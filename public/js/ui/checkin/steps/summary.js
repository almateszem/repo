/** Összegzés és a mentés utáni készenléti kártya. */

import { $, cloneTemplate } from '../../../core/dom.js';
import { animateNumber, formatNumber } from '../../../core/format.js';
import { readinessTone } from '../../../render/recovery.js';
import { CI_READINESS_VERDICTS } from '../constants.js';
import { ciDateStr, ciMuscleLabel } from '../helpers.js';
import { ci } from '../session.js';

/* ---- Összegzés ---- */

function renderSummary(nav) {
  const step = cloneTemplate('tpl-ci-summary');
  $('[data-ci-date]', step).textContent = ciDateStr();

  const { answers, carried } = ci;
  const named = (map) => Object.keys(map).map((key) => ciMuscleLabel(key));

  const painParts = Object.entries(answers.pain)
    .map(([key, value]) => `${ciMuscleLabel(key)} ${value}`);
  // Az általános fájdalmat a varázsló nem kérdezi, de ha a részletes űrlap
  // megadta, kiírjuk — különben néma ellentmondás lenne a „nincs
  // fájdalmam" válasszal.
  if (carried.painGeneral !== null) painParts.push(`általános ${carried.painGeneral}`);

  const rows = [
    ['Alvás', answers.sleepHours === null ? '–' : `${formatNumber(answers.sleepHours)} óra`],
    ['Alvásminőség', `${answers.sleepQuality ?? '–'} / 5`],
    ['Energiaszint', `${answers.energy ?? '–'} / 5`],
    ['Stresszszint', `${answers.stress ?? '–'} / 5`],
    // A kihagyott testsúly nem hiányzó adat, hanem válasz: ma nem mértél.
    ['Testsúly', answers.weightKg === null
      ? 'Ma nem mértem'
      : `${formatNumber(answers.weightKg)} kg`],
    ['Izomláz', named(answers.soreness).join(', ') || 'Nincs'],
    ['Fájdalom', painParts.join(', ') || 'Nincs'],
  ];
  // A varázslóból kimaradó, de eltárolt mezők — hogy látszódjon, mi megy
  // vissza változatlanul.
  if (carried.mood !== null) rows.push(['Közérzet', `${carried.mood} / 5`]);
  if (carried.hydration !== null) rows.push(['Folyadék', `${formatNumber(carried.hydration)} liter`]);

  const list = $('[data-ci-summary]', step);
  list.replaceChildren(...rows.map(([label, value]) => {
    const row = cloneTemplate('tpl-ci-summary-row');
    $('.ci-summary-label', row).textContent = label;
    $('.ci-summary-value', row).textContent = value;
    return row;
  }));

  // A készenlét CSAK a szervertől jöhet. Amíg a friss válaszokat nem
  // mentettük, nincs mit kiírni — kitalált számot nem teszünk a lapra.
  const showScore = ci.readiness !== null && ci.hadCheckin && !ci.dirty;
  renderReadiness(step, showScore ? ci.readiness.overall : null, { animate: false });

  // Ebben a munkamenetben mentve → a gomb helyén a visszajelzés áll.
  // Előre kitöltött, változatlan állapot → a pontszám már látszik, de a
  // mentés elérhető marad (a részletes űrlap közben írhatott bele).
  const saveBtn = $('[data-action="checkin-save"]', step);
  saveBtn.hidden = ci.saved;
  $('[data-ci-saved]', step).hidden = !ci.saved;
  $('[data-ci-done-link]', step).hidden = !(ci.saved || showScore);

  saveBtn.addEventListener('click', () => nav.submit(saveBtn, step));
  return step;
}

/** A készenlét-kártya kitöltése. `overall === null` → magyarázó sor a
    szám helyett. */
function renderReadiness(step, overall, { animate }) {
  const pending = $('[data-ci-pending]', step);
  const scoreWrap = $('[data-ci-score-wrap]', step);
  const barWrap = $('[data-ci-bar-wrap]', step);
  const verdict = $('[data-ci-verdict]', step);

  const known = overall !== null && overall !== undefined;
  pending.hidden = known;
  scoreWrap.hidden = !known;
  barWrap.hidden = !known;
  verdict.textContent = '';
  if (!known) return;

  const tone = readinessTone(overall);
  const card = $('[data-ci-readiness]', step);
  card.dataset.tone = tone;
  verdict.textContent = CI_READINESS_VERDICTS[tone];
  $('[data-ci-bar]', step).style.width = overall + '%';

  const num = $('[data-ci-score]', step);
  if (animate) animateNumber(num, overall, { from: 0, duration: 900 });
  else num.textContent = String(overall);
}

export { renderReadiness, renderSummary };
