/** Jelszócsere és fióktörlés rossz jelszóval: a szerver 403-at ad, a hiba az
    űrlapon látszik, és a felhasználó bejelentkezve marad — korábban a 401
    munkamenet-vesztésnek számított (belépő kapu, újratöltés). A beküldő gomb
    a kérés alatt tiltott, hogy ne legyen dupla beküldés. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
globalThis.Option = class {
  constructor(text, value) {
    this.text = text;
    this.value = value;
  }
};

const submitButton = () => elementFor('button[type="submit"]');
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'PUT' || init.method === 'POST') {
    calls.push({ url, disabledDuringRequest: submitButton().disabled });
  }
  if (url === '/api/auth/password') {
    return Response.json({ error: 'A jelenlegi jelszó nem stimmel.' }, { status: 403 });
  }
  if (url === '/api/auth/delete-account') {
    return Response.json(
      { error: 'A jelszó nem stimmel — a fiók nem törlődött.' },
      { status: 403 },
    );
  }
  if (url === '/api/goals') return Response.json([]);
  return Response.json({ id: 1, name: 'Teszt', username: 'teszt' });
};

const { hooks } = await import('../../../../public/js/shared/page-hooks.js');
let sessionLost = 0;
hooks.onSessionLost = () => {
  sessionLost += 1;
};
const { setupSettingsModal } = await import('../../../../public/js/profile/settings.js');
await setupSettingsModal({ confirmAction: async () => true });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('jelszócsere rossz jelszóval: a hiba az űrlapon, nincs munkamenet-vesztés', async () => {
  calls.length = 0;
  elementFor('#st-password-current').value = 'rossz-jelszo';
  elementFor('#st-password-new').value = 'ujjelszo123';
  elementFor('[data-form="change-password"]').dispatch('submit');
  await settle();
  const error = elementFor('[data-password-error]');
  assert.equal(error.textContent, 'A jelenlegi jelszó nem stimmel.');
  assert.equal(error.hidden, false);
  assert.equal(sessionLost, 0, 'bejelentkezve marad');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].disabledDuringRequest, true, 'a gomb a kérés alatt tiltott');
  assert.equal(submitButton().disabled, false, 'a végén visszaáll');
});

test('fióktörlés rossz jelszóval: a hiba az űrlapon, nincs munkamenet-vesztés', async () => {
  calls.length = 0;
  elementFor('#st-delete-password').value = 'rossz-jelszo';
  elementFor('[data-form="delete-account"]').dispatch('submit');
  await settle();
  await settle();
  const error = elementFor('[data-delete-error]');
  assert.equal(error.textContent, 'A jelszó nem stimmel — a fiók nem törlődött.');
  assert.equal(sessionLost, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].disabledDuringRequest, true);
  assert.equal(submitButton().disabled, false);
});
