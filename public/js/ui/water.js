/** Vízmérő a Táplálkozás oldalon.
 *
 * A +250 ml NEM helyi számláló: a szerver minden koppintásnál a check-in
 * folyadék-mezőjét is frissíti, tehát a készenléti pontszám is elmozdul tőle.
 * Enélkül a mérő dísz volna — a Recovery Engine a folyadékbevitelt a
 * táplálkozás-komponensben súlyozza.
 *
 * A napi cél a szervertől jön (~33 ml testsúly-kilónként), nem beégetett
 * három liter: a motor ugyanezzel a képlettel számol, és két külön cél két
 * külön „teljesítettem" érzést adna.
 */

import { api } from '../core/api.js';
import { $ } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { hooks } from '../core/page-hooks.js';
import { showToast } from '../core/toast.js';

/** Egy koppintás mennyisége. A szerver 1–3000 ml között fogad el egy tételt;
    ez a lépés a pohár/palack nagyságrendje. */
const SIP_ML = 250;

async function setupWaterMeter() {
  const section = $('.nu-water');
  if (!section) return;

  const litersEl = $('[data-water-liters]', section);
  const goalEl = $('[data-water-goal]', section);
  const fillEl = $('[data-water-fill]', section);
  const trackEl = $('[data-water-track]', section);
  const addBtn = $('[data-action="add-water"]', section);
  const undoBtn = $('[data-action="undo-water"]', section);

  let day = { totalMl: 0, entries: [], targetMl: 2640 };

  const render = () => {
    const liters = Math.round((day.totalMl / 1000) * 100) / 100;
    const target = Math.round((day.targetMl / 1000) * 10) / 10;
    litersEl.textContent = formatNumber(liters);
    goalEl.textContent = `cél ${formatNumber(target)} liter`;

    const pct = day.targetMl > 0 ? Math.min(100, (day.totalMl / day.targetMl) * 100) : 0;
    fillEl.style.width = `${pct}%`;
    trackEl.classList.toggle('is-full', day.totalMl >= day.targetMl);
    trackEl.setAttribute('aria-label',
      `Napi folyadékbevitel: ${formatNumber(liters)} liter a ${formatNumber(target)} literes célból`);

    // Visszavonni csak akkor van mit, ha van bejegyzés. A gomb azért kell,
    // mert a hozzáadás egyetlen koppintás: téves érintés után különben csak
    // a check-in űrlapján lehetne javítani.
    undoBtn.hidden = day.entries.length === 0;
  };

  const apply = (next) => { day = next; render(); };

  /* A hálózati hiba nem hagyhatja a gombot letiltva: a felhasználó különben
     úgy érezné, hogy elakadt, pedig csak nem ment át a kérés. */
  const guard = async (btn, work) => {
    btn.disabled = true;
    try {
      apply(await work());
    } catch (err) {
      console.error('Vízmérő hiba:', err);
      showToast('Nem sikerült menteni a folyadékot.', 'error');
    } finally {
      btn.disabled = false;
    }
  };

  addBtn.addEventListener('click', () => guard(addBtn, () => api.addWater(SIP_ML)));
  undoBtn.addEventListener('click', () => guard(undoBtn, () => api.deleteWaterEntry(day.entries[0].id)));

  hooks.refreshWater = async () => { apply(await api.getWater()); };
  await hooks.refreshWater();
}

export { setupWaterMeter };
