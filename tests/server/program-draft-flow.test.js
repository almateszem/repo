/**
 * Podium — a programnap piszkozata, mentése és az ugratás (HTTP)
 * -----------------------------------------------------------------------
 * P5: a programnap aznapi piszkozata „piszkozatként" jön vissza — mostantól
 *     a program helyzetével együtt, különben újratöltés után a felület nem
 *     tudja, hogy programnap (eltűnik a sáv, a befejezés után nem jön a
 *     következő nap).
 * P3: nyitott ciklus közbeni javaslat mellett a programnap mentése 409 —
 *     korábban a pozíció lépett, de a határ-szabályok végleg kimaradtak.
 *     A piszkozat megmarad, a döntés után a mentés megy.
 * P4: az ugratás és a program kikapcsolása a programnap mai piszkozatát is
 *     törli — különben a régi nap a szerkesztőben maradt, és befejezhető volt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom } from './test-harness.js';

const { request } = await startServer({ label: 'program-draft-flow' });

let seq = 0;
async function register() {
  seq += 1;
  const res = await request('POST', '/api/auth/register', {
    body: { username: `pdf${seq}`, displayName: `Teszt ${seq}`, password: 'jelszo123' },
  });
  assert.equal(res.status, 201);
  return cookieFrom(res);
}

const num = (v, pct = false) => ({ t: 'num', v, pct });
const stat = (k) => ({ t: 'stat', k });
const pctTm = (p) => ({ t: 'op', op: '*', a: num(p, true), b: { t: 'tm' } });
/** Kevés pipált szett → minden TM −30%: az első nap után javaslat nyílik. */
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
  weeks: [{ label: '1. hét', days: [day('A nap'), day('B nap'), day('C nap')] }],
  rules,
  steps: {},
});

async function activeProgram(cookie, rules) {
  const created = await request('POST', '/api/programs', {
    cookie,
    body: { name: 'Próbaprogram', program: program(rules) },
  });
  assert.equal(created.status, 201);
  const id = created.json.id;
  const act = await request('POST', `/api/programs/${id}/activate`, {
    cookie,
    body: { trainingMaxes: { Guggolás: 100 }, oneRms: {} },
  });
  assert.equal(act.status, 200);
  return id;
}

const template = async (cookie) => (await request('GET', '/api/workout-template', { cookie })).json;

/** A mai programnap — piszkozatként elmentve (mintha egy szettet kipipált volna). */
async function draftToday(cookie) {
  const t = await template(cookie);
  assert.equal(t.source, 'program');
  const exercises = t.exercises.map((e) => ({
    name: e.name,
    sets: e.sets.map((s, i) => ({ ...s, done: i === 0 })),
  }));
  const res = await request('PUT', '/api/workout-draft', {
    cookie,
    body: { name: t.name, exercises, planId: t.planId },
  });
  assert.equal(res.status, 200);
  return { name: t.name, exercises, planId: t.planId };
}

const save = (cookie, body) => request('POST', '/api/workouts', { cookie, body });

test('P5: a programnap piszkozata a program helyzetével jön vissza', async () => {
  const cookie = await register();
  const id = await activeProgram(cookie);
  await draftToday(cookie);
  const t = await template(cookie);
  assert.equal(t.source, 'draft');
  assert.equal(t.planId, id);
  assert.equal(t.program.title, '1. hét · A nap');
  assert.equal(t.program.pos, 0);
  assert.equal(t.program.total, 3);
  assert.deepEqual(t.missing, []);
  assert.equal(t.mid ?? null, null);
  assert.equal(t.exercises[0].sets[0].done, true, 'a piszkozat tartalma marad');
});

test('P5: a nem-programos piszkozat nem kap program-adatot', async () => {
  const cookie = await register();
  await activeProgram(cookie);
  await request('PUT', '/api/workout-draft', {
    cookie,
    body: {
      name: 'Saját',
      exercises: [{ name: 'Húzódzkodás', sets: [{ reps: '8', weight: '', done: true }] }],
    },
  });
  const t = await template(cookie);
  assert.equal(t.source, 'draft');
  assert.equal(t.program, undefined);
});

