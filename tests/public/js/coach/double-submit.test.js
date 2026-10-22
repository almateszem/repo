/** Dupla Enter / dupla kattintás: a chat egy üzenetet küld, az edzői étkezés
    egyet ment. Korábban mindkettő kétszer futott (két azonos üzenet,
    duplikált étkezés). */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
globalThis.Option = class {};
// A chat halk frissítő intervalluma ne tartsa életben a teszt-folyamatot
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => realSetInterval(fn, ms).unref();
const posts = [];
globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'POST') {
    posts.push(url);
    await new Promise((resolve) => setTimeout(resolve, 5)); // a válasz késik
    if (url.endsWith('/meals')) return Response.json([]); // az étkezés-lista
    return Response.json({ id: posts.length, text: 'x', mine: true, at: new Date().toISOString() });
  }
  return Response.json([]);
};

const { createChatController } = await import('../../../../public/js/coach/chat.js');
const { setupCoachMeals } = await import('../../../../public/js/coach/meals.js');

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test('chat: dupla Enter → egy üzenet', async () => {
  posts.length = 0;
  const form = elementFor('[data-form="coach-message"]');
  const input = elementFor('#coach-message');
  createChatController({
    feed: elementFor('[data-feed]'),
    form,
    input,
    getLinkId: () => 5,
    isVisible: () => false,
  });
  input.value = 'Szia!';
  form.dispatch('submit');
  form.dispatch('submit');
  await settle();
  assert.deepEqual(posts, ['/api/messages/5']);
});

test('edzői étkezés: dupla Enter → egy mentés', async () => {
  posts.length = 0;
  setupCoachMeals(elementFor('[data-root]'), {
    getCurrent: () => ({ linkId: 3, meals: [] }),
    onGoalChange() {},
    confirmAction: async () => true,
  });
  elementFor('#co-meal-name').value = 'Reggeli';
  const form = elementFor('[data-form="athlete-meal"]');
  form.dispatch('submit');
  form.dispatch('submit');
  await settle();
  assert.deepEqual(posts, ['/api/athletes/3/meals']);
});
