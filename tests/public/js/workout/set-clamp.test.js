/**
 * Podium — a szett-mezők visszaigazítása (public/js/workout/set-controls.js)
 * --------------------------------------------------------------------------
 * A léptetőgombok betartják a mező min/max-át, a billentyűzet viszont bármit
 * beenged. A mező elhagyásakor ezért mindhárom szám-mező a saját tartományába
 * kerül vissza: ismétlés 0–999 egészként, súly 0–999, RPE 1–10 fél fokozatra.
 * Enélkül a 99999 kg a szerver hibájáig jutott, és az automatikus mentés
 * minden billentyűre hibát dobott volna.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { clampSetInput } = await import('../../../../public/js/workout/set-controls.js');

/** Egy szett-mező: csak a saját szelektorára illik (a fake DOM closest-je
    mindig null-t adna). */
const field = (selector, value) => {
  const input = { value, closest: (s) => (s === selector ? input : null) };
  return input;
};

test('a súly 999-re és 0-ra szorul, a tizedese megmarad', () => {
  for (const [typed, expected] of [
    ['99999', '999'],
    ['-5', '0'],
    ['82.5', '82.5'],
    ['1.25', '1.25'],
  ]) {
    const input = field('.wk-set-weight', typed);
    clampSetInput(input);
    assert.equal(input.value, expected, `súly: ${typed}`);
  }
});

test('az ismétlés 0–999 közötti egész lesz', () => {
  for (const [typed, expected] of [
    ['1100', '999'],
    ['-5', '0'],
    ['2.5', '3'],
    ['8', '8'],
  ]) {
    const input = field('.wk-set-reps', typed);
    clampSetInput(input);
    assert.equal(input.value, expected, `ismétlés: ${typed}`);
  }
});

test('az RPE marad 1–10 fél fokozatokon', () => {
  const input = field('.wk-set-rpe', '11');
  clampSetInput(input);
  assert.equal(input.value, '10');
});

test('igazat ad, ha átírt, és az üres mezőt üresen hagyja', () => {
  const changed = field('.wk-set-weight', '5000');
  assert.equal(clampSetInput(changed), true);
  const same = field('.wk-set-weight', '100');
  assert.equal(clampSetInput(same), false);
  const empty = field('.wk-set-weight', '');
  assert.equal(clampSetInput(empty), false);
  assert.equal(empty.value, '');
});
