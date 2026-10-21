/**
 * Podium — a napi check-in állapota
 * ------------------------------------------------------------------------
 * A varázsló konstansai (lépések, skálák, testrégiók, kapuk), tiszta
 * segédfüggvényei és a munkamenet (`ci`, lépés-sorrend). A lépések
 * (steps.js, steps-input.js) és a varázsló (wizard.js) innen importál —
 * ez a fájl egyiket sem ismeri, így nincs körkörös import.
 */

import { MUSCLE_GROUPS } from '../shared/readiness.js';

/* ======================================================================
   Konstansok
   ====================================================================== */

/** A napi check-in varázsló konstansai: lépések, skálák, testrégiók, kapuk. */

/** A mindig jelen lévő lépések. A testtérképeket a kapu-válaszok fűzik be
    (lásd ciStepOrder) — ezért nincs külön „ugorj ide" logika sehol. */
const CI_BASE_STEPS = ['intro', 'sleep', 'sleepq', 'energy', 'stress', 'weight', 'soreGate'];

/** A skála-lépések kulcsa → a CHECKIN_SCALES mezőneve. */
const CI_SCALE_STEPS = { sleepq: 'sleepQuality', energy: 'energy', stress: 'stress' };

const CI_SLEEP_PRESETS = [6, 7, 7.5, 8, 8.5];

const CI_SLEEP_MIN = 0;

/* A varázsló korábban 12 óránál elvágta az alvást, a részletes űrlap és a
   szerver viszont 24-ig fogad el. Az eltérés némán csonkította a bevitelt
   (betegség, bepótolt alvás után 13 órából 12 lett), ezért a varázsló is
   0–24-gyel fut. */
const CI_SLEEP_MAX = 24;

/* A testsúly-lépés. A tartomány a szerverével egyezik (server.js) — a
   kliens csak beszédesebb hibát ad, nem enged át mást. */
const CI_WEIGHT_MIN = 30;

const CI_WEIGHT_MAX = 300;

/** Gyorsgombok a viszonyítási mérés köré, kilóban. */
const CI_WEIGHT_PRESET_OFFSETS = [-0.5, 0, 0.5];

/** A ± gombok kiindulópontja, ha még soha nem mértél. */
const CI_WEIGHT_FALLBACK = 80;

/** A két kapu-lépés szövegei és a hozzájuk tartozó állapot-kulcs. */
const CI_GATES = {
  soreGate: {
    key: 'sore',
    eyebrow: 'Részletes kitöltés',
    title: 'Van izomlázad valahol?',
    sub: '',
    no: ['Nincs izomlázam'],
    yes: ['Van, megjelölöm'],
  },
  painGate: {
    key: 'pain',
    eyebrow: 'Fájdalom · sérülés',
    title: 'Van éles fájdalmad vagy sérülésed?',
    sub: 'Ez más, mint az izomláz.',
    no: ['Nincs'],
    yes: ['Van fájdalom vagy sérülés'],
  },
};

/** A két testtérkép-mód. A `field` az answers-beli kulcs is egyben. */
const CI_MAP_MODES = {
  soreness: {
    field: 'soreness',
    max: 10,
    defaultValue: 5,
    noun: 'izomláz',
    eyebrow: 'Részletes kitöltés',
    title: 'Hol van izomlázad?',
    sub: 'Koppints egy izomra, majd csúsztasd az erősséghez.',
    legend: '1 = alig érezhető · 10 = nagyon erős',
  },
  painMap: {
    field: 'pain',
    max: 10,
    defaultValue: 5,
    noun: 'fájdalom',
    eyebrow: 'Fájdalom · sérülés',
    title: 'Hol fáj pontosan?',
    sub: 'Koppints a fájó területre, majd csúsztasd az erősséghez.',
    legend: '1 = enyhe · 10 = nagyon erős · 7-től letiltja az izmot terhelő gyakorlatokat',
  },
};

/** Automatikus továbblépés késleltetése koppintás után. */
const CI_ADVANCE_MS = 260;

const CI_PRESET_ADVANCE_MS = 140;

/** A motor 7-TŐL tiltja a gyakorlatokat (server/recovery.js:486), nem 7 fölött. */
const CI_PAIN_BLOCK = 7;

const CI_READINESS_VERDICTS = { ok: 'Jó készenlét', warn: 'Közepes', bad: 'Óvatosan ma' };

/* ======================================================================
   Segédfüggvények
   ====================================================================== */

