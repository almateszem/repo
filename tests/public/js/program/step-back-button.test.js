/**
 * Podium — az „Előző nap" gomb a program-kártyán (F1)
 * --------------------------------------------------------------------------
 * Csak akkor látszik, ha van hová visszalépni: a ciklus első napján nem, és
 * nyitott javaslatnál vagy jóváhagyásra váró ciklusnál sem (a szerver is
 * elutasítaná — előbb dönteni kell).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const { programCardActions } = await import('../../../../public/js/program/program-run.js');

const labels = (state) =>
  programCardActions({ id: 1, active: true, state }, { onChange: async () => {} }).children.map(
    (el) => el.textContent,
  );

test('a 2. naptól látszik az „Előző nap"', () => {
  assert.ok(labels({ pos: 1, mid: false, review: false }).includes('Előző nap'));
});

test('a ciklus első napján nincs „Előző nap"', () => {
  assert.ok(!labels({ pos: 0, mid: false, review: false }).includes('Előző nap'));
});

test('nyitott javaslatnál és ciklus végén nincs „Előző nap"', () => {
  assert.ok(!labels({ pos: 2, mid: true, review: false }).includes('Előző nap'));
  assert.ok(!labels({ pos: 2, mid: false, review: true }).includes('Előző nap'));
});
