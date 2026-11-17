/**
 * Podium — a sportoló-meghívás próbálgatásának korlátja (A3)
 * -----------------------------------------------------------------------
 * A meghívás szándékosan megmondja, ha nincs ilyen felhasználó (404) — így
 * az elgépelés azonnal kiderül. Ezzel viszont végig lehetett próbálgatni,
 * milyen nevek léteznek. A sikertelen próbák fiókonként óránként 10-ig
 * mehetnek; utána egy óráig MINDEN meghívás 429 — különben a 201/429
 * különbsége ugyanúgy elárulná a létező neveket. A sikeres meghívás nem
 * fogy a keretből: a valódi edzőnek ez sosem kerül az útjába.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom } from './test-harness.js';

const { request } = await startServer({ label: 'invite-limit' });

async function register(username) {
  const res = await request('POST', '/api/auth/register', {
    body: { username, displayName: username, password: 'jelszo123' },
  });
  return cookieFrom(res);
}
const invite = (cookie, username) =>
  request('POST', '/api/athletes', { cookie, body: { username } });

test('a sikeres meghívások nem fogyasztják a keretet', async () => {
  const edzo = await register('limitedzo');
  for (let i = 0; i < 12; i += 1) {
    await register(`limitsportolo${i}`);
    assert.equal((await invite(edzo, `limitsportolo${i}`)).status, 201);
  }
});

test('10 sikertelen próba után minden meghívás 429, a létező névre is', async () => {
  const kandi = await register('kandi');
  await register('letezo');
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await invite(kandi, `nincsilyen${i}`)).status, 404, `${i + 1}. próba`);
  }
  const tovabbi = await invite(kandi, 'nincsilyen99');
  assert.equal(tovabbi.status, 429);
  assert.ok(tovabbi.json.error);
  const letezo = await invite(kandi, 'letezo');
  assert.equal(letezo.status, 429, 'a létező név sem különböztethető meg');
});

test('a korlát fiókonként külön számol', async () => {
  const masik = await register('masikedzo');
  assert.equal((await invite(masik, 'nincsilyen0')).status, 404);
});
