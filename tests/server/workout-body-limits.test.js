/**
 * Podium — a szett-értékek felső korlátja (server/validation/workout-body.js)
 * -----------------------------------------------------------------------
 * A súly és az ismétlés legfeljebb 999 lehet. Korábban csak a negatív
 * értéket szűrtük: egy elgépelt 1100 (vagy 99999) kg egyéni csúccsá vált,
 * és a készenléti pontszámot is levitte. A túl nagy érték NEM vágódik le
 * csendben (az adatvesztés lenne), hanem érthető hibát kap — ugyanazon az
 * úton, mint a túl sok gyakorlat. Az ismétlés egész szám.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { exerciseLimitError, normalizeExercises } from '../../server/validation/workout-body.js';

const ex = (sets, extra = {}) => [{ name: 'Guggolás', sets, ...extra }];
const set = (reps, weight) => ({ reps, weight, rpe: '', type: 'work', done: true });

test('999 még menthető, afölött hibát kap a súly és az ismétlés is', () => {
  assert.equal(exerciseLimitError(ex([set('999', '999')])), null);
  assert.match(exerciseLimitError(ex([set('5', '1000')])), /súly.*999/i);
  assert.match(exerciseLimitError(ex([set('1000', '100')])), /ismétlés.*999/i);
  assert.match(exerciseLimitError(ex([set('1', '99999999999999999999')])), /súly/i);
});

test('a tizedesvesszős túl nagy érték sem csúszik át', () => {
  assert.match(exerciseLimitError(ex([set('5', '1100,5')])), /súly/i);
});

test('az időalapú sor súlya is korlátos', () => {
  const sets = [{ duration: '600', intensity: 'moderate', weight: '5000', done: true }];
  assert.match(exerciseLimitError(ex(sets, { logMode: 'duration' })), /súly/i);
});

test('a régi szöveges értékek („12 rep", „60% TM") továbbra is érvényesek', () => {
  assert.equal(exerciseLimitError(ex([set('12 rep', '60% TM')])), null);
  const [saved] = normalizeExercises(ex([set('12 rep', '60% TM')]));
  assert.equal(saved.sets[0].reps, '12 rep');
  assert.equal(saved.sets[0].weight, '60% TM');
});

test('az ismétlés egészre kerekedik, a súly tizedese megmarad', () => {
  const [saved] = normalizeExercises(ex([set('2.5', '82.5'), set('7.4', '1.25')]));
  assert.equal(saved.sets[0].reps, '3');
  assert.equal(saved.sets[0].weight, '82.5');
  assert.equal(saved.sets[1].reps, '7');
  assert.equal(saved.sets[1].weight, '1.25');
});
