/**
 * Podium — a programozó blokktára és fa-szerkesztése (public/js/program/block-library.js)
 * --------------------------------------------------------------------------
 * Mi hová ejthető (és mi lesz belőle), a rossz helyre ejtett blokk magyar
 * hibaüzenete, és a sorok „+” gombjainak műveletei. Tiszta függvények: a
 * programfát nem mutálják, másolatot adnak.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CATS,
  addDay,
  addExercise,
  addSet,
  addWeek,
  applyDrop,
  moveExercise,
  removeDay,
  removeExercise,
  removeSet,
  removeWeek,
  sideItems,
  weekRowSummary,
} from '../../../../public/js/program/block-library.js';

const num = (v, pct = false) => ({ t: 'num', v, pct });
const pctTm = (p) => ({ t: 'op', op: '*', a: num(p, true), b: { t: 'tm' } });
const prog = () => ({
  weeks: [
    {
      label: '1. hét',
      days: [
        {
          name: 'Guggolásnap',
          exercises: [
            {
              name: 'Guggolás',
              role: 'main',
              sets: [
                { count: 1, reps: 5, amrap: false, weight: pctTm(65) },
                { count: 1, reps: 5, amrap: false, weight: pctTm(75) },
                { count: 1, reps: 5, amrap: true, weight: pctTm(85) },
              ],
            },
          ],
        },
      ],
    },
  ],
  rules: [
    {
      on: 'workout',
      when: { t: 'cmp', op: '>=', a: null, b: num(7) },
      then: { t: 'addPct', pct: -30 },
      otherwise: null,
    },
  ],
  steps: {},
});
const item = (cat, label) => sideItems(cat, ['Kitörés', 'Felhúzás']).find((i) => i.lab === label);

test('a blokktár kategóriái és elemei', () => {
  assert.deepEqual(
    CATS.map((c) => c.k),
    ['struct', 'ex', 'val', 'perf', 'ci', 'op'],
  );
  assert.deepEqual(
    sideItems('struct').map((i) => i.lab),
    ['Hét', 'Nap', 'Szett', 'Szabály'],
  );
  assert.deepEqual(
    sideItems('ex', ['Kitörés', 'Felhúzás']).map((i) => i.name),
    ['Kitörés', 'Felhúzás'],
  );
  assert.equal(sideItems('perf').length, 6);
  assert.deepEqual(
    sideItems('ci').map((i) => i.lab),
    ['fájdalom', 'készenlét', 'alvás'],
  );
  assert.deepEqual(
    sideItems('op').map((i) => i.lab),
    ['□ × □', '□ + □', '□ − □'],
  );
});

test('gyakorlat napra: új kiegészítő; gyakorlatra: csere', () => {
  const p = prog();
  const added = applyDrop(p, item('ex', 'Kitörés'), { dz: 'day', w: '0', d: '0' }).program;
  const ex = added.weeks[0].days[0].exercises[1];
  assert.equal(ex.name, 'Kitörés');
  assert.equal(ex.role, 'accessory');
  assert.equal(p.weeks[0].days[0].exercises.length, 1, 'az eredeti érintetlen');
  const swapped = applyDrop(p, item('ex', 'Felhúzás'), { dz: 'ex', w: 0, d: 0, e: 0 }).program;
  assert.equal(swapped.weeks[0].days[0].exercises[0].name, 'Felhúzás');
  assert.equal(swapped.weeks[0].days[0].exercises[0].sets.length, 3);
});

test('gyakorlat üres napra: fő gyakorlat 70% × TM-mel', () => {
  const p = addDay(prog(), 0, 0);
  const ex = applyDrop(p, item('ex', 'Kitörés'), { dz: 'day', w: 0, d: 1 }).program.weeks[0].days[1]
    .exercises[0];
  assert.equal(ex.role, 'main');
  assert.deepEqual(ex.sets[0].weight, pctTm(70));
});

test('szett napra ejtve hibaüzenet', () => {
  const res = applyDrop(prog(), item('struct', 'Szett'), { dz: 'day', w: 0, d: 0 });
  assert.equal(res.error, 'A szettet egy gyakorlatra húzd.');
  const ok = applyDrop(prog(), item('struct', 'Szett'), { dz: 'ex', w: 0, d: 0, e: 0 }).program;
  assert.equal(ok.weeks[0].days[0].exercises[0].sets.length, 4);
});

test('fájdalom a szett súlyára: hibaüzenet, a feltételbe: bekerül', () => {
  const pain = item('ci', 'fájdalom');
  const bad = applyDrop(prog(), pain, { dz: 'setw', w: 0, d: 0, e: 0, s: 0 });
  assert.equal(
    bad.error,
    'A teljesítmény- és check-in értékek csak szabályfeltételben használhatók.',
  );
  const ok = applyDrop(prog(), pain, { dz: 'cond', path: '0.a' }).program;
  assert.deepEqual(ok.rules[0].when.a, { t: 'stat', k: 'pain' });
});

test('× a szett súlyára: körbeöleli a meglévő képletet', () => {
  const times = item('op', '□ × □');
  const p = applyDrop(prog(), times, { dz: 'setw', w: 0, d: 0, e: 0, s: 0 }).program;
  assert.deepEqual(p.weeks[0].days[0].exercises[0].sets[0].weight, {
    t: 'op',
    op: '*',
    a: pctTm(65),
    b: null,
  });
});

test('új 1RM csak az akcióban; nap a hétre, hét a végére, szabály a Szabályokra', () => {
  const newOrm = sideItems('val').find((i) => i.lab === 'új 1RM');
  assert.ok(applyDrop(prog(), newOrm, { dz: 'setw', w: 0, d: 0, e: 0, s: 0 }).error);
  const day = applyDrop(prog(), item('struct', 'Nap'), { dz: 'week', w: 0 }).program;
  assert.equal(day.weeks[0].days.length, 2);
  assert.ok(applyDrop(prog(), item('struct', 'Nap'), {}).error);
  const week = applyDrop(prog(), item('struct', 'Hét'), {}).program;
  assert.equal(week.weeks.length, 2);
  assert.equal(week.weeks[1].label, '2. hét');
  const rule = applyDrop(prog(), item('struct', 'Szabály'), { dz: 'rules' }).program;
  assert.equal(rule.rules.length, 2);
  assert.equal(rule.rules[1].on, 'workout');
  assert.ok(applyDrop(prog(), item('struct', 'Szabály'), { dz: 'day', w: 0, d: 0 }).error);
  assert.ok(applyDrop(prog(), item('ex', 'Kitörés'), { dz: 'rules' }).error);
});

test('a + Szett a gyakorlat végére új 1×5-ös sort tesz, üres súllyal', () => {
  const p = addSet(prog(), 0, 0, 0);
  assert.deepEqual(p.weeks[0].days[0].exercises[0].sets[3], {
    count: 1,
    reps: 5,
    amrap: false,
    weight: null,
  });
});

test('a sor-műveletek: gyakorlat, nap, hét hozzáadása, mozgatása és törlése', () => {
  let p = addExercise(prog(), 0, 0, 'Kitörés');
  assert.equal(p.weeks[0].days[0].exercises[1].name, 'Kitörés');
  p = moveExercise(p, 0, 0, 1, -1);
  assert.equal(p.weeks[0].days[0].exercises[0].name, 'Kitörés');
  assert.equal(moveExercise(p, 0, 0, 0, -1), p, 'a lista elején nem mozdul');
  p = removeExercise(p, 0, 0, 0);
  assert.equal(p.weeks[0].days[0].exercises.length, 1);
  p = removeSet(p, 0, 0, 0, 2);
  assert.equal(p.weeks[0].days[0].exercises[0].sets.length, 2);
  p = addWeek(p, 0);
  assert.equal(p.weeks.length, 2);
  p = addDay(p, 1, 0);
  assert.equal(p.weeks[1].days.length, 2);
  p = removeDay(p, 1, 0);
  assert.equal(p.weeks[1].days.length, 1);
  p = removeWeek(p, 1);
  assert.equal(p.weeks.length, 1);
});

test('a becsukott hét a weekSummary szövegét mutatja', () => {
  assert.equal(weekRowSummary(prog().weeks[0]), '▸ 65 / 75 / 85%');
  assert.equal(weekRowSummary({ label: '', days: [{ name: '', exercises: [] }] }), '▸ 1 nap');
});
