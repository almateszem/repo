/**
 * Podium — „Előző nap": visszalépés a blokkos programban (F1)
 * -----------------------------------------------------------------------
 * Véletlen befejezés után nem volt visszaút: az edzés törlése nem léptetett
 * vissza, és ugratás csak előre volt. A visszalépés egy napot lép vissza, és
 * a régi edzésről leveszi a programjelölést — különben az újra elvégzett nap
 * mellett a régi is a ciklusban maradna, és a ciklus statisztikái duplán
 * számolnának. Maga az edzés a naplóban marad. Nyitott javaslatnál és
 * jóváhagyásra váró ciklusnál tiltott (mint az ugratás), a ciklus első
 * napjáról pedig nem lehet visszalépni.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'podium-step-back-'));
process.env.PODIUM_DB = path.join(workDir, 'test.db');

const db = await import('../../server/db.js');
const run = await import('../../server/services/program-run.js');
const { workoutTemplate } = await import('../../server/services/session-plan.js');

process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const num = (v, pct = false) => ({ t: 'num', v, pct });
const stat = (k) => ({ t: 'stat', k });
const pctTm = (p) => ({ t: 'op', op: '*', a: num(p, true), b: { t: 'tm' } });
const BURNOUT = {
  on: 'workout',
  when: {
    t: 'cmp',
    op: '<',
    a: stat('doneAll'),
    b: { t: 'op', op: '*', a: num(80, true), b: stat('totalAll') },
  },
  then: { t: 'addPct', pct: -30 },
  otherwise: null,
};
const day = (name) => ({
  name,
  exercises: [
    {
      name: 'Guggolás',
      role: 'main',
      sets: [{ count: 2, reps: 5, amrap: false, weight: pctTm(80) }],
    },
  ],
});
const program = (rules = []) => ({
  weeks: [{ label: '1. hét', days: [day('A nap'), day('B nap')] }],
  rules,
  steps: {},
});

let seq = 0;
const D = (n) => `2026.11.${String(10 + n).padStart(2, '0')}`;
function setup(rules) {
  seq += 1;
  const user = db.createUser(`sb${seq}`, `Teszt ${seq}`, 'scrypt$16384$8$1$aa$bb').user;
  const plan = db.addProgramPlan(user.id, 'Próba', D(0), program(rules));
  const res = run.activateProgram(
    user.id,
    plan,
    { trainingMaxes: { Guggolás: 100 }, oneRms: {} },
    D(0),
  );
  assert.ok(res.plan, JSON.stringify(res));
  return { uid: user.id, plan: db.getPlan(user.id, plan.id) };
}
/** A mai programnap mentése; a `done` dönti el a pipákat. */
function doDay(uid, plan, date, done = true) {
  const t = run.programTemplate(uid, plan, date);
  assert.equal(t.source, 'program');
  const exercises = t.exercises.map((e) => ({
    name: e.name,
    sets: e.sets.map((s) => ({ ...s, done })),
  }));
  const w = db.addWorkout(uid, t.name, date, exercises, plan.id);
  run.onWorkoutSaved(uid, w, date);
  return w;
}
const pos = (uid, plan) => db.getProgramState(uid, plan.id).pos;
const cycleCount = (uid, plan) => db.getCycleWorkouts(uid, plan.id, 1).length;

test('visszalépés: a mutató egyet lép vissza, és újra az előző nap jön', () => {
  const { uid, plan } = setup();
  doDay(uid, plan, D(1));
  assert.equal(pos(uid, plan), 1);
  const st = run.stepBackProgram(uid, plan);
  assert.equal(st.pos, 0);
  assert.equal(run.programTemplate(uid, plan, D(2)).program.title, '1. hét · A nap');
});

test('a régi edzés a naplóban marad, de lekerül a programjelölés — az újra elvégzett nap nem duplázódik', () => {
  const { uid, plan } = setup();
  doDay(uid, plan, D(1));
  assert.equal(cycleCount(uid, plan), 1);
  run.stepBackProgram(uid, plan);
  assert.equal(cycleCount(uid, plan), 0, 'a régi edzés nem számít a ciklusba');
  assert.equal(db.getWorkouts(uid).length, 1, 'de a naplóban megvan');
  doDay(uid, plan, D(2));
  assert.equal(cycleCount(uid, plan), 1);
  assert.equal(pos(uid, plan), 1);
});

test('a ciklus első napjáról nem lehet visszalépni', () => {
  const { uid, plan } = setup();
  assert.match(run.stepBackProgram(uid, plan).error, /első nap/);
  assert.equal(pos(uid, plan), 0);
});

test('nyitott javaslatnál a visszalépés tiltott', () => {
  const { uid, plan } = setup([BURNOUT]);
  doDay(uid, plan, D(1), false);
  assert.ok(db.getProgramState(uid, plan.id).mid);
  assert.match(run.stepBackProgram(uid, plan).error, /dönts/);
  assert.equal(pos(uid, plan), 1);
});

test('jóváhagyásra váró ciklusnál a visszalépés tiltott', () => {
  const { uid, plan } = setup();
  doDay(uid, plan, D(1));
  doDay(uid, plan, D(2));
  assert.ok(db.getProgramState(uid, plan.id).pending);
  assert.match(run.stepBackProgram(uid, plan).error, /hagyd jóvá/);
});

test('a visszalépés a programnap piszkozatát is törli, a sajátot nem', () => {
  const { uid, plan } = setup();
  doDay(uid, plan, D(1));
  const t = run.programTemplate(uid, plan, D(2));
  db.saveWorkoutDraft(uid, t.name, t.exercises, D(2), plan.id);
  run.stepBackProgram(uid, plan);
  assert.equal(workoutTemplate(uid, D(2)).source, 'program');

  doDay(uid, plan, D(2));
  db.saveWorkoutDraft(
    uid,
    'Saját',
    [{ name: 'Húzódzkodás', sets: [{ reps: '8', weight: '', done: true }] }],
    D(3),
  );
  run.stepBackProgram(uid, plan);
  assert.equal(workoutTemplate(uid, D(3)).source, 'draft');
});
