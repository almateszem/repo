/**
 * Podium — a blokkos program szerkezete (server/program/program.js)
 * -----------------------------------------------------------------------
 * A programfa validálása, a napok kiterítése és a napi edzés felépítése
 * a képletekből. A fixture Viktor programjának kicsinyített változata.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDayWorkout,
  dayTitle,
  flattenDays,
  nextWeekStart,
  normalizeProgram,
  oneRmRefs,
  tmExercises,
} from '../../server/program/program.js';

const num = (v, pct = false) => ({ t: 'num', v, pct });
const pctTm = (p) => ({ t: 'op', op: '*', a: num(p, true), b: { t: 'tm' } });
const set = (count, reps, weight, amrap = false) => ({ count, reps, amrap, weight });

const fixture = () => ({
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
              sets: [set(1, 5, pctTm(65)), set(1, 5, pctTm(75)), set(1, 5, pctTm(85), true)],
            },
            { name: 'Guggolás', role: 'accessory', sets: [set(5, 10, pctTm(50))] },
          ],
        },
        {
          name: '',
          exercises: [
            {
              name: 'Elöl guggolás',
              role: 'main',
              sets: [
                set(3, 8, { t: 'op', op: '*', a: num(60, true), b: { t: 'orm', ex: 'Guggolás' } }),
              ],
            },
          ],
        },
      ],
    },
    {
      label: '',
      days: [
        {
          name: 'Guggolás',
          exercises: [{ name: 'Guggolás', role: 'main', sets: [set(1, 1, null)] }],
        },
        {
          name: 'Nyomás',
          exercises: [{ name: 'Fekvenyomás', role: 'main', sets: [set(1, 5, pctTm(70))] }],
        },
      ],
    },
  ],
  rules: [
    {
      on: 'cycle',
      when: { t: 'record' },
      then: {
        t: 'set',
        formula: { t: 'op', op: '*', a: num(95, true), b: { t: 'orm', ex: 'Felhúzás' } },
      },
      otherwise: { t: 'step' },
    },
  ],
  steps: {},
});

const ctx = { trainingMaxes: { Guggolás: 100 }, oneRms: { Guggolás: 110 }, bodyweight: null };

test('flattenDays: 4 nap, pos 0..3, a hét és a nap indexével', () => {
  const f = flattenDays(fixture());
  assert.equal(f.length, 4);
  assert.deepEqual(
    f.map((x) => [x.pos, x.week, x.day]),
    [
      [0, 0, 0],
      [1, 0, 1],
      [2, 1, 0],
      [3, 1, 1],
    ],
  );
  assert.equal(f[0].weekLabel, '1. hét');
  assert.equal(f[0].dayName, 'Guggolásnap');
});

test('dayTitle: névvel, név nélkül és üres hétcímkével', () => {
  const p = fixture();
  assert.equal(dayTitle(p, 0), '1. hét · Guggolásnap');
  assert.equal(dayTitle(p, 1), '1. hét · 2. nap');
  assert.equal(dayTitle(p, 3), '2. hét · Nyomás');
});

test('buildDayWorkout: TM 100 → 65/75/85 kg, az AMRAP-szetten amrap:5, a 5×10 öt külön szett 50 kg-mal', () => {
  const w = buildDayWorkout(fixture(), 0, ctx);
  assert.equal(w.name, '1. hét · Guggolásnap');
  const main = w.exercises[0];
  assert.deepEqual(
    main.sets.map((s) => s.weight),
    ['65', '75', '85'],
  );
  assert.deepEqual(main.sets[2], {
    reps: '5',
    weight: '85',
    rpe: '',
    type: 'work',
    done: false,
    amrap: 5,
  });
  assert.equal(main.sets[0].amrap, undefined);
  const acc = w.exercises[1];
  assert.equal(acc.sets.length, 5);
  assert.ok(acc.sets.every((s) => s.weight === '50' && s.reps === '10'));
  assert.deepEqual(w.missing, []);
});

test('buildDayWorkout: 1RM-ből számol (60% × 110 = 66 → 65)', () => {
  const w = buildDayWorkout(fixture(), 1, ctx);
  assert.equal(w.exercises[0].sets.length, 3);
  assert.equal(w.exercises[0].sets[0].weight, '65');
});

test('buildDayWorkout: weight:null → üres súly, missing üres', () => {
  const w = buildDayWorkout(fixture(), 2, ctx);
  assert.equal(w.exercises[0].sets[0].weight, '');
  assert.equal(w.exercises[0].sets[0].reps, '1');
  assert.deepEqual(w.missing, []);
});

test('hiányzó TM: üres súly és missing lista [{kind:"tm", exercise:"Fekvenyomás"}]', () => {
  const w = buildDayWorkout(fixture(), 3, ctx);
  assert.equal(w.exercises[0].sets[0].weight, '');
  assert.deepEqual(w.missing, [{ kind: 'tm', exercise: 'Fekvenyomás' }]);
});

test('buildDayWorkout: nem létező pozíció → null', () => {
  assert.equal(buildDayWorkout(fixture(), 9, ctx), null);
});

test('tmExercises és oneRmRefs: egyedi nevek, a szabály set-képletének 1RM-je is', () => {
  const p = fixture();
  assert.deepEqual(tmExercises(p), ['Guggolás', 'Fekvenyomás']);
  assert.deepEqual(oneRmRefs(p), ['Guggolás', 'Felhúzás']);
});

test('normalizeProgram: 0 hét, 13 hét, 21 szett-sor, üres gyakorlatnév → error', () => {
  const p0 = fixture();
  p0.weeks = [];
  assert.equal(normalizeProgram(p0).error, 'A programnak legalább egy hete kell legyen.');
  const p13 = fixture();
  p13.weeks = Array.from({ length: 13 }, () => fixture().weeks[0]);
  assert.ok(normalizeProgram(p13).error);
  const p21 = fixture();
  p21.weeks[0].days[0].exercises[0].sets = Array.from({ length: 21 }, () => set(1, 5, null));
  assert.ok(normalizeProgram(p21).error);
  const pName = fixture();
  pName.weeks[0].days[0].exercises[0].name = '  ';
  assert.ok(normalizeProgram(pName).error);
});

test('normalizeProgram: ismeretlen mezőt eldob, a reps-et egészre kerekíti', () => {
  const p = fixture();
  p.extra = 1;
  p.weeks[0].extra = 2;
  p.weeks[0].days[0].exercises[0].sets[0].reps = 5.4;
  p.steps = { Guggolás: 5, Fekvenyomás: 99, Rossz: 'x' };
  const { program, error } = normalizeProgram(p);
  assert.equal(error, undefined);
  assert.equal(program.extra, undefined);
  assert.equal(program.weeks[0].extra, undefined);
  assert.equal(program.weeks[0].days[0].exercises[0].sets[0].reps, 5);
  assert.deepEqual(program.steps, { Guggolás: 5 });
  assert.deepEqual(program.weeks[1].days[1], fixture().weeks[1].days[1]);
});

test('normalizeProgram: stat a szett súlyában → error; on hiányában cycle', () => {
  const pStat = fixture();
  pStat.weeks[0].days[0].exercises[0].sets[0].weight = { t: 'stat', k: 'pain' };
  assert.ok(normalizeProgram(pStat).error);
  const pOn = fixture();
  delete pOn.rules[0].on;
  pOn.rules.push({
    on: 'workout',
    when: { t: 'cmp', op: '>=', a: { t: 'stat', k: 'pain' }, b: num(7) },
    then: { t: 'addPct', pct: -30 },
    otherwise: null,
  });
  const { program } = normalizeProgram(pOn);
  assert.equal(program.rules[0].on, 'cycle');
  assert.equal(program.rules[1].on, 'workout');
  assert.deepEqual(program.rules[1].when.a, { t: 'stat', k: 'pain' });
});

test('normalizeProgram: rossz szabály (newOrm a feltételben, ismeretlen akció) → error', () => {
  const p1 = fixture();
  p1.rules[0].when = { t: 'cmp', op: '<', a: { t: 'newOrm' }, b: num(1) };
  assert.ok(normalizeProgram(p1).error);
  const p2 = fixture();
  p2.rules[0].then = { t: 'boom' };
  assert.ok(normalizeProgram(p2).error);
});

test('nextWeekStart: a 0. pozícióból 2, az utolsó hétből a napok száma', () => {
  const p = fixture();
  assert.equal(nextWeekStart(p, 0), 2);
  assert.equal(nextWeekStart(p, 2), 4);
});
