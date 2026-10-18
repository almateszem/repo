/**
 * Podium — adatréteg: a baseline-őr és a migrációk
 * ------------------------------------------------------------------------
 * A régebbi (többfelhasználós) fájlok átalakítása a mai alakra. Mindegyik
 * lépést az index.js hívja, explicit sorrendben — modulszintű mellékhatás
 * nincs: a lépések így minden más modul betöltése UTÁN futnak.
 */
import { splitLegacyMuscleMap } from '../muscles.js';
import { weekFromLegacy } from '../plan-week.js';
import { DB_PATH, db } from './connection.js';
import { recomputeExerciseMaxes } from './training.js';

/* ---- Baseline-őr: túl régi (egyfelhasználós) adatbázis ----
   A fiókok bevezetése előtti séma (nincs users tábla, vagy egy felhasználói
   adat-táblának nincs user_id oszlopa) migrációja kikerült: nem volt
   idempotens, és régi adatbázison élesen hibázott (első indításkor elszállt, a
   másodikon csendben kimaradt egy lépés). Az ilyen fájlhoz NEM nyúlunk — a
   szerver egyértelmű hibával áll le, mielőtt bármit írna. */
export function assertSupportedSchema() {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  const hasUserId = (table) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((column) => column.name === 'user_id');
  const userTables = [
    'weight_log',
    'nutrition_log',
    'workouts',
    'plans',
    'workout_draft',
    'checkins',
    'exercise_maxes',
  ];
  const tooOld =
    tables.size > 0 &&
    (!tables.has('users') || userTables.some((table) => tables.has(table) && !hasUserId(table)));
  if (tooOld) {
    db.close();
    throw new Error(
      `Túl régi adatbázis (${DB_PATH}): a fiókok előtti, egyfelhasználós séma. Előbb a ` +
        'c429b9f (vagy korábbi) verzióval indítsd el egyszer — az még átalakítja —, ' +
        'utána ezzel a verzióval.',
    );
  }
}

/* ======================================================================
   Migrációk
   A CREATE TABLE IF NOT EXISTS a meglévő táblákat nem bővíti — az utólag
   bevezetett oszlopokat itt pótoljuk a régebbi DB-fájlokon.
   ====================================================================== */

const columnsOf = (table) =>
  db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
const hasColumn = (table, column) => columnsOf(table).includes(column);

/** Séma-verzió (PRAGMA user_version) — a lépések listája lentebb, a
    runMigrations-nél. */
export const readSchemaVersion = () => db.prepare('PRAGMA user_version').get().user_version;

/** A többfelhasználós séma után bevezetett oszlopok pótlása a régi fájlokon.
    Friss adatbázison már a CREATE TABLE hozza létre őket, azonos DDL-lel (a
    schema-parity.test.js veti össze a kettőt). Verziózott lépés: minden itt
    pótolt oszlop az 5-ös verzió előtt született, egy 5-ös adatbázisban tehát
    már mind megvan. Új oszlop a CREATE TABLE-be és egy új verziólépésbe kerül.
    A lista a tesztnek kell. A visszatérés: melyik terv-oszlop volt meg
    ELŐTTE (a terv-migrációk ebből tudják, futniuk kell-e). */
export const ENSURED_COLUMNS = [];

