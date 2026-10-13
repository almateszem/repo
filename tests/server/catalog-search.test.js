import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMIT,
  createCatalogSearch,
  parseNames,
  parsePageParams,
  toExerciseCard,
} from '../../server/catalog-search.js';

const ex = (name, group, equipment) => ({
  name,
  group,
  equipment,
  tag: 'Összetett',
  muscles: group,
  logMode: 'reps',
  load: { chest: 1 },
  loadSource: 'kézi',
  extId: `ext-${name}`,
});

const EXERCISES = [
  ex('Fekvenyomás', 'Mell', 'Rúd'),
  ex('Tárogatás', 'Mell', 'Kézisúlyzó'),
  ex('Evezés', 'Hát', 'Kettlebell'),
  ex('Guggolás', 'Láb', 'Rúd'),
];

const SEED_FOODS = [
  { name: 'Csirkemell (nyers)', group: 'Hús, baromfi', kcal: 110 },
  { name: 'Túró', group: 'Tejtermék', kcal: 100 },
  { name: 'Alma', group: 'Gyümölcs', kcal: 52 },
];

const CUSTOM = {
  1: [{ id: 7, name: 'Anna zabkása', group: 'Saját étel', brand: 'Házi', custom: true, kcal: 380 }],
  2: [],
};

const search = createCatalogSearch({
  exercises: () => EXERCISES,
  seedFoods: () => SEED_FOODS,
  foodsFor: (userId) => [...(CUSTOM[userId] ?? []), ...SEED_FOODS],
});

const names = (items) => items.map((item) => item.name);

test('gyakorlat: a név részszövegére keres, kis-nagybetűtől függetlenül', () => {
  assert.deepEqual(names(search.searchExercises({ q: 'FEKVE' }).items), ['Fekvenyomás']);
});

test('gyakorlat: a felszerelésre is keres', () => {
  assert.deepEqual(names(search.searchExercises({ q: 'kettlebell' }).items), ['Evezés']);
});

test('gyakorlat: csoport-szűrés, keresővel együtt is', () => {
  assert.deepEqual(names(search.searchExercises({ group: 'Mell' }).items), [
    'Fekvenyomás',
    'Tárogatás',
  ]);
  assert.deepEqual(names(search.searchExercises({ q: 'rúd', group: 'Mell' }).items), [
    'Fekvenyomás',
  ]);
});

test('gyakorlat: üres keresés = minden, a katalógus sorrendjében', () => {
  const result = search.searchExercises({});
  assert.deepEqual(names(result.items), names(EXERCISES));
  assert.equal(result.total, 4);
  assert.equal(result.nextOffset, null);
});

test('gyakorlat: ismeretlen csoport üres, nem hiba', () => {
  assert.deepEqual(search.searchExercises({ group: 'Nincs ilyen' }), {
    items: [],
    total: 0,
    nextOffset: null,
  });
});

test('lapozás: nextOffset a következő lap eleje, az utolsó lapon null', () => {
  const first = search.searchExercises({ offset: 0, limit: 3 });
  assert.equal(first.items.length, 3);
  assert.equal(first.total, 4);
  assert.equal(first.nextOffset, 3);

  const last = search.searchExercises({ offset: 3, limit: 3 });
  assert.deepEqual(names(last.items), ['Guggolás']);
  assert.equal(last.nextOffset, null);

  const beyond = search.searchExercises({ offset: 10, limit: 3 });
  assert.deepEqual(beyond, { items: [], total: 4, nextOffset: null });
});

test('lapozás: a pontosan kitöltött utolsó lap után nincs több', () => {
  assert.equal(search.searchExercises({ offset: 2, limit: 2 }).nextOffset, null);
});

test('gyakorlat: a kártya nem viszi ki a szerver-belső mezőket', () => {
  for (const card of search.searchExercises({}).items) {
    assert.ok(!('load' in card));
    assert.ok(!('loadSource' in card));
    assert.ok(!('extId' in card));
    assert.ok(card.name && card.group && card.tag);
  }
  assert.deepEqual(Object.keys(toExerciseCard(EXERCISES[0])).sort(), [
    'equipment',
    'group',
    'logMode',
    'muscles',
    'name',
    'tag',
  ]);
});

test('gyakorlat-csoportok a katalógus sorrendjében, ismétlés nélkül', () => {
  assert.deepEqual(search.exerciseGroups(), ['Mell', 'Hát', 'Láb']);
});

test('gyakorlat név szerint: csak a megtaláltak, kártya-alakban', () => {
  const found = search.findExercisesByName(['Guggolás', 'Nincs ilyen']);
  assert.deepEqual(names(found), ['Guggolás']);
  assert.ok(!('load' in found[0]));
});

test('étel: a saját ételek elöl, fiókonként elkülönítve', () => {
  assert.deepEqual(names(search.searchFoods(1, {}).items), [
    'Anna zabkása',
    'Csirkemell (nyers)',
    'Túró',
    'Alma',
  ]);
  assert.ok(!search.searchFoods(2, {}).items.some((food) => food.custom));
});

test('étel: a kategóriára és a márkára is keres', () => {
  assert.deepEqual(names(search.searchFoods(1, { q: 'tejtermék' }).items), ['Túró']);
  assert.deepEqual(names(search.searchFoods(1, { q: 'házi' }).items), ['Anna zabkása']);
});

test('étel-kategóriák ábécérendben, a „Saját étel" nélkül', () => {
  assert.deepEqual(search.foodGroups(), ['Gyümölcs', 'Hús, baromfi', 'Tejtermék']);
});

test('étel név szerint: a saját is, de csak a gazdájának', () => {
  assert.deepEqual(names(search.findFoodsByName(1, ['Anna zabkása', 'Alma', 'Nincs'])), [
    'Anna zabkása',
    'Alma',
  ]);
  assert.deepEqual(search.findFoodsByName(2, ['Anna zabkása']), []);
});

test('lapozási paraméterek: alapértékek és érvényes értékek', () => {
  assert.deepEqual(parsePageParams({}), { q: '', group: null, offset: 0, limit: DEFAULT_LIMIT });
  assert.deepEqual(
    parsePageParams({ q: '  Guggolás ', group: 'Láb', offset: '40', limit: '100' }),
    {
      q: 'Guggolás',
      group: 'Láb',
      offset: 40,
      limit: 100,
    },
  );
});

test('lapozási paraméterek: hibás értékre hibát ad', () => {
  const bad = [
    { offset: '-1' },
    { offset: 'abc' },
    { offset: '1.5' },
    { limit: '0' },
    { limit: '101' },
    { limit: '2.5' },
    { q: ['a', 'b'] },
    { q: { x: '1' } },
    { q: 'a'.repeat(101) },
    { group: ['Mell', 'Hát'] },
  ];
  for (const query of bad) {
    assert.ok(parsePageParams(query).error, JSON.stringify(query));
  }
});

test('nevek: 1–50 nem üres név, különben hiba', () => {
  assert.deepEqual(parseNames([' Alma ', '', 'Túró']), { names: ['Alma', 'Túró'] });
  assert.ok(parseNames([]).error);
  assert.ok(parseNames(['', '  ']).error);
  assert.ok(parseNames(Array.from({ length: 51 }, (_, i) => `n${i}`)).error);
  assert.equal(parseNames(Array.from({ length: 50 }, (_, i) => `n${i}`)).names.length, 50);
});
