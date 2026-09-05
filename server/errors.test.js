/**
 * FitTrack Pro — a hibakezelő védőháló tesztjei
 * ---------------------------------------------
 * Ez a fájl azt őrzi, ami eddig hiányzott: hogy egy elszálló végpont VÁLASZT
 * adjon, és hogy a hiba részletei NE menjenek ki a kliensnek.
 *
 * A legfontosabb eset az async kezelő elutasított ígérete. Express 4 ezt magától
 * nem kapja el: kezelő nélkül a kérés válasz nélkül maradna (a böngésző örökre
 * pörögne), a Node 22 pedig a folyamatot is leállítaná. Ha valaki a
 * guardAsyncRoutes hívást kiveszi a server.js-ből, ennek a fájlnak el kell
 * buknia — ezért éles Express-alkalmazáson mérünk, nem utánzaton.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { guardAsyncRoutes, apiErrorHandler, installProcessGuards } from './errors.js';

/** Elindít egy kis Express appot szabad porton, és visszaad egy fetch-előt. */
async function startApp(build) {
  const app = express();
  guardAsyncRoutes(app);            // ugyanúgy, ahogy a server.js teszi
  app.use(express.json());
  build(app);
  app.use(apiErrorHandler);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  /* Időkorlát a kérésekre. Nem óvatoskodás: védőháló NÉLKÜL a szerver
     egyáltalán nem válaszol, és e nélkül a teszt nem elbukna, hanem
     BERAGADNA — egy beragadt teszt pedig nem mondja meg, mi a baj. */
  const withTimeout = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(3000) })
    .catch((err) => {
      if (err.name === 'TimeoutError') assert.fail(`a szerver nem válaszolt: ${url}`);
      throw err;
    });
  return {
    get: (p) => withTimeout(base + p),
    post: (p, body, headers) => withTimeout(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    }),
    close: () => new Promise((r) => server.close(r)),
  };
}

/* A hibakezelő szándékosan a szerver-logba ír. A tesztfuttató kimenetét viszont
   nem szemeteljük tele a VÁRT hibákkal — a hívások tényét külön ellenőrizzük. */
function silenceErrorLog() {
  const original = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  return { calls, restore: () => { console.error = original; } };
}

test('az async kezelő elutasított ígérete 500-as JSON-t ad, nem néma kérést', async () => {
  const log = silenceErrorLog();
  const app = await startApp((a) => {
    a.get('/boom', async () => { throw new Error('adatbázis /var/lib/fittrack.db megnyitása sikertelen'); });
  });
  try {
    const res = await app.get('/boom');
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Váratlan szerverhiba — próbáld újra később.');
    assert.equal(log.calls.length, 1, 'a hiba a szerver-logba kerül');
  } finally {
    await app.close();
    log.restore();
  }
});

test('a szinkron dobás ugyanoda fut be', async () => {
  const log = silenceErrorLog();
  const app = await startApp((a) => {
    a.get('/throw', () => { throw new Error('szinkron baj'); });
  });
  try {
    const res = await app.get('/throw');
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error, 'Váratlan szerverhiba — próbáld újra később.');
  } finally {
    await app.close();
    log.restore();
  }
});

test('a hiba RÉSZLETEI nem szivárognak ki a válaszba', async () => {
  const log = silenceErrorLog();
  const secret = 'SELECT * FROM users WHERE id = 42';
  const app = await startApp((a) => {
    a.get('/leak', async () => { throw new Error(secret); });
  });
  try {
    const text = await (await app.get('/leak')).text();
    assert.ok(!text.includes(secret), 'az üzenet nem mehet ki');
    assert.ok(!text.includes('at '), 'veremkép sem mehet ki');
    assert.ok(!text.includes('errors.test.js'), 'fájlnév sem mehet ki');
    // …de a szerver oldalán mindez megvan, különben nem lehetne javítani.
    assert.ok(log.calls.flat().some((a) => a instanceof Error && a.message === secret));
  } finally {
    await app.close();
    log.restore();
  }
});

test('a status-t hordozó 4xx hibák üzenete átmegy (ezek nem belső információ)', async () => {
  const log = silenceErrorLog();
  const app = await startApp((a) => {
    a.get('/nope', () => {
      const err = new Error('Ez a naptár nem a tiéd.');
      err.status = 403;
      throw err;
    });
  });
  try {
    const res = await app.get('/nope');
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'Ez a naptár nem a tiéd.');
  } finally {
    await app.close();
    log.restore();
  }
});

test('a hibás JSON-törzs 400-as JSON-t kap, nem HTML-t', async () => {
  const log = silenceErrorLog();
  const app = await startApp((a) => { a.post('/echo', (req, res) => res.json(req.body)); });
  try {
    const res = await app.post('/echo', '{ ez nem json ');
    assert.equal(res.status, 400);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal((await res.json()).error, 'Hibás JSON a kérés törzsében.');
  } finally {
    await app.close();
    log.restore();
  }
});

test('a négyparaméteres hibakezelőt NEM csomagoljuk be — az Express felismeri', () => {
  const app = express();
  guardAsyncRoutes(app);
  const handler = (err, req, res, next) => next(err);
  let seen = null;
  app.use = ((original) => (...args) => { seen = args[args.length - 1]; return original(...args); })(app.use.bind(app));
  app.use(handler);
  assert.equal(seen.length, 4, 'a paraméterszám megmarad, különben nem hibakezelő');
});

test('a becsomagolt kezelő megtartja az aritását és a nevét', () => {
  const app = express();
  const registered = [];
  app.get = (...args) => { registered.push(...args.slice(1)); return app; };
  guardAsyncRoutes(app);
  async function sajatKezelo(req, res) { res.end(); }
  app.get('/x', sajatKezelo);
  assert.equal(registered[0].length, 2);
  assert.equal(registered[0].name, 'sajatKezelo');
});

test('az elárvult ígéret-elutasítás naplózódik, de NEM állítja le a szervert', async () => {
  const log = silenceErrorLog();
  const before = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  let exited = null;
  try {
    installProcessGuards(null, { exit: (c) => { exited = c; } });
    process.emit('unhandledRejection', new Error('elárvult'), Promise.resolve());
    assert.equal(exited, null, 'nem lépünk ki');
    assert.ok(log.calls.flat().some((a) => String(a).includes('a szerver fut tovább')));
  } finally {
    process.removeAllListeners('unhandledRejection');
    for (const l of before) process.on('unhandledRejection', l);
    process.removeAllListeners('uncaughtException');
    log.restore();
  }
});

test('az elkapatlan kivétel rendezett leállást indít', async () => {
  const log = silenceErrorLog();
  const beforeUncaught = process.listeners('uncaughtException');
  const beforeRejection = process.listeners('unhandledRejection');
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  let exited = null;
  let closed = false;
  const fakeServer = { close(cb) { closed = true; cb(); } };
  try {
    installProcessGuards(fakeServer, { exit: (c) => { exited = c; } });
    process.emit('uncaughtException', new Error('végzetes'));
    assert.ok(closed, 'a szerver nem fogad több kérést');
    assert.equal(exited, 1, 'nullától eltérő kóddal lépünk ki, hogy a felügyelő újraindítson');
  } finally {
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    for (const l of beforeUncaught) process.on('uncaughtException', l);
    for (const l of beforeRejection) process.on('unhandledRejection', l);
    log.restore();
  }
});
