/** A személyes rekordok (PR) listája. */

import { api } from '../core/api.js';
import { $, cloneTemplate } from '../core/dom.js';

/** Korábbi rekordok (PR) listája a workout oldalon — a mentett edzések
    PR-jelölt gyakorlataiból (a szerver állítja össze). Újrahívható:
    edzés-mentés után frissen húzza le a listát. */
async function renderPrs() {
  const prs = await api.getPrs();
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
      detailText += ` • 1RM: ${pr.oneRM.toFixed(1)} kg`;
    }
    $('.wk-pr-detail', item).textContent = detailText;
    $('.wk-pr-date', item).textContent = pr.date;
    list.appendChild(item);
  });
  $('[data-prs-empty]').hidden = prs.length > 0;
}

/* ---- Edzés-összegző (summary) ----
   Az értékek az edzésnapló élő DOM-állapotából jönnek (pipált szettek);
   az időtartam az edzés tényleges kezdete (az első aznap kipipált szett)
   óta eltelt idő. Mély-linkkel (#summary) is működik: ilyenkor az aktuális
   naplóállapotot összegzi. */

export { renderPrs };
