/**
 * FitTrack Pro — az EDZŐ–KLIENS kapcsolat és a kereszt-fiók hozzáférés tesztjei
 * ----------------------------------------------------------------------------
 * Ez a fájl a projekt eddigi legkockázatosabb bővítését őrzi. Idáig egyszerű
 * volt a szabály: minden végpont a BEJELENTKEZETT fiókra szűrt, és kész
 * (server/users.test.js). Az edzőnek viszont látnia KELL a kliense adatát —
 * tehát mostantól létezik egy legális út más fiók adatához, és pontosan ez az
 * a felület, ahol egy hiba idegen adatot szivárogtat.
 *
 * Amit itt végig ugyanúgy kérdezünk: kap-e valaki hozzáférést anélkül, hogy a
 * MÁSIK FÉL azt elfogadta volna. A válasz mindenhol nem —
 *   · a meghívás önmagában nem ad hozzáférést, csak az elfogadás;
 *   · elfogadni CSAK a saját meghívást lehet;
 *   · a kapcsolat bontása azonnal elveszi a hozzáférést;
 *   · kívülálló semmit nem lát, és a hibakódból sem tudja meg, létezik-e a fiók.
 *
 * A tesztek a VALÓDI szervert indítják (saját ideiglenes adatbázissal) és
 * HTTP-n beszélnek vele: a hozzáférés-védelem a végpontokon dől el, nem az
 * adatrétegben, ezért ott is kell mérni.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-coach-'));

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'server.js')],
  {
    env: { ...process.env, FITTRACK_DB: path.join(workDir, 'coach.db'), PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

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

after(async () => {
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
  rmSync(workDir, { recursive: true, force: true });
});

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

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* nem JSON — marad null */ }
  return { status: res.status, json, setCookie: res.headers.getSetCookie() };
}

const cookieFrom = (res) => (res.setCookie[0] ?? '').split(';')[0];

const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

/** Regisztrál egy fiókot, és visszaadja a munkamenet-sütijét. */
async function signUp(username, displayName) {
  const res = await request('POST', '/api/auth/register', {
    body: { username, displayName, password: 'jelszo123' },
  });
  assert.equal(res.status, 201, `${username} regisztrációja`);
  return { cookie: cookieFrom(res), id: res.json.id };
}

/* ---- A szereplők ----
   bence  — edző, ő hívja meg a klienst
   petra  — a kliens, akinek van naplózott adata
   marton — kívülálló: semmilyen kapcsolatban nincs velük              */

const bence = await signUp('bence', 'Kovács Bence');
const petra = await signUp('petra', 'Nagy Petra');
const marton = await signUp('marton', 'Tóth Márton');

// Petrának legyen valódi adata — a kártyának ebből kell számolnia.
await request('POST', '/api/workouts', {
  cookie: petra.cookie,
  body: {
    name: 'Alsótest',
    exercises: [{
      name: 'Guggolás',
      sets: [{ reps: '5', weight: '100', rpe: '8', type: 'work', done: true }],
    }],
  },
});
await request('PUT', '/api/checkin', {
  cookie: petra.cookie,
  body: { sleepHours: 8, sleepQuality: 4, energy: 4, stress: 2 },
});

/** Az edzői panel állapota egy adott fiók szemszögéből. */
const overview = async (cookie) => (await request('GET', '/api/coach/overview', { cookie })).json;

/* ======================================================================
   1. Hozzáférés-védelem — bejelentkezés nélkül semmi
   ====================================================================== */

