/**
 * FitTrack Pro — a Recovery Engine unit-tesztjei
 * ----------------------------------------------
 * A beépített `node:test` futtatóval (`npm test`), nulla új függőséggel.
 * A motor tiszta függvényekből áll, ezért itt kitalált bemenetekkel a teljes
 * matematika ellenőrizhető — adatbázis és szerver nélkül.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeReadiness, sleepDurationScore, sleepScore, nutritionScore, epley1RM, BASE_WEIGHTS,
} from './recovery.js';
import { resolveExerciseLoad, isAxialLift, MUSCLE_KEYS } from './muscles.js';

/* ---- Segédek a teszt-adatokhoz ---- */

const TODAY = '2026.03.15';

/** `n` nappal ezelőtti dátum a TODAY-hez képest, "ÉÉÉÉ.HH.NN" alakban. */
function dateAgo(n) {
  const d = new Date(2026, 2, 15);
  d.setDate(d.getDate() - n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

const set = (reps, weight, rpe = 8, done = true) => ({ reps: String(reps), weight: String(weight), rpe: String(rpe), done });

const workout = (ago, name, exercises) => ({ id: ago, date: dateAgo(ago), name, exercises, planId: null });

const exercise = (name, sets, pr = false) => ({ name, pr, sets });

const fullCheckin = (overrides = {}) => ({
  date: TODAY,
  sleepHours: 8, sleepQuality: 4, energy: 4, stress: 2, mood: 4, hydration: 3,
  soreness: {}, pain: {},
  ...overrides,
});

const NUTRITION_GOAL = { calories: 2900, protein: 170 };
const NUTRITION = {
  today: { intake: 0, protein: 0, goal: NUTRITION_GOAL },
  yesterday: { intake: 2900, protein: 170, goal: NUTRITION_GOAL },
};

const run = (overrides = {}) => computeReadiness({
  checkins: [], workouts: [], nutrition: NUTRITION, weightLog: [{ kg: 80, date: TODAY }],
  catalog: [], today: TODAY, ...overrides,
});

/* ======================================================================
   Alvás
   ====================================================================== */

test('sleepDurationScore — trapéz alak a határpontokon', () => {
  assert.equal(sleepDurationScore(4), 0, '4 óra alatt nulla');
  assert.equal(sleepDurationScore(3), 0);
  assert.equal(sleepDurationScore(7.5), 1, '7.5 óránál éri el a maximumot');
  assert.equal(sleepDurationScore(9), 1, '9 óráig plató');
  assert.equal(sleepDurationScore(11), 0.85, 'túl sok alvás enyhén büntetve');
  assert.equal(sleepDurationScore(null), null, 'hiányzó adat nem nulla, hanem null');

  const mid = sleepDurationScore(5.75);
  assert.ok(mid > 0.49 && mid < 0.51, `4 és 7.5 között lineáris (kapott: ${mid})`);
});

test('sleepScore — 60/40 arány az időtartam és a minőség között', () => {
  const checkin = { sleepHours: 7.5, sleepQuality: 1 }; // idő 1.0, minőség 0.0
  assert.equal(sleepScore(checkin, []), 0.6);
});

test('sleepScore — alvásadósság legfeljebb 0.15-öt von le', () => {
  const debtDays = [
    { sleepHours: 5, daysAgo: 0 },
    { sleepHours: 5, daysAgo: 1 },
    { sleepHours: 5, daysAgo: 2 },
  ];
  const withDebt = sleepScore({ sleepHours: 5, sleepQuality: 3 }, debtDays);
  const withoutDebt = sleepScore({ sleepHours: 5, sleepQuality: 3 }, []);
  assert.ok(withDebt < withoutDebt, 'a felhalmozott adósság lehúzza a pontszámot');
  assert.ok(withoutDebt - withDebt <= 0.1500001, 'a levonás legfeljebb 0.15');
});

test('sleepScore — csak az egyik mező megadva is számol', () => {
  assert.equal(sleepScore({ sleepHours: 8, sleepQuality: null }, []), 1);
  assert.equal(sleepScore({ sleepHours: null, sleepQuality: 5 }, []), 1);
  assert.equal(sleepScore({ sleepHours: null, sleepQuality: null }, []), null);
});

/* ======================================================================
   Súly-újraosztás — a rendszer legfontosabb tulajdonsága
   ====================================================================== */

test('a hiányzó komponensek súlya arányosan újraoszlik', () => {
  const report = run({ checkins: [fullCheckin()] });
  const present = report.components.filter((c) => c.present);
  assert.equal(present.length, 6, 'teljes check-innel mind a hat komponens jelen van');
  const sum = present.reduce((acc, c) => acc + c.weight, 0);
  assert.ok(Math.abs(sum - 100) <= 1, `az effektív súlyok 100%-ra jönnek ki (kapott: ${sum})`);

  // HRV nélkül az alvás 0.25/0.85 ≈ 29.4%-ot kap
  const sleep = present.find((c) => c.key === 'sleep');
  assert.equal(sleep.weight, 29, 'az alvás a HRV súlyából is részesül');
});

test('részleges check-in — a pontszám kiszámolódik, a hiányzók jelölve', () => {
  const partial = fullCheckin({ stress: null, energy: null, hydration: null });
  const report = run({ checkins: [partial] });

  assert.ok(report.overall !== null, 'részleges adatból is van pontszám');
  assert.deepEqual(
    report.components.filter((c) => !c.present).map((c) => c.key),
    ['energy', 'stress'],
    'pontosan a meg nem adott komponensek hiányoznak',
  );
  assert.ok(report.checkin.missing.includes('stresszszint'));

  const weights = Object.fromEntries(report.components.map((c) => [c.key, c.weight]));
  assert.equal(weights.energy, 0);
  assert.equal(weights.stress, 0);
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) <= 1, 'a maradék négy komponens újraosztva 100%');
});

