/** A check-in alvás-lépése: a kiürített mező „kihagyva", nem 0 óra alvás. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
const { renderSleep } = await import('../../../../public/js/ui/checkin/steps/sleep.js');
const { ci } = await import('../../../../public/js/ui/checkin/session.js');

const nav = { cancelAdvance() {}, goNext() {}, advanceSoon() {} };

test('alvás-lépés: a kiürített mező → sleepHours null, nem 0', () => {
  renderSleep(nav);
  const input = elementFor('#ci-sleep');
  input.value = '';
  input.dispatch('input');
  assert.equal(ci.answers.sleepHours, null);

  elementFor('[data-action="checkin-next"]').dispatch('click');
  assert.equal(ci.answers.sleepHours, null, 'továbblépéskor is');
});

test('alvás-lépés: a beírt érték megmarad, a tartományon kívüli levágva', () => {
  renderSleep(nav);
  const input = elementFor('#ci-sleep');
  input.value = '6,5';
  input.dispatch('input');
  assert.equal(ci.answers.sleepHours, 6.5);

  input.value = '99';
  input.dispatch('input');
  assert.ok(ci.answers.sleepHours < 99, 'a maximumra vágva');
});
