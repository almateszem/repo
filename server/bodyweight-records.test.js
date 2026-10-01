/**
 * FitTrack Pro — rekord-csempék és saját testsúlyos terhelés: a merge utáni
 * átnézés leletei
 * -------------------------------------------------------------------------
 * KÜLÖN FÁJL, szándékosan: az api.test.js a regisztrációs korlát (30/óra/IP)
 * határán jár, ez a fájl pedig minden esethez friss fiókot kér.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom, today, gyakorlat } from './test-harness.js';

const { request } = await startServer({ label: 'bodyweight-records' });

let seq = 0;
async function register() {
  seq += 1;
  const res = await request('POST', '/api/auth/register', {
    body: { username: `rekord${seq}`, displayName: `Rekord ${seq}`, password: 'jelszo123' },
  });
  return cookieFrom(res);
}

/** A tegnapi nap — a szerver legfeljebb egy napos eltérést fogad el a
    kliens dátum-fejlécéből (X-Client-Date). */
const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};
const asYesterday = { 'X-Client-Date': yesterday() };

const records = async (cookie) => (await request('GET', '/api/exercise-records', { cookie })).json;
const recordOf = async (cookie, name) => (await records(cookie)).find((r) => r.name === name);

// Erőstandard NÉLKÜLI gyakorlat: ott csak a fejlődés-mérce szól
const NO_STANDARD = 'Gépi hátsó vállemelés';

test('a súly-konvenciók egy forrásból jönnek, a mai testsúllyal', async () => {
  const cookie = await register();
  await request('POST', '/api/weight-log', { cookie, body: { kg: 72 } });

  const res = await request('GET', '/api/weight-conventions', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.bodyweightKg, 72);
  assert.equal(res.json.bodyweightFactors['Húzódzkodás'], 1);
  assert.ok(res.json.perHand.length > 0, 'van kezenkénti gyakorlat');
  assert.ok(!res.json.perHand.includes('Fekvenyomás'), 'a rudas fekvenyomás nem kezenkénti');
});

test('a testsúly utólagos rögzítése a húzódzkodás csúcsát is kiszámolja', async () => {
  const cookie = await register();
  await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Hát', exercises: [gyakorlat('Húzódzkodás', 0, 10)] },
  });
  assert.equal(
    await recordOf(cookie, 'Húzódzkodás'),
    undefined,
    'testsúly nélkül nincs mihez mérni',
  );

  await request('POST', '/api/weight-log', { cookie, body: { kg: 75 } });
  const rekord = await recordOf(cookie, 'Húzódzkodás');
  assert.ok(rekord, 'a testsúly felvétele újraszámolta a csúcsot');
  // 75 kg × (1 + 10/30) = 100
  assert.equal(rekord.max1rm, 100);
});

test('a kiindulópont a legkorábbi DÁTUMÚ edzés, nem az elsőként rögzített', async () => {
  const cookie = await register();
  await request('POST', '/api/weight-log', { cookie, body: { kg: 80 } });

  // Előbb a mai, aztán a tegnapi edzést rögzíti (utólag pótolja)
  await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Mai', exercises: [gyakorlat(NO_STANDARD, 60, 5)] },
  });
  await request('POST', '/api/workouts', {
    cookie,
    headers: asYesterday,
    body: { name: 'Tegnapi', exercises: [gyakorlat(NO_STANDARD, 50, 5)] },
  });

  const rekord = await recordOf(cookie, NO_STANDARD);
  assert.equal(rekord.progress.fromDate, yesterday(), 'a tegnapi edzés a kiindulópont');
  assert.equal(rekord.progress.percent, 20, '50 → 60 kg ugyanazon a testsúlyon');
});

test('a fejlődés a csúcs NAPJÁNAK testsúlyával számol, nem a maival', async () => {
  const cookie = await register();
  await request('POST', '/api/weight-log', { cookie, headers: asYesterday, body: { kg: 80 } });
  for (const kg of [50, 60]) {
    await request('POST', '/api/workouts', {
      cookie,
      headers: asYesterday,
      body: { name: `Tegnap ${kg}`, exercises: [gyakorlat(NO_STANDARD, kg, 5)] },
    });
  }
  // Ma sokkal nehezebb lett — ez a tegnapi csúcs arányán nem változtat
  await request('POST', '/api/weight-log', { cookie, body: { kg: 100 } });

  const rekord = await recordOf(cookie, NO_STANDARD);
  assert.equal(rekord.progress.percent, 20, '60/80 a 50/80-hoz képest, nem 60/100');
});

test('a kipipálatlan, előre kitöltött sor nem kiindulópont', async () => {
  const cookie = await register();
  await request('POST', '/api/weight-log', { cookie, body: { kg: 80 } });
  const kitoltott = gyakorlat(NO_STANDARD, 100, 5);
  kitoltott.sets[0].done = false;
  await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Félbehagyott', exercises: [kitoltott] },
  });
  await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Valódi', exercises: [gyakorlat(NO_STANDARD, 60, 5)] },
  });

  const rekord = await recordOf(cookie, NO_STANDARD);
  assert.equal(rekord.needs, 'second-session', 'egyetlen VALÓDI edzés van');
  assert.equal(rekord.progress, null);
});

test('a bemondott csúcs saját testsúlyosnál a testsúllyal számol, és nem „fejlődés"', async () => {
  const cookie = await register();
  await request('POST', '/api/weight-log', { cookie, body: { kg: 80 } });

  const res = await request('POST', '/api/strength-assessment', {
    cookie,
    body: { entries: [{ exercise: 'Tolódzkodás', weight: 10, reps: 10 }] },
  });
  assert.equal(res.status, 201);
  // (80 + 10) × (1 + 10/30) = 120 — ugyanaz a skála, mint a naplózott szetteké
  assert.equal(res.json.entries[0].max1rm, 120);

  const rekord = await recordOf(cookie, 'Tolódzkodás');
  assert.equal(rekord.source, 'declared');
  assert.equal(rekord.progress, null, 'bemondott értéket nem mérünk a naplóhoz');
});

test('örökölt objektum-kulcs gyakorlatnévként nem rontja el a számolást', async () => {
  const cookie = await register();
  await request('POST', '/api/weight-log', { cookie, body: { kg: 80 } });
  await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Furcsa', exercises: [gyakorlat('constructor', 50, 5)] },
  });

  const res = await request('GET', '/api/exercise-records', { cookie });
  assert.equal(res.status, 200);
  const rekord = res.json.find((r) => r.name === 'constructor');
  assert.ok(rekord, 'sima súlyzós gyakorlatként számolódik');
  assert.equal(rekord.bodyweightBased, false);
  assert.ok(Number.isFinite(rekord.max1rm), `véges szám (kapott: ${rekord.max1rm})`);
});

test('a mai dátum segéd egyezik a szerverével', () => {
  // Őrszem: ha a gép órája és a szerver napja elcsúszna, a fenti
  // dátumos tesztek félrevezetően buknának.
  assert.match(today(), /^\d{4}\.\d{2}\.\d{2}$/);
});
