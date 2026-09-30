/** Edzői étrend: étkezések összeállítása a sportoló-részletnézet Táplálkozás
    fülén. Az edző ételt és grammot ad meg; az élő előnézet a kliensen számol
    (core/meals.js), a mentett érték a szerveré. */

import { api } from '../core/api.js';
import { $, $$, cloneTemplate } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { scaleFood, sumMacros } from '../core/meals.js';
import { showToast } from '../core/toast.js';

/** A napi cél elfogadott tartománya — a szerver GOAL_RANGES-ével egyezik.
    Ezen kívül az „Átveszem napi célnak" gomb tiltva van, mert a szerver
    úgyis elutasítaná. */
const GOAL_RANGE = { calories: [500, 10000], protein: [0, 500] };

const macroText = (m) => `${formatNumber(m.kcal)} kcal · ${formatNumber(m.protein)} g fehérje`;

/** Előjeles eltérés („+120" / „−80"), nullánál semmi. */
const signed = (value) =>
  value === 0 ? '±0' : `${value > 0 ? '+' : '−'}${formatNumber(Math.abs(value))}`;

let rowSeq = 0;

/**
 * @param {HTMLElement} root  a részletnézet gyökere
 * @param {object} deps
 * @param {() => object|null} deps.getCurrent  a nyitott sportoló
 * @param {() => void} deps.onGoalChange  a napi cél megváltozott (újrarajzolás)
 * @param {Function} deps.confirmAction  a ház megerősítő modálja
 */
