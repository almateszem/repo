# Lapozott katalógus — végrehajtási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gyakorlat-választó és az étel-lista ne töltse le és ne rajzolja ki induláskor a teljes katalógust: a szerver keres és 40-es lapokban ad, a kliens végtelen görgetéssel fűzi hozzá.

**Architecture:** Új szerveroldali keresőmodul (`server/catalog-search.js`, gyár-függvény, a memóriabeli kollekciókból szűr — később FTS5-re cserélhető). Új végpontok: `/api/exercises`, `/api/exercise-groups`, `/api/food-groups`, `/api/foods/by-name`; a `/api/foods` lapozott alakra vált, a `/api/exercise-catalog` megszűnik. A kliensen egy közös lapozó (`public/js/core/paged-list.js`) — tiszta állapotgép + vékony DOM-réteg (IntersectionObserver-őrelem, „Újra" sor).

**Tech Stack:** Node 22 (ESM, `node:test`, `node:sqlite`), Express 4, vanilla JS ES-modulok bundler nélkül.

**Spec:** `docs/superpowers/specs/2026-10-10-lapozott-katalogus-design.md`

## Global Constraints

- Lapméret: alapértelmezett `limit` **40**, legfeljebb **100**; nem egész / negatív / 0 / 100 feletti `limit` és nem egész / negatív `offset` → **400**.
- Keresőszöveg (`q`) legfeljebb **100** karakter, csak sztring lehet; ezen kívül → **400**.
- Ismeretlen `group` → **200**, `{ items: [], total: 0, nextOffset: null }`.
- `/api/foods/by-name`: **1–50** név; ezen kívül → **400**; ismeretlen név kimarad.
- Válasz-alak a lapozott végpontokon: `{ items, total, nextOffset }`, ahol `nextOffset` = `offset + items.length`, ha van még elem, különben `null`.
- Keresési szabály = a mai kliensoldali: kisbetűsített részszöveg; gyakorlat: név + felszerelés; étel: név + kategória + márka; üres `q` = minden; sorrend a katalógusé, ételeknél a SAJÁT ételek elöl.
- A gyakorlat kártya-alakjából a `load`, `loadSource`, `extId` mező nem mehet ki.
- Gépelés késleltetése: **250 ms** (`SEARCH_DELAY_MS`); csoport-chip azonnal vált.
- A felület szövegei magyarul; a kód kommentjei a ház stílusában (magyar, a „miért"-et mondják).
- A szerver belső `getCollection('exerciseCatalog')` használata (Recovery Engine, javaslatok, ellenőrzések) nem változik.
- Minden task végén zöld az `npm test`.

## Review Focus

1. **21–50 név a `by-name`-en** — az Express (qs) 20 ismétlődő kulcs felett a `name`-et objektummá alakítja; a felhasználó (edző) 30 tételes étkezése is töltődjön be. → Task 2 teszt: 50 névre 200, mind megjön.
2. **Gyors gépelés / késve érkező régi válasz** — csak az utolsó keresés eredménye látszódjon. → Task 3 teszt (`paged-list`): elavult válasz eldobása, megszakított kérés csendben.
3. **Speciális karakter a keresésben** (`%`, `&`, `+`, ékezet: „fekvenyomás") — ne törje el az URL-t, találjon. → Task 2 teszt: `q=%25&` és ékezetes keresés 200, helyes találat.
4. **Közvetlen nyitás a Táplálkozás oldalon** (újratöltés `#nutrition`-ön) — a lista töltődjön be akkor is, ha a router hatása a setup előtt futott. → Task 6 Step: `currentPage() === 'nutrition'` esetén indítás + Task 7 kézi ellenőrzés.
5. **Rövid első oldal / magas képernyő** — ha az őrelem az első oldal után is látszik, töltsön tovább magától (különben nincs mit görgetni). → Task 3: a DOM-réteg `ready` után újrapróbál, ha az őrelem látható + Task 7 kézi ellenőrzés.

---

## Fájlszerkezet

| Fájl                                            | Felelősség                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/catalog-search.js` (új)                 | Keresés, lapozás, csoportok, név szerinti keresés; paraméter-ellenőrzés. Tiszta gyár: adatforrást kívülről kap.                                                                  |
| `server/catalog-search.test.js` (új)            | A modul egységtesztjei fixture-adatokkal.                                                                                                                                        |
| `server/server.js`                              | Végpontok bekötése; `/api/foods` lapozása; javaslatok kártya-mezői; `/api/exercise-catalog` törlése.                                                                             |
| `server/api.test.js`, `server/timezone.test.js` | Végponti tesztek; a `/api/foods` olvasók átírása `.json.items`-re.                                                                                                               |
| `public/js/core/api.js`                         | `getJson` `signal`-lal; `searchExercises`, `getExerciseGroups`, `searchFoods`, `getFoodGroups`, `getFoodsByName`; a régi `getFoods`/`refreshFoods`/`getExerciseCatalog` törlése. |
| `public/js/core/paged-list.js` (új)             | `createPagedQuery` (DOM-mentes állapotgép), `createPagedList` (DOM-réteg), `debounce`, `SEARCH_DELAY_MS`, `PAGE_SIZE`.                                                           |
| `public/js/core/paged-list.test.js` (új)        | Az állapotgép és a `debounce` tesztjei.                                                                                                                                          |
| `public/js/ui/exercise-picker.js`               | Lapozott katalógus, chipek a szerverről, első megnyitáskor indul.                                                                                                                |
| `public/js/ui/profile.js`                       | Név-kiegészítő gépelés közben a keresőből.                                                                                                                                       |
| `public/js/render/foods.js`                     | `renderFoodItem(food)` — egy sor; a `renderFoods` megszűnik.                                                                                                                     |
| `public/js/ui/nutrition.js`                     | Lapozott étel-lista, név → étel tábla, első megnyitáskor indul.                                                                                                                  |
| `public/js/ui/custom-food.js`                   | Kategóriák a `/api/food-groups`-ból.                                                                                                                                             |
| `public/js/ui/coach-meals.js`                   | Kereső-alapú név-kiegészítő, `by-name` feloldás.                                                                                                                                 |
| `public/js/app/init.js`                         | `renderFoods` kivétele az induló listából.                                                                                                                                       |
| `public/js/nav/router.js`                       | `nutrition()` hatás: `hooks.startFoodList?.()`.                                                                                                                                  |
| `public/js/render/sets.js`                      | Elavult komment javítása (`api.getExerciseCatalog` említése).                                                                                                                    |
| `public/style.css`                              | `.paged-sentinel` stílus.                                                                                                                                                        |

---

### Task 1: Keresőmodul (`server/catalog-search.js`)

**Files:**

- Create: `server/catalog-search.js`
- Test: `server/catalog-search.test.js`
- Modify: `docs/superpowers/specs/2026-10-10-lapozott-katalogus-design.md` (a `q` 100 karakteres korlátjának felvétele)

**Interfaces:**

- Consumes: semmi (tiszta modul).
- Produces:
  - `DEFAULT_LIMIT = 40`, `MAX_LIMIT = 100`, `MAX_QUERY_LENGTH = 100`, `MAX_NAMES = 50`
  - `toExerciseCard(entry) → card` (a `load`, `loadSource`, `extId` nélkül)
  - `parsePageParams(query) → { q: string, group: string|null, offset: number, limit: number } | { error: string }`
  - `parseNames(names: string[]) → { names: string[] } | { error: string }`
  - `createCatalogSearch({ exercises: () => Entry[], seedFoods: () => Food[], foodsFor: (userId) => Food[] }) →`
    - `searchExercises({ q, group, offset, limit }) → { items: Card[], total, nextOffset }`
    - `exerciseGroups() → string[]`
    - `findExercisesByName(names: string[]) → Card[]`
    - `searchFoods(userId, { q, offset, limit }) → { items: Food[], total, nextOffset }`
    - `foodGroups() → string[]`
    - `findFoodsByName(userId, names: string[]) → Food[]`

- [ ] **Step 1: Írd meg a bukó teszteket**

`server/catalog-search.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIMIT,
  createCatalogSearch,
  parseNames,
  parsePageParams,
  toExerciseCard,
} from './catalog-search.js';

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
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `node --test server/catalog-search.test.js`
Expected: FAIL — `Cannot find module '.../server/catalog-search.js'`

- [ ] **Step 3: Írd meg a modult**

`server/catalog-search.js`:

```js
/**
 * FitTrack Pro — katalógus-keresés (gyakorlatok, ételek)
 * -----------------------------------------------------
 * A gyakorlat-választó és az étel-lista korábban a TELJES katalógust töltötte
 * le és rajzolta ki induláskor (1400+ gyakorlat, 400+ étel). Mostantól a
 * szerver keres és lapoz, a kliens mindig csak egy szeletet kap.
 *
 * Minden katalógus-keresés EZEN a modulon megy át, a végpontok csak hívják.
 * Belül egyelőre a memóriában tartott kollekciókból szűr — ennyi elemnél ez
 * gyors. Ha a katalógus nagyságrendekkel nő (pl. vonalkódos termékek a közös
 * listában), csak ennek a modulnak a belseje cserélődik (SQLite FTS5), a
 * végpontok és a kliens nem.
 *
 * Gyár-függvény: az adatforrást kívülről kapja, így adatbázis nélkül
 * tesztelhető (server/catalog-search.test.js).
 */

export const DEFAULT_LIMIT = 40;
export const MAX_LIMIT = 100;
export const MAX_QUERY_LENGTH = 100;
export const MAX_NAMES = 50;

/** A gyakorlat kártya-alakja. A `load` és a `loadSource` a Recovery Engine
    belső adata, az `extId` a külső dataset azonosítója — a felület egyiket
    sem használja, és a válasz negyedét tennék ki. */
export const toExerciseCard = ({ load, loadSource, extId, ...card }) => card;

/** A keresés ugyanaz, mint korábban a kliensen volt: kisbetűsített
    részszöveg a megadott mezők összefűzésén. */
const matches = (parts, needle) =>
  needle === '' || parts.filter(Boolean).join(' ').toLowerCase().includes(needle);

function page(items, offset, limit) {
  const slice = items.slice(offset, offset + limit);
  const end = offset + slice.length;
  return { items: slice, total: items.length, nextOffset: end < items.length ? end : null };
}

const NON_NEGATIVE_INT = /^\d+$/;

/** A lapozott végpontok query-paraméterei. Hibás értékre `{ error }` jön —
    a végpont ezt 400-zal adja vissza. A `q`/`group` tömbként vagy
    objektumként is érkezhet (`q=a&q=b`, `q[x]=1`), ezt is hibának vesszük. */
export function parsePageParams(query) {
  const { q = '', group, offset = '0', limit = String(DEFAULT_LIMIT) } = query;

  if (typeof q !== 'string') return { error: 'A keresés egyetlen szöveg legyen.' };
  if (q.length > MAX_QUERY_LENGTH)
    return { error: `A keresés legfeljebb ${MAX_QUERY_LENGTH} karakter lehet.` };
  if (group !== undefined && typeof group !== 'string')
    return { error: 'A csoport egyetlen szöveg legyen.' };
  if (typeof offset !== 'string' || !NON_NEGATIVE_INT.test(offset))
    return { error: 'Az offset nemnegatív egész szám legyen.' };
  if (typeof limit !== 'string' || !NON_NEGATIVE_INT.test(limit))
    return { error: 'A limit pozitív egész szám legyen.' };

  const limitNumber = Number(limit);
  if (limitNumber < 1 || limitNumber > MAX_LIMIT)
    return { error: `A limit 1 és ${MAX_LIMIT} között lehet.` };

  return { q: q.trim(), group: group || null, offset: Number(offset), limit: limitNumber };
}

/** A név szerinti lekérés nevei. A hívó a nyers URL-ből adja át őket
    (`URLSearchParams.getAll`), mert az Express query-parsere 20 ismétlődő
    kulcs felett tömb helyett objektumot csinál belőlük. */
export function parseNames(names) {
  const cleaned = names.map((name) => name.trim()).filter(Boolean);
  if (cleaned.length === 0) return { error: 'Legalább egy nevet adj meg.' };
  if (cleaned.length > MAX_NAMES)
    return { error: `Egyszerre legfeljebb ${MAX_NAMES} név kérhető.` };
  return { names: cleaned };
}

export function createCatalogSearch({ exercises, seedFoods, foodsFor }) {
  return {
    searchExercises({ q = '', group = null, offset = 0, limit = DEFAULT_LIMIT } = {}) {
      const needle = q.trim().toLowerCase();
      const found = exercises().filter(
        (entry) =>
          (!group || entry.group === group) && matches([entry.name, entry.equipment], needle),
      );
      const result = page(found, offset, limit);
      return { ...result, items: result.items.map(toExerciseCard) };
    },

    exerciseGroups() {
      return [...new Set(exercises().map((entry) => entry.group))].filter(Boolean);
    },

    findExercisesByName(names) {
      const wanted = new Set(names);
      return exercises()
        .filter((entry) => wanted.has(entry.name))
        .map(toExerciseCard);
    },

    /** A saját ételek elöl: a `foodsFor` már így adja (db.js → getFoodsForUser). */
    searchFoods(userId, { q = '', offset = 0, limit = DEFAULT_LIMIT } = {}) {
      const needle = q.trim().toLowerCase();
      const found = foodsFor(userId).filter((food) =>
        matches([food.name, food.group, food.brand], needle),
      );
      return page(found, offset, limit);
    },

    /** A beépített ételek kategóriái. A saját ételek „Saját étel" csoportja
        nem valódi kategória, csak megjelenítési alap — ezért a seedből. */
    foodGroups() {
      return [...new Set(seedFoods().map((food) => food.group))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'hu'));
    },

    findFoodsByName(userId, names) {
      const wanted = new Set(names);
      return foodsFor(userId).filter((food) => wanted.has(food.name));
    },
  };
}
```

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `node --test server/catalog-search.test.js`
Expected: PASS, minden teszt `ok`.

- [ ] **Step 5: A spec kiegészítése a `q` korlátjával**

A `docs/superpowers/specs/2026-10-10-lapozott-katalogus-design.md` „Végpontok" listájában a `limit`-sor után vedd fel:

```markdown
- `q` legfeljebb 100 karakter, csak egyetlen szöveg lehet (`q=a&q=b` vagy
  `q[x]=1` → **400**). Ugyanez a `group`-ra.
```

- [ ] **Step 6: Teljes tesztcsomag + commit**

Run: `npm test`
Expected: minden `pass`, `fail 0`.

```bash
git add server/catalog-search.js server/catalog-search.test.js docs/superpowers/specs/2026-10-10-lapozott-katalogus-design.md
git commit -m "Katalógus-keresés: szerveroldali kereső- és lapozómodul

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Új végpontok (gyakorlatok, csoportok, étel név szerint, javaslatok kártya-mezői)

A `/api/foods` itt MÉG NEM változik (az Task 6) — ez a task csak hozzáad.

**Files:**

- Modify: `server/server.js` (import; a `READ_ENDPOINTS` ciklus után új útvonalak, ~616. sor; `/api/exercise-suggestions` ~1488. sor)
- Test: `server/api.test.js`

**Interfaces:**

- Consumes: Task 1 — `createCatalogSearch`, `parsePageParams`, `parseNames`.
- Produces (HTTP):
  - `GET /api/exercises?q=&group=&offset=&limit=` → `{ items: Card[], total, nextOffset }`
  - `GET /api/exercise-groups` → `string[]`
  - `GET /api/food-groups` → `string[]`
  - `GET /api/foods/by-name?name=…&name=…` → `Food[]`
  - `GET /api/exercise-suggestions` → `suggestions[i]` = kártya mezői + `name` + `reasons`

- [ ] **Step 1: Írd meg a bukó végponti teszteket**

`server/api.test.js` — a 401-es lista (`const endpoints = [...]`, ~112. sor) végére, a `['GET', '/api/exercise-suggestions?title=X'],` sor után:

```js
    ['GET', '/api/exercises'],
    ['GET', '/api/exercise-groups'],
    ['GET', '/api/food-groups'],
    ['GET', '/api/foods/by-name?name=X'],
```

A `test('a gyakorlat-katalógus nem küldi ki a belső mezőket', …)` blokk UTÁN (~1643. sor) szúrd be:

```js
test('a gyakorlat-keresés lapoz: 40-es alapoldal, nextOffset, total', async () => {
  const elso = (await request('GET', '/api/exercises', { cookie: annaCookie })).json;
  assert.equal(elso.items.length, 40);
  assert.ok(elso.total > 40, 'a seed-katalógus 40-nél több gyakorlat');
  assert.equal(elso.nextOffset, 40);

  const masodik = (
    await request('GET', `/api/exercises?offset=${elso.nextOffset}`, { cookie: annaCookie })
  ).json;
  assert.notEqual(masodik.items[0].name, elso.items[0].name, 'a második lap máshol kezdődik');

  const utolso = (
    await request('GET', `/api/exercises?offset=${elso.total - 5}`, { cookie: annaCookie })
  ).json;
  assert.equal(utolso.items.length, 5);
  assert.equal(utolso.nextOffset, null, 'az utolsó lap után nincs több');
});

test('a gyakorlat-keresés sem küldi ki a belső mezőket', async () => {
  const { items } = (await request('GET', '/api/exercises?limit=100', { cookie: annaCookie })).json;
  for (const elem of items) {
    assert.ok(!('load' in elem));
    assert.ok(!('loadSource' in elem));
    assert.ok(!('extId' in elem));
  }
});

test('a gyakorlat-keresés szűr névre (ékezettel) és csoportra', async () => {
  const q = encodeURIComponent('FEKVENYOMÁS');
  const talalat = (await request('GET', `/api/exercises?q=${q}&limit=100`, { cookie: annaCookie }))
    .json;
  assert.ok(talalat.total > 0, 'van fekvenyomás a katalógusban');
  for (const elem of talalat.items) {
    assert.ok(
      `${elem.name} ${elem.equipment ?? ''}`.toLowerCase().includes('fekvenyomás'),
      elem.name,
    );
  }

  const csoportok = (await request('GET', '/api/exercise-groups', { cookie: annaCookie })).json;
  assert.ok(csoportok.includes('Mell'));

  const mell = (await request('GET', '/api/exercises?group=Mell&limit=100', { cookie: annaCookie }))
    .json;
  assert.ok(mell.total > 0);
  assert.ok(mell.items.every((elem) => elem.group === 'Mell'));

  const ismeretlen = await request('GET', '/api/exercises?group=Nincs', { cookie: annaCookie });
  assert.equal(ismeretlen.status, 200, 'az ismeretlen csoport üres keresés, nem hiba');
  assert.deepEqual(ismeretlen.json, { items: [], total: 0, nextOffset: null });
});

test('a keresőszöveg speciális karakterei nem törik el a kérést', async () => {
  for (const q of ['%', '&', '+', '100%&x=1']) {
    const res = await request('GET', `/api/exercises?q=${encodeURIComponent(q)}`, {
      cookie: annaCookie,
    });
    assert.equal(res.status, 200, q);
    assert.ok(Array.isArray(res.json.items), q);
  }
});

test('hibás lapozási paraméterre 400 jön', async () => {
  const rossz = [
    'offset=-1',
    'offset=abc',
    'limit=0',
    'limit=101',
    'limit=1.5',
    'q=a&q=b',
    'q[x]=1',
    `q=${'a'.repeat(101)}`,
  ];
  for (const query of rossz) {
    const res = await request('GET', `/api/exercises?${query}`, { cookie: annaCookie });
    assert.equal(res.status, 400, query);
    assert.ok(res.json.error, `${query}: a hibának magyar üzenete van`);
  }
});

test('a javaslatok a kártya mezőit is hozzák', async () => {
  const res = (await request('GET', '/api/exercise-suggestions?title=Mell', { cookie: annaCookie }))
    .json;
  assert.ok(res.suggestions.length > 0, 'a „Mell" cím javaslatot ad');
  for (const javaslat of res.suggestions) {
    assert.ok(javaslat.name);
    assert.ok(Array.isArray(javaslat.reasons));
    assert.ok(
      javaslat.tag && javaslat.muscles && javaslat.group && javaslat.logMode,
      javaslat.name,
    );
    assert.ok(!('load' in javaslat), 'a belső mező itt sem megy ki');
  }
});

test('az étel-kategóriák ábécérendben jönnek, a „Saját étel" nélkül', async () => {
  const csoportok = (await request('GET', '/api/food-groups', { cookie: annaCookie })).json;
  assert.ok(csoportok.length > 0);
  assert.ok(!csoportok.includes('Saját étel'));
  assert.deepEqual(
    csoportok,
    [...csoportok].sort((a, b) => a.localeCompare(b, 'hu')),
  );
});

test('étel név szerint: a megtaláltak jönnek, az ismeretlen kimarad', async () => {
  const etel = seedFood((await request('GET', '/api/foods', { cookie: annaCookie })).json).name;
  const res = await request(
    'GET',
    `/api/foods/by-name?name=${encodeURIComponent(etel)}&name=Nincs%20ilyen`,
    { cookie: annaCookie },
  );
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(
    res.json.map((food) => food.name),
    [etel],
  );
});

test('étel név szerint: 50 név még elfogadott, 51 vagy 0 már nem', async () => {
  /* Az Express query-parsere 20 ismétlődő kulcs felett objektummá alakítja a
     `name`-et — a végpontnak ettől még tömbként kell kezelnie (egy 30 tételes
     edzői étkezés betöltése nem bukhat el ezen). */
  const etel = seedFood((await request('GET', '/api/foods', { cookie: annaCookie })).json).name;
  const otven = [etel, ...Array.from({ length: 49 }, (_, i) => `ismeretlen-${i}`)];
  const ok = await request(
    'GET',
    `/api/foods/by-name?${otven.map((n) => `name=${encodeURIComponent(n)}`).join('&')}`,
    { cookie: annaCookie },
  );
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(
    ok.json.map((food) => food.name),
    [etel],
  );

  const sok = Array.from({ length: 51 }, (_, i) => `name=n${i}`).join('&');
  assert.equal(
    (await request('GET', `/api/foods/by-name?${sok}`, { cookie: annaCookie })).status,
    400,
  );
  assert.equal((await request('GET', '/api/foods/by-name', { cookie: annaCookie })).status, 400);
  assert.equal(
    (await request('GET', '/api/foods/by-name?name=%20', { cookie: annaCookie })).status,
    400,
  );
});
```

A saját ételes blokkban, a `test('ugyanaz a név két fióknak felvihető', …)` UTÁN (~1971. sor):

```js
test('étel név szerint: a saját ételt a saját értékeivel kapja mindkét fiók', async () => {
  const anna = (
    await request('GET', `/api/foods/by-name?name=${encodeURIComponent('Anna csirkéje')}`, {
      cookie: annaCookie,
    })
  ).json;
  const bela = (
    await request('GET', `/api/foods/by-name?name=${encodeURIComponent('Anna csirkéje')}`, {
      cookie: belaCookie,
    })
  ).json;
  assert.equal(anna.length, 1);
  assert.equal(anna[0].kcal, 108, 'Anna a saját értékeit kapja');
  assert.equal(bela.length, 1);
  assert.equal(bela[0].kcal, 165, 'Béla a sajátját — nem Annáét');
});
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `node --test server/api.test.js`
Expected: FAIL — az új útvonalak még 404-et adnak, pl. `a gyakorlat-keresés lapoz` → `Cannot read properties of undefined (reading 'length')`. (A 401-es teszt már most is átmegy az új útvonalakon: a belépés-védelem minden `/api` útvonal előtt áll.)

- [ ] **Step 3: Kösd be a végpontokat**

`server/server.js` — az importok közé (a többi `./…js` import mellé):

```js
import { createCatalogSearch, parseNames, parsePageParams } from './catalog-search.js';
```

A `for (const [route, key] of Object.entries(READ_ENDPOINTS)) { … }` ciklus UTÁN:

```js
/* ---- Katalógus-keresés ----
   A gyakorlat-választó és az étel-lista szeletenként kéri a katalógust: a
   szerver keres és lapoz (server/catalog-search.js), a kliens sosem kapja meg
   a teljes listát. */
const catalogSearch = createCatalogSearch({
  exercises: () => getCollection('exerciseCatalog') || [],
  seedFoods: () => getCollection('foods') || [],
  foodsFor: (userId) => getFoodsForUser(userId),
});

app.get('/api/exercises', (req, res) => {
  const params = parsePageParams(req.query);
  if (params.error) return res.status(400).json({ error: params.error });
  res.json(catalogSearch.searchExercises(params));
});

app.get('/api/exercise-groups', (req, res) => res.json(catalogSearch.exerciseGroups()));

app.get('/api/food-groups', (req, res) => res.json(catalogSearch.foodGroups()));

/* Az edzői étrend-szerkesztő ezzel oldja fel a már bent lévő tételek
   tápértékét. A neveket a nyers URL-ből olvassuk: az Express query-parsere
   20 ismétlődő `name` felett tömb helyett objektumot ad. */
app.get('/api/foods/by-name', (req, res) => {
  const raw = new URLSearchParams(req.originalUrl.split('?')[1] ?? '').getAll('name');
  const parsed = parseNames(raw);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  res.json(catalogSearch.findFoodsByName(req.user.id, parsed.names));
});
```

Az `/api/exercise-suggestions` kezelőjében a `res.json(suggestExercises({…}))` helyett:

```js
const result = suggestExercises({
  title,
  report,
  catalog: getCollection('exerciseCatalog') || [],
  workouts,
});
/* A javaslat a kártya mezőit is hozza: a választó már nem tartja a teljes
     katalógust, amiben név szerint kikereshetné őket. */
const cards = new Map(
  catalogSearch
    .findExercisesByName(result.suggestions.map((suggestion) => suggestion.name))
    .map((card) => [card.name, card]),
);
res.json({
  ...result,
  suggestions: result.suggestions
    .filter((suggestion) => cards.has(suggestion.name))
    .map((suggestion) => ({ ...cards.get(suggestion.name), ...suggestion })),
});
```

Ellenőrizd, hogy az `/api/exercise-suggestions` útvonal a `catalogSearch` deklarációja UTÁN áll (a ~1488. sor a ~616. utáni, tehát igen); ha nem, a `const` TDZ-hibát dob induláskor.

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `node --test server/api.test.js`
Expected: PASS.

- [ ] **Step 5: Teljes tesztcsomag + commit**

Run: `npm test`
Expected: `fail 0`.

```bash
git add server/server.js server/api.test.js
git commit -m "Katalógus-keresés: gyakorlat-, csoport- és név szerinti végpontok

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Közös lapozó (`public/js/core/paged-list.js`) és az api-kliens

**Files:**

- Create: `public/js/core/paged-list.js`
- Test: `public/js/core/paged-list.test.js`
- Modify: `public/js/core/api.js` (`getJson` ~43. sor; új metódusok a `getExerciseCatalog` sor mellett ~209. sor)
- Modify: `public/style.css` (a `.ep-empty` szabály után, ~6176. sor)

**Interfaces:**

- Consumes: Task 2 végpontjai.
- Produces:
  - `PAGE_SIZE = 40`, `SEARCH_DELAY_MS = 250`
  - `debounce(fn, ms) → wrapped` (`wrapped(...args)`, `wrapped.cancel()`)
  - `createPagedQuery({ fetchPage, onItems, onState }) → { setQuery(query) → Promise, loadMore() → Promise, retry() → Promise, status, hasMore }`
    - `fetchPage({ ...query, offset, limit, signal }) → Promise<{ items, total, nextOffset }>`
    - `onItems(items, { append: boolean })`
    - `onState({ status: 'loading'|'ready'|'error', total, firstPage?: boolean, error? })`
  - `createPagedList({ list, fetchPage, renderItem, onPage?, onState? }) → { setQuery(query) → Promise, retry() → Promise }`
    - `renderItem(item) → Element`, `onPage(items, nodes, { append })`
  - api: `searchExercises({ q, group, offset, limit, signal })`, `getExerciseGroups()`, `searchFoods({ q, offset, limit, signal })`, `getFoodGroups()`, `getFoodsByName(names)`

- [ ] **Step 1: Írd meg a bukó teszteket**

`public/js/core/paged-list.test.js` (csak a DOM-mentes részt teszteli; a modul felső szintje nem nyúlhat `window`/`document`-hez):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SIZE, createPagedQuery, debounce } from './paged-list.js';

/** Kívülről feloldható ígéret — a kérések sorrendjét a teszt dönti el. */
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Kamu fetchPage: minden hívást feljegyez, a választ a teszt adja meg. */
function fakeFetch() {
  const calls = [];
  const fetchPage = (params) => {
    const call = { params, ...deferred() };
    calls.push(call);
    return call.promise;
  };
  return { calls, fetchPage };
}

function setup() {
  const { calls, fetchPage } = fakeFetch();
  const items = [];
  const states = [];
  const paged = createPagedQuery({
    fetchPage,
    onItems: (page, { append }) => {
      if (!append) items.length = 0;
      items.push(...page);
    },
    onState: (state) => states.push(state),
  });
  return { calls, items, states, paged };
}

const pageOf = (names, total, nextOffset) => ({ items: names, total, nextOffset });

test('setQuery az első lapot kéri, 0-s offsettel és a lapmérettel', async () => {
  const { calls, items, states, paged } = setup();
  const done = paged.setQuery({ q: 'gugg' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.q, 'gugg');
  assert.equal(calls[0].params.offset, 0);
  assert.equal(calls[0].params.limit, PAGE_SIZE);
  assert.ok(calls[0].params.signal, 'megszakítható');
  assert.equal(states.at(-1).status, 'loading');

  calls[0].resolve(pageOf(['a', 'b'], 2, null));
  await done;
  assert.deepEqual(items, ['a', 'b']);
  assert.deepEqual(states.at(-1), { status: 'ready', total: 2 });
  assert.equal(paged.hasMore, false);
});

test('loadMore a következő lapot fűzi hozzá, null után megáll', async () => {
  const { calls, items, paged } = setup();
  const first = paged.setQuery({ q: '' });
  calls[0].resolve(pageOf(['a', 'b'], 3, 2));
  await first;

  const more = paged.loadMore();
  assert.equal(calls[1].params.offset, 2);
  calls[1].resolve(pageOf(['c'], 3, null));
  await more;
  assert.deepEqual(items, ['a', 'b', 'c']);

  await paged.loadMore();
  assert.equal(calls.length, 2, 'nincs több lap — nem kér újra');
});

test('egyszerre csak egy kérés fut: töltés közben a loadMore nem kér', async () => {
  const { calls, paged } = setup();
  paged.setQuery({ q: '' });
  await paged.loadMore();
  assert.equal(calls.length, 1);
});

test('setQuery előtt a loadMore nem kér semmit', async () => {
  const { calls, paged } = setup();
  await paged.loadMore();
  assert.equal(calls.length, 0);
});

test('a későn érkező régi válasz nem kerül a listára', async () => {
  const { calls, items, states, paged } = setup();
  const old = paged.setQuery({ q: 'g' });
  const fresh = paged.setQuery({ q: 'gugg' });
  assert.equal(calls[0].params.signal.aborted, true, 'a régi kérés megszakadt');

  calls[1].resolve(pageOf(['Guggolás'], 1, null));
  await fresh;
  calls[0].resolve(pageOf(['Gyors', 'Guggolás'], 2, null));
  await old;

  assert.deepEqual(items, ['Guggolás']);
  assert.deepEqual(states.at(-1), { status: 'ready', total: 1 });
});

test('megszakított kérés hibája csendben elmarad', async () => {
  const { calls, states, paged } = setup();
  const old = paged.setQuery({ q: 'g' });
  paged.setQuery({ q: 'gu' });
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  calls[0].reject(abort);
  await old;
  assert.ok(!states.some((state) => state.status === 'error'));
});

test('hiba után a loadMore nem ismétel magától, a retry ugyanazt a lapot kéri', async () => {
  const { calls, items, states, paged } = setup();
  const first = paged.setQuery({ q: '' });
  calls[0].resolve(pageOf(['a'], 2, 1));
  await first;

  const failing = paged.loadMore();
  calls[1].reject(new Error('hálózat'));
  await failing;
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).firstPage, false);

  await paged.loadMore();
  assert.equal(calls.length, 2, 'hibás állapotban nem ismétel magától');

  const again = paged.retry();
  assert.equal(calls[2].params.offset, 1, 'ugyanazt a lapot kéri újra');
  calls[2].resolve(pageOf(['b'], 2, null));
  await again;
  assert.deepEqual(items, ['a', 'b']);
  assert.equal(states.at(-1).status, 'ready');
});

test('az első lap hibája firstPage-ként jelez', async () => {
  const { calls, states, paged } = setup();
  const first = paged.setQuery({ q: '' });
  calls[0].reject(new Error('hálózat'));
  await first;
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).firstPage, true);
});

test('debounce: csak az utolsó hívás fut le, a késleltetés után', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const fn = debounce((value) => calls.push(value), 250);
  fn('a');
  fn('b');
  t.mock.timers.tick(249);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, ['b']);
});

test('debounce: a cancel elejti a függő hívást', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const fn = debounce((value) => calls.push(value), 250);
  fn('a');
  fn.cancel();
  t.mock.timers.tick(500);
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `node --test public/js/core/paged-list.test.js`
Expected: FAIL — `Cannot find module '.../public/js/core/paged-list.js'`

- [ ] **Step 3: Írd meg a lapozót**

`public/js/core/paged-list.js`:

```js
/** Lapozott, szerveroldalon keresett lista — a gyakorlat-választó és az
    étel-lista közös motorja.

    Két réteg:
      · createPagedQuery — DOM-mentes állapotgép (melyik lap jön, melyik
        válasz érvényes). Node-ban tesztelt (paged-list.test.js), ezért a modul
        felső szintje nem nyúlhat a `window`-hoz/`document`-hez.
      · createPagedList — a DOM-réteg: kirajzolja a lapokat, a lista végén egy
        őrelemet figyel (IntersectionObserver), és ott mutatja a „Betöltés…" /
        „Újra" állapotot. */

const PAGE_SIZE = 40;

/** A gépelés késleltetése: ennyi szünet után megy ki a keresés, nem minden
    leütésre. */
const SEARCH_DELAY_MS = 250;

/** Az őrelem ennyivel a látótér alja ELŐTT jelez — a következő lap már
    töltődik, mire a felhasználó odaér. */
const PREFETCH_MARGIN = '400px 0px';

function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

function createPagedQuery({ fetchPage, onItems, onState }) {
  let query = null;
  let nextOffset = 0;
  let total = 0;
  let status = 'idle';
  /* Minden setQuery új „nemzedéket" indít. A régi nemzedék válasza akkor sem
     kerülhet a listára, ha a fetch nem vette figyelembe a megszakítást. */
  let generation = 0;
  let controller = null;

  async function load() {
    const gen = generation;
    const offset = nextOffset;
    controller = new AbortController();
    status = 'loading';
    onState({ status, total });

    let page;
    try {
      page = await fetchPage({ ...query, offset, limit: PAGE_SIZE, signal: controller.signal });
    } catch (error) {
      // A felhasználó továbbgépelt: ez nem hiba, csak elavult kérés.
      if (gen !== generation || error?.name === 'AbortError') return;
      status = 'error';
      onState({ status, total, firstPage: offset === 0, error });
      return;
    }
    if (gen !== generation) return;

    onItems(page.items, { append: offset > 0 });
    total = page.total;
    nextOffset = page.nextOffset;
    status = 'ready';
    onState({ status, total });
  }

  return {
    /** Új keresés: a futó kérés megszakad, a lista elölről indul. */
    setQuery(next) {
      generation += 1;
      controller?.abort();
      query = { ...next };
      nextOffset = 0;
      total = 0;
      return load();
    },
    /** A következő lap, ha van — töltés közben és hiba után nem kér. */
    loadMore() {
      if (status !== 'ready' || nextOffset === null) return Promise.resolve();
      return load();
    },
    /** Hiba után ugyanazt a lapot kéri újra. */
    retry() {
      if (status !== 'error') return Promise.resolve();
      return load();
    },
    get status() {
      return status;
    },
    get hasMore() {
      return nextOffset !== null;
    },
  };
}

function createPagedList({ list, fetchPage, renderItem, onPage = () => {}, onState = () => {} }) {
  /* Az őrelem a lista UTÁN áll, nem benne: a lista lehet <ul> is, és a
     „Betöltés…" / „Újra" sor nem lista-elem. */
  const sentinel = document.createElement('div');
  sentinel.className = 'paged-sentinel';
  sentinel.setAttribute('aria-live', 'polite');
  list.after(sentinel);
  let sentinelVisible = false;

  const renderSentinel = ({ status }) => {
    if (status === 'loading') {
      sentinel.textContent = 'Betöltés…';
      return;
    }
    if (status === 'error') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'paged-retry tap-target';
      retryBtn.textContent = 'Újra';
      retryBtn.addEventListener('click', () => paged.retry());
      sentinel.replaceChildren('Nem sikerült betölteni — ', retryBtn);
      return;
    }
    sentinel.replaceChildren();
  };

  const paged = createPagedQuery({
    fetchPage,
    onItems(items, { append }) {
      const nodes = items.map(renderItem);
      if (append) list.append(...nodes);
      else list.replaceChildren(...nodes);
      onPage(items, nodes, { append });
    },
    onState(state) {
      renderSentinel(state);
      // Ha már az első lap sem jött le, a hibasor álljon a lista helyén
      if (state.status === 'error' && state.firstPage) list.replaceChildren();
      onState(state);
      /* Rövid lap vagy magas képernyő: az őrelem a betöltés után is látszik,
         és az IntersectionObserver nem jelez újra (nem változott semmi) —
         ilyenkor magunk kérjük a következőt. */
      if (state.status === 'ready' && sentinelVisible) paged.loadMore();
    },
  });

  /* Rejtett oldalon (display: none) az őrelem nem metszi a látóteret, tehát
     háttérben nem töltünk; az oldal megjelenésekor a megfigyelő újra jelez. */
  new IntersectionObserver(
    ([entry]) => {
      sentinelVisible = entry.isIntersecting;
      if (sentinelVisible) paged.loadMore();
    },
    { rootMargin: PREFETCH_MARGIN },
  ).observe(sentinel);

  return {
    setQuery: (query) => paged.setQuery(query),
    retry: () => paged.retry(),
  };
}

export { PAGE_SIZE, SEARCH_DELAY_MS, createPagedList, createPagedQuery, debounce };
```

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `node --test public/js/core/paged-list.test.js`
Expected: PASS.

- [ ] **Step 5: Az api-kliens bővítése**

`public/js/core/api.js` — a `getJson` megszakíthatóvá válik (a többi hívó nem ad át semmit, nekik nem változik):

```js
/** GET egy JSON-végpontra, egységes hibakezeléssel. A `signal`-lal a hívó
    megszakíthatja (a lapozott lista az elavult keresést). */
async function getJson(path, { signal } = {}) {
  const res = await fetch(path, { headers: requestHeaders(), signal });
  if (res.status === 401) throw handleUnauthorized();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}
```

A `getJsonCached` elé:

```js
/** Query-sztring a megadott, nem üres paraméterekből. */
function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}
```

Az `api` objektumban, a `getExerciseCatalog` sor alá (a `getExerciseCatalog` itt még marad — Task 5 törli):

```js
  /* ---- Katalógus-keresés ----
     A szerver keres és lapoz (server/catalog-search.js); a válasz
     `{ items, total, nextOffset }`. Nem cache-elt: minden keresés más szelet. */
  searchExercises: ({ q, group, offset, limit, signal } = {}) =>
    getJson(`/api/exercises?${queryString({ q, group, offset, limit })}`, { signal }),
  // A csoport-chipek — referencia-adat, egyszer töltjük le
  getExerciseGroups: () => getJsonCached('/api/exercise-groups'),
  searchFoods: ({ q, offset, limit, signal } = {}) =>
    getJson(`/api/foods?${queryString({ q, offset, limit })}`, { signal }),
  // A beépített étel-kategóriák (a saját étel modál legördülője)
  getFoodGroups: () => getJsonCached('/api/food-groups'),
  // Ételek pontos név szerint — az edzői étrend már bent lévő tételeihez
  getFoodsByName: (names) => {
    const search = new URLSearchParams();
    names.forEach((name) => search.append('name', name));
    return getJson(`/api/foods/by-name?${search}`);
  },
