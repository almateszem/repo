/**
 * Podium — a blokkos program futtatása
 * ------------------------------------------------------------------------
 * Aktiválás (a hiányzó TM-ek és 1RM-ek bekérése), a mai programnap
 * kiszámolt súlyokkal, a léptetés az elvégzett edzések szerint, az ugratás,
 * és a szabályok TM-javaslatainak jóváhagyása.
 *
 * A haladás NEM a naptárhoz kötött: a program a következő elvégzetlen napot
 * adja. A TM-et csak ember írja át (aktiválás, jóváhagyás) — a szabály csak
 * javasol. A számítás a server/program/ tiszta moduljaiban van.
 */
import {
  addTrainingMax,
  getAllExerciseMaxes,
  getCheckin,
  getCollection,
  getCycleWorkouts,
  getLatestWeight,
  getPlan,
  getProgramState,
  getTrainingMaxes,
  getTrueMaxes,
  getWorkouts,
  initProgramState,
  setActivePlan,
  setDeclaredMax,
  setProgramMid,
  setProgramPending,
  setProgramPos,
  startNextCycle,
  tagProgramWorkout,
  getActivePlan,
} from '../db.js';
import { roundToPlate } from '../program/formula.js';
import {
  buildDayWorkout,
  dayTitle,
  flattenDays,
  nextWeekStart,
  oneRmRefs,
  tmExercises,
} from '../program/program.js';
import { runStages } from '../program/rules.js';
import { readinessReport } from './session-plan.js';

const catalog = () => getCollection('exerciseCatalog') || [];
const isKg = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1000;

/** A gyakorlatok aktuális 1RM-je (exercise_maxes.max_1rm) a képletekhez. */
const oneRmMap = (userId) =>
  Object.fromEntries(getAllExerciseMaxes(userId).map((r) => [r.exercise_name, r.max_1rm]));

/** A képletek kiértékelési környezete (a sor gyakorlatát a hívó tölti ki). */
const evalContext = (userId) => ({
  trainingMaxes: getTrainingMaxes(userId),
  oneRms: oneRmMap(userId),
  bodyweight: getLatestWeight(userId),
});

/** Mi hiányzik az aktiváláshoz: TM minden TM-es gyakorlatra (javaslat: az
    1RM 90%-a, 2,5 kg-ra kerekítve), és 1RM a képletekben hivatkozottakra. */
export function activationNeeds(userId, plan) {
  const tms = getTrainingMaxes(userId);
  const orm = oneRmMap(userId);
  return {
    trainingMaxes: tmExercises(plan.program)
      .filter((ex) => tms[ex] == null)
      .map((ex) => ({
        exercise: ex,
        suggested: orm[ex] != null ? roundToPlate(orm[ex] * 0.9) : null,
      })),
    oneRms: oneRmRefs(plan.program).filter((ex) => orm[ex] == null),
  };
}

/**
 * Aktiválás: a hiányzó értékek mentése, az állapot indítása (ha még nincs —
 * az újraaktiválás folytatás), és a terv aktívvá tétele.
 */
export function activateProgram(userId, plan, { trainingMaxes = {}, oneRms = {} }, today) {
  const needs = activationNeeds(userId, plan);
  const missing =
    needs.trainingMaxes.some((n) => !isKg(trainingMaxes[n.exercise])) ||
    needs.oneRms.some((ex) => !isKg(oneRms[ex]));
  if (missing) return { error: 'Hiányzó értékek', needs };

  for (const ex of needs.oneRms) setDeclaredMax(userId, ex, oneRms[ex], today);
  const current = getTrainingMaxes(userId);
  for (const [ex, tm] of Object.entries(trainingMaxes)) {
    if (!isKg(tm) || current[ex] === tm || !tmExercises(plan.program).includes(ex)) continue;
    const suggested = needs.trainingMaxes.find((n) => n.exercise === ex)?.suggested;
    addTrainingMax(userId, ex, tm, today, suggested === tm ? 'from1rm' : 'manual');
  }
  initProgramState(userId, plan.id, today, getTrueMaxes(userId));
  setActivePlan(userId, plan.id, true, today);
  return { plan: getPlan(userId, plan.id) };
}

const total = (plan) => flattenDays(plan.program).length;
const weekOf = (plan, pos) => flattenDays(plan.program)[pos]?.week ?? null;
const position = (plan, state) => ({
  cycle: state.cycle,
  pos: state.pos,
  total: total(plan),
  title: dayTitle(plan.program, state.pos),
});

/** A mai programnap (vagy a jóváhagyásra váró javaslat) az Edzés oldalnak. */
export function programTemplate(userId, plan, today) {
  let state = getProgramState(userId, plan.id);
  if (!state) {
    initProgramState(userId, plan.id, today, getTrueMaxes(userId));
    state = getProgramState(userId, plan.id);
  }
  if (state.pending) {
    return {
      source: 'program-review',
      planId: plan.id,
      program: { cycle: state.cycle },
      suggestions: state.pending,
    };
  }
  const pos = Math.min(state.pos, total(plan) - 1);
  const where = position(plan, { ...state, pos });
  if (state.mid) {
    return { source: 'program-mid', planId: plan.id, program: where, suggestions: state.mid };
  }
  const day = buildDayWorkout(plan.program, pos, evalContext(userId));
  return {
    source: 'program',
    name: day.name,
    exercises: day.exercises,
    planId: plan.id,
    workoutId: null,
    program: where,
    missing: day.missing,
  };
}

/** A szabályokhoz egy edzés napjának check-inje: a legnagyobb fájdalom, az
    alvásórák, és a mentéskor rögzített készenlét. */
