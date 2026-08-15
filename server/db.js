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
import { buildExerciseCatalog, buildFoodCatalog } from './data/catalog.js';

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
    grams      REAL NOT NULL DEFAULT 100,  -- a naplózott adag; a makrók erre az adagra vonatkoznak
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
    -- JSON: [{ name, pr, superset, sets: [{ reps, weight, rpe, type, done }] }]
    -- A superset azt jelenti: „ez a gyakorlat az ELŐTTE lévővel egy körben" —
    -- a szuperszett-csoportokat így a tömbsorrend adja ki, nem külön azonosító.
    exercises  TEXT NOT NULL,
    plan_id    INTEGER,                -- melyik tervből indult (NULL, ha szabad edzés)
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS plans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    date       TEXT NOT NULL,
    exercises  TEXT NOT NULL,          -- JSON, a workouts.exercises-szel azonos alak
    days       TEXT NOT NULL DEFAULT '[]',  -- JSON: hétnap-indexek (0 = hétfő), amikor a terv az Edzés oldalra töltődik
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS workout_draft (
    id         INTEGER PRIMARY KEY CHECK (id = 1),  -- mindig egyetlen sor: az épp szerkesztett edzés
    name       TEXT NOT NULL,
    exercises  TEXT NOT NULL,          -- JSON, a workouts.exercises-szel azonos alak
    date       TEXT NOT NULL DEFAULT '',            -- a mentés HELYI napja — ebből tudni, friss-e a piszkozat
    plan_id    INTEGER,                             -- melyik tervből indult (NULL, ha szabad edzés)
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Napi regenerációs check-in: naponta egy sor, a dátum a kulcs.
  -- MINDEN mérőszám-oszlop NULL-ozható, és ez lényeges: a Recovery Engine a
  -- „nem adta meg" és a „nulla" esetet külön kezeli — a hiányzó mezők súlya
  -- arányosan újraoszlik a képletben, nem nullaként számít bele.
  CREATE TABLE IF NOT EXISTS checkins (
    date          TEXT PRIMARY KEY,     -- "ÉÉÉÉ.HH.NN", a szerver helyi napja
    sleep_hours   REAL,                 -- alvás időtartama órában
    sleep_quality INTEGER,              -- 1–5
    energy        INTEGER,              -- 1–5
    stress        INTEGER,              -- 1–5 (magasabb = rosszabb)
    mood          INTEGER,              -- 1–5 közérzet
    hydration     REAL,                 -- liter
    soreness      TEXT NOT NULL DEFAULT '{}',  -- JSON: { chest: 0..5, … } izomcsoportonként
    pain          TEXT NOT NULL DEFAULT '{}',  -- JSON: { general: 0..10, quads: 0..10, … }
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS exercise_maxes (
    exercise_name TEXT PRIMARY KEY,    -- a gyakorlat neve
    max_1rm       REAL NOT NULL,        -- Epley-képlettel számított maximális 1RM (kg)
    date          TEXT NOT NULL,        -- mikor jött ez az értékelés
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/* ---- Migrációk ----
   A CREATE TABLE IF NOT EXISTS a meglévő táblákat nem bővíti — az utólag
   bevezetett oszlopokat itt pótoljuk a régebbi DB-fájlokon. */
function ensureColumn(table, column, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('plans', 'days', "days TEXT NOT NULL DEFAULT '[]'");
ensureColumn('workout_draft', 'date', "date TEXT NOT NULL DEFAULT ''");
ensureColumn('workouts', 'plan_id', 'plan_id INTEGER');
ensureColumn('workout_draft', 'plan_id', 'plan_id INTEGER');
// A naplózás korábban fix 100 g-os adaggal ment — a régi sorok makrói tehát
// 100 g-ra vonatkoznak, ezért a default érték helyes a meglévő adatokra is.
ensureColumn('nutrition_log', 'grams', 'grams REAL NOT NULL DEFAULT 100');

/* A szett-értékek korábban mértékegységgel együtt, szabad szövegként voltak
   tárolva („12 rep", „60% TM", „–"). A felület már szám-mezőkkel szerkeszti
   őket, ezért a meglévő sorokból kinyerjük a puszta számot. A művelet
   idempotens (számból ugyanaz a szám lesz), és csak a ténylegesen változó
   sorokat írja vissza, így minden induláskor nyugodtan lefuthat. */
const firstNumber = (raw) => {
  const match = String(raw ?? '').replace(',', '.').match(/\d+(\.\d+)?/);
  return match ? match[0] : '';
};

function migrateSetValuesToNumbers(table) {
  const rows = db.prepare(`SELECT id, exercises FROM ${table}`).all();
  const update = db.prepare(`UPDATE ${table} SET exercises = ? WHERE id = ?`);
  for (const row of rows) {
    let exercises;
    try { exercises = JSON.parse(row.exercises); } catch { continue; }
    if (!Array.isArray(exercises)) continue;

    let changed = false;
    for (const exercise of exercises) {
      for (const set of exercise?.sets ?? []) {
        for (const key of ['reps', 'weight', 'rpe']) {
          const next = firstNumber(set[key]);
          if (set[key] !== next) {
            set[key] = next;
            changed = true;
          }
        }
      }
    }
    if (changed) update.run(JSON.stringify(exercises), row.id);
  }
}
['plans', 'workouts', 'workout_draft'].forEach(migrateSetValuesToNumbers);

/* ---- Seed ----
   Kollekciók: a data.js-ből szinkronizálva minden indításkor (INSERT OR
   REPLACE). Ezek csak olvasható referencia-adatok, ezért nyugodtan felül-
   írhatók a forrásból — így a data.js módosításai és a séma-bővítések maguktól
   érvényre jutnak a meglévő DB-ken is. A felhasználói adatot tartó táblákat
   (weight_log stb.) ez NEM érinti. */
/* A két nagy referencia-lista nem a data.js-ben él, hanem saját forrásfájlban
   (server/data/), és a catalog.js állítja össze őket — a gyakorlatoknál a
   kurált + generált összefésülésével, az ételeknél a `per` címke képzésével.
   A data.js így az marad, ami: rövid, vegyes seed-adat. */
const collections = {
  ...seed,
  exerciseCatalog: buildExerciseCatalog(),
  foods: buildFoodCatalog(),
};

const insertCollection = db.prepare('INSERT OR REPLACE INTO collections (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(collections)) {
  insertCollection.run(key, JSON.stringify(value));
}
// Az időközben eltávolított kulcsok a meglévő DB-kből is tűnjenek el.
const seedKeys = Object.keys(collections);
db.prepare(`DELETE FROM collections WHERE key NOT IN (${seedKeys.map(() => '?').join(', ')})`)
  .run(...seedKeys);
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
  return db.prepare('SELECT id, name, grams, kcal, protein, carbs, fat, date FROM nutrition_log ORDER BY id').all();
}

/** Egy adott nap naplózott ételei, rögzítési sorrendben. A Táplálkozás oldal
    mai naplója ebből épül — enélkül a felhasználó csak összesítést látott, és
    egy téves koppintást nem tudott visszavonni. */
export function getNutritionLogForDate(date) {
  return db.prepare(`SELECT id, name, grams, kcal, protein, carbs, fat, date
                     FROM nutrition_log WHERE date = ? ORDER BY id`).all(date);
}

/** A napi táplálkozási összesítő egy adott napra: az AZNAP naplózott ételek
    összege, valamint az edző által kitűzött napi cél (a felület a célhoz
    méri a bevitelt). */
export function getNutritionTotals(date) {
  const sum = db.prepare(`
    SELECT COALESCE(SUM(kcal), 0)    AS intake,
           COALESCE(SUM(protein), 0) AS protein,
           COALESCE(SUM(carbs), 0)   AS carbs,
           COALESCE(SUM(fat), 0)     AS fat
    FROM nutrition_log
    WHERE date = ?
  `).get(date);
  return { ...sum, goal: getCollection('nutritionGoal') || { calories: 0, protein: 0 } };
}

/** Egy DB-sor → a Recovery Engine által várt check-in alak (JSON-mezők
    visszafejtve, a hiányzó értékek null-ok maradnak). */
const toCheckin = (row) => (row ? {
  date: row.date,
  sleepHours: row.sleep_hours,
  sleepQuality: row.sleep_quality,
  energy: row.energy,
  stress: row.stress,
  mood: row.mood,
  hydration: row.hydration,
  soreness: JSON.parse(row.soreness || '{}'),
  pain: JSON.parse(row.pain || '{}'),
} : null);

const CHECKIN_COLUMNS = `date, sleep_hours, sleep_quality, energy, stress, mood,
                         hydration, soreness, pain`;

/** Egy adott nap check-inje, vagy null. */
export function getCheckin(date) {
  return toCheckin(db.prepare(`SELECT ${CHECKIN_COLUMNS} FROM checkins WHERE date = ?`).get(date));
}

/** A legutóbbi `limit` check-in, legújabb elöl. A motor ebből számolja az
    alvásadósságot és a becslés megbízhatóságát. */
export function getCheckins(limit = 60) {
  return db.prepare(`SELECT ${CHECKIN_COLUMNS} FROM checkins ORDER BY date DESC LIMIT ?`)
    .all(limit)
    .map(toCheckin);
}

/** Egy nap check-injének mentése/felülírása. A megadott mezők közül csak az
    érvényeseket írjuk; a hiányzók NULL-ként maradnak (ld. a tábla kommentjét).
    Ismételt mentéskor a sor frissül — a felület így szerkeszthetőként kezeli
    az aznapi check-int. Visszaadja a mentett sort. */
export function saveCheckin(date, fields) {
  db.prepare(`
    INSERT INTO checkins (date, sleep_hours, sleep_quality, energy, stress, mood,
                          hydration, soreness, pain, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET
      sleep_hours = excluded.sleep_hours, sleep_quality = excluded.sleep_quality,
      energy      = excluded.energy,      stress        = excluded.stress,
      mood        = excluded.mood,        hydration     = excluded.hydration,
      soreness    = excluded.soreness,    pain          = excluded.pain,
      updated_at  = excluded.updated_at
  `).run(
    date,
    fields.sleepHours, fields.sleepQuality, fields.energy, fields.stress,
    fields.mood, fields.hydration,
    JSON.stringify(fields.soreness ?? {}), JSON.stringify(fields.pain ?? {}),
  );
  return getCheckin(date);
}

/** Az Epley-képlet a becsült 1RM kiszámítására: 1RM = weight × (1 + reps/30) */
export function calculateEpley1RM(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r < 1) return 0;
  return w * (1 + r / 30);
}

/** Egy gyakorlat jelenlegi maximális 1RM-je, vagy null ha még nincs. */
export function getExerciseMax(exerciseName) {
  const row = db.prepare('SELECT max_1rm, date FROM exercise_maxes WHERE exercise_name = ?').get(exerciseName);
  return row ? { max1rm: row.max_1rm, date: row.date } : null;
}

/** Az összes nyomon követett maximális 1RM-ek. */
export function getAllExerciseMaxes() {
  return db.prepare('SELECT exercise_name, max_1rm, date FROM exercise_maxes ORDER BY date DESC').all();
}

/** Egy gyakorlat maximum 1RM-jének frissítése, ha az új érték nagyobb.
    Visszaadja az objektumot { max1rm, date, isPr } formában (isPr = true ha PR-t ütöttünk). */
export function updateExerciseMax(exerciseName, new1rm, currentDate) {
  const existing = getExerciseMax(exerciseName);
  const isPr = !existing || new1rm > existing.max1rm;
  
  if (isPr) {
    db.prepare(`
      INSERT INTO exercise_maxes (exercise_name, max_1rm, date, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(exercise_name) DO UPDATE SET
        max_1rm = excluded.max_1rm,
        date = excluded.date,
        updated_at = excluded.updated_at
    `).run(exerciseName, new1rm, currentDate);
  }
  
  return { max1rm: isPr ? new1rm : existing.max1rm, date: isPr ? currentDate : existing.date, isPr };
}

/** A felhasználó által készített edzéstervek, legújabb elöl. */
export function getUserPlans() {
  return db.prepare('SELECT id, name, date, exercises, days FROM plans ORDER BY id DESC').all()
    .map((row) => ({
      id: row.id, name: row.name, date: row.date,
      exercises: JSON.parse(row.exercises), days: JSON.parse(row.days),
    }));
}

/** A megadott hétnapra (0 = hétfő) ütemezett terv, vagy null. Ha több terv is
    ugyanarra a napra szól, a legutóbb létrehozott nyer. */
export function getPlanForDay(dayIndex) {
  return getUserPlans().find((plan) => plan.days.includes(dayIndex)) || null;
}

/** Az épp szerkesztett edzés piszkozata ({ name, exercises, date, planId })
    vagy null. A planId mutatja, melyik tervből indult az edzés. */
export function getWorkoutDraft() {
  const row = db.prepare('SELECT name, exercises, date, plan_id FROM workout_draft WHERE id = 1').get();
  return row
    ? { name: row.name, exercises: JSON.parse(row.exercises), date: row.date, planId: row.plan_id }
    : null;
}

/** A mentett edzések, legújabb elöl (a gyakorlatok JSON-ból visszafejtve). */
export function getWorkouts() {
  return db.prepare('SELECT id, name, date, exercises, plan_id FROM workouts ORDER BY id DESC').all()
    .map((row) => ({
      id: row.id, name: row.name, date: row.date,
      exercises: JSON.parse(row.exercises), planId: row.plan_id,
    }));
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
  snapshot.workoutDraft = getWorkoutDraft();
  snapshot.userPlans = getUserPlans();
  snapshot.checkins = getCheckins(1000);
  return snapshot;
}

/* ---- Írás ---- */

/** Új testsúly-bejegyzés; visszaadja a létrejött { id, kg, date } sort. */
export function addWeightEntry(kg, date) {
  const { lastInsertRowid } = db.prepare('INSERT INTO weight_log (kg, date) VALUES (?, ?)').run(kg, date);
  return db.prepare('SELECT id, kg, date FROM weight_log WHERE id = ?').get(Number(lastInsertRowid));
}

/** Étel naplózása a megadott adaggal (a makrók a szerver-oldali food
    objektumból, 100 g-ra vonatkozó alapértékekből átszámolva — a kliens által
    küldött tápértékekben nem bízunk, csak az adag grammjában).
    Visszaadja a létrejött bejegyzést és a frissített napi összesítőt. */
export function addNutritionEntry(food, date, grams = 100) {
  const factor = grams / 100;
  // A kalória egész, a makrók egy tizedesre — így a napi összeg sem gyűjt
  // lebegőpontos szemetet (pl. 0.30000000000000004 g zsír).
  const round1 = (value) => Math.round(value * factor * 10) / 10;

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO nutrition_log (name, grams, kcal, protein, carbs, fat, date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    food.name, grams, Math.round(food.kcal * factor),
    round1(food.protein), round1(food.carbs), round1(food.fat), date,
  );
  const entry = db.prepare(`SELECT id, name, grams, kcal, protein, carbs, fat, date
                            FROM nutrition_log WHERE id = ?`).get(Number(lastInsertRowid));
  return { entry, totals: getNutritionTotals(date) };
}

/** Egy naplóbejegyzés törlése (a Táplálkozás oldal ✕ gombja). Csak a MAI
    bejegyzés törölhető: a korábbi napok összesítői már beépültek a
    készenlét-számításba, azokat visszamenőleg nem írjuk át. Ismeretlen vagy
    nem aznapi id-re null-t ad — a hívó ebből 404-et képez. */
export function deleteNutritionEntry(id, date) {
  const { changes } = db.prepare('DELETE FROM nutrition_log WHERE id = ? AND date = ?').run(id, date);
  return changes > 0 ? getNutritionTotals(date) : null;
}

/** A piszkozat felülírása (mindig az 1-es sor) — minden változtatásnál hívjuk.
    A date a szerver helyi napja: ebből dönti el a /api/workout-template, hogy
    a piszkozat aznapi-e, vagy jöhet helyette a napra ütemezett terv. */
export function saveWorkoutDraft(name, exercises, date, planId = null) {
  db.prepare(`INSERT INTO workout_draft (id, name, exercises, date, plan_id, updated_at)
              VALUES (1, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, exercises = excluded.exercises,
                date = excluded.date, plan_id = excluded.plan_id,
                updated_at = excluded.updated_at`)
    .run(name, JSON.stringify(exercises), date, planId);
  return { name, exercises, planId };
}

/** A piszkozat törlése — az „Edzés befejezése" hívja, miután az edzés bekerült
    a naplóba. Így ugyanaznap új edzés kezdhető, a lezárt edzés nem ragad az
    Edzés oldalon, és nem lehet másodszor is (duplikátumként) lenaplózni. */
export function clearWorkoutDraft() {
  db.prepare('DELETE FROM workout_draft WHERE id = 1').run();
}

/** Edzés mentése; automatikusan kiszámítja a PR-eket az Epley-képlet alapján.
    Visszaadja a létrejött { id, name, date, exercises, planId } sort. */
export function addWorkout(name, date, exercises, planId = null) {
  // PR-eket számítunk az Epley-képlettel: 1RM = weight × (1 + reps/30)
  // Ha egy gyakorlatban van teljesített szett, és az 1RM nagyobb mint az eddigi maximum,
  // akkor PR-ként jelöljük meg a gyakorlatot
  const processedExercises = exercises.map((exercise) => {
    const sets = exercise.sets || [];
    
    // Teljesített szettekből kiemelkedő 1RM keresése
    let bestCompleted1rm = 0;
    let hasCompleted = false;
    let bestCompletedSet = null;
    
    for (const set of sets) {
      if (set.done) {
        hasCompleted = true;
        const weight = Number(set.weight);
        const reps = Number(set.reps);
        if (Number.isFinite(weight) && Number.isFinite(reps) && weight > 0 && reps >= 1) {
          const oneRM = calculateEpley1RM(weight, reps);
          if (oneRM > bestCompleted1rm) {
            bestCompleted1rm = oneRM;
            bestCompletedSet = set;
          }
        }
      }
    }
    
    // Ha nincs teljesített szett, az elsőt nézünk
    if (!hasCompleted && sets.length > 0) {
      const set = sets[0];
      const weight = Number(set.weight);
      const reps = Number(set.reps);
      if (Number.isFinite(weight) && Number.isFinite(reps) && weight > 0 && reps >= 1) {
        bestCompleted1rm = calculateEpley1RM(weight, reps);
        bestCompletedSet = set;
      }
    }
    
    // PR-ellenőrzés és frissítés
    let isPr = false;
    if (bestCompleted1rm > 0) {
      const maxRecord = updateExerciseMax(exercise.name, bestCompleted1rm, date);
      isPr = maxRecord.isPr;
    }
    
    return {
      ...exercise,
      pr: isPr || exercise.pr, // ha már volt PR jel vagy most érte el
    };
  });
  
  const { lastInsertRowid } = db
    .prepare('INSERT INTO workouts (name, date, exercises, plan_id) VALUES (?, ?, ?, ?)')
    .run(name, date, JSON.stringify(processedExercises), planId);
  return { id: Number(lastInsertRowid), name, date, exercises: processedExercises, planId };
}

/** Edzésterv mentése; visszaadja a létrejött { id, name, date, exercises, days } sort. */
export function addPlan(name, date, exercises, days) {
  const { lastInsertRowid } = db.prepare('INSERT INTO plans (name, date, exercises, days) VALUES (?, ?, ?, ?)')
    .run(name, date, JSON.stringify(exercises), JSON.stringify(days));
  return { id: Number(lastInsertRowid), name, date, exercises, days };
}

/** Meglévő terv felülírása (név, gyakorlatok, napok — a létrehozás dátuma marad).
    A frissített sort adja vissza, vagy null-t, ha nincs ilyen id. */
export function updatePlan(id, name, exercises, days) {
  const { changes } = db.prepare('UPDATE plans SET name = ?, exercises = ?, days = ? WHERE id = ?')
    .run(name, JSON.stringify(exercises), JSON.stringify(days), id);
  if (changes === 0) return null;
  const row = db.prepare('SELECT id, name, date, exercises, days FROM plans WHERE id = ?').get(id);
  return { ...row, exercises: JSON.parse(row.exercises), days: JSON.parse(row.days) };
}
