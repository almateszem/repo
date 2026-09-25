# Regeneráció oldal — új dizájn: implementációs terv (a redesign 2. része)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Regeneráció oldal (`#recovery`) felső részének átültetése a Claude Design tervre (készenlét, „Ma kíméld", izomtérkép gyűrűkkel, „Miből jön a pontszám"), három töréspontra, valódi riport-adatokkal; a többi blokk a design nyelvén alatta.

**Architecture:** A tiszta logika (kímélendő lista, gyűrű-állapot, komponens-összegzés, a térkép koordinátái) új, DOM-mentes modulba kerül (`public/js/render/recovery-map.js`), egységtesztekkel. A felső rész EGY DOM-ból áll, az elrendezést CSS grid-területek és `@container` lekérdezések váltják (asztali / tablet / mobil). Az asztali izomtérkép egyetlen SVG (`viewBox="0 0 848 700"`), így arányosan skálázódik. A figurák a design vonalrajzai statikus SVG-ként (`public/img/`).

**Tech Stack:** Vanilla JS (ESM), CSS (tokenek a `public/style.css` `:root`-jában), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-24-regeneracio-redesign-design.md` (2. rész)

**Design-forrás:** `Fit Track Pro - Regeneráció (responsive) (1).html` a repo gyökerében (Claude Design bundler-export; NEM commitoljuk). A Task 2 szkriptje bontja ki belőle a két figurát.

## Global Constraints

- Színek/fontok: CSAK a meglévő tokenek (`public/style.css` `:root`). Egyetlen új token: `--c-pain: #e8a33d` (fájdalom borostyán). Nincs Inter, nincs tiszta `#000` háttér (a lap háttere marad a `--c-bg`), a zöld a `--c-ok`.
- Minden szám a valódi `GET /api/readiness` riportból jön (`overall`, `limiting`, `caps`, `confidence`, `confidenceNote`, `checkin.present`, `components[] {key,label,score,weight,present}`, `muscles[] {key,label,readiness,known,soreness,pain}`). A design számai mintaadatok.
- „Ma kíméld": a `known` csoportok, amelyek készenléte `< 40` (`RC_SPARE_BELOW`), növekvő sorrendben; üres lista → a blokk rejtve. Pötty: fehér = izomláz jelezve (`soreness > 0`), borostyán = fájdalom jelezve (`pain > 0`).
- Gyűrű: `readiness ≥ 80` → zöld (`--c-ok`), különben fehér (`--text-primary`); `known === false` → szaggatott kör, „—", alatta „Nincs adat".
- Asztali térkép: EGY SVG, `viewBox="0 0 848 700"`, `width: 100%; max-width: 848px`.
- Töréspontok (RULING — a spec „a design szerint" 1312/760 px-es viewport-határai oldalsáv nélküli lapra szólnak; az appban 240 px-es oldalsáv és lap-padding van, ezért a határok a `.rc-page` KONTÉNER-szélességére vonatkoznak): **asztali ≥ 1040px**, **tablet 600–1039px**, **mobil < 600px** (`@container rc (…)`).
- Gyűrű-kiosztás: elöl — Váll, Mell, Bicepsz, Has / core, Quad; hátul — Trapéz, Hát, Tricepsz, Alsó hát, Farizom, Hamstring, Vádli.
- A check-in űrlap (`createBodyMap()`) VÁLTOZATLAN marad — csak a „Részletes szerkesztés" blokk kerül lejjebb.
- Tesztfuttatás: `npm test` (jelenleg 440/440 zöld). A végén minden zöld; `npm run lint` hibátlan.
- Magyar kommentek a környező kód sűrűségével. Commit-üzenetek magyarul, a végükön: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. A gyökérben lévő design-HTML-t SOHA ne commitold.

---

### Task 1: `recovery-map.js` — a felső rész tiszta logikája

**Files:**
- Create: `public/js/render/recovery-map.js`
- Create: `public/js/render/recovery-map.test.js`

**Interfaces:**
- Produces (Task 3–4 használja):
  - `RC_SPARE_BELOW = 40`, `RC_READY_FROM = 80`
  - `ringState(muscle) → { tone: 'ok'|'rest'|'none', value: number|null, sore: boolean, pain: boolean }`
  - `spareList(muscles) → Array<{ key, label, readiness, sore, pain }>`
  - `ringDashOffset(value, r) → number`
  - `componentSummary(components) → { present: Array<{key,label,score,weight}>, missing: string[] }`
  - `muscleNote(muscles) → string|null`
  - `MAP_CANVAS = { width: 848, height: 700 }`
  - `MAP_FIGURES = { front: {x,y,width,height,labelY}, back: {…} }`
  - `MAP_RINGS = { front: Array<{key,x,y,line:[x1,y1,x2,y2]}>, back: […] }`
  - `MOBILE_COLUMNS = { front: {left: string[], right: string[]}, back: {…} }`

- [ ] **Step 1: A bukó teszt** — `public/js/render/recovery-map.test.js`:

```js
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

test('muscleNote: hány csoport átlaga és hány van adat nélkül', () => {
  const muscles = MUSCLE_KEYS.map((key, i) => m(key, 50, { known: i >= 2 }));
  assert.equal(muscleNote(muscles), '10 izomcsoport átlaga · 2 csoport adat nélkül');
  assert.equal(
    muscleNote(MUSCLE_KEYS.map((key) => m(key, 50))),
    '12 izomcsoport átlaga',
  );
  assert.equal(muscleNote(MUSCLE_KEYS.map((key) => m(key, 50, { known: false }))), null);
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
    assert.deepEqual(
      [...columns].sort(),
      MAP_RINGS[view].map((ring) => ring.key).sort(),
    );
  }
});
```

- [ ] **Step 2: Futtatás — bukik**

Run: `node --test public/js/render/recovery-map.test.js`
Expected: FAIL — `Cannot find module …/recovery-map.js`.

- [ ] **Step 3: Implementáció** — `public/js/render/recovery-map.js`:

```js
/**
 * A Regeneráció oldal felső részének tiszta logikája — DOM nélkül.
 *
 * A kirajzolás (render/recovery.js) csak fogyasztja: ami itt dől el, az
 * egységtesztből ellenőrizhető (recovery-map.test.js). A szám mindig a
 * szerver riportjából jön (server/recovery.js computeReadiness); itt csak
 * válogatás, sorrend és geometria van.
 */

/** 40% alatt a csoport a „Ma kíméld" listára kerül. Csak megjelenítési
    szűrő: a szerver nem használja, a riport formátuma nem függ tőle. (A
    szerver ajánlójának „regenerált" határa a READY_THRESHOLD = 80 a
    server/suggestions.js-ben — az a gyűrű zöld küszöbének párja.) */
export const RC_SPARE_BELOW = 40;

/** Ettől zöld a gyűrű („80%+ kész"). A szerver párja: READY_THRESHOLD. */
export const RC_READY_FROM = 80;

/** Egy izomcsoport gyűrűjének állapota. A `known: false` csoport 100-asa nem
    eredmény, hanem adathiány — ezért ott nincs szám, csak „—". */
export function ringState(muscle) {
  if (muscle.known === false) return { tone: 'none', value: null, sore: false, pain: false };
  return {
    tone: muscle.readiness >= RC_READY_FROM ? 'ok' : 'rest',
    value: muscle.readiness,
    sore: (muscle.soreness ?? 0) > 0,
    pain: (muscle.pain ?? 0) > 0,
  };
}

/** A „Ma kíméld" lista: az ismert, küszöb alatti csoportok, a legfáradtabb
    elöl. Azonos értéknél a riport (= a felület) sorrendje marad. */
export function spareList(muscles = []) {
  return (muscles ?? [])
    .filter((muscle) => muscle.known !== false && muscle.readiness < RC_SPARE_BELOW)
    .map((muscle, index) => ({ muscle, index }))
    .sort((a, b) => a.muscle.readiness - b.muscle.readiness || a.index - b.index)
    .map(({ muscle }) => {
      const state = ringState(muscle);
      return {
        key: muscle.key,
        label: muscle.label,
        readiness: muscle.readiness,
        sore: state.sore,
        pain: state.pain,
      };
    });
}

/** A gyűrű kitöltetlen ívének hossza (stroke-dashoffset) egy 0–100 értékhez. */
export function ringDashOffset(value, r) {
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(value, 0), 100);
  return circumference * (1 - clamped / 100);
}

/** A komponens-bontás két része: a jelen lévő sorok és a hiányzók címkéi
    („Nincs adat: közérzet, …"). */
export function componentSummary(components = []) {
  return {
    present: components
      .filter((component) => component.present)
      .map(({ key, label, score, weight }) => ({ key, label, score, weight })),
    missing: components.filter((component) => !component.present).map((c) => c.label),
  };
}

/** Az izom-komponens sora alatti magyarázat: hány csoportból jön az átlag, és
    hány csoportról nincs adat. Ha egyikről sincs, nincs mit mondani. */
export function muscleNote(muscles = []) {
  const known = muscles.filter((muscle) => muscle.known !== false).length;
  if (known === 0) return null;
  const unknown = muscles.length - known;
  const base = `${known} izomcsoport átlaga`;
  return unknown > 0 ? `${base} · ${unknown} csoport adat nélkül` : base;
}

/* ======================================================================
   A térkép geometriája — a design 848×700-as vásznának koordinátái.
   A gyűrű (x, y) a KÖZÉPPONT; a `line` az összekötő vonal a gyűrű
   szélétől a figurán lévő pontig ([x1, y1, x2, y2]).
   ====================================================================== */

export const MAP_CANVAS = { width: 848, height: 700 };

export const MAP_FIGURES = {
  front: { x: 222, y: 120, width: 220, height: 380, labelY: 520 },
  back: { x: 452, y: 120, width: 220, height: 380, labelY: 520 },
};

export const MAP_RINGS = {
  front: [
    { key: 'shoulders', x: 148, y: 153, line: [185, 166, 285, 202] },
    { key: 'chest', x: 76, y: 243, line: [115, 238, 317, 209] },
    { key: 'biceps', x: 64, y: 353, line: [99, 335, 278, 245] },
    { key: 'core', x: 98, y: 463, line: [128, 438, 331, 266] },
    { key: 'quads', x: 168, y: 578, line: [189, 545, 313, 351] },
  ],
  back: [
    { key: 'traps', x: 648, y: 42, line: [627, 75, 563, 180] },
    { key: 'back', x: 788, y: 128, line: [751, 141, 543, 215] },
    { key: 'triceps', x: 788, y: 258, line: [749, 255, 513, 234] },
    { key: 'lowerBack', x: 788, y: 398, line: [753, 380, 563, 281] },
    { key: 'glutes', x: 752, y: 516, line: [725, 488, 548, 307] },
    { key: 'hamstrings', x: 632, y: 600, line: [619, 563, 543, 350] },
    { key: 'calves', x: 510, y: 618, line: [516, 579, 541, 407] },
  ],
};

/** Mobilon egyszerre egy nézet látszik; a gyűrűk a figura két oldalán. */
export const MOBILE_COLUMNS = {
  front: { left: ['shoulders', 'chest', 'biceps'], right: ['core', 'quads'] },
  back: { left: ['traps', 'back', 'triceps', 'lowerBack'], right: ['glutes', 'hamstrings', 'calves'] },
};
```

- [ ] **Step 4: Futtatás — zöld**

Run: `node --test public/js/render/recovery-map.test.js` → Expected: 10 pass
Run: `npm test` → Expected: `# fail 0` (450 pass)
Run: `npx prettier --check public/js/render/recovery-map.js public/js/render/recovery-map.test.js` és `npx eslint public/js/render/` → hibátlan (a prettier formázhat; akkor `--write`).

- [ ] **Step 5: Commit**

```bash
git add public/js/render/recovery-map.js public/js/render/recovery-map.test.js
git commit -m "Regeneráció: a felső rész tiszta logikája (Ma kíméld, gyűrűk, térkép-geometria)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A két figura statikus SVG-ként

**Files:**
- Create: `public/img/body-front.svg`, `public/img/body-back.svg` (szkripttel kibontva)
- Create: `public/js/render/figures.test.js`

- [ ] **Step 1: A bukó teszt** — `public/js/render/figures.test.js`:

```js
/** A Regeneráció térképének két figurája a design vonalrajza (public/img).
    A teszt azt őrzi, hogy a fájl ott van, érvényes SVG viewBox-szal, és a
    design-exportból örökölt c2pa-metaadat NEM került a kiszolgált fájlba. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`../../img/${name}`, import.meta.url), 'utf8');

for (const [name, viewBox] of [
  ['body-front.svg', '0 0 975 1625'],
  ['body-back.svg', '0 0 989 1625'],
]) {
  test(`${name}: SVG, viewBox ${viewBox}, metaadat nélkül`, () => {
    const svg = read(name);
    assert.match(svg, /^<svg[\s>]/);
    assert.ok(svg.includes(`viewBox="${viewBox}"`));
    assert.ok(!/c2pa|<metadata/i.test(svg), 'c2pa-metaadat maradt benne');
    assert.ok(svg.length < 20000, 'a vonalrajz kicsi marad');
  });
}
```

Run: `node --test public/js/render/figures.test.js` → Expected: FAIL (ENOENT).

- [ ] **Step 2: Kibontás** — a scratchpadba (NEM a repóba) `extract-figures.mjs`:

```js
// Egyszeri: a design-export két test-SVG-jének kibontása public/img alá.
// Futtatás a repo gyökeréből: node <ez a fájl>
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const source = readdirSync('.').find((name) => name.startsWith('Fit Track Pro - Regener'));
if (!source) throw new Error('Nincs meg a design-export a repo gyökerében');
const html = readFileSync(source, 'utf8');
const manifest = JSON.parse(
  html.match(/<script[^>]*__bundler\/manifest[^>]*>([\s\S]*?)<\/script>/)[1],
);

const FIGURES = {
  'body-front.svg': '82b7597b-d46c-4aee-a999-d938d33af4e4',
  'body-back.svg': 'e2b7068c-2e0b-47ce-8fee-d2076bc86457',
};

mkdirSync('public/img', { recursive: true });
for (const [name, id] of Object.entries(FIGURES)) {
  const entry = manifest[id];
  let buffer = Buffer.from(entry.data, 'base64');
  if (entry.compressed) buffer = gunzipSync(buffer);
  const svg = buffer
    .toString('utf8')
    .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
    .replace(/\s+xmlns:c2pa="[^"]*"/, '')
    .trim();
  writeFileSync(`public/img/${name}`, svg + '\n');
  console.log(name, svg.length);
}
```

Run: `node <scratchpad>/extract-figures.mjs`
Expected: két sor, mindkét méret ~5000–16000 byte.

- [ ] **Step 3: Futtatás — zöld**

Run: `node --test public/js/render/figures.test.js` → 2 pass. `npm test` → `# fail 0`.
Ellenőrizd, hogy a `.prettierignore`/`eslint` nem akad el az SVG-n (`npm run lint`).

- [ ] **Step 4: Commit**

```bash
git add public/img/body-front.svg public/img/body-back.svg public/js/render/figures.test.js
git commit -m "Regeneráció: a design két figurája statikus SVG-ként (metaadat nélkül)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A felső rész — készenlét, CTA, Ma kíméld, Miből jön a pontszám

**Files:**
- Modify: `public/index.html` (a `#recovery` szekció eleje: `rc-score` … a CTA vége, ~1340–1390. sor; a „Miből jön a pontszám" kártya ~1592–1602. sor ÁTKERÜL ide)
- Modify: `public/style.css` (új `--c-pain` token a `:root`-ban; új `rc-top` szabályok a 22. szakasz elején; a lapszélesség)
- Modify: `public/js/render/recovery.js` (`renderRecovery` felső része)

**Interfaces:**
- Consumes: Task 1 — `spareList`, `componentSummary`, `muscleNote`, `RC_SPARE_BELOW`, `RC_READY_FROM`.
- Produces (Task 4): a `.rc-top` grid és benne üres `<div class="rc-map" data-rc-map>` és `<div class="rc-maphead">` hely; a `.rc-legend` elemek.

- [ ] **Step 1: Token** — `public/style.css` `:root`, a `--c-ok` sor alá:

```css
  /* Fájdalom-jelzés (Regeneráció térkép, „Ma kíméld"): borostyán, hogy a
     piros márkaszíntől és a hiba-színtől is elváljon. */
  --c-pain: #e8a33d;
```

- [ ] **Step 2: Markup** — a `#recovery` szekcióban a `<header class="rc-header">` UTÁN, a `<details class="rc-checkin-advanced …">` ELŐTT álló részt (a `rc-score` szekció, a `rc-confidence` bekezdés, a `rc-caps` lista és a `rc-checkin-cta` link) cseréld erre; a régi „Miből jön a pontszám" `<section class="rc-card ds-section" aria-labelledby="title-rc-components">` blokkot pedig TÖRÖLD a helyéről (tartalma itt, a `.rc-comps`-ban él tovább):

```html
          <!-- Felső rész (Claude Design terv). EGY DOM, három elrendezés: a
             `.rc-top` grid-területeit a konténer szélessége váltja (asztali /
             tablet / mobil — lásd a 22. CSS-szakasz @container szabályait).
             Minden szám a GET /api/readiness riportból jön. -->
          <div class="rc-top">
            <section class="rc-hero" aria-labelledby="title-rc-score">
              <h3 class="ds-eyebrow rc-eyebrow" id="title-rc-score">Mai készenlét</h3>
              <p class="rc-hero-score">
                <span class="rc-score-num" data-rc-score>—</span
                ><span class="rc-score-max">/100</span>
              </p>
              <p class="rc-verdict" data-rc-verdict></p>
              <!-- Mi húz vissza + a sapkák + a megbízhatóság: a szám mellé az
                 indoklás (a riport `limiting`, `caps`, `confidence` mezői). -->
              <p class="rc-limiter" data-rc-limiter hidden></p>
              <ul class="rc-caps" data-list="rc-caps" hidden></ul>
              <p class="rc-confidence" data-rc-confidence>
                <span class="rc-confidence-badge" data-rc-confidence-badge></span>
                <span data-rc-confidence-text></span>
              </p>
            </section>

            <a class="rc-cta" href="#checkin" data-rc-checkin-cta>
              <span class="rc-cta-text">
                <span class="rc-cta-title" data-rc-checkin-cta-title>Napi check-in kitöltése</span>
                <span class="rc-cta-note">Pár gyors kérdés ebből számol a mai készenléted.</span>
              </span>
              <span class="rc-cta-arrow" aria-hidden="true">→</span>
            </a>

            <section class="rc-spare" aria-labelledby="title-rc-spare" data-rc-spare hidden>
              <h3 class="ds-eyebrow rc-eyebrow" id="title-rc-spare">Ma kíméld</h3>
              <ul class="rc-spare-list" data-list="rc-spare"></ul>
              <p class="rc-spare-note" data-rc-spare-note></p>
            </section>

            <!-- Jelmagyarázat asztalin a bal hasábban; tableten és mobilon a
               térkép fejlécében áll a párja (.rc-legend--map). -->
            <div class="rc-legend rc-legend--side">
              <ul class="rc-legend-list">
                <li><span class="rc-dot rc-dot--sore"></span>Izomláz</li>
                <li><span class="rc-dot rc-dot--pain"></span>Fájdalom</li>
                <li><span class="rc-dot rc-dot--ready"></span>80%+ kész</li>
              </ul>
              <p class="rc-legend-note">
                100% = teljesen regenerált. A terhelés, az izomláz és a fájdalom együtt adja a
                számot.
              </p>
            </div>

            <div class="rc-maphead">
              <h3 class="ds-eyebrow rc-eyebrow" id="title-rc-map">Izomtérkép</h3>
              <div class="rc-map-tabs" role="tablist" aria-label="Nézet">
                <button class="rc-map-tab" type="button" role="tab" data-rc-view="front"
                  aria-selected="true">Elöl</button>
                <button class="rc-map-tab" type="button" role="tab" data-rc-view="back"
                  aria-selected="false">Hátul</button>
              </div>
              <ul class="rc-legend rc-legend--map rc-legend-list">
                <li><span class="rc-dot rc-dot--sore"></span>Izomláz</li>
                <li><span class="rc-dot rc-dot--pain"></span>Fájdalom</li>
                <li><span class="rc-dot rc-dot--ready"></span>80%+ kész</li>
              </ul>
            </div>

            <!-- A térképet a Task 4 tölti ki (renderMuscleMap). -->
            <div class="rc-map" data-rc-map aria-labelledby="title-rc-map"></div>

            <section class="rc-comps" aria-labelledby="title-rc-components">
              <button class="rc-comps-toggle" type="button" aria-expanded="false"
                aria-controls="rc-comps-body" data-rc-comps-toggle>
                <span class="rc-comps-title" id="title-rc-components">Miből jön a pontszám</span>
                <span class="rc-comps-summary" data-rc-comps-summary></span>
                <span class="rc-comps-chev" aria-hidden="true"></span>
              </button>
              <div class="rc-comps-body" id="rc-comps-body">
                <ul class="rc-comps-list" data-list="rc-components"></ul>
                <div class="rc-comps-missing" data-rc-comps-missing hidden>
                  <span class="rc-comps-missing-text" data-rc-comps-missing-text></span>
                  <a class="rc-comps-fill" href="#checkin">Kitöltöm <span aria-hidden="true">→</span></a>
                </div>
                <p class="rc-hint rc-comps-hrv">
                  A HRV/pulzus komponens nincs a képletben: az alkalmazásnak nincs
                  pulzusadat-forrása, kitalált értéket pedig nem teszünk bele. A súlya arányosan
                  szétoszlik a többi komponens között — ahogy minden ki nem töltött mezőé is.
                </p>
              </div>
            </section>
          </div>
```

A `tpl-rc-component` sablont (a lap alján, `grep -n "tpl-rc-component" public/index.html`) cseréld erre:

```html
    <template id="tpl-rc-component">
      <li class="rc-comp">
        <div class="rc-comp-head">
          <span class="rc-comp-label"></span>
          <span class="rc-comp-value"></span>
        </div>
        <div class="rc-comp-bar"><span class="rc-comp-fill"></span></div>
        <div class="rc-comp-meta">
          <span class="rc-comp-weight"></span>
          <span class="rc-comp-note" hidden></span>
        </div>
      </li>
    </template>
```

A `.rc-legend--map` a `.rc-maphead`-en belül `<ul>` — szándékosan egyszerűbb, mint az oldalsó (ott nincs magyarázó bekezdés).

- [ ] **Step 3: CSS** — a 22. szakasz (`grep -n "22. Regeneráció — Recovery Engine oldal" public/style.css`, a fejléc-komment után, a `.rc-header` szabály ELÉ):

```css
/* ---- A lap szélessége: a felső rész kétsávos asztalon, ezért szélesebb,
   mint a többi lap (a .dashboard mintájára). A konténer-lekérdezések a
   `.rc-page` belső szélességéhez igazodnak, nem a viewporthoz: az oldalsáv
   és a padding miatt ugyanaz a viewport más-más tartalomszélességet ad. ---- */
.rc-page {
  container: rc / inline-size;
}

@media (min-width: 760px) {
  .app-page.rc-page {
    max-width: 1312px;
  }
}

/* ---- Felső rész: grid-területek, mobil az alap ---- */
.rc-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    'hero'
    'spare'
    'cta'
    'maphead'
    'map'
    'comps';
  row-gap: var(--sp-5);
  margin-bottom: var(--sp-15);
}

.rc-hero {
  grid-area: hero;
}
.rc-cta {
  grid-area: cta;
}
.rc-spare {
  grid-area: spare;
}
.rc-legend--side {
  grid-area: legend;
  display: none;
}
.rc-maphead {
  grid-area: maphead;
  margin-top: var(--sp-13);
}
.rc-map {
  grid-area: map;
}
.rc-comps {
  grid-area: comps;
  margin-top: var(--sp-13);
}

.rc-eyebrow {
  font-size: var(--fs-xs);
  letter-spacing: 0.14em;
  color: var(--fg-55);
}

.rc-hero-score {
  margin: var(--sp-5) 0 0;
  display: flex;
  align-items: baseline;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.rc-score-num {
  font-size: 64px;
  line-height: 0.9;
  letter-spacing: -0.034em;
}
.rc-score-max {
  font-size: 30px;
  letter-spacing: -0.027em;
  color: var(--fg-45);
}
.rc-verdict {
  margin: var(--sp-4) 0 0;
  max-width: 340px;
  font-size: var(--fs-base);
  line-height: 1.5;
  color: var(--fg-60);
}
.rc-limiter,
.rc-confidence {
  margin: var(--sp-3) 0 0;
  font-size: var(--fs-md);
  line-height: 1.5;
  color: var(--fg-55);
}
.rc-caps {
  margin: var(--sp-3) 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--fs-md);
  color: var(--c-pain);
}

.rc-cta {
  display: flex;
  align-items: center;
  gap: var(--sp-6);
  min-height: 44px;
  padding: var(--sp-7);
  background: var(--surface-panel);
  box-shadow: inset 0 0 0 1px var(--hair);
  color: var(--text-primary);
  text-decoration: none;
  transition: box-shadow var(--t-fast);
}
.rc-cta:hover {
  box-shadow: inset 0 0 0 1px var(--fg-40);
}
.rc-cta-text {
  flex: 1 1 auto;
  min-width: 0;
}
.rc-cta-title {
  display: block;
  font-size: var(--fs-lg);
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.rc-cta-note {
  display: block;
  margin-top: var(--sp-1);
  font-size: var(--fs-md);
  line-height: 1.45;
  color: var(--fg-70);
}
.rc-cta-arrow {
  font-size: var(--fs-3xl);
  font-weight: 800;
}

.rc-spare {
  padding: var(--sp-7);
  background: var(--surface-panel);
  box-shadow: inset 0 0 0 1px var(--fg-15);
}
.rc-spare-list {
  margin: var(--sp-6) 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}
.rc-spare-row {
  display: grid;
  grid-template-columns: 1fr auto;
  row-gap: var(--sp-2);
  align-items: baseline;
}
.rc-spare-name {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-lg);
  font-weight: 700;
}
.rc-spare-value {
  font-size: var(--fs-xl);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.rc-spare-bar {
  grid-column: 1 / -1;
  height: 3px;
  background: var(--fg-10);
}
.rc-spare-fill {
  display: block;
  height: 3px;
  background: var(--text-primary);
}
.rc-spare-note {
  margin: var(--sp-6) 0 0;
  font-size: var(--fs-xs);
  line-height: 1.55;
  color: var(--fg-55);
}

.rc-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
  flex: 0 0 auto;
}
.rc-dot--sore {
  background: var(--text-primary);
}
.rc-dot--pain {
  background: var(--c-pain);
}
.rc-dot--ready {
  background: var(--c-ok);
}

.rc-legend-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3) var(--sp-8);
}
.rc-legend-list li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fg-60);
}
.rc-legend-note {
  margin: var(--sp-5) 0 0;
  font-size: var(--fs-xs);
  line-height: 1.6;
  color: var(--fg-50);
}

.rc-maphead {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
}
.rc-legend--map {
  flex-basis: 100%;
}
.rc-map-tabs {
  display: flex;
  box-shadow: inset 0 0 0 1px var(--fg-25);
}
.rc-map-tab {
  min-width: 64px;
  height: 36px;
  border: 0;
  background: transparent;
  color: var(--fg-60);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  cursor: pointer;
}
.rc-map-tab[aria-selected='true'] {
  background: var(--text-primary);
  color: var(--c-bg);
}

/* ---- Miből jön a pontszám ---- */
.rc-comps {
  box-shadow: inset 0 0 0 1px var(--hair);
}
.rc-comps-toggle {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  width: 100%;
  min-height: 56px;
  padding: 0 var(--sp-7);
  border: 0;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.rc-comps-title {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.rc-comps-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-md);
  color: var(--fg-60);
}
.rc-comps-chev::before {
  content: '+';
  font-size: var(--fs-4xl);
  font-weight: 800;
  line-height: 1;
}
.rc-comps-toggle[aria-expanded='true'] .rc-comps-chev::before {
  content: '−';
}
.rc-comps-toggle[aria-expanded='true'] .rc-comps-summary {
  visibility: hidden;
}
.rc-comps-body {
  padding: 0 var(--sp-7) var(--sp-9);
}
.rc-comps-toggle[aria-expanded='false'] + .rc-comps-body {
  display: none;
}
.rc-comps-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rc-comp {
  padding: var(--sp-7) 0;
  border-top: 1px solid var(--hair-soft);
}
.rc-comp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-5);
}
.rc-comp-label {
  font-size: var(--fs-xl);
  font-weight: 700;
}
.rc-comp-value {
  font-size: var(--fs-3xl);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.rc-comp-bar {
  margin-top: var(--sp-4);
  height: 5px;
  background: var(--fg-10);
  overflow: hidden;
}
.rc-comp-fill {
  display: block;
  height: 100%;
  width: calc(var(--value, 0) * 1%);
  background: var(--fg-60);
}
.rc-comp[data-tone='ok'] .rc-comp-fill {
  background: var(--c-ok);
}
.rc-comp-meta {
  margin-top: var(--sp-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3) var(--sp-8);
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--fg-50);
}
.rc-comp-note {
  color: var(--fg-60);
}
.rc-comps-missing {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-7);
  padding-top: var(--sp-7);
  border-top: 1px solid var(--hair-soft);
}
.rc-comps-missing-text {
  font-size: var(--fs-base);
  line-height: 1.5;
  color: var(--fg-60);
}
.rc-comps-fill {
  flex: 0 0 auto;
  padding: var(--sp-5) var(--sp-7);
  box-shadow: inset 0 0 0 1px var(--fg-25);
  color: var(--text-primary);
  font-size: var(--fs-md);
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  text-decoration: none;
}
.rc-comps-fill:hover {
  box-shadow: inset 0 0 0 1px var(--fg-60);
}
.rc-comps-hrv {
  margin-top: var(--sp-9);
}

/* ---- Tablet: 600–1039px konténer ---- */
@container rc (min-width: 600px) {
  .rc-top {
    grid-template-columns: minmax(0, 1fr) 340px;
    grid-template-areas:
      'hero spare'
      'cta spare'
      'maphead maphead'
      'map map'
      'comps comps';
    column-gap: var(--sp-12);
    align-items: start;
  }
  .rc-score-num {
    font-size: 76px;
  }
  .rc-score-max {
    font-size: 36px;
  }
  .rc-maphead {
    margin-top: var(--sp-14);
  }
  .rc-map-tabs {
    display: none;
  }
  .rc-legend--map {
    flex-basis: auto;
  }
  /* Tableten és asztalon a bontás mindig nyitva: nincs mit összecsukni. */
  .rc-comps-toggle {
    pointer-events: none;
    min-height: 0;
    padding: var(--sp-12) var(--sp-12) 0;
  }
  .rc-comps-chev,
  .rc-comps-summary {
    display: none;
  }
  .rc-comps-toggle[aria-expanded='false'] + .rc-comps-body {
    display: block;
  }
  .rc-comps-body {
    padding: var(--sp-9) var(--sp-12) var(--sp-11);
  }
  .rc-comps-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--sp-13);
  }
}

/* ---- Asztali: ≥ 1040px konténer ---- */
@container rc (min-width: 1040px) {
  .rc-top {
    grid-template-columns: 360px minmax(0, 1fr);
    grid-template-rows: auto auto auto 1fr auto;
    grid-template-areas:
      'hero map'
      'cta map'
      'spare map'
      'legend map'
      'comps comps';
    column-gap: var(--sp-11);
  }
  .rc-hero {
    padding-top: var(--sp-12);
  }
  .rc-score-num {
    font-size: 82px;
  }
  .rc-score-max {
    font-size: 39px;
  }
  .rc-cta {
    margin-top: var(--sp-12);
    padding: 21px 25px 23px;
  }
  .rc-cta-title {
    font-size: 17px;
  }
  /* Asztalon a „Ma kíméld" nem doboz, hanem a bal hasáb vonallal tagolt
     szakasza, ahogy a design mutatja. */
  .rc-spare {
    margin-top: var(--sp-14);
    padding: var(--sp-10) 0 0;
    background: none;
    box-shadow: none;
    border-top: 1px solid var(--fg-15);
  }
  .rc-legend--side {
    display: block;
    align-self: start;
    margin-top: var(--sp-11);
    padding-top: var(--sp-8);
    border-top: 1px solid var(--fg-10);
  }
  .rc-maphead {
    display: none;
  }
  .rc-comps {
    margin-top: var(--sp-16);
  }
  .rc-comps-toggle {
    padding: var(--sp-14) var(--sp-14) 0;
  }
  .rc-comps-title {
    font-size: var(--fs-xl);
  }
  .rc-comps-body {
    padding: var(--sp-14) var(--sp-14) var(--sp-13);
  }
  .rc-comps-list {
    display: block;
  }
  .rc-comp {
    padding: 26px 0;
  }
  .rc-comp:first-child {
    border-top: 0;
    padding-top: 0;
  }
  .rc-comp-bar {
    height: 6px;
    margin-top: var(--sp-6);
  }
}
```

A régi `.rc-score`, `.rc-ring`, `.rc-score-text`, `.rc-checkin-cta*`, `.rc-components`, `.rc-component*` szabályokat (`grep -nE "\.rc-(score|ring|checkin-cta|component)" public/style.css`) TÖRÖLD — a markupjuk megszűnt. A `.rc-confidence-badge`, `.rc-cap`, `.rc-limiter` meglévő szabályait nézd át: ha ütköznek a fentiekkel, a fentiek nyernek (töröld a régit).

- [ ] **Step 4: Render** — `public/js/render/recovery.js`:

Import a fájl elejére:

```js
import { RC_SPARE_BELOW, componentSummary, muscleNote, spareList } from './recovery-map.js';
```

A `renderRecovery` elején az „Összesített pontszám + gyűrű" blokk (a `ring` változóval) helyett:

```js
  // — Összesített pontszám —
  const overall = report.overall;
  const known = hasReadiness(overall);
  $('[data-rc-score]').textContent = known ? String(overall) : '—';
```

(a `$('.rc-score-num').textContent = …` sort töröld; a verdict-, limiter-, megbízhatóság- és sapka-kód VÁLTOZATLAN marad.)

A „Komponens-bontás" blokk helyére:

```js
  // — Miből jön a pontszám —
  const { present, missing } = componentSummary(report.components);
  const components = $('[data-list="rc-components"]');
  components.replaceChildren();
  present.forEach((component, index) => {
    const row = cloneTemplate('tpl-rc-component');
    row.style.setProperty('--i', index);
    row.style.setProperty('--value', component.score);
    row.dataset.tone = component.score >= 80 ? 'ok' : 'rest';
    $('.rc-comp-label', row).textContent = component.label;
    $('.rc-comp-value', row).textContent = String(component.score);
    $('.rc-comp-weight', row).textContent = `Súly ${component.weight}%`;
    const note = component.key === 'muscle' ? muscleNote(report.muscles) : null;
    const noteEl = $('.rc-comp-note', row);
    noteEl.hidden = !note;
    noteEl.textContent = note ?? '';
    components.appendChild(row);
  });
  const missingEl = $('[data-rc-comps-missing]');
  missingEl.hidden = missing.length === 0;
  $('[data-rc-comps-missing-text]').textContent = missing.length
    ? `Nincs adat: ${missing.map((label) => label.toLowerCase()).join(', ')}`
    : '';
  // Mobilon összecsukva ez az egy sor látszik a bontásból.
  $('[data-rc-comps-summary]').textContent = present
    .map((component) => `${component.label} ${component.score}`)
    .join(' · ');

  // — Ma kíméld —
  const spare = spareList(report.muscles);
  const spareEl = $('[data-list="rc-spare"]');
  spareEl.replaceChildren();
  spare.forEach((row) => {
    const item = document.createElement('li');
    item.className = 'rc-spare-row';
    const name = document.createElement('span');
    name.className = 'rc-spare-name';
    name.textContent = row.label;
    if (row.sore) name.append(dot('sore', 'izomláz'));
    if (row.pain) name.append(dot('pain', 'fájdalom'));
    const value = document.createElement('span');
    value.className = 'rc-spare-value';
    value.textContent = `${row.readiness}%`;
    const bar = document.createElement('span');
    bar.className = 'rc-spare-bar';
    const fill = document.createElement('span');
    fill.className = 'rc-spare-fill';
    fill.style.width = `${row.readiness}%`;
    bar.append(fill);
    item.append(name, value, bar);
    spareEl.appendChild(item);
  });
  $('[data-rc-spare]').hidden = spare.length === 0;
  $('[data-rc-spare-note]').textContent =
    `${RC_SPARE_BELOW}% alatt ezeket ma ne terheld intenzíven.`;
```

és egy segéd a `renderRecovery` fölé:

```js
/** Egy jelző-pötty (izomláz / fájdalom) a „Ma kíméld" sorhoz és a
    gyűrűk alá. A felolvasó a címkét kapja, nem a színt. */
function dot(kind, label) {
  const el = document.createElement('span');
  el.className = `rc-dot rc-dot--${kind}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  return el;
}
```

A `fillBar` segéd a lift/muscle kódban továbbra is használatban van — maradjon. A `dot` modul-belső segéd (a Task 4 ugyanebben a fájlban használja), nem kell exportálni.

A CTA címét a `public/js/ui/recovery.js` `fillForm` már állítja (`[data-rc-checkin-cta-title]`) — változatlan.

- [ ] **Step 5: Összecsukás** — `public/js/ui/recovery.js`, a `setupRecovery`-ben a `if (!page) return;` után:

```js
  /* „Miből jön a pontszám": mobilon összecsukható, csukva egysoros
     összefoglaló. Tableten és asztalon a CSS mindig nyitva mutatja — ott a
     gomb nem kattintható (pointer-events: none), az aria-expanded csak a
     mobil állapotot hordozza. */
  const compsToggle = $('[data-rc-comps-toggle]', page);
  compsToggle.addEventListener('click', () => {
    const open = compsToggle.getAttribute('aria-expanded') === 'true';
    compsToggle.setAttribute('aria-expanded', String(!open));
  });
