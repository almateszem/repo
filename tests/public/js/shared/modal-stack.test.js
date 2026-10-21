/** Egymásra nyíló modálok: az Escape és a Tab-csapda csak a legfelsőre hat, a
    záró modál csak akkor ad vissza fókuszt, ha alatta nincs nyitott, és a
    close() ígérete a tényleges elrejtéskor teljesül — az átadás (saját étel →
    étel-modál, szkenner → saját étel) erre vár, nem egy képkockára. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from '../fake-dom.js';

installFakeDom();

/* Saját, egymástól különböző elemek kellenek (a fake-dom szelektoronként
   közös elemet ad): valódi classList, saját zár-gomb, fókusz-követés. */
const keyListeners = [];
globalThis.document.addEventListener = (type, listener) => {
  if (type === 'keydown') keyListeners.push(listener);
};
const pressKey = (key, extra = {}) => {
  const event = { key, shiftKey: false, defaultPrevented: false, ...extra };
  event.preventDefault = () => {
    event.defaultPrevented = true;
  };
  keyListeners.forEach((listener) => listener(event));
  return event;
};

const focusable = (name) => {
  const el = {
    name,
    disabled: false,
    focus() {
      globalThis.document.activeElement = el;
    },
    closest: () => null,
    addEventListener() {},
  };
  return el;
};
const makeModal = (name) => {
  const classes = new Set();
  const closeBtn = focusable(`${name}:close`);
  const field = focusable(`${name}:field`);
  return {
    name,
    closeBtn,
    field,
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
    },
    setAttribute() {},
    contains: (el) => el === closeBtn || el === field,
    querySelector: () => closeBtn,
    querySelectorAll: (selector) => (selector === '[data-close-modal]' ? [] : [closeBtn, field]),
  };
};

const { createModalController, isTopModal } =
  await import('../../../../public/js/shared/modals.js');

const trigger = focusable('trigger');

test('két nyitott modálnál az Escape csak a felsőt zárja', async () => {
  const lower = makeModal('beallitasok');
  const upper = makeModal('megerosites');
  const lowerCtl = createModalController(lower);
  const upperCtl = createModalController(upper);
  trigger.focus();
  lowerCtl.open();
  upperCtl.open();
  assert.equal(isTopModal(upper), true);

  pressKey('Escape');
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(upper.classList.contains('is-open'), false, 'a felső bezárult');
  assert.equal(lower.classList.contains('is-open'), true, 'az alsó nyitva maradt');
  assert.equal(isTopModal(lower), true);
  // A felsőt az alsóból nyitották (pl. a törlés gombja) — a fókusz oda tér vissza
  assert.equal(globalThis.document.activeElement, lower.closeBtn, 'a fókusz az alsó modálban');

  lowerCtl.close();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(globalThis.document.activeElement, trigger, 'a végén a kiváltóra kerül vissza');
});

test('a Tab-csapda csak a legfelső modálon hat', () => {
  const lower = makeModal('also');
  const upper = makeModal('felso');
  const lowerCtl = createModalController(lower);
  const upperCtl = createModalController(upper);
  lowerCtl.open();
  upperCtl.open();
  upper.field.focus(); // a felső utolsó eleme
  const event = pressKey('Tab');
  assert.equal(event.defaultPrevented, true);
  assert.equal(globalThis.document.activeElement, upper.closeBtn, 'a felső első elemére ugrik');
  upperCtl.close();
  lowerCtl.close();
});

test('átadás: a záró modál nem rántja vissza a fókuszt a nyitott új modál mögé', async () => {
  const food = makeModal('sajat-etel');
  const portion = makeModal('etel-modal');
  const foodCtl = createModalController(food);
  const portionCtl = createModalController(portion);
  trigger.focus();
  foodCtl.open();
  const closed = foodCtl.close();
  assert.ok(closed instanceof Promise, 'a close() ígéretet ad');
  assert.equal(foodCtl.close(), closed, 'a záródás alatt ugyanazt az ígéretet adja');
  portionCtl.open(); // még a kiúszó animáció alatt nyílik
  await closed;
  assert.equal(
    globalThis.document.activeElement,
    portion.closeBtn,
    'a fókusz az új modálban marad',
  );
  portionCtl.close();
});

test('a close() a már zárt modálon azonnal teljesül', async () => {
  const ctl = createModalController(makeModal('zart'));
  await ctl.close();
});
