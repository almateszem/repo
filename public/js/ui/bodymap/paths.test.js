/** A testtérkép geometriájának ellenőrzése. A rajz kézzel készült — ezek a
    tesztek nem a szépségét őrzik, hanem azt, hogy minden izomcsoport
    elérhető marad, és egyetlen régió se csússzon ki a rajzterületről. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MUSCLE_KEYS } from '../../../../server/muscles.js';
import { BODY_HEAD, BODY_REGIONS, BODY_SILHOUETTE, BODY_VIEW_BOX } from './paths.js';

const VIEWS = ['front', 'back'];

test('a két nézet uniója pontosan a kilenc izomcsoport', () => {
  const seen = new Set(VIEWS.flatMap((v) => BODY_REGIONS[v].map((r) => r.key)));
  assert.deepEqual([...seen].sort(), [...MUSCLE_KEYS].sort());
});

test('egy izomcsoport nézetenként legfeljebb egyszer szerepel', () => {
  for (const view of VIEWS) {
    const keys = BODY_REGIONS[view].map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length, `${view}: ismétlődő kulcs`);
  }
});

test('minden régiónak van rajza és felirat-helye a rajzterületen belül', () => {
  for (const view of VIEWS) {
    for (const region of BODY_REGIONS[view]) {
      assert.match(region.d, /^M[\s\d]/, `${view}/${region.key}: üres vagy hibás path`);
      assert.ok(region.labelX > 0 && region.labelX < BODY_VIEW_BOX.width,
        `${view}/${region.key}: a felirat x-e kilóg`);
      assert.ok(region.labelY > 0 && region.labelY < BODY_VIEW_BOX.height,
        `${view}/${region.key}: a felirat y-a kilóg`);
    }
  }
});

test('a tükrözött régiók a bal félen vannak megrajzolva', () => {
  // Ha egy tükrözendő régió átlógna a középvonalon, a tükörképe rálapolna
  // az eredetire — két találati felület egy helyen, ami némán elnyelné a
  // koppintást.
  const half = BODY_VIEW_BOX.width / 2;
  for (const view of VIEWS) {
    for (const region of BODY_REGIONS[view].filter((r) => r.mirrored)) {
      assert.ok(region.labelX < half, `${view}/${region.key}: nem a bal félen van`);
    }
  }
});

test('a sziluett mindkét nézethez ad rajzot', () => {
  for (const view of VIEWS) {
    assert.ok(BODY_SILHOUETTE[view].length > 0, `${view}: nincs sziluett`);
  }
  assert.ok(BODY_HEAD.r > 0);
});
