/** Edzés-összegző oldal és a heti összehasonlítás. */

import { SESSION_LOST, api } from '../core/api.js';
import { $, $$ } from '../core/dom.js';
import { animateNumber, formatNumber } from '../core/format.js';
import { hooks, shared } from '../core/page-hooks.js';
import { showToast } from '../core/toast.js';
import { navigate } from '../nav/router.js';
import { renderChart } from '../render/dashboard.js';
import { buildScale, readScale, writeScale } from '../render/recovery.js';
import { lastSummary } from '../render/summary.js';

/** Az edzés utáni visszajelzés két skálája: [mező, címke, [1-es, 5-ös vég]].
    A buildScale ugyanaz a chip-primitív, amit a check-in használ — így a
    két felület egyformán viselkedik (a `null` itt is „nem adta meg"). */
const FEEDBACK_SCALES = [
  ['difficulty', 'Mennyire volt nehéz?', ['könnyű', 'nagyon nehéz']],
  ['mood', 'Hogy érezted magad?', ['rosszul', 'remekül']],
];

function setupSummary() {
  $('[data-action="summary-dashboard"]').addEventListener('click', () => navigate('dashboard'));

  const section = $('[data-su-feedback]');
  const form = $('[data-form="workout-feedback"]', section);
  const scalesWrap = $('[data-su-feedback-scales]', section);
  const noteInput = $('#su-feedback-note');
  const doneEl = $('[data-su-feedback-done]', section);
  const leadEl = $('[data-su-feedback-lead]', section);
  const submit = $('.su-feedback-send', section);

  FEEDBACK_SCALES.forEach(([name, label, [low, high]]) => {
    scalesWrap.appendChild(buildScale({ name, label, min: 1, max: 5, hint: `1 = ${low} · 5 = ${high}` }));
  });

  // A buildScale a `data-field` attribútumba teszi a mező nevét.
  const scaleFor = (name) => $(`[data-field="${name}"]`, scalesWrap);

  /** A blokk állapotának beállítása a friss összegzésből. A `refreshSummaryFeedback`
      néven kívülről is hívható — a renderSummary minden megnyitáskor hívja. */
  /* ---- Megjegyzés egy gyakorlathoz ---- */
  const noteSection = $('[data-su-note]');
  const noteForm = $('[data-form="exercise-note"]', noteSection);
  const noteSelect = $('#su-note-exercise');
  const noteText = $('#su-note-text');
  const noteList = $('[data-su-note-list]', noteSection);
  const noteSend = $('.su-feedback-send', noteSection);

  /** A lezárt edzéshez tartozó megjegyzések kirajzolása. Csak az EHHEZ az
      edzéshez tartozókat mutatjuk: a cél "edzésId:index" alakú. */
  const renderNotes = (byTarget) => {
    const workoutId = lastSummary?.workoutId;
    const rows = [];
    for (const [target, list] of Object.entries(byTarget ?? {})) {
      const [id, index] = String(target).split(':');
      if (Number(id) !== workoutId) continue;
      const name = lastSummary.exercises?.[Number(index)] ?? 'Gyakorlat';
      for (const comment of list) rows.push({ name, comment });
    }
    noteList.replaceChildren(...rows.map(({ name, comment }) => {
      const li = document.createElement('li');
      li.className = 'su-note-item';
      const who = document.createElement('b');
      who.textContent = name;
      li.append(who, document.createTextNode(` — ${comment.text}`));
      return li;
    }));
  };

  const loadNotes = async () => {
    try {
      renderNotes(await api.getMyCommentsByTarget());
    } catch (err) {
      // A megjegyzés-lista másodlagos: a hiánya ne rontsa el az összegzőt.
      console.error('A megjegyzések betöltése nem sikerült:', err);
    }
  };

  noteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const workoutId = lastSummary?.workoutId;
    const text = noteText.value.trim();
    if (!workoutId || !text) return;

    noteSend.disabled = true;
    try {
      await api.addMyComment(`${workoutId}:${noteSelect.value}`, text);
      noteText.value = '';
      await loadNotes();
      showToast('Megjegyzés hozzáfűzve');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'A megjegyzést nem sikerült menteni', 'error');
    } finally {
      noteSend.disabled = false;
    }
  });

  hooks.refreshSummaryFeedback = () => {
    /* A megjegyzés-blokk edző NÉLKÜL is látszik: a saját naplód része
       marad. Csak mentett edzés kell hozzá — a mély-linkkel megnyitott
       összegzőn nincs mire hivatkozni. */
    const names = lastSummary?.exercises ?? [];
    noteSection.hidden = !lastSummary?.workoutId || names.length === 0;
    if (!noteSection.hidden) {
      noteSelect.replaceChildren(...names.map((name, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = name;
        return option;
      }));
      noteText.value = '';
      loadNotes();
    }

    /* Két feltétel kell: (1) MOST zárult le egy edzés, tehát van azonosító
       (mély-linkkel megnyitott összegzőn nincs), és (2) van edző, akinek a
       visszajelzés szólna. */
    const workoutId = lastSummary?.workoutId ?? null;
    const visible = Boolean(workoutId) && shared.hasCoachLink;
    section.hidden = !visible;
    if (!visible) return;

    // Új edzés → tiszta lap. A már elküldött visszajelzést nem írjuk felül.
    const alreadySent = lastSummary.feedbackSent === true;
    form.hidden = alreadySent;
    doneEl.hidden = !alreadySent;
    leadEl.hidden = alreadySent;
    if (alreadySent) return;

    FEEDBACK_SCALES.forEach(([name]) => writeScale(scaleFor(name), null));
    noteInput.value = '';
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const workoutId = lastSummary?.workoutId;
    if (!workoutId) return;

    const body = {
      difficulty: readScale(scaleFor('difficulty')),
      mood: readScale(scaleFor('mood')),
      note: noteInput.value.trim(),
    };
    /* Üres visszajelzést nem küldünk el: az edzőnek egy csupa-null sor
       semmit nem mond, viszont értesítést szülne. */
    if (body.difficulty === null && body.mood === null && !body.note) {
      showToast('Adj meg legalább egy értéket vagy írj pár szót', 'error');
      return;
    }

    submit.disabled = true;
    try {
      await api.saveWorkoutFeedback(workoutId, body);
      lastSummary.feedbackSent = true;
      hooks.refreshSummaryFeedback();
      showToast('Visszajelzés elküldve');
    } catch (err) {
      if (err.code !== SESSION_LOST) {
        console.error(err);
        showToast(err.message || 'A visszajelzést nem sikerült elküldeni', 'error');
      }
    } finally {
      submit.disabled = false;
    }
  });

  hooks.refreshSummaryFeedback();
}

