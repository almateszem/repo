/** A fejléc-sáv magassága CSS-változóként (--chrome-h). */

import { $ } from '../core/dom.js';

/* A ragadós keresősávok (Táplálkozás, gyakorlat- és edzés-választó) a
   fejléc-sáv ALATT állnak meg, ezért tudniuk kell a magasságát. Telefonon a
   fejléc ragadós és a lap tetején ül; asztalon az oldalsáv aljára kerül
   (fixed), ott a kereső a lap tetejéig mehet (0). A magasság a betűmérettel
   és a sorozat-jelvénnyel is változhat, ezért figyeljük. */
function setupChromeHeight() {
  const chrome = $('.app-chrome');
  if (!chrome) return;
  const sync = () => {
    const inFlow = getComputedStyle(chrome).position === 'sticky';
    document.documentElement.style.setProperty(
      '--chrome-h',
      inFlow ? `${chrome.offsetHeight}px` : '0px',
    );
  };
  new ResizeObserver(sync).observe(chrome);
  window.matchMedia('(min-width: 1025px)').addEventListener('change', sync);
  sync();
}

export { setupChromeHeight };
