/**
 * QR Food Scanner — helyi adatbázis (beépített node:sqlite)
 * ---------------------------------------------------------
 * Egyetlen tábla: azok a termékek, amiket az Open Food Facts NEM ismer, és
 * ezért a felhasználó töltött ki kézzel. A fájl a szerver mellett él
 * (server/qr-food-scanner.db), tehát az újraindítást túléli.
 *
 * Ez az egyetlen modul, amely a tárolást ismeri — ha valaha más adatbázisra
 * váltanánk, elég ezt átírni.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// A QRFS_DB env-változóval felülírható (a tesztek külön fájlra mutatnak).
const DB_PATH = process.env.QRFS_DB || path.join(__dirname, 'qr-food-scanner.db');

const db = new DatabaseSync(DB_PATH);

/* WAL: az olvasók nem blokkolják az írót. A synchronous = NORMAL a szokásos
   párja — áramszünetnél a legutolsó tranzakció elveszhet, de a fájl nem sérül. */
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');

/* A vonalkód a kulcs: egy termék EGY soron ül. A makrók 100 g / 100 ml
   mennyiségre értendők — ugyanaz az alap, amit az OFF is használ, így a két
   forrásból származó adat összehasonlítható. */
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    barcode    TEXT PRIMARY KEY,
    name       TEXT    NOT NULL,
    unit       TEXT    NOT NULL DEFAULT 'g',
    kcal       REAL    NOT NULL,
    protein    REAL    NOT NULL,
    carbs      REAL    NOT NULL,
    fat        REAL    NOT NULL,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
  )
`);

/**
 * Egy mentett termék vonalkód alapján.
 * @param {string} barcode
 * @returns {object|undefined}
 */
export function getProduct(barcode) {
  return db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode);
}

/**
 * Termék mentése. Ugyanarra a vonalkódra a régi sort FELÜLÍRJA (a felhasználó
 * elgépelheti a fehérjét, és a javítás nem szülhet második sort ugyanarról a
 * termékről) — a `created_at` viszont megmarad az elsőnek.
 *
 * @param {{barcode: string, name: string, unit: string, kcal: number,
 *          protein: number, carbs: number, fat: number}} product
 * @returns {object} a mentett sor
 */
export function saveProduct(product) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO products (barcode, name, unit, kcal, protein, carbs, fat, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(barcode) DO UPDATE SET
      name = excluded.name,
      unit = excluded.unit,
      kcal = excluded.kcal,
      protein = excluded.protein,
      carbs = excluded.carbs,
      fat = excluded.fat,
      updated_at = excluded.updated_at
  `).run(
    product.barcode, product.name, product.unit,
    product.kcal, product.protein, product.carbs, product.fat,
    now, now,
  );
  return getProduct(product.barcode);
}

/**
 * A mentett termékek, a legutóbb mentettel az élen.
 * @param {number} [limit=50]
 * @returns {object[]}
 */
export function listProducts(limit = 50) {
  return db.prepare('SELECT * FROM products ORDER BY updated_at DESC LIMIT ?').all(limit);
}

/** Csak teszthez: a tábla ürítése. */
export function clearProducts() {
  db.exec('DELETE FROM products');
}