```

- [ ] **Step 6: Ellenőrzés**

Run: `npm test` → `# fail 0`; `npm run lint` → hibátlan; `npx prettier --check public/index.html public/style.css public/js/render/recovery.js public/js/ui/recovery.js` (formázatlan → `--write`, csak ezeken).
Run: `npm run dev`, bejelentkezve nyisd meg a `#recovery` lapot. A böngésző konzoljában nincs hiba; a pontszám, a verdikt, a CTA, a „Ma kíméld" (ha van 40% alatti csoport) és a bontás megjelenik. (Az alapos, három töréspontos vizuális ellenőrzés a Task 5 része.)

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/style.css public/js/render/recovery.js public/js/ui/recovery.js
git commit -m "Regeneráció: új felső rész — készenlét, Ma kíméld, pontszám-bontás a design szerint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Az izomtérkép — asztali SVG, tablet- és mobil-oszlopok

**Files:**
- Modify: `public/js/render/recovery.js` (új `renderMuscleMap`, hívás a `renderRecovery`-ből)
- Modify: `public/js/ui/recovery.js` (Elöl/Hátul fülek)
- Modify: `public/style.css` (`rc-map*`, `rc-ring*` szabályok a Task 3 blokkja után)

**Interfaces:**
- Consumes: Task 1 — `MAP_CANVAS`, `MAP_FIGURES`, `MAP_RINGS`, `MOBILE_COLUMNS`, `ringState`, `ringDashOffset`; Task 3 — `dot(kind, label)`, a `[data-rc-map]` konténer, a `[data-rc-view]` fülek.

