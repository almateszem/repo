/**
 * Podium — a mindig látszó keret
 * ------------------------------------------------------------------------
 * A fejléc-sáv magassága CSS-változóként (--chrome-h), az offline/online
 * jelzés és a gyorsbillentyűk (1–7 oldalváltás).
 */

import { KEY_TO_PAGE, OPEN_MODAL_SELECTOR } from '../shared/constants.js';
import { $ } from '../shared/dom.js';
import { showToast } from '../shared/toast.js';
import { currentPage, navigate } from './router.js';

/* ======================================================================
   Fejléc-magasság
   ====================================================================== */

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

/* ======================================================================
   Offline/online jelzés
   ====================================================================== */

/** Offline/online állapot jelzése. */
function setupConnectivity() {
  window.addEventListener('offline', () => {
    showToast('Nincs internetkapcsolat', 'error');
  });
  window.addEventListener('online', () => {
    showToast('Újra online');
  });
}

/* ======================================================================
   Gyorsbillentyűk
   ====================================================================== */

/** Gyorsbillentyűk: 1–7 oldalváltás (a side-nav sorrendje). Gépelés közben és nyitott modal
    mellett inaktív — utóbbi nélkül a háttérben lévő oldal átváltott,
    miközben az ablak nyitva maradt előtte. A modált közös horgony ismeri fel,
    nem osztálylista: a lista idején az étel-, a saját étel és a szkenner
    modál kimaradt belőle. */
const isModalOpen = () => Boolean($(OPEN_MODAL_SELECTOR));

function setupShortcuts() {
  document.addEventListener('keydown', (event) => {
    // Egy vezérlő már elfogyasztotta a billentyűt (pl. a lenyíló typeahead-je)
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isModalOpen()) return;
    /* A gépelő mezők ÉS a saját vezérlők (lenyíló, lista): a custom-select
       gombja nem select, ezért a régi őr nem ismerte fel — a terv-lenyílóban
       az „5" a Tervekre váltott. A szerep szerinti őr minden jövőbeli saját
       vezérlőt is véd. */
    if (
      event.target instanceof Element &&
      (event.target.matches('input, textarea, select, [contenteditable]') ||
        event.target.closest('[role="combobox"], [role="listbox"], [aria-haspopup]'))
    )
      return;
    // A check-in varázslóban az 1–5 a VÁLASZ, nem oldalváltás: a skálák és a
    // testtérkép gombok (nem input-ok), így a fenti input-őr nem védi meg
    // őket. A számbillentyűket ott a varázsló saját kezelője dolgozza fel.
    if (currentPage() === 'checkin') return;
    const page = KEY_TO_PAGE[event.key];
    if (page) navigate(page);
  });
}

export { setupChromeHeight, setupConnectivity, setupShortcuts };
