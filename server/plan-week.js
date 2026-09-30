/**
 * FitTrack Pro — a heti bontású edzésterv
 * ---------------------------------------
 * Egy terv EGY HÉT: hét nap, hétfőtől (0) vasárnapig (6), és hetente
 * ismétlődik. Minden nap a három közül egy:
 *
 *   { type: 'workout', name, exercises }  saját edzés (a név nem kötelező)
 *   { type: 'rest' }                      pihenőnap
 *   { type: 'same', of }                  ugyanaz, mint az `of` napi edzés
 *
 * A „same" csak EDZÉSNAPRA mutathat, láncban nem — a péntek = hétfő akkor is
 * egyértelmű marad, ha a hétfőt később átírják (a péntek vele változik).
 *
 * Tiszta függvények: a db.js, a server.js és a coaching.js is ezekből
 * dolgozik, és külön tesztelhetők (plan-week.test.js). A kliens a feloldást
 * (dayEntry, dayWorkoutName) a public/js/core/plan-week.js-ben tükrözi.
 */

export const DAY_COUNT = 7;

/** A napok neve az edzés alapértelmezett nevéhez („Tervnév – Hétfő"). */
export const DAY_NAMES = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat', 'Vasárnap'];

/** A kártya-leíráshoz: a napok rövid címkéje. */
export const DAY_LABELS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

/** Egy edzésnap nevének felső korlátja. */
export const DAY_NAME_MAX = 40;

const REST = Object.freeze({ type: 'rest' });

/**
 * A régi (egy gyakorlatlista + kijelölt hétnapok) terv heti alakja: az első
 * kijelölt nap kapja az edzést, a többi kijelölt nap „ugyanaz, mint az
 * első", a többi pihenő. Kijelölt nap nélkül az edzés hétfőre kerül — a régi
 * terv így is elindítható marad, és nem vész el belőle semmi.
 */
export function weekFromLegacy(exercises, days) {
  const scheduled = [...new Set((Array.isArray(days) ? days : []).map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day < DAY_COUNT)
    .sort((a, b) => a - b);
  const first = scheduled[0] ?? 0;
  return Array.from({ length: DAY_COUNT }, (_, day) => {
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
  if (!Array.isArray(raw) || raw.length !== DAY_COUNT) {
    return { error: 'A tervnek pontosan hét napból kell állnia.' };
  }

  const week = [];
  for (const [day, entry] of raw.entries()) {
    if (entry?.type === 'workout') {
      const result = normalizeDayExercises(entry.exercises);
      if (result.error) return { error: `${DAY_NAMES[day]}: ${result.error}` };
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
      return { error: `${DAY_NAMES[day]}: csak egy edzésnappal lehet azonos.` };
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
  return `${plan.name} – ${DAY_NAMES[weekday]}`;
}

/** Az összes edzésnap gyakorlatai egy listában (biztonsági jelzéshez). */
export const allWeekExercises = (week) =>
  (week ?? []).flatMap((entry) => (entry?.type === 'workout' ? entry.exercises : []));
