/**
 * Podium — adatréteg: edzések, tervek és csúcsok
 * ------------------------------------------------------------------------
 * Edzésnapló és piszkozat, heti tervek, egyéni csúcsok (PR-követés).
 */
import { effectiveLoad } from '../data/bodyweight-load.js';
import { normalizeName } from '../muscles.js';
import { dayEntry, dayWorkoutName, workoutDays } from '../plan-week.js';
import { bestCompletedSet, calculateEpley1RM } from '../records.js';
import { getWeightLog, weightForDate } from './body.js';
import { toIso } from './coaching.js';
import { db, transaction } from './connection.js';

/** Az edzések a rekord-csempék kiindulópontjához: DÁTUM szerint (azon belül
    rögzítési sorrendben), a mentéskori PR-szabállyal (pr_rule) együtt. A
    getWorkouts rögzítési sorrendje itt hibás volna: egy utólag bepótolt régi
    edzés nem lenne kiindulópont. */
export function getWorkoutsForRecords(userId) {
  return db
    .prepare('SELECT date, exercises, pr_rule FROM workouts WHERE user_id = ? ORDER BY date, id')
    .all(userId)
    .map((row) => ({
      date: row.date,
      exercises: JSON.parse(row.exercises),
      prRule: row.pr_rule,
    }));
}

/** A felhasználó jelenlegi maximális 1RM-je egy gyakorlatban, vagy null ha még nincs. */
export function getExerciseMax(userId, exerciseName) {
  const row = db
    .prepare(
      `SELECT max_1rm, date, source FROM exercise_maxes
                          WHERE user_id = ? AND exercise_name = ?`,
    )
    .get(userId, exerciseName);
  // A `source` megmondja, mire épül a szám: naplózott szett vagy bemondás.
  return row ? { max1rm: row.max_1rm, date: row.date, source: row.source } : null;
}

/** A felhasználó összes nyomon követett maximális 1RM-je. */
export function getAllExerciseMaxes(userId) {
  return db
    .prepare(
      // A `source` is jön: a hívó tudni akarja, naplózott szett vagy bemondás
      // áll a szám mögött. A két meglévő fogyasztó mezőnként képez át, nekik
      // egy plusz oszlop nem számít.
      'SELECT exercise_name, max_1rm, date, source FROM exercise_maxes WHERE user_id = ? ORDER BY date DESC',
    )
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
  return db
    .prepare(
      `
    SELECT exercise_name, max_1rm, date, updated_at FROM exercise_maxes
    WHERE user_id = ? AND date >= ?
    ORDER BY updated_at DESC, date DESC LIMIT ?
  `,
    )
    .all(userId, sinceDate, limit)
    .map((row) => ({
      exercise: row.exercise_name,
      max1rm: row.max_1rm,
      date: row.date,
      at: toIso(row.updated_at),
    }));
}

/**
 * Az erőfelmérésen BEMONDOTT csúcs rögzítése.
 *
 * A bemondás MINDIG eltárolódik (declared_1rm / declared_date), akkor is, ha
 * mért csúcs van — így egy később törölt vagy lefelé javított mért edzés után
 * újra ez a kiindulópont. A csúcs (max_1rm / source) a közös szabályt követi,
 * amit a recomputeExerciseMaxes számol: a bemondott és a mért közül a NAGYOBB
 * (egyenlőségnél a mért). Tehát:
 *   · egy alacsonyabb bemondás nem tünteti el a valódi rekordot;
 *   · egy nagyobb bemondás lesz a csúcs, és egy KÉSŐBBI emelésnek azt kell
 *     meghaladnia — a felmérés így valódi kiindulópont;
 *   · PR-bejegyzés nem születik: a PR-lista a naplózott edzésekből épül
 *     (/api/prs), ide csak a viszonyítási alap kerül.
 *
 * Visszaadja, hogy a bemondás lett-e a csúcs (`stored`), és az érvényes csúcsot.
 */
export function setDeclaredMax(userId, exerciseName, max1rm, date) {
  return transaction(() => {
    db.prepare(
      `
    INSERT INTO exercise_maxes
      (user_id, exercise_name, max_1rm, date, source, updated_at, declared_1rm, declared_date)
    VALUES (?, ?, ?, ?, 'declared', datetime('now'), ?, ?)
    ON CONFLICT(user_id, exercise_name) DO UPDATE SET
      declared_1rm = excluded.declared_1rm, declared_date = excluded.declared_date
  `,
    ).run(userId, exerciseName, max1rm, date, max1rm, date);
    /* Hogy a bemondás vagy a mérés a csúcs, és melyik edzés PR-jelzője igaz, az
       a naplótól függ — ugyanaz az újraépítés dönti el, mint törlés után. */
    recomputeExerciseMaxes(userId);
    const peak = getExerciseMax(userId, exerciseName);
    return { stored: peak.source === 'declared', max1rm: peak.max1rm };
  });
}

