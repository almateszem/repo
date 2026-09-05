/** Terv-kártyák és a Tervek oldal listája. */

import { api } from '../core/api.js';
import { $, cloneTemplate } from '../core/dom.js';

/** Egy terv-kártya ({ name, meta, progress, own?, id? }) felépítése a Tervek
    listájához. A szerkesztés gomb csak a saját (terv-építős) terveken látszik. */
function planCardEl(plan) {
  const card = cloneTemplate('tpl-plan');
  $('.pl-card-name', card).textContent = plan.name;
  $('.pl-card-meta', card).textContent = plan.meta;

  /* A mai készenlét figyelmeztetése. A terv NEM íródik át tőle — az
     elrejtené az edző elől, mi történt —, csak megjelöljük, mi kockázatos. */
  const safety = $('.pl-card-safety', card);
  const blocked = plan.safety?.blocked ?? [];
  const caution = plan.safety?.caution ?? [];
  safety.hidden = blocked.length === 0 && caution.length === 0;
  if (!safety.hidden) {
    const parts = [];
    if (blocked.length) {
      parts.push(`Ma kerüld: ${blocked.map((e) => `${e.name} (${e.reason})`).join('; ')}`);
    }
    if (caution.length) parts.push(`Óvatosan: ${caution.map((e) => e.name).join(', ')}`);
    safety.textContent = parts.join(' · ');
    safety.classList.toggle('is-blocked', blocked.length > 0);
  }

  const progress = $('.pl-progress', card);
  progress.setAttribute('aria-valuenow', String(plan.progress));
  progress.setAttribute('aria-label', `${plan.name} — ${plan.progress}% teljesítve`);
  $('.pl-progress-fill', card).style.width = plan.progress + '%';

  const deleteBtn = $('.pl-card-delete', card);
  deleteBtn.dataset.planId = plan.id;
  deleteBtn.setAttribute('aria-label', `${plan.name} törlése`);

  const editBtn = $('.pl-card-edit', card);
  if (plan.own) {
    editBtn.hidden = false;
    editBtn.dataset.planId = plan.id;
    editBtn.title = 'Terv szerkesztése';
    editBtn.setAttribute('aria-label', `${plan.name} szerkesztése`);
  }

  const openBtn = $('.pl-card-open', card);
  openBtn.dataset.plan = plan.name;
  openBtn.title = 'Terv betöltése az edzésnaplóba';
  openBtn.setAttribute('aria-label', `${plan.name} betöltése az edzésnaplóba`);
  return card;
}

/** A legutóbb lekért tervlista — a nyíl- és a szerkesztés gomb ebből veszi
    a terv adatait (a kártyák dataset.planIndex-e ide mutat). */
let plansData = [];

/** Újrahívható: mentés/szerkesztés után és a Tervek oldal megnyitásakor
    frissen húzza le és építi újra a listát (a progress a mai teljesítést
    követi, ezért minden megjelenéskor érdemes újrakérni). */
async function renderPlans() {
  plansData = await api.getPlans();
  const list = $('[data-list="plans"]');
  list.replaceChildren();
  plansData.forEach((plan, index) => {
    const card = planCardEl(plan);
    card.dataset.planIndex = index;
    list.appendChild(card);
  });
  $('[data-plans-empty]').hidden = plansData.length > 0;
}

export { plansData, renderPlans };
