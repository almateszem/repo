/**
 * FitTrack Pro — az edzői panel sportoló-összegzője
 * -------------------------------------------------
 * Ez a modul VÁLASZOLJA MEG azt a kérdést, amit korábban a data.js beégetett
 * demo-listája játszott el: „hogy áll a sportolóm?". A bemenete a sportoló
 * SAJÁT, naplózott adata (edzések, tervek, check-inek, testsúly) és a rá
 * lefuttatott készenléti riport — a kimenete a kártyán és a részletmodálban
 * megjelenő összegzés.
 *
 * A recovery.js-hez hasonlóan NEM ismeri sem az adatbázist, sem az Expresst:
 * tiszta függvények, tehát külön tesztelhető (server/coaching.test.js), és a
 * végpont dolga marad eldönteni, KI kérdez és KIRŐL (server.js).
 *
 * Két fogalom, amit érdemes egy helyen kimondani:
 *   - TERV-KÖVETÉS (adherence): azt csinálta-e a sportoló, amit az EDZŐ
 *     kiosztott — a kijelölt napon, annyi munkasorozattal és olyan RPE-vel.
 *     Az elmúlt 4 hét minden ütemezett napja egy pont: 0, ha aznap nem
 *     indított edzést abból a tervből (más napon pótolva sem számít), különben
 *     a szett- és az RPE-egyezés átlaga. Csak a terv elfogadása óta mér, és
 *     csak az edző által kiosztott tervre (a sportoló saját terve nem mérce).
 *     Kiosztott terv nélkül null, és a felület „—"-t ír ki (nem 0%-ot: az azt
 *     hazudná, hogy elmaradt valami). Mellette a trend (utolsó 2 hét az
 *     előző 2-höz), a bontás (jó nap / szett / RPE) és a tervből indított
 *     edzések aránya.
 *   - ÖSSZPONTSZÁM (rating): a készenlét és a terv-követés átlaga; terv nélkül
 *     maga a készenlét. Ebből jön a kártya szintje (arany/ezüst/bronz).
 */
import { parseDate, dayKey, daysBetween, formatDecimal, shiftDayKey } from './recovery.js';
import { dayEntry } from './plan-week.js';

/** A terv-követés ablaka: 4 teljes hét, a MAI napot nem beleszámítva — a ma
    még hátralévő edzés nem számítható elmaradásnak. */
const WINDOW_DAYS = 28;

/** Ennyi legutóbbi eseményt mutat a részletmodál „Legutóbbi aktivitás" listája. */
const ACTIVITY_LIMIT = 4;

/* ---- Küszöbök a figyelmeztetésekhez ---- */
const LOW_READINESS = 65; // ez alatt a készenlét már riasztás
const MISSED_LIMIT = 2; // ennyi kihagyott edzéstől jelzünk a héten
const STALE_CHECKIN_DAYS = 4; // ennyi napja nincs check-in → jelzés
const INACTIVE_DAYS = 7; // ennyi napja nem edzett → jelzés
const TREND_DROP_LIMIT = -25; // ennyi pontos esés két hét alatt → jelzés

/** "ma" / "tegnap" / "N napja" — a jövőbeli dátum is „ma"-ként jelenik meg
    (elgépelt dátumnál ez kevésbé zavaró, mint egy negatív szám). */
export function relativeDay(dateStr, todayKey) {
  const key = dayKey(dateStr);
  if (!Number.isFinite(key)) return null;
  const diff = daysBetween(key, todayKey);
  if (diff <= 0) return 'ma';
  if (diff === 1) return 'tegnap';
  return `${diff} napja`;
}

/** Hány napja edzel megszakítás nélkül, puszta NAPOKBÓL. A mai naptól számol
    visszafelé; ha ma még nem volt edzés, tegnaptól — így a sorozat nem törik
    meg attól, hogy a mai edzés még előtted áll. Az edzői panel a teljes
    előzmény napjaiból hívja (getWorkoutDates), a profil és az áttekintő a
    mentett edzésekéből (server.js → trainingStreak).

    Tiszta függvény, ezért él itt és nem a server.js-ben: így tesztelhető
    (dst.test.js). Naptári lépés (shiftDayKey), nem 24 órás: az
    óraátállításnál a 24 órás lépés nem éjfélre esett, és a sorozat ott
    megszakadt. */
