/**
 * Podium — a blokkos program szerkezete
 * ------------------------------------------------------------------------
 * Program = { weeks: [{ label, days: [{ name, exercises: [{ name, role,
 *   sets: [{ count, reps, amrap, weight: Formula|null }] }] }] }],
 *   rules: [{ on, when, then, otherwise }], steps: { [gyakorlat]: kg } }
 *
 * A haladás nem a naptárhoz kötött: a program a napok sorozata, és a
 * `pos` ebben a sorozatban mutat egy napot. A hét csak csoportosít.
 * Tiszta függvények, I/O nélkül.
 */
import {
  MissingValueError,
  evalFormula,
  formulaRefs,
  normalizeFormula,
  roundToPlate,
} from './formula.js';

const LIMITS = { weeks: 12, days: 7, exercises: 20, sets: 20, rules: 10, label: 40, name: 80 };
const RULE_ON = new Set(['workout', 'week', 'cycle']);
const CMP_OPS = new Set(['<', '<=', '=', '>=', '>']);

class ProgramError extends Error {}
const fail = (msg) => {
  throw new ProgramError(msg);
};

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intIn = (v, min, max, msg) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) fail(msg);
  return n;
};
const list = (v, min, max, msg) => {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(msg);
  return v;
};

function normalizeSet(raw) {
  if (!raw || typeof raw !== 'object') fail('Érvénytelen szett.');
  let weight = null;
  if (raw.weight != null) {
    weight = normalizeFormula(raw.weight);
    if (!weight) fail('Egy szett súlyképlete érvénytelen.');
  }
  return {
    count: intIn(raw.count, 1, 20, 'A szettek száma 1 és 20 között lehet.'),
    reps: intIn(raw.reps, 0, 100, 'Az ismétlésszám 0 és 100 között lehet.'),
    amrap: Boolean(raw.amrap),
    weight,
  };
}

function normalizeExercise(raw) {
  if (!raw || typeof raw !== 'object') fail('Érvénytelen gyakorlat.');
  const name = text(raw.name, LIMITS.name);
  if (!name) fail('Minden gyakorlatnak legyen neve.');
  const sets = list(
    raw.sets,
    1,
    LIMITS.sets,
    `Egy gyakorlatnak 1–${LIMITS.sets} szett-sora lehet.`,
  );
  return { name, role: raw.role === 'main' ? 'main' : 'accessory', sets: sets.map(normalizeSet) };
}

function normalizeAction(raw) {
  if (!raw || typeof raw !== 'object') fail('Érvénytelen szabály-akció.');
  const finite = (v, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) fail('A szabály-akció értéke érvénytelen.');
    return n;
  };
  switch (raw.t) {
    case 'step':
      return { t: 'step' };
    case 'addKg':
      return { t: 'addKg', kg: finite(raw.kg, -100, 100) };
    case 'addPct':
      return { t: 'addPct', pct: finite(raw.pct, -100, 100) };
    case 'set': {
      const formula = normalizeFormula(raw.formula, { allowNewOrm: true });
      if (!formula) fail('A „TM = képlet” akció képlete érvénytelen.');
      return { t: 'set', formula };
    }
    default:
      return fail('Ismeretlen szabály-akció.');
  }
}

function normalizeCondition(raw) {
  if (raw?.t === 'record') return { t: 'record' };
  if (raw?.t === 'cmp' && CMP_OPS.has(raw.op)) {
    const a = normalizeFormula(raw.a, { allowStat: true });
    const b = normalizeFormula(raw.b, { allowStat: true });
    if (a && b) return { t: 'cmp', op: raw.op, a, b };
  }
  return fail('Egy szabály feltétele érvénytelen.');
}

function normalizeRule(raw) {
  if (!raw || typeof raw !== 'object') fail('Érvénytelen szabály.');
  return {
    on: RULE_ON.has(raw.on) ? raw.on : 'cycle',
    when: normalizeCondition(raw.when),
    then: normalizeAction(raw.then),
    otherwise: raw.otherwise == null ? null : normalizeAction(raw.otherwise),
  };
}

