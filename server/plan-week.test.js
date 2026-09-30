/**
 * FitTrack Pro — a heti bontású edzésterv tiszta függvényei (plan-week.js)
 * -----------------------------------------------------------------------
 * A régi tervek átalakítása, a beküldött hét validálása és a napok
 * feloldása („same" → a hivatkozott nap edzése). A HTTP-oldalt az
 * api.test.js próbálja ki; itt a szabályok maguk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allWeekExercises,
  dayEntry,
  dayWorkoutName,
  normalizeWeek,
  weekFromLegacy,
  workoutDays,
} from './plan-week.js';

const PUSH = [{ name: 'Fekvenyomás', sets: [{ reps: '5' }] }];
const PULL = [{ name: 'Húzódzkodás', sets: [{ reps: '8' }] }];
const REST = { type: 'rest' };

/** A szerver gyakorlat-normalizálójának egyszerű mása: üres lista = hiba. */
const exercisesOk = (raw) =>
  Array.isArray(raw) && raw.length ? { exercises: raw } : { error: 'nincs gyakorlat.' };

test('a régi terv: az első kijelölt nap az edzés, a többi ugyanaz, a többi pihenő', () => {
  const week = weekFromLegacy(PUSH, [4, 0, 2, 0]);
  assert.deepEqual(week, [
    { type: 'workout', name: '', exercises: PUSH },
    REST,
    { type: 'same', of: 0 },
    REST,
    { type: 'same', of: 0 },
    REST,
    REST,
  ]);
  assert.deepEqual(workoutDays(week), [0, 2, 4]);
});

test('kijelölt nap nélküli régi terv: az edzés hétfőre kerül', () => {
  const week = weekFromLegacy(PUSH, []);
  assert.equal(week[0].type, 'workout');
  assert.deepEqual(workoutDays(week), [0]);
  // Érvénytelen napok nem számítanak
  assert.deepEqual(workoutDays(weekFromLegacy(PUSH, [9, -1, 'kedd'])), [0]);
});

test('a hét validálása: pontosan hét nap, legalább egy edzésnap', () => {
  assert.ok(normalizeWeek([REST], exercisesOk).error);
  assert.ok(normalizeWeek(Array(7).fill(REST), exercisesOk).error, 'csak pihenő');

  const week = Array(7).fill(REST);
  week[0] = { type: 'workout', name: '  Push  ', exercises: PUSH };
  week[3] = { type: 'bármi' };
  const { week: normalized } = normalizeWeek(week, exercisesOk);
  assert.equal(normalized[0].name, 'Push', 'a név vágva');
  assert.deepEqual(normalized[3], REST, 'ismeretlen nap = pihenő');
});

test('az üres edzésnap hibát ad, a nap nevével', () => {
  const week = Array(7).fill(REST);
  week[0] = { type: 'workout', exercises: PUSH };
  week[2] = { type: 'workout', exercises: [] };
  assert.match(normalizeWeek(week, exercisesOk).error, /^Szerda:/);
});

test('a „same" csak edzésnapra mutathat — pihenőre, láncra, önmagára nem', () => {
  const base = () => {
    const week = Array(7).fill(REST);
    week[0] = { type: 'workout', exercises: PUSH };
    return week;
  };
  const ok = base();
  ok[4] = { type: 'same', of: 0 };
  assert.equal(normalizeWeek(ok, exercisesOk).error, undefined);

  const toRest = base();
  toRest[4] = { type: 'same', of: 1 };
  assert.match(normalizeWeek(toRest, exercisesOk).error, /^Péntek:/);

  const chain = base();
  chain[2] = { type: 'same', of: 0 };
  chain[4] = { type: 'same', of: 2 };
  assert.ok(normalizeWeek(chain, exercisesOk).error, 'lánc');

  const self = base();
  self[4] = { type: 'same', of: 4 };
  assert.ok(normalizeWeek(self, exercisesOk).error, 'önmaga');
});

test('a nap feloldása: saját edzés, „same", pihenő', () => {
  const week = Array(7).fill(REST);
  week[0] = { type: 'workout', name: 'Push', exercises: PUSH };
  week[2] = { type: 'workout', name: '', exercises: PULL };
  week[4] = { type: 'same', of: 0 };

  assert.deepEqual(dayEntry(week, 0), { weekday: 0, sourceDay: 0, name: 'Push', exercises: PUSH });
  assert.deepEqual(dayEntry(week, 4), { weekday: 4, sourceDay: 0, name: 'Push', exercises: PUSH });
  assert.equal(dayEntry(week, 1), null);
  assert.equal(dayEntry(null, 0), null);

  const plan = { name: 'Erő', week };
  assert.equal(dayWorkoutName(plan, 4), 'Push', 'a hivatkozott nap neve');
  assert.equal(dayWorkoutName(plan, 2), 'Erő – Szerda', 'név nélkül: terv – nap');

  assert.deepEqual(allWeekExercises(week), [...PUSH, ...PULL], 'a „same" nem duplikál');
});
