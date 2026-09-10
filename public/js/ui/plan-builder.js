/** Tervkészítő: napok, gyakorlatok, mentés. */

import { api } from '../core/api.js';
import { DAY_LABELS, DAY_NAMES } from '../core/constants.js';
import { $, $$ } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { navigate } from '../nav/router.js';
import { renderPlans } from '../render/plans.js';
import { clampRpeInput, enableSetTypeSelect, handleAddSetClick, handleRemoveSetClick, handleStepClick, readSetRow, renderExercise } from '../render/sets.js';

/** A terv-építő flow-oldal (a Tervek „+ Új terv" és szerkesztés gombja hozza
    be): terv neve + élő összegző, hétnap-ütemezés chipek, gyakorlatkártyák
    „+ Szett" gombbal, a „+ Gyakorlat hozzáadása" a közös választóra visz
    (a terv-építő listáját célozva). A Mentés új tervet hoz létre vagy a
    szerkesztettet írja felül, majd frissíti a Tervek listáját.
    Vezérlőt ad vissza: { startNew, loadPlan }. */
async function setupPlanBuilder(picker) {
  const page = $('[data-page="plan-builder"]');
  const nameInput = $('#plan-name');
  const nameError = $('#plan-name-error');
  const summaryLine = $('[data-pb-summary]');
  const list = $('[data-list="builder-exercises"]', page);
  const defaultSet = await api.getDefaultSet();

  // A szerkesztett terv id-ja — null, amíg új terv készül
  let editingId = null;

  // Hétnap-chipek (0 = hétfő) — a kijelölt napokon a terv az Edzés oldalra töltődik
  const daysWrap = $('[data-list="builder-days"]', page);
  DAY_LABELS.forEach((label, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pb-day';
    chip.textContent = label;
    chip.dataset.day = index;
    chip.setAttribute('aria-pressed', 'false');
    chip.setAttribute('aria-label', DAY_NAMES[index]);
    chip.addEventListener('click', () => {
      chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
    });
    daysWrap.appendChild(chip);
  });
  const readDays = () => $$('.pb-day', daysWrap)
    .filter((chip) => chip.getAttribute('aria-pressed') === 'true')
    .map((chip) => Number(chip.dataset.day));
  const setDays = (days) => $$('.pb-day', daysWrap).forEach((chip) => {
    chip.setAttribute('aria-pressed', String(days.includes(Number(chip.dataset.day))));
  });

  /** A készülő terv a DOM-ból (a napló-olvasóval azonos alak). A tervben a
      szettek mindig teljesítetlenek — a „kész" jelölés az edzésnaplóé. */
  const readPlan = () => $$('.wk-exercise', page).map((card) => ({
    name: $('.wk-exercise-name', card).textContent.trim(),
    pr: false,
    sets: $$('.wk-set-list .wk-set-row', card)
      .map((row) => ({ ...readSetRow(row), done: false })),
  }));

  /** Élő összegző: „3 gyakorlat · 8 szett · ~64 perc" (szettenként ~8 perc). */
  const updateSummary = () => {
    const exercises = readPlan();
    const totalSets = exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
    const minutes = Math.max(10, totalSets * 8);
    summaryLine.textContent = exercises.length === 0
      ? 'Még nincs gyakorlat — adj hozzá a lenti gombbal.'
      : `${exercises.length} gyakorlat · ${totalSets} szett · ~${minutes} perc`;
  };
  updateSummary();

  // Szett-értékek léptetése, hozzáadás/törlés (delegálva, az újakra is érvényes)
  list.addEventListener('click', (event) => {
    if (handleStepClick(event)) return;
    if (handleAddSetClick(event, defaultSet, updateSummary)) return;
    handleRemoveSetClick(event, updateSummary);
  });

  // A tervbe írt RPE ugyanarra az 1–10 skálára szorul, mint a naplóban
  list.addEventListener('change', (event) => { clampRpeInput(event.target); });

  // Szett-típus a tervben is: így a terv már megmondja, melyik sor
  // bemelegítés és melyik munkasorozat.
  enableSetTypeSelect(list, updateSummary);

  // A közös gyakorlat-választó a terv-építő listáját célozza
  $('[data-action="builder-add-exercise"]').addEventListener('click', () => {
    picker?.use({
      targetList: list,
      nameInput,
      backPage: 'plan-builder',
      backLabel: 'Vissza a terv-építőhöz',
      subtitleNoun: 'tervhez',
      toastTarget: 'a tervhez',
      exerciseOptions: { withAddSet: true },
      onChange: updateSummary,
    });
    navigate('exercise-picker');
  });
  $('[data-action="builder-back"]').addEventListener('click', () => navigate('plans'));

  nameInput.addEventListener('input', () => {
    nameInput.classList.remove('has-error');
    nameError.hidden = true;
  });

  /** Üres builder egy új tervhez. */
  const startNew = () => {
    editingId = null;
    nameInput.value = 'Új terv';
    nameInput.classList.remove('has-error');
    nameError.hidden = true;
    setDays([]);
    list.replaceChildren();
    updateSummary();
  };

  /** Meglévő terv betöltése szerkesztésre (a Tervek szerkesztés gombja hívja). */
  const loadPlan = (plan) => {
    editingId = plan.id;
    nameInput.value = plan.name;
    nameInput.classList.remove('has-error');
    nameError.hidden = true;
    setDays(plan.days || []);
    list.replaceChildren();
    plan.exercises.forEach((exercise) => {
      list.appendChild(renderExercise(exercise, { withAddSet: true }));
    });
    updateSummary();
  };

  // Mentés — validáció után új terv jön létre, vagy a szerkesztett íródik
  // felül; a Tervek listája frissül, és a Tervek oldal jön vissza
  const saveBtn = $('[data-action="save-plan"]');
  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add('has-error');
      nameError.hidden = false;
      nameInput.focus();
      showToast('Adj nevet a tervnek', 'error');
      return;
    }
    const exercises = readPlan();
    if (exercises.length === 0) {
      showToast('Adj legalább egy gyakorlatot a tervhez', 'error');
      return;
    }

    saveBtn.disabled = true;
    try {
      const days = readDays();
      if (editingId) await api.updatePlan(editingId, name, exercises, days);
      else await api.savePlan(name, exercises, days);
      await renderPlans(); // friss lista a szerverről (saját tervek elöl)

      showToast(editingId ? 'Terv frissítve' : 'Terv elmentve');
      startNew();
      navigate('plans');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Nem sikerült menteni a tervet', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  return { startNew, loadPlan };
}

export { setupPlanBuilder };
