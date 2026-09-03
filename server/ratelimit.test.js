/**
 * FitTrack Pro — a kérés-korlátozó
 * ---------------------------------
 * Tiszta számláló, tehát az idő is átadható: a tesztnek nem kell VÁRNIA egy
 * ablak leteltére, csak előre tekernie az órát. Ez nem kényelmi fogás — egy
 * valós idővel dolgozó teszt vagy lassú lenne, vagy megbízhatatlan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from './ratelimit.js';

test('a limitig átenged, utána elutasít', () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
  assert.deepEqual(
    [1, 2, 3, 4].map(() => limiter.hit('a', 0).allowed),
    [true, true, true, false],
  );
});

test('a maradék visszaszámol, és sosem megy nulla alá', () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.hit('a', 0).remaining, 1);
  assert.equal(limiter.hit('a', 0).remaining, 0);
  assert.equal(limiter.hit('a', 0).remaining, 0, 'a túllépésnél is 0, nem -1');
});

test('az ablak leteltével újraindul a számlálás', () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  limiter.hit('a', 0);
  limiter.hit('a', 0);
  assert.equal(limiter.hit('a', 999).allowed, false, 'az ablakon belül még nem');
  assert.equal(limiter.hit('a', 1000).allowed, true, 'a határon már igen');
  assert.equal(limiter.hit('a', 1000).allowed, true, 'és tiszta lappal indul');
});

test('a kulcsok egymástól függetlenül számolnak', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(limiter.hit('anna', 0).allowed, true);
  assert.equal(limiter.hit('anna', 0).allowed, false);
  assert.equal(limiter.hit('bela', 0).allowed, true, 'Béla nem issza meg Anna levét');
});

test('a Retry-After a hátralévő időt adja, másodpercre felkerekítve', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  limiter.hit('a', 0);

  assert.equal(limiter.hit('a', 0).retryAfter, 60);
  assert.equal(limiter.hit('a', 30_000).retryAfter, 30);
  assert.equal(
    limiter.hit('a', 59_500).retryAfter, 1,
    'a maradék fél másodperc is egy egész — a 0 azt jelentené, „most már jó"',
  );
});

test('a további kopogtatás NEM tolja ki a várakozást', () => {
  /* Fontos, hogy ne büntessük a türelmetlen klienst az ablak nyújtásával: a
     legtöbb kliens (a miénk is) újrapróbál, és az elcsúszó határ miatt sosem
     jutna be — a felhasználó számára ez néma befagyásnak látszana. */
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  limiter.hit('a', 0);
  for (let now = 100; now < 1000; now += 100) limiter.hit('a', now);
  assert.equal(limiter.hit('a', 1000).allowed, true, 'az eredeti ablak végén beenged');
});

test('a sikeres belépés nullázhatja a kulcsot', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  limiter.hit('a', 0);
  assert.equal(limiter.hit('a', 0).allowed, false);
  limiter.reset('a');
  assert.equal(limiter.hit('a', 0).allowed, true);
});

test('a lejárt kulcsok kitakarodnak — a számláló nem szivárog', () => {
  /* IP-alapú korlátozásnál a map minden valaha látott címet megtartana. A
     söprés csak nagy méret fölött fut, ezért a teszt is túllépi a küszöböt. */
  const limiter = createRateLimiter({ limit: 5, windowMs: 1000 });
  for (let i = 0; i < 1200; i += 1) limiter.hit(`kulcs-${i}`, 0);
  assert.ok(limiter.size() > 1000, 'előbb tényleg megnő');

  limiter.hit('friss', 5000); // az ablakon túl → söprés
  assert.equal(limiter.size(), 1, 'a lejártak eltűntek, csak a friss maradt');
});