```

- [ ] **Step 6: Az őrelem stílusa**

`public/style.css` — a `.ep-empty { … }` szabály után:

```css
/* A lapozott lista vége (js/core/paged-list.js): töltés közben „Betöltés…",
   hibánál „Újra" gomb. Üresen is kell 1px magasság, különben az
   IntersectionObserver nem látná. */
.paged-sentinel {
  min-height: 1px;
  color: var(--text-muted);
  font-size: var(--fs-base);
  text-align: center;
}

.paged-sentinel:not(:empty) {
  padding: var(--sp-5) 0;
}

.paged-retry {
  margin-left: var(--sp-3);
  text-decoration: underline;
}
```

- [ ] **Step 7: Teljes tesztcsomag + lint + commit**

Run: `npm test && npx eslint public/js/core/paged-list.js public/js/core/api.js`
Expected: `fail 0`, lint hiba nélkül.

```bash
git add public/js/core/paged-list.js public/js/core/paged-list.test.js public/js/core/api.js public/style.css
git commit -m "Lapozott lista: közös lapozó és a katalógus-keresés api-hívásai

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Gyakorlat-választó lapozott katalógussal

**Files:**

- Modify: `public/js/ui/exercise-picker.js` (teljes csere, lent)

**Interfaces:**

- Consumes: Task 3 — `createPagedList`, `debounce`, `SEARCH_DELAY_MS`; `api.searchExercises`, `api.getExerciseGroups`; Task 2 — a javaslatok kártya-mezői.
- Produces: változatlan kifelé — `setupExercisePicker(confirmAction) → { use }`, `hooks.useExercisePicker`, `hooks.refreshExercisePicker`.

