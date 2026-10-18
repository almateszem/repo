/**
 * Podium — a PR-lista és a „Korábbi edzések"
 * ------------------------------------------------------------------------
 * A lekérés (újrahívható: edzés-mentés után frissen húzza le a listákat) és
 * a „Korábbi edzések" sorainak műveletei (javításra nyitás, törlés). A
 * kirajzolás a render/prs.js és a render/workout.js dolga.
 */
import { api } from '../../core/api.js';
import { $ } from '../../core/dom.js';
import { showToast } from '../../core/toast.js';
import { paintPrs } from '../../render/prs.js';
import { paintHistory, syncHistoryEmpty } from '../../render/workout.js';

export async function renderPrs() {
  paintPrs(await api.getPrs());
}

export async function renderWorkout() {
  paintHistory(await api.getWorkouts());
}

/** A sor-műveletek bekötése; a napló vezérlőit a setupWorkout adja át. */
export function bindHistoryActions({
  editing,
  reopenWorkout,
  setUndo,
  syncEditingState,
  autosave,
  refreshAfterWorkoutChange,
  confirmAction,
}) {
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
      // A javítás új szál: a terv-betöltés előtti állapot visszaállítása
      // innentől egy RÉGI edzést írna felül
      setUndo(null);
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
}
