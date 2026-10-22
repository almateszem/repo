/**
 * Podium — korábbi edzések és rekordok
 * ------------------------------------------------------------------------
 * A „Korábbi edzések” lista és a rekordlista kirajzolása, valamint a sorok
 * műveleteinek bekötése.
 */

import { api } from '../shared/api.js';
import { $, cloneTemplate } from '../shared/dom.js';
import { showToast } from '../shared/toast.js';
import { formatNumber } from '../shared/format.js';

/* ======================================================================
   Sor-műveletek
   ====================================================================== */

/**
 * Podium — a PR-lista és a „Korábbi edzések"
 * ------------------------------------------------------------------------
 * A lekérés (újrahívható: edzés-mentés után frissen húzza le a listákat) és
 * a „Korábbi edzések" sorainak műveletei (javításra nyitás, törlés). A
 * kirajzolás lent, a „Korábbi edzések" és a „Rekordok" szakaszban.
 */

async function renderPrs() {
  paintPrs(await api.getPrs());
}

async function renderWorkout() {
  paintHistory(await api.getWorkouts());
}

/** A sor-műveletek bekötése; a napló vezérlőit a setupWorkout adja át. */
function bindHistoryActions({
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

/* ======================================================================
   Korábbi edzések
   ====================================================================== */

/** A mentett edzések listája (előzmények). */

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
    id: workout.id,
    date: workout.date,
    detail: workout.name,
    rpe: `${done}/${sets.length} szett`,
  };
}

/** A „Korábbi edzések" üres-állapota csak addig látszik, amíg nincs mentett edzés. */
const syncHistoryEmpty = () => {
  $('[data-history-empty]').hidden = $('[data-list="history"]').children.length > 0;
};

/** A „Korábbi edzések" lista a kapott mentett edzésekből (legújabb elöl; a
    lekérés: fent, renderWorkout). Az edzésnapló tartalmát
    nem ez tölti: azt a setupWorkout kéri le (aznapi piszkozat vagy a mára
    ütemezett terv). */
function paintHistory(savedWorkouts) {
  const history = $('[data-list="history"]');
  history.replaceChildren();
  savedWorkouts.forEach((workout) =>
    history.appendChild(historyEntryEl(workoutHistoryEntry(workout))),
  );
  syncHistoryEmpty();
}

/* ======================================================================
   Rekordok
   ====================================================================== */

/** A személyes rekordok (PR) listája. */

/** Korábbi rekordok (PR) listája a workout oldalon — a mentett edzések
    PR-jelölt gyakorlataiból (a szerver állítja össze; a lekérés:
    fent, renderPrs). */
function paintPrs(prs) {
  const list = $('[data-list="prs"]');
  list.replaceChildren();
  prs.forEach((pr, index) => {
    const item = cloneTemplate('tpl-pr');
    item.style.setProperty('--i', index);
    item.dataset.exercise = pr.exercise;
    $('.wk-pr-exercise', item).textContent = pr.exercise;

    // Detail: szett információ + 1RM érték
    let detailText = pr.detail;
    if (pr.oneRM !== null && pr.oneRM > 0) {
      detailText += ` • 1RM: ${formatNumber(pr.oneRM)} kg`;
    }
    $('.wk-pr-detail', item).textContent = detailText;
    $('.wk-pr-date', item).textContent = pr.date;
    list.appendChild(item);
  });
  $('[data-prs-empty]').hidden = prs.length > 0;
}

export {
  bindHistoryActions,
  historyEntryEl,
  renderPrs,
  renderWorkout,
  syncHistoryEmpty,
  workoutHistoryEntry,
};
