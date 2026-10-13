/**
 * FitTrack Pro — a számítás-átvizsgálás (2026-09-17) végponti tesztjei
 * --------------------------------------------------------------------
 * A motor-szintű javításokat a recovery.test.js és a dst.test.js őrzi. Ez a
 * fájl azokat, amelyek a végpontok és az adatréteg összjátékán múlnak:
 * a check-in folyadék-mezője, az adag-javítás pontossága, az erőfelmérés
 * határa, a bemondott csúcsok túlélése egy törlésen és a súlycsökkentési
 * javaslat kis súlyokon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom } from './test-harness.js';

const { request } = await startServer({ label: 'szamitas' });

const register = async (username) =>
  cookieFrom(
    await request('POST', '/api/auth/register', {
      body: { username, displayName: username, password: 'jelszo789' },
    }),
  );

test('folyadék nélküli check-in nem nullázza a víznaplóból jövő folyadékot', async () => {
  const cookie = await register('vizmegorzo');
  await request('POST', '/api/water', { cookie, body: { ml: 1500 } });

  await request('PUT', '/api/checkin', { cookie, body: { sleepHours: 8, energy: 4 } });
  const checkin = (await request('GET', '/api/checkin', { cookie })).json;
  assert.equal(checkin.hydration, 1.5, 'a motor továbbra is látja a napi 1,5 litert');
  assert.equal((await request('GET', '/api/water', { cookie })).json.totalMl, 1500);

  // Víznapló nélkül a mező üres marad — nem gyártunk nullát
  const other = await register('vizteleno');
  await request('PUT', '/api/checkin', { cookie: other, body: { sleepHours: 8 } });
  assert.equal((await request('GET', '/api/checkin', { cookie: other })).json.hydration, null);
});

test('az adag javítása a kerekítetlen 100 g-os alapértékből számol', async () => {
  const cookie = await register('adagjavito');
  // Csirkemell (nyers): 110 kcal, 23 g fehérje / 100 g
  const logged = await request('POST', '/api/nutrition/log', {
    cookie,
    body: { name: 'Csirkemell (nyers)', grams: 1 },
  });
  assert.equal(logged.status, 201);
  assert.equal(logged.json.entry.protein, 0.2, '1 g: a tárolt érték kerekített');

  const updated = await request('PUT', `/api/nutrition/log/${logged.json.entry.id}`, {
    cookie,
    body: { grams: 200 },
  });
  assert.equal(updated.status, 200);
  const [entry] = (await request('GET', '/api/nutrition/log', { cookie })).json;
  assert.equal(entry.protein, 46, '200 g × 0,23 — nem 0,2 × 200 = 40');
  assert.equal(entry.kcal, 220, '200 g × 1,1 — nem 1 × 200 = 200');
});

test('az erőfelmérés legfeljebb 12 ismétlést fogad el', async () => {
  const cookie = await register('felmero12');
  const entry = (reps) => ({ entries: [{ exercise: 'Fekvenyomás', weight: 60, reps }] });
  const ok = await request('POST', '/api/strength-assessment', { cookie, body: entry(12) });
  assert.equal(ok.status, 201);
  const tooMany = await request('POST', '/api/strength-assessment', { cookie, body: entry(13) });
  assert.equal(tooMany.status, 400);
});

test('edzés törlése után is megmaradnak a bemondott csúcsok', async () => {
  const cookie = await register('bemondo');
  await request('POST', '/api/strength-assessment', {
    cookie,
    body: { entries: [{ exercise: 'Guggolás', weight: 100, reps: 5 }] },
  });
  const saved = await request('POST', '/api/workouts', {
    cookie,
    body: {
      name: 'Mellnap',
      exercises: [
        {
          name: 'Fekvenyomás',
          sets: [{ reps: '5', weight: '80', rpe: '8', type: 'work', done: true }],
        },
      ],
    },
  });
  assert.equal(saved.status, 201);

  // A törlés újraépíti a csúcsokat a naplóból (recomputeExerciseMaxes)
  const deleted = await request('DELETE', `/api/workouts/${saved.json.id}`, { cookie });
  assert.equal(deleted.status, 204);

  const declared = (await request('GET', '/api/strength-assessment', { cookie })).json;
  assert.deepEqual(
    declared.map((row) => row.name),
    ['Guggolás'],
    'a felmérés nem a naplóból jön, a törlés nem viheti el',
  );
  // A bemondott gyakorlat ajánlása az összesített készenlétre épül — ahhoz check-in kell
  await request('PUT', '/api/checkin', { cookie, body: { sleepHours: 8, energy: 4, stress: 2 } });
  const readiness = (await request('GET', '/api/readiness', { cookie })).json;
  assert.ok(readiness.exercises.some((e) => e.name === 'Guggolás' && e.basis === 'declared'));
});

test('a súlycsökkentési javaslat kis súlyon sem visz nullára', async () => {
  const cookie = await register('kisulyos');
  // Kemény karedzés MA: a kar készenléte a „nagyon alacsony" sávba esik (−15%)
  const hardSet = { reps: '12', weight: '15', rpe: '10', type: 'work', done: true };
  await request('POST', '/api/workouts', {
    cookie,
    body: {
      name: 'Karnap',
      exercises: [{ name: 'Bicepsz hajlítás', sets: [hardSet, hardSet, hardSet, hardSet] }],
    },
  });
  await request('PUT', '/api/workout-draft', {
    cookie,
    body: {
      name: 'Esti kar',
      exercises: [
        {
          name: 'Bicepsz hajlítás',
          sets: [
            { reps: '12', weight: '2', rpe: '', type: 'work', done: false },
            { reps: '8', weight: '20', rpe: '', type: 'work', done: false },
          ],
        },
      ],
    },
  });

  const advice = (await request('GET', '/api/readiness/advice', { cookie })).json;
  assert.equal(advice.items.length, 1, JSON.stringify(advice));
  const [item] = advice.items;
  assert.equal(item.action, 'reduce');
  assert.equal(item.detail, 'a legnehezebb szett 20 kg → 17 kg', '15%, nem 25% (15 kg)');

  const applied = await request('POST', '/api/readiness/advice/apply', { cookie });
  const weights = applied.json.template.exercises[0].sets.map((set) => set.weight);
  assert.deepEqual(weights, ['2', '17'], 'a 2 kg-os szettnek nincs értelmes lépcsője — marad');
});

test('egy másik edzés törlése nem teszi újra „friss" értesítéssé a meglévő PR-t', async () => {
  const cookie = await register('prertesito');
  const save = (name, exercise, weight) =>
    request('POST', '/api/workouts', {
      cookie,
      body: {
        name,
        exercises: [
          {
            name: exercise,
            sets: [{ reps: '5', weight, rpe: '8', type: 'work', done: true }],
          },
        ],
      },
    });
  await save('Mellnap', 'Fekvenyomás', '80');
  const other = await save('Lábnap', 'Guggolás', '100');

  const prAt = async () =>
    (await request('GET', '/api/notifications', { cookie })).json.find(
      (item) => item.id === 'pr:Fekvenyomás',
    )?.at;
  const before = await prAt();
  assert.ok(before, 'van PR-értesítés');

  // Az SQLite datetime('now') másodperc-pontosságú: várunk, hogy egy újraírás látsszon
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal((await request('DELETE', `/api/workouts/${other.json.id}`, { cookie })).status, 204);
  assert.equal(await prAt(), before, 'az újraépítés megtartja a rekord születési idejét');
});
