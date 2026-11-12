/**
 * Podium — a blokkos programok API-ja (HTTP)
 * -----------------------------------------------------------------------
 * Egy rövid, teljes ciklus a valódi szerveren: létrehozás, aktiválás, a mai
 * programnap, léptetés mentéssel, ciklus végi és ciklus közbeni jóváhagyás,
 * ugratás, szerkesztés, és az idegen fiók kizárása.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom } from './test-harness.js';

const { request } = await startServer({ label: 'programs' });

async function register(username) {
  const res = await request('POST', '/api/auth/register', {
    body: { username, displayName: username, password: 'jelszo123' },
  });
  assert.equal(res.status, 201);
  return cookieFrom(res);
}

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
const program = (rules = [VIKTOR_RULE]) => ({
  weeks: [
    {
      label: '1. hét',
      days: [
        {
          name: 'Fő nap',
          exercises: [
            {
              name: 'Guggolás',
              role: 'main',
              sets: [{ count: 1, reps: 5, amrap: true, weight: pctTm(85) }],
            },
            {
              name: 'Fekvenyomás',
              role: 'main',
              sets: [{ count: 1, reps: 5, amrap: false, weight: pctTm(70) }],
            },
          ],
        },
        {
          name: 'Próba',
          exercises: [
            {
              name: 'Guggolás',
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
const TMS = { Guggolás: 100, Fekvenyomás: 60 };

async function activeProgram(cookie, rules) {
  const created = await request('POST', '/api/programs', {
    cookie,
    body: { name: '5/3/1', program: program(rules) },
  });
  assert.equal(created.status, 201);
  const id = created.json.id;
  const act = await request('POST', `/api/programs/${id}/activate`, {
    cookie,
    body: { trainingMaxes: TMS, oneRms: {} },
  });
  assert.equal(act.status, 200);
  return id;
}
/** A mai sablon mentése edzésként; a `mark` alakítja a szetteket. */
async function finishToday(cookie, mark = (s) => ({ ...s, done: true })) {
  const t = (await request('GET', '/api/workout-template', { cookie })).json;
  assert.equal(t.source, 'program');
  const body = {
    name: t.name,
    planId: t.planId,
    exercises: t.exercises.map((e) => ({ name: e.name, sets: e.sets.map(mark) })),
  };
  const res = await request('POST', '/api/workouts', { cookie, body });
  assert.equal(res.status, 201);
  return body;
}

const anna = await register('anna');
const bela = await register('bela');

test('POST /api/programs érvénytelen programmal 400, magyar hibaüzenettel', async () => {
  const res = await request('POST', '/api/programs', {
    cookie: anna,
    body: { name: 'Üres', program: { weeks: [], rules: [], steps: {} } },
  });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'A programnak legalább egy hete kell legyen.');
  const noName = await request('POST', '/api/programs', {
    cookie: anna,
    body: { name: '  ', program: program() },
  });
  assert.equal(noName.status, 400);
});

