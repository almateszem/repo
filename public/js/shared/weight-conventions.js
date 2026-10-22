/** Súly-konvenciók — EGY helyen.

    A szerver mondja meg (/api/weight-conventions), mely gyakorlatoknál
    kezenként értendő a beírt súly (kézisúlyzó), és melyek saját testsúlyosak
    (ott a beírt kilogramm a RÁADÁS, a terhelés zöme a testsúly). A napló
    feliratai (workout/sets-view.js) és az élő PR-jelző alapterhelése (workout/workout.js)
    is innen olvas. Korábban két másolat töltődött két kéréssel, és csak az
    egyik frissült — a testsúly mentése után a PR-jelző elavult testsúllyal
    számolt.

    Induláskor egyszer töltődik (a kártyák kirajzolása szinkron, menet közben
    nem várhat kérésre), és frissül edzés-változás meg testsúly-mentés után.
    Hibánál a korábbi (induláskor a semleges) állapot marad. */

import { api } from './api.js';

const perHand = new Set();
const addedWeight = new Set();
let bodyweightFactors = {};
let bodyweightKg = 0;

async function loadWeightConventions() {
  try {
    const conventions = await api.getWeightConventions();
    perHand.clear();
    for (const name of conventions.perHand ?? []) perHand.add(name);
    bodyweightFactors = conventions.bodyweightFactors ?? {};
    addedWeight.clear();
    for (const name of Object.keys(bodyweightFactors)) addedWeight.add(name);
    bodyweightKg = conventions.bodyweightKg ?? 0;
  } catch (err) {
    console.error('A súly-konvenciók nem töltődtek be:', err);
  }
}

/** Ugyanaz a lekérés — edzés-változás és testsúly-mentés után. */
const refreshWeightConventions = loadWeightConventions;

/** Kezenként értendő-e a beírt súly (kézisúlyzós gyakorlat). */
const isPerHand = (name) => perHand.has(name);

/** Saját testsúlyos-e (a beírt súly a ráadás). */
const isAddedWeight = (name) => addedWeight.has(name);

/** A saját testsúlyos gyakorlat alapterhelése a mostani testsúllyal (kg),
    más gyakorlatnál 0. Object.hasOwn: az örökölt kulcs (`constructor`) nem
    gyakorlat. */
const baseLoadFor = (name) =>
  Object.hasOwn(bodyweightFactors, name) && bodyweightKg > 0
    ? bodyweightFactors[name] * bodyweightKg
    : 0;

export { baseLoadFor, isAddedWeight, isPerHand, loadWeightConventions, refreshWeightConventions };
