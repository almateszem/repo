/**
 * Gyűjtő — a termék-űrlap validálása és normalizálása
 * ===================================================
 * Tiszta függvények: se adatbázis, se Express, se hálózat. Ezért külön
 * tesztelhetők (products.test.js), és a szerver-végpontok csak összedrótozzák
 * őket.
 *
 * A SZABÁLYOK SZÁNDÉKOSAN AZONOSAK a fő app végpontjáéval
 * (server/server.js → parseCollected és POST /api/foods/custom). Ez nem
 * stílus-kérdés: amit itt összegyűjtünk, annak VÁLTOZTATÁS NÉLKÜL át kell
 * mennie a FitTrack validálásán is. Ha itt megengedőbbek lennénk, a feltöltés
 * napján derülne ki, hogy a gyűjtés fele használhatatlan. A szerver ugyanezt
 * újra ellenőrzi — a Gyűjtő is „csak egy kliens".
 *
 * Egy dologban viszont ENGEDÉKENYEBB, és ez a Gyűjtő lényege: a boltban
 * elég a NÉV. A makrók nélkül mentett tétel `piszkozat` állapotba kerül, és
 * otthon, nyugodt körülmények között pótolható. A kapkodva félig kitöltött sor
 * is többet ér, mint a fel nem vitt termék — csak tudni kell róla, hogy félkész.
 */
import { normalizeBarcode } from '../shared/barcode.js';
import { FOOD_GROUPS } from '../shared/foodgroups.js';

/** Atwater-tényezők: a kalória a makrókból számolva (kcal / g). */
export const ATWATER = { protein: 4, carbs: 4, fat: 9 };

export const NAME_MIN = 2;
export const NAME_MAX = 60;      // a fő app custom_foods.name korlátja
export const BRAND_MAX = 60;
export const NOTE_MAX = 200;
export const STORE_MAX = 60;
/** Egy makróból 100 g alapmennyiségben legfeljebb ennyi lehet — 100 g-nál több
    fehérje 100 g termékben fizikai képtelenség, tehát elgépelés. */
export const MACRO_MAX = 100;
export const MACRO_SUM_MAX = 100;
/** Tiszta zsír 900 kcal/100 g — efölött nincs élelmiszer. */
export const KCAL_MAX = 900;
export const PORTION_MAX_GRAMS = 2000;
export const PORTION_MAX_COUNT = 4;
export const PORTION_LABEL_MAX = 24;

/** A tétel útja: félkész → kész → már feltöltve a FitTrack-be. */
export const STATUSES = ['piszkozat', 'kesz', 'feltoltve'];

/** Szöveg normalizálása: a többszörös szóköz egy, a szélek levágva. */
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Egy makró értéke, 0,1 g pontosságra kerekítve.
 * @returns {number|null|undefined} undefined = nem adták meg (a piszkozat
 *   megengedi), null = megadták, de érvénytelen (a hívó 400-at ad rá)
 */
export function macroValue(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MACRO_MAX) return null;
  return Math.round(value * 10) / 10;
}

/** A makrókból számolt kalória (Atwater 4/4/9), egészre kerekítve. */
export const computeKcal = ({ protein, carbs, fat }) => Math.round(
  protein * ATWATER.protein + carbs * ATWATER.carbs + fat * ATWATER.fat,
);

/**
 * Mennyivel térhet el a címkén álló kalória a képlettől.
 *
 * A rost, a poliolok és az alkohol miatt a valódi címke JOGGAL más, mint a
 * 4/4/9 — de a nagy eltérés jóval valószínűbben elgépelés, mint tény. A fix 50
 * kcal-os alsó határ a kis értékek miatt kell: 10 kcal-nál a 30% három kcal
 * lenne, ami minden valódi címkét elutasítana.
 */
export const kcalTolerance = (computed) => Math.max(50, Math.round(computed * 0.3));

/**
 * Adag-gyorsgombok: [['1 db', 55], …]. A hibás elemeket CSENDBEN eldobjuk —
 * ez kényelmi mező, nem kötelező adat; egy elrontott gyorsgomb miatt nem
 * érdemes elutasítani egy boltban, félkézzel felvitt terméket.
 */
export const normalizePortions = (raw) => (Array.isArray(raw) ? raw : [])
  .map((portion) => [
    clean(portion?.[0]).slice(0, PORTION_LABEL_MAX),
    Math.round(Number(portion?.[1])),
  ])
  .filter(([label, value]) => label && Number.isFinite(value)
    && value >= 1 && value <= PORTION_MAX_GRAMS)
  .slice(0, PORTION_MAX_COUNT);

/** Kész-e a tétel, azaz átmenne-e a FitTrack „saját étel" validálásán? */
export const isComplete = (product) => Boolean(product)
  && typeof product.protein === 'number'
  && typeof product.carbs === 'number'
  && typeof product.fat === 'number'
  && typeof product.kcal === 'number';

