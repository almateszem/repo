/** Testsúly-lépés: mai mérés, viszonyítási ponttal és „ma nem mértem" kiúttal. */

import { $, $$, cloneTemplate } from '../../../core/dom.js';
import { formatNumber } from '../../../core/format.js';
import { formatDelta, latestWeightEntry, todayWeightEntry } from '../../weight.js';
import { CI_PRESET_ADVANCE_MS, CI_WEIGHT_FALLBACK, CI_WEIGHT_MAX, CI_WEIGHT_MIN, CI_WEIGHT_PRESET_OFFSETS } from '../constants.js';
import { ciClamp } from '../helpers.js';
import { ci } from '../session.js';

/** A viszonyítási bejegyzés a gyorsgombokhoz és a ± kiindulópontjához:
    a mai mérés, ha ma már volt, egyébként a legutóbbi. */
const ciWeightReference = () => todayWeightEntry() ?? latestWeightEntry();

function renderWeight(nav) {
  const step = cloneTemplate('tpl-ci-weight');
  const input = $('#ci-weight', step);
  const presets = $('[data-ci-presets]', step);
  const note = $('[data-ci-weight-note]', step);
  const reference = ciWeightReference();
  const todayEntry = todayWeightEntry();

  // A mezőt SZÁNDÉKOSAN nem töltjük ki a legutóbbi méréssel: egy előre
  // beírt szám a „Tovább" gombbal olyan méréssé válna, ami meg sem történt.
  // A ma már rögzített érték viszont szerkeszthető — azt visszaadjuk.
  input.value = ci.answers.weightKg === null ? '' : formatNumber(ci.answers.weightKg);

  const syncStep = () => {
    const value = ci.answers.weightKg;
    $$('button', presets).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === value));
    });
    note.textContent = weightNote(value);
  };

  /** A mező alatti magyarázó sor: mihez képest van a beírt érték, illetve
      mi történik, ha üresen hagyod. */
  function weightNote(value) {
    if (value === null) {
      return reference
        ? `Üresen hagyva kihagyjuk — az utolsó mérésed ${formatNumber(reference.kg)} kg (${reference.date}).`
        : 'Üresen hagyva kihagyjuk — ma nem kerül bejegyzés a testsúly-naplóba.';
    }
    if (todayEntry) {
      return `Ma már rögzítettél ${formatNumber(todayEntry.kg)} kg-ot — a mentés ezt írja felül.`;
    }
    if (!reference) return 'Ez lesz az első bejegyzésed a testsúly-naplóban.';
    const diff = value - reference.kg;
    return Math.abs(diff) < 0.05
      ? `Ugyanannyi, mint a legutóbbi mérésed (${reference.date}).`
      : `${formatDelta(diff)} kg a legutóbbi méréshez képest (${reference.date}).`;
  }

  function commitWeight() {
    const raw = input.value.trim();
    const value = Number(raw);
    ci.answers.weightKg = raw === '' || !Number.isFinite(value)
      ? null
      : ciClamp(Math.round(value * 10) / 10, CI_WEIGHT_MIN, CI_WEIGHT_MAX);
    ci.dirty = true;
    syncStep();
  }

  // Gépelés közben nem írunk vissza a mezőbe (a félkész „8" nem ugrik
  // 30-ra), elhagyáskor viszont a látott és a tárolt érték egyezzen.
  input.addEventListener('input', commitWeight);
  input.addEventListener('blur', () => {
    input.value = ci.answers.weightKg === null ? '' : formatNumber(ci.answers.weightKg);
  });

  // A ± gombokat a megosztott handleStepClick lépteti; üres mezőnél viszont
  // 0-ról indulna (és a min miatt 30-ra ugrana), ezért az első koppintás
  // csak beülteti a viszonyítási értéket, és ott meg is áll.
  step.addEventListener('click', (event) => {
    if (!event.target.closest('.wk-num-step')) return;
    nav.cancelAdvance();
    if (input.value.trim() !== '') return;
    event.stopPropagation();
    input.value = formatNumber(reference?.kg ?? CI_WEIGHT_FALLBACK);
    commitWeight();
  });

  if (reference) {
    CI_WEIGHT_PRESET_OFFSETS.forEach((offset) => {
      const value = Math.round((reference.kg + offset) * 10) / 10;
      if (value < CI_WEIGHT_MIN || value > CI_WEIGHT_MAX) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ci-preset';
      btn.dataset.value = String(value);
      btn.textContent = formatNumber(value);
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', `${formatNumber(value)} kilogramm`);
      btn.addEventListener('click', (event) => {
        input.value = formatNumber(value);
        commitWeight();
        // Billentyűs aktiválás (detail === 0) nem léptet magától.
        if (event.detail !== 0) nav.advanceSoon(CI_PRESET_ADVANCE_MS);
      });
      presets.appendChild(btn);
    });
    presets.hidden = presets.childElementCount === 0;
  }

  $('[data-ci-weight-skip]', step).addEventListener('click', () => {
    input.value = '';
    commitWeight(); // → null: ma nincs mérés
    nav.goNext();
  });

  $('[data-action="checkin-next"]', step).addEventListener('click', () => {
    commitWeight();
    nav.goNext();
  });

  syncStep();
  return step;
}

export { ciWeightReference, renderWeight };