A térkép HÁROM változatban épül fel ugyanabba a `[data-rc-map]` konténerbe; a CSS a konténer-szélesség szerint pontosan egyet mutat:
- `.rc-map-wide` — asztali: egy `<svg viewBox="0 0 848 700">`, benne a két figura (`<image href="img/body-front.svg">`), az összekötő vonalak és a 12 gyűrű a `MAP_RINGS` koordinátáin.
- `.rc-map-split` — tablet: 4 oszlopos grid (`96px 1fr 1fr 96px`): bal oszlop az elülső 5 gyűrű, középen a két figura, jobb oszlop a hátsó 7.
- `.rc-map-tabbed` — mobil: a `data-view` szerinti nézet; 3 oszlop (`76px 1fr 76px`) a `MOBILE_COLUMNS` szerint.

- [ ] **Step 1: Render** — `public/js/render/recovery.js`, import-bővítés:

```js
import {
  MAP_CANVAS,
  MAP_FIGURES,
  MAP_RINGS,
  MOBILE_COLUMNS,
  RC_SPARE_BELOW,
  componentSummary,
  muscleNote,
  ringDashOffset,
  ringState,
  spareList,
} from './recovery-map.js';
```

Segédek a `dot` után:

```js
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** Egy gyűrű SVG-csoportként az asztali vászonra: háttérkör, érték-ív,
    szám, címke, pöttyök. (cx, cy) a középpont a 848×700-as vásznon. */
function wideRing(muscle, { x, y }) {
  const state = ringState(muscle);
  const r = 34;
  const g = svgEl('g', { class: `rc-ring rc-ring--${state.tone}` });
  if (state.tone === 'none') {
    g.append(svgEl('circle', { class: 'rc-ring-empty', cx: x, cy: y, r }));
    const dash = svgEl('text', { class: 'rc-ring-num rc-ring-num--none', x, y: y + 8 });
    dash.textContent = '—';
    g.append(dash);
  } else {
    const circumference = 2 * Math.PI * r;
    g.append(svgEl('circle', { class: 'rc-ring-bg', cx: x, cy: y, r }));
    g.append(
      svgEl('circle', {
        class: 'rc-ring-fg',
        cx: x,
        cy: y,
        r,
        'stroke-dasharray': circumference.toFixed(2),
        'stroke-dashoffset': ringDashOffset(state.value, r).toFixed(2),
        transform: `rotate(-90 ${x} ${y})`,
      }),
    );
    const num = svgEl('text', { class: 'rc-ring-num', x, y: y + 8 });
    num.textContent = String(state.value);
    const pct = svgEl('tspan', { class: 'rc-ring-pct', dx: 2 });
    pct.textContent = '%';
    num.append(pct);
    g.append(num);
  }
  const label = svgEl('text', { class: 'rc-ring-label', x, y: y + r + 20 });
  label.textContent = muscle.label;
  g.append(label);
  if (state.tone === 'none') {
    const none = svgEl('text', { class: 'rc-ring-label rc-ring-label--none', x, y: y + r + 34 });
    none.textContent = 'Nincs adat';
    g.append(none);
  }
  const dots = [state.sore && 'sore', state.pain && 'pain'].filter(Boolean);
  dots.forEach((kind, i) => {
    const offset = (i - (dots.length - 1) / 2) * 13;
    g.append(
      svgEl('circle', { class: `rc-ring-dot rc-ring-dot--${kind}`, cx: x + offset, cy: y + r + 34, r: 4 }),
    );
  });
  g.setAttribute('aria-label', ringAria(muscle, state));
  g.setAttribute('role', 'img');
  return g;
}

/** A felolvasó szövege: név, érték vagy „nincs adat", jelzések. */
function ringAria(muscle, state) {
  const parts = [muscle.label, state.tone === 'none' ? 'nincs adat' : `${state.value}%`];
  if (state.sore) parts.push('izomláz');
  if (state.pain) parts.push('fájdalom');
  return parts.join(', ');
}

/** Egy gyűrű HTML-elemként (tablet / mobil oszlop). A `size` a pixelméret. */
function compactRing(muscle, size) {
  const state = ringState(muscle);
  const r = size / 2 - 3;
  const c = size / 2;
  const item = document.createElement('div');
  item.className = `rc-cring rc-ring--${state.tone}`;
  item.setAttribute('role', 'img');
  item.setAttribute('aria-label', ringAria(muscle, state));

  const box = document.createElement('div');
  box.className = 'rc-cring-box';
  box.style.width = box.style.height = `${size}px`;
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' });
  if (state.tone === 'none') {
    svg.append(svgEl('circle', { class: 'rc-ring-empty', cx: c, cy: c, r }));
  } else {
    svg.append(svgEl('circle', { class: 'rc-ring-bg', cx: c, cy: c, r }));
    svg.append(
      svgEl('circle', {
        class: 'rc-ring-fg',
        cx: c,
        cy: c,
        r,
        'stroke-dasharray': (2 * Math.PI * r).toFixed(2),
        'stroke-dashoffset': ringDashOffset(state.value, r).toFixed(2),
        transform: `rotate(-90 ${c} ${c})`,
      }),
    );
  }
  const num = document.createElement('span');
  num.className = 'rc-cring-num';
  num.textContent = state.tone === 'none' ? '—' : String(state.value);
  if (state.tone !== 'none') {
    const pct = document.createElement('span');
    pct.className = 'rc-cring-pct';
    pct.textContent = '%';
    num.append(pct);
  }
  box.append(svg, num);

  const label = document.createElement('span');
  label.className = 'rc-cring-label';
  label.textContent = muscle.label;
  const dots = document.createElement('span');
  dots.className = 'rc-cring-dots';
  if (state.sore) dots.append(dot('sore', 'izomláz'));
  if (state.pain) dots.append(dot('pain', 'fájdalom'));
  item.append(box, label, dots);
  return item;
}

function figureImg(view) {
  const img = document.createElement('img');
  img.className = 'rc-figure';
  img.src = `img/body-${view}.svg`;
  img.alt = view === 'front' ? 'Elülső izomcsoportok' : 'Hátsó izomcsoportok';
  return img;
}

function ringColumn(keys, byKey, size) {
  const col = document.createElement('div');
  col.className = 'rc-map-col';
  keys.forEach((key) => col.append(compactRing(byKey.get(key), size)));
  return col;
}

/** Az izomtérkép mindhárom változata (asztali / tablet / mobil). */
function renderMuscleMap(muscles, view = 'front') {
  const host = $('[data-rc-map]');
  if (!host) return;
  const byKey = new Map(muscles.map((muscle) => [muscle.key, muscle]));

  // — Asztali: egy skálázódó SVG —
  const wide = svgEl('svg', {
    class: 'rc-map-wide',
    viewBox: `0 0 ${MAP_CANVAS.width} ${MAP_CANVAS.height}`,
    role: 'group',
    'aria-label': 'Izomcsoportok regenerációja — elöl és hátul',
  });
  for (const side of ['front', 'back']) {
    const f = MAP_FIGURES[side];
    wide.append(
      svgEl('image', { href: `img/body-${side}.svg`, x: f.x, y: f.y, width: f.width, height: f.height }),
    );
    const caption = svgEl('text', { class: 'rc-map-caption', x: f.x + f.width / 2, y: f.labelY });
    caption.textContent = side === 'front' ? 'Elöl' : 'Hátul';
    wide.append(caption);
  }
  const lines = svgEl('g', { class: 'rc-map-lines', 'aria-hidden': 'true' });
  for (const ring of [...MAP_RINGS.front, ...MAP_RINGS.back]) {
    const [x1, y1, x2, y2] = ring.line;
    lines.append(svgEl('line', { x1, y1, x2, y2 }));
    lines.append(svgEl('circle', { class: 'rc-map-anchor', cx: x2, cy: y2, r: 2.5 }));
  }
  wide.append(lines);
  for (const ring of [...MAP_RINGS.front, ...MAP_RINGS.back]) {
    wide.append(wideRing(byKey.get(ring.key), ring));
  }

  // — Tablet: elöl-oszlop | két figura | hátul-oszlop —
  const split = document.createElement('div');
  split.className = 'rc-map-split';
  const figures = ['front', 'back'].map((side) => {
    const fig = document.createElement('figure');
    fig.className = 'rc-map-figure';
    const caption = document.createElement('figcaption');
    caption.textContent = side === 'front' ? 'Elöl' : 'Hátul';
    fig.append(figureImg(side), caption);
    return fig;
  });
  split.append(
    ringColumn(MAP_RINGS.front.map((r) => r.key), byKey, 68),
    ...figures,
    ringColumn(MAP_RINGS.back.map((r) => r.key), byKey, 56),
  );

  // — Mobil: egy nézet, a figura két oldalán —
  const tabbed = document.createElement('div');
  tabbed.className = 'rc-map-tabbed';
  const figure = document.createElement('div');
  figure.className = 'rc-map-figure';
  figure.append(figureImg(view));
  tabbed.append(
    ringColumn(MOBILE_COLUMNS[view].left, byKey, 60),
    figure,
    ringColumn(MOBILE_COLUMNS[view].right, byKey, 60),
  );

  host.replaceChildren(wide, split, tabbed);
}
```

