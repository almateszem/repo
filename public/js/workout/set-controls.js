/**
 * Podium — a szett-sorok és a gyakorlat-kártya eseményei
 * ------------------------------------------------------------------------
 * Az edzésnapló és a terv-építő közös kezelői (RPE-szorítás, szett
 * hozzáadása/törlése, a napló lenyílói) és a gyakorlat-kártya bekötése. A sorok
 * ÉPÍTÉSE a sets-view.js-é.
 */

import { api } from '../shared/api.js';
import { $, $$ } from '../shared/dom.js';
import { bindPopupMenu } from '../shared/popup-menu.js';
import { showToast } from '../shared/toast.js';
import {
  applyIntensity,
  applySetType,
  defaultSetFor,
  defaultSetType,
  readSetRow,
  refreshExerciseList,
  renderSetRow,
  renumberSets,
  setIntensityLevels,
  syncExtraWeight,
} from './sets-view.js';

/* ======================================================================
   Szett-sorok és lenyílók
   ====================================================================== */

/**
 * Podium — a szett-sorok és a napló-lenyílók eseményei
 * ------------------------------------------------------------------------
 * Az edzésnapló és a terv-építő közös kezelői: RPE-szorítás,
 * szett hozzáadása/törlése, és a sorszám-, szett-típus-, intenzitás- és
 * plusz-súly lenyíló. A sorok ÉPÍTÉSE a sets-view.js-é — az nem köt
 * eseményt és nem hív API-t.
 */

/** A kardió-fokozatok listája a szervertől — egyszer, az app indulásakor
    (app/init.js); a sorok rajzolása onnantól készen találja. */
async function loadIntensityLevels() {
  const levels = await api.getCardioIntensities();
  setIntensityLevels(levels);
  return levels;
}

/** A szett szám-mezőinek tartománya. A léptetőgombok betartják a min/max-ot,
    a billentyűzet viszont bármit beenged („0", „55", „99999"):
      · RPE: 1–10, fél fokozatokra (a recovery-motor erre a skálára épül);
      · ismétlés: 0–999, egész;
      · súly: 0–999, két tizedesig (1,25 kg-os tárcsa is van).
    A 999 a szerver korlátja is (validation/workout-body.js) — fölötte a
    mentés hibát kap, ezért a mező előbb visszaigazít, különben az automatikus
    mentés minden billentyűre hibát dobna. */
const SET_FIELD_RULES = [
  ['.wk-set-rpe', { min: 1, max: 10, round: (v) => Math.round(v * 2) / 2 }],
  ['.wk-set-reps', { min: 0, max: 999, round: Math.round }],
  ['.wk-set-weight', { min: 0, max: 999, round: (v) => Math.round(v * 100) / 100 }],
];

/** Egy szett-mező kézzel beírt értékének a tartományba szorítása. Az üres
    mező üres marad (egyik sem kötelező). Csak fókusz elhagyásakor (change)
    fut, hogy gépelés közben ne írjuk át a félkész számot. Igazzal tér vissza,
    ha módosított (a hívó ilyenkor ment). */
function clampSetInput(target) {
  for (const [selector, { min, max, round }] of SET_FIELD_RULES) {
    const input = target.closest?.(selector);
    if (!input) continue;
    if (input.value.trim() === '') return false;

    const value = Number(input.value);
    // A kerekítést a szabály végzi: a formatInputNumber egy tizedesre vágna,
    // és a 1,25 kg-ból 1,3 lenne.
    const clamped = Number.isFinite(value)
      ? String(Math.min(Math.max(round(value), min), max))
      : '';
    if (clamped === input.value) return false;

    input.value = clamped;
    return true;
  }
  return false;
}

/** Az új szett értékei: az adott gyakorlat utolsó szettje (így ismétlődő
    szetteknél nem kell újragépelni), üres listánál a gyakorlat alap-szettje. */
function nextSetValues(setList, defaultSet) {
  const last = setList.lastElementChild;
  const name = $('.wk-exercise-name', setList.closest('.wk-exercise'))?.textContent.trim();
  const values = last
    ? { ...readSetRow(last), done: false }
    : { ...defaultSetFor(name, defaultSet), done: false };
  // A típus nem öröklődik: az új szett a pozíciója szerinti alapot kapja
  // (a renderSetRow adja), különben egy bemelegítő sor után a következő is
  // bemelegítő lenne.
  delete values.type;
  // Az AMRAP-jelző sem: az „5+" szett után hozzáadott levezető szett nem
  // AMRAP, és ha örökölné, a ciklus-szabály (az utolsó kipipált AMRAP-szett)
  // a levezető ismétlésével számolna a valódi AMRAP-eredmény helyett.
  delete values.amrap;
  return values;
}

