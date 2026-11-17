/**
 * Podium — a programozó képlet-környezete (HTTP) — P8 + P10
 * -----------------------------------------------------------------------
 * P8: új programnál a szabály-szerkesztő minden gyakorlatra 2,5 kg lépésközt
 *     írt ki, a szerver viszont alsótestre 5 kg-ot ad. Az alapértéket most a
 *     szerver adja (ugyanabból a függvényből, amivel maga is számol).
 * P10: a képlet-előnézet a „testsúly" blokkra mindig „nincs testsúly"-t írt;
 *     a környezet most a legutóbbi testsúlyt is hozza.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom } from './test-harness.js';

const { request } = await startServer({ label: 'program-context' });

const res = await request('POST', '/api/auth/register', {
  body: { username: 'kontextus', displayName: 'Kontextus', password: 'jelszo123' },
});
const cookie = cookieFrom(res);

const context = (names) => {
  const qs = names.map((n) => `ex=${encodeURIComponent(n)}`).join('&');
  return request('GET', `/api/programs/context?${qs}`, { cookie });
};

test('P8: a lépésköz-alapérték a szervertől jön — alsótest 5 kg, felsőtest 2,5 kg', async () => {
  const r = await context(['Guggolás', 'Fekvenyomás', 'Román felhúzás']);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.defaultSteps, {
    Guggolás: 5,
    Fekvenyomás: 2.5,
    'Román felhúzás': 5,
  });
});

test('P10: a környezet a legutóbbi testsúlyt is hozza', async () => {
  assert.equal((await context([])).json.bodyweight, null, 'mérés nélkül nincs testsúly');
  await request('PUT', '/api/checkin', { cookie, body: { weightKg: 82.5 } });
  const r = await context([]);
  assert.equal(r.json.bodyweight, 82.5);
  assert.deepEqual(r.json.trainingMaxes, {});
  assert.deepEqual(r.json.oneRms, {});
});

test('a gyakorlatnév-lista korlátos: túl sok vagy túl hosszú név nem jut át', async () => {
  const many = Array.from({ length: 80 }, (_, i) => `Gyakorlat ${i}`);
  const r = await context(many);
  assert.equal(r.status, 200);
  assert.ok(Object.keys(r.json.defaultSteps).length <= 50);
  const long = await context(['x'.repeat(200)]);
  assert.deepEqual(long.json.defaultSteps, {});
});

test('belépés nélkül 401', async () => {
  const r = await request('GET', '/api/programs/context');
  assert.equal(r.status, 401);
});
