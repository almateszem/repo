/**
 * Podium — a ciklusos edzésterv
 * ---------------------------------------
 * Egy terv 1–14 napos CIKLUS, amely a végére érve elölről kezdődik. A napok
 * indexe a ciklusban elfoglalt hely (0 = első nap); a nevük a hét napjait
 * követi (Hétfő … Vasárnap), a második körben „(2.)" utótaggal. A 7 napos
 * terv így pontosan a megszokott heti terv. Minden nap a három közül egy:
 *
 *   { type: 'workout', name, exercises }  saját edzés (a név nem kötelező)
 *   { type: 'rest' }                      pihenőnap
 *   { type: 'same', of }                  ugyanaz, mint az `of` napi edzés
 *
 * A „same" csak EDZÉSNAPRA mutathat, láncban nem — a péntek = hétfő akkor is
 * egyértelmű marad, ha a hétfőt később átírják (a péntek vele változik).
 *
 * A ciklus horgonya az aktiválás (`activeSince`) hetének hétfője — így aki
 * szerdán aktivál, rögtön a szerdai napon áll, és a 7 napos terv mai napja a
 * mai hétnap. Hogy egy dátumon a ciklus melyik napja van: `cycleDay`.
 *
 * Tiszta függvények: a db.js, a server.js és a coaching.js is ezekből
 * dolgozik, és külön tesztelhetők (plan-week.test.js). A kliens a feloldást
 * (dayEntry, dayWorkoutName, cycleDay) a public/js/shared/plan-week.js-ben tükrözi.
 */
import { dayKey, daysBetween, parseDate, shiftDayKey } from './dates.js';

/** A terv hosszának határai (napban). */
export const MIN_DAYS = 1;
export const MAX_DAYS = 14;

/** A régi (hétnapos) terv hossza — a weekFromLegacy mindig egy hetet ad. */
const LEGACY_DAYS = 7;

/** A napok neve az edzés alapértelmezett nevéhez („Tervnév – Hétfő"). */
export const DAY_NAMES = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap'];

/** A kártya-leíráshoz: a napok rövid címkéje. */
const DAY_LABELS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

/** A második kör (8.–14. nap) utótagja. */
const roundSuffix = (day) => (day >= DAY_NAMES.length ? ' (2.)' : '');

/** A ciklus `day`-edik napjának neve: „Hétfő", a második körben „Hétfő (2.)". */
export const dayName = (day) => `${DAY_NAMES[day % DAY_NAMES.length]}${roundSuffix(day)}`;

/** A ciklus `day`-edik napjának rövid címkéje: „H", a második körben „H (2.)". */
export const dayLabel = (day) => `${DAY_LABELS[day % DAY_LABELS.length]}${roundSuffix(day)}`;

/** Egy „ÉÉÉÉ.HH.NN" nap hetének hétfője, nap-kulcsként. */
const mondayOf = (dateStr) =>
  shiftDayKey(dayKey(dateStr), -((parseDate(dateStr).getDay() + 6) % 7));

/** Tetszőleges hétfő — a horgony nélküli terv ciklusa ehhez igazodik (7
    napos tervnél bármely hétfő ugyanazt adja). */
const FALLBACK_MONDAY = '1970.01.05';

/** A ciklus horgonya (nap-kulcs): az aktiválás hetének hétfője; aktiválás
    nélkül a létrehozásé; dátum nélkül egy rögzített hétfő. */
const cycleAnchor = (plan) => mondayOf(plan?.activeSince || plan?.date || FALLBACK_MONDAY);

/** A ciklus napja egy nap-kulcson (`dayKey`): 0 … hossz−1. Naptári
    napokban számol (a daysBetween az óraátállítás ±1 óráját elnyeli), és a
    horgony előtti napra sem ad negatív indexet. */
export function cycleDayAt(plan, key) {
  const length = plan?.week?.length || LEGACY_DAYS;
  const offset = daysBetween(cycleAnchor(plan), key);
  return ((offset % length) + length) % length;
}

/** A ciklus napja egy „ÉÉÉÉ.HH.NN" dátumon. */
export const cycleDay = (plan, dateStr) => cycleDayAt(plan, dayKey(dateStr));

/** Egy edzésnap nevének felső korlátja. */
const DAY_NAME_MAX = 40;

