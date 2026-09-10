/** Tervek oldal interakciói. */

import { api } from '../core/api.js';
import { $ } from '../core/dom.js';
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

    // Nyíl — a terv (név + gyakorlatok) betöltődik az edzésnaplóba.
    // A loadPlan megkérdezi a felhasználót, ha ezzel megkezdett edzést írna
    // felül; hamis válasz esetén itt sem navigálunk és nem toastolunk.
    const openBtn = event.target.closest('.pl-card-open');
    if (!openBtn) return;
    const plan = plansData[Number(openBtn.closest('.pl-card').dataset.planIndex)];
    if (!plan?.exercises || !workout) return;
    workout.loadPlan(plan).then((loaded) => {
      if (!loaded) return;
      showToast(`„${plan.name}” betöltve az edzésnaplóba`);
      navigate('workout');
    }).catch((err) => console.error('Terv betöltési hiba:', err));
  });

  // Új terv készítése — üres terv-építővel
  $('[data-action="new-plan"]').addEventListener('click', () => {
    planBuilder?.startNew();
    navigate('plan-builder');
  });
}

export { setupPlans };
