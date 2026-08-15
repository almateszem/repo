/**
 * FitTrack Pro — a fiókok bevezetése előtti adatbázis migrációja
 * ---------------------------------------------------------------
 * A legkockázatosabb lépés az egész átálláson: aki eddig helyben használta az
 * appot, annak a naplója már a régi, felhasználó nélküli sémában van. Ez a
 * teszt felépít egy ilyen RÉGI adatbázist, ráindítja az adatréteget, és
 * ellenőrzi, hogy
 *   1. egyetlen sor sem vész el,
 *   2. az adat egy archív fiókhoz kerül, amivel BELÉPNI NEM LEHET,
 *   3. az ELSŐ regisztráció megörökli az egészet,
 *   4. a második regisztráló viszont már nem lát belőle semmit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-migr-'));
const DB_PATH = path.join(workDir, 'legacy.db');
process.on('exit', () => rmSync(workDir, { recursive: true, force: true }));

/* ---- A RÉGI séma felépítése (szó szerint a fiókok előtti alak) ---- */
const legacyExercises = JSON.stringify(
  [{ name: 'Guggolás', pr: true, sets: [{ reps: '5', weight: '120', rpe: '8', done: true }] }],
);

{
  const old = new DatabaseSync(DB_PATH);
  old.exec(`
    CREATE TABLE collections (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE weight_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kg REAL NOT NULL, date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE nutrition_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, grams REAL NOT NULL DEFAULT 100,
      kcal REAL NOT NULL, protein REAL NOT NULL, carbs REAL NOT NULL, fat REAL NOT NULL,
      date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, date TEXT NOT NULL,
      exercises TEXT NOT NULL, plan_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, date TEXT NOT NULL,
      exercises TEXT NOT NULL, days TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    -- A régi piszkozat: az EGÉSZ adatbázisban egyetlen sor
    CREATE TABLE workout_draft (
      id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, exercises TEXT NOT NULL,
      date TEXT NOT NULL DEFAULT '', plan_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    -- A régi check-in: a dátum volt az elsődleges kulcs
    CREATE TABLE checkins (
      date TEXT PRIMARY KEY, sleep_hours REAL, sleep_quality INTEGER, energy INTEGER,
      stress INTEGER, mood INTEGER, hydration REAL,
      soreness TEXT NOT NULL DEFAULT '{}', pain TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);

  old.prepare('INSERT INTO weight_log (kg, date) VALUES (?, ?)').run(84.2, '2026.08.14');
  old.prepare('INSERT INTO weight_log (kg, date) VALUES (?, ?)').run(83.9, '2026.08.15');
  old.prepare('INSERT INTO nutrition_log (name, grams, kcal, protein, carbs, fat, date) VALUES (?,?,?,?,?,?,?)')
    .run('Csirkemell', 150, 165, 31, 0, 3.6, '2026.08.15');
  old.prepare('INSERT INTO workouts (name, date, exercises) VALUES (?, ?, ?)')
    .run('Régi edzés', '2026.08.14', legacyExercises);
  old.prepare('INSERT INTO plans (name, date, exercises, days) VALUES (?, ?, ?, ?)')
    .run('Régi terv', '2026.08.10', legacyExercises, '[0,3]');
  old.prepare('INSERT INTO workout_draft (id, name, exercises, date) VALUES (1, ?, ?, ?)')
    .run('Régi piszkozat', legacyExercises, '2026.08.15');
  old.prepare('INSERT INTO checkins (date, sleep_hours, energy) VALUES (?, ?, ?)')
    .run('2026.08.15', 7.5, 4);
  old.close();
}

/* Az adatréteg importáláskor migrál — ezért a felépítés UTÁN töltjük be. */
process.env.FITTRACK_DB = DB_PATH;
const db = await import('./db.js');

test('a migráció egyetlen sort sem veszít el', () => {
  const raw = new DatabaseSync(DB_PATH);
  const count = (table) => raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

  assert.equal(count('weight_log'), 2);
  assert.equal(count('nutrition_log'), 1);
  assert.equal(count('workouts'), 1);
  assert.equal(count('plans'), 1);
  assert.equal(count('workout_draft'), 1);
  assert.equal(count('checkins'), 1);

  // A séma viszont már az új: minden sor gazdához van kötve
  for (const table of ['weight_log', 'nutrition_log', 'workouts', 'plans', 'workout_draft', 'checkins']) {
    const columns = raw.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    assert.ok(columns.includes('user_id'), `${table}: van user_id oszlopa`);
    assert.equal(
      raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id IS NULL`).get().n, 0,
      `${table}: nem maradt gazdátlan sor`,
    );
  }
  raw.close();
});

