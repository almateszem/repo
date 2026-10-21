/** Oszlopdiagram kirajzolása egy data-chart konténerbe (Áttekintő, edzés-összegző,
    testsúly). */

import { $ } from './dom.js';

/** Egy chart konténer (újra)feltöltése — a --i a lépcsőzetes animációhoz kell.
    Újrarendereléskor a bar-in animáció is újraindul (reduced motion mellett nem). */
function renderChart(container, data) {
  const bars = $('.chart-bars', container);
  bars.replaceChildren();
  data.heights.forEach((height, index) => {
    const bar = document.createElement('span');
    bar.style.setProperty('--h', height + '%');
    bar.style.setProperty('--i', index);
    bars.appendChild(bar);
  });

  const axis = $('.chart-axis', container);
  axis.replaceChildren();
  data.axis.forEach((label) => {
    const span = document.createElement('span');
    span.textContent = label;
    axis.appendChild(span);
  });

  // A mai oszlop kiemelése. Csak akkor, ha a szerver megmondja, melyik az:
  // a heti diagramoknál az utolsó oszlop vasárnap, nem a mai nap.
  if (Number.isInteger(data.accentIndex)) {
    const bar = bars.children[data.accentIndex];
    if (bar) bar.classList.add('is-today');
  }

  // Nap-feliratok az oszlopok alá. Opcionális: a régi diagramok csak a jobb
  // oldali tengelyt használják, azoknál nincs ilyen konténer.
  const labels = $('.chart-labels', container);
  if (!labels) return;
  labels.replaceChildren();
  (data.labels || []).forEach((label) => {
    const span = document.createElement('span');
    span.textContent = label;
    labels.appendChild(span);
  });
}

export { renderChart };
