/**
 * Podium — a blokkos programok kliensoldali modellje (public/js/program/program-model.js)
 * --------------------------------------------------------------------------
 * A képlet-tükör (ugyanazt kell számolnia, mint a szervernek — paritás-
 * teszt), a sorbeli címke, a képletfa- és programfa-műveletek, a blokktár
 * szabályai és a kg-mezők beolvasása.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as server from '../../../../server/program/formula.js';
import {
  MissingValueError,
  canUseNode,
  duplicateDay,
  duplicateWeek,
  evalFormula,
  formulaLabel,
  getAt,
  insertBlock,
  insertIntoRoot,
  missingText,
  parseKg,
  removeAt,
  roundToPlate,
  setAt,
  weekSummary,
} from '../../../../public/js/program/program-model.js';

const num = (v, pct = false) => ({ t: 'num', v, pct });
const op = (o, a, b) => ({ t: 'op', op: o, a, b });
const TM = { t: 'tm' };
const orm = (ex = null) => ({ t: 'orm', ex });
const stat = (k) => ({ t: 'stat', k });

test('parseKg vesszővel: „112,5” → 112.5, „abc” → null', () => {
  assert.equal(parseKg('112,5'), 112.5);
  assert.equal(parseKg(' 100 '), 100);
  assert.equal(parseKg('abc'), null);
  assert.equal(parseKg('0'), null);
  assert.equal(parseKg('1200'), null);
  assert.equal(parseKg(''), null);
});

test('formulaLabel: (TM + 5) × 90% zárójelez, 60% × 1RM: Guggolás + 5 nem', () => {
  assert.equal(formulaLabel(op('*', op('+', TM, num(5)), num(90, true))), '(TM + 5) × 90%');
  assert.equal(
    formulaLabel(op('+', op('*', num(60, true), orm('Guggolás')), num(5))),
    '60% × 1RM: Guggolás + 5',
  );
  assert.equal(formulaLabel(op('-', TM, op('-', num(5), num(2.5)))), 'TM − (5 − 2,5)');
  assert.equal(formulaLabel(op('-', stat('totalAll'), num(10))), 'összes (mind) − 10');
  assert.equal(formulaLabel(op('*', TM, null)), 'TM × □');
  assert.equal(formulaLabel(null), '□');
});

test('getAt / setAt / removeAt: másolatot ad, nem mutál', () => {
  const root = op('*', num(85, true), TM);
  assert.deepEqual(getAt(root, 'b'), TM);
  assert.equal(getAt(root, ''), root);
  const next = setAt(root, 'a', num(90, true));
  assert.equal(root.a.v, 85);
  assert.equal(next.a.v, 90);
  assert.equal(removeAt(root, 'b').b, null);
  assert.deepEqual(root.b, TM);
  assert.equal(removeAt(root, ''), null);
});

test('insertBlock: × a TM-re → TM × □, a nextSel a „b”', () => {
  const { root, nextSel } = insertBlock(TM, '', op('*', null, null));
  assert.deepEqual(root, op('*', TM, null));
  assert.equal(nextSel, 'b');
  const filled = insertBlock(root, 'b', num(85, true));
  assert.deepEqual(filled.root, op('*', TM, num(85, true)));
  assert.equal(filled.nextSel, null);
  const empty = insertBlock(null, '', op('+', null, null));
  assert.deepEqual(empty.root, op('+', null, null));
  assert.equal(empty.nextSel, 'a');
});

test('insertIntoRoot: TM × □ + 85% → TM × 85%; üresbe a sablon', () => {
  assert.deepEqual(insertIntoRoot(op('*', TM, null), num(85, true)), op('*', TM, num(85, true)));
  assert.deepEqual(insertIntoRoot(null, TM), TM);
  assert.deepEqual(insertIntoRoot(TM, op('*', null, null)), op('*', TM, null));
  assert.deepEqual(insertIntoRoot(TM, num(5)), num(5));
});

test('canUseNode: stat a szett súlyában hibaüzenet, feltételben null', () => {
  assert.equal(
    canUseNode(stat('pain'), 'set'),
    'A teljesítmény- és check-in értékek csak szabályfeltételben használhatók.',
  );
  assert.equal(canUseNode(stat('pain'), 'cond'), null);
  assert.equal(
    canUseNode(op('*', num(95, true), { t: 'newOrm' }), 'cond'),
    'Az „új 1RM” csak a szabály „TM = képlet” akciójában használható.',
  );
  assert.equal(canUseNode({ t: 'newOrm' }, 'act'), null);
  assert.equal(canUseNode(TM, 'set'), null);
});

const exercise = (pcts) => ({
  name: 'Guggolás',
  role: 'main',
  sets: pcts.map((p) => ({ count: 1, reps: 5, amrap: false, weight: op('*', num(p, true), TM) })),
});
const prog = () => ({
  weeks: [
    { label: '1. hét', days: [{ name: 'A', exercises: [exercise([65, 75, 85])] }] },
    { label: '2. hét', days: [{ name: 'B', exercises: [exercise([70, 80, 90])] }] },
  ],
  rules: [],
  steps: {},
});

test('duplicateWeek: a másolat az eredeti után, a módosítás nem hat vissza', () => {
  const p = prog();
  const next = duplicateWeek(p, 0);
  assert.equal(p.weeks.length, 2);
  assert.equal(next.weeks.length, 3);
  assert.deepEqual(next.weeks[1], p.weeks[0]);
  next.weeks[1].days[0].name = 'Másolat';
  assert.equal(next.weeks[0].days[0].name, 'A');
  assert.equal(next.weeks[2].label, '2. hét');
});

test('duplicateDay: a nap másolata közvetlenül utána', () => {
  const next = duplicateDay(prog(), 1, 0);
  assert.equal(next.weeks[1].days.length, 2);
  assert.deepEqual(next.weeks[1].days[1], next.weeks[1].days[0]);
  assert.notEqual(next.weeks[1].days[1], next.weeks[1].days[0]);
});

test('weekSummary: az első nap első fő gyakorlatának százalékai', () => {
  assert.equal(weekSummary(prog().weeks[0]), '65 / 75 / 85%');
  assert.equal(weekSummary({ label: '', days: [{ name: '', exercises: [] }] }), '');
});

const FIXTURES = [
  [op('*', num(85, true), TM), {}],
  [op('+', op('*', num(60, true), orm('Guggolás')), num(5)), {}],
  [op('-', { t: 'bw' }, num(20)), {}],
  [orm(), {}],
  [TM, { exercise: 'Ismeretlen' }],
  [orm('Ismeretlen'), {}],
  [{ t: 'bw' }, { bodyweight: null }],
  [op('*', num(95, true), { t: 'newOrm' }), { newOrm: 150 }],
  [{ t: 'newOrm' }, {}],
  [op('-', stat('totalAll'), num(10)), { stats: { totalAll: 24 } }],
  [stat('pain'), { stats: { pain: null } }],
  [op('*', op('+', TM, num(2.5)), num(70, true)), { trainingMaxes: { Guggolás: 160 } }],
];

test('szerver–kliens paritás: 12 fixture azonos eredménnyel vagy azonos hibafajtával', () => {
  const base = {
    exercise: 'Guggolás',
    trainingMaxes: { Guggolás: 100 },
    oneRms: { Guggolás: 140 },
    bodyweight: 82.5,
  };
  const outcome = (fn, f, ctx) => {
    try {
      const v = fn(f, ctx);
      return { v, plate: server.roundToPlate(v) };
    } catch (e) {
      return { kind: e.kind, exercise: e.exercise };
    }
  };
  for (const [f, extra] of FIXTURES) {
    const ctx = { ...base, ...extra };
    const s = outcome(server.evalFormula, f, ctx);
    const c = outcome(evalFormula, f, ctx);
    assert.deepEqual(c, s, JSON.stringify(f));
    if (c.v != null) assert.equal(roundToPlate(c.v), s.plate);
  }
  assert.ok(new MissingValueError('tm', 'X') instanceof Error);
  assert.equal(roundToPlate(162.5 * 0.7), 115);
});

test('missingText: a hiány neve az élő előnézetben', () => {
  assert.equal(
    missingText(new MissingValueError('tm', 'Elöl guggolás')),
    'nincs TM: Elöl guggolás',
  );
  assert.equal(missingText(new MissingValueError('orm', 'Guggolás')), 'nincs 1RM: Guggolás');
  assert.equal(missingText(new MissingValueError('bw')), 'nincs testsúly');
  assert.equal(missingText(new MissingValueError('slot')), 'üres hely a képletben');
});
