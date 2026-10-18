/** Szerződés-teszt: a beállítások némító-kapcsolói (kliens NOTIF_CATEGORIES)
    pontosan azokat a kategóriákat ismerik, amelyeket a szerver küld
    (server/notifications.js → NOTIF_CATEGORY). Korábban a „feedback" kimaradt
    a kliens listájából, így az edzői visszajelzés nem volt némítható. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { NOTIF_CATEGORIES } from '../../../../public/js/core/constants.js';
import { NOTIF_CATEGORY, buildNotifications } from '../../../../server/notifications.js';

const at = '2026-10-18T07:00:00Z';

test('a kliens kapcsolói pontosan a szerver kategóriáit ismerik', () => {
  assert.deepEqual(
    NOTIF_CATEGORIES.map((category) => category.key),
    Object.values(NOTIF_CATEGORY),
  );
  for (const { label } of NOTIF_CATEGORIES) assert.ok(label, 'minden kapcsolónak van felirata');
});

test('a szerver minden értesítése egy ismert kategóriát visz', () => {
  const items = buildNotifications({
    unreadThreads: [{ linkId: 1, partner: 'P', unread: 1, lastText: 'x', at }],
    incomingInvites: [{ linkId: 2, coach: 'E', at }],
    acceptedLinks: [{ linkId: 3, athlete: 'S', at }],
    planOffers: [{ id: 4, plan: 'T', coach: 'E', at }],
    answeredPlans: [{ id: 5, plan: 'T', athlete: 'S', accepted: true, at }],
    recentPrs: [{ exercise: 'Guggolás', max1rm: 100, at }],
    athleteFeedback: [{ id: 6, workout: 'Lábnap', athlete: 'S', difficulty: 3, at }],
  });
  const known = new Set(NOTIF_CATEGORIES.map((category) => category.key));
  assert.equal(items.length, 7);
  for (const item of items) assert.ok(known.has(item.cat), `${item.id}: ${item.cat}`);
});
