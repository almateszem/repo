/**
 * QR Food Scanner — kliens
 * ------------------------
 * A folyamat egyetlen körből áll, és mindig ugyanoda tér vissza:
 *
 *   [szkenner] --kód--> /api/lookup
 *        ^                  |
 *        |    benne van ────┘── nincs benne ──> [makró-táblázat] ──mentés──┐
 *        └───────────────────────────────────────────────────────────────┘
 *
 * A dekódolás három szinten próbálkozik: natív BarcodeDetector → lustán
 * betöltött ZXing → kézi beírás. A harmadik nem vészmegoldás: sima http-n
 * (a gép LAN-IP-jéről nézve) a böngésző a kamerát oda sem adja.
 */

const $ = (selector, scope = document) => scope.querySelector(selector);

/* ---- QR ÉS vonalkód: az élelmiszer-csomagoláson EAN/UPC van, a kérdés viszont
   „QR-kód" volt — mindkettőt olvassuk, hogy egyik se maradjon ki. A lista
   szűkítése nem kozmetika: minden formátum külön dekódert futtat képkockánként. */
const NATIVE_FORMATS = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const ZXING_URL = '/vendor/zxing/index.min.js';
// ~8 kép/mp: a dekódolás CPU-igényes, 60 fps-en a telefon akkuja fogyna el.
const SCAN_INTERVAL_MS = 120;
const SCAN_CANVAS_W = 640;
/** Mennyi ideig áll meg a „benne van" üzenet, mielőtt visszadob a szkennerre. */
const BACK_TO_SCANNER_MS = 1800;

/** A getUserMedia hibái emberi nyelven — az `err.name` pontos, de semmit nem mond. */
const CAMERA_ERRORS = {
  NotAllowedError: 'A kamerához nem adtál engedélyt. A böngésző címsorában visszavonhatod '
    + 'a tiltást — addig írd be a kódot kézzel.',
  SecurityError: 'A böngésző letiltotta a kamerát ezen az oldalon.',
  NotFoundError: 'Nem találtunk kamerát ezen az eszközön.',
  OverconstrainedError: 'Nem találtunk használható hátsó kamerát.',
  NotReadableError: 'A kamerát épp egy másik alkalmazás használja.',
};

/* ====================================================================== *
 * Elemek
 * ====================================================================== */
const views = { scanner: $('[data-view="scanner"]'), form: $('[data-view="form"]') };
const bannerEl = $('[data-banner]');
const stage = $('[data-stage]');
const video = $('[data-video]');
const torchBtn = $('[data-torch]');
const statusEl = $('[data-status]');
const errorEl = $('[data-error]');
const restartBtn = $('[data-restart]');
const manualForm = $('[data-manual]');
const manualInput = $('[data-manual-input]');
const savedList = $('[data-saved-list]');
const savedCount = $('[data-saved-count]');

const macroForm = $('[data-macro-form]');
const formBarcode = $('[data-form-barcode]');
const formError = $('[data-form-error]');
const baseLabel = $('[data-base-label]');
const fields = {
  name: $('[data-field-name]'),
  unit: $('[data-field-unit]'),
  protein: $('[data-field-protein]'),
  carbs: $('[data-field-carbs]'),
  fat: $('[data-field-fat]'),
  kcal: $('[data-field-kcal]'),
};
const kcalState = $('[data-kcal-state]');
const kcalReset = $('[data-kcal-reset]');

/* ====================================================================== *
 * Apró segédek
 * ====================================================================== */
const showView = (name) => {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
};

const setBanner = (text, kind = '') => {
  bannerEl.hidden = !text;
  bannerEl.innerHTML = text || '';
  bannerEl.className = `banner${kind ? ` banner--${kind}` : ''}`;
};

const setStatus = (text) => { statusEl.textContent = text; };
const setError = (text) => {
  errorEl.textContent = text || '';
  errorEl.hidden = !text;
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));

/** JSON-hívás: a szerver hibaüzenete (magyarul) fontosabb, mint a státuszkód. */
async function api(url, options) {
  const res = await fetch(url, options);
  let body = null;
  try { body = await res.json(); } catch { /* üres vagy nem JSON válasz */ }
  if (!res.ok) throw new Error(body?.error || `Hiba (HTTP ${res.status}).`);
  return body;
}

