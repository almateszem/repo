/**
 * FitTrack Pro — az edzői panel összegzőjének tesztjei
 * ---------------------------------------------------
 * A coaching.js tiszta függvényeket ad (nincs adatbázis, nincs Express),
 * ezért itt a SZÁMÍTÁS kérdezhető ki közvetlenül — az a rész, amit a
 * coach.test.js HTTP-n nem tud kipróbálni: a napokon átívelő logika. A
 * mentés dátumát ugyanis a szerver adja (mindig a mai nap), tehát „múlt heti
 * edzés" csak itt állítható elő.
 *
 * A dátumok MINDIG a mai naphoz képest relatívan állnak elő. Beégetett
 * dátumokkal a teszt egy idő után magától megbukna (a 28 napos ablak
 * kicsúszna alóla), és a hétnap-alapú terv-követés is elcsúszna.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  relativeDay, weekProgress, adherence, athleteRating, athleteAlert,
  recentActivity, buildAthleteCard,
} from './coaching.js';
import { dayKey } from './recovery.js';

/** N nappal ezelőtti nap "ÉÉÉÉ.HH.NN" alakban (0 = ma). */
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

const TODAY = daysAgo(0);
const TODAY_KEY = dayKey(TODAY);
/** A mai hétnap hétfőtől számolva (0 = hétfő) — ehhez igazítjuk a terveket. */
const TODAY_WEEKDAY = (new Date().getDay() + 6) % 7;

const workout = (date, name = 'Edzés', sets = [{ done: true, type: 'work', weight: '100' }]) => ({
  name, date, exercises: [{ name: 'Guggolás', sets }],
});

test('a relatív nap magyarul, a mai naphoz mérve', () => {
  assert.equal(relativeDay(daysAgo(0), TODAY_KEY), 'ma');
  assert.equal(relativeDay(daysAgo(1), TODAY_KEY), 'tegnap');
  assert.equal(relativeDay(daysAgo(5), TODAY_KEY), '5 napja');
  assert.equal(relativeDay('nem-datum', TODAY_KEY), null);
});

test('a heti állás hétfőtől máig számol, a mai nap még nem elmaradás', () => {
  // Terv MINDEN hétnapra — így a mai nap biztosan ütemezett nap
  const plans = [{ name: 'Napi', days: [0, 1, 2, 3, 4, 5, 6] }];
  // Edzés minden eddigi napon ezen a héten, kivéve a mait
  const workouts = [];
  for (let back = 1; back <= TODAY_WEEKDAY; back += 1) workouts.push(workout(daysAgo(back)));

  const week = weekProgress({ workouts, plans, today: TODAY });
  assert.equal(week.target, 7);
  assert.equal(week.done, TODAY_WEEKDAY, 'a hét eddigi napjai megvannak');
  assert.equal(week.missed, 0, 'a MAI ütemezett edzés még nem kihagyott');
});

test('a kihagyott napokat a heti állás számolja', () => {
  const plans = [{ name: 'Napi', days: [0, 1, 2, 3, 4, 5, 6] }];
  const week = weekProgress({ workouts: [], plans, today: TODAY });
  assert.equal(week.missed, TODAY_WEEKDAY, 'a hét eddigi napjai mind kimaradtak');
});

test('terv nélkül nincs terv-követés (null, nem 0%)', () => {
  assert.equal(adherence({ workouts: [workout(daysAgo(1))], plans: [], today: TODAY }), null);
  assert.equal(adherence({ workouts: [], plans: [{ name: 'Terv', days: [] }], today: TODAY }), null);
});

test('a terv-követés az elmúlt 4 hét ütemezett napjaihoz mér', () => {
  const plans = [{ name: 'Heti kettő', days: [0, 3] }]; // hétfő + csütörtök → 8 nap / 28
  // Minden nap edzés az elmúlt 28 napban → 100%-on tetőzik, nem 350%
  const daily = [];
  for (let back = 1; back <= 28; back += 1) daily.push(workout(daysAgo(back)));
  assert.equal(adherence({ workouts: daily, plans, today: TODAY }), 100);

  // Semmi edzés → 0%
  assert.equal(adherence({ workouts: [], plans, today: TODAY }), 0);

  // Pontosan a fele: 4 edzésnap a 8 ütemezett helyett
  const half = [];
  for (let back = 1; back <= 28; back += 7) half.push(workout(daysAgo(back)));
  assert.equal(adherence({ workouts: half, plans, today: TODAY }), 50);
});

test('a mai nap nem számít bele a terv-követésbe', () => {
  const plans = [{ name: 'Napi', days: [0, 1, 2, 3, 4, 5, 6] }];
  // Csak MA volt edzés → az ablak (tegnaptól visszafelé) üres marad
  assert.equal(adherence({ workouts: [workout(daysAgo(0))], plans, today: TODAY }), 0);
});

