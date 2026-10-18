/** Sikeres terv-törlés után elbukó lista-frissítés: nem íráshiba. A kártya
    helyben kikerül, a gomb nem áll vissza (különben újra lehetne kattintani),
    és a toast a lista frissítéséről szól, nem a törlésről. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();

// A toastok szövege: a showToast egy új elemre írja
const created = [];
const realCreate = globalThis.document.createElement;
globalThis.document.createElement = (tag) => {
  const el = realCreate(tag);
  created.push(el);
  return el;
};
const toastTexts = () => created.map((el) => el.textContent).filter(Boolean);

globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'DELETE') return new Response(null, { status: 204 });
  // A lista újratöltése elbukik
  return Response.json({ error: 'A szerver most nem érhető el.' }, { status: 503 });
};

const { setupPlans } = await import('../../../../public/js/ui/plans.js');
setupPlans(null, null, async () => true);

test('terv törlése: a frissítés hibája nem íráshiba, a kártya kikerül, a gomb tiltva marad', async () => {
  let removed = false;
  const card = { remove: () => (removed = true) };
  const deleteBtn = {
    dataset: { planId: '7' },
    disabled: false,
    closest: (selector) => (selector === '.pl-card' ? card : null),
  };
  elementFor('[data-list="plans"]').dispatch('click', {
    target: { closest: (selector) => (selector === '.pl-card-delete' ? deleteBtn : null) },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(removed, true, 'a kártya helyben kikerült');
  assert.equal(deleteBtn.disabled, true, 'a gomb nem áll vissza');
  const texts = toastTexts().join(' | ');
  assert.doesNotMatch(texts, /Nem sikerült törölni/, texts);
  assert.match(texts, /törölve/, texts);
  assert.match(texts, /A lista frissítése nem sikerült/, texts);
});