/** Egyszeri, lusta szkript-betöltés (a ZXing 336 KB — csak ha tényleg kell). */
const loadScript = (src) => new Promise((resolve, reject) => {
  if (document.querySelector(`script[src="${src}"]`)) return resolve();
  const el = document.createElement('script');
  el.src = src;
  el.onload = () => resolve();
  el.onerror = () => reject(new Error(`Nem sikerült betölteni: ${src}`));
  document.head.append(el);
});

/* ====================================================================== *
 * Szkenner
 * ====================================================================== */
let stream = null;
let rafId = 0;
let canvas = null;
let zxingReader = null;
let scanning = false;

/* A legkritikusabb függvény az egész felületen. Track-stop nélkül a kamera-LED
   égve marad (a felhasználó joggal hiszi, hogy figyeljük), és a KÖVETKEZŐ
   indítás NotReadableError-t kap, mert az eszköz még foglalt. Ezért minden
   kilépési út ezen megy át. */
function stopCamera() {
  scanning = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  if (zxingReader) { try { zxingReader.reset(); } catch { /* nincs mit tenni */ } }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
  stage.hidden = true;
  torchBtn.hidden = true;
  torchBtn.setAttribute('aria-pressed', 'false');
}

/** ZXing-alapú dekóder a canvas-képkockára — ha nincs natív BarcodeDetector. */
function createZxingDetector() {
  const ZX = window.ZXing;
  if (!ZX?.MultiFormatReader) throw new Error('A ZXing dekóder nem érhető el.');

  const reader = new ZX.MultiFormatReader();
  reader.setHints(new Map([
    [ZX.DecodeHintType.POSSIBLE_FORMATS, [
      ZX.BarcodeFormat.QR_CODE, ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8,
      ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128,
    ]],
    // A csomagolás ritkán fekszik síkban a kamera előtt; a TRY_HARDER a ferde
    // és a gyengébb kontrasztú képet is megpróbálja.
    [ZX.DecodeHintType.TRY_HARDER, true],
  ]));
  zxingReader = reader;

  return (videoEl) => {
    if (!videoEl.videoWidth) return null;
    if (!canvas) canvas = document.createElement('canvas');
    // 640 px bőven elég a dekódoláshoz, a nagyobb kép képkockánként
    // milliszekundumokat vinne el.
    const scale = SCAN_CANVAS_W / videoEl.videoWidth;
    canvas.width = SCAN_CANVAS_W;
    canvas.height = Math.round(videoEl.videoHeight * scale);
    canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    const source = new ZX.HTMLCanvasElementLuminanceSource(canvas);
    const bitmap = new ZX.BinaryBitmap(new ZX.HybridBinarizer(source));
    try {
      return reader.decodeWithState(bitmap).getText();
    } catch {
      // NotFoundException minden olyan képkockán, amin nincs kód — ez a
      // szkennelés NORMÁLIS állapota, nem hiba.
      return null;
    }
  };
}

/** A használható dekóder: natív, ha van, különben lustán betöltött ZXing. */
async function createDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
      if (formats.length) {
        const detector = new window.BarcodeDetector({ formats });
        // A natív detect() közvetlenül a <video>-t is elfogadja — nem kell canvas.
        return async (videoEl) => (await detector.detect(videoEl))[0]?.rawValue ?? null;
      }
    } catch {
      // Van BarcodeDetector, de nincs mögötte platform-támogatás — essünk
      // vissza a ZXingre, ne rögtön a kézi beírásra.
    }
  }
  await loadScript(ZXING_URL);
  return createZxingDetector();
}

/** Vaku — csak ott, ahol az eszköz tudja (jellemzően telefonok hátsó kamerája). */
function setupTorch(track) {
  const capabilities = track.getCapabilities?.() ?? {};
  if (!('torch' in capabilities)) return;

  torchBtn.hidden = false;
  let torchOn = false;
  torchBtn.onclick = async () => {
    torchOn = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    } catch {
      // Néhány eszköz jelenti a képességet, de az alkalmazása mégis elbukik.
      torchOn = false;
    }
    torchBtn.setAttribute('aria-pressed', String(torchOn));
  };
}

