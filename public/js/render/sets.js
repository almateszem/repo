/**
 * Az edzésnapló szerkesztő-primitívjei: szett-sorok, szett-típusok,
 * gyakorlat-kártyák, szuperszettek és a sorrend-választók.
 *
 * Ezeket az edzésnapló, a tervkészítő és a gyakorlat-választó is használja —
 * ezért állnak külön a lapok vezérlőitől.
 */

import { api } from '../core/api.js';
import { $, $$, cloneTemplate } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { showToast } from '../core/toast.js';

/* ---- Szett-sorok ----
   Az ism./súly/RPE szám-mező: az ismétlés és a súly léptetőgombokkal, az
   RPE sima mezőként. A mértékegység a fejlécben van, nem az értékben —
   korábban bele kellett gépelni („12 rep", „60% TM"), ami mobilon
   kényelmetlen volt és a szöveges billentyűzetet hozta fel. A sorszám és a
   mezők címkéi a sor pozíciójából jönnek, ezért törlés/hozzáadás után
   újraszámozunk. */

const SET_FIELDS = [
  ['.wk-set-reps', 'reps', 'ismétlés'],
  ['.wk-set-weight', 'weight', 'súly kilogrammban'],
  ['.wk-set-rpe', 'rpe', 'RPE'],
];

/* A szett három típusa. A sorszám-gomb felirata a szám marad (a sorban
   nincs hely még egy feliratnak) — a típust a színe mutatja, a nevét az
   aria-label és a lenyíló mondja ki. */
const SET_TYPES = [
  ['warmup', 'Bemelegítő'],
  ['work', 'Munkasorozat'],
  ['drop', 'Drop set'],
];

/** A pozíció szerinti alaptípus: az első szett bemelegítés, onnantól
    munkasorozat. Az újraszámozás nem írja felül a meglévő típust; az
    egyetlen kivétel az első szett törlése (lásd promoteFirstSetToWarmup). */
const defaultSetType = (index) => (index === 0 ? 'warmup' : 'work');

/** Egy mentett szett típusa. A régi (típus nélküli) bejegyzésekre és az
    ismeretlen értékekre a pozíció szerinti alap érvényes. */
const setTypeOf = (set, index) =>
  (SET_TYPES.some(([value]) => value === set?.type) ? set.type : defaultSetType(index));

const setTypeLabel = (type) =>
  (SET_TYPES.find(([value]) => value === type) ?? SET_TYPES[1])[1];

/** Szám-mezőbe tölthető érték. A régi, mértékegységgel együtt tárolt
    bejegyzésekből („12 rep", „60% TM", „–") kinyeri a számot — a szerver
    induláskor migrálja az adatbázist, ez a kliens-oldali védőháló. */
function numericValue(raw) {
  const match = String(raw ?? '').replace(',', '.').match(/\d+(\.\d+)?/);
  return match ? match[0] : '';
}

/* ======================================================================
   IDŐALAPÚ (kardió) sorok
   ----------------------------------------------------------------------
   Amit nem ismétlésben mérnek — futópad, szobabicikli, evezőgép —, annál a
   sor mást tartalmaz: eltöltött időt és intenzitást. Nincs ismétlés, nincs
   RPE, és nincs szett-típus sem: a bemelegítő/munkasorozat/drop hármas egy
   futásra értelmezhetetlen.

   A módot a GYAKORLAT hozza magával (`logMode`), a katalógusból. Nem az
   számít, melyik szűrő-chipről adták hozzá: az sehol nem tárolódik, és a
   kereséssel amúgy is megkerülhető.
   ====================================================================== */

/* A fokozatok CÍMKÉI a szervertől jönnek, hogy a mentett kulcs és a felirat ne
   sodródhasson szét — ugyanaz az elv, mint a mérési helyeknél. Modul-szintű
   másolat, mert a sor rajzolása szinkron: a lista egyszer, az app indulásakor
   töltődik be (app/init.js), és onnantól minden rajzolás készen találja. */
let intensityLevels = [];

async function loadIntensityLevels() {
  intensityLevels = await api.getCardioIntensities();
  return intensityLevels;
}

