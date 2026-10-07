import assert from 'node:assert/strict';
import test from 'node:test';
import { copyExercises, inlineSameDays, matchesQuery } from './plan-sources.js';

const squat = { name: 'Guggolás', pr: true, sets: [{ reps: 5, weight: 100, done: true }] };

test('a „same" nap a hivatkozott nap másolatává válik', () => {
  const week = [
    { type: 'workout', name: 'Láb nap', exercises: [{ ...squat }] },
    { type: 'rest' },
    { type: 'rest' },
    { type: 'same', of: 0 },
    { type: 'rest' },
    { type: 'rest' },
    { type: 'rest' },
  ];
  const result = inlineSameDays(week);
  assert.equal(result[3].type, 'workout');
  assert.equal(result[3].name, 'Láb nap');
  assert.equal(result[3].exercises[0].name, 'Guggolás');
  // Másolat: a forrás átírása nem hat rá
  week[0].exercises[0].name = 'Más';
  assert.equal(result[3].exercises[0].name, 'Guggolás');
  assert.deepEqual(result[1], { type: 'rest' });
});

test('érvénytelen „same" hivatkozás pihenő lesz', () => {
  const week = [{ type: 'same', of: 1 }, { type: 'rest' }, { type: 'same', of: 9 }];
  assert.deepEqual(inlineSameDays(week), [{ type: 'rest' }, { type: 'rest' }, { type: 'rest' }]);
});

test('a másolt gyakorlat nem rekord, és egyik szettje sincs kész', () => {
  const [copy] = copyExercises([squat]);
  assert.equal(copy.pr, false);
  assert.equal(copy.sets[0].done, false);
  assert.equal(copy.sets[0].weight, 100);
  assert.equal(squat.sets[0].done, true, 'a forrás érintetlen');
});

test('a keresés a névre és a gyakorlatok nevére is illeszkedik', () => {
  const source = { name: 'Láb nap', exercises: [squat] };
  assert.equal(matchesQuery(source, ''), true);
  assert.equal(matchesQuery(source, '  láb '), true);
  assert.equal(matchesQuery(source, 'GUGG'), true);
  assert.equal(matchesQuery(source, 'fekve'), false);
});
