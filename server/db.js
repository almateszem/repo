/**
 * FitTrack Pro — SQLite adatréteg (beépített node:sqlite)
 * ------------------------------------------------------
 * Pragmatikus hibrid séma + világos adatszétválasztás:
 *   - collections: kulcs-érték tábla a CSAK OLVASHATÓ referencia/seed adatnak
 *     (dashboard, charts, foods, athletes…). Ez minden indításkor a data.js-ből
 *     szinkronizálódik (INSERT OR REPLACE) — így a data.js a forrása, a
 *     módosítások (és séma-bővítések) maguktól érvényre jutnak. Ez az adat
 *     MINDEN felhasználónak közös, mert referencia-adat.
 *   - users / sessions: fiókok és munkamenetek.
 *   - weight_log / nutrition_log / workouts / plans / workout_draft / checkins /
 *     exercise_maxes:
 *     a FELHASZNÁLÓI adat. Minden sor egy fiókhoz tartozik (user_id), és a
 *     modul MINDEN lekérdezése szűr rá — a felhasználók nem látják egymás
 *     adatát. A seed ezeket nem érinti, megmaradnak.
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

/* ---- Naplózási mód ----
   WAL: az olvasók nem blokkolják az írót és fordítva — a piszkozat-autosave
   így nem akad össze a dashboard olvasásaival. A synchronous = NORMAL a WAL
   szokásos párja: áramszünetnél a legutolsó tranzakció elveszhet, de az
   adatbázis nem sérül. Cserébe nincs fsync minden mentésnél.
   A beállítás a DB-fájlba íródik, tehát a meglévő fájlokon is érvényre jut. */
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = NORMAL');
// A user_id idegen kulcsok (ON DELETE CASCADE) csak bekapcsolva élnek.
db.exec('PRAGMA foreign_keys = ON');

/* ---- Séma ----
   Új adatbázison ez már a végleges alak; a régi (felhasználó nélküli)
   fájlokat a lentebbi migrációk hozzák ide. */
db.exec(`
  CREATE TABLE IF NOT EXISTS collections (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL          -- JSON
  );
  -- Fiókok. A username kisbetűsítve tárolódik (a belépés így nagybetű-
  -- érzéketlen), a display_name a felületen megjelenő név.
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,   -- scrypt (server/auth.js); üres = nem lehet belépni
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Munkamenetek. A süti tokenjének CSAK a SHA-256 lenyomata kerül ide.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL       -- ISO-8601 UTC
  );

  CREATE TABLE IF NOT EXISTS weight_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kg         REAL NOT NULL,
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS nutrition_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    date       TEXT NOT NULL,
    exercises  TEXT NOT NULL,          -- JSON, a workouts.exercises-szel azonos alak
    days       TEXT NOT NULL DEFAULT '[]',  -- JSON: hétnap-indexek (0 = hétfő), amikor a terv az Edzés oldalra töltődik
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Az épp szerkesztett edzés — FELHASZNÁLÓNKÉNT egyetlen sor. (Korábban az
  -- egész adatbázisban volt egy sor, id = 1: két ember felülírta egymást.)
  CREATE TABLE IF NOT EXISTS workout_draft (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    exercises  TEXT NOT NULL,          -- JSON, a workouts.exercises-szel azonos alak
    date       TEXT NOT NULL DEFAULT '',            -- a mentés HELYI napja — ebből tudni, friss-e a piszkozat
    plan_id    INTEGER,                             -- melyik tervből indult (NULL, ha szabad edzés)
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- Napi regenerációs check-in: felhasználónként és naponta egy sor.
  -- MINDEN mérőszám-oszlop NULL-ozható, és ez lényeges: a Recovery Engine a
  -- „nem adta meg" és a „nulla" esetet külön kezeli — a hiányzó mezők súlya
  -- arányosan újraoszlik a képletben, nem nullaként számít bele.
  CREATE TABLE IF NOT EXISTS checkins (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date          TEXT NOT NULL,       -- "ÉÉÉÉ.HH.NN", a szerver helyi napja
    sleep_hours   REAL,                -- alvás időtartama órában
    sleep_quality INTEGER,             -- 1–5
    energy        INTEGER,             -- 1–5
    stress        INTEGER,             -- 1–5 (magasabb = rosszabb)
    mood          INTEGER,             -- 1–5 közérzet
    hydration     REAL,                -- liter
    soreness      TEXT NOT NULL DEFAULT '{}',  -- JSON: { chest: 0..5, … } izomcsoportonként
    pain          TEXT NOT NULL DEFAULT '{}',  -- JSON: { general: 0..10, quads: 0..10, … }
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, date)
  );
  -- Gyakorlatonkénti egyéni csúcs (becsült 1RM). A PR MINDIG a saját korábbi
  -- teljesítményhez képest az, ezért a rekordok felhasználónként állnak — a
  -- kulcs (user_id, exercise_name).
  CREATE TABLE IF NOT EXISTS exercise_maxes (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise_name TEXT NOT NULL,       -- a gyakorlat neve
    max_1rm       REAL NOT NULL,       -- Epley-képlettel számított maximális 1RM (kg)
    date          TEXT NOT NULL,       -- mikor született ez a rekord
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, exercise_name)
  );
`);