/** A check-in varázsló tiszta segédfüggvényei. */

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
  sessionDate: null, // a betöltés helyi napja — napváltáskor újraindul
  loaded: false, // lekértük-e már a mai állapotot a szervertől
  saved: false,
  readiness: null, // a szerver riportja; helyi becslést NEM számolunk
  hadCheckin: false, // volt-e ma már check-in (az összegzésre ugráshoz)
  dirty: false, // változott-e valami a betöltött állapothoz képest
  gates: { sore: null, pain: null },
  answers: {
    sleepHours: null,
    sleepQuality: null,
    energy: null,
    stress: null,
    weightKg: null, // null = ma nem mértél; ilyenkor nem születik bejegyzés
    soreness: {}, // { chest: 3, … } 1..10, csak a megjelöltek
    pain: {}, // { back: 8, … }  1..10, 'general' NÉLKÜL
  },
  carried: { mood: null, hydration: null, painGeneral: null },
});

/** A mai nap emberi felirata („szeptember 5."), a lépések fejlécéhez. */
const ciDateStr = () => new Date().toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' });

/* ======================================================================
   Munkamenet
   ====================================================================== */

/**
 * A check-in varázsló munkamenete.
 *
 * A `carried` a legfontosabb mező. A PUT /api/checkin TELJES SORT ír felül
 * (server/db.js — ON CONFLICT … SET minden oszlopra), és a törzsből hiányzó
 * mezőből a server.js readOptionalNumber-e null-t csinál. A varázsló
 * szándékosan nem kérdez közérzetet, folyadékot és általános fájdalmat —
 * ezeket ezért betöltéskor ide tesszük el, és mentéskor VÁLTOZATLANUL
 * visszaküldjük. Enélkül a részletes űrlapon aznap megadott értékek némán
 * NULL-ra állnának.
 *
 * A testsúly nem itt, hanem az `answers`-ben van: a varázsló KÉRDEZI (a
 * dashboard külön rögzítő űrlapja helyett). A szerver nem a checkins sorba,
 * hanem a weight_log-ba írja, naponta egy sorba — az újramentés felülír, nem
 * duplikál (server/db.js addWeightEntry).
 *
 * AZ OBJEKTUM AZONOSSÁGA ÁLLANDÓ: új munkamenetnél a MEZŐI cserélődnek, maga a
 * `ci` nem. Így a lépés-modulok egyszerűen importálhatják, és egy már felépült
 * lépés eseménykezelője sem ragadhat bele egy régi állapot-objektumba.
 */

const ci = ciEmptyState();

/** Új munkamenet: minden mező vissza az alapállapotra, a nap rögzítésével. */
function resetSession(sessionDate) {
  Object.assign(ci, ciEmptyState(), { sessionDate });
}

/** Napváltás. A `loaded` hamisra állítása elég: a következő megnyitás ebből
    tudja, hogy friss munkamenetet kell kezdenie. */
function clearSession() {
  ci.loaded = false;
  ci.sessionDate = null;
}

/** A lépések aktuális sorrendje. A kapuk maguk a sorrend: ha nincs izomláz,
    a 'soreness' egyszerűen nincs a listában, és a sima „következő" a
    fájdalom-kapun landol. */
function ciStepOrder() {
  const steps = [...CI_BASE_STEPS];
  if (ci.gates.sore === 'yes') steps.push('soreness');
  steps.push('painGate');
  if (ci.gates.pain === 'yes') steps.push('painMap');
  steps.push('summary');
  return steps;
}

/** A folyamatsávban számolt lépések (az intro és az összegzés nem kérdés). */
const ciCountedSteps = () => ciStepOrder().filter((s) => s !== 'intro' && s !== 'summary');

export {
  ci,
  CI_ADVANCE_MS,
  CI_GATES,
  CI_MAP_MODES,
  CI_PAIN_BLOCK,
  CI_PRESET_ADVANCE_MS,
  CI_READINESS_VERDICTS,
  CI_SCALE_STEPS,
  CI_SLEEP_MAX,
  CI_SLEEP_MIN,
  CI_SLEEP_PRESETS,
  CI_WEIGHT_FALLBACK,
  CI_WEIGHT_MAX,
  CI_WEIGHT_MIN,
  CI_WEIGHT_PRESET_OFFSETS,
  ciClamp,
  ciCountedSteps,
  ciDateStr,
  ciMuscleLabel,
  ciPickPositive,
  ciStepOrder,
  clearSession,
  resetSession,
};
