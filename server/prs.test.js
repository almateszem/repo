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

const db = await import('./db.js');

/* Takarítás előtt zárjuk az adatbázist — Windowson a nyitott fájlt tartó
   könyvtár törlése EPERM-mel elszáll (ld. db.js → closeDatabase). */
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

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

/* ======================================================================
   A rekordot hozó szett — bemelegítővel és drop settel együtt
   ----------------------------------------------------------------------
   A szett-típusokat és az automatikus PR-számítást két külön ág hozta, és a
   találkozásuknál a felület első sora alapból BEMELEGÍTŐ lett. Ha a rekord
   „az első teljesített szett", akkor a napló a legkönnyebb sorozatot hirdeti
   csúcsnak — miközben a tárolt maximum a nehezet mutatja.
   ====================================================================== */

test('a rekordot a legjobb teljesített szett hozza, nem a bemelegítő', () => {
  const sets = [
    { reps: '10', weight: '40', rpe: '6', type: 'warmup', done: true },
    { reps: '5', weight: '100', rpe: '9', type: 'work', done: true },
    { reps: '8', weight: '80', rpe: '9', type: 'drop', done: true },
  ];
  const record = db.bestCompletedSet(sets);
  assert.equal(record.weight, '100', `a nehéz munkasorozat a rekord (kapott: ${record.weight} kg)`);
});

test('a bemelegítő sor nem szorítja le a nyomon követett csúcsot', () => {
  const user = db.createUser('tipusos', 'Típusos Tibor', 'scrypt$16384$8$1$ee$ff').user;
  db.addWorkout(user.id, 'Mellnap', TODAY, [{
    name: 'Fekvenyomás',
    pr: false,
    sets: [
      { reps: '10', weight: '40', rpe: '6', type: 'warmup', done: true },
      { reps: '5', weight: '100', rpe: '9', type: 'work', done: true },
    ],
  }]);
  assert.equal(db.getExerciseMax(user.id, 'Fekvenyomás').max1rm, db.calculateEpley1RM(100, 5));
});

test('teljesített szett híján az első sor a rekord, üres listára null', () => {
  const sets = [{ reps: '5', weight: '60', rpe: '8', type: 'work', done: false }];
  assert.equal(db.bestCompletedSet(sets), sets[0]);
  assert.equal(db.bestCompletedSet([]), null);
  assert.equal(db.bestCompletedSet(), null);
});

/* ======================================================================
   Törlés és javítás — a csúcsok VISSZAFELÉ is követik a naplót
   ----------------------------------------------------------------------
   Az updateExerciseMax csak felfelé lép. Amíg a naplóhoz csak hozzáadni
   lehetett, ez pontosan jó volt; mióta törölni és javítani is, azóta a
   megszűnt teljesítmény csúcsa bent ragadna, és elzárná a jövőbeli VALÓDI
   PR-t. Az itteni állítások azt kérik számon, hogy a rekord a MEGMARADT
   edzésekből következik — és hogy a workouts sorokban tárolt `pr` jelzők
   (amikből a PR-lista dolgozik) ugyanazt mondják, mint a tábla.
   ====================================================================== */

const torlo = db.createUser('torlo', 'Törlő Tódor', 'scrypt$16384$8$1$gg$hh').user;

test('a rekordot hozó edzés törlése után a csúcs a következő legjobbra esik vissza', () => {
  const nehez = db.addWorkout(torlo.id, 'Nehéz nap', TODAY, nyomas(100));
  db.addWorkout(torlo.id, 'Könnyebb nap', HOLNAP, nyomas(80));
  assert.equal(db.getExerciseMax(torlo.id, 'Fekvenyomás').max1rm, db.calculateEpley1RM(100, 5));

  assert.equal(db.deleteWorkout(torlo.id, nehez.id), true);

  const max = db.getExerciseMax(torlo.id, 'Fekvenyomás');
  assert.equal(max.max1rm, db.calculateEpley1RM(80, 5), 'a csúcs a megmaradt edzésből jön');
  assert.equal(max.date, HOLNAP, 'és a MEGMARADT edzés napját viseli, nem a mait');
});

test('a törlés a megmaradt edzés `pr` jelzőjét is átbillenti', () => {
  // A 80 kg-os edzés mentésekor még NEM volt rekord (a 100 fölötte állt) —
  // a törlés után viszont az lett. Ha a jelző false maradna, a PR-lista
  // üresen állna egy olyan gyakorlatra, aminek közben van tárolt csúcsa.
  const [maradt] = db.getWorkouts(torlo.id);
  assert.equal(maradt.name, 'Könnyebb nap');
  assert.equal(maradt.exercises[0].pr, true);
});