- [ ] **Step 1: Cseréld le a fájlt**

`public/js/ui/exercise-picker.js` új tartalma (a hozzáadás/eltávolítás kezelője szóról szóra a régi):

```js
/** Gyakorlat-választó: szerveroldali keresés, lapozott katalógus, szűrők. */

import { api } from '../core/api.js';
import { $, $$, cloneTemplate } from '../core/dom.js';
import { hooks } from '../core/page-hooks.js';
import { SEARCH_DELAY_MS, createPagedList, debounce } from '../core/paged-list.js';
import { showToast } from '../core/toast.js';
import { navigate } from '../nav/router.js';
import { defaultSetFor, renderExercise } from '../render/sets.js';
import { setupThumb } from './workout.js';

/** A gyakorlat-választó flow-oldal: a katalógus a szerverről jön, lapozva
    (server/catalog-search.js), kereső + izomcsoport chipek, a → gomb a
    cél-listához adja a gyakorlatot (alap szettekkel), a ✓ eltávolítja onnan.
    A cél (a terv-építő VAGY az edzésnapló listája) egy use(context)-tel
    váltható vezérlőn át áll be — a hívó (setupPlanBuilder / setupWorkout)
    adja meg, mielőtt idenavigál. */
async function setupExercisePicker(confirmAction) {
  const [defaultSet, defaultCardioSet] = await Promise.all([
    api.getDefaultSet(),
    api.getDefaultCardioSet(),
  ]);
  const pickerPage = $('[data-page="exercise-picker"]');
  const list = $('[data-list="picker-catalog"]');
  const chipWrap = $('[data-list="picker-chips"]');
  const searchInput = $('#exercise-search');
  const countEl = $('[data-picker-count]');
  const emptyState = $('.ep-empty', pickerPage);
  const backBtn = $('[data-action="picker-back"]');
  const nounEl = $('[data-picker-noun]');
  const suggestBlock = $('[data-picker-suggest]');
  const suggestList = $('[data-list="picker-suggestions"]');
  const suggestNote = $('[data-picker-suggest-note]');

  /** Az aktuális cél: { targetList, nameInput, backPage, backLabel,
      subtitleNoun, toastTarget, exerciseOptions, onChange, suggestReadiness }.
      A `suggestReadiness` az ajánlásba a mai regeneráltságot is bekéri — az
      edzésnapló igen, a terv-építő nem (egy jövőbeli tervről a mai készenlét
      semmit nem mond).

      Van egy MÁSIK cél-fajta is: az `onPick`-es. Az edzésnapló és a terv-építő
      LISTÁT tölt (a választó kártyát ad hozzá és elvesz), a profil rekord-
      csempéi viszont csak a KIVÁLASZTOTT NEVET kérik. Ha a cél `onPick`-et ad,
      a választó azt hívja, és semmit nem ad hozzá semmihez; ilyenkor a
      `targetList` és a `nameInput` el is hagyható. */
  let context = null;

  /** Egy katalógus-sor kártyája — a lapozott lista és a „Javasolt" blokk is
      ebből épül, így a két helyen ugyanúgy néz ki és ugyanúgy kattintható. */
  const buildItem = (entry) => {
    const item = cloneTemplate('tpl-picker-item');
    item.dataset.name = entry.name;
    item.dataset.group = entry.group;
    /* A NAPLÓZÁSI MÓD a katalógus-sorból jön, nem abból, melyik chip volt
       kiválasztva: a chip nem tárolódik sehol, és a kereséssel meg is
       kerülhető. A mezőt a szerver égeti rá minden sorra (data/catalog.js). */
    if (entry.logMode === 'duration') item.dataset.logMode = 'duration';
    $('.ep-item-name', item).textContent = entry.name;
    $('.ep-item-tag', item).textContent = entry.tag;
    $('.ep-item-muscles', item).textContent = entry.muscles;
    setupThumb($('.ep-item-thumb', item), entry);
    return item;
  };

  /** A célban MÁR szereplő gyakorlat-nevek — ehhez igazodik a ✓/→ állapot.
      Lista-célnál a cél-lista kártyáiból olvassuk ki, név-célnál (onPick) a
      cél mondja meg (`pickedNames`). A kettő ugyanazt jelenti a felhasználó
      felé: pipa = már nálam van, újabb kattintás leveszi. */
  const namesInTarget = () =>
    context.pickedNames
      ? new Set(context.pickedNames())
      : new Set($$('.wk-exercise-name', context.targetList).map((el) => el.textContent.trim()));

  /** Egy kártya ✓/→ gombjának állapota: benne van-e már a cél-listában. */
  const syncToggle = (item, added) => {
    const inTarget = added.has(item.dataset.name);
    const toggle = $('.ep-item-toggle', item);
    toggle.setAttribute('aria-pressed', String(inTarget));
    toggle.textContent = inTarget ? '✓' : '→';
    toggle.setAttribute(
      'aria-label',
      inTarget
        ? `${item.dataset.name} eltávolítása`
        : `${item.dataset.name} hozzáadása ${context.toastTarget}`,
    );
  };

  /* ---- A katalógus: szerveroldali keresés, 40-es lapok ----
     A DOM-ban mindig csak a betöltött lapok kártyái vannak, nem a teljes,
     1400+ elemű katalógus. Az első lapot az első megnyitás kéri, nem az app
     indulása. A kártyák kirajzolását a CSS `content-visibility: auto` továbbra
     is a láthatóságig halasztja (lásd .ep-item a style.css-ben). */
  let activeGroup = null; // null = „Mind"
  let catalogStarted = false;

  const paged = createPagedList({
    list,
    fetchPage: (params) => api.searchExercises(params),
    renderItem: buildItem,
    // Az új lap kártyái a beszúráskor kapják meg a ✓/→ állapotot
    onPage: (_items, nodes) => {
      if (!context) return;
      const added = namesInTarget();
      nodes.forEach((item) => syncToggle(item, added));
    },
    onState: ({ status, total }) => {
      if (status === 'ready') {
        countEl.textContent = total;
        emptyState.hidden = total > 0;
      }
      // Hibánál az „Újra" sor beszél — a „Nincs találat" félrevezetne
      if (status === 'error') emptyState.hidden = true;
    },
  });

  const runQuery = () => {
    runQueryDebounced.cancel();
    return paged.setQuery({ q: searchInput.value.trim(), group: activeGroup });
  };
  const runQueryDebounced = debounce(runQuery, SEARCH_DELAY_MS);

  /** Szűrő-chipek a szerver csoportjaiból (+ Mind). */
  const buildChips = (groups) => {
    chipWrap.replaceChildren(
      ...[null, ...groups].map((group) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ep-chip';
        chip.textContent = group ?? 'Mind';
        chip.setAttribute('aria-pressed', String(group === activeGroup));
        chip.addEventListener('click', () => {
          activeGroup = group;
          $$('.ep-chip', chipWrap).forEach((c) =>
            c.setAttribute('aria-pressed', String(c === chip)),
          );
          refresh();
          runQuery();
        });
        return chip;
      }),
    );
  };

  /** Az első megnyitás: első lap + chipek. Egyszer fut. A chipek hibája nem
      állítja meg a listát — szűrő nélkül is teljes értékű a választó. */
  const startCatalog = () => {
    if (catalogStarted) return;
    catalogStarted = true;
    runQuery();
    api
      .getExerciseGroups()
      .then(buildChips, (err) => console.error('A gyakorlat-csoportok nem töltődtek be:', err));
  };

  /** A fejléc és a gombállapotok szinkronja a cél állapotával. Szűrni már
      nem szűr — azt a szerver teszi. Csak a ✓/→ gombállapot múlik a célon,
      mert csak annak van mihez igazodnia. */
  const refresh = () => {
    /* Név-mező nélküli célnál (onPick) a felirat ÜRES, nem „Névtelen": ott
       nincs edzés vagy terv, aminek neve lehetne — a „Névtelen" egy nem
       létező célt nevezne meg. Ilyenkor a fejléc csak a főnevet mutatja. */
    if (context)
      $('[data-picker-workout]').textContent = context.nameInput
        ? context.nameInput.value.trim() || 'Névtelen'
        : '';
    const query = searchInput.value.trim();
    const added = context ? namesInTarget() : null;
    if (context) $$('.ep-item', list).forEach((item) => syncToggle(item, added));

    // A „Javasolt" blokk csak szűretlen listán látszik: keresés vagy chip
    // mellett a felhasználó már maga választ, és a blokk csak útban volna.
    const suggestItems = $$('.ep-item', suggestList);
    suggestBlock.hidden =
      !context || suggestItems.length === 0 || query !== '' || activeGroup !== null;
    if (context) suggestItems.forEach((item) => syncToggle(item, added));
  };

  /* Ajánlások betöltése a cél nevéhez. A kérés lassabb lehet, mint egy
     célváltás (a felhasználó visszalép és másik oldalról jön vissza), ezért
     csak a LEGUTÓBBI kérés válasza rajzolódik ki. Hiba esetén a blokk rejtve
     marad — a választó nélküle is teljes értékű. A javaslat a kártya mezőit
     is hozza (a szerver tölti ki), tehát közvetlenül kártya rajzolható belőle. */
  let suggestRequest = 0;
  const loadSuggestions = async () => {
    const requestId = ++suggestRequest;
    suggestList.replaceChildren();
    refresh();
    const title = context.nameInput?.value.trim() ?? '';
    let result;
    try {
      result = await api.getExerciseSuggestions(title, {
        withReadiness: Boolean(context.suggestReadiness),
      });
    } catch (err) {
      console.error('Ajánlott gyakorlatok betöltési hiba:', err);
      return;
    }
    if (requestId !== suggestRequest) return;

    const items = result.suggestions.map((suggestion) => {
      const item = buildItem(suggestion);
      // A javasolt sor mindig látszik: a content-visibility becslése itt
      // nem spórol semmit, csak a blokk magasságát rontaná el.
      item.classList.add('ep-item--suggested');
      const reasons = $('.ep-item-reasons', item);
      suggestion.reasons.forEach((reason) => {
        const span = document.createElement('span');
        span.className = `ep-reason ep-reason--${reason.kind}`;
        span.textContent = reason.text;
        reasons.appendChild(span);
      });
      reasons.hidden = suggestion.reasons.length === 0;
      return item;
    });
    suggestList.replaceChildren(...items);

    /* Ha a cím nem mondott semmit, ezt ki is mondjuk — különben a felhasználó
       nem érti, miért nem a „Hétfő" nevű edzéséhez illő gyakorlatokat látja. */
    const fromReadinessOnly = title !== '' && result.titleLabels.length === 0 && items.length > 0;
    suggestNote.textContent = fromReadinessOnly
      ? 'A címből nem derül ki izomcsoport — a mai regeneráltság alapján.'
      : '';
    suggestNote.hidden = !fromReadinessOnly;
    refresh();
  };

  // A „Javasolt" blokk azonnal eltűnik/visszajön, a keresés késleltetve megy ki
  searchInput.addEventListener('input', () => {
    refresh();
    runQueryDebounced();
  });

  // Hozzáadás/eltávolítás: közvetlenül a cél-lista DOM-ját módosítja. A
  // lapozott lista és a „Javasolt" blokk ugyanazt a kezelőt kapja.
  const onToggleClick = async (event) => {
    const toggle = event.target.closest('.ep-item-toggle');
    if (!toggle || !context) return;

    const item = toggle.closest('.ep-item');
    const name = item.dataset.name;

    /* Név-cél (profil rekord-csempe): a választó csak továbbadja a nevet, a
       fel/levétel a hívó dolga — kártyát nem rajzol ide, mert a névnek a
       MÁSIK lapon van helye. A `refresh` viszont kell: attól vált a most
       megnyomott gomb → és ✓ között. */
    if (context.onPick) {
      context.onPick(name);
      refresh();
      return;
    }

    const existing = $$('.wk-exercise', context.targetList).find(
      (card) => $('.wk-exercise-name', card).textContent.trim() === name,
    );
    if (existing) {
      // Az edzésnaplóban a gyakorlattal együtt a már kipipált szettek is
      // elvesznének — ilyenkor rákérdezünk. Frissen hozzáadott (még nem
      // teljesített) gyakorlatnál marad az azonnali eltávolítás.
      const doneSets = $$('.wk-set-check', existing).filter(
        (check) => check.getAttribute('aria-pressed') === 'true',
      ).length;
      if (doneSets > 0) {
        const ok = await confirmAction(
          `A(z) „${name}” gyakorlaton ${doneSets} teljesített szett van. Az eltávolítással ezek elvesznek.`,
          { title: 'Eltávolítod a gyakorlatot?', confirmLabel: 'Eltávolítás' },
        );
        if (!ok) return;
      }
      existing.remove();
      showToast(`${name} eltávolítva`);
    } else {
      /* Időalapú gyakorlat EGY sorral kerül be, a szett-alapú hárommal. A
         három szett a súlyzós munka szokása; egy futásból nem csinál senki
         hármat, és a „+ Szett" gomb ezeken a kártyákon nincs is ott. */
      const cardio = item.dataset.logMode === 'duration';
      const set = defaultSetFor(name, defaultSet);
      context.targetList.appendChild(
        renderExercise(
          {
            name,
            pr: false,
            ...(cardio && { logMode: 'duration' }),
            sets: cardio ? [{ ...defaultCardioSet }] : [{ ...set }, { ...set }, { ...set }],
          },
          context.exerciseOptions,
        ),
      );
      showToast(`${name} hozzáadva ${context.toastTarget}`);
    }
    context.onChange();
    refresh();
  };
  list.addEventListener('click', onToggleClick);
  suggestList.addEventListener('click', onToggleClick);

  backBtn.addEventListener('click', () => navigate(context?.backPage || 'plans'));

  hooks.refreshExercisePicker = refresh;

  /** A cél átállítása — a hívó ezt hívja, mielőtt a választóra navigál. Az
      első hívás indítja a katalógust is. */
  const use = (next) => {
    context = next;
    backBtn.setAttribute('aria-label', context.backLabel);
    nounEl.textContent = context.subtitleNoun;
    startCatalog();
    loadSuggestions();
  };

  /* A profil a setupExercisePicker ELŐTT áll fel (lásd app/init.js), így a
     választót nem kaphatja meg paraméterben, mint az edzésnapló és a
     terv-építő. A hooks a ház bevált megoldása erre — az init sorrendjét nem
     kell átrendezni miatta, és a hívás úgyis csak kattintáskor történik. */
  hooks.useExercisePicker = use;

  return { use };
}

export { setupExercisePicker };
```

