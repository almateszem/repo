/** A heti bontású edzésterv feloldása a kliensen — a server/plan-week.js
    tükre. Egy terv hete hét nap (0 = hétfő), mindegyik a három közül egy:
    { type: 'workout', name, exercises } · { type: 'rest' } · { type: 'same', of }. */

import { DAY_LABELS, DAY_NAMES } from './constants.js';

/** A nap neve nagy kezdőbetűvel („Hétfő") — a DAY_NAMES kisbetűs. */
const dayTitle = (day) => DAY_NAMES[day].charAt(0).toUpperCase() + DAY_NAMES[day].slice(1);

/** A mai nap hétnap-indexe (0 = hétfő). */
const todayWeekday = () => (new Date().getDay() + 6) % 7;

/** Egy nap feloldva: { weekday, sourceDay, name, exercises }, pihenőnapon null.
    A „same" nap a hivatkozott nap edzését adja. */
function dayEntry(week, weekday) {
  const entry = week?.[weekday];
  if (!entry || entry.type === 'rest') return null;
  const sourceDay = entry.type === 'same' ? entry.of : weekday;
  const source = week[sourceDay];
  if (source?.type !== 'workout') return null;
  return { weekday, sourceDay, name: source.name ?? '', exercises: source.exercises ?? [] };
}

/** Az edzés neve az adott napon: a nap neve, vagy „Tervnév – Péntek". */
function dayWorkoutName(plan, weekday) {
  const entry = dayEntry(plan.week, weekday);
  return entry?.name || `${plan.name} – ${dayTitle(weekday)}`;
}

/** Egy nap rövid állapota a heti előnézethez: a nap neve / „Pihenő" / „= H". */
function dayStatus(week, weekday) {
  const entry = week?.[weekday];
  if (!entry || entry.type === 'rest') return 'Pihenő';
  if (entry.type === 'same') return `= ${DAY_LABELS[entry.of]}`;
  return entry.name || `${entry.exercises?.length ?? 0} gyak.`;
}

export { dayEntry, dayStatus, dayTitle, dayWorkoutName, todayWeekday };