test('az összpontszám terv nélkül maga a készenlét', () => {
  assert.equal(athleteRating(80, null), 80);
  assert.equal(athleteRating(80, 90), 85);
  assert.equal(athleteRating(81, 90), 86, 'kerekít');
});

test('a riasztás a súlyosabb okokat mondja, legfeljebb kettőt', () => {
  const alert = athleteAlert({
    missed: 3, daysSinceWorkout: 9, readiness: 40, daysSinceCheckin: 10, activeDays: 30,
  });
  assert.equal(alert, '3 kihagyott edzés · 9 napja nem edzett', 'a két legsúlyosabb ok');

  assert.equal(
    athleteAlert({ missed: 0, daysSinceWorkout: 1, readiness: 58, daysSinceCheckin: 0, activeDays: 30 }),
    'készenlét 58%',
  );
  assert.equal(
    athleteAlert({ missed: 1, daysSinceWorkout: 2, readiness: 88, daysSinceCheckin: 5, activeDays: 30 }),
    'check-in 5 napja hiányzik',
    'egy kihagyott edzés még nem riasztás',
  );
  assert.equal(
    athleteAlert({ missed: 0, daysSinceWorkout: 1, readiness: 90, daysSinceCheckin: 1, activeDays: 30 }),
    null,
    'minden rendben → nincs sor',
  );
});

test('a hiányzó adat csak akkor riasztás, ha lett volna ideje meglenni', () => {
  // Ma csatlakozott, ma naplózott egy edzést: még nincs check-inje — ez nem hiba
  const fresh = athleteAlert({
    missed: 0, daysSinceWorkout: 0, readiness: 100, daysSinceCheckin: null, activeDays: 0,
  });
  assert.equal(fresh, null, 'aki most kezdett, nem „lemaradt"');

  // Egy hete használja, de check-int még egyet sem töltött ki
  const stale = athleteAlert({
    missed: 0, daysSinceWorkout: 1, readiness: 100, daysSinceCheckin: null, activeDays: 7,
  });
  assert.equal(stale, 'nincs kitöltött check-in');

  // Check-inezik, de edzést nem naplóz
  const noWorkouts = athleteAlert({
    missed: 0, daysSinceWorkout: null, readiness: 100, daysSinceCheckin: 0, activeDays: 3,
  });
  assert.equal(noWorkouts, 'még nincs naplózott edzés');

  // Teljesen üres fiók: semmiről nem állítunk semmit
  assert.equal(
    athleteAlert({ missed: 0, daysSinceWorkout: null, readiness: 100, daysSinceCheckin: null, activeDays: 0 }),
    null,
  );
});

test('a legutóbbi aktivitás a naplókból fésülődik össze, legújabb elöl', () => {
  const withPr = workout(daysAgo(1), 'Erőnap');
  withPr.exercises[0].pr = true;
  withPr.exercises[0].sets = [
    { done: true, type: 'work', weight: '100' },
    { done: true, type: 'work', weight: '140' },
  ];

  const list = recentActivity({
    workouts: [withPr],
    checkins: [{ date: daysAgo(0) }],
    weightLog: [{ kg: 82.4, date: daysAgo(3) }],
    today: TODAY,
  });

  assert.equal(list[0], 'Regenerációs check-in kitöltve — ma');
  assert.ok(list.some((entry) => entry === 'Új PR: Guggolás 140 kg — tegnap'), 'a PR a legnehezebb szettel');
  assert.ok(list.some((entry) => entry === 'Erőnap · 2 munkasorozat — tegnap'));
  assert.ok(list.some((entry) => entry === 'Testsúly rögzítve: 82.4 kg — 3 napja'));
});

test('a bemelegítő szett nem munkasorozat', () => {
  const [entry] = recentActivity({
    workouts: [workout(daysAgo(0), 'Nap', [
      { done: true, type: 'warmup', weight: '40' },
      { done: true, type: 'work', weight: '100' },
      { done: false, type: 'work', weight: '110' },
    ])],
    checkins: [],
    weightLog: [],
    today: TODAY,
  });
  assert.equal(entry, 'Nap · 1 munkasorozat — ma');
});

test('a kártya a mai hétnapra ütemezett tervet mutatja aktívként', () => {
  const card = buildAthleteCard({
    athlete: { linkId: 7, username: 'petra', name: 'Nagy Petra', goal: 'ERŐ' },
    workouts: [workout(daysAgo(0))],
    plans: [
      { name: 'Legutóbb készült', days: [(TODAY_WEEKDAY + 1) % 7] },
      { name: 'Mai terv', days: [TODAY_WEEKDAY] },
    ],
    checkins: [],
    weightLog: [],
    readiness: 82.4,
    streak: 3,
    lastMessage: { text: 'Megvolt!', at: '2026-08-25T10:00:00Z', author: 'Nagy Petra' },
    today: TODAY,
  });

  assert.equal(card.plan, 'Mai terv');
  assert.equal(card.linkId, 7);
  assert.equal(card.goal, 'ERŐ');
  assert.equal(card.readiness, 82, 'a készenlét egészre kerekítve megy ki');
  assert.equal(card.lastWorkout, 'ma');
  assert.equal(card.streak, 3);
  assert.equal(card.lastMessage.text, 'Megvolt!');
});

