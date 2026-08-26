/**
 * FitTrack Pro — az EDZŐ–SPORTOLÓ kapcsolat végponti tesztjei
 * ----------------------------------------------------------
 * Ez a fájl azt őrzi, ami az Edző oldalt valódivá teszi: két különböző fiók
 * kapcsolatba lép, üzenetet vált, és az edző a sportoló SAJÁT naplójából
 * számolt összegzést látja — de csak azután, hogy a sportoló elfogadta a
 * meghívót, és csak addig, amíg a kapcsolat él.
 *
 * A hangsúly a HOZZÁFÉRÉSEN van: a users.test.js azt bizonyítja, hogy idegen
 * nem lát bele más adatába; itt az a kérdés, hogy a BELEEGYEZÉSSEL létrejött
 * kapcsolat pontosan annyit nyit meg, amennyit kell — se többet (harmadik fél,
 * függő meghívó, lezárt kapcsolat), se kevesebbet.
 *
 * Az api.test.js-hez hasonlóan a VALÓDI szervert indítja el, saját ideiglenes
 * adatbázissal, és HTTP-n beszél vele.
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

  const setCookie = res.headers.getSetCookie();
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* nem JSON */ }
  return { status: res.status, json, setCookie };
}

const cookieFrom = (res) => (res.setCookie[0] ?? '').split(';')[0];

/** Új fiók + belépett munkamenet egy lépésben. */
async function register(username, displayName) {
  const res = await request('POST', '/api/auth/register', {
    body: { username, displayName, password: 'jelszo123' },
  });
  assert.equal(res.status, 201, `${username} regisztrációja`);
  return cookieFrom(res);
}

/** Egy gyakorlat, egyetlen teljesített munkasorozattal. */
const gyakorlat = (name, weight) => ({
  name,
  sets: [{ reps: '5', weight: String(weight), rpe: '8', type: 'work', done: true }],
});

/* A három szereplő: edző, sportoló, és egy kívülálló, akinek semmi köze
   hozzájuk — ő a teszt „támadója". */
const coach = { cookie: await register('edzo', 'Kovács Bence') };
const athlete = { cookie: await register('sportolo', 'Nagy Petra') };
const outsider = { cookie: await register('idegen', 'Idegen Ilona') };

let linkId = 0;

/* ======================================================================
   1. Hozzáférés-védelem
   ====================================================================== */

