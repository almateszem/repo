/**
 * Podium — a napi táplálkozási cél összefüggés-szabálya (szerver)
 * ------------------------------------------------------------------------
 * A fehérje kalóriája (4 kcal/g) nem haladhatja meg a napi kalóriacélt:
 * 500 kcal mellé 400 g fehérje (~1600 kcal) ellentmondás, és a rossz cél a
 * készenlét-számításba is bekerülne. A felület ugyanezt a szabályt
 * gépelés közben is jelzi (public/js/shared/nutrition-goal.js) — a kettő
 * egyezését teszt őrzi (tests/server/nutrition-goal-consistency.test.js).
 */

/** Kalória grammonként a fehérjében. */
const KCAL_PER_GRAM_PROTEIN = 4;

/** Az ellentmondás magyar leírása, vagy null, ha a pár rendben van. */
export function goalConflict(calories, protein) {
  if (!Number.isFinite(calories) || !Number.isFinite(protein)) return null;
  const proteinKcal = Math.round(protein * KCAL_PER_GRAM_PROTEIN);
  if (proteinKcal <= calories) return null;
  return (
    `A fehérje (${Math.round(protein)} g ≈ ${proteinKcal} kcal) több, mint a napi kalória ` +
    `(${Math.round(calories)} kcal) — emeld a kalóriát, vagy csökkentsd a fehérjét.`
  );
}