/** „+ Szett hozzáadása" delegált kezelése. Igazzal tér vissza, ha a
    kattintás ehhez a gombhoz tartozott (a hívó ilyenkor ne fusson tovább). */
function handleAddSetClick(event, defaultSet, onChange) {
  const addBtn = event.target.closest('.wk-add-set');
  if (!addBtn) return false;
  const setList = $('.wk-set-list', addBtn.closest('.wk-exercise'));
  setList.appendChild(renderSetRow(nextSetValues(setList, defaultSet), setList.children.length));
  renumberSets(setList); // az új sor száma a lista drop setjeitől is függ
  onChange();
  return true;
}

/** Szett törlése (✕) delegált kezelése. Az utolsó szettet nem engedi
    törölni: gyakorlatot a gyakorlat-választóból lehet kivenni. */
function handleRemoveSetClick(event, onChange) {
  const removeBtn = event.target.closest('.wk-set-remove');
  if (!removeBtn) return false;
  const row = removeBtn.closest('.wk-set-row');
  const setList = row.parentElement;
  if (setList.children.length <= 1) {
    showToast(
      'Az utolsó szett nem törölhető — a gyakorlatot a fejlécében lévő ✕-szel veheted ki',
      'error',
    );
    return true;
  }
  const wasFirst = row === setList.firstElementChild;
  row.remove();
  if (wasFirst) promoteFirstSetToWarmup(setList);
  renumberSets(setList);
  onChange();
  return true;
}

/** Az első szett törlése után az utána következő sor lép a helyére — az
    pedig az alapszabály szerint bemelegítés. A `work` típust azért léptetjük
    elő, mert az a nem első sorok alapértéke, tehát nem tudható, hogy a
    felhasználó választotta-e. A `drop` pedig azért, mert a lista élén
    értelmét veszti: nincs előtte szett, aminek a dropja lenne. */
function promoteFirstSetToWarmup(setList) {
  const first = setList.firstElementChild;
  if (first && first.dataset.setType !== 'warmup') applySetType(first, defaultSetType(0));
}

/** A gyakorlatok sorrendjének átrendezése a saját (nem natív) sorszám-
    lenyílóval: a kiválasztott szám az új pozíció, a köztük lévő
    gyakorlatok ehhez igazodva csúsznak arrébb (nem csere, hanem
    "áthelyezés"). Az `onReorder` minden sikeres átrendezés után lefut
    (pl. autosave). A natív <select> helyett azért saját felépítésű ez a
    lenyíló, mert a natív opciólista stílusozása böngészőnként/OS-enként
    megbízhatatlan és a projekt sötét témájával nem volt összhangban. A
    nyitás, a zárás és a billentyűzet a közös bindPopupMenu-é. */
function enableOrderSelect(list, onReorder) {
  bindPopupMenu(list, {
    trigger: '.wk-order-trigger',
    menu: '.wk-order-menu',
    option: '.wk-order-option',
    onChoose: (option) => {
      const card = option.closest('.wk-exercise');
      const cards = $$('.wk-exercise', list);
      const fromIndex = cards.indexOf(card);
      const toIndex = Number(option.dataset.index);
      if (fromIndex === -1 || toIndex === fromIndex) return;

      if (toIndex < fromIndex) {
        list.insertBefore(card, cards[toIndex]);
      } else {
        list.insertBefore(card, cards[toIndex].nextSibling);
      }
      // A szuperszett-kapcsolatok szomszédság-alapúak, ezért a mozgatás után
      // a csoportokat is újra kell számolni (nem csak a sorszámokat).
      refreshExerciseList(list);
      onReorder();
    },
  });
}

/** A szett típusának (bemelegítő / munkasorozat / drop set) választása a
    sorszám-gombra kötött lenyílóval — ugyanaz a minta, mint a gyakorlatok
    sorrendjénél (enableOrderSelect). A típus csak címke: a sor pozícióját
    nem befolyásolja. Az `onChange` minden tényleges váltás után lefut
    (pl. autosave). */
