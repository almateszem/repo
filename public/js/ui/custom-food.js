/** Saját étel felvitele — makrók, Atwater-ellenőrzés. */

import { SESSION_LOST, api } from '../shared/api.js';
import { $, readNumberInput } from '../shared/dom.js';
import { showToast } from '../shared/toast.js';
import { createModalController } from '../shared/modals.js';

/* ======================================================================
   Saját étel modál (cf-*)
   ----------------------------------------------------------------------
   A kalóriát a makrókból számoljuk (Atwater 4/4/9) és élőben mutatjuk, de a
   mező szerkeszthető: a csomagoláson lévő érték a rost, a poliolok és az
   alkohol miatt jogosan eltérhet a képlettől. A ↻ visszakapcsol automatikusra.
   ====================================================================== */

const ATWATER = { protein: 4, carbs: 4, fat: 9 };

/**
 * A „saját étel" modál vezérlője. Ő birtokolja a Táplálkozás oldal két új
 * gombját, a vonalkód-feloldást és a saját ételek törlését is.
 *
 * @param {object}   opts
 * @param {object}   opts.scanner        a setupScanner() vezérlője ({ scan })
 * @param {Function} opts.confirmAction  megerősítő ablak (törléshez)
 * @param {Function} opts.onSaved        () => Promise — az étel-lista frissítése
 * @param {Function} opts.onLog          (food) => void — adagválasztó nyitása
 * @returns {{ open: (prefill?: object) => void, scanAndOpen: () => Promise<void> }}
 */
