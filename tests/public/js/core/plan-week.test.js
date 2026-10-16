/**
 * Podium — a ciklusos terv kliens-oldali tükre (public/js/core/plan-week.js)
 * --------------------------------------------------------------------------
 * Ugyanazokkal az esetekkel, mint a szerver plan-week.test.js-e: ha a kettő
 * elcsúszik, a kliens más napot tart „mának", mint a szerver.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cycleDay,
  dayAdjective,
  dayLabel,
  dayLetter,
  dayRound,
  dayTitle,
  todayIndex,
} from '../../../../public/js/core/plan-week.js';

const cyclePlan = (length, extra = {}) => ({
  week: Array.from({ length }, () => ({ type: 'rest' })),
  ...extra,
});

test('a napnév a hét napját követi, a második körben (2.) utótaggal', () => {
  assert.equal(dayTitle(0), 'Hétfő');
  assert.equal(dayTitle(6), 'Vasárnap');
  assert.equal(dayTitle(7), 'Hétfő (2.)');
  assert.equal(dayTitle(13), 'Vasárnap (2.)');
  assert.equal(dayLabel(2), 'Sze');
  assert.equal(dayLabel(8), 'K (2.)');
  assert.equal(dayLetter(8), 'K');
  assert.equal(dayRound(8), '2.');
  assert.equal(dayRound(3), '');
  assert.equal(dayAdjective(2), 'szerdai');
  assert.equal(dayAdjective(7), 'hétfői (2.)');
});

test('ciklus-nap: 7 napos terv = a hétnap, bármikor aktiválták', () => {
  assert.equal(cycleDay(cyclePlan(7, { activeSince: '2026.10.14' }), '2026.10.14'), 2);
  assert.equal(cycleDay(cyclePlan(7), '2026.10.16'), 4);
});

test('ciklus-nap: 9 napos terv az aktiválás hetének hétfőjétől számol', () => {
  const plan = cyclePlan(9, { activeSince: '2026.10.14' });
  assert.equal(cycleDay(plan, '2026.10.14'), 2);
  assert.equal(cycleDay(plan, '2026.10.19'), 7);
  assert.equal(cycleDay(plan, '2026.10.21'), 0);
});

test('ciklus-nap: rövid terv, horgony előtti nap, a létrehozás dátuma mint horgony', () => {
  assert.equal(cycleDay(cyclePlan(3, { activeSince: '2026.10.14' }), '2026.10.15'), 0);
  assert.equal(cycleDay(cyclePlan(9, { activeSince: '2026.10.14' }), '2026.10.11'), 8);
  assert.equal(cycleDay(cyclePlan(9, { date: '2026.10.07' }), '2026.10.14'), 0);
});

test('ciklus-nap: az óraátállítás nem csúsztatja el a ciklust', () => {
  assert.equal(cycleDay(cyclePlan(9, { activeSince: '2026.03.23' }), '2026.03.30'), 7);
});

test('ciklus-nap dátum nélkül a mai napra szól', () => {
  const d = new Date();
  assert.equal(cycleDay(cyclePlan(7)), (d.getDay() + 6) % 7);
});

test('a „ma" az aktív terven és a hétnapos terven a ciklus napja, máshol nincs', () => {
  const nine = cyclePlan(9, { activeSince: '2026.10.14' });
  assert.equal(todayIndex({ ...nine, active: true }, '2026.10.19'), 7);
  assert.equal(todayIndex({ ...nine, active: false }, '2026.10.19'), -1, 'inaktív, nem heti');
  assert.equal(todayIndex({ ...cyclePlan(7), active: false }, '2026.10.16'), 4);
});
