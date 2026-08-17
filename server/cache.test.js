/**
 * FitTrack Pro — a kollekció-cache SZERZŐDÉSE
 * -------------------------------------------
 * A teljesítmény-javítás két nagy referencia-listát (exerciseCatalog, foods)
 * memóriában tart, hogy ne kelljen kérésenként újra JSON-ból visszafejteni
 * őket. Ennek a gyorsításnak azonban van egy kimondott ára, amit könnyű
 * elfelejteni: a cache-elt kulcsoknál MINDEN hívó UGYANAZT az objektumot kapja.
 *
 * Ebből két, egymással ellentétes irányú hiba tud születni:
 *
 *   1. Ha valaki egy cache-elt listát MÓDOSÍT, a módosítás átszivárog minden
 *      további kérésbe — és minden felhasználóhoz.
 *   2. Ha valaki egy FELHASZNÁLÓ-SPECIFIKUSAN felülírt kulcsot (dashboard)
 *      tesz be a cache-be, akkor a végpont által ráírt streak/készenlét
 *      kérésről kérésre egymásra rakódik: „A" a saját adata helyett „B"-ét
 *      látná. A db.js kommentje külön figyelmeztet erre — ez a fájl az, ami
 *      észre is veszi, ha valaki mégis megteszi.
 *
 * Ezért itt nem viselkedést mérünk, hanem OBJEKTUM-AZONOSSÁGOT: mi osztozik,
 * és mi nem.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-cache-'));
process.env.FITTRACK_DB = path.join(workDir, 'test.db');

const db = await import('./db.js');
const { resolveExerciseLoad } = await import('./muscles.js');

process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

test('a két nagy referencia-lista cache-elt — ugyanazt a tömböt kapjuk vissza', () => {
  for (const key of ['exerciseCatalog', 'foods']) {
    const first = db.getCollection(key);
    const second = db.getCollection(key);
    assert.ok(Array.isArray(first) && first.length > 0, `${key}: van tartalma`);
    assert.equal(first, second, `${key}: ugyanaz az objektum — nincs újra-JSON.parse`);
  }
});

test('a dashboard NEM cache-elt — minden kérés friss objektumot kap', () => {
  /* A /api/dashboard végpont a lekért objektumra ÍRJA rá a felhasználó
     streakjét és készenlétét. Ha ez a kulcs bekerülne a CACHED_COLLECTIONS-be,
     a két felhasználó egymás adatait látná. */
  const first = db.getCollection('dashboard');
  const second = db.getCollection('dashboard');
  assert.ok(first, 'van dashboard kollekció');
  assert.notEqual(first, second, 'külön objektum — a ráírt mezők nem rakódnak egymásra');

  // És tényleg: az egyikre írva a másik érintetlen marad.
  first.readiness = 42;
  assert.equal(db.getCollection('dashboard').readiness, undefined,
    'a ráírt mező nem szivárog át a következő kérésbe');
});

test('a felhasználó-specifikusan felülírt kulcsok egyike sem cache-elt', () => {
  /* A server.js ezekre a kollekciókra épít saját mezőket vagy szór rájuk
     számított adatot (dashboard, charts, user). Egyik sem osztozhat. */
  for (const key of ['dashboard', 'charts', 'user']) {
    const value = db.getCollection(key);
    if (value === null) continue; // nincs ilyen seed-kulcs — nincs mit védeni
    assert.notEqual(db.getCollection(key), value, `${key}: nem lehet cache-elt`);
  }
});

test('az ismeretlen kulcs null-t ad, és nem szemeteli tele a cache-t', () => {
  assert.equal(db.getCollection('nincs-ilyen-kulcs'), null);
  assert.equal(db.getCollection('nincs-ilyen-kulcs'), null);
});

test('a katalógus név-indexe újrahasznosul — ugyanaz a súly-objektum jön vissza', () => {
  /* Ez a 240 ms-os lassulás őrzője. A resolveExerciseLoad korábban minden
     hívásnál végigpásztázta az 1401 soros katalógust, és minden sorra újra
     lefuttatta a normalizeName-et. Most katalógus-tömbönként egyszer épül egy
     név-index, WeakMap-ben tárolva.

     Ha valaki elrontja az index gyorsítótárazását (pl. minden hívásnál újra
     felépíti), a súly-objektum minden hívásnál ÚJ lesz — a lassulás
     visszatér, de a viselkedés nem változik, tehát semmilyen más teszt nem
     venné észre. Ez a referencia-egyezés az egyetlen olcsó jelzés róla. */
  const catalog = db.getCollection('exerciseCatalog');
  const nev = catalog.find((item) => item.load && Object.keys(item.load).length > 0)?.name;
  assert.ok(nev, 'van load-súlyokkal ellátott katalógus-sor');

  const first = resolveExerciseLoad(nev, catalog);
  const second = resolveExerciseLoad(nev, catalog);
  assert.equal(first, second, 'az index újrahasznosult, nem épült fel újra');
  assert.ok(Object.keys(first).length > 0, 'a súlyok meg is jöttek');
});

test('a katalógus-index a hívó tömbjéhez kötődik, nem globális állapot', () => {
  /* A WeakMap kulcsa maga a katalógus-tömb. Egy MÁSIK tömbnek saját indexe
     van — így a modul kívülről nézve állapotmentes marad, és egy teszt (vagy
     egy jövőbeli második katalógus) nem szennyezi a másikat. */
  const sajat = [{ name: 'Kitalált emelés', load: { chest: 1 } }];
  assert.deepEqual(resolveExerciseLoad('Kitalált emelés', sajat), { chest: 1 });
  // Ugyanez a név az igazi katalógussal nem található — nincs átszivárgás.
  assert.deepEqual(resolveExerciseLoad('Kitalált emelés', db.getCollection('exerciseCatalog')), {});
});
