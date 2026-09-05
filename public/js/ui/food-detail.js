/** Étel-részletek: adagválasztó görgő és a naplózás. */

import { $, $$, cloneTemplate, prefersReducedMotion } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { showToast } from '../core/toast.js';
import { createModalController } from './modals.js';

/* ---- Étel részlet-modál (adagválasztás) ----
   A táplálkozási napló korábban fix 100 g-os adagot rögzített, holott a
   tápértékek is 100 g-ra vonatkoznak: aki 180 g csirkemellet evett, nem
   tudta rendesen naplózni. Az étel-kártya nyila ezért ezt a modált nyitja,
   ahol a görgethető választóval (vagy a gyorsgombokkal) állítható az adag. */
const PORTION_MIN = 5;

const PORTION_MAX = 1000;

const PORTION_STEP = 5;     // 5 g-os rács — ennél finomabb bontás konyhamérleg nélkül nem valós

const PORTION_DEFAULT = 100;

const PORTION_QUICK = [30, 50, 100, 150, 200, 300];

const PICKER_ITEM_H = 24;   // px — a .fd-picker-option magassága (style.css: --fd-item-h)

/** A gramm-választó lehetséges értékei (a rácson). */
const PORTION_VALUES = (() => {
  const values = [];
  for (let g = PORTION_MIN; g <= PORTION_MAX; g += PORTION_STEP) values.push(g);
  return values;
})();

const portionIndex = (grams) => (grams - PORTION_MIN) / PORTION_STEP;

const snapPortion = (grams) => {
  const snapped = Math.round(grams / PORTION_STEP) * PORTION_STEP;
  return Math.min(PORTION_MAX, Math.max(PORTION_MIN, snapped));
};

/** Az étel domináns makrója — a fejléc címkéjéhez (100 g-os alapértékekből). */
function foodTag(food) {
  if (food.protein >= 15) return 'Fehérjeforrás';
  if (food.carbs >= 20) return 'Szénhidrátforrás';
  if (food.fat >= 15) return 'Zsírforrás';
  return null;
}

/**
 * Az étel részlet-modál vezérlője.
 * @param {(food: object, grams: number) => Promise<void>} onAdd
 *   A naplózást végző hívó. Sikerre a modál bezárul; hibát dobva nyitva
 *   marad (a beállított adag nem vész el), és a hiba toastként jelenik meg.
 */
