/**
 * Podium — a sportoló-kártya megmondja, volt-e ma check-in (M2)
 * -----------------------------------------------------------------------
 * Az alacsony megbízhatóságnak két oka lehet: kevés napló, vagy csak a mai
 * check-in hiányzik. A felület a kettőt másként mondja ki
 * (public/js/coach/coach-shared.js → lowDataReason), ehhez a kártya
 * `checkinToday` mezője kell.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom } from './test-harness.js';

const { request } = await startServer({ label: 'coach-checkin-today' });

async function register(username, displayName) {
  const res = await request('POST', '/api/auth/register', {
    body: { username, displayName, password: 'jelszo123' },
  });
  assert.equal(res.status, 201);
  return cookieFrom(res);
}

test('a sportoló-kártya checkinToday mezője a mai check-int követi', async () => {
  const edzo = await register('ciedzo', 'Edző');
  const sportolo = await register('cisportolo', 'Sportoló');
  const invite = await request('POST', '/api/athletes', {
    cookie: edzo,
    body: { username: 'cisportolo' },
  });
  await request('POST', `/api/coach/invites/${invite.json.linkId}/accept`, { cookie: sportolo });
  const card = async () =>
    (await request('GET', '/api/athletes', { cookie: edzo })).json.athletes[0];
  assert.equal((await card()).checkinToday, false);
  await request('PUT', '/api/checkin', { cookie: sportolo, body: { sleepHours: 7, energy: 3 } });
  assert.equal((await card()).checkinToday, true);
});