Megjegyzés a régi kódhoz képest: a `data-search` attribútum és a `catalogByName` megszűnt (a szűrés a szerveren van); a `refresh` nem szűr és nem ír számlálót (azt a `total` adja).

- [ ] **Step 2: Lint + tesztcsomag**

Run: `npx eslint public/js/ui/exercise-picker.js && npm test`
Expected: lint hiba nélkül, `fail 0`.

- [ ] **Step 3: Gyors kézi próba**

Run: `npm start` (háttérben), böngészőben `http://localhost:3000`, belépés után Edzés → „+ Gyakorlat hozzáadása".
Expected: 40 kártya, a számláló a teljes darabszámot mutatja (1441 a helyi adatbázison); görgetésre bővül; „guggolás" beírására ~250 ms után szűkül; „Láb" chip szűr; → hozzáad, ✓ levesz; a „Javasolt" blokk szűretlen listán látszik. Ha nincs elérhető böngésző, ezt a lépést a Task 7-ben pótold, és írd le, hogy itt kimaradt.

- [ ] **Step 4: Commit**

```bash
git add public/js/ui/exercise-picker.js
git commit -m "Gyakorlat-választó: lapozott katalógus, első megnyitáskor tölt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Profil név-kiegészítő a keresőből; a `/api/exercise-catalog` megszűnik

**Files:**

- Modify: `public/js/ui/profile.js:248-268` (a `loadCatalogOptions` blokk) és `:315` (a hívása)
- Modify: `public/js/core/api.js` (`getExerciseCatalog` sor törlése)
- Modify: `public/js/render/sets.js:20-24` (elavult komment)
- Modify: `server/server.js` (`READ_ENDPOINTS` és `RESPONSE_PROJECTIONS`, ~594–616. sor)
- Test: `server/api.test.js`

**Interfaces:**

- Consumes: Task 3 — `api.searchExercises`, `debounce`, `SEARCH_DELAY_MS`.
- Produces: a `/api/exercise-catalog` útvonal 404-et ad.

- [ ] **Step 1: Írd át a bukó teszteket**

`server/api.test.js`:

- A 401-es listából töröld a `['GET', '/api/exercise-catalog'],` sort.
- A `test('a gyakorlat-katalógus nem küldi ki a belső mezőket', …)` blokkot cseréld erre:

```js
test('a teljes gyakorlat-katalógus végpontja megszűnt', async () => {
  /* A választó és a profil a lapozott /api/exercises-t használja; a teljes,
     1400+ soros lista többé nem megy ki a hálózatra. */
  const res = await request('GET', '/api/exercise-catalog', { cookie: annaCookie });
  assert.equal(res.status, 404);
});
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `node --test server/api.test.js`
Expected: FAIL — `a teljes gyakorlat-katalógus végpontja megszűnt`: 200 !== 404.

