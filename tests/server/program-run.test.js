/**
 * Podium — a blokkos program futtatása (server/services/program-run.js)
 * -----------------------------------------------------------------------
 * Aktiválás (TM-ek bekérése), a mai programnap kiszámolt súlyokkal, a
 * léptetés az elvégzett edzések szerint, ugratás, ciklus végi és ciklus
 * közbeni TM-javaslat, és a jóváhagyás. Saját ideiglenes adatbázison fut.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'podium-program-run-'));
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
const VIKTOR_RULE = {
  on: 'cycle',
  when: { t: 'record' },
  then: { t: 'set', formula: { t: 'op', op: '*', a: num(95, true), b: { t: 'newOrm' } } },
  otherwise: { t: 'step' },
};
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
const PAIN = {
  on: 'workout',
  when: { t: 'cmp', op: '>=', a: stat('pain'), b: num(7) },
  then: { t: 'addPct', pct: -30 },
  otherwise: null,
};

const program = (rules = [VIKTOR_RULE]) => ({
  weeks: [
    {
      label: '1. hét',
      days: [
        {
          name: 'Guggolásnap',
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
            {
              name: 'Kitörés',
              role: 'accessory',
              sets: [{ count: 5, reps: 10, amrap: false, weight: num(20) }],
            },
          ],
        },
        {
          name: 'Nyomásnap',
          exercises: [
            {
              name: 'Fekvenyomás',
              role: 'main',
              sets: [{ count: 1, reps: 5, amrap: false, weight: pctTm(70) }],
            },
          ],
        },
      ],
    },
    {
      label: '2. hét – 1RM-próba',
      days: [
        {
          name: 'Guggolás-próba',
          exercises: [
            {
              name: 'Guggolás',
              role: 'main',
              sets: [{ count: 1, reps: 1, amrap: false, weight: null }],
            },
          ],
        },
        {
          name: 'Nyomás-próba',
          exercises: [
            {
              name: 'Fekvenyomás',
              role: 'main',
              sets: [{ count: 1, reps: 1, amrap: false, weight: null }],
            },
          ],
        },
      ],
    },
  ],
  rules,
  steps: {},
});

let userSeq = 0;
const D = (n) => `2026.11.${String(10 + n).padStart(2, '0')}`;
function setup(rules) {
  userSeq += 1;
  const user = db.createUser(`u${userSeq}`, `Teszt ${userSeq}`, 'scrypt$16384$8$1$aa$bb').user;
  db.setDeclaredMax(user.id, 'Guggolás', 110, D(0));
  const plan = db.addProgramPlan(user.id, '5/3/1', D(0), program(rules));
  return { uid: user.id, plan };
}
function activate(uid, plan, tms = { Guggolás: 100, Fekvenyomás: 60 }) {
  const res = run.activateProgram(uid, plan, { trainingMaxes: tms, oneRms: {} }, D(0));
  assert.ok(res.plan, JSON.stringify(res));
  return res.plan;
}
/** A mai programnap mentése: a sablon szettjei, a `mark` dönti el a pipát és az értékeket. */
function doDay(uid, plan, date, mark = (s) => ({ ...s, done: true })) {
  const t = run.programTemplate(uid, db.getPlan(uid, plan.id), date);
  assert.equal(t.source, 'program');
  const exercises = t.exercises.map((e, ei) => ({
    name: e.name,
    sets: e.sets.map((s, si) => mark(s, ei, si, e.name)),
  }));
  const w = db.addWorkout(uid, t.name, date, exercises, plan.id);
  run.onWorkoutSaved(uid, w, date);
  return w;
}
const state = (uid, plan) => db.getProgramState(uid, plan.id);

test('activationNeeds: 1RM 110 → javasolt TM 100 (99 kerekítve); 1RM nélkül null', () => {
  const { uid, plan } = setup();
  assert.deepEqual(run.activationNeeds(uid, plan), {
    trainingMaxes: [
      { exercise: 'Guggolás', suggested: 100 },
      { exercise: 'Fekvenyomás', suggested: null },
    ],
    oneRms: [],
  });
});

test('activateProgram hiányzó TM-mel → error + needs, a terv nem aktív', () => {
  const { uid, plan } = setup();
  const res = run.activateProgram(
    uid,
    plan,
    { trainingMaxes: { Guggolás: 100 }, oneRms: {} },
    D(0),
  );
  assert.equal(res.error, 'Hiányzó értékek');
  assert.equal(res.needs.trainingMaxes.length, 2);
  assert.equal(db.getPlan(uid, plan.id).active, false);
  assert.equal(state(uid, plan), null);
});