test('check-in nélkül is ad pontszámot, de jelzi a hiányt', () => {
  const report = run();
  assert.equal(report.checkin.present, false);
  assert.ok(report.overall !== null, 'az edzésnaplóból és a táplálkozásból számol');
  assert.equal(report.confidence, 'low');
  assert.match(report.confidenceNote, /check-in/i);
});

test('a bázissúlyok között nincs HRV — nem teszünk kitalált értéket a képletbe', () => {
  assert.equal(BASE_WEIGHTS.hrv, undefined);
  const sum = Object.values(BASE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 0.85) < 1e-9, 'a hat implementált komponens 0.85-öt tesz ki');
});

/* ======================================================================
   Terhelés és csillapítás
   ====================================================================== */

const HARD_LEG_DAY = [exercise('Guggolás', [set(5, 140, 9), set(5, 140, 9), set(5, 140, 9), set(5, 140, 9)])];

test('a friss edzésterhelés csökkenti a készenlétet', () => {
  const rested = run({ checkins: [fullCheckin()] });
  const trained = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Láb', HARD_LEG_DAY)] });
  assert.ok(trained.overall < rested.overall, 'egy kemény mai edzés után alacsonyabb a pontszám');
});

test('a terhelés hatása exponenciálisan csillapodik — a régebbi edzés kevesebbet számít', () => {
  const today = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Láb', HARD_LEG_DAY)] });
  const threeDaysAgo = run({ checkins: [fullCheckin()], workouts: [workout(3, 'Láb', HARD_LEG_DAY)] });
  assert.ok(threeDaysAgo.overall > today.overall, '3 nappal későbbre már visszaépült');

  const quadsToday = today.muscles.find((m) => m.key === 'quads').readiness;
  const quadsLater = threeDaysAgo.muscles.find((m) => m.key === 'quads').readiness;
  assert.ok(quadsLater > quadsToday + 15, `a quadriceps érdemben regenerálódott (${quadsToday}% → ${quadsLater}%)`);
});

