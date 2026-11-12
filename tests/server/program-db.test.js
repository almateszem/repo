/**
 * Podium — a blokkos programok adatrétege (server/db/programs.js)
 * -----------------------------------------------------------------------
 * Programtervek, TM-előzmény, program-állapot, és a „valódi csúcs” (a
 * bemondott és a ténylegesen pipált 1 ismétléses szettek maximuma).
 * Saját ideiglenes adatbázison fut; a db.js-t a PODIUM_DB után importáljuk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'podium-programs-'));
process.env.PODIUM_DB = path.join(workDir, 'test.db');

const db = await import('../../server/db.js');
const { weekFromLegacy } = await import('../../server/plan-week.js');

process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const anna = db.createUser('anna', 'Kovács Anna', 'scrypt$16384$8$1$aa$bb').user;
const bela = db.createUser('bela', 'Nagy Béla', 'scrypt$16384$8$1$cc$dd').user;
const TODAY = '2026.11.12';

const program = {
  weeks: [
    {
      label: '1. hét',
      days: [
        {
          name: 'A',
          exercises: [
            {
              name: 'Guggolás',
              role: 'main',
              sets: [
                {
                  count: 1,
                  reps: 5,
                  amrap: true,
                  weight: { t: 'op', op: '*', a: { t: 'num', v: 85, pct: true }, b: { t: 'tm' } },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  rules: [],
  steps: {},
};

test('addProgramPlan: kind=program, inaktív, a program visszaolvasva azonos', () => {
  const plan = db.addProgramPlan(anna.id, '5/3/1', TODAY, program);
  assert.equal(plan.kind, 'program');
  assert.equal(plan.active, false);
  assert.deepEqual(plan.program, program);
  assert.deepEqual(db.getPlan(anna.id, plan.id).program, program);
});

test('updateProgramPlan egyszerű tervre null, idegen userre null', () => {
  const simple = db.addPlan(
    anna.id,
    'Egyszerű',
    TODAY,
    weekFromLegacy([{ name: 'Guggolás', sets: [{ reps: '5', weight: '100' }] }], [0]),
  );
  assert.equal(simple.kind, 'simple');
  assert.equal(simple.program, null);
  assert.equal(db.updateProgramPlan(anna.id, simple.id, 'x', program), null);
  const prog = db.addProgramPlan(anna.id, 'P', TODAY, program);
  assert.equal(db.updateProgramPlan(bela.id, prog.id, 'x', program), null);
  const changed = { ...program, steps: { Guggolás: 2.5 } };
  assert.deepEqual(db.updateProgramPlan(anna.id, prog.id, 'P2', changed).program, changed);
  // az egyszerű terv átírása programra nem hat
  assert.equal(db.updatePlan(anna.id, prog.id, 'x', simple.week), null);
});

test('training_maxes: a legutolsó érték az érvényes, az előzmény megmarad', () => {
  db.addTrainingMax(anna.id, 'Guggolás', 100, TODAY, 'from1rm');
  db.addTrainingMax(anna.id, 'Guggolás', 70, TODAY, 'rule');
  db.addTrainingMax(anna.id, 'Fekvenyomás', 62.5, TODAY, 'manual');
  assert.deepEqual(db.getTrainingMaxes(anna.id), { Guggolás: 70, Fekvenyomás: 62.5 });
  assert.equal(db.getTrainingMaxHistory(anna.id).length, 3);
  assert.deepEqual(db.getTrainingMaxes(bela.id), {});
});

test('program_state: init egyszer, pos, pending, mid, következő ciklus', () => {
  const plan = db.addProgramPlan(anna.id, 'S', TODAY, program);
  assert.equal(db.getProgramState(anna.id, plan.id), null);
  db.initProgramState(anna.id, plan.id, TODAY, { Guggolás: 110 });
  db.initProgramState(anna.id, plan.id, '2030.01.01', {});
  let st = db.getProgramState(anna.id, plan.id);
  assert.deepEqual(st, {
    cycle: 1,
    pos: 0,
    cycleStarted: TODAY,
    baseline: { Guggolás: 110 },
    pending: null,
    mid: null,
  });
  db.setProgramPos(anna.id, plan.id, 3);
  const sug = [{ exercise: 'Guggolás', current: 100, suggested: 70, reason: 'x' }];
  db.setProgramPending(anna.id, plan.id, sug);
  db.setProgramMid(anna.id, plan.id, sug);
  st = db.getProgramState(anna.id, plan.id);
  assert.equal(st.pos, 3);
  assert.deepEqual(st.pending, sug);
  assert.deepEqual(st.mid, sug);
  db.startNextCycle(anna.id, plan.id, '2026.12.01', { Guggolás: 120 });
  st = db.getProgramState(anna.id, plan.id);
  assert.equal(st.cycle, 2);
  assert.equal(st.pos, 0);
  assert.equal(st.pending, null);
  assert.equal(st.mid, null);
  assert.deepEqual(st.baseline, { Guggolás: 120 });
  assert.equal(db.getProgramState(bela.id, plan.id), null);
});

test('tagProgramWorkout: első hívás true, második false', () => {
  const plan = db.addProgramPlan(anna.id, 'T', TODAY, program);
  const w = db.addWorkout(
    anna.id,
    'Edzés',
    TODAY,
    [{ name: 'Guggolás', sets: [{ reps: '5', weight: '85', rpe: '', type: 'work', done: true }] }],
    plan.id,
  );
  assert.equal(db.tagProgramWorkout(bela.id, w.id, 1, 0, 70), false);
  assert.equal(db.tagProgramWorkout(anna.id, w.id, 1, 0, 70), true);
  assert.equal(db.tagProgramWorkout(anna.id, w.id, 1, 1, 70), false);
  const cyc = db.getCycleWorkouts(anna.id, plan.id, 1);
  assert.equal(cyc.length, 1);
  assert.equal(cyc[0].programPos, 0);
  assert.equal(cyc[0].programReadiness, 70);
  assert.deepEqual(db.getCycleWorkouts(anna.id, plan.id, 2), []);
});

test('getTrueMaxes: a bemondott 100 és a pipált 1×105 közül 105; az 5×110 AMRAP nem számít', () => {
  const set = (weight, reps, done = true) => ({
    reps: String(reps),
    weight: String(weight),
    rpe: '',
    type: 'work',
    done,
  });
  db.setDeclaredMax(bela.id, 'Fekvenyomás', 100, TODAY);
  db.setDeclaredMax(bela.id, 'Felhúzás', 200, TODAY);
  db.addWorkout(bela.id, 'E1', TODAY, [
    { name: 'Fekvenyomás', sets: [set(110, 5), set(105, 1), set(120, 1, false)] },
    { name: 'Guggolás', sets: [set(140, 1)] },
  ]);
  assert.deepEqual(db.getTrueMaxes(bela.id), { Fekvenyomás: 105, Felhúzás: 200, Guggolás: 140 });
});

test('getUserPlanSchedules: aktív programra üres lista', () => {
  const plan = db.addProgramPlan(bela.id, 'Aktív', TODAY, program);
  db.setActivePlan(bela.id, plan.id, true, TODAY);
  assert.equal(db.getActivePlan(bela.id).kind, 'program');
  assert.deepEqual(db.getUserPlanSchedules(bela.id), []);
});
