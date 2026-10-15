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
  /* Egy sorba férjen telefonon is: a mértékegység egyszer áll elöl (az adag),
     a makrók betű + szám alakban. A korábbi „23 g F · 0 g Cs · 1,8 g Zs"
     360px-en két sorba tört, és minden ételsor háromsoros lett. */
  $('.nu-food-macros', item).textContent =
    `${food.per} · F ${formatNumber(food.protein)} · Cs ${formatNumber(food.carbs)} · Zs ${formatNumber(food.fat)}`;

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
