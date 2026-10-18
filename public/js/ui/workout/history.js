/**
 * Podium — a PR-lista és a „Korábbi edzések" lekérése
 * ------------------------------------------------------------------------
 * A kirajzolás a render/prs.js és a render/workout.js dolga; ez csak lekér
 * és átad. Újrahívható: edzés-mentés után frissen húzza le a listákat.
 */
import { api } from '../../core/api.js';
import { paintPrs } from '../../render/prs.js';
import { paintHistory } from '../../render/workout.js';

export async function renderPrs() {
  paintPrs(await api.getPrs());
}

export async function renderWorkout() {
  paintHistory(await api.getWorkouts());
}
