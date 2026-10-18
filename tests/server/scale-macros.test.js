/**
 * Podium — az adagra vetítés egy helyen él (scaleMacros)
 * ------------------------------------------------------------------------
 * Az étel 100 g-os tápértékét négy út vetíti adagra: a naplózás, az adag
 * javítása, az edzői étrend tétele és a „Legutóbbiak" sor kalóriája. Ha a
 * négy másolat elcsúszik, az étrend mást ígér, mint amit a naplózás rögzít.
 * A 9,2 kcal / 375 g épp egy olyan eset, ahol a (kcal × g) / 100 és a
 * kcal × (g / 100) másra kerekít.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'podium-macros-'));
process.env.PODIUM_DB = path.join(workDir, 'macros.db');
const db = await import('../../server/db.js');
after(() => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const DATE = '2026.10.18';
const GRAMS = 375;
const macros = ({ kcal, protein, carbs, fat }) => ({ kcal, protein, carbs, fat });

test('a négy út ugyanarra a bemenetre ugyanazt adja', () => {
  const { user } = db.createUser('makro', 'Makró Márk', 'x');
  db.addCustomFood(user.id, {
    name: 'Kovászos uborka',
    unit: 'g',
    kcal: 9.2,
    protein: 0.65,
    carbs: 1.45,
    fat: 0.15,
  });
  const food = db.findFoodForUser(user.id, 'Kovászos uborka');

  // 1. naplózás a végleges adaggal
  const logged = macros(db.addNutritionEntry(user.id, food, DATE, GRAMS).entry);

  // 2. naplózás 100 g-mal, majd az adag javítása
  const { entry } = db.addNutritionEntry(user.id, food, DATE, 100);
  db.updateNutritionEntry(user.id, entry.id, GRAMS);
  const corrected = macros(db.getNutritionLogForDate(user.id, DATE).find((e) => e.id === entry.id));

  // 3. az edzői étrend tétele (étrend csak élő edzői kapcsolat mellett él)
  const coach = db.createUser('makro-edzo', 'Makró Edző', 'x').user;
  db.acceptCoachInvite(db.createCoachInvite(coach.id, user.id).id);
  const [meal] = db.createCoachMeal(
    user.id,
    coach.id,
    { name: 'Ebéd', items: [{ food, grams: GRAMS }] },
    DATE,
  );
  const planned = macros(meal.items[0]);

  // 4. a „Legutóbbiak" sor (csak kalóriát mutat)
  const recent = db.getRecentFoods(user.id).find((f) => f.name === 'Kovászos uborka');

  assert.deepEqual(corrected, logged, 'az adag javítása = a naplózás');
  assert.deepEqual(planned, logged, 'az étrend tétele = a naplózás');
  assert.equal(recent.kcal, logged.kcal, 'a Legutóbbiak kalóriája = a naplózás');
});
