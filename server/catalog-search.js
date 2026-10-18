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

import { normalizeName } from './muscles.js';

export const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const MAX_QUERY_LENGTH = 100;
const MAX_NAMES = 50;

/** A gyakorlat kártya-alakja. A `load` és a `loadSource` a Recovery Engine
    belső adata, az `extId` a külső dataset azonosítója — a felület egyiket
    sem használja, és a válasz negyedét tennék ki. */
export const toExerciseCard = ({ load, loadSource, extId, ...card }) => card;

/** A keresés ékezet- és kisbetű-független (normalizeName), és szavanként
    illeszt: MINDEN keresett szónak részszövegként szerepelnie kell a mezők
    összefűzésében, bármilyen sorrendben („első guggolás" = „guggolás első"). */
const queryWords = (q) => normalizeName(q).split(/\s+/).filter(Boolean);

const matches = (parts, words) => {
  const haystack = normalizeName(parts.filter(Boolean).join(' '));
  return words.every((word) => haystack.includes(word));
};

/** A találat rangja a NÉV alapján, kisebb az előrébb: 0 pontos egyezés,
    1 a név a kereséssel kezdődik, 2 minden keresett szóval a név egy szava
    kezdődik, 3 minden szó benne van a névben, 4 csak a többi mezőben talált. */
function nameRank(name, words) {
  const normalized = normalizeName(name).replace(/\s+/g, ' ');
  const phrase = words.join(' ');
  if (normalized === phrase) return 0;
  if (normalized.startsWith(phrase)) return 1;
  const nameWords = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.every((word) => nameWords.some((nameWord) => nameWord.startsWith(word)))) return 2;
  if (words.every((word) => normalized.includes(word))) return 3;
  return 4;
}

/** Szűrés és rangsor egy lépésben. Üres keresésre nincs rangsor; különben
    stabil rendezés, tehát azonos rangon a forrás sorrendje marad (a kurált
    gyakorlatok, illetve a saját ételek elöl). A lapozás ezután jön. */
function searchIn(items, q, partsOf) {
  const words = queryWords(q);
  if (words.length === 0) return items;
  return items
    .filter((item) => matches(partsOf(item), words))
    .map((item) => ({ item, rank: nameRank(item.name, words) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

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
      const found = searchIn(
        exercises().filter((entry) => !group || entry.group === group),
        q,
        (entry) => [entry.name, entry.equipment],
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
      const found = searchIn(foodsFor(userId), q, (food) => [food.name, food.group, food.brand]);
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
