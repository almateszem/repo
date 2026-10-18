/** Az edzés-összegző: időtartam, volumen, izomtérkép, idézet. */

import { $ } from '../core/dom.js';
import { animateNumber } from '../core/format.js';
import { hooks } from '../core/page-hooks.js';

const SUMMARY_QUOTES = [
  'Erős voltál ma — a következő edzés még jobb lesz!',
  'Minden pipált szett egy lépés a célod felé.',
  'A folyamatosság veri a tökéletességet — ma is jelen voltál.',
  'Szép munka! A regeneráció most ugyanolyan fontos, mint a súly.',
];

let summaryQuoteIndex = Math.floor(Math.random() * SUMMARY_QUOTES.length);

/** Az összegző kirajzolása. A `summary` a hívóé (ui/summary.js): lezárás
    után a rögzített pillanatkép, egyébként az élő naplóállapot
    (ui/workout/summary-data.js → summarizeWorkout). */
function renderSummary(summary) {
  $('[data-su-name]').textContent = summary.name;
  $('[data-su-pr]').hidden = !summary.hasPr;
  $('[data-su-sets-total]').textContent = String(summary.total);
  $('[data-su-quote]').textContent = SUMMARY_QUOTES[summaryQuoteIndex % SUMMARY_QUOTES.length];
  summaryQuoteIndex += 1; // minden megnyitásra másik motivációs sor jut

  animateNumber($('[data-su-sets-done]'), summary.done, { from: 0, duration: 700 });
  animateNumber($('[data-su-duration]'), summary.minutes, { from: 0, duration: 800 });

  // A visszajelzés-blokk minden megnyitáskor újraszinkronizál (más edzés,
  // vagy már elküldött visszajelzés).
  hooks.refreshSummaryFeedback?.();
}

/* ---- Regeneráció (Recovery Engine) ---- */

export { renderSummary };
