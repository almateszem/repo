/**
 * FitTrack Pro — a 2026-09-18-i biztonsági kör őrei
 * -------------------------------------------------
 * A TEENDOK.txt BIZTONSÁG szakaszának KÖZEPES és ALACSONY leletei közül
 * hatot javítottunk. Ez a fájl azokat őrzi — mindegyik olyan hiba, ami
 * NÉMÁN élt: nem hibaüzenetet adott, hanem rossz adatot hagyott maga után.
 *
 * KÜLÖN FÁJL, szándékosan: a vonalkód-korlát teszt elfogyaszt egy fiókra
 * szóló keretet, a security.test.js pedig már a belépési keretet fogyasztja.
 * Két ilyen fájl egymás mellett olvashatóbb, mint egy, amiben a sorrend
 * rejtett szerződés.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startServer, cookieFrom, gyakorlat } from './test-harness.js';

/* ---- Open Food Facts stub ----
   Ugyanaz a szerep, mint az api.test.js-ben: a kimenő hívás nem függhet az
   internettől. Itt viszont a HIBÁS viselkedéseket utánozzuk — átirányítást és
   végtelen választ —, mert pont ezek ellen íródott a javítás. */
const OFF_REDIRECT = '5901234123457'; // a stub máshová küld
const OFF_HUGE = '4006381333931'; // a stub töméntelen adatot ad
const offStub = createServer((req, res) => {
  const code = req.url.match(/\/api\/v2\/product\/(\d+)\.json/)?.[1];

  if (code === OFF_REDIRECT) {
    res.statusCode = 302;
    // Egy belső címre mutató átirányítás: pont az, amit nem szabad követni.
    res.setHeader('Location', 'http://169.254.169.254/latest/meta-data/');
    res.end();
    return;
  }
  if (code === OFF_HUGE) {
    res.setHeader('Content-Type', 'application/json');
    // 8 MB szemét, Content-Length nélkül (chunked) — a deklarált hosszra
    // épülő védelem ezt átengedné, a darabonkénti számlálás nem.
    res.write('{"status":1,"product":{"product_name":"');
    for (let i = 0; i < 64; i++) res.write('x'.repeat(128 * 1024));
    res.end('"}}');
    return;
  }
  // Minden más kód: érvényes, ismert termék.
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      status: 1,
      product: { product_name: 'Teszt termék', nutriments: { proteins_100g: 10 } },
    }),
  );
});
await new Promise((resolve) => offStub.listen(0, '127.0.0.1', resolve));
const OFF_URL = `http://127.0.0.1:${offStub.address().port}`;

const { request } = await startServer({
  label: 'hardening',
  extraEnv: { FITTRACK_OFF_URL: OFF_URL, FITTRACK_TRUST_PROXY: '1' },
});

after(async () => {
  await new Promise((resolve) => offStub.close(resolve));
});

const register = async (username) =>
  cookieFrom(
    await request('POST', '/api/auth/register', {
      body: { username, displayName: username, password: 'jelszo123' },
    }),
  );

/** Érvényes (mod-10 helyes) EAN-13-ak sorozata a korlát-teszthez: mindegyik
    MÁS kód, tehát mindegyik elvéti a gyorsítótárat és kimegy a hálózatra. */