/** A skála KÖZEPE jár ismeretlen vagy hiányzó értékre — ugyanaz, amit a szerver
    is választ. A középső elem, nem beégetett kulcs: ha a skála egyszer bővül,
    ez magától követi. */
const defaultIntensityKey = () =>
  intensityLevels[Math.floor(intensityLevels.length / 2)]?.key ?? '';

const intensityKeyOf = (value) =>
  (intensityLevels.some((level) => level.key === value) ? value : defaultIntensityKey());

const intensityLabel = (key) =>
  intensityLevels.find((level) => level.key === key)?.label ?? key;

/* A mező PERCET tartalmaz, a tárolt érték viszont MÁSODPERC.
   Másodpercet szándékosan nem lehet megadni: egy kardió edzésen az egy-két
   másodperc nem információ, egy külön mp-mező viszont minden alkalommal plusz
   beviteli lépés lenne. A tárolás azért marad mégis másodperc, mert így a
   mérték később finomítható anélkül, hogy a már mentett adathoz hozzá kellene
   nyúlni — és a szerver oldalán is ez az egy alak él (logmode.js). */

/** A mezőbe írt PERC → tárolt másodperc. */
function parseDurationInput(raw) {
  const minutes = Number(String(raw ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round(minutes) * 60;
}

/** Tárolt másodperc → a mező PERC-értéke. Nulla időre ÜRES mező jár, nem „0":
    a nulla azt állítaná, hogy megmérték és annyi lett. Egy percnél rövidebb
    tárolt idő EGY percre kerekedik felfelé, nem nullára — a nulla a következő
    mentéskor letörölné magát az értéket. */
function formatDuration(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  if (total === 0) return '';
  return String(Math.max(1, Math.round(total / 60)));
}

/** A fokozat beállítása a soron: az ÉRTÉK a data-attribútumban él (onnan
    olvassa a readSetRow), a felirat a gombon, a kijelölés az opciókon. */
function applyIntensity(row, key) {
  row.dataset.intensity = key;
  $('.wk-intensity-trigger', row).textContent = intensityLabel(key);
  $$('.wk-intensity-option', row).forEach((option) => {
    option.setAttribute('aria-selected', String(option.dataset.intensity === key));
  });
}

/** A fokozat-lenyíló feltöltése. A lista fix, ezért a sorral együtt, egyszer
    épül fel — ugyanúgy, mint a szett-típus menüje. */
function buildIntensityMenu(row) {
  $('.wk-intensity-menu', row).replaceChildren(...intensityLevels.map((level) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'wk-intensity-option';
    option.setAttribute('role', 'option');
    option.dataset.intensity = level.key;
    option.textContent = level.label;
    return option;
  }));
}

/** A plusz súly a három pötty MÖGÖTT lakik, ezért a gombnak ki kell mondania,
    ha rejt valamit: érték nélkül a pöttyök látszanak, értékkel maga a súly.
    Enélkül egy felvitt súlymellény láthatatlanul ülne egy csukott menüben. */
function syncExtraWeight(row) {
  const kg = Number($('.wk-set-weight', row).value);
  const trigger = $('.wk-extra-trigger', row);
  const hasWeight = Number.isFinite(kg) && kg > 0;
  row.dataset.hasWeight = String(hasWeight);
  trigger.textContent = hasWeight ? `+${formatNumber(kg)}` : '⋮';
  trigger.setAttribute('aria-label', hasWeight
    ? `Plusz súly: ${formatNumber(kg)} kg — módosítás`
    : 'Plusz súly hozzáadása');
}

function renderCardioRow(set) {
  const row = cloneTemplate('tpl-cardio-row');
  $('.wk-cardio-time', row).value = formatDuration(set?.duration);
  $('.wk-set-weight', row).value = numericValue(set?.weight);
  $('.wk-set-check', row).setAttribute('aria-pressed', String(Boolean(set?.done)));
  buildIntensityMenu(row);
  applyIntensity(row, intensityKeyOf(set?.intensity));
  syncExtraWeight(row);
  return row;
}

const isCardioRow = (row) => row.classList.contains('wk-set-row--cardio');

/** Egy sor címkéinek beállítása a kapott sorszám-felirattal („2", „2a").
    A sorszám-gomb címkéjébe a típus neve is belekerül — a gombon csak a
    szám látszik, képernyőolvasóval enélkül néma maradna a szín. */
function numberSetRow(row, label, dropCount = 0) {
  const trigger = $('.wk-set-num', row);
  trigger.textContent = label;
  trigger.setAttribute('aria-label',
    `${label}. szett típusa: ${setTypeLabel(row.dataset.setType)}`
    + (dropCount > 0 ? `, ${dropCount} drop settel` : ''));
  SET_FIELDS.forEach(([selector, , fieldLabel]) => {
    $(selector, row).setAttribute('aria-label', `${label}. szett — ${fieldLabel}`);
  });
  $('.wk-set-check', row).setAttribute('aria-label', `${label}. szett teljesítve`);
  $('.wk-set-remove', row).setAttribute('aria-label', `${label}. szett törlése`);
}

/** A sor típusának beállítása: a színezést a data-attribútum viszi, a
    kiválasztott állapotot a lenyíló opcióinak aria-selected-je. A gomb
    hangos címkéjét a numberSetRow írja — a hívó ezért számoz újra utána. */
function applySetType(row, type) {
  row.dataset.setType = type;
  $$('.wk-set-type-option', row).forEach((option) => {
    option.setAttribute('aria-selected', String(option.dataset.type === type));
  });
}

/** A típusválasztó lenyíló feltöltése. A három opció fix, ezért a sorral
    együtt, egyszer épül fel. */
function buildSetTypeMenu(row) {
  $('.wk-set-type-menu', row).replaceChildren(...SET_TYPES.map(([value, label]) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'wk-set-type-option';
    option.setAttribute('role', 'option');
    option.dataset.type = value;
    option.textContent = label;
    return option;
  }));
}

