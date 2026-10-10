/** Az étel-lista egy sora — a lapozott lista (js/core/paged-list.js) ebből
    rajzolja a szerverről érkező lapokat. */

import { $, cloneTemplate } from '../core/dom.js';
import { formatNumber } from '../core/format.js';

/** A SAJÁT ételek a szervertől elöl jönnek, és jelvényt + törlés-gombot
    kapnak. */
function renderFoodItem(food) {
  const item = cloneTemplate('tpl-food');

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

  return item;
}

export { renderFoodItem };
