/**
 * FitTrack Pro — a régi (9 csoportos) izomtérképek szétosztása
 * ------------------------------------------------------------
 * A 12 csoportos taxonómia a régi `arms` és `back` kulcsot felbontja. A
 * check-inekben tárolt izomláz- és fájdalom-értékeknek ÁT kell öröklődniük
 * minden utódra — egy 8/10-es kar-fájdalom tiltása nem veszhet el.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { splitLegacyMuscleMap, resolveExerciseLoad } from './muscles.js';

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

/* ======================================================================
   Kulcsszavas becslés — a „curl" nem mindig bicepsz
   ====================================================================== */

/** A legnagyobb súlyú izomcsoport egy becsült load-ban. */
const dominant = (load) => Object.entries(load).sort((a, b) => b[1] - a[1])[0]?.[0];

test('a hasizom-„curl"-ök a törzsre mennek, nem a bicepszre', () => {
  for (const name of ['Curl-up', 'curl up', 'Ab curl', 'Cable ab curl']) {
    const load = resolveExerciseLoad(name, []);
    assert.equal(dominant(load), 'core', `${name} → ${JSON.stringify(load)}`);
    assert.equal(load.biceps, undefined, `${name}: a bicepszet nem terheli`);
  }
});

test('a Jefferson curl főleg az alsó hátat terheli', () => {
  const load = resolveExerciseLoad('Jefferson curl', []);
  assert.equal(dominant(load), 'lowerBack', JSON.stringify(load));
  assert.equal(load.biceps, undefined);
});

test('a valódi karhajlítások bicepszek maradnak, a Jefferson guggolás guggolás', () => {
  for (const name of ['Bicepsz curl', 'Hammer curl', 'Barbell curl', 'Concentration curl']) {
    assert.deepEqual(resolveExerciseLoad(name, []), { biceps: 1 }, name);
  }
  assert.equal(dominant(resolveExerciseLoad('Jefferson squat', [])), 'quads');
});

test('a szétosztás szűkíthető: csak az arms bomlik, a back változatlan', () => {
  // A check-in végpont így hívja (server.js → normalizeMuscleMap).
  assert.deepEqual(splitLegacyMuscleMap({ arms: 6, biceps: 8, back: 5 }, ['arms']), {
    biceps: 8,
    triceps: 6,
    back: 5,
  });
});
