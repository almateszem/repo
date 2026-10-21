/**
 * Podium — az edzés befejezése és a javítás mentése
 * ------------------------------------------------------------------------
 * A „Befejezés" gomb: név-ellenőrzés, a kipipálatlan edzés megerősítése, új
 * edzés naplózása (összegzővel) vagy a visszanyitott edzés felülírása. A
 * napló kiürítése és a lezárás utáni frissítések a setupWorkout-éi, innen
 * csak hívódnak (bindFinish).
 */
import { api } from '../../shared/api.js';
import { $ } from '../../shared/dom.js';
import { showToast } from '../../shared/toast.js';
import { navigate } from '../../app/router.js';
import { historyEntryEl, syncHistoryEmpty, workoutHistoryEntry } from '../../render/workout.js';
import { setLastSummary, summarizeWorkout } from './summary-data.js';

export function bindFinish({
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
}) {
  /** Közös név-validáció: a mentés és a befejezés is megköveteli az edzésnevet.
      Toast nincs: a mező alatti hiba és a fókusz ugyanazt mondja (a
      képernyőolvasónak az aria-describedby), a kettő együtt duplán szólt. */
  const validateWorkoutName = () => {
    if (titleInput.value.trim()) return true;
    titleInput.classList.add('has-error');
    titleError.hidden = false;
    titleInput.focus();
    return false;
  };

  /** A javítás mentése: a MEGLÉVŐ edzés felülírása a saját dátumán. A lista
      sorát a helyén cseréljük — a lista elejére szúrás azt hazudná, hogy ez
      a legfrissebb edzés. */
  const finishEdit = async () => {
    const updated = await api.updateWorkout(
      editing.workoutId,
      titleInput.value.trim(),
      readCurrentWorkout(),
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
    // Előbb a tartalom: üres edzésnél a „nevezd el" kérés félrevezető lenne.
    if (list.children.length === 0) {
      showToast('Adj legalább egy gyakorlatot az edzéshez', 'error');
      return;
    }
    if (!validateWorkoutName()) return;

    /* Kipipált szett nélkül a naplóba egy „0/9 szett" edzés kerülne — ez
       szinte mindig véletlen koppintás. Csak új edzésnél kérdezünk: egy régi
       edzés javítását nem akasztjuk meg. */
    if (editing.workoutId === null && doneSetCount() === 0) {
      const ok = await confirmAction(
        'Egyetlen szett sincs kipipálva — a naplóba egy üres edzés kerülne. Biztosan befejezed?',
        { title: 'Befejezed kipipált szett nélkül?', confirmLabel: 'Naplózom' },
      );
      if (!ok) return;
    }

    finishBtn.disabled = true;
    try {
      /* Előbb a futó piszkozat-mentés: ha a végleges mentés (ami a piszkozatot
         törli) után érne célba, a lezárt edzés piszkozatát írná vissza. */
      await cancelAutosave();
      /* Javítás alatt álló edzésnél NEM új sor keletkezik: a meglévőt írjuk
         felül, a saját dátumán. Az összegző ilyenkor kimarad — az egy most
         befejezett edzést ünnepelne, közben egy régit javítottunk. */
      if (editing.workoutId !== null) {
        await finishEdit();
        return;
      }

      // Az összegző értékeit még a kiürítés előtt rögzítjük
      const summary = summarizeWorkout();
      const saved = await api.saveWorkout(
        titleInput.value.trim(),
        readCurrentWorkout(),
        editing.planId,
      );

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
      // A napló marad — a fent leállított piszkozat-mentés újra induljon
      draft.schedule();
    } finally {
      finishBtn.disabled = false;
    }
  });
}
