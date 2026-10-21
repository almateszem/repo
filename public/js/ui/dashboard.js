/** Az áttekintő oldal interakciói. */

import { $, $$ } from '../shared/dom.js';
import { animateNumber, formatWhole } from '../shared/format.js';
import { navigate, onPageShow } from '../app/router.js';
import { renderChromeDate } from '../render/dashboard.js';
import { hasReadiness } from '../shared/readiness.js';
import { dashboardData, refreshDashboardIfStale } from './dashboard-data.js';

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

  onPageShow('dashboard', () => {
    /* Megnyitáskor friss adat — mint a többi oldalon: terv-aktiválás után az
       új „mai edzés", éjfél után a mai streak és készenlét. Az induláskori
       render után (2 mp-en belül) nem kér újra, egy futó renderhez csatlakozik
       (refreshDashboardIfStale). A szám a MEGÉRKEZETT adatból pörög fel, így
       nincs régi → új villanás. */
    renderChromeDate();
    refreshDashboardIfStale()
      .then(() => {
        if (!dashboardData || !hasReadiness(dashboardData.readiness)) return;
        // formatWhole: a lap legnagyobb számánál egyetlen tizedesvessző is
        // megtörné az elrendezést minden képkockán.
        animateNumber($('.db-percent-num'), dashboardData.readiness, {
          from: 0,
          duration: 900,
          format: formatWhole,
        });
      })
      .catch((err) => console.error('Áttekintő frissítési hiba:', err));
  });
}

/* ---- Profiloldal (pf-*) ----
   Csak megjelenít: a fiók adatai és a naplózott edzésekből számolt
   összesítők. Az egyetlen szerkeszthető mező (a megjelenített név) a
   beállítások modalban maradt, ide csak egy gomb vezet. */

export { setupDashboard };