function enableSetTypeSelect(list, onChange) {
  bindPopupMenu(list, {
    trigger: '.wk-set-num',
    menu: '.wk-set-type-menu',
    option: '.wk-set-type-option',
    onOpen: (trigger, menu) => {
      const row = trigger.closest('.wk-set-row');
      // A drop set az ELŐZŐ szettről csökkent le: az első sorban nincs mihez,
      // bemelegítőről pedig nem csökkentenek le. Fordítva ugyanez a szabály:
      // egy szett nem válhat bemelegítővé, ha drop set kapcsolódik hozzá.
      // Rejtés helyett tiltás, hogy látszódjon: az opció létezik, csak itt
      // nem érvényes. A sor szomszédjai változhatnak (törlés, típusváltás),
      // ezért nyitáskor döntjük el, nem a menü felépítésekor.
      const prevType = row.previousElementSibling?.dataset.setType;
      $('.wk-set-type-option[data-type="drop"]', menu).disabled =
        !prevType || prevType === 'warmup';
      $('.wk-set-type-option[data-type="warmup"]', menu).disabled =
        row.nextElementSibling?.dataset.setType === 'drop';
    },
    onChoose: (option) => {
      const row = option.closest('.wk-set-row');
      if (row.dataset.setType === option.dataset.type) return;
      applySetType(row, option.dataset.type);
      renumberSets(row.parentElement); // a gomb aria-label-je a típust is mondja
      onChange();
    },
  });
}

/** Az intenzitás-fokozat választása az időalapú sorokon. Ugyanaz a saját
    lenyíló minta, mint a szett-típusnál — a natív <select> listája
    böngészőnként másképp (és ebben a témában csúnyán) rajzolódik ki.
    Az `onChange` minden tényleges váltás után lefut (pl. autosave). */
function enableIntensitySelect(list, onChange) {
  bindPopupMenu(list, {
    trigger: '.wk-intensity-trigger',
    menu: '.wk-intensity-menu',
    option: '.wk-intensity-option',
    onChoose: (option) => {
      const row = option.closest('.wk-set-row');
      if (row.dataset.intensity === option.dataset.intensity) return;
      applyIntensity(row, option.dataset.intensity);
      onChange();
    },
  });
}

/** A plusz súly menüje az időalapú sorokon. Csak nyit és zár: az ÉRTÉKET a
    benne lévő szám-mező írja, azt pedig a napló meglévő `.wk-num-input`
    figyelője menti — nem hívunk rá külön mentést, hogy egy gépelés ne
    keletkezzen kétszer. A gomb feliratát viszont itt kell frissíteni, mert a
    terv-építőnek nincs ilyen figyelője. */
function enableExtraMenu(list) {
  bindPopupMenu(list, {
    trigger: '.wk-extra-trigger',
    menu: '.wk-extra-menu',
    afterOpen: (trigger, menu) => $('.wk-set-weight', menu).focus(),
  });

  list.addEventListener('input', (event) => {
    if (!event.target.matches('.wk-extra-menu .wk-set-weight')) return;
    syncExtraWeight(event.target.closest('.wk-set-row'));
  });
}

/* ======================================================================
   Gyakorlat-kártya
   ====================================================================== */

/**
 * Podium — egy gyakorlat-kártya közös segédei (edzésnapló, gyakorlat-választó)
 * ------------------------------------------------------------------------
 * A „kipipált szettek" számolása és az eltávolítás előtti megerősítés egy
 * helyen: korábban négy, illetve két helyen állt szó szerint ugyanígy.
 */

/** Hány teljesített (kipipált) szett van a gyökér alatt — egy kártyán vagy
    az egész naplóban. */
const countDoneSets = (root) =>
  $$('.wk-set-check', root).filter((check) => check.getAttribute('aria-pressed') === 'true').length;

/** Rákérdezés egy gyakorlat eltávolítása előtt, ha van rajta teljesített
    szett: az elvesztésük visszavonhatatlan. Frissen hozzáadott (még nem
    teljesített) gyakorlatnál nincs kérdés. Igaz, ha mehet az eltávolítás. */
async function confirmRemoveExercise(card, name, confirmAction) {
  const doneSets = countDoneSets(card);
  if (doneSets === 0) return true;
  return confirmAction(
    `A(z) „${name}” gyakorlaton ${doneSets} teljesített szett van. Az eltávolítással ezek elvesznek.`,
    { title: 'Eltávolítod a gyakorlatot?', confirmLabel: 'Eltávolítás' },
  );
}

export {
  clampSetInput,
  confirmRemoveExercise,
  countDoneSets,
  enableExtraMenu,
  enableIntensitySelect,
  enableOrderSelect,
  enableSetTypeSelect,
  handleAddSetClick,
  handleRemoveSetClick,
  loadIntensityLevels,
  nextSetValues,
};
