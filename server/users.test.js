/**
 * FitTrack Pro — a felhasználók közti ADATIZOLÁCIÓ tesztjei
 * ----------------------------------------------------------
 * Ez a fájl azt a HIBÁT őrzi, ami miatt a fiókok bekerültek: korábban egyetlen
 * közös adathalmaz volt, és két ember felülírta egymás adatait.
 *
 * Minden itteni állítás ugyanazt kérdezi: lát-e „A" bármit is „B" adatából —
 * listázással, id-re hivatkozva, vagy exporttal. A válasz mindenhol nem.
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

const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-users-'));
process.env.FITTRACK_DB = path.join(workDir, 'test.db');

const db = await import('./db.js');

/* A takarítás előtt ZÁRJUK az adatbázist: Windowson egy nyitott fájlt nem
   lehet törölni, és az EPERM megbuktatta a tesztfájlt úgy, hogy közben minden
   állítása teljesült. */
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

/* ---- Két fiók, mindkettőben adat ---- */

const anna = db.createUser('anna', 'Kovács Anna', 'scrypt$16384$8$1$aa$bb').user;
const bela = db.createUser('bela', 'Nagy Béla', 'scrypt$16384$8$1$cc$dd').user;

const TODAY = '2026.08.15';
const exercises = [{ name: 'Guggolás', pr: false, sets: [{ reps: '5', weight: '100', rpe: '8', done: true }] }];

db.addWeightEntry(anna.id, 62.5, TODAY);
db.addWeightEntry(bela.id, 95, TODAY);
db.addWorkout(anna.id, 'Anna edzése', TODAY, exercises);
db.addWorkout(bela.id, 'Béla edzése', TODAY, exercises);
const annaPlan = db.addPlan(anna.id, 'Anna terve', TODAY, exercises, [0]);
const belaPlan = db.addPlan(bela.id, 'Béla terve', TODAY, exercises, [1]);
db.saveWorkoutDraft(anna.id, 'Anna piszkozata', exercises, TODAY);
db.saveWorkoutDraft(bela.id, 'Béla piszkozata', exercises, TODAY);
db.saveCheckin(anna.id, TODAY, { sleepHours: 9, energy: 5 });
db.saveCheckin(bela.id, TODAY, { sleepHours: 4, energy: 1 });

const food = { name: 'Teszt étel', kcal: 100, protein: 10, carbs: 10, fat: 5 };
const annaEntry = db.addNutritionEntry(anna.id, food, TODAY, 100).entry;
const belaEntry = db.addNutritionEntry(bela.id, food, TODAY, 200).entry;

// A saját ételek is felhasználói adat — ugyanaz az izolációs elvárás áll rájuk.
const annaFood = db.addCustomFood(anna.id, {
  name: 'Anna müzlije', unit: 'g', kcal: 380, protein: 9, carbs: 62, fat: 10,
  kcalAuto: true, barcode: '5998200310010',
});

test('a fiók létrehozása nem adja vissza a jelszót, és a név foglalt lesz', () => {
  assert.deepEqual(Object.keys(anna).sort(), ['displayName', 'id', 'username']);
  assert.equal(db.createUser('anna', 'Másik Anna', 'scrypt$1$1$1$x$y'), null, 'foglalt név');
  assert.ok(db.hasAnyUser());
});

test('minden lista CSAK a saját sorokat adja vissza', () => {
  assert.deepEqual(db.getWeightLog(anna.id).map((w) => w.kg), [62.5]);
  assert.deepEqual(db.getWeightLog(bela.id).map((w) => w.kg), [95]);

  assert.deepEqual(db.getWorkouts(anna.id).map((w) => w.name), ['Anna edzése']);
  assert.deepEqual(db.getWorkouts(bela.id).map((w) => w.name), ['Béla edzése']);

  assert.deepEqual(db.getUserPlans(anna.id).map((p) => p.name), ['Anna terve']);
  assert.deepEqual(db.getUserPlans(bela.id).map((p) => p.name), ['Béla terve']);

  assert.equal(db.getWorkoutDraft(anna.id).name, 'Anna piszkozata');
  assert.equal(db.getWorkoutDraft(bela.id).name, 'Béla piszkozata');

  assert.deepEqual(db.getNutritionLog(anna.id).map((n) => n.grams), [100]);
  assert.deepEqual(db.getNutritionLog(bela.id).map((n) => n.grams), [200]);

  assert.equal(db.getCheckin(anna.id, TODAY).sleepHours, 9);
  assert.equal(db.getCheckin(bela.id, TODAY).sleepHours, 4);
  assert.equal(db.getCheckins(anna.id).length, 1);
});