- [ ] **Step 3: A szerveroldali útvonal törlése**

`server/server.js` — a `READ_ENDPOINTS`-ből töröld a `'/api/exercise-catalog': 'exerciseCatalog',` sort. A `RESPONSE_PROJECTIONS` objektumot és a hozzá tartozó kommentet töröld, a ciklust egyszerűsítsd:

```js
for (const [route, key] of Object.entries(READ_ENDPOINTS)) {
  app.get(route, (req, res) => res.json(getCollection(key)));
}
```

(A belső mezők kiszűrése mostantól a `catalog-search.js` `toExerciseCard`-jában él.)

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `node --test server/api.test.js`
Expected: PASS.

- [ ] **Step 5: A profil név-kiegészítője**

`public/js/ui/profile.js` — az importok közé:

```js
import { SEARCH_DELAY_MS, debounce } from '../core/paged-list.js';
```

A `let catalogLoaded = false; const loadCatalogOptions = async () => { … };` blokkot (a fölötte álló kommenttel együtt) cseréld erre:

```js
/* A gyakorlat-nevek a szerver keresőjéből, gépelés közben: a szerver csak
     ismert nevet fogad el (kitalált névre az izomcsoportokat sem ismernénk,
     tehát ajánlani sem tudnánk belőle). A teljes katalógust nem töltjük le —
     a datalist csak kényelem, nélküle is be lehet gépelni a nevet. */
let assessRequest = 0;
const suggestAssessNames = debounce(async () => {
  const requestId = ++assessRequest;
  const q = assessExercise.value.trim();
  if (q === '') {
    assessOptions.replaceChildren();
    return;
  }
  try {
    const { items } = await api.searchExercises({ q, limit: 10 });
    // Közben továbbgépelt: a régebbi válasz ne írja felül az újabbat
    if (requestId !== assessRequest) return;
    assessOptions.replaceChildren(...items.map((item) => new Option(item.name)));
  } catch (err) {
    console.error('A gyakorlat-javaslatok nem töltődtek be:', err);
  }
}, SEARCH_DELAY_MS);
assessExercise.addEventListener('input', suggestAssessNames);
```