test('aktiválás TM nélkül 400 + needs; TM-mel 200, a workout-template program-forrású 85 kg-mal', async () => {
  const created = await request('POST', '/api/programs', {
    cookie: anna,
    body: { name: '5/3/1', program: program() },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.kind, 'program');
  const id = created.json.id;
  const needs = await request('GET', `/api/programs/${id}/activation`, { cookie: anna });
  assert.deepEqual(
    needs.json.trainingMaxes.map((n) => n.exercise),
    ['Guggolás', 'Fekvenyomás'],
  );
  const bad = await request('POST', `/api/programs/${id}/activate`, {
    cookie: anna,
    body: { trainingMaxes: { Guggolás: 100 }, oneRms: {} },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.needs.trainingMaxes.length, 2);
  const badNum = await request('POST', `/api/programs/${id}/activate`, {
    cookie: anna,
    body: { trainingMaxes: { Guggolás: 100, Fekvenyomás: -5 }, oneRms: {} },
  });
  assert.equal(badNum.status, 400);
  const ok = await request('POST', `/api/programs/${id}/activate`, {
    cookie: anna,
    body: { trainingMaxes: TMS, oneRms: {} },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.plan.active, true);
  const t = await request('GET', '/api/workout-template', { cookie: anna });
  assert.equal(t.json.source, 'program');
  assert.equal(t.json.exercises[0].sets[0].weight, '85');
  assert.equal(t.json.exercises[0].sets[0].amrap, 5);
  assert.equal(t.json.program.title, '1. hét · Fő nap');
  const tms = await request('GET', '/api/training-maxes', { cookie: anna });
  assert.deepEqual(tms.json, TMS);
});

test('a program kézi aktiválása a /api/plans/:id/active úton 409', async () => {
  const created = await request('POST', '/api/programs', {
    cookie: anna,
    body: { name: 'Másik', program: program() },
  });
  const res = await request('POST', `/api/plans/${created.json.id}/active`, {
    cookie: anna,
    body: { active: true },
  });
  assert.equal(res.status, 409);
});

test('dupla mentés nem léptet kétszer; az AMRAP-jelölés a naplóban megmarad', async () => {
  const cookie = await register('dupla');
  const id = await activeProgram(cookie);
  const body = await finishToday(cookie, (s) => ({ ...s, reps: '8', done: true }));
  await request('POST', '/api/workouts', { cookie, body });
  const st = await request('GET', `/api/programs/${id}`, { cookie });
  assert.equal(st.json.state.pos, 1);
  const log = await request('GET', '/api/workouts', { cookie });
  assert.equal(log.json.length, 1);
  assert.equal(log.json[0].exercises[0].sets[0].amrap, 5);
});

test('a 2. nap után review: rekordnál 95%, a jóváhagyás után az 1. nap új súllyal jön', async () => {
  const cookie = await register('ciklus');
  const id = await activeProgram(cookie);
  await finishToday(cookie);
  await finishToday(cookie, (s) => ({ ...s, weight: '120', done: true }));
  const t = await request('GET', '/api/workout-template', { cookie });
  assert.equal(t.json.source, 'program-review');
  const review = await request('GET', `/api/programs/${id}/review`, { cookie });
  const g = review.json.suggestions.find((s) => s.exercise === 'Guggolás');
  assert.equal(g.suggested, 115);
  const badDecision = await request('POST', `/api/programs/${id}/review`, {
    cookie,
    body: { decisions: { Guggolás: 'abc' } },
  });
  assert.equal(badDecision.status, 400);
  const ok = await request('POST', `/api/programs/${id}/review`, {
    cookie,
    body: { decisions: {} },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.cycle, 2);
  const next = await request('GET', '/api/workout-template', { cookie });
  assert.equal(next.json.exercises[0].sets[0].weight, '97.5');
  assert.equal((await request('GET', `/api/programs/${id}/review`, { cookie })).status, 404);
});

test('edzésszabály → program-mid; POST mid elfogadással a TM-előzményben rule forrás', async () => {
  const cookie = await register('kieges');
  const id = await activeProgram(cookie, [BURNOUT, VIKTOR_RULE]);
  await finishToday(cookie, (s) => ({ ...s, done: false }));
  const t = await request('GET', '/api/workout-template', { cookie });
  assert.equal(t.json.source, 'program-mid');
  const skip = await request('POST', `/api/programs/${id}/skip`, { cookie, body: { to: 'day' } });
  assert.equal(skip.status, 409);
  const ok = await request('POST', `/api/programs/${id}/mid`, {
    cookie,
    body: { decisions: { Fekvenyomás: 45 } },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.mid, null);
  const info = await request('GET', `/api/programs/${id}`, { cookie });
  assert.deepEqual(info.json.trainingMaxes, { Guggolás: 70, Fekvenyomás: 45 });
  assert.equal(info.json.history[0].source, 'rule');
  const again = await request('POST', `/api/programs/${id}/mid`, {
    cookie,
    body: { reject: true },
  });
  assert.equal(again.status, 409);
});

test('szerkesztés után a pozíció a program végére szorul', async () => {
  const cookie = await register('szerk');
  const id = await activeProgram(cookie);
  const skip = await request('POST', `/api/programs/${id}/skip`, { cookie, body: { to: 'day' } });
  assert.equal(skip.json.pos, 1);
  const shorter = program();
  shorter.weeks[0].days = [shorter.weeks[0].days[0]];
  const put = await request('PUT', `/api/programs/${id}`, {
    cookie,
    body: { name: 'Rövid', program: shorter },
  });
  assert.equal(put.status, 200);
  assert.equal(put.json.name, 'Rövid');
  const st = await request('GET', `/api/programs/${id}`, { cookie });
  assert.equal(st.json.state.pos, 0);
});

test('MÁS fiók programja: GET/PUT/skip/review/mid 404', async () => {
  const id = await activeProgram(await register('tulaj'));
  const calls = [
    ['GET', `/api/programs/${id}`],
    ['PUT', `/api/programs/${id}`, { name: 'x', program: program() }],
    ['GET', `/api/programs/${id}/activation`],
    ['POST', `/api/programs/${id}/activate`, { trainingMaxes: TMS, oneRms: {} }],
    ['POST', `/api/programs/${id}/skip`, { to: 'day' }],
    ['GET', `/api/programs/${id}/review`],
    ['POST', `/api/programs/${id}/review`, { decisions: {} }],
    ['POST', `/api/programs/${id}/mid`, { reject: true }],
  ];
  for (const [method, url, body] of calls) {
    const res = await request(method, url, { cookie: bela, body });
    assert.equal(res.status, 404, `${method} ${url}`);
  }
});

test('GET /api/programs/:id defaultSteps: Guggolás 5, Fekvenyomás 2,5', async () => {
  const cookie = await register('lepes');
  const id = await activeProgram(cookie);
  const res = await request('GET', `/api/programs/${id}`, { cookie });
  assert.deepEqual(res.json.defaultSteps, { Guggolás: 5, Fekvenyomás: 2.5 });
  assert.equal(res.json.plan.kind, 'program');
});

test('a meglévő egyszerű terv viselkedése változatlan (GET /api/plans kind:"simple"), a program helyzetet mutat', async () => {
  const cookie = await register('vegyes');
  const simple = await request('POST', '/api/plans', {
    cookie,
    body: {
      name: 'Egyszerű',
      exercises: [{ name: 'Guggolás', sets: [{ reps: '5', weight: '100' }] }],
      days: [0, 3],
    },
  });
  assert.equal(simple.status, 201);
  await activeProgram(cookie);
  const plans = (await request('GET', '/api/plans', { cookie })).json;
  const s = plans.find((p) => p.name === 'Egyszerű');
  const p = plans.find((x) => x.name === '5/3/1');
  assert.equal(s.kind, 'simple');
  assert.equal(s.active, false);
  assert.equal(p.kind, 'program');
  assert.deepEqual(p.state, {
    cycle: 1,
    pos: 0,
    total: 2,
    title: '1. hét · Fő nap',
    review: false,
    mid: false,
  });
});
