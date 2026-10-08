# Izomfáradtság-modell (1. lépés) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Recovery Engine izomcsoport-modelljét két tárolós (gyors + lassú) modellre cserélni, bukás-súllyal, excentrikus és újdonság-szorzóval, kalibrációs tesztekkel, és a regenerációs oldalon jelezni a szokatlan terhelést.

**Architecture:** Minden számítás a szerveren marad, tiszta függvényekben (`server/recovery.js`, `server/muscles.js`). Egy új előmenet (`buildNoveltyIndex`) az egész naplóból kiszámolja az újdonság-szorzókat, a `summarizeWorkouts` napi bucketje a gyors tároló mellé lassú tárolót kap, a `muscleReadiness` a kettő összegéből számol. A kliens csak egy új, opcionális mezőt (`unusual`) jelenít meg. Az izomláz-keverés ebben a lépésben még marad.

**Tech Stack:** Node.js ESM, beépített `node:test` (`npm test`), ESLint (`npm run lint`), vanilla JS kliens.

**Spec:** `docs/superpowers/specs/2026-10-08-izomfaradtsag-modell-design.md`

## Global Constraints

- Ág: `feature/izomfaradtsag-modell` (már létezik, a main-ből).
- Soha ne írj em dasht (U+2014) kódba, kommentbe, UI-szövegbe vagy commitüzenetbe. Tartományban magyar ` – ` vagy `–` rendben van.
- Kommentet csak a nem nyilvánvaló miérthez, 1-2 sorban. Nincs csupa nagybetűs hangsúly, nincs emoji.
- Commitüzenet magyarul, a repó stílusában (`Terület: mit csinál`), trailer nélkül (nincs `Co-Authored-By`).
- Ne formázd újra a fájlok nem érintett részeit (a `prettier --write` a teljes fájlt átírná). Csak a saját sorainkat igazítsd a `.prettierrc.json`-hoz (100 karakter, egyszeres idézőjel).
- Paraméterek a specből, szó szerint: `FAST_TAU = 0.4`, `MUSCLE_REF_MULT = 2.5`, bukás-súly RIR ≥ 4: 0,2 / 3: 0,4 / 2 és hiányzó RPE: 0,55 / 1: 0,75 / 0: 1,0 / 0 és ≥ 12 ismétlés: 1,3; excentrikus szorzó 1,5 / 1,2 / 0,6 / 1,0; újdonság: 3 hétig 1, `1 + 0,8 × (1 − e^(−(hét − 3) / 10))`, új gyakorlat 1,3 (excentrikusnál 1,5), 8 hetes visszatekintés, 4 hetes minimális előzmény, plafon (excentrikus × újdonság) 2,5; a személyes referencia alsó határa a teljes `ABS_GROUP_REF`.
- A kalibrációs tesztek tartományait csak a felhasználó jóváhagyásával szabad módosítani.

## Fájlok

| Fájl | Feladat |
|---|---|
| `server/muscles.js` | Új: `eccentricClass(name)` |
| `server/eccentric.test.js` | Új: az `eccentricClass` tesztjei |
| `server/recovery.js` | Új: `failureWeight`, `buildNoveltyIndex`, `slowSetUnits`, `gapNovelty`, `slowMultiplier`, `muscleDamage`; módosul: `summarizeWorkouts`, `muscleReadiness`, `computeReadiness`, konstansok |
| `server/recovery-novelty.test.js` | Új: `failureWeight` és `buildNoveltyIndex` tesztjei |
| `server/recovery-calibration.test.js` | Új: profilok, különleges esetek, invariánsok, küszöbök |
| `public/js/render/recovery-map.js` | Új: `unusualNote(muscles)` |
| `public/js/render/recovery-map.test.js` | Az `unusualNote` tesztje |
| `public/js/render/recovery.js` | A jelzés kirajzolása a térkép alá |
| `public/style.css` | `.rc-unusual` stílus |

---

### Task 1: Excentrikus osztályozás

**Files:**
- Modify: `server/muscles.js` (az `isAxialLift` után, az `emptyMuscleMap` elé)
- Create: `server/eccentric.test.js`

**Interfaces:**
- Produces: `export function eccentricClass(name: string | undefined): 1.5 | 1.2 | 0.6 | 1` a `server/muscles.js`-ből. A nevet a meglévő `normalizeName`-mel normalizálja (kisbetű, ékezet nélkül).