/** A drop setek betűjelei: 2 → 2a → 2b (dupla/tripla drop). Ennél többet
    nem jelölünk betűvel — az már nem drop set, hanem kifutás. */
const DROP_LETTERS = 'abcdefgh';

/** Egy gyakorlat szett-listájának újraszámozása (törlés/hozzáadás/típus-
    váltás után).

    A drop set NEM kap saját sorszámot: az előtte lévő szett számát örökli
    egy betűvel (2 → 2a → 2b), így a listából leolvasható, MELYIK szettnek a
    dropja. Ugyanaz az elv, mint a gyakorlatok szuperszett-jelölésénél, egy
    szinttel lejjebb (lásd refreshSupersetGroups) — a kapcsolatot ott is, itt
    is a szomszédság hordozza, nem külön azonosító.

    A drop setnek érvényes szülője kell legyen. Kettő nem lehet az: a semmi
    (a lista első sora) és a bemelegítő — bemelegítőről nem csökkentenek le.
    Az ide sodródott drop (pl. a szülő szett törlése után) munkasorozattá lép
    elő. Sorrendben haladunk, így a javított típust a következő sor már látja. */
function renumberSets(setList) {
  const rows = $$('.wk-set-row', setList);
  let number = 0;
  let dropIndex = 0;

  rows.forEach((row, index) => {
    if (row.dataset.setType === 'drop') {
      const prevType = rows[index - 1]?.dataset.setType;
      if (!prevType) applySetType(row, defaultSetType(0));
      else if (prevType === 'warmup') applySetType(row, 'work');
    }

    const isDrop = row.dataset.setType === 'drop';
    if (isDrop) {
      dropIndex += 1;
    } else {
      number += 1;
      dropIndex = 0;
    }

    // A füzérben betöltött szerep — ebből rajzolja a CSS az összekötő
    // zárójelet: 'parent' az EREDETI szett (itt indul a vonal), 'mid' az
    // átmenő drop, 'last' a lezáró. A szerep nélküli sorok nem tagjai
    // egyetlen füzérnek sem.
    const nextIsDrop = rows[index + 1]?.dataset.setType === 'drop';
    const role = isDrop ? (nextIsDrop ? 'mid' : 'last') : (nextIsDrop ? 'parent' : '');
    if (role) row.dataset.dropRole = role;
    else delete row.dataset.dropRole;

    // A hangos címke az eredeti szettnél elmondja, hány drop tartozik hozzá.
    let drops = 0;
    if (role === 'parent') {
      while (rows[index + 1 + drops]?.dataset.setType === 'drop') drops += 1;
    }

    numberSetRow(row, isDrop ? `${number}${DROP_LETTERS[dropIndex - 1] ?? ''}` : String(number), drops);
  });
}

