/**
 * Gyűjtő — felület
 * ================
 * Egyetlen modul, keretrendszer nélkül (mint a fő app). Négy rétegre bomlik:
 *
 *   1. `api`      — a szerverrel beszél, JSON-t ad vissza, hibát nem dob;
 *   2. `queue`    — az OFFLINE SOR: minden írás ide megy először, és onnan
 *                   szinkronizál. Ez az app lelke — a boltban gyakran nincs net;
 *   3. nézetek    — belépés / szkennelés / lista, hash-alapú váltással;
 *   4. `scanner`  — a kamera (külön modul: scanner.js).
 *
 * A LEGFONTOSABB TERVEZÉSI DÖNTÉS: a felhasználó munkája SOHA nem veszhet el a
 * hálózat miatt. Minden mentés előbb a sorba kerül, és csak utána próbál
 * felmenni. Ha nincs net, a felület ezt kiírja, de a gyűjtés megy tovább.
 */
import { createScanner } from './scanner.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* ======================================================================
   1. API-réteg
   ====================================================================== */

/**
 * Egy API-hívás. SOHA nem dob: a hálózati hibát is `{ ok: false }`-ként adja
 * vissza, mert a hívóknak ugyanúgy kell kezelniük, mint egy 500-at — a
 * különbség csak az üzenetben van.
 */
async function api(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* nem JSON */ }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null, offline: true };
  }
}

/* ======================================================================
   2. Offline sor
   ----------------------------------------------------------------------
   A `localStorage` a helyes tár ide: kicsi, szinkron, és túléli az app
   bezárását — a boltban a telefon képernyője elalszik, a fül kiesik a
   memóriából, és a félórányi gyűjtés nem tűnhet el emiatt.

   Minden tétel kap egy `clientId`-t. Ez teszi a beküldést idempotenssé: a
   megszakadt válasz utáni újrapróbálás nem duplázhat — ami pont akkor
   történik, amikor a hálózat rossz, tehát mindig.
   ====================================================================== */

const QUEUE_KEY = 'gyujto.queue';
const BARCODES_KEY = 'gyujto.barcodes';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const queue = {
  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return []; // sérült tartalom: inkább üres sor, mint összeomló app
    }
  },
  write(items) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
    } catch {
      toast('A telefon tárhelye betelt — szinkronizálj, mielőtt folytatod!', 'error');
    }
  },
  push(item) {
    const items = queue.read();
    items.push({ clientId: uid(), createdAt: new Date().toISOString(), ...item });
    queue.write(items);
    renderSyncBar();
  },
  size: () => queue.read().length,
};

/** A már gyűjtött vonalkódok — offline ebből tudjuk, hogy egy termék megvan. */
const known = {
  read() {
    try {
      const raw = JSON.parse(localStorage.getItem(BARCODES_KEY) ?? '[]');
      return new Set(Array.isArray(raw) ? raw : []);
    } catch {
      return new Set();
    }
  },
  write(set) {
    try { localStorage.setItem(BARCODES_KEY, JSON.stringify([...set])); } catch { /* tele van */ }
  },
  add(barcode) {
    const set = known.read();
    set.add(barcode);
    known.write(set);
  },
  has: (barcode) => known.read().has(barcode),
};

let syncing = false;

/**
 * A sor felküldése. Egy kéréssel megy az egész köteg; a szerver TÉTELENKÉNT
 * válaszol, ezért a sikeres sorok kiesnek, a hibásak viszont NEM ragadnak be
 * örökre: a validálási hibát jelezzük, és eldobjuk (a sor különben minden
 * szinkronnál újra próbálná ugyanazt), a hálózati hibát viszont megtartjuk.
 */
