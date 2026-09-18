/**
 * FitTrack Pro — HTTP biztonsági fejlécek
 * ---------------------------------------
 * Egyetlen köztes réteg, ami MINDEN válaszra ráteszi ugyanazt a néhány
 * fejlécet. Nulla új függőség (a helmet ugyanezt a néhány sort hozná el egy
 * függőség-fával), és külön modul, mert így a fejléc-készlet tesztelhető
 * anélkül, hogy szervert kellene indítani hozzá (server/headers.test.js).
 *
 * MIÉRT KELL, ha a 2026-09-13-i audit szerint az XSS-felület amúgy is szűk:
 * a fejlécek nem AZ ELSŐ, hanem a MÁSODIK védvonal. A frontend ma sehol nem
 * használ innerHTML-t — de ez holnap egy PR-ben megváltozhat, és a CSP
 * pontosan az ilyen néma visszalépést fogja meg. A nosniff és a
 * frame-ancestors pedig olyasmit tilt, amire az appnak soha nincs szüksége.
 *
 * AMIT NEM CSINÁL: CORS-t nem állít (az app egy-origin), és cache-vezérlést
 * sem (azt a statikus kiszolgáló intézi).
 */

/**
 * A Content-Security-Policy, ahogy ez az app tényleg fut.
 *
 * A megszorítások nem elvi maximumok, hanem a mért valóság:
 *   · script-src 'self' — a public/index.html EGYETLEN szkriptet tölt,
 *     `<script type="module" src="js/main.js">`; inline szkript nincs, és
 *     `onclick=` attribútum sincs a HTML-ben. Az 'unsafe-inline' tehát
 *     hiányozhat, és pont ez a direktíva ér a legtöbbet.
 *   · style-src 'unsafe-inline' KELL, és ez tudatos engedmény: a lépcsőzetes
 *     beúszás `style="--i: 0"`-val adja a sorszámot, a haladássávok pedig
 *     JS-ből írják a `style.width`-et (hat hívóhelyen — ld. TEENDOK,
 *     „Hatodik másolat ugyanabból a haladássáv-receptből"). Amíg ezek
 *     élnek, a stílus-nonce csak látszatvédelem volna.
 *   · img-src data: és blob: — a vonalkód-olvasó a kamerakép képkockáit
 *     canvasból olvassa, az export-letöltés blob-URL-t nyit.
 *   · connect-src 'self' — a böngésző SEHOVÁ nem hív ki: az Open Food Facts
 *     kérés a szerveren megy (server/openfoodfacts.js), pont ezért.
 *   · frame-ancestors 'none' + base-uri 'none' + object-src 'none' — olyan
 *     képességek, amiket az app soha nem használ.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

/* 180 nap, aldomainekre is. NEM preload: a preload-listára kerülés
   visszafordíthatatlan (hónapokig tart lekerülni), és egy hobbi-telepítésnél
   az ára nagyobb, mint a haszna. A fejléc CSAK HTTPS-en megy ki — sima
   HTTP-n a böngésző eldobja, de a kiküldése ott félrevezető naplót adna. */
const HSTS = 'max-age=15552000; includeSubDomains';

/**
 * A biztonsági fejlécek köztes rétege.
 *
 * @param {(req) => boolean} isSecure  HTTPS-en szolgáljuk-e ki a kérést
 *        (a szerver `isSecureRequest`-je: req.secure vagy x-forwarded-proto).
 *        A HSTS ettől függ, minden más mindig kimegy.
 */
export function securityHeaders(isSecure) {
  return function applySecurityHeaders(req, res, next) {
    res.setHeader('Content-Security-Policy', CSP);
    // A CSP frame-ancestors korszerűbb, de a régebbi böngészők csak ezt értik.
    res.setHeader('X-Frame-Options', 'DENY');
    // A böngésző ne találgassa a tartalomtípust: egy „szöveges" feltöltésből
    // így nem lehet futtatható szkript.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // A felhasználónevet és az azonosítókat tartalmazó útvonalak ne szivárogjanak
    // ki külső oldalra a Referer fejlécben (a gymvisual.com link kifelé mutat).
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (isSecure(req)) res.setHeader('Strict-Transport-Security', HSTS);
    next();
  };
}

export const CSP_VALUE = CSP;
export const HSTS_VALUE = HSTS;
