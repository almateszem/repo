/**
 * FitTrack Pro — a 12 izomcsoportos váltás migrációja (user_version 2)
 * -------------------------------------------------------------------
 * A tárolt check-inek izomláz- és fájdalom-térképe a régi `arms` és `back`
 * kulcsot használja. Induláskor egyszer átíródnak: az érték minden utódra
 * átmásolódik, így egy tárolt fájdalom-tiltás nem vész el.
 *
 * A minta az onerm-migration.test.js-é: a friss sémát külön folyamat hozza
 * létre, a régi állapotot nyersen állítjuk vissza, majd betöltjük az
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
const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-muscles-'));
const DB_PATH = path.join(workDir, 'muscles.db');

/* 1. Friss séma egy fiókkal — külön folyamatban. */
execFileSync(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    '--input-type=module',
    '-e',
    `
    const db = await import(${JSON.stringify(pathToFileURL(path.join(__dirname, 'db.js')).href)});
    db.createUser('regi', 'Régi Rita', 'x');
    db.closeDatabase();
    `,
  ],
  { env: { ...process.env, FITTRACK_DB: DB_PATH }, stdio: 'pipe' },
);

/* 2. A régi állapot: 9 csoportos kulcsok és a migráció előtti séma-verzió. */
const updatedAt = '2026-09-01 10:00:00';
{
  const raw = new DatabaseSync(DB_PATH);
  const userId = raw.prepare('SELECT id FROM users LIMIT 1').get().id;
  raw
    .prepare(
      `INSERT INTO checkins (user_id, date, soreness, pain, updated_at)
       VALUES (?, '2026-09-01', ?, ?, ?)`,
    )
    .run(
      userId,
      JSON.stringify({ arms: 6, chest: 2 }),
      JSON.stringify({ back: 8, general: 3 }),
      updatedAt,
    );
  raw.exec('PRAGMA user_version = 1');
  raw.close();
}

/* 3. Az adatréteg betöltése — itt fut a migráció. */
process.env.FITTRACK_DB = DB_PATH;
const db = await import('./db.js');
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const rawRow = () => {
  const raw = new DatabaseSync(DB_PATH);
  const row = raw.prepare('SELECT soreness, pain, updated_at FROM checkins').get();
  const version = raw.prepare('PRAGMA user_version').get().user_version;
  raw.close();
  return { ...row, version };
};

test('az arms izomláz a bicepszre és a tricepszre is átkerül', () => {
  assert.deepEqual(JSON.parse(rawRow().soreness), { biceps: 6, triceps: 6, chest: 2 });
});

test('a back fájdalom a hátra, a trapézra és az alsó hátra is átkerül; a general marad', () => {
  assert.deepEqual(JSON.parse(rawRow().pain), { back: 8, traps: 8, lowerBack: 8, general: 3 });
});

test('a migráció nem írja át a módosítás idejét, és a séma-verzió 2 lesz', () => {
  const row = rawRow();
  assert.equal(row.updated_at, updatedAt);
  assert.equal(row.version, 2);
});