async function flushQueue({ silent = false } = {}) {
  const items = queue.read();
  if (!items.length || syncing) return;

  syncing = true;
  renderSyncBar();

  const res = await api('POST', '/api/sync', { items: items.slice(0, 200) });
  syncing = false;

  if (!res.ok) {
    if (!silent) {
      toast(res.offline
        ? 'Nincs hálózat — a tételek a telefonon várakoznak.'
        : 'A szinkronizálás nem sikerült. Később újrapróbáljuk.', 'error');
    }
    renderSyncBar();
    return;
  }

  const feldolgozott = new Set();
  let hibas = 0;
  for (const result of res.json.results ?? []) {
    feldolgozott.add(result.clientId);
    if (!result.ok) hibas += 1;
  }
  queue.write(items.filter((item) => !feldolgozott.has(item.clientId)));

  if (!silent) {
    const kesz = feldolgozott.size - hibas;
    toast(hibas
      ? `${kesz} tétel felment, ${hibas} hibás volt (ellenőrizd a listában).`
      : `${kesz} tétel felment.`, hibas ? 'error' : 'ok');
  }
  renderSyncBar();
  await refreshBarcodes();
  if (state.view === 'lista') renderList();
}

/* ======================================================================
   3. Állapot és nézetváltás
   ====================================================================== */

const state = {
  user: null,
  groups: [],
  view: 'belepes',
  authMode: 'login',      // 'login' | 'register'
  barcode: null,          // az épp szerkesztett termék vonalkódja
  editingId: null,        // a lista felől nyitott tétel
  kcalAuto: true,
};

const views = {
  belepes: $('[data-view="belepes"]'),
  szkenneles: $('[data-view="szkenneles"]'),
  lista: $('[data-view="lista"]'),
};

function show(view) {
  state.view = view;
  for (const [name, el] of Object.entries(views)) el.hidden = name !== view;
  $('[data-app-header]').hidden = !state.user;
  $$('[data-tab]').forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.tab === view);
  });

  // A kamera csak a szkennelő nézetben járhat — máshol csak az akkut enné.
  if (view !== 'szkenneles') scanner?.stop();
  if (view === 'lista') renderList();
}

/** Hash → nézet. Belépés nélkül minden út a belépéshez vezet. */
function route() {
  const hash = location.hash.replace('#/', '') || 'szkenneles';
  if (!state.user) return show('belepes');
  show(hash === 'lista' ? 'lista' : 'szkenneles');
}
window.addEventListener('hashchange', route);

/* ======================================================================
   4. Apróságok: toast, escape, formázás
   ====================================================================== */