test('a be nem pipált szettek nem terhelnek', () => {
  const planned = [exercise('Guggolás', [set(5, 140, 9, false), set(5, 140, 9, false)])];
  const report = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Láb', planned)] });
  const rested = run({ checkins: [fullCheckin()] });
  assert.equal(report.overall, rested.overall, 'csak a teljesített szett számít terhelésnek');
});

/* ======================================================================
   Izomcsoport-readiness
   ====================================================================== */

test('a lábnap a lábat terheli, a mellet nem', () => {
  const report = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Láb', HARD_LEG_DAY)] });
  const byKey = Object.fromEntries(report.muscles.map((m) => [m.key, m.readiness]));

  assert.ok(byKey.quads < 70, `a quadriceps lemegy (kapott: ${byKey.quads}%)`);
  assert.ok(byKey.glutes < 90, 'a farizom is kap terhelést');
  assert.equal(byKey.chest, 100, 'a mell érintetlen marad');
  assert.equal(byKey.arms, 100, 'a kar érintetlen marad');
});

test('a teljes lábnap sokkal jobban leviszi a csoportot, mint négy guggolás-szett', () => {
  const fullLegDay = [
    exercise('Guggolás', [set(5, 140, 9), set(5, 140, 9), set(5, 140, 9), set(5, 140, 9)]),
    exercise('Lábtolás', [set(10, 200, 8), set(10, 200, 8), set(10, 200, 8)]),
    exercise('Kitörés', [set(10, 40, 8), set(10, 40, 8), set(10, 40, 8)]),
  ];
  const heavy = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Láb', fullLegDay)] });
  const light = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Láb', HARD_LEG_DAY)] });

  const quadsOf = (report) => report.muscles.find((m) => m.key === 'quads').readiness;
  assert.ok(quadsOf(heavy) < 35, `tíz szett után a quadriceps padlón (kapott: ${quadsOf(heavy)}%)`);
  assert.ok(quadsOf(heavy) < quadsOf(light) - 20, 'a volumen érdemben számít');
});

test('a saját testsúlyos munka is terhel izmot, pedig nincs tonnatömege', () => {
  const bodyweight = [exercise('Húzódzkodás', [set(10, 0), set(10, 0), set(10, 0), set(8, 0)])];
  const report = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Hát', bodyweight)] });
  const back = report.muscles.find((m) => m.key === 'back');
  assert.ok(back.readiness < 80, `a húzódzkodás leviszi a hátat (kapott: ${back.readiness}%)`);
});

test('mind a kilenc izomcsoportra ad értéket', () => {
  const report = run({ checkins: [fullCheckin()] });
  assert.deepEqual(report.muscles.map((m) => m.key), MUSCLE_KEYS);
  assert.ok(report.muscles.every((m) => Number.isInteger(m.readiness)));
});

test('a szubjektív izomláz lehúzza a csoport pontszámát', () => {
  const sore = fullCheckin({ soreness: { chest: 5 } });
  const report = run({ checkins: [sore] });
  const chest = report.muscles.find((m) => m.key === 'chest');
  assert.ok(chest.readiness < 70, `erős izomláz mellett a mell nem lehet friss (kapott: ${chest.readiness}%)`);
  assert.equal(chest.source, 'blend', 'a modell és az érzet keverékéből jött');
  assert.equal(report.muscles.find((m) => m.key === 'back').source, 'model');
});

test('a soft-min átlag miatt egyetlen tönkrement csoport is látszik az összesítőn', () => {
  const clean = run({ checkins: [fullCheckin()] });
  const oneSore = run({ checkins: [fullCheckin({ soreness: { quads: 5 } })] });
  const muscleOf = (report) => report.components.find((c) => c.key === 'muscle').score;
  assert.ok(muscleOf(oneSore) < muscleOf(clean) - 5, 'nem mosódik el kilenc csoport átlagában');
});

/* ======================================================================
   Fájdalom-sapka
   ====================================================================== */