async function setupCustomFood({ scanner, confirmAction, onSaved, onLog } = {}) {
  const modal = $('#customFoodModal');
  const controller = createModalController(modal);
  const form = $('[data-form="custom-food"]', modal);
  const nameInput = $('#cf-name', modal);
  const groupSelect = $('#cf-group', modal);
  const unitSelect = $('#cf-unit', modal);
  const proteinInput = $('#cf-protein', modal);
  const carbsInput = $('#cf-carbs', modal);
  const fatInput = $('#cf-fat', modal);
  const kcalInput = $('#cf-kcal', modal);
  const kcalState = $('[data-cf-kcal-state]', modal);
  const kcalReset = $('[data-cf-kcal-reset]', modal);
  const barcodeInput = $('#cf-barcode', modal);
  const basisEl = $('[data-cf-basis]', modal);
  const sourceEl = $('[data-cf-source]', modal);
  const errorEl = $('[data-cf-error]', modal);
  const saveButtons = [$('[data-cf-save]', modal), $('[data-cf-save-log]', modal)];

  let kcalMode = 'auto';
  let prefillSource = 'manual';

  /* A kategória-opciók a szerver kategória-listájából jönnek, nem a
     FOOD_GROUPS kliensoldali másolatából: így nincs két igazság, és a szerver
     FOOD_GROUPS-alapú validálásával sem csúszhat el. A saját ételek
     'Saját étel' csoportja kimarad — az nem valódi kategória, csak
     megjelenítési alap. A szerver már rendezve adja (catalog-search.js). */
  const groups = await api.getFoodGroups();
  groups.forEach((group) => {
    const option = document.createElement('option');
    option.value = group;
    option.textContent = group;
    groupSelect.appendChild(option);
  });

  const setError = (text) => {
    errorEl.textContent = text || '';
    errorEl.hidden = !text;
  };

  /** A mező száma, üresen 0 — csak a kalória-előnézethez és a kézi
      kalóriához. A makrókat mentés előtt a requiredMacros ellenőrzi. */
  const numberOf = (input) => readNumberInput(input) ?? 0;

  const MACRO_FIELDS = [
    [proteinInput, 'protein', 'a fehérje'],
    [carbsInput, 'carbs', 'a szénhidrát'],
    [fatInput, 'fat', 'a zsír'],
  ];

  /** A három makró, vagy null, ha valamelyik üres: az üres mező „nem tudjuk",
      nem 0 g — a vonalkódos kitöltés a hiányzó tápértéket szándékosan üresen
      hagyja. Az űrlap novalidate, ezért a required itt nem hatna. Az első
      üres mező megjelölve, a hibaüzenet őt nevezi meg. */
  const requiredMacros = () => {
    const values = {};
    for (const [input, key, label] of MACRO_FIELDS) {
      const value = readNumberInput(input);
      if (value === null) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        setError(`Add meg ${label} értékét, vagy írj 0-t.`);
        return null;
      }
      values[key] = value;
    }
    return values;
  };
  const clearMacroErrors = () => {
    MACRO_FIELDS.forEach(([input]) => input.removeAttribute('aria-invalid'));
  };

  /** A makró a mentéssel azonos kerekítéssel (a szerver macroValue-ja tizedre
      kerekít, és abból számolja a kalóriát) — enélkül az előnézet 49-et
      mutathatott a mentett 50 helyett. */
  const savedMacro = (input) => Math.round(numberOf(input) * 10) / 10;

  const computeKcal = () =>
    Math.round(
      savedMacro(proteinInput) * ATWATER.protein +
        savedMacro(carbsInput) * ATWATER.carbs +
        savedMacro(fatInput) * ATWATER.fat,
    );

  /** A kalória-mező és az állapotszöveg összehangolása a jelenlegi móddal. */
  const syncKcal = () => {
    const computed = computeKcal();
    // A programozott értékadás NEM vált ki `input` eseményt, tehát ez nem
    // billenti át kézi módba — nincs visszacsatolási hurok.
    if (kcalMode === 'auto') kcalInput.value = String(computed);
    kcalState.textContent =
      kcalMode === 'auto'
        ? 'a makrókból számolva'
        : `kézi érték · a képlet szerint ${computed} kcal`;
    kcalReset.hidden = kcalMode === 'auto';
    kcalInput.classList.toggle('is-manual', kcalMode === 'manual');
  };

  [proteinInput, carbsInput, fatInput].forEach((input) => {
    input.addEventListener('input', syncKcal);
  });
  kcalInput.addEventListener('input', () => {
    kcalMode = 'manual';
    syncKcal();
  });
  kcalReset.addEventListener('click', () => {
    kcalMode = 'auto';
    syncKcal();
    kcalInput.focus();
  });

  // Az egység a mezők jelentését változtatja meg (100 g vagy 100 ml) —
  // a legend ezt mondja ki, hogy ne legyen kétértelmű.
  const syncUnit = () => {
    basisEl.textContent = `100 ${unitSelect.value}`;
  };
  unitSelect.addEventListener('change', syncUnit);

  /** A modál megnyitása, opcionálisan előre kitöltve (vonalkódról). */
  const open = (prefill = null) => {
    form.reset();
    kcalMode = 'auto';
    prefillSource = prefill?.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual';
    setError('');
    clearMacroErrors();

    if (prefill) {
      // A hiányzó (null) tápérték ÜRESEN marad, nem nulla lesz: a nulla azt
      // állítaná, hogy a termék nem tartalmaz fehérjét, holott csak nem tudjuk.
      const fill = (input, value) => {
        input.value = value === null || value === undefined ? '' : String(value);
      };
      fill(nameInput, prefill.name);
      fill(proteinInput, prefill.protein);
      fill(carbsInput, prefill.carbs);
      fill(fatInput, prefill.fat);
      fill(barcodeInput, prefill.barcode);
      if (prefill.unit === 'ml') unitSelect.value = 'ml';

      /* Az OFF címke-kalóriája gyakran eltér a makrókból számolttól (rost,
         poliolok). Ilyenkor a címke értékét vesszük át KÉZI módban — az a
         termékre vonatkozó tény —, de a ↻ egy koppintással visszaszámoltat. */
      const labelKcal = prefill.kcal;
      if (
        labelKcal !== null &&
        labelKcal !== undefined &&
        Math.round(labelKcal) !== computeKcal()
      ) {
        kcalMode = 'manual';
        kcalInput.value = String(Math.round(labelKcal));
      }
    }

    sourceEl.hidden = prefillSource !== 'openfoodfacts';
    sourceEl.textContent =
      prefillSource === 'openfoodfacts'
        ? 'Open Food Facts adat — vesd össze a csomagolással, mielőtt mentesz.'
        : '';

    syncUnit();
    syncKcal();
    controller.open();
    // A controller a bezárás-gombra fókuszál; az űrlapon a névmező a kezdet.
    nameInput.focus();
  };

  /** Beolvasás → feloldás → az űrlap megnyitása a találattal. */
  const scanAndOpen = async () => {
    const code = await scanner?.scan();
    if (!code) return; // megszakítva

    try {
      const hit = await api.lookupBarcode(code);
      if (hit.source === 'saved') {
        // Ezt a terméket már felvitted — nem kérdezzük meg újra a
        // tápértékeit, egyből az adagválasztó jön.
        showToast(`${hit.food.name} — már a saját ételeid közt van`);
        onLog?.(hit.food);
        return;
      }
      open({ ...hit.product, source: 'openfoodfacts' });
    } catch (err) {
      /* A 404 (ismeretlen kód) és az 502 (az OFF nem elérhető) is ide fut. A
         modál ilyenkor ÜRESEN, a vonalkóddal előre kitöltve nyílik: a
         felhasználó a csomagolásról beírja az értékeket, és legközelebb már
         a saját listájából ismeri fel a szkenner. */
      if (err.code !== SESSION_LOST) {
        showToast(err.message || 'A vonalkódot nem sikerült feloldani', 'error');
        open({ barcode: code });
      }
    }
  };

  const submit = async ({ thenLog = false } = {}) => {
    setError('');
    clearMacroErrors();
    const macros = requiredMacros();
    if (!macros) return; // az űrlap és a bevitt adat marad
    saveButtons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const saved = await api.addCustomFood({
        name: nameInput.value,
        group: groupSelect.value,
        unit: unitSelect.value,
        ...macros,
        kcal: numberOf(kcalInput),
        kcalMode,
        barcode: barcodeInput.value.trim() || undefined,
        source: prefillSource,
      });
      await onSaved?.(saved);
      const closed = controller.close();
      showToast(`${saved.name} felvéve a saját ételeid közé`);
      // Az adagválasztó CSAK a záró animáció után nyíljon (a close() ígérete
      // a tényleges elrejtéskor teljesül), különben egy pillanatra két modál
      // látszana egymáson.
      if (thenLog) closed.then(() => onLog?.(saved));
    } catch (err) {
      // A szerver üzenete (409 duplikátum, 400 validálás) magyarul, az
      // űrlapon marad — a bevitt adat NEM vész el.
      if (err.code !== SESSION_LOST) setError(err.message || 'Nem sikerült menteni az ételt');
    } finally {
      saveButtons.forEach((button) => {
        button.disabled = false;
      });
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });
  $('[data-cf-save-log]', modal).addEventListener('click', () => submit({ thenLog: true }));
  $('[data-cf-scan]', modal).addEventListener('click', scanAndOpen);

  // A két oldali gomb
  $('[data-action="add-custom-food"]')?.addEventListener('click', () => open());
  $('[data-action="scan-barcode"]')?.addEventListener('click', scanAndOpen);

  /* Saját étel törlése. Külön figyelő ugyanazon a listán: a setupNutrition
     delegációját nem zavarja, mert az a `.nu-food-add`-re szűr, ami a ✕-re
     null-t ad. */
  $('[data-list="foods"]').addEventListener('click', async (event) => {
    const removeBtn = event.target.closest('.nu-food-remove');
    if (!removeBtn) return;

    const item = removeBtn.closest('.nu-food');
    const name = $('.nu-food-name', item)?.firstChild?.textContent?.trim() || 'Ez az étel';
    const ok = await confirmAction?.(
      `A(z) „${name}" törlődik a saját ételeid közül. A már lenaplózott tételeid megmaradnak.`,
      { title: 'Saját étel törlése', confirmLabel: 'Törlés' },
    );
    if (!ok) return;

    removeBtn.disabled = true;
    try {
      await api.removeCustomFood(Number(removeBtn.dataset.customFoodId));
      await onSaved?.(null);
      showToast(`${name} törölve a saját ételek közül`);
    } catch (err) {
      removeBtn.disabled = false;
      if (err.code !== SESSION_LOST) {
        showToast(err.message || 'Nem sikerült törölni az ételt', 'error');
      }
    }
  });

  return { open, scanAndOpen };
}

export { setupCustomFood };