- [ ] **Step 1: Írd meg a bukó tesztet**

Hozd létre a `server/eccentric.test.js` fájlt:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { eccentricClass } from './muscles.js';

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
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbukik**

Run: `node --test server/eccentric.test.js`
Expected: FAIL, `eccentricClass` nincs exportálva (`SyntaxError: The requested module './muscles.js' does not provide an export named 'eccentricClass'`).

- [ ] **Step 3: Implementáld**

A `server/muscles.js`-ben az `isAxialLift` függvény után, az `/** Egy üres, minden izomcsoportot tartalmazó számláló-objektum` komment elé:

```js
/** Excentrikus jelleg szerinti szorzó a lassú (károsodási) tárolóhoz.
    Edzetteknél a különbség kicsi, ezért csak négy osztály van; a kutatási
    háttér a reports/Izomfáradtság modell kalibráció.md-ben. */
const ECCENTRIC_CLASSES = [
  [1.5, /nordic|nordikus/],
  [0.6, /\bszan|\bsled|prowler/],
  [
    1.2,
    /roman|\brdl\b|merev labu|merev labas|jo reggelt|good ?morning|kitores|lunge|bolgar|bulgarian|deficit|rezsutos padon hajlitas|dontott padon.*(hajlitas|curl)|incline.*curl|fej mogotti|fej (feletti|folotti).*(nyujtas|tricepsz)|overhead.*(extension|tricep)|negativ|excentrikus/,
  ],
];

export function eccentricClass(name) {
  const normalized = normalizeName(name);
  for (const [factor, pattern] of ECCENTRIC_CLASSES) {
    if (pattern.test(normalized)) return factor;
  }
  return 1;
}
```

A sorrend számít: a Nordic és a szán előbb áll, mint az általános 1,2-es minta.

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `node --test server/eccentric.test.js`
Expected: PASS (2 teszt).

- [ ] **Step 5: Commit**

```bash
git add server/muscles.js server/eccentric.test.js
git commit -m "Izommodell: excentrikus jelleg szerinti osztályozás"
```

---

### Task 2: Bukás-súly és újdonság-index

**Files:**
- Modify: `server/recovery.js` (import, konstansok, új függvények a `setStimulus` után)
- Create: `server/recovery-novelty.test.js`

**Interfaces:**
- Consumes: `eccentricClass` (Task 1).
- Produces (mind a `server/recovery.js`-ből):
  - `export function failureWeight(rpe: number | null, reps: number): number`
  - `export function buildNoveltyIndex(workouts: object[], todayKey: number, catalog: object[]): Map<object, Array<Record<string, {value: number, reason: 'novelty' | 'gap' | null}> | null>>`. Kulcs: a workout objektum (referencia szerint), érték: a gyakorlatok sorrendjében egy-egy csoport → szorzó térkép; időalapú (kardió) sornál `null`; 4 hétnél rövidebb előzménynél üres objektum. Csak a `MUSCLE_WINDOW_DAYS` (7) napos ablakba eső edzések kerülnek bele.
  - belső konstans: `NOVELTY` (a Task 3 használja: `NOVELTY.cap`).

- [ ] **Step 1: Írd meg a bukó tesztet**

Hozd létre a `server/recovery-novelty.test.js` fájlt:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { failureWeight, buildNoveltyIndex, dayKey } from './recovery.js';

test('failureWeight: konvex a bukás közelsége szerint', () => {
  assert.equal(failureWeight(5, 8), 0.2);
  assert.equal(failureWeight(6, 8), 0.2);
  assert.equal(failureWeight(7, 8), 0.4);
  assert.equal(failureWeight(8, 8), 0.55);
  assert.equal(failureWeight(9, 8), 0.75);
  assert.equal(failureWeight(10, 8), 1);
  assert.equal(failureWeight(10, 12), 1.3);
  assert.equal(failureWeight(null, 8), 0.55, 'hiányzó RPE: RIR 2');
});

const pad = (v) => String(v).padStart(2, '0');
const START = new Date(2026, 0, 5);
const dayOf = (n) => {
  const d = new Date(START);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};
const sets = (n) =>
  Array.from({ length: n }, () => ({
    reps: '8',
    weight: '60',
    rpe: '8',
    done: true,
  }));
const wo = (n, names) => ({
  date: dayOf(n),
  exercises: names.map((name) => ({ name, sets: sets(3) })),
});

