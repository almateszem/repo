/** A Regeneráció térképének két figurája a design vonalrajza (public/img).
    A teszt azt őrzi, hogy a fájl ott van, érvényes SVG viewBox-szal, és a
    design-exportból örökölt c2pa-metaadat NEM került a kiszolgált fájlba. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`../../img/${name}`, import.meta.url), 'utf8');

for (const [name, viewBox] of [
  ['body-front.svg', '0 0 975 1625'],
  ['body-back.svg', '0 0 989 1625'],
]) {
  test(`${name}: SVG, viewBox ${viewBox}, metaadat nélkül`, () => {
    const svg = read(name);
    assert.match(svg, /^<svg[\s>]/);
    assert.ok(svg.includes(`viewBox="${viewBox}"`));
    assert.ok(!/c2pa|<metadata/i.test(svg), 'c2pa-metaadat maradt benne');
    assert.ok(svg.length < 20000, 'a vonalrajz kicsi marad');
  });
}
