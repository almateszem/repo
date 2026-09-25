# 12 izomcsoport — implementációs terv (a Regeneráció redesign 1. része)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 9 izomcsoportos taxonómia bővítése 12-re (`arms` → `biceps` + `triceps`; `back` mellé `traps` + `lowerBack`) a motorban, a katalógusban, az adatbázisban és a kliensen.

**Architecture:** A taxonómia egyetlen forrása a `server/muscles.js` (`MUSCLE_GROUPS`). A kulcscsere atomikus (Task 2): a katalógus-validáció induláskor elszáll bármely ismeretlen kulccsal, ezért a kulcsok, a kurált és a generált katalógus, a motor referenciaértékei és az ajánló egy commitban váltanak. A régi check-inek átírása egyszer lefutó `user_version = 2` migráció, egy tiszta, tesztelt segédfüggvénnyel (`splitLegacyMuscleMap`).

**Tech Stack:** Node ≥22.5 (ESM, `node:sqlite`, `node:test`), Express, vanilla JS kliens.

**Spec:** `docs/superpowers/specs/2026-09-24-regeneracio-redesign-design.md` (1. rész)

## Global Constraints

- Kulcsok és címkék, ebben a sorrendben (= a felület sorrendje): `chest` Mell, `shoulders` Váll, `biceps` Bicepsz, `triceps` Tricepsz, `traps` Trapéz, `back` Hát, `lowerBack` Alsó hát, `core` Has / core, `quads` Quad, `hamstrings` Hamstring, `glutes` Farizom, `calves` Vádli.
- Az `arms` kulcs megszűnik; sehol nem maradhat (a generált `exercises.exdb.js`-ben sem).
- Régi értékek szétosztása: `arms: x` → `biceps: x, triceps: x`; `back: x` → `back: x, traps: x, lowerBack: x`.
- τ: `biceps`/`triceps` 1.5 (az `arms` értéke), `traps` 2.2 (a `back`-é), `lowerBack` 2.6 (kissé lassabb). `ABS_GROUP_REF`: `biceps`/`triceps` 3.5, `traps`/`lowerBack` 5.0.
- A `PAIN_BLOCK` és minden más motorlogika változatlan.
- Minden `load` súlyösszege pontosan 1 (a `catalog.js` 1e-6 tűréssel ellenőrzi).
- Tesztfuttatás: `npm test` (jelenleg 427/427 zöld). A végén is minden zöld.
- Kódstílus: magyar kommentek a környező kód sűrűségével; Prettier (`npm run format:check`), ESLint (`npm run lint`).
- Commit-üzenetek magyarul, a végükön: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Az ágon lévő, NEM commitolt `PAIN_BLOCK`-munkát (`server/muscles.js`, `recovery.js`, `suggestions.js`, `server.js`, `public/js/ui/checkin/helpers.js`) a Task 1 ELŐTT külön commitba kell tenni (Task 0).

---

### Task 0: A függőben lévő PAIN_BLOCK-munka commitolása

**Files:** már módosított: `server/muscles.js`, `server/recovery.js`, `server/suggestions.js`, `server/server.js`, `public/js/ui/checkin/helpers.js`

- [ ] **Step 1: Tesztek**

Run: `npm test`
Expected: `# pass 427`, `# fail 0`

- [ ] **Step 2: Commit (csak ez az öt fájl — a gyökérben lévő design-HTML-t NE)**

```bash
git add server/muscles.js server/recovery.js server/suggestions.js server/server.js public/js/ui/checkin/helpers.js
git commit -m "PAIN_BLOCK: a 7/10-es fájdalomküszöb egy közös konstansban

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: `splitLegacyMuscleMap` — a régi kulcsok szétosztása (tiszta függvény)

**Files:**
- Modify: `server/muscles.js` (új export a fájl végén)
- Create: `server/muscles.test.js`

**Interfaces:**
- Produces: `LEGACY_SPLIT: { arms: string[], back: string[] }`, `splitLegacyMuscleMap(map: object|null): object` — Task 3 (migráció) használja.

- [ ] **Step 1: A bukó teszt**

`server/muscles.test.js`:

```js
/**
 * FitTrack Pro — a régi (9 csoportos) izomtérképek szétosztása
 * ------------------------------------------------------------
 * A 12 csoportos taxonómia a régi `arms` és `back` kulcsot felbontja. A
 * check-inekben tárolt izomláz- és fájdalom-értékeknek ÁT kell öröklődniük
 * minden utódra — egy 8/10-es kar-fájdalom tiltása nem veszhet el.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { splitLegacyMuscleMap } from './muscles.js';

test('az arms a bicepszre és a tricepszre is átmásolódik', () => {
  assert.deepEqual(splitLegacyMuscleMap({ arms: 6, chest: 2 }), {
    biceps: 6,
    triceps: 6,
    chest: 2,
  });
});

test('a back megmarad, és a trapézra meg az alsó hátra is átmásolódik', () => {
  assert.deepEqual(splitLegacyMuscleMap({ back: 7 }), { back: 7, traps: 7, lowerBack: 7 });
});

test('a nem csoporthoz kötött general fájdalom változatlan', () => {
  assert.deepEqual(splitLegacyMuscleMap({ general: 3 }), { general: 3 });
});

test('ütközésnél a nagyobb érték nyer (óvatos irány)', () => {
  assert.deepEqual(splitLegacyMuscleMap({ biceps: 2, arms: 5 }), { biceps: 5, triceps: 5 });
  assert.deepEqual(splitLegacyMuscleMap({ traps: 9, back: 4 }), {
    traps: 9,
    back: 4,
    lowerBack: 4,
  });
});

test('üres és hibás bemenetre üres objektum', () => {
  assert.deepEqual(splitLegacyMuscleMap({}), {});
  assert.deepEqual(splitLegacyMuscleMap(null), {});
  assert.deepEqual(splitLegacyMuscleMap('x'), {});
});
```

- [ ] **Step 2: Futtatás — bukik**

Run: `node --test server/muscles.test.js`
Expected: FAIL — `splitLegacyMuscleMap` nincs exportálva (SyntaxError: does not provide an export).

- [ ] **Step 3: Implementáció** — a `server/muscles.js` végére:

```js
/** A 9 → 12 csoportos váltásnál felbontott régi kulcsok és az utódaik. A
    `back` a saját utódja is: a széles hát kulcsa megmaradt. */
