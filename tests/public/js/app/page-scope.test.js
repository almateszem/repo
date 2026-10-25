/** Az oldal-gyökér keresése ne találhassa el a <body>-t. A router a body-ra is
    kiírja az aktuális oldalt (document.body.dataset.page), ezért a puszta
    `[data-page="x"]` szelektor első találata a body, ha az app az x oldalon
    indul — az oldal vezérlőjének delegált kezelői így az EGÉSZ appra kötődtek
    (pl. a check-in ± kezelője miatt minden léptetőgomb kettőt lépett). Az
    oldal-gyökeret ezért mindig `.app-page[data-page="x"]` alakban keressük. */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const JS_DIR = path.join(import.meta.dirname, '..', '..', '..', '..', 'public', 'js');

test('az oldal-gyökér szelektora .app-page-re szűkít, nem találhatja el a body-t', () => {
  const offenders = [];
  for (const entry of readdirSync(JS_DIR, { recursive: true })) {
    if (!entry.endsWith('.js')) continue;
    const source = readFileSync(path.join(JS_DIR, entry), 'utf8');
    source.split('\n').forEach((line, index) => {
      if (/\$\$?\(\s*['`]\[data-page=/.test(line)) offenders.push(`${entry}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

const CSS_DIR = path.join(import.meta.dirname, '..', '..', '..', '..', 'public', 'css');

/* A stíluslapban ugyanez a csapda: a puszta `[data-page='x'] .y` a body-n
   keresztül az x oldalon MINDEN .y-ra hat, a rejtett oldalakéra is. Szabad:
   `.app-page[data-page=…]` (az oldal-gyökér) és a body-ra SZÁNDÉKOSAN célzó
   `body[data-page=…]` / `body:is([data-page=…], …)`. */
test('a stíluslap [data-page] szelektora .app-page-re vagy szándékosan a body-ra szűkít', () => {
  const offenders = [];
  for (const entry of readdirSync(CSS_DIR)) {
    if (!entry.endsWith('.css')) continue;
    // A kommentek kiürítése (a sortörések maradnak, hogy a sorszám stimmeljen)
    const source = readFileSync(path.join(CSS_DIR, entry), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      (c) => c.replace(/[^\n]/g, ''),
    );
    source.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/\[data-page=/g)) {
        const before = line.slice(0, match.index);
        if (/(\.app-page|body)$/.test(before) || /body:is\([^)]*$/.test(before)) continue;
        offenders.push(`${entry}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});
