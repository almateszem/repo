/**
 * Podium — az AMRAP-jelölés a naplózott szetten (server/validation/workout-body.js)
 * -----------------------------------------------------------------------
 * A blokkos program AMRAP-szettje `amrap` mezőt kap (az előírt minimum).
 * A mentés megtartja, ha érvényes (egész, 1–100), különben eldobja; más
 * szettalakon nem változtat.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExercises } from '../../server/validation/workout-body.js';

const set = (extra) => ({ reps: '7', weight: '85', rpe: '', type: 'work', done: true, ...extra });

test('a szett amrap mezője megmarad, érvénytelen értéknél eltűnik', () => {
  const [ex] = normalizeExercises([
    {
      name: 'Guggolás',
      sets: [set({ amrap: 5 }), set({ amrap: 0 }), set({ amrap: 2.5 }), set({ amrap: '5' }), set()],
    },
  ]);
  assert.equal(ex.sets[0].amrap, 5);
  assert.ok(!('amrap' in ex.sets[1]));
  assert.ok(!('amrap' in ex.sets[2]));
  assert.ok(!('amrap' in ex.sets[3]));
  assert.ok(!('amrap' in ex.sets[4]));
  assert.deepEqual(Object.keys(ex.sets[4]).sort(), ['done', 'reps', 'rpe', 'type', 'weight']);
});