test('bejelentkezés nélkül az edzői végpontok is 401-et adnak', async () => {
  const endpoints = [
    ['GET', '/api/coach/overview'],
    ['POST', '/api/coach/role'],
    ['POST', '/api/coach/invites'],
    ['POST', '/api/coach/invites/1/accept'],
    ['DELETE', '/api/coach/links/1'],
    ['GET', '/api/coach/clients/1/readiness'],
    ['GET', '/api/comments/1'], ['GET', '/api/comments/1/by-target'],
    ['PUT', '/api/workouts/1/feedback'],
    ['POST', '/api/comments/1'], ['DELETE', '/api/comments/1/1'],
  ];
  for (const [method, urlPath] of endpoints) {
    const res = await request(method, urlPath, { body: method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${method} ${urlPath} védtelen!`);
  }
});

/* ======================================================================
   2. Szerepkör — a felület megnyitása még nem hozzáférés
   ====================================================================== */

test('új fiók alapból nem edző, és szerepkör nélkül nem hívhat meg senkit', async () => {
  const me = (await request('GET', '/api/user', { cookie: bence.cookie })).json;
  assert.equal(me.coachesAthletes, false, 'alapból senki nem edző');
  assert.equal(me.hasCoach, false, 'kapcsolat nélkül nincs edződ');

  const res = await request('POST', '/api/coach/invites', {
    cookie: bence.cookie,
    body: { username: 'petra' },
  });
  assert.equal(res.status, 403, 'edzői szerepkör nélkül nincs meghívás');
});

test('a szerepkör bekapcsolása ÖNMAGÁBAN nem ad hozzáférést más adatához', async () => {
  const res = await request('POST', '/api/coach/role', { cookie: bence.cookie, body: { isCoach: true } });
  assert.equal(res.status, 200);
  assert.equal(res.json.isCoach, true);

  // A szerepkör megvan, kapcsolat nincs — Petra készenléte továbbra sem látszik.
  const peek = await request('GET', `/api/coach/clients/${petra.id}/readiness`, { cookie: bence.cookie });
  assert.equal(peek.status, 404, 'kapcsolat nélkül nincs kereszt-fiók olvasás');

  const view = await overview(bence.cookie);
  assert.deepEqual(view.clients, [], 'még nincs kliense');
});

/* ======================================================================
   3. Meghívás — a hozzáférést az ELFOGADÁS adja, nem a meghívás
   ====================================================================== */

test('a meghívás validál: ismeretlen név, saját magad, ismétlés', async () => {
  const ismeretlen = await request('POST', '/api/coach/invites', {
    cookie: bence.cookie, body: { username: 'nincs-ilyen' },
  });
  assert.equal(ismeretlen.status, 404);

  const onmaga = await request('POST', '/api/coach/invites', {
    cookie: bence.cookie, body: { username: 'bence' },
  });
  assert.equal(onmaga.status, 400, 'magadat nem hívhatod meg kliensnek');

  const ures = await request('POST', '/api/coach/invites', { cookie: bence.cookie, body: {} });
  assert.equal(ures.status, 400);
});

let linkId = 0;

test('a FÜGGŐ meghívás semmilyen adatot nem tesz elérhetővé', async () => {
  const res = await request('POST', '/api/coach/invites', {
    cookie: bence.cookie, body: { username: 'petra' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.status, 'pending');
  linkId = res.json.id;

  // Ugyanaz a meghívás másodszor nem megy át.
  const ujra = await request('POST', '/api/coach/invites', {
    cookie: bence.cookie, body: { username: 'petra' },
  });
  assert.equal(ujra.status, 409);

  const bencesView = await overview(bence.cookie);
  assert.deepEqual(bencesView.clients, [], 'a függő meghívott NEM kliens');
  assert.equal(bencesView.invitesSent.length, 1, 'de a kiküldött meghívások közt ott van');

  const petrasView = await overview(petra.cookie);
  assert.equal(petrasView.invitesReceived.length, 1, 'Petra látja a beérkezett meghívást');
  assert.deepEqual(petrasView.coaches, [], 'de még nincs edzője');

  const peek = await request('GET', `/api/coach/clients/${petra.id}/readiness`, { cookie: bence.cookie });
  assert.equal(peek.status, 404, 'elfogadás előtt nincs olvasási jog');
});

test('MÁS meghívását nem lehet elfogadni — sem a kívülállónak, sem az edzőnek', async () => {
  const kivulallo = await request('POST', `/api/coach/invites/${linkId}/accept`, { cookie: marton.cookie });
  assert.equal(kivulallo.status, 404, 'Márton nem fogadhatja el Petra meghívását');

  const sajatMaga = await request('POST', `/api/coach/invites/${linkId}/accept`, { cookie: bence.cookie });
  assert.equal(sajatMaga.status, 404, 'az edző nem hagyhatja jóvá a saját meghívását');

  // A kapcsolat ettől még függőben van, hozzáférés továbbra sincs.
  const peek = await request('GET', `/api/coach/clients/${petra.id}/readiness`, { cookie: bence.cookie });
  assert.equal(peek.status, 404);
});

/* ======================================================================
   4. Elfogadás után — és CSAK az érintett feleknek
   ====================================================================== */

test('elfogadás után az edző látja a kliens VALÓDI adatát', async () => {
  const accept = await request('POST', `/api/coach/invites/${linkId}/accept`, { cookie: petra.cookie });
  assert.equal(accept.status, 200);
  assert.equal(accept.json.status, 'active');

  const view = await overview(bence.cookie);
  assert.equal(view.clients.length, 1);

  const card = view.clients[0];
  assert.equal(card.name, 'Nagy Petra');
  assert.equal(card.id, String(petra.id));
  // A kártya MINDEN mezője számolt: a mai edzés a sorozatban és az utolsó
  // edzés címkéjében is meglátszik, az aktivitás a tényleges naplóból jön.
  assert.equal(card.lastWorkout, 'ma');
  assert.equal(card.streak, 1, 'a ma naplózott edzés egynapos sorozat');
  assert.ok(card.readiness > 0, 'a készenlét a Recovery Engine-ből jön');
  assert.ok(
    card.recent.some((entry) => entry.includes('Alsótest')),
    `a naplózott edzés megjelenik az aktivitásban: ${JSON.stringify(card.recent)}`,
  );
  assert.ok(
    card.recent.some((entry) => entry.includes('Check-in')),
    'a kitöltött check-in is megjelenik',
  );

  const readiness = await request('GET', `/api/coach/clients/${petra.id}/readiness`, { cookie: bence.cookie });
  assert.equal(readiness.status, 200);
  assert.equal(readiness.json.overall, card.readiness, 'a kártya és a riport ugyanazt a számot mutatja');
});

test('a terv-követés inkább HIÁNYZIK, mint hogy hamis mulasztást mutasson', async () => {
  /* Petrának most adunk egy heti tervet. A terv MA jött létre, tehát az
     elmúlt négy hétben egyetlen olyan nap sincs, amire már be volt ütemezve —
     a naiv számítás mégis 0%-ot adna (12 „elmulasztott" alkalom), ami egy ma
     regisztrált kliensről hazugság. A helyes válasz: nincs mit mérni. */
  const plan = await request('POST', '/api/plans', {
    cookie: petra.cookie,
    body: {
      name: 'Erőnléti alapok',
      exercises: [{ name: 'Guggolás', sets: [{ reps: '5', weight: '100', rpe: '8', type: 'work' }] }],
      days: [0, 1, 2, 3, 4, 5, 6], // minden nap ütemezve — a naiv számítás így bukna a legnagyobbat
    },
  });
  assert.equal(plan.status, 201);

  const card = (await overview(bence.cookie)).clients[0];
  assert.equal(card.adherence, null, 'a terv létrejötte ELŐTTI napok nem számítanak mulasztásnak');
  assert.equal(card.plan, 'Erőnléti alapok', 'az aktív terv viszont már látszik');
});

test('a szerepkörök a kapcsolatból következnek, nem beállításból', async () => {
  const petraUser = (await request('GET', '/api/user', { cookie: petra.cookie })).json;
  assert.equal(petraUser.hasCoach, true, 'Petrának mostantól van edzője');
  assert.equal(petraUser.coachesAthletes, false, 'de ő maga nem edző');

  const benceUser = (await request('GET', '/api/user', { cookie: bence.cookie })).json;
  assert.equal(benceUser.coachesAthletes, true);
  assert.equal(benceUser.hasCoach, false, 'Bencét senki nem edzi');
});

test('a KÍVÜLÁLLÓ semmit nem lát, és a hibakód sem árulja el a fiók létezését', async () => {
  const view = await overview(marton.cookie);
  assert.deepEqual(view.clients, []);
  assert.deepEqual(view.coaches, []);
  assert.deepEqual(view.invitesReceived, []);

  /* Márton edző IS lehet — attól még senkinek nem edzője. */
  await request('POST', '/api/coach/role', { cookie: marton.cookie, body: { isCoach: true } });

  const letezo = await request('GET', `/api/coach/clients/${petra.id}/readiness`, { cookie: marton.cookie });
  const nemLetezo = await request('GET', '/api/coach/clients/999999/readiness', { cookie: marton.cookie });
  assert.equal(letezo.status, 404);
  assert.equal(nemLetezo.status, 404);
  assert.deepEqual(
    letezo.json, nemLetezo.json,
    'a létező és a nem létező fiók UGYANAZT a választ adja — különben az id-k végigpróbálhatók lennének',
  );

  // Márton a kapcsolatot sem tudja lebontani, ami nem az övé.
  const bontas = await request('DELETE', `/api/coach/links/${linkId}`, { cookie: marton.cookie });
  assert.equal(bontas.status, 404);
});

test('a saját adatát mindenki olvashatja ezen a végponton is', async () => {
  const res = await request('GET', `/api/coach/clients/${petra.id}/readiness`, { cookie: petra.cookie });
  assert.equal(res.status, 200, 'a saját fiók sosem tiltott');

  const rossz = await request('GET', '/api/coach/clients/abc/readiness', { cookie: petra.cookie });
  assert.equal(rossz.status, 400, 'nem szám azonosító → 400, nem 500');
});

/* ======================================================================
   4/b. Kiosztott edzéstervek
   ----------------------------------------------------------------------
   A kiosztott terv a KLIENSÉ (ő a tulajdonos), de az EDZŐ a szerzője.
   Ebből következik minden állítás idelent.
   ====================================================================== */

let assignedPlanId = 0;

const gyakorlat = [{
  name: 'Fekvenyomás',
  sets: [{ reps: '5', weight: '80', rpe: '8', type: 'work' }],
}];

test('az edző tervet oszt ki, és a kliens azonnal LÁTJA — de nem szerkesztheti', async () => {
  const res = await request('POST', `/api/coach/clients/${petra.id}/plans`, {
    cookie: bence.cookie,
    body: { name: 'Erő blokk', exercises: gyakorlat, days: [1, 3] },
  });
  assert.equal(res.status, 201);
  assignedPlanId = res.json.id;
  assert.equal(res.json.coachAuthored, true, 'a terv az edző szerzőségével jött létre');

  // A kliens oldaláról nézve
  const plans = (await request('GET', '/api/plans', { cookie: petra.cookie })).json;
  const assigned = plans.find((p) => p.id === assignedPlanId);
  assert.ok(assigned, 'a kiosztott terv megjelent a kliensnél');
  assert.equal(assigned.own, false, 'nem szerkesztheti — a felület emiatt rejti a ceruzát');
  assert.equal(assigned.coachAuthored, true);
  assert.match(assigned.meta, /Kovács Bence terve/, 'a kártya kiírja, kitől jött');
  assert.ok(assigned.exercises.length > 0, 'a gyakorlatok is átjöttek — edzeni tud belőle');
  assert.equal(assigned.changeNote, null, 'a létrehozás NEM módosítás — nincs még nyom rajta');
});

test('a kliens NEM tudja átírni a kiosztott tervet — és megtudja, miért', async () => {
  const res = await request('PUT', `/api/plans/${assignedPlanId}`, {
    cookie: petra.cookie,
    body: { name: 'Átírt terv', exercises: gyakorlat, days: [] },
  });
  assert.equal(res.status, 403, 'nem 404: a SAJÁT tervét látja, csak nem szerkesztheti');
  assert.match(res.json.error, /Kovács Bence/, 'a hibaüzenet megmondja, kihez forduljon');

  // És tényleg nem változott semmi.
  const plans = (await request('GET', '/api/plans', { cookie: petra.cookie })).json;
  assert.equal(plans.find((p) => p.id === assignedPlanId).name, 'Erő blokk');
});

test('az edző módosíthatja a kiosztott tervet, és látszik, MIKOR és KI', async () => {
  const res = await request('PUT', `/api/coach/plans/${assignedPlanId}`, {
    cookie: bence.cookie,
    body: { name: 'Erő blokk v2', exercises: gyakorlat, days: [1, 3, 5] },
  });
  assert.equal(res.status, 200);

  const assigned = (await request('GET', '/api/plans', { cookie: petra.cookie })).json
    .find((p) => p.id === assignedPlanId);
  assert.equal(assigned.name, 'Erő blokk v2');
  assert.match(assigned.changeNote, /Kovács Bence/, 'a kliens látja, ki módosította');
  assert.match(assigned.changeNote, /Módosítva/, 'és azt is, mikor');
});

test('a kliens SAJÁT tervéhez az edző sem nyúlhat', async () => {
  const sajat = (await request('GET', '/api/plans', { cookie: petra.cookie })).json
    .find((p) => p.own);
  assert.ok(sajat, 'van a kliensnek saját terve');

  const res = await request('PUT', `/api/coach/plans/${sajat.id}`, {
    cookie: bence.cookie,
    body: { name: 'Belenyúlok', exercises: gyakorlat, days: [] },
  });
  assert.equal(res.status, 404, 'nem ő a szerzője — nem is tud róla');
});

test('KÍVÜLÁLLÓ nem oszthat ki tervet, és a kiosztottat sem írhatja át', async () => {
  const kioszt = await request('POST', `/api/coach/clients/${petra.id}/plans`, {
    cookie: marton.cookie,
    body: { name: 'Idegen terv', exercises: gyakorlat, days: [] },
  });
  assert.equal(kioszt.status, 404, 'Márton nem edzi Petrát');

  const atir = await request('PUT', `/api/coach/plans/${assignedPlanId}`, {
    cookie: marton.cookie,
    body: { name: 'Idegen terv', exercises: gyakorlat, days: [] },
  });
  assert.equal(atir.status, 404);

  const lista = await request('GET', `/api/coach/clients/${petra.id}/plans`, { cookie: marton.cookie });
  assert.equal(lista.status, 404, 'a terveit sem listázhatja');
});

/* ======================================================================
   4/c. Értesítések — valódi eseményekből
   ====================================================================== */

test('az értesítések a MEGTÖRTÉNT eseményekből állnak, a jó fióknál', async () => {
  const petraNotifs = (await request('GET', '/api/notifications', { cookie: petra.cookie })).json;
  const bencesNotifs = (await request('GET', '/api/notifications', { cookie: bence.cookie })).json;

  // A kliens a meghívásról, a kiosztásról és a módosításról kap értesítést.
  assert.ok(petraNotifs.some((n) => n.cat === 'invite' && /meghívott/.test(n.text)));
  assert.ok(petraNotifs.some((n) => n.cat === 'plan' && /Erő blokk/.test(n.text)));
  assert.ok(petraNotifs.some((n) => n.cat === 'planChange' && /módosította/.test(n.text)));

  // Az edző CSAK az elfogadásról — a saját műveleteiről nem értesítjük magát.
  assert.ok(bencesNotifs.some((n) => n.cat === 'invite' && /elfogadta/.test(n.text)));
  assert.ok(!bencesNotifs.some((n) => n.cat === 'plan'), 'a saját kiosztásáról nem kap értesítést');

  // És egyik fiók sem látja a másikét.
  const petraSzovegek = new Set(petraNotifs.map((n) => n.text));
  assert.ok(!bencesNotifs.some((n) => petraSzovegek.has(n.text)));
});

test('az „olvasottnak jelölés" NEM törli az előzményt, csak az új jelzést', async () => {
  const elotte = (await request('GET', '/api/notifications', { cookie: petra.cookie })).json;
  assert.ok(elotte.every((n) => n.unread), 'kezdetben minden új');

  const res = await request('POST', '/api/notifications/read', { cookie: petra.cookie });
  assert.equal(res.status, 204);

  const utana = (await request('GET', '/api/notifications', { cookie: petra.cookie })).json;
  assert.equal(utana.length, elotte.length, 'a lista MEGMARAD — a korábbi felület kiürítette');
  assert.ok(utana.every((n) => !n.unread), 'de már egyik sem új');
});

/* ======================================================================
   5. A kapcsolat bontása AZONNAL elveszi a hozzáférést
   ====================================================================== */

test('a kliens felmondhatja a kapcsolatot, és az edző attól kezdve nem lát semmit', async () => {
  const res = await request('DELETE', `/api/coach/links/${linkId}`, { cookie: petra.cookie });
  assert.equal(res.status, 204);

  const peek = await request('GET', `/api/coach/clients/${petra.id}/readiness`, { cookie: bence.cookie });
  assert.equal(peek.status, 404, 'a bontás után nincs olvasási jog');

  const view = await overview(bence.cookie);
  assert.deepEqual(view.clients, [], 'a kliens eltűnt a panelről');

  const petraUser = (await request('GET', '/api/user', { cookie: petra.cookie })).json;
  assert.equal(petraUser.hasCoach, false, 'már nincs edzője');
});

test('a bontás után a korábban kiosztott tervet SEM módosíthatja tovább', async () => {
  /* A terv a kliensnél marad (edzeni tud belőle), de a volt edzője már nem
     írhatja át. A szerzőség önmagában NEM jogosultság — a kapcsolatnak is
     élnie kell. */
  const res = await request('PUT', `/api/coach/plans/${assignedPlanId}`, {
    cookie: bence.cookie,
    body: { name: 'Utólagos átírás', exercises: gyakorlat, days: [] },
  });
  assert.equal(res.status, 403);

  const megvan = (await request('GET', '/api/plans', { cookie: petra.cookie })).json
    .find((p) => p.id === assignedPlanId);
  assert.equal(megvan.name, 'Erő blokk v2', 'a terv változatlanul megmaradt a kliensnél');
});

test('a bontás után újra lehet meghívni — a kapcsolat nem ragad be', async () => {
  const res = await request('POST', '/api/coach/invites', {
    cookie: bence.cookie, body: { username: 'petra' },
  });
  assert.equal(res.status, 201, 'a felmondott kapcsolat után új meghívás küldhető');
  assert.equal(res.json.status, 'pending', 'és ez is elfogadásra vár, nem éled fel magától');

  const peek = await request('GET', `/api/coach/clients/${petra.id}/readiness`, { cookie: bence.cookie });
  assert.equal(peek.status, 404);
});

/* ======================================================================
   6. Készenlét-javaslat — a rendszer KÉRDEZ, nem cselekszik
   ----------------------------------------------------------------------
   A legfontosabb állítás itt: az elfogadás a MAI NAPLÓT írja át, a TERVET
   soha. Ha ez elromlik, az edző azt hiszi, a kliens az ő tervét csinálta
   végig — miközben más súlyokkal edzett.
   ====================================================================== */

test('a javaslat konkrét, és a MÁR TELJESÍTETT szetteket nem bántja', async () => {
  // Fájdalom a mellre — a motor 7/10 felett tiltó szintnek veszi.
  await request('PUT', '/api/checkin', {
    cookie: petra.cookie,
    body: { sleepHours: 7, sleepQuality: 3, energy: 3, stress: 3, pain: { chest: 8 } },
  });

  // Mai naplóba töltődő terv (minden napra ütemezve), fájdalmas és semleges
  // gyakorlattal. A legfrissebb terv nyer, ezért ez lesz a mai tartalom.
  await request('POST', '/api/plans', {
    cookie: petra.cookie,
    body: {
      name: 'Mai teszt',
      days: [0, 1, 2, 3, 4, 5, 6],
      exercises: [
        { name: 'Fekvenyomás', sets: [{ reps: '5', weight: '80', rpe: '8', type: 'work' }] },
        { name: 'Húzódzkodás', sets: [{ reps: '8', weight: '0', rpe: '8', type: 'work' }] },
      ],
    },
  });

  const advice = (await request('GET', '/api/readiness/advice', { cookie: petra.cookie })).json;
  assert.equal(advice.name, 'Mai teszt');

  const fekvenyomas = advice.items.find((i) => i.name === 'Fekvenyomás');
  assert.ok(fekvenyomas, 'a fájdalmas izmot terhelő gyakorlat javaslatot kap');
  assert.equal(fekvenyomas.action, 'skip', 'nincs teljesített szettje → kihagyható');
  assert.match(fekvenyomas.reason, /Mell/, 'és megmondja, miért');

  assert.ok(
    !advice.items.some((i) => i.name === 'Húzódzkodás'),
    'a saját testsúlyos gyakorlaton nincs mit levenni — nem javaslunk rá semmit',
  );
});

test('az ELFOGADÁS a mai naplót írja át — a tervet SOHA', async () => {
  const applied = await request('POST', '/api/readiness/advice/apply', { cookie: petra.cookie });
  assert.equal(applied.status, 200);
  assert.ok(applied.json.applied >= 1);

  // A mai napló: a fájdalmas gyakorlat kimaradt.
  const naplo = (await request('GET', '/api/workout-template', { cookie: petra.cookie })).json;
  assert.ok(
    !naplo.exercises.some((e) => e.name === 'Fekvenyomás'),
    'a mai naplóból kikerült',
  );
  assert.ok(naplo.exercises.some((e) => e.name === 'Húzódzkodás'), 'a többi maradt');

  // A TERV viszont érintetlen — ez a lényeg.
  const terv = (await request('GET', '/api/plans', { cookie: petra.cookie })).json
    .find((p) => p.name === 'Mai teszt');
  assert.equal(terv.exercises.length, 2, 'a terv továbbra is két gyakorlatot ír elő');
  assert.ok(terv.exercises.some((e) => e.name === 'Fekvenyomás'), 'a terv nem változott');
});

test('a javaslat nem ismétli magát: amit elfogadtál, arra nem szól újra', async () => {
  const advice = (await request('GET', '/api/readiness/advice', { cookie: petra.cookie })).json;
  assert.ok(
    !advice.items.some((i) => i.name === 'Fekvenyomás'),
    'a kihagyott gyakorlat már nincs a naplóban, tehát nincs is mit javasolni rá',
  );
});

test('a mai dátum tényleg a mai — a kártya „ma" címkéje nem véletlen', () => {
  /* Ha ez a sor elromlik, a fenti lastWorkout-állítás némán hamis biztonságot
     adna (bármilyen dátumot elfogadna „ma"-ként). */
  assert.match(today(), /^\d{4}\.\d{2}\.\d{2}$/);
});

/* ======================================================================
   7. Kommentek — megjegyzések és az edző–kliens üzenetváltás
   ----------------------------------------------------------------------
   Egy tábla és egy végpontcsalád szolgálja ki mind a négy céltípust. A
   kockázat is közös: a `subject` MÁS fiók adata, tehát ugyanaz a kapu védi,
   mint a többi kereszt-fiók olvasást. A chat ezen FELÜL szűkít — egy
   kliensnek több edzője lehet, és az egyik nem olvashat bele a másik
   szálába.
   ====================================================================== */

/** Zsolt Petra MÁSODIK edzője — vele mérjük, hogy a chat-szál tényleg csak a
    két résztvevőé, nem „minden edzőé". */
const zsolt = await signUp('zsolt', 'Szabó Zsolt');
let petraWorkoutId = 0;

test('a kapcsolatok újra élnek — a komment-tesztek erre a helyzetre épülnek', async () => {
  // A fenti blokk végén Bence meghívása FÜGGŐBEN maradt; most elfogadjuk.
  const petrasView = await overview(petra.cookie);
  const bencesInvite = petrasView.invitesReceived.find((i) => i.coach.username === 'bence');
  assert.ok(bencesInvite, 'ott a függő meghívás Bencétől');
  const accept = await request('POST', `/api/coach/invites/${bencesInvite.id}/accept`, { cookie: petra.cookie });
  assert.equal(accept.status, 200);

  // Zsolt is edző lesz, és őt is elfogadja Petra.
  await request('POST', '/api/coach/role', { cookie: zsolt.cookie, body: { isCoach: true } });
  const invite = await request('POST', '/api/coach/invites', {
    cookie: zsolt.cookie, body: { username: 'petra' },
  });
  assert.equal(invite.status, 201);
  const zsoltAccept = await request('POST', `/api/coach/invites/${invite.json.id}/accept`, { cookie: petra.cookie });
  assert.equal(zsoltAccept.status, 200);

  const view = await overview(petra.cookie);
  assert.equal(view.coaches.length, 2, 'Petrának most két edzője van');

  // Egy mentett edzés, amire a megjegyzések mutatnak.
  const workout = await request('GET', '/api/workouts', { cookie: petra.cookie });
  petraWorkoutId = workout.json[0].id;
  assert.ok(petraWorkoutId, 'van mentett edzés, amire hivatkozhatunk');
});

test('a kliens megjegyzést fűz a saját gyakorlatához, és az edzője LÁTJA', async () => {
  const target = `${petraWorkoutId}:0`;
  const created = await request('POST', `/api/comments/${petra.id}`, {
    cookie: petra.cookie,
    body: { targetType: 'exercise', targetId: target, text: 'Fájt a vállam a 3. szettnél.' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.json.authorName, 'Nagy Petra', 'a szerző a bejelentkezett fiók');

  // Az edző ugyanazt látja — ugyanazon a végponton, a kliens id-jével.
  const coachView = await request('GET', `/api/comments/${petra.id}?type=exercise&target=${target}`, {
    cookie: bence.cookie,
  });
  assert.equal(coachView.status, 200);
  assert.equal(coachView.json.length, 1);
  assert.equal(coachView.json[0].text, 'Fájt a vállam a 3. szettnél.');
});

test('az edzői megjegyzés ugyanabba a szálba kerül, más szerzővel', async () => {
  const target = `${petraWorkoutId}:0`;
  const created = await request('POST', `/api/comments/${petra.id}`, {
    cookie: bence.cookie,
    body: { targetType: 'exercise', targetId: target, text: 'Vidd lejjebb a könyököd.' },
  });
  assert.equal(created.status, 201);

  const thread = await request('GET', `/api/comments/${petra.id}?type=exercise&target=${target}`, {
    cookie: petra.cookie,
  });
  assert.equal(thread.json.length, 2, 'egy szál, két szerző');
  assert.deepEqual(thread.json.map((c) => c.authorName), ['Nagy Petra', 'Kovács Bence'],
    'időrendben, a legrégebbi elöl');
});

test('a csoportosított lekérés egy körből megadja, hol VAN megjegyzés', async () => {
  const res = await request('GET', `/api/comments/${petra.id}/by-target?type=exercise`, {
    cookie: bence.cookie,
  });
  assert.equal(res.status, 200);
  assert.equal(res.json[`${petraWorkoutId}:0`].length, 2);
  // A chat szálanként külön jogosultságot kíván, ezért itt nem kérhető le.
  const chat = await request('GET', `/api/comments/${petra.id}/by-target?type=chat`, {
    cookie: bence.cookie,
  });
  assert.equal(chat.status, 400);
});

test('a KÍVÜLÁLLÓ nem lát és nem is ír kommentet', async () => {
  const target = `${petraWorkoutId}:0`;
  const read = await request('GET', `/api/comments/${petra.id}?type=exercise&target=${target}`, {
    cookie: marton.cookie,
  });
  assert.equal(read.status, 404, 'nem 403 — az sem derülhet ki, hogy a fiók létezik');

  const write = await request('POST', `/api/comments/${petra.id}`, {
    cookie: marton.cookie,
    body: { targetType: 'exercise', targetId: target, text: 'idegen szöveg' },
  });
  assert.equal(write.status, 404);

  // És tényleg nem került be semmi.
  const thread = await request('GET', `/api/comments/${petra.id}?type=exercise&target=${target}`, {
    cookie: petra.cookie,
  });
  assert.equal(thread.json.length, 2);
});

test('a chat-szálat CSAK a két résztvevő látja — a másik edző NEM', async () => {
  const send = await request('POST', `/api/comments/${petra.id}`, {
    cookie: petra.cookie,
    body: { targetType: 'chat', targetId: String(bence.id), text: 'Szia Bence, kérdésem lenne.' },
  });
  assert.equal(send.status, 201);

  const reply = await request('POST', `/api/comments/${petra.id}`, {
    cookie: bence.cookie,
    body: { targetType: 'chat', targetId: String(bence.id), text: 'Mondjad!' },
  });
  assert.equal(reply.status, 201);

  const petraThread = await request('GET', `/api/comments/${petra.id}?type=chat&target=${bence.id}`, {
    cookie: petra.cookie,
  });
  assert.equal(petraThread.json.length, 2, 'a kliens a teljes szálat látja');

  const bencesThread = await request('GET', `/api/comments/${petra.id}?type=chat&target=${bence.id}`, {
    cookie: bence.cookie,
  });
  assert.equal(bencesThread.json.length, 2, 'és az edző is');

  /* Zsolt SZINTÉN Petra edzője, tehát a resolveClientId átengedné — a
     chat-szabály viszont nem. Ez a teszt lényege. */
  const zsoltPeek = await request('GET', `/api/comments/${petra.id}?type=chat&target=${bence.id}`, {
    cookie: zsolt.cookie,
  });
  assert.equal(zsoltPeek.status, 404, 'a másik edző nem olvashat bele');

  const zsoltWrite = await request('POST', `/api/comments/${petra.id}`, {
    cookie: zsolt.cookie,
    body: { targetType: 'chat', targetId: String(bence.id), text: 'beleszólnék' },
  });
  assert.equal(zsoltWrite.status, 404, 'és nem is írhat bele');
});

test('a szálak elkülönülnek: Zsolt szála nem keveredik Bencéével', async () => {
  await request('POST', `/api/comments/${petra.id}`, {
    cookie: zsolt.cookie,
    body: { targetType: 'chat', targetId: String(zsolt.id), text: 'Szia Petra!' },
  });
  const zsoltThread = await request('GET', `/api/comments/${petra.id}?type=chat&target=${zsolt.id}`, {
    cookie: zsolt.cookie,
  });
  assert.equal(zsoltThread.json.length, 1, 'Zsolt szálában csak a saját üzenete van');

  const bencesThread = await request('GET', `/api/comments/${petra.id}?type=chat&target=${bence.id}`, {
    cookie: bence.cookie,
  });
  assert.equal(bencesThread.json.length, 2, 'Bence szála változatlan');
});

test('a komment validál: ismeretlen típus, üres és túl hosszú szöveg', async () => {
  const rossz = [
    [{ targetType: 'kitalalt', targetId: '1', text: 'x' }, 'ismeretlen típus'],
    [{ targetType: 'exercise', targetId: '1:0', text: '   ' }, 'csak szóköz'],
    [{ targetType: 'exercise', targetId: '1:0', text: 'x'.repeat(1001) }, 'túl hosszú'],
  ];
  for (const [body, eset] of rossz) {
    const res = await request('POST', `/api/comments/${petra.id}`, { cookie: petra.cookie, body });
    assert.equal(res.status, 400, eset);
    assert.ok(res.json.error, `${eset}: beszédes hibaüzenet`);
  }
});

test('kommentet CSAK a szerzője törölhet', async () => {
  const target = `${petraWorkoutId}:0`;
  const thread = await request('GET', `/api/comments/${petra.id}?type=exercise&target=${target}`, {
    cookie: petra.cookie,
  });
  const bencesComment = thread.json.find((c) => c.authorId === bence.id);

  // Petra a SAJÁT adatán van, mégsem törölheti az edző megjegyzését.
  const petraTorol = await request('DELETE', `/api/comments/${petra.id}/${bencesComment.id}`, {
    cookie: petra.cookie,
  });
  assert.equal(petraTorol.status, 404, 'nem a szerzője — nem talál sort');

  const benceTorol = await request('DELETE', `/api/comments/${petra.id}/${bencesComment.id}`, {
    cookie: bence.cookie,
  });
  assert.equal(benceTorol.status, 204);

  const utana = await request('GET', `/api/comments/${petra.id}?type=exercise&target=${target}`, {
    cookie: petra.cookie,
  });
  assert.equal(utana.json.length, 1);
});

test('az új komment értesítést szül a MÁSIK félnél, magánál nem', async () => {
  const elotte = (await request('GET', '/api/notifications', { cookie: petra.cookie })).json;
  const sajatElotte = (await request('GET', '/api/notifications', { cookie: bence.cookie })).json;

  await request('POST', `/api/comments/${petra.id}`, {
    cookie: bence.cookie,
    body: { targetType: 'chat', targetId: String(bence.id), text: 'Ne felejtsd a bemelegítést.' },
  });

  const utana = (await request('GET', '/api/notifications', { cookie: petra.cookie })).json;
  assert.equal(utana.length, elotte.length + 1, 'Petra kapott értesítést');
  assert.equal(utana[0].cat, 'comment', 'saját kategóriát kap, hogy külön némítható legyen');

  const sajatUtana = (await request('GET', '/api/notifications', { cookie: bence.cookie })).json;
  assert.equal(sajatUtana.length, sajatElotte.length, 'az író magának nem küld értesítést');
});

test('a kapcsolat bontása a kommentekhez való hozzáférést is elveszi', async () => {
  const view = await overview(zsolt.cookie);
  const link = view.clients.find((c) => c.username === 'petra');
  const bontas = await request('DELETE', `/api/coach/links/${link.linkId}`, { cookie: zsolt.cookie });
  assert.equal(bontas.status, 204);

  const olvas = await request('GET', `/api/comments/${petra.id}?type=chat&target=${zsolt.id}`, {
    cookie: zsolt.cookie,
  });
  assert.equal(olvas.status, 404, 'a volt edző a saját korábbi szálát sem éri el');

  // Petra viszont továbbra is látja a SAJÁT adatát.
  const sajat = await request('GET', `/api/comments/${petra.id}?type=exercise&target=${petraWorkoutId}:0`, {
    cookie: petra.cookie,
  });
  assert.equal(sajat.status, 200);
});

/* ======================================================================
   8. Edzés utáni visszajelzés
   ----------------------------------------------------------------------
   STRUKTURÁLT mező a workouts soron, nem komment — így a nehézség és a
   közérzet szám marad, tehát később elemezhető. A kockázat itt is a
   kereszt-fiók írás: a visszajelzés a SAJÁT edzésre szól, idegenére nem.
   ====================================================================== */

test('a kliens visszajelzést küld a saját edzéséről, és az edzője LÁTJA', async () => {
  const kuldes = await request('PUT', `/api/workouts/${petraWorkoutId}/feedback`, {
    cookie: petra.cookie,
    body: { difficulty: 4, mood: 2, note: 'Nehéz volt, de kibírtam.' },
  });
  assert.equal(kuldes.status, 200);
  assert.equal(kuldes.json.feedback.difficulty, 4);
  assert.equal(kuldes.json.feedback.mood, 2);
  assert.equal(kuldes.json.feedback.note, 'Nehéz volt, de kibírtam.');
  assert.ok(kuldes.json.feedback.at, 'a küldés ideje is rögzül');

  const view = await overview(bence.cookie);
  const kartya = view.clients.find((c) => c.username === 'petra');
  assert.equal(kartya.lastFeedback.difficulty, 4, 'az edzői kártyán ott a legutóbbi visszajelzés');
  assert.equal(kartya.lastFeedback.note, 'Nehéz volt, de kibírtam.');
  assert.ok(kartya.lastFeedback.workout, 'és az is látszik, MELYIK edzésről szól');
});

test('a visszajelzés az edzőnek értesítést szül', async () => {
  const elotte = (await request('GET', '/api/notifications', { cookie: bence.cookie })).json;
  await request('PUT', `/api/workouts/${petraWorkoutId}/feedback`, {
    cookie: petra.cookie, body: { difficulty: 3, mood: 4, note: '' },
  });
  const utana = (await request('GET', '/api/notifications', { cookie: bence.cookie })).json;
  assert.equal(utana.length, elotte.length + 1);
  assert.equal(utana[0].cat, 'comment');
  assert.match(utana[0].text, /visszajelzést küldött/);
});

test('az újraküldés FELÜLÍR, nem halmoz — és az üres megjegyzés null lesz', async () => {
  const res = await request('GET', '/api/workouts', { cookie: petra.cookie });
  const workout = res.json.find((w) => w.id === petraWorkoutId);
  assert.equal(workout.feedback.difficulty, 3, 'a legutóbbi küldés értéke él');
  assert.equal(workout.feedback.note, null, 'az üres szöveg nem üres string, hanem null');
});

test('IDEGEN edzésre nem lehet visszajelzést küldeni', async () => {
  /* Bence Petra edzője, tehát OLVASNI lát nála — írni viszont nem az ő
     naplójába. A user_id feltétel miatt nem talál sort: 404, nem 403. */
  const res = await request('PUT', `/api/workouts/${petraWorkoutId}/feedback`, {
    cookie: bence.cookie, body: { difficulty: 1, mood: 1, note: 'nem az enyém' },
  });
  assert.equal(res.status, 404);

  const kivulallo = await request('PUT', `/api/workouts/${petraWorkoutId}/feedback`, {
    cookie: marton.cookie, body: { difficulty: 1, mood: 1 },
  });
  assert.equal(kivulallo.status, 404);

  // A korábbi visszajelzés érintetlen.
  const workouts = (await request('GET', '/api/workouts', { cookie: petra.cookie })).json;
  assert.equal(workouts.find((w) => w.id === petraWorkoutId).feedback.difficulty, 3);
});

test('a visszajelzés validál, és a HIÁNYZÓ mező null marad — nem nulla', async () => {
  const rossz = [
    [{ difficulty: 0 }, 'nehézség a tartomány alatt'],
    [{ mood: 6 }, 'közérzet a tartomány felett'],
    [{ note: 'x'.repeat(501) }, 'túl hosszú megjegyzés'],
  ];
  for (const [body, eset] of rossz) {
    const res = await request('PUT', `/api/workouts/${petraWorkoutId}/feedback`, {
      cookie: petra.cookie, body,
    });
    assert.equal(res.status, 400, eset);
    assert.ok(res.json.error, `${eset}: beszédes hibaüzenet`);
  }

  // Csak a közérzet — a nehézség NULL marad, nem 0.
  const csakMood = await request('PUT', `/api/workouts/${petraWorkoutId}/feedback`, {
    cookie: petra.cookie, body: { mood: 5 },
  });
  assert.equal(csakMood.status, 200);
  assert.equal(csakMood.json.feedback.mood, 5);
  assert.equal(csakMood.json.feedback.difficulty, null, 'a meg nem adott nehézség null');
});
