/**
 * Podium — a csúcsok újraépítése atomikus
 * ------------------------------------------------------------------------
 * A recomputeExerciseMaxes előbb TÖRÖL, aztán beszúr. Tranzakció nélkül egy
 * közbeni hiba után a csúcsok — köztük a naplóból vissza nem állítható
 * bemondottak — végleg eltűntek. A teszt egy triggerrel elrontja a
 * beszúrást, és ellenőrzi, hogy a hiba után minden csúcs érintetlen.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const workDir = mkdtempSync(path.join(tmpdir(), 'podium-atomic-'));
const DB_PATH = path.join(workDir, 'atomic.db');
process.env.PODIUM_DB = DB_PATH;
const db = await import('../../server/db.js');
after(() => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

test('a recompute közben dobott hiba után a csúcsok érintetlenek', () => {
  const { user } = db.createUser('atom', 'Atom Anna', 'x');
  db.addWorkout(user.id, 'Láb', '2026.10.01', [
    { name: 'Guggolás', sets: [{ reps: '5', weight: '100', rpe: '8', type: 'work', done: true }] },
  ]);
  db.setDeclaredMax(user.id, 'Fekvenyomás', 80, '2026.10.02');
  const before = db.getAllExerciseMaxes(user.id);
  assert.equal(before.length, 2);

  // A beszúrás elszáll — a törlés viszont már lefutott volna
  const raw = new DatabaseSync(DB_PATH);
  raw.exec(`CREATE TRIGGER boom BEFORE INSERT ON exercise_maxes
            BEGIN SELECT RAISE(ABORT, 'boom'); END`);
  raw.close();

  assert.throws(() => db.recomputeExerciseMaxes(user.id), /boom/);
  assert.deepEqual(db.getAllExerciseMaxes(user.id), before, 'egyetlen csúcs sem veszett el');
});
