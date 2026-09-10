/** Alvás-lépés: óraszám léptetővel és gyorsgombokkal. */

import { $, $$, cloneTemplate } from '../../../core/dom.js';
import { formatNumber } from '../../../core/format.js';
import { handleStepClick } from '../../../render/sets.js';
import { CI_PRESET_ADVANCE_MS, CI_SLEEP_MAX, CI_SLEEP_MIN, CI_SLEEP_PRESETS } from '../constants.js';
import { ciClamp } from '../helpers.js';
import { ci } from '../session.js';

/* ---- Alvás ---- */

function renderSleep(nav) {
  const step = cloneTemplate('tpl-ci-sleep');
  const input = $('#ci-sleep', step);
  input.value = ci.answers.sleepHours ?? 7.5;

  const presets = $('[data-ci-presets]', step);
  const syncPresets = () => {
    $$('button', presets).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === Number(input.value)));
    });
  };

  // A ± gombokat a megosztott handleStepClick lépteti (min/max/step onnan
  // jön). A varázsló lépései cserélődnek, ezért a hívás ide kerül: a lapon
  // nincs olyan delegált kezelő, ami elvégezné. A léptetés `input`
  // eseményt vált ki, az alábbi listener menti és szinkronizálja a
  // preseteket — itt már csak az automatikus továbblépést kell leállítani.
  step.addEventListener('click', (event) => {
    if (!handleStepClick(event)) return;
    nav.cancelAdvance();
  });
  input.addEventListener('input', () => { syncPresets(); commitSleep(); });

  CI_SLEEP_PRESETS.forEach((value) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ci-preset';
    btn.dataset.value = String(value);
    btn.textContent = formatNumber(value);
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', `${formatNumber(value)} óra`);
    btn.addEventListener('click', (event) => {
      input.value = value;
      syncPresets();
      commitSleep();
      // Billentyűs aktiválás (detail === 0) nem léptet magától.
      if (event.detail !== 0) nav.advanceSoon(CI_PRESET_ADVANCE_MS);
    });
    presets.appendChild(btn);
  });
  syncPresets();

  $('[data-action="checkin-next"]', step).addEventListener('click', () => {
    commitSleep();
    nav.goNext();
  });

  function commitSleep() {
    const value = Number(input.value);
    // A felhasználó látta a kiírt számot, tehát az a válasza — de a
    // tartományon kívüli kézi bevitelt nem küldjük tovább.
    ci.answers.sleepHours = Number.isFinite(value)
      ? ciClamp(value, CI_SLEEP_MIN, CI_SLEEP_MAX)
      : null;
    ci.dirty = true;
  }

  return step;
}

export { renderSleep };