/** A BEMONDOTT csúcsok. A készenlét-motor ezekből tudja, hogy a felhasználó
    egy gyakorlatot ismer és nagyjából milyen szinten — akkor is, ha még
    egyetlen edzést sem naplózott ide. A bemondott oszlopokból olvas (mint a
    recomputeExerciseMaxes), nem a csúcs forrásából: a mért csúcs alatti
    bemondás is megvan, és a profil-lista meg a motor is ezt látja. */
export function getDeclaredMaxes(userId) {
  return db
    .prepare(
      `SELECT exercise_name, declared_1rm, declared_date FROM exercise_maxes
                     WHERE user_id = ? AND declared_1rm IS NOT NULL`,
    )
    .all(userId)
    .map((row) => ({
      name: row.exercise_name,
      max1rm: row.declared_1rm,
      date: row.declared_date,
    }));
}

/** Egy gyakorlat maximum 1RM-jének frissítése, ha az új érték nagyobb.
    Visszaadja az objektumot { max1rm, date, isPr } formában (isPr = true ha PR-t ütöttünk). */
export function updateExerciseMax(userId, exerciseName, new1rm, currentDate) {
  const existing = getExerciseMax(userId, exerciseName);
  const isPr = !existing || new1rm > existing.max1rm;
  /* A bemondással egyenlő mért érték lesz a csúcs (a mérés erősebb
     bizonyíték), de nem PR — ugyanaz a szabály, mint a recomputeExerciseMaxes-ban. */
  const takesOver = !isPr && existing.source === 'declared' && new1rm === existing.max1rm;

  if (isPr || takesOver) {
    db.prepare(
      `
      INSERT INTO exercise_maxes (user_id, exercise_name, max_1rm, date, source, updated_at)
      VALUES (?, ?, ?, ?, 'measured', datetime('now'))
      ON CONFLICT(user_id, exercise_name) DO UPDATE SET
        max_1rm = excluded.max_1rm,
        date = excluded.date,
        -- A nagyobb mért érték lesz a csúcs; a bemondás (declared_1rm) marad,
        -- egy későbbi törlés vagy javítás után onnan épül újra.
        source = 'measured',
        updated_at = excluded.updated_at
    `,
    ).run(userId, exerciseName, new1rm, currentDate);
  }

  return {
    max1rm: isPr ? new1rm : existing.max1rm,
    date: isPr || takesOver ? currentDate : existing.date,
    isPr,
  };
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
 *     megemelte — mentéskor is ez íródik (addWorkout), a kliens szerkesztés
 *     közbeni jelzője csak előrejelzés. Amit a lista kiír, annak a naplóból
 *     kell következnie.
 */
export function recomputeExerciseMaxes(userId) {
  /* A BEMONDOTT csúcsok (erőfelmérés) nem a naplóból jönnek, tehát az
     újraépítés nem tudná előállítani őket. Korábban a törlés mindet elvitte:
     egy edzés törlése után eltűntek a felmérésre épülő ajánlások. Ezért ők a
     kiindulópont — pont úgy, ahogy mentéskor is az addWorkout hozzájuk méri
     a naplózott szettet (updateExerciseMax). A bemondás a saját oszlopaiból
     jön (declared_1rm), nem a csúcs forrásából: egy mért szett fölülírhatta a
     csúcsot, a bemondás attól még megvan, és az újraépítés után is megmarad. */
  const existing = new Map(
    db
      .prepare(
        `SELECT exercise_name, max_1rm, date, source, updated_at, declared_1rm, declared_date
           FROM exercise_maxes WHERE user_id = ?`,
      )
      .all(userId)
      .map((row) => [row.exercise_name, row]),
  );
  const rows = db
    .prepare(
      `SELECT id, date, exercises, pr_rule, created_at FROM workouts
        WHERE user_id = ? ORDER BY date, id`,
    )
    .all(userId);

  // gyakorlatnév → { max1rm, date, source, bornAt }
  const best = new Map(
    [...existing.values()]
      .filter((row) => row.declared_1rm !== null)
      .map((row) => [
        row.exercise_name,
        {
          max1rm: row.declared_1rm,
          date: row.declared_date,
          source: 'declared',
          // A születés ideje csak akkor ismert, ha eddig is a bemondás volt a csúcs
          bornAt:
            row.source === 'declared' && row.date === row.declared_date ? row.updated_at : null,
        },
      ]),
  );
  const rewrites = []; // [{ id, exercises }] — csak a ténylegesen változó sorok
  // A testsúlyos gyakorlatok alapterheléséhez — egyszer, nem soronként
  const weightLog = getWeightLog(userId);

  for (const row of rows) {
    let exercises;
    try {
      exercises = JSON.parse(row.exercises);
    } catch {
      continue;
    }
    if (!Array.isArray(exercises)) continue;

    let changed = false;
    for (const exercise of exercises) {
      const name = exercise?.name;
      if (!name) continue;
      /* A rekordot hozó szettet a közös bestCompletedSet adja meg, azzal a
         szabállyal, amivel az edzést MENTETTÉK (workouts.pr_rule). A pipák
         előtti naplóban (0) pipa híján az első sor számít: enélkül akinek a
         régi edzéseiben egyetlen szett sem volt bepipálva, annál a
         visszatöltés üresen maradna, és a következő edzés hamis PR-t ütne.
         Az új szabállyal mentett sorokon (1) csak a pipált szett számít —
         különben egy törlés utáni újraszámolás visszahozná azt a hamis
         rekordot, amit az addWorkout mentéskor már nem adott ki. */
      /* Saját testsúlyos gyakorlatnál a terhelés zöme a test — ugyanazzal az
         alapterheléssel kell számolni, mint mentéskor, különben az
         újraszámolás visszaírná a régi, nulla körüli értéket. Az edzés NAPJÁHOZ
         tartozó testsúllyal, nem a maival. */
      const baseLoad = effectiveLoad(name, 0, weightForDate(userId, row.date, weightLog));
      const record = bestCompletedSet(exercise?.sets ?? [], {
        fallbackToFirst: row.pr_rule === 0,
        baseLoad,
      });
      const oneRM = record
        ? calculateEpley1RM(Number(record.weight || 0) + baseLoad, record.reps)
        : 0;
      if (oneRM <= 0) continue;

      const current = best.get(name);
      const isPr = !current || oneRM > current.max1rm;
      /* Egyenlőségnél a mérés a csúcs (erősebb bizonyíték), de nem PR: a
         bemondott szintet nem haladta meg. */
      const takesOver = !isPr && current.source === 'declared' && oneRM === current.max1rm;
      if (isPr || takesOver) {
        best.set(name, {
          max1rm: oneRM,
          date: row.date,
          source: 'measured',
          bornAt: row.created_at,
        });
      }

      // A hiányzó és a false jelző ugyanaz — a régi sorokon nincs is `pr` mező
      if (Boolean(exercise.pr) !== isPr) {
        exercise.pr = isPr;
        changed = true;
      }
    }
    if (changed) rewrites.push({ id: row.id, exercises });
  }

  const clear = db.prepare('DELETE FROM exercise_maxes WHERE user_id = ?');
  const insert = db.prepare(`INSERT INTO exercise_maxes
                               (user_id, exercise_name, max_1rm, date, source, updated_at,
                                declared_1rm, declared_date)
                             VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?)`);
  const rewrite = db.prepare('UPDATE workouts SET exercises = ? WHERE id = ?');

  // A törlés és a beszúrások egy lépés: egy közbeni hiba után a régi csúcsok
  // — köztük a naplóból vissza nem állítható bemondottak — megmaradnak
  transaction(() => {
    clear.run(userId);
    for (const [name, record] of best) {
      /* Az updated_at a rekord SZÜLETÉSE — az értesítés-panel ebből dönti el,
         mi „új" (notifications.js → notifSeenAt). Az újraépítés nem születés:
         ha ugyanaz az edzés-nap viszi a rekordot, marad a régi időbélyeg (a
         képlet-migráció csak az értéket számolja át); ha egy MÁSIK edzésre száll
         át (törlés után), annak a mentési ideje. Korábban minden sor „most"
         született, és a friss PR-ek egy törlés után újra olvasatlanként jöttek. */
      const previous = existing.get(name);
      const bornAt =
        previous && previous.date === record.date && previous.source === record.source
          ? previous.updated_at
          : record.bornAt;
      insert.run(
        userId,
        name,
        record.max1rm,
        record.date,
        record.source,
        bornAt,
        previous?.declared_1rm ?? null,
        previous?.declared_date ?? null,
      );
    }
    for (const row of rewrites) rewrite.run(JSON.stringify(row.exercises), row.id);
  });
}

/* ---- Tervek (heti bontás: plan-week.js) ---- */

const PLAN_COLUMNS = 'id, name, date, week, active, active_since, assignment_id';

/** Egy terv-sor → a hívók által látott alak. A `days` SZÁMOLT érték (a nem
    pihenő napok); a régi `exercises`/`days` oszlop csak a migráció forrása. */
const toPlan = (row) => {
  const week = JSON.parse(row.week);
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    week,
    days: workoutDays(week),
    active: row.active === 1,
    activeSince: row.active_since ?? null,
    assignmentId: row.assignment_id ?? null,
  };
};

