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
 *   - TERV-KÖVETÉS (adherence): a tervekben hétnapokra ütemezett edzésekhez
 *     képest hány edzésnap valósult meg az elmúlt 4 hétben. Terv nélkül nincs
 *     mihez mérni — ilyenkor null, és a felület „—"-t ír ki (nem 0%-ot: az
 *     azt hazudná, hogy elmaradt valami).
 *   - ÖSSZPONTSZÁM (rating): a készenlét és a terv-követés átlaga; terv nélkül
 *     maga a készenlét. Ebből jön a kártya szintje (arany/ezüst/bronz).
 */
import { parseDate, dayKey, DAY_MS } from './recovery.js';

/** A terv-követés ablaka: 4 teljes hét, a MAI napot nem beleszámítva — a ma
    még hátralévő edzés nem számítható elmaradásnak. */
const WINDOW_DAYS = 28;

/** Ennyi legutóbbi eseményt mutat a részletmodál „Legutóbbi aktivitás" listája. */
const ACTIVITY_LIMIT = 4;

/* ---- Küszöbök a figyelmeztetésekhez ---- */
const LOW_READINESS = 65;      // ez alatt a készenlét már riasztás
const MISSED_LIMIT = 2;        // ennyi kihagyott edzéstől jelzünk a héten
const STALE_CHECKIN_DAYS = 4;  // ennyi napja nincs check-in → jelzés
const INACTIVE_DAYS = 7;       // ennyi napja nem edzett → jelzés

/** "ma" / "tegnap" / "N napja" — a jövőbeli dátum is „ma"-ként jelenik meg
    (elgépelt dátumnál ez kevésbé zavaró, mint egy negatív szám). */
export function relativeDay(dateStr, todayKey) {
  const key = dayKey(dateStr);
  if (!Number.isFinite(key)) return null;
  const diff = Math.round((todayKey - key) / DAY_MS);
  if (diff <= 0) return 'ma';
  if (diff === 1) return 'tegnap';
  return `${diff} napja`;
}

/** A hétnap indexe hétfőtől számolva (0 = hétfő … 6 = vasárnap). */
const weekdayOf = (dateStr) => (parseDate(dateStr).getDay() + 6) % 7;

/** Azok a naptári napok (éjfélre normalizált timestamp), amikor volt edzés. */
const trainingDayKeys = (workouts) => new Set(workouts.map((w) => dayKey(w.date)));

/** A tervekben ütemezett hétnapok uniója. Több terv is szólhat ugyanarra a
    napra — egy nap akkor is EGY edzésnap, ezért halmaz. */
const scheduledWeekdays = (plans) => new Set(plans.flatMap((plan) => plan.days ?? []));

/** Teljesített munkasorozatok száma egy edzésben (a bemelegítő nem az). */
const workSetCount = (workout) => workout.exercises
  .flatMap((exercise) => exercise.sets ?? [])
  .filter((set) => set.done && set.type !== 'warmup').length;

/**
 * A HETI állás: hány edzésnap valósult meg hétfőtől máig, mennyi volt kitűzve,
 * és hány ütemezett nap maradt ki a héten (a mai nap még nem elmaradás).
 */
export function weekProgress({ workouts, plans, today }) {
  const todayKey = dayKey(today);
  const weekday = weekdayOf(today);
  const monday = todayKey - weekday * DAY_MS;
  const trained = trainingDayKeys(workouts);
  const scheduled = scheduledWeekdays(plans);

  let done = 0;
  for (let i = 0; i <= weekday; i += 1) {
    if (trained.has(monday + i * DAY_MS)) done += 1;
  }

  let missed = 0;
  for (const day of scheduled) {
    if (day < weekday && !trained.has(monday + day * DAY_MS)) missed += 1;
  }

  return { done, target: scheduled.size, missed };
}

/**
 * Terv-követés az elmúlt 4 hétre: a lezárt napok közül hány ütemezett nap volt,
 * és azokhoz képest hány edzésnap valósult meg. Terv (ütemezett hétnap) nélkül
 * null — nincs mihez mérni.
 *
 * Az edzésnapokat NEM párosítjuk a konkrét ütemezett naphoz: aki kedd helyett
 * szerdán edz, ugyanúgy megcsinálta a heti adagját. Ezért a hányados a
 * megvalósult edzésnapok / ütemezett napok, 100%-on tetőzve.
 */
export function adherence({ workouts, plans, today }) {
  const scheduled = scheduledWeekdays(plans);
  if (scheduled.size === 0) return null;

  const todayKey = dayKey(today);
  const trained = trainingDayKeys(workouts);
  let planned = 0;
  let done = 0;

  // Tegnaptól visszafelé 28 nap — a mai nap szándékosan kimarad.
  for (let back = 1; back <= WINDOW_DAYS; back += 1) {
    const key = todayKey - back * DAY_MS;
    if (scheduled.has((new Date(key).getDay() + 6) % 7)) planned += 1;
    if (trained.has(key)) done += 1;
  }

  if (planned === 0) return null;
  return Math.min(100, Math.round((done / planned) * 100));
}

