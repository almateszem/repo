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
  relativeDay,
  weekProgress,
  adherence,
  adherenceBreakdown,
  adherenceTrend,
  planDayScore,
  planWorkouts,
  rpeMatch,
  athleteRating,
  athleteAlert,
  recentActivity,
  buildAthleteCard,
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
  name,
  date,
  exercises: [{ name: 'Guggolás', sets }],
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

/* ---- Terv-követés: az edző kiosztott tervéhez mérve ---- */

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
/** N nappal ezelőtti nap hétnapja (0 = hétfő). */
const weekdayAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return (d.getDay() + 6) % 7;
};

/** A tervezett guggolás: egy bemelegítő + 3 munkasorozat, RPE 8. */
const SQUAT_DAY = [
  {
    name: 'Guggolás',
    sets: [
      { type: 'warmup', reps: '8', weight: '60', rpe: '' },
      ...Array.from({ length: 3 }, () => ({ type: 'work', reps: '5', weight: '100', rpe: '8' })),
    ],
  },
];

/** Kiosztott terv (getAssignedPlanTargets alak): a megadott napokon a
    guggolás-edzés, a többi pihenő. */
const assigned = (days, extra = {}) => ({
  id: 1,
  week: Array.from({ length: 7 }, (_, day) =>
    days.includes(day) ? { type: 'workout', name: '', exercises: SQUAT_DAY } : { type: 'rest' },
  ),
  ...extra,
});

/** A tervből indított edzés: `done` elvégzett munkasorozat a 3-ból (+ a
    bemelegítő), mindegyiken `rpe` naplózva. */
const fromPlan = (date, { done = 3, rpe = '8', planId = 1, sets = 3 } = {}) => ({
  name: 'Erő',
  date,
  planId,
  exercises: [
    {
      name: 'Guggolás',
      sets: [
        { type: 'warmup', reps: '8', weight: '60', rpe: '', done: true },
        ...Array.from({ length: sets }, (_, i) => ({
          type: 'work',
          reps: '5',
          weight: '100',
          rpe,
          done: i < done,
        })),
      ],
    },
  ],
});

/** Tervből indított edzés az elmúlt N nap mindegyikén. */
const everyDay = (options, days = 28) =>
  Array.from({ length: days }, (_, i) => fromPlan(daysAgo(i + 1), options));

test('kiosztott terv nélkül nincs terv-követés (null, nem 0%)', () => {
  assert.equal(adherence({ workouts: everyDay(), plans: [], today: TODAY }), null);
  assert.equal(adherence({ workouts: [], plans: [assigned([])], today: TODAY }), null);
});

test('a kijelölt napon, a tervezett szettekkel és RPE-vel: 100%', () => {
  const plans = [assigned(EVERY_DAY)];
  assert.equal(adherence({ workouts: everyDay(), plans, today: TODAY }), 100);
  assert.equal(adherence({ workouts: [], plans, today: TODAY }), 0);
});

test('más napon pótolt edzés nem számít — csak a kijelölt nap', () => {
  // Csak a tegnapi hétnapra szól: az ablakban 4 ilyen nap van
  const plans = [assigned([weekdayAgo(1)])];
  const onDay = [1, 8, 15, 22].map((n) => fromPlan(daysAgo(n)));
  const dayLate = [2, 9, 16, 23].map((n) => fromPlan(daysAgo(n)));
  assert.equal(adherence({ workouts: onDay, plans, today: TODAY }), 100);
  assert.equal(adherence({ workouts: dayLate, plans, today: TODAY }), 0, 'egy nappal elcsúszva');
});

test('minden nap a SAJÁT edzéséhez mér — a hétfő a hétfői, a „same" nap a hivatkozott listához', () => {
  const monday = weekdayAgo(1);
  const other = (monday + 1) % 7;
  const pull = [{ name: 'Húzódzkodás', sets: [{ type: 'work', reps: '8', rpe: '8' }] }];
  const week = Array.from({ length: 7 }, () => ({ type: 'rest' }));
  week[monday] = { type: 'workout', name: 'Láb', exercises: SQUAT_DAY };
  week[other] = { type: 'workout', name: 'Hát', exercises: pull };
  const plans = [{ id: 1, week }];

  // Tegnap (a „láb" napon) guggolt → 100; ha húzódzkodott volna, 0 szett
  const squat = [fromPlan(daysAgo(1))];
  const breakdown = adherenceBreakdown({ workouts: squat, plans, today: TODAY });
  assert.equal(breakdown.sets, 100);
  const wrongDay = [{ ...fromPlan(daysAgo(1)), exercises: pull }];
  assert.equal(adherenceBreakdown({ workouts: wrongDay, plans, today: TODAY }).sets, 0);

  // A „same" nap a hivatkozott nap edzését várja
  week[other] = { type: 'same', of: monday };
  // (a „same" nap a mai hétnap: egy hete volt utoljára az ablakban)
  assert.equal(
    adherenceBreakdown({ workouts: [fromPlan(daysAgo(7))], plans, today: TODAY }).sets,
    100,
  );
});

