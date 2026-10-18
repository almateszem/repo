/**
 * Podium — a csúcsok induláskori újraszámolása egyszeri, verziózott lépés
 * ------------------------------------------------------------------------
 * Korábban egy visszatöltés (van edzés, nincs csúcs → újraszámolás) MINDEN
 * induláskor lefutott, és az 1-es és 3-as verziólépés is külön-külön
 * mindenkit újraszámolt. Most egyetlen kör van: a 3-as verzió előtti
 * adatbázison egyszer, utána soha.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_MODULE = pathToFileURL(path.join(__dirname, '..', '..', 'server', 'db.js')).href;
const workDir = mkdtempSync(path.join(tmpdir(), 'podium-recompute-'));
after(() => rmSync(workDir, { recursive: true, force: true }));

/** Egy indítás külön folyamatban (a db.js importkor migrál). */
const boot = (file, script = '') =>
  execFileSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--input-type=module',
      '-e',
      `const db = await import(${JSON.stringify(DB_MODULE)}); ${script} db.closeDatabase();`,
    ],
    { env: { ...process.env, PODIUM_DB: file }, stdio: 'pipe' },
  );

/** Egy fiók egy guggolós edzéssel, majd üres csúcs-tábla a megadott verzión. */
const prepare = (file, version) => {
  boot(
    file,
    `const { user } = db.createUser('csucs', 'Csúcs Csaba', 'x');
     db.addWorkout(user.id, 'Láb', '2026.10.01', [
       { name: 'Guggolás', sets: [{ reps: '5', weight: '100', rpe: '8', type: 'work', done: true }] },
     ]);`,
  );
  const raw = new DatabaseSync(file);
  raw.exec(`DELETE FROM exercise_maxes; PRAGMA user_version = ${version};`);
  raw.close();
};

const maxCount = (file) => {
  const raw = new DatabaseSync(file);
  const { n } = raw.prepare('SELECT COUNT(*) AS n FROM exercise_maxes').get();
  raw.close();
  return n;
};

test('mai verziójú adatbázison az indítás nem számolja újra a csúcsokat', () => {
  const file = path.join(workDir, 'current.db');
  prepare(file, 5);
  boot(file);
  assert.equal(maxCount(file), 0, 'a visszatöltés nem fut minden induláskor');
});

test('a 3-as verzió előtti adatbázison egyszer mindenki újraszámolódik', () => {
  const file = path.join(workDir, 'old.db');
  prepare(file, 2);
  boot(file);
  assert.equal(maxCount(file), 1, 'a naplóból visszatöltődött a csúcs');
});
