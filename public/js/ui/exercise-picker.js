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
  const [catalog, defaultSet, defaultCardioSet] = await Promise.all([
    api.getExerciseCatalog(),
    api.getDefaultSet(),
    api.getDefaultCardioSet(),
  ]);
  const pickerPage = $('[data-page="exercise-picker"]');
  const list = $('[data-list="picker-catalog"]');
  const chipWrap = $('[data-list="picker-chips"]');
  const searchInput = $('#exercise-search');
  const countEl = $('[data-picker-count]');
  const emptyState = $('.ep-empty', pickerPage);
  const backBtn = $('[data-action="picker-back"]');
  const nounEl = $('[data-picker-noun]');
  const suggestBlock = $('[data-picker-suggest]');
  const suggestList = $('[data-list="picker-suggestions"]');
  const suggestNote = $('[data-picker-suggest-note]');

  /** Az aktuális cél: { targetList, nameInput, backPage, backLabel,
      subtitleNoun, toastTarget, exerciseOptions, onChange, suggestReadiness }.
      A `suggestReadiness` az ajánlásba a mai regeneráltságot is bekéri — az
      edzésnapló igen, a terv-építő nem (egy jövőbeli tervről a mai készenlét
      semmit nem mond). */
  let context = null;

  /* A kártyák egyszer épülnek fel; a szűrés csak elrejt/megmutat.
     A katalógus 1400+ elemű, ezért a kártyák egy DocumentFragmentbe
     készülnek el, és EGY beszúrással kerülnek a listába — így a böngésző
     egyszer számol elrendezést, nem elemenként. A kártyák tényleges
     kirajzolását a CSS `content-visibility: auto` halasztja a láthatóságig
     (lásd .ep-item a style.css-ben). */
  /** Egy katalógus-sor kártyája — a teljes lista és a „Javasolt" blokk is
      ebből épül, így a két helyen ugyanúgy néz ki és ugyanúgy kattintható. */
  const buildItem = (entry) => {
    const item = cloneTemplate('tpl-picker-item');
    item.dataset.name = entry.name;
    item.dataset.group = entry.group;
    /* A NAPLÓZÁSI MÓD a katalógus-sorból jön, nem abból, melyik chip volt
       kiválasztva: a chip nem tárolódik sehol, és a kereséssel meg is
       kerülhető. A mezőt a szerver égeti rá minden sorra (data/catalog.js). */
    if (entry.logMode === 'duration') item.dataset.logMode = 'duration';
    // A keresés a felszerelésre is illeszkedjen: a katalógus nagy része a
    // külső datasetből jön, ahol a variánsokat a felszerelés különbözteti
    // meg — így a „kettlebell” beírásával azok is előjönnek, amiknek a
    // magyar nevében a szó nem szerepel.
    item.dataset.search = [entry.name, entry.equipment].filter(Boolean).join(' ').toLowerCase();
    $('.ep-item-name', item).textContent = entry.name;
    $('.ep-item-tag', item).textContent = entry.tag;
    $('.ep-item-muscles', item).textContent = entry.muscles;
    setupThumb($('.ep-item-thumb', item), entry);
    return item;
  };

  const fragment = document.createDocumentFragment();
  catalog.forEach((entry) => fragment.appendChild(buildItem(entry)));
  list.appendChild(fragment);

  const catalogByName = new Map(catalog.map((entry) => [entry.name, entry]));

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

  /** Egy kártya ✓/→ gombjának állapota: benne van-e már a cél-listában. */
  const syncToggle = (item, added) => {
    const inTarget = added.has(item.dataset.name);
    const toggle = $('.ep-item-toggle', item);
    toggle.setAttribute('aria-pressed', String(inTarget));
    toggle.textContent = inTarget ? '✓' : '→';
    toggle.setAttribute(
      'aria-label',
      inTarget
        ? `${item.dataset.name} eltávolítása`
        : `${item.dataset.name} hozzáadása ${context.toastTarget}`,
    );
  };

  /** Szűrés + a fejléc és a gombállapotok szinkronja a cél állapotával.
      A keresés/szűrés cél (context) nélkül is működik — csak a ✓/→
      gombállapot múlik a célon, mert csak annak van mihez igazodnia. */
  const refresh = () => {
    if (context)
      $('[data-picker-workout]').textContent = context.nameInput.value.trim() || 'Névtelen';
    const query = searchInput.value.trim().toLowerCase();
    const added = context ? namesInTarget() : null;
    let visibleCount = 0;
    $$('.ep-item', list).forEach((item) => {
      const matches =
        (activeGroup === 'Mind' || item.dataset.group === activeGroup) &&
        item.dataset.search.includes(query);
      item.hidden = !matches;
      if (matches) visibleCount += 1;
      if (context) syncToggle(item, added);
    });
    countEl.textContent = visibleCount;
    emptyState.hidden = visibleCount > 0;

    // A „Javasolt" blokk csak szűretlen listán látszik: keresés vagy chip
    // mellett a felhasználó már maga választ, és a blokk csak útban volna.
    const suggestItems = $$('.ep-item', suggestList);
    suggestBlock.hidden =
      !context || suggestItems.length === 0 || query !== '' || activeGroup !== 'Mind';
    if (context) suggestItems.forEach((item) => syncToggle(item, added));
  };

  /* Ajánlások betöltése a cél nevéhez. A kérés lassabb lehet, mint egy
     célváltás (a felhasználó visszalép és másik oldalról jön vissza), ezért
     csak a LEGUTÓBBI kérés válasza rajzolódik ki. Hiba esetén a blokk rejtve
     marad — a választó nélküle is teljes értékű. */
  let suggestRequest = 0;
  const loadSuggestions = async () => {
    const requestId = ++suggestRequest;
    suggestList.replaceChildren();
    refresh();
    const title = context.nameInput.value.trim();
    let result;
    try {
      result = await api.getExerciseSuggestions(title, {
        withReadiness: Boolean(context.suggestReadiness),
      });
    } catch (err) {
      console.error('Ajánlott gyakorlatok betöltési hiba:', err);
      return;
    }
    if (requestId !== suggestRequest) return;

    const items = result.suggestions
      .map((suggestion) => {
        const entry = catalogByName.get(suggestion.name);
        if (!entry) return null;
        const item = buildItem(entry);
        // A javasolt sor mindig látszik: a content-visibility becslése itt
        // nem spórol semmit, csak a blokk magasságát rontaná el.
        item.classList.add('ep-item--suggested');
        const reasons = $('.ep-item-reasons', item);
        suggestion.reasons.forEach((reason) => {
          const span = document.createElement('span');
          span.className = `ep-reason ep-reason--${reason.kind}`;
          span.textContent = reason.text;
          reasons.appendChild(span);
        });
        reasons.hidden = suggestion.reasons.length === 0;
        return item;
      })
      .filter(Boolean);
    suggestList.replaceChildren(...items);

    /* Ha a cím nem mondott semmit, ezt ki is mondjuk — különben a felhasználó
       nem érti, miért nem a „Hétfő" nevű edzéséhez illő gyakorlatokat látja. */
    const fromReadinessOnly = title !== '' && result.titleLabels.length === 0 && items.length > 0;
    suggestNote.textContent = fromReadinessOnly
      ? 'A címből nem derül ki izomcsoport — a mai regeneráltság alapján.'
      : '';
    suggestNote.hidden = !fromReadinessOnly;
    refresh();
  };

  searchInput.addEventListener('input', refresh);

  // Hozzáadás/eltávolítás: közvetlenül a cél-lista DOM-ját módosítja. A
  // teljes lista és a „Javasolt" blokk ugyanazt a kezelőt kapja.
  const onToggleClick = async (event) => {
    const toggle = event.target.closest('.ep-item-toggle');
    if (!toggle || !context) return;

    const item = toggle.closest('.ep-item');
    const name = item.dataset.name;
    const existing = $$('.wk-exercise', context.targetList).find(
      (card) => $('.wk-exercise-name', card).textContent.trim() === name,
    );
    if (existing) {
      // Az edzésnaplóban a gyakorlattal együtt a már kipipált szettek is
      // elvesznének — ilyenkor rákérdezünk. Frissen hozzáadott (még nem
      // teljesített) gyakorlatnál marad az azonnali eltávolítás.
      const doneSets = $$('.wk-set-check', existing).filter(
        (check) => check.getAttribute('aria-pressed') === 'true',
      ).length;
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
      /* Időalapú gyakorlat EGY sorral kerül be, a szett-alapú hárommal. A
         három szett a súlyzós munka szokása; egy futásból nem csinál senki
         hármat, és a „+ Szett" gomb ezeken a kártyákon nincs is ott. */
      const cardio = item.dataset.logMode === 'duration';
      context.targetList.appendChild(
        renderExercise(
          {
            name,
            pr: false,
            ...(cardio && { logMode: 'duration' }),
            sets: cardio
              ? [{ ...defaultCardioSet }]
              : [{ ...defaultSet }, { ...defaultSet }, { ...defaultSet }],
          },
          context.exerciseOptions,
        ),
      );
      showToast(`${name} hozzáadva ${context.toastTarget}`);
    }
    context.onChange();
    refresh();
  };
  list.addEventListener('click', onToggleClick);
  suggestList.addEventListener('click', onToggleClick);

  backBtn.addEventListener('click', () => navigate(context?.backPage || 'plans'));

  hooks.refreshExercisePicker = refresh;

  /** A cél átállítása — a hívó ezt hívja, mielőtt a választóra navigál. */
  const use = (next) => {
    context = next;
    backBtn.setAttribute('aria-label', context.backLabel);
    nounEl.textContent = context.subtitleNoun;
    loadSuggestions();
  };

  return { use };
}

export { setupExercisePicker };
