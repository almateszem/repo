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
  return { status: res.status, json, setCookie, retryAfter: res.headers.get('retry-after') };
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
  assert.deepEqual(theirs.json, { coach: null, invites: [], planOffers: [] });

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
   5. Értesítések — a panel valódi eseményekből
   ====================================================================== */

test('az értesítés-panel a hívó valódi eseményeiből áll össze', async () => {
  /* Kiindulás: a kapcsolat él (a sportoló elfogadta a meghívót), a sportoló
     ma naplózott egy guggolást, és az edző már mindent elolvasott. */
  const forCoach = (await request('GET', '/api/notifications', { cookie: coach.cookie })).json;

  const accepted = forCoach.find((n) => n.cat === 'coach');
  assert.ok(accepted, 'az elfogadott meghívó értesítés');
  assert.equal(accepted.text, 'Nagy Petra elfogadta a meghívódat');
  assert.ok(accepted.at, 'valódi időbélyeggel — nem „5 órája"');

  assert.equal(
    forCoach.some((n) => n.cat === 'message'), false,
    'elolvasott szálra nincs üzenet-értesítés',
  );

  /* A sportoló oldala más: neki az edző üzenete még olvasatlan, és a saját
     mai csúcsa is friss esemény. Elfogadott meghívója viszont NINCS —
     ő fogadta el a másikét. */
  const forAthlete = (await request('GET', '/api/notifications', { cookie: athlete.cookie })).json;

  /* Az edző két üzenete vár rá olvasatlanul, tehát az ÖSSZEVONT alak jár —
     szálanként egy sor akkor is, ha közben tíz üzenet gyűlt össze. */
  const message = forAthlete.find((n) => n.cat === 'message');
  assert.ok(message, 'az olvasatlan üzenet értesítés');
  assert.equal(message.text, '2 új üzenet — Kovács Bence');

  const pr = forAthlete.find((n) => n.cat === 'pr');
  assert.ok(pr, 'a mai guggolás egyéni csúcsa is esemény');
  assert.match(pr.text, /^Új egyéni csúcs: Guggolás — \d+ kg \(becsült 1RM\)$/);

  assert.equal(
    forAthlete.some((n) => n.text.includes('elfogadta a meghívódat')), false,
    'nem a sportoló meghívóját fogadták el',
  );

  // Időrend: a lista legfrissebbel kezdődik
  const times = forAthlete.map((n) => n.at);
  assert.deepEqual(times, [...times].sort().reverse(), 'legfrissebb elöl');
});

test('az olvasatlan üzenet értesítése a nyugtázással eltűnik', async () => {
  await request('POST', `/api/messages/${linkId}`, {
    cookie: athlete.cookie, body: { text: 'Holnap pótolom!' },
  });

  const before = (await request('GET', '/api/notifications', { cookie: coach.cookie })).json;
  const item = before.find((n) => n.cat === 'message');
  assert.equal(item.text, 'Új üzenet — Nagy Petra: „Holnap pótolom!”');

  await request('POST', `/api/messages/${linkId}/read`, { cookie: coach.cookie });

  const after = (await request('GET', '/api/notifications', { cookie: coach.cookie })).json;
  assert.equal(
    after.some((n) => n.cat === 'message'), false,
    'az elolvasott szál nem értesít tovább — a panel magától tisztul',
  );
});

test('a panel SEM szivárogtat: a kívülálló csak a sajátját látja', async () => {
  const mine = (await request('GET', '/api/notifications', { cookie: outsider.cookie })).json;
  assert.deepEqual(mine, [], 'nincs kapcsolata és nincs naplója — nincs értesítése sem');

  const unauth = await request('GET', '/api/notifications');
  assert.equal(unauth.status, 401, 'bejelentkezés nélkül nem is kérdezhető');
});

/* ======================================================================
   6. Egy edző egyszerre, és a leválás
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

/* ======================================================================
   7. Üzenet-korlát
   ----------------------------------------------------------------------
   A LEGVÉGÉN áll, saját szereplőkkel: húsz üzenet elküldése szükségképpen
   szétzilálná a fenti tesztek gondosan felépített szál-állapotát (olvasatlan
   számok, idézett utolsó üzenet, értesítések).
   ====================================================================== */

