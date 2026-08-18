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
   Memóriában, felhasználónévre. Nem elosztott megoldás (újraindításkor
   nullázódik), de a jelszó-próbálgatás ellen a scrypt lassúsága mellett ez
   bőven elég — és nem igényel külső tárat. */
const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // kulcs → { count, firstAt }

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
