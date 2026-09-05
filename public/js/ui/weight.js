/** Testsúlynapló: bejegyzések, diagram, lista. */

import { api } from '../core/api.js';
import { $ } from '../core/dom.js';
import { animateNumber, formatNumber } from '../core/format.js';
import { showToast } from '../core/toast.js';
import { refreshDailyStats, renderChart } from '../render/dashboard.js';
import { dayKeyOf } from './measurements.js';

/* ---- Testsúly-napló ----
   A bejegyzéseket a napi check-in írja (PUT /api/checkin → weight_log,
   naponta egy sor); ez a modul csak MEGJELENÍT: a trend-diagramot a
   Regeneráció oldalon és a Δ statot az áttekintőn. Amint van saját
   bejegyzés, a diagram KIZÁRÓLAG azokat mutatja, a skálát pedig a tényleges
   értékekhez igazítjuk — a korábbi 80–86 kg-os fix skálán minden ezen kívüli
   testsúly a diagram aljára lapult, a tengelyfeliratok pedig hazudtak. A
   seed-görbe csak addig látszik, amíg nincs egyetlen valódi bejegyzés sem —
   és ilyenkor a kártya ki is mondja, hogy demo-adatot néz a felhasználó. */
const WEIGHT_CHART_BARS = 12;      // legfeljebb ennyi oszlop látszik

const WEIGHT_CHART_MIN_SPAN = 2;   // kg — ekkora sávot mindenképp lefed a skála

/** A testsúly Δ előjelesen olvasható (+1.2 / -0.8), a 0 előjel nélkül. */
const formatDelta = (value) => (value > 0 ? '+' : '') + formatNumber(value);

/** Diagram-adat a testsúly-bejegyzésekből: a skála alja/teteje a tényleges
    minimum/maximum köré feszül (kis ráhagyással), a tengelyfeliratok pedig
    ebből a skálából állnak elő — nem beégetett értékek. */
function weightChartData(log) {
  const kgs = log.slice(-WEIGHT_CHART_BARS).map((entry) => entry.kg);
  const min = Math.min(...kgs);
  const max = Math.max(...kgs);
  // Fél kilós rácsra kerekített skála, legalább MIN_SPAN széles
  const padding = Math.max((max - min) * 0.25, (WEIGHT_CHART_MIN_SPAN - (max - min)) / 2, 0.25);
  const low = Math.floor((min - padding) * 2) / 2;
  const high = Math.ceil((max + padding) * 2) / 2;
  const span = high - low;

  return {
    heights: kgs.map((kg) => Math.min(Math.max((kg - low) / span * 100, 6), 100)),
    // Négy felirat felülről lefelé, ahogy a seed-charton is
    axis: [0, 1, 2, 3].map((i) => `${formatNumber(high - (span / 3) * i)} kg`),
  };
}

/** A szerverről betöltött testsúly-bejegyzések ({ id, kg, date }), rögzítési
    sorrendben. A check-in varázsló is ebből olvassa a legutóbbi mérést. */
let weightLog = [];

/** A legutóbbi testsúly-bejegyzés, vagy null. */
const latestWeightEntry = () => (weightLog.length ? weightLog[weightLog.length - 1] : null);

/** A MAI bejegyzés, ha van. A szerver dátumformátumára (ÉÉÉÉ.HH.NN) épül —
    ugyanaz, amit a naplóbejegyzések visznek. */
function todayWeightEntry() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const key = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  return weightLog.find((entry) => entry.date === key) ?? null;
}

