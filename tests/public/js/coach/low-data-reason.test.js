/**
 * Podium — „Még kevés az adat" csak valóban kevés naplónál (M2)
 * --------------------------------------------------------------------------
 * Az alacsony megbízhatóságnak két oka lehet: kevés napló, vagy csak a mai
 * check-in hiányzik. Korábban mindkettőre „Még kevés az adat — több naplóval
 * pontosabb lesz" állt, 28 naplózott edzés mellett is. A szerver most
 * megmondja, volt-e ma check-in (checkinToday), a felület pedig az okot.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { lowDataReason } = await import('../../../../public/js/coach/coach-shared.js');

test('az ok a megbízhatóságból és a mai check-inből', () => {
  assert.equal(lowDataReason({ confidence: 'high', checkinToday: true }), null);
  assert.equal(lowDataReason({ confidence: 'medium', checkinToday: false }), null);
  assert.equal(lowDataReason({ confidence: 'low', checkinToday: false }), 'no-checkin');
  assert.equal(lowDataReason({ confidence: 'low', checkinToday: true }), 'few-logs');
});

test('régi szervertől (checkinToday nélkül) a korábbi, óvatos szöveg marad', () => {
  assert.equal(lowDataReason({ confidence: 'low' }), 'few-logs');
});
