/**
 * Podium — üres testsúly-naplónál üres grafikon (F9)
 * --------------------------------------------------------------------------
 * Az utolsó bejegyzés törlése után a grafikon a régi oszlopokat mutatta
 * újratöltésig, mert a kód úgy számolt, hogy üres naplónál még a kezdő
 * demo-görbe áll ott. Most üres naplónál az oszlopok eltűnnek, és csak az
 * üres-állapot szövege látszik — új fióknál is: demo-görbe nincs többé.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
let serverLog = [];
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => serverLog });
const { refreshWeightLog } = await import('../../../../public/js/recovery/weight.js');

const bars = () => elementFor('.chart-bars').children.length;
const emptyText = () => elementFor('[data-weight-empty]');

test('mérésekkel oszlopok, az utolsó törlése után üres grafikon és üres-állapot szöveg', async () => {
  serverLog = [
    { id: 1, kg: 84, date: '2026.11.10' },
    { id: 2, kg: 83.5, date: '2026.11.12' },
  ];
  await refreshWeightLog();
  assert.equal(bars(), 2);
  assert.equal(emptyText().hidden, true);

  serverLog = [];
  await refreshWeightLog();
  assert.equal(bars(), 0, 'a régi oszlopok eltűntek');
  assert.equal(emptyText().hidden, false);
});
