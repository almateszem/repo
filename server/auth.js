/**
 * FitTrack Pro — jelszó-kezelés, munkamenet-tokenek, sütik
 * ---------------------------------------------------------
 * Nulla új függőség: minden a beépített node:crypto-ból jön.
 *
 * Két külön dolgot kezel, és a kettőt szándékosan nem keverjük:
 *   - JELSZÓ: scrypt-tel hashelve, sónként külön sóval. Lassú, ez a lényege.
 *   - MUNKAMENET: véletlen token, amit a süti hordoz. Az adatbázisba CSAK a
 *     token SHA-256 lenyomata kerül — ha valaki megszerzi a DB-t, a sütiket
 *     nem tudja belőle visszafejteni. Itt a gyors hash a helyes választás:
 *     a token 256 bites véletlen, nincs mit szótárazni rajta.
 *
 * A modul nem ismeri sem az adatbázist, sem az Expresst — tiszta függvények,
 * ezért külön tesztelhető (server/auth.test.js).
 */
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/* A scrypt paraméterei. Az N a költség: 16384-gyel egy ellenőrzés ~50-80 ms,
   ami interaktív belépéshez még kényelmes, tömeges próbálgatáshoz viszont már
   drága. A paraméterek BELE vannak írva minden hashbe, így később emelhetők
   anélkül, hogy a régi jelszavak érvénytelenné válnának. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Jelszó → tárolható hash-sztring ("scrypt$N$r$p$só$kulcs", mind hex). */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${key.toString('hex')}`;
}

/**
 * Jelszó ellenőrzése a tárolt hash ellen. Hamis minden olyan esetben is,
 * amikor a tárolt érték hiányzik vagy sérült — a hívónak nem kell külön
 * ágat írnia rá.
 *
 * Az üres tárolt hash SZÁNDÉKOSAN mindig hamis: az archív („korábbi adatok")
 * felhasználó ilyen, és soha nem szabad tudni belépni vele.
 */
/* Egy jól formált, de SEMMILYEN jelszóhoz nem tartozó hash (a kulcs csupa
   nulla, amit a scrypt kimenete gyakorlatilag soha nem ad ki). */
const DUMMY_HASH = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${'0'.repeat(32)}$${'0'.repeat(128)}`;

/** Ál-ellenőrzés nem létező felhasználónévre: ugyanazt a scryptet futtatja,
    mint a valódi, és mindig hamis. Enélkül a belépés nem létező névnél
    azonnal válaszolt, létezőnél ~50-80 ms után — az időzítésből így ki
    lehetett olvasni, mely nevek foglaltak. */
export const verifyAgainstDummy = async (password) => {
  await verifyPassword(password, DUMMY_HASH);
  return false;
};

export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, n, r, p, salt, expected] = parts;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false;
  }

  const expectedBuf = Buffer.from(expected, 'hex');
  if (expectedBuf.length === 0) return false;

  let actual;
  try {
    actual = await scryptAsync(password, salt, expectedBuf.length, params);
  } catch {
    return false; // értelmezhetetlen paraméterek (pl. túl nagy N)
  }
  // Azonos hosszúságú pufferek — a timingSafeEqual különben dobna.
  return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}

/** Új munkamenet-token (a sütibe kerül; az adatbázis csak a lenyomatát látja). */
export const createSessionToken = () => randomBytes(32).toString('base64url');

/** A token adatbázisban tárolt alakja. */
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

/** Cookie-fejléc → { név: érték }. Üres/hiányzó fejlécre üres objektum.
    (Nem húzunk be cookie-parser függőséget egyetlen sütiért.) */
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[name] = part.slice(eq + 1).trim(); // hibás %-kódolás: nyersen
    }
  }
  return out;
}

/** Set-Cookie fejléc összeállítása. A maxAge másodpercben; 0 = azonnali törlés. */
export function serializeCookie(name, value, { maxAge, secure = false } = {}) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',            // JS-ből nem olvasható → XSS esetén sem lopható ki
    'SameSite=Lax',        // más oldalról indított kérésekhez nem megy el
  ];
  if (maxAge !== undefined) bits.push(`Max-Age=${maxAge}`);
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/* ---- Belépési kísérlet-korlátozás ----
   Memóriában. Nem elosztott megoldás (újraindításkor nullázódik), de a
   jelszó-próbálgatás ellen a scrypt lassúsága mellett ez bőven elég — és nem
   igényel külső tárat.

   A KULCS dönti el, kit zár ki. Eredetileg a puszta felhasználónév volt: így
   BÁRKI kizárhatta az áldozatot 15 percenként 10 rossz jelszóval — a
   belépésből, a jelszócseréből és a fióktörlésből is. Ezért most két külön
   kulcstér van (ld. loginFailureKey / accountFailureKey). */
const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // kulcs → { count, firstAt }

/** Ennyi kulcs fölött söprünk a lejártakért — a ratelimit.js mintájára. A
    söprés nélkül minden valaha próbált kulcs bent maradna: egyedi nevekkel
    (vagy forrásokkal) a map a memória elfogyásáig hízlalható volt. */
const FAILURE_SWEEP_THRESHOLD = 1000;

/** Belépés: név ÉS forrás. A próbálgató így csak a saját forrását zárja ki —
    az áldozat a saját gépéről továbbra is beléphet. Az elosztott, sok forrásból
    jövő próbálgatást a forrásonkénti belépési korlát és a scrypt fékezi. */
export const loginFailureKey = (username, source) => `login:${username}|${source}`;

/** Belépett fiók műveletei (jelszócsere, törlés): a fiók azonosítója. Külön
    kulcstér, hogy a belépés idegen próbálgatása ne blokkolhassa a tulajdonost
    abban, hogy a kompromittált jelszavát lecserélje. */
export const accountFailureKey = (userId) => `account:${userId}`;

function sweepFailures(now) {
  for (const [key, entry] of failures) {
    if (now - entry.firstAt > FAILURE_WINDOW_MS) failures.delete(key);
  }
}

/** Csak a teszteknek: hány kulcsot tartunk épp nyilván. */
export const trackedFailureKeys = () => failures.size;

/** Igaz, ha a kulcs (felhasználónév) épp zárolva van. */
export function isLockedOut(key, now = Date.now()) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (now - entry.firstAt > FAILURE_WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= FAILURE_LIMIT;
}

/** Sikertelen belépés könyvelése. */
export function recordFailure(key, now = Date.now()) {
  if (failures.size > FAILURE_SWEEP_THRESHOLD) sweepFailures(now);
  const entry = failures.get(key);
  if (!entry || now - entry.firstAt > FAILURE_WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

/** Sikeres belépés — a számláló nullázódik. */
export const clearFailures = (key) => failures.delete(key);

/* ---- Bemenet-ellenőrzés ---- */

export const USERNAME_RE = /^[a-z0-9._-]{3,24}$/;
export const PASSWORD_MIN = 8;

/** A felhasználónév normalizált alakja (a bejelentkezés kisbetű-érzéketlen). */
export const normalizeUsername = (raw) => String(raw ?? '').trim().toLowerCase();
