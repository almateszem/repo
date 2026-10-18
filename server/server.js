/**
 * Podium — Express szerver
 * ------------------------------
 * Egyetlen origin: ugyanez a szerver szolgálja ki a statikus frontendet
 * (a public/ mappából) ÉS a REST API-t (/api/*). Így nincs CORS, és egyetlen
 * `npm start` elindítja az egészet.
 *
 * Az adat a SQLite adatbázisból jön (server/db.js) — a végpontok azt olvassák/
 * írják, a frontend `api` rétege pedig ezeket a végpontokat hívja.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCollection, purgeExpiredSessions, getFoodsForUser, purgeBarcodeCache } from './db.js';
// Kérés-korlátozás. Tiszta számláló, adatbázis és Express nélkül — a limitek
// és a kulcsválasztás itt, a szerveren dőlnek el (server/ratelimit.js).
import { parseTrustProxy } from './ratelimit.js';
// Hibakezelő védőháló: a kezelők becsomagolása, a JSON-hibaválasz és a
// folyamat-szintű őrök (server/errors.js).
import { guardAsyncRoutes, apiErrorHandler, installProcessGuards } from './errors.js';
// HTTP biztonsági fejlécek (CSP, nosniff, frame-ancestors, HSTS) — server/headers.js.
import { securityHeaders } from './headers.js';
import { createCatalogSearch } from './catalog-search.js';
import { isSecureRequest } from './http/session.js';
// A route-modulok: mind register(app, deps) alakban (ld. ott).
import { register as registerSessionGuard } from './http/session.js';
import { register as registerAuth, registerPublic as registerAuthPublic } from './routes/auth.js';
import { register as registerCoach } from './routes/coach.js';
import { register as registerTraining } from './routes/training.js';
import { register as registerNutrition } from './routes/nutrition.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public'); // a statikus frontend mappája

const app = express();
const PORT = process.env.PORT || 3000;

/* Reverse proxy mögött (Fly.io, nginx) a kérés FORRÁSA csak ezzel helyes: e
   nélkül minden kérés a proxy címéről jön, és a forrásonkénti korlátok (a
   belépésé és a regisztrációé) az EGÉSZ forgalomra közös keretet adnak — 60
   szemét-belépés mindenkit kizárna. Alapból kikapcsolva (ld. parseTrustProxy). */
// A FITTRACK_TRUST_PROXY a projekt régi nevéből maradt, meglévő telepítéseknek.
const TRUST_PROXY = parseTrustProxy(
  process.env.PODIUM_TRUST_PROXY || process.env.FITTRACK_TRUST_PROXY,
);
app.set('trust proxy', TRUST_PROXY);

/* Az Express alapból kiírja, hogy Express — ez csak a támadónak segít abban,
   hogy a keretrendszerre szabott próbákkal kezdjen. */
app.disable('x-powered-by');

/* Biztonsági fejlécek MINDEN válaszra, a statikus fájlokra is — ezért áll itt,
   minden útvonal-regisztráció előtt (ld. server/headers.js).
   A HSTS-hez kellő `isSecureRequest` lejjebb, a süti-szakaszban él; nyíl-
   függvénybe csomagolva adjuk át, hogy a hivatkozás csak KÉRÉSKOR oldódjon
   fel — a const itt még a temporális holt zónájában van. */
app.use(securityHeaders((req) => isSecureRequest(req)));

/* A hibakezelés MINDEN útvonal-regisztráció ELŐTT áll be — ugyanaz a minta,
   mint a hozzáférés-védelemnél: egy később felvett végpont automatikusan
   védett, nem kell rá emlékezni. Enélkül egy async kezelő elutasított ígérete
   Express 4 alatt válasz nélkül hagyná a kérést. */
guardAsyncRoutes(app);

/* A POST/PUT végpontokhoz (JSON törzs olvasása). A korlát KIMONDVA: az
   alapértelmezett 100 KB már a megengedett legnagyobb edzést (50 gyakorlat ×
   50 szett, ~175 KB) is 413-mal dobta volna, a szerkezet méretét pedig
   úgyis a normalizálás korlátozza (MAX_EXERCISES / MAX_SETS_PER_EXERCISE). */
app.use(express.json({ limit: '256kb' }));

/* ======================================================================
   Fiókok — belépés, munkamenet, hozzáférés-védelem
   ----------------------------------------------------------------------
   Minden /api/* végpont bejelentkezést követel, az /api/auth/* kivételével.
   A munkamenetet HttpOnly süti hordozza; az adatbázisban csak a token
   SHA-256 lenyomata van (ld. server/auth.js).
   ====================================================================== */

/* Egyszeri figyelmeztetés, ha proxy-fejléc érkezik, de a trust proxy ki van
   kapcsolva: ez a fenti hiba pontos tünete, és némán csak akkor derülne ki,
   amikor egy támadó (vagy egy iroda) kimeríti a közös keretet. */
let proxyWarned = false;
app.use((req, res, next) => {
  if (!TRUST_PROXY && !proxyWarned && req.get('x-forwarded-for')) {
    proxyWarned = true;
    console.warn(
      'FIGYELEM: X-Forwarded-For fejléc érkezett, de a PODIUM_TRUST_PROXY nincs beállítva — ' +
        'proxy mögött a forrásonkénti korlátok (belépés, regisztráció) a TELJES forgalomra közösen számolnak. ' +
        'Állítsd a proxy-lépések számára (pl. PODIUM_TRUST_PROXY=1).',
    );
  }
  next();
});

// Az /api/auth/* végpontok: ezek NEM kérnek belépést, ezért a belépés-őr ELŐTT
registerAuthPublic(app);

