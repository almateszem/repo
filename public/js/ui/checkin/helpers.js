/** A check-in varázsló tiszta segédfüggvényei. */

import { MUSCLE_GROUPS } from '../../render/recovery.js';

const ciMuscleLabel = (key) => MUSCLE_GROUPS.find(([k]) => k === key)?.[1] ?? key;

const ciClamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Csak a pozitív értékek — a 0 a részletes űrlapon érvényes „semmi", a
    térképen viszont ez a NEM megjelölt állapot. */
function ciPickPositive(map, skipKey = null) {
  const out = {};
  for (const [key, value] of Object.entries(map ?? {})) {
    if (key !== skipKey && Number(value) > 0) out[key] = Number(value);
  }
  return out;
}

const ciEmptyState = () => ({
  step: 'intro',
  sessionDate: null,   // a betöltés helyi napja — napváltáskor újraindul
  loaded: false,       // lekértük-e már a mai állapotot a szervertől
  saved: false,
  readiness: null,     // a szerver riportja; helyi becslést NEM számolunk
  hadCheckin: false,   // volt-e ma már check-in (az összegzésre ugráshoz)
  dirty: false,        // változott-e valami a betöltött állapothoz képest
  mapView: 'front',
  gates: { sore: null, pain: null },
  answers: {
    sleepHours: null, sleepQuality: null, energy: null, stress: null,
    weightKg: null,    // null = ma nem mértél; ilyenkor nem születik bejegyzés
    soreness: {},      // { chest: 3, … } 1..5, csak a megjelöltek
    pain: {},          // { back: 8, … }  1..10, 'general' NÉLKÜL
  },
  carried: { mood: null, hydration: null, painGeneral: null },
});

/** A mai nap emberi felirata („szeptember 5."), a lépések fejlécéhez. */
const ciDateStr = () => new Date().toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' });

export { ciClamp, ciDateStr, ciEmptyState, ciMuscleLabel, ciPickPositive };
