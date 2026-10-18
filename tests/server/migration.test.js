/**
 * Podium — régi (de már többfelhasználós) adatbázis induláskori átalakításai
 * ------------------------------------------------------------------------
 * Az egyfelhasználós → többfelhasználós migráció kikerült (a baseline-őr a túl
 * régi sémát elutasítja, lásd old-db-guard.test.js). A többfelhasználós korszak
 * későbbi átalakításai maradnak, és ezek ellenőrzése is:
 *   1. a PR-követés előtti edzésekből visszatöltődnek az egyéni csúcsok,
 *   2. a pipák előtti, bepipálatlan edzés is ad csúcsot (pr_rule = 0),
 *   3. a heti bontás előtti terv heti alakot kap, és aktív lesz.
 *
 * A teszt egy MAI sémájú adatbázist készít külön folyamatban (a db.js
 * importkor migrál), visszaállítja rajta a régi állapotot, majd betölti rá az
 * adatréteget.
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
const workDir = mkdtempSync(path.join(tmpdir(), 'podium-migr-'));
const DB_PATH = path.join(workDir, 'regi.db');

/* 1. Mai séma egy fiókkal és két edzéssel — külön folyamatban. */
execFileSync(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    '--input-type=module',
    '-e',
    `
    const db = await import(${JSON.stringify(pathToFileURL(path.join(__dirname, '..', '..', 'server', 'db.js')).href)});
    const { user } = db.createUser('david', 'Németh Dávid', 'x');
    db.addWorkout(user.id, 'Régi edzés', '2026.08.14', [
      { name: 'Guggolás', pr: true,
        sets: [{ reps: '5', weight: '120', rpe: '8', type: 'work', done: true }] },
    ]);
    /* Egy edzés, amiben EGYETLEN szett sincs bepipálva — aki a naplót előre
       kitölti és menet közben nem pipálgat, ilyen sorokat hagy maga után. */
    db.addWorkout(user.id, 'Előre kitöltött edzés', '2026.08.13', [
      { name: 'Vállnyomás', pr: false,
        sets: [{ reps: '8', weight: '40', rpe: '7', type: 'work', done: false }] },
    ]);
    db.closeDatabase();
    `,
  ],
  { env: { ...process.env, PODIUM_DB: DB_PATH }, stdio: 'pipe' },
);

/* 2. A régi állapot: a PR-követés és a pipa-szabály előtti napló (üres
      csúcs-tábla, pr_rule = 0), és egy heti bontás előtti terv (week nélkül,
      az aktiválás oszlopai nélkül). */
{
  const raw = new DatabaseSync(DB_PATH);
  const userId = raw.prepare("SELECT id FROM users WHERE username = 'david'").get().id;
  raw.exec('DELETE FROM exercise_maxes; UPDATE workouts SET pr_rule = 0;');
  raw.exec('ALTER TABLE plans DROP COLUMN active; ALTER TABLE plans DROP COLUMN active_since;');
  raw
    .prepare(
      `INSERT INTO plans (user_id, name, date, exercises, days, week)
       VALUES (?, 'Régi terv', '2026.08.10', ?, '[0,3]', NULL)`,
    )
    .run(
      userId,
      JSON.stringify([
        { name: 'Guggolás', sets: [{ reps: '5', weight: '100', rpe: '8', type: 'work' }] },
      ]),
    );
  raw.close();
}

/* 3. Az adatréteg betöltése — itt futnak az átalakítások. */
process.env.PODIUM_DB = DB_PATH;
const db = await import('../../server/db.js');
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});
const user = db.getUserWithHash('david');

test('a PR-követés előtti edzésekből visszatöltődnek az egyéni csúcsok', () => {
  // Az exercise_maxes táblát az addWorkout tölti, mentéskor. Ez az adatbázis
  // korábbi: a naplója tele van, a tábla viszont üres. Enélkül a legközelebbi
  // edzés MINDEN gyakorlata hamis PR-t ütne, mert nincs mihez mérni — és a
  // rekord egy gyengébb értéken ragadna.
  const max = db.getExerciseMax(user.id, 'Guggolás');
  assert.ok(max, 'a régi edzés gyakorlatához van csúcs');
  assert.equal(max.max1rm, db.calculateEpley1RM(120, 5), 'a napló legjobb teljesített szettjéből');
  assert.equal(max.date, '2026.08.14', 'a csúcs annak az edzésnek a dátumát viszi');

  // És a visszatöltött csúcs valóban működik: egy gyengébb edzés már nem PR.
  const gyengebb = db.addWorkout(user.id, 'Könnyű nap', '2026.08.16', [
    { name: 'Guggolás', pr: false, sets: [{ reps: '5', weight: '100', rpe: '8', done: true }] },
  ]);
  assert.equal(gyengebb.exercises[0].pr, false, 'a régi 120 kg-hoz mérődik, nem a semmihez');
});

test('a visszatöltés a pipák előtti, bepipálatlan edzést is figyelembe veszi', () => {
  /* A pipák előtti sorokon (workouts.pr_rule = 0) a visszatöltés a régi
     szabályt követi: teljesített szett híján az első sor számít (records.js →
     bestCompletedSet, fallbackToFirst). Enélkül akinek a régi edzéseiben nem
     volt pipa, annál a visszatöltés üresen maradt — és a következő edzés
     hamis PR-t ütött. */
  const max = db.getExerciseMax(user.id, 'Vállnyomás');
  assert.ok(max, 'a bepipálatlan edzés gyakorlatához is van csúcs');
  assert.equal(
    max.max1rm,
    db.calculateEpley1RM(40, 8),
    'az első szettből, ahogy az addWorkout tenné',
  );
  assert.equal(max.date, '2026.08.13');

  // És működik is: egy gyengébb vállnyomás már nem rekord.
  const gyengebb = db.addWorkout(user.id, 'Váll', '2026.08.17', [
    { name: 'Vállnyomás', pr: false, sets: [{ reps: '8', weight: '30', rpe: '7', done: true }] },
  ]);
  assert.equal(gyengebb.exercises[0].pr, false, 'nem hamis PR — van mihez mérni');
});

test('a heti bontás előtti terv heti alakot kap, és ő lesz az aktív', () => {
  /* Az első kijelölt nap (hétfő) az edzés, a csütörtök „ugyanaz, mint hétfő",
     és az egyetlen ütemezett terv lett az aktív. */
  const [regi] = db.getUserPlans(user.id);
  assert.equal(regi.name, 'Régi terv');
  assert.equal(regi.active, true);
  assert.deepEqual(regi.days, [0, 3]);
  assert.deepEqual(regi.week[3], { type: 'same', of: 0 });
  assert.equal(db.getPlanForDay(user.id, 3)?.name, 'Régi terv – Csütörtök');
  assert.equal(db.getPlanForDay(user.id, 1), null, 'a kedd pihenőnap');
});
