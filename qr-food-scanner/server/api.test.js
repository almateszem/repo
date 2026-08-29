/**
 * Végpont-tesztek: a teljes folyamat a HTTP-felület felől.
 * Az OFF egy helyi stub, az adatbázis egy ideiglenes fájl — a teszt nem
 * hálózatot és nem a fejlesztői adatbázist piszkálja.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const IN_OFF = '5997523110253';       // az OFF ismeri
const NOT_IN_OFF = '1111111111116';   // az OFF nem ismeri
const OFF_DOWN = '4006381333931';     // az OFF most nem elérhető

let offStub;
let appServer;
let base;
let tmpDir;

const request = async (method, url, body) => {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  offStub = http.createServer((req, res) => {
    const code = new URL(req.url, 'http://x').pathname.split('/').pop().replace('.json', '');
    if (code === OFF_DOWN) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    if (code === IN_OFF) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        status: 1,
        product: { product_name: 'Natúr joghurt', nutriments: { 'energy-kcal_100g': 61 } },
      }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 0 }));
  });
  await new Promise((resolve) => offStub.listen(0, '127.0.0.1', resolve));

  // Az env-változóknak a modul betöltése ELŐTT kell állniuk.
  process.env.QRFS_OFF_URL = `http://127.0.0.1:${offStub.address().port}`;
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'qrfs-test-'));
  process.env.QRFS_DB = path.join(tmpDir, 'test.db');

  const { app } = await import('./server.js');
  appServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => appServer.once('listening', resolve));
  base = `http://127.0.0.1:${appServer.address().port}`;
});

after(async () => {
  offStub?.close();
  appServer?.close();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

test('lookup — az OFF ismeri: benne van, nincs teendő', async () => {
  const { status, body } = await request('GET', `/api/lookup/${IN_OFF}`);
  assert.equal(status, 200);
  assert.equal(body.inOpenFoodFacts, true);
  assert.equal(body.barcode, IN_OFF);
  assert.equal(body.product.name, 'Natúr joghurt');
});

test('lookup — az OFF nem ismeri: jöhet a makró-űrlap', async () => {
  const { status, body } = await request('GET', `/api/lookup/${NOT_IN_OFF}`);
  assert.equal(status, 200);
  assert.equal(body.inOpenFoodFacts, false);
  assert.equal(body.product, null);
  assert.equal(body.saved, null);
});

test('lookup — érvénytelen vonalkód 400', async () => {
  const { status, body } = await request('GET', '/api/lookup/5997523110251');
  assert.equal(status, 400);
  assert.match(body.error, /Érvénytelen/);
});

test('lookup — az OFF kiesése 503, nem „nincs benne"', async () => {
  const { status, body } = await request('GET', `/api/lookup/${OFF_DOWN}`);
  assert.equal(status, 503);
  assert.match(body.error, /Open Food Facts/);
});

test('mentés — a termék bekerül a helyi adatbázisba és a listába', async () => {
  const payload = {
    barcode: NOT_IN_OFF, name: 'Házi müzli', unit: 'g',
    protein: 12, carbs: 60, fat: 9, kcal: 369,
  };
  const saved = await request('POST', '/api/products', payload);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.product.name, 'Házi müzli');
  assert.equal(saved.body.product.kcal, 369);

  const list = await request('GET', '/api/products');
  assert.equal(list.body.products.length, 1);
  assert.equal(list.body.products[0].barcode, NOT_IN_OFF);
});

test('a mentett termék visszajön a lookupban (előtöltés javításhoz)', async () => {
  const { body } = await request('GET', `/api/lookup/${NOT_IN_OFF}`);
  assert.equal(body.inOpenFoodFacts, false);
  assert.equal(body.saved.name, 'Házi müzli');
});

test('újramentés ugyanarra a kódra javít, nem duplikál', async () => {
  const { status } = await request('POST', '/api/products', {
    barcode: NOT_IN_OFF, name: 'Házi müzli (javított)', unit: 'g',
    protein: 13, carbs: 58, fat: 10, kcal: 374,
  });
  assert.equal(status, 201);

  const list = await request('GET', '/api/products');
  assert.equal(list.body.products.length, 1);
  assert.equal(list.body.products[0].name, 'Házi müzli (javított)');
  assert.equal(list.body.products[0].protein, 13);
});

test('mentés — hibás adatot a szerver is elutasít', async () => {
  const bad = await request('POST', '/api/products', {
    barcode: NOT_IN_OFF, name: '', unit: 'g', protein: 1, carbs: 1, fat: 1, kcal: 1,
  });
  assert.equal(bad.status, 400);

  const badCode = await request('POST', '/api/products', {
    barcode: '123', name: 'X', unit: 'g', protein: 1, carbs: 1, fat: 1, kcal: 1,
  });
  assert.equal(badCode.status, 400);
});
