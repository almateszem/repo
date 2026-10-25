/** A számmezők őre: a böngésző a step-rácsot a min-től számolja, ezért ha a
    min nem a step többszöröse, a „kerek" értékek érvénytelenek, és az űrlap
    némán nem küldődik el. (Az erőfelmérés súly-mezője min="1" step="2.5"
    mellett a 100 kg-ot utasította el: az érvényes értékek 1; 3,5; … 98,5; 101.) */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const html = readFileSync(
  path.join(import.meta.dirname, '..', '..', '..', '..', 'public', 'index.html'),
  'utf8',
);

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

test('minden számmező min-je a step többszöröse (vagy step="any")', () => {
  const offenders = [];
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    if (attr(tag, 'type') !== 'number') continue;
    const min = attr(tag, 'min');
    const step = attr(tag, 'step');
    if (min === undefined || step === undefined || step === 'any') continue;
    const ratio = Number(min) / Number(step);
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
      offenders.push(`${attr(tag, 'id') ?? attr(tag, 'class')}: min=${min} step=${step}`);
    }
  }
  assert.deepEqual(offenders, []);
});
