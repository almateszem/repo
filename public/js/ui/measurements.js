/** Testösszetétel: körfogat- és testzsír-mérések. */

import { api } from '../core/api.js';
import { $ } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { showToast } from '../core/toast.js';

/** "ÉÉÉÉ.HH.NN" → rendezhető szám. A dátum szöveges összehasonlítása is
    időrendi volna, de a számot a diagram is használja. */
const dayKeyOf = (dateStr) => Number(String(dateStr).replace(/\./g, ''));

/* ---- Testösszetétel ----
   A testsúly egyetlen szám: nem mondja meg, MI épült és mi fogyott. A
   mérési helyek listája (címke, mértékegység, tartomány) a SZERVERTŐL jön —
   egy helyen él, nem sodródik szét a két oldal között. */
let measurementSites = [];

let measurements = [];

/** A mérések listájának cseréje. Azért függvény, és nem közvetlen értékadás:
    egy importált kötésre nem lehet kívülről értéket adni, a mentés viszont a
    Regeneráció oldalról fut (ui/recovery.js). */
function setMeasurements(list) {
  measurements = list;
}

/** Egy mérési hely legutóbbi és legelső értéke — a delta ebből jön. */
const measurementHistory = (site) => measurements
  .filter((entry) => entry.site === site)
  .sort((a, b) => dayKeyOf(b.date) - dayKeyOf(a.date));

function renderMeasurements() {
  const fields = $('[data-body-fields]');
  const list = $('[data-body-list]');
  const empty = $('[data-body-empty]');
  if (!fields || !list) return;

  // Mezők — a legutóbbi mérésből előtöltve.
  fields.replaceChildren(...measurementSites.map((site) => {
    const wrap = document.createElement('div');
    wrap.className = 'rc-body-field';

    const label = document.createElement('label');
    label.setAttribute('for', `rc-body-${site.key}`);
    label.textContent = `${site.label} (${site.unit})`;

    const input = document.createElement('input');
    input.id = `rc-body-${site.key}`;
    input.type = 'number';
    input.inputMode = 'decimal';
    input.step = '0.1';
    input.min = String(site.min);
    input.max = String(site.max);
    input.dataset.site = site.key;
    const latest = measurementHistory(site.key)[0];
    input.value = latest ? String(latest.value) : '';

    wrap.append(label, input);
    return wrap;
  }));

  // Aktuális értékek + változás az első mérés óta.
  const rows = measurementSites
    .map((site) => ({ site, history: measurementHistory(site.key) }))
    .filter(({ history }) => history.length > 0);

  empty.hidden = rows.length > 0;
  list.replaceChildren(...rows.map(({ site, history }) => {
    const latest = history[0];
    const first = history[history.length - 1];

    const li = document.createElement('li');
    li.className = 'rc-body-row';

    const label = document.createElement('span');
    label.className = 'rc-body-row-label';
    label.textContent = `${site.label} · ${latest.date}`;

    const value = document.createElement('span');
    value.className = 'rc-body-row-value';
    value.textContent = `${formatNumber(latest.value)} ${site.unit}`;

    const delta = document.createElement('span');
    delta.className = 'rc-body-row-delta';
    /* A változás CSAK akkor jelenik meg, ha van mihez mérni: egyetlen
       mérésből nem képezünk 0-t — az azt állítaná, hogy nem változott. */
    const diff = history.length > 1 ? latest.value - first.value : null;
    delta.textContent = diff === null
      ? ''
      : `${diff > 0 ? '+' : ''}${formatNumber(diff)} ${site.unit}`;

    const del = document.createElement('button');
    del.className = 'rc-body-del';
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'A legutóbbi mérés törlése';
    del.setAttribute('aria-label', `${site.label} legutóbbi mérésének törlése`);
    del.addEventListener('click', async () => {
      del.disabled = true;
      try {
        await api.deleteMeasurement(latest.id);
        measurements = measurements.filter((entry) => entry.id !== latest.id);
        renderMeasurements();
        showToast('Mérés törölve');
      } catch (err) {
        console.error(err);
        del.disabled = false;
        showToast(err.message || 'Nem sikerült törölni a mérést', 'error');
      }
    });

    li.append(label, value, delta, del);
    return li;
  }));
}

/** A mérések betöltése. A Regeneráció oldal megnyitása hívja — a helyek
    listája csak egyszer kell, az nem változik futás közben. */
async function refreshMeasurements() {
  if (measurementSites.length === 0) measurementSites = await api.getMeasurementSites();
  measurements = await api.getMeasurements();
  renderMeasurements();
}

export { dayKeyOf, refreshMeasurements, renderMeasurements, setMeasurements };
