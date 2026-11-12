/**
 * Podium — a blokkos programok súlyképlete
 * ------------------------------------------------------------------------
 * Egy szett súlya (és egy szabály feltétele, akciója) egymásba ágyazott
 * blokkokból álló fa: szám, százalék, TM, 1RM, testsúly, új 1RM,
 * teljesítmény-/check-in érték, valamint ×, +, − műveletek.
 *
 * Tiszta függvények: nincs adatbázis, nincs I/O. A kliens
 * (public/js/program/program-model.js) ugyanezt tükrözi az élő
 * előnézethez; a kettő egyezését paritás-teszt köti össze.
 */

const MAX_DEPTH = 8;
const MAX_NODES = 32;
const MAX_NUM = 10000;

/** A szabályfeltételben használható időszak-értékek és a címkéjük. */
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
export const STAT_KEYS = Object.keys(STAT_LABELS);

const OPS = new Set(['*', '+', '-']);

/** Egy érték, ami a kiértékeléshez kellene, de nincs meg. */
export class MissingValueError extends Error {
  constructor(kind, exercise = null) {
    super(`Hiányzó érték: ${kind}${exercise ? ` (${exercise})` : ''}`);
    this.name = 'MissingValueError';
    this.kind = kind;
    this.exercise = exercise;
  }
}

/** 2,5 kg-ra kerekít, negatívból 0. Az apró eltolás a lebegőpontos hibát
    nyeli el: 162,5 × 0,7 a gépnek 113,7499…, ami 115, nem 112,5. */
export const roundToPlate = (x) => Math.max(0, Math.round(x / 2.5 + 1e-9) * 2.5);

/** Szám magyar alakban: legfeljebb 2 tizedes, tizedesvesszővel. */
export const hu = (x) => String(Math.round(x * 100) / 100).replace('.', ',');

/**
 * A beküldött képletfa tiszta másolata, vagy null, ha érvénytelen.
 * Csak az ismert mezők jutnak át; a korlátok a mélység és a csomópontszám.
 */
export function normalizeFormula(raw, { allowNewOrm = false, allowStat = false } = {}) {
  let nodes = 0;
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > MAX_DEPTH || ++nodes > MAX_NODES) return null;
    switch (n.t) {
      case 'num': {
        const v = Number(n.v);
        if (!Number.isFinite(v) || v < 0 || v > MAX_NUM) return null;
        return { t: 'num', v, pct: Boolean(n.pct) };
      }
      case 'tm':
        return { t: 'tm' };
      case 'bw':
        return { t: 'bw' };
      case 'orm': {
        if (n.ex == null || n.ex === '') return { t: 'orm', ex: null };
        if (typeof n.ex !== 'string' || n.ex.length > 80) return null;
        return { t: 'orm', ex: n.ex.trim() || null };
      }
      case 'newOrm':
        return allowNewOrm ? { t: 'newOrm' } : null;
      case 'stat':
        return allowStat && STAT_KEYS.includes(n.k) ? { t: 'stat', k: n.k } : null;
      case 'op': {
        if (!OPS.has(n.op)) return null;
        const a = walk(n.a, depth + 1);
        const b = a && walk(n.b, depth + 1);
        return a && b ? { t: 'op', op: n.op, a, b } : null;
      }
      default:
        return null;
    }
  };
  return walk(raw, 1);
}

/**
 * Egy képlet értéke. A `ctx`:
 * { exercise, trainingMaxes, oneRms, bodyweight, newOrm?, stats? }.
 * Hiányzó értéknél MissingValueError-t dob.
 */
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

/** Mire hivatkozik a képlet. Az `orm` listában a null a sor gyakorlata. */
export function formulaRefs(node) {
  const refs = { tm: false, orm: [], bw: false, newOrm: false, stat: false };
  const walk = (n) => {
    if (!n) return;
    if (n.t === 'tm') refs.tm = true;
    else if (n.t === 'orm' && !refs.orm.includes(n.ex)) refs.orm.push(n.ex);
    else if (n.t === 'bw') refs.bw = true;
    else if (n.t === 'newOrm') refs.newOrm = true;
    else if (n.t === 'stat') refs.stat = true;
    else if (n.t === 'op') {
      walk(n.a);
      walk(n.b);
    }
  };
  walk(node);
  return refs;
}

const OP_SIGN = { '*': '×', '+': '+', '-': '−' };

/** A képlet olvasható alakja a szabály-indoklásokhoz (zárójelek nélkül,
    ahogy a blokkok sorban állnak). */
export function formulaText(node) {
  if (!node) return '?';
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
    case 'op':
      return `${formulaText(node.a)} ${OP_SIGN[node.op]} ${formulaText(node.b)}`;
    default:
      return '?';
  }
}