export function streakFromDates(dates, today) {
  const trainedDays = new Set(dates.map(dayKey));
  const todayKey = dayKey(today);

  let streak = 0;
  let cursor = trainedDays.has(todayKey) ? todayKey : shiftDayKey(todayKey, -1);
  while (trainedDays.has(cursor)) {
    streak += 1;
    cursor = shiftDayKey(cursor, -1);
  }
  return streak;
}

/** A hétnap indexe hétfőtől számolva (0 = hétfő … 6 = vasárnap). */
const weekdayOf = (dateStr) => (parseDate(dateStr).getDay() + 6) % 7;

/** Azok a naptári napok (éjfélre normalizált timestamp), amikor volt edzés. */
const trainingDayKeys = (workouts) => new Set(workouts.map((w) => dayKey(w.date)));

/** A tervekben ütemezett hétnapok uniója. Több terv is szólhat ugyanarra a
    napra — egy nap akkor is EGY edzésnap, ezért halmaz. */
const scheduledWeekdays = (plans) => new Set(plans.flatMap((plan) => plan.days ?? []));

/** A terv kezdőnapja (timestamp), vagy -Infinity, ha nincs dátuma — a dátum
    nélküli terv „mindig is élt" (régi hívók, tesztek). */
const planStart = (plan) => {
  const key = plan.date ? dayKey(plan.date) : NaN;
  return Number.isFinite(key) ? key : -Infinity;
};

/** Az adott NAPON már élő tervek ütemezett hétnapjai. A terv létrehozása
    (kiosztott tervnél az elfogadása) előtti napokon nem volt mit követni —
    enélkül a friss tervet kapott sportoló igazságtalanul alacsony %-ot kapna. */
const scheduledOn = (plans, key) =>
  scheduledWeekdays(plans.filter((plan) => planStart(plan) <= key));

/** Munkasorozatok egy gyakorlat-listában. A bemelegítő nem az, és az időalapú
    (kardió) sor sem — ugyanaz a szabály, mint a server.js isWorkSet-jében. */
const workSets = (exercises) =>
  (exercises ?? [])
    .flatMap((exercise) => exercise.sets ?? [])
    .filter((set) => set.type !== 'warmup' && set.duration === undefined);

/** Teljesített munkasorozatok száma egy edzésben. */
const workSetCount = (workout) => workSets(workout.exercises).filter((set) => set.done).length;

/** Teljesített időalapú (kardió) sorok összideje egy edzésben, egész percre. */
const cardioMinutes = (workout) =>
  Math.round(
    workout.exercises
      .flatMap((exercise) => exercise.sets ?? [])
      .filter((set) => set.done && set.duration !== undefined)
      .reduce((total, set) => total + (Number(set.duration) || 0), 0) / 60,
  );

/**
 * A HETI állás: hány edzésnap valósult meg hétfőtől máig, mennyi volt kitűzve,
 * és hány ütemezett nap maradt ki a héten (a mai nap még nem elmaradás).
 */
export function weekProgress({ workouts, plans, today }) {
  const todayKey = dayKey(today);
  const weekday = weekdayOf(today);
  const monday = shiftDayKey(todayKey, -weekday);
  const trained = trainingDayKeys(workouts);
  const scheduled = scheduledWeekdays(plans);

  let done = 0;
  for (let i = 0; i <= weekday; i += 1) {
    if (trained.has(shiftDayKey(monday, i))) done += 1;
  }

  // A terv kezdete előtti nap nem elmaradás — a héten később kapott terv sem
  let missed = 0;
  for (let day = 0; day < weekday; day += 1) {
    const key = shiftDayKey(monday, day);
    if (scheduledOn(plans, key).has(day) && !trained.has(key)) missed += 1;
  }

  return { done, target: scheduled.size, missed };
}

