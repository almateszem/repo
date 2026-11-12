/**
 * Podium — bemutató-adatbázis (server/demo.db)
 * ------------------------------------------------------------------------
 * Egy edző és három sportoló, 8 hétnyi valószerű előzménnyel: edzések,
 * napi check-inek, testsúly, testméretek, táplálkozás, víz, edzői terv és
 * étrend, üzenetek, megjegyzések, és egy futó blokkos (5/3/1) program.
 *
 * Nem nyers SQL-lel ír: napról napra „lejátssza" a 8 hetet ugyanazokkal az
 * adatréteg- és szolgáltatás-függvényekkel, amiket a végpontok hívnak
 * (addWorkout → PR-számítás, onWorkoutSaved → program-léptetés és szabályok,
 * approveReview → TM-jóváhagyás …). Így az app pontosan úgy látja az adatot,
 * mintha a felületen vitték volna fel. Utólag csak az időbélyegeket igazítja
 * a naplózás napjához (különben minden sor „most" készült volna).
 *
 * A véletlen rögzített magból jön: két futtatás ugyanazt az adatot adja.
 * A dátumok a futtatás napjához igazodnak — a bemutató reggelén érdemes
 * újrafuttatni, hogy a „ma" és a „tegnap" stimmeljen.
 *
 *   npm run seed:demo                       — a mai naphoz igazítva
 *   npm run seed:demo -- --today 2026.11.13 — megadott „mai" nappal
 *   npm run start:demo                      — a szerver a demo.db-vel
 *
 * A meglévő server/podium.db-hez NEM nyúl.
 */
import path from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DB = path.join(__dirname, '..', 'server', 'demo.db');
const PASSWORD = 'podium2026';

/* ---- A régi demo.db eltakarítása (a WAL-fájljaival együtt) ---- */
for (const suffix of ['', '-wal', '-shm']) {
  try {
    rmSync(DEMO_DB + suffix, { force: true });
  } catch (err) {
    console.error(
      `Nem törölhető: ${DEMO_DB + suffix} (${err.code}). Fut még a demó szerver? Állítsd le, és futtasd újra.`,
    );
    process.exit(1);
  }
}

// Az adatréteg importkor nyitja meg a fájlt — az env-változónak előtte kell állnia
process.env.PODIUM_DB = DEMO_DB;

const dbApi = await import('../server/db.js');
const { db } = await import('../server/db/connection.js');
const { hashPassword } = await import('../server/auth.js');
const { formatDate, shiftDate, dayKey, weekdayOf } = await import('../server/dates.js');
const { dayWorkoutName } = await import('../server/plan-week.js');
const { normalizeProgram, flattenDays } = await import('../server/program/program.js');
const programRun = await import('../server/services/program-run.js');
const { readinessReport } = await import('../server/services/session-plan.js');

const {
  createUser,
  setUserGoal,
  setUserSex,
  setUserBirthYear,
  createCoachInvite,
  acceptCoachInvite,
  addMessage,
  addComment,
  assignPlan,
  resolvePlanAssignment,
  addPlan,
  getPlan,
  setActivePlan,
  addWorkout,
  saveWorkoutFeedback,
  saveCheckin,
  addWeightEntry,
  saveMeasurements,
  addWaterEntry,
  addNutritionEntry,
  saveNutritionGoal,
  saveWaterGoal,
  createCoachMeal,
  logCoachMeal,
  addProgramPlan,
  getProgramState,
  getCollection,
} = dbApi;

/* ======================================================================
   Segédek: dátum, véletlen, időbélyeg
   ====================================================================== */

const argToday = process.argv.indexOf('--today');
const TODAY =
  argToday > 0 && /^\d{4}\.\d{2}\.\d{2}$/.test(process.argv[argToday + 1] ?? '')
    ? process.argv[argToday + 1]
    : formatDate(new Date());
const DAYS = 56; // 8 hét, a mai nappal együtt
const LAST = DAYS - 1; // a mai nap indexe
const START = shiftDate(TODAY, -LAST);
const dateOf = (i) => shiftDate(START, i);
const weekday = (i) => weekdayOf(dayKey(dateOf(i))); // 0 = hétfő

