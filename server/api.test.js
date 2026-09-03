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
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-api-'));

/* ---- Az Open Food Facts helyi utánzata ----
   A /api/foods/barcode végpont kifelé hívna. A tesztcsomag viszont nem
   függhet az internettől és egy külső szolgáltatás rendelkezésre állásától:
   egy elszálló CI-futás semmit nem mondana a mi kódunkról. Ezért a szervert a
   FITTRACK_OFF_URL-lel erre a stubra irányítjuk, és mi döntjük el, mit lát —
   terméket, „nem ismerem"-et vagy hibát.

   Az /__hits számláló azért kell, hogy a gyorsítótár BIZONYÍTHATÓ legyen: a
   „cache-ből jött" állítás csak akkor ér valamit, ha közben tényleg nem ment
   ki hálózati kérés. */
const OFF_KNOWN = '5998200310010';    // ismert termék
const OFF_UNKNOWN = '5901234123457';  // az OFF status:0-t ad rá
const OFF_BROKEN = '4006381333931';   // a stub 500-zal esik el

let offHits = 0;
const offStub = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/__hits') {
    res.end(JSON.stringify({ hits: offHits }));
    return;
  }
  offHits += 1;
  const code = req.url.match(/\/api\/v2\/product\/(\d+)\.json/)?.[1];
  if (code === OFF_KNOWN) {
    res.end(JSON.stringify({
      status: 1,
      product: {
        product_name: 'Teszt joghurt',
        brands: 'Tesztmárka',
        quantity: '150 g',
        serving_quantity: 30,
        serving_size: '30 g',
        nutriments: {
          'energy-kcal_100g': 61, proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 0.5,
        },
      },
    }));
    return;
  }
  if (code === OFF_UNKNOWN) {
    res.end(JSON.stringify({ status: 0 }));
    return;
  }
  res.statusCode = 500;
  res.end('{}');
});
await new Promise((resolve) => offStub.listen(0, '127.0.0.1', resolve));
const OFF_URL = `http://127.0.0.1:${offStub.address().port}`;

/** A stub eddigi hívásszáma — a cache-tesztek ezt hasonlítják össze. */
const offHitCount = async () => (await (await fetch(`${OFF_URL}/__hits`)).json()).hits;

