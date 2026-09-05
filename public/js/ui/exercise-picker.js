/** Gyakorlat-választó: katalógus, keresés, szűrők. */

import { api } from '../core/api.js';
import { $, $$, cloneTemplate } from '../core/dom.js';
import { hooks } from '../core/page-hooks.js';
import { showToast } from '../core/toast.js';
import { navigate } from '../nav/router.js';
import { renderExercise } from '../render/sets.js';
import { setupThumb } from './workout.js';

/** A gyakorlat-választó flow-oldal: katalógus a szerverről, kereső + izom-
    csoport chipek, a → gomb a cél-listához adja a gyakorlatot (alap
    szettekkel), a ✓ eltávolítja onnan. A cél (a terv-építő VAGY az
    edzésnapló listája) egy use(context)-tel váltható vezérlőn át áll be —
    a hívó (setupPlanBuilder / setupWorkout) adja meg, mielőtt idenavigál. */
async function setupExercisePicker(confirmAction) {
  const [catalog, defaultSet] = await Promise.all([
    api.getExerciseCatalog(), api.getDefaultSet(),
  ]);
  const pickerPage = $('[data-page="exercise-picker"]');
  const list = $('[data-list="picker-catalog"]');
  const chipWrap = $('[data-list="picker-chips"]');
  const searchInput = $('#exercise-search');
  const countEl = $('[data-picker-count]');
  const emptyState = $('.ep-empty', pickerPage);
  const backBtn = $('[data-action="picker-back"]');
  const nounEl = $('[data-picker-noun]');

  /** Az aktuális cél: { targetList, nameInput, backPage, backLabel,
      subtitleNoun, toastTarget, exerciseOptions, onChange }. */
  let context = null;

  /* A kártyák egyszer épülnek fel; a szűrés csak elrejt/megmutat.
     A katalógus 1400+ elemű, ezért a kártyák egy DocumentFragmentbe
     készülnek el, és EGY beszúrással kerülnek a listába — így a böngésző
     egyszer számol elrendezést, nem elemenként. A kártyák tényleges
     kirajzolását a CSS `content-visibility: auto` halasztja a láthatóságig
     (lásd .ep-item a style.css-ben). */
  const fragment = document.createDocumentFragment();
  catalog.forEach((entry) => {
    const item = cloneTemplate('tpl-picker-item');
    item.dataset.name = entry.name;
    item.dataset.group = entry.group;
    // A keresés a felszerelésre is illeszkedjen: a katalógus nagy része a
    // külső datasetből jön, ahol a variánsokat a felszerelés különbözteti
    // meg — így a „kettlebell” beírásával azok is előjönnek, amiknek a
    // magyar nevében a szó nem szerepel.
    item.dataset.search = [entry.name, entry.equipment].filter(Boolean).join(' ').toLowerCase();
    $('.ep-item-name', item).textContent = entry.name;
    $('.ep-item-tag', item).textContent = entry.tag;
    $('.ep-item-muscles', item).textContent = entry.muscles;
    setupThumb($('.ep-item-thumb', item), entry);
    fragment.appendChild(item);
  });
  list.appendChild(fragment);

  // Szűrő-chipek a katalógus csoportjaiból (+ Mind)
  let activeGroup = 'Mind';
  ['Mind', ...new Set(catalog.map((entry) => entry.group))].forEach((group) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ep-chip';
    chip.textContent = group;
    chip.setAttribute('aria-pressed', String(group === activeGroup));
    chip.addEventListener('click', () => {
      activeGroup = group;
      $$('.ep-chip', chipWrap).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      refresh();
    });
    chipWrap.appendChild(chip);
  });

  /** A cél-listában lévő gyakorlat-nevek — ehhez igazodik a ✓/→ állapot. */
  const namesInTarget = () =>
    new Set($$('.wk-exercise-name', context.targetList).map((el) => el.textContent.trim()));

  /** Szűrés + a fejléc és a gombállapotok szinkronja a cél állapotával.
      A keresés/szűrés cél (context) nélkül is működik — csak a ✓/→
      gombállapot múlik a célon, mert csak annak van mihez igazodnia. */
  const refresh = () => {
    if (context) $('[data-picker-workout]').textContent = context.nameInput.value.trim() || 'Névtelen';
    const query = searchInput.value.trim().toLowerCase();
    const added = context ? namesInTarget() : null;
    let visibleCount = 0;
    $$('.ep-item', list).forEach((item) => {
      const matches = (activeGroup === 'Mind' || item.dataset.group === activeGroup)
        && item.dataset.search.includes(query);
      item.hidden = !matches;
      if (matches) visibleCount += 1;
      if (!context) return;

      const inTarget = added.has(item.dataset.name);
      const toggle = $('.ep-item-toggle', item);
      toggle.setAttribute('aria-pressed', String(inTarget));
      toggle.textContent = inTarget ? '✓' : '→';
      toggle.setAttribute('aria-label', inTarget
        ? `${item.dataset.name} eltávolítása`
        : `${item.dataset.name} hozzáadása ${context.toastTarget}`);
    });
    countEl.textContent = visibleCount;
    emptyState.hidden = visibleCount > 0;
  };

  searchInput.addEventListener('input', refresh);

  // Hozzáadás/eltávolítás: közvetlenül a cél-lista DOM-ját módosítja
  list.addEventListener('click', async (event) => {
    const toggle = event.target.closest('.ep-item-toggle');
    if (!toggle || !context) return;

    const name = toggle.closest('.ep-item').dataset.name;
    const existing = $$('.wk-exercise', context.targetList)
      .find((card) => $('.wk-exercise-name', card).textContent.trim() === name);
    if (existing) {
      // Az edzésnaplóban a gyakorlattal együtt a már kipipált szettek is
      // elvesznének — ilyenkor rákérdezünk. Frissen hozzáadott (még nem
      // teljesített) gyakorlatnál marad az azonnali eltávolítás.
      const doneSets = $$('.wk-set-check', existing)
        .filter((check) => check.getAttribute('aria-pressed') === 'true').length;
      if (doneSets > 0) {
        const ok = await confirmAction(
          `A(z) „${name}” gyakorlaton ${doneSets} teljesített szett van. Az eltávolítással ezek elvesznek.`,
          { title: 'Eltávolítod a gyakorlatot?', confirmLabel: 'Eltávolítás' },
        );
        if (!ok) return;
      }
      existing.remove();
      showToast(`${name} eltávolítva`);
    } else {
      context.targetList.appendChild(renderExercise({
        name,
        pr: false,
        sets: [{ ...defaultSet }, { ...defaultSet }, { ...defaultSet }],
      }, context.exerciseOptions));
      showToast(`${name} hozzáadva ${context.toastTarget}`);
    }
    context.onChange();
    refresh();
  });

  backBtn.addEventListener('click', () => navigate(context?.backPage || 'plans'));

  hooks.refreshExercisePicker = refresh;

  /** A cél átállítása — a hívó ezt hívja, mielőtt a választóra navigál. */
  const use = (next) => {
    context = next;
    backBtn.setAttribute('aria-label', context.backLabel);
    nounEl.textContent = context.subtitleNoun;
    refresh();
  };

  return { use };
}

export { setupExercisePicker };
