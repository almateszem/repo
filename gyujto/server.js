/**
 * Gyűjtő — Express szerver
 * ========================
 * Egyetlen origin: ugyanez a szerver adja a statikus felületet (gyujto/public/)
 * ÉS a REST API-t (/api/*). Nincs CORS, egyetlen parancs elindítja.
 *
 * A fő app (server/server.js) mintáit követi — süti-alapú munkamenet, „minden
 * /api/* védett" közbeiktatott réteg, kérés-korlátozás, JSON-hibák magyarul —,
 * de az adata és a fiókjai KÜLÖN élnek. A kapcsolat a két app között egyirányú
 * és offline: az export-szkript (scripts/export-products.js).
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createUser, getUserWithHash, hasAnyUser,
  createSession, getSessionUser, deleteSession, purgeExpiredSessions,
  getProductByBarcode, getProduct, listProducts, listBarcodes,
  upsertProduct, deleteProduct,
  logScan, listScans, getStats,
  readBarcodeCache, writeBarcodeCache,
} from './db.js';
import { parseProduct, STATUSES } from './products.js';
import {
  normalizeBarcode, fetchProduct,
  hashPassword, verifyPassword, createSessionToken, hashToken,
  parseCookies, serializeCookie, isLockedOut, recordFailure, clearFailures,
  USERNAME_RE, PASSWORD_MIN, normalizeUsername, createRateLimiter,
  FOOD_GROUPS,
} from './shared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
const PORT = process.env.PORT || process.env.GYUJTO_PORT || 3100;

/* A szinkron-köteg nagyobb, mint egy szokásos űrlap: egy fél napnyi offline
   gyűjtés is elfér benne. Az 512 kB még mindig messze van attól, hogy egy
   elszabadult kliens megfektesse a szervert. */
app.use(express.json({ limit: '512kb' }));

const SESSION_COOKIE = 'gyujto_session';
const SESSION_DAYS = 90;   // hosszabb, mint a fő appé: ezt a telefonon a
                           // kezdőképernyőről nyitjuk, ritkán és sietve
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

const MINUTE = 60 * 1000;
const registerLimiter = createRateLimiter({ limit: 10, windowMs: 60 * MINUTE });
/* A szkennelés a leggyakoribb művelet: percenként 120 kód bőven elég egy
   embernek (kettesével-hármasával szkennelünk másodpercenként), de egy
   végtelen ciklusba került klienst megállít. */
const lookupLimiter = createRateLimiter({ limit: 120, windowMs: MINUTE });
const writeLimiter = createRateLimiter({ limit: 240, windowMs: MINUTE });

const requestSource = (req) => req.ip || req.socket?.remoteAddress || 'ismeretlen';

function tooManyRequests(res, retryAfter, message) {
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({ error: message });
}

/* A Secure jelző csak HTTPS-en kell — localhoston bekapcsolva a böngésző
   eldobná a sütit, és senki nem tudna belépni. */
const isSecureRequest = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

function setSessionCookie(req, res, token) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, token ?? '', {
    maxAge: token ? SESSION_MAX_AGE : 0,
    secure: isSecureRequest(req),
  }));
}

const sessionToken = (req) => parseCookies(req.get('cookie'))[SESSION_COOKIE] || null;

function startSession(req, res, userId) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  createSession(hashToken(token), userId, expiresAt);
  setSessionCookie(req, res, token);
}

/* ======================================================================
   Fiókok — ezek a végpontok NEM igényelnek bejelentkezést
   ====================================================================== */

app.get('/api/auth/me', (req, res) => {
  const token = sessionToken(req);
  const user = token ? getSessionUser(hashToken(token)) : null;
  // A firstRun jelzi, hogy még egy fiók sincs: a felület ilyenkor rögtön a
  // regisztrációt kínálja, nem a belépést.
  if (!user) return res.status(401).json({ error: 'Nincs bejelentkezve.', firstRun: !hasAnyUser() });
  res.json(user);
});

function parseCredentials(body) {
  const username = normalizeUsername(body?.username);
  if (!USERNAME_RE.test(username)) {
    return {
      error: 'A felhasználónév 3–24 karakter lehet, és csak angol kisbetűt, számot, '
        + 'pontot, kötőjelet vagy aláhúzást tartalmazhat.',
    };
  }
  const password = String(body?.password ?? '');
  if (password.length < PASSWORD_MIN) {
    return { error: `A jelszó legalább ${PASSWORD_MIN} karakter legyen.` };
  }
  return { username, password };
}