/** A felhasználó AKTÍV terve, vagy null. Egyszerre legfeljebb egy aktív:
    csak ennek a hete töltődik az Edzés oldalra. */
export function getActivePlan(userId) {
  const row = db
    .prepare(`SELECT ${PLAN_COLUMNS} FROM plans WHERE user_id = ? AND active = 1 LIMIT 1`)
    .get(userId);
  return row ? toPlan(row) : null;
}

/** Az aktív terv ÜTEMEZÉSE (0 vagy 1 elem). Az edzői kártya heti állása a
    terv ciklusából (hét + horgony) és a kezdőnapjából számol, a kártyán
    pedig a terv NEVE látszik. */
export function getUserPlanSchedules(userId) {
  const plan = getActivePlan(userId);
  return plan
    ? [
        {
          id: plan.id,
          name: plan.name,
          date: plan.date,
          activeSince: plan.activeSince,
          week: plan.week,
          days: plan.days,
        },
      ]
    : [];
}

/** A terv-követés mércéje: amit EZ a kapcsolat (edző) LEGUTÓBB kiosztott és a
    sportoló elfogadott — az edző aktuális előírása; a korábbi, lecserélt
    kiosztás nem büntet. A hét a kiosztásé (az edző eredeti példánya), a
    kezdőnap a sportoló tervéé (az elfogadás napja): ha a sportoló azóta
    átírta a tervet, az nem számít. Az `id` a sportoló tervéé — a tervből
    indított edzések `planId`-je erre mutat. */