A `hooks.refreshProfile = async () => {` első sorából töröld a `loadCatalogOptions();` hívást.

- [ ] **Step 6: Az api-kliens és a komment takarítása**

`public/js/core/api.js` — töröld: `getExerciseCatalog: () => getJsonCached('/api/exercise-catalog'),`

Ellenőrzés: `grep -rn "getExerciseCatalog\|exercise-catalog" public/js server --include=*.js`
Expected: nincs találat a `public/js`-ben; a `server/` alatt legfeljebb a `api.test.js` 404-es tesztje.

`public/js/render/sets.js` — a komment

```
   A halmaz a katalógus `felszerelés` mezőjéből épül, és INDULÁSKOR töltjük
   fel: a renderExercise szinkron, menet közben nem várhat egy kérésre. A
   katalógus-válasz kliens-oldalon cache-elt (api.getExerciseCatalog), tehát ez
   nem jelent plusz hálózati kérést. Ha a töltés elhasal, a felirat marad a
   semleges „Súly·kg" — rosszabb konvenciót nem írunk ki, mint amit tudunk. */
```

helyett:

```
   A halmazt a szerver adja (/api/weight-conventions), és INDULÁSKOR töltjük
   fel: a renderExercise szinkron, menet közben nem várhat egy kérésre. Ha a
   töltés elhasal, a felirat marad a semleges „Súly·kg" — rosszabb
   konvenciót nem írunk ki, mint amit tudunk. */
```

