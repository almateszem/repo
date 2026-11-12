/**
 * Podium — a programozó blokktára és a programfa szerkesztése
 * ------------------------------------------------------------------------
 * A blokktár kategóriái (szerkezet, gyakorlatok, értékek, teljesítmény,
 * check-in, műveletek), és hogy egy blokk hová ejthető és mi lesz belőle.
 * Ugyanez fut húzásnál és telefonos „kijelöl → kattint” bevitelnél is.
 * Mellette a sorok „+”, mozgatás és törlés műveletei. Tiszta függvények: a
 * programot nem mutálják, másolatot adnak.
 */
import { STAT_LABELS, canUseNode, insertIntoRoot, weekSummary } from './program-model.js';

/** A blokktár kategóriái: kulcs, felirat (a `|` sortörés a keskeny fülön),
    szín-osztály és a tipp, hová húzható. */
export const CATS = [
  {
    k: 'struct',
    label: 'Szerkezet',
    tone: 'struct',
    hint: 'A hetet bárhová, a napot egy hétre, a szettet egy gyakorlatra, a szabályt a Szabályok kártyára húzd.',
  },
  {
    k: 'ex',
    label: 'Gyakorlat',
    tone: 'ex',
    hint: 'Egy napra húzva új gyakorlat, egy meglévő gyakorlatra húzva csere.',
  },
  {
    k: 'val',
    label: 'Értékek',
    tone: 'val',
    hint: 'Egy szett súlyára vagy a képletkészítő egy helyére húzd. Az „új 1RM” csak a szabály „TM = képlet” akciójában használható.',
  },
  {
    k: 'perf',
    label: 'Teljesít|mény',
    tone: 'perf',
    hint: 'Csak szabályfeltételben: a „Ha” sor egyik oldalára húzd. A szabály időszakából számol (edzés, hét vagy ciklus).',
  },
  {
    k: 'ci',
    label: 'Check-in',
    tone: 'ci',
    hint: 'A napi check-in (fájdalom, készenlét, alvás). Csak szabályfeltételben használható.',
  },
  {
    k: 'op',
    label: 'Műve|letek',
    tone: 'op',
    hint: 'Egy értékre húzva körbeöleli azt, pl. a TM-re húzva „TM × □”.',
  },
];

const num = (v, pct = false) => ({ t: 'num', v, pct });
const pctTm = (p) => ({ t: 'op', op: '*', a: num(p, true), b: { t: 'tm' } });
const PERF_KEYS = ['doneEx', 'totalEx', 'doneAll', 'totalAll', 'amrapReps', 'amrapTarget'];
const CHECKIN_KEYS = ['pain', 'readiness', 'sleep'];
const node = (n, lab, tone) => ({ kind: 'node', n, lab, tone });

/** Egy kategória elemei. A gyakorlatok listáját a hívó adja (a katalógus
    keresésének eredménye). */