/** A `last` edzés újdonsága a megadott csoportra. */
function noveltyOf(workouts, last, exerciseIndex, group) {
  const index = buildNoveltyIndex(workouts, dayKey(dayOf(last.at)), []);
  return index.get(last.workout)?.[exerciseIndex]?.[group];
}

test('buildNoveltyIndex: megszokott gyakorlatnál és rendszeres edzésnél 1', () => {
  const history = [0, 7, 14, 21, 28, 35].map((n) => wo(n, ['Guggolás']));
  const last = wo(42, ['Guggolás']);
  assert.deepEqual(noveltyOf([...history, last], { at: 42, workout: last }, 0, 'quads'), {
    value: 1,
    reason: null,
  });
});

test('buildNoveltyIndex: új gyakorlat 1,3, excentrikus új gyakorlat 1,5', () => {
  const history = [0, 7, 14, 21, 28, 35].map((n) => wo(n, ['Guggolás']));
  const last = wo(42, ['Lábtolás', 'Bolgár guggolás']);
  const all = [...history, last];
  assert.deepEqual(noveltyOf(all, { at: 42, workout: last }, 0, 'quads'), {
    value: 1.3,
    reason: 'novelty',
  });
  assert.deepEqual(noveltyOf(all, { at: 42, workout: last }, 1, 'quads'), {
    value: 1.5,
    reason: 'novelty',
  });
});

test('buildNoveltyIndex: az új gyakorlat a 3. alkalomtól már nem új', () => {
  const history = [0, 7, 14, 21, 28].map((n) => wo(n, ['Guggolás']));
  const second = wo(35, ['Guggolás', 'Lábtolás']);
  const first = wo(31, ['Lábtolás']);
  const third = wo(42, ['Guggolás', 'Lábtolás']);
  const all = [...history, first, second, third];
  assert.equal(
    noveltyOf(all, { at: 35, workout: second }, 1, 'quads').value,
    1.3,
    '2. alkalom még új',
  );
  assert.equal(
    noveltyOf(all, { at: 42, workout: third }, 1, 'quads').value,
    1,
    '3. alkalom már nem',
  );
});

test('buildNoveltyIndex: hosszú kihagyás után a görbe szerint nő', () => {
  const history = [0, 7, 14, 21, 28, 35].map((n) => wo(n, ['Guggolás']));
  const after26w = wo(35 + 26 * 7, ['Guggolás']);
  const result = noveltyOf(
    [...history, after26w],
    { at: 35 + 26 * 7, workout: after26w },
    0,
    'quads',
  );
  assert.equal(result.reason, 'gap');
  assert.ok(result.value > 1.7 && result.value < 1.75, `26 hétnél ~1,72 (${result.value})`);

  const after3w = wo(35 + 21, ['Guggolás']);
  assert.equal(noveltyOf([...history, after3w], { at: 56, workout: after3w }, 0, 'quads').value, 1);
});

test('buildNoveltyIndex: 4 hétnél rövidebb előzménynél nincs újdonság-szorzó', () => {
  const first = wo(0, ['Guggolás']);
  const later = wo(20, ['Bolgár guggolás']);
  const all = [first, later];
  assert.deepEqual(noveltyOf(all, { at: 20, workout: later }, 0, 'quads'), undefined);
});

test('buildNoveltyIndex: üres vagy érvénytelen napló nem hiba', () => {
  assert.equal(buildNoveltyIndex([], dayKey(dayOf(0)), []).size, 0);
  assert.equal(buildNoveltyIndex(null, dayKey(dayOf(0)), []).size, 0);
  assert.equal(buildNoveltyIndex([{ date: 'rossz', exercises: [] }], dayKey(dayOf(0)), []).size, 0);
});
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbukik**

Run: `node --test server/recovery-novelty.test.js`
Expected: FAIL, a `failureWeight` és a `buildNoveltyIndex` nincs exportálva.

- [ ] **Step 3: Az import bővítése**

A `server/recovery.js` tetején a `./muscles.js` importban az `isAxialLift,` sor után:

```js
  isAxialLift,
  eccentricClass,
  emptyMuscleMap,
```

- [ ] **Step 4: Az `NOVELTY` konstans**

A `const MUSCLE_REF_MULT = 1.5; ...` sor után (a sort magát a Task 3 módosítja):

