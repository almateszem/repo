/**
 * Gyűjtő — service worker
 * =======================
 * EGY dolga van: az app-héj (HTML/CSS/JS) offline is betöltődjön, hogy a
 * telefon kezdőképernyőjéről a boltban akkor is elinduljon, ha nincs net. A
 * gyűjtött adat NEM itt él — az a localStorage-beli sorban és a szerveren
 * (ld. app.js → queue).
 *
 * Az /api/* SOHA nem cache-elődik. Egy régi termék-lista rosszabb a semminél:
 * azt hinnénk, hogy egy kód már megvan, holott csak a cache emlékszik rá. Az
 * offline dedupláláshoz a kódlista van (localStorage), az frissül és látszik is.
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
  // Az API és a lustán töltött ZXing a hálózaté — az elsőt tilos, a másodikat
  // fölösleges cache-elni.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/vendor/')) return;

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