app.post('/api/auth/register', async (req, res) => {
  const quota = registerLimiter.hit(requestSource(req));
  if (!quota.allowed) {
    return tooManyRequests(res, quota.retryAfter, 'Túl sok regisztráció innen. Próbáld később.');
  }

  const parsed = parseCredentials(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const displayName = String(req.body?.displayName ?? '').trim().slice(0, 40) || parsed.username;
  const user = createUser(parsed.username, displayName, await hashPassword(parsed.password));
  if (!user) return res.status(409).json({ error: 'Ez a felhasználónév már foglalt.' });

  startSession(req, res, user.id);
  res.status(201).json(user);
});

/** A hibaüzenet szándékosan nem árulja el, a név vagy a jelszó volt-e rossz. */
app.post('/api/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password ?? '');

  if (isLockedOut(username)) {
    return res.status(429).json({
      error: 'Túl sok sikertelen próbálkozás. Próbáld újra néhány perc múlva.',
    });
  }

  const row = getUserWithHash(username);
  if (!row || !await verifyPassword(password, row.password_hash)) {
    recordFailure(username);
    return res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó.' });
  }

  clearFailures(username);
  startSession(req, res, row.id);
  res.json({ id: row.id, username: row.username, displayName: row.display_name });
});

app.post('/api/auth/logout', (req, res) => {
  const token = sessionToken(req);
  if (token) deleteSession(hashToken(token));
  setSessionCookie(req, res, null);
  res.status(204).end();
});

/* ---- Innentől MINDEN /api/* végpont bejelentkezést kér. Szándékosan az
   összes többi útvonal ELŐTT: egy később felvett végpont automatikusan védett
   lesz, nem kell rá külön gondolni. ---- */
app.use('/api', (req, res, next) => {
  const token = sessionToken(req);
  const user = token ? getSessionUser(hashToken(token)) : null;
  if (!user) return res.status(401).json({ error: 'Nincs bejelentkezve.' });
  req.user = user;
  next();
});

/* Írás-korlát fiókonként. Az olvasásokat nem terheljük vele — azok olcsók. */
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const quota = writeLimiter.hit(`u${req.user.id}`);
  if (!quota.allowed) {
    return tooManyRequests(res, quota.retryAfter, 'Túl sok kérés. Várj egy kicsit.');
  }
  next();
});

/* ======================================================================
   Vonalkód feloldása — az app legfontosabb végpontja
   ----------------------------------------------------------------------
   A keresés sorrendje, minden lépés megspórol egy hálózati kört:
     1. a KÖZÖS gyűjtés (products) — ezt már felvittük, kész vagyunk;
     2. helyi gyorsítótár (barcode_cache);
     3. Open Food Facts.
   A `status` mezőből tudja a felület, mit mutasson:
     'gyujtott' → megvan nálunk   'off' → az OFF ismeri   'uj' → felvihető
   ====================================================================== */
app.get('/api/lookup/:code', async (req, res) => {
  const quota = lookupLimiter.hit(`u${req.user.id}`);
  if (!quota.allowed) {
    return tooManyRequests(res, quota.retryAfter, 'Túl sok szkennelés egy perc alatt. Várj kicsit.');
  }

  const barcode = normalizeBarcode(req.params.code);
  if (!barcode) {
    return res.status(400).json({
      error: 'Érvénytelen vonalkód — 8, 12, 13 vagy 14 számjegy, helyes ellenőrzőszámmal.',
    });
  }

  const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : null;
  const finish = (status, extra) => {
    logScan({ barcode, userId: req.user.id, outcome: status, clientId });
    res.json({ status, barcode, ...extra });
  };

  const collected = getProductByBarcode(barcode);
  if (collected) return finish('gyujtott', { product: collected });

  const cached = readBarcodeCache(barcode);
  if (cached) {
    return cached.found ? finish('off', { product: cached.product }) : finish('uj', {});
  }

  const result = await fetchProduct(barcode);
  if (!result.ok) {
    /* Hálózati hiba: NEM cache-eljük, és NEM állítjuk, hogy a termék hiányzik.
       A boltban ilyenkor a felhasználó dönt: felviszi kézzel (a kód érvényes),
       vagy később újrapróbálja. A szkennelés tényét viszont naplózzuk. */
    logScan({ barcode, userId: req.user.id, outcome: 'uj', clientId });
    return res.status(502).json({
      status: 'ismeretlen',
      barcode,
      error: 'Az Open Food Facts most nem elérhető — vidd fel kézzel, vagy próbáld később.',
    });
  }

  writeBarcodeCache(barcode, result.product);
  if (!result.product) return finish('uj', {});
  finish('off', { product: result.product });
});

/* ======================================================================
   A gyűjtés
   ====================================================================== */

/** A kategórialista — a felület ebből építi a legördülőt. */
app.get('/api/groups', (req, res) => res.json(FOOD_GROUPS));

app.get('/api/products', (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '';
  const q = String(req.query.q ?? '').trim().slice(0, 60);
  res.json(listProducts({ status, q }));
});

/** Csak a kódok. A kliens ezt tölti le, hogy OFFLINE is tudja, mit gyűjtöttünk
    már — enélkül a boltban ugyanazt a terméket többször vinnénk fel. */
