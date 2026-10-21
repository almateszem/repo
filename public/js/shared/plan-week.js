/** A ciklusos edzésterv feloldása a kliensen — a server/plan-week.js tükre.
    Egy terv 1–14 napos ciklus (0 = az első nap), a napok neve a hét napjait
    követi, a második körben „(2.)" utótaggal. Minden nap a három közül egy:
    { type: 'workout', name, exercises } · { type: 'rest' } · { type: 'same', of }.
    A ciklus horgonya az aktiválás (activeSince) hetének hétfője — a szerver
    ugyanígy számol, így a kettő ugyanazt a napot tartja „mának". */

import { DAY_LABELS, DAY_NAMES } from './constants.js';

/** A második körben (8.–14. nap) a szám, különben üres. */
const dayRound = (day) => (day >= DAY_NAMES.length ? '2.' : '');

const roundSuffix = (day) => (dayRound(day) ? ` (${dayRound(day)})` : '');

/** A nap neve nagy kezdőbetűvel: „Hétfő", a második körben „Hétfő (2.)". */
const dayTitle = (day) => {
  const name = DAY_NAMES[day % DAY_NAMES.length];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}${roundSuffix(day)}`;
};

/** A nap betűje utótag nélkül („H") — a sávok cellájába, a „2." külön elem. */
const dayLetter = (day) => DAY_LABELS[day % DAY_LABELS.length];

/** A nap rövid címkéje felsoroláshoz: „H", a második körben „H (2.)". */
const dayLabel = (day) => `${dayLetter(day)}${roundSuffix(day)}`;

/** A nap mellékneve: „hétfői", a második körben „hétfői (2.)". */
const dayAdjective = (day) => `${DAY_NAMES[day % DAY_NAMES.length]}i${roundSuffix(day)}`;

/** A böngésző mai napja „ÉÉÉÉ.HH.NN" alakban (mint az X-Client-Date). */
const localToday = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
};

/** Egy „ÉÉÉÉ.HH.NN" nap sorszáma (napok 1970.01.01 óta). UTC-ben számol,
    így az óraátállítás nem csúsztat. */
const dayNumber = (dateStr) => {
  const [year, month, day] = String(dateStr).split('.').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
};

/** A nap hetének hétfője, napsorszámként (1970.01.01 csütörtök volt). */
const mondayNumber = (dateStr) => {
  const number = dayNumber(dateStr);
  return number - ((((number + 3) % 7) + 7) % 7);
};

/** Tetszőleges hétfő — a horgony nélküli terv ehhez igazodik. */
const FALLBACK_MONDAY = '1970.01.05';

/** A ciklus napja egy dátumon (alapból ma): 0 … hossz−1. A horgony előtti
    napra sem negatív. */
function cycleDay(plan, dateStr = localToday()) {
  const length = plan?.week?.length || 7;
  const anchor = mondayNumber(plan?.activeSince || plan?.date || FALLBACK_MONDAY);
  const offset = dayNumber(dateStr) - anchor;
  return ((offset % length) + length) % length;
}

/** A kártya „mai" napja: az aktív terven a ciklus napja; a nem aktív terven
    csak hétnapos tervnél (ott a ciklus maga a hét) — máshol a „ma" az
    aktiválástól függne, ezért -1 (nincs mai nap). */
function todayIndex(plan, dateStr = localToday()) {
  return plan.active || plan.week?.length === 7 ? cycleDay(plan, dateStr) : -1;
}

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

/** Egy nap rövid állapota az előnézethez: a nap neve / „Pihenő" / „= H". */
function dayStatus(week, weekday) {
  const entry = week?.[weekday];
  if (!entry || entry.type === 'rest') return 'Pihenő';
  if (entry.type === 'same') return `= ${dayLabel(entry.of)}`;
  return entry.name || `${entry.exercises?.length ?? 0} gyak.`;
}

export {
  cycleDay,
  dayAdjective,
  dayEntry,
  dayLabel,
  dayLetter,
  dayRound,
  dayStatus,
  dayTitle,
  dayWorkoutName,
  todayIndex,
};
