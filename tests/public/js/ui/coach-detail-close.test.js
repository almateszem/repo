/** Edzői cél- vagy víz-mentés közben bezárt sportoló-részletnézet: a mentés
    sikerült, ezért nem jöhet hiba-toast — korábban a `current.nutritionGoal =
    await …` a bezáráskor null-lá vált current-en szállt el. A válasz a
    mentéskor nyitott sportoló objektumára kerül. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
globalThis.Option = class {};
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => realSetInterval(fn, ms).unref();

const GOAL = { calories: 2500, protein: 150, source: 'coach', waterMl: 3000 };
let release = null;
globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'PUT' || init.method === 'POST' || init.method === 'DELETE') {
    await new Promise((resolve) => (release = resolve)); // a válasz késik
    return Response.json(GOAL);
  }
  if (url.startsWith('/api/messages/')) return Response.json({ messages: [], unread: 0 });
  return Response.json([]);
};

const errors = [];
console.error = (...args) => errors.push(args);

/** Egy sportoló-kártya (a /api/athletes elemeinek alakja). */
const athlete = () => ({
  linkId: 4,
  username: 'sportolo',
  name: 'Sportoló',
  goal: null,
  readiness: 70,
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
  unread: 0,
  nutritionGoal: { calories: 2900, protein: 170, source: 'default', waterMl: null },
  meals: [],
  lastFeedback: null,
  exerciseNotes: [],
});

const { setupAthleteDetail } = await import('../../../../public/js/ui/coach.js');
const detail = setupAthleteDetail({ confirmAction: async () => true });
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

for (const [label, form] of [
  ['napi cél', '[data-form="athlete-nutrition-goal"]'],
  ['víz-cél', '[data-form="athlete-water-goal"]'],
]) {
  test(`${label}: a mentés közben bezárt nézet nem ad hibát, a válasz a sportolóra kerül`, async () => {
    errors.length = 0;
    const opened = athlete();
    detail.open(opened);
    elementFor('#co-goal-calories').value = '2500';
    elementFor('#co-goal-protein').value = '150';
    elementFor('#co-water-liters').value = '3';
    elementFor(form).dispatch('submit');
    await settle();

    detail.close(); // a válasz előtt bezárja
    release();
    await settle();

    assert.deepEqual(errors, [], 'nincs hiba-ág (hamis „nem sikerült" toast)');
    assert.deepEqual(opened.nutritionGoal, GOAL, 'a mentéskor nyitott sportolóra kerül');
  });
}