const REST = Object.freeze({ type: 'rest' });

/**
 * A régi (egy gyakorlatlista + kijelölt hétnapok) terv heti alakja: az első
 * kijelölt nap kapja az edzést, a többi kijelölt nap „ugyanaz, mint az
 * első", a többi pihenő. Kijelölt nap nélkül az edzés hétfőre kerül — a régi
 * terv így is elindítható marad, és nem vész el belőle semmi.
 */
export function weekFromLegacy(exercises, days) {
  const scheduled = [...new Set((Array.isArray(days) ? days : []).map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day < LEGACY_DAYS)
    .sort((a, b) => a - b);
  const first = scheduled[0] ?? 0;
  return Array.from({ length: LEGACY_DAYS }, (_, day) => {
    if (day === first) return { type: 'workout', name: '', exercises: exercises ?? [] };
    return scheduled.includes(day) ? { type: 'same', of: first } : { ...REST };
  });
}

/**
 * A beküldött hét normalizálása. A `normalizeDayExercises(raw)` a hívóé (a
 * szerver gyakorlat-normalizálója): `{ exercises }`-t vagy `{ error }`-t ad.
 * Visszaad: `{ week }` vagy `{ error }` (→ 400-as válasz).
 *
 * Ismeretlen vagy hiányzó nap pihenő lesz — a hiányzó adat nem edzés.
 */
export function normalizeWeek(raw, normalizeDayExercises) {
  if (!Array.isArray(raw) || raw.length < MIN_DAYS || raw.length > MAX_DAYS) {
    return { error: `A tervnek ${MIN_DAYS}–${MAX_DAYS} napból kell állnia.` };
  }

  const week = [];
  for (const [day, entry] of raw.entries()) {
    if (entry?.type === 'workout') {
      const result = normalizeDayExercises(entry.exercises);
      if (result.error) return { error: `${dayName(day)}: ${result.error}` };
      const name = String(entry.name ?? '')
        .trim()
        .slice(0, DAY_NAME_MAX);
      week.push({ type: 'workout', name, exercises: result.exercises });
    } else if (entry?.type === 'same') {
      week.push({ type: 'same', of: Number(entry.of) });
    } else {
      week.push({ ...REST });
    }
  }

  // A „same" csak edzésnapra mutathat — láncra, pihenőre, önmagára nem
  for (const [day, entry] of week.entries()) {
    if (entry.type !== 'same') continue;
    if (!Number.isInteger(entry.of) || week[entry.of]?.type !== 'workout') {
      return { error: `${dayName(day)}: csak egy edzésnappal lehet azonos.` };
    }
  }

  if (!week.some((entry) => entry.type === 'workout')) {
    return { error: 'A tervben legalább egy edzésnapnak kell lennie.' };
  }
  return { week };
}

/** A nem pihenő napok (edzés vagy „same"), növekvő sorrendben. */
export const workoutDays = (week) =>
  (week ?? []).flatMap((entry, day) => (entry?.type === 'rest' || !entry ? [] : [day]));

/**
 * Egy nap feloldva: `{ weekday, sourceDay, name, exercises }`, ahol a
 * `sourceDay` az a nap, amelyiknek az edzése valójában fut (a „same" nap a
 * hivatkozottét). Pihenőnapon (vagy ismeretlen napon) null.
 */
export function dayEntry(week, weekday) {
  const entry = week?.[weekday];
  if (!entry || entry.type === 'rest') return null;
  const sourceDay = entry.type === 'same' ? entry.of : weekday;
  const source = week[sourceDay];
  if (source?.type !== 'workout') return null;
  return { weekday, sourceDay, name: source.name ?? '', exercises: source.exercises ?? [] };
}

/** Az edzés neve az adott napon: a nap (a „same" napnál a hivatkozott nap)
    saját neve, vagy „Tervnév – Péntek" — az a nap, amelyiken fut. */
export function dayWorkoutName(plan, weekday) {
  const entry = dayEntry(plan.week, weekday);
  if (entry?.name) return entry.name;
  return `${plan.name} – ${dayName(weekday)}`;
}

/** Az összes edzésnap gyakorlatai egy listában (biztonsági jelzéshez). */
export const allWeekExercises = (week) =>
  (week ?? []).flatMap((entry) => (entry?.type === 'workout' ? entry.exercises : []));
