/**
 * Gyűjtő — adatbázis a TELEFONON (IndexedDB)
 * ==========================================
 * Nincs szerver, nincs fiók, nincs szinkron. A gyűjtés ITT él, a telefon saját
 * adatbázisában, és csak akkor mozdul, amikor te mondod: „Feltöltés a
 * FitTrack-be" vagy „Mentés fájlba".
 *
 * MIÉRT IndexedDB és nem localStorage? A localStorage szinkron (minden írás
 * megakasztja a felületet — szkennelés közben ez látszik), ~5 MB-os, és mindent
 * sztringgé alakít. Az IndexedDB aszinkron, nagyságrendekkel többet bír, és
 * indexelve keres — a „megvan-e már ez a vonalkód" kérdés így akkor is azonnali,
 * ha ezer termék van bent.
 *
 * AMIT TUDNI KELL A TÁROLÁSRÓL (és ezért mondja ki a felület is):
 * a böngésző a saját adatait KITÖRÖLHETI. iOS-en a Safari 7 nap tétlenség után
 * takarít — KIVÉVE, ha az oldal ki van téve a kezdőképernyőre. Ezért kéri az
 * app a kihelyezést, és ezért van „Mentés fájlba": a gyűjtés hetek munkája,
 * annak kell legyen egy másolata a böngészőn kívül is.
 */

const DB_NAME = 'gyujto';
const DB_VERSION = 1;

/** A tárolók. A `products` kulcsa a vonalkód: egy termék = egy sor, mindig. */
const STORE_PRODUCTS = 'products';
/** Szkennelés-napló: mit néztünk már meg (a megtaláltakat is). */
const STORE_SCANS = 'scans';
/** Open Food Facts válaszok gyorsítótára — offline is megmarad. */
const STORE_OFF = 'offcache';

let dbPromise = null;

/** A kapcsolat (egyszer nyitjuk, utána mindenki ezt kapja). */
function open() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const products = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'barcode' });
        // A lista állapot szerint szűr, a keresés név szerint rendez — mindkettő
        // indexből, hogy ezer tételnél se kelljen végigolvasni a tárolót.
        products.createIndex('status', 'status');
        products.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains(STORE_SCANS)) {
        db.createObjectStore(STORE_SCANS, { keyPath: 'id', autoIncrement: true })
          .createIndex('barcode', 'barcode');
      }
      if (!db.objectStoreNames.contains(STORE_OFF)) {
        db.createObjectStore(STORE_OFF, { keyPath: 'barcode' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Privát ablakban (és letiltott sütiknél) az IndexedDB blokkolódhat: inkább
    // beszédes hibát adunk, mint hogy az app némán ne mentsen.
    request.onblocked = () => reject(new Error('Az adatbázis zárolva van — zárd be az app többi fülét.'));
  });

  return dbPromise;
}

/** Egy tranzakció ígéretbe csomagolva. */
async function tx(storeNames, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('A mentés megszakadt.'));
    // A visszaadott érték a TRANZAKCIÓ LEZÁRÁSA után oldódik fel, nem előbb:
    // különben az app „mentve"-t mutatna olyan íráson, ami még elszállhat.
    result = fn(...storeNames.map((name) => transaction.objectStore(name)));
    if (result instanceof Promise) reject(new Error('A tranzakció-visszahívás nem lehet async.'));
  });
}

/** Egy IDBRequest ígéretként. */
const req = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/* ======================================================================
   Termékek
   ====================================================================== */