/* ---- A szerver elindítása és a port kiolvasása ---- */

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'server.js')],
  {
    env: {
      ...process.env,
      FITTRACK_DB: path.join(workDir, 'api.db'),
      PORT: '0',
      FITTRACK_OFF_URL: OFF_URL,
    },
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
  // Az OFF-stub is a teszt eseményhurkát tartaná életben.
  await new Promise((resolve) => offStub.close(resolve));
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

/** Az első BEÉPÍTETT étel a listából. A /api/foods mostantól a hívó saját
    ételeit teszi előre, ezért a json[0] nem feltétlenül seed-elem — ez a segéd
    teszi a régi eseteket függetlenné attól, hogy előtte felvittek-e sajátot. */
const seedFood = (foods) => foods.find((food) => !food.custom);

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
    ['GET', '/api/goals'], ['GET', '/api/coach'], ['GET', '/api/messages/1'],
    ['POST', '/api/weight-log'], ['POST', '/api/nutrition/log'], ['POST', '/api/workouts'],
    ['POST', '/api/plans'], ['PUT', '/api/plans/1'], ['PUT', '/api/workout-draft'],
    ['PUT', '/api/checkin'], ['DELETE', '/api/workout-draft'], ['DELETE', '/api/nutrition/log/1'],
    ['PUT', '/api/workouts/1'], ['DELETE', '/api/workouts/1'],
    ['GET', `/api/foods/barcode/${OFF_KNOWN}`], ['POST', '/api/foods/custom'],
    ['DELETE', '/api/foods/custom/1'],
    ['GET', '/api/comments'], ['GET', '/api/comments/by-target'],
    ['POST', '/api/comments'], ['DELETE', '/api/comments/1'],
    ['GET', '/api/athletes/1/comments'], ['POST', '/api/athletes/1/comments'],
    ['PUT', '/api/workouts/1/feedback'],
    ['GET', '/api/nutrition/goal'], ['PUT', '/api/nutrition/goal'],
    ['DELETE', '/api/nutrition/goal'], ['PUT', '/api/athletes/1/nutrition-goal'],
    ['GET', '/api/readiness/advice'], ['POST', '/api/readiness/advice/apply'],
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
    body: { name: seedFood((await request('GET', '/api/foods', { cookie: annaCookie })).json).name, grams: 100 },
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

  const etel = seedFood((await request('GET', '/api/foods', { cookie: annaCookie })).json).name;
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
  const etel = seedFood(foods);
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

/* ---- Onboarding: a friss fiókot a felület a check-in varázslóra tereli ----
   A jelző azért „soha nem volt check-inje" és nem „most regisztrált", mert
   túl kell élnie az oldal-újratöltést: a /me-nek is ugyanazt kell mondania,
   amit a regisztráció válasza mondott. */

let onbCookie = '';

test('a friss fiók onboarding jelzővel jön vissza — regisztrációkor és a /me-n is', async () => {
  const reg = await request('POST', '/api/auth/register', {
    body: { username: 'onboard', displayName: 'Onboard Ottó', password: 'jelszo789' },
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.json.onboarding, true, 'új fiók: még egyetlen check-in sincs');

  onbCookie = cookieFrom(reg);
  const me = await request('GET', '/api/auth/me', { cookie: onbCookie });
  assert.equal(me.json.onboarding, true, 'újratöltés után is a varázsló jön');
});

test('az első check-in lekapcsolja az onboarding jelzőt, és készenlétet ad', async () => {
  /* Ez a funkció lényege: a friss fiók készenléte NULL, amíg nincs adat —
     a varázsló négy kötelező mezője után viszont már valódi pontszám van. */
  const elotte = await request('GET', '/api/readiness', { cookie: onbCookie });
  assert.equal(elotte.json.overall, null, 'adat nélkül nincs pontszám (nem 0 és nem 100)');

  const mentes = await request('PUT', '/api/checkin', {
    cookie: onbCookie,
    body: { sleepHours: 7, sleepQuality: 4, energy: 4, stress: 2 },
  });
  assert.equal(mentes.status, 200);
  assert.notEqual(mentes.json.readiness.overall, null, 'a varázsló mezőiből már számol a motor');

  const me = await request('GET', '/api/auth/me', { cookie: onbCookie });
  assert.equal(me.json.onboarding, false, 'az app kinyílik — nincs több terelés');
});

test('a belépés is hozza az onboarding jelzőt, a már check-inelt fióknál hamisat', async () => {
  const res = await request('POST', '/api/auth/login', {
    body: { username: 'onboard', password: 'jelszo789' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.onboarding, false);
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
  const etel = seedFood((await request('GET', '/api/foods', { cookie: belaCookie })).json);

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

test('a heti volumen-diagram a saját MUNKASOROZATAIBÓL épül (bemelegítő nélkül)', async () => {
  const charts = (await request('GET', '/api/charts', { cookie: belaCookie })).json;
  assert.equal(charts.volumeThisWeek.heights.length, 7);
  assert.equal(charts.volumeLastWeek.heights.length, 7);
  assert.deepEqual(charts.volumeThisWeek.axis, charts.volumeLastWeek.axis,
    'a két hét közös skálán van, hogy a váltógombbal összevethető legyen');
  assert.ok(charts.volumeThisWeek.total > 0, 'Béla ezen a héten mentett edzést');

  const annaCharts = (await request('GET', '/api/charts', { cookie: annaCookie })).json;
  assert.notEqual(annaCharts.volumeThisWeek.total, charts.volumeThisWeek.total,
    'a két fiók volumene külön számolódik');

  /* A bemelegítő szett NEM volumen: a Recovery Engine és a profiloldal is így
     számol, a diagram korábban viszont minden bepipált sort beleszámolt. Egy
     csak bemelegítőből álló edzés tehát nem mozdíthatja a számot. */
  const elotte = (await request('GET', '/api/charts', { cookie: annaCookie })).json.volumeThisWeek.total;
  const bemelegites = await request('POST', '/api/workouts', {
    cookie: annaCookie,
    body: {
      name: 'Csak bemelegítés',
      exercises: [{
        name: 'Guggolás',
        sets: [
          { reps: '10', weight: '40', rpe: '5', type: 'warmup', done: true },
          { reps: '10', weight: '40', rpe: '5', type: 'warmup', done: true },
        ],
      }],
    },
  });
  assert.equal(bemelegites.status, 201);
  const utana = (await request('GET', '/api/charts', { cookie: annaCookie })).json.volumeThisWeek.total;
  assert.equal(utana, elotte, 'a két bemelegítő szett nem növelte a volument');
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
  for (const utvonal of [
    '/server/db.js', '/server/fittrack.db', '/package.json', '/../server/db.js',
    // A /vendor/zxing mount a node_modules EGY mappáját teszi ki — a többinek
    // továbbra sem szabad kiszivárognia rajta keresztül.
    '/vendor/zxing/../../express/package.json', '/vendor/zxing/../../../package.json',
  ]) {
    const res = await fetch(`${baseUrl}${utvonal}`, { redirect: 'manual' });
    assert.notEqual(res.status, 200, `${utvonal} nem lehet elérhető`);
  }
});

/* ======================================================================
   9. Mentett edzés javítása és törlése
   ----------------------------------------------------------------------
   A napló sokáig csak bővülni tudott. A javítás és a törlés két dolgot
   követel meg a szervertől, és mindkettő csendben romlana el: az edzés a
   SAJÁT napján maradjon (különben elcsúszik a sorozat és a heti volumen),
   és a másik fiók sorához ne lehessen hozzáférni id-re hivatkozva sem.
   ====================================================================== */

test('a javítás a meglévő sort írja felül, az EREDETI dátumán', async () => {
  const mentes = await request('POST', '/api/workouts', {
    cookie: annaCookie,
    body: { name: 'Elgépelt nap', exercises: [gyakorlat('Bicepsz curl', 180, 5)] },
  });
  assert.equal(mentes.status, 201);
  const eredetiDatum = mentes.json.date;

  const javitas = await request('PUT', `/api/workouts/${mentes.json.id}`, {
    cookie: annaCookie,
    body: { name: 'Javított nap', exercises: [gyakorlat('Bicepsz curl', 18, 5)] },
  });
  assert.equal(javitas.status, 200);
  assert.equal(javitas.json.id, mentes.json.id, 'ugyanaz a sor, nem új');
  assert.equal(javitas.json.date, eredetiDatum, 'a javítás nem helyezi át a naplóban');
  assert.equal(javitas.json.name, 'Javított nap');

  // A lista sem duplázódott: egy sor, a javított tartalommal.
  const lista = (await request('GET', '/api/workouts', { cookie: annaCookie })).json;
  const talalatok = lista.filter((w) => w.id === mentes.json.id);
  assert.equal(talalatok.length, 1);
  assert.equal(talalatok[0].exercises[0].sets[0].weight, '18');

  // Az elgépelt 180 kg-os csúcs sem maradhat bent.
  const maxes = (await request('GET', '/api/exercise-maxes', { cookie: annaCookie })).json;
  assert.equal(maxes['Bicepsz curl'], Math.round(18 * (1 + 5 / 30) * 10) / 10,
    'a javítás után a csúcs a javított értékből jön');
});

test('a törlés kiveszi az edzést, és 404-et ad másodszor', async () => {
  const mentes = await request('POST', '/api/workouts', {
    cookie: annaCookie,
    body: { name: 'Törlendő', exercises: [gyakorlat('Lábtolás', 200, 8)] },
  });
  const id = mentes.json.id;

  const torles = await request('DELETE', `/api/workouts/${id}`, { cookie: annaCookie });
  assert.equal(torles.status, 204);
  assert.equal(torles.text, '', 'a törlés üres választ ad');

  const lista = (await request('GET', '/api/workouts', { cookie: annaCookie })).json;
  assert.equal(lista.some((w) => w.id === id), false, 'a törölt edzés eltűnt a naplóból');

  const ujra = await request('DELETE', `/api/workouts/${id}`, { cookie: annaCookie });
  assert.equal(ujra.status, 404);
  assert.ok(ujra.json.error, 'a 404 beszédes üzenetet ad, nem üres törzset');

  const maxes = (await request('GET', '/api/exercise-maxes', { cookie: annaCookie })).json;
  assert.equal(maxes['Lábtolás'], undefined, 'a törölt edzés csúcsa sem maradt vissza');
});

test('MÁS fiók edzését sem javítani, sem törölni nem lehet', async () => {
  const belaE = await request('POST', '/api/workouts', {
    cookie: belaCookie,
    body: { name: 'Béla sajátja', exercises: [gyakorlat('Evezés', 70, 8)] },
  });
  const id = belaE.json.id;

  const idegenJavitas = await request('PUT', `/api/workouts/${id}`, {
    cookie: annaCookie,
    body: { name: 'Anna átírta', exercises: [gyakorlat('Evezés', 5, 5)] },
  });
  assert.equal(idegenJavitas.status, 404, 'idegen sor NEM LÉTEZŐKÉNT viselkedik');

  const idegenTorles = await request('DELETE', `/api/workouts/${id}`, { cookie: annaCookie });
  assert.equal(idegenTorles.status, 404);

  // És tényleg érintetlen maradt.
  const belaLista = (await request('GET', '/api/workouts', { cookie: belaCookie })).json;
  const belaSor = belaLista.find((w) => w.id === id);
  assert.equal(belaSor.name, 'Béla sajátja');
  assert.equal(belaSor.exercises[0].sets[0].weight, '70');
});

test('a javítás ugyanazt a validálást kéri, mint a mentés', async () => {
  const mentes = await request('POST', '/api/workouts', {
    cookie: annaCookie,
    body: { name: 'Validáláshoz', exercises: [gyakorlat('Vádliemelés', 50, 12)] },
  });
  const id = mentes.json.id;

  const rosszTorzsek = [
    [{ name: '', exercises: [gyakorlat('Vádliemelés', 50)] }, 'üres név'],
    [{ name: 'x'.repeat(61), exercises: [gyakorlat('Vádliemelés', 50)] }, 'túl hosszú név'],
    [{ name: 'Jó név', exercises: [] }, 'gyakorlat nélkül'],
    [{ name: 'Jó név', exercises: [{ name: 'Nincs szettje', sets: [] }] }, 'szett nélküli gyakorlat'],
  ];
  for (const [body, eset] of rosszTorzsek) {
    const res = await request('PUT', `/api/workouts/${id}`, { cookie: annaCookie, body });
    assert.equal(res.status, 400, `${eset}: 400-at kell adnia`);
  }

  for (const rosszId of ['abc', '0', '-3']) {
    const res = await request('PUT', `/api/workouts/${rosszId}`, {
      cookie: annaCookie,
      body: { name: 'Jó név', exercises: [gyakorlat('Vádliemelés', 50)] },
    });
    assert.equal(res.status, 400, `${rosszId}: érvénytelen azonosító`);
    assert.equal((await request('DELETE', `/api/workouts/${rosszId}`, { cookie: annaCookie })).status, 400);
  }
});

test('a piszkozat megjegyzi a visszanyitott edzést, a törlés pedig elengedi', async () => {
  const mentes = await request('POST', '/api/workouts', {
    cookie: belaCookie,
    body: { name: 'Visszanyitandó', exercises: [gyakorlat('Húzódzkodás', 10, 8)] },
  });
  const id = mentes.json.id;

  await request('PUT', '/api/workout-draft', {
    cookie: belaCookie,
    body: { name: 'Visszanyitandó', exercises: [gyakorlat('Húzódzkodás', 12, 8)], workoutId: id },
  });

  const piszkozat = (await request('GET', '/api/workout-draft', { cookie: belaCookie })).json;
  assert.equal(piszkozat.workoutId, id, 'a javítás ténye újratöltés után is megmarad');

  const sablon = (await request('GET', '/api/workout-template', { cookie: belaCookie })).json;
  assert.equal(sablon.workoutId, id, 'az induló tartalom is viszi — a felület ebből tudja');

  /* Ha az edzést közben törlik, a piszkozat egy megszűnt sorra hivatkozna, és
     a befejezés 404-be futna. A tartalma marad, a hivatkozás nem. */
  assert.equal((await request('DELETE', `/api/workouts/${id}`, { cookie: belaCookie })).status, 204);
  const utana = (await request('GET', '/api/workout-draft', { cookie: belaCookie })).json;
  assert.equal(utana.workoutId, null, 'a törlés elengedte a hivatkozást');
  assert.equal(utana.exercises.length, 1, 'a piszkozat tartalma viszont megmaradt');
});

/* ======================================================================
   10. Saját ételek + vonalkód

   Ezek a tesztek a fájl VÉGÉN állnak, mert saját ételeket hoznak létre, ami
   megváltoztatja a /api/foods lista elejét. A korábbi esetek a seedFood()
   segéddel amúgy is függetlenek ettől, de a sorrend így is szándékos.
   ====================================================================== */

test('saját étel felvitele: a kalória a makrókból számolódik', async () => {
  const res = await request('POST', '/api/foods/custom', {
    cookie: annaCookie,
    body: { name: 'Anna csirkéje', protein: 23, carbs: 0, fat: 1.8 },
  });
  assert.equal(res.status, 201, res.text);
  // Atwater: 4·23 + 4·0 + 9·1,8 = 92 + 16,2 = 108,2 → 108
  assert.equal(res.json.kcal, 108, 'a szerver számolja a kalóriát, nem a kliens');
  assert.equal(res.json.custom, true, 'a felület ebből tesz „saját" jelvényt');
  assert.equal(res.json.per, '100 g', 'a kártya ezt a címkét írja ki');
  assert.equal(res.json.kcalAuto, true);
});

test('a kliens által küldött kalória NEM írja felül a számítottat auto módban', async () => {
  /* A kcalMode nélkül a szerver akkor is a képletet használja, ha a törzsben
     ott van egy kcal mező — különben a napi bevitelt a kliensből lehetne hazudni. */
  const res = await request('POST', '/api/foods/custom', {
    cookie: annaCookie,
    body: { name: 'Hazug kcal', protein: 10, carbs: 10, fat: 0, kcal: 5 },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.kcal, 80, '4·10 + 4·10 = 80');
});

test('a kézi kalória sávon belül elfogadott, azon kívül elutasított', async () => {
  // A csomagoláson lévő érték a rost és a poliolok miatt jogosan eltérhet.
  const jo = await request('POST', '/api/foods/custom', {
    cookie: annaCookie,
    body: { name: 'Rostos keksz', protein: 5, carbs: 60, fat: 10, kcal: 300, kcalMode: 'manual' },
  });
  // képlet: 4·5 + 4·60 + 9·10 = 350; tűrés max(50, 105) = 105 → a 300 belefér
  assert.equal(jo.status, 201, jo.text);
  assert.equal(jo.json.kcal, 300);
  assert.equal(jo.json.kcalAuto, false);

  const rossz = await request('POST', '/api/foods/custom', {
    cookie: annaCookie,
    body: { name: 'Elgépelt kcal', protein: 0, carbs: 0, fat: 0, kcal: 800, kcalMode: 'manual' },
  });
  assert.equal(rossz.status, 400);
  assert.match(rossz.json.error, /0 kcal/, 'az üzenet megmondja, mit ad ki a képlet');
});

test('a saját étel mezői validáltak', async () => {
  const rosszak = [
    [{ name: 'a', protein: 1, carbs: 1, fat: 1 }, 'túl rövid név'],
    [{ name: 'x'.repeat(61), protein: 1, carbs: 1, fat: 1 }, 'túl hosszú név'],
    [{ name: '   ', protein: 1, carbs: 1, fat: 1 }, 'csak szóköz'],
    [{ name: 'Negatív', protein: -1, carbs: 1, fat: 1 }, 'negatív makró'],
    [{ name: 'Túl sok', protein: 101, carbs: 0, fat: 0 }, '100 g feletti makró'],
    [{ name: 'Szöveg', protein: 'sok', carbs: 1, fat: 1 }, 'nem szám'],
    [{ name: 'Hiányzó', carbs: 1, fat: 1 }, 'hiányzó fehérje'],
    [{ name: 'Összeg', protein: 60, carbs: 60, fat: 10 }, 'a makrók összege > 100 g'],
    [{ name: 'Kategória', group: 'Nincs ilyen', protein: 1, carbs: 1, fat: 1 }, 'ismeretlen kategória'],
    [{ name: 'Kód', protein: 1, carbs: 1, fat: 1, barcode: '123' }, 'túl rövid vonalkód'],
    [{ name: 'Kód2', protein: 1, carbs: 1, fat: 1, barcode: '5998200310011' }, 'rossz ellenőrzőszám'],
  ];
  for (const [body, eset] of rosszak) {
    const res = await request('POST', '/api/foods/custom', { cookie: annaCookie, body });
    assert.equal(res.status, 400, `${eset} → 400 helyett ${res.status}`);
    assert.ok(res.json.error, `${eset}: magyarázó üzenet kell`);
  }
});

test('ml egységgel a tápérték 100 ml-re vonatkozik', async () => {
  const res = await request('POST', '/api/foods/custom', {
    cookie: annaCookie,
    body: { name: 'Anna narancsleve', unit: 'ml', protein: 0.7, carbs: 10, fat: 0.2 },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.unit, 'ml');
  assert.equal(res.json.per, '100 ml');
});

test('a duplikált név 409 — kis/nagybetűtől függetlenül', async () => {
  const res = await request('POST', '/api/foods/custom', {
    cookie: annaCookie,
    body: { name: 'anna CSIRKÉJE', protein: 1, carbs: 1, fat: 1 },
  });
  assert.equal(res.status, 409, res.text);
});

test('a beépített katalógus nevét nem lehet elvenni', async () => {
  /* A naplózás NÉVVEL hivatkozik az ételre; két azonos név eltérő tápértékkel
     megfejthetetlen lenne. */
  const seed = seedFood((await request('GET', '/api/foods', { cookie: annaCookie })).json);
  const res = await request('POST', '/api/foods/custom', {
    cookie: annaCookie,
    body: { name: seed.name, protein: 1, carbs: 1, fat: 1 },
  });
  assert.equal(res.status, 409, res.text);
  assert.match(res.json.error, /alap étel-listában/);
});

test('a saját ételek fiókonként elkülönülnek', async () => {
  const annaFoods = (await request('GET', '/api/foods', { cookie: annaCookie })).json;
  const belaFoods = (await request('GET', '/api/foods', { cookie: belaCookie })).json;

  assert.ok(annaFoods.some((f) => f.name === 'Anna csirkéje'), 'Anna látja a sajátját');
  assert.ok(!belaFoods.some((f) => f.custom), 'Béla egyetlen saját ételt sem lát');
  // A beépített katalógus viszont mindkettejüknél megvan.
  assert.ok(seedFood(annaFoods) && seedFood(belaFoods), 'a seed-katalógus közös');
  assert.equal(annaFoods[0].custom, true, 'a saját ételek a lista elején állnak');
});

test('ugyanaz a név két fióknak felvihető', async () => {
  const res = await request('POST', '/api/foods/custom', {
    cookie: belaCookie,
    body: { name: 'Anna csirkéje', protein: 30, carbs: 0, fat: 5 },
  });
  assert.equal(res.status, 201, 'a UNIQUE (user_id, name) fiókonként párosít');
  assert.equal(res.json.kcal, 165, '4·30 + 9·5 = 165 — BÉLA értékeivel');
});

test('MÁS fiók saját ételét nem lehet naplózni és törölni', async () => {
  const annaEtel = (await request('GET', '/api/foods', { cookie: annaCookie })).json
    .find((f) => f.name === 'Anna narancsleve');
  assert.ok(annaEtel, 'előfeltétel: Annának van narancsleve');

  const naplozas = await request('POST', '/api/nutrition/log', {
    cookie: belaCookie,
    body: { name: 'Anna narancsleve', grams: 100 },
  });
  assert.equal(naplozas.status, 400, 'Bélának ez ismeretlen étel');

  const torles = await request('DELETE', `/api/foods/custom/${annaEtel.id}`, { cookie: belaCookie });
  assert.equal(torles.status, 404);

  const meg = (await request('GET', '/api/foods', { cookie: annaCookie })).json;
  assert.ok(meg.some((f) => f.name === 'Anna narancsleve'), 'Anna étele érintetlen');
});

test('saját étel naplózása az adagra átszámolva megy be', async () => {
  const elotte = (await request('GET', '/api/nutrition', { cookie: annaCookie })).json.intake;
  const res = await request('POST', '/api/nutrition/log', {
    cookie: annaCookie,
    body: { name: 'Anna csirkéje', grams: 250 },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.entry.kcal, 270, '108 kcal / 100 g × 2,5 = 270');
  assert.equal(res.json.entry.protein, 57.5, '23 g × 2,5');
  assert.equal(res.json.totals.intake, elotte + 270);
});

test('a saját étel törlése NEM írja át a már lenaplózott bejegyzéseket', async () => {
  /* A nutrition_log a nevet és a kiszámolt makrókat MÁSOLATBAN tárolja, ezért
     a korábbi napok összesítői (és a rájuk épülő készenlét-számítás) nem
     változnak meg visszamenőleg. A törlés megerősítő szövege ezt ígéri. */
  const etel = (await request('GET', '/api/foods', { cookie: annaCookie })).json
    .find((f) => f.name === 'Anna csirkéje');
  const elotte = (await request('GET', '/api/nutrition', { cookie: annaCookie })).json;
  const naploElotte = (await request('GET', '/api/nutrition/log', { cookie: annaCookie })).json;

  const torles = await request('DELETE', `/api/foods/custom/${etel.id}`, { cookie: annaCookie });
  assert.equal(torles.status, 204);

  const utana = (await request('GET', '/api/nutrition', { cookie: annaCookie })).json;
  const naploUtana = (await request('GET', '/api/nutrition/log', { cookie: annaCookie })).json;
  assert.equal(utana.intake, elotte.intake, 'a napi bevitel változatlan');
  assert.equal(naploUtana.length, naploElotte.length, 'a mai napló tételei megmaradtak');

  const listaUtana = (await request('GET', '/api/foods', { cookie: annaCookie })).json;
  assert.ok(!listaUtana.some((f) => f.name === 'Anna csirkéje' && f.custom),
    'a lista viszont már nem kínálja fel');
});

test('a saját étel-azonosító validált', async () => {
  for (const id of ['0', '-1', 'abc']) {
    const res = await request('DELETE', `/api/foods/custom/${id}`, { cookie: annaCookie });
    assert.equal(res.status, 400, `id=${id}`);
  }
  const nincs = await request('DELETE', '/api/foods/custom/999999', { cookie: annaCookie });
  assert.equal(nincs.status, 404);
});

test('az export tartalmazza a saját ételeket, fiókonként', async () => {
  const anna = (await request('GET', '/api/export', { cookie: annaCookie })).json;
  const bela = (await request('GET', '/api/export', { cookie: belaCookie })).json;
  assert.ok(Array.isArray(anna.customFoods) && anna.customFoods.length > 0);
  assert.equal(bela.customFoods.length, 1, 'Bélának egyetlen saját étele van');
  assert.ok(!bela.customFoods.some((f) => f.name === 'Anna narancsleve'));
});

/* ---- Vonalkód ---- */

test('a vonalkód feloldása az Open Food Facts-ből jön, majd a cache-ből', async () => {
  const elso = await request('GET', `/api/foods/barcode/${OFF_KNOWN}`, { cookie: annaCookie });
  assert.equal(elso.status, 200, elso.text);
  assert.equal(elso.json.source, 'openfoodfacts');
  assert.equal(elso.json.product.name, 'Teszt joghurt (Tesztmárka)', 'a márka a névbe kerül');
  assert.equal(elso.json.product.protein, 10);
  assert.equal(elso.json.product.kcal, 61);
  assert.deepEqual(elso.json.product.portions, [['1 adag · 30 g', 30]]);

  const hitsElotte = await offHitCount();
  const masodik = await request('GET', `/api/foods/barcode/${OFF_KNOWN}`, { cookie: annaCookie });
  assert.equal(masodik.json.source, 'cache');
  assert.deepEqual(masodik.json.product, elso.json.product);
  assert.equal(await offHitCount(), hitsElotte, 'a cache-találat NEM hívta az OFF-ot');
});

test('a cache fiókok között közös (a vonalkód nem személyes adat)', async () => {
  const hitsElotte = await offHitCount();
  const res = await request('GET', `/api/foods/barcode/${OFF_KNOWN}`, { cookie: belaCookie });
  assert.equal(res.json.source, 'cache');
  assert.equal(await offHitCount(), hitsElotte);
});

test('az ismeretlen vonalkód 404, és a negatív találat is cache-elődik', async () => {
  const elso = await request('GET', `/api/foods/barcode/${OFF_UNKNOWN}`, { cookie: annaCookie });
  assert.equal(elso.status, 404);
  assert.match(elso.json.error, /vidd fel kézzel/);

  const hitsElotte = await offHitCount();
  const masodik = await request('GET', `/api/foods/barcode/${OFF_UNKNOWN}`, { cookie: annaCookie });
  assert.equal(masodik.status, 404);
  assert.equal(await offHitCount(), hitsElotte, 'nem kérdezzük meg újra ugyanazt a nem létező kódot');
});

test('az OFF hibája 502, és NEM cache-elődik', async () => {
  const elso = await request('GET', `/api/foods/barcode/${OFF_BROKEN}`, { cookie: annaCookie });
  assert.equal(elso.status, 502, elso.text);

  /* Egy pillanatnyi hálózati hiba nem ragadhat be a gyorsítótárba: a következő
     kérésnek újra meg KELL próbálnia. */
  const hitsElotte = await offHitCount();
  await request('GET', `/api/foods/barcode/${OFF_BROKEN}`, { cookie: annaCookie });
  assert.ok(await offHitCount() > hitsElotte, 'a hiba után újrapróbálkozunk');
});

test('az érvénytelen vonalkód 400 — hálózati kör nélkül', async () => {
  const hitsElotte = await offHitCount();
  for (const kod of ['123', '5998200310011', 'abcdefghijklm']) {
    const res = await request('GET', `/api/foods/barcode/${kod}`, { cookie: annaCookie });
    assert.equal(res.status, 400, `kód: ${kod}`);
  }
  assert.equal(await offHitCount(), hitsElotte, 'az ellenőrzőszám a szerveren bukik el');
});

test('a saját, vonalkódos étel rövidre zárja a keresést', async () => {
  const felvitel = await request('POST', '/api/foods/custom', {
    cookie: annaCookie,
    body: { name: 'Anna joghurtja', protein: 10, carbs: 4, fat: 0.5, barcode: OFF_KNOWN },
  });
  assert.equal(felvitel.status, 201, felvitel.text);

  const hitsElotte = await offHitCount();
  const res = await request('GET', `/api/foods/barcode/${OFF_KNOWN}`, { cookie: annaCookie });
  assert.equal(res.json.source, 'saved', 'a saját étel megelőzi a cache-t és az OFF-ot');
  assert.equal(res.json.food.custom, true);
  assert.equal(res.json.food.name, 'Anna joghurtja');
  assert.equal(await offHitCount(), hitsElotte);

  // Béla ugyanarra a kódra továbbra is a közös cache termékét kapja.
  const belae = await request('GET', `/api/foods/barcode/${OFF_KNOWN}`, { cookie: belaCookie });
  assert.equal(belae.json.source, 'cache');
});

test('ugyanazt a vonalkódot nem lehet kétszer felvinni egy fióknak', async () => {
  const res = await request('POST', '/api/foods/custom', {
    cookie: annaCookie,
    body: { name: 'Másik joghurt', protein: 1, carbs: 1, fat: 1, barcode: OFF_KNOWN },
  });
  assert.equal(res.status, 409, res.text);
});

test('az UPC-A és az EAN-13 alak ugyanarra a termékre fut', async () => {
  /* A 12 jegyű UPC-A EAN-13-ra egészül nullákkal — így egy termék EGY
     cache-soron ül akkor is, ha a kamera UPC-A-ként olvasta le. */
  const upcA = '036000291452';
  const elso = await request('GET', `/api/foods/barcode/${upcA}`, { cookie: annaCookie });
  const hitsElotte = await offHitCount();
  const ean13 = await request('GET', `/api/foods/barcode/0${upcA}`, { cookie: annaCookie });

  assert.equal(ean13.status, elso.status, 'a két alak ugyanazt a választ adja');
  if (elso.status === 404) {
    // Negatív cache: a második kérés már nem ment ki a hálózatra.
    assert.equal(await offHitCount(), hitsElotte);
  }
});

/* ======================================================================
   Készenlét-javaslat — a rendszer KÉRDEZ, nem cselekszik
   ----------------------------------------------------------------------
   A legfontosabb állítás: az elfogadás a MAI NAPLÓT írja át, a TERVET soha.
   Ha ez elromlik, az edző azt hiszi, a kliens az ő tervét csinálta végig,
   miközben más súlyokkal edzett.
   ====================================================================== */

let advCookie = '';

test('a javaslat a fájdalmas izomcsoport gyakorlatát jelöli meg', async () => {
  const reg = await request('POST', '/api/auth/register', {
    body: { username: 'javaslat', displayName: 'Javaslat Jenő', password: 'jelszo321' },
  });
  advCookie = cookieFrom(reg);

  // 8/10 fájdalom a mellre — a motor 7-től tiltó szintnek veszi.
  await request('PUT', '/api/checkin', {
    cookie: advCookie,
    body: { sleepHours: 7, sleepQuality: 3, energy: 3, stress: 3, pain: { chest: 8 } },
  });
  await request('PUT', '/api/workout-draft', {
    cookie: advCookie,
    body: {
      name: 'Mellnap',
      exercises: [{
        name: 'Fekvenyomás',
        sets: [{ reps: '8', weight: '60', rpe: '8', type: 'work', done: false }],
      }],
    },
  });

  const res = await request('GET', '/api/readiness/advice', { cookie: advCookie });
  assert.equal(res.status, 200);
  assert.equal(res.json.items.length, 1, 'egy tétel: a fájdalmas csoport gyakorlata');
  assert.equal(res.json.items[0].action, 'skip', 'még nincs teljesített szett → kihagyás');
  assert.match(res.json.items[0].name, /Fekvenyom/);
});

test('az ELFOGADÁS a mai naplót írja át — a tervet nem', async () => {
  // Legyen terv is, ugyanazzal a gyakorlattal: annak érintetlenül kell maradnia.
  const terv = await request('POST', '/api/plans', {
    cookie: advCookie,
    body: {
      name: 'Mellnap',
      days: [],
      exercises: [{
        name: 'Fekvenyomás',
        sets: [{ reps: '8', weight: '60', rpe: '8', type: 'work', done: false }],
      }],
    },
  });
  assert.equal(terv.status, 201);

  const res = await request('POST', '/api/readiness/advice/apply', { cookie: advCookie, body: {} });
  assert.equal(res.status, 200);
  assert.equal(res.json.applied, 1);
  assert.equal(res.json.template.exercises.length, 0, 'a naplóból kikerült a gyakorlat');

  const tervek = await request('GET', '/api/plans', { cookie: advCookie });
  const mellnap = tervek.json.find((p) => p.name === 'Mellnap');
  assert.equal(mellnap.exercises.length, 1, 'a TERV érintetlen — csak a napló változott');
});

test('a terv-kártya passzívan is jelzi, mi kockázatos ma', async () => {
  const tervek = await request('GET', '/api/plans', { cookie: advCookie });
  const mellnap = tervek.json.find((p) => p.name === 'Mellnap');
  assert.ok(mellnap.safety, 'a kártya kap biztonsági jelzést');
  assert.equal(mellnap.safety.blocked.length, 1, 'a fájdalmas csoport gyakorlata tiltott');
  assert.match(mellnap.safety.blocked[0].reason, /fájdalm/i, 'és megmondja, miért');
});

test('a javaslat nem ismétli magát: amit elfogadtál, arra nem szól újra', async () => {
  const res = await request('GET', '/api/readiness/advice', { cookie: advCookie });
  assert.equal(res.json.items.length, 0,
    'a kihagyott gyakorlat már nincs a naplóban, tehát nincs is mit javasolni rá');
});