function withCheckin(userId, workout) {
  const ci = getCheckin(userId, workout.date);
  const pains = Object.values(ci?.pain ?? {}).filter((v) => Number.isFinite(v));
  return {
    ...workout,
    checkin: {
      pain: pains.length ? Math.max(...pains) : null,
      sleep: Number.isFinite(ci?.sleepHours) ? ci.sleepHours : null,
      readiness: workout.programReadiness ?? null,
    },
  };
}

/**
 * Egy határ átlépése (edzés, hét, ciklus vége) után a hozzá tartozó szabályok
 * láncban. A ciklus végén a javaslat a `pending`-be, közben a `mid`-be kerül.
 */
function afterBoundary(userId, plan, state, { workoutId = null, leftWeek = null }) {
  const cycle = getCycleWorkouts(userId, plan.id, state.cycle).map((w) => withCheckin(userId, w));
  const days = flattenDays(plan.program);
  const stages = [];
  if (workoutId != null) {
    const w = cycle.find((x) => x.id === workoutId);
    if (w) stages.push({ on: 'workout', workouts: [w] });
  }
  if (leftWeek != null) {
    stages.push({
      on: 'week',
      workouts: cycle.filter((w) => days[w.programPos]?.week === leftWeek),
    });
  }
  const end = state.pos >= days.length;
  if (end) stages.push({ on: 'cycle', workouts: cycle });
  const items = runStages({
    program: plan.program,
    stages,
    trainingMaxes: getTrainingMaxes(userId),
    baselineMaxes: state.baseline,
    catalog: catalog(),
    ctx: { oneRms: oneRmMap(userId), bodyweight: getLatestWeight(userId) },
    isCycleEnd: end,
  });
  if (end) setProgramPending(userId, plan.id, items);
  else if (items.length) setProgramMid(userId, plan.id, items);
}

/** Mentett edzés után: ha az aktív program napja volt, lép egyet (egyszer). */
export function onWorkoutSaved(userId, workout, today) {
  const plan = getActivePlan(userId);
  if (!plan || plan.kind !== 'program' || !workout || workout.planId !== plan.id) return;
  const state = getProgramState(userId, plan.id);
  if (!state || state.pending) return;
  const pos = Math.min(state.pos, total(plan) - 1);
  const readiness =
    readinessReport(
      userId,
      today,
      getWorkouts(userId).filter((w) => w.id !== workout.id),
    ).overall ?? null;
  if (!tagProgramWorkout(userId, workout.id, state.cycle, pos, readiness)) return;
  const next = pos + 1;
  setProgramPos(userId, plan.id, next);
  // Nyitott ciklus közbeni javaslatnál a szabályok a döntés után futnak tovább.
  if (state.mid) return;
  const leftWeek = weekOf(plan, next) !== weekOf(plan, pos) ? weekOf(plan, pos) : null;
  afterBoundary(userId, plan, { ...state, pos: next }, { workoutId: workout.id, leftWeek });
}

/** Ugratás: a következő nap, a következő hét, vagy a ciklus vége. */
export function skipProgram(userId, plan, to) {
  const state = getProgramState(userId, plan.id);
  if (!state) return { error: 'A program még nincs aktiválva.' };
  if (state.pending) return { error: 'A ciklus lezárult — előbb hagyd jóvá a TM-eket.' };
  if (state.mid) return { error: 'Előbb dönts a szabály javaslatáról.' };
  const n = total(plan);
  const pos = Math.min(state.pos, n - 1);
  let next;
  if (to === 'day') next = pos + 1;
  else if (to === 'week') next = nextWeekStart(plan.program, pos);
  else if (to === 'cycle-end') next = n;
  else return { error: 'Ismeretlen ugratás.' };
  setProgramPos(userId, plan.id, next);
  const leftWeek = weekOf(plan, next) !== weekOf(plan, pos) ? weekOf(plan, pos) : null;
  afterBoundary(userId, plan, { ...state, pos: next }, { leftWeek });
  return getProgramState(userId, plan.id);
}

/** A javaslat értékei a döntésekkel: az átírt érték, különben a javasolt. */
const decided = (items, decisions) =>
  items.map((s) => ({
    exercise: s.exercise,
    tm: isKg(decisions?.[s.exercise]) ? decisions[s.exercise] : s.suggested,
  }));

/** A ciklus végi TM-ek jóváhagyása, és a következő ciklus indítása. */
export function approveReview(userId, plan, decisions, today) {
  const state = getProgramState(userId, plan.id);
  if (!state?.pending) return { error: 'Nincs jóváhagyásra váró áttekintés.' };
  for (const { exercise, tm } of decided(state.pending, decisions))
    addTrainingMax(userId, exercise, tm, today, 'review');
  startNextCycle(userId, plan.id, today, getTrueMaxes(userId));
  return getProgramState(userId, plan.id);
}

/** Döntés a ciklus közbeni javaslatról: `decisions` objektum = elfogadás
    (onnan építkeznek tovább a szabályok), `null` = elvetés. */
export function decideMid(userId, plan, decisions, today) {
  const state = getProgramState(userId, plan.id);
  if (!state?.mid) return { error: 'Nincs függő javaslat.' };
  if (decisions) {
    for (const { exercise, tm } of decided(state.mid, decisions))
      addTrainingMax(userId, exercise, tm, today, 'rule');
  }
  setProgramMid(userId, plan.id, null);
  return getProgramState(userId, plan.id);
}

/** Az aktív program szerkesztése után: ha a pozíció megszűnt, a program
    utolsó napjára áll (áttekintés alatt nem nyúl hozzá). */
export function clampAfterEdit(userId, plan) {
  const state = getProgramState(userId, plan.id);
  if (!state || state.pending) return;
  const last = total(plan) - 1;
  if (state.pos > last) setProgramPos(userId, plan.id, last);
}