/** Egy szett-sor kiolvasása a mezőkből (a napló és a terv-építő is ezt hívja). */
const readSetRow = (row) => {
  /* Időalapú sor: más mezők, más alak. Az idő MÁSODPERCBEN megy ki — a mentett
     alak is az, a percben megadott bevitel csak megjelenítés. */
  if (isCardioRow(row)) {
    return {
      done: $('.wk-set-check', row).getAttribute('aria-pressed') === 'true',
      duration: String(parseDurationInput($('.wk-cardio-time', row).value)),
      intensity: row.dataset.intensity || '',
      weight: $('.wk-set-weight', row).value.trim(),
    };
  }

  const set = {
    done: $('.wk-set-check', row).getAttribute('aria-pressed') === 'true',
    type: row.dataset.setType || 'work',
  };
  SET_FIELDS.forEach(([selector, key]) => { set[key] = $(selector, row).value.trim(); });
  return set;
};

function renderSetRow(set, index) {
  const row = cloneTemplate('tpl-set-row');
  SET_FIELDS.forEach(([selector, key]) => { $(selector, row).value = numericValue(set[key]); });
  $('.wk-set-check', row).setAttribute('aria-pressed', String(set.done));
  buildSetTypeMenu(row);
  applySetType(row, setTypeOf(set, index));
  // Ideiglenes felirat: a végleges sorszám a drop setektől is függ, azt a
  // teljes listát látó renumberSets adja meg — a hívó azt futtatja utána.
  numberSetRow(row, String(index + 1));
  return row;
}

/** Léptetőgomb (−/+): a lépésközt az input `step` attribútuma adja
    (1 ismétlés, 2.5 kg = a legkisebb tárcsapár). Az érték a min/max közé
    szorul, és `input` eseményt váltunk ki, hogy az arra kötött automatikus
    mentés is lefusson. Igazzal tér vissza, ha ő kezelte a kattintást. */