- [ ] **Step 7: Lint + tesztcsomag + commit**

Run: `npx eslint public/js/ui/profile.js public/js/core/api.js public/js/render/sets.js server/server.js && npm test`
Expected: lint hiba nélkül, `fail 0`.

```bash
git add public/js/ui/profile.js public/js/core/api.js public/js/render/sets.js server/server.js server/api.test.js
git commit -m "Profil: név-kiegészítő a keresőből; a teljes katalógus-végpont megszűnik

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Lapozott étel-lista (szerver + Táplálkozás + saját étel + edzői étrend) — egy lépésben

A `/api/foods` útvonal ugyanaz marad, de új alakot ad — ezért a szerver, a tesztek és MINDEN kliensoldali fogyasztó ebben az egy commitban vált.

**Files:**

- Modify: `server/server.js:2447` (`/api/foods`)
- Modify: `server/api.test.js`, `server/timezone.test.js` (a `/api/foods` olvasók)
- Modify: `public/js/core/api.js` (`getFoods`, `refreshFoods` törlése)
- Modify: `public/js/render/foods.js` (teljes csere)
- Modify: `public/js/ui/nutrition.js`
- Modify: `public/js/ui/custom-food.js:51-55`
- Modify: `public/js/ui/coach-meals.js`
- Modify: `public/js/app/init.js` (`renderFoods` import és hívás)
- Modify: `public/js/nav/router.js` (`nutrition()` hatás)

**Interfaces:**

- Consumes: Task 1 — `catalogSearch.searchFoods`; Task 3 — `createPagedList`, `debounce`, `SEARCH_DELAY_MS`, `api.searchFoods`, `api.getFoodGroups`, `api.getFoodsByName`.
- Produces:
  - `GET /api/foods?q=&offset=&limit=` → `{ items, total, nextOffset }`
  - `renderFoodItem(food) → HTMLLIElement`
  - `hooks.startFoodList()`; `setupNutrition` visszatérése változatlan: `{ logFood, refreshFoods, openFoodDetail }`

- [ ] **Step 1: Írd át a teszteket az új alakra, és vegyél fel újakat**

A meglévő olvasók átírása (mechanikus):

```bash
perl -pi -e "s/(request\('GET', '\/api\/foods', \{ cookie: \w+ \}\)\)\.json)\b/\$1.items/g" server/api.test.js
perl -pi -e 's/\bfoods\.json\[0\]/foods.json.items[0]/g' server/api.test.js server/timezone.test.js
grep -n "'/api/foods'" server/api.test.js server/timezone.test.js
```

Expected: minden olvasó `….json.items`-t vagy `foods.json.items[0]`-t használ (a 401-es lista `['GET', '/api/foods'],` sora változatlan). Nézd át a grep kimenetét soronként: a `api.test.js` 366, 412, 426, 664, 1940, 1950, 1951, 1973, 1989, 2012, 2026 körüli sorai `.json.items`, a 2413–2414 és a `timezone.test.js` 136–137 `foods.json.items[0]`.

Új tesztek a `test('a saját ételek fiókonként elkülönülnek', …)` UTÁN:

```js
test('az étel-lista lapoz és keres', async () => {
  const elso = (await request('GET', '/api/foods', { cookie: belaCookie })).json;
  assert.equal(elso.items.length, 40);
  assert.ok(elso.total > 40);
  assert.equal(elso.nextOffset, 40);

  const etel = seedFood(elso.items);
  const q = encodeURIComponent(etel.name.toUpperCase());
  const talalat = (await request('GET', `/api/foods?q=${q}`, { cookie: belaCookie })).json;
  assert.ok(
    talalat.items.some((food) => food.name === etel.name),
    'a név nagybetűs keresésére is megvan',
  );

  const kategoria = encodeURIComponent(etel.group);
  const csoport = (
    await request('GET', `/api/foods?q=${kategoria}&limit=100`, { cookie: belaCookie })
  ).json;
  assert.ok(
    csoport.items.some((food) => food.name === etel.name),
    'a kategóriára is keres',
  );
});

test('az étel-lista hibás lapozási paraméterre 400-at ad', async () => {
  for (const query of ['offset=-1', 'limit=0', 'limit=101', 'q=a&q=b']) {
    const res = await request('GET', `/api/foods?${query}`, { cookie: annaCookie });
    assert.equal(res.status, 400, query);
  }
});
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `node --test server/api.test.js server/timezone.test.js`
Expected: FAIL — a `/api/foods` még tömböt ad, a `.json.items` `undefined` (pl. `Cannot read properties of undefined (reading 'find')`).

- [ ] **Step 3: A `/api/foods` lapozása**

`server/server.js` — a `app.get('/api/foods', (req, res) => res.json(getFoodsForUser(req.user.id)));` sort cseréld:

```js
/* Az étel-lista lapozva: a saját ételek elöl, a keresés a névre, a
   kategóriára és a márkára (server/catalog-search.js). */
app.get('/api/foods', (req, res) => {
  const params = parsePageParams(req.query);
  if (params.error) return res.status(400).json({ error: params.error });
  res.json(catalogSearch.searchFoods(req.user.id, params));
});
```

Ellenőrizd, hogy a sor a `catalogSearch` deklarációja (Task 2) UTÁN áll.

- [ ] **Step 4: Futtasd, és nézd meg, hogy átmegy**

Run: `node --test server/api.test.js server/timezone.test.js`
Expected: PASS.

- [ ] **Step 5: Az étel-sor rajzolója**

`public/js/render/foods.js` új tartalma:

```js
/** Az étel-lista egy sora — a lapozott lista (js/core/paged-list.js) ebből
    rajzolja a szerverről érkező lapokat. */

import { $, cloneTemplate } from '../core/dom.js';
import { formatNumber } from '../core/format.js';

/** A SAJÁT ételek a szervertől elöl jönnek, és jelvényt + törlés-gombot
    kapnak. */
function renderFoodItem(food) {
  const item = cloneTemplate('tpl-food');

  // A kcal-jelvény a név span-jén belül ül, ezért a nevet elé szúrjuk be.
  const nameEl = $('.nu-food-name', item);
  nameEl.insertBefore(document.createTextNode(food.name + ' '), nameEl.firstChild);
  $('.nu-food-kcal', item).textContent = `${food.kcal} kcal`;
  $('.nu-food-macros', item).textContent =
    `${food.per} · ${formatNumber(food.protein)} g F · ${formatNumber(food.carbs)} g Cs · ${formatNumber(food.fat)} g Zs`;

  // A nyíl az adagválasztó modált nyitja — a naplózás onnan indul
  const addBtn = $('.nu-food-add', item);
  addBtn.dataset.food = food.name;
  addBtn.title = 'Adag megadása és hozzáadás';
  addBtn.setAttribute('aria-haspopup', 'dialog');
  addBtn.setAttribute('aria-label', `${food.name} — adag megadása és hozzáadás a naplóhoz`);

  // Saját étel: jelvény + törlés. A beépített katalógus elemei nem
  // törölhetők, azok minden fióknak közösek.
  if (food.custom) {
    item.classList.add('nu-food--custom');
    $('.nu-food-badge', item).hidden = false;
    const removeBtn = $('.nu-food-remove', item);
    removeBtn.hidden = false;
    removeBtn.dataset.customFoodId = food.id;
    removeBtn.title = 'Saját étel törlése';
    removeBtn.setAttribute('aria-label', `${food.name} törlése a saját ételek közül`);
  }

  return item;
}

export { renderFoodItem };
```

(A `data-food-name` attribútum megszűnt — a kliens már nem szűr.)

- [ ] **Step 6: A Táplálkozás oldal**

`public/js/ui/nutrition.js`:

Importok — a `renderFoods` import helyett:

```js
import { currentPage } from '../nav/router.js';
import { SEARCH_DELAY_MS, createPagedList, debounce } from '../core/paged-list.js';
import { renderFoodItem } from '../render/foods.js';
```

A függvény eleje — töröld a `// \`let\`, nem \`const\`: …`kommentet és a`let foods = await api.getFoods();` sort.

