/**
 * Podium — a blokkos programok szabályai (server/program/rules.js)
 * -----------------------------------------------------------------------
 * A TM-javaslat a ténylegesen rögzített edzésekből: rekord → 95% × új 1RM,
 * különben lépésköz; edzés-, hét- és ciklusszakaszok láncban, teljesítmény-
 * és check-in értékekkel. Az app csak javasol, a döntés az emberé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExerciseCatalog } from '../../server/data/catalog.js';
import {
  collectCycleData,
  defaultStep,
  isLowerBody,
  periodStats,
  runStages,
  suggestTrainingMaxes,
} from '../../server/program/rules.js';

const catalog = buildExerciseCatalog();
const num = (v, pct = false) => ({ t: 'num', v, pct });
const stat = (k) => ({ t: 'stat', k });
const pctTm = (p) => ({ t: 'op', op: '*', a: num(p, true), b: { t: 'tm' } });

const VIKTOR_RULE = {
  on: 'cycle',
  when: { t: 'record' },
  then: { t: 'set', formula: { t: 'op', op: '*', a: num(95, true), b: { t: 'newOrm' } } },
  otherwise: { t: 'step' },
};
const BURNOUT = {
  on: 'workout',
  when: {
    t: 'cmp',
    op: '<',
    a: stat('doneAll'),
    b: { t: 'op', op: '-', a: stat('totalAll'), b: num(10) },
  },
  then: { t: 'addPct', pct: -30 },
  otherwise: null,
};

const program = (rules = [VIKTOR_RULE], steps = {}) => ({
  weeks: [
    {
      label: '1. hét',
      days: [
        {
          name: 'A',
          exercises: [
            {
              name: 'Guggolás',
              role: 'main',
              sets: [{ count: 1, reps: 5, amrap: true, weight: pctTm(85) }],
            },
          ],
        },
        {
          name: 'B',
          exercises: [
            {
              name: 'Fekvenyomás',
              role: 'main',
              sets: [{ count: 1, reps: 5, amrap: true, weight: pctTm(85) }],
            },
          ],
        },
      ],
    },
  ],
  rules,
  steps,
});

const s = (weight, reps, done = true, extra = {}) => ({
  weight: String(weight),
  reps: String(reps),
  rpe: '',
  type: 'work',
  done,
  ...extra,
});
const wo = (exercises, checkin = {}) => ({ exercises, checkin });
const ctx = { oneRms: {}, bodyweight: null };
const tms = { Guggolás: 100, Fekvenyomás: 60 };

const suggest = (args) =>
  suggestTrainingMaxes({
    program: program(),
    trainingMaxes: tms,
    workouts: [],
    baselineMaxes: { Guggolás: 110, Fekvenyomás: 70 },
    catalog,
    ctx,
    ...args,
    rules: args.rules ?? args.program?.rules ?? program().rules,
  });
const byEx = (list, ex) => list.find((x) => x.exercise === ex);

test('rekord: 1RM-próba 120 kg (előtte 110) → TM 115 (114 kerekítve), indoklás „Új 1RM-rekord: 120 kg”', () => {
  const workouts = [wo([{ name: 'Guggolás', sets: [s(100, 1), s(120, 1)] }])];
  const g = byEx(suggest({ workouts }), 'Guggolás');
  assert.equal(g.current, 100);
  assert.equal(g.suggested, 115);
  assert.equal(g.reason, 'Új 1RM-rekord: 120 kg');
});

test('nincs rekord: Guggolás TM 100 → 105, Fekvenyomás TM 60 → 62,5', () => {
  const workouts = [wo([{ name: 'Guggolás', sets: [s(105, 1)] }])];
  const out = suggest({ workouts });
  assert.equal(byEx(out, 'Guggolás').suggested, 105);
  assert.equal(byEx(out, 'Guggolás').reason, 'Nem volt új 1RM-rekord');
  assert.equal(byEx(out, 'Fekvenyomás').suggested, 62.5);
});

test('próba nélkül: a feltétel hamis → lépésköz', () => {
  assert.equal(byEx(suggest({ workouts: [] }), 'Guggolás').suggested, 105);
});

test('a nem pipált szett nem számít: done:false 1×125 → nincs rekord', () => {
  const workouts = [wo([{ name: 'Guggolás', sets: [s(125, 1, false)] }])];
  const g = byEx(suggest({ workouts }), 'Guggolás');
  assert.equal(g.suggested, 105);
  assert.equal(g.reason, 'Nem volt új 1RM-rekord');
});

test('steps felülírja: steps.Guggolás = 2,5 → 102,5', () => {
  const p = program([VIKTOR_RULE], { Guggolás: 2.5 });
  assert.equal(byEx(suggest({ program: p }), 'Guggolás').suggested, 102.5);
});

test('cmp: AMRAP 3 < előírt 5 → addPct −10 → TM 100 → 90, indoklás „AMRAP-ismétlés = 3 < előírt ismétlés = 5”', () => {
  const rule = {
    on: 'cycle',
    when: { t: 'cmp', op: '<', a: stat('amrapReps'), b: stat('amrapTarget') },
    then: { t: 'addPct', pct: -10 },
    otherwise: null,
  };
  const workouts = [wo([{ name: 'Guggolás', sets: [s(85, 3, true, { amrap: 5 })] }])];
  const g = byEx(suggest({ rules: [rule], workouts }), 'Guggolás');
  assert.equal(g.suggested, 90);
  assert.equal(g.reason, 'AMRAP-ismétlés = 3 < előírt ismétlés = 5');
});

test('cmp hiányzó AMRAP-pal → current, „Nincs adat a szabályhoz”', () => {
  const rule = {
    on: 'cycle',
    when: { t: 'cmp', op: '<', a: stat('amrapReps'), b: num(5) },
    then: { t: 'addPct', pct: -10 },
    otherwise: { t: 'step' },
  };
  const g = byEx(suggest({ rules: [rule], workouts: [] }), 'Guggolás');
  assert.equal(g.suggested, 100);
  assert.equal(g.reason, 'Nincs adat a szabályhoz');
});

test('cmp hamis ág: „Nem teljesült: ” előtag, otherwise nélkül a következő szabály fut', () => {
  const rule = {
    on: 'cycle',
    when: { t: 'cmp', op: '>', a: num(1), b: num(2) },
    then: { t: 'addPct', pct: -10 },
    otherwise: null,
  };
  const g = byEx(suggest({ rules: [rule, VIKTOR_RULE] }), 'Guggolás');
  assert.equal(g.suggested, 105);
  const only = byEx(suggest({ rules: [rule] }), 'Guggolás');
  assert.equal(only.suggested, 100);
  assert.equal(only.reason, 'Nincs érvényes szabály');
});

test('collectCycleData: tizedesvesszős súly, az utolsó AMRAP számít', () => {
  const workouts = [
    wo([{ name: 'Guggolás', sets: [s(80, 7, true, { amrap: 5 }), s('112,5', 1)] }]),
    wo([{ name: 'Guggolás', sets: [s(85, 4, true, { amrap: 3 }), s(110, 1)] }]),
  ];
  assert.deepEqual(collectCycleData(workouts, 'Guggolás'), {
    amrapReps: 4,
    amrapTarget: 3,
    bestSingle: 112.5,
  });
});

test('periodStats: 2 edzés, 20 szettből 8 pipált; fájdalom max 7, alvás átlag 6,5, készenlét min 55', () => {
  const ten = (doneCount, name) => ({
    name,
    sets: Array.from({ length: 10 }, (_, i) => s(50, 5, i < doneCount)),
  });
  const workouts = [
    wo([ten(5, 'Guggolás')], { pain: 3, sleep: 6, readiness: 80 }),
    wo([ten(3, 'Kitörés')], { pain: 7, sleep: 7, readiness: 55 }),
  ];
  assert.deepEqual(periodStats(workouts, 'Guggolás'), {
    doneEx: 5,
    totalEx: 10,
    doneAll: 8,
    totalAll: 20,
    amrapReps: null,
    amrapTarget: null,
    pain: 7,
    readiness: 55,
    sleep: 6.5,
  });
  const empty = periodStats([wo([])], 'Guggolás');
  assert.equal(empty.pain, null);
  assert.equal(empty.sleep, null);
  assert.equal(empty.readiness, null);
});

test('kiégés: 20-ból 8 pipált → minden TM −30% (100 → 70, 60 → 42,5)', () => {
  const workouts = [
    wo([
      { name: 'Guggolás', sets: Array.from({ length: 10 }, (_, i) => s(50, 5, i < 5)) },
      { name: 'Kitörés', sets: Array.from({ length: 10 }, (_, i) => s(20, 10, i < 3)) },
    ]),
  ];
  const out = suggest({ rules: [BURNOUT], workouts });
  assert.equal(byEx(out, 'Guggolás').suggested, 70);
  assert.equal(byEx(out, 'Fekvenyomás').suggested, 42.5);
  assert.equal(byEx(out, 'Guggolás').reason, 'teljesített (mind) = 8 < összes (mind) − 10 = 10');
});

test('arányos kiégésküszöb: 6 szettből 3 pipált, doneAll < 80% × totalAll → −30%', () => {
  const rule = {
    ...BURNOUT,
    when: {
      t: 'cmp',
      op: '<',
      a: stat('doneAll'),
      b: { t: 'op', op: '*', a: num(80, true), b: stat('totalAll') },
    },
  };
  const workouts = [
    wo([{ name: 'Guggolás', sets: Array.from({ length: 6 }, (_, i) => s(50, 5, i < 3)) }]),
  ];
  assert.equal(byEx(suggest({ rules: [rule], workouts }), 'Guggolás').suggested, 70);
  // az „összes − 10” ugyanitt sosem igaz
  assert.equal(byEx(suggest({ rules: [BURNOUT], workouts }), 'Guggolás').suggested, 100);
});

test('runStages: edzés −30% után a ciklusszabály a csökkentett TM-ből lép (100 → 70 → 75), az indoklás mindkét szakaszt említi', () => {
  const p = program([BURNOUT, VIKTOR_RULE]);
  const last = wo([
    { name: 'Guggolás', sets: Array.from({ length: 20 }, (_, i) => s(50, 5, i < 2)) },
  ]);
  const out = runStages({
    program: p,
    stages: [
      { on: 'workout', workouts: [last] },
      { on: 'cycle', workouts: [last] },
    ],
    trainingMaxes: tms,
    baselineMaxes: { Guggolás: 110 },
    catalog,
    ctx,
    isCycleEnd: true,
  });
  const g = byEx(out, 'Guggolás');
  assert.equal(g.current, 100);
  assert.equal(g.suggested, 75);
  assert.match(g.reason, /^minden edzés után: .+ · a ciklus végén: Nem volt új 1RM-rekord$/);
  assert.equal(out.length, 2);
});

test('runStages ciklus közben: változás nélkül üres lista', () => {
  const p = program([BURNOUT, VIKTOR_RULE]);
  const good = wo([{ name: 'Guggolás', sets: [s(85, 5)] }]);
  const out = runStages({
    program: p,
    stages: [{ on: 'workout', workouts: [good] }],
    trainingMaxes: tms,
    baselineMaxes: {},
    catalog,
    ctx,
    isCycleEnd: false,
  });
  assert.deepEqual(out, []);
});

test('isLowerBody: Guggolás és Felhúzás igen, Fekvenyomás és Vállból nyomás nem', () => {
  assert.equal(isLowerBody('Guggolás', catalog), true);
  assert.equal(isLowerBody('Felhúzás', catalog), true);
  assert.equal(isLowerBody('Fekvenyomás', catalog), false);
  assert.equal(isLowerBody('Vállból nyomás', catalog), false);
  assert.equal(defaultStep('Guggolás', program(), catalog), 5);
});
