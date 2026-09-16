/**
 * FitTrack Pro — biztonsági végponti tesztek
 * ------------------------------------------
 * A 2026-09-13-i biztonsági átnézés három MAGAS leletének őrei, valódi
 * szerverrel (a többi végponti tesztfájl mintájára: saját folyamat, saját
 * ideiglenes adatbázis).
 *
 *   1. A belépés nem fogadhat el tetszőleges nevet: a hibás próbálkozások
 *      számlálója különben bármilyen (akár 100 KB-os) névvel hízlalható.
 *   2. Egy idegen nem zárhatja ki a fiókjából a tulajdonost — legalábbis a
 *      jelszócserét és a fióktörlést nem blokkolhatja a belépések próbálgatása.
 *   3. A mentés mérete korlátos: gyakorlat- és szettszám, megjegyzés-cél.
 *
 * KÜLÖN FÁJL, szándékosan: minden kérés 127.0.0.1-ről jön, tehát a belépés
 * forrásonkénti korlátja közös keret. Ha az api.test.js-ben élne, a limit
 * próbája a fájl minden későbbi belépését 429-re futtatná. Ugyanezért a
 * limit-teszt EBBEN a fájlban is az utolsó.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, cookieFrom } from './test-harness.js';

/* Egy proxy mögötti telepítést utánzunk (FITTRACK_TRUST_PROXY=1): a
   forrásonkénti korlát csak így mérhető két KÜLÖNBÖZŐ forrásra, és ez a
   beállítás nélkül proxy mögött az egész forgalom egyetlen forrásnak
   látszana. X-Forwarded-For nélkül a forrás továbbra is a TCP-cím. */
const { request: rawRequest } = await startServer({
  label: 'security',
  extraEnv: { FITTRACK_TRUST_PROXY: '1' },
});

/** A közös harness a fejléceket `headers`-ben várja; itt a `forwardedFor`
    kényelmi paramétert oldjuk fel X-Forwarded-For fejléccé. */
const request = (method, urlPath, { body, cookie, forwardedFor } = {}) =>
  rawRequest(method, urlPath, {
    body,
    cookie,
    headers: forwardedFor ? { 'X-Forwarded-For': forwardedFor } : undefined,
  });

const register = async (username, password = 'jelszo123') =>
  cookieFrom(
    await request('POST', '/api/auth/register', {
      body: { username, displayName: username, password },
    }),
  );

const login = (username, password, forwardedFor) =>
  request('POST', '/api/auth/login', {
    body: { username, password },
    forwardedFor,
  });

/** `count` gyakorlat, mindegyik `sets` szettel. */
const exercises = (count, sets = 1) =>
  Array.from({ length: count }, (_, i) => ({
    name: `Gyakorlat ${i + 1}`,
    sets: Array.from({ length: sets }, () => ({
      reps: '5',
      weight: '100',
      rpe: '8',
      type: 'work',
      done: true,
    })),
  }));

/* ======================================================================
   1. A belépés neve
   ====================================================================== */

test('hibás formátumú névvel a belépés 401, és nem zárol', async () => {
  const hosszu = 'x'.repeat(50_000);
  const valaszok = [];
  for (let i = 0; i < 12; i++) valaszok.push(await login(hosszu, 'barmi-jelszo'));

  assert.ok(
    valaszok.every((res) => res.status === 401),
    `mindig 401, soha 429 (kapott: ${[...new Set(valaszok.map((r) => r.status))]})`,
  );
  const rendes = await login('senki', 'barmi-jelszo');
  assert.equal(
    valaszok[0].json.error,
    rendes.json.error,
    'ugyanaz az üzenet, mint a nem létező érvényes névnél — nem árul el semmit',
  );
});

/* ======================================================================
   2. Kizárás a saját fiókból
   ====================================================================== */

