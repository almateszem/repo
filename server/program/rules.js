/**
 * Podium — a blokkos programok szabályai
 * ------------------------------------------------------------------------
 * A szabályok TM-JAVASLATOT adnak, sosem írják át a TM-et maguktól.
 * Minden szabálynak van futási pontja: minden edzés után, minden hét után
 * vagy a ciklus végén. Egy határon a szakaszok láncban futnak (edzés → hét
 * → ciklus), és mindegyik az előző javaslatából indul.
 *
 * Mindig a ténylegesen rögzített (pipált) szettekből dolgozik, nem az
 * előírtakból. Tiszta függvények, I/O nélkül.
 */
import { resolveExerciseLoad } from '../muscles.js';
import { MissingValueError, evalFormula, formulaText, hu, roundToPlate } from './formula.js';
import { tmExercises } from './program.js';

const LOWER = new Set(['quads', 'hamstrings', 'glutes', 'calves']);
const OP_SIGN = { '<': '<', '<=': '≤', '=': '=', '>=': '≥', '>': '>' };
const WHEN = {
  workout: 'minden edzés után',
  week: 'minden hét után',
  cycle: 'a ciklus végén',
};
const NO_DATA = 'Nincs adat a szabályhoz';

/** Alsótestes-e a gyakorlat: a láb terhelése több, mint a többi együtt. */
export function isLowerBody(name, catalog) {
  let lower = 0;
  let other = 0;
  for (const [group, share] of Object.entries(resolveExerciseLoad(name, catalog))) {
    if (LOWER.has(group)) lower += share;
    else other += share;
  }
  return lower > other;
}

/** A „TM + lépésköz” lépésköze: a program felülírása, különben 5 / 2,5 kg. */
export function defaultStep(name, program, catalog) {
  return program.steps?.[name] ?? (isLowerBody(name, catalog) ? 5 : 2.5);
}

const toNum = (v) => Number(String(v ?? '').replace(',', '.'));

/** Egy gyakorlat AMRAP- és 1RM-próba-adatai a pipált szettekből. */
export function collectCycleData(workouts, exercise) {
  let amrapReps = null;
  let amrapTarget = null;
  let bestSingle = null;
  for (const w of workouts) {
    for (const e of w.exercises ?? []) {
      if (e.name !== exercise) continue;
      for (const s of e.sets ?? []) {
        if (!s.done) continue;
        const reps = toNum(s.reps);
        const weight = toNum(s.weight);
        if (s.amrap && Number.isFinite(reps)) {
          amrapReps = reps;
          amrapTarget = s.amrap;
        }
        if (reps === 1 && weight > 0 && (bestSingle == null || weight > bestSingle))
          bestSingle = weight;
      }
    }
  }
  return { amrapReps, amrapTarget, bestSingle };
}

/** Egy időszak (edzés, hét, ciklus) számai egy gyakorlatra. A „mind” az
    időszak minden gyakorlatát számolja; ugratott nap nincs a listában. */
export function periodStats(workouts, exercise) {
  let doneEx = 0;
  let totalEx = 0;
  let doneAll = 0;
  let totalAll = 0;
  for (const w of workouts) {
    for (const e of w.exercises ?? []) {
      for (const s of e.sets ?? []) {
        totalAll++;
        if (s.done) doneAll++;
        if (e.name === exercise) {
          totalEx++;
          if (s.done) doneEx++;
        }
      }
    }
  }
  const { amrapReps, amrapTarget } = collectCycleData(workouts, exercise);
  const ci = (k) => workouts.map((w) => w.checkin?.[k]).filter((v) => Number.isFinite(v));
  const pains = ci('pain');
  const ready = ci('readiness');
  const sleep = ci('sleep');
  return {
    doneEx,
    totalEx,
    doneAll,
    totalAll,
    amrapReps,
    amrapTarget,
    pain: pains.length ? Math.max(...pains) : null,
    readiness: ready.length ? Math.min(...ready) : null,
    sleep: sleep.length
      ? Math.round((sleep.reduce((a, b) => a + b, 0) / sleep.length) * 10) / 10
      : null,
  };
}

