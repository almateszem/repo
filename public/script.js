/**
 * FitTrack Pro — frontend
 * -----------------------
 * Adatvezérelt frontend. Minden tartalom egy async `api` rétegen keresztül
 * érkezik, amely a backend /api/* végpontjait hívja (fetch) — a frontend maga
 * nem tárol adatot. A testsúly, az étel-napló és a mentett edzések a szerveren
 * (SQLite) perzisztálnak; a felhasználói preferenciák localStorage-ban élnek.
 * Kiszolgálás: az Express szerver (server/), a statikus fájlok a public/-ból.
 *
 * Felépítés:
 *   1. api réteg (a backend elérése — fetch a /api/* végpontokra)
 *   2. Segédfüggvények (DOM, számláló-animáció, preferenciák)
 *   3. Toast értesítések
 *   4. Router (hash-alapú oldalváltás + oldal-effektek)
 *   5. Nav ring (húzható navigációs gomb — mobil/tablet)
 *   6. Renderelők (chart, edzésnapló, PR lista, ételek, tervek, edzői
 *      panel — állapot-sáv + sportoló-kártyák, edzés-összegző,
 *      Training Max kalkulátor)
 *   7. Interakciók oldalanként (+ értesítés-panel, közös chat-vezérlő,
 *      szerepkör-alapú Edző-felületek, gyorsbillentyűk, offline)
 *   8. Init
 */
'use strict';

