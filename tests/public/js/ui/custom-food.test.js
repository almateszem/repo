/** Saját étel: az üresen hagyott makró nem lesz csendben 0 g. A vonalkódos
    kitöltés a hiányzó tápértéket szándékosan üresen hagyja — mentéskor sem
    válhat belőle „nem tartalmaz fehérjét". */

import assert from 'node:assert/strict';
import test from 'node:test';

import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
const posts = [];
globalThis.fetch = async (url, init = {}) => {
  if (init.method === 'POST') {
    const body = JSON.parse(init.body);
    posts.push({ url, body });
    return Response.json({ id: 1, ...body }, { status: 201 });
  }
  return Response.json([]); // a kategória-lista
};

const { setupCustomFood } = await import('../../../../public/js/ui/custom-food.js');
await setupCustomFood({});

const fill = ({ protein, carbs, fat }) => {
  elementFor('#cf-name').value = 'Házi müzli';
  elementFor('#cf-protein').value = protein;
  elementFor('#cf-carbs').value = carbs;
  elementFor('#cf-fat').value = fat;
};
const submit = async () => {
  elementFor('[data-form="custom-food"]').dispatch('submit');
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test('saját étel: üres makrónál nincs mentés, a hiba a mezőt nevezi meg', async () => {
  posts.length = 0;
  fill({ protein: '', carbs: '60', fat: '8' });
  await submit();
  assert.equal(posts.length, 0, 'az api.addCustomFood nem hívódik');
  const error = elementFor('[data-cf-error]');
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /fehérje/i);
  assert.match(error.textContent, /0/, 'a 0 beírását is felajánlja');
  assert.equal(elementFor('#cf-protein').getAttribute('aria-invalid'), 'true');
  assert.equal(elementFor('#cf-carbs').value, '60', 'a bevitt adat megmarad');
});

test('saját étel: a többi makró is ellenőrzött', async () => {
  posts.length = 0;
  fill({ protein: '10', carbs: '', fat: '8' });
  await submit();
  assert.equal(posts.length, 0);
  assert.match(elementFor('[data-cf-error]').textContent, /szénhidrát/i);

  fill({ protein: '10', carbs: '60', fat: ' ' });
  await submit();
  assert.equal(posts.length, 0);
  assert.match(elementFor('[data-cf-error]').textContent, /zsír/i);
});

test('saját étel: a beírt 0 érvényes, a mentés elmegy', async () => {
  posts.length = 0;
  fill({ protein: '0', carbs: '60', fat: '8,5' });
  await submit();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/api/foods/custom');
  assert.equal(posts[0].body.protein, 0);
  assert.equal(posts[0].body.fat, 8.5);
  assert.equal(elementFor('#cf-protein').getAttribute('aria-invalid'), null, 'a jelölés lekerül');
});

test('saját étel: a kcal-előnézet a mentéssel azonos kerekítésű makrókból számol', () => {
  /* A szerver a makrókat tizedre kerekíti (macroValue), és abból számol:
     5,46 g zsír → 5,5 g → 49,5 → 50 kcal. A kerekítetlen előnézet 49-et mutatott. */
  elementFor('#cf-protein').value = '0';
  elementFor('#cf-carbs').value = '0';
  elementFor('#cf-fat').value = '5.46';
  elementFor('#cf-fat').dispatch('input');
  assert.equal(elementFor('#cf-kcal').value, '50');
});
