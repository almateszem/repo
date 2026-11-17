/**
 * Podium — az értesítés-jelvény üresen indul (F7)
 * --------------------------------------------------------------------------
 * A HTML-ben beégetett „6" állt, ami belépés előtt is látszott a
 * belépőablak mögött. A jelvény rejtve és szám nélkül indul; a számot az
 * értesítések betöltése írja (app/notifications.js).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../../../public/index.html', import.meta.url), 'utf8');

test('a jelvény rejtve és szám nélkül indul', () => {
  const tag = html.match(/<span[^>]*data-notif-badge[^>]*>([^<]*)<\/span>/);
  assert.ok(tag, 'megvan a jelvény');
  assert.match(tag[0], /\bhidden\b/);
  assert.equal(tag[1].trim(), '');
});