/** Az összpontszám: a készenlét és a terv-követés átlaga (terv nélkül maga a
    készenlét). A kártya szintje (arany/ezüst/bronz) ebből jön a felületen. */
export const athleteRating = (readiness, adherenceValue) => (adherenceValue === null
  ? Math.round(readiness)
  : Math.round((readiness + adherenceValue) / 2));

/**
 * A kártya állapot-sora. Legfeljebb KÉT ok kerül bele, súlyosság szerint:
 * a kihagyott edzés a legbeszédesebb, utána a teljes leállás, a gyenge
 * készenlét, végül a hiányzó check-in. Ha nincs ok, null — ilyenkor a
 * felület „minden rendben"-t mutat.
 */
export function athleteAlert({ missed, daysSinceWorkout, readiness, daysSinceCheckin, hasHistory }) {
  const reasons = [];
  if (missed >= MISSED_LIMIT) reasons.push(`${missed} kihagyott edzés`);
  if (daysSinceWorkout === null) {
    // Csak akkor jelezzük, ha egyáltalán van már miből következtetni:
    // a frissen csatlakozott sportolónak még nincs naplója.
    if (hasHistory) reasons.push('még nincs naplózott edzés');
  } else if (daysSinceWorkout >= INACTIVE_DAYS) {
    reasons.push(`${daysSinceWorkout} napja nem edzett`);
  }
  if (readiness < LOW_READINESS) reasons.push(`készenlét ${Math.round(readiness)}%`);
  if (daysSinceCheckin === null) {
    if (hasHistory) reasons.push('nincs kitöltött check-in');
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
    const sets = workSetCount(workout);
    add(workout.date, `${workout.name} · ${sets} munkasorozat`);
    for (const exercise of workout.exercises) {
      if (!exercise.pr) continue;
      const best = (exercise.sets ?? [])
        .filter((set) => set.done)
        .reduce((a, b) => (Number(b.weight) > Number(a?.weight ?? -Infinity) ? b : a), null);
      add(workout.date, `Új PR: ${exercise.name}${best ? ` ${best.weight} kg` : ''}`);
    }
  }
  for (const checkin of checkins) add(checkin.date, 'Regenerációs check-in kitöltve');
  for (const entry of weightLog) add(entry.date, `Testsúly rögzítve: ${entry.kg} kg`);

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
 * @param {number} input.readiness a készenléti riport `overall` értéke (0–100)
 * @param {number} input.streak    az edzés-sorozat hossza napokban
 * @param {object} input.lastMessage a szál utolsó üzenete (vagy null)
 * @param {string} input.today     a mai nap "ÉÉÉÉ.HH.NN" alakban
 */
export function buildAthleteCard({
  athlete, workouts, plans, checkins, weightLog, readiness, streak, lastMessage, today,
}) {
  const todayKey = dayKey(today);
  const week = weekProgress({ workouts, plans, today });
  const adherenceValue = adherence({ workouts, plans, today });

  // A getWorkouts()/getCheckins() legújabb elöl ad vissza — a lista eleje a
  // legutóbbi esemény.
  const lastWorkout = workouts[0] ?? null;
  const lastCheckin = checkins[0] ?? null;
  const daysSince = (dateStr) => (dateStr
    ? Math.max(0, Math.round((todayKey - dayKey(dateStr)) / DAY_MS))
    : null);

  return {
    linkId: athlete.linkId,
    username: athlete.username,
    name: athlete.name,
    goal: athlete.goal ?? null,
    readiness: Math.round(readiness),
    adherence: adherenceValue,
    rating: athleteRating(readiness, adherenceValue),
    streak,
    lastWorkout: lastWorkout ? relativeDay(lastWorkout.date, todayKey) : null,
    // "3/4", terv nélkül "3/–" — a felület egy az egyben kiírja
    weekly: `${week.done}/${week.target || '–'}`,
    // Aktív terv: amelyik a MAI hétnapra szól, különben a legutóbb készített
    // (a getUserPlans legújabb elöl ad vissza).
    plan: (plans.find((plan) => (plan.days ?? []).includes(weekdayOf(today))) ?? plans[0])?.name ?? null,
    alert: athleteAlert({
      missed: week.missed,
      daysSinceWorkout: daysSince(lastWorkout?.date),
      readiness,
      daysSinceCheckin: daysSince(lastCheckin?.date),
      hasHistory: workouts.length > 0 || checkins.length > 0,
    }),
    recent: recentActivity({ workouts, checkins, weightLog, today }),
    lastMessage: lastMessage
      ? { text: lastMessage.text, at: lastMessage.at, from: lastMessage.author }
      : null,
  };
}