export const LEGACY_SPLIT = {
  arms: ['biceps', 'triceps'],
  back: ['back', 'traps', 'lowerBack'],
};

/** Egy régi (9 csoportos) izomláz- vagy fájdalom-térkép átírása: a felbontott
    kulcs értéke MINDEN utódra átmásolódik. Ütközésnél a nagyobb érték nyer —
    a fájdalom-tiltás így sosem vész el. A többi kulcs (a `general` is)
    változatlan. A db.js 2-es séma-migrációja használja. */
export function splitLegacyMuscleMap(map) {
  if (!map || typeof map !== 'object') return {};
  const out = {};
  const put = (key, value) => {
    out[key] = key in out ? Math.max(out[key], value) : value;
  };
  for (const [key, value] of Object.entries(map)) {
    for (const heir of LEGACY_SPLIT[key] ?? [key]) put(heir, value);
  }
  return out;
}
```

- [ ] **Step 4: Futtatás — zöld**

Run: `node --test server/muscles.test.js` → Expected: `# pass 5`
Run: `npm test` → Expected: `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add server/muscles.js server/muscles.test.js
git commit -m "Izomcsoportok: a régi arms/back értékek szétosztása (splitLegacyMuscleMap)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A taxonómia-váltás (szerver + katalógusok, atomikusan)

**Files:**
- Modify: `server/muscles.js` (`MUSCLE_GROUPS`, `TAU_BY_GROUP`, `KEYWORD_MAP`, fejléc-komment „kilenc" → „tizenkét")
- Modify: `server/recovery.js:201-211` (`ABS_GROUP_REF`)
- Modify: `server/suggestions.js:60-105` (`TITLE_RULES`)
- Modify: `server/data/exercises.hu.js` (109 `load` sor — szkripttel)
- Modify: `server/data/exdb.map.js:36-80` (`MUSCLE_TO_GROUP`), majd újragenerálás: `server/data/exercises.exdb.js`
- Test: `server/recovery.test.js`, `server/suggestions.test.js`, Create: `server/catalog-taxonomy.test.js`

**Interfaces:**
- Consumes: semmi a Task 1-ből.
- Produces: `MUSCLE_KEYS` = `['chest','shoulders','biceps','triceps','traps','back','lowerBack','core','quads','hamstrings','glutes','calves']` — Task 3 és Task 4 erre épít.

- [ ] **Step 1: A bukó tesztek**

Create `server/catalog-taxonomy.test.js`:

```js
/**
 * FitTrack Pro — a 12 csoportos taxonómia a katalógusokban
 * --------------------------------------------------------
 * A szerkezeti ellenőrzést (ismert kulcs, összeg = 1) a catalog.js induláskor
 * elvégzi. Ez a teszt a TARTALMAT nézi: a jellegzetes gyakorlatok a
 * mozgásuknak megfelelő új csoportot terhelik.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { MUSCLE_KEYS, MUSCLE_GROUPS, resolveExerciseLoad } from './muscles.js';
import { exercises } from './data/exercises.hu.js';
import { exdbExercises } from './data/exercises.exdb.js';

const loadOf = (name) => exercises.find((e) => e.name === name).load;

test('a tizenkét kulcs a felület sorrendjében', () => {
  assert.deepEqual(MUSCLE_KEYS, [
    'chest', 'shoulders', 'biceps', 'triceps', 'traps', 'back',
    'lowerBack', 'core', 'quads', 'hamstrings', 'glutes', 'calves',
  ]);
  assert.equal(MUSCLE_GROUPS.core, 'Has / core');
  assert.equal(MUSCLE_GROUPS.quads, 'Quad');
});

test('egyik katalógusban sem maradt arms kulcs', () => {
  for (const row of [...exercises, ...exdbExercises]) {
    assert.ok(!('arms' in row.load), `${row.name}: arms kulcs`);
  }
});

test('nyomás → tricepsz, húzás → bicepsz, vállvonogatás → trapéz, hiperextenzió → alsó hát', () => {
  assert.equal(loadOf('Fekvenyomás').triceps, 0.25);
  assert.equal(loadOf('Húzódzkodás').biceps, 0.25);
  assert.equal(loadOf('Bicepsz hajlítás').biceps, 1);
  assert.equal(loadOf('Homlok nyomás').triceps, 1);
  assert.equal(loadOf('Vállvonogatás').traps, 0.6);
  assert.equal(loadOf('Hiperextenzió').lowerBack, 0.4);
  assert.deepEqual(loadOf('Felhúzás'), {
    hamstrings: 0.3, glutes: 0.25, lowerBack: 0.2, back: 0.15, core: 0.1,
  });
});

test('a kulcsszavas becslés is az új csoportokra képez', () => {
  assert.ok(resolveExerciseLoad('bench press variáció', []).triceps > 0);
  assert.ok(resolveExerciseLoad('lat pulldown széles', []).biceps > 0);
  assert.ok(resolveExerciseLoad('shrug gépen', []).traps > 0);
  assert.ok(resolveExerciseLoad('hyperextension padon', []).lowerBack > 0);
  assert.equal(resolveExerciseLoad('skull crusher', []).triceps, 1);
  assert.equal(resolveExerciseLoad('hammer curl', []).biceps, 1);
});
```

- [ ] **Step 2: Futtatás — bukik**

Run: `node --test server/catalog-taxonomy.test.js`
Expected: FAIL (a kulcslista 9 elemű, `arms` kulcsok vannak).

- [ ] **Step 3: `server/muscles.js` — kulcsok, τ, kulcsszavak**

A `MUSCLE_GROUPS` és a komment fölötte:

```js
/** A tizenkét izomcsoport kulcsa → magyar címke. A sorrend a felület sorrendje
    (felsőtest elöl, majd hátul fentről lefelé, végül az alsótest). */
