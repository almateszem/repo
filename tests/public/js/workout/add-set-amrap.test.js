/**
 * Podium — a „+ Szett hozzáadása" nem örökli az AMRAP-jelzőt (P2)
 * --------------------------------------------------------------------------
 * Az új szett az utolsó sor másolata. Ha az utolsó sor az „5+" AMRAP-szett
 * volt, a hozzáadott levezető szett is AMRAP-pá vált, és a ciklus-szabály
 * (az utolsó kipipált AMRAP-szettet nézi) a levezető 5 ismétlésével
 * számolt a valódi 9 helyett. A típushoz hasonlóan az AMRAP sem öröklődik.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { renderSetRow } = await import('../../../../public/js/workout/sets-view.js');
const { nextSetValues } = await import('../../../../public/js/workout/set-controls.js');

test('az AMRAP-sor után hozzáadott szett nem AMRAP, az értékei viszont öröklődnek', () => {
  const last = renderSetRow(
    { reps: '9', weight: '100', rpe: '', type: 'work', done: true, amrap: 5 },
    3,
  );
  const card = globalThis.document.createElement('div'); // a gyakorlat-kártya (a név innen jönne)
  const setList = { lastElementChild: last, closest: () => card };
  const values = nextSetValues(setList, {});
  assert.ok(!('amrap' in values), 'az AMRAP-jelző nem öröklődik');
  assert.equal(values.reps, '9');
  assert.equal(values.weight, '100');
  assert.equal(values.done, false);
});