Az `applyFilter` blokkot (a fölötte álló „Az élő szűrés önálló függvényben…" kommenttel), a `searchInput.addEventListener('input', applyFilter);` sort és a régi `refreshFoods` blokkot (kommentjével) cseréld erre:

```js
/* ---- Étel-lista: szerveroldali keresés, 40-es lapok ----
     A lista az oldal ELSŐ megnyitásakor töltődik (a router nutrition()
     hatása hívja a hooks.startFoodList-et), nem az app indulásakor. A nyíl
     kattintásakor az ételt a betöltött lapokból épülő név → étel táblából
     vesszük; új keresésnél a tábla kiürül. */
const foodList = $('[data-list="foods"]');
const foodsByName = new Map();
let foodsStarted = false;

const foodsPaged = createPagedList({
  list: foodList,
  fetchPage: (params) => api.searchFoods(params),
  renderItem: renderFoodItem,
  onPage: (items, _nodes, { append }) => {
    if (!append) foodsByName.clear();
    items.forEach((food) => foodsByName.set(food.name, food));
  },
  onState: ({ status, total }) => {
    if (status === 'ready') emptyState.hidden = total > 0;
    // Hibánál az „Újra" sor beszél — a „Nincs találat" félrevezetne
    if (status === 'error') emptyState.hidden = true;
  },
});

const runFoodQuery = () => {
  runFoodQueryDebounced.cancel();
  foodsStarted = true;
  return foodsPaged.setQuery({ q: searchInput.value.trim() });
};
const runFoodQueryDebounced = debounce(runFoodQuery, SEARCH_DELAY_MS);
searchInput.addEventListener('input', runFoodQueryDebounced);

const startFoods = () => {
  if (!foodsStarted) runFoodQuery();
};
hooks.startFoodList = startFoods;

/* Saját étel felvitele/törlése után: a lista a MOSTANI kereséssel indul
     elölről, így az új saját étel (a szerver elöl adja) azonnal látszik, a
     beírt keresés pedig nem oldódik fel. */
const refreshFoods = () => runFoodQuery();
```

A lista kattintás-kezelőjében a `$('[data-list="foods"]').addEventListener('click', …` sor `$('[data-list="foods"]')` részét cseréld `foodList`-re, és benne

```js
const food = foods.find((f) => f.name === addBtn.dataset.food);
```

helyett:

```js
const food = foodsByName.get(addBtn.dataset.food);
```

A `return { logFood, refreshFoods, openFoodDetail };` sor ELÉ:

```js
/* Közvetlen nyitás a Táplálkozás oldalon (újratöltés #nutrition-ön): a
     router már a setup ELŐTT lefuttatta az oldal hatását, amikor a
     hooks.startFoodList még nem létezett — itt pótoljuk. */
if (currentPage() === 'nutrition') startFoods();
```

Ellenőrzés: `grep -n "foods\b\|applyFilter\|getFoods\|renderFoods" public/js/ui/nutrition.js`
Expected: nincs maradék `foods.find`, `applyFilter`, `getFoods`, `renderFoods` hivatkozás.

- [ ] **Step 7: Router és init**

`public/js/nav/router.js` — a `nutrition()` hatás végére:

```js
// Az étel-lista az első megnyitáskor töltődik (js/ui/nutrition.js)
hooks.startFoodList?.();
```

`public/js/app/init.js` — töröld az `import { renderFoods } from '../render/foods.js';` sort és a `safe(renderFoods),` sort az induló `Promise.all`-ból.

- [ ] **Step 8: Saját étel modál — kategóriák**

`public/js/ui/custom-food.js` — a

```js
const foods = await api.getFoods();
const groups = [...new Set(foods.filter((f) => !f.custom).map((f) => f.group))]
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, 'hu'));
```

helyett:

```js
// A szerver már rendezve adja, a „Saját étel" nélkül (catalog-search.js)
const groups = await api.getFoodGroups();
```

A fölötte álló kommentben az „az étel-listából jönnek" részt írd át: „a szerver kategória-listájából jönnek".

- [ ] **Step 9: Edzői étrend-szerkesztő**

`public/js/ui/coach-meals.js` — importok közé:

```js
import { SEARCH_DELAY_MS, debounce } from '../core/paged-list.js';
```

A `// Név → étel. …` kommentet, a `let foodsByName = null;` sort és a teljes `async function loadFoods() { … }` függvényt cseréld erre:

```js
/* Név → étel. A teljes étel-listát már nem töltjük le: a tábla a kereső
     találataiból és a név szerinti lekérésekből gyűlik. Az élő makró-összeg
     ebből számol; a mentést a szerver úgyis ellenőrzi. */
const foodsByName = new Map();
const rememberFoods = (foods) => foods.forEach((food) => foodsByName.set(food.name, food));

/** A még ismeretlen nevek tápértéke — szerkesztéskor a bent lévő
      tételekhez, mentéskor a kézzel begépelt nevekhez. A szerver egyszerre
      legfeljebb 50 nevet fogad, ezért 50-esével kérjük. */
async function resolveNames(names) {
  const missing = [...new Set(names.filter((name) => name && !foodsByName.has(name)))];
  for (let i = 0; i < missing.length; i += 50) {
    rememberFoods(await api.getFoodsByName(missing.slice(i, i + 50)));
  }
}

/* Gépelés közben a kereső 10 találata kerül a javaslatok közé. Csak a
     LEGUTÓBBI kérés válasza írhatja a listát. */
let suggestRequest = 0;
const suggestFoods = debounce(async (query) => {
  const requestId = ++suggestRequest;
  if (query === '') return;
  try {
    const { items } = await api.searchFoods({ q: query, limit: 10 });
    if (requestId !== suggestRequest) return;
    rememberFoods(items);
    datalist.replaceChildren(...items.map((food) => new Option(food.name)));
    updateSum();
  } catch (err) {
    console.error('Az étel-javaslatok nem töltődtek be:', err);
  }
}, SEARCH_DELAY_MS);
```

A `readRow`-ban:

```js
    food: foodsByName?.get($('[data-item-food]', row).value.trim()) ?? null,
```

helyett:

```js
    food: foodsByName.get($('[data-item-food]', row).value.trim()) ?? null,
```

Az `openForm`-ban a

```js
    try {
      await loadFoods();
    } catch (err) {
```

helyett:

```js
    try {
      await resolveNames((meal?.items ?? []).map((item) => item.name));
    } catch (err) {
```

Az `itemsEl.addEventListener('input', updateSum);` sort cseréld:

```js
itemsEl.addEventListener('input', (event) => {
  updateSum();
  const foodInput = event.target.closest('[data-item-food]');
  if (foodInput) suggestFoods(foodInput.value.trim());
});
```

A `submit` kezelőben a `const unknown = items.find((item) => !foodsByName.has(item.name));` sor ELÉ:

```js
// A pontosan begépelt, de a listából ki nem választott nevet is ismerjük
try {
  await resolveNames(items.map((item) => item.name));
} catch (err) {
  console.error(err);
  showToast('Az ételeket most nem sikerült ellenőrizni', 'error');
  return;
}
updateSum();
```

- [ ] **Step 10: Az api-kliens takarítása**

`public/js/core/api.js` — töröld a `getFoods` és a `refreshFoods` bejegyzést (a fölöttük álló, a cache-ről szóló kommenttel együtt).

Ellenőrzés: `grep -rn "getFoods\b\|refreshFoods\|renderFoods\|invalidateCache('/api/foods')" public/js`
Expected: csak a `nutrition.js` saját `refreshFoods` függvénye és az `init.js` `nutrition?.refreshFoods()` hívása marad.

- [ ] **Step 11: Lint + teljes tesztcsomag + commit**

Run: `npm run lint && npm test`
Expected: lint hiba nélkül, `fail 0`.

```bash
git add server/server.js server/api.test.js server/timezone.test.js public/js/core/api.js public/js/render/foods.js public/js/ui/nutrition.js public/js/ui/custom-food.js public/js/ui/coach-meals.js public/js/app/init.js public/js/nav/router.js
git commit -m "Táplálkozás: lapozott étel-lista, szerveroldali keresés

A /api/foods lapozott alakra vált; a saját étel modál és az edzői
étrend-szerkesztő a kategória- és a név szerinti végpontot használja.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Kézi ellenőrzés böngészőben és mérés

Kód nem változik (kivéve, ha hiba kerül elő — akkor javítás + teszt + külön commit).

- [ ] **Step 1: Alapmérés a változtatás ELŐTTI állapoton**

```bash
git worktree add ../repo-baseline 9f63a82
cd ../repo-baseline && npm ci --silent
```

Indítsd a baseline-t egy másik porton (`PORT=3001 FITTRACK_DB=/root/repo/server/fittrack.db npm start` — ugyanaz az adatbázis, csak olvasásra nézzük), böngészőben a DevTools konzolban, belépés után, egy friss betöltés után:

```js
document.querySelectorAll('*').length;
performance
  .getEntriesByType('resource')
  .filter((r) => /\/api\/(foods|exercise-catalog)/.test(r.name)).length;
```

és a Performance panelen (vagy `performance.now()` a `init` végén, IDEIGLENES `console.info`-val, NEM commitolva) az indulási idő. Jegyezd fel a három számot, majd állítsd le a baseline szervert — a két szerver ne fusson egyszerre ugyanazon az adatbázison.

- [ ] **Step 2: Ugyanez az új állapoton**

`npm start` a `/root/repo`-ban (3000-es port), ugyanazok a mérések. Elvárt:

- a resource-szám **0** (indításkor nem megy ki `/api/foods` és `/api/exercises` kérés),
- a DOM-elemszám érezhetően kisebb (a ~1900 lista-sor és gyermekeik nélkül).

- [ ] **Step 3: Funkcionális ellenőrzés (Review Focus 4–5 is)**

- Gyakorlat-választó (Edzés → „+ Gyakorlat hozzáadása"): 40 kártya; számláló = teljes darabszám; görgetésre 40-esével bővül (DevTools: `document.querySelectorAll('[data-list="picker-catalog"] .ep-item').length`); keresés ~250 ms után; chipek; → / ✓; „Javasolt" blokk szűretlenül igen, kereséskor nem; a terv-építőből és a profil rekord-csempéjéből nyitva is működik.
- Hálózat lassítva (DevTools → Slow 3G) gyors gépelés „g", „gu", „gug": csak az utolsó találatai látszanak.
- Hálózat lekapcsolva (Offline) görgetés: „Nem sikerült betölteni — Újra"; visszakapcsolva az „Újra" folytatja.
- Táplálkozás: megnyitáskor tölt, görgetésre bővül, keresés; nyíl → adagválasztó → naplózás; saját étel felvitele („Mentés" és „Mentés és naplózás") — a lista a keresést megtartva frissül, az új étel elöl; saját étel törlése.
- **Újratöltés a `#nutrition` oldalon**: a lista betöltődik.
- **Magas ablak** (pl. DevTools 400×2000 vagy nagyítás 33%): a választó magától tölti a 2. lapot, ha az őrelem az első lap után is látszik.
- Profil → rekord-felmérő: a „Gyakorlat" mezőbe „fekv" → javaslatok jönnek.
- Edző → sportoló → Táplálkozás fül: új étkezés, étel gépelése → javaslatok, makró-összeg; meglévő étkezés szerkesztése → a tételek makrói azonnal látszanak; listából ki nem választott, pontosan begépelt névvel mentés sikerül.

- [ ] **Step 4: Takarítás és jelentés**

```bash
cd /root/repo && git worktree remove ../repo-baseline
```

Állítsd le a futó szervereket. A jelentésben: a mérési számok előtte/utána, és minden pont, ami nem volt ellenőrizhető (pl. nem volt böngésző) — kimondva, nem hallgatva.
