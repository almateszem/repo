/**
 * FitTrack Pro — az EGYÉNI CSÚCSOK (PR) felhasználónkénti elkülönítése
 * --------------------------------------------------------------------
 * Az automatikus PR-számítás és a fiókok egymástól függetlenül készültek, és
 * a találkozásuknál van egy csendes hibalehetőség: ha az exercise_maxes tábla
 * KÖZÖS marad, akkor a legerősebb felhasználó csúcsa mindenki más elé áll —
 * egy kezdő SOHA nem üt PR-t, mert egy idegen 200 kg-jához mérődik.
 *
 * Az itteni állítások mind ugyanazt kérdezik: a saját korábbi teljesítményhez
 * mérünk-e. A válasz mindenhol igen.
 *
 * Az adatréteg fájlba ír, ezért a teszt saját ideiglenes adatbázist kap
 * (FITTRACK_DB), és a db.js-t CSAK utána importáljuk — a modul importáláskor
 * nyitja meg a fájlt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-prs-'));
process.env.FITTRACK_DB = path.join(workDir, 'test.db');
process.on('exit', () => rmSync(workDir, { recursive: true, force: true }));

const db = await import('./db.js');

const eros = db.createUser('eros', 'Erős Elek', 'scrypt$16384$8$1$aa$bb').user;
const kezdo = db.createUser('kezdo', 'Kezdő Kata', 'scrypt$16384$8$1$cc$dd').user;

const TODAY = '2026.08.15';
const HOLNAP = '2026.08.16';

/** Egy gyakorlatból álló edzés, egyetlen teljesített szettel. */
const nyomas = (weight, reps = 5, done = true) => ([
  { name: 'Fekvenyomás', pr: false, sets: [{ reps: String(reps), weight: String(weight), rpe: '8', done }] },
]);

test('az Epley-képlet a várt 1RM-et adja, érvénytelen bemenetre nullát', () => {
  assert.equal(db.calculateEpley1RM(100, 5), 100 * (1 + 5 / 30));
  // A képlet egy ismétlésnél sincs kivételezve: 100 × (1 + 1/30) ≈ 103,3. A
  // tankönyvi Epley itt magát a súlyt adná — a becslés tehát egyismétléses
  // szettnél enyhén felfelé tér el. Nem hiba, csak tudni kell róla.
  assert.equal(db.calculateEpley1RM(100, 1), 100 * (1 + 1 / 30));
  assert.ok(db.calculateEpley1RM(100, 8) > db.calculateEpley1RM(100, 5), 'több ismétlés = nagyobb becsült 1RM');
  for (const [w, r] of [[0, 5], [-10, 5], [100, 0], ['', 5], [100, 'x']]) {
    assert.equal(db.calculateEpley1RM(w, r), 0, `érvénytelen: ${w} × ${r}`);
  }
});

test('az első edzés PR, a gyengébb második nem', () => {
  const first = db.addWorkout(eros.id, 'Mellnap', TODAY, nyomas(100));
  assert.equal(first.exercises[0].pr, true, 'az első mért teljesítmény mindig rekord');

  const weaker = db.addWorkout(eros.id, 'Könnyű nap', HOLNAP, nyomas(80));
  assert.equal(weaker.exercises[0].pr, false, 'a kisebb 1RM nem rekord');

  assert.equal(db.getExerciseMax(eros.id, 'Fekvenyomás').max1rm, db.calculateEpley1RM(100, 5));
  assert.equal(db.getExerciseMax(eros.id, 'Fekvenyomás').date, TODAY, 'a csúcs dátuma nem lép előre');
});

test('a PR a SAJÁT korábbi csúcshoz mérődik, nem a legerősebb felhasználóéhoz', () => {
  // Ez a fájl létezésének oka: Kata 40 kg-ja az ő számára rekord, hiába
  // nyomott Elek ugyanabban a gyakorlatban 100-at.
  const katáé = db.addWorkout(kezdo.id, 'Első edzésem', TODAY, nyomas(40));
  assert.equal(katáé.exercises[0].pr, true);

  assert.equal(db.getExerciseMax(kezdo.id, 'Fekvenyomás').max1rm, db.calculateEpley1RM(40, 5));
  assert.equal(db.getExerciseMax(eros.id, 'Fekvenyomás').max1rm, db.calculateEpley1RM(100, 5),
    'Kata mentése nem írta felül Elek csúcsát');
});

test('a csúcslista csak a saját rekordokat adja vissza', () => {
  assert.deepEqual(db.getAllExerciseMaxes(kezdo.id).map((r) => r.max_1rm), [db.calculateEpley1RM(40, 5)]);
  assert.deepEqual(db.getAllExerciseMaxes(eros.id).map((r) => r.max_1rm), [db.calculateEpley1RM(100, 5)]);
  assert.deepEqual(db.getAllExerciseMaxes(99999), [], 'ismeretlen fiókra üres, nem más adata');
  assert.equal(db.getExerciseMax(99999, 'Fekvenyomás'), null);
});

test('teljesített szett hiányában az első szett számít, üres edzés nem dob', () => {
  const tervezett = db.addWorkout(kezdo.id, 'Csak megtervezve', HOLNAP, nyomas(50, 5, false));
  assert.equal(tervezett.exercises[0].pr, true, 'a nem kipipált szett is mér — ez a szándékolt viselkedés');

  const üres = db.addWorkout(kezdo.id, 'Nincs szett', HOLNAP, [{ name: 'Húzódzkodás', pr: false, sets: [] }]);
  assert.equal(üres.exercises[0].pr, false);
  assert.equal(db.getExerciseMax(kezdo.id, 'Húzódzkodás'), null, 'szett nélkül nem születik rekord');
});
