/**
 * FitTrack Pro — vonalkódos bolti termékek (GENERÁLT FÁJL)
 * ========================================================
 * NE SZERKESZD KÉZZEL. Ezt a fájlt a Gyűjtő export-szkriptje írja:
 *
 *     node gyujto/scripts/export-products.js
 *
 * Mi ez? A beépített étel-katalógus (server/data/foods.hu.js) ÁLTALÁNOS
 * referenciaértékeket ad — „Csirkemell (nyers)", „Tejföl 20%". Egy konkrét
 * bolti termék ettől 100 kcal-t is eltérhet, és a magyar polcok jelentős része
 * az Open Food Facts-ben sincs benne. Ezeket járjuk körbe és szkenneljük be a
 * Gyűjtővel (gyujto/), a kész tételek pedig ide kerülnek.
 *
 * Hova illeszkedik? A `/api/foods/barcode/:code` végpont sorrendje:
 *     saját étel → **ez a fájl** → barcode_cache → Open Food Facts
 * Vagyis a begyűjtött termék HÁLÓZAT NÉLKÜL is felismerhető, és nem hígítja az
 * általános katalógust: névre keresve nem jön elő, csak vonalkódra.
 *
 * A mezők megegyeznek az Open Food Facts leképezésének kimenetével
 * (server/openfoodfacts.js → mapProduct), hogy a felület számára a két forrás
 * megkülönböztethetetlen legyen. A tápértékek 100 g / 100 ml alapmennyiségre
 * értendők.
 */

/** @type {Array<{barcode: string, name: string, brand: string, group: string,
 *   unit: 'g'|'ml', kcal: number, protein: number, carbs: number, fat: number,
 *   portions: Array<[string, number]>, source: string}>} */
export const barcodeProducts = [
  // Ide generálódnak a Gyűjtő kész tételei. Amíg üres, a végpont ugyanúgy
  // működik, mint eddig — egyszerűen nincs helyi találat.
];