function validBarcode(seed) {
  const body = String(seed).padStart(12, '7').slice(0, 12);
  let sum = 0;
  for (let i = 11, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return body + String((10 - (sum % 10)) % 10);
}

/* ======================================================================
   1. HTTP biztonsági fejlécek
   ====================================================================== */

test('minden válasz viszi a biztonsági fejléceket, és nem árulja el a keretrendszert', async () => {
  const res = await request('GET', '/api/auth/me');

  assert.match(
    res.headers.get('content-security-policy') ?? '',
    /default-src 'self'/,
    'CSP kimegy',
  );
  assert.match(
    res.headers.get('content-security-policy') ?? '',
    /frame-ancestors 'none'/,
    'a beágyazás tiltva',
  );
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(res.headers.get('x-powered-by'), null, 'az Express nem mutatkozik be');
});

test('a statikus fájlok is megkapják a fejléceket', async () => {
  // A köztes réteg az útvonalak ELŐTT áll — ha valaki lejjebb tenné, ez bukik.
  const res = await request('GET', '/index.html');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('HSTS csak HTTPS-en megy ki', async () => {
  const plain = await request('GET', '/api/auth/me');
  assert.equal(plain.headers.get('strict-transport-security'), null, 'sima HTTP-n nincs');

  const https = await request('GET', '/api/auth/me', {
    headers: { 'X-Forwarded-Proto': 'https' },
  });
  assert.match(https.headers.get('strict-transport-security') ?? '', /max-age=\d+/);
});

/* ======================================================================
   2. Mérési helyek — prototípus-kulcs
   ====================================================================== */

test('a `constructor` nem csúszik át mérési helyként', async () => {
  const cookie = await register('meres');

  const res = await request('PUT', '/api/measurements', {
    cookie,
    body: { values: { constructor: 999999 } },
  });
  assert.equal(res.status, 400, 'a prototípus-kulcs ismeretlen mérési hely');

  // A rendes mérés viszont továbbra is átmegy.
  const jo = await request('PUT', '/api/measurements', {
    cookie,
    body: { values: { waist: 84 } },
  });
  assert.equal(jo.status, 200);
  const lista = await request('GET', '/api/measurements', { cookie });
  assert.equal(
    JSON.stringify(lista.json).includes('999999'),
    false,
    'a szemét-érték sehol nem tárolódott',
  );
});

/* ======================================================================
   3. Edzés-mentés: nincs duplikátum
   ====================================================================== */

test('ugyanaz az edzés kétszer elküldve EGY edzés marad', async () => {
  const cookie = await register('duplas');
  const body = { name: 'Mellnap', exercises: [gyakorlat('Fekvenyomás', 100)] };

  const elso = await request('POST', '/api/workouts', { cookie, body });
  const masodik = await request('POST', '/api/workouts', { cookie, body });

  assert.equal(elso.status, 201);
  assert.equal(masodik.status, 201, 'a megismételt kérés is sikeres — csak nem hoz létre újat');
  assert.equal(masodik.json.id, elso.json.id, 'ugyanaz a sor jön vissza');

  const lista = await request('GET', '/api/workouts', { cookie });
  const mellnapok = lista.json.filter((w) => w.name === 'Mellnap');
  assert.equal(mellnapok.length, 1, `egy Mellnap van (kapott: ${mellnapok.length})`);
});

test('a MÁSIK edzés viszont külön sor marad', async () => {
  const cookie = await register('kulonbozo');
  const elso = await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Lábnap', exercises: [gyakorlat('Guggolás', 100)] },
  });
  // Ugyanaz a név és nap, de MÁS súly: ez két különböző edzés.
  const masodik = await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Lábnap', exercises: [gyakorlat('Guggolás', 120)] },
  });
  assert.notEqual(masodik.json.id, elso.json.id, 'az eltérő tartalom új sort kap');
});

test('a mentés eltakarítja a piszkozatot — nem a kliensre bízzuk', async () => {
  const cookie = await register('piszkozatos');
  await request('PUT', '/api/workout-draft', {
    cookie,
    body: { name: 'Félkész', exercises: [gyakorlat('Húzódzkodás', 0)] },
  });
  await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Félkész', exercises: [gyakorlat('Húzódzkodás', 0)] },
  });

  const draft = await request('GET', '/api/workout-draft', { cookie });
  const exercises = draft.json?.exercises ?? [];
  assert.equal(exercises.length, 0, 'a piszkozat üres — a szerver zárta a kört');
});

/* ======================================================================
   4. Megjegyzések: a belső user-id nem kerül ki
   ====================================================================== */

