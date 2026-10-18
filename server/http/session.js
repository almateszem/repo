/**
 * Podium — munkamenet és a kérés napja
 * ------------------------------------------------------------------------
 * A munkamenet-süti, a kérés-korlátok, a belépés-őr és az írás-korlát, és a
 * kérés napja (X-Client-Date). A register(app) a belépés-őrt és az írás-
 * korlátot köti be — az auth-végpontok UTÁN, minden más útvonal ELŐTT.
 */
import { createSessionToken, hashToken, parseCookies, serializeCookie } from '../auth.js';
import { dayKey, daysBetween, formatDate, parseDate } from '../dates.js';
import { createSession, getSessionUser } from '../db.js';
import { createRateLimiter } from '../ratelimit.js';

const SESSION_COOKIE = 'podium_session';
const SESSION_DAYS = 30;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

/* ---- Kérés-korlátozás ----
   Három külön korlát, mert három külön dolgot védenek. A számláló memóriában
   él (ld. server/ratelimit.js) — újraindításkor nullázódik, több példánynál
   példányonként számol; ezt vállaljuk.

   A KULCS ott dönt, ahol a támadási felület van. A regisztráció az egyetlen
   olyan írás, amihez nem kell fiók, tehát ott csak a kérés forrása marad
   fogódzónak; minden más végpont belépést követel, ott viszont a FIÓK a
   helyes kulcs (egy fiók sok IP-ről is nyomhatja, és egy megosztott IP mögül
   sokan dolgozhatnak).

   A limitek szándékosan bőkezűek: a valódi használatot nem szabad zavarniuk.
   Az autosave a legsűrűbb író (500 ms debounce → legfeljebb 2 mentés/mp),
   annak a duplája fér bele. */
const MINUTE = 60 * 1000;

/** Új fiókok egy forrásból. A szám tudatosan bőkezű: egy edzőterem vagy egy
    iroda közös IP-je mögül többen is regisztrálhatnak egyszerre, és őket nem
    szabad kizárni. Egy fiók-gyártó szkriptet ez így is megállít. */
export const registerLimiter = createRateLimiter({ limit: 30, windowMs: 60 * MINUTE });

/** Belépési kísérletek egy forrásból, sikeresek és sikertelenek együtt. A
    névre szóló zárolás csak EGY nevet véd; enélkül egy forrás korlátlanul
    próbálgathatott sok nevet (password spraying), és minden létező névre
    kiküldött rossz jelszó egy scryptet futtatott a közös szálkészleten.
    Bőkezű: egy közös IP mögül is többen beléphetnek, a munkamenet napokig él. */
export const loginLimiter = createRateLimiter({ limit: 60, windowMs: 15 * MINUTE });

/** Írások fiókonként. Az autosave legrosszabb esetének a duplája. */
const writeLimiter = createRateLimiter({ limit: 240, windowMs: MINUTE });

/** Üzenetküldés fiókonként — külön, szigorúbb korlát: itt a spam MÁSIK
    EMBER felületén jelenik meg, nem csak a szerveren okoz terhelést. */
export const messageLimiter = createRateLimiter({ limit: 20, windowMs: MINUTE });

/** KIMENŐ vonalkód-lekérés fiókonként. A végpont GET, tehát az írás-korlát
    nem fedi — pedig két olyasmit csinál, amit egy GET-től nem várnánk: hívást
    indít az Open Food Facts felé A MI User-Agentünkkel (egy végigsorolt
    kódtartomány ott minket tilt ki, mindenki más elől is), és sort hagy a
    barcode_cache-ben.

    A korlát SZÁNDÉKOSAN csak a cache-t elvétő kéréseket számolja (ld. a
    végpontot): a saját ételre és a friss cache-sorra adott válasz olcsó, azt
    nincs miért korlátozni. Így a valódi használat — beolvas, elgépel, újra
    beolvas — soha nem ütközik bele, a végigsorolás viszont percenként 20-nál
    nem jut tovább. */
export const barcodeLookupLimiter = createRateLimiter({ limit: 20, windowMs: MINUTE });

/** A kérés forrása. Reverse proxy mögött ehhez PODIUM_TRUST_PROXY kell
    (ld. fent), különben minden kérés a proxy címéről érkezőnek látszik — a
    regisztrációs és a belépési korlát ilyenkor az egész forgalomra közösen
    számol. */
export const requestSource = (req) => req.ip || req.socket?.remoteAddress || 'ismeretlen';

/** Elutasítás 429-cel, a szokásos Retry-After fejléccel. */
export function tooManyRequests(res, retryAfter, message) {
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({ error: message });
}

/* A Secure jelző csak HTTPS-en való kiszolgáláskor kell — localhoston
   bekapcsolva a böngésző eldobná a sütit, és senki nem tudna belépni.
   Reverse proxy mögött az x-forwarded-proto árulja el a valódi sémát. */
