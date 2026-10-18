/**
 * Podium — nincs fölöslegesen exportált név
 * ------------------------------------------------------------------------
 * Őr: ha egy exportált név a saját modulján kívül sehol nem szerepel, az vagy
 * halott kód, vagy csak belül használt — mindkét esetben az `export` hazudik
 * a modul felületéről. A keresés a scripts/check-exports.js-ben él (kézzel is
 * futtatható: node scripts/check-exports.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { unusedExports } from '../scripts/check-exports.js';

test('minden exportált név használt a saját modulján kívül is', () => {
  assert.deepEqual(unusedExports(), []);
});