```js

/** Az újdonság-szorzó paraméterei (kiinduló értékek a kutatási riportból). */
const NOVELTY = {
  gapFreeWeeks: 3, // eddig a kihagyás nem számít
  gapMax: 0.8, // a kihagyás-görbe plafonja 1 + gapMax
  gapScaleWeeks: 10,
  newExercise: 1.3,
  newEccentric: 1.5,
  lookbackDays: 56, // „új gyakorlat": ennyi napban legfeljebb egyszer
  minHistoryDays: 28, // ennél rövidebb előzménynél nincs újdonság-szorzó
  meaningfulStimulus: 1, // ennyi szett-egység nullázza a kihagyás-órát
  cap: 2.5, // újdonság × excentrikus szorzó felső korlátja
};
```

- [ ] **Step 5: Az új függvények**

A `setStimulus` függvény után, a `/**\n * Az app EGYETLEN 1RM-képlete (Epley).` blokk elé:

```js
/** A lassú tároló súlya a bukás közelsége szerint (RIR = 10 − RPE). Edzetteknél
    a bukástól távoli munka után 6–24 óra alatt helyreáll a teljesítmény, a
    bukásig vitt munka után 2–5 napos farok marad. Hiányzó RPE: RIR 2. */
export function failureWeight(rpe, reps) {
  if (rpe === null) return 0.55;
  const rir = Math.round(10 - rpe);
  if (rir <= 0) return reps >= 12 ? 1.3 : 1;
  if (rir === 1) return 0.75;
  if (rir === 2) return 0.55;
  if (rir === 3) return 0.4;
  return 0.2;
}

/** Kihagyás utáni újdonság: 3 hétig 1, utána sima görbén nő (26 hétnél ~1,72). */
function gapNovelty(weeks) {
  if (weeks <= NOVELTY.gapFreeWeeks) return 1;
  return (
    1 + NOVELTY.gapMax * (1 - Math.exp(-(weeks - NOVELTY.gapFreeWeeks) / NOVELTY.gapScaleWeeks))
  );
}

/**
 * Újdonság-szorzó edzésenként, gyakorlatonként és izomcsoportonként, az adott
 * edzés előtti előzményből. Az egész naplót bejárja (a 28 napon túlit is), de
 * csak a MUSCLE_WINDOW_DAYS ablakba eső edzésekhez ad eredményt.
 *
 * @returns {Map<object, Array<Object<string, {value: number, reason: 'novelty'|'gap'|null}>|null>>}
 *   kulcs: a workout objektum; érték: a gyakorlatok sorrendjében egy-egy
 *   csoport → szorzó térkép (időalapú sornál null).
 */
export function buildNoveltyIndex(workouts, todayKey, catalog) {
  const dated = (Array.isArray(workouts) ? workouts : [])
    .map((workout) => ({ workout, key: dayKey(workout?.date) }))
    .filter(({ key }) => Number.isFinite(key) && key <= todayKey)
    .sort((a, b) => a.key - b.key);
  const index = new Map();
  if (!dated.length) return index;

  const firstKey = dated[0].key;
  const lastMeaningful = {}; // csoport → nap-kulcs
  const exerciseDays = new Map(); // normalizált név → nap-kulcsok

  for (const { workout, key } of dated) {
    const mature = daysBetween(firstKey, key) >= NOVELTY.minHistoryDays;
    const groupStimulus = emptyMuscleMap();
    const trainedNames = new Set();
    const perExercise = [];

    for (const exercise of workout.exercises ?? []) {
      if (exercise.logMode === 'duration') {
        perExercise.push(null);
        continue;
      }
      const load = resolveExerciseLoad(exercise.name, catalog);
      const stimulus = (exercise.sets ?? []).reduce((sum, set) => sum + setStimulus(set), 0);
      const name = normalizeName(exercise.name);
      const byGroup = {};

      if (mature && stimulus > 0) {
        const previous = (exerciseDays.get(name) ?? []).filter((day) => {
          const gap = daysBetween(day, key);
          return gap > 0 && gap <= NOVELTY.lookbackDays;
        });
        const exerciseNovelty =
          previous.length <= 1
            ? eccentricClass(exercise.name) > 1
              ? NOVELTY.newEccentric
              : NOVELTY.newExercise
            : 1;
        for (const group of Object.keys(load)) {
          const last = lastMeaningful[group];
          const weeks = last === undefined ? Infinity : daysBetween(last, key) / 7;
          const gap = gapNovelty(weeks);
          const value = Math.max(gap, exerciseNovelty);
          byGroup[group] = {
            value,
            reason: value === 1 ? null : exerciseNovelty >= gap ? 'novelty' : 'gap',
          };
        }
      }
      perExercise.push(byGroup);

      if (stimulus > 0) trainedNames.add(name);
      for (const [group, share] of Object.entries(load)) groupStimulus[group] += stimulus * share;
    }

    // A frissítés az edzés után jön, hogy egy gyakorlat önmagát ne lássa előzménynek.
    for (const name of trainedNames) {
      const days = exerciseDays.get(name) ?? [];
      if (days[days.length - 1] !== key) days.push(key);
      exerciseDays.set(name, days);
    }
    for (const group of MUSCLE_KEYS) {
      if (groupStimulus[group] >= NOVELTY.meaningfulStimulus) lastMeaningful[group] = key;
    }
    if (daysBetween(key, todayKey) <= MUSCLE_WINDOW_DAYS) index.set(workout, perExercise);
  }
  return index;
}
```