test('a ma csatlakozott sportoló kártyája nem riaszt, de a megbízhatóság látszik', () => {
  const card = buildAthleteCard({
    athlete: { linkId: 3, username: 'uj', name: 'Új Ugyan', goal: null },
    workouts: [workout(daysAgo(0))],
    plans: [],
    checkins: [],
    weightLog: [],
    readiness: 100,
    confidence: 'low',
    streak: 1,
    lastMessage: null,
    today: TODAY,
  });

  assert.equal(card.alert, null, 'egy nap után nincs mit számonkérni');
  assert.equal(card.confidence, 'low', 'a modál ebből írja ki, min alapul a 100%');
});

test('terv nélkül a heti állás „x/–", és az összpontszám a készenlét', () => {
  const card = buildAthleteCard({
    athlete: { linkId: 1, username: 'petra', name: 'Nagy Petra', goal: null },
    workouts: [workout(daysAgo(0))],
    plans: [],
    checkins: [],
    weightLog: [],
    readiness: 70,
    streak: 1,
    lastMessage: null,
    today: TODAY,
  });

  assert.equal(card.weekly, '1/–');
  assert.equal(card.adherence, null);
  assert.equal(card.rating, 70);
  assert.equal(card.plan, null);
  assert.equal(card.lastMessage, null);
});

/* ======================================================================
   Ablakozott edzés-napló
   ----------------------------------------------------------------------
   Az edzői panel nem olvassa be a sportoló TELJES naplóját, csak az utolsó
   pár hetet (server.js -> CARD_WINDOW_DAYS): a készenlét-motor és a
   terv-követés úgyis eldobja a régebbit. Ami viszont kilóg az ablakból, azt
   a NAPOK listája hozza — a lentiek pontosan azt őrzik, hogy ettől ne
   sérüljön a kártya.
   ====================================================================== */

test('az ablakon KÍVÜLI utolsó edzés is látszik a kártyán', () => {
  const card = buildAthleteCard({
    athlete: { linkId: 1, username: 'petra', name: 'Nagy Petra', goal: null },
    // Az ablakban nincs edzés — a sportoló két hónapja nem járt edzeni
    workouts: [],
    workoutDates: [daysAgo(62), daysAgo(64)],
    plans: [],
    checkins: [{ date: daysAgo(0) }, { date: daysAgo(70) }],
    weightLog: [],
    readiness: 90,
    streak: 0,
    lastMessage: null,
    today: TODAY,
  });

  assert.equal(card.lastWorkout, '62 napja', 'nem „—", és nem is a mai nap');
  assert.match(
    card.alert, /62 napja nem edzett/,
    'a riasztás a valódi kihagyást mondja, nem azt, hogy „még nincs naplózott edzés"',
  );
});

test('a sorozat az ablaknál hosszabb is lehet — a hívó számolja a napokból', () => {
  /* 50 egymást követő edzésnap: az ablak ennek a felét sem fogja át, a kártya
     mégis az igazi hosszt mutatja, mert a `streak` a napok listájából jön. */
  const dates = Array.from({ length: 50 }, (_, i) => daysAgo(i));
  const card = buildAthleteCard({
    athlete: { linkId: 1, username: 'petra', name: 'Nagy Petra', goal: null },
    workouts: [workout(daysAgo(0)), workout(daysAgo(1))],
    workoutDates: dates,
    plans: [],
    checkins: [],
    weightLog: [],
    readiness: 80,
    streak: 50,
    lastMessage: null,
    today: TODAY,
  });

  assert.equal(card.streak, 50);
  assert.equal(card.lastWorkout, 'ma');
});

test('workoutDates nélkül minden a régi módon, az edzésekből képződik', () => {
  /* Visszafelé kompatibilitás: a mező elhagyható, és akkor a lista maga adja
     a napokat — az ablakozatlan hívók (és a tesztek) ezt használják. */
  const card = buildAthleteCard({
    athlete: { linkId: 1, username: 'petra', name: 'Nagy Petra', goal: null },
    workouts: [workout(daysAgo(2)), workout(daysAgo(9))],
    plans: [],
    checkins: [],
    weightLog: [],
    readiness: 80,
    streak: 0,
    lastMessage: null,
    today: TODAY,
  });

  assert.equal(card.lastWorkout, '2 napja');
});
