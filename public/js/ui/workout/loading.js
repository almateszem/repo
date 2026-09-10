/**
 * A szerkesztő feltöltése tartalommal.
 *
 * Három forrás van, és mindhárom ugyanoda érkezik: a szerver induló sablonja
 * (aznapi piszkozat vagy a mai terv), egy mentett edzés (javítás), vagy egy
 * terv. A közös mag ezért egy helyen áll — a három hívó abban tér el, mit
 * tesz ELŐTTE (megerősítés) és UTÁNA (edzés-óra, mentés, navigáció).
 *
 * A modul nem birtokolja a szerkesztőt: a DOM-ot, a szerkesztési állapotot és
 * a szinkronizáló függvényeket a vezérlőtől kapja. Így a betöltés útja külön
 * olvasható a napló többi részétől, de nem lesz belőle második gazda.
 */

import { api } from '../../core/api.js';
import { $$ } from '../../core/dom.js';
import { prefs } from '../../core/prefs.js';
import { showToast } from '../../core/toast.js';
import { navigate } from '../../nav/router.js';
import { refreshExerciseList, renderExercise } from '../../render/sets.js';
import { WORKOUT_START_KEY } from '../../render/summary.js';

export function createContentLoader({
  page, list, titleInput, titleError, exerciseOptions, editing,
  syncEmpty, syncEditingState, refreshPrIndicators, autosave, confirmAction,
}) {
  /** Hány teljesített szett van most a naplóban — a felülíró műveletek
      (terv betöltése, edzés visszanyitása) ez alapján kérdeznek rá. */
  const doneSetCount = () => $$('.wk-set-check', page)
    .filter((check) => check.getAttribute('aria-pressed') === 'true').length;

  /** A napló tartalmának cseréje. Pontosan ezt csinálja mind a három betöltő —
      csak az előtte/utána következő lépésekben különböznek. */
  const fillExercises = (name, exercises) => {
    titleInput.value = name;
    list.replaceChildren();
    exercises.forEach((exercise) => {
      list.appendChild(renderExercise(exercise, exerciseOptions));
    });
    refreshExerciseList(list);
    syncEmpty();
  };

  /** A név-hibajelzés eltakarítása: az új cím betöltésével a régi névre
      vonatkozó hiba tárgytalan. */
  const clearNameError = () => {
    titleInput.classList.remove('has-error');
    titleError.hidden = true;
  };

  /** A szervertől kapott induló tartalom betöltése a naplóba. */
  const applyTemplate = (template) => {
    if (!template) return;
    editing.planId = template.planId ?? null;
    editing.workoutId = template.workoutId ?? null;
    fillExercises(template.name, template.exercises);
    if (template.source === 'plan') showToast(`Mai terv betöltve: ${template.name}`);
    // Minden template-betöltés után: a napváltáskori csere is ide fut be, és
    // ott a javítás-állapot is megszűnhet (ha a mai terv veszi át a helyét).
    syncEditingState();
    refreshPrIndicators();
  };

  /** Mentett edzés visszanyitása javításra: a tartalma a szerkesztőbe kerül,
      és a befejezés majd a MEGLÉVŐ sort frissíti. */
  const reopenWorkout = async (workout) => {
    const doneSets = doneSetCount();
    if (doneSets > 0) {
      const ok = await confirmAction(
        `A megkezdett edzésedben ${doneSets} teljesített szett van. A(z) ${workout.date} napi edzés javításra nyitása ezeket felülírja.`,
        { title: 'Felülírod a megkezdett edzést?', confirmLabel: 'Javítás megnyitása' },
      );
      if (!ok) return;
    }

    editing.planId = workout.planId ?? null;
    editing.workoutId = workout.id;
    editing.date = workout.date;
    clearNameError();
    fillExercises(workout.name, workout.exercises);
    syncEditingState();
    refreshPrIndicators();
    /* Az edzés-óra nullázódik: a megkezdett edzés helyére egy RÉGI edzés
       került, tehát a korábbi indulási időhöz már nincs mit mérni. */
    prefs.set(WORKOUT_START_KEY, null);
    autosave();
    navigate('workout');
    showToast(`A(z) ${workout.date} napi edzés javításra megnyitva`);
  };

  /** Terv betöltése az edzésnaplóba (a Tervek nyíl-gombja hívja). Igazzal tér
      vissza, ha a betöltés meg is történt — a hívó ebből tudja, navigáljon-e. */
  const loadPlan = async (plan) => {
    const doneSets = doneSetCount();
    if (doneSets > 0) {
      const ok = await confirmAction(
        `A megkezdett edzésedben ${doneSets} teljesített szett van. A(z) „${plan.name}” betöltése ezeket felülírja.`,
        { title: 'Felülírod a megkezdett edzést?', confirmLabel: 'Terv betöltése' },
      );
      if (!ok) return false;
    }

    editing.planId = plan.id ?? null;
    // A terv betöltése ÚJ edzést kezd: ha épp egy régit javítottunk, az a
    // szál itt lezárul — különben a terv tartalma írná felül a mentett edzést.
    editing.workoutId = null;
    editing.date = '';
    syncEditingState();
    clearNameError();
    fillExercises(plan.name, plan.exercises);
    prefs.set(WORKOUT_START_KEY, null); // friss edzés — az óra az első pipával indul újra
    autosave();
    return true;
  };

  /** A javításra megnyitott edzés dátuma nem utazik a piszkozattal, a
      szerkesztés-sávhoz viszont kell — a mentett edzésekből oldjuk fel.
      Ha az edzés időközben eltűnt (másik lapon törölték), a javítás
      tárgytalan: a tartalom marad, de új edzésként mentődik — ugyanaz a
      viselkedés, amit a szerver is választ (deleteWorkout → a piszkozat
      workout_id-ja NULL-ra vált). */
  const resolveEditedDate = async () => {
    if (editing.workoutId === null) return;
    const saved = await api.getWorkouts();
    editing.date = saved.find((workout) => workout.id === editing.workoutId)?.date ?? '';
    if (!editing.date) editing.workoutId = null;
  };

  return { doneSetCount, applyTemplate, reopenWorkout, loadPlan, resolveEditedDate };
}
