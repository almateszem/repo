/**
 * Podium — a napi cél kalóriája és fehérjéje nem mondhat ellent egymásnak (A2)
 * -----------------------------------------------------------------------
 * Korábban 500 kcal mellé 400 g fehérje is menthető volt — az önmagában
 * ~1600 kcal. A fehérje kalóriája (4 kcal/g) nem haladhatja meg a napi
 * kalóriacélt; ugyanez áll az edző által kitűzött célra is. A felület
 * gépelés közben is jelzi (public/js/shared/nutrition-goal.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom } from './test-harness.js';
import { goalConflict } from '../../public/js/shared/nutrition-goal.js';
import { goalConflict as serverGoalConflict } from '../../server/nutrition-goal.js';

const { request } = await startServer({ label: 'goal-consistency' });

async function register(username) {
  const res = await request('POST', '/api/auth/register', {
    body: { username, displayName: username, password: 'jelszo123' },
  });
  return cookieFrom(res);
}

test('a saját cél: ellentmondásos pár 400, beszédes üzenettel; az érvényes megy', async () => {
  const cookie = await register('celanna');
  const bad = await request('PUT', '/api/nutrition/goal', {
    cookie,
    body: { calories: 500, protein: 400 },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /fehérje/i);
  assert.match(bad.json.error, /1600/);

  const edge = await request('PUT', '/api/nutrition/goal', {
    cookie,
    body: { calories: 1200, protein: 300 },
  });
  assert.equal(edge.status, 200, 'pontosan a kalóriacél még belefér');

  const ok = await request('PUT', '/api/nutrition/goal', {
    cookie,
    body: { calories: 2600, protein: 180 },
  });
  assert.equal(ok.status, 200);
});

test('az edzői cél ugyanígy ellenőrzött', async () => {
  const edzo = await register('celedzo');
  const sportolo = await register('celsportolo');
  const invite = await request('POST', '/api/athletes', {
    cookie: edzo,
    body: { username: 'celsportolo' },
  });
  await request('POST', `/api/coach/invites/${invite.json.linkId}/accept`, { cookie: sportolo });
  const bad = await request('PUT', `/api/athletes/${invite.json.linkId}/nutrition-goal`, {
    cookie: edzo,
    body: { calories: 800, protein: 250 },
  });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /fehérje/i);
});

test('a kliens és a szerver ugyanazt a szabályt és szöveget használja', () => {
  assert.equal(goalConflict(2600, 180), null);
  assert.equal(goalConflict(1200, 300), null);
  assert.match(goalConflict(500, 400), /1600/);
  assert.equal(goalConflict(NaN, 100), null, 'hiányos bevitelre nincs ütközés-üzenet');
  for (const [c, p] of [
    [2600, 180],
    [1200, 300],
    [1199, 300],
    [500, 400],
    [800, 250],
    [NaN, 1],
  ]) {
    assert.equal(goalConflict(c, p), serverGoalConflict(c, p), `${c} kcal / ${p} g`);
  }
});
