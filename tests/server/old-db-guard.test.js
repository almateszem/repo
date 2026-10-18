/**
 * Podium — túl régi (egyfelhasználós) adatbázis: egyértelmű leállás
 * ------------------------------------------------------------------------
 * Az egyfelhasználós → többfelhasználós migráció nem volt idempotens, és régi
 * adatbázison élesen hibázott (első indításkor elszállt, a másodikon csendben
 * kimaradt egy lépés). Helyette egy baseline-őr: ha a DB-ben vannak táblák,
 * de hiányzik a többfelhasználós séma jele, a szerver hibával áll le.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_MODULE = pathToFileURL(path.join(__dirname, '..', '..', 'server', 'db.js')).href;
const workDir = mkdtempSync(path.join(tmpdir(), 'podium-olddb-'));
after(() => rmSync(workDir, { recursive: true, force: true }));

/** A db.js betöltése egy külön folyamatban a megadott adatbázissal. */
const loadDb = (file) =>
  spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--input-type=module',
      '-e',
      `const db = await import(${JSON.stringify(DB_MODULE)}); db.closeDatabase();`,
    ],
    { env: { ...process.env, PODIUM_DB: file }, encoding: 'utf8' },
  );

test('egyfelhasználós sémájú adatbázison a szerver egyértelmű hibával áll le', () => {
  const file = path.join(workDir, 'old.db');
  const raw = new DatabaseSync(file);
  // A fiókok előtti séma: nincs users tábla, a workouts sorainak nincs gazdája
  raw.exec(`
    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      exercises TEXT NOT NULL
    );
    INSERT INTO workouts (name, date, exercises) VALUES ('Régi edzés', '2026.08.14', '[]');
  `);
  raw.close();

  const result = loadDb(file);
  assert.notEqual(result.status, 0, 'nem indul el');
  assert.match(result.stderr, /Túl régi adatbázis/);

  const after = new DatabaseSync(file);
  const tables = after
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .all();
  after.close();
  assert.deepEqual(tables, [], 'a régi adatbázishoz nem nyúlt (nem hozott létre táblát)');
});

test('friss (üres) adatbázison változatlanul elindul', () => {
  const result = loadDb(path.join(workDir, 'fresh.db'));
  assert.equal(result.status, 0, result.stderr);
});
