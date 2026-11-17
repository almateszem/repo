/**
 * Podium — szett nélküli gyakorlatra a gyakorlat-szintű érték „nincs adat" (P1)
 * -----------------------------------------------------------------------
 * A szabályok minden TM-gyakorlatra lefutnak — ez szándékos: a kiégés-
 * szabály (az egész edzés számaiból) minden TM-et csökkent, és a ciklus végi
 * lépésköz edzés nélkül is jár (ld. a blokkos programok tervdokumentuma).
 *
 * A hiba a gyakorlat-szintű értékeknél volt: ha a gyakorlatból nem volt
 * szett, a 0 teljesített / 0 összes adatnak számított, és egy csak-guggolás
 * edzés után a fekvenyomás TM-je is emelkedett („0 ≥ 0"). Ilyenkor a
 * gyakorlat-szintű érték hiányzik, a rá épülő szabály „nincs adat".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExerciseCatalog } from '../../server/data/catalog.js';
import { periodStats, runStages, suggestTrainingMaxes } from '../../server/program/rules.js';

const catalog = buildExerciseCatalog();
const stat = (k) => ({ t: 'stat', k });
const num = (v) => ({ t: 'num', v, pct: false });
const pctTm = (p) => ({ t: 'op', op: '*', a: { t: 'num', v: p, pct: true }, b: { t: 'tm' } });

/** „Minden edzés után: teljesített (gyak.) ≥ összes (gyak.) → TM + lépésköz." */
const ALL_DONE = {
  on: 'workout',
  when: { t: 'cmp', op: '>=', a: stat('doneEx'), b: stat('totalEx') },
  then: { t: 'step' },
  otherwise: null,
};
/** Kiégés: az EGÉSZ edzés számaiból — minden TM-re szándékosan. */
const BURNOUT = {
  on: 'workout',
  when: { t: 'cmp', op: '<', a: stat('doneAll'), b: stat('totalAll') },
  then: { t: 'addPct', pct: -10 },
  otherwise: null,
};

const day = (name, exercise) => ({
  name,
  exercises: [
    {
      name: exercise,
      role: 'main',
      sets: [{ count: 3, reps: 5, amrap: false, weight: pctTm(80) }],
    },
  ],
});
const program = (rules) => ({
  weeks: [{ label: '1. hét', days: [day('A', 'Guggolás'), day('B', 'Fekvenyomás')] }],
  rules,
  steps: {},
});

const squatOnly = (done = [true, true, true]) => ({
  id: 1,
  exercises: [
    {
      name: 'Guggolás',
      sets: done.map((d) => ({ reps: '5', weight: '100', type: 'work', done: d })),
    },
  ],
});

const TMS = { Guggolás: 120, Fekvenyomás: 80 };

test('periodStats: szett nélküli gyakorlatnál a gyakorlat-szintű érték hiányzik, az egész edzésé nem', () => {
  const s = periodStats([squatOnly()], 'Fekvenyomás');
  assert.equal(s.doneEx, null);
  assert.equal(s.totalEx, null);
  assert.equal(s.doneAll, 3);
  assert.equal(s.totalAll, 3);
});

test('a csak-guggolás edzés után a Fekvenyomás TM-je nem emelkedik („0 ≥ 0" helyett „nincs adat")', () => {
  const out = suggestTrainingMaxes({
    program: program([ALL_DONE]),
    trainingMaxes: TMS,
    workouts: [squatOnly()],
    baselineMaxes: {},
    catalog,
    ctx: {},
  });
  const bench = out.find((s) => s.exercise === 'Fekvenyomás');
  assert.equal(bench.suggested, 80);
  assert.equal(bench.reason, 'Nincs adat a szabályhoz');
  assert.ok(out.find((s) => s.exercise === 'Guggolás').suggested > 120);

  const items = runStages({
    program: program([ALL_DONE]),
    stages: [{ on: 'workout', workouts: [squatOnly()] }],
    trainingMaxes: TMS,
    baselineMaxes: {},
    catalog,
    ctx: {},
    isCycleEnd: false,
  });
  assert.deepEqual(
    items.map((i) => i.exercise),
    ['Guggolás'],
    'ciklus közben csak az edzett gyakorlat kerül a kártyára',
  );
});

test('a kiégés-szabály továbbra is MINDEN TM-et csökkent (szándékos)', () => {
  const out = suggestTrainingMaxes({
    program: program([BURNOUT]),
    trainingMaxes: TMS,
    workouts: [squatOnly([true, false, false])],
    baselineMaxes: {},
    catalog,
    ctx: {},
  });
  assert.ok(out.find((s) => s.exercise === 'Guggolás').suggested < 120);
  assert.ok(out.find((s) => s.exercise === 'Fekvenyomás').suggested < 80);
});

test('a gyakorlat-szintű érték számmal kombinálva is „nincs adat" szett nélkül', () => {
  const rule = {
    ...ALL_DONE,
    when: { t: 'cmp', op: '>=', a: stat('totalEx'), b: num(0) },
  };
  const out = suggestTrainingMaxes({
    program: program([rule]),
    trainingMaxes: TMS,
    workouts: [squatOnly()],
    baselineMaxes: {},
    catalog,
    ctx: {},
  });
  assert.equal(out.find((s) => s.exercise === 'Fekvenyomás').suggested, 80);
});
