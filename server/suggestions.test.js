/**
 * FitTrack Pro — az ajánlott gyakorlatok unit-tesztjei
 * ----------------------------------------------------
 * A suggestions.js tiszta függvény: kitalált katalógussal és riporttal a
 * teljes döntési logika ellenőrizhető, adatbázis és szerver nélkül.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { suggestExercises, groupsFromTitle, READY_THRESHOLD } from './suggestions.js';
import { MUSCLE_KEYS } from './muscles.js';

/* ---- Segédek ---- */

const row = (name, group, load, extra = {}) => ({
  name,
  group,
  load,
  tag: 'Összetett',
  loadSource: 'curated',
  logMode: 'reps',
  ...extra,
});

const CATALOG = [
  row('Fekvenyomás', 'Mell', { chest: 0.6, shoulders: 0.15, arms: 0.25 }),
  row('Tárogatás', 'Mell', { chest: 0.9, shoulders: 0.1 }, { tag: 'Izolációs' }),
  row('Mellnyújtás', 'Mell', { chest: 1 }, { tag: 'Nyújtás' }),
  row('Húzódzkodás', 'Hát', { back: 0.7, arms: 0.25, core: 0.05 }),
  row('Evezés', 'Hát', { back: 0.7, arms: 0.2, shoulders: 0.1 }),
  row('Guggolás', 'Láb', { quads: 0.55, glutes: 0.25, core: 0.2 }),
  row('Lábtolás', 'Láb', { quads: 0.7, glutes: 0.3 }),
  row('Combhajlítás', 'Láb', { hamstrings: 1 }, { tag: 'Izolációs' }),
  row('Vádliemelés', 'Láb', { calves: 1 }, { tag: 'Izolációs' }),
  row('Bicepsz hajlítás', 'Kar', { arms: 1 }, { tag: 'Izolációs' }),
  row('Plank', 'Törzs', { core: 1 }, { tag: 'Izolációs' }),
  row('Futópad', 'Kardió', { quads: 0.5, calves: 0.5 }, { logMode: 'duration' }),
  row('Generált mellnyomás', 'Mell', { chest: 1 }, { loadSource: 'derived' }),
];

/** Riport a megadott izom-készenlétekkel; a nem említett csoport ismert és 50%. */
const report = (readiness = {}, { pain = {}, known = true, caps = [], overall = 80 } = {}) => ({
  overall,
  caps,
  muscles: MUSCLE_KEYS.map((key) => ({
    key,
    readiness: readiness[key] ?? 50,
    known,
    pain: pain[key] ?? null,
  })),
});

const names = (result) => result.suggestions.map((s) => s.name);

/* ======================================================================
   1. A cím értelmezése
   ====================================================================== */

test('a cím magyar összetett szavait és angol rövidítéseit felismeri', () => {
  assert.deepEqual(
    [...groupsFromTitle('Lábnap').keys()],
    ['quads', 'hamstrings', 'glutes', 'calves'],
  );
  assert.deepEqual([...groupsFromTitle('Hát + bicepsz').keys()], ['back', 'arms']);
  assert.deepEqual([...groupsFromTitle('Push #3').keys()], ['chest', 'shoulders', 'arms']);
  assert.deepEqual([...groupsFromTitle('labnap').keys()], [...groupsFromTitle('Lábnap').keys()]);
  assert.equal(groupsFromTitle('Mellnap').get('chest'), 'Mell', 'a címke az indoklásba kerül');
});

test('a félrevivő szavakra NEM talál: „Hétfő", „A nap", „legjobb", „hatodik", „hasonló"', () => {
  for (const title of [
    'Hétfő',
    'A nap',
    'Legjobb edzés',
    'Hatodik hét',
    'Hasonló mint tegnap',
    '',
  ]) {
    assert.equal(groupsFromTitle(title).size, 0, `„${title}" nem értelmezhető címnek kell lennie`);
  }
});

test('több szabálynál az első címke marad: a „Láb + farizom" farizma „Láb"', () => {
  assert.equal(groupsFromTitle('Láb + farizom').get('glutes'), 'Láb');
});

/* ======================================================================
   2. A két jel és az indoklás
   ====================================================================== */

test('a címből jött javaslat kimondja az okát', () => {
  const result = suggestExercises({ title: 'Mellnap', catalog: CATALOG });
  assert.equal(result.readiness, 'off');
  assert.deepEqual(result.titleLabels, ['Mell']);
  assert.deepEqual(names(result), ['Fekvenyomás', 'Tárogatás']);
  assert.deepEqual(result.suggestions[0].reasons, [{ kind: 'title', text: 'a címből: Mell' }]);
});

test('értelmezhetetlen címnél a lista a regeneráltságra esik vissza, nem marad üres', () => {
  const result = suggestExercises({
    title: 'Hétfő',
    report: report({ back: 95 }),
    catalog: CATALOG,
  });
  assert.equal(result.readiness, 'used');
  assert.deepEqual(names(result), ['Húzódzkodás', 'Evezés']);
  assert.deepEqual(result.suggestions[0].reasons, [{ kind: 'ready', text: 'Hát 95% regenerált' }]);
});

test('a két jel egyenrangú: mindkettő együtt előre, utána cím és regeneráltság váltakozva', () => {
  const result = suggestExercises({
    title: 'Hát + mell',
    report: report({ back: 90, chest: 60, arms: 99 }),
    catalog: CATALOG,
  });
  // Hát: cím + regenerált (mindkét jel) → Mell: csak cím → Kar: csak regenerált
  assert.deepEqual(
    result.suggestions.map((s) => s.group),
    ['back', 'back', 'chest', 'chest', 'arms'],
  );
  const chest = result.suggestions.find((s) => s.group === 'chest');
  assert.deepEqual(chest.reasons, [
    { kind: 'title', text: 'a címből: Mell' },
    { kind: 'low', text: 'Mell csak 60% regenerált' },
  ]);
});

