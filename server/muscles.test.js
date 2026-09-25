/**
 * FitTrack Pro — a régi (9 csoportos) izomtérképek szétosztása
 * ------------------------------------------------------------
 * A 12 csoportos taxonómia a régi `arms` és `back` kulcsot felbontja. A
 * check-inekben tárolt izomláz- és fájdalom-értékeknek ÁT kell öröklődniük
 * minden utódra — egy 8/10-es kar-fájdalom tiltása nem veszhet el.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { splitLegacyMuscleMap } from './muscles.js';

test('az arms a bicepszre és a tricepszre is átmásolódik', () => {
  assert.deepEqual(splitLegacyMuscleMap({ arms: 6, chest: 2 }), {
    biceps: 6,
    triceps: 6,
    chest: 2,
  });
});

test('a back megmarad, és a trapézra meg az alsó hátra is átmásolódik', () => {
  assert.deepEqual(splitLegacyMuscleMap({ back: 7 }), { back: 7, traps: 7, lowerBack: 7 });
});

test('a nem csoporthoz kötött general fájdalom változatlan', () => {
  assert.deepEqual(splitLegacyMuscleMap({ general: 3 }), { general: 3 });
});

test('ütközésnél a nagyobb érték nyer (óvatos irány)', () => {
  assert.deepEqual(splitLegacyMuscleMap({ biceps: 2, arms: 5 }), { biceps: 5, triceps: 5 });
  assert.deepEqual(splitLegacyMuscleMap({ traps: 9, back: 4 }), {
    traps: 9,
    back: 4,
    lowerBack: 4,
  });
});

test('üres és hibás bemenetre üres objektum', () => {
  assert.deepEqual(splitLegacyMuscleMap({}), {});
  assert.deepEqual(splitLegacyMuscleMap(null), {});
  assert.deepEqual(splitLegacyMuscleMap('x'), {});
});
