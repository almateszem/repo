/** Kapu-lépések: van-e izomláz / fájdalom. A válasz dönti el a következő lépést. */

import { $, cloneTemplate } from '../../../core/dom.js';
import { CI_GATES } from '../constants.js';
import { ci } from '../session.js';

/* ---- Kapuk ---- */

function renderGate(stepName, nav) {
  const gate = CI_GATES[stepName];
  const step = cloneTemplate('tpl-ci-gate');
  $('[data-ci-eyebrow]', step).textContent = gate.eyebrow;
  $('[data-ci-title]', step).textContent = gate.title;
  $('[data-ci-sub]', step).textContent = gate.sub;

  const wrap = $('[data-ci-gates]', step);
  [['no', 'ok'], ['yes', 'accent']].forEach(([answer, tone]) => {
    const [label, sub] = gate[answer];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ci-gate';
    btn.dataset.tone = tone;
    btn.setAttribute('aria-pressed', String(ci.gates[gate.key] === answer));

    const title = document.createElement('span');
    title.className = 'ci-gate-label';
    title.textContent = label;
    const note = document.createElement('span');
    note.className = 'ci-gate-sub';
    note.textContent = sub;
    btn.append(title, note);

    btn.addEventListener('click', () => {
      ci.gates[gate.key] = answer;
      ci.dirty = true;
      // A „nincs" válasz törli a korábban megjelölt értékeket is —
      // különben egy meggondolt válasz némán hagyná bent őket.
      if (answer === 'no') ci.answers[gate.key === 'sore' ? 'soreness' : 'pain'] = {};
      // A sorrend most már tartalmazza (vagy nem) a térkép-lépést.
      nav.goNext();
    });
    wrap.appendChild(btn);
  });
  return step;
}

export { renderGate };