test('az archív fiók létrejön, de belépni nem lehet vele', () => {
  const raw = new DatabaseSync(DB_PATH);
  const users = raw.prepare('SELECT username, password_hash FROM users').all();
  raw.close();

  assert.equal(users.length, 1);
  assert.equal(users[0].username, '__archiv__');
  assert.equal(users[0].password_hash, '', 'üres hash → a verifyPassword mindig hamis');

  // A felület szempontjából ez NEM létező fiók: a regisztrációt kell kínálni.
  assert.equal(db.hasAnyUser(), false, 'az archív fiók nem számít valódi fióknak');
});

test('az ELSŐ regisztráció megörökli a régi adatot', () => {
  const { user, adoptedLegacy } = db.createUser('david', 'Németh Dávid', 'scrypt$16384$8$1$aa$bb');
  assert.equal(adoptedLegacy, true, 'a válasz jelzi az örökölést');

  assert.deepEqual(db.getWeightLog(user.id).map((w) => w.kg), [84.2, 83.9]);
  assert.deepEqual(db.getWorkouts(user.id).map((w) => w.name), ['Régi edzés']);
  assert.deepEqual(db.getUserPlans(user.id).map((p) => p.name), ['Régi terv']);
  assert.equal(db.getWorkoutDraft(user.id).name, 'Régi piszkozat');
  assert.equal(db.getCheckin(user.id, '2026.08.15').sleepHours, 7.5);
  assert.equal(db.getNutritionTotals(user.id, '2026.08.15').intake, 165);

  // A régi terv hétnap-ütemezése is megmaradt
  assert.equal(db.getPlanForDay(user.id, 3)?.name, 'Régi terv');

  // Az archív fiók eltűnt, helyette a valódi fiók van
  const raw = new DatabaseSync(DB_PATH);
  assert.deepEqual(raw.prepare('SELECT username FROM users').all().map((u) => u.username), ['david']);
  raw.close();
  assert.ok(db.hasAnyUser());
});

test('a MÁSODIK regisztráló nem örököl semmit', () => {
  const { user, adoptedLegacy } = db.createUser('masodik', 'Második', 'scrypt$16384$8$1$cc$dd');
  assert.equal(adoptedLegacy, false);

  assert.deepEqual(db.getWeightLog(user.id), []);
  assert.deepEqual(db.getWorkouts(user.id), []);
  assert.deepEqual(db.getUserPlans(user.id), []);
  assert.equal(db.getWorkoutDraft(user.id), null);
  assert.equal(db.getCheckin(user.id, '2026.08.15'), null);
});

test('a migráció idempotens — újraindításkor nem fut le megint', () => {
  // A db.js egy folyamatban egyszer töltődik be, ezért itt a séma-jeleket
  // nézzük: nem maradt átmeneti tábla, és nem jött létre új archív fiók.
  const raw = new DatabaseSync(DB_PATH);
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
    .map((t) => t.name);
  raw.close();

  assert.ok(!tables.includes('workout_draft_new'), 'nem maradt ott az átmeneti tábla');
  assert.ok(!tables.includes('checkins_new'), 'nem maradt ott az átmeneti tábla');
  assert.equal(db.hasAnyUser(), true);
});