export function getAssignedPlanTargets(userId, linkId) {
  return db
    .prepare(
      `
    SELECT p.id, p.date, p.active_since, a.week
    FROM plans p JOIN plan_assignments a ON a.id = p.assignment_id
    WHERE p.user_id = ? AND a.link_id = ?
    ORDER BY p.id DESC LIMIT 1
  `,
    )
    .all(userId, linkId)
    .map((row) => ({
      id: row.id,
      date: row.date,
      // A ciklus horgonya a sportoló tervéé — ő aktiválta
      activeSince: row.active_since ?? null,
      week: JSON.parse(row.week),
    }));
}

/** EGY terv a felhasználó sajátjai közül, vagy null. A userId nem díszítés:
    ez akadályozza meg, hogy más tervére lehessen hivatkozni az azonosítóval. */
export function getPlan(userId, id) {
  const row = db
    .prepare(`SELECT ${PLAN_COLUMNS} FROM plans WHERE user_id = ? AND id = ?`)
    .get(userId, id);
  return row ? toPlan(row) : null;
}

/** A felhasználó által készített edzéstervek, legújabb elöl. */
export function getUserPlans(userId) {
  return db
    .prepare(`SELECT ${PLAN_COLUMNS} FROM plans WHERE user_id = ? ORDER BY id DESC`)
    .all(userId)
    .map(toPlan);
}

/** Az aktív terv edzése a ciklus megadott napján (plan-week.js → cycleDay):
    `{ id, name, exercises }`, vagy null — pihenőnapon és terv nélkül is. */
export function getPlanForDay(userId, dayIndex) {
  const plan = getActivePlan(userId);
  const entry = plan && dayEntry(plan.week, dayIndex);
  return entry
    ? { id: plan.id, name: dayWorkoutName(plan, dayIndex), exercises: entry.exercises }
    : null;
}

/** Az épp szerkesztett edzés piszkozata ({ name, exercises, date, planId })
    vagy null. A planId mutatja, melyik tervből indult az edzés. */
export function getWorkoutDraft(userId) {
  const row = db
    .prepare(
      'SELECT name, exercises, date, plan_id, workout_id FROM workout_draft WHERE user_id = ?',
    )
    .get(userId);
  return row
    ? {
        name: row.name,
        exercises: JSON.parse(row.exercises),
        date: row.date,
        planId: row.plan_id,
        workoutId: row.workout_id,
      }
    : null;
}

