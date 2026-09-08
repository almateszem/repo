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
import { ciEmptyState } from './helpers.js';
import { CI_BASE_STEPS } from './constants.js';

export const ci = ciEmptyState();

/** Új munkamenet: minden mező vissza az alapállapotra, a nap rögzítésével. */
export function resetSession(sessionDate) {
  Object.assign(ci, ciEmptyState(), { sessionDate });
}

/** Napváltás. A `loaded` hamisra állítása elég: a következő megnyitás ebből
    tudja, hogy friss munkamenetet kell kezdenie. */
export function clearSession() {
  ci.loaded = false;
  ci.sessionDate = null;
}

/** A lépések aktuális sorrendje. A kapuk maguk a sorrend: ha nincs izomláz,
    a 'soreness' egyszerűen nincs a listában, és a sima „következő" a
    fájdalom-kapun landol. */
export function ciStepOrder() {
  const steps = [...CI_BASE_STEPS];
  if (ci.gates.sore === 'yes') steps.push('soreness');
  steps.push('painGate');
  if (ci.gates.pain === 'yes') steps.push('painMap');
  steps.push('summary');
  return steps;
}

/** A folyamatsávban számolt lépések (az intro és az összegzés nem kérdés). */
export const ciCountedSteps = () => ciStepOrder().filter((s) => s !== 'intro' && s !== 'summary');