/* ---- Terv-követés: nap, szett, RPE ---- */

/** Munkaegységek egy gyakorlatban: a munkasorozatok (bemelegítő nélkül) és a
    kardió-sorok. A kardió-sornak nincs típusa, tehát a szűrőn átmegy — egy
    tervezett futás elmaradása ugyanúgy hiány, mint egy elmaradt szetté. */
const workUnits = (exercise) => (exercise?.sets ?? []).filter((set) => set.type !== 'warmup');

/** Az RPE-vel mérhető munkasorozatok (a kardió-sornak nincs RPE-je). */
const rpeSets = (exercise) => workUnits(exercise).filter((set) => set.duration === undefined);

/** Szám az RPE-mezőből, vagy null (üres / nem szám). */
const rpeOf = (set) => {
  const value = Number.parseFloat(String(set?.rpe ?? '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
};

/** Mennyire egyezik a naplózott RPE a tervezettel (0–1): ±0,5 még pontos
    (a skála fél fokozatú), ±2-től már semmi, köztük egyenletesen csökken. */
export const rpeMatch = (target, actual) => {
  const diff = Math.abs(target - actual);
  if (diff <= 0.5) return 1;
  if (diff >= 2) return 0;
  return (2 - diff) / 1.5;
};

/**
 * Egy tervből indított edzés a tervhez mérve: `sets` — a tervezett
 * munkaegységekből mennyi készült el (gyakorlatonként legfeljebb a tervezett,
 * tehát a plusz szett nem pótolja a kihagyott gyakorlatot); `rpe` — az
 * elvégzett munkasorozatok RPE-egyezésének átlaga, vagy null, ha nincs mit
 * összevetni (a tervben vagy a naplóban nincs RPE).
 *
 * A gyakorlatokat NÉV szerint párosítjuk (azonos névből az első még szabad),
 * a szetteket gyakorlaton belül SORREND szerint.
 */
export function planDayScore(planExercises, workout) {
  const pool = [...(workout.exercises ?? [])];
  let target = 0;
  let done = 0;
  let rpeSum = 0;
  let rpeCount = 0;

  for (const planned of planExercises ?? []) {
    const units = workUnits(planned).length;
    target += units;
    const index = pool.findIndex((exercise) => exercise?.name === planned.name);
    if (index === -1) continue;
    const [actual] = pool.splice(index, 1);

    done += Math.min(workUnits(actual).filter((set) => set.done).length, units);

    const actualSets = rpeSets(actual);
    rpeSets(planned).forEach((plannedSet, i) => {
      const goal = rpeOf(plannedSet);
      const logged = actualSets[i]?.done ? rpeOf(actualSets[i]) : null;
      if (goal === null || logged === null) return;
      rpeSum += rpeMatch(goal, logged);
      rpeCount += 1;
    });
  }

  return {
    // Munkaegység nélküli terv: nincs mit kihagyni
    sets: target === 0 ? 1 : done / target,
    rpe: rpeCount === 0 ? null : rpeSum / rpeCount,
  };
}

/** Egy nap pontja a két összetevőből; RPE nélkül maga a szett-arány. */
const dayScore = ({ sets, rpe }) => (rpe === null ? sets : (sets + rpe) / 2);

/**
 * A terv-követés nyers összesítése egy ablakra. Minden (kiosztott terv,
 * ütemezett nap) pár egy tervezett nap — két terv ugyanarra a napra két
 * feladat. A `from`/`to` az ablak (hány nappal ezelőtt kezdődik és végződik,
 * a mai nap = 0) — a trend két félablakot kér.
 */
function evaluatePlans({ workouts, plans, today, from = 1, to = WINDOW_DAYS }) {
  const todayKey = dayKey(today);
  // Tervből indított edzések napok szerint
  const byDay = new Map();
  for (const workout of workouts) {
    if (workout.planId == null) continue;
    const key = dayKey(workout.date);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(workout);
  }

  const result = { planned: 0, onDay: 0, score: 0, sets: 0, rpeSum: 0, rpeCount: 0 };

  // Tegnaptól visszafelé — a mai nap szándékosan kimarad (a mai edzés még
  // hátravan). Naptári lépéssel (shiftDayKey), nem 24 órással: az
  // óraátállításon túli napok különben egyetlen edzésnappal sem egyeztek.
  for (let back = from; back <= to; back += 1) {
    const key = shiftDayKey(todayKey, -back);
    const weekday = (new Date(key).getDay() + 6) % 7;
    for (const plan of plans) {
      // A terv elfogadása előtti napokon nem volt mit követni, pihenőnapon sem
      if (planStart(plan) > key) continue;
      const entry = dayEntry(plan.week, weekday);
      if (!entry) continue;
      result.planned += 1;

      // Csak a kijelölt napon, ebből a tervből indított edzés számít — és
      // AZNAPI edzéshez mérve (a hétfő a hétfői, a szerda a szerdai listához)
      const best = (byDay.get(key) ?? [])
        .filter((workout) => workout.planId === plan.id)
        .map((workout) => planDayScore(entry.exercises, workout))
        .reduce((a, b) => (a && dayScore(a) >= dayScore(b) ? a : b), null);
      if (!best) continue;

      result.onDay += 1;
      result.score += dayScore(best);
      result.sets += best.sets;
      if (best.rpe !== null) {
        result.rpeSum += best.rpe;
        result.rpeCount += 1;
      }
    }
  }
  return result;
}

/**
 * Terv-követés az elmúlt 4 hétre (%, 0–100): az ütemezett napok pontjainak
 * átlaga. Egy nap 0, ha aznap nem indított edzést a tervből, különben a
 * szett- és az RPE-egyezés átlaga. A `plans` az EDZŐ által kiosztott tervek
 * ({ id, date, week } — ld. db.js → getAssignedPlanTargets).
 * Kiosztott terv vagy az ablakba eső ütemezett nap nélkül null.
 */
export function adherence({ workouts, plans, today, from = 1, to = WINDOW_DAYS }) {
  const { planned, score } = evaluatePlans({ workouts, plans, today, from, to });
  if (planned === 0) return null;
  return Math.round((score / planned) * 100);
}

/** A terv-követés bontása a részletnézetnek: hány ütemezett napon edzett a
    kijelölt napon ("9/12"), és azokon átlagosan mennyi szettet csinált meg,
    mennyire talált az RPE (%, vagy null, ha nincs mit mérni). */
export function adherenceBreakdown({ workouts, plans, today }) {
  const r = evaluatePlans({ workouts, plans, today });
  if (r.planned === 0) return null;
  return {
    onDay: `${r.onDay}/${r.planned}`,
    sets: r.onDay === 0 ? null : Math.round((r.sets / r.onDay) * 100),
    rpe: r.rpeCount === 0 ? null : Math.round((r.rpeSum / r.rpeCount) * 100),
  };
}

/** A trend fele: ennyi napos félablakokat hasonlítunk össze. */
const TREND_DAYS = WINDOW_DAYS / 2;

/** A terv-követés iránya pontban: az utolsó 2 hét mínusz az előző 2 hét.
    Negatív = romlik. Ha valamelyik félben nincs mihez mérni (pl. a terv csak
    egy hete él), null — egy félből nincs irány. */
export function adherenceTrend({ workouts, plans, today }) {
  const recent = adherence({ workouts, plans, today, from: 1, to: TREND_DAYS });
  const previous = adherence({
    workouts,
    plans,
    today,
    from: TREND_DAYS + 1,
    to: WINDOW_DAYS,
  });
  return recent === null || previous === null ? null : recent - previous;
}

/** Az ablakba eső (a mai nappal együtt) edzések. */
const workoutsInWindow = (workouts, today) => {
  const oldest = shiftDayKey(dayKey(today), -WINDOW_DAYS);
  return workouts.filter((workout) => dayKey(workout.date) >= oldest);
};

/** Hány edzés indult TERVBŐL az elmúlt 4 hétben, az összes közül. A terv-
    követés napokat számol, és bármilyen naplózott edzést elfogad — ez mutatja
    meg, mennyi volt ebből ténylegesen a terv szerinti munka. Edzés nélkül null. */
export function planWorkouts({ workouts, today }) {
  const inWindow = workoutsInWindow(workouts, today);
  if (inWindow.length === 0) return null;
  const fromPlan = inWindow.filter((workout) => workout.planId != null).length;
  return { fromPlan, total: inWindow.length };
}

/** Az összpontszám: a készenlét és a terv-követés átlaga (terv nélkül maga a
    készenlét, készenlét nélkül maga a terv-követés). A kártya szintje
    (arany/ezüst/bronz) ebből jön a felületen.

    A készenlét lehet null (a motor nem tud mit mondani: nincs check-in, edzés
    és mérhető táplálkozás). Ez NEM nulla — korábban a Math.round(null) 0-t
    adott, és a kártya „0 pont, bronz" mellé „készenlét 0%" riasztást tett.
    Ha egyik jel sincs, a pontszám is null. */
export const athleteRating = (readiness, adherenceValue) => {
  if (readiness === null || readiness === undefined) {
    return adherenceValue === null ? null : Math.round(adherenceValue);
  }
  return adherenceValue === null
    ? Math.round(readiness)
    : Math.round((readiness + adherenceValue) / 2);
};

/**
 * A kártya állapot-sora. Legfeljebb KÉT ok kerül bele, súlyosság szerint:
 * a kihagyott edzés a legbeszédesebb, utána az eső terv-követés, a teljes
 * leállás, a gyenge készenlét, végül a hiányzó check-in. Ha nincs ok, null — ilyenkor a
 * felület „minden rendben"-t mutat.
 *
 * A HIÁNYZÓ adat csak akkor riasztás, ha már lett volna ideje meglenni: az
 * `activeDays` (hány napja van egyáltalán naplózott adata) ezt méri. Enélkül
 * minden frissen csatlakozott sportoló azonnal pirosra váltana, pedig épp
 * csak most kezdett — az edző meg megtanulná figyelmen kívül hagyni a sávot.
 */
export function athleteAlert({
  missed,
  daysSinceWorkout,
  readiness,
  daysSinceCheckin,
  activeDays = 0,
  adherenceTrend = null,
}) {
  const reasons = [];
  if (missed >= MISSED_LIMIT) reasons.push(`${missed} kihagyott edzés`);
  // A lemorzsolódás korai jele: a heti kihagyás még nem, a két hét már látszik
  if (adherenceTrend !== null && adherenceTrend <= TREND_DROP_LIMIT) {
    reasons.push(`terv-követés esik (${adherenceTrend})`);
  }
  if (daysSinceWorkout === null) {
    // Használja az appot (van check-inje), de edzést még egyet sem naplózott
    if (activeDays >= 1) reasons.push('még nincs naplózott edzés');
  } else if (daysSinceWorkout >= INACTIVE_DAYS) {
    reasons.push(`${daysSinceWorkout} napja nem edzett`);
  }
  // A hiányzó készenlét nem alacsony készenlét — arról a check-in sor szól
  if (readiness !== null && readiness !== undefined && readiness < LOW_READINESS) {
    reasons.push(`készenlét ${Math.round(readiness)}%`);
  }
  if (daysSinceCheckin === null) {
    if (activeDays >= STALE_CHECKIN_DAYS) reasons.push('nincs kitöltött check-in');
  } else if (daysSinceCheckin >= STALE_CHECKIN_DAYS) {
    reasons.push(`check-in ${daysSinceCheckin} napja hiányzik`);
  }

  return reasons.length ? reasons.slice(0, 2).join(' · ') : null;
}

/**
 * A „Legutóbbi aktivitás" lista: a sportoló naplóiból összefésült események,
 * legújabb elöl. Szándékosan összegző mondatok — az edző a haladást nézi,
 * nem a nyers sorokat.
 */
export function recentActivity({ workouts, checkins, weightLog, today }) {
  const todayKey = dayKey(today);
  const events = [];
  const add = (dateStr, text) => {
    const key = dayKey(dateStr);
    if (Number.isFinite(key)) events.push({ key, text, when: relativeDay(dateStr, todayKey) });
  };

  for (const workout of workouts) {
    /* A kardió nem munkasorozat, ezért külön, percben szerepel. Enélkül egy
       futóedzés „0 munkasorozat"-ként jelenne meg az edzőnél, mintha semmit
       nem csinált volna a sportoló. */
    const sets = workSetCount(workout);
    const minutes = cardioMinutes(workout);
    const parts = [];
    if (sets > 0 || minutes === 0) parts.push(`${sets} munkasorozat`);
    if (minutes > 0) parts.push(`${minutes} perc kardió`);
    add(workout.date, [workout.name, ...parts].join(' · '));
    for (const exercise of workout.exercises) {
      if (!exercise.pr) continue;
      const best = (exercise.sets ?? [])
        .filter((set) => set.done)
        .reduce((a, b) => (Number(b.weight) > Number(a?.weight ?? -Infinity) ? b : a), null);
      add(
        workout.date,
        `Új PR: ${exercise.name}${best ? ` ${formatDecimal(best.weight)} kg` : ''}`,
      );
    }
  }
  for (const checkin of checkins) add(checkin.date, 'Regenerációs check-in kitöltve');
  for (const entry of weightLog) {
    add(entry.date, `Testsúly rögzítve: ${formatDecimal(entry.kg)} kg`);
  }

  return events
    .sort((a, b) => b.key - a.key)
    .slice(0, ACTIVITY_LIMIT)
    .map((event) => `${event.text} — ${event.when}`);
}

/**
 * A sportoló-kártya teljes tartalma. A hívó (server.js) gyűjti össze a
 * bemenetet az adatrétegből; itt csak számolunk.
 *
 * @param {object} input.athlete   { linkId, username, name, goal } — a kapcsolat másik oldala
 * @param {string[]} [input.workoutDates] MINDEN edzésnap, legújabb elöl. Akkor
 *                                 kell, ha a `workouts` ablakozott — enélkül az
 *                                 abból képződik (ld. lentebb)
 * @param {object[]} [input.assignedPlans] az EDZŐ kiosztott tervei az ő példányában
 *                                 ({ id, date, week }) — a terv-követés mércéje
 * @param {number} input.readiness a készenléti riport `overall` értéke (0–100)
 * @param {string} input.confidence a riport `confidence` mezője ('low'|'medium'|'high')
 * @param {number} input.streak    az edzés-sorozat hossza napokban
 * @param {object} input.lastMessage a szál utolsó üzenete (vagy null); a `mine`
 *                                 mezőjét a hívó tölti ki — ő tudja, ki a néző
 * @param {number} input.unread    hány olvasatlan üzenet vár az EDZŐRE ebben a szálban
 * @param {string} input.today     a mai nap "ÉÉÉÉ.HH.NN" alakban
 */
export function buildAthleteCard({
  athlete,
  workouts,
  workoutDates = null,
  plans,
  assignedPlans = [],
  checkins,
  weightLog,
  readiness,
  confidence = null,
  streak,
  lastMessage,
  unread = 0,
  today,
}) {
  const todayKey = dayKey(today);
  const week = weekProgress({ workouts, plans, today });
  // A terv-követés mércéje az edző kiosztott terve, nem a sportoló összes terve
  const adherenceValue = adherence({ workouts, plans: assignedPlans, today });
  const trend = adherenceTrend({ workouts, plans: assignedPlans, today });
  const fromPlan = planWorkouts({ workouts, today });

  /* A `workouts` a hívónál ABLAKOZOTT lehet (a panel csak az utolsó néhány
     hét edzéseit olvassa be, mert a többit se a készenlét-motor, se a
     terv-követés nem használja). Ami viszont a teljes előzményből jön, az a
     `workoutDates`: az „utolsó edzés" tetszőlegesen régi lehet, és e nélkül
     egy két hónapja edzett sportolóra a kártya azt írná ki, hogy „még nincs
     naplózott edzés" — a legbeszédesebb riasztás helyett a legfélrevezetőbb.
     Ablakozatlan hívónál a kettő ugyanaz, ezért a lista alapból az edzésekből
     képződik. */
  const allDates = workoutDates ?? workouts.map((workout) => workout.date);
  const lastWorkoutDate = allDates[0] ?? null;
  const lastCheckin = checkins[0] ?? null;
  const daysSince = (dateStr) =>
    dateStr ? Math.max(0, daysBetween(dayKey(dateStr), todayKey)) : null;

  /* Mióta használja egyáltalán az appot: a legrégebbi naplózott nap (edzés
     vagy check-in) óta eltelt napok. A listák legújabbal kezdődnek, tehát a
     végük a legrégebbi elem. */
  const activeDays = Math.max(
    daysSince(allDates[allDates.length - 1]) ?? 0,
    daysSince(checkins[checkins.length - 1]?.date) ?? 0,
  );

  return {
    linkId: athlete.linkId,
    username: athlete.username,
    name: athlete.name,
    goal: athlete.goal ?? null,
    readiness: readiness === null || readiness === undefined ? null : Math.round(readiness),
    /* Mennyire megbízható a fenti szám. Ez NEM dísz: kevés naplónál a motor
       általános referenciával számol, és az edző a magas számot „arany
       szintnek" olvasná. A modál kiírja, hogy min alapul. */
    confidence,
    adherence: adherenceValue,
    // Pontban: az utolsó 2 hét mínusz az előző 2 hét (null, ha nincs mihez mérni)
    adherenceTrend: trend,
    // "6/9" — az elmúlt 4 hét edzéseiből hány indult tervből
    planWorkouts: fromPlan ? `${fromPlan.fromPlan}/${fromPlan.total}` : null,
    /* Van-e az edzőtől elfogadott terve. Az adherence ettől még lehet null
       (nem volt esedékes nap) — a felület ebből tudja, hogy nem „nincs terv". */
    hasAssignedPlan: assignedPlans.length > 0,
    // A terv-követés bontása: { onDay: "9/12", sets: %, rpe: % } vagy null
    adherenceDetail: adherenceBreakdown({ workouts, plans: assignedPlans, today }),
    rating: athleteRating(readiness, adherenceValue),
    streak,
    lastWorkout: lastWorkoutDate ? relativeDay(lastWorkoutDate, todayKey) : null,
    // "3/4", terv nélkül "3/–" — a felület egy az egyben kiírja
    weekly: `${week.done}/${week.target || '–'}`,
    // Aktív terv: amelyik a MAI hétnapra szól, különben a legutóbb készített
    // (a getUserPlans legújabb elöl ad vissza).
    plan:
      (plans.find((plan) => (plan.days ?? []).includes(weekdayOf(today))) ?? plans[0])?.name ??
      null,
    alert: athleteAlert({
      missed: week.missed,
      daysSinceWorkout: daysSince(lastWorkoutDate),
      readiness,
      daysSinceCheckin: daysSince(lastCheckin?.date),
      activeDays,
      adherenceTrend: trend,
    }),
    recent: recentActivity({ workouts, checkins, weightLog, today }),
    /* A szál utolsó üzenete a kártyán idézve. A `mine` a NÉZŐ (az edző)
       szemszöge — ki a néző, azt csak a végpont tudja, ezért a hívó jelöli
       meg (server.js); saját üzenetnél a felület „Te"-t ír a név helyére. */
    lastMessage: lastMessage
      ? {
          text: lastMessage.text,
          at: lastMessage.at,
          from: lastMessage.author,
          mine: lastMessage.mine === true,
        }
      : null,
    unread,
  };
}
