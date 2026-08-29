/**
 * Gyűjtő — felület
 * ================
 * Keretrendszer nélküli ES-modul. A LÉNYEG, ami ezt az appot meghatározza:
 * **nincs szerver mögötte.** Nincs fiók, nincs bejelentkezés, nincs szinkron.
 * A gyűjtés a telefon saját adatbázisában (IndexedDB) él, az Open Food Facts-et
 * a böngésző kérdezi meg közvetlenül, és az adat csak akkor mozdul, amikor te
 * mondod: „Feltöltés a FitTrack-be" vagy „Mentés fájlba".
 *
 * Ebből következik minden más: offline nincs mit „sorba tenni", mert a mentés
 * MÁR kész — a telefonon van. Hálózat csak két dologhoz kell: az OFF
 * lekérdezéshez (enélkül is fel lehet vinni terméket) és a feltöltéshez.
 *
 * Rétegek:  db.js (IndexedDB) · off.js (Open Food Facts) · products.js
 *           (validálás) · scanner.js (kamera) · ez a fájl (felület).
 */
import { createScanner } from './scanner.js';
import { parseProduct, STATUSES } from './products.js';
import { normalizeBarcode } from '../shared/barcode.js';
import { FOOD_GROUPS } from '../shared/foodgroups.js';
import * as off from './off.js';
import {
  allProducts, getProduct, saveProduct, deleteProduct, markUploaded,
  logScan, countScansToday, exportAll, importAll,
} from './db.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  view: 'szkenneles',
  barcode: null,      // az épp szerkesztett termék vonalkódja
  kcalAuto: true,
  products: [],       // a lista utolsó betöltése (a gombok ebből dolgoznak)
};

/* ======================================================================
   Apróságok
   ====================================================================== */

