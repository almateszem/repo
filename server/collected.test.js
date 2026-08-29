/**
 * A Gyűjtő-feltöltés végponti tesztjei
 * ====================================
 * A `POST /api/foods/collected` az EGYETLEN út, amin a boltokban felmért adat
 * bekerül a FitTrack-be — és onnantól MINDEN fióké. Ezért itt a szigor nem
 * formalitás: ami átcsúszik, azt mindenki látja a vonalkód-olvasójában.
 *
 * A valódi szervert indítjuk külön folyamatban, eldobható adatbázissal
 * (a server/api.test.js mintája szerint), és HTTP-n beszélünk vele.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-collected-'));

let child;
let baseUrl;
let anna = '';
let bela = '';

before(async () => {
  child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'server.js')],
    {
      env: { ...process.env, FITTRACK_DB: path.join(workDir, 'collected.db'), PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  baseUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`A szerver nem indult el:\n${output}`)), 20_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`kilépett: ${code}\n${output}`)); });
  });

  anna = await register('anna');
  bela = await register('bela');
});

/* A szervert az UTOLSÓ teszt után állítjuk le, és megvárjuk, amíg tényleg
   kilép: amíg a gyerekfolyamat és a csővezetékei élnek, a teszt-futtató
   eseményhurka sem ürül ki. */
after(async () => {
  await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  rmSync(workDir, { recursive: true, force: true });
});

async function request(method, urlPath, { body, cookie } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* nem JSON */ }
  return { status: res.status, json, setCookie: res.headers.getSetCookie() };
}

async function register(username) {
  const res = await request('POST', '/api/auth/register', {
    body: { username, password: 'probajelszo', displayName: username },
  });
  assert.equal(res.status, 201, 'a regisztráció nem sikerült');
  return (res.setCookie[0] ?? '').split(';')[0];
}

/** Egy érvényes, teljes termék a Gyűjtő exportjának alakjában. */
const termek = (barcode, extra = {}) => ({
  barcode,
  name: 'Bolti tejföl 20%',
  brand: 'Tesztmárka',
  group: 'Tejtermék',
  unit: 'g',
  protein: 3,
  carbs: 3.5,
  fat: 20,
  kcal: 206,
  portions: [['1 pohár', 150]],
  store: 'Aldi',
  note: '',
  collectedAt: '2026-08-20T10:00:00.000Z',
  ...extra,
});

const KOD = '5000112637922';
const KOD2 = '8000500310427';

test('a feltöltés bejelentkezést kér', async () => {
  const res = await request('POST', '/api/foods/collected', { body: { products: [] } });
  assert.equal(res.status, 401);
  assert.equal((await request('GET', '/api/foods/collected')).status, 401);
});

test('a `products` tömb kötelező', async () => {
  const res = await request('POST', '/api/foods/collected', { cookie: anna, body: { nope: 1 } });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /products/);
});

