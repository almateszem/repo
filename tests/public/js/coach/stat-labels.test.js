/**
 * Podium — az edzői panel stat-címkéi azt mondják, amit mérnek (M1)
 * --------------------------------------------------------------------------
 * A sportolói panelen „Aktív terv —" és „Terv-követés —" állt, miközben a
 * sportolónak aktív saját blokkos programja volt, és ugyanott „Terv szerinti
 * edzés 13/13" látszott. A három érték valójában:
 *   · terv-követés — csak az EDZŐ kiosztott tervéhez mér;
 *   · aktív terv — csak HETI terv (a blokkos programnak nincs heti ütemezése);
 *   · terv szerinti edzés — bármely tervből vagy programból indult edzés.
 * A címkék most ezt mondják ki, és a sáv-statok kulcsa is egyezik velük.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { ATHLETE_CARD_STATS, ATHLETE_DETAIL_STATS } =
  await import('../../../../public/js/coach/coach-shared.js');

const labels = ATHLETE_DETAIL_STATS.map(([label]) => label);

test('a címkék a mért tartalmat nevezik meg', () => {
  assert.ok(labels.includes('Edzői terv-követés'));
  assert.ok(labels.includes('Aktív heti terv'));
  assert.ok(labels.includes('Tervből indult edzés'));
  for (const old of ['Terv-követés', 'Aktív terv', 'Terv szerinti edzés']) {
    assert.ok(!labels.includes(old), `elavult címke: ${old}`);
  }
});

test('a kártya statjai a részletnézetben is ugyanazzal a címkével szerepelnek', () => {
  for (const [label] of ATHLETE_CARD_STATS) assert.ok(labels.includes(label), label);
});
