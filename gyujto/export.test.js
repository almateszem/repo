/**
 * Gyűjtő — az export-szkript tesztjei
 * ===================================
 * Ez a visszaút a FitTrack-be, és két hibája lenne csendes és fájdalmas:
 *
 *   1. ha a második futás TÖRÖLNÉ az elsőt (mert csak a most kész tételeket
 *      írná ki), akkor minden export után elveszne a korábbi gyűjtés;
 *   2. ha a kiírt fájl nem érvényes ES-modul vagy hiányos alakú, a FŐ APP nem
 *      indulna el — az importja a szerver legelső sorai közt fut.
 *
 * Ezért a teszt tényleg lefuttatja a szkriptet, és tényleg beimportálja, amit
 * kiírt.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'gyujto-export-'));
const DB_PATH = path.join(workDir, 'export.db');
const OUT_PATH = path.join(workDir, 'products.barcode.js');

/* A db.js a betöltésekor olvassa a GYUJTO_DB-t, ezért az env-változót az
   IMPORT ELŐTT kell beállítani — innen a dinamikus import. */
process.env.GYUJTO_DB = DB_PATH;
const { upsertProduct, listProducts } = await import('./db.js');
const { parseProduct } = await import('./products.js');

after(() => { rmSync(workDir, { recursive: true, force: true }); });

/** Egy tétel felvitele közvetlenül az adatrétegen át. */
function felvisz(body) {
  const parsed = parseProduct(body);
  assert.equal(parsed.ok, true, parsed.error);
  return upsertProduct(parsed.value, null).product;
}

/** Az export-szkript futtatása; a kimenetét visszaadja. */
function futtat(extraArgs = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        path.join(__dirname, 'scripts', 'export-products.js'),
        '--out', OUT_PATH,
        ...extraArgs,
      ],
      { env: { ...process.env, GYUJTO_DB: DB_PATH }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('exit', (code) => (code === 0
      ? resolve(out)
      : reject(new Error(`a szkript ${code} kóddal lépett ki:\n${out}`))));
  });
}

/** A generált fájl beimportálása. A lekérdezés-paraméter kell: a modulokat a
    Node gyorsítótárazza, a második futás után különben a régit látnánk. */
const beolvas = async (tag) => (await import(`file://${OUT_PATH}?v=${tag}`)).barcodeProducts;

before(() => {
  felvisz({
    barcode: '5000112637922',
    name: 'Bolti tejföl 20%',
    brand: 'Tesztmárka',
    group: 'Tejtermék',
    protein: 3,
    carbs: 3.5,
    fat: 20,
    portions: [['1 pohár', 150]],
  });
  // Piszkozat: hiányos, ezért NEM mehet ki.
  felvisz({ barcode: '8000500310427', name: 'Félkész keksz' });
});

test('a --dry-run nem ír fájlt és nem módosít állapotot', async () => {
  const kimenet = await futtat(['--dry-run']);
  assert.match(kimenet, /1 termék kerülne a fájlba/);
  assert.equal(existsSync(OUT_PATH), false);
  assert.equal(listProducts({ status: 'kesz' }).length, 1, 'a tétel kész maradt');
});

test('az export érvényes ES-modult ír, a fő app által várt alakban', async () => {
  await futtat();
  const termekek = await beolvas('1');

  assert.equal(termekek.length, 1, 'csak a kész tétel megy ki');
  const [t] = termekek;
  assert.deepEqual(t, {
    barcode: '5000112637922',
    name: 'Bolti tejföl 20%',
    brand: 'Tesztmárka',
    group: 'Tejtermék',
    unit: 'g',
    kcal: 206,
    protein: 3,
    carbs: 3.5,
    fat: 20,
    portions: [['1 pohár', 150]],
    source: 'gyujto',
  });
});

test('az exportált tétel állapota „exportalva” lesz', () => {
  assert.equal(listProducts({ status: 'kesz' }).length, 0);
  assert.equal(listProducts({ status: 'exportalva' }).length, 1);
  assert.equal(listProducts({ status: 'piszkozat' }).length, 1, 'a piszkozat érintetlen');
});

test('a MÁSODIK futás nem törli az elsőt — a fájl teljes pillanatkép', async () => {
  // Egy új tétel a második körben; a korábbinak bent kell maradnia.
  felvisz({
    barcode: '5449000000996',
    name: 'Almalé 100%',
    group: 'Ital',
    unit: 'ml',
    protein: 0.1,
    carbs: 11,
    fat: 0.1,
  });

  await futtat();
  const termekek = await beolvas('2');

  assert.equal(termekek.length, 2);
  const nevek = termekek.map((t) => t.name);
  assert.ok(nevek.includes('Bolti tejföl 20%'), 'a korábbi export nem veszett el');
  assert.ok(nevek.includes('Almalé 100%'));
  // Névre rendezve — a generált fájl diffje így olvasható marad.
  assert.deepEqual(nevek, [...nevek].sort((a, b) => a.localeCompare(b, 'hu')));
});

test('a piszkozat sosem kerül ki, amíg hiányos', async () => {
  const termekek = await beolvas('3');
  assert.ok(!termekek.some((t) => t.barcode === '8000500310427'));
  assert.ok(termekek.every((t) => typeof t.kcal === 'number' && typeof t.protein === 'number'));
});
