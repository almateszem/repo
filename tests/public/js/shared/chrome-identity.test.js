/** A telefonos fejléc köszönése és monogramja a megjelenített névből. A magyar
    névsorrend vezetéknév + keresztnév, ezért a köszönés a MÁSODIK szót
    szólítja meg („Nagy Bence" → „Bence"); egyszavas név (pl. egy
    felhasználónév) önmagát. A monogram az első két szó kezdőbetűje. */

import assert from 'node:assert/strict';
import test from 'node:test';

const { greetingName, initials, weekdayLabel } =
  await import('../../../../public/js/shared/chrome-identity.js');

test('a köszönés a keresztnevet szólítja meg', () => {
  assert.equal(greetingName('Nagy Bence'), 'Bence');
  assert.equal(greetingName('Kiss Anna Mária'), 'Anna');
  assert.equal(greetingName('  Tóth   Dávid  '), 'Dávid');
});

test('egyszavas névnél maga a név a köszönés', () => {
  assert.equal(greetingName('admin'), 'admin');
});

test('üres névnél nincs megszólítás', () => {
  assert.equal(greetingName(''), '');
  assert.equal(greetingName(undefined), '');
});

test('a monogram az első két szó kezdőbetűje, nagybetűvel', () => {
  assert.equal(initials('Nagy Bence'), 'NB');
  assert.equal(initials('kiss anna mária'), 'KA');
  assert.equal(initials('Ádám Éva'), 'ÁÉ');
});

test('egyszavas névnél egy betű a monogram, üresnél semmi', () => {
  assert.equal(initials('admin'), 'A');
  assert.equal(initials('   '), '');
});

test('a nap neve magyarul, a helyi dátumból', () => {
  assert.equal(weekdayLabel(new Date(2026, 10, 12)), 'csütörtök');
  assert.equal(weekdayLabel(new Date(2026, 10, 16)), 'hétfő');
});
