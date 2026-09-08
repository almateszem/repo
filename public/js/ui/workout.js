/** Az edzésnapló oldal vezérlője: gyakorlatok, szettek, automatikus mentés. */

import { api } from '../core/api.js';
import { onDayChange } from '../core/day.js';
import { $, $$ } from '../core/dom.js';
import { hooks } from '../core/page-hooks.js';
import { prefs } from '../core/prefs.js';
import { showToast } from '../core/toast.js';
import { navigate } from '../nav/router.js';
import { renderDashboard } from '../render/dashboard.js';
import { renderPrs } from '../render/prs.js';
import { clampRpeInput, enableOrderSelect, enableSetTypeSelect, handleAddSetClick, handleRemoveSetClick, handleStepClick, readSetRow, refreshExerciseList } from '../render/sets.js';
import { WORKOUT_START_KEY, markWorkoutStarted, setLastSummary, summarizeWorkout } from '../render/summary.js';
import { historyEntryEl, syncHistoryEmpty, workoutHistoryEntry } from '../render/workout.js';
import { createDraftAutosave } from './workout/autosave.js';
import { createPrIndicators } from './workout/pr-indicator.js';
import { createContentLoader } from './workout/loading.js';

async function setupWorkout(videoModal, prModal, picker, confirmAction) {
  const page = $('[data-page="workout"]');
  const titleInput = $('#workout-name');
  const titleError = $('#workout-name-error');
  const list = $('[data-list="exercises"]', page);

  /** Az üres állapot csak addig látszik, amíg nincs gyakorlat a naplóban. */
  const syncEmpty = () => { $('[data-workout-empty]').hidden = list.children.length > 0; };

  // Az új szettek alapértékei (ha egy gyakorlatnak még nincs szettje)
  const defaultSet = await api.getDefaultSet();

  // Az összes nyomon követett exercise maximum — az input módosításakor
  // PR-detektáláshoz kell (valós idejű PR jelzéshez)
  let exerciseMaxes = await api.getExerciseMaxes();

  // A napló kártyái: kapcsolható PR-jelvény, „+ Szett" gomb és sorszám-
  // választó (a sorrend átrendezéséhez — lásd enableOrderSelect)
  const exerciseOptions = {
    prToggle: true, withAddSet: true, reorder: true, supersets: true, removable: true,
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
        ? `A(z) ${editing.date} napi edzésedet javítod — a mentés a meglévő sort frissíti, nem hoz létre újat.`
        : 'Egy korábbi edzésedet javítod — a mentés a meglévő sort frissíti, nem hoz létre újat.';
    }
    finishLabel.textContent = isEditing ? 'Módosítások mentése' : FINISH_TEXT;
  };

  /** Az edzés aktuális állapota a DOM-ból (gyakorlatok + szettek + „kész" jelölés). */
  const readCurrentWorkout = () => $$('.wk-exercise', page).map((card) => ({
    name: $('.wk-exercise-name', card).textContent.trim(),
    pr: $('.wk-pr', card).getAttribute('aria-pressed') === 'true',
    superset: $('.wk-superset-link', card).getAttribute('aria-pressed') === 'true',
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

  /* ---- PR-jelzők ---- */
  const prIndicators = createPrIndicators({ page, getMaxes: () => exerciseMaxes });
  const updateExercisePrIndicator = prIndicators.update;
  const refreshAllPrIndicators = prIndicators.refreshAll;

  /* ---- Tartalom betöltése a szerkesztőbe ----
     A sablon, a javításra visszanyitott edzés és a terv ugyanabba a
     szerkesztőbe érkezik; a közös út a workout/loading.js-ben áll. */
  const loader = createContentLoader({
    page, list, titleInput, titleError, exerciseOptions, editing,
    syncEmpty, syncEditingState,
    refreshPrIndicators: refreshAllPrIndicators,
    autosave, confirmAction,
  });
  const { applyTemplate, reopenWorkout, loadPlan } = loader;



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
    const hasProgress = $$('.wk-set-check', page)
      .some((check) => check.getAttribute('aria-pressed') === 'true');
    if (hasProgress) {
      showToast('Új nap kezdődött — zárd le az edzést, hogy a mai terv betölthesse magát');
      return;
    }
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
    const doneSets = $$('.wk-set-check', card)
      .filter((check) => check.getAttribute('aria-pressed') === 'true').length;
    if (doneSets > 0) {
      const ok = await confirmAction(
        `A(z) „${name}” gyakorlaton ${doneSets} teljesített szett van. Az eltávolítással ezek elvesznek.`,
        { title: 'Eltávolítod a gyakorlatot?', confirmLabel: 'Eltávolítás' },
      );
      if (!ok) return;
    }
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
    picker?.use({
      targetList: list,
      nameInput: titleInput,
      backPage: 'workout',
      backLabel: 'Vissza az edzésnaplóhoz',
      subtitleNoun: 'edzéshez',
      toastTarget: 'az edzéshez',
      exerciseOptions,
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

  /** Közös név-validáció: a mentés és a befejezés is megköveteli az edzésnevet. */
  const validateWorkoutName = () => {
    if (titleInput.value.trim()) return true;
    titleInput.classList.add('has-error');
    titleError.hidden = false;
    titleInput.focus();
    showToast('Adj nevet az edzésnek', 'error');
    return false;
  };

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
  };

  /** Amit egy napló-változás (törlés vagy javítás) után frissíteni kell.
      Ugyanaz a négy felület, ami az edzés lezárásakor is — plusz az
      exerciseMaxes: a szerver a csúcsokat is újraszámolta, és a szerkesztő
      élő PR-jelzése ebből a térképből dolgozik. Elavult másolattal a
      következő edzésnél hamis (vagy elmaradt) PR-jelvényt mutatna. */
  const refreshAfterWorkoutChange = async () => {
    exerciseMaxes = await api.getExerciseMaxes();
    refreshAllPrIndicators();
    renderPrs().catch(console.error);
    hooks.refreshVolumeChart?.().catch(console.error);
    renderDashboard().catch(console.error);
    hooks.refreshRecovery?.().catch(console.error);
  };

  /** A javítás mentése: a MEGLÉVŐ edzés felülírása a saját dátumán. A lista
      sorát a helyén cseréljük — a lista elejére szúrás azt hazudná, hogy ez
      a legfrissebb edzés. */
  const finishEdit = async () => {
    const updated = await api.updateWorkout(
      editing.workoutId, titleInput.value.trim(), readCurrentWorkout(),
    );
    const row = $(`[data-list="history"] [data-workout-id="${updated.id}"]`);
    row?.replaceWith(historyEntryEl(workoutHistoryEntry(updated)));

    await clearEditor();
    await refreshAfterWorkoutChange();
    showToast('Az edzés módosításai mentve');
  };

  /* Edzés befejezése — az edzés LEZÁRÁSA: naplózás után a piszkozat törlődik
     és a napló kiürül, így ugyanaznap új edzés kezdhető, a lezárt edzés pedig
     nem naplózható másodszor is (korábban egy apró módosítás után az újbóli
     befejezés duplikált bejegyzést hozott létre). Amit a felhasználó csinált,
     azt az összegző és a „Korábbi edzések" őrzi meg. */
  const finishBtn = $('[data-action="finish-workout"]');
  finishBtn.addEventListener('click', async () => {
    if (finishBtn.disabled) return;
    if (!validateWorkoutName()) return;
    if (list.children.length === 0) {
      showToast('Adj legalább egy gyakorlatot az edzéshez', 'error');
      return;
    }

    finishBtn.disabled = true;
    try {
      /* Javítás alatt álló edzésnél NEM új sor keletkezik: a meglévőt írjuk
         felül, a saját dátumán. Az összegző ilyenkor kimarad — az egy most
         befejezett edzést ünnepelne, közben egy régit javítottunk. */
      if (editing.workoutId !== null) {
        await finishEdit();
        return;
      }

      // Az összegző értékeit még a kiürítés előtt rögzítjük
      const summary = summarizeWorkout();
      const saved = await api.saveWorkout(titleInput.value.trim(), readCurrentWorkout(), editing.planId);

      // A függő automatikus mentés leállítása (különben visszaírná a most
      // törölt piszkozatot) és a napló kiürítése — programozott változás,
      // tehát nem indít újabb automatikus mentést.
      await clearEditor();
      /* A mentett edzés AZONOSÍTÓJA is bekerül: az összegző visszajelzés-
         blokkja erre az edzésre küld. Enélkül nem tudná, mire hivatkozzon. */
      setLastSummary({
        ...summary,
        workoutId: saved.id,
        feedbackSent: false,
        /* A gyakorlatnevek a MENTETT sorrendben: a megjegyzés a tömbön
           belüli INDEXRE hivatkozik, ezért a kettőnek együtt kell járnia. */
        exercises: saved.exercises.map((exercise) => exercise.name),
      });

      // A naplózott edzés azonnal megjelenik a „Korábbi edzések" tetején,
      // a PR-lista, a heti volumen és az áttekintő számai is frissülnek.
      // A friss edzés a készenlét-becslésbe is azonnal beépül (izomcsoportok,
      // CNS, gyakorlat-ajánlások) — nem kell megvárni a következő betöltést.
      const history = $('[data-list="history"]');
      history.insertBefore(historyEntryEl(workoutHistoryEntry(saved)), history.firstChild);
      syncHistoryEmpty();
      await refreshAfterWorkoutChange();
      showToast('Edzés befejezve és naplózva');
      navigate('summary');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Nem sikerült menteni az edzést', 'error');
    } finally {
      finishBtn.disabled = false;
    }
  });


  /* A „Korábbi edzések" sorainak műveletei. Delegálva, a táplálkozás-napló
     mintájára: a lista teljesen újrarajzolódik, egyedi kezelők nem élnék túl. */
  $('[data-list="history"]').addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('[data-workout-id]');
    const id = Number(row?.dataset.workoutId);
    if (!Number.isInteger(id)) return;

    /* A teljes lista lekérése egy kattintásra: a szerkesztőnek a gyakorlat-
       lista is kell (a sorban csak a szett-szám látszik), és így egyben
       friss is — ha az edzést közben egy másik lapon törölték, azt itt
       tudjuk meg, nem a mentésnél. */
    const workout = (await api.getWorkouts()).find((entry) => entry.id === id);
    if (!workout) {
      row.remove();
      syncHistoryEmpty();
      showToast('Ez az edzés már nem létezik', 'error');
      return;
    }

    if (btn.dataset.action === 'reopen-workout') {
      await reopenWorkout(workout);
      return;
    }

    const ok = await confirmAction(
      `A(z) ${workout.date} napi „${workout.name}” edzés véglegesen törlődik. Ha egyéni csúcsot hozott, a rekord a következő legjobb edzésedre áll vissza.`,
      { title: 'Törlöd az edzést?', confirmLabel: 'Törlés' },
    );
    if (!ok) return;

    try {
      await api.deleteWorkout(id);
      row.remove();
      syncHistoryEmpty();
      /* Ha épp ezt az edzést javítottuk, a javítás tárgytalan — a szerver a
         piszkozat hivatkozását is elengedte, tehát a szerkesztő tartalma
         marad, de innentől új edzésként mentődik. */
      if (editing.workoutId === id) {
        editing.workoutId = null;
        editing.date = '';
        syncEditingState();
        autosave();
      }
      await refreshAfterWorkoutChange();
      showToast('Edzés törölve');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Nem sikerült törölni az edzést', 'error');
    }
  });

  /* A javítás megszakítása. Az EREDETI edzés érintetlen marad — csak a
     szerkesztőben álló, még el nem mentett módosítások vesznek el, ezért
     nem kérdezünk rá külön. */
  $('[data-action="cancel-workout-edit"]').addEventListener('click', async () => {
    await clearEditor();
    showToast('Szerkesztés megszakítva — az edzés változatlan');
  });


  return { loadPlan };
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
  img.addEventListener('error', () => { img.hidden = true; }, { once: true });
  if (!entry.gif) return;

  const still = img.src;
  const animated = `/exercises/${entry.gif}`;
  let preloaded = false;
  const play = () => {
    if (preloaded) { img.src = animated; return; }
    const probe = new Image();
    probe.addEventListener('load', () => { preloaded = true; img.src = animated; }, { once: true });
    probe.src = animated;
  };
  const stop = () => { img.src = still; };

  const card = img.closest('.ep-item');
  card.addEventListener('pointerenter', play);
  card.addEventListener('pointerleave', stop);
  card.addEventListener('focusin', play);
  card.addEventListener('focusout', stop);
}

export { setupThumb, setupWorkout };
