/** A Regeneráció oldal felső részének tiszta logikája: a kímélendő lista, a
    gyűrűk állapota, a komponens-összegzés és a térkép geometriája. DOM nélkül
    tesztelhető — a kirajzolás (recovery.js) csak ezeket fogyasztja. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MUSCLE_KEYS } from '../../../server/muscles.js';
import {
  MAP_CANVAS,
  MAP_RINGS,
  MOBILE_COLUMNS,
  RC_SPARE_BELOW,
  componentSummary,
  muscleNote,
  ringDashOffset,
  ringState,
  spareList,
} from './recovery-map.js';

const m = (key, readiness, extra = {}) => ({
  key,
  label: key,
  readiness,
  known: true,
  soreness: null,
  pain: null,
  ...extra,
});

test('ringState: 80-tól zöld, alatta fehér, known:false esetén nincs adat', () => {
  assert.equal(ringState(m('chest', 80)).tone, 'ok');
  assert.equal(ringState(m('chest', 79)).tone, 'rest');
  assert.deepEqual(ringState(m('chest', 100, { known: false })), {
    tone: 'none',
    value: null,
    sore: false,
    pain: false,
  });
});

test('ringState: a pöttyök a jelzett izomlázat és fájdalmat követik', () => {
  assert.deepEqual(ringState(m('quads', 31, { soreness: 6, pain: 3 })), {
    tone: 'rest',
    value: 31,
    sore: true,
    pain: true,
  });
  const zero = ringState(m('quads', 90, { soreness: 0, pain: 0 }));
  assert.equal(zero.sore, false, 'a 0 nem jelzés');
  assert.equal(zero.pain, false);
});

test(`spareList: csak az ismert, ${RC_SPARE_BELOW}% alatti csoportok, növekvő sorrendben`, () => {
  const list = spareList([
    m('glutes', 37, { soreness: 4 }),
    m('chest', 92),
    m('hamstrings', 26, { soreness: 7, pain: 5 }),
    m('calves', 10, { known: false }),
    m('quads', 40),
    m('lowerBack', 39),
  ]);
  assert.deepEqual(
    list.map((row) => row.key),
    ['hamstrings', 'glutes', 'lowerBack'],
  );
  assert.deepEqual(list[0], {
    key: 'hamstrings',
    label: 'hamstrings',
    readiness: 26,
    sore: true,
    pain: true,
  });
});

test('spareList: üres és hiányzó bemenetre üres lista', () => {
  assert.deepEqual(spareList([]), []);
  assert.deepEqual(spareList(undefined), []);
});

test('ringDashOffset: a kitöltetlen ív hossza', () => {
  const circumference = 2 * Math.PI * 34;
  assert.equal(ringDashOffset(100, 34), 0);
  assert.ok(Math.abs(ringDashOffset(0, 34) - circumference) < 1e-9);
  assert.ok(Math.abs(ringDashOffset(76, 34) - circumference * 0.24) < 1e-9);
  assert.equal(ringDashOffset(140, 34), 0, 'a 100 fölötti érték is teli kör');
});

test('componentSummary: a jelen lévők sorban, a hiányzók címkéi külön', () => {
  const summary = componentSummary([
    { key: 'sleep', label: 'Alvás', score: 80, weight: 50, present: true },
    { key: 'mood', label: 'Közérzet', score: null, weight: 0, present: false },
    { key: 'muscle', label: 'Izom-regeneráció', score: 60, weight: 20, present: true },
    { key: 'load', label: 'Edzésterhelés', score: null, weight: 0, present: false },
  ]);
  assert.deepEqual(
    summary.present.map((c) => c.key),
    ['sleep', 'muscle'],
  );
  assert.deepEqual(summary.missing, ['Közérzet', 'Edzésterhelés']);
});

test('muscleNote: hány csoportból számol (a leggyengébb felé súlyozva), és hány van adat nélkül', () => {
  /* A szerver nem sima átlagot számol, hanem soft-mint (átlag − 0,5·(átlag −
     minimum), ld. server/recovery.js) — a felirat ezt nem hallgathatja el. */
  const muscles = MUSCLE_KEYS.map((key, i) => m(key, 50, { known: i >= 2 }));
  assert.equal(
    muscleNote(muscles),
    '10 izomcsoportból, a leggyengébb felé súlyozva · 2 csoport adat nélkül',
  );
  assert.equal(
    muscleNote(MUSCLE_KEYS.map((key) => m(key, 50))),
    '12 izomcsoportból, a leggyengébb felé súlyozva',
  );
  assert.equal(muscleNote(MUSCLE_KEYS.map((key) => m(key, 50, { known: false }))), null);
});

test('null bemenet: a tiszta függvények nem dobnak, üres / adathiány eredményt adnak', () => {
  assert.deepEqual(spareList(null), []);
  assert.deepEqual(componentSummary(null), { present: [], missing: [] });
  assert.deepEqual(componentSummary(undefined), { present: [], missing: [] });
  assert.equal(muscleNote(null), null);
  assert.equal(muscleNote(undefined), null);
  const none = { tone: 'none', value: null, sore: false, pain: false };
  assert.deepEqual(ringState(null), none);
  assert.deepEqual(ringState(undefined), none);
});

test('a térkép mind a 12 izomcsoportnak ad gyűrűt, a vásznon belül', () => {
  const keys = [...MAP_RINGS.front, ...MAP_RINGS.back].map((ring) => ring.key);
  assert.deepEqual([...keys].sort(), [...MUSCLE_KEYS].sort());
  for (const ring of [...MAP_RINGS.front, ...MAP_RINGS.back]) {
    for (const [x, y] of [
      [ring.x, ring.y],
      [ring.line[0], ring.line[1]],
      [ring.line[2], ring.line[3]],
    ]) {
      assert.ok(x >= 0 && x <= MAP_CANVAS.width, `${ring.key}: x kilóg`);
      assert.ok(y >= 0 && y <= MAP_CANVAS.height, `${ring.key}: y kilóg`);
    }
  }
});

test('a spec kiosztása: elöl 5, hátul 7 csoport', () => {
  assert.deepEqual(
    MAP_RINGS.front.map((ring) => ring.key),
    ['shoulders', 'chest', 'biceps', 'core', 'quads'],
  );
  assert.deepEqual(
    MAP_RINGS.back.map((ring) => ring.key),
    ['traps', 'back', 'triceps', 'lowerBack', 'glutes', 'hamstrings', 'calves'],
  );
});

test('a mobil oszlopok nézetenként ugyanazt a készletet adják, mint a térkép', () => {
  for (const view of ['front', 'back']) {
    const columns = [...MOBILE_COLUMNS[view].left, ...MOBILE_COLUMNS[view].right];
    assert.deepEqual([...columns].sort(), MAP_RINGS[view].map((ring) => ring.key).sort());
  }
});