test('a megjegyzés `mine` jelzőt ad, belső azonosítót nem', async () => {
  const cookie = await register('jegyzetelo');
  const workout = await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Jegyzetes', exercises: [gyakorlat('Evezés', 60)] },
  });

  const uj = await request('POST', '/api/comments', {
    cookie,
    body: { targetId: `${workout.json.id}:0`, text: 'Fájt a vállam.' },
  });
  assert.equal(uj.status, 201);
  assert.deepEqual(
    Object.keys(uj.json).sort(),
    ['at', 'authorName', 'id', 'mine', 'targetId', 'text'],
    'KULCSRA ellenőrizve: egy új mező nem szivárog be észrevétlenül',
  );
  assert.equal(uj.json.mine, true, 'a saját megjegyzésem az enyém');

  const lista = await request('GET', `/api/comments?target=${workout.json.id}:0`, { cookie });
  assert.equal(lista.json[0].mine, true);
  assert.equal('authorId' in lista.json[0], false, 'a belső user-id sehol');
});

/* ======================================================================
   5. A volt edző táplálkozási célja
   ====================================================================== */

test('a kapcsolat bontásával a volt edző tápcélja is megszűnik', async () => {
  const edzo = await register('edzomester');
  const sportolo = await register('tanitvany');

  const meghivo = await request('POST', '/api/athletes', {
    cookie: edzo,
    body: { username: 'tanitvany' },
  });
  const linkId = meghivo.json.linkId;
  assert.equal(
    (await request('POST', `/api/coach/invites/${linkId}/accept`, { cookie: sportolo })).status,
    200,
  );

  const kitüzve = await request('PUT', `/api/athletes/${linkId}/nutrition-goal`, {
    cookie: edzo,
    body: { calories: 3000, protein: 200 },
  });
  assert.equal(kitüzve.status, 200, `az edző kitűzi a célt (${kitüzve.json?.error ?? ''})`);

  const elotte = await request('GET', '/api/nutrition/goal', { cookie: sportolo });
  assert.equal(elotte.json.source, 'coach');
  assert.equal(elotte.json.calories, 3000);

  assert.equal((await request('DELETE', `/api/athletes/${linkId}`, { cookie: edzo })).status, 204);

  const utana = await request('GET', '/api/nutrition/goal', { cookie: sportolo });
  assert.notEqual(utana.source, 'coach');
  assert.equal(utana.json.coach, null, 'nem maradt edzői sor');
  assert.notEqual(utana.json.calories, 3000, 'a volt edző száma nem hajtja tovább a napi célt');
});

/* ======================================================================
   6. A vonalkód-keresés kimenő hívása
   ====================================================================== */

test('az átirányítást NEM követjük (SSRF)', async () => {
  const cookie = await register('vonalkodos');
  const res = await request('GET', `/api/foods/barcode/${OFF_REDIRECT}`, { cookie });
  // 502: „most nem elérhető" — és ami fontos, a 169.254.169.254-re nem mentünk el.
  assert.equal(res.status, 502, `az átirányítás nem termékválasz (kapott: ${res.status})`);
});

test('a túl nagy választ elengedjük, nem olvassuk a memóriába', async () => {
  const cookie = await register('nagyvalasz');
  const res = await request('GET', `/api/foods/barcode/${OFF_HUGE}`, { cookie });
  assert.equal(res.status, 502, `a 8 MB-os válasz elutasítva (kapott: ${res.status})`);
});

/* UTOLSÓ a fájlban: elfogyasztja a fiók vonalkód-keretét. */
test('a kimenő vonalkód-keresés fiókonként korlátos', async () => {
  const cookie = await register('sorolo');

  let blocked = null;
  for (let i = 0; i < 40 && !blocked; i++) {
    const res = await request('GET', `/api/foods/barcode/${validBarcode(100000 + i)}`, { cookie });
    if (res.status === 429) blocked = { at: i, res };
  }
  assert.ok(blocked, 'a végigsorolást megállítja a korlát');
  assert.ok(blocked.at >= 20, `a valódi használat belefér (megállt a ${blocked.at}. kérésnél)`);
  assert.ok(Number(blocked.res.retryAfter) > 0, 'Retry-After fejléc');

  // Egy MÁSIK fiók keretét ez nem érinti — a korlát fiókonként számol.
  const masik = await register('masik-sorolo');
  const res = await request('GET', `/api/foods/barcode/${validBarcode(200000)}`, {
    cookie: masik,
  });
  assert.notEqual(res.status, 429, 'a másik fiók nem kap 429-et');
});
