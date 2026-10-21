/** Gyakorlat-választó: szerveroldali keresés, lapozott katalógus, szűrők. */

import { api } from '../shared/api.js';
import { $, $$, cloneTemplate } from '../shared/dom.js';
import { hooks } from '../shared/page-hooks.js';
import { SEARCH_DELAY_MS, createPagedList, debounce } from '../shared/paged-list.js';
import { showToast } from '../shared/toast.js';
import { navigate, onPageShow } from '../app/router.js';
import { defaultSetFor, renderExercise } from '../render/sets.js';
import { confirmRemoveExercise } from './workout/exercise-card.js';

/** A gyakorlat-választó flow-oldal: a katalógus a szerverről jön, lapozva
    (server/catalog-search.js), kereső + izomcsoport chipek, a → gomb a
    cél-listához adja a gyakorlatot (alap szettekkel), a ✓ eltávolítja onnan.
    A cél (a terv-építő VAGY az edzésnapló listája) egy use(context)-tel
    váltható vezérlőn át áll be — a hívó (setupPlanBuilder / setupWorkout)
    adja meg, mielőtt idenavigál. */
async function setupExercisePicker(confirmAction) {
  const [defaultSet, defaultCardioSet] = await Promise.all([
    api.getDefaultSet(),
    api.getDefaultCardioSet(),
  ]);
  const pickerPage = $('.app-page[data-page="exercise-picker"]');
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
      semmit nem mond).

      Van egy MÁSIK cél-fajta is: az `onPick`-es. Az edzésnapló és a terv-építő
      LISTÁT tölt (a választó kártyát ad hozzá és elvesz), a profil rekord-
      csempéi viszont csak a KIVÁLASZTOTT NEVET kérik. Ha a cél `onPick`-et ad,
      a választó azt hívja, és semmit nem ad hozzá semmihez; ilyenkor a
      `targetList` és a `nameInput` el is hagyható. */
  let context = null;

  /** Egy katalógus-sor kártyája — a lapozott lista és a „Javasolt" blokk is
      ebből épül, így a két helyen ugyanúgy néz ki és ugyanúgy kattintható. */
  const buildItem = (entry) => {
    const item = cloneTemplate('tpl-picker-item');
    item.dataset.name = entry.name;
    item.dataset.group = entry.group;
    /* A NAPLÓZÁSI MÓD a katalógus-sorból jön, nem abból, melyik chip volt
       kiválasztva: a chip nem tárolódik sehol, és a kereséssel meg is
       kerülhető. A mezőt a szerver égeti rá minden sorra (data/catalog.js). */
    if (entry.logMode === 'duration') item.dataset.logMode = 'duration';
    $('.ep-item-name', item).textContent = entry.name;
    $('.ep-item-tag', item).textContent = entry.tag;
    $('.ep-item-muscles', item).textContent = entry.muscles;
    setupThumb($('.ep-item-thumb', item), entry);
    return item;
  };

  /** A célban MÁR szereplő gyakorlat-nevek — ehhez igazodik a ✓/→ állapot.
      Lista-célnál a cél-lista kártyáiból olvassuk ki, név-célnál (onPick) a
      cél mondja meg (`pickedNames`). A kettő ugyanazt jelenti a felhasználó
      felé: pipa = már nálam van, újabb kattintás leveszi. */
  const namesInTarget = () =>
    context.pickedNames
      ? new Set(context.pickedNames())
      : new Set($$('.wk-exercise-name', context.targetList).map((el) => el.textContent.trim()));

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

  /* ---- A katalógus: szerveroldali keresés, 40-es lapok ----
     A DOM-ban mindig csak a betöltött lapok kártyái vannak, nem a teljes,
     1400+ elemű katalógus. Az első lapot az első megnyitás kéri, nem az app
     indulása. A kártyák kirajzolását a CSS `content-visibility: auto` továbbra
     is a láthatóságig halasztja (lásd .ep-item a css/08-flow-oldalak.css-ben). */
  let activeGroup = null; // null = „Mind"
  let catalogStarted = false;

  const paged = createPagedList({
    list,
    fetchPage: (params) => api.searchExercises(params),
    renderItem: buildItem,
    // Az új lap kártyái a beszúráskor kapják meg a ✓/→ állapotot
    onPage: (_items, nodes) => {
      if (!context) return;
      const added = namesInTarget();
      nodes.forEach((item) => syncToggle(item, added));
    },
    onState: ({ status, total }) => {
      if (status === 'ready') {
        countEl.textContent = total;
        emptyState.hidden = total > 0;
      }
      // Hibánál az „Újra" sor beszél — a „Nincs találat" félrevezetne
      if (status === 'error') emptyState.hidden = true;
    },
  });

  const runQuery = () => {
    runQueryDebounced.cancel();
    return paged.setQuery({ q: searchInput.value.trim(), group: activeGroup });
  };
  const runQueryDebounced = debounce(runQuery, SEARCH_DELAY_MS);

  /** Szűrő-chipek a szerver csoportjaiból (+ Mind). */
  const buildChips = (groups) => {
    chipWrap.replaceChildren(
      ...[null, ...groups].map((group) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ep-chip';
        chip.textContent = group ?? 'Mind';
        chip.setAttribute('aria-pressed', String(group === activeGroup));
        chip.addEventListener('click', () => {
          activeGroup = group;
          $$('.ep-chip', chipWrap).forEach((c) =>
            c.setAttribute('aria-pressed', String(c === chip)),
          );
          refresh();
          runQuery();
        });
        return chip;
      }),
    );
  };

  /** Az első megnyitás: első lap + chipek. Egyszer fut. A chipek hibája nem
      állítja meg a listát — szűrő nélkül is teljes értékű a választó. */
  const startCatalog = () => {
    if (catalogStarted) return;
    catalogStarted = true;
    runQuery();
    api
      .getExerciseGroups()
      .then(buildChips, (err) => console.error('A gyakorlat-csoportok nem töltődtek be:', err));
  };

  /** A fejléc és a gombállapotok szinkronja a cél állapotával. Szűrni már
      nem szűr — azt a szerver teszi. Csak a ✓/→ gombállapot múlik a célon,
      mert csak annak van mihez igazodnia. */
  const refresh = () => {
    /* Név-mező nélküli célnál (onPick) a felirat ÜRES, nem „Névtelen": ott
       nincs edzés vagy terv, aminek neve lehetne — a „Névtelen" egy nem
       létező célt nevezne meg. Ilyenkor a fejléc csak a főnevet mutatja. */
    if (context)
      $('[data-picker-workout]').textContent = context.nameInput
        ? context.nameInput.value.trim() || 'Névtelen'
        : '';
    const query = searchInput.value.trim();
    const added = context ? namesInTarget() : null;
    if (context) $$('.ep-item', list).forEach((item) => syncToggle(item, added));

    // A „Javasolt" blokk csak szűretlen listán látszik: keresés vagy chip
    // mellett a felhasználó már maga választ, és a blokk csak útban volna.
    const suggestItems = $$('.ep-item', suggestList);
    suggestBlock.hidden =
      !context || suggestItems.length === 0 || query !== '' || activeGroup !== null;
    if (context) suggestItems.forEach((item) => syncToggle(item, added));
  };

  /* Ajánlások betöltése a cél nevéhez. A kérés lassabb lehet, mint egy
     célváltás (a felhasználó visszalép és másik oldalról jön vissza), ezért
     csak a LEGUTÓBBI kérés válasza rajzolódik ki. Hiba esetén a blokk rejtve
     marad — a választó nélküle is teljes értékű. A javaslat a kártya mezőit
     is hozza (a szerver tölti ki), tehát közvetlenül kártya rajzolható belőle. */
  let suggestRequest = 0;
  const loadSuggestions = async () => {
    const requestId = ++suggestRequest;
    suggestList.replaceChildren();
    refresh();
    const title = context.nameInput?.value.trim() ?? '';
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

    const items = result.suggestions.map((suggestion) => {
      const item = buildItem(suggestion);
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
    });
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

  // A „Javasolt" blokk azonnal eltűnik/visszajön, a keresés késleltetve megy ki
  searchInput.addEventListener('input', () => {
    refresh();
    runQueryDebounced();
  });

  // Hozzáadás/eltávolítás: közvetlenül a cél-lista DOM-ját módosítja. A
  // lapozott lista és a „Javasolt" blokk ugyanazt a kezelőt kapja.
  const onToggleClick = async (event) => {
    const toggle = event.target.closest('.ep-item-toggle');
    if (!toggle || !context) return;

    const item = toggle.closest('.ep-item');
    const name = item.dataset.name;

    /* Név-cél (profil rekord-csempe): a választó csak továbbadja a nevet, a
       fel/levétel a hívó dolga — kártyát nem rajzol ide, mert a névnek a
       MÁSIK lapon van helye. A `refresh` viszont kell: attól vált a most
       megnyomott gomb → és ✓ között. */
    if (context.onPick) {
      context.onPick(name);
      refresh();
      return;
    }

    const existing = $$('.wk-exercise', context.targetList).find(
      (card) => $('.wk-exercise-name', card).textContent.trim() === name,
    );
    if (existing) {
      // Az edzésnaplóban a gyakorlattal együtt a már kipipált szettek is
      // elvesznének — ilyenkor rákérdezünk. Frissen hozzáadott (még nem
      // teljesített) gyakorlatnál marad az azonnali eltávolítás.
      if (!(await confirmRemoveExercise(existing, name, confirmAction))) return;
      existing.remove();
      showToast(`${name} eltávolítva`);
    } else {
      /* Időalapú gyakorlat EGY sorral kerül be, a szett-alapú hárommal. A
         három szett a súlyzós munka szokása; egy futásból nem csinál senki
         hármat, és a „+ Szett" gomb ezeken a kártyákon nincs is ott. */
      const cardio = item.dataset.logMode === 'duration';
      const set = defaultSetFor(name, defaultSet);
      context.targetList.appendChild(
        renderExercise(
          {
            name,
            pr: false,
            ...(cardio && { logMode: 'duration' }),
            sets: cardio ? [{ ...defaultCardioSet }] : [{ ...set }, { ...set }, { ...set }],
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

  // Megjelenéskor a cél neve és a hozzáadás-gombok állapota az aktuális
  // cél-lista szerint.
  onPageShow('exercise-picker', refresh);

  /** A cél átállítása — a hívó ezt hívja, mielőtt a választóra navigál. Az
      első hívás indítja a katalógust is. */
  const use = (next) => {
    context = next;
    backBtn.setAttribute('aria-label', context.backLabel);
    nounEl.textContent = context.subtitleNoun;
    startCatalog();
    loadSuggestions();
  };

  /* A profil a setupExercisePicker ELŐTT áll fel (lásd app/init.js), így a
     választót nem kaphatja meg paraméterben, mint az edzésnapló és a
     terv-építő. A hooks a ház bevált megoldása erre — az init sorrendjét nem
     kell átrendezni miatta, és a hívás úgyis csak kattintáskor történik. */
  hooks.useExercisePicker = use;

  return { use };
}

/**
 * A gyakorlat-kártya illusztrációja. A katalógus nagyobbik fele a külső
 * datasetből jön, ahol minden gyakorlathoz tartozik egy álló thumbnail és
 * egy animált gif (© Gym visual) — a kézzel kurált gyakorlatokhoz viszont
 * nincs média, ezért a kép ilyenkor rejtve marad.
 *
 * Alapban a thumbnail látszik, és csak rámutatásra / fókuszra vált gifre.
 * Ez szándékos: 1200+ egyszerre animáló gif a listában értelmetlenül
 * pörgetné a CPU-t, a mozgás pedig zavaró. A csere csak akkor indul, ha a
 * gif már betöltött, hogy ne villanjon üresre a kártya.
 *
 * Ha a média nincs letöltve (npm run exdb:media), a kép betöltése elhasal —
 * ilyenkor elrejtjük, és a lista pontosan úgy néz ki, mint korábban.
 */
function setupThumb(img, entry) {
  if (!img || !entry.image) return;
  img.src = `/exercises/${entry.image}`;
  img.hidden = false;
  img.addEventListener(
    'error',
    () => {
      img.hidden = true;
    },
    { once: true },
  );
  if (!entry.gif) return;

  const still = img.src;
  const animated = `/exercises/${entry.gif}`;
  let preloaded = false;
  const play = () => {
    if (preloaded) {
      img.src = animated;
      return;
    }
    const probe = new Image();
    probe.addEventListener(
      'load',
      () => {
        preloaded = true;
        img.src = animated;
      },
      { once: true },
    );
    probe.src = animated;
  };
  const stop = () => {
    img.src = still;
  };

  const card = img.closest('.ep-item');
  card.addEventListener('pointerenter', play);
  card.addEventListener('pointerleave', stop);
  card.addEventListener('focusin', play);
  card.addEventListener('focusout', stop);
}

export { setupExercisePicker };
