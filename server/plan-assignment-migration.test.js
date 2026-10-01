/**
 * FitTrack Pro — a régi tervek migrációja: kiosztás-visszakötés és heti alak
 * ------------------------------------------------------------------------
 * 1. A terv-követés az edző kiosztott tervéhez mér, ezért a sportoló tervének
 *    tudnia kell, melyik kiosztásból született (plans.assignment_id). Az
 *    oszlop előtt elfogadott tervek közül azt kötjük vissza, ami név, napok és
 *    gyakorlat-lista szerint PONTOSAN egyezik a kiosztással.
 * 2. A heti bontás (plan-week.js) előtti tervek és kiosztások hetet kapnak,
 *    és felhasználónként egy terv aktív lesz.
 *
 * Az onerm-migration.test.js mintájára: friss séma egy külön folyamatban, rajta
 * a régi állapot (az új oszlopok eldobva, a sorok a régi alakban), majd az
 * adatréteg betöltése.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-assign-'));
const DB_PATH = path.join(workDir, 'assign.db');

/* 1. Friss séma egy edzővel, egy sportolóval és az élő kapcsolatukkal. */
execFileSync(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    '--input-type=module',
    '-e',
    `
    const db = await import(${JSON.stringify(pathToFileURL(path.join(__dirname, 'db.js')).href)});
    const coach = db.createUser('edzo', 'Edző Ede', 'x').user;
    const athlete = db.createUser('sportolo', 'Sport Sári', 'x').user;
    db.acceptCoachInvite(db.createCoachInvite(coach.id, athlete.id).id);
    db.closeDatabase();
    `,
  ],
  { env: { ...process.env, FITTRACK_DB: DB_PATH }, stdio: 'pipe' },
);

/* 2. A régi állapot: az új oszlopok nélkül, a régi alakú sorokkal. Két
      elfogadott kiosztás: az egyiket a sportoló változatlanul őrzi, a másikat
      átírta; plusz egy saját terve (azonos névvel, más napokkal). */
const ex = (kg) =>
  JSON.stringify([
    {
      name: 'Guggolás',
      pr: false,
      sets: [{ reps: '5', weight: String(kg), rpe: '8', type: 'work', done: false }],
    },
  ]);
{
  const raw = new DatabaseSync(DB_PATH);
  for (const column of ['assignment_id', 'week', 'active']) {
    raw.exec(`ALTER TABLE plans DROP COLUMN ${column}`);
  }
  raw.exec('ALTER TABLE plan_assignments DROP COLUMN week');
  const offer = raw.prepare(
    "INSERT INTO plan_assignments (link_id, name, exercises, days, status) VALUES (1, ?, ?, ?, 'accepted')",
  );
  offer.run('Erő', ex(100), '[0,3]');
  offer.run('Hipertrófia', ex(60), '[1]');
  const plan = raw.prepare(
    "INSERT INTO plans (user_id, name, date, exercises, days) VALUES (2, ?, '2026.09.01', ?, ?)",
  );
  plan.run('Erő', ex(100), '[0,3]'); // az elfogadás pontos másolata
  plan.run('Hipertrófia', ex(70), '[1]'); // azóta átírva
  plan.run('Erő', ex(100), '[2]'); // saját terv
  // Az edzőnek csak egy nap nélküli „könyvtári" terve van — ez eddig sosem töltődött be
  raw
    .prepare(
      "INSERT INTO plans (user_id, name, date, exercises, days) VALUES (1, 'Sablon', '2026.09.01', ?, '[]')",
    )
    .run(ex(80));
  raw.close();
}

/* 3. Az adatréteg betöltése — itt futnak a migrációk. */
process.env.FITTRACK_DB = DB_PATH;
const db = await import('./db.js');
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

test('csak a kiosztással pontosan egyező terv kötődik vissza', () => {
  const [own, edited, kept] = db.getUserPlans(2); // legújabb elöl
  assert.equal(kept.assignmentId, 1, 'a változatlan másolat az edzőé');
  assert.equal(edited.assignmentId, null, 'az átírt tervet nem találgatjuk');
  assert.equal(own.assignmentId, null, 'azonos név, más napok: saját terv');
});

test('a régi tervek heti alakot kapnak, és egy lesz aktív', () => {
  const [own, , kept] = db.getUserPlans(2);
  assert.deepEqual(kept.days, [0, 3]);
  assert.equal(kept.week[0].type, 'workout');
  assert.deepEqual(kept.week[3], { type: 'same', of: 0 });
  assert.deepEqual(kept.week[1], { type: 'rest' });
  // A legújabb, kijelölt nappal bíró terv — eddig is ez töltődött volna be
  assert.deepEqual(
    db.getUserPlans(2).map((plan) => plan.active),
    [true, false, false],
  );
  assert.equal(own.name, 'Erő');
});

test('a nap nélküli régi terv NEM lesz aktív — különben hétfőnként betöltődne', () => {
  const [sablon] = db.getUserPlans(1);
  assert.equal(sablon.name, 'Sablon');
  assert.equal(sablon.active, false, 'eddig sem volt ütemezve, ezután sem');
  assert.equal(db.getActivePlan(1), null);
});

test('a visszakötött terv az edző példányával jön a terv-követésnek', () => {
  const targets = db.getAssignedPlanTargets(2, 1);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].week[0].exercises[0].sets[0].weight, '100');
  assert.deepEqual(targets[0].week[3], { type: 'same', of: 0 });
  assert.deepEqual(db.getAssignedPlanTargets(2, 999), [], 'másik kapcsolat kiosztása nem mérce');
});