/** Az edzés oszlopai a toWorkout-hoz — egy helyen, hogy minden olvasó
    ugyanazt az alakot adja (a visszajelzéssel együtt). */
const WORKOUT_COLUMNS = `id, name, date, exercises, plan_id,
  feedback_difficulty, feedback_mood, feedback_note, feedback_at`;

/** Egy edzés-sor → a hívók által várt alak (a gyakorlatok JSON-ból vissza). */
const toWorkout = (row) => ({
  id: row.id,
  name: row.name,
  date: row.date,
  exercises: JSON.parse(row.exercises),
  planId: row.plan_id,
  /* A visszajelzés csak akkor kerül bele, ha tényleg érkezett — üres objektum
     helyett `null`, hogy a „nem küldött" eset egyértelmű maradjon. */
  feedback: row.feedback_at
    ? {
        difficulty: row.feedback_difficulty,
        mood: row.feedback_mood,
        note: row.feedback_note,
        at: toIso(row.feedback_at),
      }
    : null,
});

/** A mentett edzések, legújabb elöl (a gyakorlatok JSON-ból visszafejtve). */
export function getWorkouts(userId) {
  return db
    .prepare(`SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE user_id = ? ORDER BY id DESC`)
    .all(userId)
    .map(toWorkout);
}

/**
 * A `sinceDate` óta mentett edzések, legújabb elöl.
 *
 * Miért van külön a teljes lekérdezéstől: az edzések ára szinte teljes
 * egészében a gyakorlat-lista JSON.parse-a, és a készenlét-motor amúgy is
 * eldob mindent, ami CHRONIC_WINDOW_DAYS-nél (28 nap) régebbi
 * (training-load.js -> summarizeWorkouts). Egy éves naplónál ez ~183 sor helyett
 * ~12-t jelent — az edzői panelen SPORTOLÓNKÉNT.
 *
 * A dátum "ÉÉÉÉ.HH.NN" alakú, tehát a szöveges összehasonlítás időrendi is.
 */
export function getWorkoutsSince(userId, sinceDate) {
  return db
    .prepare(
      `
    SELECT ${WORKOUT_COLUMNS}
    FROM workouts
    WHERE user_id = ? AND date >= ? ORDER BY id DESC
  `,
    )
    .all(userId, sinceDate)
    .map(toWorkout);
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
  return db
    .prepare('SELECT DISTINCT date FROM workouts WHERE user_id = ? ORDER BY date DESC')
    .all(userId)
    .map((row) => row.date);
}

/** A piszkozat felülírása (felhasználónként egy sor) — minden változtatásnál
    hívjuk. A date a szerver helyi napja: ebből dönti el a /api/workout-template,
    hogy a piszkozat aznapi-e, vagy jöhet helyette a napra ütemezett terv. */