test('az üzenet-özön 429-et kap, Retry-After fejléccel — fiókonként', async () => {
  const spammer = { cookie: await register('spammer', 'Türelmetlen Tamás') };
  const target = { cookie: await register('cimzett', 'Címzett Cili') };

  const invite = await request('POST', '/api/athletes', {
    cookie: spammer.cookie, body: { username: 'cimzett' },
  });
  assert.equal(invite.status, 201);
  const spamLink = invite.json.linkId;
  await request('POST', `/api/coach/invites/${spamLink}/accept`, { cookie: target.cookie });

  /* A korlát percenként 20 üzenet fiókonként. Szigorúbb, mint az általános
     írás-korlát, mert a szemetet itt egy MÁSIK ember nézi végig. */
  let limited = null;
  let sent = 0;
  for (let i = 0; i < 30 && !limited; i += 1) {
    const res = await request('POST', `/api/messages/${spamLink}`, {
      cookie: spammer.cookie, body: { text: `Sorozat ${i}` },
    });
    if (res.status === 429) limited = res;
    else sent += 1;
  }

  assert.ok(limited, 'a 30 üzenet valahol elakad');
  assert.equal(sent, 20, 'pontosan a limitig enged át');
  assert.match(limited.json.error, /gyorsan/, 'a hibaüzenet megmondja, mi a baj');
  assert.ok(Number(limited.retryAfter) > 0, `Retry-After fejléc: ${limited.retryAfter}`);

  // A MÁSIK fél korlátja ettől érintetlen: a számláló fiókonként vezet
  const other = await request('POST', `/api/messages/${spamLink}`, {
    cookie: target.cookie, body: { text: 'Én még írhatok.' },
  });
  assert.equal(other.status, 201, 'a címzett nem issza meg a spammer levét');

  // Az olvasás viszont nem korlátozott — a torlódást az írás okozza
  const read = await request('GET', `/api/messages/${spamLink}`, { cookie: spammer.cookie });
  assert.equal(read.status, 200, 'a szálát továbbra is elolvashatja');
  assert.equal(read.json.messages.length, 21);
});

/* ======================================================================
   8. Terv-kiosztás
   ----------------------------------------------------------------------
   A hangsúly itt is a HOZZÁFÉRÉSEN van: az edző a saját tervei közül ajánl,
   a sportoló fiókjába pedig csak az ELFOGADÁSSAL kerül be bármi — és akkor
   is a meglévő tervei MELLÉ, sosem helyettük.
   ====================================================================== */

test('a kiosztás mindkét irányban jogosultságot kér', async () => {
  const trainer = { cookie: await register('terv-edzo', 'Terv Tibor') };
  const client = { cookie: await register('terv-sportolo', 'Terv Tímea') };
  const stranger = { cookie: await register('terv-idegen', 'Kotnyeles Kata') };

  const invite = await request('POST', '/api/athletes', {
    cookie: trainer.cookie, body: { username: 'terv-sportolo' },
  });
  const link = invite.json.linkId;

  const own = await request('POST', '/api/plans', {
    cookie: trainer.cookie,
    body: { name: 'Erő alapozó', exercises: [gyakorlat('Guggolás', 100)], days: [0, 3] },
  });
  assert.equal(own.status, 201);

  // FÜGGŐ kapcsolatba még nem lehet kiosztani
  const early = await request('POST', `/api/athletes/${link}/plan`, {
    cookie: trainer.cookie, body: { planId: own.json.id },
  });
  assert.equal(early.status, 404, 'elfogadás előtt nincs mibe kiosztani');

  await request('POST', `/api/coach/invites/${link}/accept`, { cookie: client.cookie });

  // Idegen nem oszthat ki ebbe a kapcsolatba
  const outsiderTry = await request('POST', `/api/athletes/${link}/plan`, {
    cookie: stranger.cookie, body: { planId: own.json.id },
  });
  assert.equal(outsiderTry.status, 404);

  // A SPORTOLÓ sem oszthat ki az edzőjének: a kiosztás egyirányú
  const backwards = await request('POST', `/api/athletes/${link}/plan`, {
    cookie: client.cookie, body: { planId: own.json.id },
  });
  assert.equal(backwards.status, 404, 'a kapcsolat sportoló-oldala nem oszthat ki');

  // Más tervére sem lehet hivatkozni az azonosítójával
  const clientPlan = await request('POST', '/api/plans', {
    cookie: client.cookie,
    body: { name: 'A sajátom', exercises: [gyakorlat('Fekvenyomás', 80)], days: [1] },
  });
  const foreign = await request('POST', `/api/athletes/${link}/plan`, {
    cookie: trainer.cookie, body: { planId: clientPlan.json.id },
  });
  assert.equal(foreign.status, 404, 'csak a SAJÁT tervét oszthatja ki');

  const noPlan = await request('POST', `/api/athletes/${link}/plan`, {
    cookie: trainer.cookie, body: {},
  });
  assert.equal(noPlan.status, 400);

  /* A tényleges kiosztás. A sportoló tervei EKKOR MÉG változatlanok — az
     ajánlat nem írás a fiókjába. */
  const assigned = await request('POST', `/api/athletes/${link}/plan`, {
    cookie: trainer.cookie, body: { planId: own.json.id, note: 'Jövő héttől ezzel kezdjük.' },
  });
  assert.equal(assigned.status, 201);
  assert.equal(assigned.json.name, 'Erő alapozó');

  const beforeAccept = await request('GET', '/api/plans', { cookie: client.cookie });
  assert.deepEqual(
    beforeAccept.json.map((p) => p.name), ['A sajátom'],
    'elfogadás előtt semmi nem került a terveihez',
  );

  // Az ajánlat a sportoló Edző oldalán jelenik meg, a tartalmával együtt
  const offers = (await request('GET', '/api/coach', { cookie: client.cookie })).json.planOffers;
  assert.equal(offers.length, 1);
  assert.equal(offers[0].from, 'Terv Tibor');
  assert.equal(offers[0].note, 'Jövő héttől ezzel kezdjük.');
  assert.deepEqual(offers[0].days, [0, 3]);
  assert.equal(offers[0].exercises.length, 1, 'látja, MIT fogad el');

  // Idegen nem fogadhatja el a más nevére szóló ajánlatot
  const steal = await request('POST', `/api/plan-offers/${offers[0].id}/accept`, {
    cookie: stranger.cookie,
  });
  assert.equal(steal.status, 404);

  /* Elfogadás: a terv MÁSOLATKÉNT kerül be, a sajátja mellé. */
  const accept = await request('POST', `/api/plan-offers/${offers[0].id}/accept`, {
    cookie: client.cookie,
  });
  assert.equal(accept.status, 201);
  assert.equal(accept.json.name, 'Erő alapozó');

  const afterAccept = await request('GET', '/api/plans', { cookie: client.cookie });
  assert.deepEqual(
    afterAccept.json.map((p) => p.name).sort(), ['A sajátom', 'Erő alapozó'],
    'a saját terve megmaradt — ez hozzáadás, nem felülírás',
  );

  // A kétszeri elfogadás nem duplázza a tervet
  const again = await request('POST', `/api/plan-offers/${offers[0].id}/accept`, {
    cookie: client.cookie,
  });
  assert.equal(again.status, 404, 'a lezárt ajánlat nem fogadható el újra');
  const stable = await request('GET', '/api/plans', { cookie: client.cookie });
  assert.equal(stable.json.length, 2);

  // Az edző értesítést kap a válaszról
  const notifs = (await request('GET', '/api/notifications', { cookie: trainer.cookie })).json;
  assert.ok(
    notifs.some((n) => n.cat === 'plan' && n.text === 'Terv Tímea elfogadta a „Erő alapozó” tervet'),
    `az elfogadás értesítés: ${JSON.stringify(notifs.map((n) => n.text))}`,
  );
});

