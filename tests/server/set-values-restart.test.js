/**
 * Podium — a szett-értékek újraindítás után változatlanok
 * ------------------------------------------------------------------------
 * Korábban minden szerverindításkor egy migráció (migrateSetValuesToNumbers)
 * átírta a mentett szett-értékeket: ".5" → "5", "1e2" → "1" (100 kg-ból 1 kg),
 * "8-12" → "8". A kanonikus alakot most a MENTÉS állítja elő, az indítás nem
 * nyúl az adathoz.
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
const workDir = mkdtempSync(path.join(tmpdir(), 'podium-setvals-'));
const DB_PATH = path.join(workDir, 'setvals.db');
after(() => rmSync(workDir, { recursive: true, force: true }));

/** Egy indítás: a db.js betöltése egy külön folyamatban (a modul importkor migrál). */
const boot = (script = '') =>
  execFileSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--input-type=module',
      '-e',
      `const db = await import(${JSON.stringify(DB_MODULE)}); ${script} db.closeDatabase();`,
    ],
    { env: { ...process.env, PODIUM_DB: DB_PATH }, stdio: 'pipe' },
  );

const storedSets = () => {
  const raw = new DatabaseSync(DB_PATH);
  const row = raw.prepare('SELECT exercises FROM workouts').get();
  raw.close();
  return JSON.parse(row.exercises)[0].sets;
};

test('újraindítás után a mentett szett-értékek változatlanok', () => {
  boot(`
    const { user } = db.createUser('ujrainditas', 'Újraindítás', 'x');
    db.addWorkout(user.id, 'Edzés', '2026.10.10', [
      { name: 'Lábtolás', sets: [{ reps: '8-12', weight: '0.5', rpe: '8', type: 'work', done: true }] },
    ]);
  `);
  const before = storedSets();
  boot(); // második indítás
  boot(); // és még egy
  assert.deepEqual(storedSets(), before);
  assert.equal(storedSets()[0].reps, '8-12', 'a szöveges érték nem csonkul');
});
