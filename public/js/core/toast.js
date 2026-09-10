/** Toast értesítések. */

import { $ } from './dom.js';

/* ======================================================================
   3. Toast értesítések
   ====================================================================== */
const TOAST_VISIBLE_MS = 2400;

/** A hiba tovább látszik: 2,4 mp alatt egy „nem sikerült menteni" el sem
    olvasható, márpedig ebből tudja meg a felhasználó, hogy tennie kell valamit. */
const TOAST_ERROR_VISIBLE_MS = 5200;

function showToast(message, variant = 'default') {
  const region = $('.toast-region');
  const toast = document.createElement('div');
  toast.className = variant === 'error' ? 'toast toast--error' : 'toast';
  toast.textContent = message;
  region.appendChild(toast);

  // A toast-régió `polite`: a képernyőolvasó megvárja vele, amit épp mond.
  // Hibánál ez kevés, ezért a szöveget egy külön `assertive` régióba is
  // kiírjuk — vizuálisan ott nincs semmi, csak a bejelentés történik meg.
  if (variant === 'error') {
    const announcer = $('[data-error-announcer]');
    if (announcer) {
      // Az azonos szöveg ismételt beírását a felolvasók elnyelik: előbb
      // ürítjük, hogy két egyforma hiba is elhangozzon.
      announcer.textContent = '';
      setTimeout(() => { announcer.textContent = message; }, 60);
    }
  }

  setTimeout(() => {
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    // Tartalék, ha az animációk le vannak tiltva (prefers-reduced-motion):
    setTimeout(() => toast.remove(), 400);
  }, variant === 'error' ? TOAST_ERROR_VISIBLE_MS : TOAST_VISIBLE_MS);
}

/* ======================================================================
   4. Router — hash-alapú oldalváltás
   A cím (#workout, #coach…) tükrözi az aktív oldalt, így a vissza gomb és
   a link-megosztás is működik; az utolsó oldal localStorage-ból áll vissza.
   ====================================================================== */

export { showToast };