test('programTemplate: 1. hét 1. nap, 85 kg-os AMRAP amrap:5-tel, program.title „1. hét · Guggolásnap”', () => {
  const { uid, plan } = setup();
  const active = activate(uid, plan);
  assert.equal(active.active, true);
  const t = run.programTemplate(uid, active, D(1));
  assert.equal(t.source, 'program');
  assert.equal(t.planId, plan.id);
  assert.deepEqual(t.program, { cycle: 1, pos: 0, total: 4, title: '1. hét · Guggolásnap' });
  assert.deepEqual(
    t.exercises[0].sets.map((s) => s.weight),
    ['65', '75', '85'],
  );
  assert.equal(t.exercises[0].sets[2].amrap, 5);
  assert.equal(t.exercises[1].sets.length, 5);
  assert.deepEqual(t.missing, []);
  const hist = db.getTrainingMaxHistory(uid);
  assert.equal(hist.find((h) => h.exercise === 'Guggolás').source, 'from1rm');
  assert.equal(hist.find((h) => h.exercise === 'Fekvenyomás').source, 'manual');
  // a mai sablon is a programnap
  assert.equal(workoutTemplate(uid, D(1)).source, 'program');
});

test('hiányzó TM: üres súly és missing lista', () => {
  const { uid, plan } = setup();
  activate(uid, plan);
  const p = program();
  p.weeks[0].days[0].exercises.push({
    name: 'Felhúzás',
    role: 'accessory',
    sets: [{ count: 1, reps: 5, amrap: false, weight: pctTm(70) }],
  });
  db.updateProgramPlan(uid, plan.id, '5/3/1', p);
  const t = run.programTemplate(uid, db.getPlan(uid, plan.id), D(1));
  assert.equal(t.exercises[2].sets[0].weight, '');
  assert.deepEqual(t.missing, [{ kind: 'tm', exercise: 'Felhúzás' }]);
});

test('onWorkoutSaved: a pos 1-re lép; az utolsó nap után program-review jön a javaslatokkal', () => {
  const { uid, plan } = setup();
  activate(uid, plan);
  const w = doDay(uid, plan, D(1));
  assert.equal(state(uid, plan).pos, 1);
  run.onWorkoutSaved(uid, w, D(1)); // ugyanaz az edzés még egyszer
  assert.equal(state(uid, plan).pos, 1, 'dupla mentés nem léptet kétszer');
  doDay(uid, plan, D(2));
  doDay(uid, plan, D(3), (s) => ({ ...s, weight: '120', done: true }));
  // a nyomás-próba elmarad (nincs pipa): ott nincs rekord, lépésköz jön
  doDay(uid, plan, D(4), (s) => ({ ...s, weight: '60', done: false }));
  const t = run.programTemplate(uid, db.getPlan(uid, plan.id), D(5));
  assert.equal(t.source, 'program-review');
  const g = t.suggestions.find((s) => s.exercise === 'Guggolás');
  assert.equal(g.suggested, 115);
  assert.match(g.reason, /Új 1RM-rekord: 120 kg/);
  assert.equal(t.suggestions.find((s) => s.exercise === 'Fekvenyomás').suggested, 62.5);
});

test('skipProgram week → a következő hét eleje; cycle-end → review', () => {
  const { uid, plan } = setup();
  activate(uid, plan);
  run.skipProgram(uid, plan, 'week');
  assert.equal(state(uid, plan).pos, 2);
  run.skipProgram(uid, plan, 'cycle-end');
  assert.ok(state(uid, plan).pending);
  assert.deepEqual(run.skipProgram(uid, plan, 'day'), {
    error: 'A ciklus lezárult — előbb hagyd jóvá a TM-eket.',
  });
});

test('approveReview: az új TM-mel számol a 2. ciklus, és a baseline az új csúcs', () => {
  const { uid, plan } = setup();
  activate(uid, plan);
  run.skipProgram(uid, plan, 'week');
  doDay(uid, plan, D(1), (s) => ({ ...s, weight: '120', done: true }));
  run.skipProgram(uid, plan, 'cycle-end');
  const st = run.approveReview(uid, plan, { Fekvenyomás: 65 }, D(2));
  assert.equal(st.cycle, 2);
  assert.equal(st.pos, 0);
  assert.equal(st.pending, null);
  assert.deepEqual(st.baseline, { Guggolás: 120 });
  assert.deepEqual(db.getTrainingMaxes(uid), { Guggolás: 115, Fekvenyomás: 65 });
  const t = run.programTemplate(uid, db.getPlan(uid, plan.id), D(3));
  assert.equal(t.exercises[0].sets[2].weight, '97.5'); // 85% × 115 = 97,75
});

