/**
 * Az OFF-kliens tesztjei. A hálózati rész egy helyi stub-szerverre megy: a
 * tesztcsomag nem függhet az internettől és az OFF rendelkezésre állásától.
 *
 * A modult DINAMIKUSAN importáljuk, a stub elindítása után: a BASE_URL a
 * betöltéskor rögzül, és az ESM modul-gyorsítótár miatt csak egyszer.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

/** vonalkód → válasz. Ami nincs benne: 404, ahogy az OFF is felel. */
const ROUTES = {
  5997523110253: {
    body: {
      status: 1,
      product: {
        product_name: 'Natúr joghurt',
        brands: 'Mizo, Mizo Hungary',
        quantity: '175 g',
        nutriments: {
          'energy-kcal_100g': 61, proteins_100g: 3.5, carbohydrates_100g: 4.7, fat_100g: 3.3,
        },
      },
    },
  },
  // Létező kód, de az OFF nem ismeri: 200 + status:0.
  1111111111116: { body: { status: 0 } },
  // A szolgáltatás elérhetetlen.
  4006381333931: { status: 503, body: {} },
};

let server;
let off;

before(async () => {
  server = http.createServer((req, res) => {
    const code = new URL(req.url, 'http://x').pathname.split('/').pop().replace('.json', '');
    const route = ROUTES[code];
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 0 }));
    }
    res.writeHead(route.status ?? 200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(route.body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  process.env.QRFS_OFF_URL = `http://127.0.0.1:${server.address().port}`;
  off = await import('./openfoodfacts.js');
});

after(() => { server?.close(); });

test('normalizeBarcode — érvényes kódok', () => {
  assert.equal(off.normalizeBarcode('5997523110253'), '5997523110253');    // EAN-13
  assert.equal(off.normalizeBarcode('  5997523110253 '), '5997523110253'); // szóközök
  // UPC-A (12 jegy) → EAN-13-ra nullázva, hogy egy termék egy soron üljön
  assert.equal(off.normalizeBarcode('036000291452'), '0036000291452');
  assert.equal(off.normalizeBarcode('96385074'), '0000096385074');         // EAN-8
});

test('normalizeBarcode — érvénytelen kódot elutasít', () => {
  assert.equal(off.normalizeBarcode('5997523110251'), null); // rossz ellenőrzőszám
  assert.equal(off.normalizeBarcode('123'), null);           // rossz hossz
  assert.equal(off.normalizeBarcode(''), null);
  assert.equal(off.normalizeBarcode(null), null);
  assert.equal(off.normalizeBarcode('abcdefghijklm'), null);
});

test('mapProduct — 100 g-os tápérték, márkás név', () => {
  const product = off.mapProduct(ROUTES[5997523110253].body.product, '5997523110253');
  assert.equal(product.name, 'Natúr joghurt (Mizo)');
  assert.equal(product.unit, 'g');
  assert.deepEqual(
    [product.kcal, product.protein, product.carbs, product.fat],
    [61, 3.5, 4.7, 3.3],
  );
});

test('mapProduct — kJ-ből kcal, folyadéknál ml, hiányzó tápérték null marad', () => {
  const product = off.mapProduct({
    product_name: 'Almalé',
    quantity: '1,5 l',
    nutriments: { 'energy-kj_100g': 192, carbohydrates_100g: 11 },
  }, '4006381333931');

  assert.equal(product.unit, 'ml');
  assert.equal(product.kcal, 46);      // 192 / 4,184 kerekítve
  assert.equal(product.protein, null); // nem 0: csak nem tudjuk
  assert.equal(product.fat, null);
});

test('mapProduct — név nélküli terméknél a vonalkód az azonosító', () => {
  const product = off.mapProduct({ nutriments: {} }, '5997523110253');
  assert.equal(product.name, 'Ismeretlen nevű termék · 5997523110253');
});

test('fetchProduct — megtalált termék', async () => {
  const result = await off.fetchProduct('5997523110253');
  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.product.name, 'Natúr joghurt (Mizo)');
});

test('fetchProduct — ismeretlen kód: a 404 és a status:0 ugyanaz', async () => {
  assert.deepEqual(await off.fetchProduct('1111111111116'), { ok: true, found: false }); // status:0
  assert.deepEqual(await off.fetchProduct('2222222222220'), { ok: true, found: false }); // 404
});

test('fetchProduct — szerverhiba NEM „nincs benne"', async () => {
  const result = await off.fetchProduct('4006381333931');
  assert.equal(result.ok, false);
  assert.match(result.reason, /503/);
});
