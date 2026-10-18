/** Induláskori kapcsolat-hiba: az app nem áll csendben üres vázként, hanem
    hibát mutat és újrapróbálja — 2, 5, 10 mp várakozással, utána csak a
    kézi „Újra" gombra. Siker után a megszokott út fut. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startWithRetry } from '../../../../public/js/app/startup.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Egy próbálkozás-sorozat: a hívások sorban buknak vagy sikerülnek. */
const scripted = (outcomes) => {
  let calls = 0;
  const attempt = async () => {
    const outcome = outcomes[calls++];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { attempt, calls: () => calls };
};

test('két hiba után siker: hiba-állapot, 2 és 5 mp várakozás, majd a megszokott út', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const down = new Error('Nincs kapcsolat a szerverrel — próbáld újra.');
  const { attempt, calls } = scripted([down, down, { user: null }]);
  const errors = [];
  const successes = [];
  startWithRetry(attempt, {
    onError: (err, info) => errors.push([err.message, info.retrying]),
    onSuccess: (result) => successes.push(result),
  });
  await flush();
  assert.deepEqual(errors, [[down.message, true]], 'azonnal látszik a hiba');

  t.mock.timers.tick(1999);
  await flush();
  assert.equal(calls(), 1, '2 mp előtt nem próbál újra');
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls(), 2);
  t.mock.timers.tick(5000);
  await flush();
  assert.equal(calls(), 3);
  assert.deepEqual(successes, [{ user: null }]);
});

test('a harmadik várakozás (10 mp) után már csak a gomb indít', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const down = new Error('le');
  const { attempt, calls } = scripted([down, down, down, down, { user: { id: 1 } }]);
  const errors = [];
  const boot = startWithRetry(attempt, {
    onError: (err, info) => errors.push(info.retrying),
    onSuccess: () => {},
  });
  await flush();
  for (const wait of [2000, 5000, 10000]) {
    t.mock.timers.tick(wait);
    await flush();
  }
  assert.equal(calls(), 4);
  assert.deepEqual(
    errors,
    [true, true, true, false],
    'a negyedik hiba után nincs több önálló próba',
  );
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(calls(), 4);

  boot.retry(); // az „Újra" gomb
  await flush();
  assert.equal(calls(), 5);
});

test('a kézi újrapróba a várakozást kiváltja, nem fut kétszer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { attempt, calls } = scripted([new Error('le'), { user: null }, { user: null }]);
  const successes = [];
  const boot = startWithRetry(attempt, { onError: () => {}, onSuccess: (r) => successes.push(r) });
  await flush();
  boot.retry();
  await flush();
  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(calls(), 2, 'az időzített próba elmaradt');
  assert.equal(successes.length, 1);
});