test('a belépés próbálgatása nem blokkolja a tulajdonos jelszócseréjét', async () => {
  const cookie = await register('celpont');

  // Idegen próbálgatja a nevet (a teszt ugyanarról a gépről — a belépés így zárol).
  for (let i = 0; i < 10; i++) await login('celpont', 'rossz-jelszo');
  assert.equal((await login('celpont', 'rossz-jelszo')).status, 429, 'a próbálgató forrás zárolva');

  // A tulajdonos a már élő munkamenetéből le tudja cserélni a (kompromittált) jelszót.
  const csere = await request('PUT', '/api/auth/password', {
    cookie,
    body: { currentPassword: 'jelszo123', newPassword: 'ujjelszo123' },
  });
  assert.equal(csere.status, 200, `a jelszócsere nem kap 429-et (kapott: ${csere.status})`);
});

/* ======================================================================
   3. A mentés mérete
   ====================================================================== */

let meretCookie;

test('50 gyakorlat, gyakorlatonként 50 szett még menthető', async () => {
  meretCookie = await register('meretes');
  const res = await request('POST', '/api/workouts', {
    cookie: meretCookie,
    body: { name: 'Nagy edzés', exercises: exercises(50, 50) },
  });
  assert.equal(
    res.status,
    201,
    `a legnagyobb megengedett edzés átmegy (kapott: ${res.status} ${res.json?.error ?? ''})`,
  );
});

test('51 gyakorlat vagy 51 szett 400 — edzésnél, tervnél és piszkozatnál is', async () => {
  const cases = [
    ['POST', '/api/workouts', { name: 'Túl sok gyakorlat', exercises: exercises(51) }],
    ['POST', '/api/workouts', { name: 'Túl sok szett', exercises: exercises(1, 51) }],
    ['POST', '/api/plans', { name: 'Túl nagy terv', exercises: exercises(51) }],
    ['PUT', '/api/workout-draft', { name: '', exercises: exercises(1, 51) }],
  ];
  for (const [method, url, body] of cases) {
    const res = await request(method, url, { cookie: meretCookie, body });
    assert.equal(res.status, 400, `${method} ${url} (${body.name || 'piszkozat'}): ${res.status}`);
    assert.match(res.json.error, /legfeljebb/i, 'az üzenet megmondja a korlátot');
  }
});

test('a megjegyzés célja csak „edzés:gyakorlat" alakú lehet', async () => {
  const hosszu = await request('POST', '/api/comments', {
    cookie: meretCookie,
    body: { targetId: 'x'.repeat(5000), text: 'szöveg' },
  });
  assert.equal(hosszu.status, 400);

  const rendes = await request('POST', '/api/comments', {
    cookie: meretCookie,
    body: { targetId: '1:0', text: 'szöveg' },
  });
  assert.equal(rendes.status, 201);
});

/* ======================================================================
   4. A belépés forrásonkénti korlátja — UTOLSÓ, mert elfogyasztja a keretet
   ====================================================================== */

test('egy forrásból túl sok belépési kísérlet 429-et kap, Retry-After-rel', async () => {
  let blocked = null;
  // Mindig MÁS érvényes nevet próbálunk: a névre szóló zárolás így nem lép
  // közbe, csak a forrásonkénti korlát állíthatja meg a sorozatot.
  for (let i = 0; i < 80 && !blocked; i++) {
    const res = await login(`probalkozo${i}`, 'barmi-jelszo');
    if (res.status === 429) blocked = { at: i, res };
  }
  assert.ok(blocked, 'a sorozatot megállította a korlát');
  assert.ok(Number(blocked.res.retryAfter) > 0, 'Retry-After fejléc');
});

test('proxy mögött (trust proxy) a korlát a VALÓDI forrásra szól, nem közös keret', async () => {
  // A kimerített forrás mellett egy másik kliens ugyanazon a proxyn át
  // továbbra is próbálkozhat — beállítás nélkül mindkettő a proxy címe lenne,
  // és 60 szemét-kérés mindenkinek letiltaná a belépést.
  const tamado = '203.0.113.50';
  let blocked = false;
  for (let i = 0; i < 80 && !blocked; i++) {
    blocked = (await login(`proxys${i}`, 'barmi-jelszo', tamado)).status === 429;
  }
  assert.ok(blocked, 'a támadó forrása kimerült');

  const masik = await login('senki', 'barmi-jelszo', '198.51.100.9');
  assert.equal(masik.status, 401, `a másik forrás nem kap 429-et (kapott: ${masik.status})`);
});