/** A beküldött program tiszta másolata, vagy magyar hibaüzenet. */
export function normalizeProgram(raw) {
  try {
    if (!raw || typeof raw !== 'object') fail('Érvénytelen program.');
    if (!Array.isArray(raw.weeks) || raw.weeks.length === 0)
      fail('A programnak legalább egy hete kell legyen.');
    const weeks = list(
      raw.weeks,
      1,
      LIMITS.weeks,
      `A program legfeljebb ${LIMITS.weeks} hetes lehet.`,
    );
    const program = {
      weeks: weeks.map((w) => {
        if (!w || typeof w !== 'object') fail('Érvénytelen hét.');
        const days = list(w.days, 1, LIMITS.days, `Egy hétben 1–${LIMITS.days} nap lehet.`);
        return {
          label: text(w.label, LIMITS.label),
          days: days.map((d) => {
            if (!d || typeof d !== 'object') fail('Érvénytelen nap.');
            const exercises = list(
              d.exercises,
              1,
              LIMITS.exercises,
              `Egy napon 1–${LIMITS.exercises} gyakorlat lehet.`,
            );
            return {
              name: text(d.name, LIMITS.label),
              exercises: exercises.map(normalizeExercise),
            };
          }),
        };
      }),
      rules: list(
        raw.rules ?? [],
        0,
        LIMITS.rules,
        `Legfeljebb ${LIMITS.rules} szabály lehet.`,
      ).map(normalizeRule),
      steps: {},
    };
    if (raw.steps && typeof raw.steps === 'object') {
      for (const [name, kg] of Object.entries(raw.steps)) {
        const n = typeof kg === 'number' ? kg : NaN;
        if (Number.isFinite(n) && n >= 0 && n <= 50 && name.length <= LIMITS.name)
          program.steps[name] = n;
      }
    }
    return { program };
  } catch (err) {
    if (err instanceof ProgramError) return { error: err.message };
    throw err;
  }
}

/** A program napjai sorban: { pos, week, day, weekLabel, dayName }. */
export function flattenDays(program) {
  const out = [];
  program.weeks.forEach((w, week) =>
    w.days.forEach((d, day) =>
      out.push({ pos: out.length, week, day, weekLabel: w.label, dayName: d.name }),
    ),
  );
  return out;
}

/** A következő hét első napjának pozíciója, vagy a napok száma. */
export function nextWeekStart(program, pos) {
  const days = flattenDays(program);
  const cur = days[pos];
  if (!cur) return days.length;
  return days.find((x) => x.week > cur.week)?.pos ?? days.length;
}

/** Egy nap címe: „1. hét · Guggolásnap”, név nélkül „1. hét · 2. nap”. */
export function dayTitle(program, pos) {
  const f = flattenDays(program)[pos];
  if (!f) return '';
  return `${f.weekLabel || `${f.week + 1}. hét`} · ${f.dayName || `${f.day + 1}. nap`}`;
}

function eachSet(program, fn) {
  program.weeks.forEach((w) =>
    w.days.forEach((d) => d.exercises.forEach((e) => e.sets.forEach((s) => fn(e, s)))),
  );
}
const pushUnique = (arr, v) => {
  if (!arr.includes(v)) arr.push(v);
};

/** Azok a gyakorlatok, amelyek bármely szett-képlete TM-et használ. */
export function tmExercises(program) {
  const out = [];
  eachSet(program, (e, s) => {
    if (s.weight && formulaRefs(s.weight).tm) pushUnique(out, e.name);
  });
  return out;
}

/** A képletekben hivatkozott 1RM-gyakorlatok (a szabályok képleteivel). */
export function oneRmRefs(program) {
  const out = [];
  eachSet(program, (e, s) => {
    if (s.weight) formulaRefs(s.weight).orm.forEach((ex) => pushUnique(out, ex ?? e.name));
  });
  for (const r of program.rules ?? []) {
    for (const a of [r.then, r.otherwise]) {
      if (a?.t === 'set') formulaRefs(a.formula).orm.forEach((ex) => ex && pushUnique(out, ex));
    }
  }
  return out;
}

/**
 * Egy programnap a napló szett-alakjában, kiszámolt, kerekített kg-okkal.
 * Ami nem számolható (hiányzó TM/1RM), az üres súly, és a `missing`-be kerül.
 */
export function buildDayWorkout(program, pos, ctx) {
  const f = flattenDays(program)[pos];
  if (!f) return null;
  const day = program.weeks[f.week].days[f.day];
  const missing = [];
  const exercises = day.exercises.map((e) => {
    const sets = [];
    for (const s of e.sets) {
      let weight = '';
      if (s.weight) {
        try {
          weight = String(roundToPlate(evalFormula(s.weight, { ...ctx, exercise: e.name })));
        } catch (err) {
          if (!(err instanceof MissingValueError)) throw err;
          const item = { kind: err.kind, exercise: err.exercise };
          if (!missing.some((m) => m.kind === item.kind && m.exercise === item.exercise))
            missing.push(item);
        }
      }
      for (let i = 0; i < s.count; i++) {
        sets.push({
          reps: String(s.reps),
          weight,
          rpe: '',
          type: 'work',
          done: false,
          ...(s.amrap ? { amrap: s.reps } : {}),
        });
      }
    }
    return { name: e.name, role: e.role, sets };
  });
  return { name: dayTitle(program, pos), exercises, missing };
}
