/** Terv-kártyák és a Tervek oldal listája. */

import { $, cloneTemplate } from '../shared/dom.js';
import {
  dayEntry,
  dayLetter,
  dayRound,
  dayStatus,
  dayTitle,
  dayWorkoutName,
  todayIndex,
} from '../shared/plan-week.js';

/** A kártya sávja: a terv minden napja egy cella (a nap betűje, a második
    körben „2." jelölés, alatta az állapota). Az edzésnap gomb — azt a napot
    tölti az edzésnaplóba —, a pihenőnap tiltott; a mai nap (todayIndex)
    kiemelt. */
function weekStrip(plan) {
  const today = todayIndex(plan);
  return plan.week.map((_, day) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'pl-week-day';
    cell.dataset.day = day;
    const rest = !dayEntry(plan.week, day);
    cell.disabled = rest;
    cell.classList.toggle('is-rest', rest);
    cell.classList.toggle('is-today', day === today);
    const labelEl = document.createElement('span');
    labelEl.className = 'pl-week-label';
    labelEl.textContent = dayLetter(day);
    if (dayRound(day)) {
      const roundEl = document.createElement('span');
      roundEl.className = 'pl-week-round';
      roundEl.textContent = dayRound(day);
      labelEl.append(roundEl);
    }
    const statusEl = document.createElement('span');
    statusEl.className = 'pl-week-status';
    // A keskeny cellában a pihenő egy vonás, a név nélküli edzésnap egy pötty —
    // a „Pihenő" / „3 gyak." levágva csak zaj volna
    const entry = plan.week[day];
    statusEl.textContent = rest
      ? '–'
      : entry.type === 'workout' && !entry.name
        ? '●'
        : dayStatus(plan.week, day);
    cell.append(labelEl, statusEl);
    cell.setAttribute(
      'aria-label',
      rest
        ? `${dayTitle(day)}: pihenőnap`
        : `${dayTitle(day)}: ${dayWorkoutName(plan, day)} betöltése az edzésnaplóba`,
    );
    return cell;
  });
}

/** Egy terv-kártya ({ name, meta, progress, week, active, own?, id? })
    felépítése a Tervek listájához. A szerkesztés gomb csak a saját
    (terv-építős) terveken látszik. */
function planCardEl(plan) {
  const card = cloneTemplate('tpl-plan');
  $('.pl-card-name', card).textContent = plan.name;
  $('.pl-card-meta', card).textContent = plan.meta;
  $('.pl-week', card).replaceChildren(...weekStrip(plan));

  $('.pl-card-active', card).hidden = !plan.active;
  const activateBtn = $('.pl-card-activate', card);
  activateBtn.hidden = plan.active;
  activateBtn.setAttribute('aria-label', `${plan.name} aktiválása`);
  activateBtn.title = 'Ennek a tervnek a hete töltődjön az Edzés oldalra';

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
  editBtn.hidden = false;
  editBtn.dataset.planId = plan.id;
  editBtn.title = 'Terv szerkesztése';
  editBtn.setAttribute('aria-label', `${plan.name} szerkesztése`);

  const openBtn = $('.pl-card-open', card);
  openBtn.dataset.plan = plan.name;
  openBtn.title = 'A mai nap edzésének betöltése az edzésnaplóba';
  openBtn.setAttribute('aria-label', `${plan.name}: a mai edzés betöltése az edzésnaplóba`);
  return card;
}

/** A Tervek oldal listája a kapott tervekből. A kártyák dataset.planIndex-e
    a lista indexe — a lekérés és a lista a ui/plans-data.js-é. */
function renderPlanList(plans) {
  const list = $('[data-list="plans"]');
  list.replaceChildren();
  plans.forEach((plan, index) => {
    const card = planCardEl(plan);
    card.dataset.planIndex = index;
    list.appendChild(card);
  });
  $('[data-plans-empty]').hidden = plans.length > 0;
}

export { renderPlanList };
