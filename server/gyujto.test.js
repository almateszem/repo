/**
 * A Gyűjtő validálásának unit-tesztjei
 * ====================================
 * A modul maga a BÖNGÉSZŐBEN fut (public/gyujto/products.js) — de sima ES-modul,
 * tiszta függvényekkel, tehát Node-ból változtatás nélkül tesztelhető. Ezért
 * fekszik a tesztje itt, a többi `npm test` közt: egy külön futtatóért, ami
 * ugyanezt böngészőben csinálná, nem érné meg a bonyolultságot.
 *
 * A tétje nem elméleti: a szabályok szándékosan azonosak a szerver
 * `parseCollected`-jével, mert a gyűjtésnek VÁLTOZTATÁS NÉLKÜL át kell mennie
 * a feltöltéskor is. Ha itt megengedőbbek lennénk, az a feltöltés napján
 * derülne ki — a bolt után, amikor már nincs kéznél a csomagolás.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProduct, computeKcal, kcalTolerance, normalizePortions, isComplete,
  macroValue, MACRO_MAX, KCAL_MAX,
} from '../public/gyujto/products.js';

const KOD = '5998200310010';   // érvényes EAN-13
const KOD2 = '5901234123457';

/** Minimális, érvényes törzs — az egyes tesztek ezt írják felül. */
const alap = (extra = {}) => ({ barcode: KOD, name: 'Teszt termék', ...extra });

/* ---- Kalória ---- */

test('a kalória a makrókból számolódik (Atwater 4/4/9)', () => {
  // 10·4 + 4·4 + 0,5·9 = 60,5 → egészre kerekítve 61
  assert.equal(computeKcal({ protein: 10, carbs: 4, fat: 0.5 }), 61);
  assert.equal(computeKcal({ protein: 0, carbs: 0, fat: 0 }), 0);

  const { value } = parseProduct(alap({ protein: 20, carbs: 10, fat: 5 }));
  assert.equal(value.kcal, 165);
  assert.equal(value.kcalAuto, true);
});

test('a tűrés a fix 50 kcal és a számított 30%-a közül a nagyobbik', () => {
  assert.equal(kcalTolerance(10), 50);    // kis értéknél a fix határ véd
  assert.equal(kcalTolerance(500), 150);  // nagy értéknél a százalék
});

test('a kézzel megadott kalória a tűrésen belül elfogadott', () => {
  const jo = parseProduct(alap({ protein: 20, carbs: 10, fat: 5, kcalMode: 'manual', kcal: 200 }));
  assert.equal(jo.ok, true);
  assert.equal(jo.value.kcal, 200);
  assert.equal(jo.value.kcalAuto, false, 'a kézi érték nem számítottnak jelölődik');

  const rossz = parseProduct(alap({ protein: 20, carbs: 10, fat: 5, kcalMode: 'manual', kcal: 400 }));
  assert.equal(rossz.ok, false);
  assert.match(rossz.error, /nem fér össze a makrókkal/);
});

test('a kalória a 0–900 sávon kívül elutasított', () => {
  const res = parseProduct(alap({ kcalMode: 'manual', kcal: KCAL_MAX + 1 }));
  assert.equal(res.ok, false);
  assert.match(res.error, /0 és 900 kcal között/);
});

/* ---- Makrók ---- */

test('a makró 0 és 100 g között adható meg', () => {
  assert.equal(macroValue(''), undefined, 'az üres mező = nem adták meg');
  assert.equal(macroValue(12.34), 12.3, 'egy tizedesre kerekít');
  assert.equal(macroValue(-1), null);
  assert.equal(macroValue(MACRO_MAX + 1), null);

  const res = parseProduct(alap({ protein: 150 }));
  assert.equal(res.ok, false);
  assert.match(res.error, /0 és 100 g között/);
});

test('a három makró összege nem lehet több 100 g-nál', () => {
  const res = parseProduct(alap({ protein: 50, carbs: 40, fat: 20 }));
  assert.equal(res.ok, false);
  assert.match(res.error, /összege/);
});