export function sideItems(cat, exercises = []) {
  switch (cat) {
    case 'struct':
      return [
        ['week', 'Hét'],
        ['day', 'Nap'],
        ['set', 'Szett'],
        ['rule', 'Szabály'],
      ].map(([what, lab]) => ({ kind: 'struct', what, lab, tone: `s-${what}` }));
    case 'ex':
      return exercises.map((name) => ({ kind: 'exercise', name, lab: name, tone: 'ex' }));
    case 'val':
      return [
        node(num(50, true), '50%', 'num'),
        node(num(20), '20', 'num'),
        node({ t: 'tm' }, 'TM', 'var'),
        node({ t: 'orm', ex: null }, '1RM: gyakorlat ▾', 'var'),
        node({ t: 'bw' }, 'testsúly', 'var'),
        node({ t: 'newOrm' }, 'új 1RM', 'new'),
      ];
    case 'perf':
      return PERF_KEYS.map((k) => node({ t: 'stat', k }, STAT_LABELS[k], 'stat'));
    case 'ci':
      return CHECKIN_KEYS.map((k) => node({ t: 'stat', k }, STAT_LABELS[k], 'ci'));
    case 'op':
      return [
        ['*', '□ × □'],
        ['+', '□ + □'],
        ['-', '□ − □'],
      ].map(([op, lab]) => node({ t: 'op', op, a: null, b: null }, lab, 'op'));
    default:
      return [];
  }
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const int = (v) => Number(v);

/** Új szett-sor: 1×5, súly nélkül („a napon döntöd el”, amíg nem kap képletet). */
const newSet = () => ({ count: 1, reps: 5, amrap: false, weight: null });
const newDay = () => ({ name: '', exercises: [] });
const newRule = () => ({
  on: 'workout',
  when: { t: 'cmp', op: '>=', a: { t: 'stat', k: 'pain' }, b: num(7) },
  then: { t: 'addPct', pct: -30 },
  otherwise: null,
});
/** Új gyakorlat egy napra: az első a fő (3×5, 70% × TM), a többi kiegészítő. */
const newExercise = (name, day) =>
  day.exercises.some((e) => e.role === 'main')
    ? { name, role: 'accessory', sets: [{ count: 3, reps: 10, amrap: false, weight: null }] }
    : { name, role: 'main', sets: [{ count: 3, reps: 5, amrap: false, weight: pctTm(70) }] };

/** Egy szerkesztés a program másolatán: a `fn` a másolatot módosítja. */
const edit = (program, fn) => {
  const next = clone(program);
  fn(next);
  return next;
};

export const addSet = (program, w, d, e) =>
  edit(program, (p) => p.weeks[w].days[d].exercises[e].sets.push(newSet()));
export const removeSet = (program, w, d, e, s) =>
  edit(program, (p) => p.weeks[w].days[d].exercises[e].sets.splice(s, 1));
export const addExercise = (program, w, d, name) =>
  edit(program, (p) => {
    const day = p.weeks[w].days[d];
    day.exercises.push(newExercise(name, day));
  });
export const removeExercise = (program, w, d, e) =>
  edit(program, (p) => p.weeks[w].days[d].exercises.splice(e, 1));
/** Gyakorlat mozgatása a napon belül (`dir` −1 fel, +1 le). A lista szélén
    ugyanazt a programot adja vissza. */
export function moveExercise(program, w, d, e, dir) {
  const to = e + dir;
  const list = program.weeks[w].days[d].exercises;
  if (to < 0 || to >= list.length) return program;
  return edit(program, (p) => {
    const ex = p.weeks[w].days[d].exercises;
    [ex[e], ex[to]] = [ex[to], ex[e]];
  });
}
/** Új nap a `d` napja után (a `d` hiányában a hét végére). */
export const addDay = (program, w, d = program.weeks[w].days.length - 1) =>
  edit(program, (p) => p.weeks[w].days.splice(d + 1, 0, newDay()));
export const removeDay = (program, w, d) => edit(program, (p) => p.weeks[w].days.splice(d, 1));
/** Új hét a `w` hete után (a `w` hiányában a végére). */
export const addWeek = (program, w = program.weeks.length - 1) =>
  edit(program, (p) =>
    p.weeks.splice(w + 1, 0, { label: `${p.weeks.length + 1}. hét`, days: [newDay()] }),
  );
export const removeWeek = (program, w) => edit(program, (p) => p.weeks.splice(w, 1));
const addRule = (program) => edit(program, (p) => p.rules.push(newRule()));

/** Az új program váza: egy hét, egy nap, egy fő gyakorlat 5/3/1-es első
    hetével, és Viktor szabálya (rekord → 95% × új 1RM, különben lépésköz). */
export const starterProgram = () => ({
  weeks: [
    {
      label: '1. hét',
      days: [
        {
          name: '',
          exercises: [
            {
              name: 'Guggolás',
              role: 'main',
              sets: [
                { count: 1, reps: 5, amrap: false, weight: pctTm(65) },
                { count: 1, reps: 5, amrap: false, weight: pctTm(75) },
                { count: 1, reps: 5, amrap: true, weight: pctTm(85) },
              ],
            },
          ],
        },
      ],
    },
  ],
  rules: [
    {
      on: 'cycle',
      when: { t: 'record' },
      then: { t: 'set', formula: { t: 'op', op: '*', a: num(95, true), b: { t: 'newOrm' } } },
      otherwise: { t: 'step' },
    },
  ],
  steps: {},
});

/** A becsukott hét sora: a százalékai, vagy a napjai száma. */
export function weekRowSummary(week) {
  return `▸ ${weekSummary(week) || `${week.days.length} nap`}`;
}

/**
 * Egy blokk ledobása egy célra. A `target` a cél data-* attribútumai:
 * { dz: 'week'|'day'|'ex'|'setw'|'cond'|'act'|'rules', w, d, e, s, path }.
 * Siker: { program }, rossz cél: { error } (magyar mondat, hová való).
 */
export function applyDrop(program, item, target = {}) {
  const t = target;
  const [w, d, e, s] = [int(t.w), int(t.d), int(t.e), int(t.s)];
  const fail = (error) => ({ error });
  if (item.kind === 'exercise') {
    if (t.dz === 'day') return { program: addExercise(program, w, d, item.name) };
    if (t.dz === 'ex')
      return {
        program: edit(program, (p) => {
          p.weeks[w].days[d].exercises[e].name = item.name;
        }),
      };
    return fail('A gyakorlatot egy napra vagy egy meglévő gyakorlatra húzd.');
  }
  if (item.kind === 'struct') {
    switch (item.what) {
      case 'week':
        return { program: addWeek(program, t.w != null && t.dz ? w : undefined) };
      case 'day':
        if (t.dz === 'week') return { program: addDay(program, w) };
        if (t.dz === 'day') return { program: addDay(program, w, d) };
        return fail('A napot egy hétre húzd.');
      case 'set':
        if (t.dz !== 'ex') return fail('A szettet egy gyakorlatra húzd.');
        return { program: addSet(program, w, d, e) };
      default:
        if (t.dz !== 'rules') return fail('A szabályt a Szabályok kártyára húzd.');
        return { program: addRule(program) };
    }
  }
  // érték vagy művelet
  if (t.dz === 'setw') {
    const msg = canUseNode(item.n, 'set');
    if (msg) return fail(msg);
    return {
      program: edit(program, (p) => {
        const set = p.weeks[w].days[d].exercises[e].sets[s];
        set.weight = insertIntoRoot(set.weight, item.n);
      }),
    };
  }
  if (t.dz === 'cond' || t.dz === 'act') {
    const msg = canUseNode(item.n, t.dz);
    if (msg) return fail(msg);
    const [ri, key] = String(t.path).split('.');
    return {
      program: edit(program, (p) => {
        const rule = p.rules[int(ri)];
        if (t.dz === 'cond') rule.when[key] = insertIntoRoot(rule.when[key], item.n);
        else rule[key].formula = insertIntoRoot(rule[key].formula, item.n);
      }),
    };
  }
  return fail('Ezt egy szett súlyára, a „Ha” sor egyik oldalára vagy a képletkészítőbe húzd.');
}
