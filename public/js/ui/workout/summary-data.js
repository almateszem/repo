/**
 * Podium — az edzés-összegző adatai
 * ------------------------------------------------------------------------
 * Az edzés-óra (az első pipa indítja), az edzésnapló pillanatnyi összegzése
 * és az utoljára lezárt edzés pillanatképe. A kirajzolás a
 * render/summary.js-é: az paraméterként kapja az összegzést.
 */
import { $, $$ } from '../../core/dom.js';
import { prefs } from '../../core/prefs.js';

/** Az edzés kezdetének rögzítése (prefs): az aznapi első szett-pipa indítja.
    Terv-betöltéskor nullázódik — onnan új edzés számít. */
export const WORKOUT_START_KEY = 'workoutStart';

export const markWorkoutStarted = () => {
  const day = new Date().toDateString();
  const start = prefs.get(WORKOUT_START_KEY, null);
  if (!start || start.day !== day) prefs.set(WORKOUT_START_KEY, { day, ts: Date.now() });
};

/** Egy edzés reális felső határa — ennél régebbi kezdés elfelejtett
    (nem lezárt) edzésre utal, nem a mostanira. */
const MAX_WORKOUT_HOURS = 8;

/** Az edzés kezdete óta eltelt percek. A kezdés időbélyegéből számol, nem a
    naptári napból: így az éjfélen átnyúló edzés is a valós hosszát mutatja
    (korábban ilyenkor 0 percet írt ki). */
const workoutMinutes = () => {
  const start = prefs.get(WORKOUT_START_KEY, null);
  if (!start) return 0;
  const elapsedMinutes = Math.round((Date.now() - start.ts) / 60000);
  if (elapsedMinutes > MAX_WORKOUT_HOURS * 60) return 0;
  return Math.max(1, elapsedMinutes);
};

/** Az utoljára lezárt edzés összegzése. Az „Edzés befejezése" a naplót
    lezárja és kiüríti, ezért az összegző értékeit a lezárás pillanatában
    rögzítjük — az élő DOM-ból már nem lennének kiolvashatók. */
export let lastSummary = null;

/** Az edzésnapló pillanatnyi állapotának összegzése (a lezáráskor és a
    mély-linkkel megnyitott összegzőnél is ez számol). */
export function summarizeWorkout() {
  const workoutPage = $('[data-page="workout"]');
  const checks = $$('.wk-set-list .wk-set-check', workoutPage);
  const done = checks.filter((check) => check.getAttribute('aria-pressed') === 'true').length;
  return {
    name: $('#workout-name').value.trim() || 'Edzés',
    done,
    total: checks.length,
    minutes: done === 0 ? 0 : workoutMinutes(),
    hasPr: $$('.wk-exercise-head .wk-pr', workoutPage).some(
      (el) => el.getAttribute('aria-pressed') === 'true',
    ),
  };
}

export const setLastSummary = (summary) => {
  lastSummary = summary;
};
