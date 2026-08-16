/**
 * FitTrack Pro — a jelszó- és munkamenet-kezelés unit-tesztjei
 * -------------------------------------------------------------
 * A beépített `node:test` futtatóval (`npm test`), nulla új függőséggel.
 * A server/auth.js tiszta függvényekből áll (nem ismeri sem az adatbázist,
 * sem az Expresst), ezért itt önmagában ellenőrizhető.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hashPassword, verifyPassword, createSessionToken, hashToken,
  parseCookies, serializeCookie, isLockedOut, recordFailure, clearFailures,
  USERNAME_RE, normalizeUsername,
} from './auth.js';

test('a jelszó-hash ellenőrizhető, de nem visszafejthető', async () => {
  const hash = await hashPassword('helyes ló elem kapocs');

  assert.ok(await verifyPassword('helyes ló elem kapocs', hash), 'a jó jelszó átmegy');
  assert.equal(await verifyPassword('rossz jelszó', hash), false);
  assert.equal(await verifyPassword('', hash), false);

  // A hash nem tartalmazhatja a jelszót, és a paraméterei benne vannak
  assert.ok(!hash.includes('helyes'), 'a jelszó nem szerepel a hashben');
  assert.match(hash, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});

test('ugyanaz a jelszó kétszer más hasht ad (külön só)', async () => {
  const [a, b] = await Promise.all([hashPassword('azonos jelszó'), hashPassword('azonos jelszó')]);
  assert.notEqual(a, b, 'két hash sosem egyezhet — különben a só nem működik');
  assert.ok(await verifyPassword('azonos jelszó', a));
  assert.ok(await verifyPassword('azonos jelszó', b));
});

test('sérült vagy hiányzó hash mindig hamis — sosem dob', async () => {
  for (const stored of [
    '', null, undefined, 'akármi', 'scrypt$rossz', 'scrypt$16384$8$1$só',
    'scrypt$16384$8$1$abcd$',              // üres kulcs
    'scrypt$nemszám$8$1$abcd$beef',        // értelmezhetetlen paraméter
    'bcrypt$16384$8$1$abcd$beef',          // más algoritmus
  ]) {
    assert.equal(await verifyPassword('bármi', stored), false, `elbukik erre: ${stored}`);
  }
});

test('az ÜRES hash (archív fiók) sosem enged be', async () => {
  // A fiókok bevezetése előtti adatot egy jelszó nélküli archív fiók tartja,
  // amíg az első regisztráció át nem veszi. Belépni vele nem szabad.
  assert.equal(await verifyPassword('', ''), false);
  assert.equal(await verifyPassword('bármi', ''), false);
});

test('a munkamenet-token véletlen, és a lenyomata determinisztikus', () => {
  const a = createSessionToken();
  const b = createSessionToken();
  assert.notEqual(a, b, 'két token nem lehet azonos');
  assert.ok(a.length >= 40, 'elég hosszú (32 bájt base64url)');
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'sütibe tehető karakterek');

  assert.equal(hashToken(a), hashToken(a), 'ugyanaz a token ugyanazt a lenyomatot adja');
  assert.notEqual(hashToken(a), hashToken(b));
  assert.ok(!hashToken(a).includes(a), 'a lenyomatból nem olvasható ki a token');
});

test('parseCookies', () => {
  assert.deepEqual(parseCookies('a=1; b=2'), { a: '1', b: '2' });
  assert.deepEqual(parseCookies('fittrack_session=abc%2Fdef'), { fittrack_session: 'abc/def' });
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('hibás'), {}, 'egyenlőségjel nélküli rész kimarad');
  // Hibás %-kódolás nem dobhat — a kérés ettől még kiszolgálandó
  assert.deepEqual(parseCookies('x=%'), { x: '%' });
});

test('serializeCookie — a védő jelzők mindig rajta vannak', () => {
  const cookie = serializeCookie('fittrack_session', 'token123', { maxAge: 60 });
  assert.match(cookie, /^fittrack_session=token123/);
  assert.ok(cookie.includes('HttpOnly'), 'JS-ből ne legyen olvasható');
  assert.ok(cookie.includes('SameSite=Lax'), 'más oldalról ne menjen el');
  assert.ok(cookie.includes('Max-Age=60'));
  assert.ok(!cookie.includes('Secure'), 'HTTP-n a Secure kizárná a belépést');

  assert.ok(serializeCookie('x', 'y', { secure: true }).includes('Secure'));
  assert.ok(serializeCookie('x', '', { maxAge: 0 }).includes('Max-Age=0'), 'törléshez');
});

test('a belépési kísérlet-korlát a 10. hiba után zár, sikerre nullázódik', () => {
  const key = `teszt-${Math.random()}`;
  const now = Date.now();

  for (let i = 0; i < 9; i++) recordFailure(key, now);
  assert.equal(isLockedOut(key, now), false, '9 hiba után még mehet');

  recordFailure(key, now);
  assert.equal(isLockedOut(key, now), true, 'a 10. hiba zár');

  // Az ablak lejártával magától felenged
  assert.equal(isLockedOut(key, now + 16 * 60 * 1000), false, '15 perc után újra próbálható');

  for (let i = 0; i < 10; i++) recordFailure(key, now);
  clearFailures(key);
  assert.equal(isLockedOut(key, now), false, 'sikeres belépés törli a számlálót');
});

test('felhasználónév-szabályok', () => {
  assert.equal(normalizeUsername('  ANNA  '), 'anna', 'trimmel és kisbetűsít');

  for (const ok of ['anna', 'a_b-c.d', 'user123', 'abc']) {
    assert.ok(USERNAME_RE.test(ok), `érvényes: ${ok}`);
  }
  for (const bad of ['ab', '', 'a'.repeat(25), 'Anna', 'két szó', 'ékezetes', 'a@b']) {
    assert.equal(USERNAME_RE.test(bad), false, `érvénytelen: ${bad}`);
  }
});