(() => {

  /* ======================================================================
     1. api réteg — az egyetlen hely, ahol az app "adatot kér"
     Minden getter a backend egy /api/* végpontját hívja (fetch). A frontend
     már nem tárol adatot: az egyetlen forrás a szerver (SQLite — server/db.js).
     A csak-olvasható referencia-végpontok válasza cache-elt, mert több modul
     is ugyanazt kéri le induláskor.
     ====================================================================== */

  /** GET egy JSON-végpontra, egységes hibakezeléssel. */
  async function getJson(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  }

  /** JSON-törzsű kérés (POST/PUT) egy végpontra. Hiba esetén a szerver `error`
      üzenetét dobja, ha van, különben a HTTP-státuszt. A választ JSON-ként adja vissza. */
  async function sendJson(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.error || `${method} ${path} → ${res.status}`);
    }
    return res.json();
  }
  const postJson = (path, body) => sendJson('POST', path, body);
  const putJson = (path, body) => sendJson('PUT', path, body);

  /** GET-cache a csak-olvasható referencia-végpontokhoz: több modul kéri
      ugyanazt induláskor, elég egyszer letölteni. (Az athletes-nél tartalmi
      szerepe is van: a kártyák és a részletmodál így ugyanazokon az
      objektumokon osztoznak.) Hiba esetén a bejegyzés törlődik, hogy egy
      későbbi hívás újrapróbálhassa. */
  const referenceCache = new Map();
  function getJsonCached(path) {
    if (!referenceCache.has(path)) {
      referenceCache.set(path, getJson(path).catch((err) => {
        referenceCache.delete(path);
        throw err;
      }));
    }
    return referenceCache.get(path);
  }

  const api = {
    getUser:           () => getJsonCached('/api/user'),
    // Nem cache-elt: a dailyStats a naplózással és a nap váltásával változik
    getDashboard:      () => getJson('/api/dashboard'),
    getCharts:         () => getJsonCached('/api/charts'),
    getFoods:          () => getJsonCached('/api/foods'),
    // Nem cache-elt: a saját tervek mentés/szerkesztés után változnak
    getPlans:          () => getJson('/api/plans'),
    getAthletes:       () => getJsonCached('/api/athletes'),
    // Nem cache-elt: a PR-lista a mentett edzésekből épül, mentés után frissül
    getPrs:            () => getJson('/api/prs'),
    getNotifications:  () => getJsonCached('/api/notifications'),
    getDefaultSet:     () => getJsonCached('/api/default-set'),
    getExerciseCatalog: () => getJsonCached('/api/exercise-catalog'),
    getAthleteReplies: () => getJsonCached('/api/athlete-replies'),
    getCoachNotes:     () => getJsonCached('/api/coach-notes'),
    getCoachReplies:   () => getJsonCached('/api/coach-replies'),
    getWeightLog:      () => getJson('/api/weight-log'),
    // Új testsúly-bejegyzés — a szerver visszaadja a létrejött { kg, date }-et
    addWeightEntry:    (kg) => postJson('/api/weight-log', { kg }),
    getNutrition:      () => getJson('/api/nutrition'),
    // Étel naplózása név alapján — a szerver a frissített napi összesítőt adja vissza
    addNutritionEntry: (name) => postJson('/api/nutrition/log', { name }),
    getWorkouts:       () => getJson('/api/workouts'),
    // Edzés mentése — a szerver visszaadja a mentett { id, name, date, exercises }-t
    saveWorkout:       (name, exercises) => postJson('/api/workouts', { name, exercises }),
    // Az épp szerkesztett edzés piszkozata — betöltéskor visszaáll, minden változtatás menti
    getWorkoutDraft:   () => getJson('/api/workout-draft'),
    saveWorkoutDraft:  (name, exercises) => putJson('/api/workout-draft', { name, exercises }),
    // Edzésterv mentése/szerkesztése (terv-építő) — a szerver a mentett tervet adja vissza
    savePlan:          (name, exercises, days) => postJson('/api/plans', { name, exercises, days }),
    updatePlan:        (id, name, exercises, days) => putJson(`/api/plans/${id}`, { name, exercises, days }),
    // Az Edzés oldal induló tartalma: aznapi piszkozat / napra ütemezett terv / null
    getWorkoutTemplate: () => getJson('/api/workout-template'),
    // Teljes adat-pillanatkép a beállítások exportjához
    exportAll:         () => getJson('/api/export'),
  };

  /** Értesítés-kategóriák a beállítások modal kapcsolóihoz (notification.cat). */
  const NOTIF_CATEGORIES = [
    { key: 'plan', label: 'Terv kiosztva' },
    { key: 'comment', label: 'Edzői megjegyzés' },
    { key: 'streak', label: 'Sorozat mérföldkő' },
    { key: 'report', label: 'Heti riport' },
    { key: 'planChange', label: 'Terv módosítva' },
    { key: 'reminder', label: 'Emlékeztető' },
  ];

  /** Az oldalak, a nav gyűrű irányai és a gyorsbillentyűk megfeleltetése.
      A 'summary', a 'plan-builder' és az 'exercise-picker' flow-oldalak:
      a hash-router ismeri őket, de szándékosan nincsenek a nav gyűrű irányai
      és a gyorsbillentyűk között (az „Edzés befejezése", az „+ Új terv",
      ill. a „+ Gyakorlat hozzáadása" gomb visz oda). */
  const PAGES = ['dashboard', 'workout', 'nutrition', 'plans', 'coach', 'summary', 'plan-builder', 'exercise-picker'];
  const FLOW_PAGES = ['summary', 'plan-builder', 'exercise-picker']; // friss megnyitáskor nem állnak vissza
  const DIR_TO_PAGE = {
    up: 'coach', down: 'plans', left: 'workout', right: 'nutrition',
    home: 'dashboard',
  };
  // A gyorsbillentyűk a desktop side-nav sorrendjét követik
  const KEY_TO_PAGE = { 1: 'dashboard', 2: 'coach', 3: 'plans', 4: 'workout', 5: 'nutrition' };

  /* ======================================================================
     2. Segédfüggvények
     ====================================================================== */
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Template klónozása — a template-eknek egyetlen gyökérelemük van. */
  const cloneTemplate = (id) => $('#' + id).content.firstElementChild.cloneNode(true);

  /** Max 1 tizedesjegy, egész számnál tizedes nélkül. */
  const formatNumber = (value) => String(Math.round(value * 10) / 10);

  /** Elemenként legfeljebb egy futó szám-animáció (az újabb megszakítja a régit). */
  const runningNumberAnimations = new WeakMap();

  /** Szám "felpörgetése" egy elemben (ease-out, requestAnimationFrame).
      A format opcióval a kiírás formátuma cserélhető (pl. előjeles delta). */
  function animateNumber(el, to, { from = null, duration = 800, format = formatNumber } = {}) {
    cancelAnimationFrame(runningNumberAnimations.get(el));

    const start = from !== null ? from : (parseFloat(el.textContent) || 0);
    if (prefersReducedMotion || start === to) {
      el.textContent = format(to);
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = format(start + (to - start) * eased);
      if (progress < 1) runningNumberAnimations.set(el, requestAnimationFrame(tick));
    };
    runningNumberAnimations.set(el, requestAnimationFrame(tick));
  }

  /** Felhasználói preferenciák — egyetlen JSON kulcs alatt, hibatűrően. */
  const PREFS_KEY = 'fittrackpro:prefs';
  const prefs = {
    read() {
      try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
      catch { return {}; }
    },
    get(key, fallback) {
      const value = this.read()[key];
      return value === undefined ? fallback : value;
    },
    set(key, value) {
      try {
        const all = this.read();
        all[key] = value;
        localStorage.setItem(PREFS_KEY, JSON.stringify(all));
      } catch { /* privát mód — a demo prefek nélkül is működik */ }
    },
  };

  /** Napváltás-figyelő: percenként (és amikor a fül újra láthatóvá válik)
      ellenőrzi a helyi dátumot; éjfél után lefuttatja a feliratkozott
      frissítőket. Így a napi kalória/fehérje számlálók nulláról indulnak
      akkor is, ha az app napokon át nyitva marad, újratöltés nélkül. */
  const dayChangeListeners = [];
  const onDayChange = (listener) => dayChangeListeners.push(listener);
  function startDayWatcher() {
    let currentDay = new Date().toDateString();
    const check = () => {
      const day = new Date().toDateString();
      if (day === currentDay) return;
      currentDay = day;
      dayChangeListeners.forEach((listener) => {
        Promise.resolve().then(listener)
          .catch((err) => console.error('Napváltás-frissítési hiba:', err));
      });
    };
    setInterval(check, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
  }

  /* ======================================================================
     3. Toast értesítések
     ====================================================================== */
  const TOAST_VISIBLE_MS = 2400;

  function showToast(message, variant = 'default') {
    const region = $('.toast-region');
    const toast = document.createElement('div');
    toast.className = variant === 'error' ? 'toast toast--error' : 'toast';
    toast.textContent = message;
    region.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('is-leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
      // Tartalék, ha az animációk le vannak tiltva (prefers-reduced-motion):
      setTimeout(() => toast.remove(), 400);
    }, TOAST_VISIBLE_MS);
  }

  /* ======================================================================
     4. Router — hash-alapú oldalváltás
     A cím (#workout, #coach…) tükrözi az aktív oldalt, így a vissza gomb és
     a link-megosztás is működik; az utolsó oldal localStorage-ból áll vissza.
     ====================================================================== */

  /** Az áttekintő adatai (renderDashboard tölti fel; a pageEffects innen veszi
      a készenlét-értéket az animációhoz). */
  let dashboardData = null;

  /** Oldal-megjelenéskor futó effektek (számláló-animációk stb.). */
  const pageEffects = {
    dashboard() {
      if (dashboardData) animateNumber($('.db-percent-num'), dashboardData.readiness, { from: 0, duration: 900 });
    },
    coach() {
      // A sportoló-kártyák összpontszáma 0-ról pörög fel — csak ha az
      // edzői (menedzser) nézet éppen látszik
      const manager = $('[data-page="coach"] [data-view="manager"]');
      if (manager && !manager.hidden) animateCoachRatings();
    },
    summary() {
      renderSummary(); // az edzésnapló élő DOM-állapotából számol + felpörgeti a számokat
    },
    plans() {
      // A terv-kártyák progress-e a mai pipált szetteket követi — megnyitáskor frissül
      renderPlans().catch((err) => console.error('Tervek frissítési hiba:', err));
    },
    'exercise-picker'() {
      // A setupExercisePicker tölti fel; megjelenéskor frissíti a cél nevét
      // és a hozzáadás-gombok állapotát az aktuális cél-lista szerint.
      refreshExercisePicker?.();
    },
  };

  /** A gyakorlat-választó frissítője — a setupWorkout állítja be. */
  let refreshExercisePicker = null;

  /** A sportoló-kártyák pontszámainak felpörgetése (oldal- és nézetváltáskor). */
  function animateCoachRatings() {
    $$('[data-page="coach"] .co-card-rating').forEach((el) => {
      animateNumber(el, Number(el.dataset.rating) || 0, { from: 0, duration: 700 });
    });
  }

  function pageFromHash() {
    const hash = location.hash.replace(/^#\/?/, '');
    return PAGES.includes(hash) ? hash : 'dashboard';
  }

  function showPage(name) {
    $$('.app-page').forEach((page) => {
      page.hidden = page.dataset.page !== name;
    });
    $$('.side-nav-link').forEach((link) => {
      const target = link.getAttribute('href').slice(1);
      if (target === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    // A flow-oldalak nem számítanak "utolsó oldalnak" — friss megnyitáskor nem állnak vissza
    if (!FLOW_PAGES.includes(name)) prefs.set('lastPage', name);
    pageEffects[name]?.();
  }

  function navigate(name) {
    if (pageFromHash() === name) showPage(name); // azonos hash-nél nem jön hashchange event
    else location.hash = name;
  }

  function setupRouter() {
    window.addEventListener('hashchange', () => showPage(pageFromHash()));

    // Friss megnyitáskor (hash nélkül) az utoljára használt oldal áll vissza.
    const lastPage = prefs.get('lastPage');
    if (!location.hash && lastPage && PAGES.includes(lastPage) && lastPage !== 'dashboard') {
      location.hash = lastPage; // a hashchange handler jeleníti meg
    } else {
      showPage(pageFromHash());
    }
  }

  /* ======================================================================
     5. Nav ring — húzható navigációs gomb (pointer + billentyűzet)
     ====================================================================== */
  const RING_RADIUS = 44;      // px, a gomb maximális kitérése
  const DIR_THRESHOLD = 26;    // px, ekkora elmozdulástól számít iránynak
  const TAP_THRESHOLD = 9;     // px, ez alatt koppintásnak (home) számít

  function setupNavRing(knob, onNavigate) {
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let direction = null;
    let maxDistance = 0;

    const reset = () => {
      knob.style.cursor = 'grab';
      if (!prefersReducedMotion) {
        knob.style.transition = 'transform .4s cubic-bezier(.18,.9,.2,1.1)';
        setTimeout(() => (knob.style.transition = ''), 420);
      }
      knob.style.transform = 'translate(-50%,-50%)';
      pointerId = null;
    };

    const onDown = (event) => {
      if (pointerId !== null) return;
      pointerId = event.pointerId;
      direction = null;
      maxDistance = 0;
      startX = event.clientX;
      startY = event.clientY;
      knob.style.cursor = 'grabbing';
      knob.style.transition = '';
      try { knob.setPointerCapture(pointerId); } catch (_) { /* nem kritikus */ }
      event.preventDefault();
    };

    const onMove = (event) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      const distance = Math.hypot(dx, dy);
      maxDistance = Math.max(maxDistance, distance);

      const clamped = Math.min(distance, RING_RADIUS);
      const angle = Math.atan2(dy, dx);
      knob.style.transform =
        `translate(calc(-50% + ${Math.cos(angle) * clamped}px), calc(-50% + ${Math.sin(angle) * clamped}px))`;

      direction = distance < DIR_THRESHOLD ? null
        : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down' : 'up');
      event.preventDefault();
    };

    const onUp = (event) => {
      if (event.pointerId !== pointerId) return;
      const nav = direction ?? (maxDistance < TAP_THRESHOLD ? 'home' : null);
      reset();
      if (nav) onNavigate(nav);
    };

    const onCancel = (event) => {
      if (event.pointerId === pointerId) reset();
    };

    // Billentyűzetes navigáció ugyanazokkal az irányokkal
    const KEY_TO_DIR = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      Enter: 'home', ' ': 'home',
    };
    const onKeyDown = (event) => {
      const dir = KEY_TO_DIR[event.key];
      if (!dir) return;
      event.preventDefault();
      onNavigate(dir);
    };

    knob.addEventListener('pointerdown', onDown);
    knob.addEventListener('pointermove', onMove);
    knob.addEventListener('pointerup', onUp);
    knob.addEventListener('pointercancel', onCancel);
    knob.addEventListener('keydown', onKeyDown);
  }

  /* ======================================================================
     6. Renderelők — az api-tól lekért adatok DOM-ba töltése
     ====================================================================== */

  /** Egy chart konténer (újra)feltöltése — a --i a lépcsőzetes animációhoz kell.
      Újrarendereléskor a bar-in animáció is újraindul (reduced motion mellett nem). */
  function renderChart(container, data) {
    const bars = $('.chart-bars', container);
    bars.replaceChildren();
    data.heights.forEach((height, index) => {
      const bar = document.createElement('span');
      bar.style.setProperty('--h', height + '%');
      bar.style.setProperty('--i', index);
      bars.appendChild(bar);
    });

    const axis = $('.chart-axis', container);
    axis.replaceChildren();
    data.axis.forEach((label) => {
      const span = document.createElement('span');
      span.textContent = label;
      axis.appendChild(span);
    });
  }

  /** Minden data-chart konténert feltölt a lekért adatokból. */
  async function renderCharts() {
    const charts = await api.getCharts();
    $$('[data-chart]').forEach((container) => {
      const data = charts[container.dataset.chart];
      if (data) renderChart(container, data);
    });
  }

  /** Az áttekintő napi statjainak (kalória/fehérje) kiírása. */
  function renderDailyStats(dailyStats) {
    const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };
    setText('[data-daily="calories"]', dailyStats.calories);
    setText('[data-daily="caloriesTarget"]', '/' + dailyStats.caloriesTarget);
    setText('[data-daily="protein"]', dailyStats.protein);
  }

  /** Csak a napi statok újralekérése — étel-naplózás és napváltás után, hogy az
      áttekintő számai a friss szerver-állapotot mutassák a többi dashboard-elem
      (pl. az edzésnév-mező) újrarenderelése nélkül. */
  async function refreshDailyStats() {
    const { dailyStats } = await api.getDashboard();
    if (dashboardData) dashboardData.dailyStats = dailyStats;
    renderDailyStats(dailyStats);
  }

  /** Az áttekintő (dashboard) DB-vezérelt feltöltése: sorozat, regeneráció,
      napi statok, aktuális edzésnév, és a készenlét + sorozat alapján
      kontextusfüggő idézet (a statikus motivációs szöveg helyett). */
  async function renderDashboard() {
    dashboardData = await api.getDashboard();
    const { readiness, streak, recovery, dailyStats, workoutName } = dashboardData;

    const setText = (selector, value) => { const el = $(selector); if (el) el.textContent = value; };

    // Sorozat + napi statok
    setText('[data-stat="streak"]', streak);
    renderDailyStats(dailyStats);

    // Regeneráció
    setText('[data-recovery="sleep"]', recovery.sleep);
    setText('[data-recovery="fatigue"]', recovery.fatigue);
    setText('[data-recovery="soreness"]', recovery.soreness);

    // Készenlét: a gyűrű kitöltését és feliratát itt, a szám animálását a
    // pageEffects végzi (a --readiness változót a CSS stroke-dashoffset használja)
    const ring = $('.db-ring');
    if (ring) {
      ring.style.setProperty('--readiness', readiness);
      ring.setAttribute('aria-label', `${readiness} százalék készenlét`);
    }

    // Aktuális edzés neve (aznapi piszkozat vagy a mára ütemezett terv a
    // szerverről; null, ha nincs egyik sem): áttekintő CTA + az edzésnapló
    // címének alapértéke
    setText('[data-workout-name]', workoutName || 'Kezdj új edzést');
    const titleInput = $('#workout-name');
    if (titleInput) titleInput.value = workoutName || '';

    // Kontextusfüggő idézet
    const quoteEl = $('[data-db-quote]');
    if (quoteEl) {
      quoteEl.innerHTML = readiness >= 85
        ? `${streak} napos sorozatban vagy, és a tested is készen áll —<br>ma mehet a nehezebb edzés.`
        : readiness >= 65
        ? `${streak} napos sorozat — tartsd a lendületet,<br>de figyelj a regenerációra is.`
        : 'A tested pihenést kér —<br>ma inkább könnyebb edzés jöhet.';
    }
  }

  /* ---- Szett-sorok ----
     Az ism./súly/RPE szabad szöveges mező (a szerver is stringként tárolja:
     „12 rep", „60% TM", „–"), így a felhasználó edzés közben és a terv-
     építőben is átírhatja őket. A sorszám és a mezők akadálymentes címkéi a
     sor pozíciójából jönnek — törlés/hozzáadás után újra kell számozni. */

  const SET_FIELDS = [
    ['.wk-set-reps', 'reps', 'ismétlés'],
    ['.wk-set-weight', 'weight', 'súly'],
    ['.wk-set-rpe', 'rpe', 'RPE'],
  ];

  /** Egy sor sorszámának és címkéinek beállítása a lista-pozíció szerint. */
  function numberSetRow(row, index) {
    $('.wk-set-num', row).textContent = index + 1;
    SET_FIELDS.forEach(([selector, , label]) => {
      $(selector, row).setAttribute('aria-label', `${index + 1}. szett — ${label}`);
    });
    $('.wk-set-check', row).setAttribute('aria-label', `${index + 1}. szett teljesítve`);
    $('.wk-set-remove', row).setAttribute('aria-label', `${index + 1}. szett törlése`);
  }

  /** Egy gyakorlat szett-listájának újraszámozása (törlés/hozzáadás után). */
  const renumberSets = (setList) =>
    $$('.wk-set-row', setList).forEach((row, index) => numberSetRow(row, index));

  /** Egy szett-sor kiolvasása a mezőkből (a napló és a terv-építő is ezt hívja). */
  const readSetRow = (row) => {
    const set = { done: $('.wk-set-check', row).getAttribute('aria-pressed') === 'true' };
    SET_FIELDS.forEach(([selector, key]) => { set[key] = $(selector, row).value.trim(); });
    return set;
  };

  function renderSetRow(set, index) {
    const row = cloneTemplate('tpl-set-row');
    SET_FIELDS.forEach(([selector, key]) => { $(selector, row).value = set[key]; });
    $('.wk-set-check', row).setAttribute('aria-pressed', String(set.done));
    numberSetRow(row, index);
    return row;
  }

  /** Az új szett értékei: az adott gyakorlat utolsó szettje (így ismétlődő
      szetteknél nem kell újragépelni), üres listánál a szerver alap-szettje. */
  function nextSetValues(setList, defaultSet) {
    const last = setList.lastElementChild;
    return last ? { ...readSetRow(last), done: false } : { ...defaultSet, done: false };
  }

  /** „+ Szett hozzáadása" delegált kezelése. Igazzal tér vissza, ha a
      kattintás ehhez a gombhoz tartozott (a hívó ilyenkor ne fusson tovább). */
  function handleAddSetClick(event, defaultSet, onChange) {
    const addBtn = event.target.closest('.wk-add-set');
    if (!addBtn) return false;
    const setList = $('.wk-set-list', addBtn.closest('.wk-exercise'));
    setList.appendChild(renderSetRow(nextSetValues(setList, defaultSet), setList.children.length));
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
      showToast('Az utolsó szett nem törölhető — a gyakorlatot a gyakorlat-választóból veheted ki', 'error');
      return true;
    }
    row.remove();
    renumberSets(setList);
    onChange();
    return true;
  }

  function renderExercise(exercise, { withAddSet = false, prToggle = false } = {}) {
    const card = cloneTemplate('tpl-exercise');
    $('.wk-exercise-name', card).textContent = exercise.name;

    // Az edzésnapló kártyáin a PR-jelvény kapcsolható gomb; a terv-építőben
    // rejtve marad (a tervekben nincs PR-jelölés).
    const prBtn = $('.wk-pr', card);
    prBtn.hidden = !prToggle;
    prBtn.setAttribute('aria-pressed', String(Boolean(exercise.pr)));

    const videoBtn = $('.wk-video-btn', card);
    videoBtn.dataset.exercise = exercise.name;
    videoBtn.title = 'Technika videó';
    videoBtn.setAttribute('aria-label', `Technika videó — ${exercise.name}`);

    const setList = $('.wk-set-list', card);
    exercise.sets.forEach((set, index) => setList.appendChild(renderSetRow(set, index)));

    // „+ Szett" gomb — az edzésnapló és a terv-építő kártyáin egyaránt
    if (withAddSet) {
      const addSetBtn = document.createElement('button');
      addSetBtn.type = 'button';
      addSetBtn.className = 'wk-add-set';
      addSetBtn.textContent = '+ Szett hozzáadása';
      card.appendChild(addSetBtn);
    }
    return card;
  }

  /** Egy „Korábbi edzések" sor ({ date, detail, rpe }) <li>-vé építve. */
  function historyEntryEl(entry) {
    const li = document.createElement('li');
    [['wk-history-date', entry.date], ['wk-history-detail', entry.detail], ['wk-history-rpe', entry.rpe]]
      .forEach(([className, text]) => {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = text;
        li.appendChild(span);
      });
    return li;
  }

  /** Egy mentett edzés → „Korábbi edzések" sor (név + teljesített/összes szett). */
  function workoutHistoryEntry(workout) {
    const sets = workout.exercises.flatMap((exercise) => exercise.sets || []);
    const done = sets.filter((set) => set.done).length;
    return { date: workout.date, detail: workout.name, rpe: `${done}/${sets.length} szett` };
  }

  /** A „Korábbi edzések" üres-állapota csak addig látszik, amíg nincs mentett edzés. */
  const syncHistoryEmpty = () => {
    $('[data-history-empty]').hidden = $('[data-list="history"]').children.length > 0;
  };

  /** A „Korábbi edzések" lista a mentett edzésekből (legújabb elöl).
      Az edzésnapló tartalmát nem ez tölti: azt a setupWorkout kéri le
      (aznapi piszkozat vagy a mára ütemezett terv). */
  async function renderWorkout() {
    const savedWorkouts = await api.getWorkouts();
    const history = $('[data-list="history"]');
    history.replaceChildren();
    savedWorkouts.forEach((workout) => history.appendChild(historyEntryEl(workoutHistoryEntry(workout))));
    syncHistoryEmpty();
  }

  async function renderFoods() {
    const foods = await api.getFoods();
    const list = $('[data-list="foods"]');
    foods.forEach((food) => {
      const item = cloneTemplate('tpl-food');
      item.dataset.foodName = food.name.toLowerCase(); // a kereső erre szűr, nem a teljes szövegre

      // A kcal-jelvény a név span-jén belül ül, ezért a nevet elé szúrjuk be.
      const nameEl = $('.nu-food-name', item);
      nameEl.insertBefore(document.createTextNode(food.name + ' '), nameEl.firstChild);
      $('.nu-food-kcal', item).textContent = `${food.kcal} kcal`;
      $('.nu-food-macros', item).textContent =
        `${food.per} · ${formatNumber(food.protein)} g F · ${formatNumber(food.carbs)} g Cs · ${formatNumber(food.fat)} g Zs`;

      const addBtn = $('.nu-food-add', item);
      addBtn.dataset.food = food.name;
      addBtn.title = 'Hozzáadás a naplóhoz';
      addBtn.setAttribute('aria-label', `${food.name} hozzáadása a naplóhoz`);
      list.appendChild(item);
    });
  }

  /** Egy terv-kártya ({ name, meta, progress, own?, id? }) felépítése a Tervek
      listájához. A szerkesztés gomb csak a saját (terv-építős) terveken látszik. */
  function planCardEl(plan) {
    const card = cloneTemplate('tpl-plan');
    $('.pl-card-name', card).textContent = plan.name;
    $('.pl-card-meta', card).textContent = plan.meta;

    const progress = $('.pl-progress', card);
    progress.setAttribute('aria-valuenow', String(plan.progress));
    progress.setAttribute('aria-label', `${plan.name} — ${plan.progress}% teljesítve`);
    $('.pl-progress-fill', card).style.width = plan.progress + '%';

    const editBtn = $('.pl-card-edit', card);
    if (plan.own) {
      editBtn.hidden = false;
      editBtn.dataset.planId = plan.id;
      editBtn.title = 'Terv szerkesztése';
      editBtn.setAttribute('aria-label', `${plan.name} szerkesztése`);
    }

    const openBtn = $('.pl-card-open', card);
    openBtn.dataset.plan = plan.name;
    openBtn.title = 'Terv betöltése az edzésnaplóba';
    openBtn.setAttribute('aria-label', `${plan.name} betöltése az edzésnaplóba`);
    return card;
  }

  /** A legutóbb lekért tervlista — a nyíl- és a szerkesztés gomb ebből veszi
      a terv adatait (a kártyák dataset.planIndex-e ide mutat). */
  let plansData = [];

  /** Újrahívható: mentés/szerkesztés után és a Tervek oldal megnyitásakor
      frissen húzza le és építi újra a listát (a progress a mai teljesítést
      követi, ezért minden megjelenéskor érdemes újrakérni). */
  async function renderPlans() {
    plansData = await api.getPlans();
    const list = $('[data-list="plans"]');
    list.replaceChildren();
    plansData.forEach((plan, index) => {
      const card = planCardEl(plan);
      card.dataset.planIndex = index;
      list.appendChild(card);
    });
    $('[data-plans-empty]').hidden = plansData.length > 0;
  }

  /** Egy üzenet-buborék (a sportoló-modál chat-szimulációja használja). */
  function createCoachNote({ meta, text, variant, me = false }) {
    const article = cloneTemplate('tpl-coach-note');
    if (variant === 'plan') article.classList.add('co-note--plan');
    if (me) article.classList.add('co-note--me');
    $('.co-note-meta', article).textContent = meta;
    $('.co-note-text', article).textContent = text;
    return article;
  }

  /* ---- Edzői panel: állapot-sáv + sportoló-kártyák ----
     Összpontszám = (készenlét + terv-követés) / 2, ebből jön a tier is
     (arany ≥ 85, ezüst ≥ 70, alatta bronz) — FIFA-kártya ihletésű megjelenés. */
  const athleteRating = (athlete) => Math.round((athlete.readiness + athlete.adherence) / 2);

  const athleteTier = (rating) => (rating >= 85
    ? { key: 'gold', label: 'Arany szint' }
    : rating >= 70
      ? { key: 'silver', label: 'Ezüst szint' }
      : { key: 'bronze', label: 'Bronz szint' });

  /** A kártyán megjelenő statok (címke + érték-képző) — a modál bővebb listát mutat. */
  const ATHLETE_CARD_STATS = [
    ['Készenlét', (a) => `${a.readiness}%`],
    ['Terv-követés', (a) => `${a.adherence}%`],
    ['Sorozat', (a) => `${a.streak} nap`],
    ['Utolsó edzés', (a) => a.lastWorkout],
  ];

  function renderAthleteCard(athlete, index) {
    const card = cloneTemplate('tpl-athlete-card');
    const rating = athleteRating(athlete);
    const tier = athleteTier(rating);

    card.classList.add(`co-tier--${tier.key}`);
    card.dataset.athlete = athlete.id;
    card.style.setProperty('--i', index);
    card.setAttribute('aria-label',
      `${athlete.name} — ${rating} pont, ${tier.label}${athlete.alert ? ', figyelmet igényel' : ''} — részletek megnyitása`);

    const ratingEl = $('.co-card-rating', card);
    ratingEl.textContent = rating;
    ratingEl.dataset.rating = rating;
    $('.co-card-tag', card).textContent = athlete.goal;
    $('.co-card-name', card).textContent = athlete.name;
    $('.co-card-alert', card).hidden = !athlete.alert;

    const stats = $('.co-card-stats', card);
    ATHLETE_CARD_STATS.forEach(([label, getValue]) => {
      const stat = document.createElement('span');
      stat.className = 'co-card-stat';
      const value = document.createElement('span');
      value.className = 'co-card-stat-value';
      value.textContent = getValue(athlete);
      const labelEl = document.createElement('span');
      labelEl.className = 'co-card-stat-label';
      labelEl.textContent = label;
      stat.append(value, labelEl);
      stats.appendChild(stat);
    });

    return card;
  }

  /** Állapot-sáv + kártya-rács feltöltése a lekért sportolók alapján. */
  async function renderCoachPanel() {
    const athletes = await api.getAthletes();
    $('[data-athlete-count]').textContent = athletes.length;

    const banner = $('[data-banner]');
    const icon = $('.co-banner-icon', banner);
    const title = $('.co-banner-title', banner);
    const alertList = $('[data-list="alerts"]');
    const okText = $('.co-banner-ok-text', banner);
    const flagged = athletes.filter((athlete) => athlete.alert);

    banner.classList.toggle('co-banner--alert', flagged.length > 0);
    banner.classList.toggle('co-banner--ok', flagged.length === 0);
    alertList.replaceChildren();

    if (flagged.length > 0) {
      icon.textContent = '!';
      title.textContent = `${flagged.length} sportoló figyelmet igényel`;
      okText.hidden = true;
      flagged.forEach((athlete) => {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'co-banner-item';
        button.dataset.athlete = athlete.id;
        button.setAttribute('aria-haspopup', 'dialog');

        const name = document.createElement('span');
        name.className = 'co-banner-name';
        name.textContent = athlete.name;
        const reason = document.createElement('span');
        reason.className = 'co-banner-reason';
        reason.textContent = athlete.alert;

        button.append(name, reason);
        li.appendChild(button);
        alertList.appendChild(li);
      });
    } else {
      icon.textContent = '✓';
      title.textContent = 'Minden rendben';
      okText.hidden = false;
    }

    const grid = $('[data-list="athletes"]');
    athletes.forEach((athlete, index) => grid.appendChild(renderAthleteCard(athlete, index)));
  }

  /** Korábbi rekordok (PR) listája a workout oldalon — a mentett edzések
      PR-jelölt gyakorlataiból (a szerver állítja össze). Újrahívható:
      edzés-mentés után frissen húzza le a listát. */
  async function renderPrs() {
    const prs = await api.getPrs();
    const list = $('[data-list="prs"]');
    list.replaceChildren();
    prs.forEach((pr, index) => {
      const item = cloneTemplate('tpl-pr');
      item.style.setProperty('--i', index);
      $('.wk-pr-exercise', item).textContent = pr.exercise;
      $('.wk-pr-detail', item).textContent = pr.detail;
      $('.wk-pr-date', item).textContent = pr.date;
      list.appendChild(item);
    });
    $('[data-prs-empty]').hidden = prs.length > 0;
  }

  /* ---- Edzés-összegző (summary) ----
     Az értékek az edzésnapló élő DOM-állapotából jönnek (pipált szettek);
     az időtartam az edzés tényleges kezdete (az első aznap kipipált szett)
     óta eltelt idő. Mély-linkkel (#summary) is működik: ilyenkor az aktuális
     naplóállapotot összegzi. */

  /** Az edzés kezdetének rögzítése (prefs): az aznapi első szett-pipa indítja.
      Terv-betöltéskor nullázódik — onnan új edzés számít. */
  const WORKOUT_START_KEY = 'workoutStart';
  const markWorkoutStarted = () => {
    const day = new Date().toDateString();
    const start = prefs.get(WORKOUT_START_KEY, null);
    if (!start || start.day !== day) prefs.set(WORKOUT_START_KEY, { day, ts: Date.now() });
  };
  const workoutMinutes = () => {
    const start = prefs.get(WORKOUT_START_KEY, null);
    if (!start || start.day !== new Date().toDateString()) return 0;
    return Math.max(1, Math.round((Date.now() - start.ts) / 60000));
  };

  const SUMMARY_QUOTES = [
    'Erős voltál ma — a következő edzés még jobb lesz!',
    'Minden pipált szett egy lépés a célod felé.',
    'A folyamatosság veri a tökéletességet — ma is jelen voltál.',
    'Szép munka! A regeneráció most ugyanolyan fontos, mint a súly.',
  ];
  let summaryQuoteIndex = Math.floor(Math.random() * SUMMARY_QUOTES.length);

  function renderSummary() {
    const workoutPage = $('[data-page="workout"]');
    const checks = $$('.wk-set-list .wk-set-check', workoutPage);
    const done = checks.filter((check) => check.getAttribute('aria-pressed') === 'true').length;
    const minutes = done === 0 ? 0 : workoutMinutes();
    const hasPr = $$('.wk-exercise-head .wk-pr', workoutPage)
      .some((el) => el.getAttribute('aria-pressed') === 'true');

    $('[data-su-name]').textContent = $('#workout-name').value.trim() || 'Edzés';
    $('[data-su-pr]').hidden = !hasPr;
    $('[data-su-sets-total]').textContent = String(checks.length);
    $('[data-su-quote]').textContent = SUMMARY_QUOTES[summaryQuoteIndex % SUMMARY_QUOTES.length];
    summaryQuoteIndex += 1; // minden megnyitásra másik motivációs sor jut

    animateNumber($('[data-su-sets-done]'), done, { from: 0, duration: 700 });
    animateNumber($('[data-su-duration]'), minutes, { from: 0, duration: 800 });
  }

  /* ======================================================================
     7. Interakciók
     ====================================================================== */

  /** Közös modal-vezérlő: backdrop/gomb zárás, Escape, fókusz-csapda,
      fókusz-visszaállítás, reduced-motion. A videó- és a beállítások
      modal is erre épül. */
  function createModalController(modal) {
    const CLOSE_ANIM_MS = 190;
    let lastFocused = null;
    let hideTimer = null;

    const open = () => {
      clearTimeout(hideTimer);
      lastFocused = document.activeElement;
      modal.classList.remove('is-closing');
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      $('button[data-close-modal]', modal).focus();
    };

    const hide = () => {
      modal.classList.remove('is-open', 'is-closing');
      modal.setAttribute('aria-hidden', 'true');
      if (lastFocused) lastFocused.focus();
    };

    const close = () => {
      if (!modal.classList.contains('is-open')) return;
      if (prefersReducedMotion) {
        hide();
        return;
      }
      modal.classList.add('is-closing'); // a kiúszó animáció alatt még látszik
      hideTimer = setTimeout(hide, CLOSE_ANIM_MS);
    };

    $$('[data-close-modal]', modal).forEach((el) => el.addEventListener('click', close));

    document.addEventListener('keydown', (event) => {
      if (!modal.classList.contains('is-open')) return;

      if (event.key === 'Escape') {
        close();
        return;
      }

      // Fókusz-csapda: Tab-bal nem lehet a háttérbe lépni, amíg a modal nyitva van
      if (event.key === 'Tab') {
        const focusables = $$('button, [href], input, select, textarea', modal)
          .filter((el) => !el.disabled && !el.closest('[hidden]'));
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    return { open, close };
  }

  function setupVideoModal() {
    const modal = $('#videoModal');
    const exerciseLabel = $('.video-modal-exercise', modal);
    const controller = createModalController(modal);

    return {
      open(exerciseName) {
        exerciseLabel.textContent = exerciseName;
        controller.open();
      },
    };
  }

  /** A beállítások modal szerepkör-kapcsolói (demo: mindhárom állapot kipróbálható). */
  const ROLE_TOGGLES = [
    { key: 'roleHasCoach', label: 'Van edződ', fallback: (user) => user.hasCoach },
    { key: 'roleCoachesAthletes', label: 'Edzel másokat', fallback: (user) => user.coachesAthletes },
  ];

  /** Beállítások modal: profilnév, értesítés-kapcsolók, szerepkör-kapcsolók,
      adat-export (demo). A név és a kapcsolók a prefs-be (localStorage)
      mentődnek — más nem perzisztál. Az onRolesChange az Edző oldal
      felületeit, az onNotifCatsChange az értesítés-jelvényt frissíti élőben,
      ha egy kapcsoló átbillen. */
  async function setupSettingsModal({ onRolesChange, onNotifCatsChange } = {}) {
    const modal = $('#settingsModal');
    const controller = createModalController(modal);
    const nameInput = $('#st-display-name');
    const usernameEl = $('.db-username');
    const toggleList = $('[data-list="settings-toggles"]');
    const roleList = $('[data-list="settings-roles"]');

    // A szerepkör-kapcsolók alapállapotát a felhasználó adja meg (egyszer lekérve)
    const user = await api.getUser();

    // A megjelenített név: a mentett (localStorage) név, különben a szerveré
    usernameEl.textContent = prefs.get('displayName', user.name);

    // Kapcsoló-sorok a kategóriákból (template-klónozással)
    NOTIF_CATEGORIES.forEach(({ key, label }) => {
      const row = cloneTemplate('tpl-setting-toggle');
      $('.st-toggle-label', row).textContent = label;
      const toggle = $('.st-switch', row);
      toggle.dataset.cat = key;
      toggle.setAttribute('aria-label', `${label} értesítések`);
      toggleList.appendChild(row);
    });

    const syncToggles = () => {
      const mutedCats = prefs.get('notifCats', {});
      $$('.st-switch', toggleList).forEach((toggle) => {
        const isOn = !mutedCats[toggle.dataset.cat];
        toggle.setAttribute('aria-checked', String(isOn));
        toggle.closest('.st-toggle').classList.toggle('is-off', !isOn);
      });
    };

    // A kapcsolók azonnal érvényesülnek (prefs + értesítés-panel és -jelvény)
    toggleList.addEventListener('click', (event) => {
      const toggle = event.target.closest('.st-switch');
      if (!toggle) return;
      const mutedCats = { ...prefs.get('notifCats', {}) };
      if (mutedCats[toggle.dataset.cat]) delete mutedCats[toggle.dataset.cat];
      else mutedCats[toggle.dataset.cat] = true;
      prefs.set('notifCats', mutedCats);
      syncToggles();
      onNotifCatsChange?.();
    });

    // Szerepkör-kapcsolók (Van edződ / Edzel másokat) — ugyanaz a sorminta
    ROLE_TOGGLES.forEach(({ key, label }) => {
      const row = cloneTemplate('tpl-setting-toggle');
      $('.st-toggle-label', row).textContent = label;
      const toggle = $('.st-switch', row);
      toggle.dataset.role = key;
      toggle.setAttribute('aria-label', `${label} szerepkör`);
      roleList.appendChild(row);
    });

    const syncRoleToggles = () => {
      $$('.st-switch', roleList).forEach((toggle) => {
        const role = ROLE_TOGGLES.find((r) => r.key === toggle.dataset.role);
        const isOn = Boolean(prefs.get(role.key, role.fallback(user)));
        toggle.setAttribute('aria-checked', String(isOn));
        toggle.closest('.st-toggle').classList.toggle('is-off', !isOn);
      });
    };

    // Átbillentéskor azonnal érvényesül — az Edző oldal élőben frissül
    roleList.addEventListener('click', (event) => {
      const toggle = event.target.closest('.st-switch');
      if (!toggle) return;
      const role = ROLE_TOGGLES.find((r) => r.key === toggle.dataset.role);
      prefs.set(role.key, !prefs.get(role.key, role.fallback(user)));
      syncRoleToggles();
      onRolesChange?.();
    });

    // Adat-export: a teljes adat-pillanatkép letöltése JSON-ként + toast (demo)
    $('[data-action="export-data"]').addEventListener('click', async () => {
      try {
        const snapshot = await api.exportAll();
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'fittrack-pro-demo.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      } catch { /* ha a letöltés nem elérhető, a toast akkor is jelez */ }
      showToast('Adatok exportálva · demo');
    });

    const save = () => {
      const name = nameInput.value.trim();
      if (name) {
        usernameEl.textContent = name;
        prefs.set('displayName', name);
      }
      showToast('Beállítások elmentve · demo');
      controller.close();
    };

    $('[data-action="save-settings"]').addEventListener('click', save);
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') save();
    });

    return {
      open() {
        nameInput.value = prefs.get('displayName', usernameEl.textContent);
        syncToggles();
        syncRoleToggles();
        controller.open();
      },
    };
  }

  /** Értesítés-panel: az avatarra nyílik, olvasott állapota megjegyzett. */
  async function setupNotifications() {
    const button = $('[data-action="notifications"]');
    const panel = $('[data-notif-panel]');
    const badge = $('[data-notif-badge]');
    const list = $('[data-list="notifications"]');
    const emptyState = $('.notif-empty', panel);
    let allRead = prefs.get('notificationsRead', false);

    // Az értesítések listája — egyszer lekérve
    const notifications = await api.getNotifications();

    const updateBadge = (pop = false) => {
      // A némított kategóriák nem számítanak bele az "új" darabszámba
      const mutedCats = prefs.get('notifCats', {});
      const count = allRead ? 0 : notifications.filter((n) => !mutedCats[n.cat]).length;
      badge.hidden = count === 0;
      badge.textContent = String(count);
      badge.setAttribute('aria-label', `${count} új értesítés`);
      if (pop && !prefersReducedMotion) {
        badge.classList.remove('is-pop');
        void badge.offsetWidth; // szándékos reflow: az animáció újraindításához
        badge.classList.add('is-pop');
      }
    };

    const renderList = () => {
      list.replaceChildren();
      emptyState.hidden = !allRead;
      if (allRead) return;
      const mutedCats = prefs.get('notifCats', {}); // a beállítások modal kapcsolói
      notifications.forEach((notif, index) => {
        const li = document.createElement('li');
        li.className = 'notif-item';
        if (mutedCats[notif.cat]) li.classList.add('notif-item--muted');
        li.style.setProperty('--i', index);

        const dot = document.createElement('span');
        dot.className = 'notif-dot';

        const body = document.createElement('div');
        const text = document.createElement('span');
        text.textContent = notif.text;
        const time = document.createElement('span');
        time.className = 'notif-time';
        time.textContent = notif.time;
        body.append(text, time);

        li.append(dot, body);
        list.appendChild(li);
      });
    };

    const setOpen = (open) => {
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) renderList();
    };

    button.addEventListener('click', () => setOpen(panel.hidden));

    $('[data-action="clear-notifications"]').addEventListener('click', () => {
      allRead = true;
      prefs.set('notificationsRead', true);
      renderList();
      updateBadge();
      showToast('Minden értesítés olvasottnak jelölve');
    });

    // Kattintás a panelen kívülre / Escape / oldalváltás → zárás
    document.addEventListener('pointerdown', (event) => {
      if (!panel.hidden && !event.target.closest('[data-notif-panel], [data-action="notifications"]')) {
        setOpen(false);
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) {
        setOpen(false);
        button.focus();
      }
    });
    window.addEventListener('hashchange', () => setOpen(false));

    updateBadge(true); // betöltéskor egy finom "pop" hívja fel a figyelmet a badge-re

    return { updateBadge };
  }

  function setupDashboard(settingsModal) {
    // settingsModal null lehet, ha a betöltése hibázott — a gomb ilyenkor inaktív
    $('[data-action="settings"]').addEventListener('click', () => settingsModal?.open());
    $('[data-action="open-workout"]').addEventListener('click', () => navigate('workout'));
  }

  /* ---- Testsúly rögzítése (dashboard) ----
     A bejegyzések a szerverre mentődnek (POST /api/weight-log) és onnan
     töltődnek be; minden új érték a 12 hetes chart végére kerül és a
     "Testsúly Δ" statot frissíti. */
  const WEIGHT_CHART_MIN_KG = 80;   // a chart alja — a tengelyfeliratok (80–86 kg) skálájával azonos
  const WEIGHT_CHART_MAX_KG = 86;   // a chart teteje
  const WEIGHT_CHART_BARS = 12;     // legfeljebb ennyi oszlop látszik
  const WEIGHT_DEMO_LAST_KG = 84.6; // az utolsó mock-oszlop (76%) súlya — az első bejegyzés Δ-jához

  const weightToHeight = (kg) => Math.min(Math.max(
    (kg - WEIGHT_CHART_MIN_KG) / (WEIGHT_CHART_MAX_KG - WEIGHT_CHART_MIN_KG) * 100, 6), 100);

  /** A testsúly Δ előjelesen olvasható (+1.2 / -0.8), a 0 előjel nélkül. */
  const formatDelta = (value) => (value > 0 ? '+' : '') + formatNumber(value);

  async function setupWeightLog() {
    const form = $('[data-form="weight-log"]');
    const input = $('#weight-input');
    const lastEl = $('[data-weight-last]');
    const chart = $('[data-chart="bodyWeight"]');
    const deltaEl = $('[data-stat="weightDelta"]');

    // A testsúly-diagram alapgörbéje — egyszer lekérve, a bejegyzések ehhez fűződnek
    const bodyWeightChart = (await api.getCharts()).bodyWeight;

    // A bejegyzések a szerverről jönnek; a lokális másolat a friss válaszokkal frissül
    let log = await api.getWeightLog();

    const sync = ({ animateDelta = false } = {}) => {
      if (log.length === 0) return;

      renderChart(chart, {
        ...bodyWeightChart,
        heights: [...bodyWeightChart.heights, ...log.map((e) => weightToHeight(e.kg))]
          .slice(-WEIGHT_CHART_BARS),
      });

      const latest = log[log.length - 1];
      const previous = log.length > 1 ? log[log.length - 2].kg : WEIGHT_DEMO_LAST_KG;
      const delta = latest.kg - previous;
      if (animateDelta) animateNumber(deltaEl, delta, { duration: 600, format: formatDelta });
      else deltaEl.textContent = formatDelta(delta);

      lastEl.hidden = false;
      lastEl.textContent = `Utolsó bejegyzés: ${formatNumber(latest.kg)} kg · ${latest.date}`;
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const kg = parseFloat(input.value);
      if (!Number.isFinite(kg) || kg < 30 || kg > 300) {
        showToast('Adj meg érvényes testsúlyt (30–300 kg)', 'error');
        input.focus();
        return;
      }
      try {
        const entry = await api.addWeightEntry(kg); // szerverre mentés → { kg, date }
        log = [...log, entry];
        form.reset();
        sync({ animateDelta: true });
        showToast(`Testsúly rögzítve: ${formatNumber(entry.kg)} kg`);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült menteni a testsúlyt', 'error');
      }
    });

    sync(); // a szerverről betöltött bejegyzések megjelenítése
  }

  async function setupWorkout(videoModal, picker) {
    const page = $('[data-page="workout"]');
    const titleInput = $('#workout-name');
    const titleError = $('#workout-name-error');
    const list = $('[data-list="exercises"]', page);

    /** Az üres állapot csak addig látszik, amíg nincs gyakorlat a naplóban. */
    const syncEmpty = () => { $('[data-workout-empty]').hidden = list.children.length > 0; };

    // Az új szettek alapértékei (ha egy gyakorlatnak még nincs szettje)
    const defaultSet = await api.getDefaultSet();

    // A napló kártyái: kapcsolható PR-jelvény és „+ Szett" gomb
    const exerciseOptions = { prToggle: true, withAddSet: true };

    /** Az edzés aktuális állapota a DOM-ból (gyakorlatok + szettek + „kész" jelölés). */
    const readCurrentWorkout = () => $$('.wk-exercise', page).map((card) => ({
      name: $('.wk-exercise-name', card).textContent.trim(),
      pr: $('.wk-pr', card).getAttribute('aria-pressed') === 'true',
      sets: $$('.wk-set-list .wk-set-row', card).map(readSetRow),
    }));

    /* ---- Automatikus mentés ----
       Minden változtatás után rövid szünettel (debounce) a szerverre PUT-oljuk
       a piszkozatot, így az állapot újratöltés/leállás után is megmarad.
       Lapelrejtéskor (bezárás, tab-váltás) a függő mentést azonnal elküldjük
       keepalive-kéréssel, hogy az utolsó változtatás se vesszen el. */
    const AUTOSAVE_DEBOUNCE_MS = 500;
    let autosaveTimer = null;
    // Az „Edzés befejezése" duplikált naplózás elleni jelzője: minden
    // változtatás visszabillenti, sikeres naplózás állítja.
    let savedSinceLastChange = false;
    const autosave = () => {
      savedSinceLastChange = false;
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(async () => {
        autosaveTimer = null;
        try {
          await api.saveWorkoutDraft(titleInput.value.trim(), readCurrentWorkout());
        } catch (err) {
          console.error('Automatikus mentés sikertelen:', err);
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden' || autosaveTimer === null) return;
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      fetch('/api/workout-draft', {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: titleInput.value.trim(), exercises: readCurrentWorkout() }),
      }).catch(() => {});
    });

    // Az induló tartalom a szervertől: aznapi piszkozat, vagy — új napon —
    // a mai hétnapra ütemezett terv. Ha nincs egyik sem, a napló üres, és az
    // üres állapot hívja a Tervek oldalt / a gyakorlat-hozzáadást.
    const template = await api.getWorkoutTemplate();
    if (template) {
      titleInput.value = template.name;
      list.replaceChildren();
      template.exercises.forEach((exercise) => {
        list.appendChild(renderExercise(exercise, exerciseOptions));
      });
      if (template.source === 'plan') showToast(`Mai terv betöltve: ${template.name}`);
    }
    syncEmpty();

    // Az ism./súly/RPE mezők átírása is változtatás — a piszkozattal mentődik.
    // (Az edzésnév saját input-figyelője a hibaállapotot is kezeli, ezért az
    //  nem itt, hanem külön fut.)
    page.addEventListener('input', (event) => {
      if (event.target.matches('.wk-chip')) autosave();
    });

    // Delegált kattintáskezelés — a dinamikusan hozzáadott sorokra is érvényes.
    page.addEventListener('click', (event) => {
      // Szett hozzáadása / törlése a gyakorlat-kártyákon
      if (handleAddSetClick(event, defaultSet, autosave)) return;
      if (handleRemoveSetClick(event, autosave)) return;

      const check = event.target.closest('.wk-set-check');
      if (check) {
        const pressed = check.getAttribute('aria-pressed') === 'true';
        check.setAttribute('aria-pressed', String(!pressed));
        if (!pressed) markWorkoutStarted(); // az első pipa indítja az edzés-órát
        autosave();
        return;
      }

      // PR-jelölés kapcsolása a gyakorlaton — a piszkozattal együtt mentődik
      const prBtn = event.target.closest('.wk-pr-toggle');
      if (prBtn) {
        const pressed = prBtn.getAttribute('aria-pressed') === 'true';
        prBtn.setAttribute('aria-pressed', String(!pressed));
        autosave();
        return;
      }

      const videoBtn = event.target.closest('.wk-video-btn');
      if (videoBtn) {
        videoModal.open(videoBtn.dataset.exercise);
        return;
      }
    });

    // Gyakorlat hozzáadása közvetlenül az edzésnaplóhoz — a közös gyakorlat-
    // választó az edzésnapló listáját célozza, és minden változást ment.
    $('[data-action="workout-add-exercise"]').addEventListener('click', () => {
      picker?.use({
        targetList: list,
        nameInput: titleInput,
        backPage: 'workout',
        backLabel: 'Vissza az edzésnaplóhoz',
        subtitleNoun: 'edzéshez',
        toastTarget: 'az edzéshez',
        exerciseOptions,
        onChange: () => {
          syncEmpty();
          autosave();
        },
      });
      navigate('exercise-picker');
    });

    // Gépelésre a hibaállapot azonnal eltűnik; a nevet is automatikusan mentjük
    titleInput.addEventListener('input', () => {
      titleInput.classList.remove('has-error');
      titleError.hidden = true;
      autosave();
    });

    /** Közös név-validáció: a mentés és a befejezés is megköveteli az edzésnevet. */
    const validateWorkoutName = () => {
      if (titleInput.value.trim()) return true;
      titleInput.classList.add('has-error');
      titleError.hidden = false;
      titleInput.focus();
      showToast('Adj nevet az edzésnek', 'error');
      return false;
    };

    // Edzés befejezése — validáció után a szerverre naplózza az edzést
    // (Korábbi edzések + PR-lista), majd az összegző oldalra visz. Ha az
    // utolsó változtatás óta már naplózva lett (pl. az összegzőről visszalépve
    // újra megnyomják), nem ment duplán, csak továbbnavigál.
    const finishBtn = $('[data-action="finish-workout"]');
    finishBtn.addEventListener('click', async () => {
      if (finishBtn.disabled) return;
      if (!validateWorkoutName()) return;
      if (savedSinceLastChange) {
        navigate('summary');
        return;
      }

      finishBtn.disabled = true;
      try {
        const saved = await api.saveWorkout(titleInput.value.trim(), readCurrentWorkout());
        savedSinceLastChange = true;
        // A naplózott edzés azonnal megjelenik a „Korábbi edzések" tetején,
        // és a PR-lista is frissül (a PR-jelölt gyakorlatok bekerülnek)
        const history = $('[data-list="history"]');
        history.insertBefore(historyEntryEl(workoutHistoryEntry(saved)), history.firstChild);
        syncHistoryEmpty();
        renderPrs().catch(console.error);
        showToast('Edzés befejezve és naplózva');
        navigate('summary');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült menteni az edzést', 'error');
      } finally {
        finishBtn.disabled = false;
      }
    });

    /** Terv betöltése az edzésnaplóba (a Tervek nyíl-gombja hívja): a cím és
        a gyakorlatok cserélődnek, és az állapot azonnal piszkozatként mentődik
        — így újratöltés után is a betöltött terv marad az edzésnaplóban. */
    const loadPlan = (plan) => {
      titleInput.value = plan.name;
      titleInput.classList.remove('has-error');
      titleError.hidden = true;
      list.replaceChildren();
      plan.exercises.forEach((exercise) => {
        list.appendChild(renderExercise(exercise, exerciseOptions));
      });
      syncEmpty();
      prefs.set(WORKOUT_START_KEY, null); // friss edzés — az óra az első pipával indul újra
      autosave();
    };

    return { loadPlan };
  }

  /** A gyakorlat-választó flow-oldal: katalógus a szerverről, kereső + izom-
      csoport chipek, a → gomb a cél-listához adja a gyakorlatot (alap
      szettekkel), a ✓ eltávolítja onnan. A cél (a terv-építő VAGY az
      edzésnapló listája) egy use(context)-tel váltható vezérlőn át áll be —
      a hívó (setupPlanBuilder / setupWorkout) adja meg, mielőtt idenavigál. */
  async function setupExercisePicker() {
    const [catalog, defaultSet] = await Promise.all([
      api.getExerciseCatalog(), api.getDefaultSet(),
    ]);
    const pickerPage = $('[data-page="exercise-picker"]');
    const list = $('[data-list="picker-catalog"]');
    const chipWrap = $('[data-list="picker-chips"]');
    const searchInput = $('#exercise-search');
    const countEl = $('[data-picker-count]');
    const emptyState = $('.ep-empty', pickerPage);
    const backBtn = $('[data-action="picker-back"]');
    const nounEl = $('[data-picker-noun]');

    /** Az aktuális cél: { targetList, nameInput, backPage, backLabel,
        subtitleNoun, toastTarget, exerciseOptions, onChange }. */
    let context = null;

    // A kártyák egyszer épülnek fel; a szűrés csak elrejt/megmutat
    catalog.forEach((entry) => {
      const item = cloneTemplate('tpl-picker-item');
      item.dataset.name = entry.name;
      item.dataset.group = entry.group;
      item.dataset.search = entry.name.toLowerCase();
      $('.ep-item-name', item).textContent = entry.name;
      $('.ep-item-tag', item).textContent = entry.tag;
      $('.ep-item-muscles', item).textContent = entry.muscles;
      list.appendChild(item);
    });

    // Szűrő-chipek a katalógus csoportjaiból (+ Mind)
    let activeGroup = 'Mind';
    ['Mind', ...new Set(catalog.map((entry) => entry.group))].forEach((group) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ep-chip';
      chip.textContent = group;
      chip.setAttribute('aria-pressed', String(group === activeGroup));
      chip.addEventListener('click', () => {
        activeGroup = group;
        $$('.ep-chip', chipWrap).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        refresh();
      });
      chipWrap.appendChild(chip);
    });

    /** A cél-listában lévő gyakorlat-nevek — ehhez igazodik a ✓/→ állapot. */
    const namesInTarget = () =>
      new Set($$('.wk-exercise-name', context.targetList).map((el) => el.textContent.trim()));

    /** Szűrés + a fejléc és a gombállapotok szinkronja a cél állapotával. */
    const refresh = () => {
      if (!context) return; // mély-linkkel, cél nélkül megnyitva nincs mit szinkronizálni
      $('[data-picker-workout]').textContent = context.nameInput.value.trim() || 'Névtelen';
      const query = searchInput.value.trim().toLowerCase();
      const added = namesInTarget();
      let visibleCount = 0;
      $$('.ep-item', list).forEach((item) => {
        const matches = (activeGroup === 'Mind' || item.dataset.group === activeGroup)
          && item.dataset.search.includes(query);
        item.hidden = !matches;
        if (matches) visibleCount += 1;

        const inTarget = added.has(item.dataset.name);
        const toggle = $('.ep-item-toggle', item);
        toggle.setAttribute('aria-pressed', String(inTarget));
        toggle.textContent = inTarget ? '✓' : '→';
        toggle.setAttribute('aria-label', inTarget
          ? `${item.dataset.name} eltávolítása`
          : `${item.dataset.name} hozzáadása ${context.toastTarget}`);
      });
      countEl.textContent = visibleCount;
      emptyState.hidden = visibleCount > 0;
    };

    searchInput.addEventListener('input', refresh);

    // Hozzáadás/eltávolítás: közvetlenül a cél-lista DOM-ját módosítja
    list.addEventListener('click', (event) => {
      const toggle = event.target.closest('.ep-item-toggle');
      if (!toggle || !context) return;

      const name = toggle.closest('.ep-item').dataset.name;
      const existing = $$('.wk-exercise', context.targetList)
        .find((card) => $('.wk-exercise-name', card).textContent.trim() === name);
      if (existing) {
        existing.remove();
        showToast(`${name} eltávolítva`);
      } else {
        context.targetList.appendChild(renderExercise({
          name,
          pr: false,
          sets: [{ ...defaultSet }, { ...defaultSet }, { ...defaultSet }],
        }, context.exerciseOptions));
        showToast(`${name} hozzáadva ${context.toastTarget}`);
      }
      context.onChange();
      refresh();
    });

    backBtn.addEventListener('click', () => navigate(context?.backPage || 'plans'));

    refreshExercisePicker = refresh;

    /** A cél átállítása — a hívó ezt hívja, mielőtt a választóra navigál. */
    const use = (next) => {
      context = next;
      backBtn.setAttribute('aria-label', context.backLabel);
      nounEl.textContent = context.subtitleNoun;
      refresh();
    };

    return { use };
  }

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
    const DAY_LABELS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
    const DAY_NAMES = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];
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

    // Szett hozzáadása / törlése a kártyákon (delegálva, az újakra is érvényes)
    list.addEventListener('click', (event) => {
      if (handleAddSetClick(event, defaultSet, updateSummary)) return;
      handleRemoveSetClick(event, updateSummary);
    });

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

  /** Összegző oldal: a fő gomb zárja a kört az áttekintés felé
      (a „Vissza az edzéshez" link sima #workout hash-hivatkozás). */
  function setupSummary() {
    $('[data-action="summary-dashboard"]').addEventListener('click', () => navigate('dashboard'));
  }

  /** Heti volumen-összehasonlítás: a váltógomb újrarendereli a chartot
      (a bar-in animáció újraindul), az összvolumen felpörög az új értékre. */
  async function setupWeeklyCompare() {
    const section = $('.wk-compare');
    const chart = $('[data-chart]', section);
    const totalEl = $('[data-compare-total]');
    const noteEl = $('[data-compare-note]');

    // A két hét adata (volumeThisWeek / volumeLastWeek) — egyszer lekérve
    const charts = await api.getCharts();

    // Kezdeti (ez a hét) összesítő a felületre — így nincs beégetett placeholder
    totalEl.textContent = formatNumber(charts.volumeThisWeek.total);
    noteEl.textContent = charts.volumeThisWeek.note;
    chart.setAttribute('aria-label', charts.volumeThisWeek.ariaLabel);

    section.addEventListener('click', (event) => {
      const btn = event.target.closest('.wk-toggle-btn');
      if (!btn || btn.getAttribute('aria-pressed') === 'true') return;

      $$('.wk-toggle-btn', section).forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });

      const data = charts[btn.dataset.period];
      chart.dataset.chart = btn.dataset.period;
      chart.setAttribute('aria-label', data.ariaLabel);
      renderChart(chart, data);
      animateNumber(totalEl, data.total, { duration: 600 });
      noteEl.textContent = data.note;
    });
  }

  async function setupNutrition() {
    const foods = await api.getFoods();
    const searchInput = $('#food-search');
    const emptyState = $('.nu-empty');
    const STAT_KEYS = ['intake', 'protein', 'carbs', 'fat'];

    // A napi összesítő a szerverről (alap + naplózott ételek) — újratöltés után
    // is a valós állapotot mutatja. A lokális másolat a POST-válaszokkal frissül.
    let totals = null;
    const applyTotals = (next, { animateFrom = null } = {}) => {
      totals = next;
      STAT_KEYS.forEach((key) => {
        const el = $(`[data-stat="${key}"]`);
        if (animateFrom) animateNumber(el, totals[key], { from: animateFrom[key], duration: 600 });
        else el.textContent = formatNumber(totals[key]);
      });
    };
    applyTotals(await api.getNutrition());

    // Éjfél után a napi összesítő nulláról indul (a szerver mindig az aznapi
    // bejegyzéseket összegzi — csak újra le kell kérni).
    onDayChange(async () => applyTotals(await api.getNutrition()));

    // A napi cél a szerverről (Cél kcal + edző célja szöveg)
    const goalCalEl = $('[data-goal="calories"]');
    if (goalCalEl) goalCalEl.textContent = totals.goal.calories;
    const goalTextEl = $('[data-nu-goal-text]');
    if (goalTextEl) {
      goalTextEl.textContent = `napi ${totals.goal.calories} kcal, ${totals.goal.protein} g fehérje a tömegnövelő fázisban.`;
    }

    searchInput.addEventListener('input', () => {
      const query = searchInput.value.trim().toLowerCase();
      let visibleCount = 0;
      $$('.nu-food').forEach((item) => {
        const matches = item.dataset.foodName.includes(query);
        item.hidden = !matches;
        if (matches) visibleCount += 1;
      });
      emptyState.hidden = visibleCount > 0;
    });

    // Étel hozzáadása: a szerver naplózza és visszaadja a frissített összesítőt
    $('[data-list="foods"]').addEventListener('click', async (event) => {
      const addBtn = event.target.closest('.nu-food-add');
      if (!addBtn) return;

      const food = foods.find((f) => f.name === addBtn.dataset.food);
      if (!food) return;

      try {
        const previous = totals;
        applyTotals(await api.addNutritionEntry(food.name), { animateFrom: previous });
        // Az áttekintő kalória-statja is kövesse a naplózást (közös forrás a szerveren)
        refreshDailyStats().catch(console.error);
        showToast(`${food.name} hozzáadva a naplóhoz · +${food.kcal} kcal`);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült hozzáadni az ételt', 'error');
      }
    });
  }

  /** A Tervek oldal interakciói. A planBuilder és a workout a megfelelő setup
      függvények vezérlői — hiba esetén (safe-ből null) a gombok nem visznek át. */
  function setupPlans(planBuilder, workout) {
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

      // Nyíl — a terv (név + gyakorlatok) betöltődik az edzésnaplóba
      const openBtn = event.target.closest('.pl-card-open');
      if (!openBtn) return;
      const plan = plansData[Number(openBtn.closest('.pl-card').dataset.planIndex)];
      if (!plan?.exercises || !workout) return;
      workout.loadPlan(plan);
      showToast(`„${plan.name}” betöltve az edzésnaplóba`);
      navigate('workout');
    });

    // Új terv készítése — üres terv-építővel
    $('[data-action="new-plan"]').addEventListener('click', () => {
      planBuilder?.startNew();
      navigate('plan-builder');
    });
  }

  /** Közös chat-szimuláció: saját üzenet azonnal megjelenik, majd „gépel…”
      jelző után szimulált válasz érkezik (körbeforgó válaszlista). A sportoló-
      modál chatje és a kliens nézet edző-chatje is erre épül. A beszélgetés
      objektum: { name, thread, replyPending } — az előzmény a session alatt
      memóriában marad. */
  function createChatController({ feed, form, input, replies, getConversation, isFeedVisible }) {
    const TYPING_DELAY_MS = 700;
    const REPLY_DELAY_MS = 1900;
    let replyIndex = 0;

    const scrollFeedToEnd = () => { feed.scrollTop = feed.scrollHeight; };

    const renderThread = (conversation) => {
      feed.replaceChildren();
      conversation.thread.forEach((note) => feed.appendChild(createCoachNote(note)));
      scrollFeedToEnd();
    };

    form.addEventListener('submit', (event) => {
      event.preventDefault(); // required-validáció után futunk, nincs valódi backend

      const message = input.value.trim();
      if (!message) return;

      const conversation = getConversation();
      const myNote = { meta: 'Te · most', text: message, me: true };
      conversation.thread.push(myNote);
      feed.appendChild(createCoachNote(myNote));
      scrollFeedToEnd();
      form.reset();
      input.focus();

      if (conversation.replyPending) return; // beszélgetésenként egy szimulált válasz fusson
      conversation.replyPending = true;

      setTimeout(() => {
        // "Gépel…" jelző — csak ha még mindig ez a beszélgetés látszik
        const typingNote = createCoachNote({ meta: conversation.name, text: '' });
        const typing = document.createElement('span');
        typing.className = 'co-typing';
        typing.setAttribute('aria-label', `${conversation.name} éppen ír`);
        for (let i = 0; i < 3; i += 1) typing.appendChild(document.createElement('span'));
        $('.co-note-text', typingNote).appendChild(typing);
        if (getConversation() === conversation && isFeedVisible()) {
          feed.appendChild(typingNote);
          scrollFeedToEnd();
        }

        setTimeout(() => {
          const reply = {
            meta: `${conversation.name} · most`,
            text: replies[replyIndex % replies.length],
          };
          replyIndex += 1;
          conversation.thread.push(reply);
          conversation.replyPending = false;
          if (typingNote.isConnected) typingNote.replaceWith(createCoachNote(reply));
          else if (getConversation() === conversation && isFeedVisible()) feed.appendChild(createCoachNote(reply));
          scrollFeedToEnd();
        }, REPLY_DELAY_MS - TYPING_DELAY_MS);
      }, TYPING_DELAY_MS);
    });

    return { renderThread };
  }

  /** A modálban megjelenő részletes statok (a kártya statjai + extra mezők). */
  const ATHLETE_MODAL_STATS = [
    ...ATHLETE_CARD_STATS,
    ['Heti edzések', (a) => a.weekly],
    ['Aktív terv', (a) => a.plan],
  ];

  /** Sportoló részletmodál: összegzés, gyors műveletek és üzenetküldés
      szimulált sportoló-válasszal. A modal-plumbing a közös vezérlőé. */
  async function setupAthleteModal() {
    const modal = $('#athleteModal');
    const controller = createModalController(modal);
    const athleteReplies = await api.getAthleteReplies();
    const badge = $('.co-modal-badge', modal);
    const titleEl = $('#athleteModalTitle');
    const tierEl = $('.co-modal-tier', modal);
    const alertEl = $('[data-modal-alert]', modal);
    const statsEl = $('[data-modal-stats]', modal);
    const activityEl = $('[data-modal-activity]', modal);
    const msgButton = $('[data-action="message"]', modal);
    const msgSection = $('[data-msg-section]', modal);
    const feed = $('[data-msg-feed]', modal);
    const form = $('[data-form="athlete-message"]', modal);
    const input = $('#athlete-message');

    let current = null;

    // A chat-mechanika (küldés, „gépel…", szimulált válasz) a közös vezérlőé
    const chat = createChatController({
      feed,
      form,
      input,
      replies: athleteReplies,
      getConversation: () => current,
      isFeedVisible: () => !msgSection.hidden,
    });

    const setMessageOpen = (open, { focus = false } = {}) => {
      msgSection.hidden = !open;
      msgButton.setAttribute('aria-expanded', String(open));
      if (open) {
        chat.renderThread(current);
        if (focus) input.focus();
      }
    };

    // Terv / edzés szerkesztése: demo-stub — toast + átnavigálás a megfelelő oldalra
    $('[data-action="edit-plan"]', modal).addEventListener('click', () => {
      showToast(`„${current.plan}” megnyitva szerkesztésre · demo`);
      controller.close();
      navigate('plans');
    });

    $('[data-action="edit-workout"]', modal).addEventListener('click', () => {
      showToast(`${current.name} — legutóbbi edzés megnyitva · demo`);
      controller.close();
      navigate('workout');
    });

    msgButton.addEventListener('click', () => setMessageOpen(msgSection.hidden, { focus: true }));

    return {
      open(athlete) {
        current = athlete;
        // Az üzenetváltás előzménye a session alatt megmarad (memóriában)
        if (!athlete.thread) {
          athlete.thread = [{ meta: `${athlete.name} · tegnap`, text: athlete.lastMessage }];
        }

        const rating = athleteRating(athlete);
        const tier = athleteTier(rating);
        badge.className = `co-modal-badge co-tier--${tier.key}`;
        $('.co-modal-rating', badge).textContent = rating;
        $('.co-modal-tag', badge).textContent = athlete.goal;
        titleEl.textContent = athlete.name;
        tierEl.textContent = `${tier.label} · ${rating} pont`;

        alertEl.hidden = !athlete.alert;
        if (athlete.alert) alertEl.textContent = `Figyelmet igényel: ${athlete.alert}`;

        statsEl.replaceChildren();
        ATHLETE_MODAL_STATS.forEach(([label, getValue]) => {
          const stat = document.createElement('div');
          stat.className = 'co-modal-stat';
          const dt = document.createElement('dt');
          dt.textContent = label;
          const dd = document.createElement('dd');
          dd.textContent = getValue(athlete);
          stat.append(dt, dd);
          statsEl.appendChild(stat);
        });

        activityEl.replaceChildren();
        athlete.recent.forEach((entry, index) => {
          const li = document.createElement('li');
          li.style.setProperty('--i', index);
          li.textContent = entry;
          activityEl.appendChild(li);
        });

        setMessageOpen(false);
        controller.open();
      },
    };
  }

  /** Edzői panel: kártyára vagy riasztás-sorra kattintva a részletmodál nyílik. */
  async function setupCoach(athleteModal) {
    // A sportolók listája — egyszer lekérve; a kattintás id alapján keres benne.
    // (Ugyanaz a cache szolgálja ki az összes kattintást, így a modal-ban a
    //  session alatt épülő üzenetváltás-előzmény ugyanazon az objektumon marad.)
    const athletes = await api.getAthletes();
    $('[data-page="coach"]').addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-athlete]');
      if (!trigger) return;
      const athlete = athletes.find((a) => a.id === trigger.dataset.athlete);
      if (athlete) athleteModal?.open(athlete);
    });
  }

  /** Az Edző oldal szerepkör-alapú felületei.
      - hasCoach + coachesAthletes → nézetváltó („Edződ" / „Edzetteim"), az
        utolsó választás prefs-ben megjegyzett;
      - csak hasCoach → csak a kliens chat; csak coachesAthletes → csak a
        sportoló-menedzser; egyik sem → üres állapot.
      A kliens chat a közös chat-vezérlőre épül (coachNotes + coachReplies). */
  async function setupCoachSurfaces() {
    const page = $('[data-page="coach"]');
    const toggle = $('[data-coach-toggle]', page);
    const emptyState = $('[data-coach-empty]', page);
    const views = {
      client: $('[data-view="client"]', page),
      manager: $('[data-view="manager"]', page),
    };

    const [coachNotes, coachReplies, user] = await Promise.all([
      api.getCoachNotes(), api.getCoachReplies(), api.getUser(),
    ]);

    // A saját edző beszélgetése — az előzmény a session alatt memóriában marad
    const coachConversation = {
      name: 'Kovács Bence',
      thread: coachNotes.map((note) => ({ ...note })),
    };

    const chat = createChatController({
      feed: $('[data-client-feed]', page),
      form: $('[data-form="coach-message"]', page),
      input: $('#coach-message'),
      replies: coachReplies,
      getConversation: () => coachConversation,
      isFeedVisible: () => !views.client.hidden,
    });

    const roles = () => ({
      hasCoach: prefs.get('roleHasCoach', user.hasCoach),
      coachesAthletes: prefs.get('roleCoachesAthletes', user.coachesAthletes),
    });

    /** A szerepkörök + a megjegyzett választás alapján kapcsolja a nézeteket. */
    const apply = ({ animate = false } = {}) => {
      const { hasCoach, coachesAthletes } = roles();
      const both = hasCoach && coachesAthletes;
      const view = both
        ? (prefs.get('coachView', 'client') === 'manager' ? 'manager' : 'client')
        : hasCoach ? 'client' : coachesAthletes ? 'manager' : null;

      toggle.hidden = !both;
      emptyState.hidden = view !== null;
      views.client.hidden = view !== 'client';
      views.manager.hidden = view !== 'manager';

      $$('.co-toggle-btn', toggle).forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.coachView === view));
      });

      if (view === 'client') chat.renderThread(coachConversation);
      if (view === 'manager' && animate) animateCoachRatings();
    };

    toggle.addEventListener('click', (event) => {
      const btn = event.target.closest('.co-toggle-btn');
      if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
      prefs.set('coachView', btn.dataset.coachView);
      apply({ animate: true });
    });

    apply();
    return { apply };
  }

  /** Gyorsbillentyűk: 1–5 oldalváltás (gépelés közben inaktív). */
  function setupShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target instanceof Element
        && event.target.matches('input, textarea, select, [contenteditable]')) return;
      const page = KEY_TO_PAGE[event.key];
      if (page) navigate(page);
    });
  }

  /** Offline/online állapot jelzése. */
  function setupConnectivity() {
    window.addEventListener('offline', () => {
      showToast('Nincs internetkapcsolat', 'error');
    });
    window.addEventListener('online', () => {
      showToast('Újra online');
    });
  }

  /* ======================================================================
     8. Init
     ====================================================================== */
  async function init() {
    // Egy init-lépés hibája (pl. egy végpont nem válaszol) ne vigye el a
    // többit: naplózzuk, a hibás szekció üresen marad, a többi működik.
    let hadError = false;
    const safe = (task) => Promise.resolve()
      .then(task)
      .catch((err) => {
        hadError = true;
        console.error('Betöltési hiba:', err);
        return null;
      });

    // Kezdeti tartalom betöltése — a renderelők az api-n keresztül kérnek
    // adatot a backendtől. Párhuzamosan, mert függetlenek.
    await Promise.all([
      safe(renderCharts),
      safe(renderDashboard),
      safe(renderWorkout),
      safe(renderPrs),
      safe(renderFoods),
      safe(renderPlans),
      safe(renderCoachPanel),
    ]);

    // A szerepkör-alapú nézetek a router előtt állnak be, hogy az induló
    // oldal effektjei (pl. kártya-pontszámok) már a jó nézetet lássák.
    const coachSurfaces = await safe(setupCoachSurfaces);

    setupRouter();

    const videoModal = setupVideoModal();
    const notifPanel = await safe(setupNotifications);
    const settingsModal = await safe(() => setupSettingsModal({
      onRolesChange: () => coachSurfaces?.apply({ animate: true }),
      onNotifCatsChange: () => notifPanel?.updateBadge(),
    }));
    const athleteModal = await safe(setupAthleteModal);
    setupDashboard(settingsModal);
    await safe(setupWeightLog);
    // A közös gyakorlat-választó — az edzésnapló és a terv-építő is ezt célozza át
    const picker = await safe(setupExercisePicker);
    const workout = await safe(() => setupWorkout(videoModal, picker));
    await safe(setupWeeklyCompare);
    await safe(setupNutrition);
    const planBuilder = await safe(() => setupPlanBuilder(picker));
    setupPlans(planBuilder, workout);
    await safe(() => setupCoach(athleteModal));
    setupSummary();
    setupShortcuts();
    setupConnectivity();

    setupNavRing($('#navKnob'), (dir) => navigate(DIR_TO_PAGE[dir] ?? 'dashboard'));

    // Napváltás-figyelő: éjfél után az áttekintő napi statjai is nullázódnak
    // (a táplálkozás-oldali frissítő a setupNutrition-ben iratkozik fel).
    onDayChange(refreshDailyStats);
    startDayWatcher();

    if (hadError) {
      showToast('Nem minden adat töltődött be — próbáld frissíteni az oldalt', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch((err) => console.error('Inicializálási hiba:', err));
  });

})();
