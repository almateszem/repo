/**
 * Podium — a gyakorlat-megjegyzés követi a gyakorlatát az edzés javításakor
 * ------------------------------------------------------------------------
 * A cél "edzésId:index" alakú. Ha a visszanyitott edzésben a megjegyzett
 * gyakorlat ELŐTTI gyakorlatot törlik vagy átsorolják, a megjegyzés korábban
 * másik gyakorlatra csúszott. Az updateWorkout most név szerint párosítja a
 * régi és az új listát, és a célt az új indexre írja át; a törölt gyakorlat
 * megjegyzése árva lesz (egyetlen gyakorlatra sem mutat).
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'podium-comments-'));
process.env.PODIUM_DB = path.join(workDir, 'comments.db');
const db = await import('../../server/db.js');
after(() => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const userId = db.createUser('jegyzetelo', 'Jegyzetelő', 'x').user.id;
const ex = (name) => ({
  name,
  sets: [{ reps: '5', weight: '60', rpe: '8', type: 'work', done: true }],
});
/** A megjegyzések célja → szöveg (a szerver olvasóinak nézete). */
const notesOf = (workout) => {
  const byTarget = db.getCommentsByTarget(userId, 'exercise', userId);
  const result = {};
  for (const [target, list] of Object.entries(byTarget)) {
    const [id, index] = target.split(':');
    const exercise = Number(id) === workout.id ? workout.exercises[Number(index)] : undefined;
    if (exercise) result[exercise.name] = list.map((c) => c.text);
  }
  return result;
};

test('átsorolás után a megjegyzés a saját gyakorlatán marad', () => {
  const w = db.addWorkout(userId, 'Edzés', '2026.10.10', [ex('Guggolás'), ex('Fekvenyomás')]);
  db.addComment(userId, userId, 'exercise', `${w.id}:1`, 'a fekvenyomásról');
  const updated = db.updateWorkout(userId, w.id, 'Edzés', [ex('Fekvenyomás'), ex('Guggolás')]);
  assert.deepEqual(notesOf(updated), { Fekvenyomás: ['a fekvenyomásról'] });
});

test('az előtte álló gyakorlat törlése után sem csúszik el', () => {
  const w = db.addWorkout(userId, 'Edzés', '2026.10.11', [
    ex('Guggolás'),
    ex('Evezés'),
    ex('Fekvenyomás'),
  ]);
  db.addComment(userId, userId, 'exercise', `${w.id}:2`, 'fekve 2');
  db.addComment(userId, userId, 'exercise', `${w.id}:1`, 'evezés');
  // Az Evezés kikerül: a megjegyzése árva, a Fekvenyomásé a 2-ről az 1-re lép
  const updated = db.updateWorkout(userId, w.id, 'Edzés', [ex('Guggolás'), ex('fekvenyomas')]);
  assert.deepEqual(notesOf(updated), { fekvenyomas: ['fekve 2'] });
});

test('azonos nevű gyakorlatok sorrendben párosodnak', () => {
  const w = db.addWorkout(userId, 'Edzés', '2026.10.12', [
    ex('Fekvenyomás'),
    ex('Guggolás'),
    ex('Fekvenyomás'),
  ]);
  db.addComment(userId, userId, 'exercise', `${w.id}:2`, 'második fekve');
  const updated = db.updateWorkout(userId, w.id, 'Edzés', [
    ex('Guggolás'),
    ex('Fekvenyomás'),
    ex('Fekvenyomás'),
  ]);
  const byTarget = db.getCommentsByTarget(userId, 'exercise', userId);
  assert.ok(byTarget[`${updated.id}:2`], 'a második fekvenyomás a második maradt');
});
