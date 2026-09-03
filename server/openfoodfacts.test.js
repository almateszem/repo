/**
 * Az Open Food Facts leképezés és a vonalkód-normalizálás tesztjei.
 *
 * Ez a fájl SEM hálózatot, SEM adatbázist nem használ: a modul két tiszta
 * függvényét vizsgálja. Ezért nem kell hozzá FITTRACK_DB, ideiglenes könyvtár
 * vagy closeDatabase — ezredmásodpercek alatt fut. A hálózati kört és a
 * gyorsítótárat a végponti teszt (api.test.js) fedi le, egy helyi stubbal.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBarcode, mapProduct } from './openfoodfacts.js';

/* ======================================================================
   normalizeBarcode
   ====================================================================== */

test('normalizeBarcode: érvényes EAN-13 változatlan marad', () => {
  // 5998200310010 — helyes GS1 mod-10 ellenőrzőszámmal
  assert.equal(normalizeBarcode('5998200310010'), '5998200310010');
});

test('normalizeBarcode: a nem számjegyeket eldobja', () => {
  assert.equal(normalizeBarcode(' 5998 2003 1001 0 '), '5998200310010');
});

test('normalizeBarcode: az EAN-8 és az UPC-A EAN-13-ra egészül', () => {
  // Így ugyanaz a termék EGY cache-soron ül, akkor is, ha a kamera UPC-A-ként,
  // a felhasználó pedig EAN-13-ként adta meg.
  assert.equal(normalizeBarcode('96385074'), '0000096385074');
  assert.equal(normalizeBarcode('036000291452'), '0036000291452');
});

test('normalizeBarcode: a 14 jegyű GTIN elfogadott', () => {
  assert.equal(normalizeBarcode('00012345678905'), '00012345678905');
});

test('normalizeBarcode: rossz ellenőrzőszám elutasítva', () => {
  // Az utolsó számjegy 1-re rontva — enélkül egy félreolvasott számjegy némán
  // rossz termékre keresne rá.
  assert.equal(normalizeBarcode('5998200310011'), null);
});

test('normalizeBarcode: érvénytelen hossz és bemenet elutasítva', () => {
  for (const bad of ['', '123', '59982003100', '599820031001012', 'abcdefgh', null, undefined, {}]) {
    assert.equal(normalizeBarcode(bad), null, `elfogadta: ${JSON.stringify(bad)}`);
  }
});

/* ======================================================================
   mapProduct
   ====================================================================== */

const nutriments = (extra = {}) => ({
  'energy-kcal_100g': 61,
  proteins_100g: 10,
  carbohydrates_100g: 4,
  fat_100g: 0.5,
  ...extra,
});

test('mapProduct: a négy tápérték és a márkás név átjön', () => {
  const food = mapProduct({
    product_name: 'Görög joghurt',
    brands: 'Tesztmárka, Másodmárka',
    nutriments: nutriments(),
  }, '5998200310010');

  assert.equal(food.name, 'Görög joghurt (Tesztmárka)');
  assert.equal(food.brand, 'Tesztmárka'); // csak az első márka
  assert.equal(food.kcal, 61);
  assert.equal(food.protein, 10);
  assert.equal(food.carbs, 4);
  assert.equal(food.fat, 0.5);
  assert.equal(food.unit, 'g');
  assert.equal(food.barcode, '5998200310010');
  assert.equal(food.source, 'openfoodfacts');
});

test('mapProduct: a magyar név elsőbbséget élvez', () => {
  const food = mapProduct({
    product_name: 'Greek yogurt',
    product_name_hu: 'Görög joghurt',
    nutriments: nutriments(),
  }, '5998200310010');
  assert.equal(food.name, 'Görög joghurt');
});

test('mapProduct: a névben már benne lévő márka nem duplázódik', () => {
  const food = mapProduct({
    product_name: 'Tesztmárka Joghurt',
    brands: 'Tesztmárka',
    nutriments: nutriments(),
  }, '5998200310010');
  assert.equal(food.name, 'Tesztmárka Joghurt');
});