/* ======================================================================
   Migrációk
   A CREATE TABLE IF NOT EXISTS a meglévő táblákat nem bővíti — az utólag
   bevezetett oszlopokat itt pótoljuk a régebbi DB-fájlokon.
   ====================================================================== */

const columnsOf = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
const hasColumn = (table, column) => columnsOf(table).includes(column);

function ensureColumn(table, column, ddl) {
  if (!hasColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('plans', 'days', "days TEXT NOT NULL DEFAULT '[]'");
ensureColumn('workout_draft', 'date', "date TEXT NOT NULL DEFAULT ''");
ensureColumn('workouts', 'plan_id', 'plan_id INTEGER');
ensureColumn('workout_draft', 'plan_id', 'plan_id INTEGER');
// A naplózás korábban fix 100 g-os adaggal ment — a régi sorok makrói tehát
// 100 g-ra vonatkoznak, ezért a default érték helyes a meglévő adatokra is.
ensureColumn('nutrition_log', 'grams', 'grams REAL NOT NULL DEFAULT 100');

/* ---- Migráció: egyfelhasználós → többfelhasználós ----

   A korábbi verziókban nem volt fiók: egyetlen közös adathalmaz létezett.
   Ezt az adatot NEM dobjuk el. Ha találunk ilyen sorokat, létrehozunk egy
   ARCHÍV felhasználót (üres jelszó-hash → belépni vele nem lehet), és minden
   gazdátlan sort hozzá rendelünk. Az ELSŐ valódi regisztráció aztán átveszi
   ezt az adatot (ld. createUser → adoptLegacyData), és az archív fiók eltűnik.

   Így aki eddig helyben használta az appot, a regisztráció után ugyanazt az
   előzményt látja, mint korábban. */

const LEGACY_USERNAME = '__archiv__';

/** Az archív felhasználó azonosítója, létrehozva, ha még nincs. */
function ensureLegacyUser() {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(LEGACY_USERNAME);
  if (existing) return existing.id;
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO users (username, display_name, password_hash) VALUES (?, 'Korábbi adatok', '')",
  ).run(LEGACY_USERNAME);
  return Number(lastInsertRowid);
}

/* A négy egyszerű tábla: elég egy új oszlop, a meglévő sorok az archív
   felhasználóhoz kerülnek. (Az ALTER TABLE nem tud NOT NULL-t adni default
   nélkül, ezért az oszlop a DB szintjén nullázható marad a régi fájlokon; az
   adatréteg minden írásnál kitölti. Új adatbázison a séma NOT NULL.) */
for (const table of ['weight_log', 'nutrition_log', 'workouts', 'plans']) {
  if (hasColumn(table, 'user_id')) continue;
  db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER`);
  const orphans = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  if (orphans > 0) {
    db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(ensureLegacyUser());
  }
}

/* A workout_draft és a checkins ELSŐDLEGES KULCSA változott (id = 1 →
   user_id; date → (user_id, date)), ezt az SQLite nem tudja ALTER TABLE-lel.
   Ilyenkor a bevett minta: új tábla + átmásolás + csere. */

function rebuildWorkoutDraft() {
  if (hasColumn('workout_draft', 'user_id')) return;
  const legacy = db.prepare('SELECT name, exercises, date, plan_id FROM workout_draft WHERE id = 1').get();

  db.exec(`
    CREATE TABLE workout_draft_new (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      exercises  TEXT NOT NULL,
      date       TEXT NOT NULL DEFAULT '',
      plan_id    INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  if (legacy) {
    db.prepare(`INSERT INTO workout_draft_new (user_id, name, exercises, date, plan_id)
                VALUES (?, ?, ?, ?, ?)`)
      .run(ensureLegacyUser(), legacy.name, legacy.exercises, legacy.date, legacy.plan_id);
  }
  db.exec('DROP TABLE workout_draft; ALTER TABLE workout_draft_new RENAME TO workout_draft;');
}

function rebuildCheckins() {
  if (hasColumn('checkins', 'user_id')) return;
  const legacy = db.prepare(`SELECT date, sleep_hours, sleep_quality, energy, stress, mood,
                                    hydration, soreness, pain FROM checkins`).all();

  db.exec(`
    CREATE TABLE checkins_new (
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date          TEXT NOT NULL,
      sleep_hours   REAL,
      sleep_quality INTEGER,
      energy        INTEGER,
      stress        INTEGER,
      mood          INTEGER,
      hydration     REAL,
      soreness      TEXT NOT NULL DEFAULT '{}',
      pain          TEXT NOT NULL DEFAULT '{}',
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, date)
    );
  `);
  if (legacy.length) {
    const userId = ensureLegacyUser();
    const insert = db.prepare(`INSERT INTO checkins_new
      (user_id, date, sleep_hours, sleep_quality, energy, stress, mood, hydration, soreness, pain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of legacy) {
      insert.run(userId, row.date, row.sleep_hours, row.sleep_quality, row.energy,
        row.stress, row.mood, row.hydration, row.soreness, row.pain);
    }
  }
  db.exec('DROP TABLE checkins; ALTER TABLE checkins_new RENAME TO checkins;');
}

/* Az egyéni csúcsok kulcsa is változott (exercise_name → (user_id,
   exercise_name)) — ugyanaz az újraépítő minta. A korábbi rekordok az archív
   felhasználóhoz kerülnek, így az első regisztráló megörökli őket. */
function rebuildExerciseMaxes() {
  if (hasColumn('exercise_maxes', 'user_id')) return;
  const legacy = db.prepare('SELECT exercise_name, max_1rm, date FROM exercise_maxes').all();

  db.exec(`
    CREATE TABLE exercise_maxes_new (
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exercise_name TEXT NOT NULL,
      max_1rm       REAL NOT NULL,
      date          TEXT NOT NULL,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, exercise_name)
    );
  `);
  if (legacy.length) {
    const userId = ensureLegacyUser();
    const insert = db.prepare(`INSERT INTO exercise_maxes_new (user_id, exercise_name, max_1rm, date)
                               VALUES (?, ?, ?, ?)`);
    for (const row of legacy) insert.run(userId, row.exercise_name, row.max_1rm, row.date);
  }
  db.exec('DROP TABLE exercise_maxes; ALTER TABLE exercise_maxes_new RENAME TO exercise_maxes;');
}

/* A tábla-csere idejére kikapcsoljuk az idegenkulcs-ellenőrzést: a DROP+RENAME
   közben a hivatkozások átmenetileg nem állnak össze. */
db.exec('PRAGMA foreign_keys = OFF');
rebuildWorkoutDraft();
rebuildCheckins();
rebuildExerciseMaxes();
db.exec('PRAGMA foreign_keys = ON');

/* A szett-értékek korábban mértékegységgel együtt, szabad szövegként voltak
   tárolva („12 rep", „60% TM", „–"). A felület már szám-mezőkkel szerkeszti
   őket, ezért a meglévő sorokból kinyerjük a puszta számot. A művelet
   idempotens (számból ugyanaz a szám lesz), és csak a ténylegesen változó
   sorokat írja vissza, így minden induláskor nyugodtan lefuthat. */
const firstNumber = (raw) => {
  const match = String(raw ?? '').replace(',', '.').match(/\d+(\.\d+)?/);
  return match ? match[0] : '';
};

function migrateSetValuesToNumbers(table, key) {
  const rows = db.prepare(`SELECT ${key} AS id, exercises FROM ${table}`).all();
  const update = db.prepare(`UPDATE ${table} SET exercises = ? WHERE ${key} = ?`);
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
migrateSetValuesToNumbers('plans', 'id');
migrateSetValuesToNumbers('workouts', 'id');
// A piszkozatnak már nincs id oszlopa — felhasználónként azonosít.
migrateSetValuesToNumbers('workout_draft', 'user_id');

/* Az `exercise_maxes` táblát az addWorkout tölti, edzés mentésekor. Aki viszont
   a PR-követés BEVEZETÉSE ELŐTT naplózott, annak az egész előzménye kimaradt
   belőle: a tábla üres, miközben a workouts tele van. Ilyenkor a legközelebbi
   edzés minden gyakorlata hamis PR-t ütne (nincs mihez mérni), és a rekord egy
   gyengébb értéken ragadna. Ezért a meglévő edzésekből egyszer visszatöltjük a
   csúcsokat.

   Csak azokra a fiókokra fut, akiknek van edzésük, de EGYETLEN csúcsuk sincs —
   így a második indulásnál már nincs dolga, és aki menet közben gyűjtötte a
   rekordjait, annak az adatához nem nyúl. */
function backfillExerciseMaxes() {
  const userIds = db.prepare(`
    SELECT DISTINCT w.user_id AS id FROM workouts w
    WHERE NOT EXISTS (SELECT 1 FROM exercise_maxes m WHERE m.user_id = w.user_id)
  `).all().map((row) => row.id);
  if (!userIds.length) return;

  const insert = db.prepare(`INSERT INTO exercise_maxes (user_id, exercise_name, max_1rm, date)
                             VALUES (?, ?, ?, ?)`);
  const workoutsOf = db.prepare('SELECT date, exercises FROM workouts WHERE user_id = ? ORDER BY id');

  for (const userId of userIds) {
    const best = new Map(); // gyakorlatnév → { max1rm, date }
    for (const row of workoutsOf.all(userId)) {
      let exercises;
      try { exercises = JSON.parse(row.exercises); } catch { continue; }
      if (!Array.isArray(exercises)) continue;

      for (const exercise of exercises) {
        const name = exercise?.name;
        if (!name) continue;
        /* PONTOSAN ugyanaz a szabály, mint az addWorkout-ban — a rekordot hozó
           szettet a közös bestCompletedSet adja meg. Korábban itt egy saját,
           csak a bepipált szetteket néző ciklus állt, és ez eltért: az
           addWorkout teljesített szett HÍJÁN az első sorra esik vissza, ez a
           ciklus viszont ilyenkor semmit nem talált. Akinek tehát a régi
           edzéseiben egyetlen szett sem volt bepipálva, annak a visszatöltés
           üresen maradt — vagyis pontosan az a hamis PR keletkezett a
           következő edzésnél, aminek a megelőzésére ez a függvény való. */
        const record = bestCompletedSet(exercise?.sets ?? []);
        const oneRM = record ? calculateEpley1RM(record.weight, record.reps) : 0;
        if (oneRM <= 0) continue;
        const current = best.get(name);
        if (!current || oneRM > current.max1rm) best.set(name, { max1rm: oneRM, date: row.date });
      }
    }
    for (const [name, record] of best) insert.run(userId, name, record.max1rm, record.date);
  }
}
backfillExerciseMaxes();

/* ---- Indexek ----
   A táblák átépítése (workout_draft, checkins) eldobja a rajtuk lévő
   indexeket, ezért az index-létrehozás a migrációk UTÁN áll.

   A napi táplálkozási összesítő és a mai napló felhasználóra + dátumra szűr;
   index nélkül ez a napról napra hízó nutrition_log teljes végigolvasása volt
   (EXPLAIN QUERY PLAN: SCAN nutrition_log). A korábbi, csak dátum szerinti
   index helyét az összetett veszi át — az első oszlopa ugyanúgy szűr, de a
   felhasználós lekérdezést is kiszolgálja. */
db.exec(`
  DROP INDEX IF EXISTS idx_nutrition_log_date;
  CREATE INDEX IF NOT EXISTS idx_nutrition_log_user_date ON nutrition_log(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id);
  CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id);
  CREATE INDEX IF NOT EXISTS idx_weight_log_user ON weight_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

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

/* ======================================================================
   Fiókok és munkamenetek
   ====================================================================== */

/** Egy felhasználó sora → a felület által látott alak (jelszó nélkül!). */
const toUser = (row) => (row
  ? { id: row.id, username: row.username, displayName: row.display_name }
  : null);

/** Felhasználó a (már kisbetűsített) felhasználónév alapján, a hash-sel együtt
    — kizárólag a belépés ellenőrzéséhez. */
export function getUserWithHash(username) {
  return db.prepare('SELECT id, username, display_name, password_hash FROM users WHERE username = ?')
    .get(username) || null;
}

/** Felhasználó azonosító alapján (jelszó nélkül). */
export function getUser(id) {
  return toUser(db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(id));
}

/** Van-e már valódi (nem archív) fiók? A felület ebből tudja, hogy az első
    regisztráció következik-e. */
export function hasAnyUser() {
  return db.prepare('SELECT COUNT(*) AS n FROM users WHERE username != ?').get(LEGACY_USERNAME).n > 0;
}

/* A migráció során félretett, gazdátlan adat átadása az első valódi fióknak.
   Csak akkor fut, ha az imént létrejött fiók az ELSŐ valódi fiók — a második
   regisztráló már nem örökölheti meg más előzményét. */
function adoptLegacyData(newUserId) {
  const legacy = db.prepare('SELECT id FROM users WHERE username = ?').get(LEGACY_USERNAME);
  if (!legacy) return false;

  const realUsers = db.prepare('SELECT COUNT(*) AS n FROM users WHERE username != ?')
    .get(LEGACY_USERNAME).n;
  if (realUsers !== 1) return false; // nem az első regisztráció — nem nyúlunk hozzá

  for (const table of ['weight_log', 'nutrition_log', 'workouts', 'plans', 'workout_draft',
    'checkins', 'exercise_maxes']) {
    db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ?`).run(newUserId, legacy.id);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(legacy.id);
  return true;
}

/**
 * Új fiók. A hívó adja a MÁR kisbetűsített felhasználónevet és a MÁR
 * elkészített jelszó-hasht (a hashelés a server/auth.js dolga).
 * Visszaadja: { user, adoptedLegacy } — utóbbi jelzi, ha a fiók megörökölte a
 * fiókok bevezetése előtti adatokat. Foglalt névre null-t ad.
 */
export function createUser(username, displayName, passwordHash) {
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return null;

  const { lastInsertRowid } = db.prepare(
    'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)',
  ).run(username, displayName, passwordHash);
  const id = Number(lastInsertRowid);

  return { user: getUser(id), adoptedLegacy: adoptLegacyData(id) };
}

/** Munkamenet létrehozása a token lenyomatához. */
export function createSession(tokenHash, userId, expiresAt) {
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(tokenHash, userId, expiresAt);
}

/** A munkamenethez tartozó felhasználó, vagy null (ismeretlen vagy lejárt
    token). A lejárt sorokat menet közben takarítjuk. */
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
  return toUser(row);
}

/** Kijelentkezés — a munkamenet törlése. */
export function deleteSession(tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

/** A lejárt munkamenetek takarítása (induláskor és időzítve hívjuk). */
export function purgeExpiredSessions() {
  const { changes } = db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  return changes;
}
purgeExpiredSessions();

/* ======================================================================
   Olvasás — MINDEN függvény első paramétere a felhasználó azonosítója.
   Ez szándékos: így egy lekérdezést nem lehet „véletlenül" szűretlenül
   hívni, mert a userId hiánya azonnal hibás eredményt adna.
   ====================================================================== */

/* A két nagy kollekció memóriában tartva. A collections tábla a seed után nem
   változik (csak induláskor írjuk), ezért a cache a folyamat teljes életében
   érvényes marad. Ez REFERENCIA-adat: minden felhasználónak ugyanaz.

   CSAK ez a két kulcs cache-elhető, és ez szándékos: a hívó ugyanazt az
   objektumot kapja meg minden kérésnél, tehát MÓDOSÍTANIA TILOS. A 'dashboard'
   épp ezért nem szerepel itt — a /api/dashboard végpont a lekért objektumra
   írja rá a streaket és a készenlétet, cache-elve ezek kérésről kérésre
   egymásra rakódnának.

   Nyereség: az exerciseCatalog 365 KB-os JSON.parse-a kérésenként 3,6-4,4 ms
   volt, és minden readiness-számítás lekérte. */
const CACHED_COLLECTIONS = new Set(['exerciseCatalog', 'foods']);
const collectionCache = new Map();

/** Egy olvasható kollekció (foods, charts, …) JSON-ből visszafejtve.
    A CACHED_COLLECTIONS kulcsainál a visszaadott érték MEGOSZTOTT — olvasásra
    való, módosítani nem szabad. */
export function getCollection(key) {
  if (collectionCache.has(key)) return collectionCache.get(key);

  const row = db.prepare('SELECT value FROM collections WHERE key = ?').get(key);
  const value = row ? JSON.parse(row.value) : null;
  if (CACHED_COLLECTIONS.has(key)) collectionCache.set(key, value);
  return value;
}

/** A testsúly-bejegyzések a valódi táblából, rögzítési sorrendben. */
export function getWeightLog(userId) {
  return db.prepare('SELECT id, kg, date FROM weight_log WHERE user_id = ? ORDER BY id').all(userId);
}

/** A naplózott ételek, rögzítési sorrendben. */
export function getNutritionLog(userId) {
  return db.prepare(`SELECT id, name, grams, kcal, protein, carbs, fat, date
                     FROM nutrition_log WHERE user_id = ? ORDER BY id`).all(userId);
}

/** Egy adott nap naplózott ételei, rögzítési sorrendben. A Táplálkozás oldal
    mai naplója ebből épül — enélkül a felhasználó csak összesítést látott, és
    egy téves koppintást nem tudott visszavonni. */
export function getNutritionLogForDate(userId, date) {
  return db.prepare(`SELECT id, name, grams, kcal, protein, carbs, fat, date
                     FROM nutrition_log WHERE user_id = ? AND date = ? ORDER BY id`).all(userId, date);
}

/** A napi táplálkozási összesítő egy adott napra: az AZNAP naplózott ételek
    összege, valamint az edző által kitűzött napi cél (a felület a célhoz
    méri a bevitelt). */
export function getNutritionTotals(userId, date) {
  const sum = db.prepare(`
    SELECT COALESCE(SUM(kcal), 0)    AS intake,
           COALESCE(SUM(protein), 0) AS protein,
           COALESCE(SUM(carbs), 0)   AS carbs,
           COALESCE(SUM(fat), 0)     AS fat
    FROM nutrition_log
    WHERE user_id = ? AND date = ?
  `).get(userId, date);
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
export function getCheckin(userId, date) {
  return toCheckin(db.prepare(`SELECT ${CHECKIN_COLUMNS} FROM checkins
                               WHERE user_id = ? AND date = ?`).get(userId, date));
}

/** A legutóbbi `limit` check-in, legújabb elöl. A motor ebből számolja az
    alvásadósságot és a becslés megbízhatóságát. */
export function getCheckins(userId, limit = 60) {
  return db.prepare(`SELECT ${CHECKIN_COLUMNS} FROM checkins
                     WHERE user_id = ? ORDER BY date DESC LIMIT ?`)
    .all(userId, limit)
    .map(toCheckin);
}

/** Egy nap check-injének mentése/felülírása. A megadott mezők közül csak az
    érvényeseket írjuk; a hiányzók NULL-ként maradnak (ld. a tábla kommentjét).
    Ismételt mentéskor a sor frissül — a felület így szerkeszthetőként kezeli
    az aznapi check-int. Visszaadja a mentett sort. */
export function saveCheckin(userId, date, fields) {
  /* A hiányzó kulcs és a szándékos „nem adta meg" ugyanaz: NULL. A végpont
     mindig mind a hat mezőt kitölti, de az adatréteg részleges objektumot is
     elfogad — undefined-ot ugyanis a SQLite nem tud paraméterként kötni, és
     azon egy hiányzó kulcs miatt elszállna a mentés. */
  const value = (raw) => (raw === undefined ? null : raw);

  db.prepare(`
    INSERT INTO checkins (user_id, date, sleep_hours, sleep_quality, energy, stress, mood,
                          hydration, soreness, pain, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, date) DO UPDATE SET
      sleep_hours = excluded.sleep_hours, sleep_quality = excluded.sleep_quality,
      energy      = excluded.energy,      stress        = excluded.stress,
      mood        = excluded.mood,        hydration     = excluded.hydration,
      soreness    = excluded.soreness,    pain          = excluded.pain,
      updated_at  = excluded.updated_at
  `).run(
    userId, date,
    value(fields.sleepHours), value(fields.sleepQuality), value(fields.energy),
    value(fields.stress), value(fields.mood), value(fields.hydration),
    JSON.stringify(fields.soreness ?? {}), JSON.stringify(fields.pain ?? {}),
  );
  return getCheckin(userId, date);
}

/** Az Epley-képlet a becsült 1RM kiszámítására: 1RM = weight × (1 + reps/30) */
export function calculateEpley1RM(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r < 1) return 0;
  return w * (1 + r / 30);
}

/**
 * A gyakorlat REKORDOT HOZÓ szettje: a teljesítettek közül a legmagasabb
 * becsült 1RM-ű, vagy — ha egy sor sincs bepipálva — az első.
 *
 * Ez az egyetlen hely, ahol ez a szabály ki van mondva, és ennek oka van. A
 * szabály eddig kétszer, két ágon élt: az addWorkout a legjobb szettből
 * döntött PR-ről, a /api/prs listája viszont az ELSŐ teljesítettet írta ki.
 * Amíg minden szett egyforma volt, ez ritkán tért el; a szett-típusok óta
 * viszont az első sor alapból BEMELEGÍTŐ, tehát a lista rendszeresen egy
 * könnyű bemelegítést hirdetett rekordnak (10 × 40 kg a 5 × 100 helyett),
 * miközben a mellette álló csúcs a valódi értéket mutatta.
 *
 * @param {Array<object>} sets egy gyakorlat szettjei
 * @returns {object|null} a rekordot hozó szett, vagy null üres listára
 */
export function bestCompletedSet(sets = []) {
  let best = null;
  let best1rm = 0;
  for (const set of sets) {
    if (!set?.done) continue;
    const oneRM = calculateEpley1RM(set.weight, set.reps);
    if (best === null || oneRM > best1rm) { best = set; best1rm = oneRM; }
  }
  return best ?? sets[0] ?? null;
}

/** A felhasználó jelenlegi maximális 1RM-je egy gyakorlatban, vagy null ha még nincs. */
export function getExerciseMax(userId, exerciseName) {
  const row = db.prepare('SELECT max_1rm, date FROM exercise_maxes WHERE user_id = ? AND exercise_name = ?')
    .get(userId, exerciseName);
  return row ? { max1rm: row.max_1rm, date: row.date } : null;
}

/** A felhasználó összes nyomon követett maximális 1RM-je. */
export function getAllExerciseMaxes(userId) {
  return db.prepare('SELECT exercise_name, max_1rm, date FROM exercise_maxes WHERE user_id = ? ORDER BY date DESC')
    .all(userId);
}

/** Egy gyakorlat maximum 1RM-jének frissítése, ha az új érték nagyobb.
    Visszaadja az objektumot { max1rm, date, isPr } formában (isPr = true ha PR-t ütöttünk). */
export function updateExerciseMax(userId, exerciseName, new1rm, currentDate) {
  const existing = getExerciseMax(userId, exerciseName);
  const isPr = !existing || new1rm > existing.max1rm;

  if (isPr) {
    db.prepare(`
      INSERT INTO exercise_maxes (user_id, exercise_name, max_1rm, date, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, exercise_name) DO UPDATE SET
        max_1rm = excluded.max_1rm,
        date = excluded.date,
        updated_at = excluded.updated_at
    `).run(userId, exerciseName, new1rm, currentDate);
  }

  return { max1rm: isPr ? new1rm : existing.max1rm, date: isPr ? currentDate : existing.date, isPr };
}

/** A felhasználó által készített edzéstervek, legújabb elöl. */
export function getUserPlans(userId) {
  return db.prepare('SELECT id, name, date, exercises, days FROM plans WHERE user_id = ? ORDER BY id DESC')
    .all(userId)
    .map((row) => ({
      id: row.id, name: row.name, date: row.date,
      exercises: JSON.parse(row.exercises), days: JSON.parse(row.days),
    }));
}

/** A megadott hétnapra (0 = hétfő) ütemezett terv, vagy null. Ha több terv is
    ugyanarra a napra szól, a legutóbb létrehozott nyer. */
export function getPlanForDay(userId, dayIndex) {
  return getUserPlans(userId).find((plan) => plan.days.includes(dayIndex)) || null;
}

/** Az épp szerkesztett edzés piszkozata ({ name, exercises, date, planId })
    vagy null. A planId mutatja, melyik tervből indult az edzés. */
export function getWorkoutDraft(userId) {
  const row = db.prepare('SELECT name, exercises, date, plan_id FROM workout_draft WHERE user_id = ?')
    .get(userId);
  return row
    ? { name: row.name, exercises: JSON.parse(row.exercises), date: row.date, planId: row.plan_id }
    : null;
}

/** A mentett edzések, legújabb elöl (a gyakorlatok JSON-ból visszafejtve). */
export function getWorkouts(userId) {
  return db.prepare('SELECT id, name, date, exercises, plan_id FROM workouts WHERE user_id = ? ORDER BY id DESC')
    .all(userId)
    .map((row) => ({
      id: row.id, name: row.name, date: row.date,
      exercises: JSON.parse(row.exercises), planId: row.plan_id,
    }));
}

/** Teljes pillanatkép a beállítások exportjához: a közös referencia-adat és a
    HÍVÓ SAJÁT naplói. Más felhasználó adata sosem kerül bele. */
export function getSnapshot(userId) {
  const snapshot = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM collections').all()) {
    snapshot[key] = JSON.parse(value);
  }
  snapshot.weightLog = getWeightLog(userId);
  snapshot.nutritionLog = getNutritionLog(userId);
  snapshot.workouts = getWorkouts(userId);
  snapshot.workoutDraft = getWorkoutDraft(userId);
  snapshot.userPlans = getUserPlans(userId);
  snapshot.checkins = getCheckins(userId, 1000);
  /* Az egyéni csúcsok is a felhasználó adata. Az edzésekből elvileg
     visszaszámolhatók (ezt teszi a backfillExerciseMaxes), de a „teljes
     pillanatkép" akkor teljes, ha nem kell hozzá újraszámolni semmit — és a
     csúcs DÁTUMA is megmarad, ami a naplóból csak közvetve jönne ki.
     A mezőnevek itt a getExerciseMax alakját követik (max1rm), nem a tábla
     oszlopneveit — a snapshot többi része is a felület felőli alakot használja.
     A getAllExerciseMaxes nyers sorait ezért képezzük át, nem őt írjuk át:
     azon a /api/exercise-maxes végpont ül. */
  snapshot.exerciseMaxes = getAllExerciseMaxes(userId).map((row) => ({
    exercise: row.exercise_name,
    max1rm: row.max_1rm,
    date: row.date,
  }));
  return snapshot;
}

/* ---- Írás ---- */

/** A nap testsúly-bejegyzése; visszaadja a { id, kg, date } sort.
    FELHASZNÁLÓNKÉNT ÉS NAPONTA EGY SOR: ha az adott fióknak arra a napra már
    van bejegyzése, azt írjuk felül.
    A testsúlyt a napi check-in kérdi (Regeneráció → check-in varázsló), amit
    a nap folyamán bármikor újra lehet menteni — sima INSERT-tel minden mentés
    új oszlopot rakott volna a trend-diagramra ugyanarról a napról. */
export function addWeightEntry(userId, kg, date) {
  const existing = db.prepare('SELECT id FROM weight_log WHERE user_id = ? AND date = ? ORDER BY id DESC')
    .get(userId, date);
  if (existing) {
    db.prepare('UPDATE weight_log SET kg = ? WHERE id = ?').run(kg, Number(existing.id));
    return db.prepare('SELECT id, kg, date FROM weight_log WHERE id = ?').get(Number(existing.id));
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO weight_log (user_id, kg, date) VALUES (?, ?, ?)')
    .run(userId, kg, date);
  return db.prepare('SELECT id, kg, date FROM weight_log WHERE id = ?').get(Number(lastInsertRowid));
}

/** Étel naplózása a megadott adaggal (a makrók a szerver-oldali food
    objektumból, 100 g-ra vonatkozó alapértékekből átszámolva — a kliens által
    küldött tápértékekben nem bízunk, csak az adag grammjában).
    Visszaadja a létrejött bejegyzést és a frissített napi összesítőt. */
export function addNutritionEntry(userId, food, date, grams = 100) {
  const factor = grams / 100;
  // A kalória egész, a makrók egy tizedesre — így a napi összeg sem gyűjt
  // lebegőpontos szemetet (pl. 0.30000000000000004 g zsír).
  const round1 = (value) => Math.round(value * factor * 10) / 10;

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO nutrition_log (user_id, name, grams, kcal, protein, carbs, fat, date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId, food.name, grams, Math.round(food.kcal * factor),
    round1(food.protein), round1(food.carbs), round1(food.fat), date,
  );
  const entry = db.prepare(`SELECT id, name, grams, kcal, protein, carbs, fat, date
                            FROM nutrition_log WHERE id = ?`).get(Number(lastInsertRowid));
  return { entry, totals: getNutritionTotals(userId, date) };
}

/** Egy naplóbejegyzés törlése (a Táplálkozás oldal ✕ gombja). Csak a MAI
    bejegyzés törölhető: a korábbi napok összesítői már beépültek a
    készenlét-számításba, azokat visszamenőleg nem írjuk át. Ismeretlen, nem
    aznapi vagy MÁS FELHASZNÁLÓ id-jére null-t ad — a hívó ebből 404-et képez. */
export function deleteNutritionEntry(userId, id, date) {
  const { changes } = db.prepare('DELETE FROM nutrition_log WHERE id = ? AND user_id = ? AND date = ?')
    .run(id, userId, date);
  return changes > 0 ? getNutritionTotals(userId, date) : null;
}

/** A piszkozat felülírása (felhasználónként egy sor) — minden változtatásnál
    hívjuk. A date a szerver helyi napja: ebből dönti el a /api/workout-template,
    hogy a piszkozat aznapi-e, vagy jöhet helyette a napra ütemezett terv. */
export function saveWorkoutDraft(userId, name, exercises, date, planId = null) {
  db.prepare(`INSERT INTO workout_draft (user_id, name, exercises, date, plan_id, updated_at)
              VALUES (?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET
                name = excluded.name, exercises = excluded.exercises,
                date = excluded.date, plan_id = excluded.plan_id,
                updated_at = excluded.updated_at`)
    .run(userId, name, JSON.stringify(exercises), date, planId);
  return { name, exercises, planId };
}

/** A piszkozat törlése — az „Edzés befejezése" hívja, miután az edzés bekerült
    a naplóba. Így ugyanaznap új edzés kezdhető, a lezárt edzés nem ragad az
    Edzés oldalon, és nem lehet másodszor is (duplikátumként) lenaplózni. */
export function clearWorkoutDraft(userId) {
  db.prepare('DELETE FROM workout_draft WHERE user_id = ?').run(userId);
}

/** Edzés mentése; automatikusan kiszámítja a PR-eket az Epley-képlet alapján.
    A rekordok a MENTŐ FELHASZNÁLÓ saját csúcsaihoz mérődnek.
    Visszaadja a létrejött { id, name, date, exercises, planId } sort. */
export function addWorkout(userId, name, date, exercises, planId = null) {
  // PR-eket számítunk az Epley-képlettel: 1RM = weight × (1 + reps/30)
  // Ha egy gyakorlatban van teljesített szett, és az 1RM nagyobb mint az eddigi maximum,
  // akkor PR-ként jelöljük meg a gyakorlatot
  const processedExercises = exercises.map((exercise) => {
    const sets = exercise.sets || [];

    // A rekordot hozó szett (teljesítettek közül a legjobb, különben az első)
    // — ugyanaz a szabály, amit a /api/prs listája is kiír.
    const record = bestCompletedSet(sets);
    const bestCompleted1rm = record ? calculateEpley1RM(record.weight, record.reps) : 0;

    // PR-ellenőrzés és frissítés
    let isPr = false;
    if (bestCompleted1rm > 0) {
      isPr = updateExerciseMax(userId, exercise.name, bestCompleted1rm, date).isPr;
    }

    return {
      ...exercise,
      pr: isPr || exercise.pr, // ha már volt PR jel vagy most érte el
    };
  });

  const { lastInsertRowid } = db
    .prepare('INSERT INTO workouts (user_id, name, date, exercises, plan_id) VALUES (?, ?, ?, ?, ?)')
    .run(userId, name, date, JSON.stringify(processedExercises), planId);
  return { id: Number(lastInsertRowid), name, date, exercises: processedExercises, planId };
}

/** Edzésterv mentése; visszaadja a létrejött { id, name, date, exercises, days } sort. */
export function addPlan(userId, name, date, exercises, days) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO plans (user_id, name, date, exercises, days) VALUES (?, ?, ?, ?, ?)')
    .run(userId, name, date, JSON.stringify(exercises), JSON.stringify(days));
  return { id: Number(lastInsertRowid), name, date, exercises, days };
}

/** Meglévő terv felülírása (név, gyakorlatok, napok — a létrehozás dátuma marad).
    A frissített sort adja vissza, vagy null-t, ha nincs ilyen id — MÁS
    felhasználó tervére is null jön, azt nem lehet átírni. */
export function updatePlan(userId, id, name, exercises, days) {
  const { changes } = db.prepare('UPDATE plans SET name = ?, exercises = ?, days = ? WHERE id = ? AND user_id = ?')
    .run(name, JSON.stringify(exercises), JSON.stringify(days), id, userId);
  if (changes === 0) return null;
  const row = db.prepare('SELECT id, name, date, exercises, days FROM plans WHERE id = ?').get(id);
  return { ...row, exercises: JSON.parse(row.exercises), days: JSON.parse(row.days) };
}

/** Az adatbázis-kapcsolat lezárása.

    A szervernek erre nincs szüksége (a folyamat végéig nyitva tartja a fájlt),
    a TESZTEKNEK viszont igen: azok ideiglenes könyvtárba dolgoznak, és azt a
    futás végén letörlik. Windowson egy NYITOTT fájlt nem lehet törölni — a
    takarítás EPERM-mel elszállt, és a teszt „megbukott" úgy, hogy közben
    minden állítása teljesült. Ezért a takarítás előtt le kell zárni. */
export function closeDatabase() {
  db.close();
}
