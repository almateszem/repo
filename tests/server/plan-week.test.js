/**
 * Podium — a heti bontású edzésterv tiszta függvényei (plan-week.js)
 * -----------------------------------------------------------------------
 * A régi tervek átalakítása, a beküldött hét validálása és a napok
 * feloldása („same" → a hivatkozott nap edzése). A HTTP-oldalt az
 * api.test.js próbálja ki; itt a szabályok maguk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allWeekExercises,
  cycleDay,
  dayEntry,
  dayLabel,
  dayName,
  dayWorkoutName,
  normalizeWeek,
  weekFromLegacy,
  workoutDays,
} from '../../server/plan-week.js';

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

test('a hét validálása: legalább egy edzésnap', () => {
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

/* ---- Változó hosszú terv: 1–14 napos ciklus ---- */

const cyclePlan = (length, extra = {}) => ({
  week: Array.from({ length }, () => ({ ...REST })),
  ...extra,
});

test('a napnév a hét napját követi, a második körben (2.) utótaggal', () => {
  assert.equal(dayName(0), 'Hétfő');
  assert.equal(dayName(6), 'Vasárnap');
  assert.equal(dayName(7), 'Hétfő (2.)');
  assert.equal(dayName(13), 'Vasárnap (2.)');
  assert.equal(dayLabel(2), 'Sze');
  assert.equal(dayLabel(8), 'K (2.)');
});

test('ciklus-nap: 7 napos terv = a hétnap, bármikor aktiválták', () => {
  assert.equal(cycleDay(cyclePlan(7, { activeSince: '2026.10.14' }), '2026.10.14'), 2);
  assert.equal(cycleDay(cyclePlan(7), '2026.10.16'), 4, 'horgony nélkül is péntek');
});

test('ciklus-nap: 9 napos terv az aktiválás hetének hétfőjétől számol', () => {
  const plan = cyclePlan(9, { activeSince: '2026.10.14' }); // horgony: 2026.10.12, hétfő
  assert.equal(cycleDay(plan, '2026.10.14'), 2);
  assert.equal(cycleDay(plan, '2026.10.19'), 7, 'a következő hétfő = „Hétfő (2.)"');
  assert.equal(cycleDay(plan, '2026.10.21'), 0, 'újrakezdődik');
});

test('ciklus-nap: rövid terv, horgony előtti nap, a létrehozás dátuma mint horgony', () => {
  assert.equal(cycleDay(cyclePlan(3, { activeSince: '2026.10.14' }), '2026.10.15'), 0);
  assert.equal(cycleDay(cyclePlan(9, { activeSince: '2026.10.14' }), '2026.10.11'), 8);
  assert.equal(cycleDay(cyclePlan(9, { date: '2026.10.07' }), '2026.10.14'), 0);
});

test('ciklus-nap: az óraátállítás nem csúsztatja el a ciklust', () => {
  // 2026.03.29 a 23 órás nap
  assert.equal(cycleDay(cyclePlan(9, { activeSince: '2026.03.23' }), '2026.03.30'), 7);
});

test('normalizeWeek: 1 és 14 nap között fogad el', () => {
  const day = { type: 'workout', name: '', exercises: PUSH };
  assert.ok(normalizeWeek([day], exercisesOk).week);
  assert.equal(normalizeWeek(Array(14).fill(day), exercisesOk).week.length, 14);
  for (const raw of [[], Array(15).fill(day)]) {
    assert.equal(normalizeWeek(raw, exercisesOk).error, 'A tervnek 1–14 napból kell állnia.');
  }
  // a 9 napos terv utolsó (8.) napja a tartományon kívüli 9. napra mutat
  const nine = [day, ...Array(7).fill(REST), { type: 'same', of: 9 }];
  assert.equal(
    normalizeWeek(nine, exercisesOk).error,
    'Kedd (2.): csak egy edzésnappal lehet azonos.',
  );
});
