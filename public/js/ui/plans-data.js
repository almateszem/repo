/**
 * Podium — a Tervek oldal listájának adatai
 * ------------------------------------------------------------------------
 * A tervlista lekérése és a legutóbbi másolata; a kirajzolás a
 * render/plans.js-é (renderPlanList).
 */
import { api } from '../core/api.js';
import { renderPlanList } from '../render/plans.js';

/** A legutóbb lekért tervlista — a nyíl- és a szerkesztés gomb ebből veszi
    a terv adatait (a kártyák dataset.planIndex-e ide mutat). */
export let plansData = [];

/** Újrahívható: mentés/szerkesztés után és a Tervek oldal megnyitásakor
    frissen húzza le és építi újra a listát (a progress a mai teljesítést
    követi, ezért minden megjelenéskor érdemes újrakérni). */
export async function renderPlans() {
  plansData = await api.getPlans();
  renderPlanList(plansData);
}
