/**
 * Vonalkód-normalizálás és Open Food Facts leképezés — KÖZÖS modul
 * ================================================================
 * Ezt a fájlt KÉT oldal használja, és pont ezért él itt, a public/ alatt:
 *
 *   - a FitTrack szerver (server/openfoodfacts.js re-exportálja) a saját
 *     vonalkód-végpontjához;
 *   - a Gyűjtő a BÖNGÉSZŐBEN (public/gyujto/), ahol nincs szerver, és a
 *     böngésző hívja közvetlenül az Open Food Facts-et.
 *
 * Ha a két hely másképp normalizálna, ugyanaz a termék két KÜLÖN kódon ülne,
 * és a boltban begyűjtött tétel nem találna rá a párjára a FitTrack-ben. Ezért
 * nincs belőle két példány.
 *
 * Csak tiszta függvények és szabványos API-k — se `process`, se `node:`
 * import —, hogy a böngésző változtatás nélkül betölthesse.
 */

/** 1 kcal = 4,184 kJ — sok európai termék csak kilojoule-ban címkéz. */
const KJ_PER_KCAL = 4.184;

/**
 * Vonalkód normalizálása és ellenőrzése.
 *
 * Csak a számjegyeket tartjuk meg (a kamera néha szóközt is ad), és GS1 mod-10
 * ellenőrzőszámot számolunk: enélkül egy félreolvasott számjegy némán rossz
 * termékre keresne rá. Elfogadott hosszak: EAN-8, UPC-A (12), EAN-13, GTIN-14.
 *
 * A rövidebb kódokat EAN-13-ra egészítjük ki nullákkal (ez GS1-konform, és az
 * OFF is így tárolja) — így egy termék EGY soron ül akkor is, ha a kamera
 * UPC-A-ként, a felhasználó viszont EAN-13-ként adta meg.
 *
 * @param {unknown} raw
 * @returns {string|null} 13 jegyű kód, vagy null ha érvénytelen
 */
export function normalizeBarcode(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return null;

  // mod-10: jobbról az utolsó előtti számjegy súlya 3, onnan váltakozva 1 és 3.
  const body = digits.slice(0, -1);
  const check = Number(digits.at(-1));
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  if ((10 - (sum % 10)) % 10 !== check) return null;

  return digits.length < 13 ? digits.padStart(13, '0') : digits;
}

/** Szám vagy null — az OFF üres sztringet és null-t is ad hiányzó mezőre. */
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * OFF v2 termék → a FitTrack étel-alakja, 100 g / 100 ml alapmennyiségre
 * (ugyanúgy, mint a beépített katalógus — a naplózás így semmit nem tud meg
 * arról, hogy az étel vonalkódról jött).
 *
 * A hiányzó tápérték `null` marad, NEM 0: a nulla azt állítaná, hogy a termék
 * nem tartalmaz fehérjét, holott csak nem tudjuk. Az űrlapon üresen jelenik
 * meg, és a felhasználó a csomagolásról pótolja.
 *
 * @returns {object|null} null, ha egyetlen 100 g-os tápérték sincs
 */
export function mapProduct(raw, barcode) {
  const nutriments = raw?.nutriments ?? {};

  let kcal = num(nutriments['energy-kcal_100g']);
  const kj = num(nutriments['energy-kj_100g']);
  if (kcal === null && kj !== null) kcal = Math.round(kj / KJ_PER_KCAL);

  const protein = num(nutriments.proteins_100g);
  const carbs = num(nutriments.carbohydrates_100g);
  const fat = num(nutriments.fat_100g);

  // Semmilyen 100 g-os adat: a termék létezik az OFF-ban, de tápérték nélkül —
  // ilyenkor nincs mit előre kitölteni, a hívó „nem találtam"-ként kezeli.
  if ([kcal, protein, carbs, fat].every((value) => value === null)) return null;

  const brand = clean(raw.brands).split(',')[0].trim();
  const base = clean(raw.product_name_hu) || clean(raw.product_name)
    || clean(raw.generic_name_hu) || clean(raw.generic_name);

  // A márka a névbe kerül: a boltban két „Natúr joghurt" is van, a felhasználó
  // a márkából ismeri fel a sajátját. Ha nincs név, a vonalkód az azonosító.
  let name;
  if (!base) name = `Ismeretlen termék · ${barcode}`;
  else if (brand && !base.toLowerCase().includes(brand.toLowerCase())) name = `${base} (${brand})`;
  else name = base;
  // A custom_foods név-mezője 60 karakter (a végpont is erre validál).
  name = name.slice(0, 60);

  // Italoknál ml a természetes egység; a `quantity` „500 ml" / „1,5 l" alakú.
  const unit = /\d\s*(ml|cl|dl|l)\b/i.test(clean(raw.quantity)) ? 'ml' : 'g';

  // Egy adag-gyorsgomb a címkéről (pl. „1 adag · 30 g") — a részlet-modál
  // chipjeként jelenik meg, mint a beépített ételek portions mezője.
  const serving = num(raw.serving_quantity);
  const portions = serving !== null && serving >= 1 && serving <= 2000
    ? [[`1 adag${clean(raw.serving_size) ? ` · ${clean(raw.serving_size)}` : ''}`.slice(0, 24),
      Math.round(serving)]]
    : [];

  return { name, brand, unit, kcal, protein, carbs, fat, portions, barcode, source: 'openfoodfacts' };
}

/* Csak amire szükségünk van: az OFF teljes terméke több száz mező, és a
   `fields=` paraméterrel a válasz a töredékére zsugorodik. */
export const OFF_FIELDS = [
  'product_name', 'product_name_hu', 'generic_name', 'generic_name_hu',
  'brands', 'quantity', 'serving_size', 'serving_quantity', 'nutriments',
].join(',');

export const OFF_BASE_URL = 'https://world.openfoodfacts.org';

/**
 * Az OFF termék-lekérdezés URL-je.
 *
 * Az `app_name`/`app_version` NEM dísz: az Open Food Facts azonosítást vár
 * minden hívótól, és a szerver azt a User-Agent fejlécben küldi. A BÖNGÉSZŐ
 * viszont nem állíthat User-Agentet (a fetch tiltja), ezért ott ezt a
 * dokumentált lekérdezés-paraméteres utat használjuk — enélkül az OFF a
 * névtelen böngésző-forgalmat korlátozhatja vagy elutasíthatja.
 */
export function offProductUrl(barcode, { baseUrl = OFF_BASE_URL, app = null } = {}) {
  const params = new URLSearchParams({ fields: OFF_FIELDS });
  if (app) {
    params.set('app_name', app.name);
    params.set('app_version', app.version);
  }
  return `${baseUrl}/api/v2/product/${barcode}.json?${params}`;
}
