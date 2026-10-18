/** Az Áttekintő kirajzolása nem nyúlhat az edzésnapló címéhez. DOM nincs,
    ezért a modul betöltése előtt egy tűrő `document`-helyettesítőt teszünk a
    globálisra: minden szelektorra ugyanazt az elemet adja vissza, amelynek az
    ismeretlen metódusai üres függvények — a teszt csak a #workout-name
    mezőt figyeli. */

import assert from 'node:assert/strict';
import test from 'node:test';

const fakeElement = () =>
  new Proxy(
    { dataset: {}, style: { setProperty() {} }, value: '', textContent: '', hidden: false },
    { get: (target, prop) => (prop in target ? target[prop] : () => fakeElement()) },
  );
const elements = new Map();
const elementFor = (selector) => {
  if (!elements.has(selector)) elements.set(selector, fakeElement());
  return elements.get(selector);
};

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = {
  querySelector: elementFor,
  querySelectorAll: () => [],
  createElement: () => fakeElement(),
  createTextNode: (text) => text,
};
globalThis.fetch = () =>
  Promise.resolve(
    Response.json({
      readiness: 70,
      streak: 2,
      recovery: { sleep: '7 óra', fatigue: '-', soreness: '-' },
      dailyStats: {},
      workoutName: 'Push A',
      workoutPlan: { exercises: [] },
      restDay: false,
      checkinPresent: true,
    }),
  );

const { renderDashboard } = await import('../../../../public/js/ui/dashboard-data.js');

test('a renderDashboard nem írja át az edzésnapló címét', async () => {
  /* Edzés befejezése után a clearEditor kiüríti a naplót, majd a dashboard-
     frissítés a mai terv nevét írta az üres címbe — planId nélkül, így egy
     szabad edzés a terv nevével mentődött. A check-in mentése is ezt hívja. */
  const title = elementFor('#workout-name');
  title.value = 'Saját szabad edzés';
  await renderDashboard();
  assert.equal(title.value, 'Saját szabad edzés');

  title.value = ''; // a befejezés utáni üres napló
  await renderDashboard();
  assert.equal(title.value, '');

  // Az Áttekintő CTA-ja továbbra is a terv nevét mutatja
  assert.equal(elementFor('[data-workout-name]').textContent, 'Push A');
});
