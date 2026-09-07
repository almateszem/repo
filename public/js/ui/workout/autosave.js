/**
 * Az edzésnapló piszkozatának automatikus mentése.
 *
 * Debounce-olt PUT a szerverre, felső határidővel, sikertelenség esetén
 * korlátozott számú újrapróbálkozással, és a lap elrejtésekor (bezárás,
 * tab-váltás) egy utolsó keepalive-kéréssel. A saját állapotát (időzítők,
 * utoljára elküldött törzs, fut-e épp mentés) senki más nem látja.
 *
 * A mentendő törzset NEM maga állítja elő: azt a vezérlő adja `buildBody`-ként,
 * mert a törzs a szerkesztő élő állapotától függ (terv-azonosító, javított
 * edzés azonosítója). Így a motor nem ismeri a naplót, csak menteni tud.
 */

import { api } from '../../core/api.js';
import { $ } from '../../core/dom.js';

export function createDraftAutosave({ buildBody }) {
/* ---- Automatikus mentés ----
   Minden változtatás után rövid szünettel (debounce) a szerverre PUT-oljuk
   a piszkozatot, így az állapot újratöltés/leállás után is megmarad.
   Lapelrejtéskor (bezárás, tab-váltás) a függő mentést azonnal elküldjük
   keepalive-kéréssel, hogy az utolsó változtatás se vesszen el. */
const AUTOSAVE_DEBOUNCE_MS = 500;
/** Felső korlát a debounce halogatására. A debounce minden változtatásnál
    újraindul, tehát folyamatos gépelésnél (500 ms-nál sűrűbb leütéseknél)
    magától sosem sülne el — az ELSŐ függő változtatástól számítva ennyi idő
    után mindenképp mentünk. */
const AUTOSAVE_MAX_WAIT_MS = 5000;
/** Sikertelen mentés utáni újrapróbálkozások szünetei. A végén megáll: a
    felhasználó ekkor már látja a hibaállapotot, és ő dönt. */
const AUTOSAVE_RETRY_MS = [3000, 8000, 20000];

const statusEl = $('[data-autosave-status]');
const statusTextEl = $('[data-autosave-text]');
const IDLE_TEXT = statusTextEl.textContent;

/** Az automatikus mentés állapota egy soron. Korábban itt csak egy statikus
    ígéret állt („a módosítások automatikusan mentődnek"), a hiba pedig
    kizárólag a konzolra ment — a felhasználó azt hitte, minden mentve van,
    közben nem. */
const setStatus = (state, text) => {
  statusEl.dataset.state = state;
  statusTextEl.textContent = text;
};
const clockNow = () => new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });

let autosaveTimer = null;
let retryTimer = null;
let retryStep = 0;
/** Az első még el nem mentett változtatás időpontja — ehhez mérjük a
    max-waitet. null, ha nincs függő mentés. */
let pendingSince = null;
/** Az utoljára SIKERESEN elküldött törzs sorosítva. Ha a mentés pillanatában
    ugyanez jönne ki, a kérés kimarad: a debounce akkor is elsül, ha az
    állapot közben visszaállt (beírsz egy értéket, majd visszaírod az
    eredetit; vagy a szett-típus oda-vissza váltása). */
let lastSentBody = null;
/** Fut-e épp mentés. Egyszerre csak egy: a párhuzamos kérések feldolgozási
    sorrendje nem garantált, és egy későn beérkező válasz elavult állapotot
    rögzítene a lastSentBody-ba — utána a valódi változás maradna ki. */
let inFlight = false;

const flush = async () => {
  autosaveTimer = null;
  retryTimer = null; // ha újrapróbálkozásból futunk, az az időzítő már elsült

  // Fut egy mentés → megvárjuk. A pendingSince ilyenkor SZÁNDÉKOSAN marad:
  // a max-wait határideje az első változtatástól ketyeg tovább.
  if (inFlight) {
    autosaveTimer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    return;
  }
  pendingSince = null;

  const body = buildBody();
  const serialized = JSON.stringify(body);
  if (serialized === lastSentBody) {
    // Nincs mit menteni. Ha épp hibaállapot látszik, az ilyenkor félrevezető:
    // a szerveren pontosan ez az állapot van, csak azóta jutottunk vissza ide.
    if (statusEl.dataset.state === 'error') setStatus('saved', `Mentve · ${clockNow()}`);
    return;
  }

  setStatus('saving', 'Mentés…');
  inFlight = true;
  try {
    await api.saveWorkoutDraft(body.name, body.exercises, body.planId, body.workoutId);
    lastSentBody = serialized;
    retryStep = 0;
    setStatus('saved', `Mentve · ${clockNow()}`);
  } catch (err) {
    console.error('Automatikus mentés sikertelen:', err);
    const wait = AUTOSAVE_RETRY_MS[retryStep];
    if (wait === undefined) {
      setStatus('error', 'A napló nincs elmentve — ellenőrizd a kapcsolatot, majd módosíts valamit az újrapróbáláshoz.');
      return;
    }
    retryStep += 1;
    setStatus('error', `Nem sikerült menteni — újrapróbálkozás ${Math.round(wait / 1000)} mp múlva…`);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(flush, wait);
  } finally {
    inFlight = false;
  }
};

const autosave = () => {
  // Új változtatás → a hibás kör újraindul az elejéről
  clearTimeout(retryTimer);
  retryTimer = null;
  retryStep = 0;

  // Az első függő változtatás indítja a max-wait óráját; a továbbiak már
  // csak a debounce-t tolják, a határidőt nem.
  if (pendingSince === null) pendingSince = Date.now();
  const untilDeadline = pendingSince + AUTOSAVE_MAX_WAIT_MS - Date.now();
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flush, Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, untilDeadline)));
};

/** A függő mentés leállítása (az edzés lezárása hívja: a piszkozat törlése
    után egy késleltetett mentés visszaírná a most lezárt edzést). */
const cancelAutosave = () => {
  clearTimeout(autosaveTimer);
  clearTimeout(retryTimer);
  autosaveTimer = null;
  retryTimer = null;
  retryStep = 0;
  pendingSince = null;
  inFlight = false;
  // A piszkozat törlődik (az edzés lezárult), tehát az „ezt már elküldtük"
  // emlék is érvénytelen: a következő edzés első mentése akkor is menjen ki,
  // ha véletlenül pont ugyanaz a szerkezet.
  lastSentBody = null;
  setStatus('idle', IDLE_TEXT);
};
document.addEventListener('visibilitychange', () => {
  // Függő mentés VAGY függő újrapróbálkozás esetén is küldünk: a
  // lapelrejtés (bezárás, tab-váltás) az utolsó esély.
  if (document.visibilityState !== 'hidden' || (autosaveTimer === null && retryTimer === null)) return;
  clearTimeout(autosaveTimer);
  clearTimeout(retryTimer);
  autosaveTimer = null;
  retryTimer = null;
  pendingSince = null;
  const serialized = JSON.stringify(buildBody());
  // Ugyanaz, mint ami már kint van → nincs kérés. A lastSentBody-t viszont
  // NEM írjuk át a küldéskor: a keepalive-kérés eredményét nem látjuk, és
  // egy sikeresnek hitt, valójában elveszett mentés rosszabb, mint egy
  // fölösleges ismétlés a visszatérés utáni első változtatáskor.
  if (serialized === lastSentBody) return;
  fetch('/api/workout-draft', {
    method: 'PUT',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: serialized,
  }).catch(() => {});
});

  return { schedule: autosave, cancel: cancelAutosave };
}
