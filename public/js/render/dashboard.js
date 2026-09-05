/** Az áttekintő oldal kirajzolása: diagramok, napi statisztika, készenlét. */

import { api } from '../core/api.js';
import { $, $$ } from '../core/dom.js';
import { prefs } from '../core/prefs.js';
import { hasReadiness } from './recovery.js';

/** Az áttekintő adatai (renderDashboard tölti fel; a pageEffects innen veszi
    a készenlét-értéket az animációhoz). */
let dashboardData = null;

/** Egy chart konténer (újra)feltöltése — a --i a lépcsőzetes animációhoz kell.
    Újrarendereléskor a bar-in animáció is újraindul (reduced motion mellett nem). */
function renderChart(container, data) {
  const bars = $('.chart-bars', container);
  bars.replaceChildren();
  data.heights.forEach((height, index) => {
    const bar = document.createElement('span');
    bar.style.setProperty('--h', height + '%');
    bar.style.setProperty('--i', index);
    bars.appendChild(bar);
  });

  const axis = $('.chart-axis', container);
  axis.replaceChildren();
  data.axis.forEach((label) => {
    const span = document.createElement('span');
    span.textContent = label;
    axis.appendChild(span);
  });
}

/** Minden data-chart konténert feltölt a lekért adatokból. */
async function renderCharts() {
  const charts = await api.getCharts();
  $$('[data-chart]').forEach((container) => {
    const data = charts[container.dataset.chart];
    if (data) renderChart(container, data);
  });
}

/** Az áttekintő napi statjainak (kalória/fehérje) kiírása. */
function renderDailyStats(dailyStats) {
  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
  setText('[data-daily="calories"]', dailyStats.calories);
  setText('[data-daily="caloriesTarget"]', '/' + dailyStats.caloriesTarget);
  setText('[data-daily="protein"]', dailyStats.protein);
}

/** A napi check-in emlékeztető ki/be kapcsolása az áttekintőn. A gomb csak
    addig látszik, amíg a mai check-in hiányzik. A desktop rács is követi az
    állapotot (data-checkin-pending): a gomb a jobb oszlopot tölti ki, ezért
    a rejtésekor másik grid-template kell, különben ott üres hasáb maradna. */
function syncCheckinCta(checkinPresent) {
  const cta = $('[data-checkin-cta]');
  if (!cta) return;
  cta.hidden = Boolean(checkinPresent);
  $('.dashboard')?.setAttribute('data-checkin-pending', String(!checkinPresent));
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

/** Az áttekintő (dashboard) DB-vezérelt feltöltése: sorozat, regeneráció,
    napi statok, aktuális edzésnév, és a készenlét + sorozat alapján
    kontextusfüggő idézet (a statikus motivációs szöveg helyett). */
async function renderDashboard() {
  dashboardData = await api.getDashboard();
  const { readiness, streak, recovery, dailyStats, workoutName } = dashboardData;

  const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };

  // Sorozat + napi statok
  setText('[data-stat="streak"]', streak);
  renderDailyStats(dailyStats);

  // Regeneráció
  setText('[data-recovery="sleep"]', recovery.sleep);
  setText('[data-recovery="fatigue"]', recovery.fatigue);
  setText('[data-recovery="soreness"]', recovery.soreness);

  // Készenlét: a gyűrű kitöltését és feliratát itt, a szám animálását a
  // pageEffects végzi (a --readiness változót a CSS stroke-dashoffset használja).
  // A szelektor szándékosan a kártyára szűkít: a Regeneráció oldalon is van
  // egy .db-ring, azt a renderRecovery kezeli.
  const ring = $('.db-readiness .db-ring');
  const readinessKnown = hasReadiness(readiness);
  if (ring) {
    ring.style.setProperty('--readiness', readinessKnown ? readiness : 0);
    ring.setAttribute('aria-label', readinessKnown
      ? `${readiness} százalék készenlét`
      : 'Készenlét: nincs elég adat');
  }
  // A szám animálását a pageEffects végzi — ha nincs adat, ott sincs mit
  // felpörgetni, ezért a helyőrzőt itt írjuk ki.
  if (!readinessKnown) {
    const num = $('.db-percent-num');
    if (num) num.textContent = '—';
  }

  // A kártya alsó sora megmondja, mire épül a szám — a Recovery Engine
  // enélkül csak egy önmagát magyarázó szám lenne.
  setText('[data-readiness-note]', !readinessKnown
    ? 'még nincs elég adat →'
    : dashboardData.checkinPresent
      ? (dashboardData.readinessConfidence === 'high'
        ? 'a saját előzményedhez mérve'
        : 'részben általános referenciával')
      : 'töltsd ki a napi check-int →');

  // A check-in emlékeztető gomb. A check-in mentése renderDashboard-ot hív,
  // így a gomb azonnal eltűnik — újratöltés nélkül.
  syncCheckinCta(dashboardData.checkinPresent);

  // Aktuális edzés neve (aznapi piszkozat vagy a mára ütemezett terv a
  // szerverről; null, ha nincs egyik sem): áttekintő CTA + az edzésnapló
  // címének alapértéke
  setText('[data-workout-name]', workoutName || 'Kezdj új edzést');
  const titleInput = $('#workout-name');
  if (titleInput) titleInput.value = workoutName || '';

  // Kontextusfüggő idézet. Két sorból épül (a sortörés a tördelés miatt
  // szándékos) — a szöveget textContent-tel írjuk ki, nem innerHTML-lel,
  // hogy az adatból származó rész se kerülhessen soha HTML-ként a lapra.
  const quoteEl = $('[data-db-quote]');
  if (quoteEl) {
    const [first, second] = readiness >= 85
      ? [`${streak} napos sorozatban vagy, és a tested is készen áll —`, 'ma mehet a nehezebb edzés.']
      : readiness >= 65
        ? [`${streak} napos sorozat — tartsd a lendületet,`, 'de figyelj a regenerációra is.']
        : ['A tested pihenést kér —', 'ma inkább könnyebb edzés jöhet.'];
    quoteEl.replaceChildren(
      document.createTextNode(first),
      document.createElement('br'),
      document.createTextNode(second),
    );
  }
}

/** A megjelenített felhasználónév: a saját (localStorage) név, különben a
    szerveré. Külön renderelő, mert korábban csak a beállítások modal
    felépítése írta ki — ha az a lépés elhasalt, a név helye üresen maradt. */
async function renderUserName() {
  const el = $('.db-username');
  if (!el) return;
  const user = await api.getUser();
  el.textContent = prefs.get('displayName', user.name);
}

export { dashboardData, refreshDailyStats, renderChart, renderCharts, renderDashboard, renderUserName };
