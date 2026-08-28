/**
 * Gyűjtő — SQLite adatréteg (beépített node:sqlite)
 * =================================================
 * Az egyetlen modul, amely a tárolást ismeri. A séma a fő app `server/db.js`
 * mintáját követi (WAL, idegen kulcsok, előkészített utasítások), de az adat
 * MÁS természetű, és ez a séma legfontosabb üzenete:
 *
 *   - `users` / `sessions` — a Gyűjtő SAJÁT, a FitTrack-től független fiókjai.
 *     Ugyanaz a scrypt-kód hasheli a jelszót (shared.js), de a fiókok külön
 *     élnek: a boltban gyűjtő ember nem feltétlenül FitTrack-felhasználó.
 *   - `products` — a gyűjtés maga. **Szándékosan NINCS rajta user_id-szűrés**:
 *     ez KÖZÖS adat, mint a fő appban a `barcode_cache`. Ha ketten-hárman
 *     járjuk a boltokat, az a lényeg, hogy mindenki lássa, mi van már meg —
 *     a `created_by` / `updated_by` csak nyilvántartás, nem hozzáférés-korlát.
 *   - `scans` — minden szkennelés egy sor, a megtaláltaké is. Ebből tudjuk,
 *     hol jártunk már; a `client_id` teszi az offline felszinkronizálást
 *     idempotenssé (ld. lentebb).
 *   - `barcode_cache` — a fő app táblájával azonos alakú, hogy ugyanaz a kód
 *     ne menjen ki kétszer az Open Food Facts-hez.
 *
 * A DB fájl: gyujto/gyujto.db, a `GYUJTO_DB` env-változóval felülírható
 * (a tesztek eldobható fájlra állítják).
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.GYUJTO_DB || path.join(__dirname, 'gyujto.db');

const db = new DatabaseSync(DB_PATH);

/* WAL: az olvasók nem blokkolják az írót. Egy boltban több telefon
   szinkronizál egyszerre — a listát lekérő kérésnek nem kell megvárnia a
   beérkező tételt. A synchronous = NORMAL a WAL szokásos párja. */
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,      -- kisbetűsítve tárolva
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,             -- scrypt (server/auth.js)
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,             -- a sütiben lévő token SHA-256-ja
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL                 -- ISO-8601 UTC
  );

  -- A gyűjtés. A tápértékek — mint a FitTrack katalógusában — 100 g / 100 ml
  -- alapmennyiségre értendők, hogy az export leképezés nélkül átvihető legyen.
  -- A makrók NULLABLE-ök: a boltban elég a név, a többi otthon pótolható
  -- (status = 'piszkozat'). A nulla mást állítana, mint a hiány.
  CREATE TABLE IF NOT EXISTS products (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode    TEXT NOT NULL UNIQUE,         -- normalizált, EAN-13-ra egészített
    name       TEXT NOT NULL,
    brand      TEXT NOT NULL DEFAULT '',
    -- Nem lehet a neve "group": az SQL kulcsszó, idézőjel nélkül szintaktikai hiba.
    food_group TEXT NOT NULL DEFAULT '',
    unit       TEXT NOT NULL DEFAULT 'g',    -- 'g' | 'ml'
    kcal       REAL,
    protein    REAL,
    carbs      REAL,
    fat        REAL,
    kcal_auto  INTEGER NOT NULL DEFAULT 1,   -- 1 = a kcal a makrókból számolt
    portions   TEXT NOT NULL DEFAULT '[]',   -- JSON: [['1 adag', 150]]
    note       TEXT NOT NULL DEFAULT '',
    store      TEXT NOT NULL DEFAULT '',     -- hol találtuk
    status     TEXT NOT NULL DEFAULT 'piszkozat', -- piszkozat | kesz | exportalva
    source     TEXT NOT NULL DEFAULT 'manual',    -- manual | openfoodfacts
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Minden szkennelés, a megtaláltaké is. A client_id az OFFLINE SOR kulcsa:
  -- a telefon minden bejegyzéshez generál egyet, és ugyanaz a köteg kétszer
  -- beküldve (megszakadt válasz, kétszer megnyomott gomb) sem duplázódik.
  CREATE TABLE IF NOT EXISTS scans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode    TEXT NOT NULL,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    outcome    TEXT NOT NULL,                -- gyujtott | off | uj
    client_id  TEXT UNIQUE,                  -- a kliens által adott azonosító
    scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Vonalkód → Open Food Facts termék. NEM felhasználói adat. A negatív
  -- találatot is tároljuk (found = 0), különben minden újraolvasás új
  -- hálózati kérés lenne egy nem létező termékre.
  CREATE TABLE IF NOT EXISTS barcode_cache (
    barcode    TEXT PRIMARY KEY,
    found      INTEGER NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
  CREATE INDEX IF NOT EXISTS idx_scans_barcode ON scans(barcode);
`);

/* ======================================================================
   Fiókok és munkamenetek
   ====================================================================== */

/** Új fiók. Null, ha a felhasználónév foglalt. */
export function createUser(username, displayName, passwordHash) {
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return null;
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)',
  ).run(username, displayName, passwordHash);
  return { id: Number(lastInsertRowid), username, displayName };
}

/** A belépéshez: a jelszó-hasht IS visszaadja. Máshol ne használd. */
export function getUserWithHash(username) {
  return db.prepare('SELECT id, username, display_name, password_hash FROM users WHERE username = ?')
    .get(username) ?? null;
}

export function hasAnyUser() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

export function createSession(tokenHash, userId, expiresAt) {
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, userId, expiresAt);
}

/** A munkamenethez tartozó felhasználó, vagy null (ismeretlen vagy lejárt). */
export function getSessionUser(tokenHash) {
  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash);
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteSession(tokenHash);
    return null;
  }
  return { id: row.id, username: row.username, displayName: row.display_name };
}

export function deleteSession(tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function purgeExpiredSessions() {
  return db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run().changes;
}
purgeExpiredSessions();

/* ======================================================================
   A gyűjtés
   ====================================================================== */

/** Adatbázis-sor → a felület által várt alak (JSON-mezők kibontva). */
function toProduct(row) {
  if (!row) return null;
  let portions = [];
  try {
    portions = JSON.parse(row.portions);
  } catch {
    portions = []; // sérült JSON: a gyorsgombok elhagyhatók, a termék nem
  }
  return {
    id: row.id,
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    group: row.food_group,
    unit: row.unit,
    kcal: row.kcal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    kcalAuto: Boolean(row.kcal_auto),
    portions: Array.isArray(portions) ? portions : [],
    note: row.note,
    store: row.store,
    status: row.status,
    source: row.source,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* A listákhoz mindig a felvivő NEVÉVEL együtt kérdezünk: a felületen az
   „utoljára Kati írta át" információ nélkül a közös gyűjtés átláthatatlan. */
const PRODUCT_SELECT = `
  SELECT p.*, u.display_name AS created_by_name
  FROM products p LEFT JOIN users u ON u.id = p.created_by
`;

export function getProductByBarcode(barcode) {
  return toProduct(db.prepare(`${PRODUCT_SELECT} WHERE p.barcode = ?`).get(barcode));
}

export function getProduct(id) {
  return toProduct(db.prepare(`${PRODUCT_SELECT} WHERE p.id = ?`).get(id));
}

/**
 * A gyűjtés listája.
 * @param {string} [status] szűrés állapotra ('' = mind)
 * @param {string} [q]      keresés névre, márkára, vonalkódra
 */
export function listProducts({ status = '', q = '', limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(p.name LIKE ? OR p.brand LIKE ? OR p.barcode LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const sql = `${PRODUCT_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT ?`;
  return db.prepare(sql).all(...params, limit).map(toProduct);
}

/** Csak a kódok — ezt tölti le a kliens offline-dedupláláshoz. */
export function listBarcodes() {
  return db.prepare('SELECT barcode FROM products').all().map((row) => row.barcode);
}

/**
 * Termék felvitele vagy frissítése — MINDIG a vonalkódra.
 *
 * A boltban ugyanazt a terméket ketten is beszkennelhetik, és ugyanaz a telefon
 * is beküldheti kétszer (offline sor). Új sor helyett tehát frissítünk: a
 * vonalkód a termék azonossága.
 *
 * @param {object} value a parseProduct() kimenete
 * @param {number|null} userId ki írja
 * @param {string} [editedAt] a kliens szerinti szerkesztési idő (ISO). Egy
 *   RÉGEBBI offline tétel nem írhatja felül az újabb szerver-sort — a boltban
 *   percekkel később felszinkronizáló telefon különben visszaírná a régi adatot.
 * @returns {{product: object, skipped: boolean}}
 */
export function upsertProduct(value, userId, editedAt = null) {
  const existing = db.prepare('SELECT id, updated_at, status FROM products WHERE barcode = ?')
    .get(value.barcode);

  /* A SQLite datetime('now') alakja „2026-08-28 17:20:00", UTC-ben. Az ISO-ra
     igazítás (T + Z) nélkül a böngészők HELYI időként értelmeznék, és a
     összehasonlítás a nyári időszámítás mértékével csúszna el. */
  if (existing && editedAt) {
    const serverAt = Date.parse(`${existing.updated_at.replace(' ', 'T')}Z`);
    const clientAt = Date.parse(editedAt);
    if (Number.isFinite(serverAt) && Number.isFinite(clientAt) && clientAt < serverAt) {
      return { product: getProduct(existing.id), skipped: true };
    }
  }

  const portions = JSON.stringify(value.portions ?? []);
  if (existing) {
    db.prepare(`
      UPDATE products SET
        name = ?, brand = ?, food_group = ?, unit = ?,
        kcal = ?, protein = ?, carbs = ?, fat = ?, kcal_auto = ?,
        portions = ?, note = ?, store = ?, status = ?, source = ?,
        updated_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      value.name, value.brand, value.foodGroup, value.unit,
      value.kcal, value.protein, value.carbs, value.fat, value.kcalAuto ? 1 : 0,
      portions, value.note, value.store, value.status, value.source,
      userId, existing.id,
    );
    return { product: getProduct(existing.id), skipped: false };
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO products (
      barcode, name, brand, food_group, unit,
      kcal, protein, carbs, fat, kcal_auto,
      portions, note, store, status, source, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    value.barcode, value.name, value.brand, value.foodGroup, value.unit,
    value.kcal, value.protein, value.carbs, value.fat, value.kcalAuto ? 1 : 0,
    portions, value.note, value.store, value.status, value.source, userId, userId,
  );
  return { product: getProduct(Number(lastInsertRowid)), skipped: false };
}

export function deleteProduct(id) {
  return db.prepare('DELETE FROM products WHERE id = ?').run(id).changes > 0;
}

/** Az export után: a kivitt tételek állapota. */
export function markExported(ids) {
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(
    `UPDATE products SET status = 'exportalva', updated_at = datetime('now')
     WHERE id IN (${placeholders})`,
  ).run(...ids).changes;
}

/* ======================================================================
   Szkennelés-napló
   ====================================================================== */

/**
 * Egy szkennelés naplózása.
 * @returns {boolean} false, ha ezt a client_id-t már láttuk (offline duplikátum)
 */
export function logScan({ barcode, userId, outcome, clientId = null, scannedAt = null }) {
  if (clientId && db.prepare('SELECT 1 FROM scans WHERE client_id = ?').get(clientId)) {
    return false;
  }
  db.prepare(`
    INSERT INTO scans (barcode, user_id, outcome, client_id, scanned_at)
    VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))
  `).run(barcode, userId, outcome, clientId, scannedAt);
  return true;
}

/** A legutóbbi szkennelések — a felület „ma már megnéztük" listájához. */
export function listScans(limit = 50) {
  return db.prepare(`
    SELECT s.barcode, s.outcome, s.scanned_at, u.display_name AS user_name,
           p.name AS product_name
    FROM scans s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN products p ON p.barcode = s.barcode
    ORDER BY s.id DESC LIMIT ?
  `).all(limit).map((row) => ({
    barcode: row.barcode,
    outcome: row.outcome,
    scannedAt: row.scanned_at,
    userName: row.user_name,
    productName: row.product_name,
  }));
}

/** Számlálók a fejléchez. */
export function getStats() {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM products GROUP BY status').all();
  const counts = { piszkozat: 0, kesz: 0, exportalva: 0 };
  for (const row of byStatus) counts[row.status] = row.n;
  return {
    ...counts,
    osszes: counts.piszkozat + counts.kesz + counts.exportalva,
    maSzkennelt: db.prepare(
      "SELECT COUNT(*) AS n FROM scans WHERE date(scanned_at) = date('now')",
    ).get().n,
  };
}

/* ======================================================================
   Open Food Facts gyorsítótár
   ====================================================================== */

/** Egy hete frissebb sor. A régebbit inkább újrakérdezzük: az OFF-ban
    folyamatosan javítják a tápértékeket. */
export function readBarcodeCache(barcode) {
  const row = db.prepare(`
    SELECT found, payload FROM barcode_cache
    WHERE barcode = ? AND fetched_at > datetime('now', '-7 days')
  `).get(barcode);
  if (!row) return null;
  if (!row.found) return { found: false, product: null };
  try {
    return { found: true, product: JSON.parse(row.payload) };
  } catch {
    return null; // sérült sor: úgy kezeljük, mintha nem lenne
  }
}

export function writeBarcodeCache(barcode, product) {
  db.prepare(`
    INSERT INTO barcode_cache (barcode, found, payload, fetched_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(barcode) DO UPDATE SET
      found = excluded.found, payload = excluded.payload, fetched_at = excluded.fetched_at
  `).run(barcode, product ? 1 : 0, JSON.stringify(product ?? {}));
}

/** Csak a teszteknek és a szkripteknek: a nyers kapcsolat. */
export const rawDb = db;