export const MUSCLE_GROUPS = {
  chest: 'Mell',
  shoulders: 'Váll',
  biceps: 'Bicepsz',
  triceps: 'Tricepsz',
  traps: 'Trapéz',
  back: 'Hát',
  lowerBack: 'Alsó hát',
  core: 'Has / core',
  quads: 'Quad',
  hamstrings: 'Hamstring',
  glutes: 'Farizom',
  calves: 'Vádli',
};
```

`TAU_BY_GROUP` (a komment marad, egy mondattal bővül):

```js
    kapnak (nyújtott állapotban terhelődnek, ami több izomkárosodást okoz).
    Az alsó hát a széles hátnál lassabb: a gerincfeszítők a nehéz felhúzásban
    és a hajolt munkában folyamatos, statikus terhelést kapnak. */
export const TAU_BY_GROUP = {
  biceps: 1.5,
  triceps: 1.5,
  calves: 1.5,
  shoulders: 1.5,
  chest: 2.2,
  back: 2.2,
  traps: 2.2,
  quads: 2.2,
  lowerBack: 2.6,
  hamstrings: 3.0,
  glutes: 3.0,
  core: 3.0,
};
```

`KEYWORD_MAP` — a sorok cseréje (a minták és a sorrend VÁLTOZATLAN, csak a súly-objektumok; a nem listázott sorok maradnak). A súlyok a katalógus átírt soraival egyeznek:

```js
  [/felhuzas.?allig|upright.?row/, { shoulders: 0.6, traps: 0.3, biceps: 0.1 }],
  [/shrug|vallvonogat/, { traps: 0.6, shoulders: 0.4 }],
  // … hatso.?vall, kitores sor változatlan …
  [/roman|rdl|merev.?labu/, { hamstrings: 0.5, glutes: 0.3, lowerBack: 0.15, core: 0.05 }],
  [
    /felhuz|deadlift|huzas.?fold/,
    { hamstrings: 0.3, glutes: 0.25, lowerBack: 0.2, back: 0.15, core: 0.1 },
  ],
  // … guggolás-, lábtolás-, csípőtolás-, comb-, vádli-sorok változatlanok …
  [/ferde.?fekvenyom|incline/, { chest: 0.65, shoulders: 0.2, triceps: 0.15 }],
  [/fekvenyom|bench|mellnyomas|mell.?nyomas/, { chest: 0.6, triceps: 0.25, shoulders: 0.15 }],
  [/tolodzk|dip/, { chest: 0.5, triceps: 0.35, shoulders: 0.15 }],
  // … tarogat sor változatlan …
  [/fekvotamasz|push.?up/, { chest: 0.55, triceps: 0.25, shoulders: 0.15, core: 0.05 }],
  [/huzodzk|pull.?up|chin.?up/, { back: 0.7, biceps: 0.25, core: 0.05 }],
  [/lehuzas|lat.?pulldown/, { back: 0.75, biceps: 0.25 }],
  [/evezes|\brow|hajolt/, { back: 0.7, biceps: 0.2, shoulders: 0.1 }],
  [/pulover|pullover/, { back: 0.7, chest: 0.2, triceps: 0.1 }],
  [/hiperextenzio|hyperextension|torok?emel/, { lowerBack: 0.4, hamstrings: 0.3, glutes: 0.3 }],
  [
    /arnold|vallbol.?nyom|vall.?nyom|overhead.?press|katonai/,
    { shoulders: 0.65, triceps: 0.25, core: 0.1 },
  ],
  // … oldalemel, elolemel változatlan …
  // — Kar —
  [/bicepsz|bicep|hajlitas.?sulyzo|kalapacs|hammer|\bcurl/, { biceps: 1 }],
  [/tricepsz|tricep|nyujtas.?kabel|homlok.?nyomas|skull/, { triceps: 1 }],
  [/alkar|forearm|csuklo/, { biceps: 1 }],
  // … plank, felules változatlan …
  [/oblique|ferde.?has|orosz.?csavar|russian.?twist/, { core: 0.85, biceps: 0.08, triceps: 0.07 }],
  [/farmer/, { core: 0.6, biceps: 0.25, traps: 0.15 }],
