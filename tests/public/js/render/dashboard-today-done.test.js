/** A mai terv már kész: az Áttekintő nem kínálja újra a terv nevét, mintha
    még hátra lenne — „Mai edzés kész ✓" áll a helyén, a gomb pedig új (szabad)
    edzést indít. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
const { paintDashboard } = await import('../../../../public/js/render/dashboard.js');

const DATA = {
  readiness: 70,
  streak: 2,
  recovery: { sleep: '7 óra', fatigue: '-', soreness: '-' },
  dailyStats: {},
  workoutName: 'Push A',
  workoutPlan: { exercises: [] },
  restDay: false,
  checkinPresent: true,
};

test('a még hátralévő mai terv: a neve és az „Edzés indítása"', () => {
  paintDashboard({ ...DATA, todayDone: false });
  assert.equal(elementFor('[data-workout-name]').textContent, 'Push A');
  assert.equal(elementFor('[data-cta-label]').textContent, 'Edzés indítása');
});

test('a ma már elvégzett terv: „Mai edzés kész ✓" és „Új edzés"', () => {
  paintDashboard({ ...DATA, todayDone: true });
  assert.equal(elementFor('[data-workout-name]').textContent, 'Mai edzés kész ✓');
  assert.equal(elementFor('[data-cta-label]').textContent, 'Új edzés');
});
