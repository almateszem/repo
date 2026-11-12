/**
 * Podium — a blokkos programok kliensoldali modellje
 * ------------------------------------------------------------------------
 * Tiszta függvények a programozó oldalnak: a súlyképlet kiértékelése az élő
 * előnézethez (a szerver server/program/formula.js-ének TÜKRE — a paritás-
 * teszt köti össze a kettőt), a sorbeli címke, a képletfa- és programfa-
 * műveletek, a blokktár szabálya, és a kg-mezők beolvasása.
 */

const MAX_DEPTH = 8;

/** A szabályfeltételben használható időszak-értékek címkéi (a szerverével azonosak). */
export const STAT_LABELS = {
  doneEx: 'teljesített (gyak.)',
  totalEx: 'összes (gyak.)',
  doneAll: 'teljesített (mind)',
  totalAll: 'összes (mind)',
  amrapReps: 'AMRAP-ismétlés',
  amrapTarget: 'előírt ismétlés',
  pain: 'fájdalom',
  readiness: 'készenlét',
  sleep: 'alvás',
};

/** Egy érték, ami a kiértékeléshez kellene, de nincs meg. */
export class MissingValueError extends Error {
  constructor(kind, exercise = null) {
    super(`Hiányzó érték: ${kind}`);
    this.name = 'MissingValueError';
    this.kind = kind;
    this.exercise = exercise;
  }
}

/** 2,5 kg-ra kerekít, negatívból 0 (a lebegőpontos hibát az eltolás nyeli el). */
export const roundToPlate = (x) => Math.max(0, Math.round(x / 2.5 + 1e-9) * 2.5);

/** Szám magyar alakban: legfeljebb 2 tizedes, tizedesvesszővel. */
export const hu = (x) => String(Math.round(x * 100) / 100).replace('.', ',');

/** A képlet értéke — a szerver evalFormula-jával azonos viselkedés. */
export function evalFormula(node, ctx, depth = 1) {
  if (!node || depth > MAX_DEPTH) throw new MissingValueError('slot');
  switch (node.t) {
    case 'num':
      return node.pct ? node.v / 100 : node.v;
    case 'tm': {
      const v = ctx.trainingMaxes?.[ctx.exercise];
      if (v == null) throw new MissingValueError('tm', ctx.exercise);
      return v;
    }
    case 'orm': {
      const ex = node.ex || ctx.exercise;
      const v = ctx.oneRms?.[ex];
      if (v == null) throw new MissingValueError('orm', ex);
      return v;
    }
    case 'bw':
      if (ctx.bodyweight == null) throw new MissingValueError('bw');
      return ctx.bodyweight;
    case 'newOrm':
      if (ctx.newOrm == null) throw new MissingValueError('newOrm', ctx.exercise);
      return ctx.newOrm;
    case 'stat': {
      const v = ctx.stats?.[node.k];
      if (v == null) throw new MissingValueError('stat', ctx.exercise);
      return v;
    }
    case 'op': {
      const a = evalFormula(node.a, ctx, depth + 1);
      const b = evalFormula(node.b, ctx, depth + 1);
      return node.op === '*' ? a * b : node.op === '+' ? a + b : a - b;
    }
    default:
      throw new MissingValueError('slot');
  }
}

/** A hiány olvasható neve az előnézethez („nincs TM: Elöl guggolás”). */
export function missingText(err) {
  switch (err.kind) {
    case 'tm':
      return `nincs TM: ${err.exercise}`;
    case 'orm':
      return `nincs 1RM: ${err.exercise}`;
    case 'bw':
      return 'nincs testsúly';
    case 'newOrm':
      return 'a ciklus végén számol';
    case 'stat':
      return 'edzés után számol';
    default:
      return 'üres hely a képletben';
  }
}

const OP_SIGN = { '*': '×', '+': '+', '-': '−' };
const PREC = { '*': 2, '+': 1, '-': 1 };

/** A képlet egy sorban: `85% × TM`, `(TM + 5) × 90%`. Csak akkor zárójelez,
    ha a műveleti sorrend megkívánja. Az üres hely `□`. */
export function formulaLabel(node) {
  if (!node) return '□';
  switch (node.t) {
    case 'num':
      return hu(node.v) + (node.pct ? '%' : '');
    case 'tm':
      return 'TM';
    case 'bw':
      return 'testsúly';
    case 'newOrm':
      return 'új 1RM';
    case 'orm':
      return node.ex ? `1RM: ${node.ex}` : '1RM';
    case 'stat':
      return STAT_LABELS[node.k] ?? '?';
    case 'op': {
      const p = PREC[node.op];
      const side = (child, right) => {
        const text = formulaLabel(child);
        if (child?.t !== 'op') return text;
        const cp = PREC[child.op];
        const wrap = cp < p || (right && cp === p && node.op === '-');
        return wrap ? `(${text})` : text;
      };
      return `${side(node.a, false)} ${OP_SIGN[node.op]} ${side(node.b, true)}`;
    }
    default:
      return '?';
  }
}

