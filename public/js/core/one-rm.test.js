import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate1RM } from './one-rm.js';
// A recovery.js tiszta modul (a db.js importja adatbázist nyitna); a db.js
// calculateEpley1RM-je ezt hívja, azt a server/prs.test.js fedi.
import { estimate1RM as serverEstimate1RM } from '../../../server/recovery.js';

test('a kliens PR-jelzője ugyanazt az 1RM-et számolja, mint a szerver', () => {
  for (const weight of [2.5, 40, 100, 142.5]) {
    for (let reps = 0; reps <= 15; reps += 1) {
      assert.equal(
        estimate1RM(weight, reps),
        serverEstimate1RM(weight, reps) ?? 0,
        `${weight} × ${reps}`,
      );
    }
  }
});

test('egy ismétlés becslése maga a súly', () => {
  assert.equal(estimate1RM(100, 1), 100);
  assert.equal(estimate1RM(100, 5), 100 * (1 + 5 / 30));
  assert.equal(estimate1RM(0, 5), 0);
});
