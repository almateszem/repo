/**
 * Podium — az Áttekintő
 * ------------------------------------------------------------------------
 * A kirajzolás (diagramok, napi statisztika, készenlét, mai edzés), az
 * adatok (/api/dashboard, /api/charts, /api/user lekérése és a legutóbbi
 * áttekintő-adat) és az oldal vezérlője egy fájlban.
 */

import { api, clientDate } from '../shared/api.js';
import { $, $$ } from '../shared/dom.js';
import { animateNumber, formatWhole } from '../shared/format.js';
import { prefs } from '../shared/prefs.js';
import { renderChart } from '../shared/chart.js';
import { hasReadiness } from '../shared/readiness.js';
import { navigate, onPageShow } from '../app/router.js';
import { DETAILS_ON_RECOVERY, dashboardQuote } from '../render/recovery-map.js';

/* ======================================================================
   Kirajzolás
   ====================================================================== */

/** Minden data-chart konténert feltölt a kapott (/api/charts) adatokból. */
function paintCharts(charts) {
  $$('[data-chart]').forEach((container) => {
    const data = charts[container.dataset.chart];
    if (data) renderChart(container, data);
  });
}

/** Az Áttekintő „Utolsó 14 nap" diagramja a már lekért chartokból. Edzés
    befejezése, javítása és törlése után ez fut (hooks.refreshVolumeChart) —
    a teljes renderCharts() NEM: az a seed demo-testsúlygörbét (server/data.js)
    is újrarajzolná a valódi fölé. */
function renderVolumeTrend(charts) {
  const container = $('[data-chart="volumeTrend"]');
  if (container && charts?.volumeTrend) renderChart(container, charts.volumeTrend);
}

/** Az idézet sora, benne a „részletek a Regeneráción" rész a Regenerációra
    linkelve (csak ez a szövegrész kattintható, nem az egész mondat). */
function linkDetails(line) {
  const at = line.indexOf(DETAILS_ON_RECOVERY);
  if (at === -1) return [document.createTextNode(line)];
  const link = document.createElement('a');
  link.href = '#recovery';
  link.textContent = DETAILS_ON_RECOVERY;
  return [
    document.createTextNode(line.slice(0, at)),
    link,
    document.createTextNode(line.slice(at + DETAILS_ON_RECOVERY.length)),
  ];
}

/** Az áttekintő napi statjainak (kalória/fehérje) kiírása. */
function renderDailyStats(dailyStats) {
  const setText = (selector, value) => {
    const el = $(selector);
    if (el) el.textContent = value;
  };
  setText('[data-daily="calories"]', dailyStats.calories);
  setText('[data-daily="caloriesTarget"]', '/' + dailyStats.caloriesTarget);
  setText('[data-daily="protein"]', dailyStats.protein);
  setText('[data-daily="carbs"]', dailyStats.carbs);
  setText('[data-daily="fat"]', dailyStats.fat);

  /* A kalóriasáv. 100 százalékon megáll: a cél felé jóval túl is lehet enni,
     de egy túlcsorduló sáv csak széttörné az elrendezést — a túlevés a
     számokból látszik, nem a sáv hosszából. */
  const fill = $('[data-daily-fill]');
  if (fill) {
    const target = Number(dailyStats.caloriesTarget) || 0;
    const pct = target > 0 ? Math.min(100, (dailyStats.calories / target) * 100) : 0;
    fill.style.width = `${pct}%`;
  }
}

/** A napi check-in emlékeztető ki/be kapcsolása az áttekintőn. A gomb csak
    addig látszik, amíg a mai check-in hiányzik.

    A korábbi data-checkin-pending jelző elmaradt: az a kártyarácsnak kellett,
    ahol a gomb egy teljes oszlopot töltött ki, és a rejtésekor másik
    grid-template-re kellett váltani. A mostani elrendezésben a bal hasáb
    egyszerű függőleges folyam — a rejtett elem helye magától összecsukódik. */
function syncCheckinCta(checkinPresent) {
  const cta = $('[data-checkin-cta]');
  if (!cta) return;
  cta.hidden = Boolean(checkinPresent);
}

/** Az áttekintő kirajzolása a kapott (/api/dashboard) adatokból: sorozat,
    regeneráció, napi statok, aktuális edzésnév és a Regenerációval közös
    készenléti ítélet. A lekérés lent, a renderDashboard-é. */