Megjegyzés: a `daysBetween`, a `dayKey`, a `setStimulus`, a `resolveExerciseLoad`, a `normalizeName`, az `emptyMuscleMap`, a `MUSCLE_KEYS` és a `MUSCLE_WINDOW_DAYS` már létezik a fájlban.

- [ ] **Step 6: Futtasd, és nézd meg, hogy átmegy**

Run: `node --test server/recovery-novelty.test.js server/recovery.test.js`
Expected: PASS. A `recovery.test.js` változatlanul zöld, mert a motor még nem használja az új függvényeket.

- [ ] **Step 7: Commit**

```bash
git add server/recovery.js server/recovery-novelty.test.js
git commit -m "Recovery Engine: bukás-súly és újdonság-index az izommodellhez"
```

---

### Task 3: Két tárolós izommodell és kalibrációs tesztek

**Files:**
- Modify: `server/recovery.js` (`MUSCLE_REF_MULT`, új konstans és segédek, `summarizeWorkouts`, `muscleReadiness`, `computeReadiness`)
- Create: `server/recovery-calibration.test.js`

**Interfaces:**
- Consumes: `eccentricClass` (Task 1), `failureWeight`, `buildNoveltyIndex`, `NOVELTY` (Task 2).
- Produces: a `computeReadiness(...).muscles[i]` minden eleme új mezőt kap: `unusual: 'novelty' | 'gap' | null`. A többi mező változatlan.

- [ ] **Step 1: Írd meg a kalibrációs teszteket**

Hozd létre a `server/recovery-calibration.test.js` fájlt:

```js
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
  const [h1, , h3] = curve(habitual, LAST, 'quads');
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
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbukik**

Run: `node --test server/recovery-calibration.test.js`
Expected: 6 FAIL (erőemelő, testépítő, csapatsportoló, új excentrikus gyakorlat, szünet, új fiók), 4 PASS (hiányzó RPE, a két invariáns, küszöbök). A prototípuson pontosan ez jött ki a mostani motorral.

- [ ] **Step 3: Konstansok**

Cseréld le ezt a sort:

```js
const MUSCLE_REF_MULT = 1.5; // ennyiszer tipikus szesszió visz egy csoportot nulláig
```

erre:

```js
const MUSCLE_REF_MULT = 2.5; // a gyors és a lassú tároló együtt; kalibrálva: recovery-calibration.test.js

/** A gyors (metabolikus) tároló időállandója napban. A motor napra kerekít,
    így ez gyakorlatilag csak az edzés napját érinti. */
const FAST_TAU = 0.4;
```

- [ ] **Step 4: Szett-szintű segédek**

A Task 2-ben beszúrt `failureWeight` után, a `gapNovelty` elé:

```js
/** Egy teljesített szett lassú-tároló egysége, az izom-részesedés és az
    excentrikus szorzó előtt. Az RPE itt csak a bukás-súlyon át hat. */
function slowSetUnits(set) {
  if (!set?.done) return 0;
  const reps = num(set.reps);
  if (reps === null || reps <= 0) return 0;
  const typeFactor = typeStimulusFactor(set.type);
  if (typeFactor === 0) return 0;
  return typeFactor * failureWeight(num(set.rpe), reps);
}
```

A `gapNovelty` után, a `buildNoveltyIndex` dokumentációs blokkja elé:

```js
/** A lassú tároló szorzója: excentrikus jelleg × újdonság, együtt legfeljebb
    NOVELTY.cap, hogy a két, részben azonos jelenség ne számítson kétszer. */
