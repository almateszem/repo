/**
 * Podium — adatréteg: a séma, az indexek és a referencia-kollekciók
 * ------------------------------------------------------------------------
 * A CREATE TABLE-ek (a teljes, végleges alak), az indexek és a data.js-ből
 * szinkronizált kollekciók. Mindegyiket az index.js hívja induláskor.
 */
import { data as seed } from '../data.js';
import path from 'node:path';
import { buildExerciseCatalog, buildFoodCatalog } from '../data/catalog.js';
import { DB_PATH, db, dbExisted } from './connection.js';

/* ---- Séma ----
   Új adatbázison ez a teljes, végleges alak: minden oszlop itt születik. A
   többfelhasználós, de régebbi fájlokon a később bevezetett oszlopokat a
   migrations.js ensureColumns-lépése pótolja, azonos DDL-lel; a felhasználó
   nélküli fájlokat a baseline-őr (migrations.js) elutasítja. */
export function createSchema() {
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
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      sex           TEXT,            -- 'male' | 'female' | NULL (erőszint-érme)
      birth_year    INTEGER          -- születési év (erőszint életkori korrekció), lehet NULL
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- az étel 100 g-ra vonatkozó, kerekítetlen tápértéke a naplózáskor (régi sorokon NULL)
      base_kcal    REAL,
      base_protein REAL,
      base_carbs   REAL,
      base_fat     REAL
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

    -- Testösszetétel: körfogatok és testzsír. A weight_log egyetlen számot tárol,
    -- de a puszta kilogramm nem mondja meg, MI épült és mi fogyott — egy versenyző
    -- a mellette futó körfogatot követi.
    --
    -- Naponta és mérési helyenként EGY sor (UNIQUE): az aznapi újramérés felülír,
    -- nem duplikál — ugyanaz az elv, mint a weight_log-nál. A site értékkészletét
    -- a szerver zárja (MEASUREMENT_SITES), hogy a trend ne essen szét elgépelt
    -- kulcsokra.
    CREATE TABLE IF NOT EXISTS body_measurements (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date    TEXT NOT NULL,        -- "ÉÉÉÉ.HH.NN"
      site    TEXT NOT NULL,        -- 'chest' | 'arm' | … | 'bodyfat'
      value   REAL NOT NULL,        -- cm, a 'bodyfat'-nál százalék
      UNIQUE (user_id, date, site)
    );
    CREATE INDEX IF NOT EXISTS idx_measurements_user
      ON body_measurements(user_id, site, date);

    -- Víznapló: KORTYONKÉNT egy sor, időbélyeggel. A napi folyadék EGYETLEN
    -- forrása: a check-in a hydration-t innen olvassa (CHECKIN_COLUMNS), az
    -- űrlapon megadott liter is ide íródik. A folyadékbevitel a Recovery Engine
    -- bemenete (nutritionScore, 0.2 súly) — két külön szám két külön
    -- készenlétet adna, attól függően, melyik felületen írta be a felhasználó.
    CREATE TABLE IF NOT EXISTS water_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date      TEXT NOT NULL,        -- "ÉÉÉÉ.HH.NN"
      ml        INTEGER NOT NULL,     -- milliliter; a liter csak megjelenítés
      logged_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_water_user_date
      ON water_log(user_id, date);

    CREATE TABLE IF NOT EXISTS nutrition_goals (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source     TEXT NOT NULL,        -- 'own' | 'coach'
      calories   REAL NOT NULL,
      protein    REAL NOT NULL,
      set_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- ki állította be
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, source)
    );

    -- Az edző által összeállított étrend: étkezések („Reggeli"), bennük ételek
    -- grammal. A user_id a SPORTOLÓ, a set_by az edző.
    --
    -- A tételek a 100 g-os makrókat MÁSOLATBAN tárolják (mint a nutrition_log
    -- base_* oszlopai): az edző saját ételei a sportoló fiókjából nem
    -- láthatók, és egy később törölt étel sem ronthatja el az étrendet.
    CREATE TABLE IF NOT EXISTS coach_meals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      set_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name       TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      -- JSON: [{ name, grams, base_kcal, base_protein, base_carbs, base_fat }]
      items      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_coach_meals_user
      ON coach_meals(user_id, position, id);
    -- Melyik étkezést melyik NAPON ette meg a sportoló. Naponta egyszer
    -- naplózható (PRIMARY KEY): a „Megettem" után az étkezés aznapra eltűnik
    -- a listájából, másnap újra ott van — az étrend napi terv.
    CREATE TABLE IF NOT EXISTS coach_meal_logs (
      meal_id   INTEGER NOT NULL REFERENCES coach_meals(id) ON DELETE CASCADE,
      date      TEXT NOT NULL,        -- "ÉÉÉÉ.HH.NN"
      logged_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (meal_id, date)
    );

    -- Az edző által kitűzött napi víz-cél (ml). Nélküle a cél a testsúlyból
    -- számolódik (~33 ml/kg, recovery.js → hydrationTarget). Ugyanaz a szabály,
    -- mint a nutrition_goals edzői soránál: csak a MOSTANI edzőé számít, és
    -- a sportoló nem módosíthatja.
    CREATE TABLE IF NOT EXISTS water_goals (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ml         INTEGER NOT NULL,
      set_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- edzés utáni visszajelzés (mind NULL-ozható: „nem küldött" ≠ „rosszat jelzett")
      feedback_difficulty INTEGER,
      feedback_mood       INTEGER,
      feedback_note       TEXT,
      feedback_at         TEXT,
      pr_rule    INTEGER NOT NULL DEFAULT 0  -- 0 = pipák előtti napló, 1 = csak a pipált szett számít
    );
    CREATE TABLE IF NOT EXISTS plans (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      date       TEXT NOT NULL,
      exercises  TEXT NOT NULL,          -- JSON, a workouts.exercises-szel azonos alak
      days       TEXT NOT NULL DEFAULT '[]',  -- JSON: hétnap-indexek (0 = hétfő), amikor a terv az Edzés oldalra töltődik
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      assignment_id INTEGER,             -- melyik edzői kiosztásból született (NULL = saját terv)
      week       TEXT,                   -- JSON: a heti bontás (plan-week.js)
      active     INTEGER NOT NULL DEFAULT 0,  -- felhasználónként egy aktív terv
      active_since TEXT                  -- az aktiválás napja, a ciklus horgonya
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
      hydration     REAL,                -- régi; a folyadék a water_log-ból jön
      soreness      TEXT NOT NULL DEFAULT '{}',  -- JSON: { chest: 0..10, … } izomcsoportonként
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
      responded_at TEXT,
      week         TEXT                            -- JSON: a heti bontás (plan-week.js)
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
      declared_1rm  REAL,                -- az erőfelmérésen BEMONDOTT csúcs (vagy NULL)
      declared_date TEXT,                -- a bemondás napja
      source        TEXT NOT NULL DEFAULT 'measured',  -- a csúcs forrása: 'measured' | 'declared'
      PRIMARY KEY (user_id, exercise_name)
    );
  `);
}

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
export function createIndexes() {
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
}

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
export function seedCollections() {
  const collections = {
    ...seed,
    exerciseCatalog: buildExerciseCatalog(),
    foods: buildFoodCatalog(),
  };

  const insertCollection = db.prepare(
    'INSERT OR REPLACE INTO collections (key, value) VALUES (?, ?)',
  );
  for (const [key, value] of Object.entries(collections)) {
    insertCollection.run(key, JSON.stringify(value));
  }
  // Az időközben eltávolított kulcsok a meglévő DB-kből is tűnjenek el.
  const seedKeys = Object.keys(collections);
  db.prepare(
    `DELETE FROM collections WHERE key NOT IN (${seedKeys.map(() => '?').join(', ')})`,
  ).run(...seedKeys);
  // eslint-disable-next-line no-console -- indulási kiírás: a feloldott DB-útvonal
  console.log(
    'SQLite kész →',
    path.resolve(DB_PATH),
    dbExisted ? '(meglévő)' : '(ÚJ adatbázis jött létre)',
  );
  if (!dbExisted) {
    /* Élesben ez a sor CSAK EGYSZER, a legelső indításkor helyénvaló. Ha minden
       deploy után látod, akkor a fájlrendszer ephemeral, és a felhasználói
       naplók deployonként elvesznek — perzisztens volume kell (README → Élesítés). */
    // eslint-disable-next-line no-console -- figyelmeztetés ephemeral tárolóra
    console.log(
      '   → ha ezt MINDEN indításkor látod, az adatbázis nem marad meg: perzisztens tároló kell.',
    );
  }
}

/* A két nagy kollekció memóriában tartva. A collections tábla a seed után nem
   változik (csak induláskor írjuk), ezért a cache a folyamat teljes életében
   érvényes marad. Ez REFERENCIA-adat: minden felhasználónak ugyanaz.

   CSAK ez a két kulcs cache-elhető, és ez szándékos: a hívó ugyanazt az
   objektumot kapja meg minden kérésnél, tehát MÓDOSÍTANIA TILOS. A 'dashboard'
   sem szerepel itt: a /api/dashboard végpont a streaket és a készenlétet egy
   MÁSOLATRA írja (server.js) — a cache nélküli kulcs csak második védvonal.

   Nyereség: az exerciseCatalog 365 KB-os JSON.parse-a kérésenként 3,6-4,4 ms
   volt, és minden readiness-számítás lekérte. */
const CACHED_COLLECTIONS = new Set(['exerciseCatalog', 'foods']);

const collectionCache = new Map();

/** Egy olvasható kollekció (foods, charts, …) JSON-ből visszafejtve.
    A visszaadott objektumot csak OLVASNI szabad: a CACHED_COLLECTIONS
    kulcsainál MEGOSZTOTT, és egy kulcs később bármikor bekerülhet oda. Aki
    módosítaná, előbb másolatot készítsen (pl. a /api/dashboard). */
export function getCollection(key) {
  if (collectionCache.has(key)) return collectionCache.get(key);

  const row = db.prepare('SELECT value FROM collections WHERE key = ?').get(key);
  const value = row ? JSON.parse(row.value) : null;
  if (CACHED_COLLECTIONS.has(key)) collectionCache.set(key, value);
  return value;
}
