/**
 * Podium — a megjelenített név a szerveren él (A5)
 * -----------------------------------------------------------------------
 * A Beállításokban átírt név korábban csak a böngésző helyi tárolójába
 * került: az edző, a sportolók, az üzenetek és egy másik eszköz továbbra is
 * a regisztrációkori nevet látta. Most a PUT /api/user menti, és mindenhol
 * ugyanaz a név látszik.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom } from './test-harness.js';

const { request } = await startServer({ label: 'display-name' });

async function register(username, displayName) {
  const res = await request('POST', '/api/auth/register', {
    body: { username, displayName, password: 'jelszo123' },
  });
  assert.equal(res.status, 201);
  return cookieFrom(res);
}

const anna = await register('nevanna', 'Anna');

test('a név a szerverre mentődik, és a fiók minden nézete azt mutatja', async () => {
  const res = await request('PUT', '/api/user', {
    cookie: anna,
    body: { displayName: '  Kis Anna  ' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.name, 'Kis Anna');
  assert.equal((await request('GET', '/api/user', { cookie: anna })).json.name, 'Kis Anna');
  assert.equal(
    (await request('GET', '/api/auth/me', { cookie: anna })).json.displayName,
    'Kis Anna',
  );
  assert.equal((await request('GET', '/api/profile', { cookie: anna })).json.name, 'Kis Anna');
});

test('az edző az új nevet látja a sportoló-kártyán', async () => {
  const edzo = await register('nevedzo', 'Edző');
  const sportolo = await register('nevsportolo', 'Régi Név');
  const invite = await request('POST', '/api/athletes', {
    cookie: edzo,
    body: { username: 'nevsportolo' },
  });
  await request('POST', `/api/coach/invites/${invite.json.linkId}/accept`, { cookie: sportolo });
  await request('PUT', '/api/user', { cookie: sportolo, body: { displayName: 'Új Név' } });
  const { athletes } = (await request('GET', '/api/athletes', { cookie: edzo })).json;
  assert.deepEqual(
    athletes.map((a) => a.name),
    ['Új Név'],
  );
});

test('üres és 40 karakternél hosszabb név 400, a régi marad', async () => {
  for (const displayName of ['   ', 'x'.repeat(41), 42]) {
    const res = await request('PUT', '/api/user', { cookie: anna, body: { displayName } });
    assert.equal(res.status, 400, JSON.stringify(displayName));
    assert.ok(res.json.error);
  }
  assert.equal((await request('GET', '/api/user', { cookie: anna })).json.name, 'Kis Anna');
});

test('a név nélküli kérés (csak cél) a nevet nem bántja', async () => {
  const res = await request('PUT', '/api/user', { cookie: anna, body: { goal: '' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.name, 'Kis Anna');
});
