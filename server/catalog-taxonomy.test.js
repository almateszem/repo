/**
 * FitTrack Pro — a 12 csoportos taxonómia a katalógusokban
 * --------------------------------------------------------
 * A szerkezeti ellenőrzést (ismert kulcs, összeg = 1) a catalog.js induláskor
 * elvégzi. Ez a teszt a TARTALMAT nézi: a jellegzetes gyakorlatok a
 * mozgásuknak megfelelő új csoportot terhelik.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MUSCLE_KEYS, MUSCLE_GROUPS, resolveExerciseLoad } from './muscles.js';
import { exercises } from './data/exercises.hu.js';
import { exdbExercises } from './data/exercises.exdb.js';

const loadOf = (name) => exercises.find((e) => e.name === name).load;

test('a tizenkét kulcs a felület sorrendjében', () => {
  assert.deepEqual(MUSCLE_KEYS, [
    'chest',
    'shoulders',
    'biceps',
    'triceps',
    'traps',
    'back',
    'lowerBack',
    'core',
    'quads',
    'hamstrings',
    'glutes',
    'calves',
  ]);
  assert.equal(MUSCLE_GROUPS.core, 'Has / core');
  assert.equal(MUSCLE_GROUPS.quads, 'Quad');
});

test('egyik katalógusban sem maradt arms kulcs', () => {
  for (const row of [...exercises, ...exdbExercises]) {
    assert.ok(!('arms' in row.load), `${row.name}: arms kulcs`);
  }
});

test('nyomás → tricepsz, húzás → bicepsz, vállvonogatás → trapéz, hiperextenzió → alsó hát', () => {
  assert.equal(loadOf('Fekvenyomás').triceps, 0.25);
  assert.equal(loadOf('Húzódzkodás').biceps, 0.25);
  assert.equal(loadOf('Bicepsz hajlítás').biceps, 1);
  assert.equal(loadOf('Homlok nyomás').triceps, 1);
  assert.equal(loadOf('Vállvonogatás').traps, 0.6);
  assert.equal(loadOf('Hiperextenzió').lowerBack, 0.4);
  assert.deepEqual(loadOf('Felhúzás'), {
    hamstrings: 0.3,
    glutes: 0.25,
    lowerBack: 0.2,
    back: 0.15,
    core: 0.1,
  });
});

test('a kulcsszavas becslés is az új csoportokra képez', () => {
  assert.ok(resolveExerciseLoad('bench press variáció', []).triceps > 0);
  assert.ok(resolveExerciseLoad('lat pulldown széles', []).biceps > 0);
  assert.ok(resolveExerciseLoad('shrug gépen', []).traps > 0);
  assert.ok(resolveExerciseLoad('hyperextension padon', []).lowerBack > 0);
  assert.equal(resolveExerciseLoad('skull crusher', []).triceps, 1);
  assert.equal(resolveExerciseLoad('hammer curl', []).biceps, 1);
  // A `\bcurl` bicepsz-minta önmagában elnyelné a "hamstring curl", "nordic
  // curl", "glute ham curl" gyakorlatokat is — ezek a comb hajlítás (hamstring)
  // sorhoz kell, hogy tartozzanak, ezért annak a mintája elé kerültek.
  assert.equal(resolveExerciseLoad('nordic curl', []).hamstrings, 1);
  assert.equal(resolveExerciseLoad('hamstring curl', []).hamstrings, 1);
  assert.equal(resolveExerciseLoad('glute ham curl', []).hamstrings, 1);
  assert.equal(resolveExerciseLoad('barbell curl', []).biceps, 1);
});
