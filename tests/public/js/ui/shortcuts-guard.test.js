/** A gyorsbillentyű-őr a saját lenyílón is véd: a custom-select typeahead-je
    elfogyasztja a billentyűt (preventDefault), az őr ezt és a combobox /
    listbox / aria-haspopup vezérlőket is tiszteli. Korábban a terv-lenyílóban
    az „5" a Tervek oldalra váltott. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from '../fake-dom.js';

installFakeDom();
globalThis.MutationObserver = class {
  observe() {}
};
globalThis.Element = class {};
// A custom-select a natív select value/selectedIndex leíróit csomagolja be
globalThis.HTMLSelectElement = class {
  get value() {
    return this.storedValue;
  }
  set value(next) {
    this.storedValue = next;
  }
  get selectedIndex() {
    return this.storedIndex ?? 0;
  }
  set selectedIndex(next) {
    this.storedIndex = next;
  }
};
globalThis.location = { hash: '#dashboard' };

const keyListeners = [];
const realQuery = globalThis.document.querySelector;
globalThis.document.addEventListener = (type, listener) => {
  if (type === 'keydown') keyListeners.push(listener);
};
// Nincs nyitott modál (a fake-dom minden szelektorra talál elemet)
globalThis.document.querySelector = (selector) =>
  selector.includes('aria-modal') ? null : realQuery(selector);

const created = [];
const realCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) => {
  const el = realCreate(tag);
  created.push({ tag, el });
  return el;
};

const { setupShortcuts } = await import('../../../../public/js/ui/shortcuts.js');
const { enhanceSelect } = await import('../../../../public/js/ui/custom-select.js');
setupShortcuts();

/** Egy billentyű-esemény a document-figyelőkön, adott célelemmel. */
const press = (key, target, extra = {}) => {
  const event = { key, target, defaultPrevented: false, ...extra };
  event.preventDefault = () => {
    event.defaultPrevented = true;
  };
  keyListeners.forEach((listener) => listener(event));
  return event;
};
/** Egy célelem, amely a megadott szelektorokra illeszkedik `closest`-tel. */
const target = (matching = []) =>
  Object.assign(new globalThis.Element(), {
    matches: () => false,
    closest: (selector) => (matching.some((m) => selector.includes(m)) ? {} : null),
  });

test('kontroll: sima gombon az „5" oldalt vált', () => {
  globalThis.location.hash = '#dashboard';
  press('5', target());
  assert.equal(globalThis.location.hash, 'plans');
});

test('a lenyíló (combobox / listbox / aria-haspopup) célelemén az „5" nem vált oldalt', () => {
  for (const role of ['[role="combobox"]', '[role="listbox"]', '[aria-haspopup]']) {
    globalThis.location.hash = '#dashboard';
    press('5', target([role]));
    assert.equal(globalThis.location.hash, '#dashboard', role);
  }
});

test('az elfogyasztott (defaultPrevented) billentyű nem vált oldalt', () => {
  globalThis.location.hash = '#dashboard';
  press('5', target(), { defaultPrevented: true });
  assert.equal(globalThis.location.hash, '#dashboard');
});

test('a custom-select typeahead-je elfogyasztja a billentyűt (zárt listánál)', () => {
  created.length = 0;
  const select = realCreate('select');
  select.options = [{ textContent: '5x5 erő', value: 'a' }];
  select.selectedIndex = 0;
  enhanceSelect(select);
  const trigger = created.find((entry) => entry.tag === 'button').el;
  const event = { key: '5', ctrlKey: false, metaKey: false, defaultPrevented: false };
  event.preventDefault = () => {
    event.defaultPrevented = true;
  };
  trigger.dispatch('keydown', event);
  assert.equal(event.defaultPrevented, true);
});
