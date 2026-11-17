/**
 * Podium — a jelszómező „Mutasd" gombja (F8)
 * --------------------------------------------------------------------------
 * A regisztráción egyetlen jelszómező van; a „Mutasd" teszi ellenőrizhetővé,
 * mit gépelt be a felhasználó. A gomb állapota a képernyőolvasónak is
 * kiderül (aria-pressed, beszédes címke), és beküldés után visszarejt.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { bindPasswordReveal } = await import('../../../../public/js/shared/password-reveal.js');

const setup = () => {
  const input = globalThis.document.createElement('input');
  input.type = 'password';
  const button = globalThis.document.createElement('button');
  const reveal = bindPasswordReveal(input, button);
  return { input, button, reveal };
};

test('kattintásra megmutatja, újabb kattintásra elrejti', () => {
  const { input, button } = setup();
  assert.equal(button.textContent, 'Mutasd');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  button.dispatch('click');
  assert.equal(input.type, 'text');
  assert.equal(button.textContent, 'Elrejt');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.getAttribute('aria-label'), 'Jelszó elrejtése');
  button.dispatch('click');
  assert.equal(input.type, 'password');
});

test('a hide visszarejti (beküldés után)', () => {
  const { input, button, reveal } = setup();
  button.dispatch('click');
  reveal.hide();
  assert.equal(input.type, 'password');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
});
