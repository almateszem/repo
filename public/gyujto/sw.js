/**
 * Gyűjtő — service worker
 * =======================
 * EGY dolga van: az app-héj (HTML/CSS/JS) offline is betöltődjön, hogy a
 * telefon kezdőképernyőjéről a boltban akkor is elinduljon, ha nincs net.
 *
 * A gyűjtött adat NEM itt él, hanem az IndexedDB-ben (db.js) — a service
 * worker soha nem nyúl hozzá. Az /api/* és az Open Food Facts sem cache-elődik:
 * egy régi válasz rosszabb a semminél, mert azt hinnénk, tudunk valamit a
 * termékről, holott csak a cache emlékszik rá. (Az OFF-válaszokat az app maga
 * gyorsítótárazza, lejárattal — ld. db.js → readOffCache.)
 */

const CACHE = 'gyujto-shell-v1';

/* A héj darabjai. A ZXing SZÁNDÉKOSAN nincs itt: 336 KB, és a natív
   BarcodeDetectorrel rendelkező telefonokon soha nem is töltődik le. */
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'scanner.js',
  'products.js',
  'db.js',
  'off.js',
  '../shared/barcode.js',
  '../shared/foodgroups.js',
  'manifest.webmanifest',
  'icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      // Az új verzió azonnal átveheti a helyet: a felhasználó nem tud arról,
      // hogy „be kell zárni minden fület".
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Az API a hálózaté (tilos cache-elni). A ZXing viszont KELL offline is: a
  // boltban a natív dekóder nélküli telefonon enélkül nem indulna a szkenner —
  // ezért az esik a lenti cache-first ágra, mint a héj többi darabja.
  if (url.pathname.startsWith('/api/')) return;

  /* Cache-first: a héj ritkán változik, és a boltban a gyorsaság többet ér,
     mint a frissesség. Az új verzió a következő indításnál jön be (a hálózati
     válasszal frissítjük a cache-t a háttérben). */
  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);

      return cached || fresh;
    }),
  );
});