/* Rögzített magú véletlen (mulberry32): újrafuttatva ugyanaz az adat. */
let seed = 20261113;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p) => rnd() < p;
const between = (a, b) => a + rnd() * (b - a);
const intBetween = (a, b) => Math.floor(between(a, b + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const round1 = (x) => Math.round(x * 10) / 10;
const plate = (x) => Math.max(0, Math.round(x / 2.5) * 2.5);

/** "ÉÉÉÉ.HH.NN" + helyi óra:perc → az SQLite datetime('now') UTC alakja. */
const stamp = (date, hh, mm = 0) => {
  const [y, m, d] = date.split('.').map(Number);
  return new Date(y, m - 1, d, hh, mm, intBetween(0, 59))
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
};

const setStamp = (table, column, id, value) =>
  db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(value, id);
const lastId = (table) => db.prepare(`SELECT MAX(id) AS id FROM ${table}`).get().id;

/* ======================================================================
   Edzés-alakok (a napló szett-alakja)
   ====================================================================== */

const work = (reps, weight, rpe = '') => ({
  reps: String(reps),
  weight: String(weight),
  rpe: String(rpe),
  type: 'work',
  done: true,
});
const warm = (reps, weight) => ({ ...work(reps, weight), type: 'warmup' });
const cardio = (minutes, intensity) => ({
  duration: String(Math.round(minutes * 60)),
  intensity,
  weight: '',
  done: true,
});
const exercise = (name, sets) => ({ name, pr: false, superset: false, sets });
/** Terv-szett: kitöltendő sor (done: false), mint a terv-építőben. */
const planSet = (reps, weight) => ({
  reps: String(reps),
  weight: String(weight),
  rpe: '',
  type: 'work',
  done: false,
});
const planEx = (name, count, reps, weight) =>
  exercise(
    name,
    Array.from({ length: count }, () => planSet(reps, weight)),
  );
const planCardio = (name, minutes, intensity) =>
  exercise(name, [{ duration: String(minutes * 60), intensity, weight: '', done: false }]);

/* ======================================================================
   Étel-katalógus
   ====================================================================== */

const FOODS = new Map((getCollection('foods') || []).map((f) => [f.name, f]));
const food = (name) => {
  const f = FOODS.get(name);
  if (!f) throw new Error(`Nincs ilyen étel a katalógusban: ${name}`);
  return f;
};

/** Egy étkezés tételei a naplóba, a megadott helyi időponttal. */
function logMeal(userId, date, items, hh) {
  items.forEach(([name, grams], k) => {
    const g = Math.round(grams * between(0.9, 1.1));
    const { entry } = addNutritionEntry(userId, food(name), date, g);
    setStamp('nutrition_log', 'created_at', entry.id, stamp(date, hh, 5 + k * 2));
  });
}

/** A napi víz kortyonként, napközben szétterítve. */
function logWater(userId, date, totalMl, untilHour = 21) {
  let left = Math.round(totalMl / 50) * 50;
  let hour = 8;
  while (left > 0) {
    const ml = Math.min(left, pick([250, 330, 500, 500, 750]));
    addWaterEntry(userId, date, ml);
    setStamp('water_log', 'logged_at', lastId('water_log'), stamp(date, Math.min(hour, untilHour)));
    left -= ml;
    hour += intBetween(1, 3);
  }
}

function logWeight(userId, date, kg) {
  addWeightEntry(userId, round1(kg), date);
  setStamp('weight_log', 'created_at', lastId('weight_log'), stamp(date, 7, intBetween(0, 30)));
}

function logCheckin(userId, date, fields, hh = 7) {
  saveCheckin(userId, date, fields);
  db.prepare('UPDATE checkins SET updated_at = ? WHERE user_id = ? AND date = ?').run(
    stamp(date, hh, intBetween(5, 50)),
    userId,
    date,
  );
}

/** Edzés mentése a végpont útján (PR + program-léptetés), az adott nap dátumával. */
function logWorkout(userId, date, name, exercises, planId, hh) {
  const saved = addWorkout(userId, name, date, exercises, planId);
  programRun.onWorkoutSaved(userId, saved, date);
  setStamp('workouts', 'created_at', saved.id, stamp(date, hh, intBetween(0, 50)));
  return saved;
}

function feedback(userId, workout, date, hh, { difficulty, mood, note = null }) {
  saveWorkoutFeedback(userId, workout.id, { difficulty, mood, note });
  setStamp('workouts', 'feedback_at', workout.id, stamp(date, hh + 1, intBetween(30, 59)));
}

/* ======================================================================
   Fiókok és kapcsolatok
   ====================================================================== */

const hash = await hashPassword(PASSWORD);
function account(username, displayName, { goal, sex, birthYear }) {
  const { user } = createUser(username, displayName, hash);
  if (goal) setUserGoal(user.id, goal);
  setUserSex(user.id, sex);
  setUserBirthYear(user.id, birthYear);
  db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(
    stamp(START, 9, intBetween(0, 59)),
    user.id,
  );
  return user.id;
}

const COACH = account('edzo', 'Szabó Márton', { goal: 'strength', sex: 'male', birthYear: 1988 });
const BENCE = account('bence', 'Nagy Bence', { goal: 'strength', sex: 'male', birthYear: 1999 });
const REKA = account('reka', 'Kiss Réka', { goal: 'cut', sex: 'female', birthYear: 2001 });
const DAVID = account('david', 'Tóth Dávid', { goal: 'mass', sex: 'male', birthYear: 2003 });

function link(athleteId, dayIdx) {
  const { id } = createCoachInvite(COACH, athleteId);
  acceptCoachInvite(id);
  db.prepare('UPDATE coach_links SET created_at = ?, responded_at = ? WHERE id = ?').run(
    stamp(dateOf(dayIdx), 10, 0),
    stamp(dateOf(dayIdx), 12, 30),
    id,
  );
  return id;
}
const LINK = { bence: link(BENCE, 0), reka: link(REKA, 0), david: link(DAVID, 0) };

/** Üzenet a szálba, megadott időponttal; `read` = a címzett elolvasta. */
function message(linkId, senderId, dayIdx, hh, mm, body, read = true) {
  const { id } = addMessage(linkId, senderId, body);
  const date = dateOf(dayIdx);
  db.prepare('UPDATE messages SET created_at = ?, read_at = ? WHERE id = ?').run(
    stamp(date, hh, mm),
    read ? stamp(date, Math.min(hh + 1, 23), mm) : null,
    id,
  );
}

function comment(authorId, subjectId, workoutId, exIndex, dayIdx, hh, text) {
  addComment(authorId, subjectId, 'exercise', `${workoutId}:${exIndex}`, text);
  setStamp(
    'comments',
    'created_at',
    lastId('comments'),
    stamp(dateOf(dayIdx), hh, intBetween(0, 59)),
  );
}

/** Edzői terv: az edző saját tervként menti, majd kiosztja; a sportoló elfogadja. */
function coachPlan(linkId, athleteId, dayIdx, name, week, note) {
  const date = dateOf(dayIdx);
  const own = addPlan(COACH, name, date, week);
  setActivePlan(COACH, own.id, false, date); // az edzőnek ez sablon, nem saját edzésterve
  const offer = assignPlan(linkId, { name, week, note });
  resolvePlanAssignment(offer.id, 'accepted');
  db.prepare('UPDATE plan_assignments SET created_at = ?, responded_at = ? WHERE id = ?').run(
    stamp(date, 11, 0),
    stamp(date, 18, 20),
    offer.id,
  );
  const plan = addPlan(athleteId, name, date, week, offer.id);
  setActivePlan(athleteId, plan.id, true, date);
  return getPlan(athleteId, plan.id);
}

/** A check-in izomláz-térképe az előző napi edzés izmaiból. */
const sorenessFrom = (muscles, lo, hi) =>
  Object.fromEntries(muscles.map((m) => [m, intBetween(lo, hi)]));

/* ======================================================================
   1. NAGY BENCE — erőemelő, saját 5/3/1-es blokkos program
   ----------------------------------------------------------------------
   Az első másfél hét szabad, nehéz edzés (ebből lesznek az 1RM-ek), utána
   aktiválja a 4 hetes, heti 4 napos 5/3/1-et. Az első ciklus végén a
   szabály TM-et javasol, ő jóváhagyja, a második ciklus most is fut.
   ====================================================================== */

const pctTm = (p) => ({ t: 'op', op: '*', a: { t: 'num', v: p, pct: true }, b: { t: 'tm' } });
const WAVES = [
  {
    label: '1. hét – 5-ös',
    sets: [
      [5, 65],
      [5, 75],
      [5, 85, true],
    ],
  },
  {
    label: '2. hét – 3-as',
    sets: [
      [3, 70],
      [3, 80],
      [3, 90, true],
    ],
  },
  {
    label: '3. hét – 5/3/1',
    sets: [
      [5, 75],
      [3, 85],
      [1, 95, true],
    ],
  },
  {
    label: '4. hét – deload',
    sets: [
      [5, 40],
      [5, 50],
      [5, 60],
    ],
  },
];
const BENCE_DAYS = [
  {
    name: 'Guggolásnap',
    main: 'Guggolás',
    acc: [
      ['Román felhúzás', 3, 8],
      ['Kitörés', 3, 10],
      ['Kábeles hasprés', 3, 15],
    ],
  },
  {
    name: 'Fekvenyomásnap',
    main: 'Fekvenyomás',
    acc: [
      ['Kézisúlyzós hajolt evezés', 4, 10],
      ['Tolódzkodás', 3, 10],
      ['Tricepsz nyújtás', 3, 12],
    ],
  },
  {
    name: 'Felhúzásnap',
    main: 'Felhúzás',
    acc: [
      ['Csípőtolás', 3, 10],
      ['Kábeles lehúzás', 4, 10],
      ['Kábeles hasprés', 3, 15],
    ],
  },
  {
    name: 'Vállnap',
    main: 'Katonai nyomás',
    acc: [
      ['Húzódzkodás', 4, 8],
      ['Oldalemelés', 3, 15],
      ['Bicepsz hajlítás', 3, 12],
    ],
  },
];
/** Kiegészítők munkasúlya: kezdő kg és heti emelés. A testsúlyosoknál a ráakasztott súly. */
const ACC_LOAD = {
  'Román felhúzás': [100, 2.5],
  Kitörés: [40, 1.25],
  'Kábeles hasprés': [35, 1.25],
  'Kézisúlyzós hajolt evezés': [36, 1],
  Tolódzkodás: [10, 1.25],
  'Tricepsz nyújtás': [25, 0.6],
  Csípőtolás: [120, 2.5],
  'Kábeles lehúzás': [65, 1.25],
  Húzódzkodás: [5, 1.25],
  Oldalemelés: [10, 0.3],
  'Bicepsz hajlítás': [35, 0.6],
};
/** Bence „valódi" 1RM-je a 0. napon; heti ~0,6%-kal erősödik. */
const BENCE_TRUE = { Guggolás: 160, Fekvenyomás: 115, Felhúzás: 190, 'Katonai nyomás': 72.5 };
const trueMax = (lift, i) => BENCE_TRUE[lift] * (1 + 0.0009 * i);
/** Ennyi ismétlés megy a súllyal (Epley visszafelé), a napi formával. */
const repsAt = (lift, i, weight, form) =>
  Math.max(1, Math.floor(30 * (trueMax(lift, i) / weight - 1) + form));

const BENCE_PROGRAM = (() => {
  const raw = {
    weeks: WAVES.map((w) => ({
      label: w.label,
      days: BENCE_DAYS.map((d) => ({
        name: d.name,
        exercises: [
          {
            name: d.main,
            role: 'main',
            sets: w.sets.map(([reps, p, amrap]) => ({
              count: 1,
              reps,
              amrap: Boolean(amrap),
              weight: pctTm(p),
            })),
          },
          ...d.acc.map(([name, count, reps]) => ({
            name,
            role: 'accessory',
            sets: [{ count, reps, amrap: false, weight: null }],
          })),
        ],
      })),
    })),
    rules: [
      {
        on: 'cycle',
        when: { t: 'record' },
        then: {
          t: 'set',
          formula: { t: 'op', op: '*', a: { t: 'num', v: 95, pct: true }, b: { t: 'newOrm' } },
        },
        otherwise: { t: 'step' },
      },
    ],
    steps: {},
  };
  const { program, error } = normalizeProgram(raw);
  if (error) throw new Error(`A demó program érvénytelen: ${error}`);
  return program;
})();

/** A szabad (program előtti) nehéz edzések: [nap, név, fő gyakorlat, kiegészítők]. */
const BENCE_FREE = [
  [0, 'Guggolás – nehéz hármasok', 'Guggolás', ['Román felhúzás', 'Kábeles hasprés']],
  [3, 'Fekvenyomás – nehéz hármasok', 'Fekvenyomás', ['Kézisúlyzós hajolt evezés', 'Tolódzkodás']],
  [5, 'Felhúzás – nehéz hármasok', 'Felhúzás', ['Kábeles lehúzás', 'Csípőtolás']],
  [7, 'Váll + hát', 'Katonai nyomás', ['Húzódzkodás', 'Oldalemelés', 'Bicepsz hajlítás']],
];
const MAIN_MUSCLES = {
  Guggolás: ['quads', 'glutes', 'hamstrings'],
  Fekvenyomás: ['chest', 'triceps', 'shoulders'],
  Felhúzás: ['hamstrings', 'lowerBack', 'glutes', 'back'],
  'Katonai nyomás': ['shoulders', 'triceps', 'back'],
};
const BENCE_NOTES = [
  'Jól ment, a bemelegítés után könnyűnek éreztem.',
  'Az AMRAP-nál az utolsó kettő nehéz volt, de tiszta.',
  'Kicsit fáradt voltam, a kiegészítőket rövidebb pihenővel csináltam.',
  'Új rekord! 💪',
  'A deload jólesett, friss vagyok.',
  null,
  null,
];

function accessorySets(name, count, reps, i) {
  const [start, perWeek] = ACC_LOAD[name] ?? [20, 0.5];
  const kg = plate(start + (perWeek * i) / 7);
  return Array.from({ length: count }, (_, k) =>
    work(k === count - 1 && chance(0.3) ? reps - 1 : reps, kg, pick([7, 8, 8, 9])),
  );
}

function seedBence() {
  const id = BENCE;
  let plan = null;
  const workouts = [];
  let lastMuscles = [];

  for (let i = 0; i <= LAST; i++) {
    const date = dateOf(i);
    const wd = weekday(i);

    // Testsúly: 87,5 → 89 kg lassú tömegnövelés
    if (chance(0.8) || i === LAST)
      logWeight(id, date, 87.5 + (1.5 * i) / LAST + between(-0.4, 0.4));

    // Check-in: jó alvás, alacsony stressz — magas készenlét
    if (chance(0.9) || i >= LAST - 2) {
      logCheckin(id, date, {
        sleepHours: round1(between(7, 8.6)),
        sleepQuality: intBetween(3, 5),
        energy: intBetween(3, 5),
        stress: intBetween(1, 3),
        mood: intBetween(4, 5),
        soreness: lastMuscles.length ? sorenessFrom(lastMuscles, 2, 5) : {},
        pain: i === LAST - 1 ? { lowerBack: 3 } : {},
      });
    }
    lastMuscles = [];

    // Víz és táplálkozás (~3000 kcal, 180 g fehérje)
    logWater(id, date, between(2600, 3600), i === LAST ? 10 : 21);
    if (chance(0.7) || i === LAST) {
      logMeal(
        id,
        date,
        [
          ['Zabpehely', 100],
          ['Tej 2,8%', 300],
          ['Banán', 120],
        ],
        7,
      );
      if (i < LAST) {
        logMeal(
          id,
          date,
          [
            ['Csirkemell (sült)', 250],
            ['Basmati rizs (főtt)', 300],
            ['Brokkoli', 150],
          ],
          13,
        );
        logMeal(
          id,
          date,
          [
            ['Tejsavó fehérjepor (whey)', 35],
            ['Mogyoróvaj', 30],
          ],
          16,
        );
        logMeal(
          id,
          date,
          pick([
            [
              ['Marha darált hús (5%)', 200],
              ['Tészta (főtt)', 300],
            ],
            [
              ['Lazac (nyers)', 200],
              ['Burgonya (főtt)', 350],
            ],
            [
              ['Pulykamell (nyers)', 220],
              ['Fehér rizs (főtt)', 300],
            ],
          ]),
          19,
        );
        if (chance(0.5)) logMeal(id, date, [['Görög joghurt 2%', 200]], 21);
      }
    }

    // A mai nap üres: a bemutatón élőben lehet rögzíteni a mai programnapot
    if (i === LAST) continue;

    // Szabad, nehéz edzések az első másfél hétben
    const free = BENCE_FREE.find(([d]) => d === i);
    if (free) {
      const [, name, lift, accs] = free;
      const top = plate(trueMax(lift, i) * 0.9);
      const exs = [
        exercise(lift, [
          warm(10, 20),
          warm(5, plate(top * 0.5)),
          warm(3, plate(top * 0.7)),
          work(3, top, 8),
          work(3, top, 8.5),
          work(3, top, 9),
        ]),
        ...accs.map((a) => {
          const def = BENCE_DAYS.flatMap((d) => d.acc).find(([n]) => n === a);
          return exercise(a, accessorySets(a, def[1], def[2], i));
        }),
      ];
      const saved = logWorkout(id, date, name, exs, null, 17);
      workouts.push({ saved, i });
      lastMuscles = MAIN_MUSCLES[lift];
      continue;
    }

    // Aktiválás a 10. napon: TM = az 1RM 90%-a (amit a felület is javasol)
    if (i === 10) {
      plan = addProgramPlan(id, 'Erő 5/3/1 – 4 nap', dateOf(9), BENCE_PROGRAM);
      db.prepare('UPDATE plans SET created_at = ? WHERE id = ?').run(
        stamp(dateOf(9), 20, 15),
        plan.id,
      );
      const needs = programRun.activationNeeds(id, plan);
      const trainingMaxes = Object.fromEntries(
        needs.trainingMaxes.map((n) => [n.exercise, n.suggested]),
      );
      const res = programRun.activateProgram(id, plan, { trainingMaxes }, date);
      if (res.error) throw new Error(`A program aktiválása nem sikerült: ${res.error}`);
    }
    if (!plan) continue;

    // Programnapok: hétfő, kedd, csütörtök, péntek — néha kimarad egy
    if (![0, 1, 3, 4].includes(wd) || (i > 10 && chance(0.08))) continue;

    plan = getPlan(id, plan.id);
    let tpl = programRun.programTemplate(id, plan, date);
    if (tpl.source === 'program-review') {
      // Ciklus vége: a szabály TM-javaslatát változtatás nélkül jóváhagyja
      programRun.approveReview(id, plan, {}, date);
      tpl = programRun.programTemplate(id, plan, date);
    }
    if (tpl.source !== 'program') throw new Error(`Váratlan programállapot: ${tpl.source}`);

    const form = between(-1.5, 1.5);
    const exs = tpl.exercises.map((e) => {
      if (e.role !== 'main') {
        return exercise(e.name, accessorySets(e.name, e.sets.length, Number(e.sets[0].reps), i));
      }
      const first = Number(e.sets[0].weight);
      const sets = [warm(10, 20), warm(5, plate(first * 0.6))];
      for (const s of e.sets) {
        const kg = Number(s.weight);
        if (s.amrap) {
          const reps = Math.max(Number(s.reps), repsAt(e.name, i, kg, form));
          sets.push({ ...work(reps, kg, reps >= Number(s.reps) + 4 ? 9.5 : 9), amrap: s.amrap });
        } else {
          sets.push(work(s.reps, kg, kg / first > 0.8 ? 8 : 7));
        }
      }
      return exercise(e.name, sets);
    });
    const saved = logWorkout(id, date, tpl.name, exs, plan.id, 17);
    workouts.push({ saved, i });
    lastMuscles = MAIN_MUSCLES[exs[0].name];

    if (chance(0.55)) {
      feedback(id, saved, date, 18, {
        difficulty: intBetween(3, 4),
        mood: intBetween(4, 5),
        note: saved.exercises[0].pr ? 'Új rekord! 💪' : pick(BENCE_NOTES),
      });
    }
  }

  // Testméretek kéthetente
  for (const [k, i] of [0, 14, 28, 42, LAST - 1].entries()) {
    saveMeasurements(id, dateOf(i), {
      chest: round1(108 + k * 0.4 + between(-0.2, 0.2)),
      arm: round1(40 + k * 0.25 + between(-0.1, 0.1)),
      waist: round1(86 + k * 0.15 + between(-0.3, 0.3)),
      thigh: round1(64 + k * 0.3),
      bodyfat: round1(16 + between(-0.3, 0.3)),
    });
  }

  saveNutritionGoal(id, 'own', { calories: 3100, protein: 180 }, id);

  // Üzenetek
  const L = LINK.bence;
  message(
    L,
    COACH,
    1,
    9,
    10,
    'Szia Bence! Örülök, hogy itt vagy. Az első két hétben dolgozz nehéz hármasokkal, abból számoljuk az 1RM-eket.',
  );
  message(L, BENCE, 1, 12, 40, 'Rendben, holnap jön a guggolás. A program majd 5/3/1 lesz?');
  message(
    L,
    COACH,
    1,
    13,
    2,
    'Igen, 4 hetes blokk, a TM az 1RM 90%-a. A ciklus végén a rendszer javasol új TM-et, azt hagyd jóvá.',
  );
  message(
    L,
    BENCE,
    10,
    19,
    5,
    'Aktiváltam a programot, az első guggolásnap megvolt. Könnyűnek tűnt 🙂',
  );
  message(
    L,
    COACH,
    10,
    20,
    30,
    'Az első hét pont ilyen. Az AMRAP-nál maradjon 1-2 ismétlés tartalékban.',
  );
  const review = flattenDays(BENCE_PROGRAM).length;
  const cycleEnd = workouts.filter((w) => w.saved.planId === plan.id)[review - 1]?.i ?? 40;
  message(
    L,
    COACH,
    cycleEnd + 1,
    8,
    45,
    'Gratulálok az első ciklushoz! Guggolásban és felhúzásban is rekord volt az AMRAP-on. Az új TM-ek mehetnek.',
  );
  message(L, BENCE, cycleEnd + 1, 10, 12, 'Köszi! Jóváhagytam, indul a második kör.');
  message(
    L,
    BENCE,
    LAST - 1,
    21,
    3,
    'A derekam kicsit merev ma este. A holnapi felhúzásnapot csináljam?',
  );
  message(
    L,
    COACH,
    LAST - 1,
    21,
    40,
    'Ha reggel a check-inben 4 alatt van a fájdalom, mehet. A kiegészítőket vedd lejjebb, és jelezd, hogy ment.',
  );

  // Az edző megjegyzése egy rekordos fő gyakorlathoz
  const prDay = workouts
    .filter((w) => w.saved.planId === plan?.id && w.saved.exercises[0].pr)
    .at(-1);
  if (prDay) {
    comment(
      COACH,
      id,
      prDay.saved.id,
      0,
      prDay.i,
      20,
      'Szép AMRAP! A videón a lockoutnál kicsit hátradőlsz — tartsd semlegesen a törzset.',
    );
    comment(id, id, prDay.saved.id, 0, prDay.i, 21, 'Köszi, legközelebb figyelek rá!');
  }
  return plan;
}

/* ======================================================================
   2. KISS RÉKA — fogyás, az edző heti 3+1 napos terve és étrendje
   ====================================================================== */

const REKA_A = [
  ['Guggolás', 3, 10, 40, 1.4],
  ['Kézisúlyzós fekvenyomás', 3, 10, 12, 0.3],
  ['Kábeles lehúzás', 3, 12, 35, 0.6],
  ['Csípőtolás', 3, 12, 50, 2],
  ['Kábeles hasprés', 3, 15, 20, 0.5],
];
const REKA_B = [
  ['Román felhúzás', 3, 10, 35, 1.4],
  ['Kézisúlyzós ülő vállból nyomás', 3, 10, 8, 0.25],
  ['Kábeles ülő evezés', 3, 12, 35, 0.6],
  ['Kitörés', 3, 10, 16, 0.6],
  ['Oldalemelés', 3, 15, 4, 0.15],
];
const toPlan = (rows) => rows.map(([name, count, reps, kg]) => planEx(name, count, reps, kg));
const REKA_WEEK = [
  { type: 'workout', name: 'Teljes test A', exercises: toPlan(REKA_A) },
  { type: 'rest' },
  { type: 'workout', name: 'Teljes test B', exercises: toPlan(REKA_B) },
  { type: 'rest' },
  { type: 'same', of: 0 },
  { type: 'workout', name: 'Kardió', exercises: [planCardio('Futás', 35, 'moderate')] },
  { type: 'rest' },
];
const REKA_MUSCLES = {
  'Teljes test A': ['quads', 'glutes', 'chest', 'back'],
  'Teljes test B': ['hamstrings', 'glutes', 'shoulders', 'back'],
  Kardió: ['quads', 'calves'],
};

function seedReka() {
  const id = REKA;
  const plan = coachPlan(
    LINK.reka,
    id,
    1,
    'Szálkásítás – teljes test',
    REKA_WEEK,
    'Heti 3 erőedzés + 1 futás. A súlyokat akkor emeld, ha minden szett tisztán megvan.',
  );

  // Edzői cél és étrend (~1750 kcal)
  saveNutritionGoal(id, 'coach', { calories: 1750, protein: 125 }, COACH);
  saveWaterGoal(id, 2500, COACH);
  const meal = (name, items) =>
    createCoachMeal(
      id,
      COACH,
      { name, items: items.map(([f, grams]) => ({ food: food(f), grams })) },
      dateOf(1),
    );
  meal('Reggeli', [
    ['Zabpehely', 50],
    ['Görög joghurt 2%', 150],
    ['Banán', 80],
  ]);
  meal('Ebéd', [
    ['Csirkemell (sült)', 140],
    ['Basmati rizs (főtt)', 150],
    ['Brokkoli', 200],
  ]);
  meal('Vacsora', [
    ['Lazac (nyers)', 130],
    ['Édesburgonya (főtt)', 180],
  ]);
  const meals = db
    .prepare('SELECT id, name FROM coach_meals WHERE user_id = ? ORDER BY position')
    .all(id);
  const mealHour = { Reggeli: 7, Ebéd: 12, Vacsora: 19 };

  let lastMuscles = [];
  let firstA = null;
  for (let i = 0; i <= LAST; i++) {
    const date = dateOf(i);
    const wd = weekday(i);

    // Testsúly: 68,6 → 64,9 kg
    if (chance(0.85)) logWeight(id, date, 68.6 - (3.7 * i) / LAST + between(-0.3, 0.3));

    // Check-in — a mait még nem töltötte ki (a bemutatón élőben lehet)
    if (i < LAST && chance(0.88)) {
      logCheckin(
        id,
        date,
        {
          sleepHours: round1(between(6.6, 8.2)),
          sleepQuality: intBetween(3, 5),
          energy: intBetween(3, 4),
          stress: intBetween(2, 3),
          mood: intBetween(3, 5),
          soreness: lastMuscles.length ? sorenessFrom(lastMuscles, 2, 4) : {},
          pain: {},
        },
        6,
      );
    }
    lastMuscles = [];

    // Víz és étrend: a mai napon csak a reggeli és egy pohár víz
    logWater(id, date, i === LAST ? 500 : between(1900, 2800), i === LAST ? 9 : 21);
    if (i >= 1 && (chance(0.88) || i === LAST)) {
      for (const m of meals) {
        if (i === LAST && m.name !== 'Reggeli') continue;
        if (m.name !== 'Reggeli' && chance(0.08)) continue;
        const { entries } = logCoachMeal(id, m.id, date);
        const at = stamp(date, mealHour[m.name], 10);
        for (const e of entries) setStamp('nutrition_log', 'created_at', e.id, at);
        db.prepare('UPDATE coach_meal_logs SET logged_at = ? WHERE meal_id = ? AND date = ?').run(
          at,
          m.id,
          date,
        );
      }
      if (i < LAST) {
        logMeal(
          id,
          date,
          pick([[['Alma', 150]], [['Sovány túró', 150]], [['Fehérjeszelet', 50]]]),
          16,
        );
      }
    }

    if (i < 1 || i === LAST) continue;
    const entry = REKA_WEEK[wd];
    if (entry.type === 'rest' || chance(0.1)) continue;
    const name = dayWorkoutName(plan, wd);
    let exs;
    if (name === 'Kardió') {
      const run = chance(0.7);
      exs = [
        exercise(run ? 'Futás' : 'Szobabicikli', [
          cardio(run ? between(28, 40) : between(35, 45), pick(['moderate', 'moderate', 'high'])),
        ]),
      ];
    } else {
      const rows = name === 'Teljes test A' ? REKA_A : REKA_B;
      exs = rows.map(([ex, count, reps, kg, perWeek]) => {
        const w = Math.round((kg + (perWeek * i) / 7) * 2) / 2;
        const sets = Array.from({ length: count }, (_, k) =>
          work(k === count - 1 && chance(0.25) ? reps - 2 : reps, w, pick([7, 7.5, 8])),
        );
        return exercise(
          ex,
          ex === 'Guggolás' || ex === 'Román felhúzás' ? [warm(12, 20), ...sets] : sets,
        );
      });
    }
    const saved = logWorkout(id, date, name, exs, plan.id, 7);
    lastMuscles = REKA_MUSCLES[name] ?? [];
    if (name === 'Teljes test A' && i > 20 && !firstA) firstA = { saved, i };
    if (chance(0.6)) {
      feedback(id, saved, date, 7, {
        difficulty: intBetween(2, 4),
        mood: intBetween(3, 5),
        note: pick([
          null,
          null,
          'Ment minden szett 🙂',
          'Kicsit éhes voltam edzés előtt.',
          'A futás nagyon jólesett.',
        ]),
      });
    }
  }

  // Testméretek kéthetente: a derék és a csípő is fogy
  for (const [k, i] of [0, 14, 28, 42, LAST - 2].entries()) {
    saveMeasurements(id, dateOf(i), {
      waist: round1(76 - k * 1.1 + between(-0.2, 0.2)),
      hip: round1(101 - k * 0.7 + between(-0.2, 0.2)),
      thigh: round1(58.5 - k * 0.5),
      arm: round1(28.5 - k * 0.2),
      bodyfat: round1(27.5 - k * 0.8 + between(-0.2, 0.2)),
    });
  }

  if (firstA) {
    comment(id, id, firstA.saved.id, 0, firstA.i, 8, 'A 3. szettnél kicsit húzott a bal térdem.');
    comment(
      COACH,
      id,
      firstA.saved.id,
      0,
      firstA.i,
      12,
      'Legközelebb hosszabb bemelegítés, és figyelj, hogy a térd a lábujjak irányába menjen. Ha marad, szólj!',
    );
  }

  const L = LINK.reka;
  message(
    L,
    COACH,
    1,
    11,
    5,
    'Szia Réka! Kiküldtem a heti tervet és az étrendet, a cél 1750 kcal és 125 g fehérje.',
  );
  message(L, REKA, 1, 18, 20, 'Szuper, köszönöm! Elfogadtam a tervet, hétfőn kezdek.');
  message(L, REKA, 15, 20, 10, 'Két hét alatt -1,3 kg! Az étrend teljesen jól tartható.');
  message(
    L,
    COACH,
    15,
    21,
    0,
    'Szép munka! A guggolásban emelhetsz 2,5 kg-ot, ha minden ismétlés tiszta.',
  );
  message(
    L,
    COACH,
    29,
    9,
    30,
    'Négy hét alatt a derekad is 2 cm-t ment lejjebb, nagyon jó a tempó 👏',
  );
  message(L, REKA, 29, 12, 15, 'Köszi! Érzem, hogy a lépcsőn is könnyebb.');
  message(
    L,
    REKA,
    LAST - 1,
    19,
    45,
    'Szombaton családi program lesz. A futást áttehetem vasárnapra?',
    false,
  );
  return plan;
}

/* ======================================================================
   3. TÓTH DÁVID — tömegnövelés, felső/alsó. Hat hétig jól halad, az utolsó
   két hétben a vizsgaidőszak miatt romlik az alvás és kimaradnak az edzések
   — az edzői panelen riasztással jelenik meg.
   ====================================================================== */

const DAVID_UPPER_A = [
  ['Fekvenyomás', 4, 8, 70, 1.25],
  ['Kézisúlyzós hajolt evezés', 4, 10, 26, 0.6],
  ['Kézisúlyzós ülő vállból nyomás', 3, 10, 18, 0.4],
  ['Bicepsz hajlítás', 3, 12, 27.5, 0.4],
];
const DAVID_LOWER_A = [
  ['Guggolás', 4, 8, 80, 1.5],
  ['Román felhúzás', 3, 10, 70, 1.25],
  ['Lábtolós vádliemelés', 3, 15, 100, 1.5],
  ['Kábeles hasprés', 3, 15, 30, 0.5],
];
const DAVID_UPPER_B = [
  ['Ferde fekvenyomás', 4, 10, 55, 1],
  ['Húzódzkodás', 4, 8, 0, 0],
  ['Oldalemelés', 3, 15, 8, 0.2],
  ['Tricepsz nyújtás', 3, 12, 20, 0.4],
];
const DAVID_LOWER_B = [
  ['Felhúzás', 3, 6, 100, 1.75],
  ['Kitörés', 3, 10, 30, 0.75],
  ['Csípőtolás', 3, 10, 80, 2],
  ['Kábeles hasprés', 3, 15, 30, 0.5],
];
const DAVID_WEEK = [
  { type: 'workout', name: 'Felső A', exercises: toPlan(DAVID_UPPER_A) },
  { type: 'workout', name: 'Alsó A', exercises: toPlan(DAVID_LOWER_A) },
  { type: 'rest' },
  { type: 'workout', name: 'Felső B', exercises: toPlan(DAVID_UPPER_B) },
  { type: 'workout', name: 'Alsó B', exercises: toPlan(DAVID_LOWER_B) },
  { type: 'rest' },
  { type: 'rest' },
];
const DAVID_ROWS = {
  'Felső A': [DAVID_UPPER_A, ['chest', 'back', 'shoulders', 'biceps']],
  'Alsó A': [DAVID_LOWER_A, ['quads', 'glutes', 'hamstrings']],
  'Felső B': [DAVID_UPPER_B, ['chest', 'back', 'triceps']],
  'Alsó B': [DAVID_LOWER_B, ['hamstrings', 'glutes', 'lowerBack', 'quads']],
};

function seedDavid() {
  const id = DAVID;
  const plan = coachPlan(
    LINK.david,
    id,
    0,
    'Tömegnövelés – felső/alsó',
    DAVID_WEEK,
    'Heti 4 edzés, 8–12-es tartomány. Kalóriatöbblet nélkül nem fog menni, egyél rendesen!',
  );
  saveNutritionGoal(id, 'coach', { calories: 3200, protein: 160 }, COACH);

  const BAD = LAST - 13; // innentől a vizsgaidőszak
  const LAST_WORKOUT = LAST - 8; // ezután már nem edzett
  /* Ma reggel kitöltötte a check-int — rossz értékekkel. Enélkül a 8 nap
     pihenés miatt a készenlét magas lenne, és a kártya ellentmondana a
     riasztásnak. */
  const LAST_CHECKIN = LAST;
  // A vizsgák alatt csak két edzés: az időszak első és utolsó edzésnapján
  const badDays = [];
  for (let i = BAD; i <= LAST_WORKOUT; i++) {
    if (DAVID_WEEK[weekday(i)].type !== 'rest') badDays.push(i);
  }
  const BAD_WORKOUTS = [badDays[0], badDays.at(-1)];
  const KNEE = BAD_WORKOUTS[1]; // ezen az edzésen fájdult meg a térde
  let lastMuscles = [];

  for (let i = 0; i <= LAST; i++) {
    const date = dateOf(i);
    const wd = weekday(i);
    const bad = i >= BAD;

    // Testsúly: hat hétig nő, utána megáll, kicsit visszaesik
    const kg = bad ? 76.1 - (i - BAD) * 0.05 : 73.8 + (2.3 * i) / BAD;
    if (chance(bad ? 0.3 : 0.65)) logWeight(id, date, kg + between(-0.35, 0.35));

    // Check-in: jó időszakban rendszeres, a vizsgák alatt ritkul és romlik
    if (i <= LAST_CHECKIN && chance(bad ? 0.6 : 0.8)) {
      logCheckin(
        id,
        date,
        bad
          ? {
              sleepHours: round1(between(4.6, 6)),
              sleepQuality: intBetween(1, 2),
              energy: intBetween(1, 2),
              stress: intBetween(4, 5),
              mood: intBetween(2, 3),
              soreness: lastMuscles.length ? sorenessFrom(lastMuscles, 3, 6) : {},
              pain: i > KNEE ? { quads: intBetween(5, 6), general: 3 } : {},
            }
          : {
              sleepHours: round1(between(6.8, 8.2)),
              sleepQuality: intBetween(3, 4),
              energy: intBetween(3, 4),
              stress: intBetween(2, 3),
              mood: intBetween(3, 4),
              soreness: lastMuscles.length ? sorenessFrom(lastMuscles, 3, 5) : {},
              pain: {},
            },
        8,
      );
    }
    if (i === LAST_CHECKIN) {
      // A mai check-in mindig meglegyen, rossz értékekkel
      logCheckin(id, date, {
        sleepHours: 4.9,
        sleepQuality: 1,
        energy: 2,
        stress: 5,
        mood: 2,
        soreness: {},
        pain: { quads: 6, general: 3 },
      });
    }
    lastMuscles = [];

    // Víz és étkezés — rendszertelen, a vizsgák alatt alig
    if (chance(bad ? 0.35 : 0.7))
      logWater(id, date, bad ? between(900, 1500) : between(1800, 2600));
    if (chance(bad ? 0.2 : 0.5)) {
      logMeal(
        id,
        date,
        [
          ['Teljes kiőrlésű kenyér', 120],
          ['Főtt tojás', 150],
          ['Trappista sajt', 40],
        ],
        8,
      );
      logMeal(
        id,
        date,
        pick([
          [
            ['Csirkecomb (bőr nélkül)', 250],
            ['Tészta (főtt)', 350],
          ],
          [
            ['Sertéskaraj', 200],
            ['Burgonyapüré', 300],
          ],
          [
            ['Hamburger (sajtos)', 230],
            ['Hasábburgonya', 150],
          ],
        ]),
        13,
      );
      if (chance(0.6))
        logMeal(
          id,
          date,
          [
            ['Tejsavó fehérjepor (whey)', 40],
            ['Banán', 120],
          ],
          18,
        );
    }

    // Edzések: a terv napjain; a vizsgák alatt csak kettő, aztán semmi
    if (i > LAST_WORKOUT || i === LAST) continue;
    const entry = DAVID_WEEK[wd];
    if (entry.type === 'rest') continue;
    if (bad ? !BAD_WORKOUTS.includes(i) : chance(0.12)) continue;

    const name = dayWorkoutName(plan, wd);
    const [rows, muscles] = DAVID_ROWS[name];
    const exs = rows.map(([ex, count, reps, kg0, perWeek]) => {
      const w = plate(kg0 + (perWeek * Math.min(i, BAD)) / 7);
      const tired = bad ? 2 : 0;
      const sets = Array.from({ length: count }, (_, k) =>
        work(
          Math.max(1, (k >= count - 2 && chance(0.3) ? reps - 1 : reps) - tired),
          w,
          bad ? 9 : pick([7, 8, 8]),
        ),
      );
      return exercise(ex, k0warm(ex, w, sets));
    });
    const saved = logWorkout(id, date, name, exs, plan.id, 18);
    lastMuscles = muscles;
    if (bad) {
      feedback(id, saved, date, 18, {
        difficulty: 5,
        mood: 2,
        note:
          i === KNEE
            ? 'Guggolásnál szúrt a térdem, a végét kihagytam.'
            : 'Nagyon fáradt vagyok, alig aludtam.',
      });
    } else if (chance(0.4)) {
      feedback(id, saved, date, 18, {
        difficulty: intBetween(3, 4),
        mood: intBetween(3, 4),
        note: pick([null, 'Jó pumpa 💪', 'Ment a progresszió.', null]),
      });
    }
  }

  for (const [k, i] of [0, 14, 28, 42].entries()) {
    saveMeasurements(id, dateOf(i), {
      chest: round1(96 + k * 0.6),
      arm: round1(34 + k * 0.35),
      waist: round1(78 + k * 0.3),
      thigh: round1(55 + k * 0.4),
    });
  }

  const L = LINK.david;
  message(
    L,
    COACH,
    0,
    12,
    40,
    'Szia Dávid! Kiküldtem a felső/alsó tervet. Heti 4 edzés, és figyelj a kalóriára!',
  );
  message(L, DAVID, 0, 19, 0, 'Köszi, elfogadtam! Hétfőn kezdek.');
  message(L, DAVID, 22, 20, 15, 'Felhúzásban megvolt a 100 kg 6-szor 😎');
  message(L, COACH, 22, 21, 0, 'Szép! Maradj a 6-os tartományban, ne told maximumra.');
  message(
    L,
    COACH,
    LAST - 3,
    9,
    15,
    'Szia Dávid! Látom, kimaradt pár edzés, és a check-injeid alapján nagyon keveset alszol. Minden rendben?',
  );
  message(
    L,
    DAVID,
    LAST - 3,
    22,
    50,
    'Vizsgaidőszak van, alig alszom 5 órát. A térdem is fáj a múlt heti guggolás óta.',
  );
  message(
    L,
    COACH,
    LAST - 2,
    7,
    30,
    'Értem. A vizsgák alatt elég heti 2 rövid felsőtestes edzés, lábat most ne. Ha a térd nem javul, nézesd meg.',
    false,
  );
  return plan;
}

/** A nehéz összetett gyakorlatok elé bemelegítő szett kerül. */
function k0warm(name, kg, sets) {
  if (!['Fekvenyomás', 'Guggolás', 'Felhúzás', 'Ferde fekvenyomás'].includes(name)) return sets;
  return [warm(10, 20), warm(5, plate(kg * 0.6)), ...sets];
}

/* ======================================================================
   Futtatás és összegzés
   ====================================================================== */

const bencePlan = seedBence();
seedReka();
seedDavid();

const count = (table, where = '') =>
  db.prepare(`SELECT COUNT(*) AS c FROM ${table} ${where}`).get().c;
const state = getProgramState(BENCE, bencePlan.id);

console.log(`\nBemutató-adatbázis kész: ${DEMO_DB}`);
console.log(`Időszak: ${START} – ${TODAY} (8 hét)\n`);
console.log('Fiókok (jelszó mindegyiknél: ' + PASSWORD + '):');
for (const [user, uid, role] of [
  ['edzo', COACH, 'edző — Szabó Márton'],
  ['bence', BENCE, 'erőemelő, 5/3/1 program'],
  ['reka', REKA, 'fogyás, edzői terv + étrend'],
  ['david', DAVID, 'tömegnövelés, lemaradóban (riasztás)'],
]) {
  const w = count('workouts', `WHERE user_id = ${uid}`);
  const c = count('checkins', `WHERE user_id = ${uid}`);
  const r = uid === COACH ? '' : `, készenlét ma: ${readinessReport(uid, TODAY).overall ?? '—'}`;
  console.log(
    `  ${user.padEnd(6)} ${role.padEnd(38)} ${String(w).padStart(2)} edzés, ${String(c).padStart(2)} check-in${r}`,
  );
}
console.log(
  `\nBence programja: ${state.cycle}. ciklus, ${state.pos + 1}. nap / ${flattenDays(BENCE_PROGRAM).length}`,
);
console.log('\nIndítás: npm run start:demo\n');