```

Megjegyzések: a `\bcurl` új minta a bicepsz-sorban (a „hammer curl" eddig is talált a `hammer`-rel; a sima „curl" nem). A `/comb.?hajlit|leg.?curl|labhajlit/` sor ELŐBB áll, így a „leg curl" továbbra is hamstring. A `farmer` külön sorba kerül (a katalógus „Farmer séta" sorával egyezik).

A modul fejléc-kommentjében „A kilenc izomcsoport" → „A tizenkét izomcsoport" (ha előfordul; `grep -n kilenc server/muscles.js`).

- [ ] **Step 4: `server/recovery.js` — `ABS_GROUP_REF`**

```js
const ABS_GROUP_REF = {
  chest: 5.0,
  back: 5.0,
  traps: 5.0,
  lowerBack: 5.0,
  quads: 5.0,
  shoulders: 4.2,
  hamstrings: 4.2,
  glutes: 4.2,
  biceps: 3.5,
  triceps: 3.5,
  calves: 3.5,
  core: 3.5,
};
```

- [ ] **Step 5: `server/data/exercises.hu.js` — átírás szkripttel**

Mentsd a szkriptet a scratchpadba (NEM a repóba) `split-catalog.mjs` néven:

```js
// Egyszeri átalakító: server/data/exercises.hu.js `load` sorai → 12 izomcsoport.
// Futtatás a repo gyökeréből: node <ez a fájl> [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const FILE = path.resolve('server/data/exercises.hu.js');
const { exercises } = await import(pathToFileURL(FILE).href);

/* — Az `arms` rész célja — */
const ARMS_TO_BICEPS_OVERRIDE = new Set([
  'Felhúzás állig', // Váll csoport, de húzás
  'Függeszkedő lábemelés',
  'Toes to bar',
  'Farmer séta',
  'Suitcase carry',
  'Evezőgép',
]);
const ARMS_TO_TRICEPS_OVERRIDE = new Set([
  'Straight-arm lehúzás', // Hát csoport, de nyújtott karú
  'Kábeles pulóver',
  'Ab wheel',
  'Turkish get-up',
  'Fej fölötti séta',
  'SkiErg',
  'Burpee',
  'Bear crawl',
]);
/** Vegyes (húz + nyom) mozgás: az `arms` fele-fele, a nagyobbik fél a bicepszé. */
const ARMS_SPLIT_EVEN = new Set(['Orosz csavarás', 'Assault bike', 'Battle rope']);

function armsTarget(entry) {
  if (ARMS_TO_BICEPS_OVERRIDE.has(entry.name)) return 'biceps';
  if (ARMS_TO_TRICEPS_OVERRIDE.has(entry.name)) return 'triceps';
  if (entry.group === 'Mell' || entry.group === 'Váll') return 'triceps';
  if (entry.group === 'Hát') return 'biceps';
  if (entry.group === 'Kar') return entry.muscles.startsWith('Tricepsz') ? 'triceps' : 'biceps';
  throw new Error(`Nincs szabály az arms-ra: ${entry.name}`);
}

/* — A `back` rész szétosztása: név → { cél: súly }, összege = a régi back. — */
const BACK_SPLIT = {
  Vállvonogatás: { traps: 0.6 },
  'Kézisúlyzós vállvonogatás': { traps: 0.6 },
  'Felhúzás állig': { traps: 0.3 },
  'Y-emelés': { traps: 0.4 },
  Felhúzás: { back: 0.15, lowerBack: 0.2 },
  'Sumo felhúzás': { back: 0.1, lowerBack: 0.15 },
  'Trap-rudas felhúzás': { traps: 0.1, lowerBack: 0.15 },
  'Rack pull': { back: 0.2, traps: 0.15, lowerBack: 0.15 },
  'Román felhúzás': { lowerBack: 0.15 },
  'Merev lábas felhúzás': { lowerBack: 0.2 },
  'Jó reggelt': { lowerBack: 0.3 },
  Hiperextenzió: { lowerBack: 0.4 },
  'Fordított hiperextenzió': { lowerBack: 0.25 },
  Superman: { lowerBack: 0.6 },
  'Bird dog': { lowerBack: 0.2 },
  'Kettlebell swing': { lowerBack: 0.1 },
  'Trap-rudas guggolás': { traps: 0.1 },
  'Farmer séta': { traps: 0.15 },
  'Suitcase carry': { traps: 0.1 },
};

const round2 = (x) => Math.round(x * 100) / 100;

function newLoad(entry) {
  const out = {};
  const add = (key, value) => (out[key] = round2((out[key] ?? 0) + value));
  for (const [key, value] of Object.entries(entry.load)) {
    if (key === 'arms') {
      if (ARMS_SPLIT_EVEN.has(entry.name)) {
        const half = round2(Math.ceil((value / 2) * 100) / 100);
        add('biceps', half);
        add('triceps', round2(value - half));
      } else add(armsTarget(entry), value);
    } else if (key === 'back' && BACK_SPLIT[entry.name]) {
      const split = BACK_SPLIT[entry.name];
      const total = round2(Object.values(split).reduce((a, b) => a + b, 0));
      if (total !== value) throw new Error(`${entry.name}: back ${value} ≠ szétosztás ${total}`);
      for (const [k, v] of Object.entries(split)) add(k, v);
    } else add(key, value);
  }
  return out;
}