test('a hiányzó makró null marad, nem nulla', () => {
  // A nulla azt ÁLLÍTANÁ, hogy nincs benne fehérje — a null azt, hogy még nem tudjuk.
  const { value } = parseProduct(alap({ protein: 10 }));
  assert.equal(value.protein, 10);
  assert.equal(value.carbs, null);
  assert.equal(value.fat, null);
  assert.equal(value.kcal, null, 'hiányos makrókból nem számolunk kalóriát');
});

/* ---- Állapot ---- */

test('a hiányos tétel piszkozat marad, akkor is, ha a kliens készt kér', () => {
  const { value } = parseProduct(alap({ status: 'kesz', protein: 10 }));
  assert.equal(value.status, 'piszkozat');
  assert.equal(isComplete(value), false);
});

test('a teljes tétel kész lesz, és piszkozatként is menthető', () => {
  const kesz = parseProduct(alap({ protein: 10, carbs: 4, fat: 0.5 })).value;
  assert.equal(isComplete(kesz), true);
  assert.equal(kesz.status, 'kesz');

  const piszkozat = parseProduct(alap({ status: 'piszkozat', protein: 10, carbs: 4, fat: 0.5 })).value;
  assert.equal(piszkozat.status, 'piszkozat');
});

test('a „feltoltve” kívülről nem kérhető', () => {
  // Ezt csak a SIKERES feltöltés írhatja be: egy kliens nem állíthatja
  // magáról, hogy az adata már átment a FitTrack-be.
  const { value } = parseProduct(alap({ status: 'feltoltve', protein: 10, carbs: 4, fat: 0.5 }));
  assert.equal(value.status, 'kesz');
});

/* ---- Név, vonalkód, kategória, adagok ---- */

test('a név 2–60 karakter, a többszörös szóköz összevonva', () => {
  assert.equal(parseProduct(alap({ name: 'x' })).ok, false);
  assert.equal(parseProduct(alap({ name: 'x'.repeat(61) })).ok, false);
  assert.equal(parseProduct(alap({ name: '  Natúr   joghurt ' })).value.name, 'Natúr joghurt');
});

test('a vonalkód kötelező, és az ellenőrzőszámnak stimmelnie kell', () => {
  assert.equal(parseProduct({ name: 'Valami' }).ok, false);
  assert.match(parseProduct({ name: 'Valami', barcode: '5998200310011' }).error, /Érvénytelen vonalkód/);
  // A rövidebb kód EAN-13-ra egészül — így egy termék EGY soron ül akkor is,
  // ha a kamera UPC-A-ként, a felhasználó EAN-13-ként adta meg.
  assert.equal(parseProduct({ name: 'Valami', barcode: '036000291452' }).value.barcode, '0036000291452');
});

test('csak a FitTrack ismert kategóriái fogadhatók el', () => {
  assert.equal(parseProduct(alap({ group: 'Tejtermék' })).value.foodGroup, 'Tejtermék');
  assert.equal(parseProduct(alap({ group: '' })).value.foodGroup, '');
  assert.equal(parseProduct(alap({ group: 'Kitalált csoport' })).ok, false);
});

test('az adagok normalizálódnak, a hibás elemek csendben kiesnek', () => {
  assert.deepEqual(normalizePortions([['1 db', 55.4], ['', 100], ['x', 0], ['y', 3000]]), [['1 db', 55]]);
  assert.deepEqual(normalizePortions('nem tömb'), []);
  assert.equal(normalizePortions([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]).length, 4);
});

test('a szöveges mezők hossza korlátos', () => {
  const { value } = parseProduct(alap({
    brand: 'M'.repeat(100), note: 'J'.repeat(300), store: 'B'.repeat(100), barcode: KOD2,
  }));
  assert.equal(value.brand.length, 60);
  assert.equal(value.note.length, 200);
  assert.equal(value.store.length, 60);
});

test('az egység csak g vagy ml lehet', () => {
  assert.equal(parseProduct(alap({ unit: 'ml' })).value.unit, 'ml');
  assert.equal(parseProduct(alap({ unit: 'liter' })).value.unit, 'g');
});
