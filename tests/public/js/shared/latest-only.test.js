/** Generációs őr: egy lassú, régebbi kérés válasza nem írhat a felületre, ha
    közben újabb kérés indult vagy mentés történt (a Regeneráció oldal
    frissítése így nem írja vissza a mentés előtti állapotot). */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLatestOnly } from '../../../../public/js/shared/latest-only.js';

test('latestOnly: csak a legutóbb indított kérés érvényes', () => {
  const guard = createLatestOnly();
  const slow = guard.begin();
  const fast = guard.begin();
  assert.equal(guard.isCurrent(fast), true);
  assert.equal(guard.isCurrent(slow), false, 'a lassú, régebbi válasz eldobandó');
});

test('latestOnly: a mentés (invalidate) a futó kérést is elavulttá teszi', () => {
  const guard = createLatestOnly();
  const before = guard.begin();
  guard.invalidate();
  assert.equal(guard.isCurrent(before), false);
  assert.equal(guard.isCurrent(guard.begin()), true, 'utána újra lehet kérni');
});
