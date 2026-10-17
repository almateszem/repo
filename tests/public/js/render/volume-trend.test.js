/** Az Áttekintő „Utolsó 14 nap" diagramja edzés befejezése, javítása és
    törlése után is frissül — de CSAK ez a konténer: a teljes renderCharts() a
    seed demo-testsúlygörbét (server/data.js) rajzolná a valódi fölé. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
const looked = [];
const lookedAll = [];
globalThis.document.querySelector = (selector) => {
  looked.push(selector);
  return elementFor(selector);
};
globalThis.document.querySelectorAll = (selector) => {
  lookedAll.push(selector);
  return [];
};

const CHARTS = {
  volumeTrend: { heights: [10, 40, 80], axis: ['0', '5 t'], labels: ['h', 'k', 'sz'] },
  volumeThisWeek: { heights: [5, 5], axis: [], labels: [], total: 3, note: '', ariaLabel: 'x' },
  bodyWeight: { heights: [50, 50, 50, 50], axis: ['demo'], labels: [] },
};
let chartRequests = 0;
globalThis.fetch = async () => {
  chartRequests += 1;
  return Response.json(CHARTS);
};

const { renderVolumeTrend } = await import('../../../../public/js/render/dashboard.js');
const { setupWeeklyCompare } = await import('../../../../public/js/ui/summary.js');
const { hooks } = await import('../../../../public/js/core/page-hooks.js');

const reset = () => {
  looked.length = 0;
  lookedAll.length = 0;
  elementFor('.chart-bars').replaceChildren();
};

test('renderVolumeTrend: csak a volumeTrend konténert rajzolja', () => {
  reset();
  renderVolumeTrend(CHARTS);
  assert.ok(looked.includes('[data-chart="volumeTrend"]'));
  assert.equal(elementFor('.chart-bars').children.length, 3, 'a volumeTrend három oszlopa');
  assert.ok(!looked.includes('[data-chart="bodyWeight"]'), 'a testsúly-görbe érintetlen');
  assert.deepEqual(lookedAll, [], 'nem jár végig minden data-chart konténeren');
});

test('renderVolumeTrend: volumeTrend adat nélkül nem nyúl semmihez', () => {
  reset();
  renderVolumeTrend({ bodyWeight: CHARTS.bodyWeight });
  assert.equal(elementFor('.chart-bars').children.length, 0);
});

test('a refreshVolumeChart (edzés után) az Áttekintő volumeTrend-jét is frissíti, egy lekéréssel', async () => {
  await setupWeeklyCompare();
  reset();
  chartRequests = 0;
  await hooks.refreshVolumeChart();
  assert.equal(chartRequests, 1, 'a már lekért chartokkal, új lekérés nélkül');
  assert.ok(looked.includes('[data-chart="volumeTrend"]'), 'az Áttekintő diagramja');
  assert.ok(!looked.includes('[data-chart="bodyWeight"]'), 'a testsúly-görbe érintetlen');
});
