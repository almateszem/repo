/** Táplálkozás oldal: keresés, naplózás, napi célok. */

import { SESSION_LOST, api } from '../shared/api.js';
import { onDayChange } from '../shared/day.js';
import { $, cloneTemplate } from '../shared/dom.js';
import { animateNumber, formatNumber } from '../shared/format.js';
import { hooks } from '../shared/page-hooks.js';
import { SEARCH_DELAY_MS, createPagedList, debounce } from '../shared/paged-list.js';
import { showToast } from '../shared/toast.js';
import { onPageShow } from '../app/router.js';
import { refreshDailyStats } from './dashboard-data.js';
import { renderFoodItem } from '../render/foods.js';

async function setupNutrition(foodDetail) {
  const searchInput = $('#food-search');
  const emptyState = $('.nu-empty');
  const logList = $('[data-list="nutrition-log"]');
  const logEmpty = $('[data-nu-log-empty]');
  const logCount = $('[data-nu-log-count]');
  const STAT_KEYS = ['intake', 'protein', 'carbs', 'fat'];

  // A napi összesítő a szerverről (alap + naplózott ételek) — újratöltés után
  // is a valós állapotot mutatja. A lokális másolat a POST-válaszokkal frissül.
  let totals = null;
  const applyTotals = (next, { animateFrom = null } = {}) => {
    totals = next;
    STAT_KEYS.forEach((key) => {
      const el = $(`[data-stat="${key}"]`);
      if (animateFrom) animateNumber(el, totals[key], { from: animateFrom[key], duration: 600 });
      else el.textContent = formatNumber(totals[key]);
    });
    /* A fejléc „Cél" száma is innen jön: a cél mostantól szerkeszthető,
       tehát nem elég egyszer, betöltéskor kiírni. */
    const goalCalEl = $('[data-goal="calories"]');
    if (goalCalEl) goalCalEl.textContent = formatNumber(totals.goal.calories);

    /* A hős alatti sáv a cél felé vezető utat mutatja — ugyanaz a minta, mint
       a vízmérőé (ui/water.js). 100%-nál megáll: a túlevés nem „több mint
       teli" sáv, azt a szám mondja meg, nem a rajz. A nulla cél ellen a
       védelem nem elméleti — a cél szerkeszthető, és a hányados NaN-ként
       érvénytelen CSS-szélességet adna. */
    const intakeFill = $('[data-intake-fill]');
    if (intakeFill) {
      const goal = totals.goal.calories;
      const ratio = goal > 0 ? Math.min(totals.intake / goal, 1) : 0;
      intakeFill.style.width = `${Math.round(ratio * 100)}%`;
    }
  };
  applyTotals(await api.getNutrition());

  /* ---- Mai napló ----
     A felület korábban csak összesített: nem lehetett megnézni, mit ettél
     aznap, és egy téves koppintás visszavonhatatlan volt. A lista a
     szerverről jön, a törlés a bejegyzés id-jével megy. */
  let logEntries = [];

  const renderLog = () => {
    logList.replaceChildren();
    logEntries.forEach((entry, index) => {
      const item = cloneTemplate('tpl-nutrition-entry');
      item.style.setProperty('--i', index);
      $('.nu-log-name', item).textContent = entry.name;
      // Az adag is látszik: két 100 g-os és egy 250 g-os tétel másképp
      // olvasandó, a puszta makrókból ez nem derülne ki.
      $('.nu-log-macros', item).textContent =
        `${formatNumber(entry.grams)} g · ${formatNumber(entry.protein)} g F · ${formatNumber(entry.carbs)} g Cs · ${formatNumber(entry.fat)} g Zs`;
      $('.nu-log-kcal', item).textContent = `${formatNumber(entry.kcal)} kcal`;

      const editBtn = $('.nu-log-edit', item);
      editBtn.dataset.entryId = entry.id;
      editBtn.setAttribute('aria-label', `${entry.name} adagjának javítása`);

      const removeBtn = $('.nu-log-remove', item);
      removeBtn.dataset.entryId = entry.id;
      removeBtn.title = 'Bejegyzés törlése';
      removeBtn.setAttribute(
        'aria-label',
        `${entry.name} (${formatNumber(entry.grams)} g) törlése a mai naplóból`,
      );
      logList.appendChild(item);
    });

    logEmpty.hidden = logEntries.length > 0;
    logCount.textContent =
      logEntries.length > 0
        ? `${logEntries.length} tétel · ${formatNumber(logEntries.reduce((sum, e) => sum + e.kcal, 0))} kcal`
        : '';
  };

  const reloadLog = async () => {
    logEntries = await api.getNutritionLog();
    renderLog();
  };
  await reloadLog();

  /** Az adag beépített szerkesztője. A ház nem használ natív ablakot
      (window.prompt/confirm), ezért a sorban nyílik egy mező: Enter ment,
      Escape és a fókusz elvesztése elvet. */
  function openPortionEditor(row, entry) {
    const macros = $('.nu-log-macros', row);
    const original = macros.textContent;

    const input = document.createElement('input');
    input.className = 'nu-log-grams';
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.step = '1';
    input.value = String(entry.grams);
    input.setAttribute('aria-label', `${entry.name} adagja grammban`);

    let done = false;
    const cancel = () => {
      if (done) return;
      done = true;
      macros.textContent = original;
    };

    const save = async () => {
      if (done) return;
      const grams = Number(input.value);
      if (!Number.isFinite(grams) || grams < 1) {
        showToast('Az adag egy pozitív szám legyen', 'error');
        input.focus();
        return;
      }
      done = true;
      try {
        const previous = totals;
        const res = await api.updateNutritionEntry(entry.id, Math.round(grams));
        applyTotals(res.totals, { animateFrom: previous });
        await reloadLog();
        refreshDailyStats().catch(console.error);
        showToast('Adag javítva');
      } catch (err) {
        console.error(err);
        macros.textContent = original;
        showToast(err.message || 'Nem sikerült javítani az adagot', 'error');
      }
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    input.addEventListener('blur', cancel);

    macros.replaceChildren(input);
    input.focus();
    input.select();
  }

  // Törlés — a szerver a frissített összesítőt adja vissza, így egy körből
  // frissül a napló, a makrók és az áttekintő kalória-statja is.
  logList.addEventListener('click', async (event) => {
    /* Adag javítása. Az elgépelt mennyiséget eddig csak törléssel lehetett
       orvosolni, és addig a napi bevitel alulmért maradt — ami a készenlét
       táplálkozás-komponensébe is beszivárog. */
    const editBtn = event.target.closest('.nu-log-edit');
    if (editBtn) {
      const id = Number(editBtn.dataset.entryId);
      const entry = logEntries.find((e) => e.id === id);
      const row = editBtn.closest('.nu-log-item');
      if (!entry || !row || $('.nu-log-grams', row)) return;
      openPortionEditor(row, entry);
      return;
    }

    const removeBtn = event.target.closest('.nu-log-remove');
    if (!removeBtn) return;
    const id = Number(removeBtn.dataset.entryId);
    const entry = logEntries.find((e) => e.id === id);

    removeBtn.disabled = true;
    try {
      const previous = totals;
      applyTotals(await api.removeNutritionEntry(id), { animateFrom: previous });
      logEntries = logEntries.filter((e) => e.id !== id);
      renderLog();
      refreshDailyStats().catch(console.error);
      showToast(entry ? `${entry.name} törölve a naplóból` : 'Bejegyzés törölve');
    } catch (err) {
      console.error(err);
      removeBtn.disabled = false;
      showToast(err.message || 'Nem sikerült törölni a bejegyzést', 'error');
    }
  });

  // Éjfél után a napi összesítő nulláról indul (a szerver mindig az aznapi
  // bejegyzéseket összegzi — csak újra le kell kérni), és a napló is kiürül.
  onDayChange(async () => {
    applyTotals(await api.getNutrition());
    await reloadLog();
  });

  /* ---- Napi cél ----
     Két forrásból jöhet: amit az EDZŐ tűzött ki, és amit a felhasználó maga
     állított be. Az edzőé az erősebb, és zárol (`locked`): amíg él, a
     szerkesztő el van rejtve — csak az edző módosíthatja. */
  const goalSection = $('.nu-goal');
  const goalValueEl = $('[data-nu-goal-value]', goalSection);
  const goalSourceEl = $('[data-nu-goal-source]', goalSection);
  const goalForm = $('[data-form="nutrition-goal"]', goalSection);
  const goalEditBtn = $('[data-action="edit-goal"]', goalSection);
  const goalRevertBtn = $('[data-action="revert-goal"]', goalSection);
  const goalCaloriesInput = $('#nu-goal-calories');
  const goalProteinInput = $('#nu-goal-protein');
  const goalSaveBtn = $('.nu-goal-save', goalSection);

  /** Honnan jön a szám — ezt mindig kiírjuk, mert a puszta érték nem
      mondaná meg, hogy az edződ tűzte-e ki vagy te magad. */
  const GOAL_SOURCE_TEXT = {
    own: () => 'A saját célod.',
    coach: (goal) => `${goal.setBy ?? 'Az edződ'} tűzte ki — csak ő módosíthatja.`,
    default: () => 'Alapértelmezett cél — állítsd be a sajátodat.',
  };

  const renderGoal = (goal) => {
    if (!goal) return;
    goalValueEl.textContent = `${formatNumber(goal.calories)} kcal · ${formatNumber(goal.protein)} g fehérje`;
    goalSourceEl.textContent = (GOAL_SOURCE_TEXT[goal.source] ?? GOAL_SOURCE_TEXT.default)(goal);

    // Az edzői cél zárolt: nincs mit szerkeszteni, a nyitott űrlap is bezárul
    goalEditBtn.hidden = Boolean(goal.locked);
    if (goal.locked) setGoalFormOpen(false);
    // Visszaállítani csak a saját célt lehet (az edzőét ő maga vonja vissza)
    goalRevertBtn.hidden = goal.source !== 'own';

    // A szerkesztő mezői mindig az ÉRVÉNYES célról indulnak.
    goalCaloriesInput.value = Math.round(goal.calories);
    goalProteinInput.value = Math.round(goal.protein);
  };

  const setGoalFormOpen = (open) => {
    goalForm.hidden = !open;
    goalEditBtn.setAttribute('aria-expanded', String(open));
    goalEditBtn.textContent = open ? 'Mégse' : 'Módosítom';
    if (open) goalCaloriesInput.focus();
  };

  goalEditBtn.addEventListener('click', () => setGoalFormOpen(goalForm.hidden));

  goalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    goalSaveBtn.disabled = true;
    try {
      renderGoal(
        await api.saveNutritionGoal(
          Number(goalCaloriesInput.value),
          Number(goalProteinInput.value),
        ),
      );
      setGoalFormOpen(false);
      // A napi összesítő ugyanezt a célt méri — újra le kell kérni.
      applyTotals(await api.getNutrition());
      refreshDailyStats().catch(console.error);
      showToast('Napi cél mentve');
    } catch (err) {
      if (err.code !== SESSION_LOST) {
        console.error(err);
        showToast(err.message || 'A célt nem sikerült menteni', 'error');
        // Pl. közben az edző kitűzte (403) — a zárolt állapotot mutassuk
        renderGoal((await api.getNutrition()).goal);
      }
    } finally {
      goalSaveBtn.disabled = false;
    }
  });

  /* A saját cél elvetése: az alapértelmezett cél lép érvénybe. A szám a
     napi összesítőt is átírja, ezért azt is újra lekérjük. */
  goalRevertBtn.addEventListener('click', async () => {
    goalRevertBtn.disabled = true;
    try {
      renderGoal(await api.clearNutritionGoal());
      setGoalFormOpen(false);
      applyTotals(await api.getNutrition());
      refreshDailyStats().catch(console.error);
      showToast('Napi cél visszaállítva');
    } catch (err) {
      if (err.code !== SESSION_LOST) {
        console.error(err);
        showToast(err.message || 'A célt nem sikerült visszaállítani', 'error');
      }
    } finally {
      goalRevertBtn.disabled = false;
    }
  });

  renderGoal(totals.goal);

  /* ---- Az edződ étrendje ----
     Az edző által összeállított étkezések. A „Megettem" az étkezés MINDEN
     tételét a mai naplóba írja — a szerver a tárolt adagokból és makrókból
     dolgozik, a kliens csak az étkezés id-jét küldi. */
  const mealsSection = $('[data-nu-meals]');
  const mealList = $('[data-list="coach-meals"]', mealsSection);
  const mealsTotalEl = $('[data-nu-meals-total]', mealsSection);
  const mealsDoneEl = $('[data-nu-meals-done]', mealsSection);
  let meals = [];

  /* A MA már megevett étkezés eltűnik a listából — másodszor nem
     naplózható (a szerver is 409-cel utasítaná el). Másnap újra ott van. */
  const renderMeals = () => {
    const left = meals.filter((meal) => !meal.eatenToday);
    mealsSection.hidden = meals.length === 0;
    mealsDoneEl.hidden = meals.length === 0 || left.length > 0;
    mealList.replaceChildren(
      ...left.map((meal) => {
        const item = cloneTemplate('tpl-nutrition-meal');
        $('.nu-meal-name', item).textContent = meal.name;
        $('.nu-meal-macros', item).textContent =
          `${formatNumber(meal.protein)} g F · ${formatNumber(meal.carbs)} g Cs · ${formatNumber(meal.fat)} g Zs`;
        $('.nu-meal-kcal', item).textContent = `${formatNumber(meal.kcal)} kcal`;
        const logBtn = $('.nu-meal-log', item);
        logBtn.dataset.mealId = meal.id;
        logBtn.setAttribute('aria-label', `${meal.name} naplózása a mai napra`);
        $('.nu-meal-items', item).replaceChildren(
          ...meal.items.map((line) => {
            const li = document.createElement('li');
            li.textContent = `${line.name} · ${formatNumber(line.grams)} g · ${formatNumber(line.kcal)} kcal`;
            return li;
          }),
        );
        return item;
      }),
    );
    const eaten = meals.length - left.length;
    const sum = meals.reduce((acc, meal) => acc + meal.kcal, 0);
    mealsTotalEl.textContent =
      meals.length > 0
        ? `${eaten}/${meals.length} megvan · ${formatNumber(sum)} kcal összesen`
        : '';
  };

  const reloadMeals = async () => {
    try {
      meals = await api.getMeals();
    } catch (err) {
      // Az étrend kiegészítő blokk — a hibája ne vigye el az oldalt
      if (err.code !== SESSION_LOST) console.error('Az étrend nem tölthető be:', err);
      meals = [];
    }
    renderMeals();
  };
  await reloadMeals();
  /* Az oldal megnyitásakor: az étrendet ÉS a célt is az edző írja, tehát
     bármelyik elavulhatott, amíg máshol jártunk (pl. közben kitűzött cél →
     a szerkesztőnek el kell tűnnie). */
  hooks.refreshCoachMeals = async () => {
    const next = await api.getNutrition();
    applyTotals(next);
    renderGoal(next.goal);
    await reloadMeals();
  };
  // Éjfél után a tegnap megevett étkezések újra naplózhatók
  onDayChange(reloadMeals);

  mealList.addEventListener('click', async (event) => {
    const logBtn = event.target.closest('.nu-meal-log');
    if (!logBtn) return;
    const meal = meals.find((m) => m.id === Number(logBtn.dataset.mealId));
    if (!meal) return;

    logBtn.disabled = true;
    try {
      const previous = totals;
      const res = await api.logMeal(meal.id);
      applyTotals(res.totals, { animateFrom: previous });
      logEntries = [...logEntries, ...res.entries];
      renderLog();
      meals = res.meals;
      renderMeals();
      refreshDailyStats().catch(console.error);
      showToast(`${meal.name} naplózva · +${formatNumber(meal.kcal)} kcal`);
    } catch (err) {
      logBtn.disabled = false;
      if (err.code !== SESSION_LOST) {
        console.error(err);
        showToast(err.message || 'Az étkezést nem sikerült naplózni', 'error');
        // Pl. egy másik fülön már naplózta (409) — a lista hozza be a valóságot
        await reloadMeals();
      }
    }
  });

  /* ---- Étel-lista: szerveroldali keresés, 40-es lapok ----
     A lista az oldal ELSŐ megnyitásakor töltődik (onPageShow → startFoods,
     lent), nem az app indulásakor. A nyíl
     kattintásakor az ételt a betöltött lapokból épülő név → étel táblából
     vesszük; új keresésnél a tábla kiürül. */
  const foodList = $('[data-list="foods"]');
  const moreBtn = $('[data-action="more-foods"]');
  const foodsByName = new Map();
  let foodsStarted = false;

  /* Keresés nélkül a lista összecsukott: az első COLLAPSED_FOODS étel
     látszik, alatta „Mutass többet". Korábban az első 40 étel (és görgetésre a
     következő 40) szűretlenül állt a lapon, ami telefonon 4000px fölé nyújtotta
     az oldalt. A szám a CSS .nu-food-list.is-collapsed szabályával egyezik. */
  const COLLAPSED_FOODS = 8;
  let foodsExpanded = false;

  const syncMoreButton = () => {
    moreBtn.hidden = foodsExpanded || foodList.children.length <= COLLAPSED_FOODS;
  };

  const foodsPaged = createPagedList({
    list: foodList,
    fetchPage: (params) => api.searchFoods(params),
    renderItem: renderFoodItem,
    onPage: (items, _nodes, { append }) => {
      if (!append) foodsByName.clear();
      items.forEach((food) => foodsByName.set(food.name, food));
    },
    onState: ({ status, total }) => {
      if (status === 'ready') emptyState.hidden = total > 0;
      // Hibánál az „Újra" sor beszél — a „Nincs találat" félrevezetne
      if (status === 'error') emptyState.hidden = true;
      syncMoreButton();
    },
  });

  /** Összecsukott vagy teljes lista. Kereséskor mindig a teljes: aki gépel,
      az a találatokat akarja látni, nem egy újabb gombot. */
  const setFoodsExpanded = (expanded) => {
    foodsExpanded = expanded;
    foodList.classList.toggle('is-collapsed', !expanded);
    foodsPaged.setPaused(!expanded);
    syncMoreButton();
  };

  moreBtn.addEventListener('click', () => {
    setFoodsExpanded(true);
    // A billentyűzetes felhasználó ott folytatja, ahol az új sorok kezdődnek
    foodList.children[COLLAPSED_FOODS]?.querySelector('.nu-food-add')?.focus();
  });

  const runFoodQuery = () => {
    runFoodQueryDebounced.cancel();
    foodsStarted = true;
    const q = searchInput.value.trim();
    setFoodsExpanded(q !== '');
    syncRecentVisibility();
    return foodsPaged.setQuery({ q });
  };
  const runFoodQueryDebounced = debounce(runFoodQuery, SEARCH_DELAY_MS);
  searchInput.addEventListener('input', runFoodQueryDebounced);

  const startFoods = () => {
    if (foodsStarted) return;
    runFoodQuery();
    refreshRecent();
  };
  /* Az étrendet az edző írja — a mi másolatunk bármikor elavulhat. Pótlás
     nem kell: induláskor a setup tölti az összesítőt. */
  onPageShow(
    'nutrition',
    () => hooks.refreshCoachMeals().catch((err) => console.error('Étrend frissítési hiba:', err)),
    { catchUp: false },
  );

  /* Saját étel felvitele/törlése után: a lista a MOSTANI kereséssel indul
     elölről, így az új saját étel (a szerver elöl adja) azonnal látszik, a
     beírt keresés pedig nem oldódik fel. */
  const refreshFoods = () => runFoodQuery();

  /** Az adagválasztó megnyitása egy ételre — a napi összesítővel és a mai,
      EBBŐL az ételből származó bejegyzésekkel. A lista nyila és a saját étel
      „Mentés és naplózás" gombja is ezt hívja. */
  const openFoodDetail = (food) => {
    if (!foodDetail) return false;
    foodDetail.open(food, {
      totals,
      entries: logEntries.filter((entry) => entry.name === food.name),
    });
    return true;
  };

  /* Naplózás a részlet-modálból: a szerver a megadott adagra számolja át a
     makrókat, és visszaadja a frissített összesítőt. Hibát tovább dobunk —
     a modál ilyenkor nyitva marad a beállított adaggal. */
  /* ---- Legutóbbiak ----
     Az utoljára naplózott, különböző ételek a legutóbbi adaggal. Egy koppintás
     ugyanazt az adagot naplózza újra; ha más kell, a listából az adagválasztó
     nyílik. Hibánál a sor egyszerűen nem jelenik meg — nem blokkolja a lapot. */
  const recentSection = $('[data-nu-recent]');
  const recentList = $('[data-list="recent-foods"]');
  let recentFoods = [];

  const syncRecentVisibility = () => {
    recentSection.hidden = recentFoods.length === 0 || searchInput.value.trim() !== '';
  };

  const renderRecent = () => {
    recentList.replaceChildren(
      ...recentFoods.map((entry) => {
        const amount = `${formatNumber(entry.grams)} ${entry.unit}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'nu-recent-item';
        button.dataset.recentFood = entry.name;
        button.setAttribute('aria-label', `${entry.name}, ${amount} naplózása`);

        const name = document.createElement('span');
        name.className = 'nu-recent-name';
        name.textContent = entry.name;
        const meta = document.createElement('span');
        meta.className = 'nu-recent-meta';
        meta.textContent = `${amount} · ${formatNumber(entry.kcal)} kcal`;
        button.append(name, meta);

        const item = document.createElement('li');
        item.appendChild(button);
        return item;
      }),
    );
    syncRecentVisibility();
  };

  const refreshRecent = async () => {
    try {
      recentFoods = await api.getRecentFoods();
      renderRecent();
    } catch (err) {
      console.error('Legutóbbiak betöltési hiba:', err);
    }
  };

  recentList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-recent-food]');
    if (!button) return;
    const entry = recentFoods.find((food) => food.name === button.dataset.recentFood);
    if (!entry) return;
    // Dupla koppintás ne naplózzon kétszer
    button.disabled = true;
    try {
      await logFood({ name: entry.name, unit: entry.unit }, entry.grams);
    } catch (err) {
      showToast(err.message || 'Nem sikerült hozzáadni az ételt', 'error');
    } finally {
      button.disabled = false;
    }
  });

  const logFood = async (food, grams) => {
    const previous = totals;
    // A válasz a létrejött bejegyzést IS tartalmazza — így a mai napló
    // listája újabb lekérés nélkül nő eggyel.
    const { entry, totals: next } = await api.addNutritionEntry(food.name, grams);
    applyTotals(next, { animateFrom: previous });
    logEntries = [...logEntries, entry];
    renderLog();
    // Az áttekintő kalória-statja is kövesse a naplózást (közös forrás a szerveren)
    refreshDailyStats().catch(console.error);
    showToast(
      `${food.name} · ${formatNumber(grams)} ${food.unit || 'g'} hozzáadva · +${formatNumber(entry.kcal)} kcal`,
    );
    // Az épp naplózott étel a „Legutóbbiak" elejére kerül
    refreshRecent();
  };

  // A kártya nyila az adagválasztó modált nyitja. Ha az (betöltési hiba
  // miatt) nem áll rendelkezésre, a korábbi viselkedés marad: 100 g naplózása.
  foodList.addEventListener('click', async (event) => {
    const addBtn = event.target.closest('.nu-food-add');
    if (!addBtn) return;

    const food = foodsByName.get(addBtn.dataset.food);
    if (!food) return;

    if (openFoodDetail(food)) return;

    try {
      await logFood(food, 100);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Nem sikerült hozzáadni az ételt', 'error');
    }
  });

  /* Az étel-lista az első megnyitáskor töltődik. Ha az app épp a Táplálkozás
     oldalon nyílt (újratöltés #nutrition-ön), a regisztráció azonnal pótolja. */
  onPageShow('nutrition', startFoods);

  return { logFood, refreshFoods, openFoodDetail };
}

export { setupNutrition };
