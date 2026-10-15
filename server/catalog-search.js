/**
 * Podium — katalógus-keresés (gyakorlatok, ételek)
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
