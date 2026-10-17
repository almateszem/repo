/**
 * Podium — a bemondott csúcs külön oszlopba kerül (user_version 5)
 * ----------------------------------------------------------------------
 * Korábban a bemondás csak `source = 'declared'` sorként élt, és egy mért
 * szett felülírta. Az új séma külön oszlopban tartja (declared_1rm,
 * declared_date); a migráció a meglévő bemondott sorokat átmásolja oda.
 *
 * A régi állapotot user_version 0-val állítjuk vissza: így az is ellenőrzött,
 * hogy a másolás az 1RM-képlet újraszámolása (user_version 1) ELŐTT fut —
 * különben az újraépítés az üres oszlopból indulna, és a bemondás elveszne.
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
const workDir = mkdtempSync(path.join(tmpdir(), 'podium-declmig-'));
const DB_PATH = path.join(workDir, 'declared-migration.db');

/* 1. Friss séma egy fiókkal: egy bemondott guggolás és egy mért fekvenyomás —
      külön folyamatban (a db.js importkor migrál). */
execFileSync(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    '--input-type=module',
    '-e',
    `
    const db = await import(${JSON.stringify(pathToFileURL(path.join(__dirname, '..', '..', 'server', 'db.js')).href)});
    const { user } = db.createUser('regi', 'Régi Rita', 'x');
    db.addWorkout(user.id, 'Mellnap', '2026.09.01', [
      { name: 'Fekvenyomás', pr: false,
        sets: [{ reps: '1', weight: '100', rpe: '10', type: 'work', done: true }] },
    ]);
    db.setDeclaredMax(user.id, 'Guggolás', 130, '2026.09.02');
    db.closeDatabase();
    `,
  ],
  { env: { ...process.env, PODIUM_DB: DB_PATH }, stdio: 'pipe' },
);

/* 2. A régi állapot: a bemondott oszlopok üresek, a séma-verzió 0. */
{
  const raw = new DatabaseSync(DB_PATH);
  raw.exec('UPDATE exercise_maxes SET declared_1rm = NULL, declared_date = NULL');
  raw.exec('PRAGMA user_version = 0');
  raw.close();
}

/* 3. Az adatréteg betöltése — itt fut a migráció. */
process.env.PODIUM_DB = DB_PATH;
const db = await import('../../server/db.js');
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const rowOf = (name) => {
  const raw = new DatabaseSync(DB_PATH);
  const row = raw
    .prepare(
      `SELECT max_1rm, source, declared_1rm, declared_date FROM exercise_maxes
        WHERE exercise_name = ?`,
    )
    .get(name);
  raw.close();
  return row;
};

test('a régi bemondott sor átkerül a bemondott oszlopokba, és csúcs marad', () => {
  assert.deepEqual(
    { ...rowOf('Guggolás') },
    { max_1rm: 130, source: 'declared', declared_1rm: 130, declared_date: '2026.09.02' },
  );
});

test('a mért sorhoz nem kerül bemondás', () => {
  const row = rowOf('Fekvenyomás');
  assert.equal(row.source, 'measured');
  assert.equal(row.declared_1rm, null);
});

test('a séma-verzió a legfrissebb (5) lesz', () => {
  const raw = new DatabaseSync(DB_PATH);
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 5);
  raw.close();
});