test('a pihent felsőtest nem szorítja ki a cím fáradt csoportjait (lábnap másnapján)', () => {
  /* Valódi adaton talált hiba: kemény lábnap után a „Lábnap" címre egyetlen
     lábgyakorlat sem jött, mert a 100%-os felsőtest a készenlét-rendezésben
     a nyolcas korlát elé került. */
  const result = suggestExercises({
    title: 'Lábnap',
    report: report({
      quads: 40,
      hamstrings: 40,
      glutes: 40,
      calves: 100,
      chest: 100,
      back: 100,
      shoulders: 100,
      arms: 100,
      core: 100,
    }),
    catalog: CATALOG,
  });
  assert.ok(result.suggestions.length <= 8);
  assert.ok(names(result).includes('Guggolás'), 'a quadriceps a címből bekerül');
  assert.ok(names(result).includes('Combhajlítás'), 'a hamstring a címből bekerül');
  assert.ok(names(result).includes('Fekvenyomás'), 'a regenerált mell is kap helyet');
  assert.deepEqual(result.suggestions.find((s) => s.name === 'Guggolás').reasons, [
    { kind: 'title', text: 'a címből: Láb' },
    { kind: 'low', text: 'Quadriceps csak 40% regenerált' },
  ]);
});

test(`a ${READY_THRESHOLD}% alatti, címben nem szereplő csoport nem kerül be`, () => {
  const result = suggestExercises({
    title: '',
    report: report({ chest: READY_THRESHOLD - 1 }),
    catalog: CATALOG,
  });
  assert.deepEqual(result.suggestions, []);
});

/* ======================================================================
   3. Biztonság: fájdalom, adathiány, sapka
   ====================================================================== */

test('fájdalommal letiltott csoport SOSEM kerül be — a cím sem írja felül', () => {
  const result = suggestExercises({
    title: 'Mellnap',
    report: report({ chest: 100 }, { pain: { chest: 8 } }),
    catalog: CATALOG,
  });
  assert.ok(!result.suggestions.some((s) => s.group === 'chest'));
  assert.deepEqual(result.titleLabels, [], 'a teljesen kizárt cím-címke sem jelenik meg');
});

test('a másodlagosan fájdalmas csoportot terhelő gyakorlat is kimarad', () => {
  // A váll fáj: a fekvenyomás (15% váll) és a tárogatás (10%) is kiesik.
  const result = suggestExercises({
    title: 'Mellnap',
    report: report({}, { pain: { shoulders: 7 } }),
    catalog: CATALOG,
  });
  assert.deepEqual(names(result), ['Generált mellnyomás']);
});

test('a 7 alatti fájdalom nem tilt', () => {
  const result = suggestExercises({
    title: 'Mellnap',
    report: report({}, { pain: { chest: 6 } }),
    catalog: CATALOG,
  });
  assert.ok(names(result).includes('Fekvenyomás'));
});

test('friss fióknál (known: false) a 100% nem jel — csak a cím számít', () => {
  const result = suggestExercises({
    title: 'Hétfő',
    report: report({ chest: 100, back: 100 }, { known: false, overall: null }),
    catalog: CATALOG,
  });
  assert.equal(result.readiness, 'unknown');
  assert.deepEqual(result.suggestions, []);
});

test('sapkás napon egy izom sem lehet jobb a napnál', () => {
  const capped = report({ chest: 95 }, { caps: ['közérzet'], overall: 40 });
  const result = suggestExercises({ title: 'Mellnap', report: capped, catalog: CATALOG });
  assert.deepEqual(result.suggestions[0].reasons, [
    { kind: 'title', text: 'a címből: Mell' },
    { kind: 'low', text: 'Mell csak 40% regenerált' },
  ]);
  const fallback = suggestExercises({ title: '', report: capped, catalog: CATALOG });
  assert.deepEqual(fallback.suggestions, [], 'cím nélkül sapkás napon nem hívunk be edzeni');
});

/* ======================================================================
   4. Jelöltek és sorrend
   ====================================================================== */

test('kardió és nyújtás nem kerül a javaslatok közé', () => {
  const result = suggestExercises({ title: 'Teljes test', catalog: CATALOG });
  assert.ok(!names(result).includes('Futópad'));
  assert.ok(!names(result).includes('Mellnyújtás'));
});

test('a már naplózott gyakorlat előre kerül, utána kurált és összetett', () => {
  const workouts = [
    { exercises: [{ name: 'generált MELLNYOMÁS' }] },
    { exercises: [{ name: 'Generált mellnyomás' }] },
  ];
  const result = suggestExercises({ title: 'Mellnap', catalog: CATALOG, workouts });
  assert.deepEqual(names(result), ['Generált mellnyomás', 'Fekvenyomás']);
});

test('csoportonként legfeljebb 2, összesen legfeljebb 8 javaslat, ismétlés nélkül', () => {
  const result = suggestExercises({ title: 'Teljes test', catalog: CATALOG });
  assert.ok(result.suggestions.length <= 8);
  assert.equal(new Set(names(result)).size, result.suggestions.length);
  const perGroup = Object.groupBy(result.suggestions, (s) => s.group);
  for (const list of Object.values(perGroup)) assert.ok(list.length <= 2);
});
