/**
 * Podium — a napló, a terv és a blokkos program közös korlátai
 * -----------------------------------------------------------------------
 * P6: a gyakorlatnév minden mentésnél 60 karakterre vágódott, pedig a
 *     katalógusban 9 hosszabb név is van — a csonka név többé nem egyezett
 *     a katalógussal, és a program-szabályok sem találták.
 * P7: a „0+ AMRAP" szett elvesztette a jelzőjét, és az AMRAP-szabály mindig
 *     „nincs adat" lett. AMRAP-nál legalább 1 ismétlés az előírás.
 * P9: érvényes program olyan napot is generálhatott, amit a mentés
 *     elutasított (túl hosszú cím, 50-nél több szett egy gyakorlatra) — a
 *     hiba csak az edzés végén, a „Befejezés"-nél derült ki.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExercises } from '../../server/validation/workout-body.js';
import { buildDayWorkout, normalizeProgram } from '../../server/program/program.js';
import { buildExerciseCatalog } from '../../server/data/catalog.js';
import { EXERCISE_NAME_MAX } from '../../server/limits.js';

const LONG = 'Kábeles álló fordított fogású egykezes fej fölötti tricepsz nyújtás'; // 67

const set = { reps: '10', weight: '20', rpe: '', type: 'work', done: true };

test('P6: a katalógus minden gyakorlatneve belefér a korlátba', () => {
  const tooLong = buildExerciseCatalog()
    .map((e) => e.name)
    .filter((name) => name.length > EXERCISE_NAME_MAX);
  assert.deepEqual(tooLong, []);
});

test('P6: a hosszú katalógus-név csonkítás nélkül mentődik', () => {
  const [ex] = normalizeExercises([{ name: LONG, sets: [set] }]);
  assert.equal(ex.name, LONG);
});

const program = ({ label = '1. hét', day = 'A nap', sets } = {}) => ({
  weeks: [
    {
      label,
      days: [
        {
          name: day,
          exercises: [
            {
              name: LONG,
              role: 'main',
              sets: sets ?? [{ count: 3, reps: 5, amrap: false, weight: null }],
            },
          ],
        },
      ],
    },
  ],
  rules: [],
});

test('P6: a program a hosszú gyakorlatnevet is egészben tartja meg', () => {
  const { program: p, error } = normalizeProgram(program());
  assert.equal(error, undefined);
  assert.equal(buildDayWorkout(p, 0, {}).exercises[0].name, LONG);
});

test('P7: AMRAP-szett 0 előírt ismétléssel nem menthető', () => {
  const { error } = normalizeProgram(
    program({ sets: [{ count: 1, reps: 0, amrap: true, weight: null }] }),
  );
  assert.match(error, /AMRAP/);
});

test('P7: az 1 ismétléses AMRAP-szett jelzője megmarad a naplóban is', () => {
  const { program: p } = normalizeProgram(
    program({ sets: [{ count: 1, reps: 1, amrap: true, weight: null }] }),
  );
  const [ex] = normalizeExercises(buildDayWorkout(p, 0, {}).exercises);
  assert.equal(ex.sets[0].amrap, 1);
});

test('P7: a nem-AMRAP szett továbbra is lehet 0 ismétléses', () => {
  const { error } = normalizeProgram(
    program({ sets: [{ count: 1, reps: 0, amrap: false, weight: null }] }),
  );
  assert.equal(error, undefined);
});

test('P9: a túl hosszú napcím (hét + nap) már a program mentésekor hibát ad', () => {
  const { error } = normalizeProgram(program({ label: 'H'.repeat(40), day: 'N'.repeat(40) }));
  assert.match(error, /60/);
  assert.match(error, /rövidítsd/);
});

test('P9: a 60 karakteres napcím még belefér, és a napló is elfogadja', () => {
  const label = 'H'.repeat(30);
  const day = 'N'.repeat(27); // 30 + " · " + 27 = 60
  const { program: p, error } = normalizeProgram(program({ label, day }));
  assert.equal(error, undefined);
  assert.equal(buildDayWorkout(p, 0, {}).name.length, 60);
});

test('P9: 50-nél több kibontott szett egy gyakorlatra hibát ad, a gyakorlat nevével', () => {
  const sets = [1, 2, 3].map(() => ({ count: 20, reps: 5, amrap: false, weight: null }));
  const { error } = normalizeProgram(program({ sets }));
  assert.match(error, /50/);
  assert.ok(error.includes(LONG), error);
});

test('P9: pontosan 50 kibontott szett még belefér', () => {
  const sets = [
    { count: 20, reps: 5, amrap: false, weight: null },
    { count: 20, reps: 5, amrap: false, weight: null },
    { count: 10, reps: 5, amrap: false, weight: null },
  ];
  const { error } = normalizeProgram(program({ sets }));
  assert.equal(error, undefined);
});