function setupFoodDetail({ onAdd }) {
  const modal = $('#foodModal');
  const controller = createModalController(modal);
  const picker = $('[data-fd-picker]', modal);
  const chipBox = $('[data-fd-chips]', modal);
  const todaySection = $('[data-fd-today]', modal);
  const todayList = $('[data-fd-today-list]', modal);
  const addButtons = $$('[data-fd-add]', modal);

  let food = null;
  let context = { totals: null, entries: [] };
  let grams = PORTION_DEFAULT;
  let busy = false;

  /* A választó elemei egyszer épülnek fel — az értékkészlet ételtől független.
     A képernyőolvasó a spinbutton aria-valuenow/valuetext-jéből olvassa az
     adagot, a számoszlop maga csak vizuális. */
  picker.append(...PORTION_VALUES.map((value) => {
    const option = document.createElement('div');
    option.className = 'fd-picker-option';
    option.textContent = value;
    option.setAttribute('aria-hidden', 'true');
    return option;
  }));
  picker.setAttribute('aria-valuemin', PORTION_MIN);
  picker.setAttribute('aria-valuemax', PORTION_MAX);

  /* A gyors-adag chipek ÉTELENKÉNT épülnek újra. Az étel-katalógus reális
     adagokat is tárol (`portions`: [['1 filé', 150], …]) — egy tojásnál a
     „1 db · 55 g” sokkal használhatóbb gomb, mint a általános 30/50/100.
     Ahol nincs megadva adag, marad a fix grammos sor. Az egység az ételtől
     függ: az italoknál ml, hogy ne „500 g kóla” legyen. */
  const renderChips = (current) => {
    const unit = current?.unit || 'g';
    const presets = current?.portions?.length
      ? current.portions.map(([label, value]) => [`${label} · ${value} ${unit}`, value])
      : PORTION_QUICK.map((value) => [`${value} ${unit}`, value]);

    chipBox.replaceChildren(...presets.map(([label, value]) => {
      const chip = document.createElement('button');
      chip.className = 'fd-chip';
      chip.type = 'button';
      chip.textContent = label;
      chip.dataset.grams = value;
      chip.setAttribute('aria-pressed', 'false');
      return chip;
    }));
  };
  renderChips(null);

  /** A modál teljes tartalmának újraszámolása a kiválasztott adagra. */
  const render = () => {
    if (!food) return;
    const factor = grams / 100;
    const addKcal = Math.round(food.kcal * factor);
    const addProtein = Math.round(food.protein * factor * 10) / 10;

    $('[data-fd-protein]', modal).textContent = formatNumber(food.protein * factor);
    $('[data-fd-carbs]', modal).textContent = formatNumber(food.carbs * factor);
    $('[data-fd-kcal]', modal).textContent = String(addKcal);
    $('[data-fd-portion]', modal).textContent = String(grams);
    $('[data-fd-unit]', modal).textContent = food.unit || 'g';

    // Napi cél: a sáv azt mutatja, hol tartana a bevitel EZZEL az adaggal
    const totals = context.totals;
    const goals = [
      { key: 'kcal', now: totals ? totals.intake + addKcal : 0, max: totals?.goal?.calories ?? 0, unit: 'kcal' },
      { key: 'protein', now: totals ? totals.protein + addProtein : 0, max: totals?.goal?.protein ?? 0, unit: 'g' },
    ];
    goals.forEach(({ key, now, max, unit }) => {
      const bar = $(`[data-fd-${key}-bar]`, modal);
      const percent = max > 0 ? Math.round((now / max) * 100) : 0;
      bar.classList.toggle('is-over', percent > 100);
      bar.setAttribute('aria-valuenow', Math.min(100, percent));
      bar.setAttribute('aria-valuetext', `${formatNumber(now)} / ${formatNumber(max)} ${unit}`);
      $('.fd-goal-fill', bar).style.width = `${Math.min(100, percent)}%`;
      $(`[data-fd-${key}-goal]`, modal).textContent =
        `${formatNumber(now)} / ${formatNumber(max)} ${unit}`;
    });

    $('[data-fd-delta]', modal).textContent =
      `+${addKcal} kcal · +${formatNumber(addProtein)} g fehérje ezzel az adaggal`;

    $$('.fd-chip', chipBox).forEach((chip) => {
      chip.setAttribute('aria-pressed', String(Number(chip.dataset.grams) === grams));
    });

    const index = portionIndex(grams);
    const unitWord = food.unit === 'ml' ? 'milliliter' : 'gramm';
    picker.setAttribute('aria-valuenow', grams);
    picker.setAttribute('aria-valuetext', `${grams} ${unitWord}`);
    Array.from(picker.children).forEach((option, i) => {
      option.classList.toggle('is-selected', i === index);
    });
  };

  const scrollToGrams = (value) => {
    const top = portionIndex(value) * PICKER_ITEM_H;
    if (Math.abs(picker.scrollTop - top) < 1) return;
    picker.scrollTo({ top, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  };

  /** Adag beállítása. A `scroll: false` a görgetésből érkező változásé —
      ott a tekerő már a helyén van, a visszaírás megakasztaná a mozgást. */
  const setGrams = (next, { scroll = true } = {}) => {
    const snapped = snapPortion(next);
    if (snapped !== grams) {
      grams = snapped;
      render();
    }
    if (scroll) scrollToGrams(snapped);
  };

  // A görgetésből érkező érték: a középső keretbe eső elem. A számítás
  // rAF-be van halasztva, hogy a görgetés ne fusson szám-formázásba.
  let scrollFrame = null;
  picker.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      const index = Math.min(
        PORTION_VALUES.length - 1,
        Math.max(0, Math.round(picker.scrollTop / PICKER_ITEM_H)),
      );
      setGrams(PORTION_VALUES[index], { scroll: false });
    });
  });

  // Billentyűzet: a spinbutton-tól elvárt lépések (a görgetés egérrel/ujjal megy)
  picker.addEventListener('keydown', (event) => {
    const steps = {
      ArrowUp: PORTION_STEP, ArrowRight: PORTION_STEP,
      ArrowDown: -PORTION_STEP, ArrowLeft: -PORTION_STEP,
      PageUp: PORTION_STEP * 10, PageDown: -PORTION_STEP * 10,
    };
    if (event.key in steps) {
      event.preventDefault();
      setGrams(grams + steps[event.key]);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setGrams(PORTION_MIN);
    } else if (event.key === 'End') {
      event.preventDefault();
      setGrams(PORTION_MAX);
    }
  });

  chipBox.addEventListener('click', (event) => {
    const chip = event.target.closest('.fd-chip');
    if (chip) setGrams(Number(chip.dataset.grams));
  });

  const submit = async () => {
    if (busy || !food) return;
    busy = true;
    addButtons.forEach((button) => { button.disabled = true; });
    try {
      await onAdd(food, grams);
      controller.close();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Nem sikerült hozzáadni az ételt', 'error');
    } finally {
      busy = false;
      addButtons.forEach((button) => { button.disabled = false; });
    }
  };
  addButtons.forEach((button) => button.addEventListener('click', submit));

  return {
    /**
     * @param {object} nextFood  a kiválasztott étel (100 g-ra vett makrókkal)
     * @param {object} nextContext { totals, entries } — a napi összesítő és
     *        a MAI, ebből az ételből származó naplóbejegyzések
     */
    open(nextFood, nextContext = {}) {
      food = nextFood;
      context = { totals: nextContext.totals ?? null, entries: nextContext.entries ?? [] };
      // Kezdő adag: az étel első reális adagja, ha van ilyen (egy tojásnál
      // az 55 g életszerűbb kiindulás, mint a fix 100 g).
      grams = snapPortion(food.portions?.[0]?.[1] ?? PORTION_DEFAULT);
      renderChips(food);

      $('[data-fd-name]', modal).textContent = food.name;
      $('[data-fd-glyph]', modal).textContent = food.name.trim().charAt(0).toUpperCase();
      const tagEl = $('[data-fd-tag]', modal);
      const tag = foodTag(food);
      tagEl.textContent = tag ?? '';
      tagEl.hidden = tag === null;

      todayList.replaceChildren();
      context.entries.forEach((entry, index) => {
        const item = cloneTemplate('tpl-fd-today-item');
        $('.fd-today-meta', item).textContent = `${index + 1}. adag`;
        $('.fd-today-value', item).textContent =
          `${formatNumber(entry.grams)} g · ${formatNumber(entry.kcal)} kcal`;
        todayList.appendChild(item);
      });
      todaySection.hidden = context.entries.length === 0;
      $('[data-fd-today-total]', modal).textContent = [
        `${formatNumber(context.entries.reduce((sum, e) => sum + e.grams, 0))} g`,
        `${formatNumber(context.entries.reduce((sum, e) => sum + e.kcal, 0))} kcal`,
      ].join(' · ');

      render();
      controller.open();
      // A tekerőt csak a megnyitás UTÁN lehet pozicionálni: rejtett elemnek
      // nincs görgethető magassága, a scrollTop írása némán elveszne.
      picker.scrollTop = portionIndex(grams) * PICKER_ITEM_H;
    },
  };
}

export { setupFoodDetail };
