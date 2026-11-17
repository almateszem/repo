/**
 * Podium — a napi táplálkozási cél összefüggés-szabálya
 * ------------------------------------------------------------------------
 * A fehérje kalóriája (4 kcal/g) nem haladhatja meg a napi kalóriacélt:
 * 500 kcal mellé 400 g fehérje (~1600 kcal) ellentmondás, és a rossz cél a
 * készenlét-számításba is bekerülne. A szerver (server/routes/nutrition.js)
 * és a két űrlap (saját cél, edzői cél) ugyanezt a függvényt használja,
 * hogy a szabály és a szöveg ne csússzon szét. DOM nélküli modul.
 */

/** Kalória grammonként a fehérjében. */
const KCAL_PER_GRAM_PROTEIN = 4;

/** Az ellentmondás magyar leírása, vagy null, ha a pár rendben van (vagy még
    hiányos — azt a kötelező mező maga jelzi). */
export function goalConflict(calories, protein) {
  if (!Number.isFinite(calories) || !Number.isFinite(protein)) return null;
  const proteinKcal = Math.round(protein * KCAL_PER_GRAM_PROTEIN);
  if (proteinKcal <= calories) return null;
  return (
    `A fehérje (${Math.round(protein)} g ≈ ${proteinKcal} kcal) több, mint a napi kalória ` +
    `(${Math.round(calories)} kcal) — emeld a kalóriát, vagy csökkentsd a fehérjét.`
  );
}

/** A két mező összekötése: gépelés közben a fehérje-mező egyedi hibát kap,
    így a böngésző a mentést is megállítja, és kiírja az okát. */
export function bindGoalConsistency(caloriesInput, proteinInput) {
  const check = () => {
    const message = goalConflict(Number(caloriesInput.value), Number(proteinInput.value)) ?? '';
    proteinInput.setCustomValidity(message);
    proteinInput.toggleAttribute('aria-invalid', message !== '');
  };
  caloriesInput.addEventListener('input', check);
  proteinInput.addEventListener('input', check);
  return check;
}
