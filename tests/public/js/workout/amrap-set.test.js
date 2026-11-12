/**
 * Podium — az AMRAP-szett a naplósorban (public/js/workout/sets-view.js)
 * --------------------------------------------------------------------------
 * A blokkos program AMRAP-szettje `amrap` mezőt hoz (az előírt minimum). A
 * sor ezt megőrzi és visszaadja mentéskor — enélkül a ciklus végi szabály
 * nem tudná, melyik szett volt az AMRAP. A sima szett nem kap ilyen mezőt.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { readSetRow, renderSetRow } = await import('../../../../public/js/workout/sets-view.js');

test('readSetRow visszaadja az amrap-ot, renderSetRow beírja', () => {
  const row = renderSetRow(
    { reps: '7', weight: '85', rpe: '', type: 'work', done: true, amrap: 5 },
    1,
  );
  assert.equal(row.dataset.amrap, '5');
  assert.equal(readSetRow(row).amrap, 5);
});

test('sima szettnél nincs amrap mező', () => {
  const row = renderSetRow({ reps: '5', weight: '60', rpe: '', type: 'work', done: false }, 1);
  assert.equal(row.dataset.amrap, undefined);
  assert.ok(!('amrap' in readSetRow(row)));
});