/* Hozzáférés-védelem és írás-korlát: innentől minden /api/* végpont
   bejelentkezést kér (http/session.js). SZÁNDÉKOSAN a többi útvonal ELŐTT: egy
   később felvett végpont automatikusan védett lesz. */
registerSessionGuard(app);

/* Napi takarítás: a lejárt munkamenetek és a lejárt vonalkód-cache sorok. Az
   unref() miatt ez az időzítő nem tartja életben a folyamatot (pl. teszt után
   nem akad be a leállás). Egy menetben megy a kettő, mert ugyanaz a dolguk:
   olyan sorokat vinni, amiket az olvasó kód már úgysem vesz figyelembe. */
setInterval(
  () => {
    purgeExpiredSessions();
    purgeBarcodeCache();
  },
  24 * 60 * 60 * 1000,
).unref();

/* ======================================================================
   API — az adat-seam szerver-oldali vége.
   A frontend `api.getX()` metódusai ezeket a végpontokat hívják. Az olvasó-
   végpontok egy-egy collections-kulcsot adnak vissza; az útvonal → kulcs
   megfeleltetés egy helyen, hogy a lista könnyen bővíthető legyen.
   (A weight-log NEM itt van: saját táblából, dedikált route-tal jön.
    A /api/foods SEM: mióta a felhasználó saját ételt is felvihet, a válasz
    fiókfüggő — dedikált route-ot kapott a táplálkozási végpontok között.)
   ====================================================================== */
const READ_ENDPOINTS = {
  // A /api/notifications NINCS köztük: nem referencia-adat többé, hanem a
  // hívó valódi eseményeiből épül (ld. lentebb, „Értesítések").
  '/api/default-set': 'defaultSet',
  // Az időalapú sorok alapértékei — a szett-alap párja.
  '/api/default-cardio-set': 'defaultCardioSet',
  // A választható edzés-célok (kulcs + kártya-címke + felirat). A sportolók
  // listája NINCS köztük: az nem referencia-adat, hanem valódi kapcsolat —
  // ld. lentebb, „Edző–sportoló kapcsolatok".
  '/api/goals': 'goals',
};

for (const [route, key] of Object.entries(READ_ENDPOINTS)) {
  app.get(route, (req, res) => res.json(getCollection(key)));
}

/* ---- Katalógus-keresés ----
   A gyakorlat-választó és az étel-lista szeletenként kéri a katalógust: a
   szerver keres és lapoz (server/catalog-search.js), a kliens sosem kapja meg
   a teljes listát. */
const catalogSearch = createCatalogSearch({
  exercises: () => getCollection('exerciseCatalog') || [],
  seedFoods: () => getCollection('foods') || [],
  foodsFor: (userId) => getFoodsForUser(userId),
});

/* A tartományok útvonalai (register(app, deps) — ld. a modulok register-
   kommentjét). A sorrend közömbös: két útvonal sem illeszkedik ugyanarra a
   kérésre. */
const deps = { catalogSearch };
registerAuth(app);
registerCoach(app, deps);
registerTraining(app, deps);
registerNutrition(app, deps);

/* Ismeretlen API-útvonal: JSON-hibát adunk, nem az express.static HTML-es
   404-ét — így a kliens hibakezelése (ami JSON `error` mezőt olvas) értelmes
   üzenetet kap elgépelt vagy megszűnt végpont esetén is. */
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Nincs ilyen végpont: ${req.method} /api${req.path}` });
});

/* ======================================================================
   Statikus frontend — az API-útvonalak UTÁN, kizárólag a public/ mappából.
   A szerver-belső (kód, DB-fájl, node_modules) így eleve nem érhető el
   http-n, nem kell hozzá tiltólista.
   ====================================================================== */

/* A ZXing vonalkód-dekóder UMD-bundle-je. Bundler nincs a projektben, a
   public/ mappát viszont nem szemeteljük tele egy 336 KB-os függőség
   másolatával — ezért a node_modules-ból EZT AZ EGY mappát tesszük ki,
   semmi mást. A frontend lustán, csak a szkennelés indításakor tölti be, és
   ha a csomag nincs telepítve, a 404-re a kézi vonalkód-beírásra vált.
   A statikus kiszolgálás nem enged ki a mappából (az express.static a
   ../-t tartalmazó útvonalakat elutasítja), tehát a node_modules többi
   része továbbra sem érhető el. */
app.use(
  '/vendor/zxing',
  express.static(path.join(__dirname, '..', 'node_modules', '@zxing', 'library', 'umd')),
);

app.use(express.static(PUBLIC_DIR));

/* A hibakezelő az ÖSSZES útvonal UTÁN — ide fut be minden, amit a becsomagolt
   kezelők `next(err)`-rel továbbadtak, és az express.json() hibás törzsre
   dobott hibája is. A veremkép a szerver-logba megy, a kliens JSON-t kap. */
app.use(apiErrorHandler);

/* A TÉNYLEGESEN kiosztott portot írjuk ki, nem a kért PORT-ot. A kettő
   rendszerint ugyanaz, de PORT=0 esetén az operációs rendszer választ szabad
   portot — így indul a végponti teszt (server/api.test.js) is, ami ebből a
   sorból olvassa ki, hova küldje a kéréseket. */
const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console -- indulási banner: a szerver címe
  console.log(`Podium szerver fut: http://localhost:${server.address().port}`);
});

/* Ami a kérés-kezelésen KÍVÜL szállna el (időzítő, háttér-feladat): naplózzuk.
   Az elkapatlan kivétel rendezett leállást hoz, az elárvult ígéret nem —
   az indoklás a server/errors.js fejlécében van. */
installProcessGuards(server);
