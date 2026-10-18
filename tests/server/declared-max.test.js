/**
 * Podium — a bemondott csúcs külön él a mért mellett
 * ------------------------------------------------------------------
 * Gyakorlatonként egy sor van; korábban egy mért szett ugyanazt a sort írta
 * át `source = 'measured'`-re, és a bemondott érték megsemmisült. Egy elgépelt,
 * majd javított edzés után a csúcs a javított (alacsonyabb) értékre esett, a
 * bemondás nélkül. A bemondás most külön oszlopban marad (declared_1rm), és a
 * csúcs a közös szabályt követi: a bemondott és a mért közül a NAGYOBB.
 *
 * Adatréteg-szintű teszt, eldobható adatbázison (a db.js importkor nyit).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'podium-declared-'));
process.env.PODIUM_DB = path.join(workDir, 'declared.db');
const db = await import('../../server/db.js');
after(() => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

let seq = 0;
const newUser = () => db.createUser(`bemondo${++seq}`, `Bemondó ${seq}`, 'x').user.id;
const bench = (weight, reps) => [
  {
    name: 'Fekvenyomás',
    sets: [{ reps: String(reps), weight: String(weight), rpe: '8', type: 'work', done: true }],
  },
];

test('bemondott 100 → elgépelt 5×180 → javítás 5×80: a csúcs a bemondott 100', () => {
  const userId = newUser();
  db.setDeclaredMax(userId, 'Fekvenyomás', 100, '2026.10.01');
  const saved = db.addWorkout(userId, 'Mellnap', '2026.10.02', bench(180, 5));
  assert.equal(db.getExerciseMax(userId, 'Fekvenyomás').source, 'measured', 'az elgépelés mért');

  db.updateWorkout(userId, saved.id, 'Mellnap', bench(80, 5));
  assert.deepEqual(db.getExerciseMax(userId, 'Fekvenyomás'), {
    max1rm: 100,
    date: '2026.10.01',
    source: 'declared',
  });
});

test('ugyanez törléssel: a bemondott 100 marad', () => {
  const userId = newUser();
  db.setDeclaredMax(userId, 'Fekvenyomás', 100, '2026.10.01');
  const saved = db.addWorkout(userId, 'Mellnap', '2026.10.02', bench(180, 5));
  db.deleteWorkout(userId, saved.id);
  const max = db.getExerciseMax(userId, 'Fekvenyomás');
  assert.equal(max.max1rm, 100);
  assert.equal(max.source, 'declared');
});

test('mért csúcs után ALACSONYABB bemondás: a mért marad, de a bemondás eltárolódik', () => {
  const userId = newUser();
  const saved = db.addWorkout(userId, 'Mellnap', '2026.10.02', bench(120, 1));
  const result = db.setDeclaredMax(userId, 'Fekvenyomás', 80, '2026.10.03');
  assert.deepEqual(result, { stored: false, max1rm: 120 }, 'a mért csúcs az érvényes');
  assert.equal(db.getExerciseMax(userId, 'Fekvenyomás').source, 'measured');

  // A mért edzés törlése után a megmaradt bemondás lesz a csúcs
  db.deleteWorkout(userId, saved.id);
  assert.deepEqual(db.getExerciseMax(userId, 'Fekvenyomás'), {
    max1rm: 80,
    date: '2026.10.03',
    source: 'declared',
  });
});

test('mért csúcs után NAGYOBB bemondás: a bemondott lesz a csúcs', () => {
  const userId = newUser();
  db.addWorkout(userId, 'Mellnap', '2026.10.02', bench(120, 1));
  const result = db.setDeclaredMax(userId, 'Fekvenyomás', 130, '2026.10.03');
  assert.deepEqual(result, { stored: true, max1rm: 130 });
  assert.deepEqual(db.getExerciseMax(userId, 'Fekvenyomás'), {
    max1rm: 130,
    date: '2026.10.03',
    source: 'declared',
  });
});

test('egyenlő bemondásnál a mért marad a csúcs', () => {
  const userId = newUser();
  db.addWorkout(userId, 'Mellnap', '2026.10.02', bench(120, 1));
  assert.deepEqual(db.setDeclaredMax(userId, 'Fekvenyomás', 120, '2026.10.03'), {
    stored: false,
    max1rm: 120,
  });
  assert.equal(db.getExerciseMax(userId, 'Fekvenyomás').source, 'measured');
});

test('mentéskor is: a bemondással egyenlő mért szett lesz a csúcs, de nem PR', () => {
  const userId = newUser();
  db.setDeclaredMax(userId, 'Fekvenyomás', 120, '2026.10.01');
  const saved = db.addWorkout(userId, 'Mellnap', '2026.10.02', bench(120, 1));
  assert.equal(saved.exercises[0].pr, false, 'a bemondott szintet nem haladta meg');
  assert.deepEqual(db.getExerciseMax(userId, 'Fekvenyomás'), {
    max1rm: 120,
    date: '2026.10.02',
    source: 'measured',
  });
});

test('a mért csúcs alatti bemondás is látszik a bemondott csúcsok között', () => {
  /* A getDeclaredMaxes a bemondott oszlopokból olvas (declared_1rm), nem a
     csúcs forrásából: a profil-lista és a készenlét-motor is ezt kapja. */
  const userId = newUser();
  db.addWorkout(userId, 'Mellnap', '2026.10.02', bench(120, 1));
  db.setDeclaredMax(userId, 'Fekvenyomás', 80, '2026.10.03');
  assert.equal(db.getExerciseMax(userId, 'Fekvenyomás').source, 'measured', 'a csúcs a mért');
  assert.deepEqual(db.getDeclaredMaxes(userId), [
    { name: 'Fekvenyomás', max1rm: 80, date: '2026.10.03' },
  ]);
});
