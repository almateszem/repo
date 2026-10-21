/** A dupla beküldés elleni közös védelem: a gomb az első await ELŐTT tiltott,
    a még futó művelet második indítása nem fut le, a végén minden visszaáll,
    és az eredmény/hiba a hívóhoz jut. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { withBusy } = await import('../../../../public/js/shared/dom.js');

const button = () => ({ disabled: false });

test('withBusy: a gomb az első await előtt tiltott, a végén visszaáll', async () => {
  const btn = button();
  let seenDisabled = null;
  const run = withBusy(btn, async () => {
    seenDisabled = btn.disabled;
    await null;
    return 42;
  });
  assert.equal(btn.disabled, true, 'szinkron tiltás');
  assert.equal(seenDisabled, true);
  assert.equal(await run, 42, 'az eredmény továbbmegy');
  assert.equal(btn.disabled, false);
});

test('withBusy: a még futó művelet második indítása nem fut le', async () => {
  const btn = button();
  let runs = 0;
  let release;
  const slow = () =>
    withBusy(btn, async () => {
      runs += 1;
      await new Promise((resolve) => (release = resolve));
    });
  const first = slow();
  const second = slow();
  assert.equal(runs, 1);
  assert.equal(await second, undefined, 'a második azonnal, futás nélkül tér vissza');
  release();
  await first;
  const third = slow();
  release();
  await third;
  assert.equal(runs, 2, 'befejezés után újra indítható');
});

test('withBusy: a megadott kulcs szerint véd (több gomb, egy művelet)', async () => {
  const [a, b] = [button(), button()];
  let runs = 0;
  let release;
  const run = (btn) =>
    withBusy(
      btn,
      async () => {
        runs += 1;
        await new Promise((resolve) => (release = resolve));
      },
      'offer:7',
    );
  const first = run(a);
  await run(b);
  assert.equal(runs, 1, 'ugyanaz a kulcs — másik gombról sem indul');
  assert.equal(b.disabled, false, 'a meg nem indult hívás gombjához nem nyúl');
  release();
  await first;
});

test('withBusy: a hiba továbbmegy, és a finally visszaállít', async () => {
  const btns = [button(), button()];
  await assert.rejects(
    withBusy(btns, async () => {
      throw new Error('nem sikerült');
    }),
    /nem sikerült/,
  );
  assert.deepEqual(
    btns.map((b) => b.disabled),
    [false, false],
  );
  // a jelző is felszabadult
  assert.equal(await withBusy(btns, async () => 'újra'), 'újra');
});
