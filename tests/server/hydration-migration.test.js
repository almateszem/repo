/**
 * Podium — a folyadék egyetlen forrása a víznapló (user_version 4)
 * ----------------------------------------------------------------------
 * Korábban minden korty víz a checkins.hydration mezőbe is beíródott, és ha
 * aznap még nem volt check-in, egy csupa-NULL sort hozott létre. Mindenki a
 * sor LÉTEZÉSÉT nézte, így egy pohár víz „kitöltött check-innek" számított.
 * A migráció ezeket a fantom-sorokat törli, a víznapló előtti check-inek
 * literértékét pedig átviszi a víznaplóba (ahonnan a check-in már olvas).
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
const workDir = mkdtempSync(path.join(tmpdir(), 'podium-hydr-'));
const DB_PATH = path.join(workDir, 'hydration.db');

/* 1. Friss séma egy fiókkal — külön folyamatban (a db.js importkor migrál). */
execFileSync(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    '--input-type=module',
    '-e',
    `
    const db = await import(${JSON.stringify(pathToFileURL(path.join(__dirname, '..', '..', 'server', 'db.js')).href)});
    db.createUser('vizes', 'Vizes Vali', 'x');
    db.closeDatabase();
    `,
  ],
  { env: { ...process.env, PODIUM_DB: DB_PATH }, stdio: 'pipe' },
);

/* 2. A régi állapot: egy csak-vizes fantom-sor (a víznaplóban a kortyokkal),
      egy víznapló előtti valódi check-in literértékkel, és egy valódi
      check-in, amelynek a napján már vannak kortyok. */
let userId;
{
  const raw = new DatabaseSync(DB_PATH);
  userId = raw.prepare("SELECT id FROM users WHERE username = 'vizes'").get().id;
  const checkin = raw.prepare(
    'INSERT INTO checkins (user_id, date, sleep_hours, energy, hydration) VALUES (?, ?, ?, ?, ?)',
  );
  const sip = raw.prepare('INSERT INTO water_log (user_id, date, ml) VALUES (?, ?, ?)');
  checkin.run(userId, '2026.10.01', null, null, 0.5);
  sip.run(userId, '2026.10.01', 500);
  checkin.run(userId, '2026.09.01', 7, 4, 2.25);
  checkin.run(userId, '2026.10.02', 8, 3, 3);
  sip.run(userId, '2026.10.02', 250);
  sip.run(userId, '2026.10.02', 500);
  raw.exec('PRAGMA user_version = 3');
  raw.close();
}

/* 3. Az adatréteg betöltése — itt fut a migráció. */
process.env.PODIUM_DB = DB_PATH;
const db = await import('../../server/db.js');
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

test('a csak vízből lett check-in sor eltűnik, a kortyok maradnak', () => {
  assert.equal(db.getCheckin(userId, '2026.10.01'), null);
  assert.equal(db.getWaterDay(userId, '2026.10.01').totalMl, 500);
});

test('a víznapló előtti check-in literértéke átkerül a víznaplóba', () => {
  assert.equal(db.getWaterDay(userId, '2026.09.01').totalMl, 2250);
  const checkin = db.getCheckin(userId, '2026.09.01');
  assert.equal(checkin.sleepHours, 7);
  assert.equal(checkin.hydration, 2.25);
});

test('ahol már voltak kortyok, ott a víznapló az irányadó, nem duplázódik', () => {
  const day = db.getWaterDay(userId, '2026.10.02');
  assert.equal(day.entries.length, 2);
  assert.equal(db.getCheckin(userId, '2026.10.02').hydration, 0.75);
  const raw = new DatabaseSync(DB_PATH);
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 5);
  raw.close();
});
