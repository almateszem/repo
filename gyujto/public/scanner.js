/**
 * Gyűjtő — vonalkód-olvasó
 * ========================
 * Három szint, ebben a sorrendben:
 *   1. natív `BarcodeDetector` — nulla letöltés, a platform gyorsított
 *      dekódere (Androidon, ChromeOS-en);
 *   2. lustán betöltött ZXing UMD — asztali Chrome-on, Firefoxon és Safarin ez
 *      az egyetlen működő út. 336 KB, ezért CSAK akkor töltjük le, ha tényleg
 *      szkennelünk, és a natív út nem használható;
 *   3. kézi beírás — nem itt, hanem a felületen; NEM vészmegoldás, hanem
 *      egyenrangú út (ld. lentebb a biztonságos kontextust).
 *
 * A fő app modálja (public/script.js) egyetlen kódot olvas be és bezárul. A
 * Gyűjtő MÁSKÉNT használja: a boltban egymás után sok terméket szkennelünk,
 * ezért ez a modul FOLYAMATOSAN fut, és minden találatnál visszahív. A hívó
 * dönti el, mikor áll meg (`pause()` amíg az űrlapot töltjük, `resume()` utána).
 */

/** Élelmiszer-csomagoláson gyakorlatilag ezek fordulnak elő. A szűkítés nem
    kozmetika: minden engedélyezett formátum külön dekódert futtat képkockánként. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const ZXING_URL = '/vendor/zxing/index.min.js';
/** ~8 kép/mp. A dekódolás CPU-igényes; 60 fps-en a ZXing úgysem végezne, a
    telefon akkuja viszont elfogyna — a boltban végigjárt óra alatt ez számít. */
const FRAME_INTERVAL_MS = 120;
const CANVAS_W = 640;
/** Ugyanazt a kódot ennyi ideig nem jelentjük újra: a kamera másodpercenként
    nyolcszor látja ugyanazt a csomagolást, de az egy szkennelés. */
const REPEAT_MS = 2500;

/** A getUserMedia hibái emberi nyelven — az `err.name` pontos, de a
    felhasználónak semmit nem mond. */
const CAMERA_ERRORS = {
  NotAllowedError: 'A kamerához nem adtál engedélyt. A böngésző címsorában visszavonhatod '
    + 'a tiltást — addig írd be a kódot kézzel.',
  SecurityError: 'A böngésző letiltotta a kamerát ezen az oldalon.',
  NotFoundError: 'Nem találtunk kamerát ezen az eszközön.',
  OverconstrainedError: 'Nem találtunk használható hátsó kamerát.',
  NotReadableError: 'A kamerát épp egy másik alkalmazás használja.',
};