/** Gyakorlatonkénti TM-javaslat a megadott szabályokkal és időszakkal. */
export function suggestTrainingMaxes({
  program,
  rules = program.rules,
  trainingMaxes,
  workouts,
  baselineMaxes,
  catalog,
  ctx,
}) {
  return tmExercises(program)
    .filter((ex) => trainingMaxes[ex] != null)
    .map((ex) => {
      const current = trainingMaxes[ex];
      const keep = (reason) => ({ exercise: ex, current, suggested: current, reason });
      const data = collectCycleData(workouts, ex);
      const evalCtx = { ...ctx, exercise: ex, trainingMaxes, stats: periodStats(workouts, ex) };
      for (const rule of rules) {
        let cond;
        let reason;
        if (rule.when.t === 'record') {
          cond = data.bestSingle != null && data.bestSingle > (baselineMaxes[ex] ?? 0);
          reason = cond ? `Új 1RM-rekord: ${hu(data.bestSingle)} kg` : 'Nem volt új 1RM-rekord';
        } else {
          let a;
          let b;
          try {
            a = evalFormula(rule.when.a, evalCtx);
            b = evalFormula(rule.when.b, evalCtx);
          } catch (err) {
            if (err instanceof MissingValueError) return keep(NO_DATA);
            throw err;
          }
          cond = { '<': a < b, '<=': a <= b, '=': a === b, '>=': a >= b, '>': a > b }[rule.when.op];
          reason = `${formulaText(rule.when.a)} = ${hu(a)} ${OP_SIGN[rule.when.op]} ${formulaText(rule.when.b)} = ${hu(b)}`;
          if (!cond) reason = `Nem teljesült: ${reason}`;
        }
        const action = cond ? rule.then : rule.otherwise;
        if (!action) continue;
        let next;
        if (action.t === 'step') next = current + defaultStep(ex, program, catalog);
        else if (action.t === 'addKg') next = current + action.kg;
        else if (action.t === 'addPct') next = current * (1 + action.pct / 100);
        else {
          const newOrm = cond && rule.when.t === 'record' ? data.bestSingle : null;
          try {
            next = evalFormula(action.formula, { ...evalCtx, newOrm });
          } catch (err) {
            if (err instanceof MissingValueError) return keep(NO_DATA);
            throw err;
          }
        }
        return { exercise: ex, current, suggested: roundToPlate(next), reason };
      }
      return keep('Nincs érvényes szabály');
    });
}

/**
 * A határon futó szakaszok láncban. A `stages`: [{ on, workouts }] sorrendben.
 * Ciklus végén minden TM-es gyakorlat visszajön, ciklus közben csak a változók.
 */
export function runStages({
  program,
  stages,
  trainingMaxes,
  baselineMaxes,
  catalog,
  ctx,
  isCycleEnd,
}) {
  const start = { ...trainingMaxes };
  const tms = { ...trainingMaxes };
  const reasons = {};
  for (const { on, workouts } of stages) {
    const rules = program.rules.filter((r) => (r.on || 'cycle') === on);
    if (!rules.length) continue;
    const out = suggestTrainingMaxes({
      program,
      rules,
      trainingMaxes: tms,
      workouts,
      baselineMaxes,
      catalog,
      ctx,
    });
    for (const s of out) {
      if (s.suggested !== s.current || (on === 'cycle' && isCycleEnd))
        (reasons[s.exercise] ??= []).push(`${WHEN[on]}: ${s.reason}`);
      tms[s.exercise] = s.suggested;
    }
  }
  return tmExercises(program)
    .filter((ex) => start[ex] != null && (isCycleEnd || tms[ex] !== start[ex]))
    .map((ex) => ({
      exercise: ex,
      current: start[ex],
      suggested: tms[ex],
      reason: (reasons[ex] ?? ['nincs változás']).join(' · '),
    }));
}