/** A testsúly-nézetek újrarajzolása a `weightLog`-ból. */
function syncWeightViews({ animateDelta = false } = {}) {
  const chart = $('[data-chart="bodyWeight"]');
  const lastEl = $('[data-weight-last]');
  const emptyEl = $('[data-weight-empty]');
  const deltaEl = $('[data-stat="weightDelta"]');
  // A Δ statot kísérő „kg" mértékegység — egyetlen bejegyzésnél elrejtjük
  const deltaUnitEl = deltaEl?.parentElement && $('.db-stat-unit', deltaEl.parentElement);

  if (weightLog.length === 0) {
    // Marad a seed-görbe — de kimondjuk, hogy az nem a felhasználó adata,
    // és a Δ sem mutat 0-t olyan változásra, amit soha nem mértünk.
    if (emptyEl) emptyEl.hidden = false;
    if (lastEl) lastEl.hidden = true;
    if (deltaEl) deltaEl.textContent = '–';
    if (deltaUnitEl) deltaUnitEl.hidden = true;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;

  if (chart) renderChart(chart, weightChartData(weightLog));

  const latest = weightLog[weightLog.length - 1];
  if (deltaEl) {
    // Δ csak akkor értelmes, ha van mihez viszonyítani. Korábban az első
    // bejegyzés egy beégetett demo-testsúlyhoz (84.6 kg) mérte magát, és
    // ezért teljesen valótlan változást mutatott.
    if (weightLog.length > 1) {
      const delta = latest.kg - weightLog[weightLog.length - 2].kg;
      if (animateDelta) animateNumber(deltaEl, delta, { duration: 600, format: formatDelta });
      else deltaEl.textContent = formatDelta(delta);
      if (deltaUnitEl) deltaUnitEl.hidden = false;
    } else {
      deltaEl.textContent = '–';
      if (deltaUnitEl) deltaUnitEl.hidden = true;
    }
  }

  if (lastEl) {
    lastEl.hidden = false;
    lastEl.textContent = `Utolsó mérés: ${formatNumber(latest.kg)} kg · ${latest.date}`;
  }
}

/** A testsúly-bejegyzések szerkeszthető listája. Egy elgépelt, kiugró érték
    a trend-diagram skáláját lapos vonallá nyomja és a Δ statot is elviszi —
    eddig nem volt út a javításához. A dátum NEM szerkeszthető: a javítás nem
    áthelyezés (ugyanaz az elv, mint a mentett edzésnél). */
const WEIGHT_LIST_LIMIT = 8;

function renderWeightList() {
  const list = $('[data-weight-list]');
  if (!list) return;

  const rows = [...weightLog].sort((a, b) => dayKeyOf(b.date) - dayKeyOf(a.date))
    .slice(0, WEIGHT_LIST_LIMIT);

  list.replaceChildren(...rows.map((entry) => {
    const li = document.createElement('li');
    li.className = 'rc-weight-row';

    const date = document.createElement('span');
    date.className = 'rc-weight-date';
    date.textContent = entry.date;

    const input = document.createElement('input');
    input.className = 'rc-weight-input';
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '30';
    input.max = '300';
    input.step = '0.1';
    input.value = String(entry.kg);
    input.setAttribute('aria-label', `${entry.date} testsúlya kilogrammban`);

    // Mentés a mező elhagyásakor, ha tényleg változott.
    input.addEventListener('change', async () => {
      const kg = Number(input.value);
      if (!Number.isFinite(kg) || kg === entry.kg) { input.value = String(entry.kg); return; }
      input.disabled = true;
      try {
        mergeWeightEntry(await api.updateWeightEntry(entry.id, kg));
        renderWeightList();
        refreshDailyStats().catch(console.error);
        showToast('Testsúly javítva');
      } catch (err) {
        console.error(err);
        input.value = String(entry.kg);
        showToast(err.message || 'Nem sikerült javítani a bejegyzést', 'error');
      } finally {
        input.disabled = false;
      }
    });

    const del = document.createElement('button');
    del.className = 'rc-weight-del';
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'Bejegyzés törlése';
    del.setAttribute('aria-label', `${entry.date} bejegyzésének törlése`);
    del.addEventListener('click', async () => {
      del.disabled = true;
      try {
        await api.deleteWeightEntry(entry.id);
        weightLog = weightLog.filter((item) => item.id !== entry.id);
        syncWeightViews({ animateDelta: true });
        renderWeightList();
        refreshDailyStats().catch(console.error);
        showToast('Bejegyzés törölve');
      } catch (err) {
        console.error(err);
        del.disabled = false;
        showToast(err.message || 'Nem sikerült törölni a bejegyzést', 'error');
      }
    });

    li.append(date, input, del);
    return li;
  }));
}

/** A napló újratöltése a szerverről + újrarajzolás. A Regeneráció oldal
    megnyitása hívja (az adat máshol — akár másik fülön — is változhatott). */
async function refreshWeightLog() {
  weightLog = await api.getWeightLog();
  syncWeightViews();
  renderWeightList();
}

/** A check-in válaszában érkező testsúly-bejegyzés beolvasztása. Naponta egy
    sor van, ezért az azonos id-jű bejegyzést CSERÉLJÜK, nem hozzáfűzzük —
    különben a napi újramentés fantom-oszlopot rakna a diagramra. */
function mergeWeightEntry(entry) {
  if (!entry) return;
  const index = weightLog.findIndex((item) => item.id === entry.id);
  weightLog = index >= 0
    ? weightLog.map((item, i) => (i === index ? entry : item))
    : [...weightLog, entry];
  syncWeightViews({ animateDelta: true });
}

export { formatDelta, latestWeightEntry, mergeWeightEntry, refreshWeightLog, todayWeightEntry };
