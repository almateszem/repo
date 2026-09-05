/** Az edzés-összegző: időtartam, volumen, izomtérkép, idézet. */

import { $, $$ } from '../core/dom.js';
import { animateNumber } from '../core/format.js';
import { hooks } from '../core/page-hooks.js';
import { prefs } from '../core/prefs.js';

/** Az edzés kezdetének rögzítése (prefs): az aznapi első szett-pipa indítja.
    Terv-betöltéskor nullázódik — onnan új edzés számít. */
const WORKOUT_START_KEY = 'workoutStart';

const markWorkoutStarted = () => {
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

const SUMMARY_QUOTES = [
  'Erős voltál ma — a következő edzés még jobb lesz!',
  'Minden pipált szett egy lépés a célod felé.',
  'A folyamatosság veri a tökéletességet — ma is jelen voltál.',
  'Szép munka! A regeneráció most ugyanolyan fontos, mint a súly.',
];

let summaryQuoteIndex = Math.floor(Math.random() * SUMMARY_QUOTES.length);

/** Az utoljára lezárt edzés összegzése. Az „Edzés befejezése" a naplót
    lezárja és kiüríti, ezért az összegző értékeit a lezárás pillanatában
    rögzítjük — az élő DOM-ból már nem lennének kiolvashatók. */
let lastSummary = null;

/** Az edzésnapló pillanatnyi állapotának összegzése (a lezáráskor és a
    mély-linkkel megnyitott összegzőnél is ez számol). */
function summarizeWorkout() {
  const workoutPage = $('[data-page="workout"]');
  const checks = $$('.wk-set-list .wk-set-check', workoutPage);
  const done = checks.filter((check) => check.getAttribute('aria-pressed') === 'true').length;
  return {
    name: $('#workout-name').value.trim() || 'Edzés',
    done,
    total: checks.length,
    minutes: done === 0 ? 0 : workoutMinutes(),
    hasPr: $$('.wk-exercise-head .wk-pr', workoutPage)
      .some((el) => el.getAttribute('aria-pressed') === 'true'),
  };
}

const setLastSummary = (summary) => { lastSummary = summary; };

function renderSummary() {
  // Lezárás után a rögzített pillanatkép, egyébként az élő naplóállapot
  const summary = lastSummary ?? summarizeWorkout();

  $('[data-su-name]').textContent = summary.name;
  $('[data-su-pr]').hidden = !summary.hasPr;
  $('[data-su-sets-total]').textContent = String(summary.total);
  $('[data-su-quote]').textContent = SUMMARY_QUOTES[summaryQuoteIndex % SUMMARY_QUOTES.length];
  summaryQuoteIndex += 1; // minden megnyitásra másik motivációs sor jut

  animateNumber($('[data-su-sets-done]'), summary.done, { from: 0, duration: 700 });
  animateNumber($('[data-su-duration]'), summary.minutes, { from: 0, duration: 800 });

  // A visszajelzés-blokk minden megnyitáskor újraszinkronizál (más edzés,
  // vagy már elküldött visszajelzés).
  hooks.refreshSummaryFeedback?.();
}

/* ---- Regeneráció (Recovery Engine) ---- */

export { WORKOUT_START_KEY, lastSummary, markWorkoutStarted, renderSummary, setLastSummary, summarizeWorkout };
