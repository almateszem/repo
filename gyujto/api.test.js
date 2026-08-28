/**
 * Gyűjtő — VÉGPONTI (HTTP) tesztek
 * ================================
 * A valódi szerver, külön folyamatban, eldobható adatbázissal és helyi
 * Open-Food-Facts-stubbal (ld. testkit.js). Ami itt zöld, az a felhasználó által
 * ténylegesen látott viselkedés — nem a modulok külön-külön vett helyessége.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, OFF_KNOWN, OFF_UNKNOWN, OFF_BROKEN } from './testkit.js';

let srv;
let request;
let anna = '';
let bela = '';

before(async () => {
  srv = await startServer();
  ({ request } = srv);
  anna = await srv.login('anna');
  bela = await srv.login('bela');
});

after(async () => { await srv.stop(); });

/* Saját, érvényes EAN-13-ak a felvitel-tesztekhez (az OFF-stub nem ismeri őket). */
const UJ_KOD = '5000112637922';
const UJ_KOD2 = '8000500310427';

/** Teljes, kész termék törzse. */
const termek = (barcode, extra = {}) => ({
  barcode,
  name: 'Bolti tejföl 20%',
  brand: 'Tesztmárka',
  group: 'Tejtermék',
  unit: 'g',
  protein: 3,
  carbs: 3.5,
  fat: 20,
  ...extra,
});

/* ======================================================================
   1. Hozzáférés-védelem
   ====================================================================== */

