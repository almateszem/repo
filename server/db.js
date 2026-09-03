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
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { data as seed } from './data.js';
import { buildExerciseCatalog, buildFoodCatalog } from './data/catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Alapból server/fittrack.db; a FITTRACK_DB env-változóval felülírható (pl. teszthez).
const DB_PATH = process.env.FITTRACK_DB || path.join(__dirname, 'fittrack.db');

/* Volt-e már adatbázis, mielőtt megnyitottuk? Ez a legolcsóbb ELLENŐRIZHETŐ
   jele annak, hogy a fájl tényleg megmarad a deployok között: sok hostingon
   (Heroku, Render, Fly volume nélkül) a fájlrendszer ephemeral, és minden
   újraindításkor üres lappal indulnánk — a felhasználók naplója pedig
   csendben eltűnne. Egy „új adatbázis jött létre" sor minden indításkor
   ennek a pontos tünete, és a naplóban azonnal látszik.
   Ld. TEENDOK.txt → ÜZEMELTETÉS, és a README „Élesítés" szakasza. */
const dbExisted = existsSync(DB_PATH);

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
    goal          TEXT,            -- edzés-cél kulcsa (data.js → goals), lehet NULL
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
  -- Saját (a felhasználó által felvitt) ételek. A beépített katalógus a
  -- collections['foods'] kulcsban él és MINDENKINEK közös; ez viszont
  -- felhasználói adat, ezért saját tábla user_id-vel. A tápértékek — mint a
  -- beépített katalógusban — 100 g / 100 ml alapmennyiségre értendők, így a
  -- naplózás (addNutritionEntry) változtatás nélkül működik rájuk.
  CREATE TABLE IF NOT EXISTS custom_foods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- COLLATE NOCASE: a „Tejföl" és a „tejföl" ugyanaz az étel, a UNIQUE is erre
    -- épül. A SQLite NOCASE viszont csak ASCII-t hajt (a „TÚRÓ" és a „túró"
    -- SQL szinten két külön sor), ezért a felvitel ELŐTT az addCustomFood
    -- ékezet-helyesen is ellenőrzi az ütközést — ez a megszorítás a backstop.
    name       TEXT NOT NULL COLLATE NOCASE,
    brand      TEXT NOT NULL DEFAULT '',
    -- Nem lehet a neve "group": az SQL kulcsszó, idézőjel nélkül szintaktikai hiba.
    food_group TEXT NOT NULL DEFAULT '',       -- a FOOD_GROUPS egyike vagy üres
    unit       TEXT NOT NULL DEFAULT 'g',      -- 'g' | 'ml'
    kcal       REAL NOT NULL,
    protein    REAL NOT NULL,
    carbs      REAL NOT NULL,
    fat        REAL NOT NULL,
    kcal_auto  INTEGER NOT NULL DEFAULT 1,     -- 1 = a kcal a makrókból számolt (4/4/9)
    barcode    TEXT,                           -- normalizált EAN-13, vagy NULL
    portions   TEXT NOT NULL DEFAULT '[]',     -- JSON: [['1 adag', 150]]
    source     TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'openfoodfacts'
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, name),
    -- SQLite-ban a NULL-ok egymástól KÜLÖNBÖZŐEK, ezért ez a megszorítás a
    -- vonalkód nélkül, kézzel felvitt ételekbe nem szól bele.
    UNIQUE (user_id, barcode)
  );
  -- Vonalkód → Open Food Facts termék, gyorsítótárazva. Ez NEM felhasználói
  -- adat: ugyanaz a vonalkód mindenkinek ugyanazt a terméket jelenti, ezért
  -- szándékosan nincs rajta user_id (és nincs is rajta mit szivárogtatni).
  -- A negatív találatot is tároljuk (found = 0) — enélkül minden újraolvasás
  -- új hálózati kérés lenne egy nem létező termékre.
  -- Napi táplálkozási cél, FELHASZNÁLÓNKÉNT. Korábban egyetlen fix érték volt
  -- a seed adatban, minden fióknak ugyanaz.
  --
  -- Fiókonként KÉT sor lehet, és ez a lényeg:
  --   'coach' — amit az edző tűzött ki,
  --   'own'   — amit a felhasználó maga állított be.
  -- Az érvényes cél az 'own', ha van; különben a 'coach'; különben a seed
  -- alapérték. A két sor EGYÜTT él tovább: így látszik, hogy a felhasználó
  -- eltért az edzői céltól — a néma felülírás mindkét irányban rossz volna.
  --
  -- Csak kalória és fehérje: a felület (a napi összesítő, az étel-modál
  -- sávjai és az áttekintő) ezt a kettőt méri célhoz. Szénhidrát/zsír célt
  -- nem veszünk fel, amíg nincs, ami megjelenítse.
  -- Megjegyzések. Egy edzésen belüli GYAKORLATRA mutatnak — nem üzenetek: az
  -- edző–sportoló beszélgetés a messages táblában él, ez pedig egy konkrét
  -- gyakorlathoz tapad („fájt a vállam a 3. szettnél").
  --
  --   author_id   — ki írta,
  --   subject_id  — KINEK az adatáról szól (a hozzáférés ebből dől el: a
  --                 subject maga és az ÉLŐ kapcsolatban álló edzője),
  --   target_type — egyelőre csak 'exercise'; a szett és a videó akkor kerül
  --                 be, amikor lesz mire mutatniuk,
  --   target_id   — "edzésId:index" (a workouts.exercises tömbön belüli
  --                 pozíció; a mentett edzés gyakorlat-listája nem változik,
  --                 ezért az index stabil).
  CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_comments_target
    ON comments(subject_id, target_type, target_id, id);

  CREATE TABLE IF NOT EXISTS nutrition_goals (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source     TEXT NOT NULL,        -- 'own' | 'coach'
    calories   REAL NOT NULL,
    protein    REAL NOT NULL,
    set_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- ki állította be
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, source)
  );

  CREATE TABLE IF NOT EXISTS barcode_cache (
    barcode    TEXT PRIMARY KEY,               -- normalizált (EAN-13-ra egészített) kód
    found      INTEGER NOT NULL,               -- 1 = van termék, 0 = az OFF nem ismeri
    payload    TEXT NOT NULL DEFAULT '{}',     -- JSON: a leképezett termék (found = 1)
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    -- Melyik MENTETT edzésből nyitották vissza (NULL = új edzés). Ebből tudja a
    -- befejezés, hogy a meglévő sort kell FRISSÍTENIE: enélkül a javított edzés
    -- mai edzésként íródna be, és elcsúszna a napló időrendje.
    workout_id INTEGER,
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
  -- Edző–sportoló kapcsolat. EGY sor = egy irányított kapcsolat: az edző
  -- meghívja a sportolót ('pending'), a sportoló elfogadja ('active').
  -- A pár (coach_id, athlete_id) egyedi, tehát ugyanaz a meghívás nem
  -- duplázódhat; a fordított irányú (a másik fél mint edző) külön sor lenne.
  CREATE TABLE IF NOT EXISTS coach_links (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    coach_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    athlete_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending | active
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    responded_at TEXT,                              -- mikor fogadta el a sportoló
    UNIQUE (coach_id, athlete_id),
    CHECK (coach_id != athlete_id)
  );
  -- Üzenetek a kapcsolat két oldala között. A szál a kapcsolathoz tartozik,
  -- nem a két félhez külön — a kapcsolat megszűnésével (CASCADE) az üzenetek
  -- is eltűnnek, tehát a levált sportoló előzménye nem marad az edzőnél.
  -- A read_at a CÍMZETT olvasását jelöli: mikor nézte meg a szál másik oldala
  -- ezt a sort. NULL = olvasatlan. Egy szálnak két oldala van, tehát egy
  -- oszlop elég — a küldő számára a saját üzenete definíció szerint olvasott.
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id    INTEGER NOT NULL REFERENCES coach_links(id) ON DELETE CASCADE,
    sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),  -- UTC
    read_at    TEXT                                      -- UTC, NULL = olvasatlan
  );
  -- Terv-kiosztás: az edző FELAJÁNL egy tervet, a sportoló elfogadja vagy
  -- elutasítja. Miért nem írjuk egyszerűen a sportoló plans táblájába:
  --   1. A tervet TÖRÖLNI nem lehet az appban, tehát amit egyszer belepakolunk
  --      a fiókjába, azt onnan nem is tudná kiszedni.
  --   2. Ugyanaz az elv, mint a kapcsolaté: ami a másik fiókjában megjelenik,
  --      ahhoz a másik BELEEGYEZÉSE kell.
  -- A gyakorlat-lista PILLANATKÉP, nem hivatkozás: ha az edző később átírja a
  -- saját tervét, a kiosztott (és elfogadott) példány nem változik meg némán
  -- a sportoló alatt.
  CREATE TABLE IF NOT EXISTS plan_assignments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id      INTEGER NOT NULL REFERENCES coach_links(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    exercises    TEXT NOT NULL,                  -- JSON, a plans.exercises alakjában
    days         TEXT NOT NULL DEFAULT '[]',     -- JSON: hétnap-indexek
    note         TEXT,                           -- az edző kísérő sora (nem kötelező)
    status       TEXT NOT NULL DEFAULT 'pending',-- pending | accepted | declined
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    responded_at TEXT
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
// Edzés-cél: a fiók sajátja, az edzői panel kártyáján címkeként látszik.
// Üresen hagyható (NULL) — a felület ilyenkor „—"-t mutat.
ensureColumn('users', 'goal', 'goal TEXT');
/* Edzés utáni visszajelzés. STRUKTURÁLT mező, nem komment: a nehézség és a
   közérzet így számmá válik, tehát később elemezhető — egy szabad szöveges
   kommentből ez nem jönne ki. Mindhárom NULL-ozható: a „nem küldött
   visszajelzést" és a „rosszat jelzett" két külön dolog, ugyanúgy, mint a
   check-innél. */
ensureColumn('workouts', 'feedback_difficulty', 'feedback_difficulty INTEGER');
ensureColumn('workouts', 'feedback_mood', 'feedback_mood INTEGER');
ensureColumn('workouts', 'feedback_note', 'feedback_note TEXT');
ensureColumn('workouts', 'feedback_at', 'feedback_at TEXT');
/* Mire épül a csúcs: 'measured' — naplózott szettből számolt (Epley), vagy
   'declared' — az erőfelmérésen BEMONDOTT érték. A kettő nem ugyanaz, és a
   felületnek ki is kell mondania, min alapul: a bemondott szám nem mérés.
   (Ugyanaz a megkülönböztetés, ami a gyakorlat-katalógusban a loadSource.)
   A meglévő sorok mind naplózott szettből születtek, tehát a default helyes. */
ensureColumn('exercise_maxes', 'source', "source TEXT NOT NULL DEFAULT 'measured'");
// Olvasás-jelölés az üzeneteken. A régi sorok NULL-lal (olvasatlanul) jönnek
// át — ez a helyes: nem tudhatjuk, látta-e őket a címzett. Aki megnyitja a
// szálat, egy lépésben olvasottá teszi a régi hátralékot is.
ensureColumn('messages', 'read_at', 'read_at TEXT');

/* ---- Migráció: egyfelhasználós → többfelhasználós ----

   A korábbi verziókban nem volt fiók: egyetlen közös adathalmaz létezett.
   Ezt az adatot NEM dobjuk el. Ha találunk ilyen sorokat, létrehozunk egy
   ARCHÍV felhasználót (üres jelszó-hash → belépni vele nem lehet), és minden
   gazdátlan sort hozzá rendelünk. Az ELSŐ valódi regisztráció aztán átveszi
   ezt az adatot (ld. createUser → adoptLegacyData), és az archív fiók eltűnik.

   Így aki eddig helyben használta az appot, a regisztráció után ugyanazt az
   előzményt látja, mint korábban. */

/* A FELHASZNÁLÓI adatot tartó táblák — mindegyik sorát a `user_id` köti a
   fiókhoz. Egy helyen felsorolva, mert két művelet is végigmegy rajtuk: az
   első regisztráció adat-öröklése és a fiók törlése. Ha új ilyen tábla
   születik, ITT kell felvenni. */
const USER_DATA_TABLES = ['weight_log', 'nutrition_log', 'workouts', 'plans',
  'workout_draft', 'checkins', 'exercise_maxes'];


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

/* Ez az ensureColumn KÉSŐBB fut, mint a többi — szándékosan. A
   rebuildWorkoutDraft ÚJRAÉPÍTI a táblát (a régi id = 1 kulcs miatt), tehát a
   fölötte hozzáadott oszlopot menet közben eldobná. Aki ide új oszlopot vesz
   fel a workout_draft-hoz, az ide vegye fel, ne a többi közé. */
ensureColumn('workout_draft', 'workout_id', 'workout_id INTEGER');

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
   rekordjait, annak az adatához nem nyúl.

   Maga az újraépítés a recomputeExerciseMaxes-ban él (ld. lentebb, az egyéni
   csúcsok között): ugyanazt a munkát végzi a törlés/javítás után is, és két
   helyen álló, lassan elcsúszó másolatból pontosan a bestCompletedSet
   kommentjében leírt hiba születne. */
function backfillExerciseMaxes() {
  const userIds = db.prepare(`
    SELECT DISTINCT w.user_id AS id FROM workouts w
    WHERE NOT EXISTS (SELECT 1 FROM exercise_maxes m WHERE m.user_id = w.user_id)
  `).all().map((row) => row.id);

  for (const userId of userIds) recomputeExerciseMaxes(userId);
}
backfillExerciseMaxes();

/* ---- Indexek ----
   A táblák átépítése (workout_draft, checkins) eldobja a rajtuk lévő
   indexeket, ezért az index-létrehozás a migrációk UTÁN áll.

   A napi táplálkozási összesítő és a mai napló felhasználóra + dátumra szűr;
   index nélkül ez a napról napra hízó nutrition_log teljes végigolvasása volt
   (EXPLAIN QUERY PLAN: SCAN nutrition_log). A korábbi, csak dátum szerinti
   index helyét az összetett veszi át — az első oszlopa ugyanúgy szűr, de a
   felhasználós lekérdezést is kiszolgálja.

   A custom_foods SZÁNDÉKOSAN nem szerepel itt: a két UNIQUE megszorítása
   (user_id, name) és (user_id, barcode) implicit indexet hoz létre, és
   mindkettő első oszlopa user_id — a listázást és a vonalkód-keresést is
   kiszolgálják. Külön index csak felesleges írás-költség lenne. */
db.exec(`
  DROP INDEX IF EXISTS idx_nutrition_log_date;
  CREATE INDEX IF NOT EXISTS idx_nutrition_log_user_date ON nutrition_log(user_id, date);
  CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id);
  CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id);
  CREATE INDEX IF NOT EXISTS idx_weight_log_user ON weight_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_coach_links_coach ON coach_links(coach_id);
  CREATE INDEX IF NOT EXISTS idx_coach_links_athlete ON coach_links(athlete_id);
  CREATE INDEX IF NOT EXISTS idx_messages_link ON messages(link_id, id);
  /* Olvasatlan-számláló: az edzői panel EGY lekérdezéssel kéri le az összes
     szál hátralékát. Részleges index — csak az olvasatlan sorok kerülnek bele,
     tehát a mérete nem a szál hosszával, hanem a tényleg olvasatlan üzenetek
     számával nő (a szálak túlnyomó része elolvasva nulla sort ad ide). */
  CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(link_id, sender_id)
    WHERE read_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_plan_assignments_link ON plan_assignments(link_id, id);
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
console.log('SQLite kész →', path.resolve(DB_PATH), dbExisted ? '(meglévő)' : '(ÚJ adatbázis jött létre)');
if (!dbExisted) {
  /* Élesben ez a sor CSAK EGYSZER, a legelső indításkor helyénvaló. Ha minden
     deploy után látod, akkor a fájlrendszer ephemeral, és a felhasználói
     naplók deployonként elvesznek — perzisztens volume kell (README → Élesítés). */
  console.log('   → ha ezt MINDEN indításkor látod, az adatbázis nem marad meg: perzisztens tároló kell.');
}

/* ======================================================================
   Fiókok és munkamenetek
   ====================================================================== */

/** Egy felhasználó sora → a felület által látott alak (jelszó nélkül!). */
const toUser = (row) => (row
  ? { id: row.id, username: row.username, displayName: row.display_name }
  : null);

/** Egy felhasználó NYILVÁNOS alakja: ennyit lát róla a kapcsolat másik
    oldala (meghíváskor, a sportoló-kártyán, az üzenet-szálban). Az id
    szándékosan nincs benne — a felület a kapcsolat azonosítójával dolgozik. */
const toPublicUser = (row) => (row
  ? { username: row.username, name: row.display_name, goal: row.goal ?? null }
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

/** A fiók létrehozásának időpontja, ahogy a users.created_at tárolja
    (datetime('now') → "2026-03-12 08:41:07", UTC). Nem a getUser() adja vissza:
    a munkamenet-feloldás minden kérésben lefut, és ez az egy mező csak a
    profiloldal „Tag … óta" sorának kell. Ismeretlen fiókra null. */
export function getUserCreatedAt(id) {
  return db.prepare('SELECT created_at FROM users WHERE id = ?').get(id)?.created_at ?? null;
}

/** A fiók edzés-célja (a data.js goals-listájának kulcsa), vagy null. */
export function getUserGoal(id) {
  return db.prepare('SELECT goal FROM users WHERE id = ?').get(id)?.goal ?? null;
}

/** A fiók edzés-céljának beállítása. A null a „nincs megadva" — a hívó
    (server.js) ellenőrzi, hogy a kulcs szerepel-e a goals-listában. */
export function setUserGoal(id, goal) {
  db.prepare('UPDATE users SET goal = ? WHERE id = ?').run(goal, id);
  return getUserGoal(id);
}

/** Felhasználó keresése a (már kisbetűsített) felhasználónév alapján — a
    meghíváshoz. Az archív fiók SOSEM találat: az nem egy valódi ember, és a
    hozzárendelt adat az első regisztrálóé lesz. */
export function findUserByUsername(username) {
  const row = db.prepare('SELECT id, username, display_name, goal FROM users WHERE username = ? AND username != ?')
    .get(username, LEGACY_USERNAME);
  return row ? { id: row.id, ...toPublicUser(row) } : null;
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

  for (const table of USER_DATA_TABLES) {
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

/** A fiók jelszó-hashének cseréje (a hashelés a hívó dolga, ld. auth.js). */
export function updateUserPassword(id, passwordHash) {
  return db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id).changes > 0;
}

/** A fiók ÖSSZES munkamenetének törlése — jelszóváltáskor hívjuk, hogy a
    korábban kiadott sütik (más eszközök, esetleg egy ellopott token) ne
    maradjanak érvényben. A hívó ezután új munkamenetet nyit magának. */
export function deleteUserSessions(userId) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
}

/**
 * A fiók és MINDEN hozzá tartozó adat törlése, egyetlen tranzakcióban.
 *
 * A törlés SZÁNDÉKOSAN nem bízza magát az idegenkulcs-CASCADE-re: a séma új
 * adatbázisokon tartalmazza ugyan (`REFERENCES users(id) ON DELETE CASCADE`),
 * a fiókok előtti fájlokon viszont a `user_id` oszlopok ALTER TABLE-lel
 * születtek, megszorítás nélkül. Ott a users-sor törlése gazdátlan sorokat
 * hagyna maga után — épp azt az adatot, amit a felhasználó töröltetni akart.
 *
 * Az edző–sportoló kapcsolatok mindkét irányban megszűnnek, a hozzájuk tartozó
 * üzenetekkel együtt: a másik fél sem őrizheti tovább a beszélgetést.
 */
export function deleteUser(userId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`DELETE FROM messages
                WHERE link_id IN (SELECT id FROM coach_links WHERE coach_id = ? OR athlete_id = ?)`)
      .run(userId, userId);
    // Öv és nadrágtartó: ha egy üzenet valahogy kapcsolat nélkül maradt volna
    db.prepare('DELETE FROM messages WHERE sender_id = ?').run(userId);
    db.prepare('DELETE FROM coach_links WHERE coach_id = ? OR athlete_id = ?').run(userId, userId);

    for (const table of USER_DATA_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    const { changes } = db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    db.exec('COMMIT');
    return changes > 0;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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
   Edző–sportoló kapcsolatok és üzenetek
   ----------------------------------------------------------------------
   A kapcsolat IRÁNYÍTOTT: az edző hívja meg a sportolót (pending), és a
   sportoló fogadja el (active). Beleegyezés nélkül tehát senki adata nem
   látszik a másik oldalon — a végpontok mindenhol az AKTÍV kapcsolatot kérik.

   A sportolónak egyszerre EGY aktív edzője lehet (a felület is egy edzőt
   mutat); edzőként viszont bárki tarthat több sportolót.
   ====================================================================== */

/** A SQLite datetime('now') alakja ("2026-08-25 18:30:07", UTC) → ISO-8601.
    A felület relatív időt ír ki belőle ("2 órája"), ahhoz kell a zóna. */
const toIso = (stamp) => (stamp ? `${String(stamp).replace(' ', 'T')}Z` : null);

/** Meghívó: az edző hívja a sportolót. Visszaadja a létrejött kapcsolatot
    (getCoachLink alakjában), vagy null-t, ha ez a pár EBBEN AZ IRÁNYBAN már
    létezik (függő vagy élő). A fordított irányt a hívó zárja ki
    (server.js): az önmagában érvényes sor lenne, csak épp értelmetlen. */
export function createCoachInvite(coachId, athleteId) {
  if (coachId === athleteId) return null;
  if (db.prepare('SELECT 1 FROM coach_links WHERE coach_id = ? AND athlete_id = ?').get(coachId, athleteId)) {
    return null;
  }
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO coach_links (coach_id, athlete_id, status) VALUES (?, ?, 'pending')",
  ).run(coachId, athleteId);
  return getCoachLink(Number(lastInsertRowid));
}

/** Egy kapcsolat a saját azonosítója alapján (a végpontok ebből döntik el,
    hogy a hívó fél egyáltalán érintett-e). Ismeretlen id-re null. */
export function getCoachLink(linkId) {
  const row = db.prepare(`SELECT id, coach_id, athlete_id, status, created_at, responded_at
                          FROM coach_links WHERE id = ?`).get(linkId);
  return row ? {
    id: row.id,
    coachId: row.coach_id,
    athleteId: row.athlete_id,
    status: row.status,
    createdAt: toIso(row.created_at),
    respondedAt: toIso(row.responded_at),
  } : null;
}

/** A sportoló ÉLŐ edzője, vagy null. */
export function getActiveCoach(athleteId) {
  const row = db.prepare(`
    SELECT l.id AS link_id, u.username, u.display_name, u.goal
    FROM coach_links l JOIN users u ON u.id = l.coach_id
    WHERE l.athlete_id = ? AND l.status = 'active'
    ORDER BY l.id LIMIT 1
  `).get(athleteId);
  return row ? { linkId: row.link_id, ...toPublicUser(row) } : null;
}

/** A sportolóhoz érkezett, még el nem fogadott meghívók (legújabb elöl). */
export function getPendingCoachInvites(athleteId) {
  return db.prepare(`
    SELECT l.id AS link_id, l.created_at, u.username, u.display_name, u.goal
    FROM coach_links l JOIN users u ON u.id = l.coach_id
    WHERE l.athlete_id = ? AND l.status = 'pending'
    ORDER BY l.id DESC
  `).all(athleteId).map((row) => ({
    linkId: row.link_id, at: toIso(row.created_at), coach: toPublicUser(row),
  }));
}

/**
 * Az edző sportolói a megadott állapotban ('active' vagy 'pending').
 * A sor tartalmazza a sportoló BELSŐ azonosítóját is: a hívó (server.js)
 * ebből olvassa ki a sportoló naplóit a kártya-statokhoz. A hálózatra
 * kimenő alakba az id nem kerül bele — ott a linkId az azonosító.
 */
export function getCoachAthletes(coachId, status = 'active') {
  return db.prepare(`
    SELECT l.id AS link_id, l.created_at, l.responded_at, u.id AS user_id,
           u.username, u.display_name, u.goal
    FROM coach_links l JOIN users u ON u.id = l.athlete_id
    WHERE l.coach_id = ? AND l.status = ?
    ORDER BY l.id
  `).all(coachId, status).map((row) => ({
    linkId: row.link_id,
    at: toIso(row.created_at),
    // Mikor fogadta el a sportoló. Csak élő kapcsolatnál van értéke — az
    // értesítés-panel ebből tudja, hogy „X elfogadta a meghívódat".
    respondedAt: toIso(row.responded_at),
    userId: row.user_id,
    ...toPublicUser(row),
  }));
}

/** Meghívó elfogadása. A hívó előbb ellenőrzi, hogy a sportolónak nincs-e már
    élő edzője — ez a függvény csak az állapotot állítja át. */
export function acceptCoachInvite(linkId) {
  const { changes } = db.prepare(
    "UPDATE coach_links SET status = 'active', responded_at = datetime('now') WHERE id = ? AND status = 'pending'",
  ).run(linkId);
  return changes > 0 ? getCoachLink(linkId) : null;
}

/** Kapcsolat bontása: visszautasított/visszavont meghívó és leválás is ez.
    Az üzenetek a CASCADE miatt vele tűnnek el. */
export function deleteCoachLink(linkId) {
  return db.prepare('DELETE FROM coach_links WHERE id = ?').run(linkId).changes > 0;
}

/** Egy üzenet-sor → a felület által látott alak. A `mine` a NÉZŐ szemszöge,
    ezért a hívó adja hozzá (ld. server.js). */
const toMessage = (row) => ({
  id: row.id,
  senderId: row.sender_id,
  author: row.display_name,
  text: row.body,
  at: toIso(row.created_at),
  readAt: toIso(row.read_at),
});

/** A négy üzenet-lekérdezés ugyanazt a mezőkészletet adja vissza (ezt várja a
    toMessage), ezért a SELECT-lista egy helyen él. */
const MESSAGE_COLUMNS = `
  m.id, m.sender_id, m.body, m.created_at, m.read_at, u.display_name
  FROM messages m JOIN users u ON u.id = m.sender_id
`;

/** Egy kapcsolat üzenetei időrendben (a legutóbbi `limit` darab). */
export function getMessages(linkId, limit = 100) {
  return db.prepare(`
    SELECT ${MESSAGE_COLUMNS}
    WHERE m.link_id = ? ORDER BY m.id DESC LIMIT ?
  `).all(linkId, limit).map(toMessage).reverse();
}

/** A kapcsolat legutóbbi üzenete, vagy null (a sportoló-kártya idézi). */
export function getLastMessage(linkId) {
  const row = db.prepare(`
    SELECT ${MESSAGE_COLUMNS}
    WHERE m.link_id = ? ORDER BY m.id DESC LIMIT 1
  `).get(linkId);
  return row ? toMessage(row) : null;
}

/** Üzenet küldése egy kapcsolatba. A küldő fél jogosultságát a végpont
    ellenőrzi (csak a kapcsolat két oldala írhat bele). */
export function addMessage(linkId, senderId, body) {
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO messages (link_id, sender_id, body) VALUES (?, ?, ?)',
  ).run(linkId, senderId, body);
  const row = db.prepare(`SELECT ${MESSAGE_COLUMNS} WHERE m.id = ?`).get(Number(lastInsertRowid));
  return toMessage(row);
}

/**
 * A szál olvasottnak jelölése a NÉZŐ szemszögéből: a másik fél még olvasatlan
 * üzenetei kapnak időbélyeget. A sajátjait senki nem „olvassa el" — azok
 * read_at-je a címzett olvasását jelöli, tehát a sender_id != ? feltétel nem
 * finomkodás, hanem a mező jelentése.
 *
 * @returns {number} hány üzenet vált olvasottá (0 = nem volt hátralék)
 */
export function markMessagesRead(linkId, readerId) {
  return db.prepare(`
    UPDATE messages SET read_at = datetime('now')
    WHERE link_id = ? AND sender_id != ? AND read_at IS NULL
  `).run(linkId, readerId).changes;
}

/**
 * A felhasználó ÖSSZES szálának olvasatlan-hátraléka egyetlen lekérdezésben:
 * { [linkId]: darabszám }, csak a nem-nulla szálakkal.
 *
 * Szándékosan nem szálanként számolunk: az edzői panel 20-30 sportolónál
 * ugyanennyi külön COUNT-ot futtatna, és a szinkron SQLite miatt mindegyik a
 * teljes event loopot blokkolná (ld. TEENDOK.txt, teljesítmény-szakasz).
 */
export function getUnreadCounts(userId) {
  const rows = db.prepare(`
    SELECT m.link_id, COUNT(*) AS unread
    FROM messages m JOIN coach_links l ON l.id = m.link_id
    WHERE m.read_at IS NULL AND m.sender_id != ?
      AND (l.coach_id = ? OR l.athlete_id = ?)
    GROUP BY m.link_id
  `).all(userId, userId, userId);
  return new Map(rows.map((row) => [row.link_id, row.unread]));
}

/* ---- Terv-kiosztás ---- */

/** Egy kiosztás-sor → a felület által látott alak. */
const toAssignment = (row) => ({
  id: row.id,
  linkId: row.link_id,
  name: row.name,
  exercises: JSON.parse(row.exercises),
  days: JSON.parse(row.days),
  note: row.note,
  status: row.status,
  at: toIso(row.created_at),
  respondedAt: toIso(row.responded_at),
});

/* A kiosztás mezői. Kétszer kell: egyszer önmagában, egyszer `a.` előtaggal a
   kapcsolat- és felhasználó-JOIN-os lekérdezésekhez (ott a display_name miatt
   a csillag nem volna egyértelmű). */
const ASSIGNMENT_FIELDS = ['id', 'link_id', 'name', 'exercises', 'days', 'note', 'status', 'created_at', 'responded_at'];
const ASSIGNMENT_COLUMNS = ASSIGNMENT_FIELDS.join(', ');
const ASSIGNMENT_COLUMNS_A = ASSIGNMENT_FIELDS.map((field) => `a.${field}`).join(', ');

/** Terv felajánlása a kapcsolat sportolójának. A hívó (server.js) ellenőrzi,
    hogy a kapcsolat él-e, és hogy tényleg az EDZŐ oldala kéri. */
export function assignPlan(linkId, { name, exercises, days, note = null }) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO plan_assignments (link_id, name, exercises, days, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(linkId, name, JSON.stringify(exercises), JSON.stringify(days), note);
  return getPlanAssignment(Number(lastInsertRowid));
}

/** Egy kiosztás a saját azonosítója alapján (a végpont ebből dönti el, hogy a
    hívó egyáltalán érintett-e). Ismeretlen id-re null. */
export function getPlanAssignment(id) {
  const row = db.prepare(`SELECT ${ASSIGNMENT_COLUMNS} FROM plan_assignments WHERE id = ?`).get(id);
  return row ? toAssignment(row) : null;
}

/**
 * A sportolóhoz érkezett, még FÜGGŐ terv-ajánlatok (legújabb elöl), az edző
 * nevével együtt. Csak élő kapcsolatból: a felfüggesztett/megszűnt kapcsolat
 * ajánlata nem lóghat ott a sportolónál.
 */
export function getPendingPlanOffers(athleteId) {
  return db.prepare(`
    SELECT ${ASSIGNMENT_COLUMNS_A}, u.display_name, u.username
    FROM plan_assignments a
    JOIN coach_links l ON l.id = a.link_id
    JOIN users u ON u.id = l.coach_id
    WHERE l.athlete_id = ? AND l.status = 'active' AND a.status = 'pending'
    ORDER BY a.id DESC
  `).all(athleteId).map((row) => ({
    ...toAssignment(row),
    coach: { username: row.username, name: row.display_name },
  }));
}

/**
 * Az edző által kiosztott tervek, amikre a sportoló MÁR válaszolt — az
 * értesítés-panel ebből tudja, hogy „X elfogadta a … tervet". Csak a
 * `limit` legutóbbi, a sportoló nevével.
 */
export function getAnsweredPlanOffers(coachId, limit = 10) {
  return db.prepare(`
    SELECT ${ASSIGNMENT_COLUMNS_A}, u.display_name, u.username
    FROM plan_assignments a
    JOIN coach_links l ON l.id = a.link_id
    JOIN users u ON u.id = l.athlete_id
    WHERE l.coach_id = ? AND a.status != 'pending'
    ORDER BY a.responded_at DESC LIMIT ?
  `).all(coachId, limit).map((row) => ({
    ...toAssignment(row),
    athlete: { username: row.username, name: row.display_name },
  }));
}

/** A kiosztás lezárása ('accepted' vagy 'declined'). Csak FÜGGŐ sort mozdít
    meg, tehát a kétszer elküldött válasz nem írja felül az elsőt. */
export function resolvePlanAssignment(id, status) {
  const { changes } = db.prepare(`
    UPDATE plan_assignments SET status = ?, responded_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(status, id);
  return changes > 0 ? getPlanAssignment(id) : null;
}

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

/** A `sinceDate` óta rögzített testsúlyok, a getWeightLog sorrendjében
    (legrégebbi elöl). Az edzői kártyához ennyi elég: a készenlét-motor csak a
    LEGUTOLSÓ mérést használja (a terhelés-referenciák skálázásához), a
    „legutóbbi aktivitás" pedig négy eseményt mutat. Napi méréssel a teljes
    napló évente ~365 sorral hízik — sportolónként, minden panel-frissítésnél. */
export function getWeightLogSince(userId, sinceDate) {
  return db.prepare('SELECT id, kg, date FROM weight_log WHERE user_id = ? AND date >= ? ORDER BY id')
    .all(userId, sinceDate);
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

/* ---- Megjegyzések ----
   A hozzáférést NEM ez a modul dönti el — az a server.js kapuja. Itt csak az
   olvasás és az írás van. */

/** Egy DB-sor → a felület által várt alak. A szerző nevét is hozzuk, hogy a
    lista egyetlen lekérésből kirajzolható legyen. */
const toComment = (row) => ({
  id: row.id,
  authorId: row.author_id,
  authorName: row.author_name,
  targetId: row.target_id,
  text: row.text,
  // ISO-ra alakítva, mint az üzeneteknél: a relatív időt a KLIENS képzi, ő
  // ismeri a felhasználó időzónáját.
  at: toIso(row.created_at),
});

const COMMENT_SELECT = `
  SELECT c.id, c.author_id, c.target_id, c.text, c.created_at,
         u.display_name AS author_name
  FROM comments c JOIN users u ON u.id = c.author_id`;

/** Egy cél megjegyzései, időrendben (a legrégebbi elöl — így olvasható). */
export function getComments(subjectId, targetType, targetId) {
  return db.prepare(`${COMMENT_SELECT}
    WHERE c.subject_id = ? AND c.target_type = ? AND c.target_id = ?
    ORDER BY c.id ASC`).all(subjectId, targetType, String(targetId)).map(toComment);
}

/** Egy típus ÖSSZES megjegyzése célonként csoportosítva. Az összegző oldal így
    egyetlen kérésből tudja, melyik gyakorlathoz tartozik megjegyzés. */
export function getCommentsByTarget(subjectId, targetType) {
  const rows = db.prepare(`${COMMENT_SELECT}
    WHERE c.subject_id = ? AND c.target_type = ?
    ORDER BY c.id ASC`).all(subjectId, targetType).map(toComment);
  const grouped = {};
  for (const row of rows) (grouped[row.targetId] ??= []).push(row);
  return grouped;
}

/** Új megjegyzés. Visszaadja a mentett sort (a szerző nevével együtt). */
export function addComment(authorId, subjectId, targetType, targetId, text) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO comments (author_id, subject_id, target_type, target_id, text)
    VALUES (?, ?, ?, ?, ?)`).run(authorId, subjectId, targetType, String(targetId ?? ''), text);
  return toComment(db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(lastInsertRowid));
}

/** Megjegyzés törlése. CSAK a szerző törölhet, ezért az author_id is feltétel —
    így egy idegen id-vel küldött kérés nem talál sort, és 404-et kap. */
export function deleteComment(commentId, authorId) {
  return db.prepare('DELETE FROM comments WHERE id = ? AND author_id = ?')
    .run(commentId, authorId).changes > 0;
}

/* ---- Napi táplálkozási cél ----
   Az érvényes cél: 'own' → 'coach' → seed alapérték. A két sor egymás mellett
   marad, hogy az eltérés LÁTSZÓDJON. */

/** Egy cél-sor a felület alakjában (a szerző nevével együtt). */
const toGoalRow = (row) => (row ? {
  calories: row.calories,
  protein: row.protein,
  setBy: row.set_by_name ?? null,
  setAt: row.updated_at,
} : null);

const GOAL_SELECT = `
  SELECT g.calories, g.protein, g.updated_at, u.display_name AS set_by_name
  FROM nutrition_goals g LEFT JOIN users u ON u.id = g.set_by`;

/** Egy fiók cél-sora forrás szerint ('own' vagy 'coach'), vagy null. */
export function getNutritionGoalRow(userId, source) {
  return toGoalRow(db.prepare(`${GOAL_SELECT} WHERE g.user_id = ? AND g.source = ?`)
    .get(userId, source));
}

/** A felhasználóra ÉRVÉNYES cél, a származásával együtt. A felület ebből
    tudja kiírni, honnan jön a szám, és hogy eltért-e az edzőitől. */
export function getNutritionGoal(userId) {
  const own = getNutritionGoalRow(userId, 'own');
  const coach = getNutritionGoalRow(userId, 'coach');
  const fallback = getCollection('nutritionGoal') || { calories: 0, protein: 0 };

  const active = own ?? coach ?? { ...fallback, setBy: null, setAt: null };
  const source = own ? 'own' : (coach ? 'coach' : 'default');

  return {
    calories: active.calories,
    protein: active.protein,
    source,
    setBy: active.setBy,
    setAt: active.setAt,
    coach,
    /* Eltérés CSAK akkor, ha mindkettő létezik és tényleg más. Enélkül a
       felület akkor is „eltértél"-t írna, ha a saját célod történetesen
       megegyezik az edzőével. */
    differs: Boolean(own && coach
      && (own.calories !== coach.calories || own.protein !== coach.protein)),
  };
}

/** Cél mentése/felülírása egy forrásra. A `setBy` az, AKI beállította — az
    edzői sornál az edző, a sajátnál a felhasználó maga. */
export function saveNutritionGoal(userId, source, { calories, protein }, setBy) {
  db.prepare(`
    INSERT INTO nutrition_goals (user_id, source, calories, protein, set_by, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, source) DO UPDATE SET
      calories = excluded.calories, protein = excluded.protein,
      set_by = excluded.set_by, updated_at = excluded.updated_at
  `).run(userId, source, calories, protein, setBy);
  return getNutritionGoal(userId);
}

/** A SAJÁT cél törlése — ezzel a felhasználó visszaáll az edzői célra (vagy
    az alapértékre). Az edzői sort ez nem bántja. */
export function clearOwnNutritionGoal(userId) {
  db.prepare("DELETE FROM nutrition_goals WHERE user_id = ? AND source = 'own'").run(userId);
  return getNutritionGoal(userId);
}

/** A napi táplálkozási összesítő egy adott napra: az AZNAP naplózott ételek
    összege, valamint az érvényes napi cél (a felület a célhoz méri a
    bevitelt). */

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
  return { ...sum, goal: getNutritionGoal(userId) };
}

/* ======================================================================
   Saját ételek — a felhasználó által felvitt, illetve vonalkódról beolvasott
   termékek. A beépített katalógussal AZONOS alakot adnak vissza (100 g-ra
   vonatkozó makrók), csak a `custom: true` jelző különbözteti meg őket — így
   a naplózás, az adagválasztó és az étel-kártya változtatás nélkül működik.
   ====================================================================== */

/** Egy custom_foods sor → a felület (és a naplózás) által várt étel-alak.
    A `per` címkét ugyanúgy képezzük, mint a catalog.js a seed-ételeknél —
    enélkül az étel-kártya „undefined"-ot írna ki. */
const toCustomFood = (row) => (row ? {
  id: row.id,
  name: row.name,
  brand: row.brand || undefined,
  // A csoport nélküli saját ételek is kapjanak besorolást: a felület a
  // group mezőt írja ki a kártyára, és keresni is lehet rá.
  group: row.food_group || 'Saját étel',
  unit: row.unit,
  per: `100 ${row.unit}`,
  kcal: row.kcal,
  protein: row.protein,
  carbs: row.carbs,
  fat: row.fat,
  kcalAuto: row.kcal_auto === 1,
  portions: JSON.parse(row.portions || '[]'),
  barcode: row.barcode || undefined,
  source: row.source,
  custom: true,
} : null);

const CUSTOM_FOOD_COLS = `id, name, brand, food_group, unit, kcal, protein, carbs, fat,
                          kcal_auto, barcode, portions, source`;

/** A hívó saját ételei, felvitel sorrendjében. */
export function listCustomFoods(userId) {
  return db.prepare(`SELECT ${CUSTOM_FOOD_COLS} FROM custom_foods WHERE user_id = ? ORDER BY id`)
    .all(userId).map(toCustomFood);
}

/** Saját étel név szerint (kis/nagybetű-érzéketlen — a name COLLATE NOCASE). */
export function getCustomFoodByName(userId, name) {
  return toCustomFood(db.prepare(`SELECT ${CUSTOM_FOOD_COLS} FROM custom_foods
                                  WHERE user_id = ? AND name = ?`).get(userId, name));
}

/** Saját étel vonalkód szerint — a beolvasás ezzel zárható rövidre (ha a
    terméket már felvitte, nincs se hálózati kör, se újabb kitöltés). */
export function getCustomFoodByBarcode(userId, barcode) {
  return toCustomFood(db.prepare(`SELECT ${CUSTOM_FOOD_COLS} FROM custom_foods
                                  WHERE user_id = ? AND barcode = ?`).get(userId, barcode));
}

/** Névütközés a hívó saját ételei közt, ÉKEZETEKKEL EGYÜTT.
    A tábla COLLATE NOCASE-e csak ASCII-t hajt: SQL szinten a „Túró Rudi" és a
    „TÚRÓ RUDI" két külön sor lenne, a felhasználó viszont joggal ugyanannak az
    ételnek látja őket. A JS toLowerCase() Unicode-ot is kezel, és a saját lista
    néhány tucat elem — bőven megéri végigolvasni. */
const customNameTaken = (userId, name) => {
  const needle = String(name).toLowerCase();
  return listCustomFoods(userId).some((food) => food.name.toLowerCase() === needle);
};

/** Saját étel felvitele. A validálást a végpont végzi; ide már tiszta, 100 g-ra
    normalizált adat érkezik. Ütközésnél (azonos név vagy vonalkód ugyanannál a
    fióknál) null-t ad — a hívó ebből 409-et képez. */
export function addCustomFood(userId, food) {
  if (customNameTaken(userId, food.name)) return null;
  if (food.barcode && getCustomFoodByBarcode(userId, food.barcode)) return null;

  const { lastInsertRowid } = db.prepare(
    `INSERT INTO custom_foods (user_id, name, brand, food_group, unit, kcal,
                               protein, carbs, fat, kcal_auto, barcode, portions, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId, food.name, food.brand ?? '', food.group ?? '', food.unit,
    food.kcal, food.protein, food.carbs, food.fat, food.kcalAuto ? 1 : 0,
    food.barcode ?? null, JSON.stringify(food.portions ?? []), food.source ?? 'manual',
  );
  return toCustomFood(db.prepare(`SELECT ${CUSTOM_FOOD_COLS} FROM custom_foods WHERE id = ?`)
    .get(Number(lastInsertRowid)));
}

/** Saját étel törlése. Ismeretlen id-re vagy MÁS felhasználó ételére false —
    a hívó ebből 404-et képez. A már lenaplózott bejegyzések NEM sérülnek: a
    nutrition_log a nevet és a kiszámolt makrókat MÁSOLATBAN tárolja, tehát a
    korábbi napok összesítői változatlanok maradnak. */
export function deleteCustomFood(userId, id) {
  return db.prepare('DELETE FROM custom_foods WHERE id = ? AND user_id = ?')
    .run(id, userId).changes > 0;
}

/** A hívónak megjelenítendő teljes étel-lista: elöl a sajátjai (azokat keresi
    a leggyakrabban), utána a beépített katalógus.
    FONTOS: a getCollection('foods') tömbje MEGOSZTOTT és cache-elt — ezért ÚJ
    tömböt képzünk a spreaddel, belepush-olni tilos lenne. */
export function getFoodsForUser(userId) {
  return [...listCustomFoods(userId), ...(getCollection('foods') || [])];
}

/** Naplózható étel keresése név szerint. A SAJÁT étel nyer: a beépített
    katalógus később bővülhet egy olyan névvel, amit a felhasználó már felvitt
    — ilyenkor is az ő tápértékei az érvényesek. */
export function findFoodForUser(userId, name) {
  return getCustomFoodByName(userId, name)
    || (getCollection('foods') || []).find((f) => f.name === name)
    || null;
}

/* ---- Vonalkód-gyorsítótár ---- */

/** Friss cache-sor vagy null. A frissesség HATÁRA a találattól függ: egy
    megtalált termék tápértéke ritkán változik (30 nap), a „nem ismerjük"
    viszont holnap már lehet más (1 nap — az OFF közösségi adatbázis, naponta
    ezrével kerülnek bele termékek).
    A CASE-t szándékosan SQL-ben számoljuk: a SQLite dátumformátuma
    („ÉÉÉÉ-HH-NN óó:pp:mm") JS-ben nem szabványosan parse-olható. */
export function readBarcodeCache(barcode) {
  const row = db.prepare(`
    SELECT found, payload FROM barcode_cache
    WHERE barcode = ?
      AND fetched_at > datetime('now', CASE found WHEN 1 THEN '-30 days' ELSE '-1 day' END)
  `).get(barcode);
  if (!row) return null;
  return { found: row.found === 1, product: row.found === 1 ? JSON.parse(row.payload) : null };
}

/** Cache-írás. A `product === null` a negatív találatot rögzíti. */
export function writeBarcodeCache(barcode, product) {
  db.prepare(`INSERT INTO barcode_cache (barcode, found, payload, fetched_at)
              VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(barcode) DO UPDATE SET
                found = excluded.found, payload = excluded.payload,
                fetched_at = excluded.fetched_at`)
    .run(barcode, product ? 1 : 0, JSON.stringify(product ?? {}));
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

/** Volt-e ennek a fióknak VALAHA check-inje. A felület ebből tudja, hogy a
    friss fiókot a check-in varázslóra kell terelnie: a regisztráció ténye
    csak pillanatnyi kliens-állapot, ez viszont túléli az oldal-újratöltést. */
export function hasAnyCheckin(userId) {
  return Boolean(db.prepare('SELECT 1 FROM checkins WHERE user_id = ? LIMIT 1').get(userId));
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
  const row = db.prepare(`SELECT max_1rm, date, source FROM exercise_maxes
                          WHERE user_id = ? AND exercise_name = ?`)
    .get(userId, exerciseName);
  // A `source` megmondja, mire épül a szám: naplózott szett vagy bemondás.
  return row ? { max1rm: row.max_1rm, date: row.date, source: row.source } : null;
}

/** A felhasználó összes nyomon követett maximális 1RM-je. */
export function getAllExerciseMaxes(userId) {
  return db.prepare('SELECT exercise_name, max_1rm, date FROM exercise_maxes WHERE user_id = ? ORDER BY date DESC')
    .all(userId);
}

/**
 * A `sinceDate` óta született egyéni csúcsok, legfrissebb elöl — az
 * értesítés-panel ebből építi az „új PR" sorokat.
 *
 * Két időpont van a soron, és mindkettőre szükség van: a `date` a csúcsot hozó
 * EDZÉS napja (erre szűrünk), az `updated_at` pedig az, amikor a rekord
 * ténylegesen megszületett (ez rendez, és ez az értesítés időbélyege). A kettő
 * a PR-követés előtti edzésekből visszatöltött soroknál tér el egymástól: ott
 * a dátum régi, a bejegyzés viszont friss — a dátumra szűrés így pont azt éri
 * el, hogy egy migráció ne zúdítson be tucatnyi „új csúcs" értesítést.
 *
 * A dátum "ÉÉÉÉ.HH.NN" alakú, tehát a szöveges összehasonlítás egyben
 * időrendi is (nullákkal feltöltött, évvel kezdődő mezők).
 */
export function getRecentExerciseMaxes(userId, sinceDate, limit = 5) {
  return db.prepare(`
    SELECT exercise_name, max_1rm, date, updated_at FROM exercise_maxes
    WHERE user_id = ? AND date >= ?
    ORDER BY updated_at DESC, date DESC LIMIT ?
  `).all(userId, sinceDate, limit).map((row) => ({
    exercise: row.exercise_name,
    max1rm: row.max_1rm,
    date: row.date,
    at: toIso(row.updated_at),
  }));
}

/** Egy gyakorlat maximum 1RM-jének frissítése, ha az új érték nagyobb.
    Visszaadja az objektumot { max1rm, date, isPr } formában (isPr = true ha PR-t ütöttünk). */
/**
 * Az erőfelmérésen BEMONDOTT csúcs rögzítése.
 *
 * A bemondott szám nem mérés, ezért két dolgot NEM tesz:
 *   · nem ír felül MÉRT csúcsot — a naplózott szett erősebb bizonyíték, és
 *     egy alacsonyabb bemondás nem tüntetheti el a valódi rekordot;
 *   · nem hoz létre PR-bejegyzést: a PR-lista a naplózott edzésekből épül
 *     (/api/prs), ide csak a viszonyítási alap kerül. Egy KÉSŐBBI emelésnek
 *     viszont meg kell haladnia — a felmérés így valódi kiindulópont.
 *
 * Visszaadja, hogy tényleg beírtuk-e.
 */
export function setDeclaredMax(userId, exerciseName, max1rm, date) {
  const existing = getExerciseMax(userId, exerciseName);
  if (existing && existing.source === 'measured') return { stored: false, max1rm: existing.max1rm };

  db.prepare(`
    INSERT INTO exercise_maxes (user_id, exercise_name, max_1rm, date, source, updated_at)
    VALUES (?, ?, ?, ?, 'declared', datetime('now'))
    ON CONFLICT(user_id, exercise_name) DO UPDATE SET
      max_1rm = excluded.max_1rm, date = excluded.date,
      source = 'declared', updated_at = excluded.updated_at
  `).run(userId, exerciseName, max1rm, date);
  return { stored: true, max1rm };
}

/** A BEMONDOTT csúcsok. A készenlét-motor ezekből tudja, hogy a felhasználó
    egy gyakorlatot ismer és nagyjából milyen szinten — akkor is, ha még
    egyetlen edzést sem naplózott ide. */
export function getDeclaredMaxes(userId) {
  return db.prepare(`SELECT exercise_name, max_1rm, date FROM exercise_maxes
                     WHERE user_id = ? AND source = 'declared'`)
    .all(userId)
    .map((row) => ({ name: row.exercise_name, max1rm: row.max_1rm, date: row.date }));
}

export function updateExerciseMax(userId, exerciseName, new1rm, currentDate) {
  const existing = getExerciseMax(userId, exerciseName);
  const isPr = !existing || new1rm > existing.max1rm;

  if (isPr) {
    db.prepare(`
      INSERT INTO exercise_maxes (user_id, exercise_name, max_1rm, date, source, updated_at)
      VALUES (?, ?, ?, ?, 'measured', datetime('now'))
      ON CONFLICT(user_id, exercise_name) DO UPDATE SET
        max_1rm = excluded.max_1rm,
        date = excluded.date,
        -- A naplózott szett FELÜLÍRJA a bemondott alapot: a mérés erősebb bizonyíték.
        source = 'measured',
        updated_at = excluded.updated_at
    `).run(userId, exerciseName, new1rm, currentDate);
  }

  return { max1rm: isPr ? new1rm : existing.max1rm, date: isPr ? currentDate : existing.date, isPr };
}

/**
 * Egy felhasználó egyéni csúcsainak ÉS a mentett edzésekben tárolt `pr`
 * jelzőknek a TELJES újraépítése a naplóból.
 *
 * Miért kell egyáltalán: az updateExerciseMax csak FELFELÉ lép. Amíg csak
 * hozzáadni lehetett a naplóhoz, ez pontosan jó volt — mióta törölni és
 * javítani is, azóta viszont a csúcs bent ragadna a megszűnt teljesítményen:
 * elzárná a jövőbeli VALÓDI PR-t, és olyan rekordot mutatna, ami mögött nincs
 * edzés.
 *
 * MIÉRT KELL A `pr` JELZŐKET IS ÚJRAÍRNI: a /api/prs és a /api/prs/history nem
 * ebből a táblából olvas, hanem a workouts sorokban tárolt jelzőkből. Ha a
 * törölt edzés vitte a rekordot, akkor a nála gyengébb, KÉSŐBBI edzés lesz az
 * új csúcs — de a jelzője false maradna, és a PR-lista üresen állna egy olyan
 * gyakorlatra, aminek közben van értéke az exercise_maxes-ben. A két tárolás
 * csak együtt igaz.
 *
 * Három részlet, ami nem magától értetődő:
 *   · A rendezés `date, id` — nem `id`. Amíg a napló csak bővült, a kettő
 *     ugyanaz volt; a helyben javítás óta nem: egy javított RÉGI edzés a
 *     beszúrási sorrendben későbbinek látszana, és elvinné a rekordot egy
 *     nála frissebb edzés elől.
 *   · A rekord `date`-je a FORRÁS-EDZÉS napja marad, sosem a mai. A
 *     getRecentExerciseMaxes dátumra szűr, tehát különben egy törlés után az
 *     értesítés-panel a fél napló csúcsait „friss egyéni csúcs"-ként zúdítaná be.
 *   · A szabály a szerveré: PR az a gyakorlat, amelyik a futó maximumot
 *     megemelte. A kliens szerkesztés közbeni, előre kitett jelzője (addWorkout
 *     → `isPr || exercise.pr`) utólag nem reprodukálható, és nem is kell:
 *     amit a lista kiír, annak a naplóból következnie kell.
 */
export function recomputeExerciseMaxes(userId) {
  const rows = db.prepare('SELECT id, date, exercises FROM workouts WHERE user_id = ? ORDER BY date, id')
    .all(userId);

  const best = new Map();      // gyakorlatnév → { max1rm, date }
  const rewrites = [];         // [{ id, exercises }] — csak a ténylegesen változó sorok

  for (const row of rows) {
    let exercises;
    try { exercises = JSON.parse(row.exercises); } catch { continue; }
    if (!Array.isArray(exercises)) continue;

    let changed = false;
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
      const isPr = !current || oneRM > current.max1rm;
      if (isPr) best.set(name, { max1rm: oneRM, date: row.date });

      // A hiányzó és a false jelző ugyanaz — a régi sorokon nincs is `pr` mező
      if (Boolean(exercise.pr) !== isPr) {
        exercise.pr = isPr;
        changed = true;
      }
    }
    if (changed) rewrites.push({ id: row.id, exercises });
  }

  const clear = db.prepare('DELETE FROM exercise_maxes WHERE user_id = ?');
  const insert = db.prepare(`INSERT INTO exercise_maxes (user_id, exercise_name, max_1rm, date)
                             VALUES (?, ?, ?, ?)`);
  const rewrite = db.prepare('UPDATE workouts SET exercises = ? WHERE id = ?');

  clear.run(userId);
  for (const [name, record] of best) insert.run(userId, name, record.max1rm, record.date);
  for (const row of rewrites) rewrite.run(JSON.stringify(row.exercises), row.id);
}

/** A tervek ÜTEMEZÉSE, legújabb elöl — gyakorlat-lista nélkül.
    Az edzői kártyának pontosan ennyi kell (a terv-követés a hétnapokból
    számol, a kártyán a terv NEVE látszik), a gyakorlatok JSON-ja viszont a
    terv legnagyobb része. Sportolónként, minden panel-frissítésnél. */
export function getUserPlanSchedules(userId) {
  return db.prepare('SELECT id, name, days FROM plans WHERE user_id = ? ORDER BY id DESC')
    .all(userId)
    .map((row) => ({ id: row.id, name: row.name, days: JSON.parse(row.days) }));
}

/** EGY terv a felhasználó sajátjai közül, vagy null. A userId nem díszítés:
    ez akadályozza meg, hogy más tervére lehessen hivatkozni az azonosítóval. */
export function getPlan(userId, id) {
  const row = db.prepare('SELECT id, name, date, exercises, days FROM plans WHERE user_id = ? AND id = ?')
    .get(userId, id);
  return row ? {
    id: row.id, name: row.name, date: row.date,
    exercises: JSON.parse(row.exercises), days: JSON.parse(row.days),
  } : null;
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
  const row = db.prepare('SELECT name, exercises, date, plan_id, workout_id FROM workout_draft WHERE user_id = ?')
    .get(userId);
  return row
    ? {
      name: row.name, exercises: JSON.parse(row.exercises), date: row.date,
      planId: row.plan_id, workoutId: row.workout_id,
    }
    : null;
}

/** Egy edzés-sor → a hívók által várt alak (a gyakorlatok JSON-ból vissza). */
const toWorkout = (row) => ({
  id: row.id, name: row.name, date: row.date,
  exercises: JSON.parse(row.exercises), planId: row.plan_id,
  /* A visszajelzés csak akkor kerül bele, ha tényleg érkezett — üres objektum
     helyett `null`, hogy a „nem küldött" eset egyértelmű maradjon. */
  feedback: row.feedback_at ? {
    difficulty: row.feedback_difficulty,
    mood: row.feedback_mood,
    note: row.feedback_note,
    at: row.feedback_at,
  } : null,
});

/** A mentett edzések, legújabb elöl (a gyakorlatok JSON-ból visszafejtve). */
export function getWorkouts(userId) {
  return db.prepare(`SELECT id, name, date, exercises, plan_id,
          feedback_difficulty, feedback_mood, feedback_note, feedback_at FROM workouts WHERE user_id = ? ORDER BY id DESC`)
    .all(userId).map(toWorkout);
}

/**
 * A `sinceDate` óta mentett edzések, legújabb elöl.
 *
 * Miért van külön a teljes lekérdezéstől: az edzések ára szinte teljes
 * egészében a gyakorlat-lista JSON.parse-a, és a készenlét-motor amúgy is
 * eldob mindent, ami CHRONIC_WINDOW_DAYS-nél (28 nap) régebbi
 * (recovery.js -> summarizeWorkouts). Egy éves naplónál ez ~183 sor helyett
 * ~12-t jelent — az edzői panelen SPORTOLÓNKÉNT.
 *
 * A dátum "ÉÉÉÉ.HH.NN" alakú, tehát a szöveges összehasonlítás időrendi is.
 */
export function getWorkoutsSince(userId, sinceDate) {
  return db.prepare(`
    SELECT id, name, date, exercises, plan_id,
           feedback_difficulty, feedback_mood, feedback_note, feedback_at
    FROM workouts
    WHERE user_id = ? AND date >= ? ORDER BY id DESC
  `).all(userId, sinceDate).map(toWorkout);
}

/**
 * Azok a NAPOK, amikor volt edzés — legújabb elöl, ismétlés nélkül.
 *
 * Ez a teljes előzményt nézi, de nem olvas gyakorlat-listát, tehát olcsó
 * (3 éves naplónál is pár száz rövid sztring). Két dologhoz kell, amit a
 * 28 napos ablak elrontana: a SOROZAT hossza tetszőlegesen régre nyúlhat,
 * és az „utolsó edzés" akkor is létezik, ha épp két hónapja volt — az
 * edzői kártya különben „még nincs naplózott edzés"-t írna ki egy olyan
 * sportolóra, aki csak régen edzett utoljára.
 */
export function getWorkoutDates(userId) {
  return db.prepare('SELECT DISTINCT date FROM workouts WHERE user_id = ? ORDER BY date DESC')
    .all(userId).map((row) => row.date);
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
  // A saját ételek is a felhasználó adata — a naplóból nem rekonstruálhatók
  // (a nutrition_log az adagra átszámolt makrókat tárolja, nem a 100 g-osakat).
  snapshot.customFoods = listCustomFoods(userId);
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
export function saveWorkoutDraft(userId, name, exercises, date, planId = null, workoutId = null) {
  db.prepare(`INSERT INTO workout_draft (user_id, name, exercises, date, plan_id, workout_id, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET
                name = excluded.name, exercises = excluded.exercises,
                date = excluded.date, plan_id = excluded.plan_id,
                workout_id = excluded.workout_id,
                updated_at = excluded.updated_at`)
    .run(userId, name, JSON.stringify(exercises), date, planId, workoutId);
  return { name, exercises, planId, workoutId };
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
  // A friss edzésen még nincs visszajelzés — a mező alakja mégis azonos a
  // getWorkouts sorával, hogy a felületnek ne kelljen két esetre készülnie.
  return { id: Number(lastInsertRowid), name, date, exercises: processedExercises, planId, feedback: null };
}

/**
 * Mentett edzés törlése. Csak a SAJÁT sorát törli — idegen id-re false jön,
 * ugyanaz a minta, mint az updatePlan null-ja.
 *
 * A törlés után a csúcsok újraépülnek: enélkül a megszűnt edzés rekordja bent
 * ragadna, és elzárná a jövőbeli valódi PR-t (ld. recomputeExerciseMaxes).
 * A kettő EGY tranzakcióban megy — félúton megszakadva a napló és a csúcsok
 * ellentmondanának egymásnak.
 */
export function deleteWorkout(userId, id) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { changes } = db.prepare('DELETE FROM workouts WHERE id = ? AND user_id = ?').run(id, userId);
    if (changes > 0) {
      /* Ha épp ez az edzés volt visszanyitva a szerkesztőbe, a piszkozat egy
         megszűnt sorra hivatkozna, és a befejezés 404-be futna. A tartalmát
         nem dobjuk el (azt a felhasználó írta) — csak elengedjük a
         hivatkozást, így új edzésként menthető. */
      db.prepare('UPDATE workout_draft SET workout_id = NULL WHERE user_id = ? AND workout_id = ?')
        .run(userId, id);
      recomputeExerciseMaxes(userId);
    }
    db.exec('COMMIT');
    return changes > 0;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Mentett edzés felülírása (név + gyakorlatok). A DÁTUMA és a plan_id-je
 * MARAD: a javítás nem helyezi át az edzést a mai napra — különben elcsúszna
 * a sorozat, a heti volumen és a készenlét 28 napos ablaka.
 *
 * A frissített sort adja vissza, vagy null-t, ha nincs ilyen id — MÁS
 * felhasználó edzését sem lehet átírni. A sort a csúcsok újraszámolása UTÁN
 * olvassuk vissza, tehát a válasz már a friss `pr` jelzőket viszi.
 */
/** Egy edzés a saját naplóból, vagy null. A user_id feltétel nem elhagyható:
    enélkül idegen edzés id-jével is lehetne dolgozni. */
/** Az edző sportolóinak friss edzés-visszajelzései (a `sinceDate` óta).
    Ez az edzői oldal egyik értesítés-forrása: hogy a sportoló hogyan ÉLTE MEG
    az edzést, a naplóból nem számolható ki — csak tőle tudható meg.
    Csak ÉLŐ kapcsolat számít, ugyanúgy, mint mindenhol máshol. */
export function getAthleteFeedbackSince(coachId, sinceDate) {
  return db.prepare(`
    SELECT w.id, w.name, w.feedback_difficulty, w.feedback_at,
           u.display_name AS athlete_name
    FROM workouts w
    JOIN coach_links cl ON cl.athlete_id = w.user_id AND cl.status = 'active'
    JOIN users u ON u.id = w.user_id
    WHERE cl.coach_id = ? AND w.feedback_at IS NOT NULL AND w.date >= ?
    ORDER BY w.feedback_at DESC
  `).all(coachId, sinceDate).map((row) => ({
    id: row.id,
    workout: row.name,
    athlete: row.athlete_name,
    difficulty: row.feedback_difficulty,
    at: row.feedback_at,
  }));
}

export function getWorkout(userId, workoutId) {
  const row = db.prepare(`SELECT id, name, date, exercises, plan_id,
          feedback_difficulty, feedback_mood, feedback_note, feedback_at FROM workouts WHERE id = ? AND user_id = ?`)
    .get(workoutId, userId);
  return row ? toWorkout(row) : null;
}

/** Az edzés utáni visszajelzés mentése/felülírása. CSAK a saját edzésére —
    az UPDATE a user_id-re is szűr, tehát idegen sorra nem talál semmit.
    Visszaadja a frissített edzést, vagy null-t, ha nem volt ilyen sor. */
export function saveWorkoutFeedback(userId, workoutId, { difficulty, mood, note }) {
  const changed = db.prepare(`
    UPDATE workouts
       SET feedback_difficulty = ?, feedback_mood = ?, feedback_note = ?,
           feedback_at = datetime('now')
     WHERE id = ? AND user_id = ?`)
    .run(difficulty ?? null, mood ?? null, note ?? null, workoutId, userId).changes;
  return changed ? getWorkout(userId, workoutId) : null;
}

export function updateWorkout(userId, id, name, exercises) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const { changes } = db.prepare('UPDATE workouts SET name = ?, exercises = ? WHERE id = ? AND user_id = ?')
      .run(name, JSON.stringify(exercises), id, userId);
    if (changes === 0) {
      db.exec('COMMIT');
      return null;
    }
    recomputeExerciseMaxes(userId);
    const row = db.prepare('SELECT id, name, date, exercises, plan_id FROM workouts WHERE id = ?').get(id);
    db.exec('COMMIT');
    return toWorkout(row);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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