export function ensureColumns(schemaVersion) {
  const ensureColumn = (table, column, ddl) => {
    const added = schemaVersion < 5 && !hasColumn(table, column);
    if (added) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    ENSURED_COLUMNS.push({ table, column, added });
  };
  /* A fiók neme — 'male' | 'female' | NULL. Elhagyható, és az is marad: a
     profil erőszint-érméhez kell (a küszöbök nemenként lényegesen eltérnek,
     lásd data/strength-standards.js), minden más funkció működik nélküle. */
  ensureColumn('users', 'sex', 'sex TEXT');
  /* A születési ÉV (nem dátum) — az erőszint életkori korrekciójához elég, és
     ennél többet nem kérünk el, mint amennyi a számításhoz kell. Elhagyható:
     hiányában a küszöbök a 25-40 éves sávra szólnak. */
  ensureColumn('users', 'birth_year', 'birth_year INTEGER');
  ensureColumn('plans', 'days', "days TEXT NOT NULL DEFAULT '[]'");
  /* Melyik edzői kiosztás elfogadásából született a terv (NULL = saját terv).
     A terv-követés ebből tudja, hogy a terv az edzőé, és hogy az edző EREDETI
     példányához mérjen — a sportoló által később átírt tervhez nem. A meglévő
     tervek visszakötése lentebb, a migrációk között fut. */
  const plansHadAssignment = hasColumn('plans', 'assignment_id');
  ensureColumn('plans', 'assignment_id', 'assignment_id INTEGER');
  /* A heti bontás (plan-week.js): a terv és a kiosztás hete JSON-ban, és
     felhasználónként egy AKTÍV terv. A kitöltés lentebb, a migrációk végén. */
  const plansHadActive = hasColumn('plans', 'active');
  ensureColumn('plans', 'week', 'week TEXT');
  ensureColumn('plans', 'active', 'active INTEGER NOT NULL DEFAULT 0');
  /* A ciklus horgonya (plan-week.js → cycleAnchor): az aktiválás napja. A
     kitöltés lentebb, az aktív terv bevezetése után. */
  const plansHadActiveSince = hasColumn('plans', 'active_since');
  ensureColumn('plans', 'active_since', 'active_since TEXT');
  ensureColumn('plan_assignments', 'week', 'week TEXT');
  ensureColumn('workout_draft', 'date', "date TEXT NOT NULL DEFAULT ''");
  ensureColumn('workouts', 'plan_id', 'plan_id INTEGER');
  ensureColumn('workout_draft', 'plan_id', 'plan_id INTEGER');
  // A naplózás korábban fix 100 g-os adaggal ment — a régi sorok makrói tehát
  // 100 g-ra vonatkoznak, ezért a default érték helyes a meglévő adatokra is.
  ensureColumn('nutrition_log', 'grams', 'grams REAL NOT NULL DEFAULT 100');
  /* Az étel 100 g-ra vonatkozó, KEREKÍTETLEN tápértéke a naplózás pillanatában
     (másolat, mint a többi makró). Az adag-javítás ebből számol: a kerekített,
     adagra vetített értékből arányosítva a hiba felnagyítódott (1 g nyers
     csirkemell 0,2 g fehérjéjéből 200 g-ra 40 g lett a valós 46 helyett). A régi sorokon
     NULL — ott marad az arányos átszámolás. */
  ensureColumn('nutrition_log', 'base_kcal', 'base_kcal REAL');
  ensureColumn('nutrition_log', 'base_protein', 'base_protein REAL');
  ensureColumn('nutrition_log', 'base_carbs', 'base_carbs REAL');
  ensureColumn('nutrition_log', 'base_fat', 'base_fat REAL');
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
  /* Melyik PR-szabállyal mentették az edzést: 0 = a pipák előtti napló (pipa
     híján az első sor a rekord), 1 = csak a pipált szett számít. A visszatöltés
     soronként ebből dönt, hogy a régi napló csúcsai megmaradjanak, de egy mai,
     előre kitöltött edzés ne üssön hamis rekordot. */
  ensureColumn('workouts', 'pr_rule', 'pr_rule INTEGER NOT NULL DEFAULT 0');
  /* Mire épül a csúcs: 'measured' — naplózott szettből számolt (Epley), vagy
     'declared' — az erőfelmérésen BEMONDOTT érték. A kettő nem ugyanaz, és a
     felületnek ki is kell mondania, min alapul: a bemondott szám nem mérés.
     (Ugyanaz a megkülönböztetés, ami a gyakorlat-katalógusban a loadSource.)
     A meglévő sorok mind naplózott szettből születtek, tehát a default helyes.
     A `source` a CSÚCS forrása; maga a bemondás külön oszlopban él
     (declared_1rm, lent), így egy mért szett nem tünteti el. */
  ensureColumn('exercise_maxes', 'source', "source TEXT NOT NULL DEFAULT 'measured'");
  // Olvasás-jelölés az üzeneteken. A régi sorok NULL-lal (olvasatlanul) jönnek
  // át — ez a helyes: nem tudhatjuk, látta-e őket a címzett. Aki megnyitja a
  // szálat, egy lépésben olvasottá teszi a régi hátralékot is.
  ensureColumn('messages', 'read_at', 'read_at TEXT');
  // A visszanyitott (javítás alatt álló) edzés azonosítója a piszkozaton.
  ensureColumn('workout_draft', 'workout_id', 'workout_id INTEGER');
  /* A bemondott csúcs (erőfelmérés) a mért mellett, külön oszlopokban. Korábban
     a bemondás csak `source = 'declared'` sorként élt, és az első mért szett
     felülírta: egy elgépelt, majd javított edzés után a csúcs a bemondás nélkül
     épült újra. */
  ensureColumn('exercise_maxes', 'declared_1rm', 'declared_1rm REAL');
  ensureColumn('exercise_maxes', 'declared_date', 'declared_date TEXT');
  return { plansHadAssignment, plansHadActive, plansHadActiveSince };
}

/* A szett-értékek számalakját a MENTÉS állítja elő (server.js →
   nonNegativeField). Az induláskori átírás (migrateSetValuesToNumbers) kikerült:
   minden ma létező adatbázis már átment rajta, a nagyon régieket a baseline-őr
   fogja meg — közben pedig minden indításkor csonkította a szándékosan
   szövegként mentett értékeket (".5" → "5", "1e2" → "1", "8-12" → "8"). */