/** A kamera indítása és a dekódoló ciklus. A beolvasott kód `handleCode`-ba megy. */
async function startScanner() {
  showView('scanner');
  restartBtn.hidden = true;
  setError('');
  manualInput.value = '';
  setStatus('Kamera indítása…');

  /* A getUserMedia CSAK biztonságos kontextusban él: https VAGY localhost.
     Sima http-n, a gép LAN-IP-jéről a böngésző NEM ad kamerát. Ezt ki kell
     mondani: enélkül „nem működik a szkenner"-ként jelentik. */
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    setStatus('');
    setError('A kamera csak https-en vagy localhoston érhető el — írd be a kódot kézzel.');
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
  } catch (err) {
    setStatus('');
    setError(CAMERA_ERRORS[err.name] || 'A kamerát nem sikerült elindítani — írd be a kódot kézzel.');
    return;
  }

  video.srcObject = stream;
  stage.hidden = false;
  try {
    await video.play();
  } catch {
    // Az autoplay-tiltás némított videónál ritka, és nem végzetes: a képkockák
    // a dekódoló ciklusban akkor is elérhetők lehetnek.
  }
  setupTorch(stream.getVideoTracks()[0]);

  let detect;
  try {
    setStatus('Dekóder betöltése…');
    detect = await createDetector();
  } catch {
    stopCamera();
    setStatus('');
    setError('A dekódert nem sikerült betölteni — írd be a kódot kézzel.');
    return;
  }
  setStatus('Irányítsd a kamerát a termék kódjára.');

  /* requestAnimationFrame, nem setInterval: a rAF magától megáll, ha a fül
     háttérbe kerül vagy a képernyő lezár — a setInterval a telefon akkuját
     égetné dekódolással egy fekete képkockán. */
  scanning = true;
  let lastRun = 0;
  let busy = false;
  let lastCode = null;

  const tick = async (now) => {
    if (!scanning) return;
    rafId = requestAnimationFrame(tick);
    if (!stream || busy || now - lastRun < SCAN_INTERVAL_MS) return;
    lastRun = now;
    busy = true;
    try {
      const code = await detect(video);
      /* KÉT egymás utáni azonos leolvasás kell. Egyetlen képkocka
         félreolvasása így nem visz be rossz terméket — a mod-10 ellenőrzőszám
         sem fog ki minden hibán. */
      if (code && code === lastCode) {
        navigator.vibrate?.(30);
        stopCamera();
        handleCode(code);
        return;
      }
      lastCode = code;
    } catch {
      // Képkockánkénti hiba: a következőn újrapróbáljuk.
    } finally {
      busy = false;
    }
  };
  rafId = requestAnimationFrame(tick);
}

// Háttérbe került fül: a rAF magától megáll, a kamera-LED viszont nem.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && stream) {
    stopCamera();
    setStatus('');
    restartBtn.hidden = false;
    setError('A beolvasás megszakadt (a fül háttérbe került).');
  }
});
window.addEventListener('beforeunload', stopCamera);

/* ====================================================================== *
 * A folyamat: ellenőrzés → „benne van" vagy makró-táblázat
 * ====================================================================== */
let backToScannerTimer = 0;

/** A „benne van" / „mentve" üzenet után visszadob a szkennerre. */
function backToScannerSoon() {
  clearTimeout(backToScannerTimer);
  backToScannerTimer = setTimeout(() => {
    setBanner('');
    startScanner();
  }, BACK_TO_SCANNER_MS);
}

/**
 * Egy beolvasott (vagy kézzel beírt) kód feldolgozása.
 * Ez az app egyetlen elágazása: benne van az OFF-ban, vagy sem.
 */
async function handleCode(rawCode) {
  showView('scanner');
  setStatus('Ellenőrzés az Open Food Facts-ben…');
  setError('');
  setBanner('');

  let result;
  try {
    result = await api(`/api/lookup/${encodeURIComponent(rawCode)}`);
  } catch (err) {
    setStatus('');
    restartBtn.hidden = false;
    setError(err.message);
    return;
  }

  if (result.inOpenFoodFacts) {
    // Kész: kiírjuk, hogy benne van, és megyünk vissza a szkennerre.
    const name = result.product?.name ? escapeHtml(result.product.name) : 'Termék';
    setBanner(`✓ Benne van az Open Food Facts-ben<small>${name} · ${result.barcode}</small>`, 'ok');
    setStatus('Vissza a beolvasáshoz…');
    backToScannerSoon();
    return;
  }

  // Nincs benne: makró-táblázat.
  openMacroForm(result.barcode, result.saved);
}

/* ====================================================================== *
 * Makró-táblázat
 * ====================================================================== */
/* A kalóriát a makrókból számoljuk (Atwater 4/4/9) és élőben mutatjuk, de a
   mező szerkeszthető: a csomagoláson lévő érték a rost, a poliolok és az
   alkohol miatt jogosan eltérhet a képlettől. A ↻ visszakapcsol automatikusra. */