function paintDashboard(dashboardData) {
  const { readiness, streak, recovery, dailyStats, workoutName, restDay, todayDone } =
    dashboardData;

  const setText = (selector, value) => {
    const el = $(selector);
    if (el) el.textContent = value;
  };

  // Sorozat + napi statok
  setText('[data-stat="streak"]', streak);
  renderDailyStats(dailyStats);

  // A fejléc-sáv sorozat-jelvénye. Nulla sorozatnál elrejtjük: a „0 nap” nem
  // információ, csak zaj a név mellett.
  const streakChip = $('[data-chrome-streak]');
  if (streakChip) {
    streakChip.textContent = `${streak} nap`;
    streakChip.hidden = !streak;
  }

  // Regeneráció
  setText('[data-recovery="sleep"]', recovery.sleep);
  setText('[data-recovery="fatigue"]', recovery.fatigue);
  setText('[data-recovery="soreness"]', recovery.soreness);

  const readinessKnown = hasReadiness(readiness);
  // A szám animálását az Áttekintő megnyitási feladata végzi — ha nincs adat, ott sincs mit
  // felpörgetni, ezért a helyőrzőt itt írjuk ki.
  if (!readinessKnown) {
    const num = $('.db-percent-num');
    if (num) num.textContent = '—';
  }

  // A check-in emlékeztető gomb. A check-in mentése renderDashboard-ot hív,
  // így a gomb azonnal eltűnik — újratöltés nélkül.
  syncCheckinCta(dashboardData.checkinPresent);

  // Aktuális edzés neve (aznapi piszkozat vagy a mára ütemezett terv a
  // szerverről; null, ha nincs egyik sem): az áttekintő CTA-ja. Az edzésnapló
  // címéhez NEM nyúlunk: azt induláskor az applyTemplate állítja be — ez a
  // render edzés befejezése és check-in mentése után is lefut, és a terv nevét
  // írta volna az üres (vagy kézzel elnevezett) naplóba.
  // Az aktív terv szerinti pihenőnapon ezt mondjuk ki — az edzés persze így is
  // indítható. Ha a mai tervből ma már mentett edzés van (todayDone), nem
  // kínáljuk újra, mintha hátra lenne: a gomb ilyenkor új edzést indít.
  const title = todayDone
    ? 'Mai edzés kész ✓'
    : workoutName || (restDay ? 'Pihenőnap' : 'Kezdj új edzést');
  setText('[data-workout-name]', title);
  setText('[data-cta-label]', todayDone ? 'Új edzés' : 'Edzés indítása');

  /* A jobb hasáb gyakorlat-előnézete. A lista a szervertől készen jön
     (workoutPlan): a sorozat/ismétlés/súly összefűzése ott történik, hogy a
     felület ne kezdjen el a napló belső alakjával számolni. */
  const sideList = $('[data-list="today-exercises"]');
  if (sideList) {
    const exercises = dashboardData.workoutPlan?.exercises ?? [];
    sideList.replaceChildren(
      ...exercises.map((exercise, index) => {
        const li = document.createElement('li');
        li.className = 'db-side-item';

        const no = document.createElement('span');
        no.className = 'db-side-no';
        no.textContent = String(index + 1).padStart(2, '0');

        const text = document.createElement('span');
        text.className = 'db-side-text';
        const name = document.createElement('span');
        name.className = 'db-side-name';
        name.textContent = exercise.name;
        text.appendChild(name);
        // A részletsor elmarad, ha a tervben nincs súly és ismétlés — az üres
        // sor csak helyet foglalna.
        if (exercise.detail) {
          const detail = document.createElement('span');
          detail.className = 'db-side-detail';
          detail.textContent = exercise.detail;
          text.appendChild(detail);
        }

        li.append(no, text);
        return li;
      }),
    );

    const meta = $('[data-workout-meta]');
    if (meta) {
      // A becslés durva, de van referenciája: gyakorlatonként ~12 perc.
      meta.textContent = `${exercises.length} gyakorlat · ~${exercises.length * 12} perc`;
      meta.hidden = exercises.length === 0;
    }
    const empty = $('[data-side-empty]');
    if (empty) empty.hidden = exercises.length > 0;
  }

  // Kontextusfüggő idézet. Két sorból épül (a sortörés a tördelés miatt
  // szándékos) — a szöveget textContent-tel írjuk ki, nem innerHTML-lel,
  // hogy az adatból származó rész se kerülhessen soha HTML-ként a lapra.
  const quoteEl = $('[data-db-quote]');
  if (quoteEl) {
    /* Az ítélet ugyanaz, mint a Regeneráción (verdictText): korábban itt egy
       saját 85/65-ös lánc futott CNS és gyakorlat-ítélet nélkül, és ellentmondott
       neki (92 + CNS 78 → „ma mehet a nehezebb" vs. „korlátozd"). */
    const [first, second] = dashboardQuote(dashboardData);
    quoteEl.replaceChildren(
      document.createTextNode(first),
      document.createElement('br'),
      ...linkDetails(second),
    );
  }
}

