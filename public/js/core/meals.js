/**
 * Étkezés-számolás az edzői étrend-szerkesztő élő előnézetéhez.
 *
 * UGYANAZ a kerekítés, mint a szerveren (server/db.js → scaleMealItem, ami az
 * addNutritionEntry-ét követi): kcal egészre, makrók egy tizedesre, az
 * étkezés összege egy tizedesre. A mentett szám a szerveré — ez csak azért
 * egyezik vele, hogy az edző ne lásson mást gépelés közben, mint mentés után.
 */

/** Egy 100 g-os étel makrói a megadott adagra. */
export function scaleFood(food, grams) {
  const factor = grams / 100;
  const round1 = (value) => Math.round(value * factor * 10) / 10;
  return {
    kcal: Math.round(food.kcal * factor),
    protein: round1(food.protein),
    carbs: round1(food.carbs),
    fat: round1(food.fat),
  };
}

/** Tételek (már adagra számolt makrókkal) összege. */
export function sumMacros(items) {
  const sum = (key) => Math.round(items.reduce((acc, item) => acc + item[key], 0) * 10) / 10;
  return { kcal: sum('kcal'), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat') };
}