/** Heti volumen-összehasonlítás: a váltógomb újrarendereli a chartot
    (a bar-in animáció újraindul), az összvolumen felpörög az új értékre.
    A `refresh()` friss adatot húz le a szerverről — az edzés lezárása ezt
    hívja, hogy a most naplózott szettek azonnal megjelenjenek. */
async function setupWeeklyCompare() {
  const section = $('.wk-compare');
  const chart = $('[data-chart]', section);
  const totalEl = $('[data-compare-total]');
  const noteEl = $('[data-compare-note]');

  // A két hét adata (volumeThisWeek / volumeLastWeek)
  let charts = await api.getCharts();

  /** Az éppen kiválasztott időszak kulcsa (a váltógombokból). */
  const activePeriod = () =>
    $$('.wk-toggle-btn', section).find((b) => b.getAttribute('aria-pressed') === 'true')
      ?.dataset.period || 'volumeThisWeek';

  const applyPeriod = (period, { animate = false } = {}) => {
    const data = charts[period];
    if (!data) return;
    chart.dataset.chart = period;
    chart.setAttribute('aria-label', data.ariaLabel);
    renderChart(chart, data);
    if (animate) animateNumber(totalEl, data.total, { duration: 600 });
    else totalEl.textContent = formatNumber(data.total);
    noteEl.textContent = data.note;
  };

  // Kezdeti (ez a hét) összesítő a felületre — így nincs beégetett placeholder
  applyPeriod('volumeThisWeek');

  section.addEventListener('click', (event) => {
    const btn = event.target.closest('.wk-toggle-btn');
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return;

    $$('.wk-toggle-btn', section).forEach((b) => {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    applyPeriod(btn.dataset.period, { animate: true });
  });

  hooks.refreshVolumeChart = async () => {
    charts = await api.refreshCharts();
    applyPeriod(activePeriod(), { animate: true });
  };
}

export { setupSummary, setupWeeklyCompare };
