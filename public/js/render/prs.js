/** A személyes rekordok (PR) listája. */

import { $, cloneTemplate } from '../core/dom.js';
import { formatNumber } from '../core/format.js';

/** Korábbi rekordok (PR) listája a workout oldalon — a mentett edzések
    PR-jelölt gyakorlataiból (a szerver állítja össze; a lekérés:
    ui/workout/history.js → renderPrs). */
function paintPrs(prs) {
  const list = $('[data-list="prs"]');
  list.replaceChildren();
  prs.forEach((pr, index) => {
    const item = cloneTemplate('tpl-pr');
    item.style.setProperty('--i', index);
    item.dataset.exercise = pr.exercise;
    $('.wk-pr-exercise', item).textContent = pr.exercise;

    // Detail: szett információ + 1RM érték
    let detailText = pr.detail;
    if (pr.oneRM !== null && pr.oneRM > 0) {
      detailText += ` • 1RM: ${formatNumber(pr.oneRM)} kg`;
    }
    $('.wk-pr-detail', item).textContent = detailText;
    $('.wk-pr-date', item).textContent = pr.date;
    list.appendChild(item);
  });
  $('[data-prs-empty]').hidden = prs.length > 0;
}

export { paintPrs };
