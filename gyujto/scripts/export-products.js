#!/usr/bin/env node
/**
 * Gyűjtő → FitTrack: a kész tételek kivitele
 * ==========================================
 * Ez a szkript a visszaút. A boltokban összegyűjtött, KÉSZ (teljes tápértékű)
 * termékekből legenerálja a `server/data/products.barcode.js` fájlt, amit a fő
 * app a vonalkód-feloldásnál az Open Food Facts ELŐTT néz meg.
 *
 * Két dolgot csinál, ebben a sorrendben:
 *   1. kiírja a fájlt — TELJES pillanatképként, a korábban már exportált
 *      tételekkel EGYÜTT. Ez fontos: ha csak az újakat írnánk ki, a második
 *      futás törölné az elsőt. A fájl így mindig önmagában teljes;
 *   2. a `kesz` sorokat `exportalva` állapotba viszi — ettől látszik a
 *      felületen, mi ment már át, és mi vár még.
 *
 * Kapcsolók:
 *   --dry-run   nem ír fájlt és nem módosít állapotot, csak megmondja, mi lenne
 *   --out <út>  másik célfájl (alapból ../server/data/products.barcode.js)
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawDb, listProducts, markExported } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const outIndex = args.indexOf('--out');
const OUT_PATH = outIndex >= 0 && args[outIndex + 1]
  ? path.resolve(args[outIndex + 1])
  : path.join(__dirname, '..', '..', 'server', 'data', 'products.barcode.js');

/** Egy tétel a fő app által várt alakban (= mapProduct kimenete + kategória). */
const toEntry = (p) => ({
  barcode: p.barcode,
  name: p.name,
  brand: p.brand,
  group: p.group,
  unit: p.unit,
  kcal: p.kcal,
  protein: p.protein,
  carbs: p.carbs,
  fat: p.fat,
  portions: p.portions,
  // A forrás megmarad: a FitTrack űrlapja ebből tudja kiírni, hogy a
  // tápérték a mi bolti gyűjtésünkből való, nem az Open Food Facts-ből.
  source: 'gyujto',
});

/* A fájl TELJES pillanatkép: a most kész és a korábban már kivitt tételek
   együtt. Ezért olvassuk mindkét állapotot. */
const kesz = listProducts({ status: 'kesz', limit: 100000 });
const korabbi = listProducts({ status: 'exportalva', limit: 100000 });

const entries = [...korabbi, ...kesz]
  .map(toEntry)
  .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

const HEADER = `/**
 * FitTrack Pro — vonalkódos bolti termékek (GENERÁLT FÁJL)
 * ========================================================
 * NE SZERKESZD KÉZZEL. Ezt a fájlt a Gyűjtő export-szkriptje írja:
 *
 *     node gyujto/scripts/export-products.js
 *
 * Mi ez? A beépített étel-katalógus (server/data/foods.hu.js) ÁLTALÁNOS
 * referenciaértékeket ad. Egy konkrét bolti termék ettől 100 kcal-t is
 * eltérhet, és a magyar polcok jelentős része az Open Food Facts-ben sincs
 * benne. Ezeket járjuk körbe és szkenneljük be a Gyűjtővel (gyujto/).
 *
 * Hova illeszkedik? A \`/api/foods/barcode/:code\` végpont sorrendje:
 *     saját étel → **ez a fájl** → barcode_cache → Open Food Facts
 * Vagyis a begyűjtött termék HÁLÓZAT NÉLKÜL is felismerhető, és nem hígítja az
 * általános katalógust: névre keresve nem jön elő, csak vonalkódra.
 *
 * A mezők megegyeznek az Open Food Facts leképezésének kimenetével
 * (server/openfoodfacts.js → mapProduct). A tápértékek 100 g / 100 ml
 * alapmennyiségre értendők.
 *
 * Generálva: ${new Date().toISOString().slice(0, 10)} — ${entries.length} termék
 */

/** @type {Array<{barcode: string, name: string, brand: string, group: string,
 *   unit: 'g'|'ml', kcal: number, protein: number, carbs: number, fat: number,
 *   portions: Array<[string, number]>, source: string}>} */
export const barcodeProducts = [
`;

/* Soronként egy termék, JSON-ból. A JSON.stringify idézőjelezése itt előny:
   a magyar neveket (aposztróf, idézőjel) biztosan helyesen escape-eli, és a
   fájl gépi eredete a formázásból is látszik. */
const body = entries.map((entry) => `  ${JSON.stringify(entry)},`).join('\n');
const contents = `${HEADER}${body}${body ? '\n' : ''}];\n`;

if (dryRun) {
  console.log(`[próba] ${entries.length} termék kerülne a fájlba `
    + `(${kesz.length} új, ${korabbi.length} korábbi).`);
  console.log(`[próba] célfájl: ${OUT_PATH}`);
  process.exit(0);
}

writeFileSync(OUT_PATH, contents, 'utf8');

/* Az állapotváltás CSAK a sikeres írás után. Fordított sorrendben egy megtelt
   lemez azt jelentené, hogy a tételek „exportálva" állapotban ragadnak, holott
   sehol nincsenek. */
const marked = markExported(kesz.map((p) => p.id));

console.log(`Kiírva: ${OUT_PATH}`);
console.log(`${entries.length} termék a fájlban (${marked} új tétel most került át).`);
if (!entries.length) {
  console.log('Még nincs kész tétel — gyűjts be párat, vagy egészítsd ki a piszkozatokat.');
}

// A DB-kapcsolatot magunk zárjuk: enélkül a WAL-fájlok a szkript után is ott
// maradnának a lemezen.
rawDb.close();
