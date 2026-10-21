/** Az edzésnapló oldal vezérlője: gyakorlatok, szettek, automatikus mentés. */

import { api } from '../shared/api.js';
import { onDayChange } from '../shared/day.js';
import { $, $$ } from '../shared/dom.js';
import { hooks } from '../shared/page-hooks.js';
import { prefs } from '../shared/prefs.js';
import { showToast } from '../shared/toast.js';
import { baseLoadFor, refreshWeightConventions } from '../shared/weight-conventions.js';
import { navigate } from '../app/router.js';
import { renderDashboard } from './dashboard-data.js';
import { renderPrs } from './workout/history.js';
import { readSetRow, refreshExerciseList } from '../render/sets.js';
import {
  clampRpeInput,
  enableExtraMenu,
  enableIntensitySelect,
  enableOrderSelect,
  enableSetTypeSelect,
  handleAddSetClick,
  handleRemoveSetClick,
} from './workout/set-controls.js';
import { handleStepClick } from '../shared/stepper.js';
import { WORKOUT_START_KEY, markWorkoutStarted, setLastSummary } from './workout/summary-data.js';
import { createDraftAutosave } from './workout/autosave.js';
import { createPrIndicators } from './workout/pr-indicator.js';
import { createContentLoader } from './workout/loading.js';
import { countDoneSets, confirmRemoveExercise } from './workout/exercise-card.js';
import { bindFinish } from './workout/finish.js';
import { bindHistoryActions } from './workout/history.js';
import { createPlanUndo } from './workout/plan-undo.js';

