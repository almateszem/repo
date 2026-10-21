/** A súly-konvenciók EGY helyen élnek (shared/weight-conventions.js): a napló
    felirata (kézisúlyzó / ráakasztott súly) és az élő PR-jelző alapterhelése
    ugyanabból olvas, és a testsúly változása után frissül. Korábban két
    másolat töltődött két kéréssel, és csak az egyik frissült. */

import assert from 'node:assert/strict';
import test from 'node:test';

let requests = 0;
let response = {
  perHand: ['Kézisúlyzós fekvenyomás'],
  bodyweightFactors: { Húzódzkodás: 1, Fekvőtámasz: 0.65 },
  bodyweightKg: 80,
};
globalThis.fetch = async () => {
  requests += 1;
  if (response instanceof Error) throw response;
  return Response.json(response);
};

const conventions = await import('../../../../public/js/shared/weight-conventions.js');

test('betöltés után a getterek a szerver listáiból válaszolnak', async () => {
  await conventions.loadWeightConventions();
  assert.equal(requests, 1);
  assert.equal(conventions.isPerHand('Kézisúlyzós fekvenyomás'), true);
  assert.equal(conventions.isPerHand('Fekvenyomás'), false);
  assert.equal(conventions.isAddedWeight('Húzódzkodás'), true);
  assert.equal(conventions.baseLoadFor('Húzódzkodás'), 80);
  assert.equal(conventions.baseLoadFor('Fekvőtámasz'), 52);
  assert.equal(conventions.baseLoadFor('Fekvenyomás'), 0);
  assert.equal(conventions.baseLoadFor('constructor'), 0, 'örökölt kulcs nem gyakorlat');
});

test('a frissítés a testsúly változását is átveszi', async () => {
  response = { ...response, bodyweightKg: 90 };
  await conventions.refreshWeightConventions();
  assert.equal(conventions.baseLoadFor('Húzódzkodás'), 90);
});

test('hibás frissítésnél a korábbi állapot marad', async () => {
  response = new TypeError('Failed to fetch');
  const quiet = console.error;
  console.error = () => {};
  await conventions.refreshWeightConventions();
  console.error = quiet;
  assert.equal(conventions.baseLoadFor('Húzódzkodás'), 90);
  assert.equal(conventions.isPerHand('Kézisúlyzós fekvenyomás'), true);
});
