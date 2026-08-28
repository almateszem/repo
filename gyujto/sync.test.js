/**
 * Gyűjtő — az offline sor felszinkronizálása
 * ==========================================
 * A boltban gyakran nincs net: a telefon sorba teszi a szkenneléseket és a
 * kitöltött űrlapokat, és hálózat esetén EGY kéréssel küldi fel. Két dolgot kell
 * itt bizonyítani, mert mindkettő pont akkor romlik el, amikor a hálózat rossz —
 * tehát mindig:
 *
 *   1. IDEMPOTENCIA — a megszakadt válasz utáni újrapróbálás nem duplázhat.
 *   2. NEM VESZÍT ÉS NEM ÍR FELÜL — egy hibás sor nem viheti magával a többit,
 *      és egy késve érkező RÉGI tétel nem írhatja vissza az újabb adatot.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './testkit.js';

let srv;
let request;
let anna = '';

before(async () => {
  srv = await startServer();
  ({ request } = srv);
  anna = await srv.login('anna');
});

after(async () => { await srv.stop(); });

const KOD = '5000112637922';
const KOD2 = '8000500310427';
const KOD3 = '5449000000996';

const REGEN = '2020-01-01T10:00:00.000Z';
const KESOBB = '2099-01-01T10:00:00.000Z';

test('a törzsnek `items` tömböt kell tartalmaznia', async () => {
  const res = await request('POST', '/api/sync', { cookie: anna, body: { items: 'nem tömb' } });
  assert.equal(res.status, 400);
});

test('ugyanaz a clientId kétszer beküldve EGY szkennelést ad', async () => {
  const koteg = {
    items: [{ type: 'scan', clientId: 'abc-123', barcode: KOD, outcome: 'uj' }],
  };

  const elso = await request('POST', '/api/sync', { cookie: anna, body: koteg });
  assert.equal(elso.status, 200);
  assert.equal(elso.json.results[0].ok, true);
  assert.equal(elso.json.results[0].duplicate, false);

  // Ugyanaz a köteg még egyszer — a kliens nem kapta meg az első választ.
  const masodik = await request('POST', '/api/sync', { cookie: anna, body: koteg });
  assert.equal(masodik.json.results[0].duplicate, true, 'a második beküldés nem hoz létre új sort');

  const szkennelesek = (await request('GET', '/api/scans', { cookie: anna })).json;
  assert.equal(szkennelesek.filter((s) => s.barcode === KOD).length, 1);
});

test('a köteg termékeket is felvisz, és tételenként válaszol', async () => {
  const res = await request('POST', '/api/sync', {
    cookie: anna,
    body: {
      items: [
        {
          type: 'product',
          clientId: 'p-1',
          payload: {
            barcode: KOD, name: 'Offline felvitt tejföl', protein: 3, carbs: 3.5, fat: 20,
          },
        },
        { type: 'product', clientId: 'p-2', payload: { barcode: KOD2, name: 'x' } },
        { type: 'scan', clientId: 's-1', barcode: 'ez-nem-vonalkod', outcome: 'uj' },
        { type: 'valami-mas', clientId: 'x-1' },
      ],
    },
  });

  assert.equal(res.status, 200, 'egy hibás sor sem buktatja el az egész köteget');
  const [jo, rovidNev, rosszKod, ismeretlenTipus] = res.json.results;

  assert.equal(jo.ok, true);
  assert.equal(jo.product.name, 'Offline felvitt tejföl');
  assert.equal(jo.product.status, 'kesz');

  assert.equal(rovidNev.ok, false);
  assert.match(rovidNev.error, /2 és 60 karakter között/);

  assert.equal(rosszKod.ok, false);
  assert.match(rosszKod.error, /Érvénytelen vonalkód/);

  assert.equal(ismeretlenTipus.ok, false);
  assert.match(ismeretlenTipus.error, /Ismeretlen tétel-típus/);

  // A válasz friss számlálókat is hoz: a felület egy kérésből frissül.
  assert.equal(typeof res.json.stats.osszes, 'number');
});

test('a késve érkező RÉGI tétel nem írja felül az újabb szerver-sort', async () => {
  // A szerveren most a legfrissebb adat van (az előző teszt írta).
  const res = await request('POST', '/api/sync', {
    cookie: anna,
    body: {
      items: [{
        type: 'product',
        clientId: 'p-regi',
        editedAt: REGEN,
        payload: { barcode: KOD, name: 'RÉGI, elavult név', protein: 1, carbs: 1, fat: 1 },
      }],
    },
  });

  assert.equal(res.json.results[0].skipped, true);
  assert.equal(res.json.results[0].product.name, 'Offline felvitt tejföl', 'a szerver adata maradt');
});

test('az ÚJABB tétel viszont felülír', async () => {
  const res = await request('POST', '/api/sync', {
    cookie: anna,
    body: {
      items: [{
        type: 'product',
        clientId: 'p-uj',
        editedAt: KESOBB,
        payload: { barcode: KOD, name: 'Frissített tejföl', protein: 3, carbs: 3.5, fat: 20 },
      }],
    },
  });

  assert.equal(res.json.results[0].skipped, false);
  assert.equal(res.json.results[0].product.name, 'Frissített tejföl');
});

test('a szkennelés megadott időbélyeggel naplózódik (a sorban állás ideje nem vész el)', async () => {
  await request('POST', '/api/sync', {
    cookie: anna,
    body: {
      items: [{
        type: 'scan',
        clientId: 's-idobelyeg',
        barcode: KOD3,
        outcome: 'off',
        scannedAt: '2026-08-20 09:15:00',
      }],
    },
  });

  const sor = (await request('GET', '/api/scans', { cookie: anna })).json
    .find((s) => s.barcode === KOD3);
  assert.equal(sor.scannedAt, '2026-08-20 09:15:00');
  assert.equal(sor.outcome, 'off');
  assert.equal(sor.userName, 'anna');
});

test('a köteg mérete korlátos — egy elszabadult kliens nem fektetheti meg a szervert', async () => {
  const items = Array.from({ length: 300 }, (_, i) => ({
    type: 'scan', clientId: `tomeg-${i}`, barcode: KOD, outcome: 'uj',
  }));
  const res = await request('POST', '/api/sync', { cookie: anna, body: { items } });
  assert.equal(res.json.results.length, 200, 'a szerver az első 200 tételt dolgozza fel');
});