function handleStepClick(event) {
  const stepBtn = event.target.closest('.wk-num-step');
  if (!stepBtn) return false;

  const input = $('.wk-num-input', stepBtn.parentElement);
  const step = Number(input.step) || 1;
  const min = input.min === '' ? -Infinity : Number(input.min);
  const max = input.max === '' ? Infinity : Number(input.max);
  const current = Number(input.value);
  const next = (Number.isFinite(current) ? current : 0) + Number(stepBtn.dataset.dir) * step;

  input.value = formatNumber(Math.min(Math.max(next, min), max));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** Az RPE-mező kézzel beírt értékének 1–10 közé (fél fokozatokra) szorítása.
    A léptetőgombok betartják a min/max-ot, a billentyűzet viszont bármit
    beenged („0", „55", „8.3"), a recovery-motor pedig erre a skálára épül.
    Az üres mező üres marad — az RPE nem kötelező. Csak fókusz elhagyásakor
    (change) fut, hogy gépelés közben ne írjuk át a félkész számot. Igazzal
    tér vissza, ha módosított (a hívó ilyenkor ment). */
function clampRpeInput(target) {
  const input = target.closest?.('.wk-set-rpe');
  if (!input || input.value.trim() === '') return false;

  const value = Number(input.value);
  const clamped = Number.isFinite(value)
    ? formatNumber(Math.min(Math.max(Math.round(value * 2) / 2, 1), 10))
    : '';
  if (clamped === input.value) return false;

  input.value = clamped;
  return true;
}

/** Az új szett értékei: az adott gyakorlat utolsó szettje (így ismétlődő
    szetteknél nem kell újragépelni), üres listánál a szerver alap-szettje. */
function nextSetValues(setList, defaultSet) {
  const last = setList.lastElementChild;
  const values = last ? { ...readSetRow(last), done: false } : { ...defaultSet, done: false };
  // A típus nem öröklődik: az új szett a pozíciója szerinti alapot kapja
  // (a renderSetRow adja), különben egy bemelegítő sor után a következő is
  // bemelegítő lenne.
  delete values.type;
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
    showToast('Az utolsó szett nem törölhető — a gyakorlatot a fejlécében lévő ✕-szel veheted ki', 'error');
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

function renderExercise(exercise, {
  withAddSet = false, prToggle = false, reorder = false, supersets = false, removable = false,
} = {}) {
  const card = cloneTemplate('tpl-exercise');
  $('.wk-exercise-name', card).textContent = exercise.name;

  /* A NAPLÓZÁSI MÓD a kártyán is látszik: ebből tudja a rács a saját oszlopait,
     és ebből olvassa ki a napló, mit küldjön a szerverre. */
  const cardio = exercise.logMode === 'duration';
  card.dataset.logMode = cardio ? 'duration' : 'reps';

  // A szuperszett-kapocs is naplóra szabott: a tervben a gyakorlatok
  // sorrendje/összekapcsolása még nem téma. A gomb láthatóságát (első kártya)
  // és a csoport-kereteket a refreshSupersetGroups állítja be.
  $('.wk-superset', card).hidden = !supersets;
  $('.wk-superset-link', card).setAttribute('aria-pressed', String(Boolean(exercise.superset)));

  // A sorszám-választó csak az edzésnaplóban látszik — a terv-építőben a
  // gyakorlatok sorrendje a hozzáadás sorrendje marad. A gomb felirata és
  // a lenyíló lista tartalma a lista minden változásakor renumberOrderSelects-
  // szel frissül.
  $('.wk-order-select', card).hidden = !reorder;

  // Az edzésnapló kártyáin a PR-jelvény automatikusan, a képlet alapján
  // frissül (updateExercisePrIndicator); a terv-építőben rejtve marad.
  const prBtn = $('.wk-pr', card);
  /* Időalapú soron nincs PR: nincs mihez mérni, és a szerver sem számol rá
     egyet sem. A gomb ezért nem csak hamis, hanem REJTETT is — egy örökké üres
     jelvény helyet foglalna és kérdést szülne. */
  prBtn.hidden = !prToggle || cardio;
  prBtn.setAttribute('aria-pressed', String(Boolean(exercise.pr)));

  const videoBtn = $('.wk-video-btn', card);
  videoBtn.dataset.exercise = exercise.name;
  videoBtn.title = 'Technika videó';
  videoBtn.setAttribute('aria-label', `Technika videó — ${exercise.name}`);

  const removeBtn = $('.wk-exercise-remove', card);
  removeBtn.hidden = !removable;
  removeBtn.title = 'Gyakorlat eltávolítása';
  removeBtn.setAttribute('aria-label', `${exercise.name} eltávolítása az edzésből`);

  const setList = $('.wk-set-list', card);
  if (cardio) {
    /* A fejléc feliratai a módhoz igazodnak: „Ism./Súly·kg/RPE" helyett
       „Idő/Intenzitás". A két üres cella a pötty-gombé és a pipáé. */
    const head = $('.wk-set-row--head', card);
    head.classList.add('wk-set-row--cardio');
    head.replaceChildren(...['Idő·perc', 'Intenzitás', '', ''].map((text) => {
      const cell = document.createElement('span');
      cell.textContent = text;
      return cell;
    }));
    /* Gyakorlatonként EGY sor a szabály. Ha egy mentett bejegyzésben mégis több
       áll, mindet kirajzoljuk: a naplóból nem tüntetünk el adatot. */
    const rows = exercise.sets?.length ? exercise.sets : [{}];
    rows.forEach((set) => setList.appendChild(renderCardioRow(set)));
  } else {
    exercise.sets.forEach((set, index) => setList.appendChild(renderSetRow(set, index)));
    renumberSets(setList); // a drop setek az előző szett számát öröklik
  }

  /* „+ Szett" gomb — az edzésnapló és a terv-építő kártyáin egyaránt. Időalapú
     gyakorlaton NINCS: egy kardió gyakorlat egy sor. Ha itt maradna, a fázisokra
     bontás a hátsó ajtón sétálna vissza, szabályozatlanul. */
  if (withAddSet && !cardio) {
    const addSetBtn = document.createElement('button');
    addSetBtn.type = 'button';
    addSetBtn.className = 'wk-add-set';
    addSetBtn.textContent = '+ Szett hozzáadása';
    card.appendChild(addSetBtn);
  }
  return card;
}

/** A szuperszett-csoportok betűjelei. Ennél több gyakorlat egy körben már
    nem szuperszett, hanem köredzés — a betű ilyenkor egyszerűen elmarad. */
const SUPERSET_LETTERS = 'ABCDEFGH';

/** A szuperszett-csoportok újraszámolása a kártyák AKTUÁLIS DOM-sorrendjéből.
    A kapcsolat mindig „az előttem lévővel" jelentésű, ezért a csoportokat
    kizárólag a sorrend adja ki: két összekapcsolt közé mozgatott gyakorlat
    beolvad a csoportba (így lesz triszett), a lista elejére mozgatott pedig
    kiesik belőle. Emiatt minden hozzáadás/törlés/átrendezés/kapcsolás után
    le kell futnia.

    Csak az edzésnapló listáján hívjuk (a terv-építőben a `.wk-superset`
    wrapper rejtett, ott nincs mit számolni).

    A kártyákra `data-superset-role`-t ír (solo / start / middle / end — ez
    rajzolja a CSS-ben az összekötött keretet), és visszaadja a megjelenítendő
    sorszám-címkéket (`['1A', '1B', '2']`) a renumberOrderSelects számára. */
function refreshSupersetGroups(list) {
  const cards = $$('.wk-exercise', list);
  const groups = [];
  let groupNumber = 0;
  let letterIndex = 0;

  cards.forEach((card, index) => {
    const link = $('.wk-superset-link', card);
    // Az első kártyának nincs mihez kapcsolódnia — a gomb rejtve marad, és
    // az esetleg örökölt „kapcsolt" állapotot is töröljük (pl. ha a
    // felhasználó egy csoporttagot mozgatott a lista elejére).
    if (index === 0) link.setAttribute('aria-pressed', 'false');
    link.hidden = index === 0;

    const linked = link.getAttribute('aria-pressed') === 'true';
    if (linked) {
      letterIndex += 1;
    } else {
      groupNumber += 1;
      letterIndex = 0;
    }
    groups.push({ linked, groupNumber, letterIndex });

    if (index > 0) {
      const prevName = $('.wk-exercise-name', cards[index - 1]).textContent.trim();
      link.setAttribute('aria-label', `Szuperszett a(z) „${prevName}” gyakorlattal`);
    }
  });

  return cards.map((card, index) => {
    const { linked, groupNumber: number, letterIndex: letter } = groups[index];
    // A csoporthoz tartozás két irányból is jöhet: vagy én kapcsolódom az
    // előzőhöz, vagy a következő kapcsolódik hozzám.
    const nextLinked = Boolean(groups[index + 1]?.linked);
    card.dataset.supersetRole = linked
      ? (nextLinked ? 'middle' : 'end')
      : (nextLinked ? 'start' : 'solo');

    const inGroup = linked || nextLinked;
    return inGroup ? `${number}${SUPERSET_LETTERS[letter] ?? ''}` : String(number);
  });
}

/** A `.wk-order-select` gombjainak feliratát és a hozzájuk tartozó
    lenyíló lista (`.wk-order-menu`) opcióit frissíti a lista aktuális
    állapotára — minden hozzáadás/eltávolítás/átrendezés után meg kell
    hívni, különben a számozás elcsúszna a tényleges DOM-sorrendtől.

    A `labels` a refreshSupersetGroups címkéi („1A", „1B", „2"); ha nincs
    megadva, sima sorszámozás megy. A lenyíló opciói UGYANEZT a címkekészletet
    kapják: az opció a célpozíciót jelenti, így amit a listában látsz, azt
    választod ki. */
function renumberOrderSelects(list, labels) {
  const cards = $$('.wk-exercise', list);
  const labelAt = (index) => labels?.[index] ?? String(index + 1);
  cards.forEach((card, index) => {
    const wrap = $('.wk-order-select', card);
    if (wrap.hidden) return;
    $('.wk-order-trigger', wrap).textContent = labelAt(index);

    const menu = $('.wk-order-menu', wrap);
    if (menu.children.length !== cards.length) {
      menu.replaceChildren(...cards.map((_, i) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'wk-order-option';
        option.setAttribute('role', 'option');
        option.dataset.index = String(i);
        return option;
      }));
    }
    // A feliratok a darabszám változása nélkül is módosulhatnak (kapcsolás),
    // ezért ezek MINDIG frissülnek, nem csak a menü újraépítésekor.
    $$('.wk-order-option', menu).forEach((option, i) => {
      option.textContent = labelAt(i);
      option.setAttribute('aria-selected', String(i === index));
    });
  });
}

/** Az edzésnapló gyakorlat-listájának teljes újraszinkronizálása:
    szuperszett-csoportok, majd az azokból adódó sorszám-címkék. Minden
    hozzáadás/törlés/átrendezés/kapcsolás után ezt kell hívni. */
function refreshExerciseList(list) {
  renumberOrderSelects(list, refreshSupersetGroups(list));
}

/** Az összes nyitott sorszám-lenyíló bezárása (kívülre kattintás, Escape,
    vagy egy opció kiválasztása után). */
function closeAllOrderMenus(list) {
  $$('.wk-order-menu', list).forEach((menu) => { menu.hidden = true; });
  $$('.wk-order-trigger', list).forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
}

/** A gyakorlatok sorrendjének átrendezése a saját (nem natív) sorszám-
    lenyílóval: a kiválasztott szám az új pozíció, a köztük lévő
    gyakorlatok ehhez igazodva csúsznak arrébb (nem csere, hanem
    "áthelyezés"). Az `onReorder` minden sikeres átrendezés után lefut
    (pl. autosave). A natív <select> helyett azért saját felépítésű ez a
    lenyíló, mert a natív opciólista stílusozása böngészőnként/OS-enként
    megbízhatatlan és a projekt sötét témájával nem volt összhangban. */
function enableOrderSelect(list, onReorder) {
  list.addEventListener('click', (event) => {
    const trigger = event.target.closest('.wk-order-trigger');
    if (trigger) {
      const menu = $('.wk-order-menu', trigger.closest('.wk-order-select'));
      const willOpen = menu.hidden;
      closeAllOrderMenus(list);
      menu.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    const option = event.target.closest('.wk-order-option');
    if (!option) return;
    const card = option.closest('.wk-exercise');
    const cards = $$('.wk-exercise', list);
    const fromIndex = cards.indexOf(card);
    const toIndex = Number(option.dataset.index);
    closeAllOrderMenus(list);
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
  });

  // Kattintás a lenyílókon kívülre / Escape → zárás (ugyanaz a minta, mint
  // az értesítés-panelnél).
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.wk-order-select')) closeAllOrderMenus(list);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllOrderMenus(list);
  });
}

/** Az összes nyitott szett-típus lenyíló bezárása. */
function closeAllSetTypeMenus(list) {
  $$('.wk-set-type-menu', list).forEach((menu) => { menu.hidden = true; });
  $$('.wk-set-num', list).forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
}

/** A szett típusának (bemelegítő / munkasorozat / drop set) választása a
    sorszám-gombra kötött lenyílóval — ugyanaz a minta, mint a gyakorlatok
    sorrendjénél (enableOrderSelect). A típus csak címke: a sor pozícióját
    nem befolyásolja. Az `onChange` minden tényleges váltás után lefut
    (pl. autosave). */
function enableSetTypeSelect(list, onChange) {
  list.addEventListener('click', (event) => {
    const trigger = event.target.closest('.wk-set-num');
    if (trigger) {
      const row = trigger.closest('.wk-set-row');
      const menu = $('.wk-set-type-menu', trigger.parentElement);
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
      const willOpen = menu.hidden;
      closeAllSetTypeMenus(list);
      menu.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    const option = event.target.closest('.wk-set-type-option');
    if (!option) return;
    const row = option.closest('.wk-set-row');
    closeAllSetTypeMenus(list);
    if (row.dataset.setType === option.dataset.type) return;

    applySetType(row, option.dataset.type);
    renumberSets(row.parentElement); // a gomb aria-label-je a típust is mondja
    onChange();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.wk-set-type')) closeAllSetTypeMenus(list);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllSetTypeMenus(list);
  });
}


/** Az összes nyitott intenzitás-lenyíló bezárása. */
function closeAllIntensityMenus(list) {
  $$('.wk-intensity-menu', list).forEach((menu) => { menu.hidden = true; });
  $$('.wk-intensity-trigger', list).forEach((t) => t.setAttribute('aria-expanded', 'false'));
}

/** Az intenzitás-fokozat választása az időalapú sorokon. Ugyanaz a saját
    lenyíló minta, mint a szett-típusnál — a natív <select> listája
    böngészőnként másképp (és ebben a témában csúnyán) rajzolódik ki.
    Az `onChange` minden tényleges váltás után lefut (pl. autosave). */
function enableIntensitySelect(list, onChange) {
  list.addEventListener('click', (event) => {
    const trigger = event.target.closest('.wk-intensity-trigger');
    if (trigger) {
      const menu = $('.wk-intensity-menu', trigger.parentElement);
      const willOpen = menu.hidden;
      closeAllIntensityMenus(list);
      menu.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    const option = event.target.closest('.wk-intensity-option');
    if (!option) return;
    const row = option.closest('.wk-set-row');
    closeAllIntensityMenus(list);
    if (row.dataset.intensity === option.dataset.intensity) return;

    applyIntensity(row, option.dataset.intensity);
    onChange();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.wk-intensity')) closeAllIntensityMenus(list);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllIntensityMenus(list);
  });
}

/** Az összes nyitott plusz-súly menü bezárása. */
function closeAllExtraMenus(list) {
  $$('.wk-extra-menu', list).forEach((menu) => { menu.hidden = true; });
  $$('.wk-extra-trigger', list).forEach((t) => t.setAttribute('aria-expanded', 'false'));
}

/** A plusz súly menüje az időalapú sorokon. Csak nyit és zár: az ÉRTÉKET a
    benne lévő szám-mező írja, azt pedig a napló meglévő `.wk-num-input`
    figyelője menti — nem hívunk rá külön mentést, hogy egy gépelés ne
    keletkezzen kétszer. A gomb feliratát viszont itt kell frissíteni, mert a
    terv-építőnek nincs ilyen figyelője. */
function enableExtraMenu(list) {
  list.addEventListener('click', (event) => {
    const trigger = event.target.closest('.wk-extra-trigger');
    if (!trigger) return;
    const menu = $('.wk-extra-menu', trigger.parentElement);
    const willOpen = menu.hidden;
    closeAllExtraMenus(list);
    menu.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) $('.wk-set-weight', menu).focus();
  });

  list.addEventListener('input', (event) => {
    if (!event.target.matches('.wk-extra-menu .wk-set-weight')) return;
    syncExtraWeight(event.target.closest('.wk-set-row'));
  });

  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.wk-extra')) closeAllExtraMenus(list);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllExtraMenus(list);
  });
}

export { clampRpeInput, enableExtraMenu, enableIntensitySelect, enableOrderSelect, enableSetTypeSelect, handleAddSetClick, handleRemoveSetClick, handleStepClick, loadIntensityLevels, readSetRow, refreshExerciseList, renderExercise };