test('a napi összesítő nem keveri össze a két fiók bevitelét', () => {
  // Anna 100 g-ot, Béla 200 g-ot naplózott ugyanabból az ételből.
  assert.equal(db.getNutritionTotals(anna.id, TODAY).intake, 100);
  assert.equal(db.getNutritionTotals(bela.id, TODAY).intake, 200);
});

test('a piszkozat felhasználónkénti — nem írják felül egymást', () => {
  // Ez volt a konkrét hiba: a workout_draft egyetlen sor volt (id = 1).
  db.saveWorkoutDraft(bela.id, 'Béla átírta a sajátját', exercises, TODAY);
  assert.equal(db.getWorkoutDraft(anna.id).name, 'Anna piszkozata', 'Anna piszkozata érintetlen');
  assert.equal(db.getWorkoutDraft(bela.id).name, 'Béla átírta a sajátját');

  db.clearWorkoutDraft(bela.id);
  assert.equal(db.getWorkoutDraft(bela.id), null);
  assert.ok(db.getWorkoutDraft(anna.id), 'a másik törlése nem vitte el Annáét');
});

test('MÁS fiók sorát id-re hivatkozva sem lehet módosítani vagy törölni', () => {
  // A kliens bármilyen id-t küldhet; a szűrés a lekérdezésben van, nem a
  // felületen. Az „idegen" id-re null jön, amiből a végpont 404-et képez.
  assert.equal(
    db.updatePlan(bela.id, annaPlan.id, 'ELTÉRÍTVE', exercises, []), null,
    'Béla nem írhatja át Anna tervét',
  );
  assert.equal(db.getUserPlans(anna.id)[0].name, 'Anna terve', 'Anna terve változatlan');

  assert.equal(
    db.deleteNutritionEntry(bela.id, annaEntry.id, TODAY), null,
    'Béla nem törölheti Anna naplótételét',
  );
  assert.equal(db.getNutritionLog(anna.id).length, 1, 'Anna tétele megvan');

  // A sajátjával viszont mindkettő működik — a szűrés nem tör el mindent
  assert.ok(db.updatePlan(bela.id, belaPlan.id, 'Béla átnevezte', exercises, []));
  assert.ok(db.deleteNutritionEntry(bela.id, belaEntry.id, TODAY));
});

test('a napra ütemezett terv is fiókonként külön', () => {
  assert.equal(db.getPlanForDay(anna.id, 0)?.name, 'Anna terve');
  assert.equal(db.getPlanForDay(bela.id, 0), null, 'Anna hétfői terve nem jön át Bélának');
});

test('az export CSAK a hívó adatát tartalmazza', () => {
  const snapshot = db.getSnapshot(anna.id);
  assert.deepEqual(snapshot.weightLog.map((w) => w.kg), [62.5]);
  assert.deepEqual(snapshot.workouts.map((w) => w.name), ['Anna edzése']);
  assert.equal(snapshot.workoutDraft.name, 'Anna piszkozata');
  assert.equal(snapshot.checkins.length, 1);
  // Az egyéni csúcsok is a felhasználó adata — a pillanatképnek része.
  assert.deepEqual(snapshot.exerciseMaxes,
    [{ exercise: 'Guggolás', max1rm: db.calculateEpley1RM(100, 5), date: TODAY }]);

  // A referencia-adat (közös) viszont benne van — abból mindenki ugyanazt kapja
  assert.ok(Array.isArray(snapshot.foods) && snapshot.foods.length > 0);

  // A saját ételek is a felhasználó adata (a naplóból nem rekonstruálhatók).
  assert.deepEqual(snapshot.customFoods.map((f) => f.name), ['Anna müzlije']);
  assert.deepEqual(db.getSnapshot(bela.id).customFoods, []);

  const dump = JSON.stringify(snapshot);
  assert.ok(!dump.includes('Béla'), 'a másik fiók adata sehol nem szivárog be');
});

/* ---- Saját ételek ---- */

test('a saját ételeket csak a tulajdonosuk éri el', () => {
  assert.deepEqual(db.listCustomFoods(anna.id).map((f) => f.name), ['Anna müzlije']);
  assert.deepEqual(db.listCustomFoods(bela.id), [], 'Bélának nincs saját étele');

  assert.equal(db.getCustomFoodByName(bela.id, 'Anna müzlije'), null);
  assert.equal(db.getCustomFoodByBarcode(bela.id, '5998200310010'), null);
  assert.ok(db.getCustomFoodByBarcode(anna.id, '5998200310010'), 'Anna viszont megtalálja');
});

