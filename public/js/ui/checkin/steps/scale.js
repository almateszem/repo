/** 1–5 skálák (alvásminőség, energia, stressz) — egy renderelő mindháromnak. */

import { $, $$, cloneTemplate } from '../../../core/dom.js';
import { CHECKIN_SCALES } from '../../../render/recovery.js';
import { CI_ADVANCE_MS, CI_SCALE_STEPS } from '../constants.js';
import { ci } from '../session.js';

/* ---- 1–5 skálák ---- */

function renderScale(stepName, nav) {
  const field = CI_SCALE_STEPS[stepName];
  const [, , [low, high], question] = CHECKIN_SCALES.find(([name]) => name === field);

  const step = cloneTemplate('tpl-ci-scale');
  $('[data-ci-title]', step).textContent = question;
  $('[data-ci-low]', step).textContent = `1 · ${low}`;
  $('[data-ci-high]', step).textContent = `5 · ${high}`;

  const group = $('[data-ci-scale]', step);
  group.setAttribute('aria-label', question);
  const nextBtn = $('[data-action="checkin-next"]', step);

  const syncButtons = () => {
    $$('button', group).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === ci.answers[field]));
    });
    nextBtn.disabled = ci.answers[field] === null;
  };

  const choose = (value, { auto }) => {
    ci.answers[field] = value;
    ci.dirty = true;
    syncButtons();
    if (auto) nav.advanceSoon(CI_ADVANCE_MS);
  };

  for (let value = 1; value <= 5; value += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ci-scale-btn';
    btn.dataset.value = String(value);
    btn.textContent = String(value);
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', `${value} — ${value === 1 ? low : value === 5 ? high : 'közepes'}`);
    btn.addEventListener('click', (event) => choose(value, { auto: event.detail !== 0 }));
    group.appendChild(btn);
  }
  syncButtons();

  // Számbillentyűk: a setupShortcuts ezen az oldalon félreáll, itt viszont
  // a válasz gyors útja (a designból hiányzó billentyűzet-affordancia).
  step.addEventListener('keydown', (event) => {
    const value = Number(event.key);
    if (!Number.isInteger(value) || value < 1 || value > 5) return;
    event.preventDefault();
    choose(value, { auto: false });
    nextBtn.focus();
  });

  nextBtn.addEventListener('click', () => nav.goNext());
  return step;
}

export { renderScale };
