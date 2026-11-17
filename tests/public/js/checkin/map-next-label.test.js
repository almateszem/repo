/**
 * Podium — a check-in térkép-lépés gombja kimondja, ha nincs jelölés (F6)
 * --------------------------------------------------------------------------
 * A „Van, megjelölöm" után jelölés nélkül is tovább lehetett lépni, és az
 * összegző szó nélkül „Izomláz: Nincs"-et írt. Most a gomb felirata
 * jelölésig „Mégsincs izomlázam" (fájdalomnál „Mégsem fáj sehol"), az első
 * jelölés után „Tovább".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { mapNextLabel } = await import('../../../../public/js/checkin/steps.js');
const { CI_MAP_MODES } = await import('../../../../public/js/checkin/session.js');

test('jelölés nélkül a mód saját mondata, jelöléssel „Tovább"', () => {
  assert.equal(mapNextLabel(CI_MAP_MODES.soreness, {}), 'Mégsincs izomlázam');
  assert.equal(mapNextLabel(CI_MAP_MODES.painMap, {}), 'Mégsem fáj sehol');
  assert.equal(mapNextLabel(CI_MAP_MODES.soreness, { quads: 5 }), 'Tovább');
});
