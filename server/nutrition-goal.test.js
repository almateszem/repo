/**
 * FitTrack Pro — az EDZŐI táplálkozási cél élettartama, az adatréteg szintjén
 * ---------------------------------------------------------------------------
 * A hardening.test.js a végponton át bizonyítja, hogy a bontással a volt edző
 * célja megszűnik. Itt két olyan eset a kérdés, ami a szokásos felületi úton
 * nem áll elő, az adatbázisban viszont igen:
 *
 *   1. KÉT élő kapcsolat ugyanahhoz a sportolóhoz (a coach_links csak a
 *      (coach_id, athlete_id) párra egyedi). Az egyik bontása nem viheti el a
 *      MÁSIK edző által kitűzött célt.
 *   2. Az edző TÖRLI a fiókját: a kapcsolat a fiókkal megy, a cél set_by
 *      mezője NULL lesz — a gazdátlan szám nem hajthatja tovább a napi célt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-goal-'));
const DB_PATH = path.join(workDir, 'test.db');
process.env.FITTRACK_DB = DB_PATH;

const db = await import('./db.js');

/* Takarítás előtt zárjuk az adatbázist — Windowson a nyitott fájlt tartó
   könyvtár törlése EPERM-mel elszáll (ld. db.js → closeDatabase). */
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const HASH = 'scrypt$16384$8$1$aa$bb';

/** Élő kapcsolat edző és sportoló között (meghívó + elfogadás). */
function link(coach, athlete) {
  const invite = db.createCoachInvite(coach.id, athlete.id);
  return db.acceptCoachInvite(invite.id);
}

test('egy MÁSIK edző kapcsolatának bontása nem viszi el a célt', () => {
  const edzoA = db.createUser('edzo-a', 'Edző A', HASH).user;
  const edzoB = db.createUser('edzo-b', 'Edző B', HASH).user;
  const sportolo = db.createUser('sportolo-ab', 'Sportoló', HASH).user;

  link(edzoA, sportolo);
  const linkB = link(edzoB, sportolo);
  db.saveNutritionGoal(sportolo.id, 'coach', { calories: 2800, protein: 180 }, edzoA.id);

  assert.equal(db.deleteCoachLink(linkB.id), true);

  const goal = db.getNutritionGoal(sportolo.id);
  assert.equal(goal.source, 'coach', 'az A edző célja megmaradt');
  assert.equal(goal.calories, 2800);
});

test('a SAJÁT kapcsolat bontása továbbra is viszi a célt', () => {
  const edzo = db.createUser('edzo-sajat', 'Edző', HASH).user;
  const sportolo = db.createUser('sportolo-sajat', 'Sportoló', HASH).user;

  const kapcsolat = link(edzo, sportolo);
  db.saveNutritionGoal(sportolo.id, 'coach', { calories: 2600, protein: 170 }, edzo.id);

  db.deleteCoachLink(kapcsolat.id);
  assert.equal(db.getNutritionGoal(sportolo.id).locked, false);
});

test('a törölt fiókú edző célja nem hajtja tovább a napi célt', () => {
  const edzo = db.createUser('edzo-torolt', 'Edző', HASH).user;
  const sportolo = db.createUser('sportolo-torolt', 'Sportoló', HASH).user;

  link(edzo, sportolo);
  db.saveNutritionGoal(sportolo.id, 'coach', { calories: 3100, protein: 210 }, edzo.id);
  assert.equal(db.getNutritionGoal(sportolo.id).source, 'coach');

  db.deleteUser(edzo.id);

  const goal = db.getNutritionGoal(sportolo.id);
  assert.notEqual(goal.source, 'coach');
  assert.equal(goal.locked, false);
  assert.notEqual(goal.calories, 3100);
});

/* ---- Az edzői ÉTREND ugyanígy a kapcsolathoz kötött ---- */