export function runMigrations(
  schemaVersion,
  { plansHadAssignment, plansHadActive, plansHadActiveSince },
) {
  /* Séma-verziók (PRAGMA user_version) az egyszer lefutó adat-migrációkhoz.
       1 — az 1RM-képlet egységesítése (one-rm.js → estimate1RM): az
           egyismétléses szett becslése a súly maga, nem +3,3%. Az újraszámolás
           a 3-as lépéssel egy körben fut (lent).
       2 — 9 → 12 izomcsoport: a check-inek izomláz- és fájdalom-térképében a
           régi `arms` a bicepszre és a tricepszre, a `back` a hátra, a
           trapézra és az alsó hátra is átmásolódik (muscles.js
           splitLegacyMuscleMap). Az edzésnaplót nem kell átírni: az
           izomterhelést a motor a gyakorlatnévből mindig újraszámolja.
       3 — a csúcsok egyszeri újraszámolása a naplóból, mindenkinek (lent, a
           terv-migrációk után): az 1-es képlet, a testsúlyos terhelés és a
           PR-követés előtti napló visszatöltése egy körben.
       4 — a víznapló mint egyetlen folyadék-forrás (lent).
       5 — a bemondott csúcsok átmásolása a declared_1rm / declared_date
           oszlopokba. Ez az ELSŐ lépés, nem az utolsó: a 3-as újraszámolás
           már ezekből az oszlopokból indul, üresen a bemondás elveszne. A másolás idempotens; a verziószámot a sor végén írjuk.
     (A schemaVersion-t az index.js olvassa ki, az ensureColumns előtt.) */
  if (schemaVersion < 5) {
    db.exec(`
      UPDATE exercise_maxes SET declared_1rm = max_1rm, declared_date = date
      WHERE source = 'declared' AND declared_1rm IS NULL
    `);
  }
  if (schemaVersion < 2) {
    const parse = (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    };
    const rows = db.prepare('SELECT user_id, date, soreness, pain FROM checkins').all();
    const update = db.prepare(
      'UPDATE checkins SET soreness = ?, pain = ? WHERE user_id = ? AND date = ?',
    );
    db.exec('BEGIN');
    try {
      for (const row of rows) {
        update.run(
          JSON.stringify(splitLegacyMuscleMap(parse(row.soreness))),
          JSON.stringify(splitLegacyMuscleMap(parse(row.pain))),
          row.user_id,
          row.date,
        );
      }
      db.exec('PRAGMA user_version = 2');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  /* A plans.assignment_id bevezetésekor (ld. fent) a már elfogadott tervek
     közül azt kötjük vissza, ami név, napok és gyakorlat-lista szerint PONTOSAN
     egyezik a kiosztással — az elfogadás így másolta át. Az azóta átírt tervet
     nem találgatjuk: az a sportolóé, nem az edző mércéje. */
  if (!plansHadAssignment) {
    const accepted = db
      .prepare(
        `
      SELECT a.id, l.athlete_id, a.name, a.days, a.exercises
      FROM plan_assignments a JOIN coach_links l ON l.id = a.link_id
      WHERE a.status = 'accepted' ORDER BY a.id
    `,
      )
      .all();
    const findPlan = db.prepare(`
      SELECT id FROM plans
      WHERE user_id = ? AND assignment_id IS NULL AND name = ? AND days = ? AND exercises = ?
      ORDER BY id LIMIT 1
    `);
    const link = db.prepare('UPDATE plans SET assignment_id = ? WHERE id = ?');
    for (const offer of accepted) {
      const plan = findPlan.get(offer.athlete_id, offer.name, offer.days, offer.exercises);
      if (plan) link.run(offer.id, plan.id);
    }
  }

  /* A heti bontás bevezetése (plan-week.js): a régi, egy gyakorlatlista +
     kijelölt napok alakú tervek és kiosztások hetet kapnak — az első kijelölt
     nap az edzés, a többi kijelölt nap „ugyanaz, mint az első", a többi
     pihenő. A régi oszlopok maradnak (a fenti visszakötés pontos egyezéssel
     olvassa őket). Verziózott lépés: az 5-ös verzióig minden indításkor
     lefutott, és minden író (addPlan, updatePlan, assignPlan) kitölti a hetet —
     egy 5-ös adatbázisban tehát nincs NULL week, ezért az olvasók (toPlan,
     toAssignment, getAssignedPlanTargets) a régi oszlopokhoz már nem nyúlnak. */
  if (schemaVersion < 5) {
    for (const table of ['plans', 'plan_assignments']) {
      const legacy = db
        .prepare(`SELECT id, exercises, days FROM ${table} WHERE week IS NULL`)
        .all();
      const fill = db.prepare(`UPDATE ${table} SET week = ? WHERE id = ?`);
      for (const row of legacy) {
        const exercises = JSON.parse(row.exercises);
        const week = weekFromLegacy(
          Array.isArray(exercises) ? exercises : [],
          JSON.parse(row.days),
        );
        fill.run(JSON.stringify(week), row.id);
      }
    }
  }

  /* Az aktív terv bevezetésekor felhasználónként egy terv lesz aktív: a
     legújabb, amelyiknek volt kijelölt napja (eddig ez töltődött be az Edzés
     oldalra). A nap nélküli „könyvtári" tervet NEM aktiváljuk: a heti alakban
     hétfőre kerül (weekFromLegacy), aktívként tehát minden hétfőn betöltődne,
     és az edzői kártya is ütemezett napnak számolná — eddig sosem volt az. */
  if (!plansHadActive) {
    const owners = db.prepare('SELECT DISTINCT user_id AS id FROM plans').all();
    const pick = db.prepare(`
      SELECT id FROM plans WHERE user_id = ? AND days != '[]'
      ORDER BY id DESC LIMIT 1
    `);
    const activate = db.prepare('UPDATE plans SET active = 1 WHERE id = ?');
    for (const owner of owners) {
      const plan = pick.get(owner.id);
      if (plan) activate.run(plan.id);
    }
  }

  /* A ciklus bevezetésekor a már aktív terv a mai napot kapja horgonynak. A
     meglévő tervek mind hétnaposak, és azoknál bármely hétfő ugyanazt a mai
     napot adja — a mai terv-nap tehát nem mozdul. */
  if (!plansHadActiveSince) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
    db.prepare('UPDATE plans SET active_since = ? WHERE active = 1').run(todayStr);
  }

  /*   3 — a csúcsok és a PR-jelzők egyszeri újraépítése a naplóból
           (recomputeExerciseMaxes), mindenkinek, akinek van edzése. Egy körben
           három korábbi okból:
           - az 1RM-képlet egységesítése (1-es lépés): az egyismétléses szett
             becslése a súly maga, nem +3,3%;
           - a saját testsúlyos gyakorlatok terhelése (data/bodyweight-load.js):
             egy húzódzkodás terhelése a test maga, nem a beírt 0 kg — a korábbi
             naplóból ezek kimaradtak, vagy egy „10 kg-os tolódzkodással" ültek
             a csúcsok között;
           - a PR-követés előtti napló: ott a csúcs-tábla üres, és a következő
             edzés minden gyakorlata hamis PR-t ütne (korábban ezt egy MINDEN
             induláskor lefutó visszatöltés pótolta).
           A bemondott csúcsokat nem érinti (azok a `declared` ágon
           kiindulópontok, és az 5-ös lépés már átmásolta őket).
           (A fejlesztő ágon ez még 2-es volt; a mainben a 2-es az izomcsoport-
           bontásé, ezért kapott új számot.) */
  if (schemaVersion < 3) {
    const userIds = db
      .prepare('SELECT DISTINCT user_id AS id FROM workouts')
      .all()
      .map((row) => row.id);
    for (const userId of userIds) recomputeExerciseMaxes(userId);
    db.exec('PRAGMA user_version = 3');
  }

  /*   4 — a folyadék egyetlen forrása a víznapló (ld. CHECKIN_COLUMNS). A
           víznapló előtti check-inek literértéke átkerül a víznaplóba (ahol
           aznapra még nincs korty), és törlődnek azok a sorok, amelyeket csak a
           korábbi víz-szinkron hozott létre: egyetlen kitöltött mező nélkül
           ezek „kitöltött check-innek" látszottak. */
  if (schemaVersion < 4) {
    db.exec('BEGIN');
    try {
      db.exec(`
        INSERT INTO water_log (user_id, date, ml)
        SELECT c.user_id, c.date, CAST(ROUND(c.hydration * 1000) AS INTEGER) FROM checkins c
        WHERE c.hydration > 0 AND NOT EXISTS (
          SELECT 1 FROM water_log w WHERE w.user_id = c.user_id AND w.date = c.date
        );
        DELETE FROM checkins
        WHERE sleep_hours IS NULL AND sleep_quality IS NULL AND energy IS NULL
          AND stress IS NULL AND mood IS NULL AND soreness = '{}' AND pain = '{}';
        PRAGMA user_version = 4;
      `);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  // 5 — a másolás fent, a többi migráció előtt futott (ld. a verziólistát).
  if (schemaVersion < 5) db.exec('PRAGMA user_version = 5');
}
