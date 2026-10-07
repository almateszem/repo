/** Tervkészítő: a hét napjai (edzés / pihenő), gyakorlatok, mentés. */

import { api } from '../core/api.js';
import { DAY_LABELS, DAY_NAMES } from '../core/constants.js';
import { $, $$ } from '../core/dom.js';
import { copyExercises, inlineSameDays } from '../core/plan-sources.js';
import { dayTitle } from '../core/plan-week.js';
import { showToast } from '../core/toast.js';
import { navigate } from '../nav/router.js';
import { renderPlans } from '../render/plans.js';
import {
  clampRpeInput,
  enableExtraMenu,
  enableIntensitySelect,
  enableSetTypeSelect,
  handleAddSetClick,
  handleRemoveSetClick,
  handleStepClick,
  readSetRow,
  renderExercise,
} from '../render/sets.js';

/** Üres hét egy új tervhez: hétfőn edzés, a többi pihenő. */
const freshDays = () =>
  DAY_LABELS.map((_, day) => ({ type: day === 0 ? 'workout' : 'rest', name: '' }));

/** A terv-építő flow-oldal (a Tervek „+ Új terv" és szerkesztés gombja hozza
    be). A terv EGY HÉT: a napfülek alatt a kijelölt nap panelje — edzés
    (saját név + gyakorlatkártyák) vagy pihenő. Egy edzésnapba a „Meglévő
    edzés betöltése" a terv másik napjának vagy egy naplózott edzésnek a
    MÁSOLATÁT tölti. Minden napnak saját listája van a DOM-ban (csak a kijelölt
    látszik), így a fülváltás nem veszít adatot. A „+ Gyakorlat hozzáadása" a
    közös választóra visz, a kijelölt nap listáját célozva. A Mentés új tervet
    hoz létre vagy a szerkesztettet írja felül, majd frissíti a Tervek listáját.
    Vezérlőt ad vissza: { startNew, loadPlan }. */
