/**
 * Podium — érintési célterületek és a háttér zárolása (F5, M4)
 * --------------------------------------------------------------------------
 * F5: a testsúly- és mérésnapló törlőgombja, a saját megjegyzés törlése és a
 *     napi cél két szöveges gombja telefonon túl kicsi volt (21×27, ill.
 *     15 px magas). Mind .tap-target lett; a listasorokban a találati terület
 *     a SORTÁVOLSÁGHOZ igazodik (testsúly 35 px, mérés 33 px), különben a
 *     szomszéd sor ✕-ébe vagy az inputba lógna — egy rossz koppintás más
 *     bejegyzést törölne. (2026-11-17-i élő mérés, 390 px.)
 * M4: megnyitott ablak mögött a háttér görgethető volt. Bármely nyitott
 *     ablak (vagy a program-aktiválás overlay-e) mellett a gyökér nem görget.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../../../public/${rel}`, import.meta.url), 'utf8');
const css = read('css/01-alap.css');
const html = read('index.html');

test('F5: a három törlőgomb tap-target osztályt kap', () => {
  for (const file of [
    'js/recovery/weight.js',
    'js/recovery/measurements.js',
    'js/workout/exercise-notes.js',
  ]) {
    assert.match(read(file), /ds-icon-del--inline tap-target/, file);
  }
});

test('F5: a listasorok törlőgombjának területe nem nagyobb a sortávolságnál', () => {
  assert.match(css, /\.rc-weight-del\s*\{\s*--tap:\s*35px;/);
  assert.match(css, /\.rc-body-del\s*\{\s*--tap:\s*33px;/);
});

test('F5: a napi cél két szöveges gombja tap-target', () => {
  assert.match(html, /class="nu-goal-edit tap-target"/);
  assert.match(html, /class="nu-goal-revert tap-target"/);
});

test('M4: nyitott ablak mellett a gyökér nem görget, és a görgetősáv helye megmarad', () => {
  assert.match(css, /html:has\(\.modal\.is-open, \.fw-overlay\)\s*\{\s*overflow:\s*hidden;/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
});