const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const parts = (path) => (path ? path.split('.') : []);

/** A fa egy pontja: `''` a gyökér, `'a.b'` a gyökér a-jának b-je. */
export function getAt(root, path) {
  let node = root;
  for (const k of parts(path)) node = node?.[k];
  return node;
}

/** Új fa, amelyben a `path` helyén `value` áll (az eredeti érintetlen). */
export function setAt(root, path, value) {
  const keys = parts(path);
  if (keys.length === 0) return value;
  const next = clone(root);
  let node = next;
  for (const k of keys.slice(0, -1)) node = node[k];
  node[keys.at(-1)] = value;
  return next;
}

/** A hely kiürítése (a gyökérnél: üres képlet). */
export const removeAt = (root, path) => setAt(root, path, null);

/** Az első üres hely (mélységi bejárás, `a` előbb), vagy null. */
function firstEmpty(node, path) {
  if (!node) return path;
  if (node.t !== 'op') return null;
  const join = (k) => (path ? `${path}.${k}` : k);
  return firstEmpty(node.a, join('a')) ?? firstEmpty(node.b, join('b'));
}

/**
 * Blokk a kijelölt helyre. Ha a sablon művelet és a helyen már érték áll, a
 * művelet KÖRBEÖLELI (Scratch-viselkedés: a régi érték az `a` lesz). A
 * `nextSel` a következő kitöltendő hely, vagy null.
 */
export function insertBlock(root, path, template) {
  const node = clone(template);
  const here = getAt(root, path);
  if (node.t === 'op' && here) node.a = clone(here);
  const next = setAt(root, path, node);
  return { root: next, nextSel: firstEmpty(next, '') };
}

/** Blokk a képlet gyökerébe (a blokktárból húzva): üresbe a sablon, művelet
    a meglévőt öleli körbe, érték az első üres helyre, ha nincs, cserél. */
export function insertIntoRoot(root, template) {
  if (!root) return clone(template);
  if (template.t === 'op') return insertBlock(root, '', template).root;
  const slot = firstEmpty(root, '');
  return slot == null ? clone(template) : setAt(root, slot, clone(template));
}

/** Hol használható egy blokk: `set` (szett súlya), `cond` (szabályfeltétel),
    `act` (szabály „TM = képlet” akciója). Hibaüzenet, vagy null. */
export function canUseNode(node, where) {
  let stat = false;
  let newOrm = false;
  const walk = (n) => {
    if (!n) return;
    if (n.t === 'stat') stat = true;
    if (n.t === 'newOrm') newOrm = true;
    if (n.t === 'op') {
      walk(n.a);
      walk(n.b);
    }
  };
  walk(node);
  if (stat && where !== 'cond')
    return 'A teljesítmény- és check-in értékek csak szabályfeltételben használhatók.';
  if (newOrm && where !== 'act')
    return 'Az „új 1RM” csak a szabály „TM = képlet” akciójában használható.';
  return null;
}

/** A hét másolata közvetlenül utána. */
export function duplicateWeek(program, w) {
  const next = clone(program);
  next.weeks.splice(w + 1, 0, clone(program.weeks[w]));
  return next;
}

/** A nap másolata közvetlenül utána, ugyanabban a hétben. */
export function duplicateDay(program, w, d) {
  const next = clone(program);
  next.weeks[w].days.splice(d + 1, 0, clone(program.weeks[w].days[d]));
  return next;
}

/** A becsukott hét összefoglalója: az első nap első fő gyakorlatának
    `szám% × TM` százalékai, pl. „65 / 75 / 85%”. */
export function weekSummary(week) {
  const main = week.days[0]?.exercises.find((e) => e.role === 'main');
  const pcts = (main?.sets ?? [])
    .map((s) => s.weight)
    .filter((f) => f?.t === 'op' && f.op === '*' && f.a?.t === 'num' && f.a.pct && f.b?.t === 'tm')
    .map((f) => hu(f.a.v));
  return pcts.length ? `${pcts.join(' / ')}%` : '';
}

/** Kg-mező beolvasása („112,5” is): pozitív, legfeljebb 1000, különben null. */
export function parseKg(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return v > 0 && v <= 1000 ? v : null;
}
