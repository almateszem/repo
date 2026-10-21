/** A check-in alvás-lépése: a kiürített mező „kihagyva", nem 0 óra alvás. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
const { renderSleep } = await import('../../../../public/js/checkin/steps-input.js');
const { ci } = await import('../../../../public/js/checkin/session.js');

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

test('alvás-lépés: a ± kattintást nem a lépés lépteti, csak a továbblépést állítja le', () => {
  // A léptetés a varázsló delegált kezelőjéé (wizard.js) — ha a lépés is
  // léptetne, egy kattintás kettőt lépne (7,5 → 8,5 a 0,5-ös lépésköz helyett).
  let cancelled = 0;
  renderSleep({ ...nav, cancelAdvance: () => cancelled++ });
  const stepInput = elementFor('.wk-num-input');
  Object.assign(stepInput, { value: '7.5', step: '0.5', min: '0', max: '24' });
  stepInput.dispatchEvent = () => true;
  const stepBtn = { dataset: { dir: '1' }, parentElement: elementFor('.wk-num') };
  const target = { closest: (selector) => (selector === '.wk-num-step' ? stepBtn : null) };

  elementFor('#tpl-ci-sleep').dispatch('click', { target });
  assert.equal(stepInput.value, '7.5', 'a lépés nem léptetett');
  assert.ok(cancelled > 0, 'az automatikus továbblépés leállt');
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