let toastTimer = 0;
function toast(text, kind = 'ok') {
  const el = $('[data-toast]');
  el.textContent = text;
  el.className = `toast toast--${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

/** HTML-escape. Minden felhasználói szöveg ezen megy át innerHTML előtt. */
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

/** Tápérték kiírása — a hiányzót láthatóan hiánynak jelölve, nem nullának. */
const macro = (value, suffix = ' g') => (typeof value === 'number' ? `${value}${suffix}` : '—');

const STATUS_LABEL = { piszkozat: 'piszkozat', kesz: 'kész', feltoltve: 'feltöltve' };

const macrosHtml = (p) => `
  <dl class="macros">
    <div><dt>kcal</dt><dd>${macro(p.kcal, '')}</dd></div>
    <div><dt>fehérje</dt><dd>${macro(p.protein)}</dd></div>
    <div><dt>szénh.</dt><dd>${macro(p.carbs)}</dd></div>
    <div><dt>zsír</dt><dd>${macro(p.fat)}</dd></div>
  </dl>
  <p class="muted">100 ${esc(p.unit ?? 'g')}-ra</p>`;

/* ======================================================================
   Nézetváltás
   ====================================================================== */

const views = {
  szkenneles: $('[data-view="szkenneles"]'),
  lista: $('[data-view="lista"]'),
  feltoltes: $('[data-view="feltoltes"]'),
};

function show(view) {
  state.view = view;
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  $$('[data-tab]').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === view));

  // A kamera csak a szkennelő nézetben járhat — máshol csak az akkut enné.
  if (view !== 'szkenneles') scanner.stop();
  if (view === 'lista') renderList();
  if (view === 'feltoltes') renderUpload();
}

function route() {
  const hash = location.hash.replace('#/', '');
  show(views[hash] ? hash : 'szkenneles');
}
window.addEventListener('hashchange', route);

/* ======================================================================
   Szkennelés
   ====================================================================== */

const scanner = createScanner({
  video: $('[data-sc-video]'),
  stage: $('[data-sc-stage]'),
  torch: $('[data-sc-torch]'),
  onCode: (code) => handleCode(code),
  onStatus: (text) => { $('[data-sc-status]').textContent = text; },
  onError: (text) => {
    const el = $('[data-sc-error]');
    el.textContent = text || '';
    el.hidden = !text;
  },
});

$('[data-action="scan-start"]').addEventListener('click', async () => {
  const started = await scanner.start();
  $('[data-action="scan-start"]').hidden = started;
  $('[data-action="scan-stop"]').hidden = !started;
});

$('[data-action="scan-stop"]').addEventListener('click', () => {
  scanner.stop();
  $('[data-action="scan-start"]').hidden = false;
  $('[data-action="scan-stop"]').hidden = true;
});

$('[data-form="manual"]').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = event.target.elements.code;
  const code = input.value.replace(/\D/g, '');
  if (!code) return;
  input.value = '';
  handleCode(code);
});

/**
 * Egy beolvasott kód feldolgozása — az app központi elágazása.
 *
 * A sorrend: SAJÁT GYŰJTÉS → Open Food Facts. Az elsőt a telefon tudja
 * hálózat nélkül is; a másodikat csak online, és ha nem megy, azt KIMONDJUK,
 * nem hallgatjuk el „hiányzik"-ként.
 */
async function handleCode(raw) {
  scanner.pause();

  const barcode = normalizeBarcode(raw);
  if (!barcode) {
    renderResult({ status: 'hibas', barcode: String(raw).replace(/\D/g, '') });
    return;
  }

  const mine = await getProduct(barcode);
  if (mine) {
    await logScan(barcode, 'gyujtott');
    renderResult({ status: 'gyujtott', barcode, product: mine });
    return;
  }

  $('[data-sc-status]').textContent = 'Keresés az Open Food Facts-ben…';
  const hit = await off.lookup(barcode);
  $('[data-sc-status]').textContent = scanner.isRunning() ? 'Tartsd a vonalkódot a keretbe.' : '';

  if (!hit.ok) {
    await logScan(barcode, 'nem-elerheto');
    renderResult({ status: hit.reason === 'offline' ? 'offline' : 'ismeretlen', barcode, reason: hit.reason });
    openForm({ barcode });
    return;
  }

  if (hit.product) {
    await logScan(barcode, 'off');
    renderResult({ status: 'off', barcode, product: hit.product });
    return;
  }

  await logScan(barcode, 'uj');
  renderResult({ status: 'uj', barcode });
  // A hiányzó terméknél nem kérdezünk rá, hogy akarja-e felvinni: a boltban
  // pont ezért állunk a polc előtt. Az űrlap rögtön nyílik.
  openForm({ barcode });
}

/** Az eredmény-kártya. A `status` dönti el a színt és a felkínált lépést. */
function renderResult(data) {
  const box = $('[data-result]');
  const barcode = esc(data.barcode);
  const p = data.product;

  const cards = {
    gyujtott: () => `
      <div class="result__card result__card--ok">
        <p class="result__badge">Megvan a gyűjtésben</p>
        <h2>${esc(p.name)}</h2>
        ${p.brand ? `<p class="muted">${esc(p.brand)}</p>` : ''}
        ${macrosHtml(p)}
        <p class="muted">${esc(STATUS_LABEL[p.status] ?? p.status)}</p>
        <div class="result__actions">
          <button type="button" class="btn btn--secondary" data-act="edit">Javítás</button>
          <button type="button" class="btn btn--primary" data-act="next">Következő</button>
        </div>
      </div>`,

    off: () => `
      <div class="result__card result__card--info">
        <p class="result__badge">Az Open Food Facts ismeri</p>
        <h2>${esc(p.name)}</h2>
        ${macrosHtml(p)}
        <p class="muted">A FitTrack ezt már ma is megtalálja — nem kell felvinni.
           Ha a tápérték hibás vagy hiányos, vedd fel a sajátunkat.</p>
        <div class="result__actions">
          <button type="button" class="btn btn--secondary" data-act="prefill">Mégis felviszem</button>
          <button type="button" class="btn btn--primary" data-act="next">Következő</button>
        </div>
      </div>`,

    uj: () => `
      <div class="result__card result__card--new">
        <p class="result__badge">Ez hiányzik</p>
        <h2>${barcode}</h2>
        <p>Nincs meg sem a gyűjtésben, sem az Open Food Facts-ben. Írd le a
           csomagolásról — ezért jöttünk.</p>
      </div>`,

    offline: () => `
      <div class="result__card result__card--warn">
        <p class="result__badge">Nincs hálózat</p>
        <h2>${barcode}</h2>
        <p>Most nem tudjuk megkérdezni az Open Food Facts-et, tehát nem tudjuk,
           ismeri-e. A gyűjtésünkben nincs benne — ha a kezedben a csomagolás,
           vidd fel nyugodtan. A duplikátumot a feltöltés kiszűri.</p>
      </div>`,

    ismeretlen: () => `
      <div class="result__card result__card--warn">
        <p class="result__badge">Az Open Food Facts nem válaszol</p>
        <h2>${barcode}</h2>
        <p>${esc(data.reason === 'timeout' ? 'Túl lassú a hálózat.' : `Hiba: ${data.reason}`)}
           A kód érvényes, tehát felviheted kézzel.</p>
      </div>`,

    hibas: () => `
      <div class="result__card result__card--warn">
        <p class="result__badge">Érvénytelen kód</p>
        <h2>${barcode || '—'}</h2>
        <p>Ez nem érvényes vonalkód (8, 12, 13 vagy 14 számjegy, helyes
           ellenőrzőszámmal). Olvasd be újra, vagy írd be kézzel.</p>
        <div class="result__actions">
          <button type="button" class="btn btn--primary" data-act="next">Újra</button>
        </div>
      </div>`,
  };

  box.innerHTML = (cards[data.status] ?? cards.hibas)();
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  $('[data-act="next"]', box)?.addEventListener('click', nextScan);
  $('[data-act="edit"]', box)?.addEventListener('click', () => openForm(p));
  $('[data-act="prefill"]', box)?.addEventListener('click', () => openForm({ ...p, barcode: data.barcode }));
}

/** Vissza a szkennelésbe: a kártya és az űrlap eltűnik, a kamera folytatja. */
function nextScan() {
  $('[data-result]').hidden = true;
  closeForm();
  scanner.resume();
  if (!scanner.isRunning()) $('[data-form="manual"]').elements.code.focus();
}

/* ======================================================================
   A termék-űrlap
   ====================================================================== */

const form = $('[data-form="product"]');

function openForm(product = {}) {
  state.barcode = product.barcode ?? null;
  state.kcalAuto = product.kcalAuto ?? true;

  form.hidden = false;
  $('[data-form-title]').textContent = product.status ? 'Tétel javítása' : 'Új termék felvitele';
  $('[data-form-barcode]').textContent = state.barcode ?? '';

  const f = form.elements;
  f.name.value = product.name ?? '';
  f.brand.value = product.brand ?? '';
  f.group.value = FOOD_GROUPS.includes(product.group) ? product.group : '';
  f.protein.value = product.protein ?? '';
  f.carbs.value = product.carbs ?? '';
  f.fat.value = product.fat ?? '';
  f.kcal.value = product.kcal ?? '';
  f.store.value = product.store ?? '';
  f.note.value = product.note ?? '';

  const [portion] = product.portions ?? [];
  f.portionLabel.value = portion?.[0] ?? '';
  f.portionGrams.value = portion?.[1] ?? '';

  $$('input[name="unit"]', form).forEach((radio) => {
    radio.checked = radio.value === (product.unit ?? 'g');
  });

  $('[data-product-error]').hidden = true;
  updateKcal();
  f.name.focus();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeForm() {
  form.hidden = true;
  form.reset();
  state.barcode = null;
  state.kcalAuto = true;
}

$('[data-action="cancel-product"]').addEventListener('click', nextScan);

const num = (input) => {
  const value = Number(String(input.value).replace(',', '.'));
  return Number.isFinite(value) && input.value !== '' ? value : null;
};

/* A kalória élő számítása. A felület ugyanazt a képletet mutatja, amit a
   validálás és a szerver is számol (Atwater 4/4/9) — így senki nem lepődik
   meg mentés után. */
function updateKcal() {
  const hint = $('[data-kcal-hint]');
  $('[data-action="kcal-auto"]').hidden = state.kcalAuto;

  if (!state.kcalAuto) {
    hint.textContent = 'Kézzel megadott érték — ellenőrizzük, hogy összefér-e a makrókkal.';
    return;
  }

  const p = num(form.elements.protein);
  const c = num(form.elements.carbs);
  const f = num(form.elements.fat);
  if (p === null || c === null || f === null) {
    form.elements.kcal.value = '';
    hint.textContent = 'Add meg mind a három makrót, és kiszámoljuk. Enélkül a tétel piszkozat marad.';
    return;
  }
  form.elements.kcal.value = Math.round(p * 4 + c * 4 + f * 9);
  hint.textContent = 'A makrókból számolva (4/4/9). Ha a csomagoláson más áll, írd felül.';
}

['protein', 'carbs', 'fat'].forEach((name) => {
  form.elements[name].addEventListener('input', updateKcal);
});

form.elements.kcal.addEventListener('input', () => {
  state.kcalAuto = false;
  updateKcal();
});

$('[data-action="kcal-auto"]').addEventListener('click', () => {
  state.kcalAuto = true;
  updateKcal();
});

async function save(status) {
  const errorEl = $('[data-product-error]');
  errorEl.hidden = true;

  const f = form.elements;
  const portionLabel = f.portionLabel.value.trim();
  const portionGrams = num(f.portionGrams);

  const parsed = parseProduct({
    barcode: state.barcode,
    name: f.name.value,
    brand: f.brand.value,
    group: f.group.value,
    unit: $('input[name="unit"]:checked', form)?.value ?? 'g',
    protein: f.protein.value === '' ? undefined : num(f.protein),
    carbs: f.carbs.value === '' ? undefined : num(f.carbs),
    fat: f.fat.value === '' ? undefined : num(f.fat),
    kcal: f.kcal.value === '' ? undefined : num(f.kcal),
    kcalMode: state.kcalAuto ? 'auto' : 'manual',
    portions: portionLabel && portionGrams ? [[portionLabel, portionGrams]] : [],
    store: f.store.value,
    note: f.note.value,
    status,
  });

  if (!parsed.ok) {
    errorEl.textContent = parsed.error;
    errorEl.hidden = false;
    return;
  }

  try {
    const saved = await saveProduct(parsed.value);
    toast(saved.status === 'kesz' ? 'Mentve — kész tétel.' : 'Mentve piszkozatként.');
    nextScan();
    refreshCounts();
  } catch (err) {
    // Ha az IndexedDB elszáll (privát ablak, tele a tárhely), azt KI KELL
    // MONDANI: a felhasználó különben azt hinné, hogy a munkája megvan.
    errorEl.textContent = `A telefon nem tudta elmenteni: ${err.message}`;
    errorEl.hidden = false;
  }
}

form.addEventListener('submit', (event) => { event.preventDefault(); save('kesz'); });
$('[data-action="save-draft"]').addEventListener('click', () => save('piszkozat'));

/* ======================================================================
   A gyűjtés listája
   ====================================================================== */

$$('[data-status-filter] input').forEach((radio) => radio.addEventListener('change', renderList));

let searchTimer = 0;
$('[data-search]').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderList, 250);
});

async function renderList() {
  const list = $('[data-list]');
  const status = $('[data-status-filter] input:checked')?.value ?? '';
  const q = $('[data-search]').value.trim().toLowerCase();

  state.products = await allProducts();
  const shown = state.products.filter((p) => {
    if (status && p.status !== status) return false;
    if (!q) return true;
    return `${p.name} ${p.brand} ${p.barcode}`.toLowerCase().includes(q);
  });

  if (!shown.length) {
    list.innerHTML = `<p class="empty">${state.products.length
      ? 'Erre a szűrőre nincs találat.'
      : 'Még nincs itt semmi. Menj a Szkennelés fülre, és kezdd el!'}</p>`;
    return;
  }

  list.innerHTML = shown.map((p) => `
    <article class="item item--${esc(p.status)}">
      <div class="item__head">
        <h3>${esc(p.name)}</h3>
        <span class="item__status">${esc(STATUS_LABEL[p.status] ?? p.status)}</span>
      </div>
      <p class="item__meta">
        ${esc(p.barcode)}${p.brand ? ` · ${esc(p.brand)}` : ''}${p.group ? ` · ${esc(p.group)}` : ''}
      </p>
      <dl class="macros macros--sm">
        <div><dt>kcal</dt><dd>${macro(p.kcal, '')}</dd></div>
        <div><dt>fehérje</dt><dd>${macro(p.protein)}</dd></div>
        <div><dt>szénh.</dt><dd>${macro(p.carbs)}</dd></div>
        <div><dt>zsír</dt><dd>${macro(p.fat)}</dd></div>
      </dl>
      ${p.store || p.note ? `<p class="item__meta">${esc([p.store, p.note].filter(Boolean).join(' · '))}</p>` : ''}
      <div class="item__actions">
        <button type="button" class="btn btn--secondary btn--sm" data-edit="${esc(p.barcode)}">Javítás</button>
        <button type="button" class="btn btn--ghost btn--sm" data-delete="${esc(p.barcode)}">Törlés</button>
      </div>
    </article>`).join('');

  $$('[data-edit]', list).forEach((btn) => btn.addEventListener('click', () => {
    location.hash = '#/szkenneles';
    show('szkenneles');
    $('[data-result]').hidden = true;
    openForm(state.products.find((p) => p.barcode === btn.dataset.edit));
  }));

  $$('[data-delete]', list).forEach((btn) => btn.addEventListener('click', async () => {
    const product = state.products.find((p) => p.barcode === btn.dataset.delete);
    if (!confirm(`Törlöd a gyűjtésből: ${product.name}?`)) return;
    await deleteProduct(product.barcode);
    toast('Törölve.');
    renderList();
    refreshCounts();
  }));
}

/* ======================================================================
   Feltöltés és mentés
   ----------------------------------------------------------------------
   Három út, és mind a háromra szükség van:
     - FELTÖLTÉS a FitTrack-be: ez a cél. Mivel a Gyűjtőt ugyanaz a szerver
       szolgálja ki, a meglévő FitTrack-munkamenet süti magától megy vele —
       nincs külön fiók, nincs külön jelszó.
     - MENTÉS FÁJLBA: biztonsági másolat. A böngésző kitörölheti a saját adatait
       (iOS-en 7 nap tétlenség után, ha az app nincs kitéve a kezdőképernyőre) —
       hetek munkája nem függhet ettől.
     - VISSZATÖLTÉS FÁJLBÓL: ezzel fésülhető össze KÉT TELEFON gyűjtése is.
   ====================================================================== */

async function renderUpload() {
  const products = await allProducts();
  const kesz = products.filter((p) => p.status === 'kesz');
  const piszkozat = products.filter((p) => p.status === 'piszkozat');
  const feltoltve = products.filter((p) => p.status === 'feltoltve');

  $('[data-upload-summary]').innerHTML = `
    <div class="stats">
      <div class="stat"><span>${products.length}</span>összes</div>
      <div class="stat"><span>${piszkozat.length}</span>piszkozat</div>
      <div class="stat"><span>${kesz.length}</span>feltölthető</div>
      <div class="stat"><span>${feltoltve.length}</span>feltöltve</div>
    </div>
    ${piszkozat.length ? `<p class="muted">${piszkozat.length} piszkozat még hiányos —
       ezek nem mennek fel. Egészítsd ki őket a Gyűjtés fülön.</p>` : ''}`;

  $('[data-action="upload"]').disabled = kesz.length === 0;
  $('[data-action="upload"]').textContent = kesz.length
    ? `Feltöltés a FitTrack-be (${kesz.length})`
    : 'Nincs feltölthető tétel';
}

$('[data-action="upload"]').addEventListener('click', async () => {
  const button = $('[data-action="upload"]');
  const resultEl = $('[data-upload-result]');
  const products = (await allProducts()).filter((p) => p.status === 'kesz');
  if (!products.length) return;

  button.disabled = true;
  resultEl.hidden = true;

  let res;
  try {
    res = await fetch('/api/foods/collected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products }),
    });
  } catch {
    resultEl.className = 'form-error';
    resultEl.textContent = 'Nincs hálózat — a gyűjtés a telefonon megmarad, próbáld később.';
    resultEl.hidden = false;
    button.disabled = false;
    return;
  }

  if (res.status === 401) {
    resultEl.className = 'form-error';
    resultEl.innerHTML = 'Ehhez be kell lépned a FitTrack-be. '
      + '<a href="/" class="link">Belépés →</a> — utána gyere vissza ide.';
    resultEl.hidden = false;
    button.disabled = false;
    return;
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    resultEl.className = 'form-error';
    resultEl.textContent = json?.error ?? `A feltöltés nem sikerült (HTTP ${res.status}).`;
    resultEl.hidden = false;
    button.disabled = false;
    return;
  }

  // Csak a TÉNYLEG átment tételeket jelöljük feltöltöttnek: amit a szerver
  // visszadobott, az piszkozatként marad, hogy javítható legyen.
  const rejectedCodes = new Set((json.rejected ?? []).map((r) => r.barcode));
  await markUploaded(products.filter((p) => !rejectedCodes.has(p.barcode)).map((p) => p.barcode));

  resultEl.className = json.rejected?.length ? 'form-error' : 'form-ok';
  resultEl.innerHTML = `<strong>${json.added} új, ${json.updated} frissített termék.</strong>`
    + (json.skipped ? ` ${json.skipped} tételnél a FitTrack-ben frissebb mérés van — azokat nem írtuk felül.` : '')
    + (json.rejected?.length
      ? `<br>${json.rejected.length} tétel nem ment át: ${esc(json.rejected.map((r) => `${r.barcode} (${r.error})`).join('; '))}`
      : '')
    + `<br>A FitTrack most ${json.count} begyűjtött terméket ismer.`;
  resultEl.hidden = false;

  toast(`${json.added + json.updated} termék felment a FitTrack-be.`);
  renderUpload();
  refreshCounts();
});

$('[data-action="save-file"]').addEventListener('click', async () => {
  const data = await exportAll();
  if (!data.products.length) return toast('Még nincs mit menteni.', 'error');

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gyujtes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  // A blob-URL-t el kell engedni, különben a memóriában marad az egész fájl.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`${data.products.length} termék elmentve fájlba.`);
});

$('[data-load-file]').addEventListener('change', async (event) => {
  const [file] = event.target.files ?? [];
  if (!file) return;
  event.target.value = ''; // ugyanaz a fájl újra kiválasztható legyen

  try {
    const stats = await importAll(JSON.parse(await file.text()));
    toast(`${stats.added} új, ${stats.updated} frissített, ${stats.skipped} kihagyott tétel.`);
    renderUpload();
    refreshCounts();
  } catch (err) {
    toast(`Nem sikerült beolvasni: ${err.message}`, 'error');
  }
});

/* ======================================================================
   Fejléc-számlálók és a tárolás-figyelmeztetés
   ====================================================================== */

async function refreshCounts() {
  const products = await allProducts();
  $('[data-count-total]').textContent = products.length;
  $('[data-count-scans]').textContent = await countScansToday();
}

/* A böngésző a saját adatait kitörölheti. iOS-en a Safari 7 nap tétlenség után
   takarít — DE a kezdőképernyőre kitett appot békén hagyja. Ezt egyszer, nem
   tolakodóan kimondjuk; aki már kitette, annak nem szólunk. */
function storageHint() {
  const installed = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  if (installed || localStorage.getItem('gyujto.hintSeen')) return;

  const bar = $('[data-storage-hint]');
  bar.hidden = false;
  $('[data-action="hint-close"]').addEventListener('click', () => {
    bar.hidden = true;
    try { localStorage.setItem('gyujto.hintSeen', '1'); } catch { /* privát ablak */ }
  });
}

/* ======================================================================
   Indulás
   ====================================================================== */

async function init() {
  // A kategória-legördülő a KÖZÖS listából épül (public/shared/foodgroups.js),
  // nem szerver-hívásból: a boltban nincs kitől megkérdezni.
  $('[data-group-select]').innerHTML = '<option value="">— nincs megadva —</option>'
    + FOOD_GROUPS.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');

  try {
    await refreshCounts();
  } catch (err) {
    toast(`Az adatbázis nem nyílt meg: ${err.message}`, 'error');
  }

  storageHint();
  route();

  /* A service worker az app-héjat gyorsítótárazza, hogy a kezdőképernyőről net
     nélkül is elinduljon. A `/api/` és az OFF soha nem cache-elődik ott. */
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Enélkül is megy minden, csak offline nem indul újra — nem hiba.
    });
  }
}

// A STATUSES-t a felület nem használja közvetlenül, de a modul szerződésének
// része: ha valaki új állapotot vesz fel, itt lássa, hogy a szűrők is kellenek.
void STATUSES;

init();
