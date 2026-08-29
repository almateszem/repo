/**
 * FitTrack Pro — Open Food Facts proxy
 * ------------------------------------
 * A vonalkód-olvasó ebből tölti fel a „saját étel" űrlapot. A böngésző a
 * FitTrack-ben NEM hívja közvetlenül az OFF-ot, három okból:
 *   1. az OFF azonosító User-Agentet kér, amit kliensből nem lehet beállítani;
 *   2. így megmarad az app egy-origin, CORS-mentes felépítése;
 *   3. a válasz a szerveren gyorsítótárazható (barcode_cache) — ugyanazt a
 *      terméket sokan és sokszor olvassák be.
 *
 * A NORMALIZÁLÁS ÉS A LEKÉPEZÉS NEM ITT VAN: azok tiszta függvények, és a
 * public/shared/barcode.js-ben laknak, mert a **Gyűjtő** (public/gyujto/) a
 * böngészőből ugyanazokat használja. Ez a modul csak a szerver-oldali hívást
 * teszi hozzá, és az eredetihez híven újra-exportálja a közös részt, hogy a
 * hívóknak (server.js, openfoodfacts.test.js) ne kelljen tudniuk a bontásról.
 */
export { normalizeBarcode, mapProduct } from '../public/shared/barcode.js';

import { mapProduct, offProductUrl, OFF_BASE_URL } from '../public/shared/barcode.js';

// Az alap-URL env-változóból jön, hogy a teszt egy helyi stubra irányíthassa —
// a tesztcsomag nem függhet az internettől és egy külső szolgáltatás
// rendelkezésre állásától.
const BASE_URL = process.env.FITTRACK_OFF_URL || OFF_BASE_URL;
// Az OFF használati feltétele az azonosító User-Agent; névtelen kérésre 403 jár.
const USER_AGENT = process.env.FITTRACK_OFF_UA || 'FitTrackPro/0.1 (hobbi projekt)';
const TIMEOUT_MS = Number(process.env.FITTRACK_OFF_TIMEOUT_MS) || 6000;

/**
 * Egy termék lekérése az Open Food Facts-ből.
 *
 * A háromállapotú visszatérés szándékos: a „nem ismerjük" és a „most nem
 * elérhető" MÁS. Az elsőt érdemes gyorsítótárazni (holnap sem lesz benne), a
 * másodikat tilos — egy pillanatnyi hálózati hiba nem ragadhat be a cache-be.
 *
 * @returns {Promise<{ok: true, product: object|null} | {ok: false, reason: string}>}
 */
export async function fetchProduct(barcode) {
  const url = offProductUrl(barcode, { baseUrl: BASE_URL });
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Az OFF ismeretlen kódra 404-et VAGY 200 + status:0-t ad — mindkettő
    // ugyanazt jelenti, és mindkettő cache-elhető.
    if (res.status === 404) return { ok: true, product: null };
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const body = await res.json();
    if (body?.status === 0 || !body?.product) return { ok: true, product: null };
    return { ok: true, product: mapProduct(body.product, barcode) };
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? 'timeout' : err.message };
  }
}
