/** Az autosave leállítása (az edzés lezárása) a FOLYAMATBAN lévő mentést is
    érvényteleníti: egy cancel előtt indult, utána elbukó PUT nem indíthat
    újrapróbát (az 3 s múlva üres piszkozatot írt a mai napra), és a cancel
    ígérete a futó mentés lezárultakor teljesül — a befejezés ezt várja meg a
    végleges mentés előtt, különben egy későn célba érő PUT a lezárt edzés
    piszkozatát írná vissza. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from '../fake-dom.js';

installFakeDom();

/** A piszkozat-mentések: mindegyik kívülről oldható fel vagy buktatható el. */
const puts = [];
globalThis.fetch = (url, init = {}) =>
  new Promise((resolve) => {
    if (url === '/api/workout-draft' && init.method === 'PUT') {
      puts.push({
        ok: () => resolve(Response.json({})),
        fail: () => resolve(Response.json({ error: 'hiba' }, { status: 500 })),
      });
      return;
    }
    resolve(Response.json({}));
  });

const { createDraftAutosave } = await import('../../../../public/js/workout/autosave.js');
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
let edits = 0;
const buildBody = () => ({ name: `Edzés ${edits}`, exercises: [], planId: null, workoutId: null });

test('cancel közben elbukó PUT → nincs újrapróba', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  puts.length = 0;
  edits += 1;
  const autosave = createDraftAutosave({ buildBody });
  autosave.schedule();
  t.mock.timers.tick(600); // a debounce elsül, a PUT elindul
  assert.equal(puts.length, 1);

  autosave.cancel(); // az edzés lezárul
  puts[0].fail();
  await flushMicrotasks();
  t.mock.timers.tick(60_000); // minden újrapróba-időzítő lejárna
  await flushMicrotasks();
  assert.equal(puts.length, 1, 'a lezárás után nem megy ki újabb mentés');
});

test('cancel közben futó PUT → a cancel ígérete a mentés lezárultakor teljesül', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  puts.length = 0;
  edits += 1;
  const autosave = createDraftAutosave({ buildBody });
  autosave.schedule();
  t.mock.timers.tick(600);
  assert.equal(puts.length, 1);

  let settled = false;
  const done = autosave.cancel();
  assert.ok(done instanceof Promise, 'a cancel ígéretet ad');
  done.then(() => {
    settled = true;
  });
  await flushMicrotasks();
  assert.equal(settled, false, 'amíg a PUT fut, a befejezés vár');
  puts[0].ok();
  await flushMicrotasks();
  assert.equal(settled, true);
});

test('futó mentés nélkül a cancel ígérete azonnal teljesül', async () => {
  const autosave = createDraftAutosave({ buildBody });
  await autosave.cancel();
});
