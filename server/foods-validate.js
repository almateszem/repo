/**
 * Podium — saját étel: a beküldött adatok ellenőrzése
 * ------------------------------------------------------------------------
 * Tiszta függvények, adatbázis nélkül: a /api/foods/custom végpont (server.js)
 * adja át a törzset és a beépített katalógust, a mentés az övé.
 */
import { normalizeBarcode } from './openfoodfacts.js';
import { FOOD_GROUPS } from './data/foods.hu.js';

/** Egy adag felső határa grammban — a naplózás és az adag-előbeállítás közös
    határa (server.js is innen veszi). */
export const MAX_PORTION_GRAMS = 2000;

const CUSTOM_NAME_MIN = 2;
const CUSTOM_NAME_MAX = 60;
const MACRO_MAX = 100; // g / 100 g — ennél több fizikailag nem fér bele
const MACRO_SUM_MAX = 100.5; // fél gramm tűrés a kerekítésnek
const KCAL_MAX = 900; // 100 g tiszta zsír ~900 kcal
/** Atwater-tényezők: ennyi kcal-t ad egy gramm makrotápanyag. */
const ATWATER = { protein: 4, carbs: 4, fat: 9 };

/** Egy makró-mező: véges szám, 0 és 100 g között, egy tizedesre kerekítve
    (mint a nutrition_log-ban) — érvénytelenre null. */
const macroValue = (raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MACRO_MAX) return null;
  return Math.round(value * 10) / 10;
};

/** Adag-előbeállítások: [['1 adag', 150], …] — max 4 db, 1–2000 g/ml.
    A rosszul megadott elemeket csendben eldobjuk: ez kényelmi mező, nem
    kötelező adat, egy hibás gyorsgomb miatt nem érdemes elutasítani a mentést. */
const normalizePortions = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .map((portion) => [
      String(portion?.[0] ?? '')
        .trim()
        .slice(0, 24),
      Math.round(Number(portion?.[1])),
    ])
    .filter(
      ([label, value]) =>
        label && Number.isFinite(value) && value >= 1 && value <= MAX_PORTION_GRAMS,
    )
    .slice(0, 4);

/** Egy saját étel törzsének ellenőrzése és normalizálása. Törzs:
      { name, group?, unit?, brand?, protein, carbs, fat,
        kcal?, kcalMode?, barcode?, portions?, source? }

    A makrók 100 g / 100 ml alapmennyiségre értendők — ugyanúgy, mint a
    beépített katalógusban, így a naplózás semmit nem tud meg arról, hogy az
    étel „saját".

    A kalóriát ALAPBÓL a szerver számolja az Atwater-tényezőkkel (4/4/9), a
    felület pedig élőben mutatja ugyanezt. Ha a felhasználó felülírja
    (kcalMode: 'manual'), elfogadjuk — a csomagoláson lévő érték a rost, a
    poliolok és az alkohol miatt jogosan eltérhet —, de csak ésszerű sávban: a
    képlettől való nagy eltérés jóval valószínűbben elgépelés, mint tény.

    A `builtinFoods` a beépített katalógus (collections['foods']). A
    visszatérés { food } (az addCustomFood bemenete), vagy { status, error }. */
export function parseCustomFood(body, builtinFoods) {
  const name = String(body?.name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length < CUSTOM_NAME_MIN || name.length > CUSTOM_NAME_MAX) {
    return {
      status: 400,
      error: `Az étel neve ${CUSTOM_NAME_MIN} és ${CUSTOM_NAME_MAX} karakter között lehet.`,
    };
  }

  const unit = body?.unit === 'ml' ? 'ml' : 'g';

  const group = String(body?.group ?? '').trim();
  if (group && !FOOD_GROUPS.includes(group)) {
    return { status: 400, error: 'Ismeretlen kategória.' };
  }

  const protein = macroValue(body?.protein);
  const carbs = macroValue(body?.carbs);
  const fat = macroValue(body?.fat);
  if (protein === null || carbs === null || fat === null) {
    return {
      status: 400,
      error: `A fehérje, a szénhidrát és a zsír 0 és ${MACRO_MAX} g között adható meg (100 ${unit}-ra).`,
    };
  }
  if (protein + carbs + fat > MACRO_SUM_MAX) {
    return {
      status: 400,
      error: `A három makró összege nem lehet több 100 g-nál 100 ${unit}-ban.`,
    };
  }

  const computed = Math.round(
    protein * ATWATER.protein + carbs * ATWATER.carbs + fat * ATWATER.fat,
  );
  let kcal = computed;
  const manual = body?.kcalMode === 'manual' && body?.kcal !== undefined;
  if (manual) {
    const raw = Number(body.kcal);
    if (!Number.isFinite(raw) || raw < 0 || raw > KCAL_MAX) {
      return {
        status: 400,
        error: `A kalória 0 és ${KCAL_MAX} kcal között adható meg (100 ${unit}-ra).`,
      };
    }
    // Tűrés: a nagyobbik a fix 50 kcal-ból és a számított 30%-ából. A fix
    // alsó határ a kis értékek miatt kell (10 kcal-nál a 30% három kcal lenne).
    const tolerance = Math.max(50, Math.round(computed * 0.3));
    if (Math.abs(raw - computed) > tolerance) {
      return {
        status: 400,
        error:
          `A megadott ${Math.round(raw)} kcal nem fér össze a makrókkal ` +
          `(a képlet szerint ${computed} kcal). Ellenőrizd a makrókat, ` +
          'vagy számoltasd újra a kalóriát.',
      };
    }
    kcal = Math.round(raw);
  }

  let barcode = null;
  const rawBarcode = body?.barcode;
  if (rawBarcode !== undefined && rawBarcode !== null && rawBarcode !== '') {
    barcode = normalizeBarcode(rawBarcode);
    if (!barcode) {
      return {
        status: 400,
        error: 'Érvénytelen vonalkód — 8, 12, 13 vagy 14 számjegy, helyes ellenőrzőszámmal.',
      };
    }
  }

  // A név NEM ütközhet a beépített katalógussal: a naplózás NÉVVEL hivatkozik
  // az ételre, két azonos név eltérő tápértékkel megfejthetetlen lenne.
  if (builtinFoods.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    return { status: 409, error: 'Ez a név szerepel az alap étel-listában — válassz másikat.' };
  }

  return {
    food: {
      name,
      brand: String(body?.brand ?? '')
        .trim()
        .slice(0, 60),
      group,
      unit,
      kcal,
      protein,
      carbs,
      fat,
      kcalAuto: !manual,
      barcode,
      portions: normalizePortions(body?.portions),
      source: body?.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
    },
  };
}