test('P3: nyitott javaslat mellett a programnap mentése 409, a piszkozat és a javaslat megmarad', async () => {
  const cookie = await register();
  const id = await activeProgram(cookie, [BURNOUT]);
  // Az 1. nap kevés pipával → javaslat nyílik
  const first = await template(cookie);
  const res1 = await save(cookie, {
    name: first.name,
    planId: first.planId,
    exercises: first.exercises.map((e) => ({
      name: e.name,
      sets: e.sets.map((s) => ({ ...s, done: false })),
    })),
  });
  assert.equal(res1.status, 201);
  assert.equal((await template(cookie)).source, 'program-mid');

  // Egy másik eszközön a 2. nap már a szerkesztőben állt (régi kliens)
  const stale = { name: '1. hét · B nap', planId: id, exercises: first.exercises };
  await request('PUT', '/api/workout-draft', { cookie, body: stale });
  const blocked = await save(cookie, stale);
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /dönts/i);
  assert.equal((await request('GET', '/api/workouts', { cookie })).json.length, 1);

  const t = await template(cookie);
  assert.equal(t.source, 'draft', 'a piszkozat megmaradt');
  assert.ok(Array.isArray(t.mid) && t.mid.length > 0, 'a javaslat a piszkozat mellett is látszik');

  // Döntés után a mentés megy, és a 2. napra lép
  const decided = await request('POST', `/api/programs/${id}/mid`, {
    cookie,
    body: { decisions: {} },
  });
  assert.equal(decided.status, 200);
  const ok = await save(cookie, stale);
  assert.equal(ok.status, 201);
  const info = await request('GET', `/api/programs/${id}`, { cookie });
  assert.equal(info.json.state.pos, 2);
});

test('P3: programon kívüli edzés nyitott javaslat mellett is menthető', async () => {
  const cookie = await register();
  await activeProgram(cookie, [BURNOUT]);
  const first = await template(cookie);
  await save(cookie, {
    name: first.name,
    planId: first.planId,
    exercises: first.exercises.map((e) => ({ name: e.name, sets: e.sets })),
  });
  const own = await save(cookie, {
    name: 'Saját futás',
    exercises: [{ name: 'Húzódzkodás', sets: [{ reps: '8', weight: '', done: true }] }],
  });
  assert.equal(own.status, 201);
});

test('P4: az ugratás törli a programnap mai piszkozatát — a következő nap jön', async () => {
  const cookie = await register();
  const id = await activeProgram(cookie);
  await draftToday(cookie);
  const skip = await request('POST', `/api/programs/${id}/skip`, { cookie, body: { to: 'day' } });
  assert.equal(skip.status, 200);
  const t = await template(cookie);
  assert.equal(t.source, 'program');
  assert.equal(t.program.title, '1. hét · B nap');
});

test('P4: az ugratás a programon kívüli piszkozathoz nem nyúl', async () => {
  const cookie = await register();
  const id = await activeProgram(cookie);
  await request('PUT', '/api/workout-draft', {
    cookie,
    body: {
      name: 'Saját',
      exercises: [{ name: 'Húzódzkodás', sets: [{ reps: '8', weight: '', done: true }] }],
    },
  });
  await request('POST', `/api/programs/${id}/skip`, { cookie, body: { to: 'day' } });
  const t = await template(cookie);
  assert.equal(t.source, 'draft');
  assert.equal(t.name, 'Saját');
});

test('P4: a program kikapcsolása törli a programnap mai piszkozatát', async () => {
  const cookie = await register();
  const id = await activeProgram(cookie);
  await draftToday(cookie);
  const off = await request('POST', `/api/plans/${id}/active`, {
    cookie,
    body: { active: false },
  });
  assert.equal(off.status, 200);
  const t = await template(cookie);
  assert.notEqual(t?.source, 'draft');
});