async function setupPlanBuilder(picker, workoutPicker) {
  const page = $('[data-page="plan-builder"]');
  const nameInput = $('#plan-name');
  const nameError = $('#plan-name-error');
  const summaryLine = $('[data-pb-summary]');
  const daysWrap = $('[data-list="builder-days"]', page);
  const listsWrap = $('[data-pb-lists]', page);
  const dayTitleEl = $('[data-pb-day-title]', page);
  const modeBtns = $$('[data-pb-mode]', page);
  const restNote = $('[data-pb-rest]', page);
  const workoutWrap = $('[data-pb-workout]', page);
  const dayNameInput = $('[data-pb-day-name]', page);
  const defaultSet = await api.getDefaultSet();

  // A szerkesztett terv id-ja — null, amíg új terv készül
  let editingId = null;
  // A kijelölt nap (0 = hétfő) és a napok beállítása: { type, name }. A
  // gyakorlatok nem itt, hanem a napok listáiban (DOM) élnek.
  let activeDay = 0;
  let days = freshDays();

  // Naponként egy gyakorlat-lista
  const lists = DAY_LABELS.map((_, day) => {
    const list = document.createElement('div');
    list.className = 'wk-list';
    list.dataset.day = day;
    list.hidden = true;
    listsWrap.appendChild(list);
    return list;
  });

  // Napfülek: a nap betűje, alatta az állapota (név / pihenő / gyakorlatszám)
  const chips = DAY_LABELS.map((label, day) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'pb-day';
    chip.setAttribute('role', 'tab');
    chip.dataset.day = day;
    const labelEl = document.createElement('span');
    labelEl.className = 'pb-day-label';
    labelEl.textContent = label;
    const statusEl = document.createElement('span');
    statusEl.className = 'pb-day-status';
    chip.append(labelEl, statusEl);
    chip.addEventListener('click', () => selectDay(day));
    daysWrap.appendChild(chip);
    return chip;
  });

  /** Egy lista gyakorlatai (a napló-olvasóval azonos alak). A tervben a
      szettek mindig teljesítetlenek — a „kész" jelölés az edzésnaplóé. */
  const readExercises = (list) =>
    $$('.wk-exercise', list).map((card) => ({
      name: $('.wk-exercise-name', card).textContent.trim(),
      pr: false,
      // A naplózási mód a tervben is a gyakorlaté marad (ld. readCurrentWorkout).
      ...(card.dataset.logMode === 'duration' && { logMode: 'duration' }),
      sets: $$('.wk-set-list .wk-set-row', card).map((row) => ({
        ...readSetRow(row),
        done: false,
      })),
    }));

  /** A készülő hét a szerver alakjában (server/plan-week.js). */
  const readWeek = () =>
    days.map((day, index) =>
      day.type === 'workout'
        ? { type: 'workout', name: day.name.trim(), exercises: readExercises(lists[index]) }
        : { type: 'rest' },
    );

  const exerciseCount = (day) => $$('.wk-exercise', lists[day]).length;

  /** A nap edzésének neve: a saját neve, vagy „Tervnév – Hétfő". */
  const dayWorkoutTitle = (day) =>
    days[day].name.trim() || `${nameInput.value.trim() || 'Terv'} – ${dayTitle(day)}`;

  /** A nap rövid állapota a fülön. */
  const statusOf = (day) => {
    const entry = days[day];
    if (entry.type === 'rest') return 'Pihenő';
    const count = exerciseCount(day);
    return entry.name.trim() || (count ? `${count} gyak.` : 'Üres');
  };

  /** Élő összegző: „3 edzésnap · 4 pihenő · 12 gyakorlat". */
  const updateSummary = () => {
    const training = days.filter((day) => day.type !== 'rest').length;
    const exercises = days.reduce(
      (sum, day, index) => sum + (day.type === 'workout' ? exerciseCount(index) : 0),
      0,
    );
    summaryLine.textContent =
      exercises === 0
        ? 'Még nincs gyakorlat — válassz egy napot, és adj hozzá a lenti gombbal.'
        : `${training} edzésnap · ${7 - training} pihenő · ${exercises} gyakorlat`;
    chips.forEach((chip, day) => {
      $('.pb-day-status', chip).textContent = statusOf(day);
      chip.classList.toggle('is-rest', days[day].type === 'rest');
    });
  };

  /** A kijelölt nap panelje a `days` szerint. */
  const renderPanel = () => {
    const entry = days[activeDay];
    chips.forEach((chip, day) => chip.setAttribute('aria-selected', String(day === activeDay)));
    dayTitleEl.textContent = dayTitle(activeDay);
    modeBtns.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.pbMode === entry.type));
    });

    workoutWrap.hidden = entry.type !== 'workout';
    restNote.hidden = entry.type !== 'rest';
    lists.forEach((list, day) => {
      list.hidden = day !== activeDay || entry.type !== 'workout';
    });

    dayNameInput.value = entry.name;
    dayNameInput.placeholder = `${nameInput.value.trim() || 'Terv'} – ${dayTitle(activeDay)}`;
    updateSummary();
  };

  const selectDay = (day) => {
    activeDay = day;
    renderPanel();
  };

  /** A kijelölt nap típusának váltása. A pihenőre állított nap gyakorlatai
      rejtve megmaradnak — visszaváltáskor ott vannak; mentéskor nem mennek fel. */
  const setMode = (type) => {
    if (days[activeDay].type === type) return;
    days[activeDay] = { type, name: days[activeDay].name };
    renderPanel();
  };

  modeBtns.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.pbMode)));
  dayNameInput.addEventListener('input', () => {
    days[activeDay].name = dayNameInput.value;
    updateSummary();
  });

  // Szett-értékek léptetése, hozzáadás/törlés (delegálva, minden nap listájára)
  listsWrap.addEventListener('click', (event) => {
    if (handleStepClick(event)) return;
    if (handleAddSetClick(event, defaultSet, updateSummary)) return;
    handleRemoveSetClick(event, updateSummary);
  });

  // A tervbe írt RPE ugyanarra az 1–10 skálára szorul, mint a naplóban
  listsWrap.addEventListener('change', (event) => {
    clampRpeInput(event.target);
  });

  // Szett-típus a tervben is: így a terv már megmondja, melyik sor
  // bemelegítés és melyik munkasorozat.
  enableSetTypeSelect(listsWrap, updateSummary);

  // Az időalapú sorok vezérlői a tervben is működnek: egy terv is tartalmazhat
  // futópadot, és ott is időt meg intenzitást kell tudni megadni.
  enableIntensitySelect(listsWrap, updateSummary);
  enableExtraMenu(listsWrap);

  // A közös gyakorlat-választó a KIJELÖLT nap listáját célozza
  $('[data-action="builder-add-exercise"]').addEventListener('click', () => {
    picker?.use({
      targetList: lists[activeDay],
      // A választó csak a `.value`-t olvassa (fejléc + ajánlások): a nap
      // edzésének neve, hogy a „Láb nap" láb-gyakorlatokat ajánljon
      nameInput: {
        get value() {
          return dayWorkoutTitle(activeDay);
        },
      },
      backPage: 'plan-builder',
      backLabel: 'Vissza a terv-építőhöz',
      subtitleNoun: 'edzéshez',
      toastTarget: `a ${DAY_NAMES[activeDay]}i edzéshez`,
      exerciseOptions: { withAddSet: true },
      onChange: updateSummary,
    });
    navigate('exercise-picker');
  });

  // „Meglévő edzés betöltése": a terv másik edzésnapjai helyben, a napló a
  // választóban töltődik. A kijelölt napot a hívás pillanatában rögzítjük.
  $('[data-action="builder-load-workout"]').addEventListener('click', () => {
    const day = activeDay;
    workoutPicker?.open({
      subtitle: `${dayTitle(day)} · ${dayWorkoutTitle(day)}`,
      dayTitle: dayTitle(day),
      planSources: days.flatMap((entry, index) =>
        entry.type === 'workout' && index !== day && exerciseCount(index)
          ? [
              {
                name: dayWorkoutTitle(index),
                tag: dayTitle(index),
                adoptName: entry.name.trim(),
                exercises: readExercises(lists[index]),
              },
            ]
          : [],
      ),
      currentCount: () => exerciseCount(day),
      onPick: (source) => {
        lists[day].replaceChildren(
          ...copyExercises(source.exercises).map((exercise) =>
            renderExercise(exercise, { withAddSet: true }),
          ),
        );
        if (!days[day].name.trim()) days[day].name = source.adoptName;
        selectDay(day);
        showToast(`„${source.name}” betöltve — ${dayTitle(day)}`);
      },
    });
  });
  $('[data-action="builder-back"]').addEventListener('click', () => navigate('plans'));

  nameInput.addEventListener('input', () => {
    nameInput.classList.remove('has-error');
    nameError.hidden = true;
    dayNameInput.placeholder = `${nameInput.value.trim() || 'Terv'} – ${dayTitle(activeDay)}`;
  });

  /** A builder feltöltése egy héttel (üres héttel új tervhez). A régi tervek
      „same" napjai itt másolattá válnak (inlineSameDays). */
  const fill = (name, week) => {
    nameInput.value = name;
    nameInput.classList.remove('has-error');
    nameError.hidden = true;
    lists.forEach((list) => list.replaceChildren());
    days = inlineSameDays(week).map((entry, day) => {
      if (entry.type !== 'workout') return { type: 'rest', name: '' };
      entry.exercises.forEach((exercise) => {
        lists[day].appendChild(renderExercise(exercise, { withAddSet: true }));
      });
      return { type: 'workout', name: entry.name };
    });
    const firstWorkout = days.findIndex((day) => day.type === 'workout');
    selectDay(Math.max(0, firstWorkout));
  };

  /** Üres builder egy új tervhez. */
  const startNew = () => {
    editingId = null;
    fill('Új terv', freshDays());
  };

  /** Meglévő terv betöltése szerkesztésre (a Tervek szerkesztés gombja hívja). */
  const loadPlan = (plan) => {
    editingId = plan.id;
    fill(plan.name, plan.week);
  };

  startNew();

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
    if (!days.some((day) => day.type === 'workout')) {
      showToast('A tervben legalább egy edzésnapnak kell lennie', 'error');
      return;
    }
    const empty = days.findIndex((day, index) => day.type === 'workout' && !exerciseCount(index));
    if (empty !== -1) {
      selectDay(empty);
      showToast(`${dayTitle(empty)}: adj hozzá gyakorlatot, vagy állítsd pihenőre`, 'error');
      return;
    }

    saveBtn.disabled = true;
    try {
      const week = readWeek();
      if (editingId) await api.updatePlan(editingId, name, week);
      else await api.savePlan(name, week);
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