test('bejelentkezés nélkül a kapcsolat- és üzenet-végpontok is 401-et adnak', async () => {
  const endpoints = [
    ['GET', '/api/athletes'], ['POST', '/api/athletes'], ['DELETE', '/api/athletes/1'],
    ['GET', '/api/coach'], ['DELETE', '/api/coach'],
    ['POST', '/api/coach/invites/1/accept'], ['DELETE', '/api/coach/invites/1'],
    ['GET', '/api/messages/1'], ['POST', '/api/messages/1'], ['POST', '/api/messages/1/read'],
    ['GET', '/api/goals'], ['PUT', '/api/user'],
  ];
  for (const [method, urlPath] of endpoints) {
    const res = await request(method, urlPath, { body: method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${method} ${urlPath} védtelen!`);
  }
});

/* ======================================================================
   2. Meghívás
   ====================================================================== */

test('friss fióknak nincs edzője és nincs sportolója', async () => {
  const mine = await request('GET', '/api/athletes', { cookie: coach.cookie });
  assert.deepEqual(mine.json, { athletes: [], invites: [] });

  const theirs = await request('GET', '/api/coach', { cookie: athlete.cookie });
  assert.deepEqual(theirs.json, { coach: null, invites: [] });

  const user = await request('GET', '/api/user', { cookie: coach.cookie });
  assert.deepEqual(Object.keys(user.json).sort(), ['goal', 'name', 'username'],
    'a fiók alakjában nincs szerepkör-jelző: az a kapcsolatokból következik');
});

test('a meghívó visszautasítja az ismeretlen nevet és az önmeghívást', async () => {
  const unknown = await request('POST', '/api/athletes', {
    cookie: coach.cookie, body: { username: 'nincs-ilyen' },
  });
  assert.equal(unknown.status, 404);

  const self = await request('POST', '/api/athletes', {
    cookie: coach.cookie, body: { username: 'edzo' },
  });
  assert.equal(self.status, 400);

  const empty = await request('POST', '/api/athletes', { cookie: coach.cookie, body: {} });
  assert.equal(empty.status, 400);
});

test('a meghívó függő marad, és addig NEM ad hozzáférést', async () => {
  const res = await request('POST', '/api/athletes', {
    cookie: coach.cookie, body: { username: 'SportolO' }, // nagybetűkkel is megtalálja
  });
  assert.equal(res.status, 201);
  assert.equal(res.json.username, 'sportolo');
  assert.equal(res.json.name, 'Nagy Petra');
  linkId = res.json.linkId;

  // Az edzőnél a meghívó látszik, sportoló viszont még nincs
  const mine = await request('GET', '/api/athletes', { cookie: coach.cookie });
  assert.equal(mine.json.athletes.length, 0, 'elfogadás előtt nincs sportoló');
  assert.equal(mine.json.invites.length, 1);
  assert.equal(mine.json.invites[0].linkId, linkId);

  // A sportolónál a meghívó megjelenik, de edző még nincs
  const theirs = await request('GET', '/api/coach', { cookie: athlete.cookie });
  assert.equal(theirs.json.coach, null);
  assert.equal(theirs.json.invites.length, 1);
  assert.equal(theirs.json.invites[0].name, 'Kovács Bence');

  // Üzenetet küldeni még nem lehet: a szál csak élő kapcsolatban létezik
  const msg = await request('GET', `/api/messages/${linkId}`, { cookie: coach.cookie });
  assert.equal(msg.status, 404, 'függő kapcsolatnak nincs üzenet-szála');

  // Ugyanaz a meghívó nem duplázható
  const again = await request('POST', '/api/athletes', {
    cookie: coach.cookie, body: { username: 'sportolo' },
  });
  assert.equal(again.status, 409);
});

test('idegen nem fogadhatja el a más nevére szóló meghívót', async () => {
  const res = await request('POST', `/api/coach/invites/${linkId}/accept`, { cookie: outsider.cookie });
  assert.equal(res.status, 404);

  const remove = await request('DELETE', `/api/coach/invites/${linkId}`, { cookie: outsider.cookie });
  assert.equal(remove.status, 404);

  const drop = await request('DELETE', `/api/athletes/${linkId}`, { cookie: outsider.cookie });
  assert.equal(drop.status, 404, 'a kapcsolatot csak az edzője bonthatja');
});

/* ======================================================================
   3. Elfogadás — innen látszanak az adatok
   ====================================================================== */

test('elfogadás után az edző látja a sportolót', async () => {
  const accept = await request('POST', `/api/coach/invites/${linkId}/accept`, { cookie: athlete.cookie });
  assert.equal(accept.status, 200);
  assert.equal(accept.json.coach.username, 'edzo');

  const mine = await request('GET', '/api/athletes', { cookie: coach.cookie });
  assert.equal(mine.json.invites.length, 0, 'a meghívó elfogadás után nem függő többé');
  assert.equal(mine.json.athletes.length, 1);
  assert.equal(mine.json.athletes[0].name, 'Nagy Petra');

  const theirs = await request('GET', '/api/coach', { cookie: athlete.cookie });
  assert.equal(theirs.json.coach.username, 'edzo', 'a sportoló oldalán is él a kapcsolat');
  assert.equal(theirs.json.invites.length, 0);
});

test('a kártya a sportoló SAJÁT naplójából számol', async () => {
  // A sportoló naplója: heti 2 napra ütemezett terv + egy lezárt edzés
  const plan = await request('POST', '/api/plans', {
    cookie: athlete.cookie,
    body: { name: 'Erőnléti alapok', exercises: [gyakorlat('Guggolás', 100)], days: [0, 3] },
  });
  assert.equal(plan.status, 201);

  // A mentés dátumát a SZERVER adja (mindig a mai nap), ezért itt csak a mai
  // edzés vizsgálható; a napokon átívelő logikát (terv-követés, sorozat,
  // riasztások) a coaching.test.js méri, ahol a dátum megadható.
  const saved = await request('POST', '/api/workouts', {
    cookie: athlete.cookie,
    body: { name: 'Alsótest', exercises: [gyakorlat('Guggolás', 120)] },
  });
  assert.equal(saved.status, 201);

  const res = await request('GET', '/api/athletes', { cookie: coach.cookie });
  const card = res.json.athletes[0];

  assert.equal(card.linkId, linkId);
  assert.equal(card.plan, 'Erőnléti alapok', 'az aktív terv a sportoló tervéből jön');
  assert.equal(card.lastWorkout, 'ma');
  assert.ok(card.streak >= 1, 'a sorozat a mai edzésből legalább 1');
  assert.ok(card.readiness > 0 && card.readiness <= 100, 'a készenlét a Recovery Engine-ből');
  assert.match(card.weekly, /^\d+\/(\d+|–)$/, 'a heti állás "megvolt/kitűzött" alakú');
  assert.equal(card.weekly.split('/')[1], '2', 'a kitűzött a terv két napjából jön');
  assert.ok(card.recent.some((entry) => entry.includes('Alsótest')), 'az aktivitás a valódi edzésekből épül');
  assert.ok(!('userId' in card), 'a sportoló belső azonosítója nem szivárog ki');
});

test('a kívülálló továbbra sem lát semmit', async () => {
  const mine = await request('GET', '/api/athletes', { cookie: outsider.cookie });
  assert.deepEqual(mine.json.athletes, []);

  const thread = await request('GET', `/api/messages/${linkId}`, { cookie: outsider.cookie });
  assert.equal(thread.status, 404, 'idegen nem olvashatja a szálat');

  const send = await request('POST', `/api/messages/${linkId}`, {
    cookie: outsider.cookie, body: { text: 'Beleszólok' },
  });
  assert.equal(send.status, 404, 'idegen nem írhat a szálba');

  // Értelmezhetetlen azonosítóra sem hibázhat a szerver (a szám-konverzió NaN-t ad)
  const bogus = await request('GET', '/api/messages/abc', { cookie: coach.cookie });
  assert.equal(bogus.status, 404);

  const read = await request('POST', `/api/messages/${linkId}/read`, { cookie: outsider.cookie });
  assert.equal(read.status, 404, 'idegen nem nyugtázhatja más szálát');
});

/* ======================================================================
   4. Üzenetek
   ====================================================================== */

test('az üzenet mindkét irányban megérkezik, és a "mine" a nézőtől függ', async () => {
  const sent = await request('POST', `/api/messages/${linkId}`, {
    cookie: coach.cookie, body: { text: 'Szép munka a guggolásnál!' },
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.json.mine, true);

  const reply = await request('POST', `/api/messages/${linkId}`, {
    cookie: athlete.cookie, body: { text: 'Köszönöm, jövő héten emelek!' },
  });
  assert.equal(reply.status, 201);

  const asCoach = await request('GET', `/api/messages/${linkId}`, { cookie: coach.cookie });
  assert.equal(asCoach.json.partner.name, 'Nagy Petra');
  assert.equal(asCoach.json.partner.role, 'athlete');
  assert.deepEqual(asCoach.json.messages.map((m) => m.mine), [true, false], 'időrendben, a saját elöl');

  const asAthlete = await request('GET', `/api/messages/${linkId}`, { cookie: athlete.cookie });
  assert.equal(asAthlete.json.partner.name, 'Kovács Bence');
  assert.equal(asAthlete.json.partner.role, 'coach');
  assert.deepEqual(asAthlete.json.messages.map((m) => m.mine), [false, true], 'ugyanaz a szál, fordított nézőpont');
  assert.equal(asAthlete.json.messages[0].text, 'Szép munka a guggolásnál!');

  // A kártya az utolsó üzenetet idézi, az EDZŐ szemszögéből jelölve
  const card = (await request('GET', '/api/athletes', { cookie: coach.cookie })).json.athletes[0];
  assert.equal(card.lastMessage.text, 'Köszönöm, jövő héten emelek!');
  assert.equal(card.lastMessage.mine, false, 'az utolsó szó a sportolóé volt');
});

test('az olvasatlan üzenet számít, a nyugtázás után nem', async () => {
  /* A kiindulás: a fenti teszt két üzenete még nyugtázatlan. Mindkét fél a
     MÁSIK üzenetét látja olvasatlanként — a sajátját senki nem "olvassa el". */
  const coachThread = await request('GET', `/api/messages/${linkId}`, { cookie: coach.cookie });
  assert.equal(coachThread.json.unread, 1, 'az edzőnek a sportoló üzenete olvasatlan');
  assert.deepEqual(
    coachThread.json.messages.map((m) => m.read), [false, false],
    'még egyik üzenetet sem olvasták el',
  );

  // A kártya és a nézetváltó jelvénye ugyanabból a számból él
  const before = (await request('GET', '/api/athletes', { cookie: coach.cookie })).json.athletes[0];
  assert.equal(before.unread, 1);
  const athleteSide = await request('GET', '/api/coach', { cookie: athlete.cookie });
  assert.equal(athleteSide.json.coach.unread, 1, 'a sportolónak az edző üzenete olvasatlan');

  // Az edző elolvassa: CSAK a sportoló üzenete válik olvasottá
  const read = await request('POST', `/api/messages/${linkId}/read`, { cookie: coach.cookie });
  assert.equal(read.status, 200);
  assert.equal(read.json.read, 1, 'egy üzenet vált olvasottá');

  const after = (await request('GET', '/api/athletes', { cookie: coach.cookie })).json.athletes[0];
  assert.equal(after.unread, 0, 'az edzőnek nincs több hátraléka');

  const stillUnread = await request('GET', '/api/coach', { cookie: athlete.cookie });
  assert.equal(stillUnread.json.coach.unread, 1, 'a sportoló hátralékát az edző olvasása nem érinti');

  /* A küldő a saját üzenetén látja, hogy elolvasták — ez az "olvasva" jelölés.
     A sportoló szemszögéből: a SAJÁT üzenete (mine) most már read. */
  const asAthlete = await request('GET', `/api/messages/${linkId}`, { cookie: athlete.cookie });
  const own = asAthlete.json.messages.find((m) => m.mine);
  assert.equal(own.read, true, 'az edző elolvasta a sportoló üzenetét');
  assert.equal(asAthlete.json.unread, 1, 'a sportolónak viszont maradt olvasatlanja');
});

test('a nyugtázás idempotens, és az új üzenet újra hátralékot csinál', async () => {
  const again = await request('POST', `/api/messages/${linkId}/read`, { cookie: coach.cookie });
  assert.equal(again.status, 200);
  assert.equal(again.json.read, 0, 'hátralék nélkül nincs mit megjelölni');

  await request('POST', `/api/messages/${linkId}`, {
    cookie: athlete.cookie, body: { text: 'Kihagytam a keddi edzést.' },
  });
  const thread = await request('GET', `/api/messages/${linkId}`, { cookie: coach.cookie });
  assert.equal(thread.json.unread, 1, 'az új üzenet olvasatlanul érkezik');

  // A GET önmagában NEM jelöl olvasottnak: a halk frissítés nem jelenti, hogy
  // a felhasználó a képernyőn is látta a szálat.
  const twice = await request('GET', `/api/messages/${linkId}`, { cookie: coach.cookie });
  assert.equal(twice.json.unread, 1, 'a lekérés önmagában nem nyugtáz');

  await request('POST', `/api/messages/${linkId}/read`, { cookie: coach.cookie });
});

test('az üres üzenetet elutasítja, a hosszút levágja', async () => {
  const empty = await request('POST', `/api/messages/${linkId}`, {
    cookie: coach.cookie, body: { text: '   ' },
  });
  assert.equal(empty.status, 400);

  const long = await request('POST', `/api/messages/${linkId}`, {
    cookie: coach.cookie, body: { text: 'a'.repeat(500) },
  });
  assert.equal(long.status, 201);
  assert.equal(long.json.text.length, 280);
});

/* ======================================================================
   5. Egy edző egyszerre, és a leválás
   ====================================================================== */

test('második edző csak leválás után fogadható el', async () => {
  const invite = await request('POST', '/api/athletes', {
    cookie: outsider.cookie, body: { username: 'sportolo' },
  });
  assert.equal(invite.status, 201);

  const accept = await request('POST', `/api/coach/invites/${invite.json.linkId}/accept`, {
    cookie: athlete.cookie,
  });
  assert.equal(accept.status, 409, 'már van edzője');

  // A meghívó elutasítható
  const decline = await request('DELETE', `/api/coach/invites/${invite.json.linkId}`, {
    cookie: athlete.cookie,
  });
  assert.equal(decline.status, 204);
  const after = await request('GET', '/api/coach', { cookie: athlete.cookie });
  assert.equal(after.json.invites.length, 0);
});

test('leválás után az edző nem lát semmit, és a szál is megszűnik', async () => {
  const leave = await request('DELETE', '/api/coach', { cookie: athlete.cookie });
  assert.equal(leave.status, 204);

  const mine = await request('GET', '/api/athletes', { cookie: coach.cookie });
  assert.deepEqual(mine.json.athletes, [], 'a sportoló eltűnt az edzői panelről');

  const thread = await request('GET', `/api/messages/${linkId}`, { cookie: coach.cookie });
  assert.equal(thread.status, 404, 'a bontott kapcsolat üzenetei nem érhetők el');

  const theirs = await request('GET', '/api/coach', { cookie: athlete.cookie });
  assert.equal(theirs.json.coach, null, 'a sportolónak nincs többé edzője');
});

test('a kapcsolat nem fordulhat meg: az edző és a sportoló szerepe nem cserélhető', async () => {
  /* Kiindulás: az előző teszt után a „sportolo" fióknak nincs edzője.
     Ő most meghívja „edzo"-t SPORTOLÓNAK — ez még szabályos, hiszen nincs
     köztük élő kapcsolat. */
  const backwardsInvite = await request('POST', '/api/athletes', {
    cookie: athlete.cookie, body: { username: 'edzo' },
  });
  assert.equal(backwardsInvite.status, 201);

  // Közben viszont „edzo" hívja meg őt, és el is fogadja: innentől edzi őt.
  const invite = await request('POST', '/api/athletes', {
    cookie: coach.cookie, body: { username: 'sportolo' },
  });
  assert.equal(invite.status, 201);
  const accepted = await request('POST', `/api/coach/invites/${invite.json.linkId}/accept`, {
    cookie: athlete.cookie,
  });
  assert.equal(accepted.status, 200);

  /* A korábbi, függő meghívó ezek után NEM fogadható el: az edző a saját
     sportolójának lenne a sportolója. Két külön üzenet-szál jönne létre
     ugyanazzal az emberrel, és a felületen nem látszana, melyikbe írsz. */
  const accept = await request('POST', `/api/coach/invites/${backwardsInvite.json.linkId}/accept`, {
    cookie: coach.cookie,
  });
  assert.equal(accept.status, 409, 'a saját sportolód nem lehet az edződ');

  // Új meghívót sem lehet küldeni a saját edződnek
  await request('DELETE', `/api/athletes/${backwardsInvite.json.linkId}`, { cookie: athlete.cookie });
  const again = await request('POST', '/api/athletes', {
    cookie: athlete.cookie, body: { username: 'edzo' },
  });
  assert.equal(again.status, 409);
  assert.match(again.json.error, /edződ/, 'a hibaüzenet megmondja, mi az akadály');

  // Takarítás: a következő teszt friss kapcsolattal indul
  assert.equal((await request('DELETE', '/api/coach', { cookie: athlete.cookie })).status, 204);
});

/* ======================================================================
   6. Edzés-cél (a kártya címkéje)
   ====================================================================== */

test('az edzés-cél mentődik, és csak ismert kulcs fogadható el', async () => {
  const goals = await request('GET', '/api/goals', { cookie: athlete.cookie });
  assert.ok(Array.isArray(goals.json) && goals.json.length > 0);
  const strength = goals.json.find((goal) => goal.key === 'strength');
  assert.ok(strength?.tag, 'a célnak van rövid címkéje a kártyához');

  const bad = await request('PUT', '/api/user', { cookie: athlete.cookie, body: { goal: 'nincs-ilyen' } });
  assert.equal(bad.status, 400);

  const ok = await request('PUT', '/api/user', { cookie: athlete.cookie, body: { goal: 'strength' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.goal, 'strength');

  // Új kapcsolat: az edző a sportoló CÍMKÉJÉT látja, nem a nyers kulcsot
  const invite = await request('POST', '/api/athletes', {
    cookie: coach.cookie, body: { username: 'sportolo' },
  });
  assert.equal(invite.status, 201);
  assert.equal(invite.json.goal, strength.tag);

  await request('POST', `/api/coach/invites/${invite.json.linkId}/accept`, { cookie: athlete.cookie });
  const card = (await request('GET', '/api/athletes', { cookie: coach.cookie })).json.athletes[0];
  assert.equal(card.goal, strength.tag);

  const cleared = await request('PUT', '/api/user', { cookie: athlete.cookie, body: { goal: '' } });
  assert.equal(cleared.json.goal, null, 'a cél törölhető');
});