A `renderRecovery` végére (a gyakorlat-ajánlások után):

```js
  // — Izomtérkép —
  renderMuscleMap(report.muscles, $('[data-page="recovery"]').dataset.rcView ?? 'front');
```

Exportáld a `renderMuscleMap`-et is.

- [ ] **Step 2: Fülek** — `public/js/ui/recovery.js`, a Task 3 összecsukó-kódja után. A fül csak a mobil-változatot rajzolja újra, a lapon eltárolt legutóbbi riportból (`page.rcReport`, lásd lent). Az import-listához add a `renderMuscleMap`-et:

```js
  /* Mobilon Elöl/Hátul fül: egyszerre egy figura. A választás a lapon
     marad (data-rc-view), így egy újrarenderelés sem ugrik vissza „Elöl"-re. */
  $$('[data-rc-view]', page).forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.rcView;
      page.dataset.rcView = view;
      $$('[data-rc-view]', page).forEach((other) =>
        other.setAttribute('aria-selected', String(other === tab)),
      );
      if (page.rcReport) renderMuscleMap(page.rcReport.muscles, view);
    });
  });
```

és a `renderRecovery` elején (a `if (!page || !report) return;` után): `page.rcReport = report;` — így a fül mindig a legutóbbi riportot rajzolja.

- [ ] **Step 3: CSS** — a Task 3 blokkja után:

