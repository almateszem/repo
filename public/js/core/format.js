/** Szám-formázás és a számláló-animáció. */

import { prefersReducedMotion } from './dom.js';

/** Max 1 tizedesjegy, egész számnál tizedes nélkül. */
const formatNumber = (value) => String(Math.round(value * 10) / 10);

/** Elemenként legfeljebb egy futó szám-animáció (az újabb megszakítja a régit). */
const runningNumberAnimations = new WeakMap();

/** Szám "felpörgetése" egy elemben (ease-out, requestAnimationFrame).
    A format opcióval a kiírás formátuma cserélhető (pl. előjeles delta). */
function animateNumber(el, to, { from = null, duration = 800, format = formatNumber } = {}) {
  cancelAnimationFrame(runningNumberAnimations.get(el));

  const start = from !== null ? from : (parseFloat(el.textContent) || 0);
  if (prefersReducedMotion || start === to) {
    el.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = format(start + (to - start) * eased);
    if (progress < 1) runningNumberAnimations.set(el, requestAnimationFrame(tick));
  };
  runningNumberAnimations.set(el, requestAnimationFrame(tick));
}

export { animateNumber, formatNumber };
