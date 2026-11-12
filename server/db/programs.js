/**
 * Podium — adatréteg: blokkos programok
 * ------------------------------------------------------------------------
 * A programterv a `plans` tábla sora `kind = 'program'`-mal. Mellette a
 * haladás (`program_state`), a TM-előzmény (`training_maxes`), és az edzés
 * helye a programban (`workouts.program_cycle` / `program_pos`).
 * Minden függvény a userId-re szűr.
 */
import { db } from './connection.js';
import { getPlan } from './training.js';

/** Új blokkos program. Inaktívként jön létre: az aktiválás bekéri a TM-eket. */
export function addProgramPlan(userId, name, date, program) {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO plans (user_id, name, date, week, exercises, days, active, kind, program)
       VALUES (?, ?, ?, '[]', '[]', '[]', 0, 'program', ?)`,
    )
    .run(userId, name, date, JSON.stringify(program));
  return getPlan(userId, Number(lastInsertRowid));
}

/** Program átírása; egyszerű vagy idegen tervre null. */
export function updateProgramPlan(userId, id, name, program) {
  const { changes } = db
    .prepare(
      `UPDATE plans SET name = ?, program = ?
       WHERE id = ? AND user_id = ? AND kind = 'program'`,
    )
    .run(name, JSON.stringify(program), id, userId);
  return changes === 0 ? null : getPlan(userId, id);
}

const parse = (text, fallback) => (text ? JSON.parse(text) : fallback);

/** A program haladása, vagy null, ha még nem indult. */
export function getProgramState(userId, planId) {
  const row = db
    .prepare('SELECT * FROM program_state WHERE plan_id = ? AND user_id = ?')
    .get(planId, userId);
  return row
    ? {
        cycle: row.cycle,
        pos: row.pos,
        cycleStarted: row.cycle_started,
        baseline: parse(row.baseline, {}),
        pending: parse(row.pending, null),
        mid: parse(row.mid, null),
      }
    : null;
}

/** Az állapot indítása — csak ha még nincs: az újraaktiválás folytatás. */
export function initProgramState(userId, planId, today, baseline) {
  db.prepare(
    `INSERT OR IGNORE INTO program_state (plan_id, user_id, cycle, pos, cycle_started, baseline)
     SELECT id, user_id, 1, 0, ?, ? FROM plans WHERE id = ? AND user_id = ?`,
  ).run(today, JSON.stringify(baseline), planId, userId);
}

const setField = (column) => (userId, planId, value) =>
  db
    .prepare(`UPDATE program_state SET ${column} = ? WHERE plan_id = ? AND user_id = ?`)
    .run(value, planId, userId);
const setPos = setField('pos');
const setPending = setField('pending');
const setMid = setField('mid');

export const setProgramPos = (userId, planId, pos) => setPos(userId, planId, pos);
export const setProgramPending = (userId, planId, suggestions) =>
  setPending(userId, planId, suggestions ? JSON.stringify(suggestions) : null);
export const setProgramMid = (userId, planId, suggestions) =>
  setMid(userId, planId, suggestions ? JSON.stringify(suggestions) : null);

/** A következő ciklus: cycle+1, az első nap, javaslatok nélkül, friss alappal. */
export function startNextCycle(userId, planId, today, baseline) {
  db.prepare(
    `UPDATE program_state
       SET cycle = cycle + 1, pos = 0, cycle_started = ?, baseline = ?, pending = NULL, mid = NULL
     WHERE plan_id = ? AND user_id = ?`,
  ).run(today, JSON.stringify(baseline), planId, userId);
}

/** Az érvényes TM-ek: gyakorlatonként a legutolsó sor. */
export function getTrainingMaxes(userId) {
  const out = {};
  for (const row of db
    .prepare('SELECT exercise_name, tm FROM training_maxes WHERE user_id = ? ORDER BY id')
    .all(userId)) {
    out[row.exercise_name] = row.tm;
  }
  return out;
}

/** A TM-előzmény, legújabb elöl. */
export function getTrainingMaxHistory(userId) {
  return db
    .prepare(
      `SELECT exercise_name AS exercise, tm, date, source FROM training_maxes
       WHERE user_id = ? ORDER BY id DESC`,
    )
    .all(userId);
}

export function addTrainingMax(userId, exercise, tm, date, source) {
  db.prepare(
    'INSERT INTO training_maxes (user_id, exercise_name, tm, date, source) VALUES (?, ?, ?, ?, ?)',
  ).run(userId, exercise, tm, date, source);
}

/** Az edzés programnapként jelölése. Csak a még nem jelölt sort írja át,
    így a dupla mentés nem léptet kétszer: igaz, ha most jelölődött. */
export function tagProgramWorkout(userId, workoutId, cycle, pos, readiness) {
  return (
    db
      .prepare(
        `UPDATE workouts SET program_cycle = ?, program_pos = ?, program_readiness = ?
         WHERE id = ? AND user_id = ? AND program_pos IS NULL`,
      )
      .run(cycle, pos, readiness ?? null, workoutId, userId).changes > 0
  );
}

/** A ciklus programnapként jelölt edzései, rögzítési sorrendben. */
export function getCycleWorkouts(userId, planId, cycle) {
  return db
    .prepare(
      `SELECT id, name, date, exercises, plan_id, program_pos, program_readiness FROM workouts
       WHERE user_id = ? AND plan_id = ? AND program_cycle = ? ORDER BY id`,
    )
    .all(userId, planId, cycle)
    .map((row) => ({
      id: row.id,
      name: row.name,
      date: row.date,
      exercises: JSON.parse(row.exercises),
      planId: row.plan_id,
      programPos: row.program_pos,
      programReadiness: row.program_readiness,
    }));
}

const toNum = (v) => Number(String(v ?? '').replace(',', '.'));

/**
 * A „valódi csúcs” gyakorlatonként: a bemondott 1RM és a valaha pipált,
 * pontosan 1 ismétléses szettek közül a nagyobb. Szándékosan nem a
 * `max_1rm`: azt az AMRAP-szettek Epley-becslése is emeli, és akkor egy
 * valódi próba-szingli sem számítana rekordnak.
 */
export function getTrueMaxes(userId) {
  const out = {};
  const bump = (name, kg) => {
    if (kg > 0 && !(out[name] >= kg)) out[name] = kg;
  };
  for (const row of db
    .prepare(
      'SELECT exercise_name, declared_1rm FROM exercise_maxes WHERE user_id = ? AND declared_1rm > 0',
    )
    .all(userId)) {
    bump(row.exercise_name, row.declared_1rm);
  }
  for (const row of db.prepare('SELECT exercises FROM workouts WHERE user_id = ?').all(userId)) {
    for (const e of JSON.parse(row.exercises)) {
      for (const s of e.sets ?? []) {
        if (s.done && toNum(s.reps) === 1) bump(e.name, toNum(s.weight));
      }
    }
  }
  return out;
}