```css
/* ---- Izomtérkép: három változat, a konténer-szélesség választ ---- */
.rc-map-wide,
.rc-map-split {
  display: none;
}
.rc-map-tabbed {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr) 76px;
  gap: var(--sp-1);
  height: 420px;
  margin-top: var(--sp-8);
}
.rc-map-col {
  display: flex;
  flex-direction: column;
  justify-content: space-around;
}
.rc-map-figure {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-5);
  min-width: 0;
  overflow: hidden;
}
.rc-figure {
  width: 100%;
  height: 360px;
  object-fit: contain;
}
.rc-map-figure figcaption,
.rc-map-caption {
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  fill: var(--fg-60);
  color: var(--fg-60);
}
.rc-map-caption {
  text-anchor: middle;
}

/* Gyűrű — közös (SVG-ben és HTML-ben is) */
.rc-ring-bg {
  fill: var(--fg-06);
  stroke: var(--fg-15);
  stroke-width: 3;
}
.rc-ring-fg {
  fill: none;
  stroke: var(--text-primary);
  stroke-width: 3;
}
.rc-ring--ok .rc-ring-fg {
  stroke: var(--c-ok);
}
.rc-ring-empty {
  fill: var(--fg-06);
  stroke: var(--fg-40);
  stroke-width: 1.5;
  stroke-dasharray: 3 6;
}
.rc-ring-num {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.03em;
  text-anchor: middle;
  fill: var(--text-primary);
}
.rc-ring-num--none {
  fill: var(--fg-40);
}
.rc-ring-pct {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  fill: var(--fg-50);
}
.rc-ring-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.11em;
  text-transform: uppercase;
  text-anchor: middle;
  fill: var(--fg-70);
}
.rc-ring-label--none {
  fill: var(--fg-60);
}
.rc-ring-dot--sore {
  fill: var(--text-primary);
}
.rc-ring-dot--pain {
  fill: var(--c-pain);
}
.rc-map-lines line {
  stroke: var(--fg-30);
  stroke-width: 1;
}
.rc-map-anchor {
  fill: var(--fg-75);
}

/* Kompakt (HTML) gyűrű */
.rc-cring {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
}
.rc-cring-box {
  position: relative;
}
.rc-cring-box svg {
  display: block;
}
.rc-cring-num {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.03em;
}
.rc-ring--none .rc-cring-num {
  color: var(--fg-40);
}
.rc-cring-pct {
  margin-left: 1px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--fg-50);
}
.rc-cring-label {
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--fg-70);
}
.rc-cring-dots {
  display: flex;
  gap: var(--sp-1);
  height: 8px;
}

@container rc (min-width: 600px) {
  .rc-map-tabbed {
    display: none;
  }
  .rc-map-split {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) minmax(0, 1fr) 96px;
    gap: var(--sp-3);
    height: 680px;
    margin-top: var(--sp-10);
  }
  .rc-map-split > .rc-map-col:last-child {
    justify-content: space-between;
  }
  .rc-map-split .rc-figure {
    height: 560px;
  }
}

@container rc (min-width: 1040px) {
  .rc-map-split {
    display: none;
  }
  .rc-map-wide {
    display: block;
    width: 100%;
    max-width: 848px;
    height: auto;
    margin-left: auto;
  }
}
```

