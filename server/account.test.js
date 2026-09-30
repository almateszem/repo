/**
 * FitTrack Pro — jelszóváltoztatás és fióktörlés (végponti tesztek)
 * ----------------------------------------------------------------
 * Két olyan műveletről van szó, amit rosszul csinálni drága: az egyik kizárhat
 * a saját fiókodból, a másik véglegesen töröl mindent. Ezért itt nem csak a
 * boldog út számít, hanem az is, hogy
 *   - a MUNKAMENET önmagában nem elég hozzájuk (a jelszó is kell),
 *   - jelszóváltás után a KORÁBBI munkamenetek megszűnnek (más eszköz, lopott
 *     süti), a változtató böngészője viszont bent marad,
 *   - a törlés tényleg mindent visz — a másik félnél lévő üzeneteket is —,
 *     és nem hagy gazdátlan sorokat.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, gyakorlat as buildGyakorlat } from './test-harness.js';

const { request, cookieFrom } = await startServer({ label: 'account' });

const register = async (username, displayName, password = 'jelszo123') =>
  cookieFrom(
    await request('POST', '/api/auth/register', { body: { username, displayName, password } }),
  );
const login = async (username, password) =>
  cookieFrom(await request('POST', '/api/auth/login', { body: { username, password } }));

const gyakorlat = () => [buildGyakorlat('Guggolás', 100)];

/* ======================================================================
   1. Jelszóváltoztatás
   ====================================================================== */

test('a fiók-műveletek bejelentkezés nélkül nem érhetők el', async () => {
  const pwd = await request('PUT', '/api/auth/password', {
    body: { currentPassword: 'jelszo123', newPassword: 'ujjelszo123' },
  });
  assert.equal(pwd.status, 401);

  const del = await request('POST', '/api/auth/delete-account', {
    body: { password: 'jelszo123' },
  });
  assert.equal(del.status, 401);
});

test('a jelszóváltás kéri a jelenlegi jelszót, és ellenőrzi az újat', async () => {
  const cookie = await register('valto', 'Váltó Vilmos');

  const wrong = await request('PUT', '/api/auth/password', {
    cookie,
    body: { currentPassword: 'nemez1234', newPassword: 'ujjelszo123' },
  });
  assert.equal(wrong.status, 401, 'a munkamenet önmagában nem elég');

  const short = await request('PUT', '/api/auth/password', {
    cookie,
    body: { currentPassword: 'jelszo123', newPassword: 'rovid' },
  });
  assert.equal(short.status, 400);

  const same = await request('PUT', '/api/auth/password', {
    cookie,
    body: { currentPassword: 'jelszo123', newPassword: 'jelszo123' },
  });
  assert.equal(same.status, 400, 'ugyanaz a jelszó nem „változtatás"');

  // A hibás próbálkozások után is működik a helyes csere
  const ok = await request('PUT', '/api/auth/password', {
    cookie,
    body: { currentPassword: 'jelszo123', newPassword: 'ujjelszo123' },
  });
  assert.equal(ok.status, 200);
});

test('jelszóváltás után a többi eszköz kiesik, a változtató böngészője bent marad', async () => {
  await register('ketgep', 'Két Gép');
  const laptop = await login('ketgep', 'jelszo123');
  const telefon = await login('ketgep', 'jelszo123');

  const changed = await request('PUT', '/api/auth/password', {
    cookie: laptop,
    body: { currentPassword: 'jelszo123', newPassword: 'masikjelszo1' },
  });
  assert.equal(changed.status, 200);
  const laptopUtan = cookieFrom(changed);
  assert.ok(laptopUtan && laptopUtan !== laptop, 'a válasz FRISS munkamenet-sütit ad');

  assert.equal(
    (await request('GET', '/api/user', { cookie: laptopUtan })).status,
    200,
    'a változtató böngészője használható marad',
  );
  assert.equal(
    (await request('GET', '/api/user', { cookie: telefon })).status,
    401,
    'a másik eszköz munkamenete megszűnt',
  );
  assert.equal(
    (await request('GET', '/api/user', { cookie: laptop })).status,
    401,
    'a régi süti sem él tovább',
  );

  assert.equal(
    (
      await request('POST', '/api/auth/login', {
        body: { username: 'ketgep', password: 'jelszo123' },
      })
    ).status,
    401,
    'a régi jelszó nem jó többé',
  );
  assert.equal(
    (
      await request('POST', '/api/auth/login', {
        body: { username: 'ketgep', password: 'masikjelszo1' },
      })
    ).status,
    200,
  );
});