const MEAL = {
  name: 'Reggeli',
  items: [{ food: { name: 'Zabpehely', kcal: 370, protein: 13, carbs: 60, fat: 7 }, grams: 80 }],
};
const NAP = '2026-10-01';

test('a bontással a volt edző étkezései is lekerülnek — nem naplózhatók tovább', () => {
  const edzo = db.createUser('edzo-etrend', 'Edző', HASH).user;
  const sportolo = db.createUser('sportolo-etrend', 'Sportoló', HASH).user;

  const kapcsolat = link(edzo, sportolo);
  const [etkezes] = db.createCoachMeal(sportolo.id, edzo.id, MEAL, NAP);
  assert.equal(db.getCoachMeals(sportolo.id, NAP).length, 1);

  db.deleteCoachLink(kapcsolat.id);

  assert.deepEqual(db.getCoachMeals(sportolo.id, NAP), [], 'a sportoló étrendje üres');
  assert.equal(db.countCoachMeals(sportolo.id), 0);
  assert.equal(db.logCoachMeal(sportolo.id, etkezes.id, NAP), null, 'nem írhat a naplóba');
});

test('a törölt fiókú edző étkezései sem maradnak a sportolónál', () => {
  const edzo = db.createUser('edzo-etrend-torolt', 'Edző', HASH).user;
  const sportolo = db.createUser('sportolo-etrend-torolt', 'Sportoló', HASH).user;

  link(edzo, sportolo);
  db.createCoachMeal(sportolo.id, edzo.id, MEAL, NAP);
  db.deleteUser(edzo.id);

  assert.deepEqual(db.getCoachMeals(sportolo.id, NAP), []);
});

test('az új edző nem látja / nem örökli a régi edző étrendjét', () => {
  const regi = db.createUser('edzo-regi-etrend', 'Régi', HASH).user;
  const uj = db.createUser('edzo-uj-etrend', 'Új', HASH).user;
  const sportolo = db.createUser('sportolo-valto', 'Sportoló', HASH).user;

  link(regi, sportolo);
  /* Élő kapcsolat nélkül ottmaradt sor (régebbi fájlokon a bontás még nem
     takarított): írjuk be közvetlenül, majd bontsuk a kapcsolatot SQL-lel. */
  db.createCoachMeal(sportolo.id, regi.id, MEAL, NAP);
  const raw = new DatabaseSync(DB_PATH);
  raw.prepare('DELETE FROM coach_links WHERE coach_id = ?').run(regi.id);
  raw.close();

  link(uj, sportolo);
  assert.deepEqual(db.getCoachMeals(sportolo.id, NAP), [], 'csak az élő edző étrendje számít');
});

test('élő kapcsolat nélkül ottmaradt edzői sort sem veszünk figyelembe', () => {
  /* Régebbi fájlokon előfordulhat: a sor a bontás-takarítás előttről maradt,
     vagy a set_by már NULL. Olvasáskor sem számít — írni nem kell hozzá. */
  const edzo = db.createUser('edzo-regi', 'Edző', HASH).user;
  const sportolo = db.createUser('sportolo-regi', 'Sportoló', HASH).user;
  const arva = db.createUser('sportolo-arva', 'Sportoló 2', HASH).user;

  db.saveNutritionGoal(sportolo.id, 'coach', { calories: 2900, protein: 190 }, edzo.id);
  db.saveNutritionGoal(arva.id, 'coach', { calories: 2950, protein: 195 }, null);

  for (const user of [sportolo, arva]) {
    const goal = db.getNutritionGoal(user.id);
    assert.equal(goal.source, 'default');
    assert.equal(goal.locked, false);
  }

  // A tárolt sorhoz nem nyúltunk — csak nem érvényes.
  const raw = new DatabaseSync(DB_PATH);
  assert.equal(
    raw
      .prepare(
        "SELECT COUNT(*) AS n FROM nutrition_goals WHERE source = 'coach' AND user_id IN (?, ?)",
      )
      .get(sportolo.id, arva.id).n,
    2,
  );
  raw.close();
});