/** Minden termék, legutóbb módosított elöl. */
export async function allProducts() {
  const db = await open();
  const items = await req(db.transaction(STORE_PRODUCTS).objectStore(STORE_PRODUCTS).getAll());
  return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProduct(barcode) {
  const db = await open();
  return req(db.transaction(STORE_PRODUCTS).objectStore(STORE_PRODUCTS).get(barcode)) ?? null;
}

/** Megvan-e már ez a vonalkód? Ez a legforgalmasabb kérdés az egész appban. */
export async function hasProduct(barcode) {
  const db = await open();
  const count = await req(db.transaction(STORE_PRODUCTS).objectStore(STORE_PRODUCTS).count(barcode));
  return count > 0;
}

/**
 * Termék mentése. A kulcs a vonalkód, tehát ugyanaz a kód FRISSÍT, nem duplikál.
 * A `collectedAt` (az első felmérés ideje) megmarad — ez dönti el a feltöltésnél
 * az ütközést, és nem szabad, hogy egy későbbi apró javítás „frissebbé" tegye.
 */
export async function saveProduct(product) {
  const now = new Date().toISOString();
  const existing = await getProduct(product.barcode);
  const row = {
    ...product,
    collectedAt: existing?.collectedAt ?? now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await tx([STORE_PRODUCTS], 'readwrite', (store) => { store.put(row); });
  return row;
}

export async function deleteProduct(barcode) {
  await tx([STORE_PRODUCTS], 'readwrite', (store) => { store.delete(barcode); });
}

/** A feltöltés/export után: a kivitt tételek megjelölése. */
export async function markUploaded(barcodes) {
  const now = new Date().toISOString();
  const db = await open();
  const transaction = db.transaction(STORE_PRODUCTS, 'readwrite');
  const store = transaction.objectStore(STORE_PRODUCTS);
  for (const barcode of barcodes) {
    const row = await req(store.get(barcode));
    // Csak azt jelöljük, ami tényleg kész: egy közben piszkozattá visszaírt
    // tétel nem mondhatja magáról, hogy már felment.
    if (row && row.status === 'kesz') store.put({ ...row, status: 'feltoltve', uploadedAt: now });
  }
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

/* ======================================================================
   Szkennelés-napló
   ====================================================================== */

export async function logScan(barcode, outcome) {
  await tx([STORE_SCANS], 'readwrite', (store) => {
    store.add({ barcode, outcome, scannedAt: new Date().toISOString() });
  });
}

/** Hány szkennelés volt ma — a felület számlálójához. */
export async function countScansToday() {
  const db = await open();
  const all = await req(db.transaction(STORE_SCANS).objectStore(STORE_SCANS).getAll());
  const today = new Date().toISOString().slice(0, 10);
  return all.filter((scan) => String(scan.scannedAt).startsWith(today)).length;
}

/* ======================================================================
   Open Food Facts gyorsítótár
   ----------------------------------------------------------------------
   A NEGATÍV találatot is tároljuk (found: false): enélkül minden újraolvasás
   új hálózati kérés lenne egy nem létező termékre — pont a boltban, ahol a net
   a leglassabb. Egy hét után újrakérdezzük: az OFF-ban folyamatosan javítják
   a tápértékeket.
   ====================================================================== */

const OFF_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

export async function readOffCache(barcode) {
  const db = await open();
  const row = await req(db.transaction(STORE_OFF).objectStore(STORE_OFF).get(barcode));
  if (!row) return null;
  if (Date.now() - Date.parse(row.fetchedAt) > OFF_CACHE_MS) return null;
  return row;
}

export async function writeOffCache(barcode, product) {
  await tx([STORE_OFF], 'readwrite', (store) => {
    store.put({ barcode, found: Boolean(product), product: product ?? null, fetchedAt: new Date().toISOString() });
  });
}

/* ======================================================================
   Mentés / visszatöltés fájlba
   ====================================================================== */

/** A teljes gyűjtés egy exportálható objektumban. */
export async function exportAll() {
  return {
    format: 'gyujto-v1',
    exportedAt: new Date().toISOString(),
    products: await allProducts(),
  };
}

/**
 * Egy korábbi export visszatöltése — ez fésüli össze KÉT TELEFON gyűjtését is.
 * Ütközéskor a frissebb FELMÉRÉS nyer (collectedAt), nem a későbbi import:
 * a másik telefon régebbi adata nem írhatja felül a tegnapi, pontosabbat.
 *
 * @returns {{added: number, updated: number, skipped: number}}
 */
export async function importAll(data) {
  const items = Array.isArray(data?.products) ? data.products : null;
  if (!items) throw new Error('Ez nem Gyűjtő-mentés: hiányzik a `products` lista.');

  const stats = { added: 0, updated: 0, skipped: 0 };
  const db = await open();
  const transaction = db.transaction(STORE_PRODUCTS, 'readwrite');
  const store = transaction.objectStore(STORE_PRODUCTS);

  for (const item of items) {
    if (!item?.barcode || !item?.name) { stats.skipped += 1; continue; }
    const prev = await req(store.get(item.barcode));
    if (prev && String(prev.collectedAt ?? '') >= String(item.collectedAt ?? '')) {
      stats.skipped += 1;
      continue;
    }
    store.put(item);
    if (prev) stats.updated += 1;
    else stats.added += 1;
  }

  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  return stats;
}

/** Csak a tesztnek és a „minden törlése" gombnak. */
export async function clearAll() {
  await tx([STORE_PRODUCTS, STORE_SCANS, STORE_OFF], 'readwrite', (p, s, o) => {
    p.clear(); s.clear(); o.clear();
  });
}
