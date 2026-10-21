/** Edzés-választó: a terv-építő kijelölt napjába egy meglévő edzés MÁSOLATÁT
    tölti — a terv egy másik napjáét vagy egy naplózott edzését. */

import { api } from '../shared/api.js';
import { $, cloneTemplate } from '../shared/dom.js';
import { matchesQuery } from '../shared/plan-sources.js';
import { showToast } from '../shared/toast.js';
import { navigate } from '../app/router.js';

/** A választó flow-oldal. A hívó (a terv-építő) `open(context)`-tel nyitja:
    { subtitle, dayTitle, planSources, currentCount, onPick }. A napló
    forrásait minden megnyitáskor a szervertől kéri (a mai mentés is
    látsszon). Választáskor nem üres napnál rákérdez, aztán az `onPick`
    cserél, és visszavisz a terv-építőbe. */
function setupWorkoutPicker(confirmAction) {
  const page = $('[data-page="workout-picker"]');
  const subtitleEl = $('[data-wp-subtitle]', page);
  const searchInput = $('#workout-search');
  const planBlock = $('[data-wp-plan]', page);
  const planList = $('[data-list="wp-plan"]', page);
  const logBlock = $('[data-wp-log]', page);
  const logList = $('[data-list="wp-log"]', page);
  const emptyState = $('[data-wp-empty]', page);

  let context = null;
  let logSources = [];

  const pick = async (source) => {
    const count = context.currentCount();
    if (count > 0) {
      const ok = await confirmAction(
        `${context.dayTitle}: a ${count} gyakorlat helyére a(z) „${source.name}” ${source.exercises.length} gyakorlata kerül.`,
        { title: 'Lecseréled a gyakorlatokat?', confirmLabel: 'Csere' },
      );
      if (!ok) return;
    }
    context.onPick(source);
    navigate('plan-builder');
  };

  const buildRow = (source) => {
    const item = cloneTemplate('tpl-workout-source');
    $('.ep-item-name', item).textContent = source.name;
    $('.ep-item-tag', item).textContent = source.tag;
    $('.ep-item-muscles', item).textContent =
      `${source.exercises.length} gyakorlat · ${source.exercises
        .map((exercise) => exercise.name)
        .join(', ')}`;
    const button = $('.ep-item-toggle', item);
    button.setAttribute('aria-label', `${source.name} betöltése`);
    button.addEventListener('click', () => pick(source));
    return item;
  };

  /** Egy blokk feltöltése a keresésnek megfelelő forrásokkal; a találatok
      számát adja vissza. Üres blokk el is tűnik. */
  const fillBlock = (block, list, sources) => {
    const shown = sources.filter((source) => matchesQuery(source, searchInput.value));
    list.replaceChildren(...shown.map(buildRow));
    block.hidden = shown.length === 0;
    return shown.length;
  };

  const render = () => {
    const total =
      fillBlock(planBlock, planList, context.planSources) +
      fillBlock(logBlock, logList, logSources);
    emptyState.hidden = total > 0;
    emptyState.textContent = searchInput.value.trim()
      ? 'Nincs találat a keresésre.'
      : 'Még nincs betölthető edzés — sem a terv más napján, sem a naplóban.';
  };

  searchInput.addEventListener('input', () => context && render());
  $('[data-action="workout-picker-back"]').addEventListener('click', () =>
    navigate('plan-builder'),
  );

  const open = async (next) => {
    context = next;
    subtitleEl.textContent = next.subtitle;
    searchInput.value = '';
    logSources = [];
    render();
    navigate('workout-picker');
    try {
      const workouts = await api.getWorkouts();
      // Közben újra megnyitották egy másik napra — a régi válasz már nem ide tartozik
      if (context !== next) return;
      logSources = workouts
        .filter((workout) => workout.exercises?.length)
        .map((workout) => ({
          name: workout.name || 'Edzés',
          tag: workout.date,
          adoptName: workout.name ?? '',
          exercises: workout.exercises,
        }));
      render();
    } catch (err) {
      console.error(err);
      showToast('Nem sikerült betölteni a korábbi edzéseket', 'error');
    }
  };

  return { open };
}

export { setupWorkoutPicker };