test('az utolsó edzés törlésével a csúcs is eltűnik', () => {
  const [maradt] = db.getWorkouts(torlo.id);
  assert.equal(db.deleteWorkout(torlo.id, maradt.id), true);
  assert.equal(db.getExerciseMax(torlo.id, 'Fekvenyomás'), null,
    'edzés nélkül nincs mire hivatkozni — a rekord nem élheti túl a naplóját');
  assert.deepEqual(db.getWorkouts(torlo.id), []);
});

test('MÁS felhasználó edzését nem lehet törölni, és a csúcsaihoz sem nyúl', () => {
  const [elekE] = db.getWorkouts(eros.id);
  assert.equal(db.deleteWorkout(torlo.id, elekE.id), false, 'idegen sorra false');
  assert.equal(db.deleteWorkout(torlo.id, 999999), false, 'nem létező sorra is false');
  assert.equal(db.getExerciseMax(eros.id, 'Fekvenyomás').max1rm, db.calculateEpley1RM(100, 5),
    'Elek csúcsa érintetlen');
  assert.equal(db.getWorkouts(eros.id).length, 2, 'és az edzései is megvannak');
});

test('a javítás a saját napján hagyja az edzést, és újraszámolja a csúcsot', () => {
  const user = db.createUser('javito', 'Javító Judit', 'scrypt$16384$8$1$ii$jj').user;
  const elgepelt = db.addWorkout(user.id, 'Mellnap', TODAY, nyomas(180));
  assert.equal(db.getExerciseMax(user.id, 'Fekvenyomás').max1rm, db.calculateEpley1RM(180, 5));

  const javitott = db.updateWorkout(user.id, elgepelt.id, 'Mellnap', nyomas(80));

  assert.equal(javitott.date, TODAY, 'a javítás NEM helyezi át a mai napra');
  assert.equal(javitott.id, elgepelt.id, 'ugyanaz a sor, nem új');
  assert.equal(db.getExerciseMax(user.id, 'Fekvenyomás').max1rm, db.calculateEpley1RM(80, 5),
    'az elgépelt 180 kg-os rekord nem ragadhat bent');
});

test('MÁS felhasználó edzését javítani sem lehet', () => {
  const [elekE] = db.getWorkouts(eros.id);
  assert.equal(db.updateWorkout(kezdo.id, elekE.id, 'Átírva', nyomas(1)), null);
  assert.equal(db.getWorkouts(eros.id)[0].name, elekE.name, 'a neve sem változott');
});

test('a csúcs a DÁTUM szerinti sorrendet követi, nem a beszúrásit', () => {
  /* Ez a javítás miatt lényeges: egy RÉGI edzés utólag szerkesztve a
     beszúrási sorrendben későbbinek látszik. Ha az újraszámolás id szerint
     menne, a régi edzés vinné el a rekordot egy nála frissebb elől. */
  const user = db.createUser('sorrend', 'Sorrend Sári', 'scrypt$16384$8$1$kk$ll').user;
  const regi = db.addWorkout(user.id, 'Régi', TODAY, nyomas(60));
  db.addWorkout(user.id, 'Friss', HOLNAP, nyomas(100));

  // A RÉGI edzést javítjuk — a sora ettől „mozdul meg" utoljára
  db.updateWorkout(user.id, regi.id, 'Régi javítva', nyomas(70));

  const max = db.getExerciseMax(user.id, 'Fekvenyomás');
  assert.equal(max.max1rm, db.calculateEpley1RM(100, 5), 'a nagyobb súly a rekord');
  assert.equal(max.date, HOLNAP, 'és a FRISSEBB edzés napján áll');

  /* Itt válik el a két rendezés. IDŐREND szerint a régi edzés a maga napján
     az ELSŐ mért teljesítmény volt, tehát rekord — és az is marad. Ha az
     újraszámolás id szerint menne, a javított sor a friss edzés UTÁN
     következne, és a napló azt állítaná, hogy a korábbi edzés sosem volt
     rekord. */
  const [friss, regiSor] = db.getWorkouts(user.id);
  assert.equal(friss.exercises[0].pr, true, 'a frissebb, nehezebb edzés rekord');
  assert.equal(regiSor.exercises[0].pr, true, 'a korábbi edzés a maga idejében is az volt');
});
