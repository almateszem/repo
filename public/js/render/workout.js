/** A mentett edzések listája (előzmények). */

import { api } from '../core/api.js';
import { $, cloneTemplate } from '../core/dom.js';

/** Egy „Korábbi edzések" sor ({ id, date, detail, rpe }) <li>-vé építve.
    Az id a sor gombjaira is rákerül: a javítás és a törlés ebből tudja,
    melyik mentett edzésről van szó. */
function historyEntryEl(entry) {
  const li = cloneTemplate('tpl-history-entry');
  li.dataset.workoutId = entry.id;
  $('.wk-history-date', li).textContent = entry.date;
  $('.wk-history-detail', li).textContent = entry.detail;
  $('.wk-history-rpe', li).textContent = entry.rpe;

  // A gombok felirata („Javítás", „✕") önmagában nem mondja meg, MELYIK
  // edzésről van szó — képernyőolvasóval a lista csupa azonos gomb lenne.
  const label = `${entry.date} · ${entry.detail}`;
  $('[data-action="reopen-workout"]', li).setAttribute('aria-label', `${label} javítása`);
  $('[data-action="delete-workout"]', li).setAttribute('aria-label', `${label} törlése`);
  $('[data-action="delete-workout"]', li).title = 'Edzés törlése';
  return li;
}

/** Egy mentett edzés → „Korábbi edzések" sor (név + teljesített/összes szett). */
function workoutHistoryEntry(workout) {
  const sets = workout.exercises.flatMap((exercise) => exercise.sets || []);
  const done = sets.filter((set) => set.done).length;
  return {
    id: workout.id, date: workout.date, detail: workout.name,
    rpe: `${done}/${sets.length} szett`,
  };
}

/** A „Korábbi edzések" üres-állapota csak addig látszik, amíg nincs mentett edzés. */
const syncHistoryEmpty = () => {
  $('[data-history-empty]').hidden = $('[data-list="history"]').children.length > 0;
};

/** A „Korábbi edzések" lista a mentett edzésekből (legújabb elöl).
    Az edzésnapló tartalmát nem ez tölti: azt a setupWorkout kéri le
    (aznapi piszkozat vagy a mára ütemezett terv). */
async function renderWorkout() {
  const savedWorkouts = await api.getWorkouts();
  const history = $('[data-list="history"]');
  history.replaceChildren();
  savedWorkouts.forEach((workout) => history.appendChild(historyEntryEl(workoutHistoryEntry(workout))));
  syncHistoryEmpty();
}

export { historyEntryEl, renderWorkout, syncHistoryEmpty, workoutHistoryEntry };
