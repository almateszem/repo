/**
 * Podium — az edzői kártya készenléte = a sportoló saját készenléte
 * ------------------------------------------------------------------------
 * A kártya ablakozva olvassa a naplót (63 nap edzés, 35 nap testsúly), a
 * sportoló a teljes naplóból számol. A három eltérő bemenet — a legutolsó
 * testsúly, a „valaha edzett-e" és az első edzés napja — ezért kívülről, a
 * teljes naplóból érkezik a motorhoz; enélkül ugyanarra a napra más szám jött
 * ki (sportoló 68, edző 52, „készenlét 52%" riasztással).
 *
 * A régi (ablakon kívüli) sorokat közvetlenül az adatbázisba írjuk: a
 * végpontok csak a mai napra mentenek.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, cookieFrom, today } from './test-harness.js';

const LABEL = 'coach-readiness';
const { request, workDir } = await startServer({ label: LABEL });

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

async function register(username, displayName) {
  const res = await request('POST', '/api/auth/register', {
    body: { username, displayName, password: 'jelszo123' },
  });
  assert.equal(res.status, 201, `${username} regisztrációja`);
  return { cookie: cookieFrom(res), id: res.json.id };
}

const legDay = (weight) =>
  JSON.stringify([
    {
      name: 'Guggolás',
      pr: false,
      sets: Array.from({ length: 5 }, () => ({
        reps: '5',
        weight: String(weight),
        rpe: '9',
        type: 'work',
        done: true,
      })),
    },
    {
      name: 'Román felhúzás',
      pr: false,
      sets: Array.from({ length: 4 }, () => ({
        reps: '8',
        weight: String(weight * 0.7),
        rpe: '8',
        type: 'work',
        done: true,
      })),
    },
  ]);

test('a kártya készenléte ugyanaz, mint a sportolóé — ablakon kívüli előzmény mellett is', async () => {
  const coach = await register('kartya-edzo', 'Kártya Edző');
  const athlete = await register('kartya-sportolo', 'Kártya Sportoló');
  const invite = await request('POST', '/api/athletes', {
    cookie: coach.cookie,
    body: { username: 'kartya-sportolo' },
  });
  await request('POST', `/api/coach/invites/${invite.json.linkId}/accept`, {
    cookie: athlete.cookie,
  });

  /* Az előzmény: az első edzés 90 napja (a kártya 63 napos ablakán kívül), a
     testsúly 50 napja mérve (a 35 napos ablakon kívül, és nem a 80 kg-os
     alapérték). Az ablakban a legelső edzés friss — a kártya eddig ehhez
     mérte, hogy „érett-e" az előzmény az újdonság-szorzóhoz. */
  const raw = new DatabaseSync(path.join(workDir, `${LABEL}.db`));
  const addWorkout = raw.prepare(
    "INSERT INTO workouts (user_id, name, date, exercises, pr_rule) VALUES (?, 'Lábnap', ?, ?, 1)",
  );
  addWorkout.run(athlete.id, daysAgo(90), legDay(60));
  addWorkout.run(athlete.id, daysAgo(1), legDay(110));
  addWorkout.run(athlete.id, today(), legDay(110));
  raw
    .prepare('INSERT INTO weight_log (user_id, kg, date) VALUES (?, 58, ?)')
    .run(athlete.id, daysAgo(50));
  raw.close();

  await request('PUT', '/api/checkin', {
    cookie: athlete.cookie,
    body: { sleepHours: 7, sleepQuality: 3, energy: 3, stress: 3 },
  });

  const own = (await request('GET', '/api/readiness', { cookie: athlete.cookie })).json;
  const cards = (await request('GET', '/api/athletes', { cookie: coach.cookie })).json.athletes;
  const card = cards.find((entry) => entry.name === 'Kártya Sportoló');
  assert.equal(typeof own.overall, 'number');
  assert.equal(card.readiness, own.overall, 'ugyanarra a napra ugyanaz a szám');
});

test('csak ablakon kívüli edzés mellett is: a kártya tudja, hogy edzett már', async () => {
  const coach = await register('kartya-edzo2', 'Kártya Edző 2');
  const athlete = await register('kartya-regi', 'Kártya Régi');
  const invite = await request('POST', '/api/athletes', {
    cookie: coach.cookie,
    body: { username: 'kartya-regi' },
  });
  await request('POST', `/api/coach/invites/${invite.json.linkId}/accept`, {
    cookie: athlete.cookie,
  });

  const raw = new DatabaseSync(path.join(workDir, `${LABEL}.db`));
  raw
    .prepare(
      "INSERT INTO workouts (user_id, name, date, exercises, pr_rule) VALUES (?, 'Lábnap', ?, ?, 1)",
    )
    .run(athlete.id, daysAgo(90), legDay(80));
  raw.close();
  await request('PUT', '/api/checkin', {
    cookie: athlete.cookie,
    body: { sleepHours: 8, sleepQuality: 4, energy: 4, stress: 2 },
  });

  const own = (await request('GET', '/api/readiness', { cookie: athlete.cookie })).json;
  const cards = (await request('GET', '/api/athletes', { cookie: coach.cookie })).json.athletes;
  const card = cards.find((entry) => entry.name === 'Kártya Régi');
  assert.equal(card.readiness, own.overall);
});