test('az elutasított terv nem kerül be, és nem lóg ott tovább', async () => {
  const trainer = { cookie: await register('terv-edzo2', 'Másik Márton') };
  const client = { cookie: await register('terv-sportolo2', 'Nemet Nóra') };

  const invite = await request('POST', '/api/athletes', {
    cookie: trainer.cookie, body: { username: 'terv-sportolo2' },
  });
  const link = invite.json.linkId;
  await request('POST', `/api/coach/invites/${link}/accept`, { cookie: client.cookie });

  const own = await request('POST', '/api/plans', {
    cookie: trainer.cookie,
    body: { name: 'Nem kell', exercises: [gyakorlat('Felhúzás', 60)], days: [] },
  });
  await request('POST', `/api/athletes/${link}/plan`, {
    cookie: trainer.cookie, body: { planId: own.json.id },
  });

  const offers = (await request('GET', '/api/coach', { cookie: client.cookie })).json.planOffers;
  assert.equal(offers.length, 1);

  // A sportoló értesítése is megjelenik, amíg függő
  const pending = (await request('GET', '/api/notifications', { cookie: client.cookie })).json;
  assert.ok(pending.some((n) => n.text === 'Másik Márton kiosztotta a „Nem kell” tervet'));

  const decline = await request('DELETE', `/api/plan-offers/${offers[0].id}`, { cookie: client.cookie });
  assert.equal(decline.status, 204);

  const after = await request('GET', '/api/coach', { cookie: client.cookie });
  assert.deepEqual(after.json.planOffers, [], 'az elutasított ajánlat lekerül');

  const plans = await request('GET', '/api/plans', { cookie: client.cookie });
  assert.deepEqual(plans.json, [], 'és semmi nem került a tervei közé');

  // Az edző viszont MEGTUDJA, hogy nemet mondtak — a hallgatás rosszabb lenne
  const notifs = (await request('GET', '/api/notifications', { cookie: trainer.cookie })).json;
  assert.ok(
    notifs.some((n) => n.text === 'Nemet Nóra elutasította a „Nem kell” tervet'),
    `az elutasítás is esemény: ${JSON.stringify(notifs.map((n) => n.text))}`,
  );
});

test('a kapcsolat bontásával a függő terv-ajánlat is eltűnik', async () => {
  const trainer = { cookie: await register('terv-edzo3', 'Rövid Robi') };
  const client = { cookie: await register('terv-sportolo3', 'Váló Vera') };

  const invite = await request('POST', '/api/athletes', {
    cookie: trainer.cookie, body: { username: 'terv-sportolo3' },
  });
  const link = invite.json.linkId;
  await request('POST', `/api/coach/invites/${link}/accept`, { cookie: client.cookie });

  const own = await request('POST', '/api/plans', {
    cookie: trainer.cookie,
    body: { name: 'Elmarad', exercises: [gyakorlat('Evezés', 50)], days: [] },
  });
  await request('POST', `/api/athletes/${link}/plan`, {
    cookie: trainer.cookie, body: { planId: own.json.id },
  });

  await request('DELETE', '/api/coach', { cookie: client.cookie });

  const after = await request('GET', '/api/coach', { cookie: client.cookie });
  assert.deepEqual(after.json.planOffers, [], 'a bontott kapcsolat ajánlata nem marad ott');
});
