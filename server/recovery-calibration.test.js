/**
 * Az izomfáradtság-modell kalibrációs tesztjei. Kitalált, 6 hetes naplók,
 * a „ma" léptetésével mért d1 / d2 / d3 értékek. Tartományt ellenőriznek, nem
 * pontos számot. Háttér: docs/superpowers/specs/2026-10-08-izomfaradtsag-modell-design.md
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { computeReadiness } from './recovery.js';

const pad = (v) => String(v).padStart(2, '0');
const START = new Date(2026, 0, 5); // hétfő
const dayOf = (n) => {
  const d = new Date(START);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

const set = (reps, rpe) => ({
  reps: String(reps),
  weight: '60',
  rpe: rpe === null ? '' : String(rpe),
  done: true,
  type: 'work',
});
const sets = (n, reps, rpe) => Array.from({ length: n }, () => set(reps, rpe));
const ex = (name, list) => ({ name, pr: false, sets: list });
const wo = (n, exercises) => ({
  id: n,
  date: dayOf(n),
  name: 'Edzés',
  exercises,
  planId: null,
});

/** Hat hét, hetente két alkalom (hétfő és csütörtök). */
const sixWeeks = (session) =>
  Array.from({ length: 6 }, (_, w) => [wo(w * 7, session()), wo(w * 7 + 3, session())]).flat();
const LAST = 42;

const readinessOn = (workouts, day, group) =>
  computeReadiness({
    checkins: [],
    workouts,
    nutrition: { today: {}, yesterday: {} },
    weightLog: [{ kg: 80, date: dayOf(0) }],
    catalog: [],
    today: dayOf(day),
  }).muscles.find((m) => m.key === group);

/** A `last` napi edzés utáni 1., 2., 3. nap pontszáma. */
const curve = (workouts, last, group) =>
  [1, 2, 3].map((d) => readinessOn(workouts, last + d, group).readiness);

const powerSession = () => [ex('Guggolás', sets(5, 3, 8.5)), ex('Fekvenyomás', sets(5, 3, 8.5))];
const legDay = (third = 'Lábtolás') => [
  ex('Guggolás', [...sets(2, 8, 8), ...sets(2, 8, 10)]),
  ex(third, [...sets(2, 10, 8), ...sets(2, 10, 10)]),
  ex('Combnyújtás', [...sets(2, 12, 8), ...sets(2, 12, 10)]),
];
const teamSession = () => [
  ex('Guggolás', sets(3, 6, 7)),
  ex('Fekvenyomás', sets(3, 6, 7)),
  ex('Evezés', sets(3, 8, 7)),
];

test('kalibráció: erőemelő, bukástól távoli nehéz munka után másnapra kész', () => {
  const workouts = [...sixWeeks(powerSession), wo(LAST, powerSession())];
  for (const group of ['quads', 'chest']) {
    const [d1, d2] = curve(workouts, LAST, group);
    assert.ok(d1 >= 75, `${group} d1 ≥ 75 (${d1})`);
    assert.ok(d2 >= 85, `${group} d2 ≥ 85 (${d2})`);
  }
});

test('kalibráció: testépítő, megszokott lábnap a fele bukásig', () => {
  const workouts = [...sixWeeks(legDay), wo(LAST, legDay())];
  const [d1, d2, d3] = curve(workouts, LAST, 'quads');
  assert.ok(d1 >= 65 && d1 <= 85, `d1 65–85 (${d1})`);
  assert.ok(d2 >= 85, `d2 ≥ 85 (${d2})`);
  assert.ok(d3 >= 90, `d3 ≥ 90 (${d3})`);
});

test('kalibráció: csapatsportoló termi munkája másnapra nem fáraszt', () => {
  const workouts = [...sixWeeks(teamSession), wo(LAST, teamSession())];
  const [d1] = curve(workouts, LAST, 'quads');
  assert.ok(d1 >= 85, `d1 ≥ 85 (${d1})`);
});