- [ ] **Step 4: Ellenőrzés**

Run: `npm test` → `# fail 0`; `npm run lint`; prettier a négy érintett fájlon.
Run: `npm run dev`, `#recovery`: asztali szélességen a figurák, a 12 gyűrű és a vonalak a helyükön; ablakszűkítéskor tablet (két figura, két oszlop), majd mobil (fülek). A mobil fülváltás a figurát és a gyűrű-oszlopokat is cseréli. Konzolban nincs hiba (a `img/body-*.svg` betölt — ha az app nem a gyökérről szolgál ki, a relatív `img/` útvonalat igazítsd a `public/index.html` többi asset-hivatkozásához).

- [ ] **Step 5: Commit**

```bash
git add public/js/render/recovery.js public/js/ui/recovery.js public/style.css
git commit -m "Regeneráció: izomtérkép gyűrűkkel — asztali SVG, tablet- és mobil-elrendezés

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A design alatti blokkok + a régi izomcsoport-kártya megszűnése

**Files:**
- Modify: `public/index.html` (a `#recovery` szekció alsó része)
- Modify: `public/style.css` (22. szakasz: `rc-card` → vonallal tagolt szakaszok; törlések)
- Modify: `public/js/render/recovery.js` (az „Izomcsoportok" render-blokk törlése)

- [ ] **Step 1: Sorrend és tisztítás** — a `.rc-top` UTÁN, ebben a sorrendben álljon: `<details class="rc-checkin-advanced …">` (Részletes szerkesztés), `rc-weight` (Testsúly alakulása), `rc-body` (Testösszetétel), `rc-cns` (Idegrendszer), `rc-lifts` szekció (Mai ajánlások). A `<section … aria-labelledby="title-rc-muscles">` („Izomcsoportok") blokkot TÖRÖLD, a `tpl-rc-muscle` sablonnal együtt (`grep -n "tpl-rc-muscle" public/index.html`).

- [ ] **Step 2: Render** — a `renderRecovery`-ből töröld a „// — Izomcsoportok —" blokkot (a `data-list="rc-muscles"` feltöltése). Ellenőrizd: `grep -rn "rc-muscles\|tpl-rc-muscle\|rc-muscle-" public` → csak CSS maradhat, azt a következő lépés törli.

- [ ] **Step 3: CSS a design nyelvén** — a 22. szakaszban:
- töröld a `.rc-muscles`, `.rc-muscle*` szabályokat;
- a `.rc-card` legyen vonallal tagolt szakasz, nem doboz:

```css
/* A felső rész alatti blokkok a design nyelvén: nem kártyák, hanem
   hajszálvonallal elválasztott szakaszok, mono felkiáltó-címmel. */
.rc-card {
  padding: var(--sp-13) 0 0;
  margin-top: var(--sp-13);
  background: none;
  border: 0;
  border-top: 1px solid var(--hair);
  box-shadow: none;
}
.rc-section-title {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--fg-55);
}
```

(ha a `.rc-card` / `.rc-section-title` már létezik, a meglévő szabályt írd át erre — ne legyen kettő.)
- A `.rc-checkin-advanced` összecsukott sávja kapja ugyanezt a felső vonalat és mono címet (a `.rc-checkin-summary` `.rc-section-title`-t használ, ez a fenti szabállyal rendben van).
- A felső rész alatt a blokkok tartalma asztalon se nyúljon a teljes 1312px-re: `@container rc (min-width: 1040px) { .rc-page > .rc-card, .rc-page > .rc-checkin-advanced { max-width: 760px; } }`.
- Minden `rc-*` szabály, amelynek a szelektora már nem létezik a markupban (`rc-score`, `rc-ring`, `rc-component`, `rc-muscle`, `rc-checkin-cta`), legyen törölve: `for s in rc-score rc-ring rc-component rc-muscle rc-checkin-cta; do grep -c "\.$s" public/style.css; grep -c "$s" public/index.html public/js -r; done` — a CSS-számláló csak akkor lehet > 0, ha a markupban is van találat.

- [ ] **Step 4: Ellenőrzés**

Run: `npm test` → `# fail 0`; `npm run lint`; prettier a három fájlon.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/style.css public/js/render/recovery.js
git commit -m "Regeneráció: a design alatti blokkok a design nyelvén; az izomcsoport-kártya megszűnik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Vizuális ellenőrzés a három törésponton

**Files:** nincs kódváltozás, kivéve a talált hibák javítását.

- [ ] **Step 1:** `npm run dev`; egy tesztfiók check-innel (izomlázzal és egy ≥7 fájdalommal legalább egy csoportra) és legalább egy naplózott edzéssel, hogy legyen 40% alatti csoport, `known:false` csoport nélkül is és vele is (friss fiók check-in nélkül → minden gyűrű „—").
- [ ] **Step 2:** Képernyőkép a `#recovery` lapról 1440×900, 1280×800, 900×1100 és 390×844 méretben (headless Chrome vagy a böngésző DevTools). Ellenőrizd:
  - 1440: asztali (bal hasáb + SVG térkép vonalakkal), a gyűrűk nem takarják a figurát, a „Ma kíméld" a bal hasábban, alatta a jelmagyarázat;
  - 1280 és 900: tablet (kétsávos fej, két figura két gyűrű-oszloppal, a bontás két hasábban);
  - 390: mobil (fülek, összecsukott bontás egysoros összefoglalóval, a 44px-es érintési célok megvannak);
  - a `known:false` gyűrű szaggatott, „—" és „Nincs adat"; a ≥80-as gyűrű zöld; a pöttyök színe helyes;
  - nincs vízszintes görgetés egyik méreten sem.
- [ ] **Step 3:** A talált eltéréseket javítsd, `npm test` + `npm run lint`, commit: `Regeneráció: vizuális javítások a töréspontokon` (+ Co-Authored-By sor).