test('AMRAP-becslés nem rontja el a rekordot: 5×110 AMRAP (Epley 128) után a 1×120 próba rekord, 1RM előtte 110', () => {
  const { uid, plan } = setup();
  activate(uid, plan);
  doDay(uid, plan, D(1), (s, ei, si) =>
    ei === 0 && si === 2 ? { ...s, weight: '110', done: true } : { ...s, done: true },
  );
  run.skipProgram(uid, plan, 'cycle-end');
  run.approveReview(uid, plan, {}, D(2));
  assert.ok(db.getExerciseMax(uid, 'Guggolás').max1rm > 120, 'az Epley-csúcs 120 fölött');
  assert.deepEqual(state(uid, plan).baseline, { Guggolás: 110 });
  run.skipProgram(uid, plan, 'week');
  doDay(uid, plan, D(3), (s) => ({ ...s, weight: '120', done: true }));
  run.skipProgram(uid, plan, 'cycle-end');
  const g = state(uid, plan).pending.find((s) => s.exercise === 'Guggolás');
  assert.equal(g.suggested, 115);
  assert.match(g.reason, /Új 1RM-rekord: 120 kg/);
});

test('kiégés edzésszabály: 8-ból 2 pipált → program-mid −30%-kal; elfogadás után a következő nap a 70%-os TM-mel számol, rule forrással', () => {
  const { uid, plan } = setup([BURNOUT, VIKTOR_RULE]);
  activate(uid, plan);
  doDay(uid, plan, D(1), (s, ei, si) => ({ ...s, done: ei === 0 && si < 2 }));
  const t = run.programTemplate(uid, db.getPlan(uid, plan.id), D(2));
  assert.equal(t.source, 'program-mid');
  assert.equal(t.program.title, '1. hét · Nyomásnap');
  assert.deepEqual(
    t.suggestions.map((s) => [s.exercise, s.current, s.suggested]),
    [
      ['Guggolás', 100, 70],
      ['Fekvenyomás', 60, 42.5],
    ],
  );
  assert.match(
    t.suggestions[0].reason,
    /^minden edzés után: teljesített \(mind\) = 2 < 80% × összes \(mind\) = 6,4$/,
  );
  assert.deepEqual(run.skipProgram(uid, plan, 'day'), {
    error: 'Előbb dönts a szabály javaslatáról.',
  });
  run.decideMid(uid, plan, {}, D(2));
  assert.deepEqual(db.getTrainingMaxes(uid), { Guggolás: 70, Fekvenyomás: 42.5 });
  assert.equal(db.getTrainingMaxHistory(uid)[0].source, 'rule');
  const next = run.programTemplate(uid, db.getPlan(uid, plan.id), D(2));
  assert.equal(next.source, 'program');
  assert.equal(next.exercises[0].sets[0].weight, '30'); // 70% × 42,5 = 29,75
});

test('fájdalomszabály a check-inből: a napi pain.general 8 → program-mid', () => {
  const { uid, plan } = setup([PAIN]);
  activate(uid, plan);
  db.saveCheckin(uid, D(1), { pain: { general: 8, quads: 2 } });
  doDay(uid, plan, D(1));
  const t = run.programTemplate(uid, db.getPlan(uid, plan.id), D(2));
  assert.equal(t.source, 'program-mid');
  assert.match(t.suggestions[0].reason, /fájdalom = 8 ≥ 7/);
});

test('decideMid null → a TM marad, jön a következő nap', () => {
  const { uid, plan } = setup([PAIN]);
  activate(uid, plan);
  db.saveCheckin(uid, D(1), { pain: { general: 9 } });
  doDay(uid, plan, D(1));
  const st = run.decideMid(uid, plan, null, D(2));
  assert.equal(st.mid, null);
  assert.deepEqual(db.getTrainingMaxes(uid), { Guggolás: 100, Fekvenyomás: 60 });
  assert.equal(run.programTemplate(uid, db.getPlan(uid, plan.id), D(2)).source, 'program');
  assert.deepEqual(run.decideMid(uid, plan, null, D(2)), { error: 'Nincs függő javaslat.' });
});

test('szerkesztés után a pozíció a program végére szorul', () => {
  const { uid, plan } = setup();
  activate(uid, plan);
  run.skipProgram(uid, plan, 'week');
  run.skipProgram(uid, plan, 'day');
  assert.equal(state(uid, plan).pos, 3);
  const p = program();
  p.weeks = [p.weeks[0]];
  db.updateProgramPlan(uid, plan.id, '5/3/1', p);
  run.clampAfterEdit(uid, db.getPlan(uid, plan.id));
  assert.equal(state(uid, plan).pos, 1);
});

test('workoutTemplate: a mai piszkozat elsőbbséget kap a programnappal szemben', () => {
  const { uid, plan } = setup();
  activate(uid, plan);
  db.saveWorkoutDraft(
    uid,
    'Saját',
    [
      {
        name: 'Húzódzkodás',
        sets: [{ reps: '8', weight: '', rpe: '', type: 'work', done: false }],
      },
    ],
    D(1),
  );
  assert.equal(workoutTemplate(uid, D(1)).source, 'draft');
  assert.equal(workoutTemplate(uid, D(2)).source, 'program');
});