function slowMultiplier(novelty, eccentric) {
  return Math.min(eccentric * novelty, NOVELTY.cap);
}
```

- [ ] **Step 5: `summarizeWorkouts`: a bucket két új mezője**

Cseréld le:

```js
function summarizeWorkouts(workouts, todayKey, catalog, bodyWeight) {
  const byDay = new Map(); // daysAgo → { load, cns, muscles }
  const exercises = new Map(); // név → { name, sessions: [{ daysAgo, best1RM, sets }] }

  const dayBucket = (ago) => {
    if (!byDay.has(ago)) byDay.set(ago, { load: 0, cns: 0, muscles: emptyMuscleMap() });
    return byDay.get(ago);
  };
```

erre:

```js
function summarizeWorkouts(workouts, todayKey, catalog, bodyWeight, novelty = new Map()) {
  const byDay = new Map(); // daysAgo → { load, cns, muscles, slow, unusual }
  const exercises = new Map(); // név → { name, sessions: [{ daysAgo, best1RM, sets }] }

  // muscles: a gyors tároló, slow: a lassú tároló (mindkettő szett-egység);
  // unusual: volt-e aznap újdonság-szorzós terhelés a csoporton.
  const dayBucket = (ago) => {
    if (!byDay.has(ago)) {
      byDay.set(ago, {
        load: 0,
        cns: 0,
        muscles: emptyMuscleMap(),
        slow: emptyMuscleMap(),
        unusual: Object.fromEntries(MUSCLE_KEYS.map((key) => [key, null])),
      });
    }
    return byDay.get(ago);
  };
```

- [ ] **Step 6: `summarizeWorkouts`: gyakorlat-index**

Cseréld le:

```js
    const bucket = dayBucket(ago);

    for (const exercise of workout.exercises ?? []) {
```

erre:

```js
    const bucket = dayBucket(ago);

    const workoutNovelty = novelty.get(workout) ?? [];
    for (const [exerciseIndex, exercise] of (workout.exercises ?? []).entries()) {
```

- [ ] **Step 7: `summarizeWorkouts`: a lassú egységek gyűjtése**

Cseréld le:

```js
      let exerciseStimulus = 0;
      let best1RM = null;
```

erre:

```js
      let exerciseStimulus = 0;
      let exerciseSlow = 0;
      let best1RM = null;
```

és ezt:

```js
        exerciseStimulus += setStimulus(set);

        const load = setLoad(set);
```

erre:

```js
        exerciseStimulus += setStimulus(set);
        exerciseSlow += slowSetUnits(set);

        const load = setLoad(set);
```

- [ ] **Step 8: `summarizeWorkouts`: szétosztás a csoportokra**

Cseréld le:

```js
      for (const [group, share] of Object.entries(muscleLoad)) {
        bucket.muscles[group] += exerciseStimulus * share;
      }
```

erre:

```js
      const eccentric = eccentricClass(exercise.name);
      const groupNovelty = workoutNovelty[exerciseIndex] ?? {};
      for (const [group, share] of Object.entries(muscleLoad)) {
        bucket.muscles[group] += exerciseStimulus * share;
        if (exerciseSlow > 0) {
          const { value, reason } = groupNovelty[group] ?? { value: 1, reason: null };
          bucket.slow[group] += exerciseSlow * share * slowMultiplier(value, eccentric);
          if (reason === 'novelty' || (reason === 'gap' && !bucket.unusual[group])) {
            bucket.unusual[group] = reason;
          }
        }
      }
```

- [ ] **Step 9: `muscleDamage` és a `muscleReadiness`**

A `function muscleReadiness({ byDay, checkin, hasHistory, hasAnyWorkout }) {` sor elé:

```js
/** Egy izomcsoport károsodása a két tároló összegeként, és hogy az ablakon
    belül érte-e szokatlan terhelés (az új gyakorlat az erősebb jel). */
function muscleDamage(byDay, group) {
  const fast = decayedSum(byDay, FAST_TAU, MUSCLE_WINDOW_DAYS, (bucket) => bucket.muscles[group]);
  const slow = decayedSum(
    byDay,
    TAU_BY_GROUP[group],
    MUSCLE_WINDOW_DAYS,
    (bucket) => bucket.slow[group],
  );
  let unusual = null;
  for (const [ago, bucket] of byDay) {
    if (ago > MUSCLE_WINDOW_DAYS) continue;
    const reason = bucket.unusual[group];
    if (reason === 'novelty' || (reason === 'gap' && !unusual)) unusual = reason;
  }
  return { damage: fast + slow, unusual };
}

```

A `muscleReadiness`-ben cseréld le:

```js
    const tau = TAU_BY_GROUP[group];
    const damage = decayedSum(byDay, tau, MUSCLE_WINDOW_DAYS, (bucket) => bucket.muscles[group]);
```

erre:

```js
    const { damage, unusual } = muscleDamage(byDay, group);
```

ezt:

```js
        ? Math.max(personalRef[group], absoluteRef * 0.5)
```

erre:

```js
        ? Math.max(personalRef[group], absoluteRef)
```

és a visszaadott objektumban ezt:

```js
      lastLoadedDaysAgo,
    };
```

erre:

```js
      lastLoadedDaysAgo,
      unusual,
    };
```

- [ ] **Step 10: Bekötés a `computeReadiness`-ben**

Cseréld le:

```js
  const { byDay, exercises } = summarizeWorkouts(workouts, todayKey, catalog, bodyWeight);
```

erre:

```js
  const novelty = buildNoveltyIndex(workouts, todayKey, catalog);
  const { byDay, exercises } = summarizeWorkouts(workouts, todayKey, catalog, bodyWeight, novelty);
```

- [ ] **Step 11: Futtasd a kalibrációs és a motor-teszteket**

Run: `node --test server/recovery-calibration.test.js server/recovery-novelty.test.js server/eccentric.test.js server/recovery.test.js server/muscles.test.js`
Expected: mind PASS (a prototípuson 102 teszt, 0 hiba).

Ha egy kalibrációs teszt elbukik: ne a tartományt írd át. Ellenőrizd a fenti lépéseket a spec képleteivel; ha a kód egyezik, állj meg, és jelentsd a felhasználónak a mért számokat (a teszt üzenete kiírja őket).

- [ ] **Step 12: A teljes tesztcsomag és a lint**

Run: `npm test`
Expected: minden PASS. Ha az `api.test.js` vagy más teszt az izom-objektum pontos alakját várja (`deepEqual`), az új `unusual` mezőt add hozzá az elvárt értékhez (`unusual: null`), ne töröld a mezőt.

Run: `npm run lint`
Expected: 0 hiba.

- [ ] **Step 13: Elavult kommentek**

Run: `git grep -n "MUSCLE_REF_MULT\|absoluteRef \* 0.5\|1,5-szer\|1.5 ×" -- server/`
Ha egy komment a régi 1,5-ös szorzóra vagy a fél abszolút alsó határra hivatkozik, igazítsd az új értékhez (1-2 sor, em dash nélkül).

- [ ] **Step 14: Commit**

```bash
git add server/recovery.js server/recovery-calibration.test.js
git commit -m "Recovery Engine: két tárolós izommodell, újdonság- és excentrikus szorzó, kalibrációs tesztek"
```

---

### Task 4: Szokatlan terhelés jelzése a regenerációs oldalon

**Files:**
- Modify: `public/js/render/recovery-map.js` (új export a `muscleNote` után)
- Modify: `public/js/render/recovery-map.test.js`
- Modify: `public/js/render/recovery.js` (`renderMuscleMap`)
- Modify: `public/style.css` (a `.rc-spare-note` szabály után)

**Interfaces:**
- Consumes: `muscles[i].unusual: 'novelty' | 'gap' | null` (Task 3), `muscles[i].label`, `muscles[i].known`.
- Produces: `export function unusualNote(muscles?: object[]): string | null` a `recovery-map.js`-ből.

- [ ] **Step 1: Írd meg a bukó tesztet**

A `public/js/render/recovery-map.test.js` importlistájában a `muscleNote,` után add hozzá: `unusualNote,`. A fájl végére:

```js

test('unusualNote: a szokatlan terhelést kapott ismert csoportok, okonként', () => {
  assert.equal(unusualNote([m('quads', 70), m('chest', 90)]), null);
  assert.equal(unusualNote([]), null);
  assert.equal(unusualNote(null), null);
  assert.equal(
    unusualNote([
      m('quads', 60, { unusual: 'novelty' }),
      m('glutes', 65, { unusual: 'novelty' }),
      m('calves', 80, { unusual: 'gap' }),
    ]),
    'Szokatlan terhelés (új gyakorlat: quads, glutes; hosszú kihagyás után: calves), ezért ezek lassabban regenerálódnak.',
  );
  assert.equal(unusualNote([m('quads', 60, { unusual: 'gap', known: false })]), null);
});
```

(Az `m` segéd a fájl elején már létezik: a `label` a kulcs.)

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbukik**

Run: `node --test public/js/render/recovery-map.test.js`
Expected: FAIL, az `unusualNote` nincs exportálva.

- [ ] **Step 3: Implementáld**

A `public/js/render/recovery-map.js`-ben a `muscleNote` függvény után:

```js

/** A szokatlan terhelést (új gyakorlat, hosszú kihagyás) kapott csoportok
    rövid magyarázata a térkép alá. Null, ha nincs ilyen csoport. */
export function unusualNote(muscles = []) {
  const list = (muscles ?? []).filter((muscle) => muscle.known !== false);
  const labels = (reason) =>
    list.filter((muscle) => muscle.unusual === reason).map((muscle) => muscle.label);
  const parts = [];
  const novel = labels('novelty');
  const gap = labels('gap');
  if (novel.length) parts.push(`új gyakorlat: ${novel.join(', ')}`);
  if (gap.length) parts.push(`hosszú kihagyás után: ${gap.join(', ')}`);
  if (!parts.length) return null;
  return `Szokatlan terhelés (${parts.join('; ')}), ezért ezek lassabban regenerálódnak.`;
}
```

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `node --test public/js/render/recovery-map.test.js`
Expected: PASS.

- [ ] **Step 5: Kirajzolás**

A `public/js/render/recovery.js` importlistájában (`from './recovery-map.js'`) a `spareList,` után add hozzá: `unusualNote,`.

A `renderMuscleMap` függvény végén cseréld le:

```js
  host.replaceChildren(wide, split, tabbedMap(byKey, view));
}
```

erre:

```js
  host.replaceChildren(wide, split, tabbedMap(byKey, view));

  const note = unusualNote(muscles);
  if (note) {
    const el = document.createElement('p');
    el.className = 'rc-unusual';
    el.textContent = note;
    host.append(el);
  }
}
```

A `host.replaceChildren(...)` sor egyszer szerepel a fájlban.

- [ ] **Step 6: Stílus**

A `public/style.css`-ben a `.rc-spare-note { ... }` szabály után:

```css
.rc-unusual {
  margin: var(--sp-6) 0 0;
  font-size: var(--fs-xs);
  line-height: 1.55;
  color: var(--fg-55);
}
```

- [ ] **Step 7: Próba a böngészőben**

Indítsd a szervert (`npm start`, a 127.0.0.1:3000-en), lépj be egy tesztfiókkal, naplózz egy edzést egy olyan gyakorlattal, amit a fiók még nem csinált (a fióknak legyen legalább 4 hetes előzménye; ha nincs ilyen fiók, ezt a lépést hagyd ki, és írd meg a jelentésben). Nyisd meg a Regeneráció oldalt: a térkép alatt meg kell jelennie a „Szokatlan terhelés (új gyakorlat: …)” sornak asztali, tablet és mobil szélességen is. Ha nincs szokatlan terhelés, a sor nem jelenik meg.

- [ ] **Step 8: Teljes tesztcsomag, lint, commit**

Run: `npm test` és `npm run lint`
Expected: minden PASS, 0 lint-hiba.

```bash
git add public/js/render/recovery-map.js public/js/render/recovery-map.test.js public/js/render/recovery.js public/style.css
git commit -m "Regeneráció: szokatlan terhelés jelzése a térkép alatt"
```

---

### Task 5: Kapu a 2. lépéshez

**Files:** nincs kódváltozás.

- [ ] **Step 1: Kalibrációs eredmények összegyűjtése**

Run: `node --test server/recovery-calibration.test.js`
Expected: 10 PASS.

- [ ] **Step 2: Jelentés a felhasználónak**

Írd meg röviden: a kalibrációs tesztek izomláz nélkül is tartományon belül vannak-e (a motor ebben a lépésben még keveri az izomlázat, de a tesztek check-in nélkül futnak, tehát izomláz nélkül mérnek). Ha igen, a 2. lépés (az izomláz kivezetése, spec 4. szakasz) indulhat, külön implementációs tervvel. A 2. lépést ebben a tervben ne kezdd el.