/** Szkript egyszeri, lusta betöltése (a ZXing UMD-hez). */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Nem sikerült betölteni: ${src}`));
    document.head.append(el);
  });
}

/**
 * Folyamatos vonalkód-olvasó.
 *
 * @param {object} opts
 * @param {HTMLVideoElement} opts.video   ide megy a kamerakép
 * @param {HTMLElement} opts.stage        a videót körülvevő doboz (megjelenítés)
 * @param {HTMLButtonElement} opts.torch  vaku-gomb (elrejtve, ha az eszköz nem tudja)
 * @param {(code: string) => void} opts.onCode    minden ÚJ beolvasott kódra
 * @param {(text: string) => void} opts.onStatus  állapotszöveg a felületnek
 * @param {(text: string) => void} opts.onError   hibaszöveg (üres = nincs hiba)
 */
export function createScanner({ video, stage, torch, onCode, onStatus, onError }) {
  let stream = null;
  let timerId = 0;
  let canvas = null;
  let zxingReader = null;
  let paused = false;
  let lastCode = '';
  let lastAt = 0;

  const setStatus = (text) => onStatus?.(text);
  const setError = (text) => onError?.(text);

  /* A legkritikusabb függvény az egész felületen. Track-stop nélkül a
     kamera-LED égve marad (a felhasználó joggal hiszi, hogy figyeljük), és a
     KÖVETKEZŐ indítás NotReadableError-t kap, mert az eszköz még foglalt.
     Ezért MINDEN kilépési út ezen megy át. */
  function stop() {
    if (timerId) { clearTimeout(timerId); timerId = 0; }
    if (zxingReader) {
      try { zxingReader.reset(); } catch { /* nincs mit tenni */ }
      zxingReader = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
    if (stage) stage.hidden = true;
    if (torch) {
      torch.hidden = true;
      torch.setAttribute('aria-pressed', 'false');
    }
    setStatus('');
  }

  /** ZXing-alapú dekóder a canvas-képkockára. Csak ha a natív nem használható. */
  function createZxingDetector() {
    const ZX = window.ZXing;
    if (!ZX?.MultiFormatReader) throw new Error('A ZXing dekóder nem érhető el.');

    const reader = new ZX.MultiFormatReader();
    reader.setHints(new Map([
      [ZX.DecodeHintType.POSSIBLE_FORMATS, [
        ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8,
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
      // 640 px-re skálázunk: a dekódoláshoz bőven elég, a nagyobb kép
      // képkockánként milliszekundumokat vinne el.
      const scale = CANVAS_W / videoEl.videoWidth;
      canvas.width = CANVAS_W;
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

  /** A használható dekóder: natív, ha van, különben lustán töltött ZXing. */
  async function createDetector() {
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const formats = FORMATS.filter((format) => supported.includes(format));
        if (formats.length) {
          const detector = new window.BarcodeDetector({ formats });
          // A natív detect() közvetlenül a <video>-t is elfogadja — nem kell canvas.
          return async (videoEl) => (await detector.detect(videoEl))[0]?.rawValue ?? null;
        }
      } catch {
        // Van BarcodeDetector, de nem használható — essünk vissza a ZXingre,
        // ne rögtön a kézi beírásra.
      }
    }
    await loadScript(ZXING_URL);
    return createZxingDetector();
  }

  /** Vaku — csak ott, ahol az eszköz tudja (jellemzően telefonok hátsó kamerája). */
  function setupTorch(track) {
    if (!torch) return;
    const capabilities = track.getCapabilities?.() ?? {};
    if (!('torch' in capabilities)) return;

    torch.hidden = false;
    let on = false;
    torch.onclick = async () => {
      on = !on;
      try {
        await track.applyConstraints({ advanced: [{ torch: on }] });
      } catch {
        on = false; // néhány eszköz jelenti a képességet, de az alkalmazás elbukik
      }
      torch.setAttribute('aria-pressed', String(on));
    };
  }

  async function start() {
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
      return false;
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
      setError(CAMERA_ERRORS[err.name] ?? `A kamera nem indult el: ${err.message}`);
      return false;
    }

    video.srcObject = stream;
    if (stage) stage.hidden = false;
    try {
      await video.play();
    } catch {
      // Autoplay-tiltás: a kép áll, de a dekódolás így is működhet.
    }
    setupTorch(stream.getVideoTracks()[0]);

    let detect;
    try {
      detect = await createDetector();
    } catch (err) {
      stop();
      setError(`${err.message} Írd be a vonalkódot kézzel.`);
      return false;
    }

    setStatus('Tartsd a vonalkódot a keretbe.');
    paused = false;

    /* setTimeout-lánc, nem requestAnimationFrame: a rAF a háttérbe került
       fülön leáll ugyan, de aktív fülön 60 Hz-en hívna — nekünk 8 elég, és a
       lánc a dekódolás TÉNYLEGES idejét is beleszámolja az ütemezésbe. */
    const tick = async () => {
      if (!stream) return;
      if (!paused) {
        try {
          const raw = await detect(video);
          if (raw) {
            const code = String(raw).replace(/\D/g, '');
            const now = Date.now();
            // Ugyanazt a csomagolást másodpercenként nyolcszor látjuk — de az
            // egy szkennelés. Új kód viszont azonnal mehet.
            if (code && (code !== lastCode || now - lastAt > REPEAT_MS)) {
              lastCode = code;
              lastAt = now;
              onCode?.(code);
            }
          }
        } catch {
          // Egy elszállt képkocka nem állítja le a szkennelést.
        }
      }
      if (stream) timerId = setTimeout(tick, FRAME_INTERVAL_MS);
    };
    tick();
    return true;
  }

  /* Háttérbe került fül: a dekódolás magától lassul, a kamera-LED viszont nem
     alszik el. A felhasználó ilyenkor átváltott egy másik appra — állítsuk le. */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) stop();
  });
  window.addEventListener('beforeunload', stop);

  return {
    start,
    stop,
    /** Szünet a találat feldolgozása (űrlapkitöltés) idejére — a kamera él,
        de nem jelentünk újabb kódot. Így a visszatérés azonnali. */
    pause() { paused = true; },
    resume() {
      paused = false;
      // A szünet után ugyanaz a termék újra beolvasható (a felhasználó
      // szándékosan tartja oda) — ne a REPEAT_MS zárja ki.
      lastCode = '';
    },
    isRunning: () => Boolean(stream),
  };
}
