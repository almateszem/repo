/**
 * PR-jelzők az edzésnapló gyakorlat-kártyáin.
 *
 * A „PR" gomb `aria-pressed` állapota az EGYETLEN, kizárólag képlet által
 * vezérelt jelzés a naplóban — ezért áll külön a szerkesztő többi részétől.
 *
 * A csúcsokat nem tárolja: a vezérlő adja `getMaxes`-ként, mert azok minden
 * mentett edzés után újratöltődnek a szerverről.
 */

import { $, $$ } from '../../core/dom.js';
import { readSetRow } from '../../render/sets.js';

export function createPrIndicators({ page, getMaxes }) {
/** Egy gyakorlat PR-jelzésének frissítése — kizárólag a teljesített
    (pipált) szettek 1RM-jét nézi; a nem pipált szettekbe írt számok nem
    számítanak, függetlenül attól, hogy van-e egyáltalán pipált szett.
    Ha a gyakorlatnak nincs korábbi rekordja, bármelyik pipált, érvényes
    szám PR-nak számít. A gomb `aria-pressed` állapotát írja — ez az
    egyetlen, kizárólag a képlet által vezérelt állapot. */
const updateExercisePrIndicator = (exerciseCard) => {
  if (!exerciseCard) return;
  const prBtn = $('.wk-pr', exerciseCard);
  const exerciseName = $('.wk-exercise-name', exerciseCard)?.textContent?.trim();
  if (!prBtn || !exerciseName) return;

  const setRows = $$('.wk-set-list .wk-set-row', exerciseCard);
  let bestCompleted1rm = 0;

  // Az Epley-képlet: 1RM = weight * (1 + reps / 30)
  for (const row of setRows) {
    const set = readSetRow(row);
    if (!set.done) continue;

    const reps = Number(set.reps);
    const weight = Number(set.weight);
    if (!Number.isFinite(reps) || !Number.isFinite(weight) || reps < 1 || weight <= 0) continue;

    const oneRM = weight * (1 + reps / 30);
    if (oneRM > bestCompleted1rm) bestCompleted1rm = oneRM;
  }

  // Nincs korábbi rekord az exercise-hez → bármilyen érvényes szám PR-nak számít
  const currentMax = getMaxes()[exerciseName] ?? 0;
  const hasPotentialPr = bestCompleted1rm > 0 && bestCompleted1rm > currentMax;
  prBtn.setAttribute('aria-pressed', String(hasPotentialPr));
};

/** Az összes exercise PR jelzésének frissítése — az edzés betöltésekor
    és az applyTemplate után meghívjuk, hogy az összes szett PR státusza
    szinkronban legyen az getMaxes()-szel. */
const refreshAllPrIndicators = () => {
  $$('.wk-exercise', page).forEach(updateExercisePrIndicator);
};

  return { update: updateExercisePrIndicator, refreshAll: refreshAllPrIndicators };
}
