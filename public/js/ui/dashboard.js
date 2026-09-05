/** Az áttekintő oldal interakciói. */

import { $, $$ } from '../core/dom.js';
import { navigate } from '../nav/router.js';

function setupDashboard(settingsModal) {
  /* MINDEN beállítás-gomb, nem csak az első: a fogaskerék az áttekintőn és a
     „Beállítások" a profiloldalon is ide fut. A $ (első találat) itt némán
     kihagyta volna a másikat.
     A settingsModal null lehet, ha a betöltése hibázott — a gomb ilyenkor inaktív. */
  $$('[data-action="settings"]').forEach((btn) => {
    btn.addEventListener('click', () => settingsModal?.open());
  });
  $('[data-action="open-workout"]').addEventListener('click', () => navigate('workout'));
  // Az avatar+név gomb: korábban az értesítés-panelt nyitotta, most a profil
  // oldalra visz (az értesítéseknek saját harang gombjuk van mellette).
  $('[data-action="profile"]').addEventListener('click', () => navigate('profile'));
}

/* ---- Profiloldal (pf-*) ----
   Csak megjelenít: a fiók adatai és a naplózott edzésekből számolt
   összesítők. Az egyetlen szerkeszthető mező (a megjelenített név) a
   beállítások modalban maradt, ide csak egy gomb vezet. */

export { setupDashboard };
