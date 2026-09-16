/**
 * FitTrack Pro — a KÉRÉS NAPJA (időzóna) tesztjei
 * -----------------------------------------------
 * A naplózás egy napra könyvel: edzés, check-in, étkezés, testsúly. Korábban
 * ezt a napot a SZERVER helyi ideje adta, ami néma adathibát okozott: egy
 * UTC-s szerveren a magyar felhasználónak este 10 után már a következő napra
 * ment minden — és ez visszamenőleg torzította a sorozatot, a heti volument
 * és a készenlétet is.
 *
 * Azóta a napot a kliens mondja meg (X-Client-Date). Ez a fájl azt őrzi, hogy
 * a szerver EL IS FOGADJA a valós időzónákból jövő napot, de NEM fogad el
 * bármit: a fejléc nem lehet visszadátumozásra használható csatorna.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './test-harness.js';

const { request: rawRequest } = await startServer({ label: 'tz' });

/** Kérés tetszőleges X-Client-Date fejléccel (a `date` elhagyható). */
const request = (method, urlPath, { body, cookie, date } = {}) =>
  rawRequest(method, urlPath, {
    body,
    cookie,
    headers: date !== undefined ? { 'X-Client-Date': date } : undefined,
  });

const pad = (n) => String(n).padStart(2, '0');
const format = (d) => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
const shift = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return format(d);
};
const SERVER_TODAY = format(new Date());

const gyakorlat = () => [
  {
    name: 'Guggolás',
    sets: [{ reps: '5', weight: '100', rpe: '8', type: 'work', done: true }],
  },
];

const reg = await request('POST', '/api/auth/register', {
  body: { username: 'utazo', displayName: 'Utazó Ubul', password: 'jelszo123' },
});
const cookie = (reg.setCookie[0] ?? '').split(';')[0];

/** Az utoljára mentett edzés dátuma. */
async function lastWorkoutDate() {
  const res = await request('GET', '/api/workouts', { cookie });
  return res.json[0].date;
}

test('fejléc nélkül a szerver saját napja marad az irányadó', async () => {
  const saved = await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Fejléc nélkül', exercises: gyakorlat() },
  });
  assert.equal(saved.status, 201);
  assert.equal(saved.json.date, SERVER_TODAY);
});

test('a kliens napját elfogadja — ez a lényeg: a naplózás a FELHASZNÁLÓ napjára megy', async () => {
  /* A szerver UTC-ben járhat, miközben a felhasználónál (UTC+2) már a
     következő nap van. Ilyenkor az edzésnek a felhasználó napjára kell
     kerülnie, nem a szerverére. */
  const holnap = shift(1);
  const saved = await request('POST', '/api/workouts', {
    cookie,
    date: holnap,
    body: { name: 'Késő esti edzés', exercises: gyakorlat() },
  });
  assert.equal(saved.json.date, holnap);
  assert.equal(await lastWorkoutDate(), holnap);

  // A másik irányban is (UTC-8: a szervernél már holnap van, a kliensnél még ma)
  const tegnap = shift(-1);
  const earlier = await request('POST', '/api/workouts', {
    cookie,
    date: tegnap,
    body: { name: 'Hajnali edzés', exercises: gyakorlat() },
  });
  assert.equal(earlier.json.date, tegnap);
});

test('a távoli dátumot NEM fogadja el — a fejléc nem visszadátumozásra való', async () => {
  const esetek = [
    [shift(5), 'öt nappal későbbi'],
    [shift(-30), 'egy hónappal korábbi'],
    ['2020.01.01', 'évekkel korábbi'],
  ];
  for (const [date, eset] of esetek) {
    const saved = await request('POST', '/api/workouts', {
      cookie,
      date,
      body: { name: `Hamis nap (${eset})`, exercises: gyakorlat() },
    });
    assert.equal(saved.json.date, SERVER_TODAY, `${eset}: a szerver napjára esik vissza`);
  }
});

test('az értelmezhetetlen fejléc nem borítja fel a mentést', async () => {
  const rosszak = ['2026-08-25', '2026.13.45', 'ma', '', '   ', '2026.8.5'];
  for (const date of rosszak) {
    const saved = await request('POST', '/api/workouts', {
      cookie,
      date,
      body: { name: 'Rossz fejléc', exercises: gyakorlat() },
    });
    assert.equal(saved.status, 201, `"${date}": a kérés nem hibázik el`);
    assert.equal(saved.json.date, SERVER_TODAY, `"${date}": a szerver napja marad`);
  }
});

test('a check-in és a napi táplálkozási napló ugyanazt a napot használja', async () => {
  const holnap = shift(1);

  const saved = await request('PUT', '/api/checkin', {
    cookie,
    date: holnap,
    body: { sleepHours: 7, sleepQuality: 4, energy: 4, stress: 2, mood: 4, hydration: 2.5 },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.checkin.date, holnap, 'a check-in a kliens napjára kerül');

  // Ugyanazzal a fejléccel visszaolvasva ott is van
  const same = await request('GET', '/api/checkin', { cookie, date: holnap });
  assert.equal(same.json?.date, holnap);

  // A szerver napján viszont NEM — az egy másik nap sora
  const serverDay = await request('GET', '/api/checkin', { cookie });
  assert.notEqual(serverDay.json?.date, holnap);

  // Étel is a kliens napjára naplózódik
  const foods = await request('GET', '/api/foods', { cookie });
  const food = foods.json[0];
  const logged = await request('POST', '/api/nutrition/log', {
    cookie,
    date: holnap,
    body: { name: food.name, grams: 100 },
  });
  assert.equal(logged.status, 201);
  assert.equal(logged.json.entry.date, holnap);

  const listedTomorrow = await request('GET', '/api/nutrition/log', { cookie, date: holnap });
  assert.ok(listedTomorrow.json.some((entry) => entry.id === logged.json.entry.id));
  const listedToday = await request('GET', '/api/nutrition/log', { cookie });
  assert.ok(
    !listedToday.json.some((entry) => entry.id === logged.json.entry.id),
    'a másik nap naplója nem keveredik bele',
  );
});

test('a sorozat is a kliens napjához igazodik', async () => {
  /* Az előző tesztek után van edzés tegnapra, mára és holnapra. A „holnapi"
     kliens szemszögéből ez háromnapos sorozat; a szerver napjáról nézve
     kétnapos (a holnapi edzés még nem számít bele). */
  const asTomorrow = await request('GET', '/api/dashboard', { cookie, date: shift(1) });
  const asToday = await request('GET', '/api/dashboard', { cookie });
  assert.equal(asTomorrow.json.streak, 3);
  assert.equal(asToday.json.streak, 2);
});
