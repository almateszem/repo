/** A saját napi cél visszaállítható: a gomb csak saját célnál látszik, a
    DELETE /api/nutrition/goal-t hívja, és a válaszban érkező (alapértelmezett)
    célt rajzolja ki — utána a gomb eltűnik. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
// Az étel-lista lapozója figyeli a lista alját — itt nincs mit figyelnie.
globalThis.IntersectionObserver = class {
  observe() {}
  disconnect() {}
};

const OWN = { calories: 2500, protein: 150, source: 'own', locked: false };
const DEFAULT = { calories: 2200, protein: 120, source: 'default', locked: false };
let goal = OWN;
const calls = [];

globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  calls.push(`${method} ${url}`);
  if (url === '/api/nutrition/goal' && method === 'DELETE') {
    goal = DEFAULT;
    return Response.json(DEFAULT);
  }
  if (url === '/api/nutrition') {
    return Response.json({ intake: 0, protein: 0, carbs: 0, fat: 0, goal });
  }
  return Response.json([]);
};

// Rejtve indul (mint a markupban): a kirajzolásnak kell megmutatnia.
const revertBtn = elementFor('[data-action="revert-goal"]');
revertBtn.hidden = true;

const { setupNutrition } = await import('../../../../public/js/nutrition/nutrition.js');
await setupNutrition({ open() {} });

test('saját célnál látszik a visszaállítás', () => {
  assert.equal(revertBtn.hidden, false);
});

test('a visszaállítás törli a saját célt, és az alapértelmezettet mutatja', async () => {
  calls.length = 0;
  revertBtn.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(calls.includes('DELETE /api/nutrition/goal'), calls.join(', '));
  assert.match(elementFor('[data-nu-goal-value]').textContent, /2\s?200 kcal/);
  assert.equal(revertBtn.hidden, true, 'alapértelmezett célnál nincs mit visszaállítani');
});
