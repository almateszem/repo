/** A számmezők −/+ léptetőgombja (edzésnapló, terv-építő, check-in,
    Regeneráció) — egyetlen delegált kattintás-kezelő. */

import { $ } from './dom.js';
import { formatInputNumber } from './format.js';

/** Léptetőgomb (−/+): a lépésközt az input `step` attribútuma adja
    (1 ismétlés, 2.5 kg = a legkisebb tárcsapár). Az érték a min/max közé
    szorul, és `input` eseményt váltunk ki, hogy az arra kötött automatikus
    mentés is lefusson. Igazzal tér vissza, ha ő kezelte a kattintást. */
function handleStepClick(event) {
  const stepBtn = event.target.closest('.wk-num-step');
  if (!stepBtn) return false;

  const input = $('.wk-num-input', stepBtn.parentElement);
  const step = Number(input.step) || 1;
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);
  const current = Number(input.value);
  const next = (Number.isFinite(current) ? current : 0) + Number(stepBtn.dataset.dir) * step;

  input.value = formatInputNumber(Math.min(Math.max(next, min), max));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export { handleStepClick };