/**
 * A beküldött termék-űrlap ellenőrzése és normalizálása.
 *
 * @param {object} body a kliens törzse
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 *   A hibaüzenet magyar és a felületen VÁLTOZTATÁS NÉLKÜL megjeleníthető.
 */
export function parseProduct(body) {
  const name = clean(body?.name);
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { ok: false, error: `A termék neve ${NAME_MIN} és ${NAME_MAX} karakter között lehet.` };
  }

  // A vonalkód itt KÖTELEZŐ (a fő appban nem az): a Gyűjtőbe minden tétel
  // szkennelésből származik, és a vonalkód a termék azonossága — enélkül az
  // export nem tudná, mire illessze a sort.
  const barcode = normalizeBarcode(body?.barcode);
  if (!barcode) {
    return {
      ok: false,
      error: 'Érvénytelen vonalkód — 8, 12, 13 vagy 14 számjegy, helyes ellenőrzőszámmal.',
    };
  }

  const unit = body?.unit === 'ml' ? 'ml' : 'g';

  const group = clean(body?.group ?? body?.foodGroup);
  if (group && !FOOD_GROUPS.includes(group)) {
    return { ok: false, error: 'Ismeretlen kategória.' };
  }

  const protein = macroValue(body?.protein);
  const carbs = macroValue(body?.carbs);
  const fat = macroValue(body?.fat);
  if (protein === null || carbs === null || fat === null) {
    return {
      ok: false,
      error: `A fehérje, a szénhidrát és a zsír 0 és ${MACRO_MAX} g között adható meg (100 ${unit}-ra).`,
    };
  }

  const allMacros = protein !== undefined && carbs !== undefined && fat !== undefined;
  if (allMacros && protein + carbs + fat > MACRO_SUM_MAX) {
    return {
      ok: false,
      error: `A három makró összege nem lehet több ${MACRO_SUM_MAX} g-nál 100 ${unit}-ban.`,
    };
  }

  /* A kalória. Ha megvan mind a három makró, alapból a képlet adja; a kézi
     felülírást elfogadjuk, de csak a tűrésen belül. Ha a makrók még hiányoznak
     (piszkozat), a kézzel megadott kalóriát nincs mihez mérni — ilyenkor csak a
     0–900 sávot nézzük, és a tétel amúgy is félkész marad. */
  let kcal;
  let kcalAuto = true;
  const manual = body?.kcalMode === 'manual'
    && body?.kcal !== undefined && body?.kcal !== null && body?.kcal !== '';

  if (manual) {
    const raw = Number(body.kcal);
    if (!Number.isFinite(raw) || raw < 0 || raw > KCAL_MAX) {
      return {
        ok: false,
        error: `A kalória 0 és ${KCAL_MAX} kcal között adható meg (100 ${unit}-ra).`,
      };
    }
    if (allMacros) {
      const computed = computeKcal({ protein, carbs, fat });
      if (Math.abs(raw - computed) > kcalTolerance(computed)) {
        return {
          ok: false,
          error: `A megadott ${Math.round(raw)} kcal nem fér össze a makrókkal `
               + `(a képlet szerint ${computed} kcal). Ellenőrizd a makrókat, `
               + 'vagy számoltasd újra a kalóriát.',
        };
      }
    }
    kcal = Math.round(raw);
    kcalAuto = false;
  } else if (allMacros) {
    kcal = computeKcal({ protein, carbs, fat });
  }

  const value = {
    barcode,
    name,
    brand: clean(body?.brand).slice(0, BRAND_MAX),
    foodGroup: group,
    unit,
    // A hiányzó tápérték null, NEM 0: a nulla azt ÁLLÍTANÁ, hogy a termék nem
    // tartalmaz fehérjét, holott csak még nem tudjuk.
    protein: protein ?? null,
    carbs: carbs ?? null,
    fat: fat ?? null,
    kcal: kcal ?? null,
    kcalAuto,
    portions: normalizePortions(body?.portions),
    note: clean(body?.note).slice(0, NOTE_MAX),
    store: clean(body?.store).slice(0, STORE_MAX),
    source: body?.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
  };

  /* Az állapotot az ADAT dönti el, nem a gomb, amit megnyomtak: a „kész" azt
     ígéri, hogy a tétel feltölthető, és ezt csak a teljesség igazolhatja. A
     `feltoltve` innen nem kérhető — azt a sikeres feltöltés írja be. */
  const wanted = body?.status === 'piszkozat' ? 'piszkozat' : 'kesz';
  value.status = isComplete(value) && wanted === 'kesz' ? 'kesz' : 'piszkozat';

  return { ok: true, value };
}
