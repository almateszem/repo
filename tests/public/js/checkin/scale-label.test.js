/**
 * Podium — a check-in skála képernyőolvasó-címkéi (F4)
 * --------------------------------------------------------------------------
 * A 2-es és a 4-es gomb címkéje korábban szintén „közepes" volt — a
 * fordított skálán (stressz: 5 = nagyon feszült) ráadásul valótlanul. Most
 * a köztes értékek a helyüket mondják, a két végpont a kérdés saját szavát.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { scaleLabel } = await import('../../../../public/js/checkin/steps.js');

test('a végpontok a saját szavukat, a köztes értékek a helyüket mondják', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((v) => scaleLabel(v, 'nyugodt', 'nagyon feszült')),
    [
      '1 az 5-ből — nyugodt',
      '2 az 5-ből',
      '3 az 5-ből',
      '4 az 5-ből',
      '5 az 5-ből — nagyon feszült',
    ],
  );
});

test('egyik címke sem mond „közepes"-t', () => {
  for (let v = 1; v <= 5; v += 1) {
    assert.ok(!scaleLabel(v, 'kimerült', 'tele energiával').includes('közepes'));
  }
});