test('a kijelölt napon, de NEM a tervből indított edzés nem teljesítés', () => {
  const plans = [assigned(EVERY_DAY)];
  const free = everyDay({ planId: null });
  const otherPlan = everyDay({ planId: 2 });
  assert.equal(adherence({ workouts: free, plans, today: TODAY }), 0);
  assert.equal(adherence({ workouts: otherPlan, plans, today: TODAY }), 0);
});

test('a szett- és az RPE-egyezés átlaga adja a nap pontját', () => {
  const plans = [assigned(EVERY_DAY)];
  // Minden szett megvan, de RPE 9 a tervezett 8 helyett: (1 + 2/3) / 2 → 83
  assert.equal(adherence({ workouts: everyDay({ rpe: '9' }), plans, today: TODAY }), 83);
  // 1 szett a 3-ból, pontos RPE: (1/3 + 1) / 2 → 67
  assert.equal(adherence({ workouts: everyDay({ done: 1 }), plans, today: TODAY }), 67);
  // RPE nélkül naplózva: csak a szett számít (2/3 → 67)
  assert.equal(adherence({ workouts: everyDay({ done: 2, rpe: '' }), plans, today: TODAY }), 67);
});

test('egy nap pontja: szett-arány és RPE-egyezés', () => {
  const exercises = SQUAT_DAY;
  const day = (options) => planDayScore(exercises, fromPlan(TODAY, options));

  assert.deepEqual(day(), { sets: 1, rpe: 1 });
  assert.equal(day({ done: 2 }).sets, 2 / 3);
  // A plusz szett nem visz 100 fölé, és a bemelegítő nem munkasorozat
  assert.equal(day({ sets: 5, done: 5 }).sets, 1);
  // A tervben szereplő, de kihagyott gyakorlat: 0 szett
  const skipped = { ...fromPlan(TODAY), exercises: [{ name: 'Húzódzkodás', sets: [] }] };
  assert.deepEqual(planDayScore(exercises, skipped), { sets: 0, rpe: null });
  // A nem elvégzett szett RPE-je nem számít
  assert.equal(day({ done: 0, rpe: '5' }).rpe, null);
});

test('az RPE-egyezés: ±0,5 pontos, ±2-től nulla, köztük arányos', () => {
  assert.equal(rpeMatch(8, 8.5), 1);
  assert.equal(rpeMatch(8, 7.5), 1);
  assert.equal(rpeMatch(8, 9), 2 / 3);
  assert.equal(rpeMatch(8, 10), 0);
  assert.equal(rpeMatch(8, 5), 0);
});

test('a mai nap nem számít bele a terv-követésbe', () => {
  const plans = [assigned(EVERY_DAY)];
  // Csak MA volt edzés → az ablak (tegnaptól visszafelé) üres marad
  assert.equal(adherence({ workouts: [fromPlan(TODAY)], plans, today: TODAY }), 0);
});

test('a terv-követés csak a terv elfogadása óta mér', () => {
  // 3 napja elfogadott napi terv: az ablakban 3 tervezett nap, nem 28
  const plans = [assigned(EVERY_DAY, { date: daysAgo(3) })];
  const before = [];
  for (let back = 4; back <= 28; back += 1) before.push(fromPlan(daysAgo(back)));
  assert.equal(adherence({ workouts: before, plans, today: TODAY }), 0);

  const after = [1, 2, 3].map((n) => fromPlan(daysAgo(n)));
  assert.equal(adherence({ workouts: after, plans, today: TODAY }), 100);
});

test('a ma kapott terv még nem ad terv-követést', () => {
  const plans = [assigned(EVERY_DAY, { date: TODAY })];
  assert.equal(adherence({ workouts: [], plans, today: TODAY }), null);
});

