/** Az áttekintő oldal kirajzolása: diagramok, napi statisztika, készenlét. */

import { api, clientDate } from '../core/api.js';
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

  // A mai oszlop kiemelése. Csak akkor, ha a szerver megmondja, melyik az:
  // a heti diagramoknál az utolsó oszlop vasárnap, nem a mai nap.
  if (Number.isInteger(data.accentIndex)) {
    const bar = bars.children[data.accentIndex];
    if (bar) bar.classList.add('is-today');
  }

  // Nap-feliratok az oszlopok alá. Opcionális: a régi diagramok csak a jobb
  // oldali tengelyt használják, azoknál nincs ilyen konténer.
  const labels = $('.chart-labels', container);
  if (!labels) return;
  labels.replaceChildren();
  (data.labels || []).forEach((label) => {
    const span = document.createElement('span');
    span.textContent = label;
    labels.appendChild(span);
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

  /* A jobb hasáb gyakorlat-előnézete. A lista a szervertől készen jön
     (workoutPlan): a sorozat/ismétlés/súly összefűzése ott történik, hogy a
     felület ne kezdjen el a napló belső alakjával számolni. */
  const sideList = $('[data-list="today-exercises"]');
  if (sideList) {
    const exercises = dashboardData.workoutPlan?.exercises ?? [];
    sideList.replaceChildren(...exercises.map((exercise, index) => {
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
    }));

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

/** A fejléc-sáv dátuma. Ugyanabból a clientDate()-ből, amit minden kérés visz —
    így a sávon látott nap mindig az, amelyikre a szerver ír. */
function renderChromeDate() {
  const el = $('[data-chrome-date]');
  if (!el) return;
  const [, month, day] = clientDate().split('.');
  el.textContent = `${month}.${day}.`;
}

export {
  dashboardData, refreshDailyStats, renderChart, renderCharts,
  renderChromeDate, renderDashboard, renderUserName,
};
