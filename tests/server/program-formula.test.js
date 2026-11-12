/**
 * Podium — a blokkos programok súlyképlete (server/program/formula.js)
 * -----------------------------------------------------------------------
 * A képletfa validálása, kiértékelése és a 2,5 kg-os kerekítés.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MissingValueError,
  evalFormula,
  formulaRefs,
  formulaText,
  hu,
  normalizeFormula,
  roundToPlate,
} from '../../server/program/formula.js';

const num = (v, pct = false) => ({ t: 'num', v, pct });
const op = (o, a, b) => ({ t: 'op', op: o, a, b });

test('85% × TM a sor gyakorlatának TM-jéből', () => {
  const f = op('*', num(85, true), { t: 'tm' });
  const ctx = { exercise: 'Guggolás', trainingMaxes: { Guggolás: 100 }, oneRms: {} };
  assert.equal(evalFormula(f, ctx), 85);
});

test('60% × 1RM(Guggolás) + 5 → 71, kerekítve 70', () => {
  const f = op('+', op('*', num(60, true), { t: 'orm', ex: 'Guggolás' }), num(5));
  const x = evalFormula(f, {
    exercise: 'Elöl guggolás',
    trainingMaxes: {},
    oneRms: { Guggolás: 110 },
  });
  assert.equal(x, 71);
  assert.equal(roundToPlate(x), 70);
});

test('roundToPlate: 119 → 120, 91 → 90, −3 → 0, 162,5 × 0,7 → 115', () => {
  assert.equal(roundToPlate(119), 120);
  assert.equal(roundToPlate(91), 90);
  assert.equal(roundToPlate(-3), 0);
  assert.equal(roundToPlate(162.5 * 0.7), 115);
});

test('hiányzó TM: MissingValueError kind=tm, exercise=Elöl guggolás', () => {
  assert.throws(
    () => evalFormula({ t: 'tm' }, { exercise: 'Elöl guggolás', trainingMaxes: {}, oneRms: {} }),
    (e) => e instanceof MissingValueError && e.kind === 'tm' && e.exercise === 'Elöl guggolás',
  );
});

test('stat: ctx.stats.doneAll 12 → 12; null stat → MissingValueError kind=stat', () => {
  const ctx = {
    exercise: 'Guggolás',
    trainingMaxes: {},
    oneRms: {},
    stats: { doneAll: 12, pain: null },
  };
  assert.equal(evalFormula({ t: 'stat', k: 'doneAll' }, ctx), 12);
  assert.throws(
    () => evalFormula({ t: 'stat', k: 'pain' }, ctx),
    (e) => e instanceof MissingValueError && e.kind === 'stat',
  );
});

test('normalizeFormula: ismeretlen t, nem véges szám, 9 mély fa, newOrm engedély nélkül → null', () => {
  assert.equal(normalizeFormula({ t: 'xyz' }), null);
  assert.equal(normalizeFormula({ t: 'num', v: Infinity, pct: false }), null);
  let deep = { t: 'tm' };
  for (let i = 0; i < 9; i++) deep = op('+', deep, num(1));
  assert.equal(normalizeFormula(deep), null);
  assert.equal(normalizeFormula({ t: 'newOrm' }), null);
});

test('normalizeFormula: allowNewOrm mellett a newOrm érvényes', () => {
  const f = op('*', num(95, true), { t: 'newOrm' });
  assert.deepEqual(normalizeFormula({ ...f, extra: 1 }, { allowNewOrm: true }), f);
});

test('normalizeFormula: stat csak allowStat mellett, ismeretlen k → null', () => {
  assert.equal(normalizeFormula({ t: 'stat', k: 'pain' }), null);
  assert.deepEqual(normalizeFormula({ t: 'stat', k: 'pain' }, { allowStat: true }), {
    t: 'stat',
    k: 'pain',
  });
  assert.equal(normalizeFormula({ t: 'stat', k: 'nope' }, { allowStat: true }), null);
});

test('normalizeFormula: 32-nél több csomópont → null, a szám szövegből is olvasható', () => {
  let wide = num(1);
  for (let i = 0; i < 20; i++) wide = op('+', wide, num(1));
  assert.equal(normalizeFormula(wide), null);
  assert.deepEqual(normalizeFormula({ t: 'num', v: '20', pct: 0 }), num(20));
});

test('formulaRefs: 60% × 1RM(Guggolás) + TM → tm:true, orm:["Guggolás"]', () => {
  const f = op('+', op('*', num(60, true), { t: 'orm', ex: 'Guggolás' }), { t: 'tm' });
  assert.deepEqual(formulaRefs(f), {
    tm: true,
    orm: ['Guggolás'],
    bw: false,
    newOrm: false,
    stat: false,
  });
});

test('formulaText: összes (mind) − 10, 95% × új 1RM', () => {
  assert.equal(formulaText(op('-', { t: 'stat', k: 'totalAll' }, num(10))), 'összes (mind) − 10');
  assert.equal(formulaText(op('*', num(95, true), { t: 'newOrm' })), '95% × új 1RM');
  assert.equal(formulaText({ t: 'orm', ex: null }), '1RM');
  assert.equal(formulaText(num(12.5)), '12,5');
});

test('hu: 112.5 → „112,5”, 70 → „70”', () => {
  assert.equal(hu(112.5), '112,5');
  assert.equal(hu(70), '70');
});