const literal = (load) =>
  '{ ' +
  Object.entries(load)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ') +
  ' }';

let text = readFileSync(FILE, 'utf8');
let changed = 0;
const usedBack = new Set();
for (const entry of exercises) {
  const touchesArms = 'arms' in entry.load;
  const touchesBack = 'back' in entry.load && BACK_SPLIT[entry.name];
  if (!touchesArms && !touchesBack) continue;
  if (touchesBack) usedBack.add(entry.name);

  const next = newLoad(entry);
  const sum = Object.values(next).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) throw new Error(`${entry.name}: összeg ${sum}`);

  // A sor a `name: '…'` után következő első `load: { … }`.
  const nameAt = text.indexOf(`name: '${entry.name}'`);
  if (nameAt < 0) throw new Error(`Nem található: ${entry.name}`);
  const loadAt = text.indexOf('load: {', nameAt);
  const loadEnd = text.indexOf('}', loadAt) + 1;
  text = text.slice(0, loadAt) + 'load: ' + literal(next) + text.slice(loadEnd);
  changed += 1;
  console.log(`${entry.name}: ${JSON.stringify(entry.load)} → ${literal(next)}`);
}
const unused = Object.keys(BACK_SPLIT).filter((n) => !usedBack.has(n));
if (unused.length) throw new Error(`Fel nem használt BACK_SPLIT sor: ${unused.join(', ')}`);
if (/\barms\b/.test(text.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''))) {
  throw new Error('Maradt arms kulcs a fájlban');
}
console.log(`${changed} sor módosul`);
if (process.argv.includes('--write')) writeFileSync(FILE, text);
```

FONTOS: a szkript a még RÉGI `exercises.hu.js`-t importálja — ez nem függ a `muscles.js`-től, tehát a Step 3 után is fut.

Run (próba): `node <scratchpad>/split-catalog.mjs`
Expected: az utolsó sor `109 sor módosul`, hiba nélkül.
Run (írás): `node <scratchpad>/split-catalog.mjs --write`, majd `npx prettier --write server/data/exercises.hu.js`
Ellenőrzés: `grep -c "arms" server/data/exercises.hu.js` → `0`

A fájl fejléc-kommentjében (`load` mező leírása) nincs kulcslista — nem kell módosítani.

- [ ] **Step 6: `server/data/exdb.map.js` — leképezés + újragenerálás**

A `MUSCLE_TO_GROUP`-ban:

```js
  spine: 'lowerBack',
  'lower back': 'lowerBack',
  'upper back': 'back',
  back: 'back',
  lats: 'back',
  'latissimus dorsi': 'back',
  rhomboids: 'back',
  traps: 'traps',
  trapezius: 'traps',
  'levator scapulae': 'traps',
  // …
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'biceps',
  brachialis: 'biceps',
  wrists: 'biceps',
  'wrist flexors': 'biceps',
  'wrist extensors': 'biceps',
  hands: 'biceps',
  'grip muscles': 'biceps',
```

A fájl fejlécében „a mi kilenc regenerációs csoportunk" → „a mi tizenkét regenerációs csoportunk"; a `deriveLoad` kommentjében „target 'biceps' → arms, secondary 'forearms' → szintén arms" → „target 'biceps' → biceps, secondary 'forearms' → szintén biceps". Az alkar a bicepsz-csoportba kerül (spec: „az alkar is ide").

Run: `npm run exdb:build` (hálózat kell: letölti a forrást a `server/data/.exdb/` alá)
Expected: sikeres futás, `server/data/exercises.exdb.js` újraírva.
Ellenőrzés: `grep -c "arms:" server/data/exercises.exdb.js` → `0`; `git diff --stat server/data/exercises.exdb.js` csak `load`-változást mutat (a sorok száma azonos: `Gyakorlatok: 1241`).
Ha nincs hálózat: állj meg és jelezd — a generált fájlt kézzel szerkeszteni TILOS.

- [ ] **Step 7: `server/suggestions.js` — `TITLE_RULES`**

A „Hát", „Kar", „Push", „Pull", „Felsőtest" szabály cseréje; a „Kar" elé két új szabály:

```js
  {
    label: 'Hát',
    groups: ['back', 'traps', 'lowerBack'],
    prefix: ['hát'],
    exact: ['hatnap', 'back'],
  },
  // … Váll változatlan …
  { label: 'Bicepsz', groups: ['biceps'], prefix: ['bicepsz'], exact: ['bicep', 'biceps'] },
  { label: 'Tricepsz', groups: ['triceps'], prefix: ['tricepsz'], exact: ['tricep', 'triceps'] },
  {
    label: 'Kar',
    groups: ['biceps', 'triceps'],
    prefix: ['karnap', 'karok', 'alkar'],
    exact: ['kar', 'arm', 'arms'],
  },
  // … Láb, Farizom, Vádli, Törzs változatlan …
  {
    label: 'Push',
    groups: ['chest', 'shoulders', 'triceps'],
    prefix: ['push', 'nyomó'],
    exact: ['nyomo'],
  },
  {
    label: 'Pull',
    groups: ['back', 'traps', 'lowerBack', 'biceps'],
    prefix: ['pull', 'húzó'],
    exact: ['huzo'],
  },
  {
    label: 'Felsőtest',
    groups: ['chest', 'shoulders', 'biceps', 'triceps', 'traps', 'back', 'lowerBack'],
    prefix: ['felsőtest', 'upper'],
    exact: ['felso', 'felsotest'],
  },
