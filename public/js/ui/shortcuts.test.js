/** A gyorsbillentyűk modál-őrének ellenőrzése. DOM nincs, ezért nem a
    szelektort futtatjuk, hanem azt a szerkezetet őrizzük, amire épül: minden
    modál gyökere közvetlen gyerekként egy aria-modal kártyát tart. Ha egy új
    modál ettől eltérne, az őr némán nem látná — az 1–5 billentyű pedig a
    nyitott ablak mögött oldalt váltana, ahogy a szelektor-lista idején. */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import * as constants from '../core/constants.js';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', '..');
const html = readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

/** A modál-vezérlőt példányosító hívások száma a public/js alatt — a
    definíció (`function createModalController(`) nem számít bele. */
function countControllerCalls() {
  let count = 0;
  for (const entry of readdirSync(path.join(PUBLIC_DIR, 'js'), { recursive: true })) {
    if (!entry.endsWith('.js') || entry.endsWith('.test.js')) continue;
    const source = readFileSync(path.join(PUBLIC_DIR, 'js', entry), 'utf8');
    count += (source.match(/(?<!function )createModalController\(/g) ?? []).length;
  }
  return count;
}

/** A modál-gyökerek és a közvetlenül utánuk következő két nyitó tag
    (fátyol, kártya) az index.html-ből. */
const MODAL_ROOT = /<div class="([\w-]+-modal)\b[^"]*" id="(\w+)" aria-hidden="true">\s*<div class="\1-backdrop"[^>]*><\/div>\s*<div ([^>]*)>/g;
const roots = [...html.matchAll(MODAL_ROOT)].map(([, cls, id, cardAttrs]) => ({ cls, id, cardAttrs }));

test('a gyorsbillentyű-őr a közös horgonyt használja, nem modál-listát', () => {
  assert.equal(constants.OPEN_MODAL_SELECTOR, '.is-open > [aria-modal="true"]');
  // A konstans önmagában kevés: az őrnek TÉNYLEG ebből kell kérdeznie.
  const source = readFileSync(path.join(import.meta.dirname, 'shortcuts.js'), 'utf8');
  assert.match(source, /isModalOpen = \(\) => Boolean\(\$\(OPEN_MODAL_SELECTOR\)\)/);
  assert.doesNotMatch(source, /-modal\.is-open/, 'visszacsúszott a kézi modál-lista');
});

test('minden modál-vezérlőhöz tartozik egy felismert gyökér az index.html-ben', () => {
  // Enélkül egy elcsúszott regex 0 gyökeret találna, és a lenti teszt üresen menne át.
  assert.equal(roots.length, countControllerCalls());
});

test('minden modál-gyökér közvetlen kártyája aria-modal párbeszédablak', () => {
  for (const { id, cls, cardAttrs } of roots) {
    assert.match(cardAttrs, new RegExp(`class="${cls}-card"`), `#${id}: nem a kártya a fátyol utáni elem`);
    assert.match(cardAttrs, /role="(alert)?dialog"/, `#${id}: a kártyán nincs dialog szerep`);
    assert.match(cardAttrs, /aria-modal="true"/, `#${id}: a kártyán nincs aria-modal`);
  }
});