async function setupWorkout(videoModal, prModal, picker, confirmAction) {
  const page = $('.app-page[data-page="workout"]');
  const titleInput = $('#workout-name');
  const titleError = $('#workout-name-error');
  const list = $('[data-list="exercises"]', page);

  /** Az üres állapot csak addig látszik, amíg nincs gyakorlat a naplóban. */
  const syncEmpty = () => {
    $('[data-workout-empty]').hidden = list.children.length > 0;
  };

  // Az új szettek alapértékei (ha egy gyakorlatnak még nincs szettje)
  const defaultSet = await api.getDefaultSet();

  // Az összes nyomon követett exercise maximum — az input módosításakor
  // PR-detektáláshoz kell (valós idejű PR jelzéshez)
  let exerciseMaxes = await api.getExerciseMaxes();
  /* A saját testsúlyos gyakorlatok csúcsa a testsúllyal együtt tárolódik
     (server/data/bodyweight-load.js) — az élő PR-jelzőnek is azzal kell
     számolnia, különben a húzódzkodás jelzője sosem gyulladna ki. Az
     alapterhelés a közös shared/weight-conventions.js-ből (baseLoadFor). */

  // A napló kártyái: kapcsolható PR-jelvény, „+ Szett" gomb és sorszám-
  // választó (a sorrend átrendezéséhez — lásd enableOrderSelect)
  const exerciseOptions = {
    prToggle: true,
    withAddSet: true,
    reorder: true,
    supersets: true,
    removable: true,
  };

  /* A szerkesztett edzés azonossága EGY objektumban.
       planId    — melyik tervből indult (null = szabad edzés). A Tervek
                   oldali haladás ebből párosít, nem a terv nevéből.
       workoutId — melyik MENTETT edzést javítjuk (null = új edzés). A
                   piszkozattal együtt utazik, tehát újratöltés után is
                   megmarad — enélkül a befejezés új, mai edzést hozna létre
                   a javítás helyett.
       date      — a javított edzés napja, a szerkesztés-sáv szövegéhez.
     Azért objektum és nem három `let`: a betöltő modul (workout/loading.js)
     is írja, importált kötésre pedig nem lehet értéket adni. */
  const editing = { planId: null, workoutId: null, date: '' };

  const editingBar = $('[data-editing-workout]');
  const editingText = $('[data-editing-text]', editingBar);
  const finishLabel = $('[data-action="finish-workout"] span');
  const FINISH_TEXT = finishLabel.textContent;

  /** A szerkesztés-sáv és a befejező gomb felirata a jelen állapothoz.
      A gomb szövege is változik: „Edzés befejezése" azt ígérné, hogy új sor
      keletkezik a naplóban — javításkor viszont a meglévő sor frissül. */
  const syncEditingState = () => {
    const isEditing = editing.workoutId !== null;
    editingBar.hidden = !isEditing;
    if (isEditing) {
      // A dátum a mentett edzésekből oldódik fel, és ez eggyel későbbi kérés:
      // amíg nincs meg, dátum nélkül is értelmes mondatot írunk ki.
      editingText.textContent = editing.date
        ? `A(z) ${editing.date} napi edzésedet javítod.`
        : 'Egy korábbi edzésedet javítod.';
    }
    finishLabel.textContent = isEditing ? 'Módosítások mentése' : FINISH_TEXT;
  };

  /** Az edzés aktuális állapota a DOM-ból (gyakorlatok + szettek + „kész" jelölés).

      A NAPLÓZÁSI MÓD is vele utazik, de csak ha eltér az alapértelmezéstől: a
      szerver ebből tudja, idő- vagy ismétlés-alapú sorként normalizálja-e a
      gyakorlatot. Enélkül egy futópad-sor mentéskor visszaesne szettre, és az
      ideje elveszne. */
  const readCurrentWorkout = () =>
    $$('.wk-exercise', page).map((card) => ({
      name: $('.wk-exercise-name', card).textContent.trim(),
      pr: $('.wk-pr', card).getAttribute('aria-pressed') === 'true',
      superset: $('.wk-superset-link', card).getAttribute('aria-pressed') === 'true',
      ...(card.dataset.logMode === 'duration' && { logMode: 'duration' }),
      sets: $$('.wk-set-list .wk-set-row', card).map(readSetRow),
    }));

  /** A piszkozat-végpont törzse a DOM aktuális állapotából. Egy helyen áll,
      mert a debounce-olt mentés és a lapelrejtéskori keepalive-kérés
      ugyanazt küldi — és így az összehasonlításuk is azonos alakú. */
  const buildDraftBody = () => ({
    name: titleInput.value.trim(),
    exercises: readCurrentWorkout(),
    planId: editing.planId,
    workoutId: editing.workoutId,
  });

  /* ---- Automatikus mentés ----
     A motor a workout/autosave.js-ben él: debounce, felső határidő,
     újrapróbálkozás és a lapelrejtéskori utolsó mentés. Innen csak a
     „változott valami" jelzést kapja. */
  const draft = createDraftAutosave({ buildBody: buildDraftBody });

  /** A napló változott. A mentésen túl az összegzőt is érvényteleníti: az
      megint az aktuális naplóállapotot mutassa, ne a legutóbbi lezárás
      pillanatképét. */
  const autosave = () => {
    setLastSummary(null);
    draft.schedule();
  };
  const cancelAutosave = draft.cancel;

  // A gyakorlatok sorrendje a sorszám-választóval módosítható — az
  // átrendezés után ugyanaz az autosave menti, mint egy szett-szerkesztést.
  enableOrderSelect(list, autosave);
  // A szettek típusa (bemelegítő / munkasorozat / drop set) a sor számára
  // kötött lenyílóval állítható; a váltás is a piszkozattal mentődik.
  enableSetTypeSelect(list, autosave);
  // Az időalapú sorok két saját vezérlője: az intenzitás-fokozat lenyílója és
  // a plusz súly menüje. A súly mezőjét a lenti szám-mező-figyelő menti,
  // ezért az csak a gomb feliratát szinkronizálja.
  enableIntensitySelect(list, autosave);
  enableExtraMenu(list);

  /* ---- PR-jelzők ---- */
  const prIndicators = createPrIndicators({
    page,
    getMaxes: () => exerciseMaxes,
    getBaseLoad: baseLoadFor,
  });
  const updateExercisePrIndicator = prIndicators.update;
  const refreshAllPrIndicators = prIndicators.refreshAll;

  /* ---- Tartalom betöltése a szerkesztőbe ----
     A sablon, a javításra visszanyitott edzés és a terv ugyanabba a
     szerkesztőbe érkezik; a közös út a workout/loading.js-ben áll. */
  const loader = createContentLoader({
    page,
    list,
    titleInput,
    titleError,
    exerciseOptions,
    editing,
    syncEmpty,
    syncEditingState,
    refreshPrIndicators: refreshAllPrIndicators,
    autosave,
    confirmAction,
  });
  const { applyTemplate, reopenWorkout, doneSetCount } = loader;

  /* ---- A terv-betöltés visszavonása (workout/plan-undo.js) ---- */
  const planUndo = createPlanUndo({
    titleInput,
    editing,
    readCurrentWorkout,
    loader,
    applyTemplate,
    syncEditingState,
    syncEmpty,
    autosave,
    clearEditor: () => clearEditor(),
    doneSetCount,
    confirmAction,
  });
  const { setUndo, loadPlan } = planUndo;

  // Az induló tartalom a szervertől: aznapi piszkozat, vagy — új napon —
  // a mai hétnapra ütemezett terv. Ha nincs egyik sem, a napló üres, és az
  // üres állapot hívja a Tervek oldalt / a gyakorlat-hozzáadást.
  applyTemplate(await api.getWorkoutTemplate());
  syncEmpty();

  await loader.resolveEditedDate();
  syncEditingState();

  /* Napváltás éjfélkor: ilyenkor a MAI napra ütemezett terv válik érvényessé.
     Ha a naplóban még nincs megkezdett munka, csendben átváltunk rá; ha van,
     nem írjuk felül a félkész edzést — csak jelezzük, mi a teendő. Enélkül
     a napokon át nyitva hagyott app a tegnapi edzést mutatta tovább. */
  onDayChange(async () => {
    if (countDoneSets(page) > 0) {
      showToast('Új nap kezdődött — zárd le az edzést, hogy a mai terv betölthesse magát');
      return;
    }
    setUndo(null); // a tegnapi állapot visszaállítása már nem értelmes
    applyTemplate(await api.getWorkoutTemplate());
  });

  // Az ism./súly/RPE mezők átírása is változtatás — a piszkozattal mentődik.
  // (Az edzésnév saját input-figyelője a hibaállapotot is kezeli, ezért az
  //  nem itt, hanem külön fut.)

  page.addEventListener('input', (event) => {
    if (event.target.matches('.wk-num-input')) {
      // Valós idejű PR detektálás
      updateExercisePrIndicator(event.target.closest('.wk-exercise'));
      autosave();
    }
  });

  // A mező elhagyásakor az RPE visszakerül az 1–10 skálára (gépelés közben
  // nem nyúlunk hozzá). Az input-figyelő már mentett, ezért csak akkor
  // mentünk újra, ha a szorítás tényleg átírta az értéket.
  page.addEventListener('change', (event) => {
    if (clampRpeInput(event.target)) autosave();
  });

  /** Gyakorlat teljes eltávolítása a naplóból. A teljesített szettekre
      ugyanúgy rákérdezünk, mint a gyakorlat-választóban: az elvesztésük
      visszavonhatatlan. Az utolsó gyakorlat is kivehető — a piszkozat-végpont
      az üres listát is elfogadja, a napló pedig az üres állapotra vált. */
  const removeExercise = async (card) => {
    const name = $('.wk-exercise-name', card).textContent.trim();
    if (!(await confirmRemoveExercise(card, name, confirmAction))) return;
    card.remove();
    syncEmpty();
    // A sorszámok és a szuperszett-csoportok a maradék listára igazodnak
    refreshExerciseList(list);
    autosave();
    showToast(`${name} eltávolítva`);
  };

  // Delegált kattintáskezelés — a dinamikusan hozzáadott sorokra is érvényes.
  page.addEventListener('click', (event) => {
    // A kártyát a kezelők lefutása előtt mentjük el: törléskor a sor kikerül
    // a DOM-ból, utána már nem lenne elérhető az őse.
    const exerciseCard = event.target.closest('.wk-exercise');

    // Szett-értékek léptetése, illetve szett hozzáadása / törlése
    if (handleStepClick(event)) return; // a kiváltott input esemény menti
    if (handleAddSetClick(event, defaultSet, autosave)) {
      updateExercisePrIndicator(exerciseCard);
      return;
    }
    if (handleRemoveSetClick(event, autosave)) {
      updateExercisePrIndicator(exerciseCard);
      return;
    }

    const check = event.target.closest('.wk-set-check');
    if (check) {
      const pressed = check.getAttribute('aria-pressed') === 'true';
      check.setAttribute('aria-pressed', String(!pressed));
      if (!pressed) markWorkoutStarted(); // az első pipa indítja az edzés-órát
      updateExercisePrIndicator(exerciseCard); // a pipa állapota is számít a PR-képletbe
      autosave();
      return;
    }

    // Szuperszett-kapocs: az előző gyakorlathoz köti / elválasztja ezt a
    // kártyát. A csoportkeretet és a sorszámokat a refreshExerciseList rajzolja
    // újra, az állapot a piszkozattal mentődik.
    const supersetLink = event.target.closest('.wk-superset-link');
    if (supersetLink) {
      const linked = supersetLink.getAttribute('aria-pressed') === 'true';
      supersetLink.setAttribute('aria-pressed', String(!linked));
      refreshExerciseList(list);
      autosave();
      return;
    }

    // A megerősítés miatt aszinkron; a kezelő maga szinkron marad, ezért
    // nem várjuk meg (a törlés a saját ágán fejezi be magát).
    if (event.target.closest('.wk-exercise-remove')) {
      removeExercise(exerciseCard);
      return;
    }

    const videoBtn = event.target.closest('.wk-video-btn');
    if (videoBtn) {
      videoModal.open(videoBtn.dataset.exercise);
      return;
    }

    const prItem = event.target.closest('.wk-pr-item');
    if (prItem) {
      prModal.open(prItem.dataset.exercise);
      return;
    }
  });

  // Billentyűzetes elérés: a .wk-pr-item nem <button>, mert vizuálisan
  // listasorként illeszkedik — Enter/Szóköz-zel mégis nyithatónak kell
  // lennie (role="button" tabindex="0" a sablonon).
  page.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const prItem = event.target.closest('.wk-pr-item');
    if (!prItem) return;
    event.preventDefault();
    prModal.open(prItem.dataset.exercise);
  });

  // Gyakorlat hozzáadása közvetlenül az edzésnaplóhoz — a közös gyakorlat-
  // választó az edzésnapló listáját célozza, és minden változást ment.
  $('[data-action="workout-add-exercise"]').addEventListener('click', () => {
    // A felhasználó továbblépett — a korábbi névhiba a következő befejezésnél
    // úgyis újra megjelenik, ha még mindig nincs név.
    titleInput.classList.remove('has-error');
    titleError.hidden = true;
    picker?.use({
      targetList: list,
      nameInput: titleInput,
      backPage: 'workout',
      backLabel: 'Vissza az edzésnaplóhoz',
      subtitleNoun: 'edzéshez',
      toastTarget: 'az edzéshez',
      exerciseOptions,
      // Ma edz: az ajánlásba a mai regeneráltság is beleszól.
      suggestReadiness: true,
      onChange: () => {
        syncEmpty();
        refreshExerciseList(list);
        autosave();
        // Új gyakorlat hozzáadásakor azonnal frissítsd a PR detektálást
        refreshAllPrIndicators();
      },
    });
    navigate('exercise-picker');
  });

  // Gépelésre a hibaállapot azonnal eltűnik; a nevet is automatikusan mentjük
  titleInput.addEventListener('input', () => {
    titleInput.classList.remove('has-error');
    titleError.hidden = true;
    autosave();
  });

  /** A napló kiürítése és a piszkozat elengedése — az edzés lezárása és a
      javítás is ezzel zárul, ugyanabban a sorrendben (előbb a függő mentést
      állítjuk le, különben visszaírná a most törölt piszkozatot). */
  const clearEditor = async () => {
    cancelAutosave();
    await api.clearWorkoutDraft().catch((err) => {
      console.error('A piszkozat törlése sikertelen:', err);
    });
    list.replaceChildren();
    titleInput.value = '';
    editing.planId = null;
    editing.workoutId = null;
    editing.date = '';
    prefs.set(WORKOUT_START_KEY, null); // az edzés-óra a következő első pipával indul
    syncEmpty();
    syncEditingState();
    setUndo(null);
  };

  /** Amit egy napló-változás (törlés vagy javítás) után frissíteni kell.
      Ugyanaz a négy felület, ami az edzés lezárásakor is — plusz az
      exerciseMaxes: a szerver a csúcsokat is újraszámolta, és a szerkesztő
      élő PR-jelzése ebből a térképből dolgozik. Elavult másolattal a
      következő edzésnél hamis (vagy elmaradt) PR-jelvényt mutatna. */
  const refreshAfterWorkoutChange = async () => {
    [exerciseMaxes] = await Promise.all([api.getExerciseMaxes(), refreshWeightConventions()]);
    refreshAllPrIndicators();
    renderPrs().catch(console.error);
    hooks.refreshVolumeChart?.().catch(console.error);
    renderDashboard().catch(console.error);
    hooks.refreshRecovery?.().catch(console.error);
  };

  /* ---- Befejezés és a „Korábbi edzések" sorai (workout/finish.js,
     workout/history.js) ---- */
  bindFinish({
    list,
    titleInput,
    titleError,
    editing,
    draft,
    cancelAutosave,
    doneSetCount,
    readCurrentWorkout,
    clearEditor,
    refreshAfterWorkoutChange,
    confirmAction,
  });
  bindHistoryActions({
    editing,
    reopenWorkout,
    setUndo,
    syncEditingState,
    autosave,
    refreshAfterWorkoutChange,
    confirmAction,
  });

  /* A javítás megszakítása. Az EREDETI edzés érintetlen marad — csak a
     szerkesztőben álló, még el nem mentett módosítások vesznek el, ezért
     nem kérdezünk rá külön. */
  $('[data-action="cancel-workout-edit"]').addEventListener('click', async () => {
    await clearEditor();
    showToast('Szerkesztés megszakítva — az edzés változatlan');
  });

  /** A szerver átírta a piszkozatot (a készenlét-javaslat elfogadása): a
      képernyőn álló napló elavult. A függő mentést eldobjuk — különben a
      régi tartalmat írná vissza —, és a szerver változatát töltjük be. */
  const replaceFromServer = (template) => {
    cancelAutosave();
    setUndo(null);
    applyTemplate(template);
    syncEmpty();
  };

  return { loadPlan, replaceFromServer };
}

export { setupWorkout };