function setupCoachMeals(root, { getCurrent, onGoalChange, confirmAction }) {
  const section = $('.co-meals', root);
  const listEl = $('[data-meal-list]', section);
  const emptyEl = $('[data-meals-empty]', section);
  const totalEl = $('[data-meals-total]', section);
  const toGoalBtn = $('[data-action="meals-to-goal"]', section);
  const newBtn = $('[data-action="new-meal"]', section);
  const form = $('[data-form="athlete-meal"]', section);
  const nameInput = $('#co-meal-name');
  const itemsEl = $('[data-meal-items]', form);
  const sumEl = $('[data-meal-sum]', form);
  const datalist = $('#co-meal-foods');
  const saveBtn = $('button[type="submit"]', form);

  // A szerkesztett étkezés id-je; null = új étkezés
  let editingId = null;
  // Név → étel. Az api.getFoods cache-elt, és az edző SAJÁT ételeit is hozza.
  let foodsByName = null;

  async function loadFoods() {
    if (foodsByName) return;
    const foods = await api.getFoods();
    foodsByName = new Map(foods.map((food) => [food.name, food]));
    datalist.replaceChildren(...foods.map((food) => new Option(food.name)));
  }

  /* ---- Szerkesztő ---- */

  /** Egy sor aktuális állapota: a felismert étel (vagy null) és a gramm. */
  const readRow = (row) => ({
    food: foodsByName?.get($('[data-item-food]', row).value.trim()) ?? null,
    grams: Number($('[data-item-grams]', row).value),
  });

  /** A sorok és az étkezés élő összege. Ismeretlen étel vagy rossz gramm
      mellett a sor nem számol — a mentést a szerver úgyis visszadobná. */
  function updateSum() {
    const scaled = [];
    $$('.co-meal-item', itemsEl).forEach((row) => {
      const { food, grams } = readRow(row);
      const macrosEl = $('[data-item-macros]', row);
      if (!food || !Number.isFinite(grams) || grams < 1) {
        macrosEl.textContent = food ? '' : 'Válassz a listából';
        return;
      }
      const macros = scaleFood(food, grams);
      macrosEl.textContent = macroText(macros);
      scaled.push(macros);
    });
    sumEl.textContent =
      scaled.length > 0 ? `Étkezés összesen: ${macroText(sumMacros(scaled))}` : '';
  }

  function addItemRow({ name = '', grams = 100 } = {}) {
    const row = cloneTemplate('tpl-meal-item-row');
    rowSeq += 1;
    const [foodLabel, gramsLabel] = $$('label', row);
    const foodInput = $('[data-item-food]', row);
    const gramsInput = $('[data-item-grams]', row);
    foodInput.id = `co-meal-food-${rowSeq}`;
    gramsInput.id = `co-meal-grams-${rowSeq}`;
    foodLabel.htmlFor = foodInput.id;
    gramsLabel.htmlFor = gramsInput.id;
    foodInput.value = name;
    gramsInput.value = String(grams);
    itemsEl.appendChild(row);
    return row;
  }

  const isFormOpen = () => !form.hidden;

  async function openForm(meal = null) {
    try {
      await loadFoods();
    } catch (err) {
      console.error(err);
      showToast('Az étel-lista most nem tölthető be', 'error');
      return;
    }
    editingId = meal?.id ?? null;
    nameInput.value = meal?.name ?? '';
    itemsEl.replaceChildren();
    (meal?.items ?? [{}]).forEach((item) => addItemRow(item));
    updateSum();
    saveBtn.textContent = meal ? 'Módosítás mentése' : 'Étkezés mentése';
    form.hidden = false;
    newBtn.hidden = true;
    nameInput.focus();
  }

  function closeForm() {
    form.hidden = true;
    newBtn.hidden = false;
    editingId = null;
    itemsEl.replaceChildren();
  }

  newBtn.addEventListener('click', () => openForm());
  $('[data-action="cancel-meal"]', form).addEventListener('click', closeForm);
  $('[data-action="add-meal-item"]', form).addEventListener('click', () => {
    $('[data-item-food]', addItemRow()).focus();
    updateSum();
  });

  itemsEl.addEventListener('input', updateSum);
  itemsEl.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('[data-action="remove-meal-item"]');
    if (!removeBtn) return;
    // Az utolsó sort nem vesszük el: tétel nélküli étkezés nem menthető
    if ($$('.co-meal-item', itemsEl).length === 1) {
      const row = removeBtn.closest('.co-meal-item');
      $('[data-item-food]', row).value = '';
    } else {
      removeBtn.closest('.co-meal-item').remove();
    }
    updateSum();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const athlete = getCurrent();
    if (!athlete) return;

    const items = $$('.co-meal-item', itemsEl).map((row) => ({
      name: $('[data-item-food]', row).value.trim(),
      grams: Number($('[data-item-grams]', row).value),
    }));
    const unknown = items.find((item) => !foodsByName.has(item.name));
    if (unknown) {
      showToast(`Ismeretlen étel: ${unknown.name || '(üres)'} — válassz a listából`, 'error');
      return;
    }

    const meal = { name: nameInput.value.trim(), items };
    saveBtn.disabled = true;
    try {
      athlete.meals =
        editingId === null
          ? await api.addAthleteMeal(athlete.linkId, meal)
          : await api.updateAthleteMeal(athlete.linkId, editingId, meal);
      showToast(editingId === null ? `${meal.name} hozzáadva` : `${meal.name} módosítva`);
      closeForm();
      renderList(athlete);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Az étkezést nem sikerült menteni', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  /* ---- Lista ---- */

  function mealRow(meal) {
    const item = cloneTemplate('tpl-coach-meal');
    item.dataset.mealId = meal.id;
    $('.co-meal-name', item).textContent = meal.name;
    $('.co-meal-macros', item).textContent = `${formatNumber(meal.protein)} g fehérje`;
    $('.co-meal-kcal', item).textContent = `${formatNumber(meal.kcal)} kcal`;
    // A sportoló ma már naplózta („Megettem") — az edző így látja a követést
    $('.co-meal-eaten', item).hidden = !meal.eatenToday;
    $$('[data-meal-action]', item).forEach((btn) => {
      const verb = btn.dataset.mealAction === 'edit' ? 'szerkesztése' : 'törlése';
      btn.setAttribute('aria-label', `${meal.name} ${verb}`);
    });
    $('.co-meal-lines', item).replaceChildren(
      ...meal.items.map((line) => {
        const li = document.createElement('li');
        li.append(
          ...[line.name, `${formatNumber(line.grams)} g`, macroText(line)].map((text) => {
            const span = document.createElement('span');
            span.textContent = text;
            return span;
          }),
        );
        return li;
      }),
    );
    return item;
  }

  /** Egy összesítő sor (kcal vagy fehérje): érték, a céltól való eltérés és
      a lefedettség-sáv. Cél nélkül csak az érték látszik. */
  function renderMetric(key, value, goalValue, unit, delta) {
    const row = $(`[data-total="${key}"]`, totalEl);
    const track = $('[data-total-track]', row);
    const deltaEl = $('[data-total-delta]', row);
    const hasGoal = goalValue != null;
    $('[data-total-value]', row).textContent = hasGoal
      ? `${formatNumber(value)} / ${formatNumber(goalValue)} ${unit}`
      : `${formatNumber(value)} ${unit}`;
    deltaEl.textContent = hasGoal ? `${signed(delta)} ${unit}` : '';
    // Jócskán a cél fölött: figyelmeztető szín (alatta a sáv mutatja a hiányt)
    deltaEl.classList.toggle('is-over', hasGoal && goalValue > 0 && value > goalValue * 1.1);
    track.hidden = !hasGoal;
    if (!hasGoal) return;
    const ratio = goalValue > 0 ? Math.min(value / goalValue, 1) : 1;
    $('.co-total-fill', track).style.width = `${ratio * 100}%`;
    track.classList.toggle('is-full', value >= goalValue);
  }

  /** Az étrend összege a napi célhoz mérve. A cél külön szám marad — itt
      csak látszik, mennyire fedi az étrend, és egy gombbal átvehető. */
  function renderTotal(athlete) {
    const meals = athlete.meals ?? [];
    totalEl.hidden = meals.length === 0;
    if (meals.length === 0) return;

    const total = sumMacros(meals);
    const goal = athlete.nutritionGoal;
    renderMetric(
      'kcal',
      total.kcal,
      goal?.calories,
      'kcal',
      goal && Math.round(total.kcal - goal.calories),
    );
    renderMetric(
      'protein',
      total.protein,
      goal?.protein,
      'g',
      goal && Math.round((total.protein - goal.protein) * 10) / 10,
    );

    const [minCal, maxCal] = GOAL_RANGE.calories;
    const [minPro, maxPro] = GOAL_RANGE.protein;
    const inRange =
      total.kcal >= minCal &&
      total.kcal <= maxCal &&
      total.protein >= minPro &&
      total.protein <= maxPro;
    const same =
      goal &&
      Math.round(total.kcal) === Math.round(goal.calories) &&
      Math.round(total.protein) === Math.round(goal.protein);
    toGoalBtn.hidden = Boolean(same);
    toGoalBtn.disabled = !inRange;
    toGoalBtn.title = inRange ? '' : `A napi cél legalább ${minCal} kcal lehet`;
  }

  function renderList(athlete) {
    const meals = athlete.meals ?? [];
    emptyEl.hidden = meals.length > 0;
    listEl.replaceChildren(...meals.map(mealRow));
    renderTotal(athlete);
  }

  listEl.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-meal-action]');
    const athlete = getCurrent();
    if (!btn || !athlete) return;
    const id = Number(btn.closest('.co-meal').dataset.mealId);
    const meal = athlete.meals.find((m) => m.id === id);
    if (!meal) return;

    if (btn.dataset.mealAction === 'edit') {
      openForm(meal);
      return;
    }

    const confirmed = await confirmAction(`${meal.name} lekerül ${athlete.name} étrendjéből.`, {
      title: 'Étkezés törlése',
      confirmLabel: 'Törlés',
    });
    if (!confirmed) return;
    try {
      athlete.meals = await api.removeAthleteMeal(athlete.linkId, id);
      if (editingId === id) closeForm();
      renderList(athlete);
      showToast(`${meal.name} törölve`);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Az étkezést nem sikerült törölni', 'error');
    }
  });

  toGoalBtn.addEventListener('click', async () => {
    const athlete = getCurrent();
    if (!athlete?.meals?.length) return;
    const total = sumMacros(athlete.meals);
    toGoalBtn.disabled = true;
    try {
      athlete.nutritionGoal = await api.setAthleteNutritionGoal(
        athlete.linkId,
        Math.round(total.kcal),
        Math.round(total.protein),
      );
      onGoalChange();
      showToast('Az étrend összege lett a napi cél');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'A célt nem sikerült kitűzni', 'error');
    } finally {
      renderTotal(athlete);
    }
  });

  return {
    /** A `keepInputs` a háttér-frissítésé: a nyitott szerkesztőt nem
        zárjuk be alóla. Sportoló-váltáskor (open) viszont zárjuk. */
    render(athlete, { keepInputs = false } = {}) {
      if (!keepInputs || !isFormOpen()) closeForm();
      renderList(athlete);
    },
    /** A napi cél változott — az összesítő sor eltérése is. */
    renderTotal: () => {
      const athlete = getCurrent();
      if (athlete) renderTotal(athlete);
    },
  };
}

export { setupCoachMeals };
