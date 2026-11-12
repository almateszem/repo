/**
 * Podium — a blokkos program futtatásának kliensoldala (public/js/program/program-run.js)
 * --------------------------------------------------------------------------
 * A jóváhagyó kártyák döntéseinek beolvasása (átírt érték, különben a
 * javasolt; tizedesvessző is), és hogy az „Elvetem” reject:true-t küld.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { installFakeDom } from '../fake-dom.js';

installFakeDom();
const requests = [];
globalThis.fetch = (url, init) => {
  requests.push({ url, init });
  return Promise.resolve(new Response('{}', { status: 200 }));
};
const { readDecisions } = await import('../../../../public/js/program/program-run.js');
const { api } = await import('../../../../public/js/shared/api.js');

const items = [
  { exercise: 'Guggolás', current: 100, suggested: 105, reason: 'x' },
  { exercise: 'Fekvenyomás', current: 60, suggested: 62.5, reason: 'y' },
];

test('az áttekintő kártya az átírt értéket küldi, a többinél a javasoltat', () => {
  assert.deepEqual(readDecisions(items, ['107,5', '62,5']), {
    decisions: { Guggolás: 107.5, Fekvenyomás: 62.5 },
  });
});

test('érvénytelen mező: hiba és a rossz sorok indexe', () => {
  assert.deepEqual(readDecisions(items, ['abc', '0']), {
    error: 'Minden TM legyen pozitív szám (pl. 112,5).',
    bad: [0, 1],
  });
});

test('a ciklus közbeni kártya Elvetem gombja reject:true-t küld', async () => {
  await api.decideProgramMid(7, null);
  const last = requests.at(-1);
  assert.match(String(last.url), /\/api\/programs\/7\/mid$/);
  assert.deepEqual(JSON.parse(last.init.body), { reject: true });
  await api.decideProgramMid(7, { Guggolás: 70 });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { decisions: { Guggolás: 70 } });
});
