/** A számmezők közös olvasója: az üres mező „nincs megadva" (null), nem 0. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { readNumberInput } = await import('../../../../public/js/core/dom.js');

const field = (value) => ({ value });

test('readNumberInput: üres és csak szóközös mező → null', () => {
  assert.equal(readNumberInput(field('')), null);
  assert.equal(readNumberInput(field('   ')), null);
});

test('readNumberInput: a vessző tizedesjel', () => {
  assert.equal(readNumberInput(field('82,5')), 82.5);
  assert.equal(readNumberInput(field(' 7.5 ')), 7.5);
});

test('readNumberInput: a beírt 0 érvényes 0', () => {
  assert.equal(readNumberInput(field('0')), 0);
});

test('readNumberInput: nem szám → null', () => {
  assert.equal(readNumberInput(field('abc')), null);
  assert.equal(readNumberInput(field('Infinity')), null);
});
