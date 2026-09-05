/** Az étel-katalógus és a napi étel-napló kirajzolása. */

import { api } from '../core/api.js';
import { $, cloneTemplate } from '../core/dom.js';
import { formatNumber } from '../core/format.js';

/** Az étel-lista feltöltése. A `list` opcionális: ha a hívó már lekérte az
    ételeket (setupNutrition), ne kérje le másodszor is — így a lista és a
    naplózás ugyanabból az egy válaszból épül, és nem csúszhatnak el.
    A SAJÁT ételek a szervertől elöl jönnek, és jelvényt + törlés-gombot kapnak. */
async function renderFoods(foodList = null) {
  const foods = foodList ?? await api.getFoods();
  const list = $('[data-list="foods"]');
  list.replaceChildren(); // újrahíváskor se duplázódjon a lista
  foods.forEach((food) => {
    const item = cloneTemplate('tpl-food');
    // A kereső erre szűr, nem a teljes szövegre. A kategória is bele megy:
    // 437 étel közt a „tejtermék” vagy a „hüvelyes” beírása használhatóbb
    // belépő, mint végiggörgetni a listát. A márka a vonalkódról felvitt
    // termékeknél az, amiről a felhasználó felismeri őket.
    item.dataset.foodName = [food.name, food.group, food.brand]
      .filter(Boolean).join(' ').toLowerCase();

    // A kcal-jelvény a név span-jén belül ül, ezért a nevet elé szúrjuk be.
    const nameEl = $('.nu-food-name', item);
    nameEl.insertBefore(document.createTextNode(food.name + ' '), nameEl.firstChild);
    $('.nu-food-kcal', item).textContent = `${food.kcal} kcal`;
    $('.nu-food-macros', item).textContent =
      `${food.per} · ${formatNumber(food.protein)} g F · ${formatNumber(food.carbs)} g Cs · ${formatNumber(food.fat)} g Zs`;

    // A nyíl az adagválasztó modált nyitja — a naplózás onnan indul
    const addBtn = $('.nu-food-add', item);
    addBtn.dataset.food = food.name;
    addBtn.title = 'Adag megadása és hozzáadás';
    addBtn.setAttribute('aria-haspopup', 'dialog');
    addBtn.setAttribute('aria-label', `${food.name} — adag megadása és hozzáadás a naplóhoz`);

    // Saját étel: jelvény + törlés. A beépített katalógus elemei nem
    // törölhetők, azok minden fióknak közösek.
    if (food.custom) {
      item.classList.add('nu-food--custom');
      $('.nu-food-badge', item).hidden = false;
      const removeBtn = $('.nu-food-remove', item);
      removeBtn.hidden = false;
      removeBtn.dataset.customFoodId = food.id;
      removeBtn.title = 'Saját étel törlése';
      removeBtn.setAttribute('aria-label', `${food.name} törlése a saját ételek közül`);
    }

    list.appendChild(item);
  });
}

export { renderFoods };