test('MÁS fiók saját ételét nem lehet törölni', () => {
  assert.equal(db.deleteCustomFood(bela.id, annaFood.id), false);
  assert.equal(db.listCustomFoods(anna.id).length, 1, 'Anna étele érintetlen');
});

test('a naplózási keresés a SAJÁT ételt is megtalálja, de csak a tulajdonosnak', () => {
  assert.equal(db.findFoodForUser(anna.id, 'Anna müzlije').kcal, 380);
  assert.equal(db.findFoodForUser(bela.id, 'Anna müzlije'), null);
  // A beépített katalógus viszont mindkettejüknek elérhető.
  const seedName = db.getCollection('foods')[0].name;
  assert.ok(db.findFoodForUser(anna.id, seedName));
  assert.ok(db.findFoodForUser(bela.id, seedName));
});

test('getFoodsForUser: a saját ételek elöl, és a MEGOSZTOTT cache érintetlen marad', () => {
  /* Ez a legfontosabb állítás itt. A getCollection('foods') tömbje cache-elt
     és MINDEN kérésnek ugyanaz az objektum: ha a merge belepush-olna, Anna
     müzlije a folyamat élettartamáig ott ragadna MINDENKI katalógusában. */
  const kiindulas = db.getCollection('foods').length;

  const annaFoods = db.getFoodsForUser(anna.id);
  const belaFoods = db.getFoodsForUser(bela.id);

  assert.equal(annaFoods[0].name, 'Anna müzlije', 'a saját étel a lista elején');
  assert.equal(annaFoods.length, kiindulas + 1);
  assert.equal(belaFoods.length, kiindulas, 'Bélának csak a seed-katalógus');
  assert.ok(!belaFoods.some((f) => f.custom));

  assert.equal(db.getCollection('foods').length, kiindulas,
    'a megosztott katalógus-tömb NEM módosult');
});

test('munkamenet: érvényes, lejárt és ismeretlen token', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  db.createSession('hash-ervenyes', anna.id, future);
  db.createSession('hash-lejart', bela.id, past);

  assert.equal(db.getSessionUser('hash-ervenyes').username, 'anna');
  assert.equal(db.getSessionUser('hash-lejart'), null, 'a lejárt munkamenet nem enged be');
  assert.equal(db.getSessionUser('nincs-ilyen'), null);

  // A lejárt sort a lekérdezés menet közben ki is takarította
  assert.equal(db.purgeExpiredSessions(), 0, 'már nem maradt lejárt sor');

  db.deleteSession('hash-ervenyes');
  assert.equal(db.getSessionUser('hash-ervenyes'), null, 'kijelentkezés után érvénytelen');
});

test('ismeretlen fiók azonosítójára üres eredmény jön, nem más adata', () => {
  // Ha valahol elmaradna a userId (bug), az eredmény legyen ÜRES, ne pedig
  // véletlenül a legelső felhasználó adata.
  const ghost = 99999;
  assert.deepEqual(db.getWeightLog(ghost), []);
  assert.deepEqual(db.getWorkouts(ghost), []);
  assert.deepEqual(db.getUserPlans(ghost), []);
  assert.equal(db.getWorkoutDraft(ghost), null);
  assert.equal(db.getCheckin(ghost, TODAY), null);
  assert.equal(db.getNutritionTotals(ghost, TODAY).intake, 0);
  assert.equal(db.getUser(ghost), null);
});

test('hiányzó userId HIBÁT dob — nem ad vissza csendben idegen adatot', () => {
  // Ha egy végpontról valaha lemaradna a userId, azt azonnal lássuk: a
  // node:sqlite nem tud undefined-ot paraméterként kötni, és dob. Ez sokkal
  // jobb, mint némán üres (vagy rosszabb: valaki más) adatot adni — a hívó
  // 500-at kap, ami kiderül, nem pedig egy csendes adatszivárgás.
  for (const call of [
    () => db.getWeightLog(undefined),
    () => db.getWorkouts(undefined),
    () => db.getUserPlans(undefined),
    () => db.getWorkoutDraft(undefined),
  ]) {
    assert.throws(call, /cannot be bound|SQLite/i);
  }
});