const ATWATER = { protein: 4, carbs: 4, fat: 9 };
let kcalAuto = true;

const numOf = (input) => {
  const value = Number(String(input.value).replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
};

function refreshKcal() {
  if (!kcalAuto) return;
  const kcal = Math.round(
    numOf(fields.protein) * ATWATER.protein
    + numOf(fields.carbs) * ATWATER.carbs
    + numOf(fields.fat) * ATWATER.fat,
  );
  fields.kcal.value = String(kcal);
}

for (const key of ['protein', 'carbs', 'fat']) {
  fields[key].addEventListener('input', refreshKcal);
}
fields.kcal.addEventListener('input', () => {
  kcalAuto = false;
  kcalState.textContent = 'kézzel megadva';
  kcalReset.hidden = false;
});
kcalReset.addEventListener('click', () => {
  kcalAuto = true;
  kcalState.textContent = 'a makrókból számolva';
  kcalReset.hidden = true;
  refreshKcal();
});
fields.unit.addEventListener('change', () => {
  baseLabel.textContent = `100 ${fields.unit.value}`;
});

/**
 * Az űrlap megnyitása egy ismeretlen termékhez.
 * @param {string} barcode
 * @param {object|null} saved  korábban mentett sor — ilyenkor javítunk, nem újat viszünk fel
 */
function openMacroForm(barcode, saved) {
  macroForm.dataset.barcode = barcode;
  formBarcode.textContent = barcode;
  formError.hidden = true;

  fields.name.value = saved?.name ?? '';
  fields.unit.value = saved?.unit ?? 'g';
  fields.protein.value = saved?.protein ?? '';
  fields.carbs.value = saved?.carbs ?? '';
  fields.fat.value = saved?.fat ?? '';
  fields.kcal.value = saved?.kcal ?? '';
  baseLabel.textContent = `100 ${fields.unit.value}`;

  // Mentett terméknél a kalória a mentett érték marad, amíg hozzá nem nyúlunk.
  kcalAuto = !saved;
  kcalState.textContent = saved ? 'a korábbi mentésből' : 'a makrókból számolva';
  kcalReset.hidden = !saved;

  setBanner(saved
    ? 'Ez a termék nincs az Open Food Facts-ben, de már mentetted — az adatok javíthatók.'
    : '');
  showView('form');
  fields.name.focus();
}

macroForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitBtn = $('button[type="submit"]', macroForm);
  formError.hidden = true;
  submitBtn.disabled = true;

  try {
    const { product } = await api('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        barcode: macroForm.dataset.barcode,
        name: fields.name.value,
        unit: fields.unit.value,
        protein: fields.protein.value,
        carbs: fields.carbs.value,
        fat: fields.fat.value,
        kcal: fields.kcal.value,
      }),
    });
    setBanner(`✓ Mentve a helyi adatbázisba<small>${escapeHtml(product.name)} · ${product.barcode}</small>`, 'ok');
    await refreshSaved();
    showView('scanner');
    setStatus('Vissza a beolvasáshoz…');
    backToScannerSoon();
  } catch (err) {
    formError.textContent = err.message;
    formError.hidden = false;
  } finally {
    submitBtn.disabled = false;
  }
});

$('[data-form-cancel]').addEventListener('click', () => {
  setBanner('');
  startScanner();
});

/* ====================================================================== *
 * A helyi adatbázis listája — hogy a mentés látható is legyen
 * ====================================================================== */
async function refreshSaved() {
  let products = [];
  try {
    ({ products } = await api('/api/products'));
  } catch {
    // A lista csak visszajelzés: ha nem jön meg, a folyamat működik nélküle is.
    return;
  }
  savedCount.textContent = String(products.length);
  savedList.innerHTML = products.length
    ? products.map((p) => `
      <li>
        <strong>${escapeHtml(p.name)}</strong>
        <span class="meta">
          ${p.barcode} · 100 ${p.unit}: ${p.kcal} kcal ·
          F ${p.protein} g · Sz ${p.carbs} g · Zs ${p.fat} g
        </span>
      </li>`).join('')
    : '<li class="saved__empty">Még nincs mentett termék.</li>';
}

/* ====================================================================== *
 * Indulás
 * ====================================================================== */
manualForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const code = manualInput.value.trim();
  if (!code) return;
  stopCamera();
  handleCode(code);
});

restartBtn.addEventListener('click', () => {
  setBanner('');
  startScanner();
});

refreshSaved();
startScanner();
