/** Az Edző oldal egy frissítése (render + shown) a látható üzenetszálat EGYSZER
    kéri le, és legfeljebb egyszer jelöli olvasottnak — korábban a render és a
    shown is betöltötte. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
globalThis.Option = class {};
// A chat halk frissítő intervalluma ne tartsa életben a teszt-folyamatot
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => realSetInterval(fn, ms).unref();

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push(`${init.method ?? 'GET'} ${url}`);
  if (url.endsWith('/read')) return Response.json({ read: 1 });
  if (url.startsWith('/api/messages/')) {
    // Olvasatlan üzenet: minden lekérés nyugtázást is indít
    return Response.json({
      messages: [{ id: 1, text: 'Szia', mine: false, author: 'Edző', at: '2026-10-18T06:38:08Z' }],
      unread: 1,
    });
  }
  return Response.json([]);
};

/** Egy valódi GET /api/coach válasz alakja (a teszt-szerverről). */
const COACH_DATA = {
  coach: {
    linkId: 1,
    since: '2026-10-18T06:37:20Z',
    username: 'edzo',
    name: 'Edző',
    goal: null,
    unread: 1,
  },
  me: {
    linkId: 1,
    username: 'sportolo',
    name: 'Sportoló',
    goal: null,
    readiness: null,
    confidence: 'low',
    adherence: null,
    adherenceTrend: null,
    planWorkouts: null,
    hasAssignedPlan: false,
    adherenceDetail: null,
    rating: null,
    streak: 0,
    lastWorkout: null,
    weekly: '0/0',
    plan: null,
    alert: null,
    recent: [],
    lastMessage: null,
    unread: 1,
    nutritionGoal: {
      calories: 2900,
      protein: 170,
      source: 'default',
      setBy: null,
      setAt: null,
      locked: false,
      waterMl: null,
    },
    meals: [],
    lastFeedback: null,
    exerciseNotes: [],
  },
  planHistory: [],
  invites: [],
  planOffers: [],
};

const { setupClientView } = await import('../../../../public/js/coach/client.js');
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('egy frissítés → egy üzenet-lekérés és legfeljebb egy olvasottnak jelölés', async () => {
  const client = setupClientView({
    page: elementFor('[data-page="coach"]'),
    view: elementFor('[data-view="client"]'),
    onChange() {},
  });
  client.render(COACH_DATA);
  // Az Üzenetek fülre váltás (ez maga is betölti a szálat)
  elementFor('[data-client-tabs]').dispatch('click', {
    target: { closest: () => ({ dataset: { clientTab: 'messages' } }) },
  });
  await settle();

  calls.length = 0;
  // A coach.js refresh()-e: render, majd a nézet helyre kerülése után shown()
  client.render(COACH_DATA);
  client.shown();
  await settle();

  const loads = calls.filter((call) => call === 'GET /api/messages/1');
  const reads = calls.filter((call) => call === 'POST /api/messages/1/read');
  assert.equal(loads.length, 1, `egy lekérés (${calls.join(', ')})`);
  assert.ok(reads.length <= 1, `legfeljebb egy nyugtázás (${calls.join(', ')})`);
});