/* ======================================================================
   2. Fióktörlés
   ====================================================================== */

test('a törlés jelszó nélkül nem megy végbe', async () => {
  const cookie = await register('marado', 'Maradó Márió');
  const wrong = await request('POST', '/api/auth/delete-account', {
    cookie,
    body: { password: 'nemez1234' },
  });
  assert.equal(wrong.status, 401);
  assert.equal((await request('GET', '/api/user', { cookie })).status, 200, 'a fiók megvan');
});

test('a törlés mindent visz: naplók, kapcsolatok, üzenetek — a másik félnél is', async () => {
  const coach = await register('mentor', 'Mentor Márta');
  const athlete = await register('tanitvany', 'Tanítvány Tamás');

  // Kapcsolat + üzenetváltás + saját napló
  const invite = await request('POST', '/api/athletes', {
    cookie: coach,
    body: { username: 'tanitvany' },
  });
  await request('POST', `/api/coach/invites/${invite.json.linkId}/accept`, { cookie: athlete });
  await request('POST', `/api/messages/${invite.json.linkId}`, {
    cookie: coach,
    body: { text: 'Szia, kezdjük!' },
  });
  await request('POST', '/api/workouts', {
    cookie: athlete,
    body: { name: 'Alsótest', exercises: gyakorlat() },
  });
  assert.equal((await request('GET', '/api/athletes', { cookie: coach })).json.athletes.length, 1);

  const deleted = await request('POST', '/api/auth/delete-account', {
    cookie: athlete,
    body: { password: 'jelszo123' },
  });
  assert.equal(deleted.status, 200);
  assert.ok((deleted.setCookie[0] ?? '').includes('Max-Age=0'), 'a süti is törlődik');

  assert.equal(
    (await request('GET', '/api/user', { cookie: athlete })).status,
    401,
    'a munkamenet megszűnt',
  );
  assert.equal(
    (
      await request('POST', '/api/auth/login', {
        body: { username: 'tanitvany', password: 'jelszo123' },
      })
    ).status,
    401,
    'a törölt fiókkal nem lehet belépni',
  );

  // Az edzőnél sem marad utána semmi
  const panel = await request('GET', '/api/athletes', { cookie: coach });
  assert.deepEqual(panel.json.athletes, [], 'lekerült az edzői panelről');
  assert.deepEqual(panel.json.invites, []);
  assert.equal(
    (await request('GET', `/api/messages/${invite.json.linkId}`, { cookie: coach })).status,
    404,
    'a beszélgetés is eltűnt — a másik fél sem őrzi tovább',
  );
});

test('a törölt felhasználónév újra kiadható, és az új fiók ÜRESEN indul', async () => {
  const cookie = await register('ujrakezdo', 'Újrakezdő Ubul');
  await request('POST', '/api/workouts', {
    cookie,
    body: { name: 'Régi edzés', exercises: gyakorlat() },
  });
  await request('POST', '/api/auth/delete-account', { cookie, body: { password: 'jelszo123' } });

  const ujra = await request('POST', '/api/auth/register', {
    body: { username: 'ujrakezdo', displayName: 'Másik Ubul', password: 'masikjelszo1' },
  });
  assert.equal(ujra.status, 201, 'a név felszabadult');

  const workouts = await request('GET', '/api/workouts', { cookie: cookieFrom(ujra) });
  assert.deepEqual(workouts.json, [], 'az új fiók NEM örökli a törölt fiók adatait');
});