test('a bontás: jó napon elvégezve, szett és RPE külön', () => {
  const plans = [assigned(EVERY_DAY)];
  // A 28 napból 14-en edzett, mindig minden szettel, RPE 9-cel
  const workouts = everyDay({ rpe: '9' }).filter((_, i) => i % 2 === 0);
  assert.deepEqual(adherenceBreakdown({ workouts, plans, today: TODAY }), {
    onDay: '14/28',
    sets: 100,
    rpe: 67,
  });
  assert.deepEqual(adherenceBreakdown({ workouts: [], plans, today: TODAY }), {
    onDay: '0/28',
    sets: null,
    rpe: null,
  });
  assert.equal(adherenceBreakdown({ workouts, plans: [], today: TODAY }), null);
});

test('a heti állásban a terv előtti nap nem kihagyás', () => {
  const plans = [{ name: 'Napi', date: TODAY, days: [0, 1, 2, 3, 4, 5, 6] }];
  assert.equal(weekProgress({ workouts: [], plans, today: TODAY }).missed, 0);
});

test('a trend az utolsó két hetet az előző kettőhöz méri', () => {
  const plans = [assigned(EVERY_DAY)];
  // Az előző két hétben minden nap edzett, az utolsó kettőben semmit
  const early = [];
  for (let back = 15; back <= 28; back += 1) early.push(fromPlan(daysAgo(back)));
  assert.equal(adherenceTrend({ workouts: early, plans, today: TODAY }), -100);
  assert.equal(adherenceTrend({ workouts: early, plans: [], today: TODAY }), null);

  const alert = athleteAlert({
    missed: 0,
    daysSinceWorkout: 1,
    readiness: null,
    daysSinceCheckin: 0,
    adherenceTrend: -30,
  });
  assert.equal(alert, 'terv-követés esik (-30)');
  assert.equal(
    athleteAlert({
      missed: 0,
      daysSinceWorkout: 1,
      readiness: null,
      daysSinceCheckin: 0,
      adherenceTrend: -10,
    }),
    null,
    'kis ingadozás nem riasztás',
  );
});

test('a terv szerinti edzések aránya a tervből indultakat számolja', () => {
  const workouts = [
    { ...workout(daysAgo(1)), planId: 1 },
    { ...workout(daysAgo(2)), planId: 1 },
    { ...workout(daysAgo(3)), planId: null },
    { ...workout(daysAgo(40)), planId: 1 }, // ablakon kívül
  ];
  assert.deepEqual(planWorkouts({ workouts, today: TODAY }), { fromPlan: 2, total: 3 });
  assert.equal(planWorkouts({ workouts: [], today: TODAY }), null);
});

test('a kártyán a sportoló SAJÁT terve nem mérce, csak a kiosztott', () => {
  const base = {
    athlete: { linkId: 1, username: 'x', name: 'X' },
    workouts: everyDay(),
    checkins: [],
    weightLog: [],
    readiness: null,
    streak: 0,
    lastMessage: null,
    today: TODAY,
  };
  const own = buildAthleteCard({ ...base, plans: [{ id: 1, name: 'Saját', days: EVERY_DAY }] });
  assert.equal(own.adherence, null);
  assert.equal(own.adherenceDetail, null);
  assert.equal(own.plan, 'Saját', 'a heti állás és az aktív terv továbbra is a saját tervekből');

  const coached = buildAthleteCard({ ...base, plans: [], assignedPlans: [assigned(EVERY_DAY)] });
  assert.equal(coached.adherence, 100);
  assert.deepEqual(coached.adherenceDetail, { onDay: '28/28', sets: 100, rpe: 100 });
});

test('az összpontszám terv nélkül maga a készenlét', () => {
  assert.equal(athleteRating(80, null), 80);
  assert.equal(athleteRating(80, 90), 85);
  assert.equal(athleteRating(81, 90), 86, 'kerekít');
});

test('hiányzó készenlét: nem nulla, nem riaszt, a pontszám a terv-követésből jön', () => {
  assert.equal(athleteRating(null, null), null, 'se készenlét, se terv: nincs pontszám');
  assert.equal(athleteRating(null, 75), 75, 'csak terv-követés');
  assert.equal(
    athleteAlert({ missed: 0, daysSinceWorkout: 1, readiness: null, daysSinceCheckin: 0 }),
    null,
    'a null nem „készenlét 0%"',
  );

  const card = buildAthleteCard({
    athlete: { linkId: 9, username: 'adatlan', name: 'Adat Nélkül', goal: null },
    workouts: [],
    plans: [],
    checkins: [],
    weightLog: [],
    readiness: null,
    confidence: 'low',
    streak: 0,
    lastMessage: null,
    today: TODAY,
  });
  assert.equal(card.readiness, null);
  assert.equal(card.rating, null);
  assert.equal(card.alert, null);
});

