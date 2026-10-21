/**
 * Podium — az áttekintő adatai
 * ------------------------------------------------------------------------
 * Az /api/dashboard, /api/charts és /api/user lekérése és a legutóbbi
 * áttekintő-adat; a kirajzolás a render/dashboard.js-é.
 */
import { api } from '../shared/api.js';
import { $ } from '../shared/dom.js';
import {
  paintCharts,
  paintDashboard,
  paintUserName,
  renderDailyStats,
  syncCheckinCta,
} from '../render/dashboard.js';

/** Az áttekintő adatai (renderDashboard tölti fel; az Áttekintő megnyitási feladata innen veszi
    a készenlét-értéket az animációhoz). */
export let dashboardData = null;

/** Minden diagram a szerver friss adataiból. */
export async function renderCharts() {
  paintCharts(await api.getCharts());
}

/** Csak az áttekintő élő értékeinek újralekérése — étel-naplózás és napváltás
    után, hogy a napi statok és a check-in emlékeztető a friss szerver-állapotot
    mutassák a többi dashboard-elem (pl. az edzésnév-mező) újrarenderelése
    nélkül. Éjfél után ez hozza vissza az emlékeztetőt: a szerver az új napra
    számol, amire még nincs check-in. */
export async function refreshDailyStats() {
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
export async function renderDashboard() {
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
export function refreshDashboardIfStale() {
  if (renderInFlight) return renderInFlight;
  if (Date.now() - lastRenderAt < DASHBOARD_FRESH_MS) return Promise.resolve();
  return renderDashboard();
}

/** A megjelenített felhasználónév: a saját (localStorage) név, különben a
    szerveré. Külön renderelő, mert korábban csak a beállítások modal
    felépítése írta ki — ha az a lépés elhasalt, a név helye üresen maradt. */
export async function renderUserName() {
  if (!$('.db-username')) return;
  paintUserName(await api.getUser());
}
