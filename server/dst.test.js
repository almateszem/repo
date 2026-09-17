/**
 * FitTrack Pro — óraátállítás (DST) tesztek
 * -----------------------------------------
 * A napok helyi éjfélre normalizált timestampek (recovery.js → dayKey). A
 * napi léptetés korábban `± n × 24 óra` volt, ami az óraátállítás 23 és 25
 * órás napján nem éjfélre esett: a sorozat megszakadt, a terv-követés
 * 36%-ra esett, a múlt heti volumen üres lett.
 *
 * A hiba csak DST-s időzónában jön elő, ezért ez a fájl a magyar időzónában
 * fut. A node --test minden fájlt külön folyamatban futtat, tehát a TZ
 * beállítása a többi tesztet nem érinti. A modulokat a beállítás UTÁN töltjük.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Europe/Budapest';
const { dayKey, daysBetween, shiftDayKey } = await import('./recovery.js');
const { adherence, streakFromDates, weekProgress, relativeDay } = await import('./coaching.js');

const pad = (n) => String(n).padStart(2, '0');
/** Az `end` napig visszafelé `count` egymást követő nap, "ÉÉÉÉ.HH.NN" alakban. */
const daysUntil = (end, count) => {
  const [y, m, d] = end.split('.').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(y, m - 1, d - i);
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  });
};

// 2026-ban: tavasszal márc. 29., ősszel okt. 25. az átállás napja
const AUTUMN = '2026.10.25';
const SPRING = '2026.03.29';

test('a teszt tényleg DST-s időzónában fut (különben üres volna)', () => {
  const before = new Date(2026, 9, 24).getTimezoneOffset();
  const after = new Date(2026, 9, 26).getTimezoneOffset();
  assert.notEqual(before, after, 'Europe/Budapest: okt. 25-én óraátállítás');
});

test('shiftDayKey naptári napot lép, az átállításon át is éjfélre', () => {
  assert.equal(shiftDayKey(dayKey('2026.10.26'), -1), dayKey(AUTUMN));
  assert.equal(shiftDayKey(dayKey(AUTUMN), -1), dayKey('2026.10.24'));
  assert.equal(shiftDayKey(dayKey('2026.03.30'), -1), dayKey(SPRING));
  assert.equal(shiftDayKey(dayKey(SPRING), -1), dayKey('2026.03.28'));
  assert.equal(shiftDayKey(dayKey('2026.11.05'), -28), dayKey('2026.10.08'));
  assert.equal(daysBetween(dayKey('2026.10.20'), dayKey('2026.11.05')), 16);
  assert.equal(daysBetween(dayKey('2026.03.25'), dayKey('2026.04.02')), 8);
});

test('az edzés-sorozat nem szakad meg az óraátállításnál', () => {
  assert.equal(streakFromDates(daysUntil('2026.10.30', 10), '2026.10.30'), 10);
  assert.equal(streakFromDates(daysUntil('2026.04.02', 10), '2026.04.02'), 10);
  // Ma még nem edzett: tegnaptól számol, szintén az átállításon át
  assert.equal(streakFromDates(daysUntil('2026.10.29', 10), '2026.10.30'), 10);
});

test('a terv-követés az átállításon túli napokat is látja', () => {
  const plans = [{ days: [0, 1, 2, 3, 4, 5, 6] }];
  for (const today of ['2026.11.05', '2026.04.10']) {
    const workouts = daysUntil(today, 40).map((date) => ({ date, exercises: [] }));
    assert.equal(adherence({ workouts, plans, today }), 100, today);
  }
  // Csak hétfőre ütemezett terv: a hétfők száma az ablakban helyesen jön ki
  const mondays = daysUntil('2026.11.05', 40)
    .filter((date) => new Date(dayKey(date)).getDay() === 1)
    .map((date) => ({ date, exercises: [] }));
  assert.equal(adherence({ workouts: mondays, plans: [{ days: [0] }], today: '2026.11.05' }), 100);
});

test('a heti állás és a relatív nap az átállítás hetében is pontos', () => {
  const plans = [{ days: [0, 1, 2, 3, 4, 5, 6] }];
  const workouts = daysUntil(AUTUMN, 7).map((date) => ({ date, exercises: [] }));
  assert.deepEqual(weekProgress({ workouts, plans, today: AUTUMN }), {
    done: 7,
    target: 7,
    missed: 0,
  });
  assert.equal(relativeDay('2026.10.20', dayKey('2026.11.05')), '16 napja');
});
