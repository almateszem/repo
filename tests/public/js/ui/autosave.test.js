/** A piszkozat lapelrejtéskori keepalive-mentése. DOM nincs, ezért a modul
    betöltése előtt egy minimális `window`/`document`/`fetch` helyettesítőt
    teszünk a globálisra: csak azt, amit az autosave és az importjai a
    betöltéskor és a visibilitychange-kezelőben használnak. */

import assert from 'node:assert/strict';
import test from 'node:test';

const listeners = {};
const fakeEl = () => ({ dataset: {}, textContent: '' });
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = {
  visibilityState: 'visible',
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  addEventListener: (type, fn) => {
    listeners[type] = fn;
  },
};
const requests = [];
globalThis.fetch = (url, init) => {
  requests.push({ url, init });
  return Promise.resolve(new Response('{}'));
};

const { createDraftAutosave } = await import('../../../../public/js/ui/workout/autosave.js');
const { clientDate } = await import('../../../../public/js/core/api.js');

test('a keepalive piszkozat-mentés is viszi az X-Client-Date fejlécet', () => {
  /* Enélkül a szerver a SAJÁT napjával mentené a piszkozatot (UTC-s szerver,
     magyar felhasználó éjfél után), és újratöltéskor a mai terv lépne a
     megkezdett edzés helyére. */
  const autosave = createDraftAutosave({
    buildBody: () => ({ name: 'Lábnap', exercises: [], planId: null, workoutId: null }),
  });
  autosave.schedule(); // függő mentés — a debounce még nem sült el
  globalThis.document.visibilityState = 'hidden';
  listeners.visibilitychange();
  autosave.cancel();

  const keepalive = requests.find((req) => req.init?.keepalive);
  assert.ok(keepalive, 'lapelrejtéskor kimegy a keepalive-kérés');
  assert.equal(keepalive.url, '/api/workout-draft');
  assert.equal(keepalive.init.headers['X-Client-Date'], clientDate());
  assert.equal(keepalive.init.headers['Content-Type'], 'application/json');
});
