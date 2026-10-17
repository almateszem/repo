/** Az Áttekintő megnyitáskor friss adatot kér — de nem duplán: az induláskori
    render után (2 mp-en belül) nem kér újra, egy épp futó renderhez pedig
    csatlakozik. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from '../fake-dom.js';

installFakeDom();
let requests = 0;
let release = null; // ha be van állítva, a válasz erre vár
let readiness = 70;
globalThis.fetch = async () => {
  requests += 1;
  if (release) await new Promise((resolve) => (release = resolve));
  return Response.json({
    readiness,
    streak: 1,
    recovery: { sleep: '-', fatigue: '-', soreness: '-' },
    dailyStats: {},
    workoutName: null,
    workoutPlan: { exercises: [] },
    restDay: false,
    checkinPresent: true,
  });
};

const dashboard = await import('../../../../public/js/render/dashboard.js');
const { renderDashboard, refreshDashboardIfStale } = dashboard;

let now = 1_000_000;
Date.now = () => now;

test('frissen renderelt Áttekintőnél (2 mp-en belül) nincs második kérés', async () => {
  await renderDashboard();
  requests = 0;
  now += 1500;
  await refreshDashboardIfStale();
  assert.equal(requests, 0);
});

test('régebbi adatnál megnyitáskor friss kérés megy, és az adat frissül', async () => {
  now += 5000;
  requests = 0;
  readiness = 42;
  await refreshDashboardIfStale();
  assert.equal(requests, 1);
  assert.equal(dashboard.dashboardData.readiness, 42, 'az animáció a friss adatból fut');
});

test('egy épp futó renderhez csatlakozik, nem indít másodikat', async () => {
  now += 5000;
  requests = 0;
  release = () => {};
  const first = renderDashboard();
  await new Promise((resolve) => setTimeout(resolve, 0)); // a kérés elindult
  const joined = refreshDashboardIfStale();
  assert.equal(requests, 1);
  const finish = release;
  release = null;
  finish();
  await Promise.all([first, joined]);
  assert.equal(requests, 1);
});
