import test from 'node:test';
import assert from 'node:assert/strict';

import { failureWeight, buildNoveltyIndex, dayKey } from './recovery.js';

test('failureWeight: konvex a bukás közelsége szerint', () => {
  assert.equal(failureWeight(5, 8), 0.2);
  assert.equal(failureWeight(6, 8), 0.2);
  assert.equal(failureWeight(7, 8), 0.4);
  assert.equal(failureWeight(8, 8), 0.55);
  assert.equal(failureWeight(9, 8), 0.75);
  assert.equal(failureWeight(10, 8), 1);
  assert.equal(failureWeight(10, 12), 1.3);
  assert.equal(failureWeight(null, 8), 0.55, 'hiányzó RPE: RIR 2');
});

const pad = (v) => String(v).padStart(2, '0');
const START = new Date(2026, 0, 5);
const dayOf = (n) => {
  const d = new Date(START);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};
const sets = (n) =>
  Array.from({ length: n }, () => ({
    reps: '8',
    weight: '60',
    rpe: '8',
    done: true,
  }));
const wo = (n, names) => ({
  date: dayOf(n),
  exercises: names.map((name) => ({ name, sets: sets(3) })),
});

/** A `last` edzés újdonsága a megadott csoportra. */
function noveltyOf(workouts, last, exerciseIndex, group) {
  const index = buildNoveltyIndex(workouts, dayKey(dayOf(last.at)), []);
  return index.get(last.workout)?.[exerciseIndex]?.[group];
}

test('buildNoveltyIndex: megszokott gyakorlatnál és rendszeres edzésnél 1', () => {
  const history = [0, 7, 14, 21, 28, 35].map((n) => wo(n, ['Guggolás']));
  const last = wo(42, ['Guggolás']);
  assert.deepEqual(noveltyOf([...history, last], { at: 42, workout: last }, 0, 'quads'), {
    value: 1,
    reason: null,
  });
});

test('buildNoveltyIndex: a mellékizom kis részesedése nem ad kihagyás-szorzót', () => {
  const history = [0, 7, 14, 21, 28, 35].map((n) => wo(n, ['Guggolás']));
  const last = wo(42, ['Guggolás']);
  const all = [...history, last];
  for (const group of ['glutes', 'core']) {
    assert.deepEqual(
      noveltyOf(all, { at: 42, workout: last }, 0, group),
      {
        value: 1,
        reason: null,
      },
      group,
    );
  }
});

test('buildNoveltyIndex: új gyakorlat 1,3, excentrikus új gyakorlat 1,5', () => {
  const history = [0, 7, 14, 21, 28, 35].map((n) => wo(n, ['Guggolás']));
  const last = wo(42, ['Lábtolás', 'Bolgár guggolás']);
  const all = [...history, last];
  assert.deepEqual(noveltyOf(all, { at: 42, workout: last }, 0, 'quads'), {
    value: 1.3,
    reason: 'novelty',
  });
  assert.deepEqual(noveltyOf(all, { at: 42, workout: last }, 1, 'quads'), {
    value: 1.5,
    reason: 'novelty',
  });
});

test('buildNoveltyIndex: az új gyakorlat a 3. alkalomtól már nem új', () => {
  const history = [0, 7, 14, 21, 28].map((n) => wo(n, ['Guggolás']));
  const second = wo(35, ['Guggolás', 'Lábtolás']);
  const first = wo(31, ['Lábtolás']);
  const third = wo(42, ['Guggolás', 'Lábtolás']);
  const all = [...history, first, second, third];
  assert.equal(
    noveltyOf(all, { at: 35, workout: second }, 1, 'quads').value,
    1.3,
    '2. alkalom még új',
  );
  assert.equal(
    noveltyOf(all, { at: 42, workout: third }, 1, 'quads').value,
    1,
    '3. alkalom már nem',
  );
});

test('buildNoveltyIndex: hosszú kihagyás után a görbe szerint nő', () => {
  const history = [0, 7, 14, 21, 28, 35].map((n) => wo(n, ['Guggolás']));
  const after26w = wo(35 + 26 * 7, ['Guggolás']);
  const result = noveltyOf(
    [...history, after26w],
    { at: 35 + 26 * 7, workout: after26w },
    0,
    'quads',
  );
  assert.equal(result.reason, 'gap');
  assert.ok(result.value > 1.7 && result.value < 1.75, `26 hétnél ~1,72 (${result.value})`);

  const after3w = wo(35 + 21, ['Guggolás']);
  assert.equal(noveltyOf([...history, after3w], { at: 56, workout: after3w }, 0, 'quads').value, 1);
});

test('buildNoveltyIndex: 4 hétnél rövidebb előzménynél nincs újdonság-szorzó', () => {
  const first = wo(0, ['Guggolás']);
  const later = wo(20, ['Bolgár guggolás']);
  const all = [first, later];
  assert.deepEqual(noveltyOf(all, { at: 20, workout: later }, 0, 'quads'), undefined);
});

test('buildNoveltyIndex: üres vagy érvénytelen napló nem hiba', () => {
  assert.equal(buildNoveltyIndex([], dayKey(dayOf(0)), []).size, 0);
  assert.equal(buildNoveltyIndex(null, dayKey(dayOf(0)), []).size, 0);
  assert.equal(buildNoveltyIndex([{ date: 'rossz', exercises: [] }], dayKey(dayOf(0)), []).size, 0);
});

test('buildNoveltyIndex: korábbi érdemi terhelés nélküli csoportra nincs kihagyás-szorzó', () => {
  const history = [0, 7, 14, 21, 28, 35].map((n) => wo(n, ['Guggolás']));
  const last = wo(42, ['Vádliemelés']);
  assert.deepEqual(noveltyOf([...history, last], { at: 42, workout: last }, 0, 'calves'), {
    value: 1.3,
    reason: 'novelty',
  });
});