test('mapProduct: név nélküli terméknél a vonalkód az azonosító', () => {
  const food = mapProduct({ nutriments: nutriments() }, '5998200310010');
  assert.equal(food.name, 'Ismeretlen termék · 5998200310010');
});

test('mapProduct: a név 60 karakterre vágódik (a custom_foods korlátja)', () => {
  const food = mapProduct({ product_name: 'x'.repeat(200), nutriments: nutriments() }, '5998200310010');
  assert.equal(food.name.length, 60);
});

test('mapProduct: csak kJ-t adó termékből kcal számolódik', () => {
  // Sok európai termék kizárólag kilojoule-ban címkéz. 1 kcal = 4,184 kJ.
  const food = mapProduct({
    product_name: 'Csak kJ',
    nutriments: { 'energy-kj_100g': 1000, proteins_100g: 1, carbohydrates_100g: 1, fat_100g: 1 },
  }, '5998200310010');
  assert.equal(food.kcal, 239); // 1000 / 4,184 = 239,0…
});

test('mapProduct: a kcal-címke erősebb a kJ-nál, ha mindkettő megvan', () => {
  const food = mapProduct({
    product_name: 'Mindkettő',
    nutriments: { 'energy-kcal_100g': 100, 'energy-kj_100g': 1000, proteins_100g: 1 },
  }, '5998200310010');
  assert.equal(food.kcal, 100);
});

test('mapProduct: a folyadék-mennyiségből ml egység lesz', () => {
  for (const [quantity, expected] of [['500 ml', 'ml'], ['1,5 l', 'ml'], ['33 cl', 'ml'], ['150 g', 'g'], ['', 'g']]) {
    const food = mapProduct({ product_name: 'X', quantity, nutriments: nutriments() }, '5998200310010');
    assert.equal(food.unit, expected, `quantity: ${quantity}`);
  }
});

test('mapProduct: a serving_quantity adag-gyorsgombbá válik', () => {
  const food = mapProduct({
    product_name: 'X', serving_quantity: 30, serving_size: '30 g', nutriments: nutriments(),
  }, '5998200310010');
  assert.deepEqual(food.portions, [['1 adag · 30 g', 30]]);
});

test('mapProduct: a sávon kívüli serving_quantity kimarad', () => {
  for (const serving of [0, 5000, 'sok', null]) {
    const food = mapProduct({ product_name: 'X', serving_quantity: serving, nutriments: nutriments() }, '5998200310010');
    assert.deepEqual(food.portions, [], `serving: ${serving}`);
  }
});

test('mapProduct: a hiányzó tápérték null marad, NEM nulla', () => {
  /* Ez a lényeg: a 0 azt ÁLLÍTANÁ, hogy a termék nem tartalmaz zsírt, holott
     csak nem tudjuk. A null-t az űrlap üres mezőként mutatja, és a felhasználó
     a csomagolásról pótolja. */
  const food = mapProduct({
    product_name: 'Részleges',
    nutriments: { proteins_100g: 10 },
  }, '5998200310010');
  assert.equal(food.protein, 10);
  assert.equal(food.carbs, null);
  assert.equal(food.fat, null);
  assert.equal(food.kcal, null);
});

test('mapProduct: az üres sztringes tápérték is null lesz', () => {
  const food = mapProduct({
    product_name: 'Üres mezők',
    nutriments: { proteins_100g: '', carbohydrates_100g: 4, fat_100g: null },
  }, '5998200310010');
  assert.equal(food.protein, null);
  assert.equal(food.carbs, 4);
  assert.equal(food.fat, null);
});

test('mapProduct: tápérték nélküli termékre null (nincs mit előre kitölteni)', () => {
  assert.equal(mapProduct({ product_name: 'Semmi', nutriments: {} }, '5998200310010'), null);
  assert.equal(mapProduct({ product_name: 'Semmi' }, '5998200310010'), null);
});
