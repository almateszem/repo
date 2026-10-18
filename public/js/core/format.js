/** Szám-formázás és a számláló-animáció. */

import { prefersReducedMotion } from './dom.js';

/** KIÍRÁSRA: max 1 tizedesjegy, egész számnál tizedes nélkül, magyar
    tizedesvesszővel („82,5"). A szerver is így ír (pl. a volumen-diagram
    „1,2 t" tengelye) — korábban a kettő keveredett egy képernyőn belül. */
const formatNumber = (value) => formatInputNumber(value).replace('.', ',');

/** BEVITELI MEZŐBE: ugyanaz a kerekítés, de ponttal. A type="number" mező és
    a Number() csak a pontot érti — vesszővel a mező üresen maradna. */
const formatInputNumber = (value) => String(Math.round(value * 10) / 10);

/** EGÉSZ SZÁMOKHOZ: a formatNumber egy tizedesig kerekít, ami felpörgetés
    közben tört értékeket villantana fel. A tizedesvessző ráadásul szélesíti
    a szöveget, így a nagy számoknál (készenléti százalék) minden képkockán
    ugrálna az elrendezés. Darabszámnál, pontszámnál, százaléknál ezt add át
    az animateNumber format opciójának. */
const formatWhole = (value) => String(Math.round(value));

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

/** Relatív idő az üzenet ISO-8601 időbélyegéből. Az üzenetek percre pontos
    ideje nem érdekes, a „mikor" viszont igen — a hét fölött ezért dátumra
    vált. (A szerver UTC-t küld, a Date a böngésző zónájában értelmezi.) */
function relativeTime(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  if (minutes < 1) return 'most';
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'tegnap';
  if (days < 7) return `${days} napja`;
  return at.toLocaleDateString('hu-HU');
}

/** "ÉÉÉÉ.HH.NN" → rendezhető szám. A dátum szöveges összehasonlítása is
    időrendi volna, de a számot a diagram is használja. */
const dayKeyOf = (dateStr) => Number(String(dateStr).replace(/\./g, ''));

/** A változás előjelesen olvasható (+1.2 / -0.8), a 0 előjel nélkül — a
    testsúly Δ-jához. */
const formatDelta = (value) => (value > 0 ? '+' : '') + formatNumber(value);

export {
  animateNumber,
  dayKeyOf,
  formatDelta,
  formatInputNumber,
  formatNumber,
  formatWhole,
  relativeTime,
};