test('fájdalom-sapka: a csoport 30%-ra korlátozva, a teljes pontszám 45-re', () => {
  const report = run({ checkins: [fullCheckin({ pain: { hamstrings: 8 } })] });

  const hamstrings = report.muscles.find((m) => m.key === 'hamstrings');
  assert.ok(hamstrings.readiness <= 30, `a fájó csoport sapkázva (kapott: ${hamstrings.readiness}%)`);
  assert.ok(report.overall <= 45, `a teljes készenlét sapkázva (kapott: ${report.overall})`);
  assert.ok(report.caps.some((text) => /fájdalm/i.test(text)), 'a sapka indoklása szerepel a riportban');
});

test('a fájó izmot terhelő gyakorlat „kerüld ma" ajánlást kap', () => {
  const workouts = [
    workout(2, 'Láb', HARD_LEG_DAY),
    workout(6, 'Láb', HARD_LEG_DAY),
    workout(10, 'Láb', HARD_LEG_DAY),
  ];
  const report = run({ checkins: [fullCheckin({ pain: { quads: 9 } })], workouts });
  const squat = report.exercises.find((e) => e.name === 'Guggolás');
  assert.ok(squat, 'a guggolás szerepel az ajánlások között');
  assert.equal(squat.verdict, 'avoid');
  assert.equal(squat.painBlocked, true);
});

test('rossz közérzet-sapka', () => {
  const report = run({ checkins: [fullCheckin({ mood: 1 })] });
  assert.ok(report.overall <= 40, `beteg napon a készenlét 40 alatt (kapott: ${report.overall})`);
});

/* ======================================================================
   Gyakorlat-ajánlások
   ====================================================================== */

test('a fő emelés egyetlen alkalom után is kap ajánlást, az egyéb gyakorlat nem', () => {
  const workouts = [workout(4, 'Vegyes', [
    exercise('Guggolás', [set(5, 100)]),
    exercise('Oldalemelés', [set(12, 12)]),
  ])];
  const report = run({ checkins: [fullCheckin()], workouts });
  const names = report.exercises.map((e) => e.name);
  assert.ok(names.includes('Guggolás'), 'fő emelés: 1 alkalom is elég');
  assert.ok(!names.includes('Oldalemelés'), 'egyéb gyakorlathoz 3 alkalom kell');
});

test('az ajánlási küszöbök konkrét edzésdöntést adnak', () => {
  const report = run({ checkins: [fullCheckin()], workouts: [workout(7, 'Láb', HARD_LEG_DAY)] });
  const squat = report.exercises.find((e) => e.name === 'Guggolás');
  assert.ok(squat.readiness >= 80, 'egy hét pihenő után friss');
  assert.ok(['normal', 'strong', 'pr'].includes(squat.verdict));
  assert.ok(typeof squat.text === 'string' && squat.text.length > 0, 'van szöveges ajánlás');
  assert.ok('loadDelta' in squat && 'volumeDelta' in squat, 'a kimenet szerkezetes, nem csak szöveg');
});

test('a friss kemény edzés után a gyakorlat volumen-vágást kap', () => {
  const workouts = [
    workout(0, 'Láb', HARD_LEG_DAY),
    workout(1, 'Láb', HARD_LEG_DAY),
    workout(2, 'Láb', HARD_LEG_DAY),
  ];
  const report = run({ checkins: [fullCheckin()], workouts });
  const squat = report.exercises.find((e) => e.name === 'Guggolás');
  assert.ok(['trim', 'reduce', 'skip'].includes(squat.verdict), `három egymást követő lábnap után könnyítés kell (kapott: ${squat.verdict})`);
});

/* ======================================================================
   CNS
   ====================================================================== */

test('a nehéz, magas RPE-s axiális emelés jobban terheli az idegrendszert, mint az izolációs munka', () => {
  const heavy = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Erő', [
    exercise('Felhúzás', [set(3, 180, 10), set(3, 180, 10), set(3, 180, 10)], true),
  ])] });
  const light = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Izoláció', [
    exercise('Bicepsz hajlítás', [set(12, 20, 7), set(12, 20, 7), set(12, 20, 7)]),
  ])] });
  assert.ok(heavy.cns.readiness < light.cns.readiness - 10,
    `a nehéz felhúzás jobban viszi a CNS-t (${heavy.cns.readiness}% vs ${light.cns.readiness}%)`);
});

