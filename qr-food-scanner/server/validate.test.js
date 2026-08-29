/** A makró-űrlap validálása — a rendszer egyetlen pontja, ahol adat lép be. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProduct, kcalFromMacros } from './validate.js';

const BARCODE = '5997523110253';
const valid = { name: 'Házi müzli', unit: 'g', protein: 12, carbs: 60, fat: 9, kcal: 369 };

test('érvényes adat átmegy, a nevet trimmeli', () => {
  const result = validateProduct({ ...valid, name: '  Házi   müzli ' }, BARCODE);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { barcode: BARCODE, ...valid });
});

test('a tizedesvessző is szám (magyar billentyűzet)', () => {
  const result = validateProduct({ ...valid, protein: '12,5', kcal: '370' }, BARCODE);
  assert.equal(result.ok, true);
  assert.equal(result.value.protein, 12.5);
  assert.equal(result.value.kcal, 370);
});

test('a lebegőpontos maradék nem kerül az adatbázisba', () => {
  const result = validateProduct({ ...valid, fat: 0.1 + 0.2 }, BARCODE);
  assert.equal(result.value.fat, 0.3);
});

test('név nélkül nincs mentés', () => {
  const result = validateProduct({ ...valid, name: '   ' }, BARCODE);
  assert.equal(result.ok, false);
  assert.match(result.error, /nevet/);
});

test('hiányzó makró: hibaüzenet, nem néma nulla', () => {
  const result = validateProduct({ ...valid, carbs: '' }, BARCODE);
  assert.equal(result.ok, false);
  assert.match(result.error, /szénhidrát/);
});

test('100 g-nál több makró 100 g termékben lehetetlen', () => {
  const result = validateProduct({ ...valid, protein: 40, carbs: 40, fat: 40 }, BARCODE);
  assert.equal(result.ok, false);
  assert.match(result.error, /együtt/);
});

test('negatív és irreális érték elutasítva', () => {
  assert.equal(validateProduct({ ...valid, fat: -1 }, BARCODE).ok, false);
  assert.equal(validateProduct({ ...valid, kcal: 5000 }, BARCODE).ok, false);
  assert.equal(validateProduct({ ...valid, unit: 'dkg' }, BARCODE).ok, false);
});

test('kcalFromMacros — Atwater 4/4/9', () => {
  assert.equal(kcalFromMacros({ protein: 10, carbs: 20, fat: 5 }), 165);
  assert.equal(kcalFromMacros({}), 0);
});
