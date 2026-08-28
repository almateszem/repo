/**
 * Gyűjtő — a FitTrack Pro felé vezető EGYETLEN híd
 * ================================================
 * A Gyűjtő külön app: saját szerver, saját adatbázis, saját fiókok. Két dolgot
 * viszont NEM írunk meg újra, mert a másolat garantáltan elcsúszna az eredetitől:
 *
 *   - a vonalkód mod-10 ellenőrzőszáma és az Open Food Facts leképezése
 *     (server/openfoodfacts.js) — ha a két hely másképp normalizálna, ugyanaz a
 *     termék két különböző kódon ülne, és az export nem találna rá a fő appban;
 *   - a jelszó-hash és a munkamenet-token (server/auth.js) — kriptográfiai kódot
 *     duplikálni önmagában is hiba.
 *
 * Mindkettő NULLA FÜGGŐSÉGŰ, tiszta modul (csak node:crypto), tehát az import
 * nem húz be semmit a fő app szerveréből — sem Expresst, sem adatbázist.
 *
 * HA A MAPPÁT KI KELL EMELNI a repóból: másold a `server/openfoodfacts.js`-t és a
 * `server/auth.js`-t a gyujto/ mellé, és írd át az alábbi két útvonalat. Más
 * fájlban nincs hivatkozás a fő appra.
 */

export {
  normalizeBarcode, mapProduct, fetchProduct,
} from '../server/openfoodfacts.js';

export {
  hashPassword, verifyPassword, createSessionToken, hashToken,
  parseCookies, serializeCookie, isLockedOut, recordFailure, clearFailures,
  USERNAME_RE, PASSWORD_MIN, normalizeUsername,
} from '../server/auth.js';

export { createRateLimiter } from '../server/ratelimit.js';

/* A kategóriák a fő app étel-katalógusából jönnek: a gyűjtött termék így
   ugyanabba a 17 csoportba kerül, amit a FitTrack ismer — az exportnak nem kell
   utólag megfeleltetnie semmit. A foods.hu.js import a 437 elemű listát is
   behúzza, de csak modul-szinten, egyszer: a Gyűjtő nem használja az ételeket,
   csak a csoportneveket. */
export { FOOD_GROUPS } from '../server/data/foods.hu.js';
