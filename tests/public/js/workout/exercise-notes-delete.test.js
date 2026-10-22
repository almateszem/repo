/** A saját gyakorlat-megjegyzés törölhető: a NÉZŐ saját során ✕ áll, ami a
    DELETE /api/comments/:id-t hívja és a sort kiveszi; a másé nem törölhető
    (a szerver is csak a szerzőnek enged). */

import assert from 'node:assert/strict';
import test from 'node:test';

import { installFakeDom } from '../fake-dom.js';

installFakeDom();

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push(`${init.method ?? 'GET'} ${url}`);
  return new Response(null, { status: 204 });
};

const { exerciseNoteRow } = await import('../../../../public/js/workout/exercise-notes.js');

const NOTE = {
  id: 5,
  target: '12:0',
  exercise: 'Guggolás',
  workout: 'Láb',
  date: '2026.10.20',
  authorName: 'Anna',
  at: '2026-10-20T08:00:00.000Z',
  text: 'Térd befelé dőlt',
};

/** A sor (bármilyen mélyen lévő) törlőgombja, ha van. */
function findDelete(el) {
  if (String(el?.className ?? '').includes('co-note-del')) return el;
  for (const child of el?.children ?? []) {
    const found = findDelete(child);
    if (found) return found;
  }
  return null;
}

test('a saját megjegyzés ✕-e törli a megjegyzést és kiveszi a sort', async () => {
  const row = exerciseNoteRow({ ...NOTE, mine: true }, async () => {});
  let removed = false;
  row.remove = () => (removed = true);

  const del = findDelete(row);
  assert.ok(del, 'a saját soron van törlőgomb');
  del.dispatch('click');
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(calls, ['DELETE /api/comments/5']);
  assert.equal(removed, true, 'a sor kikerült');
});

test('a más által írt megjegyzésen nincs törlőgomb', () => {
  const row = exerciseNoteRow({ ...NOTE, mine: false }, async () => {});
  assert.equal(findDelete(row), null);
});
