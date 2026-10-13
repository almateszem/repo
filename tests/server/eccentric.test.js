import test from 'node:test';
import assert from 'node:assert/strict';

import { eccentricClass } from '../../server/muscles.js';

test('eccentricClass: a négy osztály a katalógus jellemző neveire', () => {
  const cases = [
    ['Nordic hamstring', 1.5],
    ['Szánhúzás', 0.6],
    ['Szántolás', 0.6],
    ['Román felhúzás', 1.2],
    ['Merev lábas felhúzás', 1.2],
    ['Jó reggelt', 1.2],
    ['Kitörés', 1.2],
    ['Bolgár kitörés', 1.2],
    ['Bolgár guggolás', 1.2],
    ['Rézsútos padon hajlítás', 1.2],
    ['Kétkezes fej mögötti nyújtás', 1.2],
    ['Negatív fekvenyomás', 1.2],
    ['Guggolás', 1],
    ['Fekvenyomás', 1],
    ['Combnyújtás', 1],
    ['Overhead squat', 1],
    ['Fej fölötti séta', 1],
  ];
  for (const [name, expected] of cases) assert.equal(eccentricClass(name), expected, name);
});

test('eccentricClass: ékezet és kisbetű nélkül is felismer, ismeretlen névre 1', () => {
  assert.equal(eccentricClass('roman felhuzas'), 1.2);
  assert.equal(eccentricClass('RDL'), 1.2);
  assert.equal(eccentricClass('nordic curl'), 1.5);
  assert.equal(eccentricClass('Valami saját gyakorlat'), 1);
  assert.equal(eccentricClass(undefined), 1);
});
