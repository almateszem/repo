/**
 * FitTrack Pro — SQLite adatréteg (beépített node:sqlite)
 * ------------------------------------------------------
 * Pragmatikus hibrid séma + világos adatszétválasztás:
 *   - collections: kulcs-érték tábla a CSAK OLVASHATÓ referencia/seed adatnak
 *     (user, dashboard, charts, foods, plans, athletes…). Ez minden indításkor
 *     a data.js-ből szinkronizálódik (INSERT OR REPLACE) — így a data.js a
 *     forrása, a módosítások (és séma-bővítések) maguktól érvényre jutnak.
 *   - weight_log / nutrition_log / workouts: valódi táblák a FELHASZNÁLÓI
 *     adatnak (ide írunk POST-tal). Ezeket a seed NEM érinti, megmaradnak.
 *
 * A DB fájl: server/fittrack.db — a szerver újraindítását túléli. Ez az
 * egyetlen modul, amely a tárolást ismeri; ha később Postgresre váltanánk,
 * elég ezt átírni.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { data as seed } from './data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Alapból server/fittrack.db; a FITTRACK_DB env-változóval felülírható (pl. teszthez).
const DB_PATH = process.env.FITTRACK_DB || path.join(__dirname, 'fittrack.db');

const db = new DatabaseSync(DB_PATH);

/* ---- Séma ---- */
db.exec(`
  CREATE TABLE IF NOT EXISTS collections (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL          -- JSON
  );
  CREATE TABLE IF NOT EXISTS weight_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kg         REAL NOT NULL,
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS nutrition_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    kcal       REAL NOT NULL,
    protein    REAL NOT NULL,
    carbs      REAL NOT NULL,
    fat        REAL NOT NULL,
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS workouts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    date       TEXT NOT NULL,
    exercises  TEXT NOT NULL,          -- JSON: [{ name, pr, sets: [{ reps, weight, rpe, done }] }]
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/* ---- Seed ----
   Kollekciók: a data.js-ből szinkronizálva minden indításkor (INSERT OR
   REPLACE). Ezek csak olvasható referencia-adatok, ezért nyugodtan felül-
   írhatók a forrásból — így a data.js módosításai és a séma-bővítések maguktól
   érvényre jutnak a meglévő DB-ken is. A felhasználói adatot tartó táblákat
   (weight_log stb.) ez NEM érinti. */
const insertCollection = db.prepare('INSERT OR REPLACE INTO collections (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(seed)) {
  insertCollection.run(key, JSON.stringify(value));
}
console.log('SQLite kész →', DB_PATH);

/* ---- Olvasás ---- */

/** Egy olvasható kollekció (foods, plans, charts, …) JSON-ből visszafejtve. */
export function getCollection(key) {
  const row = db.prepare('SELECT value FROM collections WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

/** A testsúly-bejegyzések a valódi táblából, rögzítési sorrendben. */
export function getWeightLog() {
  return db.prepare('SELECT id, kg, date FROM weight_log ORDER BY id').all();
}

/** A naplózott ételek, rögzítési sorrendben. */
export function getNutritionLog() {
  return db.prepare('SELECT id, name, kcal, protein, carbs, fat, date FROM nutrition_log ORDER BY id').all();
}

/** A napi táplálkozási összesítő egy adott napra: a kiinduló alap + az AZNAP
    naplózott ételek összege, valamint az edző által kitűzött napi cél
    (a felület a célhoz méri a bevitelt). */
export function getNutritionTotals(date) {
  const base = getCollection('nutritionBase') || { intake: 0, protein: 0, carbs: 0, fat: 0 };
  const sum = db.prepare(`
    SELECT COALESCE(SUM(kcal), 0)    AS intake,
           COALESCE(SUM(protein), 0) AS protein,
           COALESCE(SUM(carbs), 0)   AS carbs,
           COALESCE(SUM(fat), 0)     AS fat
    FROM nutrition_log
    WHERE date = ?
  `).get(date);
  return {
    intake:  base.intake  + sum.intake,
    protein: base.protein + sum.protein,
    carbs:   base.carbs   + sum.carbs,
    fat:     base.fat     + sum.fat,
    goal:    getCollection('nutritionGoal') || { calories: 0, protein: 0 },
  };
}

/** A mentett edzések, legújabb elöl (a gyakorlatok JSON-ból visszafejtve). */
export function getWorkouts() {
  return db.prepare('SELECT id, name, date, exercises FROM workouts ORDER BY id DESC').all()
    .map((row) => ({ id: row.id, name: row.name, date: row.date, exercises: JSON.parse(row.exercises) }));
}

/** Teljes pillanatkép a beállítások exportjához (minden kollekció + naplók). */
export function getSnapshot() {
  const snapshot = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM collections').all()) {
    snapshot[key] = JSON.parse(value);
  }
  snapshot.weightLog = getWeightLog();
  snapshot.nutritionLog = getNutritionLog();
  snapshot.workouts = getWorkouts();
  return snapshot;
}

/* ---- Írás ---- */

/** Új testsúly-bejegyzés; visszaadja a létrejött { id, kg, date } sort. */
export function addWeightEntry(kg, date) {
  const { lastInsertRowid } = db.prepare('INSERT INTO weight_log (kg, date) VALUES (?, ?)').run(kg, date);
  return db.prepare('SELECT id, kg, date FROM weight_log WHERE id = ?').get(Number(lastInsertRowid));
}

/** Étel naplózása (a makrók a szerver-oldali food objektumból). Visszaadja a
    frissített napi összesítőt { intake, protein, carbs, fat }. */
export function addNutritionEntry(food, date) {
  db.prepare(`INSERT INTO nutrition_log (name, kcal, protein, carbs, fat, date)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(food.name, food.kcal, food.protein, food.carbs, food.fat, date);
  return getNutritionTotals(date);
}

/** Edzés mentése; visszaadja a létrejött { id, name, date, exercises } sort. */
export function addWorkout(name, date, exercises) {
  const { lastInsertRowid } = db.prepare('INSERT INTO workouts (name, date, exercises) VALUES (?, ?, ?)')
    .run(name, date, JSON.stringify(exercises));
  return { id: Number(lastInsertRowid), name, date, exercises };
}