test('kalibráció: új excentrikus gyakorlat lassabb regenerációt ad, de nem nulláz', () => {
  // A kitörés és a bolgár guggolás izom-megoszlása és excentrikus osztálya
  // azonos, így a személyes referencia is: csak az újdonság különbözik.
  const habitual = [
    ...sixWeeks(() => legDay('Bolgár guggolás')),
    wo(LAST, legDay('Bolgár guggolás')),
  ];
  const novel = [...sixWeeks(() => legDay('Kitörés')), wo(LAST, legDay('Bolgár guggolás'))];
  const [h1] = curve(habitual, LAST, 'quads');
  const [n1, , n3] = curve(novel, LAST, 'quads');
  assert.ok(n1 < h1, `új gyakorlattal d1 alacsonyabb (${n1} < ${h1})`);
  assert.ok(n3 >= 70, `d3 ≥ 70 (${n3})`);
  assert.equal(readinessOn(novel, LAST + 1, 'quads').unusual, 'novelty');
  assert.equal(readinessOn(habitual, LAST + 1, 'quads').unusual, null);
});

test('kalibráció: 6 hónap szünet után ugyanaz az edzés jobban fáraszt', () => {
  const squat = () => [ex('Guggolás', sets(4, 8, 8))];
  const comeback = LAST + 26 * 7;
  const afterBreak = [...sixWeeks(squat), wo(comeback, squat())];
  const continuous = [...sixWeeks(squat), wo(LAST, squat())];
  const [b1] = curve(afterBreak, comeback, 'quads');
  const [c1] = curve(continuous, LAST, 'quads');
  assert.ok(b1 < c1, `szünet után alacsonyabb (${b1} < ${c1})`);
  assert.equal(readinessOn(afterBreak, comeback + 1, 'quads').unusual, 'gap');
});

test('kalibráció: hiányzó RPE ugyanaz, mint az RPE 8', () => {
  const history = sixWeeks(powerSession);
  const noRpe = curve([...history, wo(LAST, [ex('Guggolás', sets(5, 3, null))])], LAST, 'quads');
  const rpe8 = curve([...history, wo(LAST, [ex('Guggolás', sets(5, 3, 8))])], LAST, 'quads');
  assert.deepEqual(noRpe, rpe8);
});

test('kalibráció: új fióknál nincs újdonság-büntetés', () => {
  const workouts = [wo(0, legDay('Bolgár guggolás'))];
  assert.equal(readinessOn(workouts, 1, 'quads').unusual, null);
  const [d1, , d3] = curve(workouts, 0, 'quads');
  assert.ok(d1 >= 40 && d1 <= 70, `abszolút referenciával d1 40–70 (${d1})`);
  assert.ok(d3 >= 80, `d3 ≥ 80 (${d3})`);
});

test('invariáns: közelebb a bukáshoz alacsonyabb pontszám', () => {
  const history = sixWeeks(powerSession);
  const at = (rpe) =>
    readinessOn([...history, wo(LAST, [ex('Guggolás', sets(4, 8, rpe))])], LAST + 1, 'quads')
      .readiness;
  const values = [6, 7, 8, 9, 10].map(at);
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i] < values[i - 1], `RPE-sor szigorúan csökken: ${values.join(', ')}`);
  }
});

test('invariáns: több eltelt nap magasabb pontszám', () => {
  const workouts = [...sixWeeks(legDay), wo(LAST, legDay())];
  const values = [0, 1, 2, 3, 4, 5].map((d) => readinessOn(workouts, LAST + d, 'quads').readiness);
  for (let i = 1; i < values.length; i += 1) {
    assert.ok(values[i] >= values[i - 1], `napok szerint nem csökken: ${values.join(', ')}`);
  }
});

test('küszöbök: a 70-es és 55-ös határ a bukásig vitt munka utáni napot fogja', () => {
  // Új fiók, abszolút referencia: 6×10 bukásig, illetve 6×12 bukásig a négyfejűre.
  const failure10 = [wo(0, [ex('Lábtolás', sets(6, 10, 10)), ex('Combnyújtás', sets(3, 10, 10))])];
  const failure12 = [wo(0, [ex('Lábtolás', sets(6, 12, 10)), ex('Combnyújtás', sets(4, 12, 10))])];
  const d1of = (w) => readinessOn(w, 1, 'quads').readiness;
  assert.ok(d1of(failure10) < 70, `bukásig 10 ismétlés: 70 alatt (${d1of(failure10)})`);
  assert.ok(d1of(failure12) < 55, `bukásig 12 ismétlés: 55 alatt (${d1of(failure12)})`);
});