test('a rossz alvás lehúzza a CNS-t azonos edzésterhelés mellett', () => {
  const workouts = [workout(1, 'Erő', HARD_LEG_DAY)];
  const slept = run({ checkins: [fullCheckin({ sleepHours: 8.5, sleepQuality: 5 })], workouts });
  const tired = run({ checkins: [fullCheckin({ sleepHours: 4.5, sleepQuality: 1 })], workouts });
  assert.ok(tired.cns.readiness < slept.cns.readiness, 'az alvás közvetlenül hat az idegrendszerre');
});

/* ======================================================================
   Táplálkozás
   ====================================================================== */

test('nutritionScore — az alultápláltság büntetve, a többlet nem', () => {
  const goal = { calories: 3000, protein: 150 };
  const full = nutritionScore({ intake: 3000, protein: 150, goal }, null, 80);
  const over = nutritionScore({ intake: 4000, protein: 200, goal }, null, 80);
  const under = nutritionScore({ intake: 1500, protein: 75, goal }, null, 80);

  assert.equal(full, 1);
  assert.equal(over, 1, 'a többlet nem ad extra pontot, de nem is büntet');
  assert.ok(under < 0.6, 'a fél adag érdemben lehúz');
});

test('a naplózatlan táplálkozás nem számít alultápláltságnak', () => {
  const unlogged = {
    today: { intake: 0, protein: 0, goal: NUTRITION_GOAL },
    yesterday: { intake: 0, protein: 0, goal: NUTRITION_GOAL },
  };
  const report = run({ checkins: [fullCheckin({ hydration: null })], nutrition: unlogged });
  const nutrition = report.components.find((c) => c.key === 'nutrition');
  assert.equal(nutrition.present, false, 'üres napló → a komponens kimarad, nem 0 pontot ér');
  assert.equal(nutrition.weight, 0, 'a súlya újraoszlik a többi komponensen');
});

test('a tegnapi bevitel a mérvadó — reggel a mai étkezések még előtted vannak', () => {
  const goodYesterday = run({ checkins: [fullCheckin({ hydration: null })], nutrition: NUTRITION });
  const badYesterday = run({
    checkins: [fullCheckin({ hydration: null })],
    nutrition: {
      today: { intake: 2900, protein: 170, goal: NUTRITION_GOAL },
      yesterday: { intake: 900, protein: 40, goal: NUTRITION_GOAL },
    },
  });
  const scoreOf = (report) => report.components.find((c) => c.key === 'nutrition').score;
  assert.equal(scoreOf(goodYesterday), 100);
  assert.ok(scoreOf(badYesterday) < 50, 'a tegnapi hiány akkor is látszik, ha ma már rendben eszik');
});

test('nutritionScore — hidratáció testsúlyra skálázva, hiányában újraosztva', () => {
  const goal = { calories: 3000, protein: 150 };
  assert.equal(nutritionScore({ intake: 3000, protein: 150, goal }, 2.64, 80), 1, '80 kg-hoz 2.64 l a cél');
  const dry = nutritionScore({ intake: 3000, protein: 150, goal }, 0, 80);
  assert.ok(dry < 1 && dry >= 0.79, 'a hiányzó folyadék a 20%-nyi súlyát viszi');
  assert.equal(nutritionScore(null, null, 80), null, 'adat híján null, nem 0');
});

/* ======================================================================
   e1RM és izom-leképezés
   ====================================================================== */

test('epley1RM — RIR-korrekcióval', () => {
  assert.equal(epley1RM(1, 100, 10), 100, 'RPE 10-es szingli maga az 1RM');
  assert.ok(epley1RM(5, 100, 8) > epley1RM(5, 100, 10), 'a tartalékkal végzett szett magasabb 1RM-et jelez');
  assert.equal(epley1RM(0, 100, 8), null);
  assert.equal(epley1RM(5, 0, 8), null);
});

