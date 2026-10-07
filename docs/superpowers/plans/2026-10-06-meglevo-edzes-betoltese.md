# Meglévő edzés betöltése — megvalósítási terv

> **Agent-végrehajtóknak:** KÖTELEZŐ al-skill: superpowers:subagent-driven-development
> (ajánlott) vagy superpowers:executing-plans. A lépések `- [ ]` jelölőnégyzetek.

**Cél:** A terv-építőből kikerül az „Ugyanaz, mint…" mód; helyette az Edzés
panelen egy „Meglévő edzés betöltése" gomb egy kereshető választó-oldalra visz,
ahonnan a terv másik napja vagy egy naplózott edzés gyakorlatai **másolatként**
kerülnek a kijelölt napba (nem üres napnál megerősítés után, cserével).

**Architektúra:** A tiszta logika (régi `same` napok feloldása másolattá,
gyakorlatlista másolása, keresés) egy új, tesztelt kliens-modulba kerül
(`public/js/core/plan-sources.js`). Az új flow-oldal (`workout-picker`) saját
setup-modult kap (`public/js/ui/workout-picker.js`) a gyakorlat-választó
mintájára; a terv-építő egy `open(context)` hívással célozza. A szerver és az
adatformátum **nem változik**: a `same` nap a régi tervekben tovább működik.

**Tech stack:** Vanilla JS ES-modulok, Express + SQLite (érintetlen),
`node:test`, ESLint, Prettier.

**Spec:** `docs/superpowers/specs/2026-10-06-meglevo-edzes-betoltese-design.md`
**Demó:** `docs/superpowers/demos/2026-10-06-meglevo-edzes-demo.html`

## Globális megkötések

