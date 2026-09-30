/** Tervek oldal interakciói. */

import { api } from '../core/api.js';
import { $ } from '../core/dom.js';
import { dayEntry, dayWorkoutName, todayWeekday } from '../core/plan-week.js';
import { showToast } from '../core/toast.js';
import { navigate } from '../nav/router.js';
import { plansData, renderPlans } from '../render/plans.js';

/** A Tervek oldal interakciói. A planBuilder és a workout a megfelelő setup
    függvények vezérlői — hiba esetén (safe-ből null) a gombok nem visznek át. */
function setupPlans(planBuilder, workout, confirmAction) {
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
      await renderPlans();
      showToast(`„${name}" törölve`);
    } catch (err) {
      console.error(err);
      button.disabled = false;
      showToast(err.message || 'Nem sikerült törölni a tervet', 'error');
    }
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

    // Nyíl — a MAI nap edzése. Pihenőnapon a heti sávra irányítunk: onnan
    // bármelyik edzésnap elindítható.
    if (!event.target.closest('.pl-card-open')) return;
    const today = todayWeekday();
    if (dayEntry(plan.week, today)) {
      loadDay(plan, today);
      return;
    }
    showToast('Ma pihenőnap van ebben a tervben — válaszd ki, melyik nap edzését indítod');
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

export { setupPlans };
