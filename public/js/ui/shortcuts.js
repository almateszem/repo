/** Gyorsbillentyűk. */

import { KEY_TO_PAGE, OPEN_MODAL_SELECTOR } from '../core/constants.js';
import { $ } from '../core/dom.js';
import { currentPage, navigate } from '../nav/router.js';

/** Gyorsbillentyűk: 1–5 oldalváltás. Gépelés közben és nyitott modal
    mellett inaktív — utóbbi nélkül a háttérben lévő oldal átváltott,
    miközben az ablak nyitva maradt előtte. A modált közös horgony ismeri fel,
    nem osztálylista: a lista idején az étel-, a saját étel és a szkenner
    modál kimaradt belőle. */
const isModalOpen = () => Boolean($(OPEN_MODAL_SELECTOR));

function setupShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isModalOpen()) return;
    if (
      event.target instanceof Element &&
      event.target.matches('input, textarea, select, [contenteditable]')
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

export { setupShortcuts };