- A szerver (`server/plan-week.js`, `server/db.js`, `server/server.js`) nem módosul; a `same` nap továbbra is érvényes bemenet.
- A kliens mentéskor csak `{ type: 'workout', name, exercises }` és `{ type: 'rest' }` napot küld.
- Betöltés = **másolat**; a forrás későbbi változása nem hat a napra.
- Nem üres napnál megerősítés: cím „Lecseréled a gyakorlatokat?", gomb „Csere" — a meglévő `confirmAction` (`setupConfirmDialog`) ablakkal, nem `window.confirm`-mel.
- Naplóból betöltve minden szett `done: false`, minden gyakorlat `pr: false`.
- Ha a napnak nincs saját neve, a forrás saját nevét kapja (a „Tervnév – Nap" alapnevet NEM).
- „Korábbi edzések": minden naplózott edzés, legújabb elöl (`api.getWorkouts()` sorrendje), nincs összevonás.
- Kódstílus: a környező kódhoz igazodva — magyar kommentek, 2 szóköz, egyszeres idézőjel, Prettier.
- Ellenőrzés: `npm test`, `npm run lint`, `npm run format:check` mind zöld.

## Fájlok

| Fájl                                  | Változás                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `public/js/core/plan-sources.js`      | **Új.** `inlineSameDays`, `copyExercises`, `matchesQuery`                  |
| `public/js/core/plan-sources.test.js` | **Új.** A fenti három tesztje                                              |
| `public/js/ui/workout-picker.js`      | **Új.** A választó-oldal: `setupWorkoutPicker(confirmAction)` → `{ open }` |
| `public/js/ui/plan-builder.js`        | `same` mód ki; `fill` a feloldott hetet tölti; új gomb kezelése            |
| `public/index.html`                   | „Ugyanaz, mint…" gomb + `.pb-same` blokk ki; új gomb; új oldal; új sablon  |
| `public/js/core/constants.js`         | `workout-picker` a `PAGES` és `FLOW_PAGES` listába                         |
| `public/js/nav/router.js`             | `PAGE_TITLES` / `PAGE_ICONS` új kulcs                                      |
| `public/js/app/init.js`               | `setupWorkoutPicker` felépítése, átadás a terv-építőnek                    |
| `public/style.css`                    | `.pb-same*` szabályok ki; `.wp-*` pár sor                                  |
| `README.md`                           | A „Heti bontású tervek" bekezdés                                           |

---

### 1. feladat: Tiszta segédfüggvények (`plan-sources.js`)

**Fájlok:**

- Létrehoz: `public/js/core/plan-sources.js`
- Teszt: `public/js/core/plan-sources.test.js`

**Interfészek:**

- Termel:
  - `inlineSameDays(week: Day[]): Day[]` — a `same` napokat a hivatkozott nap másolatává alakítja (`{ type: 'workout', name, exercises }`); érvénytelen hivatkozás → `{ type: 'rest' }`. A többi nap változatlan alakú másolat.
  - `copyExercises(exercises: Exercise[]): Exercise[]` — mély másolat, `pr: false`, minden szett `done: false`.
  - `matchesQuery(source: { name: string, exercises: Exercise[] }, query: string): boolean` — üres keresésre `true`; különben kis-nagybetű-függetlenül a névben VAGY bármely gyakorlat nevében.

- [ ] **1. lépés: A bukó teszt megírása**

`public/js/core/plan-sources.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { copyExercises, inlineSameDays, matchesQuery } from './plan-sources.js';

const squat = { name: 'Guggolás', pr: true, sets: [{ reps: 5, weight: 100, done: true }] };

test('a „same" nap a hivatkozott nap másolatává válik', () => {
  const week = [
    { type: 'workout', name: 'Láb nap', exercises: [{ ...squat }] },
    { type: 'rest' },
    { type: 'rest' },
    { type: 'same', of: 0 },
    { type: 'rest' },
    { type: 'rest' },
    { type: 'rest' },
  ];
  const result = inlineSameDays(week);
  assert.equal(result[3].type, 'workout');
  assert.equal(result[3].name, 'Láb nap');
  assert.equal(result[3].exercises[0].name, 'Guggolás');
  // Másolat: a forrás átírása nem hat rá
  week[0].exercises[0].name = 'Más';
  assert.equal(result[3].exercises[0].name, 'Guggolás');
  assert.deepEqual(result[1], { type: 'rest' });
});

test('érvénytelen „same" hivatkozás pihenő lesz', () => {
  const week = [{ type: 'same', of: 1 }, { type: 'rest' }, { type: 'same', of: 9 }];
  assert.deepEqual(inlineSameDays(week), [{ type: 'rest' }, { type: 'rest' }, { type: 'rest' }]);
});

test('a másolt gyakorlat nem rekord, és egyik szettje sincs kész', () => {
  const [copy] = copyExercises([squat]);
  assert.equal(copy.pr, false);
  assert.equal(copy.sets[0].done, false);
  assert.equal(copy.sets[0].weight, 100);
  assert.equal(squat.sets[0].done, true, 'a forrás érintetlen');
});

test('a keresés a névre és a gyakorlatok nevére is illeszkedik', () => {
  const source = { name: 'Láb nap', exercises: [squat] };
  assert.equal(matchesQuery(source, ''), true);
  assert.equal(matchesQuery(source, '  láb '), true);
  assert.equal(matchesQuery(source, 'GUGG'), true);
  assert.equal(matchesQuery(source, 'fekve'), false);
});
```

- [ ] **2. lépés: Futtatás — bukik**

Futtasd: `node --test public/js/core/plan-sources.test.js`
Várt: FAIL — `Cannot find module …/plan-sources.js`

- [ ] **3. lépés: Implementáció**

`public/js/core/plan-sources.js`:

```js
/** A terv-építő „Meglévő edzés betöltése" tiszta segédei: a régi „same"
    napok feloldása, a betöltött gyakorlatok másolása és a választó keresése.
    DOM nélkül, hogy node:test-tel tesztelhetők legyenek. */

/** Gyakorlatlista mély másolata tervbe: a terv sablon, ezért egyik gyakorlat
    sem rekord, és egyik szett sincs teljesítve (a naplóból jövő is). */
const copyExercises = (exercises) =>
  (exercises ?? []).map((exercise) => ({
    ...exercise,
    pr: false,
    sets: (exercise.sets ?? []).map((set) => ({ ...set, done: false })),
  }));

/** A régi tervek „ugyanaz, mint" napjai a terv-építőben a hivatkozott nap
    MÁSOLATÁVÁ válnak — a kezelőfelület már nem ismer kapcsolt napot. A
    szerver a „same"-et továbbra is elfogadja, így a nem szerkesztett régi
    tervek változatlanul futnak. Érvénytelen hivatkozás pihenő lesz. */
const inlineSameDays = (week) =>
  week.map((entry) => {
    if (entry?.type === 'workout') {
      return { type: 'workout', name: entry.name ?? '', exercises: copyExercises(entry.exercises) };
    }
    const source = entry?.type === 'same' ? week[entry.of] : null;
    if (source?.type === 'workout') {
      return {
        type: 'workout',
        name: source.name ?? '',
        exercises: copyExercises(source.exercises),
      };
    }
    return { type: 'rest' };
  });

/** A választó keresője: az edzés nevére vagy bármelyik gyakorlatára illeszt. */
const matchesQuery = (source, query) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [source.name, ...source.exercises.map((exercise) => exercise.name)].some((text) =>
    String(text ?? '')
      .toLowerCase()
      .includes(needle),
  );
};

export { copyExercises, inlineSameDays, matchesQuery };
```

- [ ] **4. lépés: Futtatás — átmegy**

Futtasd: `node --test public/js/core/plan-sources.test.js`
Várt: 4 teszt PASS

- [ ] **5. lépés: Commit**

```bash
git add public/js/core/plan-sources.js public/js/core/plan-sources.test.js
git commit -m "Terv-építő: segédek a meglévő edzés betöltéséhez"
```

---

### 2. feladat: A terv-építőből kikerül az „Ugyanaz, mint…"

**Fájlok:**

- Módosít: `public/index.html` (a terv-építő panel, ~824–862. sor)
- Módosít: `public/js/ui/plan-builder.js`
- Módosít: `public/style.css` (~5919–5946. sor, `.pb-same*`)

**Interfészek:**

- Fogyaszt: `inlineSameDays` (1. feladat)
- A `days[i]` alakja innentől `{ type: 'workout' | 'rest', name }` (az `of` mező megszűnik).

- [ ] **1. lépés: HTML — a harmadik gomb és a `.pb-same` blokk törlése**

A `public/index.html`-ben a `data-pb-mode="same"` gombot és a teljes
`<!-- „Ugyanaz, mint …" … -->` + `<div class="pb-same" data-pb-same hidden>…</div>`
blokkot töröld. A hét kommentje:

```html
<!-- A hét: minden nap saját edzés vagy pihenő, és hetente
             ismétlődik. A fülek a napok; alattuk a kijelölt nap panelje. -->
```

- [ ] **2. lépés: CSS — a `.pb-same`, `.pb-same-label` szabályok törlése**

A `public/style.css`-ben a `.pb-same {…}` és `.pb-same-label {…}` törlendő, a
közös szelektorokból pedig a `.pb-same-select` kiesik:

```css
.pb-day-name {
  /* …változatlan törzs… */
}

.pb-day-name:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 1px;
}
```

- [ ] **3. lépés: JS — a `same` logika kivétele a `plan-builder.js`-ből**

Változások (a többi sor marad):

```js
/** Tervkészítő: a hét napjai (edzés / pihenő), gyakorlatok, mentés. */
// …importok mellé:
import { inlineSameDays } from '../core/plan-sources.js';

/** Üres hét egy új tervhez: hétfőn edzés, a többi pihenő. */
const freshDays = () =>
  DAY_LABELS.map((_, day) => ({ type: day === 0 ? 'workout' : 'rest', name: '' }));
```

A fejléc-komment („A terv EGY HÉT: …") közepe: „…edzés (saját név +
gyakorlatkártyák) vagy pihenő. Egy edzésnapba a „Meglévő edzés betöltése" a
terv másik napjának vagy egy naplózott edzésnek a MÁSOLATÁT tölti…".

Töröld: a `sameWrap`, `sameSelect` konstansokat; a `sameTargets` és
`releaseReferences` függvényt; a `sameSelect` change-figyelőt.

```js
/** A készülő hét a szerver alakjában (server/plan-week.js). */
const readWeek = () =>
  days.map((day, index) =>
    day.type === 'workout'
      ? { type: 'workout', name: day.name.trim(), exercises: readExercises(lists[index]) }
      : { type: 'rest' },
  );

/** A nap rövid állapota a fülön. */
const statusOf = (day) => {
  const entry = days[day];
  if (entry.type === 'rest') return 'Pihenő';
  const count = exerciseCount(day);
  return entry.name.trim() || (count ? `${count} gyak.` : 'Üres');
};
```

`renderPanel`-ből a `sameWrap.hidden = …` sor és az `if (entry.type === 'same') {…}`
blokk törlendő. A `setMode` egyszerűsödik — a pihenőre váltott nap listája a
DOM-ban marad (rejtve), így a visszaváltás nem veszít adatot:

```js
/** A kijelölt nap típusának váltása. A pihenőre állított nap gyakorlatai
      rejtve megmaradnak — visszaváltáskor ott vannak; mentéskor nem mennek fel. */
const setMode = (type) => {
  if (days[activeDay].type === type) return;
  days[activeDay] = { type, name: days[activeDay].name };
  renderPanel();
};
```

A `fill` a feloldott hetet tölti:

```js
/** A builder feltöltése egy héttel (üres héttel új tervhez). A régi tervek
      „same" napjai itt másolattá válnak (inlineSameDays). */
const fill = (name, week) => {
  nameInput.value = name;
  nameInput.classList.remove('has-error');
  nameError.hidden = true;
  lists.forEach((list) => list.replaceChildren());
  days = inlineSameDays(week).map((entry, day) => {
    if (entry.type !== 'workout') return { type: 'rest', name: '' };
    entry.exercises.forEach((exercise) => {
      lists[day].appendChild(renderExercise(exercise, { withAddSet: true }));
    });
    return { type: 'workout', name: entry.name };
  });
  const firstWorkout = days.findIndex((day) => day.type === 'workout');
  selectDay(Math.max(0, firstWorkout));
};
```

Az `updateSummary`-ban a `training` számítás marad (`type !== 'rest'`).

- [ ] **4. lépés: Ellenőrzés**

Futtasd: `npm test && npm run lint`
Várt: minden PASS, nincs lint-hiba (különösen: nincs fel nem használt
változó/import, pl. `DAY_NAMES` még kell a `toastTarget`-hez).
Futtasd: `grep -n "same" public/js/ui/plan-builder.js` — csak az
`inlineSameDays` import/hívás és kommentek maradhatnak.

- [ ] **5. lépés: Commit**

```bash
git add public/index.html public/js/ui/plan-builder.js public/style.css
git commit -m "Terv-építő: az „Ugyanaz, mint…\" mód kivezetése, régi napok másolattá"
```

---

### 3. feladat: Az edzés-választó oldal és a „Meglévő edzés betöltése" gomb

**Fájlok:**

- Létrehoz: `public/js/ui/workout-picker.js`
- Módosít: `public/index.html` (új gomb a `.pb-workout`-ban; új `<section>` az `exercise-picker` után; új `<template>` a `tpl-picker-item` után)
- Módosít: `public/js/core/constants.js`, `public/js/nav/router.js`, `public/js/app/init.js`, `public/js/ui/plan-builder.js`, `public/style.css`

**Interfészek:**

- Fogyaszt: `copyExercises`, `matchesQuery` (1. feladat); `api.getWorkouts()` → `[{ id, name, date, exercises, … }]`, legújabb elöl; `confirmAction(message, { title, confirmLabel }) → Promise<boolean>`.
- Termel: `setupWorkoutPicker(confirmAction) → { open(context) }`, ahol
  `context = { subtitle: string, dayTitle: string, planSources: Source[], currentCount: () => number, onPick: (source: Source) => void }`
  és `Source = { name: string, tag: string, adoptName: string, exercises: Exercise[] }`.
- `setupPlanBuilder(picker, workoutPicker)` — új második paraméter.

- [ ] **1. lépés: Oldal-regisztráció**

`public/js/core/constants.js` — a `PAGES` listába `'exercise-picker'` után
`'workout-picker'`; a `FLOW_PAGES`:

```js
const FLOW_PAGES = ['summary', 'plan-builder', 'exercise-picker', 'workout-picker', 'checkin']; // friss megnyitáskor nem állnak vissza
```

A felette álló kommentben a flow-oldalak felsorolásába: „…az 'exercise-picker',
a 'workout-picker' és a 'checkin'…", illetve „…a „+ Gyakorlat hozzáadása", a
„Meglévő edzés betöltése"…".

`public/js/nav/router.js`:

```js
  'workout-picker': 'Edzés betöltése',        // PAGE_TITLES
  'workout-picker': 'icon-page-plan-builder', // PAGE_ICONS
```

(a kommentben a „11 kulcs" → „12 kulcs").

- [ ] **2. lépés: HTML — gomb, oldal, sablon**

A `.pb-workout`-ban a `pb-day-name` input után, a `data-pb-lists` elé:

```html
<!-- Egy meglévő edzés (a terv másik napja vagy a napló) MÁSOLATA
                 kerül a napba — a választó flow-oldalra visz (#workout-picker) -->
<button class="wk-add-exercise pb-load" type="button" data-action="builder-load-workout">
  Meglévő edzés betöltése
</button>
```

Az `exercise-picker` `<section>` után:

```html
<!-- ================================================================
           Workout Picker — meglévő edzés betöltése (flow-oldal)
           A terv-építő „Meglévő edzés betöltése" gombja hozza be. Két forrás:
           a terv többi edzésnapja és a napló minden edzése (legújabb elöl).
           A választás a kijelölt nap gyakorlatait MÁSOLATTAL cseréli le.
           ================================================================ -->
<section
  class="app-page ep-page"
  data-page="workout-picker"
  aria-labelledby="title-workout-picker"
  hidden
>
  <header class="ep-header">
    <button
      class="ep-back tap-target"
      type="button"
      data-action="workout-picker-back"
      aria-label="Vissza a terv-építőhöz"
    >
      ←
    </button>
    <div class="ep-header-text">
      <p class="ep-subtitle ds-eyebrow" data-wp-subtitle></p>
      <h2 class="ep-title" id="title-workout-picker">Edzés betöltése</h2>
    </div>
  </header>

  <div class="nu-search">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10 4a6 6 0 1 0 3.8 10.6l5 5 1.4-1.4-5-5A6 6 0 0 0 10 4zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"
      />
    </svg>
    <label class="sr-only" for="workout-search">Keresés az edzések között</label>
    <input
      type="search"
      id="workout-search"
      placeholder="Keresés az edzések között…"
      autocomplete="off"
    />
  </div>

  <section class="wp-block" data-wp-plan aria-labelledby="title-wp-plan" hidden>
    <h3 class="wp-block-title ds-eyebrow" id="title-wp-plan">A terv napjai</h3>
    <div class="ep-list" data-list="wp-plan"></div>
  </section>

  <section class="wp-block" data-wp-log aria-labelledby="title-wp-log" hidden>
    <h3 class="wp-block-title ds-eyebrow" id="title-wp-log">Korábbi edzések</h3>
    <div class="ep-list" data-list="wp-log"></div>
  </section>

  <p class="ep-empty" data-wp-empty hidden></p>
</section>
```

A `tpl-picker-item` sablon után:

```html
<!-- Az edzés-választó egy sora: név, forrás (nap vagy dátum), gyakorlatok -->
<template id="tpl-workout-source">
  <article class="ep-item ds-row">
    <div class="ep-item-info ds-row-main">
      <h3 class="ep-item-name ds-row-name"></h3>
      <p class="ep-item-meta">
        <span class="ep-item-tag"></span><span class="ep-item-muscles ds-row-sub"></span>
      </p>
    </div>
    <button class="ep-item-toggle tap-target" type="button">→</button>
  </article>
</template>
```

- [ ] **3. lépés: CSS**

A `public/style.css` ep-* szakaszának végére:

```css
/* Az edzés-választó (workout-picker) két blokkja: a terv napjai és a napló */
.wp-block-title {
  margin: var(--sp-9) 0 var(--sp-4);
}

/* A sor gyakorlat-felsorolása hosszú lehet: egy sorban, kipontozva */
[data-page='workout-picker'] .ep-item-muscles {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* A betöltés-gomb a hozzáadás-gomb testvére, de a lista FÖLÖTT áll */
.pb-load {
  margin-bottom: 0;
}
```

- [ ] **4. lépés: `public/js/ui/workout-picker.js`**

```js
/** Edzés-választó: a terv-építő kijelölt napjába egy meglévő edzés MÁSOLATÁT
    tölti — a terv egy másik napjáét vagy egy naplózott edzését. */

import { api } from '../core/api.js';
import { $, cloneTemplate } from '../core/dom.js';
import { matchesQuery } from '../core/plan-sources.js';
import { showToast } from '../core/toast.js';
import { navigate } from '../nav/router.js';

/** A választó flow-oldal. A hívó (a terv-építő) `open(context)`-tel nyitja:
    { subtitle, dayTitle, planSources, currentCount, onPick }. A napló
    forrásait minden megnyitáskor a szervertől kéri (a mai mentés is
    látsszon). Választáskor nem üres napnál rákérdez, aztán az `onPick`
    cserél, és visszavisz a terv-építőbe. */
function setupWorkoutPicker(confirmAction) {
  const page = $('[data-page="workout-picker"]');
  const subtitleEl = $('[data-wp-subtitle]', page);
  const searchInput = $('#workout-search');
  const planBlock = $('[data-wp-plan]', page);
  const planList = $('[data-list="wp-plan"]', page);
  const logBlock = $('[data-wp-log]', page);
  const logList = $('[data-list="wp-log"]', page);
  const emptyState = $('[data-wp-empty]', page);

  let context = null;
  let logSources = [];

  const pick = async (source) => {
    const count = context.currentCount();
    if (count > 0) {
      const ok = await confirmAction(
        `${context.dayTitle}: a ${count} gyakorlat helyére a(z) „${source.name}” ${source.exercises.length} gyakorlata kerül.`,
        { title: 'Lecseréled a gyakorlatokat?', confirmLabel: 'Csere' },
      );
      if (!ok) return;
    }
    context.onPick(source);
    navigate('plan-builder');
  };

  const buildRow = (source) => {
    const item = cloneTemplate('tpl-workout-source');
    $('.ep-item-name', item).textContent = source.name;
    $('.ep-item-tag', item).textContent = source.tag;
    $('.ep-item-muscles', item).textContent =
      `${source.exercises.length} gyakorlat · ${source.exercises
        .map((exercise) => exercise.name)
        .join(', ')}`;
    const button = $('.ep-item-toggle', item);
    button.setAttribute('aria-label', `${source.name} betöltése`);
    button.addEventListener('click', () => pick(source));
    return item;
  };

  /** Egy blokk feltöltése a keresésnek megfelelő forrásokkal; a találatok
      számát adja vissza. Üres blokk el is tűnik. */
  const fillBlock = (block, list, sources) => {
    const shown = sources.filter((source) => matchesQuery(source, searchInput.value));
    list.replaceChildren(...shown.map(buildRow));
    block.hidden = shown.length === 0;
    return shown.length;
  };

  const render = () => {
    const total =
      fillBlock(planBlock, planList, context.planSources) +
      fillBlock(logBlock, logList, logSources);
    emptyState.hidden = total > 0;
    emptyState.textContent = searchInput.value.trim()
      ? 'Nincs találat a keresésre.'
      : 'Még nincs betölthető edzés — sem a terv más napján, sem a naplóban.';
  };

  searchInput.addEventListener('input', () => context && render());
  $('[data-action="workout-picker-back"]').addEventListener('click', () =>
    navigate('plan-builder'),
  );

  const open = async (next) => {
    context = next;
    subtitleEl.textContent = next.subtitle;
    searchInput.value = '';
    logSources = [];
    render();
    navigate('workout-picker');
    try {
      const workouts = await api.getWorkouts();
      // Közben újra megnyitották egy másik napra — a régi válasz már nem ide tartozik
      if (context !== next) return;
      logSources = workouts
        .filter((workout) => workout.exercises?.length)
        .map((workout) => ({
          name: workout.name || 'Edzés',
          tag: workout.date,
          adoptName: workout.name ?? '',
          exercises: workout.exercises,
        }));
      render();
    } catch (err) {
      console.error(err);
      showToast('Nem sikerült betölteni a korábbi edzéseket', 'error');
    }
  };

  return { open };
}

export { setupWorkoutPicker };
```

- [ ] **5. lépés: A terv-építő bekötése (`plan-builder.js`)**

Szignatúra és import:

```js
import { copyExercises, inlineSameDays } from '../core/plan-sources.js';
// …
async function setupPlanBuilder(picker, workoutPicker) {
```

A `builder-add-exercise` figyelő után:

```js
// „Meglévő edzés betöltése": a terv másik edzésnapjai helyben, a napló a
// választóban töltődik. A kijelölt napot a hívás pillanatában rögzítjük.
$('[data-action="builder-load-workout"]').addEventListener('click', () => {
  const day = activeDay;
  workoutPicker?.open({
    subtitle: `${dayTitle(day)} · ${dayWorkoutTitle(day)}`,
    dayTitle: dayTitle(day),
    planSources: days.flatMap((entry, index) =>
      entry.type === 'workout' && index !== day && exerciseCount(index)
        ? [
            {
              name: dayWorkoutTitle(index),
              tag: dayTitle(index),
              adoptName: entry.name.trim(),
              exercises: readExercises(lists[index]),
            },
          ]
        : [],
    ),
    currentCount: () => exerciseCount(day),
    onPick: (source) => {
      lists[day].replaceChildren(
        ...copyExercises(source.exercises).map((exercise) =>
          renderExercise(exercise, { withAddSet: true }),
        ),
      );
      if (!days[day].name.trim()) days[day].name = source.adoptName;
      selectDay(day);
      showToast(`„${source.name}” betöltve — ${dayTitle(day)}`);
    },
  });
});
```

- [ ] **6. lépés: `init.js`**

Import: `import { setupWorkoutPicker } from '../ui/workout-picker.js';`
A `setupPlanBuilder` hívás elé:

```js
// A „Meglévő edzés betöltése" választója — szinkron épül fel, adatot
// csak megnyitáskor kér
const workoutPicker = await safe(() => setupWorkoutPicker(confirmAction));
const planBuilder = await safe(() => setupPlanBuilder(picker, workoutPicker));
```

- [ ] **7. lépés: Automatikus ellenőrzés**

Futtasd: `npm test && npm run lint && npm run format:check`
Várt: minden zöld (az `icons.test.js` a sablonban lévő gombot is nézi — nincs
benne üres `<svg>`). Ha a Prettier panaszkodik: `npm run format`, és nézd át a diffet.

- [ ] **8. lépés: Böngészős ellenőrzés** (`npm run dev`, bejelentkezett felhasználóval)

1. Tervek → „+ Új terv": a nap típusa csak Edzés / Pihenő.
2. Hétfőre adj 2 gyakorlatot, nevezd „Láb nap"-nak. Péntek → Edzés → „Meglévő edzés betöltése": „A terv napjai" alatt ott a Láb nap; a „Korábbi edzések" alatt a napló, legújabb elöl.
3. Keresés „gugg"-ra szűr; értelmetlen szóra „Nincs találat a keresésre."
4. Láb nap → a péntek megkapja a 2 gyakorlatot és a „Láb nap" nevet, toast jön. Hétfőn módosíts egy súlyt → a péntek NEM változik.
5. Pénteken (nem üres) tölts be egy napló-edzést → megerősítő ablak; „Mégse" → semmi nem változik; „Csere" → csere, egyik szett sincs kipipálva.
6. Mentsd a tervet, nyisd újra szerkesztésre: minden nap a helyén.
7. Régi, „same"-es terv (pl. a migrációs teszt adatai, vagy egy DB-ben kézzel `{ "type": "same", "of": 0 }` nap) szerkesztése: a nap a hétfő másolataként jelenik meg; mentés után a `GET /api/plans` válaszában már nincs `same`.
8. ← gomb a választón visszavisz a terv-építőbe, a kijelölt nap nem változik.

- [ ] **9. lépés: Commit**

```bash
git add public/js/ui/workout-picker.js public/js/ui/plan-builder.js public/index.html \
  public/js/core/constants.js public/js/nav/router.js public/js/app/init.js public/style.css
git commit -m "Terv-építő: meglévő edzés betöltése a terv napjairól és a naplóból"
```

---

### 4. feladat: Dokumentáció

**Fájlok:**

- Módosít: `README.md` (~344–349. sor)
- Módosít: `docs/superpowers/specs/2026-10-06-meglevo-edzes-betoltese-design.md` (állapot)

- [ ] **1. lépés: README**

```markdown
- **Heti bontású tervek.** Egy terv egy hét, és hetente ismétlődik: minden nap
  saját edzés (opcionális névvel, pl. „Láb nap”) vagy pihenőnap
  (`server/plan-week.js`). Egy edzésnapba a „Meglévő edzés betöltése” a terv
  másik napjának vagy egy naplózott edzésnek a másolatát tölti. A régi tervek
  „ugyanaz, mint” napjait a szerver továbbra is elfogadja; a terv-építőben
  megnyitva ezek másolattá válnak. Egyszerre egy terv aktív; annak a
  mai napja automatikusan betöltődik az Edzés oldalra — de egy már megkezdett
  edzést soha nem ír felül. A terv-kártya heti sávjából bármelyik nap edzése
  elindítható.
```

- [ ] **2. lépés: Spec állapota** — „Állapot: jóváhagyásra vár (demó készül)" → „Állapot: kész".

- [ ] **3. lépés: Végső ellenőrzés és commit**

Futtasd: `npm test && npm run lint && npm run format:check` — mind zöld.

```bash
git add README.md docs/superpowers/specs/2026-10-06-meglevo-edzes-betoltese-design.md \
  docs/superpowers/demos/2026-10-06-meglevo-edzes-demo.html \
  docs/superpowers/plans/2026-10-06-meglevo-edzes-betoltese.md
git commit -m "Dokumentáció: meglévő edzés betöltése a terv-építőben"
```

---

## Önellenőrzés (a spec ellen)

- Edzés / Pihenő, „Ugyanaz, mint…" ki → 2. feladat.
- Gomb + kereshető oldal, két szakasz, minden napló-alkalom → 3. feladat.
- Másolat, csere, megerősítés, név átvétele, `done: false` → 1. + 3. feladat.
- Régi tervek: szerver érintetlen, szerkesztéskor másolattá → 1. (`inlineSameDays`) + 2. (`fill`).
- README → 4. feladat.
