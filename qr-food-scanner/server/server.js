/**
 * QR Food Scanner — szerver
 * -------------------------
 * Az app folyamata három végpontra épül:
 *   GET  /api/lookup/:barcode  — benne van-e a kód az Open Food Facts-ben?
 *   POST /api/products         — az OFF által nem ismert termék makrói → helyi DB
 *   GET  /api/products         — a helyi adatbázis tartalma (visszajelzés)
 *
 * A szerver azért kell egyáltalán, mert (1) az OFF azonosító User-Agentet vár,
 * amit böngészőből nem lehet küldeni, és (2) a kamera csak biztonságos
 * kontextusban indul — a localhost az.
 */
import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { normalizeBarcode, fetchProduct } from './openfoodfacts.js';
import { validateProduct } from './validate.js';
import { getProduct, saveProduct, listProducts } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.QRFS_PORT) || 4173;

export const app = express();
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(ROOT, 'public')));

/* A ZXing UMD a node_modules-ból megy ki — a dekóderre csak azokon a
   böngészőkön van szükség, ahol nincs natív BarcodeDetector (asztali Chrome
   Windowson, Firefox, Safari). Ha a csomag nincs telepítve, az app működik: a
   natív dekóder és a kézi beírás akkor is megvan. Két helyen keressük, mert a
   telepítés a repó gyökerébe is felkúszhat (npm workspaces / közös install). */
const ZXING_DIRS = [
  path.join(ROOT, 'node_modules', '@zxing', 'library', 'umd'),
  path.join(ROOT, '..', 'node_modules', '@zxing', 'library', 'umd'),
];
const zxingDir = ZXING_DIRS.find((dir) => existsSync(dir));
if (zxingDir) app.use('/vendor/zxing', express.static(zxingDir, { maxAge: '1y', immutable: true }));

/**
 * A beolvasott kód ellenőrzése.
 *
 * A válasz `inOpenFoodFacts` mezője dönti el a folyamat irányát: igaz esetén a
 * kliens csak kiírja, hogy benne van, és visszadob a szkennerre; hamis esetén
 * jön a makró-űrlap. A `saved` a helyi adatbázis sora (ha korábban már
 * kitöltötted ezt a terméket) — ezzel tölti elő az űrlapot.
 */
app.get('/api/lookup/:barcode', async (req, res) => {
  const barcode = normalizeBarcode(req.params.barcode);
  if (!barcode) {
    return res.status(400).json({ error: 'Érvénytelen vonalkód (hossz vagy ellenőrzőszám).' });
  }

  const result = await fetchProduct(barcode);
  /* Hálózati hiba NEM „nincs benne": ilyenkor kézi kitöltést kérnénk egy olyan
     termékhez, ami valójában benne van az OFF-ban. Inkább hibát mondunk. */
  if (!result.ok) {
    return res.status(503).json({
      error: 'Az Open Food Facts most nem elérhető, próbáld újra.',
      reason: result.reason,
    });
  }

  return res.json({
    barcode,
    inOpenFoodFacts: result.found,
    product: result.product ?? null,
    saved: getProduct(barcode) ?? null,
  });
});

/** Az OFF által nem ismert termék mentése a helyi adatbázisba. */
app.post('/api/products', (req, res) => {
  const barcode = normalizeBarcode(req.body?.barcode);
  if (!barcode) return res.status(400).json({ error: 'Érvénytelen vonalkód.' });

  const check = validateProduct(req.body, barcode);
  if (!check.ok) return res.status(400).json({ error: check.error });

  return res.status(201).json({ product: saveProduct(check.value) });
});

/** A helyi adatbázis tartalma — hogy a mentés látható is legyen, ne csak megtörténjen. */
app.get('/api/products', (req, res) => {
  res.json({ products: listProducts() });
});

// A szerver csak akkor indul el, ha közvetlenül futtatják — a tesztek
// importálják az `app`-ot, és saját, véletlen porton nyitnak listenert.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  app.listen(PORT, () => {
    console.log(`QR Food Scanner — http://localhost:${PORT}`);
    if (!zxingDir) {
      console.log('Megjegyzés: a ZXing nincs telepítve (npm install) — a natív '
        + 'dekóder és a kézi beírás így is működik.');
    }
  });
}
