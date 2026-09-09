/** Test-térkép lépés: a közös bodymap komponens beillesztése a varázslóba. */

import { $, cloneTemplate } from '../../../core/dom.js';
import { createBodyMap } from '../../bodymap/index.js';
import { CI_MAP_MODES, CI_PAIN_BLOCK } from '../constants.js';
import { ciMuscleLabel } from '../helpers.js';
import { ci } from '../session.js';

function renderMap(stepName, nav) {
  const mode = CI_MAP_MODES[stepName];

  const step = cloneTemplate('tpl-ci-map');
  $('[data-ci-eyebrow]', step).textContent = mode.eyebrow;
  $('[data-ci-title]', step).textContent = mode.title;
  $('[data-ci-sub]', step).textContent = mode.sub;
  $('[data-ci-legend]', step).textContent = mode.legend;

  const map = createBodyMap({
    max: mode.max,
    defaultValue: mode.defaultValue,
    noun: mode.noun,
    values: ci.answers[mode.field],
    muscleLabel: ciMuscleLabel,
    blockFrom: mode.field === 'pain' ? CI_PAIN_BLOCK : null,
    onChange: () => { ci.dirty = true; },
  });
  $('[data-ci-map]', step).replaceWith(map.el);

  $('[data-action="checkin-next"]', step).addEventListener('click', () => nav.goNext());
  return step;
}

export { renderMap };