test('a riasztás a súlyosabb okokat mondja, legfeljebb kettőt', () => {
  const alert = athleteAlert({
    missed: 3,
    daysSinceWorkout: 9,
    readiness: 40,
    daysSinceCheckin: 10,
    activeDays: 30,
  });
  assert.equal(alert, '3 kihagyott edzés · 9 napja nem edzett', 'a két legsúlyosabb ok');

  assert.equal(
    athleteAlert({
      missed: 0,
      daysSinceWorkout: 1,
      readiness: 58,
      daysSinceCheckin: 0,
      activeDays: 30,
    }),
    'készenlét 58%',
  );
  assert.equal(
    athleteAlert({
      missed: 1,
      daysSinceWorkout: 2,
      readiness: 88,
      daysSinceCheckin: 5,
      activeDays: 30,
    }),
    'check-in 5 napja hiányzik',
    'egy kihagyott edzés még nem riasztás',
  );
  assert.equal(
    athleteAlert({
      missed: 0,
      daysSinceWorkout: 1,
      readiness: 90,
      daysSinceCheckin: 1,
      activeDays: 30,
    }),
    null,
    'minden rendben → nincs sor',
  );
});

test('a hiányzó adat csak akkor riasztás, ha lett volna ideje meglenni', () => {
  // Ma csatlakozott, ma naplózott egy edzést: még nincs check-inje — ez nem hiba
  const fresh = athleteAlert({
    missed: 0,
    daysSinceWorkout: 0,
    readiness: 100,
    daysSinceCheckin: null,
    activeDays: 0,
  });
  assert.equal(fresh, null, 'aki most kezdett, nem „lemaradt"');

  // Egy hete használja, de check-int még egyet sem töltött ki
  const stale = athleteAlert({
    missed: 0,
    daysSinceWorkout: 1,
    readiness: 100,
    daysSinceCheckin: null,
    activeDays: 7,
  });
  assert.equal(stale, 'nincs kitöltött check-in');

  // Check-inezik, de edzést nem naplóz
  const noWorkouts = athleteAlert({
    missed: 0,
    daysSinceWorkout: null,
    readiness: 100,
    daysSinceCheckin: 0,
    activeDays: 3,
  });
  assert.equal(noWorkouts, 'még nincs naplózott edzés');

  // Teljesen üres fiók: semmiről nem állítunk semmit
  assert.equal(
    athleteAlert({
      missed: 0,
      daysSinceWorkout: null,
      readiness: 100,
      daysSinceCheckin: null,
      activeDays: 0,
    }),
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
  assert.ok(
    list.some((entry) => entry === 'Új PR: Guggolás 140 kg — tegnap'),
    'a PR a legnehezebb szettel',
  );
  assert.ok(list.some((entry) => entry === 'Erőnap · 2 munkasorozat — tegnap'));
  assert.ok(list.some((entry) => entry === 'Testsúly rögzítve: 82,4 kg — 3 napja'));
});

test('a bemelegítő szett nem munkasorozat', () => {
  const [entry] = recentActivity({
    workouts: [
      workout(daysAgo(0), 'Nap', [
        { done: true, type: 'warmup', weight: '40' },
        { done: true, type: 'work', weight: '100' },
        { done: false, type: 'work', weight: '110' },
      ]),
    ],
    checkins: [],
    weightLog: [],
    today: TODAY,
  });
  assert.equal(entry, 'Nap · 1 munkasorozat — ma');
});

test('a kardió nem munkasorozat, hanem perc — a futóedzés sem „0 munkasorozat"', () => {
  const futas = {
    date: daysAgo(0),
    name: 'Futás',
    exercises: [
      {
        name: 'Futópad',
        logMode: 'duration',
        sets: [{ duration: '2700', intensity: 'high', done: true }],
      },
    ],
  };
  const vegyes = {
    date: daysAgo(1),
    name: 'Láb',
    exercises: [
      { name: 'Guggolás', sets: [{ done: true, type: 'work', weight: '100' }] },
      {
        name: 'Szobabicikli',
        logMode: 'duration',
        sets: [{ duration: '600', intensity: 'low', done: true }],
      },
      {
        name: 'Evezőgép',
        logMode: 'duration',
        sets: [{ duration: '900', intensity: 'low', done: false }],
      },
    ],
  };
  const list = recentActivity({
    workouts: [futas, vegyes],
    checkins: [],
    weightLog: [],
    today: TODAY,
  });
  assert.deepEqual(list, [
    'Futás · 45 perc kardió — ma',
    'Láb · 1 munkasorozat · 10 perc kardió — tegnap',
  ]);
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
    card.alert,
    /62 napja nem edzett/,
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
