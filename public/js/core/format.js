/** Szám-formázás és a számláló-animáció. */

import { prefersReducedMotion } from './dom.js';

/** KIÍRÁSRA: max 1 tizedesjegy, egész számnál tizedes nélkül, magyar
    tizedesvesszővel („82,5"). A szerver is így ír (pl. a volumen-diagram
    „1,2 t" tengelye) — korábban a kettő keveredett egy képernyőn belül. */
const formatNumber = (value) => formatInputNumber(value).replace('.', ',');

/** BEVITELI MEZŐBE: ugyanaz a kerekítés, de ponttal. A type="number" mező és
    a Number() csak a pontot érti — vesszővel a mező üresen maradna. */
const formatInputNumber = (value) => String(Math.round(value * 10) / 10);

/** Elemenként legfeljebb egy futó szám-animáció (az újabb megszakítja a régit). */
const runningNumberAnimations = new WeakMap();

/** Szám "felpörgetése" egy elemben (ease-out, requestAnimationFrame).
    A format opcióval a kiírás formátuma cserélhető (pl. előjeles delta). */
function animateNumber(el, to, { from = null, duration = 800, format = formatNumber } = {}) {
  cancelAnimationFrame(runningNumberAnimations.get(el));

  // A kiírt szám tizedesvesszős (formatNumber) — a parseFloat csak a pontot érti
  const start = from !== null ? from : parseFloat(el.textContent.replace(',', '.')) || 0;
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

export { animateNumber, formatInputNumber, formatNumber };
