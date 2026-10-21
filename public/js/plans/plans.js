/**
 * Podium — a Tervek oldal
 * ------------------------------------------------------------------------
 * A tervlista vezérlője (szerkesztés, törlés, aktiválás, egy nap betöltése
 * az edzésnaplóba), a terv-kártyák kirajzolása és a lista lekérése. A terv
 * szerkesztése a mellette lévő plan-builder.js-é.
 */

import { api } from '../shared/api.js';
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
import { showToast } from '../shared/toast.js';
import { navigate, onPageShow } from '../app/router.js';

/* ======================================================================
   Vezérlő
   ====================================================================== */

/** A Tervek oldal interakciói. A planBuilder és a workout a megfelelő setup
    függvények vezérlői — hiba esetén (safe-ből null) a gombok nem visznek át. */
function setupPlans(planBuilder, workout, confirmAction) {
  // A terv-kártyák progress-e a mai pipált szetteket követi — megnyitáskor frissül
  onPageShow('plans', () =>
    renderPlans().catch((err) => console.error('Tervek frissítési hiba:', err)),
  );

  /** Terv törlése a listából, megerősítéssel. A visszavonhatatlanságot ki is
      mondjuk: az edzőtől kapott tervet újra kérni kell, ha kell. */
  async function deletePlanFromList(id, name, button) {
    const ok = await confirmAction?.(
      `Biztosan törlöd a(z) „${name}" tervet? Ez nem vonható vissza.`,
      { title: 'Terv törlése', confirmLabel: 'Törlöm' },
    );
    if (!ok) return;
    button.disabled = true;
    try {
      await api.deletePlan(id);
    } catch (err) {
      console.error(err);
      button.disabled = false;
      showToast(err.message || 'Nem sikerült törölni a tervet', 'error');
      return;
    }
    /* A törlés sikerült: a kártya helyben kikerül, a gomb nem áll vissza. A
       lista újratöltése külön ág — ha az bukik el, az nem íráshiba. */
    button.closest('.pl-card')?.remove();
    showToast(`„${name}" törölve`);
    renderPlans().catch((err) => {
      console.error(err);
      showToast('A lista frissítése nem sikerült', 'error');
    });
  }

  $('[data-list="plans"]').addEventListener('click', (event) => {
    // Szerkesztés — a saját terv a terv-építőbe töltődik
    const editBtn = event.target.closest('.pl-card-edit');
    if (editBtn) {
      const plan = plansData.find((p) => p.id === Number(editBtn.dataset.planId));
      if (!plan || !planBuilder) return;
      planBuilder.loadPlan(plan);
      navigate('plan-builder');
      return;
    }

    /* Törlés. A terv-lista eddig kizárólag nőni tudott — az edzőtől kapott,
       egyszer elfogadott terv sem volt kiszedhető. */
    const deleteBtn = event.target.closest('.pl-card-delete');
    if (deleteBtn) {
      const id = Number(deleteBtn.dataset.planId);
      const plan = plansData.find((p) => p.id === id);
      deletePlanFromList(id, plan?.name ?? 'A terv', deleteBtn);
      return;
    }

    // Aktiválás — ennek a tervnek a hete töltődik ezentúl az Edzés oldalra
    const activateBtn = event.target.closest('.pl-card-activate');
    if (activateBtn) {
      const plan = plansData[Number(activateBtn.closest('.pl-card').dataset.planIndex)];
      if (plan) activatePlan(plan, activateBtn);
      return;
    }

    const card = event.target.closest('.pl-card');
    const plan = card && plansData[Number(card.dataset.planIndex)];
    if (!plan?.week) return;

    // A heti sáv egy napja — AZ a nap töltődik be (pl. a keddi csütörtökön)
    const dayBtn = event.target.closest('.pl-week-day');
    if (dayBtn) {
      loadDay(plan, Number(dayBtn.dataset.day));
      return;
    }

    // Nyíl — a MAI nap edzése. Pihenőnapon (és a nem aktív, nem heti
    // tervnél, ahol nincs „mai" nap) a sávra irányítunk: onnan bármelyik
    // edzésnap elindítható.
    if (!event.target.closest('.pl-card-open')) return;
    const today = todayIndex(plan);
    if (dayEntry(plan.week, today)) {
      loadDay(plan, today);
      return;
    }
    showToast(
      today === -1
        ? 'Ennek a tervnek nincs mai napja, amíg nem aktív — válaszd ki, melyik nap edzését indítod'
        : 'Ma pihenőnap van ebben a tervben — válaszd ki, melyik nap edzését indítod',
    );
    $('.pl-week-day:not(:disabled)', card)?.focus();
  });

  /** Egy nap edzése az edzésnaplóba. A loadPlan megkérdezi a felhasználót, ha
      ezzel megkezdett edzést írna felül; hamis válasz esetén itt sem
      navigálunk és nem toastolunk. */
  function loadDay(plan, day) {
    const entry = dayEntry(plan.week, day);
    if (!entry || !workout) return;
    const name = dayWorkoutName(plan, day);
    workout
      .loadPlan({ id: plan.id, name, exercises: entry.exercises })
      .then((loaded) => {
        if (!loaded) return;
        showToast(`„${name}” betöltve az edzésnaplóba`);
        navigate('workout');
      })
      .catch((err) => console.error('Terv betöltési hiba:', err));
  }

  async function activatePlan(plan, button) {
    button.disabled = true;
    try {
      await api.setPlanActive(plan.id, true);
      await renderPlans();
      showToast(`„${plan.name}” az aktív terv — ennek a hete töltődik az Edzés oldalra`);
    } catch (err) {
      console.error(err);
      button.disabled = false;
      showToast(err.message || 'Nem sikerült aktiválni a tervet', 'error');
    }
  }

  // Új terv készítése — üres terv-építővel
  $('[data-action="new-plan"]').addEventListener('click', () => {
    planBuilder?.startNew();
    navigate('plan-builder');
  });
}

/* ======================================================================
   Terv-kártyák kirajzolása
   ====================================================================== */

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
    a lista indexe — a lekérés és a lista lent, a renderPlans-é. */
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

/* ======================================================================
   A lista adatai
   ====================================================================== */

/** A legutóbb lekért tervlista — a nyíl- és a szerkesztés gomb ebből veszi
    a terv adatait (a kártyák dataset.planIndex-e ide mutat). */
let plansData = [];

/** Újrahívható: mentés/szerkesztés után és a Tervek oldal megnyitásakor
    frissen húzza le és építi újra a listát (a progress a mai teljesítést
    követi, ezért minden megjelenéskor érdemes újrakérni). */
async function renderPlans() {
  plansData = await api.getPlans();
  renderPlanList(plansData);
}

export { renderPlans, setupPlans };