test('a katalógus load-súlyai és a kulcsszavas fallback is 1-re normalizálódnak', () => {
  const catalog = [{ name: 'Guggolás', load: { quads: 5, glutes: 3, core: 2 } }]; // szándékosan nem 1 az összeg
  const fromCatalog = resolveExerciseLoad('Guggolás', catalog);
  assert.ok(Math.abs(Object.values(fromCatalog).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(fromCatalog.quads, 0.5);

  const fromKeyword = resolveExerciseLoad('sumo felhúzás', []);
  assert.ok(Math.abs(Object.values(fromKeyword).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(fromKeyword.hamstrings > 0 && fromKeyword.back > 0);

  assert.deepEqual(resolveExerciseLoad('Trambulin ugrálás', []), {}, 'ismeretlen név nem terhel hamisan izmot');
});

test('az ismeretlen nevű gyakorlat is számít az általános terhelésbe', () => {
  const rested = run({ checkins: [fullCheckin()] });
  const unknown = run({ checkins: [fullCheckin()], workouts: [workout(0, 'Vegyes', [
    exercise('Trambulin ugrálás', [set(10, 100), set(10, 100), set(10, 100)]),
  ])] });
  assert.ok(unknown.overall < rested.overall, 'a terhelés-komponens akkor is látja, ha az izom ismeretlen');
  assert.ok(unknown.muscles.every((m) => m.readiness === 100), 'de egyetlen izomcsoportot sem terhel');
});

test('isAxialLift', () => {
  assert.equal(isAxialLift('Guggolás'), true);
  assert.equal(isAxialLift('felhuzas'), true);
  assert.equal(isAxialLift('Oldalemelés'), false);
});

/* ======================================================================
   Megbízhatóság — „nincs elég adat" őszintén
   ====================================================================== */

test('kevés előzménnyel alacsony a megbízhatóság', () => {
  const report = run({ checkins: [fullCheckin()] });
  assert.equal(report.confidence, 'low');
  assert.equal(report.meta.historyDays, 0);
});

test('elég előzménnyel és check-innel magas a megbízhatóság', () => {
  const workouts = Array.from({ length: 8 }, (_, i) => workout(i * 2 + 1, 'Edzés', [
    exercise('Fekvenyomás', [set(8, 80), set(8, 80), set(8, 80)]),
  ]));
  const checkins = Array.from({ length: 10 }, (_, i) => fullCheckin({ date: dateAgo(i) }));
  const report = run({ checkins, workouts });
  assert.equal(report.confidence, 'high');
  assert.match(report.confidenceNote, /saját előzményedhez/i);
});

test('a jövőbeli dátumú edzés nem torzítja a számítást', () => {
  const rested = run({ checkins: [fullCheckin()] });
  const withFuture = run({ checkins: [fullCheckin()], workouts: [workout(-3, 'Jövőbeli', HARD_LEG_DAY)] });
  assert.equal(withFuture.overall, rested.overall);
});

/* ======================================================================
   A riport alakja
   ====================================================================== */

test('a riport minden felület által várt mezőt tartalmaz', () => {
  const report = run({ checkins: [fullCheckin()], workouts: [workout(1, 'Láb', HARD_LEG_DAY)] });

  assert.ok(report.overall >= 0 && report.overall <= 100);
  assert.ok(['low', 'medium', 'high'].includes(report.confidence));
  assert.equal(report.components.length, 6);
  assert.equal(report.muscles.length, 9);
  assert.ok(typeof report.cns.readiness === 'number');
  assert.ok(Array.isArray(report.exercises));
  assert.deepEqual(Object.keys(report.recovery), ['sleep', 'fatigue', 'soreness']);
  assert.equal(report.recovery.sleep, '8 óra');
});

test('check-in nélkül a regenerációs sorok nem találnak ki alvásadatot', () => {
  const report = run();
  assert.equal(report.recovery.sleep, '—');
});