app.get('/api/barcodes', (req, res) => res.json(listBarcodes()));

app.get('/api/scans', (req, res) => res.json(listScans(50)));

app.get('/api/stats', (req, res) => res.json(getStats()));

/** Termék felvitele vagy frissítése. A kulcs MINDIG a vonalkód: ugyanazt a
    terméket ketten is beszkennelhetik, új sor helyett tehát frissítünk. */
app.post('/api/products', (req, res) => {
  const parsed = parseProduct(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const { product } = upsertProduct(parsed.value, req.user.id, req.body?.editedAt ?? null);
  res.status(201).json(product);
});

app.put('/api/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen azonosító.' });
  }
  const existing = getProduct(id);
  if (!existing) return res.status(404).json({ error: 'Nincs ilyen tétel a gyűjtésben.' });

  /* A vonalkód nem írható át: az a termék azonossága. Aki elgépelte, törölje a
     sort és szkennelje újra — így nem lesz két sor ugyanarra a termékre. */
  const parsed = parseProduct({ ...req.body, barcode: existing.barcode });
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const { product } = upsertProduct(parsed.value, req.user.id, req.body?.editedAt ?? null);
  res.json(product);
});

app.delete('/api/products/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen azonosító.' });
  }
  if (!deleteProduct(id)) return res.status(404).json({ error: 'Nincs ilyen tétel a gyűjtésben.' });
  res.status(204).end();
});

/* ======================================================================
   Offline sor — kötegelt beküldés
   ----------------------------------------------------------------------
   A boltban gyakran nincs net: a telefon a szkenneléseket és a kitöltött
   űrlapokat egy sorban tartja, és hálózat esetén EGY kéréssel küldi fel.
   A végpont TÉTELENKÉNT válaszol, és soha nem esik el az egészre: egy hibás
   sor (mondjuk hiányos név) nem viheti magával a másik harmincat.

   Idempotens: ugyanaz a `clientId` kétszer beküldve egy sort ad. Enélkül a
   megszakadt válasz utáni újrapróbálás duplázna — ami pont akkor történik,
   amikor a hálózat rossz, tehát mindig.
   ====================================================================== */
app.post('/api/sync', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : null;
  if (!items) return res.status(400).json({ error: 'A törzsben `items` tömböt várunk.' });

  const results = items.map((item) => {
    const clientId = String(item?.clientId ?? '').slice(0, 64) || null;

    if (item?.type === 'scan') {
      const barcode = normalizeBarcode(item?.barcode);
      if (!barcode) return { clientId, ok: false, error: 'Érvénytelen vonalkód.' };
      const outcome = ['gyujtott', 'off', 'uj'].includes(item?.outcome) ? item.outcome : 'uj';
      const inserted = logScan({
        barcode, userId: req.user.id, outcome, clientId, scannedAt: item?.scannedAt ?? null,
      });
      return { clientId, ok: true, duplicate: !inserted };
    }

    if (item?.type === 'product') {
      const parsed = parseProduct(item?.payload ?? {});
      if (!parsed.ok) return { clientId, ok: false, error: parsed.error };
      const { product, skipped } = upsertProduct(
        parsed.value, req.user.id, item?.editedAt ?? null,
      );
      return { clientId, ok: true, skipped, product };
    }

    return { clientId, ok: false, error: 'Ismeretlen tétel-típus.' };
  });

  res.json({ results, stats: getStats() });
});

/** A kész tételek gépi alakban — ugyanaz, amit az export-szkript ír ki. */
app.get('/api/export.json', (req, res) => res.json(listProducts({ status: 'kesz', limit: 5000 })));

/* Ismeretlen API-útvonal: JSON-hiba, nem az express.static HTML-es 404-e. */
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Nincs ilyen végpont: ${req.method} /api${req.path}` });
});

/* ======================================================================
   Statikus felület — az API-útvonalak UTÁN, kizárólag a gyujto/public/-ból.
   ====================================================================== */

/* A ZXing dekóder UMD-bundle-je a GYÖKÉR node_modules-ból (a Gyűjtőnek nincs
   saját telepítése — ld. a package.json melletti megjegyzést a README-ben).
   Lustán, csak szkenneléskor töltjük be; ha nincs telepítve, a 404-re a felület
   a kézi kódbeírásra vált. */
app.use('/vendor/zxing', express.static(
  path.join(__dirname, '..', 'node_modules', '@zxing', 'library', 'umd'),
));

app.use(express.static(PUBLIC_DIR));

/* Naponta egyszer kitakarítjuk a lejárt munkameneteket. Az unref() nélkül ez
   az időzítő életben tartaná a folyamatot a tesztek végén is. */
setInterval(purgeExpiredSessions, 24 * 60 * 60 * 1000).unref();

const server = app.listen(PORT, () => {
  console.log(`Gyűjtő szerver fut: http://localhost:${server.address().port}`);
});
