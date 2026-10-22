/** A születési év mező tartománya a szerver szabályát követi (thisYear−100 …
    thisYear−13), megnyitáskor számolva — korábban a kliens-min 1900 volt. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
globalThis.Option = class {};
globalThis.fetch = async (url) =>
  url === '/api/goals'
    ? Response.json([])
    : Response.json({ id: 1, name: 'Teszt', username: 'teszt', birthYear: null });

const { setupSettingsModal } = await import('../../../../public/js/profile/settings.js');
const settings = await setupSettingsModal({ confirmAction: async () => true });

test('születési év: a mező min/max-a a szerver szabálya szerint', () => {
  settings.open();
  const year = new Date().getFullYear();
  const input = elementFor('#st-birth-year');
  assert.equal(input.min, String(year - 100));
  assert.equal(input.max, String(year - 13));
});
