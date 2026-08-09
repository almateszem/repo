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

  /** Törlő kérés — a válasz üres (204), ezért nem próbáljuk JSON-ként olvasni. */
  async function del(path) {
    const res = await fetch(path, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  }

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

  /** Egy cache-elt végpont eldobása, hogy a következő lekérés friss adatot
      hozzon. A /api/charts részben SZÁMÍTOTT adat (heti volumen a mentett
      edzésekből), ezért edzés naplózása után érvényteleníteni kell — enélkül
      a volumen-diagram a munkamenet végéig a betöltéskori értéket mutatná. */
  const invalidateCache = (path) => referenceCache.delete(path);

  const api = {
    getUser:           () => getJsonCached('/api/user'),
    // Nem cache-elt: a dailyStats a naplózással és a nap váltásával változik
    getDashboard:      () => getJson('/api/dashboard'),
    getCharts:         () => getJsonCached('/api/charts'),
    // Friss chart-adat a cache megkerülésével (edzés naplózása után)
    refreshCharts:     () => { invalidateCache('/api/charts'); return getJsonCached('/api/charts'); },
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
    // A mai naplózott tételek — a Táplálkozás oldal „Mai napló" listájához
    getNutritionLog:   () => getJson('/api/nutrition/log'),
    // Étel naplózása név + adag (gramm) alapján — a válasz { entry, totals }.
    // A makrókat a szerver számolja át az adagra, a kliens csak a grammot küldi.
    addNutritionEntry: (name, grams) => postJson('/api/nutrition/log', { name, grams }),
    // Naplóbejegyzés visszavonása — a válasz a frissített napi összesítő
    removeNutritionEntry: (id) => sendJson('DELETE', `/api/nutrition/log/${id}`),
    getWorkouts:       () => getJson('/api/workouts'),
    // Edzés mentése — a szerver visszaadja a mentett { id, name, date, exercises }-t.
    // A planId azt rögzíti, melyik tervből indult az edzés (a Tervek oldali
    // haladás ebből párosít, nem névegyezésből).
    saveWorkout:       (name, exercises, planId) => postJson('/api/workouts', { name, exercises, planId }),
    // Az épp szerkesztett edzés piszkozata — betöltéskor visszaáll, minden változtatás menti
    getWorkoutDraft:   () => getJson('/api/workout-draft'),
    saveWorkoutDraft:  (name, exercises, planId) => putJson('/api/workout-draft', { name, exercises, planId }),
    // Az edzés lezárása után a piszkozat törlődik — új edzés kezdhető ugyanaznap
    clearWorkoutDraft: () => del('/api/workout-draft'),
    // Edzésterv mentése/szerkesztése (terv-építő) — a szerver a mentett tervet adja vissza
    savePlan:          (name, exercises, days) => postJson('/api/plans', { name, exercises, days }),
    updatePlan:        (id, name, exercises, days) => putJson(`/api/plans/${id}`, { name, exercises, days }),
    // Az Edzés oldal induló tartalma: aznapi piszkozat / napra ütemezett terv / null
    getWorkoutTemplate: () => getJson('/api/workout-template'),
    // Teljes adat-pillanatkép a beállítások exportjához
    exportAll:         () => getJson('/api/export'),
    // Recovery Engine — egyik sem cache-elt: naponta (és minden check-in,
    // ill. edzés-mentés után) változnak.
    getReadiness:      () => getJson('/api/readiness'),
    getCheckin:        () => getJson('/api/checkin'),
    // A mentés a friss riportot is visszaadja, hogy a felület egy körből frissüljön
    saveCheckin:       (fields) => putJson('/api/checkin', fields),
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
  const PAGES = ['dashboard', 'recovery', 'workout', 'nutrition', 'plans', 'coach', 'summary', 'plan-builder', 'exercise-picker'];
  const FLOW_PAGES = ['summary', 'plan-builder', 'exercise-picker']; // friss megnyitáskor nem állnak vissza
  const DIR_TO_PAGE = {
    up: 'coach', down: 'plans', left: 'workout', right: 'nutrition',
    home: 'dashboard',
  };
  // A gyorsbillentyűk a desktop side-nav sorrendjét követik.
  // A Regeneráció oldal szándékosan nincs a nav gyűrű négy iránya között —
  // mobilon az áttekintő készenlét-kártyája visz oda (lásd .db-readiness).
  const KEY_TO_PAGE = { 1: 'dashboard', 2: 'recovery', 3: 'coach', 4: 'plans', 5: 'workout', 6: 'nutrition' };

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
  /** A hiba tovább látszik: 2,4 mp alatt egy „nem sikerült menteni" el sem
      olvasható, márpedig ebből tudja meg a felhasználó, hogy tennie kell valamit. */
  const TOAST_ERROR_VISIBLE_MS = 5200;

  function showToast(message, variant = 'default') {
    const region = $('.toast-region');
    const toast = document.createElement('div');
    toast.className = variant === 'error' ? 'toast toast--error' : 'toast';
    toast.textContent = message;
    region.appendChild(toast);

    // A toast-régió `polite`: a képernyőolvasó megvárja vele, amit épp mond.
    // Hibánál ez kevés, ezért a szöveget egy külön `assertive` régióba is
    // kiírjuk — vizuálisan ott nincs semmi, csak a bejelentés történik meg.
    if (variant === 'error') {
      const announcer = $('[data-error-announcer]');
      if (announcer) {
        // Az azonos szöveg ismételt beírását a felolvasók elnyelik: előbb
        // ürítjük, hogy két egyforma hiba is elhangozzon.
        announcer.textContent = '';
        setTimeout(() => { announcer.textContent = message; }, 60);
      }
    }

    setTimeout(() => {
      toast.classList.add('is-leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
      // Tartalék, ha az animációk le vannak tiltva (prefers-reduced-motion):
      setTimeout(() => toast.remove(), 400);
    }, variant === 'error' ? TOAST_ERROR_VISIBLE_MS : TOAST_VISIBLE_MS);
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
    recovery() {
      // A készenlét az edzés naplózásával is változik, ezért minden
      // megnyitáskor újraszámoltatjuk a szerverrel.
      refreshRecovery?.().catch((err) => console.error('Regeneráció frissítési hiba:', err));
    },
    'exercise-picker'() {
      // A setupExercisePicker tölti fel; megjelenéskor frissíti a cél nevét
      // és a hozzáadás-gombok állapotát az aktuális cél-lista szerint.
      refreshExercisePicker?.();
    },
  };

  /** A gyakorlat-választó frissítője — a setupWorkout állítja be. */
  let refreshExercisePicker = null;

  /** A Regeneráció oldal frissítője — a setupRecovery állítja be. Az oldal
      megnyitása és az edzés lezárása is hívja. */
  let refreshRecovery = null;

  /** A heti volumen-diagram frissítője — a setupWeeklyCompare állítja be.
      Az edzés lezárása hívja, hogy a friss szettek azonnal látszódjanak. */
  let refreshVolumeChart = null;

  /** A sportoló-kártyák pontszámainak felpörgetése (oldal- és nézetváltáskor). */
  function animateCoachRatings() {
    $$('[data-page="coach"] .co-card-rating').forEach((el) => {
      animateNumber(el, Number(el.dataset.rating) || 0, { from: 0, duration: 700 });
    });
  }

  /** Az aktuális oldal a hash-ből, vagy null, ha a hash nem oldalnév.
      A null fontos: a `#app-main` (skip link), a `#title-…` horgonyok és a
      régi/elgépelt linkek NEM oldalváltások. Korábban minden ismeretlen hash
      'dashboard'-ra fordult, ezért az „Ugrás a tartalomhoz" link — pont az
      akadálymentességi segédeszköz — bármelyik oldalról az Áttekintésre
      dobta a felhasználót. */
  function pageFromHash() {
    const hash = location.hash.replace(/^#\/?/, '');
    return PAGES.includes(hash) ? hash : null;
  }

  /** Az oldalak emberi neve — a mobil nav-hint és a fókusz-bejelentés használja. */
  const PAGE_TITLES = {
    dashboard: 'Áttekintés', recovery: 'Regeneráció', workout: 'Edzés',
    nutrition: 'Táplálkozás', plans: 'Tervek', coach: 'Edző',
    summary: 'Edzés-összegző', 'plan-builder': 'Terv-építő',
    'exercise-picker': 'Gyakorlat hozzáadása',
  };

  /** Az éppen látható oldal (a DOM az igazságforrás — a hash lehet horgony is). */
  const currentPage = () => $('.app-page:not([hidden])')?.dataset.page ?? 'dashboard';

  /** A mobil nav gyűrű „itt vagy" jelzése. A gyűrűnek négy iránya van, az
      Áttekintés és a Regeneráció nincs köztük — ezért a hint-sor mindig
      kiírja az oldal nevét, a négy címke közül pedig kiemeli az aktuálisat
      (ha van ilyen). Enélkül mobilon semmi nem mutatta, hol vagy. */
  function syncNavRingState(name) {
    const label = $('[data-nav-current]');
    if (label) label.textContent = PAGE_TITLES[name] ?? '';
    $$('.nl').forEach((el) => {
      const dir = el.className.match(/nl--(\w+)/)?.[1];
      const dirKey = { up: 'up', dn: 'down', lt: 'left', rt: 'right' }[dir];
      el.classList.toggle('is-current', DIR_TO_PAGE[dirKey] === name);
    });
  }

  function showPage(name) {
    const changed = currentPage() !== name;

    $$('.app-page').forEach((page) => {
      page.hidden = page.dataset.page !== name;
    });
    $$('.side-nav-link').forEach((link) => {
      const target = link.getAttribute('href').slice(1);
      if (target === name) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    syncNavRingState(name);

    /* Oldalváltáskor a görgetés és a fókusz is az új oldalra kerül. Korábban
       egyik sem történt meg: a Regeneráció aljáról az Áttekintésre lépve a lap
       közepén találtad magad, a képernyőolvasó fókusza pedig egy épp elrejtett
       elemen maradt. */
    if (changed) {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      const heading = $(`.app-page[data-page="${name}"] h2`);
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }

    // A flow-oldalak nem számítanak "utolsó oldalnak" — friss megnyitáskor nem állnak vissza
    if (!FLOW_PAGES.includes(name)) prefs.set('lastPage', name);
    pageEffects[name]?.();
  }

  function navigate(name) {
    if (pageFromHash() === name) showPage(name); // azonos hash-nél nem jön hashchange event
    else location.hash = name;
  }

  function setupRouter() {
    // Csak a valódi oldalnevekre váltunk. Ismeretlen hash (skip link, horgony,
    // elgépelt link) esetén az aktuális oldal marad — nem dobjuk vissza a
    // felhasználót az Áttekintésre.
    window.addEventListener('hashchange', () => {
      const page = pageFromHash();
      if (page) showPage(page);
    });

    // Friss megnyitáskor (hash nélkül) az utoljára használt oldal áll vissza.
    const lastPage = prefs.get('lastPage');
    if (!location.hash && lastPage && PAGES.includes(lastPage) && lastPage !== 'dashboard') {
      location.hash = lastPage; // a hashchange handler jeleníti meg
    } else {
      showPage(pageFromHash() ?? 'dashboard');
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
    // pageEffects végzi (a --readiness változót a CSS stroke-dashoffset használja).
    // A szelektor szándékosan a kártyára szűkít: a Regeneráció oldalon is van
    // egy .db-ring, azt a renderRecovery kezeli.
    const ring = $('.db-readiness .db-ring');
    if (ring) {
      ring.style.setProperty('--readiness', readiness);
      ring.setAttribute('aria-label', `${readiness} százalék készenlét`);
    }

    // A kártya alsó sora megmondja, mire épül a szám — a Recovery Engine
    // enélkül csak egy önmagát magyarázó szám lenne.
    setText('[data-readiness-note]', dashboardData.checkinPresent
      ? (dashboardData.readinessConfidence === 'high'
        ? 'a saját előzményedhez mérve'
        : 'részben általános referenciával')
      : 'töltsd ki a napi check-int →');

    // Aktuális edzés neve (aznapi piszkozat vagy a mára ütemezett terv a
    // szerverről; null, ha nincs egyik sem): áttekintő CTA + az edzésnapló
    // címének alapértéke
    setText('[data-workout-name]', workoutName || 'Kezdj új edzést');
    const titleInput = $('#workout-name');
    if (titleInput) titleInput.value = workoutName || '';

    // Kontextusfüggő idézet. Két sorból épül (a sortörés a tördelés miatt
    // szándékos) — a szöveget textContent-tel írjuk ki, nem innerHTML-lel,
    // hogy az adatból származó rész se kerülhessen soha HTML-ként a lapra.
    const quoteEl = $('[data-db-quote]');
    if (quoteEl) {
      const [first, second] = readiness >= 85
        ? [`${streak} napos sorozatban vagy, és a tested is készen áll —`, 'ma mehet a nehezebb edzés.']
        : readiness >= 65
          ? [`${streak} napos sorozat — tartsd a lendületet,`, 'de figyelj a regenerációra is.']
          : ['A tested pihenést kér —', 'ma inkább könnyebb edzés jöhet.'];
      quoteEl.replaceChildren(
        document.createTextNode(first),
        document.createElement('br'),
        document.createTextNode(second),
      );
    }
  }

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

  /** Szám-mezőbe tölthető érték. A régi, mértékegységgel együtt tárolt
      bejegyzésekből („12 rep", „60% TM", „–") kinyeri a számot — a szerver
      induláskor migrálja az adatbázist, ez a kliens-oldali védőháló. */
  function numericValue(raw) {
    const match = String(raw ?? '').replace(',', '.').match(/\d+(\.\d+)?/);
    return match ? match[0] : '';
  }

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

  /** A megjelenített felhasználónév: a saját (localStorage) név, különben a
      szerveré. Külön renderelő, mert korábban csak a beállítások modal
      felépítése írta ki — ha az a lépés elhasalt, a név helye üresen maradt. */
  async function renderUserName() {
    const el = $('.db-username');
    if (!el) return;
    const user = await api.getUser();
    el.textContent = prefs.get('displayName', user.name);
  }

  function renderSetRow(set, index) {
    const row = cloneTemplate('tpl-set-row');
    SET_FIELDS.forEach(([selector, key]) => { $(selector, row).value = numericValue(set[key]); });
    $('.wk-set-check', row).setAttribute('aria-pressed', String(set.done));
    numberSetRow(row, index);
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
    list.replaceChildren(); // újrahíváskor se duplázódjon a lista
    foods.forEach((food) => {
      const item = cloneTemplate('tpl-food');
      item.dataset.foodName = food.name.toLowerCase(); // a kereső erre szűr, nem a teljes szövegre

      // A kcal-jelvény a név span-jén belül ül, ezért a nevet elé szúrjuk be.
      const nameEl = $('.nu-food-name', item);
      nameEl.insertBefore(document.createTextNode(food.name + ' '), nameEl.firstChild);
      $('.nu-food-kcal', item).textContent = `${food.kcal} kcal`;
      $('.nu-food-macros', item).textContent =
        `${food.per} · ${formatNumber(food.protein)} g F · ${formatNumber(food.carbs)} g Cs · ${formatNumber(food.fat)} g Zs`;

      // A nyíl az adagválasztó modált nyitja — a naplózás onnan indul
      const addBtn = $('.nu-food-add', item);
      addBtn.dataset.food = food.name;
      addBtn.title = 'Adag megadása és hozzáadás';
      addBtn.setAttribute('aria-haspopup', 'dialog');
      addBtn.setAttribute('aria-label', `${food.name} — adag megadása és hozzáadás a naplóhoz`);
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
    grid.replaceChildren(); // újrahíváskor se duplázódjanak a kártyák
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

  /** Egy edzés reális felső határa — ennél régebbi kezdés elfelejtett
      (nem lezárt) edzésre utal, nem a mostanira. */
  const MAX_WORKOUT_HOURS = 8;

  /** Az edzés kezdete óta eltelt percek. A kezdés időbélyegéből számol, nem a
      naptári napból: így az éjfélen átnyúló edzés is a valós hosszát mutatja
      (korábban ilyenkor 0 percet írt ki). */
  const workoutMinutes = () => {
    const start = prefs.get(WORKOUT_START_KEY, null);
    if (!start) return 0;
    const elapsedMinutes = Math.round((Date.now() - start.ts) / 60000);
    if (elapsedMinutes > MAX_WORKOUT_HOURS * 60) return 0;
    return Math.max(1, elapsedMinutes);
  };

  const SUMMARY_QUOTES = [
    'Erős voltál ma — a következő edzés még jobb lesz!',
    'Minden pipált szett egy lépés a célod felé.',
    'A folyamatosság veri a tökéletességet — ma is jelen voltál.',
    'Szép munka! A regeneráció most ugyanolyan fontos, mint a súly.',
  ];
  let summaryQuoteIndex = Math.floor(Math.random() * SUMMARY_QUOTES.length);

  /** Az utoljára lezárt edzés összegzése. Az „Edzés befejezése" a naplót
      lezárja és kiüríti, ezért az összegző értékeit a lezárás pillanatában
      rögzítjük — az élő DOM-ból már nem lennének kiolvashatók. */
  let lastSummary = null;

  /** Az edzésnapló pillanatnyi állapotának összegzése (a lezáráskor és a
      mély-linkkel megnyitott összegzőnél is ez számol). */
  function summarizeWorkout() {
    const workoutPage = $('[data-page="workout"]');
    const checks = $$('.wk-set-list .wk-set-check', workoutPage);
    const done = checks.filter((check) => check.getAttribute('aria-pressed') === 'true').length;
    return {
      name: $('#workout-name').value.trim() || 'Edzés',
      done,
      total: checks.length,
      minutes: done === 0 ? 0 : workoutMinutes(),
      hasPr: $$('.wk-exercise-head .wk-pr', workoutPage)
        .some((el) => el.getAttribute('aria-pressed') === 'true'),
    };
  }

  const setLastSummary = (summary) => { lastSummary = summary; };

  function renderSummary() {
    // Lezárás után a rögzített pillanatkép, egyébként az élő naplóállapot
    const summary = lastSummary ?? summarizeWorkout();

    $('[data-su-name]').textContent = summary.name;
    $('[data-su-pr]').hidden = !summary.hasPr;
    $('[data-su-sets-total]').textContent = String(summary.total);
    $('[data-su-quote]').textContent = SUMMARY_QUOTES[summaryQuoteIndex % SUMMARY_QUOTES.length];
    summaryQuoteIndex += 1; // minden megnyitásra másik motivációs sor jut

    animateNumber($('[data-su-sets-done]'), summary.done, { from: 0, duration: 700 });
    animateNumber($('[data-su-duration]'), summary.minutes, { from: 0, duration: 800 });
  }

  /* ---- Regeneráció (Recovery Engine) ---- */

  /** A kilenc izomcsoport kulcsa és magyar címkéje — a szerver
      MUSCLE_GROUPS-ával azonos sorrendben (server/muscles.js). A check-in
      izomláz- és fájdalom-mezői ebből épülnek. */
  const MUSCLE_GROUPS = [
    ['chest', 'Mell'], ['back', 'Hát'], ['shoulders', 'Váll'], ['arms', 'Karok'],
    ['quads', 'Quadriceps'], ['hamstrings', 'Hamstring'], ['glutes', 'Farizom'],
    ['calves', 'Vádli'], ['core', 'Törzs'],
  ];

  /** A gyors check-in 1–5-ös skálái: [mező-név, címke, [1-es végpont, 5-ös végpont]]. */
  const CHECKIN_SCALES = [
    ['sleepQuality', 'Alvásminőség', ['nagyon rossz', 'kiváló']],
    ['energy', 'Energiaszint', ['kimerült', 'tele energiával']],
    ['stress', 'Stresszszint', ['nyugodt', 'nagyon feszült']],
  ];

  /** A részletes blokk közérzet-skálája (ugyanaz a komponens). */
  const MOOD_SCALE = ['mood', 'Közérzet', ['beteg vagyok', 'remekül']];

  /** Készenlét-sáv → állapot-kulcs. A CSS ebből színez (ok / warn / bad). */
  const readinessTone = (value) => (value >= 80 ? 'ok' : value >= 60 ? 'warn' : 'bad');

  const CONFIDENCE_LABELS = { high: 'Megbízható', medium: 'Közepes', low: 'Tájékoztató' };

  /**
   * Egy 0–5 vagy 1–5 skála felépítése chip-csoportként. Az érték az
   * aria-pressed attribútumban él (a terv-építő nap-chipjeivel azonos minta),
   * így nincs a DOM mellett külön állapot, amit szinkronban kéne tartani.
   * A `null` érték érvényes: azt jelenti, hogy a felhasználó nem adta meg —
   * a motor ilyenkor újraosztja a súlyt.
   */
  function buildScale({ name, label, min, max, hint }) {
    const scale = cloneTemplate('tpl-scale');
    scale.dataset.field = name;
    $('.rc-scale-label', scale).textContent = label;
    $('.rc-scale-hint', scale).textContent = hint ?? '';

    const chips = $('.rc-scale-chips', scale);
    chips.setAttribute('aria-label', label);
    for (let value = min; value <= max; value += 1) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'rc-chip';
      chip.textContent = String(value);
      chip.dataset.value = String(value);
      chip.setAttribute('aria-pressed', 'false');
      chip.setAttribute('aria-label', `${label}: ${value}`);
      chip.addEventListener('click', () => {
        // Az aktív chip újbóli megnyomása törli a választást — így egy
        // véletlen kattintás visszavonható „nem adtam meg" állapotra.
        const active = chip.getAttribute('aria-pressed') === 'true';
        $$('.rc-chip', chips).forEach((c) => c.setAttribute('aria-pressed', 'false'));
        chip.setAttribute('aria-pressed', String(!active));
      });
      chips.appendChild(chip);
    }
    return scale;
  }

  /** Egy chip-skála aktuális értéke, vagy null, ha nincs kiválasztva. */
  const readScale = (scaleEl) => {
    const active = $('.rc-chip[aria-pressed="true"]', scaleEl);
    return active ? Number(active.dataset.value) : null;
  };

  /** Egy chip-skála beállítása (null → semmi sincs kiválasztva). */
  const writeScale = (scaleEl, value) => {
    $$('.rc-chip', scaleEl).forEach((chip) => {
      chip.setAttribute('aria-pressed', String(value !== null && value !== undefined && Number(chip.dataset.value) === Number(value)));
    });
  };

  /** Egy 0–100 érték kiírása sávra: szélesség, ARIA és állapot-szín. */
  function fillBar(barEl, value, label) {
    barEl.setAttribute('aria-valuenow', String(value));
    barEl.setAttribute('aria-label', `${label} — ${value}%`);
    barEl.dataset.tone = readinessTone(value);
    $('.pl-progress-fill', barEl).style.width = `${value}%`;
  }

  /** A készenléti riport kirajzolása. A `report` a GET /api/readiness válasza. */
  function renderRecovery(report) {
    const page = $('[data-page="recovery"]');
    if (!page || !report) return;

    // — Összesített pontszám + gyűrű —
    const overall = report.overall ?? 0;
    const ring = $('[data-rc-ring]');
    ring.style.setProperty('--readiness', overall);
    ring.dataset.tone = readinessTone(overall);
    ring.setAttribute('aria-label', `${overall} pont készenlét`);
    $('.rc-score-num').textContent = String(overall);

    $('[data-rc-verdict]').textContent = overall >= 85
      ? 'Készen állsz — ma mehet a nehezebb edzés.'
      : overall >= 70
        ? 'Rendben vagy — tartsd a tervezett terhelést.'
        : overall >= 55
          ? 'Fáradt vagy — érdemes visszavenni a volumenből.'
          : 'A tested pihenést kér — ma inkább könnyű nap.';

    // — Megbízhatóság —
    const badge = $('[data-rc-confidence-badge]');
    badge.textContent = CONFIDENCE_LABELS[report.confidence] ?? report.confidence;
    badge.dataset.level = report.confidence;
    $('[data-rc-confidence-text]').textContent = report.confidenceNote ?? '';

    // — Sapkák (fájdalom, betegség) —
    const caps = $('[data-list="rc-caps"]');
    caps.replaceChildren();
    report.caps.forEach((text) => {
      const item = document.createElement('li');
      item.className = 'rc-cap';
      item.textContent = text;
      caps.appendChild(item);
    });
    caps.hidden = report.caps.length === 0;

    // — Komponens-bontás —
    const components = $('[data-list="rc-components"]');
    components.replaceChildren();
    report.components.forEach((component, index) => {
      const row = cloneTemplate('tpl-rc-component');
      row.style.setProperty('--i', index);
      row.classList.toggle('rc-component--absent', !component.present);
      $('.rc-component-label', row).textContent = component.label;
      $('.rc-component-weight', row).textContent = component.present ? `${component.weight}%` : 'nincs adat';
      $('.rc-component-value', row).textContent = component.present ? `${component.score}` : '—';
      fillBar($('.rc-bar', row), component.present ? component.score : 0, component.label);
      components.appendChild(row);
    });

    // — CNS —
    $('[data-rc-cns]').textContent = String(report.cns.readiness);
    $('[data-rc-cns-note]').textContent = report.cns.readiness >= 80
      ? 'Friss idegrendszer — a nehéz, alacsony ismétléses munka rendben van.'
      : report.cns.readiness >= 60
        ? 'Enyhén terhelt — kerüld a maximum-közeli szetteket.'
        : 'Terhelt idegrendszer — nehéz guggolás, felhúzás és PR-próbálkozás ma nem javasolt.';

    // — Izomcsoportok —
    const muscles = $('[data-list="rc-muscles"]');
    muscles.replaceChildren();
    report.muscles.forEach((muscle, index) => {
      const row = cloneTemplate('tpl-rc-muscle');
      row.style.setProperty('--i', index);
      $('.rc-muscle-label', row).textContent = muscle.label;
      $('.rc-muscle-value', row).textContent = `${muscle.readiness}%`;
      fillBar($('.rc-bar', row), muscle.readiness, muscle.label);

      // A meta-sor megmondja, mire épül a becslés — a szám így nem varázslat
      const meta = [];
      if (muscle.lastLoadedDaysAgo !== null) {
        meta.push(muscle.lastLoadedDaysAgo === 0 ? 'ma terhelted' : `${muscle.lastLoadedDaysAgo} napja terhelted`);
      }
      if (muscle.soreness !== null) meta.push(`izomláz ${muscle.soreness}/5`);
      if (muscle.pain !== null && muscle.pain > 0) meta.push(`fájdalom ${muscle.pain}/10`);
      $('.rc-muscle-meta', row).textContent = meta.join(' · ');
      muscles.appendChild(row);
    });

    // — Gyakorlat-ajánlások —
    const lifts = $('[data-list="rc-lifts"]');
    lifts.replaceChildren();
    report.exercises.forEach((lift, index) => {
      const item = cloneTemplate('tpl-rc-lift');
      item.style.setProperty('--i', index);
      item.dataset.verdict = lift.verdict;
      $('.rc-lift-name', item).textContent = lift.name;
      $('.rc-lift-score', item).textContent = `${lift.readiness}%`;
      $('.rc-lift-score', item).dataset.tone = readinessTone(lift.readiness);
      $('.rc-lift-text', item).textContent = lift.text;
      $('[data-lift-load]', item).textContent = lift.loadDelta;
      $('[data-lift-volume]', item).textContent = lift.volumeDelta;
      lifts.appendChild(item);
    });
    $('[data-rc-lifts-empty]').hidden = report.exercises.length > 0;
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

      // Fókusz-csapda: Tab-bal nem lehet a háttérbe lépni, amíg a modal nyitva van.
      // A [tabindex="0"] is kell: az étel-modál gramm-választója nem gomb, de
      // billentyűzettel kezelhető — enélkül a csapda átugraná.
      if (event.key === 'Tab') {
        const focusables = $$('button, [href], input, select, textarea, [tabindex="0"]', modal)
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

  /**
   * Megerősítő ablak adatvesztéssel járó műveletekhez. A natív
   * `window.confirm()` helyett: az app design-nyelvén szólal meg, és a
   * fókuszkezelése a többi modáléval azonos (fókusz-csapda, Escape,
   * visszaadott fókusz). Promise<boolean>-t ad — a hívó `await`-tel használja.
   *
   * A fókusz szándékosan a „Mégse" gombra kerül: a megerősítendő művelet
   * visszafordíthatatlan, a véletlen Enter ne hajtsa végre.
   */
  function setupConfirmDialog() {
    const modal = $('#confirmModal');
    const controller = createModalController(modal);
    const titleEl = $('#confirmModalTitle');
    const textEl = $('#confirmModalText');
    const okBtn = $('[data-confirm-ok]', modal);
    const cancelBtn = $('[data-confirm-cancel]', modal);

    let resolve = null;
    /** Egyszer lezáró elsütés — a nyitva maradt ígéret hamissal zárul. */
    const settle = (value) => {
      const pending = resolve;
      resolve = null;
      controller.close();
      pending?.(value);
    };

    okBtn.addEventListener('click', () => settle(true));
    cancelBtn.addEventListener('click', () => settle(false));
    // Bezárás (✕, backdrop) és Escape = elutasítás. A createModalController
    // ezekre már zárja az ablakot; itt csak az ígéretet kell lezárni.
    $$('[data-close-modal]', modal).forEach((el) => el.addEventListener('click', () => settle(false)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('is-open')) settle(false);
    });

    return (message, { title = 'Biztosan folytatod?', confirmLabel = 'Folytatás' } = {}) =>
      new Promise((res) => {
        settle(false); // egyszerre csak egy kérdés áll fenn
        resolve = res;
        titleEl.textContent = title;
        textEl.textContent = message;
        okBtn.textContent = confirmLabel;
        controller.open();
        cancelBtn.focus();
      });
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

    const chips = PORTION_QUICK.map((value) => {
      const chip = document.createElement('button');
      chip.className = 'fd-chip';
      chip.type = 'button';
      chip.textContent = `${value} g`;
      chip.dataset.grams = value;
      chip.setAttribute('aria-pressed', 'false');
      return chip;
    });
    chipBox.append(...chips);

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

      chips.forEach((chip) => {
        chip.setAttribute('aria-pressed', String(Number(chip.dataset.grams) === grams));
      });

      const index = portionIndex(grams);
      picker.setAttribute('aria-valuenow', grams);
      picker.setAttribute('aria-valuetext', `${grams} gramm`);
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
        grams = PORTION_DEFAULT;

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
    // A név kiírását a renderUserName végzi — ez a modal csak szerkeszti

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

    /* A név — a kapcsolókhoz hasonlóan — azonnal érvényesül gépelés közben,
       így a „Mentés" gomb nem hazudik olyan műveletet, ami valójában már
       megtörtént (a kapcsolók eddig is azonnal hatottak). Kiürített mezőnél
       a szerver szerinti névre esünk vissza, nem a korábbi egyéni névre —
       korábban ez némán, visszajelzés nélkül maradt a régin. */
    const applyName = () => {
      const name = nameInput.value.trim();
      if (name) prefs.set('displayName', name);
      else prefs.set('displayName', undefined);
      usernameEl.textContent = name || user.name;
    };

    nameInput.addEventListener('input', applyName);
    nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') controller.close();
    });

    $('[data-action="save-settings"]').addEventListener('click', () => {
      applyName();
      controller.close();
    });

    return {
      open() {
        nameInput.value = prefs.get('displayName', '') || '';
        nameInput.placeholder = user.name;
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
     töltődnek be. Amint van saját bejegyzés, a diagram KIZÁRÓLAG azokat
     mutatja, a skálát pedig a tényleges értékekhez igazítjuk — a korábbi
     80–86 kg-os fix skálán minden ezen kívüli testsúly a diagram aljára
     lapult, a tengelyfeliratok pedig hazudtak. A seed-görbe csak addig
     látszik, amíg nincs egyetlen valódi bejegyzés sem. */
  const WEIGHT_CHART_BARS = 12;      // legfeljebb ennyi oszlop látszik
  const WEIGHT_CHART_MIN_SPAN = 2;   // kg — ekkora sávot mindenképp lefed a skála

  /** A testsúly Δ előjelesen olvasható (+1.2 / -0.8), a 0 előjel nélkül. */
  const formatDelta = (value) => (value > 0 ? '+' : '') + formatNumber(value);

  /** Diagram-adat a testsúly-bejegyzésekből: a skála alja/teteje a tényleges
      minimum/maximum köré feszül (kis ráhagyással), a tengelyfeliratok pedig
      ebből a skálából állnak elő — nem beégetett értékek. */
  function weightChartData(log) {
    const kgs = log.slice(-WEIGHT_CHART_BARS).map((entry) => entry.kg);
    const min = Math.min(...kgs);
    const max = Math.max(...kgs);
    // Fél kilós rácsra kerekített skála, legalább MIN_SPAN széles
    const padding = Math.max((max - min) * 0.25, (WEIGHT_CHART_MIN_SPAN - (max - min)) / 2, 0.25);
    const low = Math.floor((min - padding) * 2) / 2;
    const high = Math.ceil((max + padding) * 2) / 2;
    const span = high - low;

    return {
      heights: kgs.map((kg) => Math.min(Math.max((kg - low) / span * 100, 6), 100)),
      // Négy felirat felülről lefelé, ahogy a seed-charton is
      axis: [0, 1, 2, 3].map((i) => `${formatNumber(high - (span / 3) * i)} kg`),
    };
  }

  async function setupWeightLog() {
    const form = $('[data-form="weight-log"]');
    const input = $('#weight-input');
    const lastEl = $('[data-weight-last]');
    const chart = $('[data-chart="bodyWeight"]');
    const deltaEl = $('[data-stat="weightDelta"]');

    // A Δ statot kísérő „kg" mértékegység — egyetlen bejegyzésnél elrejtjük
    const deltaUnitEl = deltaEl.parentElement && $('.db-stat-unit', deltaEl.parentElement);

    // A bejegyzések a szerverről jönnek; a lokális másolat a friss válaszokkal frissül
    let log = await api.getWeightLog();

    const sync = ({ animateDelta = false } = {}) => {
      if (log.length === 0) return; // marad a seed-görbe, amíg nincs saját adat

      renderChart(chart, weightChartData(log));

      const latest = log[log.length - 1];
      // Δ csak akkor értelmes, ha van mihez viszonyítani. Korábban az első
      // bejegyzés egy beégetett demo-testsúlyhoz (84.6 kg) mérte magát, és
      // ezért teljesen valótlan változást mutatott.
      if (log.length > 1) {
        const delta = latest.kg - log[log.length - 2].kg;
        if (animateDelta) animateNumber(deltaEl, delta, { duration: 600, format: formatDelta });
        else deltaEl.textContent = formatDelta(delta);
        if (deltaUnitEl) deltaUnitEl.hidden = false;
      } else {
        deltaEl.textContent = '–';
        if (deltaUnitEl) deltaUnitEl.hidden = true;
      }

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

  /** A Regeneráció oldal: a napi check-in űrlap felépítése és mentése, majd a
      készenléti riport kirajzolása. A számítás teljes egészében a szerveren
      (server/recovery.js) fut — a kliens csak beküld és megjelenít. */
  async function setupRecovery() {
    const page = $('[data-page="recovery"]');
    if (!page) return;

    const form = $('[data-form="checkin"]', page);
    const stateEl = $('[data-checkin-state]', page);
    const scalesWrap = $('[data-list="checkin-scales"]', page);
    const sorenessWrap = $('[data-list="checkin-soreness"]', page);
    const painWrap = $('[data-list="checkin-pain"]', page);
    const sleepInput = $('#checkin-sleep');
    const hydrationInput = $('#checkin-hydration');
    const weightInput = $('#checkin-weight');

    // — Az űrlap dinamikus részei —
    CHECKIN_SCALES.forEach(([name, label, [low, high]]) => {
      scalesWrap.appendChild(buildScale({ name, label, min: 1, max: 5, hint: `1 = ${low} · 5 = ${high}` }));
    });
    MUSCLE_GROUPS.forEach(([key, label]) => {
      sorenessWrap.appendChild(buildScale({ name: `soreness.${key}`, label, min: 0, max: 5 }));
      painWrap.appendChild(buildScale({ name: `pain.${key}`, label, min: 0, max: 10 }));
    });
    painWrap.appendChild(buildScale({ name: 'pain.general', label: 'Általános fájdalom', min: 0, max: 10 }));
    {
      const [name, label, [low, high]] = MOOD_SCALE;
      $('.rc-extra-fields', page).before(buildScale({ name, label, min: 1, max: 5, hint: `1 = ${low} · 5 = ${high}` }));
    }

    /** Egy skála a mező-neve alapján. */
    const scaleFor = (name) => $(`.rc-scale[data-field="${name}"]`, page);

    /** Az űrlap kitöltése a szerverről kapott check-inből (vagy ürítése). */
    const fillForm = (checkin) => {
      const numberOrEmpty = (value) => (value === null || value === undefined ? '' : String(value));
      sleepInput.value = numberOrEmpty(checkin?.sleepHours);
      hydrationInput.value = numberOrEmpty(checkin?.hydration);
      weightInput.value = ''; // a testsúlyt nem töltjük vissza: új mérés, nem szerkesztés

      [...CHECKIN_SCALES, MOOD_SCALE].forEach(([name]) => writeScale(scaleFor(name), checkin?.[name] ?? null));
      MUSCLE_GROUPS.forEach(([key]) => {
        writeScale(scaleFor(`soreness.${key}`), checkin?.soreness?.[key] ?? null);
        writeScale(scaleFor(`pain.${key}`), checkin?.pain?.[key] ?? null);
      });
      writeScale(scaleFor('pain.general'), checkin?.pain?.general ?? null);

      stateEl.textContent = checkin ? 'ma már kitöltötted — módosítható' : 'ma még nincs kitöltve';
      stateEl.dataset.filled = String(Boolean(checkin));
    };

    /** Az űrlap beolvasása a PUT /api/checkin törzsévé. Az üres mezők null-ként
        mennek: a motor a „nem adta meg" esetet nem nullaként, hanem
        súly-újraosztással kezeli. */
    const readForm = () => {
      const numberOrNull = (input) => (input.value.trim() === '' ? null : Number(input.value));
      const body = {
        sleepHours: numberOrNull(sleepInput),
        hydration: numberOrNull(hydrationInput),
        weightKg: numberOrNull(weightInput),
        soreness: {},
        pain: {},
      };
      [...CHECKIN_SCALES, MOOD_SCALE].forEach(([name]) => { body[name] = readScale(scaleFor(name)); });
      MUSCLE_GROUPS.forEach(([key]) => {
        const soreness = readScale(scaleFor(`soreness.${key}`));
        if (soreness !== null) body.soreness[key] = soreness;
        const pain = readScale(scaleFor(`pain.${key}`));
        if (pain !== null) body.pain[key] = pain;
      });
      const generalPain = readScale(scaleFor('pain.general'));
      if (generalPain !== null) body.pain.general = generalPain;
      return body;
    };

    // A ± léptetőgombok ugyanúgy működnek, mint az edzésnaplóban
    form.addEventListener('click', (event) => { handleStepClick(event); });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const body = readForm();

      // Kliens-oldali előellenőrzés a beszédesebb hibaüzenetért; a szerver
      // ugyanezt újra elvégzi (a kliens értékeiben nem bízunk).
      if (body.sleepHours !== null && (!Number.isFinite(body.sleepHours) || body.sleepHours < 0 || body.sleepHours > 24)) {
        showToast('Az alvás időtartama 0 és 24 óra között adható meg', 'error');
        sleepInput.focus();
        return;
      }
      if (body.weightKg !== null && (!Number.isFinite(body.weightKg) || body.weightKg < 30 || body.weightKg > 300)) {
        showToast('Adj meg érvényes testsúlyt (30–300 kg)', 'error');
        weightInput.focus();
        return;
      }

      const submit = $('.rc-save', form);
      submit.disabled = true;
      try {
        // A válasz a friss riportot is tartalmazza — nem kell külön lekérni
        const { checkin, weightEntry, readiness } = await api.saveCheckin(body);
        fillForm(checkin);
        renderRecovery(readiness);
        showToast(weightEntry
          ? `Check-in mentve · testsúly ${formatNumber(weightEntry.kg)} kg`
          : 'Check-in mentve');
        // Az áttekintő készenlét-gyűrűje ugyanebből a motorból jön
        renderDashboard().catch((err) => console.error('Áttekintő frissítési hiba:', err));
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült menteni a check-int', 'error');
      } finally {
        submit.disabled = false;
      }
    });

    /** Friss riport + check-in a szerverről. A pageEffects és az edzés
        lezárása is ezt hívja. */
    refreshRecovery = async () => {
      const [report, checkin] = await Promise.all([api.getReadiness(), api.getCheckin()]);
      fillForm(checkin);
      renderRecovery(report);
    };

    await refreshRecovery();
  }

  async function setupWorkout(videoModal, picker, confirmAction) {
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

    // Melyik tervből indult az aktuális edzés (null = szabad edzés). A Tervek
    // oldali haladás ebből párosít, nem a terv nevéből.
    let currentPlanId = null;

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
    /** Sikertelen mentés utáni újrapróbálkozások szünetei. A végén megáll: a
        felhasználó ekkor már látja a hibaállapotot, és ő dönt. */
    const AUTOSAVE_RETRY_MS = [3000, 8000, 20000];

    const statusEl = $('[data-autosave-status]');
    const statusTextEl = $('[data-autosave-text]');
    const IDLE_TEXT = statusTextEl.textContent;

    /** Az automatikus mentés állapota egy soron. Korábban itt csak egy statikus
        ígéret állt („a módosítások automatikusan mentődnek"), a hiba pedig
        kizárólag a konzolra ment — a felhasználó azt hitte, minden mentve van,
        közben nem. */
    const setStatus = (state, text) => {
      statusEl.dataset.state = state;
      statusTextEl.textContent = text;
    };
    const clockNow = () => new Date().toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });

    let autosaveTimer = null;
    let retryTimer = null;
    let retryStep = 0;

    const flush = async () => {
      autosaveTimer = null;
      retryTimer = null; // ha újrapróbálkozásból futunk, az az időzítő már elsült
      setStatus('saving', 'Mentés…');
      try {
        await api.saveWorkoutDraft(titleInput.value.trim(), readCurrentWorkout(), currentPlanId);
        retryStep = 0;
        setStatus('saved', `Mentve · ${clockNow()}`);
      } catch (err) {
        console.error('Automatikus mentés sikertelen:', err);
        const wait = AUTOSAVE_RETRY_MS[retryStep];
        if (wait === undefined) {
          setStatus('error', 'A napló nincs elmentve — ellenőrizd a kapcsolatot, majd módosíts valamit az újrapróbáláshoz.');
          return;
        }
        retryStep += 1;
        setStatus('error', `Nem sikerült menteni — újrapróbálkozás ${Math.round(wait / 1000)} mp múlva…`);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush, wait);
      }
    };

    const autosave = () => {
      // Bármilyen változtatás után újra él az edzés: az összegző megint az
      // aktuális naplóállapotot mutassa, ne a legutóbbi lezárás pillanatképét.
      setLastSummary(null);
      // Új változtatás → a hibás kör újraindul az elejéről
      clearTimeout(retryTimer);
      retryStep = 0;
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
    };

    /** A függő mentés leállítása (az edzés lezárása hívja: a piszkozat törlése
        után egy késleltetett mentés visszaírná a most lezárt edzést). */
    const cancelAutosave = () => {
      clearTimeout(autosaveTimer);
      clearTimeout(retryTimer);
      autosaveTimer = null;
      retryTimer = null;
      retryStep = 0;
      setStatus('idle', IDLE_TEXT);
    };
    document.addEventListener('visibilitychange', () => {
      // Függő mentés VAGY függő újrapróbálkozás esetén is küldünk: a
      // lapelrejtés (bezárás, tab-váltás) az utolsó esély.
      if (document.visibilityState !== 'hidden' || (autosaveTimer === null && retryTimer === null)) return;
      clearTimeout(autosaveTimer);
      clearTimeout(retryTimer);
      autosaveTimer = null;
      retryTimer = null;
      fetch('/api/workout-draft', {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: titleInput.value.trim(),
          exercises: readCurrentWorkout(),
          planId: currentPlanId,
        }),
      }).catch(() => {});
    });

    /** A szervertől kapott induló tartalom betöltése a naplóba. */
    const applyTemplate = (template) => {
      if (!template) return;
      currentPlanId = template.planId ?? null;
      titleInput.value = template.name;
      list.replaceChildren();
      template.exercises.forEach((exercise) => {
        list.appendChild(renderExercise(exercise, exerciseOptions));
      });
      if (template.source === 'plan') showToast(`Mai terv betöltve: ${template.name}`);
      syncEmpty();
    };

    // Az induló tartalom a szervertől: aznapi piszkozat, vagy — új napon —
    // a mai hétnapra ütemezett terv. Ha nincs egyik sem, a napló üres, és az
    // üres állapot hívja a Tervek oldalt / a gyakorlat-hozzáadást.
    applyTemplate(await api.getWorkoutTemplate());
    syncEmpty();

    /* Napváltás éjfélkor: ilyenkor a MAI napra ütemezett terv válik érvényessé.
       Ha a naplóban még nincs megkezdett munka, csendben átváltunk rá; ha van,
       nem írjuk felül a félkész edzést — csak jelezzük, mi a teendő. Enélkül
       a napokon át nyitva hagyott app a tegnapi edzést mutatta tovább. */
    onDayChange(async () => {
      const hasProgress = $$('.wk-set-check', page)
        .some((check) => check.getAttribute('aria-pressed') === 'true');
      if (hasProgress) {
        showToast('Új nap kezdődött — zárd le az edzést, hogy a mai terv betölthesse magát');
        return;
      }
      applyTemplate(await api.getWorkoutTemplate());
    });

    // Az ism./súly/RPE mezők átírása is változtatás — a piszkozattal mentődik.
    // (Az edzésnév saját input-figyelője a hibaállapotot is kezeli, ezért az
    //  nem itt, hanem külön fut.)
    page.addEventListener('input', (event) => {
      if (event.target.matches('.wk-num-input')) autosave();
    });

    // Delegált kattintáskezelés — a dinamikusan hozzáadott sorokra is érvényes.
    page.addEventListener('click', (event) => {
      // Szett-értékek léptetése, illetve szett hozzáadása / törlése
      if (handleStepClick(event)) return; // a kiváltott input esemény menti
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

    /* Edzés befejezése — az edzés LEZÁRÁSA: naplózás után a piszkozat törlődik
       és a napló kiürül, így ugyanaznap új edzés kezdhető, a lezárt edzés pedig
       nem naplózható másodszor is (korábban egy apró módosítás után az újbóli
       befejezés duplikált bejegyzést hozott létre). Amit a felhasználó csinált,
       azt az összegző és a „Korábbi edzések" őrzi meg. */
    const finishBtn = $('[data-action="finish-workout"]');
    finishBtn.addEventListener('click', async () => {
      if (finishBtn.disabled) return;
      if (!validateWorkoutName()) return;
      if (list.children.length === 0) {
        showToast('Adj legalább egy gyakorlatot az edzéshez', 'error');
        return;
      }

      finishBtn.disabled = true;
      try {
        // Az összegző értékeit még a kiürítés előtt rögzítjük
        const summary = summarizeWorkout();
        const saved = await api.saveWorkout(titleInput.value.trim(), readCurrentWorkout(), currentPlanId);

        // A függőben lévő automatikus mentés (és a hiba-újrapróbálkozás) már
        // nem kell — különben visszaírná a most törölt piszkozatot
        cancelAutosave();
        await api.clearWorkoutDraft().catch((err) => {
          console.error('A piszkozat törlése sikertelen:', err);
        });

        // A napló kiürítése (programozott változás — nem indít automatikus mentést)
        list.replaceChildren();
        titleInput.value = '';
        currentPlanId = null;
        prefs.set(WORKOUT_START_KEY, null); // az edzés-óra a következő első pipával indul
        syncEmpty();
        setLastSummary(summary);

        // A naplózott edzés azonnal megjelenik a „Korábbi edzések" tetején,
        // a PR-lista, a heti volumen és az áttekintő számai is frissülnek
        const history = $('[data-list="history"]');
        history.insertBefore(historyEntryEl(workoutHistoryEntry(saved)), history.firstChild);
        syncHistoryEmpty();
        renderPrs().catch(console.error);
        refreshVolumeChart?.().catch(console.error);
        renderDashboard().catch(console.error);
        // A friss edzés azonnal beépül a készenlét-becslésbe (izomcsoportok,
        // CNS, gyakorlat-ajánlások) — nem kell megvárni a következő betöltést
        refreshRecovery?.().catch(console.error);
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
        — így újratöltés után is a betöltött terv marad az edzésnaplóban.

        Ha a naplóban már van teljesített szett, előbb rákérdezünk: a betöltés
        felülírja az egészet. Korábban ez a legpusztítóbb művelet volt az
        appban, és épp ez futott végig kérdés nélkül — miközben egyetlen
        gyakorlat eltávolításánál már volt megerősítés.
        Hamissal tér vissza, ha a felhasználó meggondolta magát. */
    const loadPlan = async (plan) => {
      const doneSets = $$('.wk-set-check', page)
        .filter((check) => check.getAttribute('aria-pressed') === 'true').length;
      if (doneSets > 0) {
        const ok = await confirmAction(
          `A megkezdett edzésedben ${doneSets} teljesített szett van. A(z) „${plan.name}” betöltése ezeket felülírja.`,
          { title: 'Felülírod a megkezdett edzést?', confirmLabel: 'Terv betöltése' },
        );
        if (!ok) return false;
      }

      currentPlanId = plan.id ?? null;
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
      return true;
    };

    return { loadPlan };
  }

  /** A gyakorlat-választó flow-oldal: katalógus a szerverről, kereső + izom-
      csoport chipek, a → gomb a cél-listához adja a gyakorlatot (alap
      szettekkel), a ✓ eltávolítja onnan. A cél (a terv-építő VAGY az
      edzésnapló listája) egy use(context)-tel váltható vezérlőn át áll be —
      a hívó (setupPlanBuilder / setupWorkout) adja meg, mielőtt idenavigál. */
  async function setupExercisePicker(confirmAction) {
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
    list.addEventListener('click', async (event) => {
      const toggle = event.target.closest('.ep-item-toggle');
      if (!toggle || !context) return;

      const name = toggle.closest('.ep-item').dataset.name;
      const existing = $$('.wk-exercise', context.targetList)
        .find((card) => $('.wk-exercise-name', card).textContent.trim() === name);
      if (existing) {
        // Az edzésnaplóban a gyakorlattal együtt a már kipipált szettek is
        // elvesznének — ilyenkor rákérdezünk. Frissen hozzáadott (még nem
        // teljesített) gyakorlatnál marad az azonnali eltávolítás.
        const doneSets = $$('.wk-set-check', existing)
          .filter((check) => check.getAttribute('aria-pressed') === 'true').length;
        if (doneSets > 0) {
          const ok = await confirmAction(
            `A(z) „${name}” gyakorlaton ${doneSets} teljesített szett van. Az eltávolítással ezek elvesznek.`,
            { title: 'Eltávolítod a gyakorlatot?', confirmLabel: 'Eltávolítás' },
          );
          if (!ok) return;
        }
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

    // Szett-értékek léptetése, hozzáadás/törlés (delegálva, az újakra is érvényes)
    list.addEventListener('click', (event) => {
      if (handleStepClick(event)) return;
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
      (a bar-in animáció újraindul), az összvolumen felpörög az új értékre.
      A `refresh()` friss adatot húz le a szerverről — az edzés lezárása ezt
      hívja, hogy a most naplózott szettek azonnal megjelenjenek. */
  async function setupWeeklyCompare() {
    const section = $('.wk-compare');
    const chart = $('[data-chart]', section);
    const totalEl = $('[data-compare-total]');
    const noteEl = $('[data-compare-note]');

    // A két hét adata (volumeThisWeek / volumeLastWeek)
    let charts = await api.getCharts();

    /** Az éppen kiválasztott időszak kulcsa (a váltógombokból). */
    const activePeriod = () =>
      $$('.wk-toggle-btn', section).find((b) => b.getAttribute('aria-pressed') === 'true')
        ?.dataset.period || 'volumeThisWeek';

    const applyPeriod = (period, { animate = false } = {}) => {
      const data = charts[period];
      if (!data) return;
      chart.dataset.chart = period;
      chart.setAttribute('aria-label', data.ariaLabel);
      renderChart(chart, data);
      if (animate) animateNumber(totalEl, data.total, { duration: 600 });
      else totalEl.textContent = formatNumber(data.total);
      noteEl.textContent = data.note;
    };

    // Kezdeti (ez a hét) összesítő a felületre — így nincs beégetett placeholder
    applyPeriod('volumeThisWeek');

    section.addEventListener('click', (event) => {
      const btn = event.target.closest('.wk-toggle-btn');
      if (!btn || btn.getAttribute('aria-pressed') === 'true') return;

      $$('.wk-toggle-btn', section).forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      applyPeriod(btn.dataset.period, { animate: true });
    });

    refreshVolumeChart = async () => {
      charts = await api.refreshCharts();
      applyPeriod(activePeriod(), { animate: true });
    };
  }

  async function setupNutrition(foodDetail) {
    const foods = await api.getFoods();
    const searchInput = $('#food-search');
    const emptyState = $('.nu-empty');
    const logList = $('[data-list="nutrition-log"]');
    const logEmpty = $('[data-nu-log-empty]');
    const logCount = $('[data-nu-log-count]');
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

    /* ---- Mai napló ----
       A felület korábban csak összesített: nem lehetett megnézni, mit ettél
       aznap, és egy téves koppintás visszavonhatatlan volt. A lista a
       szerverről jön, a törlés a bejegyzés id-jével megy. */
    let logEntries = [];

    const renderLog = () => {
      logList.replaceChildren();
      logEntries.forEach((entry, index) => {
        const item = cloneTemplate('tpl-nutrition-entry');
        item.style.setProperty('--i', index);
        $('.nu-log-name', item).textContent = entry.name;
        // Az adag is látszik: két 100 g-os és egy 250 g-os tétel másképp
        // olvasandó, a puszta makrókból ez nem derülne ki.
        $('.nu-log-macros', item).textContent =
          `${formatNumber(entry.grams)} g · ${formatNumber(entry.protein)} g F · ${formatNumber(entry.carbs)} g Cs · ${formatNumber(entry.fat)} g Zs`;
        $('.nu-log-kcal', item).textContent = `${formatNumber(entry.kcal)} kcal`;

        const removeBtn = $('.nu-log-remove', item);
        removeBtn.dataset.entryId = entry.id;
        removeBtn.title = 'Bejegyzés törlése';
        removeBtn.setAttribute('aria-label',
          `${entry.name} (${formatNumber(entry.grams)} g) törlése a mai naplóból`);
        logList.appendChild(item);
      });

      logEmpty.hidden = logEntries.length > 0;
      logCount.textContent = logEntries.length > 0
        ? `${logEntries.length} tétel · ${formatNumber(logEntries.reduce((sum, e) => sum + e.kcal, 0))} kcal`
        : '';
    };

    const reloadLog = async () => {
      logEntries = await api.getNutritionLog();
      renderLog();
    };
    await reloadLog();

    // Törlés — a szerver a frissített összesítőt adja vissza, így egy körből
    // frissül a napló, a makrók és az áttekintő kalória-statja is.
    logList.addEventListener('click', async (event) => {
      const removeBtn = event.target.closest('.nu-log-remove');
      if (!removeBtn) return;
      const id = Number(removeBtn.dataset.entryId);
      const entry = logEntries.find((e) => e.id === id);

      removeBtn.disabled = true;
      try {
        const previous = totals;
        applyTotals(await api.removeNutritionEntry(id), { animateFrom: previous });
        logEntries = logEntries.filter((e) => e.id !== id);
        renderLog();
        refreshDailyStats().catch(console.error);
        showToast(entry ? `${entry.name} törölve a naplóból` : 'Bejegyzés törölve');
      } catch (err) {
        console.error(err);
        removeBtn.disabled = false;
        showToast(err.message || 'Nem sikerült törölni a bejegyzést', 'error');
      }
    });

    // Éjfél után a napi összesítő nulláról indul (a szerver mindig az aznapi
    // bejegyzéseket összegzi — csak újra le kell kérni), és a napló is kiürül.
    onDayChange(async () => {
      applyTotals(await api.getNutrition());
      await reloadLog();
    });

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

    /* Naplózás a részlet-modálból: a szerver a megadott adagra számolja át a
       makrókat, és visszaadja a frissített összesítőt. Hibát tovább dobunk —
       a modál ilyenkor nyitva marad a beállított adaggal. */
    const logFood = async (food, grams) => {
      const previous = totals;
      // A válasz a létrejött bejegyzést IS tartalmazza — így a mai napló
      // listája újabb lekérés nélkül nő eggyel.
      const { entry, totals: next } = await api.addNutritionEntry(food.name, grams);
      applyTotals(next, { animateFrom: previous });
      logEntries = [...logEntries, entry];
      renderLog();
      // Az áttekintő kalória-statja is kövesse a naplózást (közös forrás a szerveren)
      refreshDailyStats().catch(console.error);
      showToast(`${food.name} · ${formatNumber(grams)} g hozzáadva · +${formatNumber(entry.kcal)} kcal`);
    };

    // A kártya nyila az adagválasztó modált nyitja. Ha az (betöltési hiba
    // miatt) nem áll rendelkezésre, a korábbi viselkedés marad: 100 g naplózása.
    $('[data-list="foods"]').addEventListener('click', async (event) => {
      const addBtn = event.target.closest('.nu-food-add');
      if (!addBtn) return;

      const food = foods.find((f) => f.name === addBtn.dataset.food);
      if (!food) return;

      if (foodDetail) {
        foodDetail.open(food, {
          totals,
          entries: logEntries.filter((entry) => entry.name === food.name),
        });
        return;
      }

      try {
        await logFood(food, 100);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült hozzáadni az ételt', 'error');
      }
    });

    return { logFood };
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

  /** Gyorsbillentyűk: 1–5 oldalváltás. Gépelés közben és nyitott modal
      mellett inaktív — utóbbi nélkül a háttérben lévő oldal átváltott,
      miközben az ablak nyitva maradt előtte. */
  const isModalOpen = () =>
    Boolean($('.video-modal.is-open, .settings-modal.is-open, .athlete-modal.is-open, .confirm-modal.is-open'));

  function setupShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isModalOpen()) return;
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
      safe(renderUserName),
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
    // Megerősítő ablak — szinkron felépítésű, mert több setup is erre épül
    const confirmAction = setupConfirmDialog();
    const notifPanel = await safe(setupNotifications);
    const settingsModal = await safe(() => setupSettingsModal({
      onRolesChange: () => coachSurfaces?.apply({ animate: true }),
      onNotifCatsChange: () => notifPanel?.updateBadge(),
    }));
    const athleteModal = await safe(setupAthleteModal);
    setupDashboard(settingsModal);
    await safe(setupWeightLog);
    await safe(setupRecovery);
    // A közös gyakorlat-választó — az edzésnapló és a terv-építő is ezt célozza át
    const picker = await safe(() => setupExercisePicker(confirmAction));
    const workout = await safe(() => setupWorkout(videoModal, picker, confirmAction));
    await safe(setupWeeklyCompare);
    // Az étel-modál és a Táplálkozás oldal kölcsönösen hivatkoznak egymásra
    // (a nyíl nyitja a modált, a modál naplóz az oldal állapotán keresztül),
    // ezért a naplózó függvény a felépült oldalról kerül be utólag.
    let nutrition = null;
    const foodDetail = setupFoodDetail({
      onAdd: (food, grams) => nutrition.logFood(food, grams),
    });
    nutrition = await safe(() => setupNutrition(foodDetail));
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