export const isSecureRequest = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

/** A munkamenet-süti kiadása (belépés/regisztráció) vagy törlése (kilépés). */
export function setSessionCookie(req, res, token) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, token ?? '', {
      maxAge: token ? SESSION_MAX_AGE : 0,
      secure: isSecureRequest(req),
    }),
  );
}

/** A kérés sütijéből kiolvasott munkamenet-token (vagy null). */
export const sessionToken = (req) => parseCookies(req.get('cookie'))[SESSION_COOKIE] || null;

/** Új munkamenet a felhasználónak: token a sütibe, lenyomat az adatbázisba. */
export function startSession(req, res, userId) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  createSession(hashToken(token), userId, expiresAt);
  setSessionCookie(req, res, token);
}

/* ---- Írás-korlát fiókonként ----
   Az előző réteghez hasonlóan ez is SZÁNDÉKOSAN az útvonalak előtt áll: egy
   később felvett író végpont automatikusan védett lesz.

   Csak az ÍRÁSOKAT korlátozzuk. Az olvasás sem ingyen van, de ott nincs mit
   felhalmozni: egy elszabadult olvasó legfeljebb magát lassítja, míg az írás
   sorokat hagy maga után az adatbázisban — és a szinkron SQLite miatt minden
   egyes írás az egész event loopot blokkolja. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** A szerver saját helyi napja — tartalék, ha a kliens nem mond dátumot. */
const serverToday = () => formatDate(new Date());

/* ---- A kérés napja ----
   A naplózás EGY napra könyvel: edzés, check-in, étkezés, testsúly. Melyik
   nap ez? Korábban a SZERVER helyi napja, ami hibás: egy UTC-s szerveren a
   magyar felhasználónak este 10 után már a következő napra ment minden —
   visszamenőleg torzítva a sorozatot, a heti volument és a készenlétet.

   Ezért a napot a KLIENS mondja meg (X-Client-Date fejléc, a böngésző helyi
   naptára szerint). Két dolgot ellenőrzünk rajta:
     - alakilag pontosan "ÉÉÉÉ.HH.NN", és visszaalakítva ugyanaz (tehát nem
       csúszik át egy „2026.13.45" a Date átfordulásán);
     - a szerver napjától legfeljebb EGY napra tér el. Ennyi minden létező
       időzónára elég (UTC-12 … UTC+14), viszont megakadályozza, hogy valaki
       tetszőleges napra írja vissza a saját előzményét.
   Hiányzó vagy gyanús fejléc esetén marad a szerver napja. */
const CLIENT_DATE_RE = /^\d{4}\.\d{2}\.\d{2}$/;
const CLIENT_DATE_HEADER = 'x-client-date';

export function requestDate(req) {
  const raw = String(req.get(CLIENT_DATE_HEADER) ?? '').trim();
  if (!CLIENT_DATE_RE.test(raw)) return serverToday();

  const parsed = parseDate(raw);
  if (Number.isNaN(parsed.getTime()) || formatDate(parsed) !== raw) return serverToday();

  const server = serverToday();
  // Napban mérve, nem milliszekundumban: az óraátállítás napja 25 órás, és a
  // szomszédos nap különben „túl messzinek" látszott.
  return Math.abs(daysBetween(dayKey(server), dayKey(raw))) <= 1 ? raw : server;
}

/** Az útvonalak bekötése. Ugyanarra az app-ra, amit a server.js épít — NEM
    express.Router és NEM al-alkalmazás: a guardAsyncRoutes csak az app
    metódusait foltozza (errors.js), egy Router async kezelőjének hibájára
    nem jönne válasz, egy al-alkalmazás pedig elveszítené a trust proxy
    beállítást. */
export function register(app) {
  /* ---- Hozzáférés-védelem: innentől minden /api/* végpont bejelentkezést kér.
     Ez SZÁNDÉKOSAN az összes többi útvonal ELŐTT áll: egy később felvett
     végpont automatikusan védett lesz, nem kell rá külön gondolni. ---- */
  app.use('/api', (req, res, next) => {
    const token = sessionToken(req);
    const user = token ? getSessionUser(hashToken(token)) : null;
    if (!user) return res.status(401).json({ error: 'Nincs bejelentkezve.' });
    req.user = user;
    // A kérés napja (a kliens naptára szerint) — minden végpont ezt használja,
    // hogy egy kérésen belül biztosan ugyanaz a nap szerepeljen mindenhol.
    req.today = requestDate(req);
    next();
  });

  app.use('/api', (req, res, next) => {
    if (!WRITE_METHODS.has(req.method)) return next();
    const quota = writeLimiter.hit(req.user.id);
    if (!quota.allowed) {
      return tooManyRequests(
        res,
        quota.retryAfter,
        'Túl sok kérés. Várj egy kicsit, aztán próbáld újra.',
      );
    }
    next();
  });
}
