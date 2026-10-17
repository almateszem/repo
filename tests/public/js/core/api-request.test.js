/** Az api réteg közös kérés-magja: a hálózati hiba és a szerverhiba magyar
    mondattá válik (a hívóhelyek `err.message || 'magyar szöveg'` tartaléka
    ugyanis sosem futott le — a „Failed to fetch" és a „POST … → 502" ment ki
    a felületre), az AbortError érintetlenül megy tovább, a 401 pedig csak a
    hagyományos hívásoknál munkamenet-vesztés. */

import assert from 'node:assert/strict';
import test from 'node:test';

const { api, SESSION_LOST } = await import('../../../../public/js/core/api.js');
const { hooks } = await import('../../../../public/js/core/page-hooks.js');

let sessionLost = 0;
hooks.onSessionLost = () => {
  sessionLost += 1;
};

/** A következő fetch válasza: egy Response, vagy egy dobott hiba. */
const respond = (outcome) => {
  globalThis.fetch = async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
};
const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const failureOf = async (call) => {
  try {
    await call();
  } catch (err) {
    return err;
  }
  assert.fail('a hívásnak hibát kellett volna dobnia');
};

const NETWORK = 'Nincs kapcsolat a szerverrel — próbáld újra.';
const UNAVAILABLE = 'A szerver most nem érhető el — próbáld újra.';
const SERVER_ERROR = 'Szerverhiba — próbáld újra.';

/** Mind az öt burkoló egy-egy képviselője. */
const CALLS = {
  getJson: () => api.getWorkouts(),
  getJsonDetailed: () => api.lookupBarcode('123'),
  sendJson: () => api.saveCheckin({ sleepHours: 7 }),
  del: () => api.deleteWorkout(1),
  authRequest: () => api.login('anna', 'jelszo123'),
};

test('hálózati hiba (fetch TypeError) → magyar üzenet, err.code = network', async () => {
  for (const [name, call] of Object.entries(CALLS)) {
    respond(new TypeError('Failed to fetch'));
    const err = await failureOf(call);
    assert.equal(err.message, NETWORK, name);
    assert.equal(err.code, 'network', name);
  }
});

test('a belépés ellenőrzése (api.me) is magyar üzenetet ad hálózati hibánál', async () => {
  respond(new TypeError('Failed to fetch'));
  const err = await failureOf(() => api.me());
  assert.equal(err.message, NETWORK);
});

test('AbortError változatlanul megy tovább', async () => {
  const abort = new DOMException('The operation was aborted.', 'AbortError');
  respond(abort);
  const err = await failureOf(() => api.searchExercises({ q: 'gugg' }));
  assert.equal(err, abort);
});

test('502/503/504 → „nem érhető el", más 5xx → „Szerverhiba"', async () => {
  for (const [name, call] of Object.entries(CALLS)) {
    for (const status of [502, 503, 504]) {
      respond(new Response('<html>Bad Gateway</html>', { status }));
      assert.equal((await failureOf(call)).message, UNAVAILABLE, `${name} ${status}`);
    }
    respond(new Response('', { status: 500 }));
    assert.equal((await failureOf(call)).message, SERVER_ERROR, `${name} 500`);
  }
});

test('a szerver `error` mezője elsőbbséget élvez', async () => {
  for (const [name, call] of Object.entries(CALLS)) {
    respond(json(500, { error: 'Az adatbázis most nem írható.' }));
    assert.equal((await failureOf(call)).message, 'Az adatbázis most nem írható.', name);
    respond(json(409, { error: 'Ütközés.' }));
    assert.equal((await failureOf(call)).message, 'Ütközés.', name);
  }
});

test('egyéb státusz error mező nélkül → a régi, nyers szöveg', async () => {
  respond(json(404));
  assert.equal((await failureOf(CALLS.getJson)).message, 'GET /api/workouts → 404');
  respond(json(404));
  assert.equal((await failureOf(CALLS.sendJson)).message, 'PUT /api/checkin → 404');
  respond(json(404));
  assert.equal((await failureOf(CALLS.del)).message, 'DELETE /api/workouts/1 → 404');
  respond(json(404));
  assert.equal((await failureOf(CALLS.authRequest)).message, 'Hiba (404)');
});

test('401 → SESSION_LOST a hagyományos hívásoknál, az authRequest-nél nem', async () => {
  for (const name of ['getJson', 'getJsonDetailed', 'sendJson', 'del']) {
    sessionLost = 0;
    respond(json(401, { error: 'Nincs bejelentkezve.' }));
    const err = await failureOf(CALLS[name]);
    assert.equal(err.code, SESSION_LOST, name);
    assert.equal(sessionLost, 1, name);
  }
  sessionLost = 0;
  respond(json(401, { error: 'Hibás felhasználónév vagy jelszó.' }));
  const err = await failureOf(CALLS.authRequest);
  assert.equal(err.message, 'Hibás felhasználónév vagy jelszó.');
  assert.notEqual(err.code, SESSION_LOST);
  assert.equal(sessionLost, 0);
});

test('a 401 az api.me-nél továbbra is a „nincs belépve" normális válasza', async () => {
  sessionLost = 0;
  respond(json(401, { error: 'Nincs bejelentkezve.', firstRun: true }));
  assert.deepEqual(await api.me(), { user: null, firstRun: true });
  assert.equal(sessionLost, 0);
});

test('err.status és err.detail megmarad', async () => {
  respond(json(409, { error: 'A javaslat elavult.', fresh: true }));
  const err = await failureOf(CALLS.sendJson);
  assert.equal(err.status, 409);
  assert.deepEqual(err.detail, { error: 'A javaslat elavult.', fresh: true });
  respond(json(404, { error: 'Ismeretlen kód.' }));
  assert.equal((await failureOf(CALLS.getJsonDetailed)).status, 404);
});

test('a sikeres válaszok alakja változatlan', async () => {
  respond(json(200, [{ id: 1 }]));
  assert.deepEqual(await api.getWorkouts(), [{ id: 1 }]);
  respond(new Response(null, { status: 204 }));
  assert.equal(await api.deleteWorkout(1), undefined);
  respond(new Response(null, { status: 204 }));
  assert.equal(await api.logout(), null);
  respond(json(200, { id: 1, username: 'anna' }));
  assert.deepEqual(await api.me(), { user: { id: 1, username: 'anna' }, firstRun: false });
});
