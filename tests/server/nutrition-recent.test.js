/**
 * FitTrack Pro — a Táplálkozás oldal „Legutóbbiak" sora (getRecentFoods)
 * ---------------------------------------------------------------------
 * A sor egy koppintással újranaplóz, ezért három dolgon múlik:
 *   1. egy étel csak EGYSZER szerepel, a legutóbbi adagjával, legújabb elöl;
 *   2. csak a ma is naplózható étel kerül bele (a törölt saját étel nem);
 *   3. más felhasználó naplója nem szivárog át.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-recent-'));
process.env.FITTRACK_DB = path.join(workDir, 'test.db');

const db = await import('../../server/db.js');

/* Takarítás előtt zárjuk az adatbázist — Windowson a nyitott fájlt tartó
   könyvtár törlése EPERM-mel elszáll (ld. db.js → closeDatabase). */
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const HASH = 'scrypt$16384$8$1$aa$bb';
const DAY = '2026.10.15';

/** Saját étel (a katalógus a teszt-adatbázisban üres, a saját étel viszont
    ugyanúgy naplózható). */
function food(userId, name, { kcal = 100, unit = 'g' } = {}) {
  return db.addCustomFood(userId, { name, unit, kcal, protein: 10, carbs: 10, fat: 1 });
}

test('üres napló → üres lista', () => {
  const user = db.createUser('recent-ures', 'Üres', HASH).user;
  assert.deepEqual(db.getRecentFoods(user.id), []);
});

test('egy étel egyszer, a legutóbbi adaggal, legújabb elöl', () => {
  const user = db.createUser('recent-sorrend', 'Sorrend', HASH).user;
  const zab = food(user.id, 'Zabpehely', { kcal: 380 });
  const tej = food(user.id, 'Tej', { kcal: 50, unit: 'ml' });

  db.addNutritionEntry(user.id, zab, DAY, 60);
  db.addNutritionEntry(user.id, tej, DAY, 250);
  db.addNutritionEntry(user.id, zab, DAY, 80);

  assert.deepEqual(db.getRecentFoods(user.id), [
    { name: 'Zabpehely', grams: 80, unit: 'g', kcal: 304 },
    { name: 'Tej', grams: 250, unit: 'ml', kcal: 125 },
  ]);
});

test('legfeljebb a kért számú étel jön', () => {
  const user = db.createUser('recent-limit', 'Limit', HASH).user;
  for (let i = 1; i <= 10; i += 1) {
    db.addNutritionEntry(user.id, food(user.id, `Étel ${i}`), DAY, 100);
  }
  const recent = db.getRecentFoods(user.id);
  assert.equal(recent.length, 8);
  assert.equal(recent[0].name, 'Étel 10');
});

test('a törölt saját étel kimarad (az újranaplózása elbukna)', () => {
  const user = db.createUser('recent-torolt', 'Törölt', HASH).user;
  const megmarad = food(user.id, 'Megmaradó');
  const torolt = food(user.id, 'Törölt étel');
  db.addNutritionEntry(user.id, megmarad, DAY, 100);
  db.addNutritionEntry(user.id, torolt, DAY, 100);

  db.deleteCustomFood(user.id, torolt.id);

  assert.deepEqual(
    db.getRecentFoods(user.id).map((entry) => entry.name),
    ['Megmaradó'],
  );
});

test('más felhasználó naplója nem kerül bele', () => {
  const anna = db.createUser('recent-anna', 'Anna', HASH).user;
  const bela = db.createUser('recent-bela', 'Béla', HASH).user;
  db.addNutritionEntry(anna.id, food(anna.id, 'Anna étele'), DAY, 100);

  assert.deepEqual(db.getRecentFoods(bela.id), []);
});
