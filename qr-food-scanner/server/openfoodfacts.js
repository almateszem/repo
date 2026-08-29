/**
 * QR Food Scanner — Open Food Facts kliens
 * ----------------------------------------
 * Egyetlen kérdésre felel: BENNE VAN-E a beolvasott kód az OFF adatbázisában?
 *
 * A böngésző nem hívja közvetlenül az OFF-ot: az OFF azonosító User-Agentet
 * kér (névtelen kérésre 403 jár), amit kliensből nem lehet beállítani, és így
 * az app egy-origin marad, CORS nélkül.
 *
 * A modul tiszta függvényei (`normalizeBarcode`, `mapProduct`) hálózat nélkül
 * tesztelhetők; a `fetchProduct` az egyetlen, ami kifelé beszél.
 */

// Env-változóból, hogy a teszt egy helyi stubra irányíthassa — a tesztcsomag
// nem függhet az internettől.
const BASE_URL = process.env.QRFS_OFF_URL || 'https://world.openfoodfacts.org';
const USER_AGENT = process.env.QRFS_OFF_UA || 'QrFoodScanner/0.1 (hobbi projekt)';
const TIMEOUT_MS = Number(process.env.QRFS_OFF_TIMEOUT_MS) || 6000;

/** 1 kcal = 4,184 kJ — sok európai termék csak kilojoule-ban címkéz. */
const KJ_PER_KCAL = 4.184;

/**
 * Vonalkód normalizálása és ellenőrzése.
 *
 * Csak a számjegyeket tartjuk meg (a kamera néha szóközt is ad), és GS1 mod-10
 * ellenőrzőszámot számolunk: enélkül egy félreolvasott számjegy némán rossz
 * termékre keresne rá. Elfogadott hosszak: EAN-8, UPC-A (12), EAN-13, GTIN-14.
 * A rövidebb kódokat EAN-13-ra egészítjük ki nullákkal (ez GS1-konform, és az
 * OFF is így tárolja) — így ugyanaz a termék EGY soron ül a helyi adatbázisban
 * akkor is, ha egyszer UPC-A-ként, másszor EAN-13-ként olvassuk be.
 *
 * @param {unknown} raw
 * @returns {string|null} 13 (vagy 14) jegyű kód, vagy null ha érvénytelen
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
 * OFF v2 termék → a képernyőn megjelenő alak, 100 g / 100 ml alapmennyiségre.
 *
 * A hiányzó tápérték `null` marad, NEM 0: a nulla azt állítaná, hogy a termék
 * nem tartalmaz fehérjét, holott csak nem tudjuk.
 *
 * @param {object} raw   az OFF `product` objektuma
 * @param {string} barcode
 * @returns {{name: string, brand: string, unit: string, kcal: number|null,
 *            protein: number|null, carbs: number|null, fat: number|null}}
 */
export function mapProduct(raw, barcode) {
  const nutriments = raw?.nutriments ?? {};

  let kcal = num(nutriments['energy-kcal_100g']);
  const kj = num(nutriments['energy-kj_100g']);
  if (kcal === null && kj !== null) kcal = Math.round(kj / KJ_PER_KCAL);

  const brand = clean(raw?.brands).split(',')[0].trim();
  const base = clean(raw?.product_name_hu) || clean(raw?.product_name)
    || clean(raw?.generic_name_hu) || clean(raw?.generic_name);

  // A márka a névbe kerül: a boltban két „Natúr joghurt" is van, a felhasználó
  // a márkából ismeri fel a sajátját. Ha nincs név, a vonalkód az azonosító.
  let name;
  if (!base) name = `Ismeretlen nevű termék · ${barcode}`;
  else if (brand && !base.toLowerCase().includes(brand.toLowerCase())) name = `${base} (${brand})`;
  else name = base;

  // Italoknál ml a természetes egység; a `quantity` „500 ml" / „1,5 l" alakú.
  const unit = /\d\s*(ml|cl|dl|l)\b/i.test(clean(raw?.quantity)) ? 'ml' : 'g';

  return {
    name: name.slice(0, 80),
    brand,
    unit,
    kcal,
    protein: num(nutriments.proteins_100g),
    carbs: num(nutriments.carbohydrates_100g),
    fat: num(nutriments.fat_100g),
  };
}

// Csak amire szükségünk van: az OFF teljes terméke több száz mező, a `fields=`
// paraméterrel a válasz a töredékére zsugorodik.
const FIELDS = [
  'product_name', 'product_name_hu', 'generic_name', 'generic_name_hu',
  'brands', 'quantity', 'nutriments',
].join(',');

/**
 * Egy termék lekérése az Open Food Facts-ből.
 *
 * A háromállapotú visszatérés szándékos: a „nincs benne" és a „most nem
 * elérhető" MÁS. Az elsőre makró-űrlap jár, a másodikra hibaüzenet — hálózati
 * hiba miatt nem kérünk kézi kitöltést egy olyan termékhez, ami valójában
 * benne van az OFF-ban.
 *
 * @param {string} barcode normalizált vonalkód
 * @returns {Promise<{ok: true, found: boolean, product?: object} | {ok: false, reason: string}>}
 */
export async function fetchProduct(barcode) {
  const url = `${BASE_URL}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Az OFF ismeretlen kódra 404-et VAGY 200 + status:0-t ad — mindkettő
    // ugyanazt jelenti.
    if (res.status === 404) return { ok: true, found: false };
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const body = await res.json();
    if (body?.status === 0 || !body?.product) return { ok: true, found: false };
    return { ok: true, found: true, product: mapProduct(body.product, barcode) };
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? 'timeout' : err.message };
  }
}
