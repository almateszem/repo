/** Vonalkód-olvasó: kamera, ZXing, a talált termék átadása. */

import { $, $$, loadScript } from '../core/dom.js';
import { createModalController } from './modals.js';

/* ======================================================================
   Vonalkód-olvasó (sc-*)
   ----------------------------------------------------------------------
   Három szint, ebben a sorrendben:
     1. natív BarcodeDetector — nulla letöltés, a platform gyorsított
        dekódere. Androidon/ChromeOS-en elérhető;
     2. lustán betöltött ZXing UMD — asztali Chrome-on (Windows), Firefoxon
        és Safarin ez az egyetlen működő út;
     3. kézi beírás — NEM vészmegoldás, hanem egyenrangú út: sima http-n
        (a gép LAN-IP-jéről nézve) a böngésző a kamerát oda sem adja, és a
        szkennelés fizikailag is bukhat (karcos csomagolás, rossz fény).
   ====================================================================== */

const ZXING_URL = '/vendor/zxing/index.min.js';

// Élelmiszer-csomagoláson gyakorlatilag ezek fordulnak elő. A szűkítés nem
// kozmetika: minden engedélyezett formátum külön dekódert futtat képkockánként.
const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

// ~8 kép/mp. A dekódolás CPU-igényes; 60 fps-en a ZXing úgysem végezne, a
// telefon akkuja viszont elfogyna.
const SCAN_INTERVAL_MS = 120;

const SCAN_CANVAS_W = 640;

/** A getUserMedia hibái emberi nyelven. A böngésző `err.name`-je pontos, de
    a felhasználónak semmit nem mond. */
const CAMERA_ERRORS = {
  NotAllowedError: 'A kamerához nem adtál engedélyt. A böngésző címsorában visszavonhatod '
    + 'a tiltást — addig írd be a kódot kézzel.',
  SecurityError: 'A böngésző letiltotta a kamerát ezen az oldalon.',
  NotFoundError: 'Nem találtunk kamerát ezen az eszközön.',
  OverconstrainedError: 'Nem találtunk használható hátsó kamerát.',
  NotReadableError: 'A kamerát épp egy másik alkalmazás használja.',
};

/**
 * A vonalkód-olvasó modál vezérlője.
 *
 * @returns {{ scan: () => Promise<string|null> }}
 *   A `scan()` a beolvasott (nyers) vonalkóddal oldódik fel, vagy null-lal,
 *   ha a felhasználó megszakította. SOHA nem dob: a hibák a modálon belül,
 *   magyarul jelennek meg, és a kézi beírás mindig marad.
 */