test('egy érvényes köteg bekerül, és MINDEN fiók megkapja', async () => {
  const res = await request('POST', '/api/foods/collected', {
    cookie: anna, body: { products: [termek(KOD)] },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(
    { added: res.json.added, updated: res.json.updated, skipped: res.json.skipped },
    { added: 1, updated: 0, skipped: 0 },
  );

  // A MÁSIK fiók vonalkód-olvasója is megtalálja — ez a feltöltés értelme.
  const lookup = await request('GET', `/api/foods/barcode/${KOD}`, { cookie: bela });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.json.source, 'local');
  assert.equal(lookup.json.product.name, 'Bolti tejföl 20%');
  assert.equal(lookup.json.product.kcal, 206);
  assert.deepEqual(lookup.json.product.portions, [['1 pohár', 150]]);
  assert.equal(lookup.json.product.source, 'gyujto');
});

test('a saját étel ELŐBBRE való, mint a begyűjtött', async () => {
  // A felhasználó saját mérése az ő számára mindig erősebb, mint a közös adat.
  const own = await request('POST', '/api/foods/custom', {
    cookie: bela,
    body: { name: 'Béla saját tejfölje', protein: 3, carbs: 3.5, fat: 20, barcode: KOD },
  });
  assert.equal(own.status, 201);

  const lookup = await request('GET', `/api/foods/barcode/${KOD}`, { cookie: bela });
  assert.equal(lookup.json.source, 'saved');
  assert.equal(lookup.json.food.name, 'Béla saját tejfölje');

  // Annának viszont továbbra is a közös adat jön.
  const annaLookup = await request('GET', `/api/foods/barcode/${KOD}`, { cookie: anna });
  assert.equal(annaLookup.json.source, 'local');
});

test('ugyanaz a vonalkód FRISSÍT, nem duplikál', async () => {
  const res = await request('POST', '/api/foods/collected', {
    cookie: bela,
    body: { products: [termek(KOD, { name: 'Pontosított tejföl', collectedAt: '2026-08-25T10:00:00.000Z' })] },
  });
  assert.equal(res.json.updated, 1);
  assert.equal(res.json.added, 0);
  assert.equal(res.json.count, 1, 'nem keletkezett új sor');

  const lookup = await request('GET', `/api/foods/barcode/${KOD}`, { cookie: anna });
  assert.equal(lookup.json.product.name, 'Pontosított tejföl');
});

test('a RÉGEBBI mérés nem írja felül a frissebbet', async () => {
  // Egy telefon hetekkel később jut hálózathoz: az ő régi adata nem
  // ronthatja el a közben felvitt, pontosabb mérést.
  const res = await request('POST', '/api/foods/collected', {
    cookie: anna,
    body: { products: [termek(KOD, { name: 'RÉGI, elavult név', collectedAt: '2026-08-01T10:00:00.000Z' })] },
  });
  assert.equal(res.json.skipped, 1);
  assert.equal(res.json.updated, 0);

  const lookup = await request('GET', `/api/foods/barcode/${KOD}`, { cookie: anna });
  assert.equal(lookup.json.product.name, 'Pontosított tejföl', 'a frissebb mérés maradt');
});

test('a hibás tétel kiesik, a köteg többi része átmegy', async () => {
  const res = await request('POST', '/api/foods/collected', {
    cookie: anna,
    body: {
      products: [
        termek(KOD2, { name: 'Rendes keksz', collectedAt: '2026-08-26T10:00:00.000Z' }),
        termek('ez-nem-vonalkod'),
        termek('5449000000996', { name: 'x' }),                       // túl rövid név
        termek('4006381333931', { protein: 50, carbs: 40, fat: 20 }), // >100 g összesen
        termek('5901234123457', { kcal: 800 }),                       // nem fér a makrókhoz
      ],
    },
  });

  assert.equal(res.status, 200, 'egy hibás sor sem buktatja el az egész köteget');
  assert.equal(res.json.added, 1);
  assert.equal(res.json.rejected.length, 4);
  assert.match(res.json.rejected[0].error, /vonalkód/i);
  assert.match(res.json.rejected[1].error, /karakter/);
  assert.match(res.json.rejected[2].error, /összege/);
  assert.match(res.json.rejected[3].error, /nem fér össze/);
});

test('a lista és a számláló a valódi sorokból jön', async () => {
  const res = await request('GET', '/api/foods/collected', { cookie: anna });
  assert.equal(res.status, 200);
  assert.equal(res.json.count, 2);
  assert.equal(res.json.products.length, 2);
  assert.ok(res.json.products.every((p) => typeof p.kcal === 'number'));
});

test('a túl nagy köteg elutasított', async () => {
  const products = Array.from({ length: 2001 }, (_, i) => termek(KOD, { name: `T${i}` }));
  const res = await request('POST', '/api/foods/collected', { cookie: anna, body: { products } });
  assert.equal(res.status, 413);
});

test('a hiányzó időbélyeg a legrégebbi értéket kapja, nem a mostanit', async () => {
  // Egy hibás órájú (vagy szándékosan hazudó) telefon nem írhat felül semmit.
  const res = await request('POST', '/api/foods/collected', {
    cookie: anna,
    body: { products: [termek(KOD, { name: 'Időbélyeg nélkül', collectedAt: undefined })] },
  });
  assert.equal(res.json.skipped, 1);
});
