/**
 * FitTrack Pro — VÉGPONTI (HTTP) tesztek
 * --------------------------------------
 * A többi tesztfájl a modulokat külön-külön méri: a recovery.test.js a
 * matematikát, a users.test.js az adatréteg szűrését, az auth.test.js a
 * jelszót és a sütit. A server.js viszont — a validálás, a normalizálás, a
 * hozzáférés-védelem és a végpontok összedrótozása — eddig egyáltalán nem volt
 * tesztelve, pedig a hibák jó része PONTOSAN ott keletkezik: az adatréteg
 * helyesen szűr, de a végpont nem adja át a userId-t; a db.js elfogadja az
 * adatot, de a végpont nem validál.
 *
 * Ezért ez a fájl a VALÓDI szervert indítja el (külön folyamatban, saját
 * ideiglenes adatbázissal), és HTTP-n beszél vele — ugyanúgy, ahogy a böngésző.
 * Amit itt ellenőrzünk, az a felhasználó által ténylegesen látott viselkedés.
 *
 * A szerver PORT=0-val indul: a portot az operációs rendszer választja, a
 * teszt pedig a szerver indulási sorából olvassa ki. Így párhuzamos futásnál
 * sem ütközik semmi.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-api-'));

/* ---- A szerver elindítása és a port kiolvasása ---- */

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'server.js')],
  {
    env: { ...process.env, FITTRACK_DB: path.join(workDir, 'api.db'), PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

/** A szerver indulási sorából kiolvasott alap-URL. Ha 20 mp alatt nem indul
    el, inkább elbukunk egy beszédes üzenettel, mint hogy a futtató ölje meg. */
const baseUrl = await new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => reject(new Error(`A szerver nem indult el időben:\n${output}`)), 20_000);

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    output += chunk;
    const match = output.match(/http:\/\/localhost:(\d+)/);
    if (match) {
      clearTimeout(timer);
      resolve(`http://localhost:${match[1]}`);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.on('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`A szerver kilépett (kód: ${code}):\n${output}`));
  });
});

/* A szervert az UTOLSÓ teszt után állítjuk le, és megvárjuk, amíg tényleg
   kilép. Ez nem elhagyható: amíg a gyerekfolyamat és a csővezetékei élnek, a
   teszt-futtató eseményhurka sem ürül ki, tehát a `node --test` a legutolsó
   pipa után is ott állna örökre. (A process.on('exit') ehhez késő: az csak
   akkor sülne el, ha a folyamat már amúgy is kilépne.) */
after(async () => {
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
  // A DB-fájlt a gyerek tartotta nyitva — a törlés csak a kilépése után megy.
  rmSync(workDir, { recursive: true, force: true });
});

/* ---- Kérés-segéd ----
   A munkamenetet süti hordozza, ezért a hívó átadhatja a sajátját; a válaszból
   kiolvasott új sütit visszaadjuk, hogy a belépés után tovább lehessen adni. */

async function request(method, urlPath, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });

  const setCookie = res.headers.getSetCookie();
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* nem JSON — a json null marad */ }

  return { status: res.status, json, text, setCookie };
}

/** A Set-Cookie fejlécből a `név=érték` rész (ezt küldjük vissza Cookie-ként). */
const cookieFrom = (res) => (res.setCookie[0] ?? '').split(';')[0];

/** A szerver által használt mai dátum — a végpontok ezt írják a sorokba. */
const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

/** Egy gyakorlat, egyetlen teljesített munkasorozattal. */
const gyakorlat = (name, weight, reps = 5) => ({
  name,
  sets: [{ reps: String(reps), weight: String(weight), rpe: '8', type: 'work', done: true }],
});

// A belépett fiókok sütijei — az első két teszt tölti fel őket.
let annaCookie = '';
let belaCookie = '';

/* ======================================================================
   1. Hozzáférés-védelem — bejelentkezés nélkül semmi nem érhető el
   ====================================================================== */