```

- [ ] **Step 8: A meglévő tesztek frissítése**

`server/recovery.test.js`:
- 360. sor: `assert.equal(byKey.arms, 100, 'a kar érintetlen marad');` →
  ```js
  assert.equal(byKey.biceps, 100, 'a bicepsz érintetlen marad');
  assert.equal(byKey.triceps, 100, 'a tricepsz érintetlen marad');
  ```
- `test('mind a kilenc izomcsoportra ad értéket'` → `test('mind a tizenkét izomcsoportra ad értéket'`

`server/suggestions.test.js`:
- CATALOG: `Fekvenyomás` → `{ chest: 0.6, triceps: 0.25, shoulders: 0.15 }`; `Húzódzkodás` → `{ back: 0.7, biceps: 0.25, core: 0.05 }`; `Evezés` → `{ back: 0.7, biceps: 0.2, shoulders: 0.1 }`; `Bicepsz hajlítás` → `{ biceps: 1 }`.
- 64–65. sor:
  ```js
  assert.deepEqual(
    [...groupsFromTitle('Hát + bicepsz').keys()],
    ['back', 'traps', 'lowerBack', 'biceps'],
  );
  assert.deepEqual([...groupsFromTitle('Push #3').keys()], ['chest', 'shoulders', 'triceps']);
  ```
- 113. sor: `report({ back: 90, chest: 60, arms: 99 })` → `report({ back: 90, chest: 60, biceps: 99 })`; 119. sor: `['back', 'back', 'chest', 'chest', 'arms']` → `['back', 'back', 'chest', 'chest', 'biceps']`.
- 142. sor körül: `arms: 100,` → `biceps: 100, triceps: 100, traps: 100, lowerBack: 100,`.
- 153. sor: `'Quadriceps csak 40% regenerált'` → `'Quad csak 40% regenerált'`.

- [ ] **Step 9: Teljes futtatás**

Run: `npm test`
Expected: `# fail 0` (427 + 5 + 4 = 436 pass). Ha a „két jel egyenrangú" teszt csoport-sorrendje eltér: a `traps`/`lowerBack` címből jövő, de katalógus-gyakorlat nélküli csoport — ellenőrizd, hogy a kimenet csoportjai a várt `['back','back','chest','chest','biceps']`; ha nem, a TESZT várt értékét csak akkor írd át, ha a sorrend a „mindkét jel → cím/regenerált váltakozva" szabályt továbbra is betartja, és írd le az okát a commit-üzenetben.

Run: `npm run lint` és `npm run format:check` → Expected: hiba nélkül.

- [ ] **Step 10: Commit**

```bash
git add server/muscles.js server/recovery.js server/suggestions.js server/data/exercises.hu.js server/data/exdb.map.js server/data/exercises.exdb.js server/recovery.test.js server/suggestions.test.js server/catalog-taxonomy.test.js
git commit -m "Izomcsoportok: 9 → 12 (bicepsz, tricepsz, trapéz, alsó hát)

Az arms kulcs megszűnik; a katalógus súlyai gyakorlattípus szerint
oszlanak (nyomás → tricepsz, húzás → bicepsz, vállvonogatás → trapéz,
hiperextenzió/felhúzás → részben alsó hát). Az exdb újragenerálva.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: A régi check-inek migrációja (`user_version = 2`)

**Files:**
- Modify: `server/db.js` (import + új migrációs blokk a `schemaVersion < 1` blokk UTÁN, ~660. sor)
- Modify: `server/onerm-migration.test.js:85-93` (a várt séma-verzió)
- Create: `server/muscle-split-migration.test.js`

**Interfaces:**
- Consumes: `splitLegacyMuscleMap` (Task 1), `db.saveCheckin(userId, date, fields)`, `db.getCheckin(userId, date)` → `{ soreness, pain, … }`.

- [ ] **Step 1: A bukó teszt** — `server/muscle-split-migration.test.js`:

```js
/**
 * FitTrack Pro — a 12 izomcsoportos váltás migrációja (user_version 2)
 * -------------------------------------------------------------------
 * A tárolt check-inek izomláz- és fájdalom-térképe a régi `arms` és `back`
 * kulcsot használja. Induláskor egyszer átíródnak: az érték minden utódra
 * átmásolódik, így egy tárolt fájdalom-tiltás nem vész el.
 *
 * A minta az onerm-migration.test.js-é: a friss sémát külön folyamat hozza
 * létre, a régi állapotot nyersen állítjuk vissza, majd betöltjük az
 * adatréteget.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-muscles-'));
const DB_PATH = path.join(workDir, 'muscles.db');

/* 1. Friss séma egy fiókkal — külön folyamatban. */
execFileSync(
  process.execPath,
  [
    '--disable-warning=ExperimentalWarning',
    '--input-type=module',
    '-e',
    `
    const db = await import(${JSON.stringify(pathToFileURL(path.join(__dirname, 'db.js')).href)});
    db.createUser('regi', 'Régi Rita', 'x');
    db.closeDatabase();
    `,
  ],
  { env: { ...process.env, FITTRACK_DB: DB_PATH }, stdio: 'pipe' },
);

/* 2. A régi állapot: 9 csoportos kulcsok és a migráció előtti séma-verzió. */
const updatedAt = '2026-09-01 10:00:00';
{
  const raw = new DatabaseSync(DB_PATH);
  const userId = raw.prepare('SELECT id FROM users LIMIT 1').get().id;
  raw
    .prepare(
      `INSERT INTO checkins (user_id, date, soreness, pain, updated_at)
       VALUES (?, '2026-09-01', ?, ?, ?)`,
    )
    .run(
      userId,
      JSON.stringify({ arms: 6, chest: 2 }),
      JSON.stringify({ back: 8, general: 3 }),
      updatedAt,
    );
  raw.exec('PRAGMA user_version = 1');
  raw.close();
}

/* 3. Az adatréteg betöltése — itt fut a migráció. */
process.env.FITTRACK_DB = DB_PATH;
const db = await import('./db.js');
process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

const rawRow = () => {
  const raw = new DatabaseSync(DB_PATH);
  const row = raw.prepare('SELECT soreness, pain, updated_at FROM checkins').get();
  const version = raw.prepare('PRAGMA user_version').get().user_version;
  raw.close();
  return { ...row, version };
};

test('az arms izomláz a bicepszre és a tricepszre is átkerül', () => {
  assert.deepEqual(JSON.parse(rawRow().soreness), { biceps: 6, triceps: 6, chest: 2 });
});

test('a back fájdalom a hátra, a trapézra és az alsó hátra is átkerül; a general marad', () => {
  assert.deepEqual(JSON.parse(rawRow().pain), { back: 8, traps: 8, lowerBack: 8, general: 3 });
});

test('a migráció nem írja át a módosítás idejét, és a séma-verzió 2 lesz', () => {
  const row = rawRow();
  assert.equal(row.updated_at, updatedAt);
  assert.equal(row.version, 2);
});
```

Ellenőrizd a `checkins` oszlopok alapértékeit (`server/db.js` `CREATE TABLE checkins`): a nem megadott mezők (alvás stb.) NULL-lal vagy alapértékkel beszúrhatók. Ha a `users` tábla neve/oszlopa eltér, igazítsd a nyers lekérdezést (`grep -n "CREATE TABLE.*users" -A5 server/db.js`).

- [ ] **Step 2: Futtatás — bukik**

Run: `node --test server/muscle-split-migration.test.js`
Expected: FAIL — a soreness még `{ arms: 6, chest: 2 }`.

- [ ] **Step 3: Implementáció — `server/db.js`**

Import a meglévők mellé:

```js
import { splitLegacyMuscleMap } from './muscles.js';
```

A séma-verzió komment bővítése és az új blokk közvetlenül a `schemaVersion < 1` blokk után:

```js
     2 — 9 → 12 izomcsoport: a check-inek izomláz- és fájdalom-térképében a
         régi `arms` a bicepszre és a tricepszre, a `back` a hátra, a
         trapézra és az alsó hátra is átmásolódik (muscles.js
         splitLegacyMuscleMap). Az edzésnaplót nem kell átírni: az
         izomterhelést a motor a gyakorlatnévből mindig újraszámolja. */
```

```js
if (schemaVersion < 2) {
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };
  const rows = db.prepare('SELECT user_id, date, soreness, pain FROM checkins').all();
  const update = db.prepare(
    'UPDATE checkins SET soreness = ?, pain = ? WHERE user_id = ? AND date = ?',
  );
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      update.run(
        JSON.stringify(splitLegacyMuscleMap(parse(row.soreness))),
        JSON.stringify(splitLegacyMuscleMap(parse(row.pain))),
        row.user_id,
        row.date,
      );
    }
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
```

(Az `updated_at` szándékosan nincs az UPDATE-ben — a migráció nem felhasználói módosítás.)

- [ ] **Step 4: Az 1RM-migráció tesztjének igazítása** — `server/onerm-migration.test.js`:

```js
test('a bemondott csúcs megmarad, és a séma-verzió a legfrissebb (2) lesz', () => {
  // …
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 2);
```

- [ ] **Step 5: Futtatás — zöld**

Run: `node --test server/muscle-split-migration.test.js` → Expected: `# pass 3`
Run: `npm test` → Expected: `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/muscle-split-migration.test.js server/onerm-migration.test.js
git commit -m "Migráció (user_version 2): a régi check-inek arms/back értékeinek szétosztása

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Kliens — izomlista és testtérkép 12 régióval

**Files:**
- Modify: `public/js/render/recovery.js:5-18` (`MUSCLE_GROUPS`)
- Modify: `public/js/ui/bodymap/paths.js` (ARM → BICEPS/TRICEPS, hátul trapéz + hát + alsó hát)
- Test: `public/js/ui/bodymap/paths.test.js`

**Interfaces:**
- Consumes: `MUSCLE_KEYS` (Task 2) — a `paths.test.js` a szerver moduljából olvassa.

- [ ] **Step 1: A teszt frissítése (bukó)** — `public/js/ui/bodymap/paths.test.js`:

```js
test('a két nézet uniója pontosan a tizenkét izomcsoport', () => {
```

és a `MIRRORING` tábla:

```js
const MIRRORING = {
  shoulders: true,
  biceps: true,
  triceps: true,
  quads: true,
  hamstrings: true,
  calves: true,
  chest: false,
  core: false,
  traps: false,
  back: false,
  lowerBack: false,
  glutes: false,
};
```

Run: `node --test public/js/ui/bodymap/paths.test.js`
Expected: FAIL — az unió még `arms`-ot tartalmaz, `biceps`/`triceps`/`traps`/`lowerBack` hiányzik.

- [ ] **Step 2: `paths.js`** — az `ARM` konstans helyett két, azonos rajzú régió (elöl a bicepsz, hátul a tricepsz látszik ugyanazon a karon):

```js
/* A kar mindkét nézetben ugyanaz a rajz: elölről a bicepsz, hátulról a
   tricepsz látszik rajta. */
const ARM_PATH =
  'M 43 114 C 39 126 39 138 43 150 C 37 162 35 176 39 190 ' +
  'C 41 202 43 208 44 212 C 48 216 53 215 55 212 ' +
  'C 58 200 63 184 62 168 C 62 162 60 156 60 150 ' +
  'C 65 140 69 126 67 110 C 60 116 50 118 43 114 Z';

const BICEPS = { key: 'biceps', mirrored: true, labelX: 52, labelY: 160, d: ARM_PATH };
const TRICEPS = { key: 'triceps', mirrored: true, labelX: 52, labelY: 160, d: ARM_PATH };
```

A „két nézetben azonos régiók" komment: „A váll és a vádli elölről és hátulról is ugyanott van" (a kar kikerül a felsorolásból).

`front`: `ARM` → `BICEPS`. `back`: `ARM` → `TRICEPS`, és a mostani `back` régió helyére három (sorrend: trapéz, hát, alsó hát):

```js
    {
      key: 'traps',
      mirrored: false,
      labelX: 110,
      labelY: 76,
      d:
        'M 96 58 C 104 56 116 56 124 58 C 132 66 142 74 148 82 ' +
        'C 134 90 122 96 110 100 C 98 96 86 90 72 82 C 78 74 88 66 96 58 Z',
    },
    {
      key: 'back',
      mirrored: false,
      labelX: 110,
      labelY: 116,
      d:
        'M 78 90 C 92 98 128 98 142 90 C 148 108 144 124 138 134 ' +
        'C 120 138 100 138 82 134 C 76 124 72 108 78 90 Z',
    },
    {
      key: 'lowerBack',
      mirrored: false,
      labelX: 110,
      labelY: 145,
      d:
        'M 84 136 C 100 140 120 140 136 136 C 136 142 135 148 133 152 ' +
        'C 118 156 102 156 87 152 C 85 148 84 142 84 136 Z',
    },
```

- [ ] **Step 3: `public/js/render/recovery.js`** — a lista és a komment:

```js
/** A tizenkét izomcsoport kulcsa és magyar címkéje — a szerver
    MUSCLE_GROUPS-ával azonos sorrendben (server/muscles.js). A check-in
    izomláz- és fájdalom-mezői ebből épülnek. */
const MUSCLE_GROUPS = [
  ['chest', 'Mell'],
  ['shoulders', 'Váll'],
  ['biceps', 'Bicepsz'],
  ['triceps', 'Tricepsz'],
  ['traps', 'Trapéz'],
  ['back', 'Hát'],
  ['lowerBack', 'Alsó hát'],
  ['core', 'Has / core'],
  ['quads', 'Quad'],
  ['hamstrings', 'Hamstring'],
  ['glutes', 'Farizom'],
  ['calves', 'Vádli'],
];
```

- [ ] **Step 4: Futtatás — zöld**

Run: `node --test public/js/ui/bodymap/paths.test.js` → Expected: minden pass
Run: `npm test` → Expected: `# fail 0`
Run: `grep -rnE "\barms\b" server public --include=*.js | grep -v node_modules` → Expected: csak a `LEGACY_SPLIT` / `splitLegacyMuscleMap` (muscles.js, muscles.test.js), a migrációs teszt, a `suggestions.js` `exact: [... 'arms']` címszava és az `exdb.names.hu.js` fordítási sora.

- [ ] **Step 5: Kézi ellenőrzés böngészőben**

Run: `npm run dev`, nyisd meg a `#checkin` varázslót és a `#recovery` oldalt.
Ellenőrizd: a testtérképen elöl a bicepsz, hátul a tricepsz, a trapéz és az alsó hát külön koppintható; a trapéz nem takarja a vállat, az alsó hát nem takarja a farizmot; a Regeneráció oldal izomlistája 12 sort mutat az új címkékkel. Ha egy régió átfed, a koordinátákat igazítsd és írd le a commitban.

- [ ] **Step 6: Commit**

```bash
git add public/js/render/recovery.js public/js/ui/bodymap/paths.js public/js/ui/bodymap/paths.test.js
git commit -m "Testtérkép és izomlista: 12 izomcsoport (bicepsz/tricepsz, trapéz, alsó hát)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Utána

A 2. rész (az oldal új dizájnja) külön tervet kap, ennek a befejezése után:
`docs/superpowers/plans/2026-09-25-regeneracio-oldal.md`.
