/**
 * Podium — a terv-betöltés visszavonása
 * ------------------------------------------------------------------------
 * A Tervek oldalon egy koppintás azonnal a naplóba tölti a tervet; a „← Vissza"
 * a betöltés ELŐTTI állapotot állítja vissza. A setupWorkout adja át a napló
 * vezérlőit (createPlanUndo).
 */
import { $ } from '../../shared/dom.js';
import { prefs } from '../../shared/prefs.js';
import { showToast } from '../../shared/toast.js';
import { navigate } from '../../app/router.js';
import { WORKOUT_START_KEY } from './summary-data.js';

export function createPlanUndo({
  titleInput,
  editing,
  readCurrentWorkout,
  loader,
  applyTemplate,
  syncEditingState,
  syncEmpty,
  autosave,
  clearEditor,
  doneSetCount,
  confirmAction,
}) {
  /* ---- A terv-betöltés visszavonása ----
     A Tervek oldalon egy koppintás azonnal a naplóba tölti a tervet (és a
     piszkozat mentődik). Véletlen koppintásnál a „← Vissza" a betöltés ELŐTTI
     állapotot állítja vissza — az üres naplót, vagy a korábbi, megkezdett
     edzést a pipáival együtt —, és visszavisz a Tervek oldalra. A pillanatkép
     csak memóriában él: amint a visszavonás értelmét veszti (befejezés,
     javításra nyitás, napváltás), eldobjuk. */
  const undoBar = $('[data-plan-undo]');
  let undoSnapshot = null;

  const setUndo = (snapshot) => {
    undoSnapshot = snapshot;
    undoBar.hidden = snapshot === null;
  };

  const snapshotEditor = () => ({
    name: titleInput.value,
    exercises: readCurrentWorkout(),
    planId: editing.planId,
    workoutId: editing.workoutId,
    date: editing.date,
    start: prefs.get(WORKOUT_START_KEY),
  });

  /** A Tervek oldal ezt hívja: a betöltés előtt rögzíti a napló állapotát. */
  const loadPlan = async (plan) => {
    const before = snapshotEditor();
    const loaded = await loader.loadPlan(plan);
    if (loaded) setUndo(before);
    return loaded;
  };

  /* „← Vissza": a terv-betöltés visszavonása. Ha a betöltött edzésben már
     van kipipált szett, rákérdezünk — az a munka elvész. */
  $('[data-action="undo-plan-load"]').addEventListener('click', async () => {
    const snapshot = undoSnapshot;
    if (!snapshot) return;
    const doneSets = doneSetCount();
    if (doneSets > 0) {
      const ok = await confirmAction(
        `A betöltött edzésben ${doneSets} kipipált szett van — ezek elvesznek.`,
        { title: 'Visszavonod a betöltést?', confirmLabel: 'Visszavonom' },
      );
      if (!ok) return;
    }

    if (snapshot.exercises.length === 0 && !snapshot.name.trim()) {
      // Üres volt a napló: a terv piszkozatát is töröljük — nem marad semmi
      await clearEditor();
    } else {
      // A korábbi edzés vissza, a pipáival és az edzés-órájával együtt
      applyTemplate({
        name: snapshot.name,
        exercises: snapshot.exercises,
        planId: snapshot.planId,
        workoutId: snapshot.workoutId,
      });
      editing.date = snapshot.date;
      syncEditingState();
      syncEmpty();
      prefs.set(WORKOUT_START_KEY, snapshot.start ?? null);
      autosave();
      setUndo(null);
    }
    navigate('plans');
    showToast('Betöltés visszavonva — semmi nem került a naplóba');
  });

  return { setUndo, loadPlan };
}