test('bejelentkezés nélkül MINDEN /api végpont 401-et ad', async () => {
  /* Ez a teszt a server.js legfontosabb egyetlen sorát őrzi: a védelem az
     összes útvonal ELŐTT áll, tehát egy később felvett végpont automatikusan
     védett. Ha valaki a middleware ELÉ szúr be egy új route-ot, itt bukik. */
  const endpoints = [
    ['GET', '/api/user'], ['GET', '/api/profile'], ['GET', '/api/dashboard'], ['GET', '/api/charts'],
    ['GET', '/api/weight-log'], ['GET', '/api/nutrition'], ['GET', '/api/nutrition/log'],
    ['GET', '/api/workouts'], ['GET', '/api/workout-draft'], ['GET', '/api/workout-template'],
    ['GET', '/api/plans'], ['GET', '/api/prs'], ['GET', '/api/prs/history?exercise=X'],
    ['GET', '/api/exercise-maxes'], ['GET', '/api/readiness'], ['GET', '/api/checkin'],
    ['GET', '/api/export'], ['GET', '/api/foods'], ['GET', '/api/exercise-catalog'],
    ['GET', '/api/athletes'], ['GET', '/api/notifications'], ['GET', '/api/default-set'],
    ['GET', '/api/athlete-replies'], ['GET', '/api/coach-notes'], ['GET', '/api/coach-replies'],
    ['POST', '/api/weight-log'], ['POST', '/api/nutrition/log'], ['POST', '/api/workouts'],
    ['POST', '/api/plans'], ['PUT', '/api/plans/1'], ['PUT', '/api/workout-draft'],
    ['PUT', '/api/checkin'], ['DELETE', '/api/workout-draft'], ['DELETE', '/api/nutrition/log/1'],
  ];

  for (const [method, urlPath] of endpoints) {
    const res = await request(method, urlPath, { body: method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${method} ${urlPath} védtelen!`);
  }
});

test('üres adatbázison a /api/auth/me firstRun jelzéssel válaszol', async () => {
  const res = await request('GET', '/api/auth/me');
  assert.equal(res.status, 401);
  assert.equal(res.json.firstRun, true, 'még egy fiók sincs → a felület regisztrációt kínál');
});

/* ======================================================================
   2. Regisztráció, belépés, munkamenet
   ====================================================================== */

test('a regisztráció visszautasítja a rossz felhasználónevet és a rövid jelszót', async () => {
  const rossz = [
    [{ username: 'ab', password: 'jelszo123' }, 'túl rövid név'],
    [{ username: 'Nagy Béla', password: 'jelszo123' }, 'szóköz és ékezet a névben'],
    [{ username: 'anna', password: 'rovid' }, 'túl rövid jelszó'],
    [{ username: '', password: '' }, 'üres törzs'],
  ];
  for (const [body, eset] of rossz) {
    const res = await request('POST', '/api/auth/register', { body });
    assert.equal(res.status, 400, eset);
    assert.ok(res.json.error, `${eset}: van hibaüzenet`);
  }
});

test('sikeres regisztráció után áll a munkamenet, és a süti védett', async () => {
  const res = await request('POST', '/api/auth/register', {
    body: { username: 'anna', displayName: 'Kovács Anna', password: 'jelszo123' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.username, 'anna');
  assert.equal(res.json.displayName, 'Kovács Anna');
  assert.ok(!('password' in res.json) && !('password_hash' in res.json), 'a jelszó nem szivárog ki');

  const raw = res.setCookie[0];
  assert.ok(raw.includes('HttpOnly'), 'HttpOnly — JS-ből nem olvasható');
  assert.ok(raw.includes('SameSite=Lax'), 'SameSite=Lax — idegen oldalról nem megy el');
  assert.ok(!raw.includes('Secure'), 'localhoston nincs Secure, különben senki nem tudna belépni');

  annaCookie = cookieFrom(res);
  const me = await request('GET', '/api/auth/me', { cookie: annaCookie });
  assert.equal(me.status, 200);
  assert.equal(me.json.username, 'anna');
});

test('a foglalt felhasználónév 409-et ad, a névütközés kisbetű-érzéketlen', async () => {
  const res = await request('POST', '/api/auth/register', {
    body: { username: 'ANNA', displayName: 'Másik Anna', password: 'jelszo123' },
  });
  assert.equal(res.status, 409);
});

test('a második fiók is létrejön, és NEM örököl a másiktól', async () => {
  const res = await request('POST', '/api/auth/register', {
    body: { username: 'bela', displayName: 'Nagy Béla', password: 'jelszo456' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.adoptedLegacy, false, 'nincs mit örökölnie — nem ő az első fiók');
  belaCookie = cookieFrom(res);
});

test('a belépés nem árulja el, a név vagy a jelszó volt-e rossz', async () => {
  const rosszJelszo = await request('POST', '/api/auth/login', {
    body: { username: 'anna', password: 'nemez' },
  });
  const nincsIlyenFiok = await request('POST', '/api/auth/login', {
    body: { username: 'senki', password: 'jelszo123' },
  });
  assert.equal(rosszJelszo.status, 401);
  assert.equal(nincsIlyenFiok.status, 401);
  assert.equal(rosszJelszo.json.error, nincsIlyenFiok.json.error,
    'azonos üzenet — különben fel lehetne térképezni a létező fiókokat');
});

test('a belépés kisbetű-érzéketlen a névre, és új munkamenetet ad', async () => {
  const res = await request('POST', '/api/auth/login', {
    body: { username: 'ANNA', password: 'jelszo123' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.username, 'anna');

  const me = await request('GET', '/api/auth/me', { cookie: cookieFrom(res) });
  assert.equal(me.status, 200);
});

test('kijelentkezés után a régi süti már nem nyit ajtót', async () => {
  const belepes = await request('POST', '/api/auth/login', {
    body: { username: 'bela', password: 'jelszo456' },
  });
  const cookie = cookieFrom(belepes);
  assert.equal((await request('GET', '/api/user', { cookie })).status, 200);

  const kilepes = await request('POST', '/api/auth/logout', { body: {}, cookie });
  assert.equal(kilepes.status, 204);
  assert.equal((await request('GET', '/api/user', { cookie })).status, 401,
    'a munkamenet a szerveren is megszűnt, nem csak a böngészőben');
});

test('a kitalált munkamenet-token nem ad hozzáférést', async () => {
  const res = await request('GET', '/api/user', { cookie: 'fittrack_session=hamisitott-token' });
  assert.equal(res.status, 401);
});

test('ismeretlen /api útvonal JSON-hibát ad, nem HTML-t', async () => {
  const res = await request('GET', '/api/nincs-ilyen', { cookie: annaCookie });
  assert.equal(res.status, 404);
  assert.ok(res.json.error.includes('/api/nincs-ilyen'));
});

/* ======================================================================
   3. Adatizoláció — HTTP szinten
   Az adatréteg szűrését a users.test.js méri; itt az a kérdés, hogy a
   VÉGPONTOK tényleg a hívó fiókját adják-e át neki.
   ====================================================================== */

test('a /api/user a BEJELENTKEZETT fiók nevét adja', async () => {
  const anna = await request('GET', '/api/user', { cookie: annaCookie });
  const bela = await request('GET', '/api/user', { cookie: belaCookie });
  assert.equal(anna.json.name, 'Kovács Anna');
  assert.equal(bela.json.name, 'Nagy Béla');
});

test('Anna edzése nem jelenik meg Béla listáiban', async () => {
  const mentes = await request('POST', '/api/workouts', {
    cookie: annaCookie,
    body: { name: 'Anna mellnapja', exercises: [gyakorlat('Fekvenyomás', 60)] },
  });
  assert.equal(mentes.status, 201);

  const annaLista = await request('GET', '/api/workouts', { cookie: annaCookie });
  const belaLista = await request('GET', '/api/workouts', { cookie: belaCookie });
  assert.equal(annaLista.json.length, 1);
  assert.equal(belaLista.json.length, 0, 'Béla nem látja Anna edzését');
});

test('MÁS fiók tervét nem lehet átírni — 404, nem csendes felülírás', async () => {
  const terv = await request('POST', '/api/plans', {
    cookie: annaCookie,
    body: { name: 'Anna terve', exercises: [gyakorlat('Guggolás', 80)], days: [0, 3] },
  });
  assert.equal(terv.status, 201);

  const idegenIras = await request('PUT', `/api/plans/${terv.json.id}`, {
    cookie: belaCookie,
    body: { name: 'ELTÉRÍTVE', exercises: [gyakorlat('Guggolás', 10)], days: [] },
  });
  assert.equal(idegenIras.status, 404);

  const annaTervek = await request('GET', '/api/plans', { cookie: annaCookie });
  assert.equal(annaTervek.json[0].name, 'Anna terve', 'a terv érintetlen maradt');
});

test('MÁS fiók naplóbejegyzését nem lehet törölni', async () => {
  const naplozas = await request('POST', '/api/nutrition/log', {
    cookie: annaCookie,
    body: { name: (await request('GET', '/api/foods', { cookie: annaCookie })).json[0].name, grams: 100 },
  });
  assert.equal(naplozas.status, 201);

  const idegenTorles = await request('DELETE', `/api/nutrition/log/${naplozas.json.entry.id}`, {
    cookie: belaCookie,
  });
  assert.equal(idegenTorles.status, 404);

  const annaNaplo = await request('GET', '/api/nutrition/log', { cookie: annaCookie });
  assert.equal(annaNaplo.json.length, 1, 'a bejegyzés megmaradt');
});

test('az export CSAK a hívó saját adatát tartalmazza', async () => {
  const bela = await request('GET', '/api/export', { cookie: belaCookie });
  assert.equal(bela.json.workouts.length, 0);
  assert.equal(bela.json.userPlans.length, 0);
  assert.equal(bela.json.nutritionLog.length, 0);
  assert.deepEqual(bela.json.exerciseMaxes, [], 'még nincs csúcsa');
  // A referencia-adat viszont közös — annak ott kell lennie.
  assert.ok(Array.isArray(bela.json.foods) && bela.json.foods.length > 0);
});

/* ======================================================================
   4. Validáció — a szerver nem bízik a kliensben
   ====================================================================== */

test('a testsúly csak 30 és 300 kg között fogadható el', async () => {
  for (const kg of [29, 301, 0, -5, 'nyolcvan', null]) {
    const res = await request('POST', '/api/weight-log', { cookie: annaCookie, body: { kg } });
    assert.equal(res.status, 400, `${kg} kg-ot vissza kell utasítani`);
  }
  const jo = await request('POST', '/api/weight-log', { cookie: annaCookie, body: { kg: 83.5 } });
  assert.equal(jo.status, 200);
  assert.equal(jo.json.kg, 83.5);
});

test('csak a katalógusban szereplő étel naplózható, érvényes adaggal', async () => {
  const ismeretlen = await request('POST', '/api/nutrition/log', {
    cookie: annaCookie, body: { name: 'Sárkánytojás', grams: 100 },
  });
  assert.equal(ismeretlen.status, 400);

  const etel = (await request('GET', '/api/foods', { cookie: annaCookie })).json[0].name;
  for (const grams of [0, -1, 2001, 'sok']) {
    const res = await request('POST', '/api/nutrition/log', { cookie: annaCookie, body: { name: etel, grams } });
    assert.equal(res.status, 400, `${grams} g-ot vissza kell utasítani`);
  }
});

test('a makrókat a SZERVER számolja — a kliens hamis tápértéke nem jut be', async () => {
  /* A törzsben szándékosan képtelen értékeket küldünk. Ha a szerver ezeket
     átvenné, a napi összesítőt (és rajta keresztül a készenlét-számítást) a
     kliensből lehetne hazudni. */
  const foods = (await request('GET', '/api/foods', { cookie: belaCookie })).json;
  const etel = foods[0];
  const res = await request('POST', '/api/nutrition/log', {
    cookie: belaCookie,
    body: { name: etel.name, grams: 100, kcal: 99999, protein: 99999, carbs: 0, fat: 0 },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.entry.kcal, Math.round(etel.kcal), 'a katalógus értéke ment be, nem a küldött');
  assert.notEqual(res.json.entry.kcal, 99999);
});

test('az edzés neve kötelező, és legalább egy érvényes gyakorlat kell', async () => {
  const rossz = [
    [{ name: '', exercises: [gyakorlat('Guggolás', 80)] }, 'üres név'],
    [{ name: 'x'.repeat(61), exercises: [gyakorlat('Guggolás', 80)] }, 'túl hosszú név'],
    [{ name: 'Edzés', exercises: [] }, 'üres gyakorlatlista'],
    [{ name: 'Edzés', exercises: [{ name: 'Guggolás', sets: [] }] }, 'szett nélküli gyakorlat'],
    [{ name: 'Edzés', exercises: [{ name: '', sets: [{ reps: '5' }] }] }, 'névtelen gyakorlat'],
    [{ name: 'Edzés', exercises: 'nem tömb' }, 'rossz szerkezet'],
  ];
  for (const [body, eset] of rossz) {
    const res = await request('POST', '/api/workouts', { cookie: annaCookie, body });
    assert.equal(res.status, 400, eset);
  }
});

test('a check-in a tartományon kívüli értéket visszautasítja', async () => {
  const rossz = [
    [{ sleepHours: 25 }, 'alvás 24 óra felett'],
    [{ sleepHours: -1 }, 'negatív alvás'],
    [{ energy: 0 }, 'energia a skála alatt'],
    [{ energy: 6 }, 'energia a skála felett'],
    [{ stress: 'sok' }, 'nem szám'],
    [{ hydration: 16 }, 'folyadék a felső határ felett'],
  ];
  for (const [body, eset] of rossz) {
    const res = await request('PUT', '/api/checkin', { cookie: annaCookie, body });
    assert.equal(res.status, 400, eset);
    assert.ok(res.json.error, `${eset}: beszédes hibaüzenet`);
  }
});

test('a check-in a NEM MEGADOTT mezőt null-ként őrzi, nem nullaként', async () => {
  /* Ez a Recovery Engine egyik alapfeltevése: a hiányzó mező súlya
     újraoszlik a képletben. Ha nullává csúszna, minden kihagyott kérdés
     „a lehető legrosszabb" értékként verné le a készenlétet. */
  const res = await request('PUT', '/api/checkin', {
    cookie: belaCookie, body: { sleepHours: 7, energy: 4 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.checkin.sleepHours, 7);
  assert.equal(res.json.checkin.energy, 4);
  assert.equal(res.json.checkin.stress, null, 'a meg nem adott stressz null');
  assert.equal(res.json.checkin.mood, null);
});

test('a check-in csak ismert izomkulcsot és érvényes értéket vesz át', async () => {
  const res = await request('PUT', '/api/checkin', {
    cookie: belaCookie,
    body: {
      sleepHours: 7,
      soreness: { chest: 3, kitalaltIzom: 5, quads: 99 },
      pain: { general: 4, semmi: 2 },
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.checkin.soreness, { chest: 3 }, 'ismeretlen kulcs és tartományon kívüli érték kiesik');
  assert.deepEqual(res.json.checkin.pain, { general: 4 });
});

/* ======================================================================
   5. Normalizálás — a tárolt adat nem függ a kliens jóindulatától
   ====================================================================== */

test('az RPE 1 és 10 közé szorul, fél fokozatra kerekítve', async () => {
  const res = await request('PUT', '/api/workout-draft', {
    cookie: annaCookie,
    body: {
      name: 'RPE-teszt',
      exercises: [{
        name: 'Guggolás',
        sets: [
          { reps: '5', weight: '100', rpe: '99', type: 'work' },
          { reps: '5', weight: '100', rpe: '0', type: 'work' },
          { reps: '5', weight: '100', rpe: 'RPE 8', type: 'work' },
          { reps: '5', weight: '100', rpe: '7,3', type: 'work' },
          { reps: '5', weight: '100', rpe: 'semmi', type: 'work' },
        ],
      }],
    },
  });
  assert.equal(res.status, 200);
  const rpek = res.json.exercises[0].sets.map((s) => s.rpe);
  assert.deepEqual(rpek, ['10', '1', '8', '7.5', ''],
    'felső/alsó határ, szövegből kinyert szám, tizedesvessző, üres');
});

test('a drop set nem állhat a lista élén és nem követhet bemelegítőt', async () => {
  const res = await request('PUT', '/api/workout-draft', {
    cookie: annaCookie,
    body: {
      name: 'Szett-típus teszt',
      exercises: [{
        name: 'Bicepsz',
        sets: [
          { reps: '10', weight: '20', type: 'drop' },   // a lista élén — nincs mihez csökkennie
          { reps: '10', weight: '20', type: 'drop' },   // bemelegítőt követ
          { reps: '10', weight: '20', type: 'drop' },   // ez már valódi drop
          { reps: '10', weight: '20', type: 'kitalalt' }, // ismeretlen → pozíció szerinti alap
        ],
      }],
    },
  });
  const tipusok = res.json.exercises[0].sets.map((s) => s.type);
  assert.deepEqual(tipusok, ['warmup', 'work', 'drop', 'work']);
});

test('a szuperszett-jelölés a lista első gyakorlatán nem érvényesül', async () => {
  const res = await request('PUT', '/api/workout-draft', {
    cookie: annaCookie,
    body: {
      name: 'Szuperszett teszt',
      exercises: [
        { ...gyakorlat('Fekvenyomás', 60), superset: true },  // nincs előtte semmi
        { ...gyakorlat('Evezés', 50), superset: true },       // ez valódi párosítás
      ],
    },
  });
  assert.equal(res.json.exercises[0].superset, false, 'az első elemnek nincs mihez kapcsolódnia');
  assert.equal(res.json.exercises[1].superset, true);
});

/* ======================================================================
   6. Teljes folyamatok — ahogy a felület használja
   ====================================================================== */

test('étel naplózása növeli a napi összesítőt, a törlés visszaállítja', async () => {
  const kiindulas = (await request('GET', '/api/nutrition', { cookie: belaCookie })).json.intake;
  const etel = (await request('GET', '/api/foods', { cookie: belaCookie })).json[0];

  const felvitel = await request('POST', '/api/nutrition/log', {
    cookie: belaCookie, body: { name: etel.name, grams: 200 },
  });
  assert.equal(felvitel.status, 201);
  assert.ok(felvitel.json.totals.intake > kiindulas, 'a bevitel nőtt');
  assert.equal(felvitel.json.entry.grams, 200);
  // 200 g → a 100 g-os alapérték kétszerese
  assert.equal(felvitel.json.entry.kcal, Math.round(etel.kcal * 2));

  const torles = await request('DELETE', `/api/nutrition/log/${felvitel.json.entry.id}`, {
    cookie: belaCookie,
  });
  assert.equal(torles.status, 200);
  assert.equal(torles.json.intake, kiindulas, 'az összesítő visszaállt');
});

test('edzés mentése PR-t jelöl, és a rekord a saját csúcshoz mérődik', async () => {
  // Béla első fekvenyomása — nincs mihez mérni, tehát PR.
  const elso = await request('POST', '/api/workouts', {
    cookie: belaCookie,
    body: { name: 'Béla mellnapja', exercises: [gyakorlat('Fekvenyomás', 100, 5)] },
  });
  assert.equal(elso.status, 201);
  assert.equal(elso.json.exercises[0].pr, true, 'az első teljesítmény mindig rekord');

  // Anna 60 kg-os fekvenyomása is PR — a SAJÁT előzményéhez mérve.
  const annaEdzes = (await request('GET', '/api/workouts', { cookie: annaCookie })).json;
  assert.equal(annaEdzes[annaEdzes.length - 1].exercises[0].pr, true,
    'a kezdő nem a legerősebb felhasználó csúcsához mérődik');

  // Gyengébb második edzés — nem rekord.
  const gyengebb = await request('POST', '/api/workouts', {
    cookie: belaCookie,
    body: { name: 'Könnyű nap', exercises: [gyakorlat('Fekvenyomás', 60, 5)] },
  });
  assert.equal(gyengebb.json.exercises[0].pr, false);

  // A nyomon követett csúcs a nagyobbik érték maradt.
  const maxes = (await request('GET', '/api/exercise-maxes', { cookie: belaCookie })).json;
  assert.equal(maxes['Fekvenyomás'], Math.round(100 * (1 + 5 / 30) * 10) / 10);
});

test('a PR-lista a rekordot hozó szettet írja ki, nem a bemelegítőt', async () => {
  /* Ez egy már EGYSZER elrontott viselkedés őrzője: a lista korábban az első
     teljesített szettet mutatta, ami a szett-típusok óta jellemzően a
     bemelegítés — a felület a 10 × 40 kg-ot hirdette rekordnak a 3 × 120
     helyett. */
  await request('POST', '/api/workouts', {
    cookie: belaCookie,
    body: {
      name: 'Guggolás nap',
      exercises: [{
        name: 'Guggolás',
        sets: [
          { reps: '10', weight: '40', rpe: '5', type: 'warmup', done: true },
          { reps: '3', weight: '120', rpe: '9', type: 'work', done: true },
        ],
      }],
    },
  });

  const prs = (await request('GET', '/api/prs', { cookie: belaCookie })).json;
  const guggolas = prs.find((p) => p.exercise === 'Guggolás');
  assert.ok(guggolas, 'a guggolás szerepel a rekordok között');
  assert.equal(guggolas.detail, '3 ism. @ 120 kg', 'a nehéz munkasorozat a rekord, nem a bemelegítés');
  assert.equal(guggolas.oneRM, Math.round(120 * (1 + 3 / 30) * 10) / 10);
});

test('a PR-előzmény a kért gyakorlatra szűr', async () => {
  const elozmeny = (await request('GET', '/api/prs/history?exercise=Guggol%C3%A1s', {
    cookie: belaCookie,
  })).json;
  assert.ok(elozmeny.length >= 1);
  assert.ok(elozmeny.every((e) => e.exercise === 'Guggolás'));

  const ures = (await request('GET', '/api/prs/history?exercise=Nincs%20ilyen', {
    cookie: belaCookie,
  })).json;
  assert.deepEqual(ures, [], 'ismeretlen NÉV nem hiba — csak még nincs rekordja');
});

test('a PR-előzmény hangosan hibázik hiányzó vagy kétértelmű paraméterre', async () => {
  /* Mindhárom eset korábban üres listát adott, ami megkülönböztethetetlen volt
     attól, hogy a gyakorlathoz tényleg nincs rekord — a hiba némán elveszett. */
  const rossz = [
    ['/api/prs/history', 'hiányzó paraméter'],
    ['/api/prs/history?exercise=', 'üres paraméter'],
    ['/api/prs/history?exercise=%20%20', 'csak szóköz'],
    ['/api/prs/history?exercise=Guggol%C3%A1s&exercise=Fekvenyom%C3%A1s', 'kétértelmű (ismétlődő) paraméter'],
  ];
  for (const [urlPath, eset] of rossz) {
    const res = await request('GET', urlPath, { cookie: belaCookie });
    assert.equal(res.status, 400, eset);
    assert.ok(res.json.error, `${eset}: van hibaüzenet`);
  }
});

test('az export tartalmazza az egyéni csúcsokat, a dátumukkal együtt', async () => {
  /* A csúcsok elvileg visszaszámolhatók az edzésekből, de a „teljes
     pillanatkép" akkor teljes, ha nem kell hozzá újraszámolni semmit — és a
     csúcs dátuma a naplóból csak közvetve jönne ki. */
  const snapshot = (await request('GET', '/api/export', { cookie: belaCookie })).json;
  assert.ok(Array.isArray(snapshot.exerciseMaxes));

  const guggolas = snapshot.exerciseMaxes.find((m) => m.exercise === 'Guggolás');
  assert.ok(guggolas, 'a guggolás csúcsa benne van');
  assert.equal(guggolas.max1rm, 120 * (1 + 3 / 30), 'a nehéz munkasorozatból');
  assert.equal(guggolas.date, today());

  // A /api/exercise-maxes végpont alakja ettől függetlenül változatlan marad.
  const maxMap = (await request('GET', '/api/exercise-maxes', { cookie: belaCookie })).json;
  assert.equal(maxMap['Guggolás'], Math.round(120 * (1 + 3 / 30) * 10) / 10);

  /* És a szűrés itt is él. Mindkét fiók nyomott fekvenyomást, de más súllyal:
     a snapshotban Béla SAJÁT csúcsának kell állnia, nem Annáénak. */
  const bencs = snapshot.exerciseMaxes.find((m) => m.exercise === 'Fekvenyomás');
  assert.equal(bencs.max1rm, 100 * (1 + 5 / 30), 'Béla 100 kg-ja');
  assert.notEqual(bencs.max1rm, 60 * (1 + 5 / 30), 'nem Anna 60 kg-ja');
});

test('a piszkozat visszatöltődik, és törlés után eltűnik', async () => {
  const mentes = await request('PUT', '/api/workout-draft', {
    cookie: belaCookie,
    body: { name: 'Félbehagyott edzés', exercises: [gyakorlat('Húzódzkodás', 0, 8)] },
  });
  assert.equal(mentes.status, 200);

  const sablon = (await request('GET', '/api/workout-template', { cookie: belaCookie })).json;
  assert.equal(sablon.source, 'draft');
  assert.equal(sablon.name, 'Félbehagyott edzés');

  assert.equal((await request('DELETE', '/api/workout-draft', { cookie: belaCookie })).status, 204);
  assert.equal((await request('GET', '/api/workout-draft', { cookie: belaCookie })).json, null);
});

test('az üres gyakorlatlistájú piszkozat érvényes, a hibás szerkezet nem', async () => {
  const ures = await request('PUT', '/api/workout-draft', {
    cookie: belaCookie, body: { name: '', exercises: [] },
  });
  assert.equal(ures.status, 200, 'a még üres edzésnapló is menthető');

  const hibas = await request('PUT', '/api/workout-draft', {
    cookie: belaCookie, body: { name: 'x', exercises: 'nem tömb' },
  });
  assert.equal(hibas.status, 400);
});

test('a mai napra ütemezett terv töltődik az Edzés oldalra', async () => {
  await request('DELETE', '/api/workout-draft', { cookie: belaCookie });
  const maiNap = (new Date().getDay() + 6) % 7;

  const terv = await request('POST', '/api/plans', {
    cookie: belaCookie,
    body: { name: 'Mai terv', exercises: [gyakorlat('Vállnyomás', 40)], days: [maiNap] },
  });
  assert.equal(terv.status, 201);

  const sablon = (await request('GET', '/api/workout-template', { cookie: belaCookie })).json;
  assert.equal(sablon.source, 'plan');
  assert.equal(sablon.name, 'Mai terv');
  assert.equal(sablon.planId, terv.json.id);
});

test('a hétnap-lista egyedi, rendezett 0–6 indexekké normalizálódik', async () => {
  const terv = await request('POST', '/api/plans', {
    cookie: annaCookie,
    body: {
      name: 'Napok teszt',
      exercises: [gyakorlat('Guggolás', 80)],
      days: [3, 0, 3, 9, -1, 'kedd', 6],
    },
  });
  assert.equal(terv.status, 201);
  const mentett = (await request('GET', '/api/plans', { cookie: annaCookie })).json
    .find((p) => p.name === 'Napok teszt');
  assert.deepEqual(mentett.days, [0, 3, 6]);
});

test('a check-in mentése a testsúlyt a testsúly-naplóba írja, naponta egy sorba', async () => {
  const elso = await request('PUT', '/api/checkin', {
    cookie: annaCookie, body: { sleepHours: 7.5, energy: 4, weightKg: 70 },
  });
  assert.equal(elso.status, 200);
  assert.equal(elso.json.weightEntry.kg, 70);
  assert.ok(elso.json.readiness, 'a friss riport is visszajön — a felület egy körből frissül');

  // Ugyanaznap újramentve: felülír, nem duplikál.
  const masodik = await request('PUT', '/api/checkin', {
    cookie: annaCookie, body: { sleepHours: 8, energy: 5, weightKg: 71 },
  });
  assert.equal(masodik.json.weightEntry.kg, 71);

  const naplo = (await request('GET', '/api/weight-log', { cookie: annaCookie })).json;
  const maiSorok = naplo.filter((sor) => sor.date === today());
  assert.equal(maiSorok.length, 1, 'a mai napra egyetlen testsúly-sor van');
  assert.equal(maiSorok[0].kg, 71);

  const rosszSuly = await request('PUT', '/api/checkin', {
    cookie: annaCookie, body: { sleepHours: 8, weightKg: 500 },
  });
  assert.equal(rosszSuly.status, 400);
});

test('a check-in újramentése frissíti a sort, nem hoz létre újat', async () => {
  const mai = (await request('GET', '/api/checkin', { cookie: annaCookie })).json;
  assert.equal(mai.sleepHours, 8, 'a legutóbbi mentés értéke látszik');
  assert.equal(mai.date, today());
});

/* ======================================================================
   6b. Profiloldal — a fiók adatai és az összesítők
   ====================================================================== */

test('a profil összesítői a SAJÁT naplózott adatból épülnek', async () => {
  /* Friss fiókkal, hogy a számok pontosan ellenőrizhetők legyenek: Anna és
     Béla ekkor már több edzést és check-int is elmentett — ha bármelyikük
     adata beszivárogna, az itt azonnal kiütközik. */
  const reg = await request('POST', '/api/auth/register', {
    body: { username: 'cili', displayName: 'Szabó Cili', password: 'jelszo123' },
  });
  assert.equal(reg.status, 201);
  const ciliCookie = cookieFrom(reg);

  const ures = (await request('GET', '/api/profile', { cookie: ciliCookie })).json;
  assert.equal(ures.username, 'cili');
  assert.equal(ures.name, 'Szabó Cili');
  assert.equal(ures.joinedAt, today(), 'a regisztráció napja a felület dátumformátumában');
  assert.deepEqual(ures.stats, {
    workouts: 0, streak: 0, prs: 0, workSets: 0,
    lastWorkoutDate: null, firstWorkoutDate: null, weight: null,
  }, 'új fióknál minden összesítő nulla, a dátumok és a testsúly null');

  /* Egy edzés: bemelegítő + két munkasorozat, amelyek közül az egyik NINCS
     bepipálva. A workSets tehát 1 — sem a bemelegítés, sem a nem teljesített
     szett nem számít bele. */
  await request('POST', '/api/workouts', {
    cookie: ciliCookie,
    body: {
      name: 'Cili első edzése',
      exercises: [{
        name: 'Guggolás',
        sets: [
          { reps: '10', weight: '40', rpe: '5', type: 'warmup', done: true },
          { reps: '5', weight: '80', rpe: '8', type: 'work', done: true },
          { reps: '5', weight: '85', rpe: '9', type: 'work', done: false },
        ],
      }],
    },
  });

  const egyEdzes = (await request('GET', '/api/profile', { cookie: ciliCookie })).json.stats;
  assert.equal(egyEdzes.workouts, 1);
  assert.equal(egyEdzes.streak, 1, 'a mai edzés egy napos sorozat');
  assert.equal(egyEdzes.prs, 1, 'az első teljesítmény rekord');
  assert.equal(egyEdzes.workSets, 1, 'csak a TELJESÍTETT munkasorozat számít');
  assert.equal(egyEdzes.firstWorkoutDate, today());
  assert.equal(egyEdzes.lastWorkoutDate, today());
  assert.equal(egyEdzes.weight, null, 'testsúly-mérés nélkül nincs testsúly-blokk');

  // Testsúly a napi check-inből. Egyetlen bejegyzésnél nincs mihez mérni,
  // ezért a delta null — nem 0, ami „nem változott"-at állítana.
  await request('PUT', '/api/checkin', {
    cookie: ciliCookie, body: { sleepHours: 7, energy: 4, weightKg: 62.5 },
  });
  const sullyal = (await request('GET', '/api/profile', { cookie: ciliCookie })).json.stats;
  assert.deepEqual(sullyal.weight, { current: 62.5, delta: null, entries: 1 });

  // Ugyanaz a gyakorlat MÁSODSZOR, nagyobb súllyal: új PR, de a PR-t elért
  // gyakorlatok száma 1 marad — gyakorlatot számolunk, nem rekord-eseményt.
  await request('POST', '/api/workouts', {
    cookie: ciliCookie,
    body: { name: 'Cili második edzése', exercises: [gyakorlat('Guggolás', 90)] },
  });
  const ketEdzes = (await request('GET', '/api/profile', { cookie: ciliCookie })).json.stats;
  assert.equal(ketEdzes.workouts, 2);
  assert.equal(ketEdzes.prs, 1, 'ugyanaz a gyakorlat kétszer is csak egy tétel');
  assert.equal(ketEdzes.workSets, 2);
});

/* ======================================================================
   7. Összeállított válaszok — dashboard, chartok, katalógus
   ====================================================================== */

test('a dashboard minden számolt mezőt kitölt', async () => {
  const db = (await request('GET', '/api/dashboard', { cookie: annaCookie })).json;
  assert.equal(typeof db.streak, 'number');
  assert.equal(typeof db.readiness, 'number');
  assert.ok(db.readiness >= 0 && db.readiness <= 100, 'a készenlét 0–100 közötti');
  assert.equal(typeof db.readinessConfidence, 'string');
  assert.equal(db.checkinPresent, true, 'Anna ma töltött check-int');
  assert.equal(typeof db.dailyStats.calories, 'number');
  assert.equal(Number.isInteger(db.dailyStats.calories), true, 'a kalória egész szám');
});

test('a dashboard NEM ragadja meg a korábbi kérés értékeit', async () => {
  /* A végpont a `dashboard` kollekcióra írja rá a felhasználó-specifikus
     mezőket. Ha ez az objektum cache-elt (megosztott) lenne, a két fiók
     egymás készenlétét és sorozatát látná. */
  const anna = (await request('GET', '/api/dashboard', { cookie: annaCookie })).json;
  const bela = (await request('GET', '/api/dashboard', { cookie: belaCookie })).json;
  assert.equal(anna.checkinPresent, true);
  assert.equal(bela.checkinPresent, true);
  // Béla edzett, Anna alig — a sorozatuk nem lehet ugyanaz a véletlen folytán sem
  assert.equal(typeof anna.streak, 'number');
  assert.equal(typeof bela.streak, 'number');

  // Anna újra lekérve ugyanazt kapja, mint először (nem Béla adata ragadt bele)
  const annaUjra = (await request('GET', '/api/dashboard', { cookie: annaCookie })).json;
  assert.equal(annaUjra.streak, anna.streak);
  assert.equal(annaUjra.readiness, anna.readiness);
});

test('a heti volumen-diagram a saját teljesített szettjeiből épül', async () => {
  const charts = (await request('GET', '/api/charts', { cookie: belaCookie })).json;
  assert.equal(charts.volumeThisWeek.heights.length, 7);
  assert.equal(charts.volumeLastWeek.heights.length, 7);
  assert.deepEqual(charts.volumeThisWeek.axis, charts.volumeLastWeek.axis,
    'a két hét közös skálán van, hogy a váltógombbal összevethető legyen');
  assert.ok(charts.volumeThisWeek.total > 0, 'Béla ezen a héten mentett edzést');

  const annaCharts = (await request('GET', '/api/charts', { cookie: annaCookie })).json;
  assert.notEqual(annaCharts.volumeThisWeek.total, charts.volumeThisWeek.total,
    'a két fiók volumene külön számolódik');
});

test('a gyakorlat-katalógus nem küldi ki a belső mezőket', async () => {
  const katalogus = (await request('GET', '/api/exercise-catalog', { cookie: annaCookie })).json;
  assert.ok(katalogus.length > 0);
  for (const elem of katalogus) {
    assert.ok(!('load' in elem), 'a load szerver-belső (a készenlét-motoré)');
    assert.ok(!('loadSource' in elem), 'a loadSource szerver-belső');
    assert.ok(!('extId' in elem), 'az extId szerver-belső');
  }
  assert.ok(katalogus[0].name, 'a névnek viszont ki kell mennie');
});

test('a készenléti riport szerkezete teljes', async () => {
  const r = (await request('GET', '/api/readiness', { cookie: annaCookie })).json;
  assert.ok(r.overall >= 0 && r.overall <= 100, 'az összesített készenlét 0–100 közötti');
  assert.equal(r.date, today());
  assert.ok(r.components, 'komponens-bontás');
  assert.ok(Array.isArray(r.muscles), 'izomcsoportonkénti regeneráció');
  assert.ok(Array.isArray(r.exercises), 'gyakorlat-ajánlások');
  assert.equal(r.checkin.present, true, 'Anna ma töltött check-int');
  assert.ok(Array.isArray(r.checkin.missing), 'a hiányzó mezők listája');
  assert.equal(typeof r.confidence, 'string');
  assert.equal(typeof r.cns.readiness, 'number');
  // Az áttekintő „Regeneráció" kártyájának három sora — a dashboard ezt veszi át.
  for (const kulcs of ['sleep', 'fatigue', 'soreness']) {
    assert.equal(typeof r.recovery[kulcs], 'string', `a recovery.${kulcs} szöveges sor`);
  }
});

/* ======================================================================
   8. Statikus frontend
   ====================================================================== */

test('a frontend bejelentkezés nélkül is kiszolgálódik (a belépő képernyő kell)', async () => {
  const res = await fetch(`${baseUrl}/index.html`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('<!DOCTYPE html>') || html.includes('<!doctype html>'));
});

test('a szerver-belső fájlok nem érhetők el HTTP-n', async () => {
  for (const utvonal of ['/server/db.js', '/server/fittrack.db', '/package.json', '/../server/db.js']) {
    const res = await fetch(`${baseUrl}${utvonal}`, { redirect: 'manual' });
    assert.notEqual(res.status, 200, `${utvonal} nem lehet elérhető`);
  }
});