test('bejelentkezés nélkül egyetlen /api/* végpont sem érhető el', async () => {
  for (const [method, url] of [
    ['GET', '/api/products'],
    ['GET', `/api/lookup/${OFF_KNOWN}`],
    ['GET', '/api/barcodes'],
    ['GET', '/api/stats'],
    ['POST', '/api/products'],
    ['POST', '/api/sync'],
    ['GET', '/api/export.json'],
  ]) {
    const res = await request(method, url, { body: method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${method} ${url} védtelen maradt`);
  }
});

test('a /api/auth/me a firstRun jelzést adja, amíg nincs fiók — most már van', async () => {
  const res = await request('GET', '/api/auth/me');
  assert.equal(res.status, 401);
  assert.equal(res.json.firstRun, false);
});

test('belépés hibás jelszóval elutasított, és nem árulja el, mi volt rossz', async () => {
  const res = await request('POST', '/api/auth/login', {
    body: { username: 'anna', password: 'rosszjelszo' },
  });
  assert.equal(res.status, 401);
  assert.match(res.json.error, /Hibás felhasználónév vagy jelszó/);
});

test('a foglalt felhasználónév 409-et ad', async () => {
  const res = await request('POST', '/api/auth/register', {
    body: { username: 'anna', password: 'masikjelszo' },
  });
  assert.equal(res.status, 409);
});

/* ======================================================================
   2. Vonalkód feloldása
   ====================================================================== */

test('az érvénytelen vonalkód 400, mielőtt bármi hálózati történne', async () => {
  const elotte = await srv.offHitCount();
  const res = await request('GET', '/api/lookup/5998200310011', { cookie: anna });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /Érvénytelen vonalkód/);
  assert.equal(await srv.offHitCount(), elotte, 'hibás kódra nem hívjuk az OFF-ot');
});

test('az OFF által ismert kód „off” állapotot és előre kitöltött terméket ad', async () => {
  const res = await request('GET', `/api/lookup/${OFF_KNOWN}`, { cookie: anna });
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'off');
  assert.equal(res.json.product.name, 'Teszt joghurt (Tesztmárka)');
  assert.equal(res.json.product.protein, 10);
  assert.deepEqual(res.json.product.portions, [['1 adag · 30 g', 30]]);
});

test('a második olvasás a gyorsítótárból jön — bizonyíthatóan hálózat nélkül', async () => {
  const elotte = await srv.offHitCount();
  const res = await request('GET', `/api/lookup/${OFF_KNOWN}`, { cookie: bela });
  assert.equal(res.json.status, 'off');
  assert.equal(await srv.offHitCount(), elotte, 'a cache-találat nem megy ki a hálózatra');
});

test('amit az OFF sem ismer, az „uj” — ezt kell kézzel felvinni', async () => {
  const res = await request('GET', `/api/lookup/${OFF_UNKNOWN}`, { cookie: anna });
  assert.equal(res.json.status, 'uj');
  assert.equal(res.json.product, undefined);
});

test('a negatív találat is cache-elődik (a nemlétező termékre sem kérdezünk kétszer)', async () => {
  const elotte = await srv.offHitCount();
  await request('GET', `/api/lookup/${OFF_UNKNOWN}`, { cookie: anna });
  assert.equal(await srv.offHitCount(), elotte);
});

test('az OFF hibája 502, és NEM állítja, hogy a termék hiányzik', async () => {
  const res = await request('GET', `/api/lookup/${OFF_BROKEN}`, { cookie: anna });
  assert.equal(res.status, 502);
  assert.equal(res.json.status, 'ismeretlen');
  assert.match(res.json.error, /nem elérhető/);

  // A hálózati hiba nem cache-elődik: egy perc múlva sikerülhet.
  const elotte = await srv.offHitCount();
  await request('GET', `/api/lookup/${OFF_BROKEN}`, { cookie: anna });
  assert.equal(await srv.offHitCount(), elotte + 1, 'a hibát nem ragasztjuk be a cache-be');
});

/* ======================================================================
   3. A gyűjtés
   ====================================================================== */

test('hiányzó termék felvihető, és utána már „gyujtott”-ként oldódik fel', async () => {
  const create = await request('POST', '/api/products', { cookie: anna, body: termek(UJ_KOD) });
  assert.equal(create.status, 201);
  assert.equal(create.json.status, 'kesz');
  assert.equal(create.json.kcal, 3 * 4 + 3.5 * 4 + 20 * 9, 'a kalóriát a szerver számolja');
  assert.equal(create.json.createdByName, 'anna');

  const elotte = await srv.offHitCount();
  const lookup = await request('GET', `/api/lookup/${UJ_KOD}`, { cookie: bela });
  assert.equal(lookup.json.status, 'gyujtott', 'a KÖZÖS gyűjtést a másik fiók is látja');
  assert.equal(lookup.json.product.name, 'Bolti tejföl 20%');
  assert.equal(await srv.offHitCount(), elotte, 'a saját gyűjtésért nem megyünk ki a hálózatra');
});

test('a boltban elég a név — a tétel piszkozatként megmarad', async () => {
  const res = await request('POST', '/api/products', {
    cookie: anna,
    body: { barcode: UJ_KOD2, name: 'Ismeretlen keksz', store: 'Aldi Fő tér' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.status, 'piszkozat');
  assert.equal(res.json.protein, null, 'a hiányzó makró null, nem nulla');
  assert.equal(res.json.store, 'Aldi Fő tér');
});

test('ugyanaz a vonalkód FRISSÍT, nem duplikál', async () => {
  const elotte = (await request('GET', '/api/products', { cookie: anna })).json.length;
  const res = await request('POST', '/api/products', {
    cookie: bela,
    body: termek(UJ_KOD, { name: 'Bolti tejföl 20% (pontosítva)' }),
  });
  assert.equal(res.status, 201);
  const utana = (await request('GET', '/api/products', { cookie: anna })).json;
  assert.equal(utana.length, elotte, 'nem keletkezett új sor');
  assert.equal(utana.find((p) => p.barcode === UJ_KOD).name, 'Bolti tejföl 20% (pontosítva)');
});

test('a piszkozat javítása kész állapotba viszi a tételt', async () => {
  const lista = (await request('GET', '/api/products', { cookie: anna })).json;
  const keksz = lista.find((p) => p.barcode === UJ_KOD2);

  const res = await request('PUT', `/api/products/${keksz.id}`, {
    cookie: anna,
    body: { name: keksz.name, protein: 6, carbs: 65, fat: 20, group: 'Édesség, snack' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.status, 'kesz');
  assert.equal(res.json.barcode, UJ_KOD2, 'a vonalkód nem írható át — az a termék azonossága');
});

test('a lista szűrhető állapotra és kereshető', async () => {
  const kesz = (await request('GET', '/api/products?status=kesz', { cookie: anna })).json;
  assert.ok(kesz.length >= 2);
  assert.ok(kesz.every((p) => p.status === 'kesz'));

  const talalat = (await request('GET', '/api/products?q=tejf%C3%B6l', { cookie: anna })).json;
  assert.equal(talalat.length, 1);
  assert.equal(talalat[0].barcode, UJ_KOD);
});

test('a /api/barcodes csak a kódokat adja — ezzel dedupliál a kliens offline', async () => {
  const kodok = (await request('GET', '/api/barcodes', { cookie: anna })).json;
  assert.ok(kodok.includes(UJ_KOD) && kodok.includes(UJ_KOD2));
  assert.ok(kodok.every((k) => typeof k === 'string'));
});

test('a statisztika a valódi sorokból számol', async () => {
  const stats = (await request('GET', '/api/stats', { cookie: anna })).json;
  assert.equal(stats.osszes, stats.piszkozat + stats.kesz + stats.exportalva);
  assert.ok(stats.maSzkennelt > 0, 'a szkennelések naplózódtak');
});

test('a hibás törzs 400-at ad, beszédes magyar üzenettel', async () => {
  const res = await request('POST', '/api/products', {
    cookie: anna, body: { barcode: UJ_KOD, name: 'x' },
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /2 és 60 karakter között/);
});

test('a nem létező tétel javítása/törlése 404', async () => {
  assert.equal((await request('PUT', '/api/products/9999', { cookie: anna, body: {} })).status, 404);
  assert.equal((await request('DELETE', '/api/products/9999', { cookie: anna })).status, 404);
});

test('a törlés valóban eltünteti a sort', async () => {
  const create = await request('POST', '/api/products', {
    cookie: anna, body: termek('5449000000996', { name: 'Törlendő tétel' }),
  });
  assert.equal(create.status, 201);

  assert.equal((await request('DELETE', `/api/products/${create.json.id}`, { cookie: anna })).status, 204);
  const lookup = await request('GET', '/api/lookup/5449000000996', { cookie: anna });
  assert.notEqual(lookup.json.status, 'gyujtott');
});

test('az export csak a kész tételeket adja', async () => {
  const exportalt = (await request('GET', '/api/export.json', { cookie: anna })).json;
  assert.ok(exportalt.length > 0);
  assert.ok(exportalt.every((p) => p.status === 'kesz'));
  assert.ok(exportalt.every((p) => typeof p.kcal === 'number'), 'kész tétel nem lehet hiányos');
});

test('ismeretlen API-útvonalra JSON-hiba jön, nem HTML', async () => {
  const res = await request('GET', '/api/nincs-ilyen', { cookie: anna });
  assert.equal(res.status, 404);
  assert.match(res.json.error, /Nincs ilyen végpont/);
});
