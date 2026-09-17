/**
 * FitTrack Pro — az 1RM-képlet egységesítésének migrációja (user_version 1)
 * ------------------------------------------------------------------------
 * A PR-követés korábban a nyers Epley-képlettel számolt, tehát egy 100 kg-os
 * szingli 103,3 kg-os csúcsként tárolódott. Az új képlettel egy ismétlés maga a
 * súly — a már tárolt csúcsokat viszont az adatréteg induláskor egyszer
 * újraépíti a naplóból, különben egy későbbi 102,5 kg-os szingli sem lenne PR.
 *
 * A teszt egy ÚJ sémájú adatbázist készít egy külön folyamatban (a db.js
 * importkor migrál, egy folyamatban egyszer tölthető be), visszaállítja rajta
 * a régi állapotot (régi csúcs-érték, user_version 0), majd betölti rá az
 * adatréteget.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-onerm-'));
const DB_PATH = path.join(workDir, 'onerm.db');

/* 1. Friss séma egy fiókkal, egy 1 × 100 kg-os fekvenyomással és egy
      bemondott guggolás-csúccsal — külön folyamatban. */
execFileSync(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    '--input-type=module',
    '-e',
    `
    const db = await import(${JSON.stringify(path.join(__dirname, 'db.js'))});
    const { user } = db.createUser('regi', 'Régi Rita', 'x');
    db.addWorkout(user.id, 'Mellnap', '2026.09.01', [
      { name: 'Fekvenyomás', pr: false,
        sets: [{ reps: '1', weight: '100', rpe: '10', type: 'work', done: true }] },
    ]);
    db.setDeclaredMax(user.id, 'Guggolás', 130, '2026.09.02');
    db.closeDatabase();
    `,
  ],
  { env: { ...process.env, FITTRACK_DB: DB_PATH }, stdio: 'pipe' },
);

/* 2. A régi állapot: a nyers Epley-érték és a migráció előtti séma-verzió. */
{
  const raw = new DatabaseSync(DB_PATH);
  raw
    .prepare("UPDATE exercise_maxes SET max_1rm = ? WHERE exercise_name = 'Fekvenyomás'")
    .run(100 * (1 + 1 / 30));
  raw.exec('PRAGMA user_version = 0');
  raw.close();
}

/* 3. Az adatréteg betöltése — itt fut a migráció. */
process.env.FITTRACK_DB = DB_PATH;
const db = await import('./db.js');
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const maxOf = (name) => {
  const raw = new DatabaseSync(DB_PATH);
  const row = raw
    .prepare('SELECT max_1rm, source FROM exercise_maxes WHERE exercise_name = ?')
    .get(name);
  raw.close();
  return row;
};

test('a migráció a mért csúcsot az új képlettel építi újra', () => {
  assert.deepEqual({ ...maxOf('Fekvenyomás') }, { max_1rm: 100, source: 'measured' });
});

test('a bemondott csúcs megmarad, és a séma-verzió 1 lesz', () => {
  assert.deepEqual({ ...maxOf('Guggolás') }, { max_1rm: 130, source: 'declared' });
  const raw = new DatabaseSync(DB_PATH);
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
  raw.close();
});
