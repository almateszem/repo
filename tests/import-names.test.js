/**
 * Podium — minden importált név létezik a célmodulban
 * ------------------------------------------------------------------------
 * Őr: egy átnevezés vagy áthelyezés után ottmaradt import a böngészőben az
 * egész modulgráfot leállítja (a felület el sem indul), a szerveroldali és a
 * kliens-tesztek viszont ezt nem mindig veszik észre. A keresés a
 * scripts/check-imports.js-ben él.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { missingImports } from '../scripts/check-imports.js';

test('minden statikus import neve szerepel a célmodul exportjai között', () => {
  assert.deepEqual(missingImports(), []);
});
