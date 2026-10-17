/** A felhasználói preferenciák fiókonként élnek (podium:prefs:<felhasználónév>).
    Korábban egyetlen böngésző-szintű kulcs volt: közös gépen a második fiók
    örökölte az elsőét — Béla Áttekintőjén „Anna" állt, és Anna olvasott-ideje
    Béla friss értesítéseit olvasottnak mutatta. */

import assert from 'node:assert/strict';
import test from 'node:test';

/** Map-alapú localStorage; a `broken` változat minden hívásra kivételt dob
    (privát mód, letiltott tároló). */
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
};
const brokenStorage = () => {
  const fail = () => {
    throw new Error('SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
};

let instance = 0;
/** Friss modul-példány (a prefs modul-szintű állapotot tart). */
const freshPrefs = async (storage) => {
  globalThis.localStorage = storage;
  instance += 1;
  return (await import(`../../../../public/js/core/prefs.js?v=${instance}`)).prefs;
};

test('prefs: két fiók egymástól elkülönítve', async () => {
  const storage = memoryStorage();
  const prefs = await freshPrefs(storage);
  prefs.bind('anna');
  prefs.set('displayName', 'Anna');
  prefs.set('notifSeenAt', '2026-10-17T10:00:00Z');
  prefs.unbind();

  prefs.bind('Bela'); // a kis-nagybetű nem számít, ahogy a szerveren sem
  assert.equal(prefs.get('displayName', 'szerver-név'), 'szerver-név');
  assert.equal(prefs.get('notifSeenAt', ''), '');
  prefs.set('coachView', 'manager');
  prefs.unbind();

  prefs.bind('ANNA ');
  assert.equal(prefs.get('displayName'), 'Anna');
  assert.equal(prefs.get('coachView', null), null);
  assert.ok(storage.data.has('podium:prefs:anna'));
  assert.ok(storage.data.has('podium:prefs:bela'));
});

test('prefs: a régi közös kulcsot az első belépő fiók veszi át, a második tiszta lappal indul', async () => {
  const storage = memoryStorage({
    'podium:prefs': JSON.stringify({ displayName: 'Anna', lastPage: 'workout' }),
  });
  const prefs = await freshPrefs(storage);
  prefs.bind('anna');
  assert.equal(prefs.get('displayName'), 'Anna');
  assert.equal(prefs.get('lastPage'), 'workout');
  assert.ok(!storage.data.has('podium:prefs'), 'a közös kulcs törlődött');
  prefs.unbind();

  prefs.bind('bela');
  assert.equal(prefs.get('displayName', null), null);
  assert.equal(prefs.get('lastPage', null), null);
});

test('prefs: a FitTrack-kori kulcsot is átveszi, ha nincs újabb', async () => {
  const storage = memoryStorage({ 'fittrackpro:prefs': JSON.stringify({ displayName: 'Régi' }) });
  const prefs = await freshPrefs(storage);
  prefs.bind('regi');
  assert.equal(prefs.get('displayName'), 'Régi');
  assert.ok(!storage.data.has('fittrackpro:prefs'));
});

test('prefs: megkötés előtt nem ír a közös kulcsra, és a fallbacket adja', async () => {
  const storage = memoryStorage({ 'podium:prefs': JSON.stringify({ displayName: 'Anna' }) });
  const prefs = await freshPrefs(storage);
  assert.equal(prefs.get('displayName', 'alap'), 'alap', 'a közös kulcsot sem olvassa');
  prefs.set('lastPage', 'nutrition');
  assert.equal(storage.data.get('podium:prefs'), JSON.stringify({ displayName: 'Anna' }));
  assert.equal(storage.data.size, 1, 'semmilyen kulcsra nem írt');
});

test('prefs: privát módban (dobó localStorage) sem hibázik', async () => {
  const prefs = await freshPrefs(brokenStorage());
  assert.doesNotThrow(() => prefs.bind('anna'));
  assert.doesNotThrow(() => prefs.set('displayName', 'Anna'));
  assert.equal(prefs.get('displayName', 'alap'), 'alap');
  assert.doesNotThrow(() => prefs.unbind());
});