let toastTimer = 0;
function toast(text, kind = 'ok') {
  const el = $('[data-toast]');
  el.textContent = text;
  el.className = `toast toast--${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

/** HTML-escape. Minden felhasználói szöveg ezen megy át, mielőtt innerHTML-be
    kerülne — a terméknevet más ember írta be, és a gyűjtés közös. */
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

/** Egy tápérték kiírása, a hiányzót láthatóan hiánynak jelölve. */
const macro = (value, suffix = ' g') => (typeof value === 'number' ? `${value}${suffix}` : '—');

const STATUS_LABEL = { piszkozat: 'piszkozat', kesz: 'kész', exportalva: 'exportálva' };

/* ======================================================================
   5. Belépés
   ====================================================================== */

const authForm = $('[data-form="auth"]');

function setAuthMode(mode) {
  state.authMode = mode;
  const register = mode === 'register';
  $('[data-auth-title]').textContent = register ? 'Regisztráció' : 'Belépés';
  $('[data-auth-submit]').textContent = register ? 'Fiók létrehozása' : 'Belépés';
  $('[data-field="displayName"]').hidden = !register;
  $('[data-action="toggle-auth-mode"]').textContent = register
    ? 'Van már fiókom — belépek'
    : 'Nincs még fiókom — regisztrálok';
  authForm.password.autocomplete = register ? 'new-password' : 'current-password';
  $('[data-auth-error]').hidden = true;
}

$('[data-action="toggle-auth-mode"]').addEventListener('click', () => {
  setAuthMode(state.authMode === 'login' ? 'register' : 'login');
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = $('[data-auth-error]');
  errorEl.hidden = true;

  const body = {
    username: authForm.username.value.trim(),
    password: authForm.password.value,
    displayName: authForm.displayName.value.trim(),
  };
  const url = state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';

  const res = await api('POST', url, body);
  if (!res.ok) {
    errorEl.textContent = res.offline
      ? 'Nincs hálózat — a belépéshez net kell. (A már belépett munkamenet offline is működik.)'
      : (res.json?.error ?? 'Nem sikerült a belépés.');
    errorEl.hidden = false;
    return;
  }

  authForm.reset();
  state.user = res.json;
  await afterLogin();
});

$('[data-action="logout"]').addEventListener('click', async () => {
  if (queue.size() && !confirm(`${queue.size()} tétel még nem ment fel. Biztosan kilépsz?`)) return;
  await api('POST', '/api/auth/logout');
  state.user = null;
  scanner?.stop();
  location.hash = '';
  show('belepes');
});

/** Belépés után: a felület felépítése és a várakozó sor felküldése. */
async function afterLogin() {
  $('[data-user-name]').textContent = state.user.displayName || state.user.username;
  await loadGroups();
  await refreshBarcodes();
  location.hash = '#/szkenneles';
  show('szkenneles');
  await flushQueue({ silent: true });
  renderSyncBar();
}

async function loadGroups() {
  const res = await api('GET', '/api/groups');
  if (!res.ok) return;
  state.groups = res.json;
  const select = $('[data-group-select]');
  select.innerHTML = '<option value="">— nincs megadva —</option>'
    + state.groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
}

/** A gyűjtött kódok letöltése — ettől tud a felület OFFLINE is szólni, hogy
    egy terméket már felvittünk. Enélkül duplán dolgoznánk a boltban. */
async function refreshBarcodes() {
  const res = await api('GET', '/api/barcodes');
  if (res.ok && Array.isArray(res.json)) known.write(new Set(res.json));
}

/* ======================================================================
   6. Szinkron-sáv
   ====================================================================== */

function renderSyncBar() {
  const bar = $('[data-sync-bar]');
  const count = queue.size();
  const offline = !navigator.onLine;

  if (!count && !offline) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.classList.toggle('sync-bar--offline', offline);
  $('[data-sync-text]').textContent = syncing
    ? 'Szinkronizálás…'
    : `${offline ? 'Nincs hálózat' : 'Feltöltésre vár'} · ${count} tétel`;
}

$('[data-sync-bar]').addEventListener('click', () => flushQueue());
window.addEventListener('online', () => { renderSyncBar(); flushQueue({ silent: true }); });
window.addEventListener('offline', renderSyncBar);

/* ======================================================================
   7. Szkennelés
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
 * Offline a szerver nem kérdezhető meg, de a munka nem állhat meg: a helyben
 * tárolt kódlistából megmondjuk, gyűjtöttük-e már, a szkennelést pedig sorba
 * tesszük. Ami nincs a listában, azt fel lehet vinni — a szerver majd eldönti,
 * hogy az Open Food Facts ismerte-e.
 */
async function handleCode(code) {
  scanner.pause();
  const scanClientId = uid();

  if (!navigator.onLine) {
    queue.push({ type: 'scan', barcode: code, outcome: 'uj', scannedAt: new Date().toISOString() });
    if (known.has(code)) {
      renderResult({ status: 'gyujtott-offline', barcode: code });
    } else {
      renderResult({ status: 'uj', barcode: code, offline: true });
      openProductForm({ barcode: code });
    }
    return;
  }

  $('[data-sc-status]').textContent = 'Keresés…';
  const res = await api('GET', `/api/lookup/${encodeURIComponent(code)}?clientId=${scanClientId}`);
  $('[data-sc-status]').textContent = scanner.isRunning() ? 'Tartsd a vonalkódot a keretbe.' : '';

  if (res.offline) {
    // Menet közben szakadt meg a net: ugyanaz az ág, mint fent.
    queue.push({ type: 'scan', barcode: code, outcome: 'uj', scannedAt: new Date().toISOString() });
    renderResult({ status: known.has(code) ? 'gyujtott-offline' : 'uj', barcode: code, offline: true });
    if (!known.has(code)) openProductForm({ barcode: code });
    return;
  }

  if (res.status === 400) {
    renderResult({ status: 'hibas', barcode: code, error: res.json?.error });
    return;
  }

  const data = res.json ?? {};
  renderResult({ ...data, barcode: data.barcode ?? code });

  // A hiányzó terméknél nem kérdezünk rá, hogy akarja-e felvinni: a boltban
  // pont ezért állunk a polc előtt. Az űrlap rögtön nyílik.
  if (data.status === 'uj') openProductForm({ barcode: data.barcode ?? code });
}

/** Az eredmény-kártya. A `status` dönti el a színt és a felkínált lépést. */
function renderResult(data) {
  const box = $('[data-result]');
  const barcode = esc(data.barcode);
  const p = data.product;

  const macros = (product) => `
    <dl class="macros">
      <div><dt>kcal</dt><dd>${macro(product.kcal, '')}</dd></div>
      <div><dt>fehérje</dt><dd>${macro(product.protein)}</dd></div>
      <div><dt>szénh.</dt><dd>${macro(product.carbs)}</dd></div>
      <div><dt>zsír</dt><dd>${macro(product.fat)}</dd></div>
    </dl>
    <p class="muted">100 ${esc(product.unit ?? 'g')}-ra</p>`;

  const kartyak = {
    gyujtott: () => `
      <div class="result__card result__card--ok">
        <p class="result__badge">Megvan a gyűjtésben</p>
        <h2>${esc(p.name)}</h2>
        ${p.brand ? `<p class="muted">${esc(p.brand)}</p>` : ''}
        ${macros(p)}
        <p class="muted">${esc(STATUS_LABEL[p.status] ?? p.status)}${
  p.createdByName ? ` · felvitte: ${esc(p.createdByName)}` : ''}</p>
        <div class="result__actions">
          <button type="button" class="btn btn--secondary" data-action="edit-result">Javítás</button>
          <button type="button" class="btn btn--primary" data-action="next">Következő</button>
        </div>
      </div>`,

    'gyujtott-offline': () => `
      <div class="result__card result__card--ok">
        <p class="result__badge">Megvan a gyűjtésben</p>
        <h2>${barcode}</h2>
        <p>Ezt a kódot már felvittük — nem kell újra. (Offline vagy, ezért a
           részleteket most nem tudjuk megmutatni.)</p>
        <div class="result__actions">
          <button type="button" class="btn btn--primary" data-action="next">Következő</button>
        </div>
      </div>`,

    off: () => `
      <div class="result__card result__card--info">
        <p class="result__badge">Az Open Food Facts ismeri</p>
        <h2>${esc(p.name)}</h2>
        ${macros(p)}
        <p class="muted">A FitTrack ezt már ma is megtalálja — nem kell felvinni.
           Ha a tápérték hibás vagy hiányos, felviheted a sajátunkat.</p>
        <div class="result__actions">
          <button type="button" class="btn btn--secondary" data-action="add-anyway">Mégis felviszem</button>
          <button type="button" class="btn btn--primary" data-action="next">Következő</button>
        </div>
      </div>`,

    uj: () => `
      <div class="result__card result__card--new">
        <p class="result__badge">Ez hiányzik${data.offline ? ' (offline)' : ''}</p>
        <h2>${barcode}</h2>
        <p>Nincs meg sem a gyűjtésben, sem az Open Food Facts-ben. Írd le a
           csomagolásról — ezért jöttünk.</p>
      </div>`,

    ismeretlen: () => `
      <div class="result__card result__card--warn">
        <p class="result__badge">Az Open Food Facts nem elérhető</p>
        <h2>${barcode}</h2>
        <p>${esc(data.error ?? 'Most nem tudjuk megkérdezni.')} A kód érvényes,
           tehát nyugodtan felviheted kézzel.</p>
        <div class="result__actions">
          <button type="button" class="btn btn--secondary" data-action="add-anyway">Felviszem kézzel</button>
          <button type="button" class="btn btn--primary" data-action="next">Következő</button>
        </div>
      </div>`,

    hibas: () => `
      <div class="result__card result__card--warn">
        <p class="result__badge">Érvénytelen kód</p>
        <h2>${barcode}</h2>
        <p>${esc(data.error ?? 'Ez nem tűnik érvényes vonalkódnak.')}</p>
        <div class="result__actions">
          <button type="button" class="btn btn--primary" data-action="next">Újra</button>
        </div>
      </div>`,
  };

  box.innerHTML = (kartyak[data.status] ?? kartyak.hibas)();
  box.hidden = false;
  box.dataset.barcode = data.barcode ?? '';
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  /* A gombokat itt kötjük be, nem delegálva: a kártya minden szkennelésnél
     újraépül, és a delegálás ebben a kis felületben csak elrejtené, mi hova
     tartozik. */
  $('[data-action="next"]', box)?.addEventListener('click', nextScan);
  $('[data-action="edit-result"]', box)?.addEventListener('click', () => openProductForm(p));
  $('[data-action="add-anyway"]', box)?.addEventListener('click', () => openProductForm({
    ...(p ?? {}), barcode: data.barcode, id: null, source: p ? 'openfoodfacts' : 'manual',
  }));
}

/** Vissza a szkennelésbe: a kártya és az űrlap eltűnik, a kamera folytatja. */
function nextScan() {
  $('[data-result]').hidden = true;
  closeProductForm();
  scanner.resume();
  if (!scanner.isRunning()) $('[data-form="manual"]').elements.code.focus();
}

/* ======================================================================
   8. A termék-űrlap
   ====================================================================== */

const productForm = $('[data-form="product"]');

/**
 * Az űrlap megnyitása. `product` lehet: csak egy vonalkód (új tétel), egy
 * Open-Food-Facts-találat (előkitöltve), vagy a gyűjtés egy sora (javítás).
 */
function openProductForm(product = {}) {
  state.barcode = product.barcode ?? null;
  state.editingId = product.id ?? null;
  state.kcalAuto = product.kcalAuto ?? true;

  productForm.hidden = false;
  $('[data-form-title]').textContent = state.editingId ? 'Tétel javítása' : 'Új termék felvitele';
  $('[data-form-barcode]').textContent = state.barcode ?? '';

  productForm.elements.name.value = product.name ?? '';
  productForm.elements.brand.value = product.brand ?? '';
  productForm.elements.group.value = state.groups.includes(product.group) ? product.group : '';
  productForm.elements.protein.value = product.protein ?? '';
  productForm.elements.carbs.value = product.carbs ?? '';
  productForm.elements.fat.value = product.fat ?? '';
  productForm.elements.kcal.value = product.kcal ?? '';
  productForm.elements.store.value = product.store ?? '';
  productForm.elements.note.value = product.note ?? '';

  const [portion] = product.portions ?? [];
  productForm.elements.portionLabel.value = portion?.[0] ?? '';
  productForm.elements.portionGrams.value = portion?.[1] ?? '';

  $$('input[name="unit"]', productForm).forEach((radio) => {
    radio.checked = radio.value === (product.unit ?? 'g');
  });

  $('[data-product-error]').hidden = true;
  updateKcal();
  productForm.elements.name.focus();
  productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeProductForm() {
  productForm.hidden = true;
  productForm.reset();
  state.barcode = null;
  state.editingId = null;
  state.kcalAuto = true;
}

$('[data-action="cancel-product"]').addEventListener('click', nextScan);

/* A kalória élő számítása. A felület ugyanazt a képletet mutatja, amit a
   szerver számol (Atwater 4/4/9) — így senki nem lepődik meg mentés után. */
const num = (input) => {
  const value = Number(String(input.value).replace(',', '.'));
  return Number.isFinite(value) && input.value !== '' ? value : null;
};

function updateKcal() {
  const hint = $('[data-kcal-hint]');
  const autoBtn = $('[data-action="kcal-auto"]');
  autoBtn.hidden = state.kcalAuto;

  if (!state.kcalAuto) {
    hint.textContent = 'Kézzel megadott érték — a szerver ellenőrzi, hogy összefér-e a makrókkal.';
    return;
  }

  const p = num(productForm.elements.protein);
  const c = num(productForm.elements.carbs);
  const f = num(productForm.elements.fat);
  if (p === null || c === null || f === null) {
    productForm.elements.kcal.value = '';
    hint.textContent = 'Add meg mind a három makrót, és kiszámoljuk. Enélkül a tétel piszkozat marad.';
    return;
  }
  productForm.elements.kcal.value = Math.round(p * 4 + c * 4 + f * 9);
  hint.textContent = 'A makrókból számolva (4/4/9). Ha a csomagoláson más áll, írd felül.';
}

['protein', 'carbs', 'fat'].forEach((name) => {
  productForm[name].addEventListener('input', updateKcal);
});

// A kalória kézi átírása kikapcsolja az automatikát — de csak ha tényleg a
// felhasználó írta, nem amikor mi töltjük ki.
productForm.elements.kcal.addEventListener('input', () => {
  state.kcalAuto = false;
  updateKcal();
});

$('[data-action="kcal-auto"]').addEventListener('click', () => {
  state.kcalAuto = true;
  updateKcal();
});

/** Az űrlapból a szervernek küldhető törzs. */
function collectProduct(status) {
  const portionLabel = productForm.elements.portionLabel.value.trim();
  const portionGrams = num(productForm.elements.portionGrams);

  return {
    barcode: state.barcode,
    name: productForm.elements.name.value.trim(),
    brand: productForm.elements.brand.value.trim(),
    group: productForm.elements.group.value,
    unit: $('input[name="unit"]:checked', productForm)?.value ?? 'g',
    protein: productForm.elements.protein.value === '' ? undefined : num(productForm.elements.protein),
    carbs: productForm.elements.carbs.value === '' ? undefined : num(productForm.elements.carbs),
    fat: productForm.elements.fat.value === '' ? undefined : num(productForm.elements.fat),
    kcal: productForm.elements.kcal.value === '' ? undefined : num(productForm.elements.kcal),
    kcalMode: state.kcalAuto ? 'auto' : 'manual',
    portions: portionLabel && portionGrams ? [[portionLabel, portionGrams]] : [],
    store: productForm.elements.store.value.trim(),
    note: productForm.elements.note.value.trim(),
    status,
    editedAt: new Date().toISOString(),
  };
}

async function saveProduct(status) {
  const errorEl = $('[data-product-error]');
  errorEl.hidden = true;

  const payload = collectProduct(status);
  if (payload.name.length < 2) {
    errorEl.textContent = 'A név legalább 2 karakter legyen — enélkül a tétel később azonosíthatatlan.';
    errorEl.hidden = false;
    return;
  }

  /* OFFLINE: a sorba tesszük, és úgy viselkedünk, mintha mentve lenne — mert
     az is: a telefon megőrzi. A kódot azonnal felvesszük az ismertek közé, így
     a következő szkennelésnél már „megvan"-t mutatunk. */
  if (!navigator.onLine) {
    queue.push({ type: 'product', payload, editedAt: payload.editedAt });
    known.add(payload.barcode);
    toast('Nincs hálózat — a tétel a telefonon vár, és magától felmegy.', 'ok');
    nextScan();
    return;
  }

  const res = state.editingId
    ? await api('PUT', `/api/products/${state.editingId}`, payload)
    : await api('POST', '/api/products', payload);

  if (res.offline) {
    queue.push({ type: 'product', payload, editedAt: payload.editedAt });
    known.add(payload.barcode);
    toast('Megszakadt a hálózat — a tétel sorba került.', 'ok');
    nextScan();
    return;
  }

  if (!res.ok) {
    errorEl.textContent = res.json?.error ?? 'A mentés nem sikerült.';
    errorEl.hidden = false;
    return;
  }

  known.add(res.json.barcode);
  toast(res.json.status === 'kesz' ? 'Mentve — kész tétel.' : 'Mentve piszkozatként.', 'ok');
  nextScan();
  if (state.view === 'lista') renderList();
}

productForm.addEventListener('submit', (event) => {
  event.preventDefault();
  saveProduct('kesz');
});

$('[data-action="save-draft"]').addEventListener('click', () => saveProduct('piszkozat'));

/* ======================================================================
   9. A gyűjtés listája
   ====================================================================== */

$$('[data-status-filter] input').forEach((radio) => {
  radio.addEventListener('change', renderList);
});

let searchTimer = 0;
$('[data-search]').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderList, 250);
});

async function renderList() {
  const list = $('[data-list]');
  const status = $('[data-status-filter] input:checked')?.value ?? '';
  const q = $('[data-search]').value.trim();

  const [products, stats] = await Promise.all([
    api('GET', `/api/products?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`),
    api('GET', '/api/stats'),
  ]);

  if (stats.ok) {
    const s = stats.json;
    $('[data-count-total]').textContent = s.osszes;
    $('[data-stats]').innerHTML = `
      <div class="stat"><span>${s.osszes}</span>összes</div>
      <div class="stat"><span>${s.piszkozat}</span>piszkozat</div>
      <div class="stat"><span>${s.kesz}</span>kész</div>
      <div class="stat"><span>${s.maSzkennelt}</span>ma szkennelt</div>`;
  }

  if (!products.ok) {
    list.innerHTML = `<p class="empty">${products.offline
      ? 'Nincs hálózat — a lista nem tölthető be. A gyűjtés a telefonon megvan, és magától felmegy.'
      : 'A lista nem tölthető be.'}</p>`;
    return;
  }

  if (!products.json.length) {
    list.innerHTML = '<p class="empty">Még nincs itt semmi. Menj a Szkennelés fülre, és kezdd el!</p>';
    return;
  }

  list.innerHTML = products.json.map((p) => `
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
        <button type="button" class="btn btn--secondary btn--sm" data-edit="${p.id}">Javítás</button>
        <button type="button" class="btn btn--ghost btn--sm" data-delete="${p.id}">Törlés</button>
      </div>
    </article>`).join('');

  $$('[data-edit]', list).forEach((btn) => btn.addEventListener('click', () => {
    const product = products.json.find((p) => p.id === Number(btn.dataset.edit));
    location.hash = '#/szkenneles';
    show('szkenneles');
    $('[data-result]').hidden = true;
    openProductForm(product);
  }));

  $$('[data-delete]', list).forEach((btn) => btn.addEventListener('click', async () => {
    const product = products.json.find((p) => p.id === Number(btn.dataset.delete));
    if (!confirm(`Törlöd a gyűjtésből: ${product.name}?`)) return;
    const res = await api('DELETE', `/api/products/${product.id}`);
    if (!res.ok) return toast('A törlés nem sikerült.', 'error');
    toast('Törölve.', 'ok');
    await refreshBarcodes();
    renderList();
  }));
}

/* ======================================================================
   10. Indulás
   ====================================================================== */

async function init() {
  renderSyncBar();

  const res = await api('GET', '/api/auth/me');
  if (res.ok) {
    state.user = res.json;
    await afterLogin();
  } else {
    // Első indításkor (még egy fiók sincs) rögtön a regisztrációt kínáljuk.
    setAuthMode(res.json?.firstRun ? 'register' : 'login');
    show('belepes');
  }

  /* A service worker CSAK az app-héjat gyorsítótárazza (HTML/CSS/JS), az
     /api/* soha. Ettől indul el a telefon kezdőképernyőjéről net nélkül is. */
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // A regisztráció bukása nem hiba a felhasználónak: az app enélkül is megy,
      // csak offline nem indul újra.
    });
  }
}

init();
