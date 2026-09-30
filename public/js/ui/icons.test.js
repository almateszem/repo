/** Az ikon-sprite őre: egy <use> nem hivatkozhat nem létező szimbólumra, és
    gombban nem állhat üres <svg> — mindkettő láthatatlan, de kattintható
    gombot ad. (A fejléc beállítás-gombja így állt üresen, ikon nélkül.) */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'index.html'), 'utf8');

test('minden <use href="#…"> létező szimbólumra mutat', () => {
  const symbols = new Set([...html.matchAll(/<symbol id="([\w-]+)"/g)].map(([, id]) => id));
  for (const [, id] of html.matchAll(/<use href="#([\w-]+)"/g)) {
    assert.ok(symbols.has(id), `hiányzó szimbólum: #${id}`);
  }
});

test('gombban nincs üres <svg>', () => {
  const empty = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*?<svg[^>]*>\s*<\/svg>/g) ?? [];
  assert.deepEqual(empty, [], 'üres ikon egy gombban');
});