/** A fejléc-sáv dátuma. Ugyanabból a clientDate()-ből, amit minden kérés visz —
    így a sávon látott nap mindig az, amelyikre a szerver ír. */
function renderChromeDate() {
  const el = $('[data-chrome-date]');
  if (!el) return;
  const [, month, day] = clientDate().split('.');
  el.textContent = `${month}.${day}.`;
}

/** A megjelenített felhasználónév: a saját (localStorage) név, különben a
    szerveré (a lekérés lent, a renderUserName-é). */
function paintUserName(user) {
  const el = $('.db-username');
  if (!el) return;
  el.textContent = prefs.get('displayName', user.name);
}

/* ======================================================================
   Adatok
   ====================================================================== */

/** Az áttekintő adatai (renderDashboard tölti fel; az Áttekintő megnyitási feladata innen veszi
    a készenlét-értéket az animációhoz). */
let dashboardData = null;

/** Minden diagram a szerver friss adataiból. */
async function renderCharts() {
  paintCharts(await api.getCharts());
}

/** Csak az áttekintő élő értékeinek újralekérése — étel-naplózás és napváltás
    után, hogy a napi statok és a check-in emlékeztető a friss szerver-állapotot
    mutassák a többi dashboard-elem (pl. az edzésnév-mező) újrarenderelése
    nélkül. Éjfél után ez hozza vissza az emlékeztetőt: a szerver az új napra
    számol, amire még nincs check-in. */
async function refreshDailyStats() {
  const { dailyStats, checkinPresent } = await api.getDashboard();
  if (dashboardData) {
    dashboardData.dailyStats = dailyStats;
    dashboardData.checkinPresent = checkinPresent;
  }
  renderDailyStats(dailyStats);
  syncCheckinCta(checkinPresent);
}

/** Ennyi ideig számít frissnek egy lefutott renderDashboard: az Áttekintő
    megnyitása (router → onPageShow) ezen belül nem kér újra — pl. az induláskori
    render után nem megy ki második /api/dashboard kérés. */
const DASHBOARD_FRESH_MS = 2000;
let lastRenderAt = -Infinity;
let renderInFlight = null;

/** Az áttekintő (dashboard) DB-vezérelt feltöltése: sorozat, regeneráció,
    napi statok, aktuális edzésnév, és a Regenerációval közös
    készenléti ítélet (a statikus motivációs szöveg helyett).
    Mindig friss adatot kér: a hívók (edzés, check-in mentése) a saját
    változásuk utáni állapotot várják. */
async function renderDashboard() {
  const run = api.getDashboard().then((data) => {
    dashboardData = data;
    paintDashboard(data);
  });
  renderInFlight = run;
  try {
    await run;
    lastRenderAt = Date.now();
  } finally {
    if (renderInFlight === run) renderInFlight = null;
  }
}

/** Az Áttekintő megnyitásakor: ha épp fut egy render, ahhoz csatlakozik; ha
    az utolsó DASHBOARD_FRESH_MS-on belül futott, nem kér újra; különben friss
    adatot kér. A visszaadott ígéret a `dashboardData` frissülése után teljesül. */
function refreshDashboardIfStale() {
  if (renderInFlight) return renderInFlight;
  if (Date.now() - lastRenderAt < DASHBOARD_FRESH_MS) return Promise.resolve();
  return renderDashboard();
}

/** A megjelenített felhasználónév: a saját (localStorage) név, különben a
    szerveré. Külön renderelő, mert korábban csak a beállítások modal
    felépítése írta ki — ha az a lépés elhasalt, a név helye üresen maradt. */
async function renderUserName() {
  if (!$('.db-username')) return;
  paintUserName(await api.getUser());
}

/* ======================================================================
   Vezérlő
   ====================================================================== */

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

export {
  dashboardData,
  paintDashboard,
  refreshDashboardIfStale,
  refreshDailyStats,
  renderCharts,
  renderChromeDate,
  renderDashboard,
  renderUserName,
  renderVolumeTrend,
  setupDashboard,
};