export function saveWorkoutDraft(userId, name, exercises, date, planId = null, workoutId = null) {
  db.prepare(
    `INSERT INTO workout_draft (user_id, name, exercises, date, plan_id, workout_id, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET
                name = excluded.name, exercises = excluded.exercises,
                date = excluded.date, plan_id = excluded.plan_id,
                workout_id = excluded.workout_id,
                updated_at = excluded.updated_at`,
  ).run(userId, name, JSON.stringify(exercises), date, planId, workoutId);
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
/* Ennyi másodpercen belül számít ugyanaz a mentés ISMÉTLÉSNEK (ld. lent). Két
   percnél a hálózati újrapróbálás és a „mindkét fülön rányomtam" is bőven
   belefér, egy szándékosan megismételt edzés viszont soha. */
const DUPLICATE_WINDOW_SECONDS = 120;

/** Az edzés TARTALMI ujjlenyomata a duplikátum-kereséshez. A `pr` jelzőt
    kihagyjuk: a mentett soron a szerver írja rá, a beérkezőn a kliens küldi —
    a kettő ugyanarra az edzésre is eltérhet. Minden más mező (a szettek
    értékeivel együtt) a normalizálásból jön, tehát a kulcssorrend azonos. */
const workoutFingerprint = (list) =>
  JSON.stringify((list ?? []).map(({ pr: _pr, ...rest }) => rest));

export function addWorkout(userId, name, date, exercises, planId = null) {
  /* EGY TRANZAKCIÓ az egész: a duplikátum-keresés, a PR-feldolgozás, a
     beszúrás és a piszkozat törlése. A PR-maximumot (updateExerciseMax) a
     beszúrás ELŐTT írjuk — ha a beszúrás utána elbukna, tranzakció nélkül egy
     fantom csúcs maradna, ami mögött nincs edzés, és ami elzárná a következő
     valódi PR-t. */
  db.exec('BEGIN IMMEDIATE');
  try {
    const saved = insertWorkoutOnce(userId, name, date, exercises, planId);
    /* A piszkozat törlése. Eddig csak a kliens takarította el (DELETE
       /api/workout-draft, külön kérés) — ha az elmaradt (bezárt fül,
       megszakadt hálózat), a félig mentett edzés ott maradt piszkozatként, és
       a felhasználó legközelebb ugyanazt a szettsort látta újra „folyamatban
       lévő" edzésként. A szerver most maga zárja a kört: ami edzés lett, az
       nem piszkozat többé.
       A DUPLIKÁTUM-ágon is: két fülön az egyik befejezi az edzést, a másik
       közben még piszkozatot ment, majd ugyanazt az edzést küldi — a lezárt
       edzés különben „folyamatban lévőként" jönne vissza. */
    db.prepare('DELETE FROM workout_draft WHERE user_id = ?').run(userId);
    db.exec('COMMIT');
    return saved;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* Az addWorkout tranzakción belüli része: a meglévő sor (ismétlésnél) vagy a
   frissen beszúrt edzés. Önmagában NEM hívható — a tranzakciót a hívó nyitja. */
function insertWorkoutOnce(userId, name, date, exercises, planId) {
  /* IDEMPOTENCIA. A mentésnek nincs kliens-oldali kulcsa, és a felület sem
     tiltja le a gombot elég korán: két fülön (vagy egy hálózati
     újrapróbáláskor) ugyanaz az edzés kétszer jött be. A duplikátum nem csak
     a listában látszik — torzítja a volument, a sorozatot, az edzői kártyát,
     és a PR-maximumot is, amit lentebb írunk.
     Ezért a KERESÉS ELÖL ÁLL: a PR-feldolgozás előtt, mert annak már van
     mellékhatása (updateExerciseMax). Találat esetén a MEGLÉVŐ sort adjuk
     vissza — a kliens ugyanazt kapja, mintha most mentett volna. */
  const wanted = workoutFingerprint(exercises);
  const recent = db
    .prepare(
      `SELECT id, exercises, plan_id FROM workouts
       WHERE user_id = ? AND date = ? AND name = ?
         AND created_at > datetime('now', ?)`,
    )
    .all(userId, date, name, `-${DUPLICATE_WINDOW_SECONDS} seconds`);

  for (const row of recent) {
    const stored = JSON.parse(row.exercises);
    if ((row.plan_id ?? null) !== planId) continue;
    if (workoutFingerprint(stored) !== wanted) continue;
    return getWorkout(userId, row.id);
  }

  // PR-eket számítunk az Epley-képlettel: 1RM = weight × (1 + reps/30)
  // Ha egy gyakorlatban van teljesített szett, és az 1RM nagyobb mint az eddigi maximum,
  // akkor PR-ként jelöljük meg a gyakorlatot
  /* A napi testsúly a saját testsúlyos gyakorlatokhoz kell: ott a terhelés
     zöme maga a test, a beírt kilogramm csak a ráadás. Az edzés NAPJÁHOZ
     tartozó súlyt keressük, nem a mait — egy tavalyi húzódzkodás a tavalyi
     testsúlyoddal volt annyi, amennyi. */
  const bodyweightOnDate = weightForDate(userId, date);

  const processedExercises = exercises.map((exercise) => {
    const sets = exercise.sets || [];

    /* Saját testsúlyosnál a testsúly hányada MINDEN szett terheléséhez
       hozzáadódik — a rangsoroláshoz is, különben nulla súlyon minden szett
       egyformán 0 lenne, és a „legjobb" az első pipált sor lenne. */
    const baseLoad = effectiveLoad(exercise.name, 0, bodyweightOnDate);

    // A rekordot hozó szett: az új edzésen CSAK a pipáltak közül a legjobb
    // (pr_rule = 1) — egy előre kitöltött, el nem végzett sor nem rekord.
    const record = bestCompletedSet(sets, { baseLoad });
    const bestCompleted1rm = record
      ? calculateEpley1RM(Number(record.weight || 0) + baseLoad, record.reps)
      : 0;

    // PR-ellenőrzés és frissítés
    let isPr = false;
    if (bestCompleted1rm > 0) {
      isPr = updateExerciseMax(userId, exercise.name, bestCompleted1rm, date).isPr;
    }

    return {
      ...exercise,
      // A szerver szabálya dönt: a kliens jelzője csak előrejelzés volt
      pr: isPr,
    };
  });

  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO workouts (user_id, name, date, exercises, plan_id, pr_rule) VALUES (?, ?, ?, ?, ?, 1)',
    )
    .run(userId, name, date, JSON.stringify(processedExercises), planId);
  // Ugyanaz a leképezés, mint a getWorkouts soráé (toWorkout), hogy a
  // felületnek ne kelljen két alakra készülnie
  return getWorkout(userId, Number(lastInsertRowid));
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
    const { changes } = db
      .prepare('DELETE FROM workouts WHERE id = ? AND user_id = ?')
      .run(id, userId);
    if (changes > 0) {
      /* Ha épp ez az edzés volt visszanyitva a szerkesztőbe, a piszkozat egy
         megszűnt sorra hivatkozna, és a befejezés 404-be futna. A tartalmát
         nem dobjuk el (azt a felhasználó írta) — csak elengedjük a
         hivatkozást, így új edzésként menthető. */
      db.prepare(
        'UPDATE workout_draft SET workout_id = NULL WHERE user_id = ? AND workout_id = ?',
      ).run(userId, id);
      recomputeExerciseMaxes(userId);
    }
    db.exec('COMMIT');
    return changes > 0;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* Modulon belüli segéd — a mentés, a javítás és a visszajelzés ezen adja
   vissza a friss sort. */
function getWorkout(userId, workoutId) {
  const row = db
    .prepare(`SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE id = ? AND user_id = ?`)
    .get(workoutId, userId);
  return row ? toWorkout(row) : null;
}

/** Az edzés utáni visszajelzés mentése/felülírása. CSAK a saját edzésére —
    az UPDATE a user_id-re is szűr, tehát idegen sorra nem talál semmit.
    Visszaadja a frissített edzést, vagy null-t, ha nem volt ilyen sor. */
export function saveWorkoutFeedback(userId, workoutId, { difficulty, mood, note }) {
  const changed = db
    .prepare(
      `
    UPDATE workouts
       SET feedback_difficulty = ?, feedback_mood = ?, feedback_note = ?,
           feedback_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
    )
    .run(difficulty ?? null, mood ?? null, note ?? null, workoutId, userId).changes;
  return changed ? getWorkout(userId, workoutId) : null;
}

/** A gyakorlat-megjegyzések célja ("edzésId:index") az edzés javítása után is
    a saját gyakorlatára mutasson. A régi és az új lista név szerint párosul
    (normalizeName; azonos névnél sorrendben); a megjegyzés az új indexre kerül.
    A törölt gyakorlat megjegyzése ÁRVA lesz ("edzésId:x<régi index>"): egyetlen
    gyakorlatra sem mutat, tehát a régi indexen sem csúszik át egy másikra. A
    sorokat azonosító szerint írjuk át, így a csere (0 ↔ 1) sem fésül össze
    két megjegyzést. A hívó tranzakciójában fut. */
function retargetExerciseComments(userId, workoutId, oldExercises, newExercises) {
  const freeByName = new Map(); // normalizált név → az új lista szabad indexei
  (Array.isArray(newExercises) ? newExercises : []).forEach((exercise, index) => {
    const key = normalizeName(exercise?.name);
    if (!freeByName.has(key)) freeByName.set(key, []);
    freeByName.get(key).push(index);
  });
  const newIndexOf = new Map(); // régi index → új index (vagy hiányzik: törölve)
  (Array.isArray(oldExercises) ? oldExercises : []).forEach((exercise, index) => {
    const free = freeByName.get(normalizeName(exercise?.name));
    if (free?.length) newIndexOf.set(index, free.shift());
  });

  const prefix = `${workoutId}:`;
  const rows = db
    .prepare(
      `SELECT id, target_id FROM comments
        WHERE subject_id = ? AND target_type = 'exercise' AND target_id LIKE ?`,
    )
    .all(userId, `${prefix}%`);
  const retarget = db.prepare('UPDATE comments SET target_id = ? WHERE id = ?');
  for (const row of rows) {
    const rest = row.target_id.slice(prefix.length);
    if (!/^\d+$/.test(rest)) continue; // már árva
    const oldIndex = Number(rest);
    const next = newIndexOf.has(oldIndex) ? String(newIndexOf.get(oldIndex)) : `x${oldIndex}`;
    if (next !== rest) retarget.run(prefix + next, row.id);
  }
}

export function updateWorkout(userId, id, name, exercises) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const before = db
      .prepare('SELECT exercises FROM workouts WHERE id = ? AND user_id = ?')
      .get(id, userId);
    // A most újramentett edzés már az új PR-szabály alá kerül (pr_rule = 1).
    const { changes } = db
      .prepare(
        'UPDATE workouts SET name = ?, exercises = ?, pr_rule = 1 WHERE id = ? AND user_id = ?',
      )
      .run(name, JSON.stringify(exercises), id, userId);
    if (changes === 0) {
      db.exec('COMMIT');
      return null;
    }
    retargetExerciseComments(userId, id, JSON.parse(before.exercises), exercises);
    recomputeExerciseMaxes(userId);
    const saved = getWorkout(userId, id);
    db.exec('COMMIT');
    return saved;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Terv törlése. Csak a SAJÁT sorát törli — idegen id-re false jön, tehát a
    hívó 404-et képez belőle. Az edzőtől kapott, elfogadott terv a sportoló
    saját sora (az elfogadás MÁSOLATOT hoz létre), ezért az is törölhető.
    Ha az AKTÍV tervet törli, a legújabb megmaradt veszi át a helyét — mint az
    addPlan-nél: aki tervet használ, ne maradjon némán aktív terv nélkül. */
export function deletePlan(userId, id, today) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const wasActive = getActivePlan(userId)?.id === Number(id);
    const deleted =
      db.prepare('DELETE FROM plans WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
    /* Csak ütemezett napú terv veheti át a helyét: a nap nélküli régi
       „könyvtári" terv a heti alakban hétfőre kerül, aktívként tehát minden
       hétfőn betöltődne (ugyanezért nem aktiválja a migráció sem). */
    if (deleted && wasActive) {
      db.prepare(
        `UPDATE plans SET active = 1, active_since = ?
         WHERE id = (SELECT id FROM plans WHERE user_id = ? AND days != '[]'
                     ORDER BY id DESC LIMIT 1)`,
      ).run(today ?? null, userId);
    }
    db.exec('COMMIT');
    return deleted;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Edzésterv mentése (a hét: plan-week.js alak); visszaadja a létrejött tervet.
    Az `assignmentId` az edzői kiosztás elfogadásáé (saját tervnél null). Ha a
    felhasználónak még nincs aktív terve, ez lesz az — különben a meglévő
    aktív marad, és az újat a Tervek oldalon lehet átkapcsolni. A régi
    `exercises` oszlop üres marad, a `days` a számolt edzésnapok. */
export function addPlan(userId, name, date, week, assignmentId = null) {
  const active = getActivePlan(userId) ? 0 : 1;
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO plans
         (user_id, name, date, week, exercises, days, active, active_since, assignment_id)
       VALUES (?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
    )
    .run(
      userId,
      name,
      date,
      JSON.stringify(week),
      JSON.stringify(workoutDays(week)),
      active,
      active ? date : null,
      assignmentId,
    );
  return getPlan(userId, Number(lastInsertRowid));
}

/** Meglévő terv felülírása (név és hét — a létrehozás dátuma és az aktív
    állapot marad). A frissített tervet adja vissza, vagy null-t, ha nincs
    ilyen id — MÁS felhasználó tervére is null jön, azt nem lehet átírni. */
export function updatePlan(userId, id, name, week) {
  const { changes } = db
    .prepare('UPDATE plans SET name = ?, week = ?, days = ? WHERE id = ? AND user_id = ?')
    .run(name, JSON.stringify(week), JSON.stringify(workoutDays(week)), id, userId);
  return changes === 0 ? null : getPlan(userId, id);
}

/** A terv aktívvá tétele (a felhasználó többi terve ettől kikapcsol) vagy
    kikapcsolása. Bekapcsoláskor a `today` lesz a ciklus horgonya — az
    újraaktiválás tehát újraindítja a ciklust; a már aktív terv „újra-
    bekapcsolása" nem (a SET a régi `active` értéket látja). A frissített tervet adja
    vissza, idegen/ismeretlen id-re null. */
export function setActivePlan(userId, id, active, today) {
  if (!getPlan(userId, id)) return null;
  if (active) {
    db.prepare(
      `UPDATE plans SET active = CASE WHEN id = ? THEN 1 ELSE 0 END,
         active_since = CASE WHEN id = ? AND active = 0 THEN ? ELSE active_since END
       WHERE user_id = ?`,
    ).run(id, id, today ?? null, userId);
  } else {
    db.prepare('UPDATE plans SET active = 0 WHERE id = ? AND user_id = ?').run(id, userId);
  }
  return getPlan(userId, id);
}