function setupScanner() {
  const modal = $('#scannerModal');
  const controller = createModalController(modal);
  const stage = $('[data-sc-stage]', modal);
  const video = $('[data-sc-video]', modal);
  const torchBtn = $('[data-sc-torch]', modal);
  const statusEl = $('[data-sc-status]', modal);
  const errorEl = $('[data-sc-error]', modal);
  const manualForm = $('[data-form="manual-barcode"]', modal);
  const manualInput = $('#sc-manual-code', modal);

  let pending = null;      // a futó scan() feloldója
  let stream = null;
  let rafId = 0;
  let canvas = null;
  let zxingReader = null;

  const setStatus = (text) => { statusEl.textContent = text; };
  const setError = (text) => {
    errorEl.textContent = text || '';
    errorEl.hidden = !text;
  };

  /* A legkritikusabb függvény az egész felületen. Track-stop nélkül a
     kamera-LED égve marad a modál bezárása után is (a felhasználó joggal
     hiszi, hogy figyeljük), és a KÖVETKEZŐ megnyitás NotReadableError-t kap,
     mert az eszköz még foglalt. Ezért MINDEN kilépési út ezen megy át. */
  const stopCamera = () => {
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
  };

  /** Az ígéret lezárása EGYSZER, minden kilépési úton — előbb a kamera áll le. */
  const settle = (code) => {
    stopCamera();
    const resolve = pending;
    pending = null;
    controller.close();
    if (resolve) resolve(code ?? null);
  };

  // A modál saját záró-útjai (✕, háttér, Escape, hashchange) a controllerben
  // vannak; azok a `close`-t hívják, nem a settle-t — ezért itt is figyelünk,
  // különben a scan() ígérete örökre függőben maradna.
  $$('[data-close-modal]', modal).forEach((el) => el.addEventListener('click', () => settle(null)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) settle(null);
  });
  window.addEventListener('hashchange', () => { if (pending) settle(null); });
  // Háttérbe került fül: a rAF magától megáll, a kamera-LED viszont nem.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) stopCamera();
  });
  window.addEventListener('beforeunload', stopCamera);

  /** ZXing-alapú dekóder a canvas-képkockára. Csak akkor hívjuk, ha a
      natív BarcodeDetector nem használható. */
  const createZxingDetector = () => {
    const ZX = window.ZXing;
    if (!ZX?.MultiFormatReader) throw new Error('A ZXing dekóder nem érhető el.');

    const reader = new ZX.MultiFormatReader();
    const hints = new Map([
      [ZX.DecodeHintType.POSSIBLE_FORMATS, [
        ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8,
        ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128,
      ]],
      // A csomagolás ritkán fekszik síkban a kamera előtt; a TRY_HARDER a
      // ferde és a gyengébb kontrasztú képet is megpróbálja.
      [ZX.DecodeHintType.TRY_HARDER, true],
    ]);
    reader.setHints(hints);
    zxingReader = reader;

    return (videoEl) => {
      if (!videoEl.videoWidth) return null;
      if (!canvas) canvas = document.createElement('canvas');
      // 640 px-re skálázunk: a dekódoláshoz bőven elég, és a nagyobb kép
      // képkockánként milliszekundumokat vinne el.
      const scale = SCAN_CANVAS_W / videoEl.videoWidth;
      canvas.width = SCAN_CANVAS_W;
      canvas.height = Math.round(videoEl.videoHeight * scale);
      canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      const source = new ZX.HTMLCanvasElementLuminanceSource(canvas);
      const bitmap = new ZX.BinaryBitmap(new ZX.HybridBinarizer(source));
      try {
        // decodeWithState: a setHints-szel beállított olvasókat újrahasználja
        // — folyamatos szkennelésnél ez a gyorsabb út.
        return reader.decodeWithState(bitmap).getText();
      } catch {
        // NotFoundException minden olyan képkockán, amin nincs kód — ez a
        // szkennelés NORMÁLIS állapota, nem hiba.
        return null;
      }
    };
  };

  /** A használható dekóder: natív, ha van, különben lustán betöltött ZXing. */
  const createDetector = async () => {
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = SCAN_FORMATS.filter((format) => supported.includes(format));
        if (formats.length) {
          const detector = new window.BarcodeDetector({ formats });
          // A natív detect() közvetlenül a <video>-t is elfogadja — nem kell canvas.
          return async (videoEl) => (await detector.detect(videoEl))[0]?.rawValue ?? null;
        }
      } catch {
        // Van BarcodeDetector, de nem használható (pl. nincs mögötte platform-
        // támogatás) — essünk vissza a ZXingre, ne a kézi beírásra.
      }
    }
    await loadScript(ZXING_URL);
    return createZxingDetector();
  };

  /** Vaku — csak ott, ahol az eszköz tudja (jellemzően telefonok hátsó kamerája). */
  const setupTorch = (track) => {
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
  };

  const start = async () => {
    setError('');
    setStatus('Kamera indítása…');

    /* A getUserMedia CSAK biztonságos kontextusban él: https VAGY localhost.
       Sima http-n, a gép LAN-IP-jéről (telefonról a gépre) a böngésző NEM ad
       kamerát. Ezt ki kell mondani: enélkül „nem működik a szkenner"-ként
       jelentik, és nincs mit debugolni rajta. */
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('');
      setError('A kamera csak https-en vagy localhoston érhető el. Telefonról, a gép '
        + 'IP-címéről nyitva a böngésző letiltja — írd be a vonalkódot kézzel.');
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
      // Az autoplay-tiltás ritka némított videónál, de nem végzetes: a
      // képkockák a detektáló ciklusban akkor is elérhetők lehetnek.
    }
    setupTorch(stream.getVideoTracks()[0]);

    let detect;
    try {
      setStatus('Dekóder betöltése…');
      detect = await createDetector();
    } catch {
      stopCamera();
      setStatus('');
      setError('A vonalkód-dekódert nem sikerült betölteni — írd be a kódot kézzel.');
      return;
    }
    setStatus('Irányítsd a kamerát a vonalkódra.');

    /* requestAnimationFrame, nem setInterval: a rAF magától megáll, ha a fül
       háttérbe kerül vagy a képernyő lezár — a setInterval a telefon akkuját
       égetné dekódolással egy fekete képkockán. */
    let lastRun = 0;
    let busy = false;
    let lastCode = null;
    const tick = async (now) => {
      rafId = requestAnimationFrame(tick);
      if (!stream || busy || now - lastRun < SCAN_INTERVAL_MS) return;
      lastRun = now;
      busy = true;
      try {
        const code = await detect(video);
        /* KÉT egymás utáni azonos leolvasás kell. Egyetlen képkocka
           félreolvasása így nem visz be rossz terméket — a mod-10 ellenőrző-
           szám sem fog ki minden hibán, és egy rossz étel csendben elrontaná
           a napi bevitelt. */
        if (code && code === lastCode) {
          navigator.vibrate?.(30);
          settle(code);
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
  };

  // Kézi beírás — a validálást (hossz, ellenőrzőszám) a szerver végzi.
  manualForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = manualInput.value.trim();
    if (code) settle(code);
  });

  return {
    scan() {
      return new Promise((resolve) => {
        // Ha valamiért már fut egy szkennelés, azt megszakítjuk — két
        // párhuzamos kamera-stream sosem lenne jó.
        if (pending) settle(null);
        pending = resolve;
        manualInput.value = '';
        setError('');
        controller.open();
        start();
      });
    },
  };
}

export { setupScanner };
