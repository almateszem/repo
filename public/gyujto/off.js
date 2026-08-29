/**
 * Gyűjtő — Open Food Facts a böngészőből
 * ======================================
 * Szerver nélkül a lekérdezést a telefon maga intézi. Két dolog kell hozzá,
 * amit a szerveres úton nem kellett végiggondolni:
 *
 *  1. AZONOSÍTÁS. Az OFF minden hívótól azonosítást vár, és a szerver ezt a
 *     User-Agent fejlécben küldi. A böngésző NEM állíthat User-Agentet (a fetch
 *     tiltja), ezért a dokumentált `app_name` / `app_version` lekérdezés-
 *     paramétereket használjuk (public/shared/barcode.js → offProductUrl).
 *  2. GYORSÍTÓTÁR. Nincs közös szerver-oldali cache, tehát a telefon
 *     gyorsítótáraz (IndexedDB). Ez offline is megmarad — ami a boltban többet
 *     ér, mint bármi más.
 *
 * A háromállapotú visszatérés SZÁNDÉKOS, és a szerveres verzióval azonos:
 * a „nem ismerjük" és a „most nem elérhető" MÁS. Az elsőt cache-eljük (holnap
 * sem lesz benne), a másodikat tilos — egy pillanatnyi hálózati hiba nem
 * ragadhat be, és főleg nem állíthatjuk róla, hogy a termék hiányzik.
 */
import { mapProduct, offProductUrl } from '../shared/barcode.js';
import { readOffCache, writeOffCache } from './db.js';

const APP = { name: 'FitTrack-Gyujto', version: '0.1' };
const TIMEOUT_MS = 8000;   // a boltban a mobilnet lassabb, mint egy szerveren

/**
 * Egy termék feloldása.
 * @returns {Promise<{ok: true, product: object|null, cached: boolean}
 *                  | {ok: false, reason: string}>}
 */
export async function lookup(barcode) {
  const cached = await readOffCache(barcode).catch(() => null);
  if (cached) return { ok: true, product: cached.product, cached: true };

  // Offline: meg se próbáljuk. A hívó ebből tudja, hogy nem „hiányzik" a
  // termék, csak nem tudtuk megkérdezni.
  if (!navigator.onLine) return { ok: false, reason: 'offline' };

  try {
    const res = await fetch(offProductUrl(barcode, { app: APP }), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Az OFF ismeretlen kódra 404-et VAGY 200 + status:0-t ad — mindkettő
    // ugyanazt jelenti, és mindkettő cache-elhető.
    if (res.status === 404) {
      await writeOffCache(barcode, null);
      return { ok: true, product: null, cached: false };
    }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const body = await res.json();
    const product = body?.status === 0 || !body?.product
      ? null
      : mapProduct(body.product, barcode);

    await writeOffCache(barcode, product);
    return { ok: true, product, cached: false };
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? 'timeout' : err.message };
  }
}
