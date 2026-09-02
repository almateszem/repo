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

  /* A munkamenet lejárta (401) minden végponton előfordulhat, nem csak
     induláskor: a süti 30 nap után elévül, és a fiók másik eszközről ki is
     jelentkeztethető. Ilyenkor nincs értelme hibaüzenetet mutatni a felület
     ötven pontján — egyszer visszavisszük a felhasználót a belépő képernyőre.
     A jelzőt a setupAuthGate állítja be. */
  let onSessionLost = () => {};
  const SESSION_LOST = 'session-lost';

  /* A böngésző IANA időzónája (pl. "Europe/Budapest"). MINDEN /api kérés
     fejlécében elmegy, mert a NAPOT a szerver ebből képzi: a szerver helyi
     ideje nem a felhasználóé, és UTC-s szerveren a magyar felhasználónak
     hajnali 2-kor váltana a nap — az éjszakai edzés, check-in és étkezés a
     KÖVETKEZŐ naphoz könyvelődne. (server/server.js → todayInZone) */
  const TIME_ZONE = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; }
    catch { return ''; }
  })();

  /** Az API-hívások közös fejlécei. Ismeretlen zónánál a fejléc elmarad, és
      a szerver a saját helyi idejére esik vissza. */
  const apiHeaders = (extra) => (TIME_ZONE ? { ...extra, 'X-Time-Zone': TIME_ZONE } : { ...extra });

  /** 401 esetén elindítja a visszaterelést, és jelzett hibát dob. */
  function handleUnauthorized() {
    onSessionLost();
    const err = new Error('A munkamenet lejárt — jelentkezz be újra.');
    err.code = SESSION_LOST;
    return err;
  }

  /** GET egy JSON-végpontra, egységes hibakezeléssel. */
  async function getJson(path) {
    const res = await fetch(path, { headers: apiHeaders() });
    if (res.status === 401) throw handleUnauthorized();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  }

  /** JSON-törzsű kérés (POST/PUT) egy végpontra. Hiba esetén a szerver `error`
      üzenetét dobja, ha van, különben a HTTP-státuszt. A választ JSON-ként adja vissza. */
  async function sendJson(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw handleUnauthorized();
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
    const res = await fetch(path, { method: 'DELETE', headers: apiHeaders() });
    if (res.status === 401) throw handleUnauthorized();
    if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  }

  /* Az auth-végpontok NEM mehetnek a fenti burkolókon: a 401 ott normális
     válasz („nem vagy belépve"), nem a munkamenet elvesztése. */
  async function authRequest(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const detail = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(detail?.error || `Hiba (${res.status})`);
    return detail;
  }

  /** GET-cache a csak-olvasható referencia-végpontokhoz: több modul kéri
      ugyanazt induláskor, elég egyszer letölteni. Hiba esetén a bejegyzés
      törlődik, hogy egy későbbi hívás újrapróbálhassa. */
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
    /* Friss profil a cache megkerülésével. A szerepkörök nem beállítások:
       a „van edződ" egy elfogadott meghívásból következik, tehát a
       munkamenet közben is megváltozhat. */
    refreshUser:       () => { invalidateCache('/api/user'); return getJsonCached('/api/user'); },
    // Nem cache-elt: a dailyStats a naplózással és a nap váltásával változik
    getDashboard:      () => getJson('/api/dashboard'),
    getCharts:         () => getJsonCached('/api/charts'),
    // Friss chart-adat a cache megkerülésével (edzés naplózása után)
    refreshCharts:     () => { invalidateCache('/api/charts'); return getJsonCached('/api/charts'); },
    getFoods:          () => getJsonCached('/api/foods'),
    // Nem cache-elt: a saját tervek mentés/szerkesztés után változnak
    getPlans:          () => getJson('/api/plans'),
    // Nem cache-elt: a PR-lista a mentett edzésekből épül, mentés után frissül
    getPrs:            () => getJson('/api/prs'),
    getPrHistory:      (exercise) => getJson(`/api/prs/history?exercise=${encodeURIComponent(exercise)}`),
    // Nem cache-elt: az exercise maxes-ek az edzés közben változhatnak
    getExerciseMaxes:  () => getJson('/api/exercise-maxes'),
    /* Az értesítések MÁR NEM cache-elhetők: valódi eseményekből épülnek, és
       az „olvasott" állapot a szerveren él. A read a 204 miatt nem mehet a
       JSON-burkolón — az üres törzsön elhasalna. */
    getNotifications:  () => getJson('/api/notifications'),
    markNotificationsRead: async () => {
      const res = await fetch('/api/notifications/read', { method: 'POST' });
      if (res.status === 401) throw handleUnauthorized();
      if (!res.ok) throw new Error(`POST /api/notifications/read → ${res.status}`);
    },

    /* ---- Kiosztott tervek (edzői oldal) ----
       A saját tervek végpontjai (savePlan / updatePlan) SZÁNDÉKOSAN külön
       maradnak: egy elgépelt paraméter így nem írhat más fiókjába. */
    getClientPlans:    (clientId) => getJson(`/api/coach/clients/${clientId}/plans`),
    assignPlan:        (clientId, name, exercises, days) =>
      postJson(`/api/coach/clients/${clientId}/plans`, { name, exercises, days }),
    updateAssignedPlan: (planId, name, exercises, days) =>
      putJson(`/api/coach/plans/${planId}`, { name, exercises, days }),
    getDefaultSet:     () => getJsonCached('/api/default-set'),
    getExerciseCatalog: () => getJsonCached('/api/exercise-catalog'),
    /* ---- Kommentek ----
       EGY végpontcsalád mindenre: megjegyzés edzéshez/gyakorlathoz/tervhez,
       és az edző–kliens üzenetváltás is. A `subjectId` az a fiók, AKINEK az
       adatáról szó van — edző–kliens viszonyban mindig a kliens. Nincs
       cache: ezek élő, változó szálak. */
    getComments: (subjectId, type, target = '') =>
      getJson(`/api/comments/${subjectId}?type=${type}&target=${encodeURIComponent(target)}`),
    getCommentsByTarget: (subjectId, type) =>
      getJson(`/api/comments/${subjectId}/by-target?type=${type}`),
    addComment: (subjectId, targetType, targetId, text) =>
      postJson(`/api/comments/${subjectId}`, { targetType, targetId, text }),
    deleteComment: (subjectId, commentId) => del(`/api/comments/${subjectId}/${commentId}`),

    /* ---- Edző–kliens kapcsolat ----
       Egyik sem cache-elt: a kapcsolatok és a kliensek kártyaadatai minden
       művelet (meghívás, elfogadás, bontás) után változnak. */
    getCoachOverview:  () => getJson('/api/coach/overview'),
    setCoachRole:      (isCoach) => postJson('/api/coach/role', { isCoach }),
    inviteClient:      (username) => postJson('/api/coach/invites', { username }),
    acceptInvite:      (id) => postJson(`/api/coach/invites/${id}/accept`),
    removeCoachLink:   (id) => del(`/api/coach/links/${id}`),
    // A testsúly-napló. Írni nem innen írunk: a testsúlyt a napi check-in
    // kérdi, és a PUT /api/checkin weightKg mezője rögzíti (naponta egy sor).
    getWeightLog:      () => getJson('/api/weight-log'),
    getNutrition:      () => getJson('/api/nutrition'),
    /* ---- Napi cél ----
       Két forrás lehet (edzői / saját); a válasz mindkettőt hozza, hogy a
       felület ki tudja írni, honnan jön a szám és eltértél-e az edzőitől. */
    getNutritionGoal:  () => getJson('/api/nutrition/goal'),
    saveNutritionGoal: (calories, protein) => putJson('/api/nutrition/goal', { calories, protein }),
    // A válasz a FRISS cél (a visszaállás utáni állapot), ezért sendJson —
    // ugyanaz a minta, mint a naplóbejegyzés törlésénél.
    clearNutritionGoal: () => sendJson('DELETE', '/api/nutrition/goal'),
    setClientNutritionGoal: (clientId, calories, protein) =>
      putJson(`/api/coach/clients/${clientId}/nutrition-goal`, { calories, protein }),
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
    /* Edzés utáni visszajelzés az edzőnek: strukturált (nehézség, közérzet) +
       szabad szöveg. Ugyanarra az edzésre újraküldve felülír. */
    saveWorkoutFeedback: (workoutId, feedback) => putJson(`/api/workouts/${workoutId}/feedback`, feedback),
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
    /* Készenlét-alapú javaslat a MAI naplóra. Az apply ÚJRASZÁMOLJA a
       javaslatot a szerveren — a kliens listáját nem fogadja el bemenetként,
       különben egy hamisított kérés tetszőleges gyakorlatot törölhetne. */
    getSessionAdvice:  () => getJson('/api/readiness/advice'),
    applySessionAdvice: () => postJson('/api/readiness/advice/apply'),

    /* ---- Fiók ----
       A me() a 401-et NEM hibaként kezeli: az a „nincs belépve" normális
       válasza, és a belépő képernyő ebből indul. A firstRun jelzi, ha még
       egyetlen fiók sincs — ilyenkor rögtön a regisztrációt kínáljuk. */
    me: async () => {
      const res = await fetch('/api/auth/me');
      if (res.status === 401) {
        const detail = await res.json().catch(() => ({}));
        return { user: null, firstRun: Boolean(detail.firstRun) };
      }
      if (!res.ok) throw new Error(`GET /api/auth/me → ${res.status}`);
      return { user: await res.json(), firstRun: false };
    },
    login:    (username, password) => authRequest('/api/auth/login', { username, password }),
    register: (username, displayName, password) =>
      authRequest('/api/auth/register', { username, displayName, password }),
    logout:   () => authRequest('/api/auth/logout'),
  };

  /** Értesítés-kategóriák a beállítások modal kapcsolóihoz (notification.cat).
      CSAK olyan kategória szerepel itt, amire a szerver TÉNYLEG küld eseményt.
      A korábbi lista tartalmazott „Sorozat mérföldkő" és „Heti riport" sorokat
      is — azok mögött soha nem állt esemény, csak a demo-adat szövegei.
      A gyakorlat-megjegyzések kategóriája a kommentekkel együtt jön majd. */
  const NOTIF_CATEGORIES = [
    { key: 'invite', label: 'Meghívás, kapcsolat' },
    { key: 'plan', label: 'Terv kiosztva' },
    { key: 'planChange', label: 'Terv módosítva' },
    { key: 'comment', label: 'Üzenet, megjegyzés' },
    { key: 'goal', label: 'Táplálkozási cél' },
  ];

  /** Az oldalak, a nav gyűrű irányai és a gyorsbillentyűk megfeleltetése.
      A 'summary', a 'plan-builder', az 'exercise-picker' és a 'checkin'
      flow-oldalak: a hash-router ismeri őket, de szándékosan nincsenek a nav
      gyűrű irányai és a gyorsbillentyűk között (az „Edzés befejezése", az
      „+ Új terv", a „+ Gyakorlat hozzáadása", ill. az áttekintő check-in
      emlékeztetője és a Regeneráció oldal gombja visz oda). */
  const PAGES = ['dashboard', 'recovery', 'workout', 'nutrition', 'plans', 'coach', 'summary', 'plan-builder', 'exercise-picker', 'checkin'];
  const FLOW_PAGES = ['summary', 'plan-builder', 'exercise-picker', 'checkin']; // friss megnyitáskor nem állnak vissza
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
      // Nincs adat → nincs mit felpörgetni; a „—" helyőrzőt a renderDashboard írja ki.
      if (dashboardData && hasReadiness(dashboardData.readiness)) {
        animateNumber($('.db-percent-num'), dashboardData.readiness, { from: 0, duration: 900 });
      }
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
    checkin() {
      // Friss riport (készenlét + a mai check-in értékei) minden megnyitáskor.
      // A lépés-pozíció csak új munkamenetnél áll vissza — lásd
      // refreshCheckinWizard.
      refreshCheckinWizard?.().catch((err) => console.error('Check-in frissítési hiba:', err));
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

  /** A check-in varázsló frissítője — a setupCheckinWizard állítja be. */
  let refreshCheckinWizard = null;

  /** Az összegző visszajelzés-blokkjának frissítője — a setupSummary állítja be. */
  let refreshSummaryFeedback = null;

  /** Van-e elfogadott edződ. Az edzés utáni visszajelzés blokkja ebből dől el:
      edző nélkül nincs kinek küldeni. A renderUserName tölti fel. */
  let hasCoachLink = false;

  /** A mentett check-in kirajzolása a Regeneráció oldalra — a setupRecovery
      állítja be. A hosszú űrlap ÉS a varázsló is ezt hívja mentés után, így
      a két írási út nem sodródhat szét. */
  let applyCheckinSaved = null;

  /** A készenlét-javaslat ablaka — az init állítja be. A check-in mentése
      után ugrik fel, ha van mit javasolni. Azért modul-szintű, mert a
      setupRecovery-nél KÉSŐBB épül fel (az edzésnapló vezérlője kell hozzá),
      a check-in mentése viszont onnan fut. */
  let adviceModal = null;

  /** A sportoló-kártyák pontszámainak felpörgetése (oldal- és nézetváltáskor). */
  function animateCoachRatings() {
    $$('[data-page="coach"] .co-card-rating[data-rating]').forEach((el) => {
      animateNumber(el, Number(el.dataset.rating) || 0, { from: 0, duration: 700 });
    });
  }

  /* ---- Onboarding-zár ----
     Amíg áll, a #checkin az EGYETLEN elérhető oldal. A frissen regisztrált
     fiók így nem üres Áttekintésre érkezik: kitölti az első check-int, és
     rögtön valódi adatból kapja az első készenléti pontszámot. (Enélkül a
     Recovery Engine — helyesen — `null`-t ad, mert nincs mire alapoznia.)

     A zár állapotát a SZERVER mondja meg (`user.onboarding` = a fióknak még
     soha nem volt check-inje), nem a „most regisztráltam" pillanatnyi tény —
     így az oldal-újratöltést is túléli.

     Négy kijárat van a lapról, és kettő őr fedi le mind a négyet:
       - a `navigate()` őre: nav gyűrű (mobil) + az 1–6 gyorsbillentyűk,
       - a `hashchange` őre: a desktop side-nav sima <a href="#…"> linkjei,
         és a címsorba kézzel írt hash.
     A hidegindítást a setupRouter külön ága intézi. */
  let onboardingLock = false;

  /** A zár be-/kikapcsolása. A body attribútuma a CSS-nek szól: az is elrejti
      a navigációt, mert egy kattintásra visszapattanó menü rossz élmény. */
  function setOnboardingLock(on) {
    onboardingLock = on;
    document.body.toggleAttribute('data-onboarding', on);
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
    'exercise-picker': 'Gyakorlat hozzáadása', checkin: 'Napi check-in',
  };

  /** Az oldalak ikonjai a nav gyűrű gombjához — az index.html tetején lévő közös
      sprite symbol-id-jei. Ugyanaz a 10 kulcs, mint a PAGE_TITLES-ben, hogy a
      kettő ne sodródjon szét. Az Edző oldal a már meglévő #icon-user-t használja. */
  const PAGE_ICONS = {
    dashboard: 'icon-page-dashboard', recovery: 'icon-page-recovery',
    workout: 'icon-page-workout', nutrition: 'icon-page-nutrition',
    plans: 'icon-page-plans', coach: 'icon-user',
    summary: 'icon-page-summary', 'plan-builder': 'icon-page-plan-builder',
    'exercise-picker': 'icon-page-exercise-picker', checkin: 'icon-page-checkin',
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

    /* A gombon lévő ikon az egyetlen jelzés, ami MINDEN oldalra működik: a négy
       iránycímke az Áttekintésnél, a Regenerációnál és a flow-oldalakon egyszerre
       sötét marad. */
    const knob = $('#navKnob');
    const icon = knob?.querySelector('.nav-knob-icon');
    const symbol = PAGE_ICONS[name];
    if (icon) {
      icon.hidden = !symbol; // ismeretlen oldalnál üres gomb, nem törött <use>
      if (symbol) {
        icon.querySelector('use')?.setAttribute('href', `#${symbol}`);
        icon.classList.remove('is-swap');
        void icon.offsetWidth; // reflow: enélkül azonos elemen nem indul újra az animáció
        icon.classList.add('is-swap');
      }
    }
    // Az ikon aria-hidden, így a gomb neve mondja meg a képernyőolvasónak, hol vagy.
    if (knob) {
      knob.setAttribute('aria-label',
        `Navigáció — jelenlegi oldal: ${PAGE_TITLES[name] ?? 'ismeretlen'}. `
        + 'Húzd a kívánt irányba, vagy koppints az áttekintéshez.');
    }
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
    // Onboarding alatt a check-in az egyetlen úti cél (nav gyűrű, gyorsbillentyűk).
    if (onboardingLock && name !== 'checkin') return;
    if (pageFromHash() === name) showPage(name); // azonos hash-nél nem jön hashchange event
    else location.hash = name;
  }

  function setupRouter() {
    // Csak a valódi oldalnevekre váltunk. Ismeretlen hash (skip link, horgony,
    // elgépelt link) esetén az aktuális oldal marad — nem dobjuk vissza a
    // felhasználót az Áttekintésre.
    window.addEventListener('hashchange', () => {
      const page = pageFromHash();
      /* Onboarding alatt a side-nav sima linkjei és a kézzel írt hash is ide
         fut be — a navigate() őre azokat nem látja, ezért itt terelünk vissza.
         A `page &&` nem elhagyható: a nem-oldalnév hash (a `#app-main` skip
         link, a `#title-…` horgonyok) NEM oldalváltás, azt békén hagyjuk —
         különben pont az akadálymentességi ugrólink törne el. */
      if (onboardingLock && page && page !== 'checkin') {
        location.hash = 'checkin';
        return;
      }
      if (page) showPage(page);
    });

    /* Onboarding: a lastPage visszaállítása előtt döntünk, és a flow-hash
       törlése ELŐTT — az kitörölné a #checkin-t. Egyben azt is megelőzi, hogy
       az új fiók az ELŐZŐ felhasználó utolsó oldalára essen: a prefs.lastPage
       böngésző-globális, nem fiókonkénti. */
    if (onboardingLock) {
      navigate('checkin');
      return;
    }

    // A flow-oldalak (összegző / terv-építő / gyakorlat-választó) csak a
    // saját indító gombjukon át nyílnak meg helyesen — az állítja be az
    // előfeltételt (lastSummary / editingId / a választó `context`-je).
    // Ha az app hidegen úgy indul, hogy a hash MÁR egy flow-oldalra mutat
    // — pl. a telefon vissza gombja megölte, majd a rendszer a régi URL-lel
    // állította vissza az oldalt —, ez az előfeltétel hiányzik: a
    // gyakorlat-választón például a hozzáadás-gomb némán nem csinál semmit.
    // Indításkor ezért úgy kezeljük ezt a hash-t, mintha üres lenne.
    if (FLOW_PAGES.includes(pageFromHash())) location.hash = '';

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

  /** A napi check-in emlékeztető ki/be kapcsolása az áttekintőn. A gomb csak
      addig látszik, amíg a mai check-in hiányzik. A desktop rács is követi az
      állapotot (data-checkin-pending): a gomb a jobb oszlopot tölti ki, ezért
      a rejtésekor másik grid-template kell, különben ott üres hasáb maradna. */
  function syncCheckinCta(checkinPresent) {
    const cta = $('[data-checkin-cta]');
    if (!cta) return;
    cta.hidden = Boolean(checkinPresent);
    $('.dashboard')?.setAttribute('data-checkin-pending', String(!checkinPresent));
  }

  /** Csak az áttekintő élő értékeinek újralekérése — étel-naplózás és napváltás
      után, hogy a napi statok és a check-in emlékeztető a friss szerver-állapotot
      mutassák a többi dashboard-elem (pl. az edzésnév-mező) újrarenderelése
      nélkül. Éjfél után ez hozza vissza az emlékeztetőt: a szerver az új napra
      számol, amire még nincs check-in. */
  async function refreshDailyStats() {
    const { dailyStats, checkinPresent } = await api.getDashboard();
    if (dashboardData) {
      dashboardData.dailyStats = dailyStats;
      dashboardData.checkinPresent = checkinPresent;
    }
    renderDailyStats(dailyStats);
    syncCheckinCta(checkinPresent);
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
    const readinessKnown = hasReadiness(readiness);
    if (ring) {
      ring.style.setProperty('--readiness', readinessKnown ? readiness : 0);
      ring.setAttribute('aria-label', readinessKnown
        ? `${readiness} százalék készenlét`
        : 'Készenlét: nincs elég adat');
    }
    // A szám animálását a pageEffects végzi — de ha nincs adat, ott sincs
    // mit felpörgetni, ezért a helyőrzőt itt írjuk ki.
    if (!readinessKnown) {
      const num = $('.db-percent-num');
      if (num) num.textContent = '—';
    }

    // A kártya alsó sora megmondja, mire épül a szám — a Recovery Engine
    // enélkül csak egy önmagát magyarázó szám lenne.
    setText('[data-readiness-note]', !readinessKnown
      ? 'még nincs elég adat →'
      : dashboardData.checkinPresent
        ? (dashboardData.readinessConfidence === 'high'
          ? 'a saját előzményedhez mérve'
          : 'részben általános referenciával')
        : 'töltsd ki a napi check-int →');

    // A check-in emlékeztető gomb. A check-in mentése renderDashboard-ot hív,
    // így a gomb azonnal eltűnik — újratöltés nélkül.
    syncCheckinCta(dashboardData.checkinPresent);

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
    const set = {
      done: $('.wk-set-check', row).getAttribute('aria-pressed') === 'true',
      type: row.dataset.setType || 'work',
    };
    SET_FIELDS.forEach(([selector, key]) => { set[key] = $(selector, row).value.trim(); });
    return set;
  };

  /** A megjelenített felhasználónév: a saját (localStorage) név, különben a
      szerveré. Külön renderelő, mert korábban csak a beállítások modal
      felépítése írta ki — ha az a lépés elhasalt, a név helye üresen maradt. */
  /** A bejelentkezett fiók azonosítója. A chat ebből tudja, melyik üzenet a
      sajátunk a KÖZÖS szálban (a szálat mindkét fél ugyanúgy kéri le). */
  let myUserId = null;

  async function renderUserName() {
    const el = $('.db-username');
    if (!el) return;
    const user = await api.getUser();
    myUserId = user.id ?? null;
    hasCoachLink = Boolean(user.hasCoach);
    el.textContent = prefs.get('displayName', user.name);
  }

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
    prBtn.hidden = !prToggle;
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
    exercise.sets.forEach((set, index) => setList.appendChild(renderSetRow(set, index)));
    renumberSets(setList); // a drop setek az előző szett számát öröklik

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
      // A kereső erre szűr, nem a teljes szövegre. A kategória is bele megy:
      // 437 étel közt a „tejtermék” vagy a „hüvelyes” beírása használhatóbb
      // belépő, mint végiggörgetni a listát.
      item.dataset.foodName = [food.name, food.group].filter(Boolean).join(' ').toLowerCase();

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

    /* „Módosítva 2 órája · Kovács Bence" — csak kiosztott terven. Enélkül a
       kliens észrevétlenül más edzést csinálna, mint amit tegnap látott. */
    const change = $('.pl-card-change', card);
    change.hidden = !plan.changeNote;
    if (plan.changeNote) change.textContent = plan.changeNote;

    /* A mai készenlét figyelmeztetése. A terv NEM íródik át tőle — az
       elrejtené az edző elől, mi történt —, csak megjelöljük, mi kockázatos. */
    const safety = $('.pl-card-safety', card);
    const blocked = plan.safety?.blocked ?? [];
    const caution = plan.safety?.caution ?? [];
    safety.hidden = blocked.length === 0 && caution.length === 0;
    if (!safety.hidden) {
      const parts = [];
      if (blocked.length) {
        parts.push(`Ma kerüld: ${blocked.map((e) => `${e.name} (${e.reason})`).join('; ')}`);
      }
      if (caution.length) parts.push(`Óvatosan: ${caution.map((e) => e.name).join(', ')}`);
      safety.textContent = parts.join(' · ');
      safety.classList.toggle('is-blocked', blocked.length > 0);
    }

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
  /* A kártya pontszáma. Mindkét összetevő HIÁNYOZHAT: a terv-követés, ha
     nincs napra ütemezett terv, a készenlét, ha a kliensnek még nincs
     semmilyen adata. Ha egyik sincs, nincs pontszám — a kártya „—"-t mutat,
     nem nullát. */
  const athleteRating = (athlete) => {
    const parts = [athlete.readiness, athlete.adherence].filter((v) => v !== null && v !== undefined);
    return parts.length === 0 ? null : Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  };

  const athleteTier = (rating) => (rating === null
    ? { key: 'none', label: 'Nincs elég adat' }
    : rating >= 85
      ? { key: 'gold', label: 'Arany szint' }
      : rating >= 70
        ? { key: 'silver', label: 'Ezüst szint' }
        : { key: 'bronze', label: 'Bronz szint' });

  /** A kártyán megjelenő statok (címke + érték-képző) — a modál bővebb listát mutat. */
  const ATHLETE_CARD_STATS = [
    ['Készenlét', (a) => (a.readiness === null ? '—' : `${a.readiness}%`)],
    // Nincs napra ütemezett terve → nincs mihez mérni a követést.
    ['Terv-követés', (a) => (a.adherence === null ? '—' : `${a.adherence}%`)],
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
      `${athlete.name} — ${rating === null ? 'nincs elég adat' : `${rating} pont, ${tier.label}`}${athlete.alert ? ', figyelmet igényel' : ''} — részletek megnyitása`);

    const ratingEl = $('.co-card-rating', card);
    ratingEl.textContent = rating === null ? '—' : String(rating);
    // A 0-ról felpörgő animáció csak akkor fut, ha van mit felpörgetni.
    if (rating !== null) ratingEl.dataset.rating = rating;
    else delete ratingEl.dataset.rating;
    /* A seed-sportolóknak volt „cél" címkéjük (ERŐ / TÖM / FIT). Valódi
       fióknál ilyen mező nincs — a profilban nem kérünk edzéscélt —, kitalálni
       pedig nem fogunk, ezért a jelvény csak a pontszámot mutatja. */
    $('.co-card-tag', card).hidden = true;
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
  /** Az edzői panel kirajzolása a VALÓDI kliensekből (a hívó adja át őket,
      a lekérés a setupCoachSurfaces dolga). Három állapota van, és a
      harmadikat könnyű elrontani: nulla kliensnél nem szabad „minden rendben"-t
      írni, mert az azt sugallná, hogy a kliensek jól haladnak. */
  function renderCoachPanel(clients) {
    const athletes = clients;
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

    if (athletes.length === 0) {
      icon.textContent = '+';
      title.textContent = 'Még nincs kliensed';
      okText.hidden = false;
      okText.textContent = 'Hívd meg a klienseidet a felhasználónevükkel — '
        + 'az adataikat csak azután látod, hogy elfogadták a meghívást.';
    } else if (flagged.length > 0) {
      icon.textContent = '!';
      title.textContent = `${flagged.length} kliens figyelmet igényel`;
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
      okText.textContent = 'Minden kliensed a terv szerint halad — nincs sürgős teendőd.';
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
      item.dataset.exercise = pr.exercise;
      $('.wk-pr-exercise', item).textContent = pr.exercise;
      
      // Detail: szett információ + 1RM érték
      let detailText = pr.detail;
      if (pr.oneRM !== null && pr.oneRM > 0) {
        detailText += ` • 1RM: ${pr.oneRM.toFixed(1)} kg`;
      }
      $('.wk-pr-detail', item).textContent = detailText;
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

    // A visszajelzés-blokk minden megnyitáskor újraszinkronizál (más edzés,
    // vagy már elküldött visszajelzés).
    refreshSummaryFeedback?.();
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

  /** A gyors check-in 1–5-ös skálái:
      [mező-név, rövid címke, [1-es végpont, 5-ös végpont], varázsló-kérdés].
      A negyedik elem CSAK a lépésenkénti varázslónak kell (ott a kérdés a
      képernyő címe); a Regeneráció oldal részletes űrlapja az első hármat
      használja. Egy táblában tartjuk, hogy a két felület ne sodródjon szét. */
  const CHECKIN_SCALES = [
    ['sleepQuality', 'Alvásminőség', ['nagyon rossz', 'kiváló'], 'Milyen volt az alvásod?'],
    ['energy', 'Energiaszint', ['kimerült', 'tele energiával'], 'Mennyi energiád van ma?'],
    ['stress', 'Stresszszint', ['nyugodt', 'nagyon feszült'], 'Mennyire vagy feszült?'],
  ];

  /** A részletes blokk közérzet-skálája (ugyanaz a komponens). */
  const MOOD_SCALE = ['mood', 'Közérzet', ['beteg vagyok', 'remekül']];

  /** Készenlét-sáv → állapot-kulcs. A CSS ebből színez (ok / warn / bad). */
  const readinessTone = (value) => (value >= 80 ? 'ok' : value >= 60 ? 'warn' : 'bad');

  /* A készenlét NULL, ha a motornak nincs mire alapoznia (vadonatúj fiók:
     se check-in, se naplózott edzés). Ezt sem 0-nak, sem 100-nak nem szabad
     mutatni — előbbi „pihenj ma"-t, utóbbi „tökéletes állapot"-ot állítana
     ott, ahol semmit nem tudunk. */
  const NO_READINESS_TEXT = 'Még nincs elég adat a készenléthez — töltsd ki a napi check-int, '
    + 'vagy naplózz egy edzést.';
  const hasReadiness = (value) => value !== null && value !== undefined;

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
    const overall = report.overall;
    const known = hasReadiness(overall);
    const ring = $('[data-rc-ring]');
    ring.style.setProperty('--readiness', known ? overall : 0);
    ring.dataset.tone = known ? readinessTone(overall) : 'none';
    ring.setAttribute('aria-label', known ? `${overall} pont készenlét` : 'Készenlét: nincs elég adat');
    $('.rc-score-num').textContent = known ? String(overall) : '—';

    $('[data-rc-verdict]').textContent = !known
      ? NO_READINESS_TEXT
      : overall >= 85
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

    // — CNS — (null, ha nincs edzés-előzmény: a nulla terhelés ott üres napló)
    const cns = report.cns.readiness;
    $('[data-rc-cns]').textContent = hasReadiness(cns) ? String(cns) : '—';
    $('[data-rc-cns-note]').textContent = !hasReadiness(cns)
      ? 'Még nincs naplózott edzésed — ebből nem becsülhető idegrendszeri terhelés.'
      : cns >= 80
        ? 'Friss idegrendszer — a nehéz, alacsony ismétléses munka rendben van.'
        : cns >= 60
          ? 'Enyhén terhelt — kerüld a maximum-közeli szetteket.'
          : 'Terhelt idegrendszer — nehéz guggolás, felhúzás és PR-próbálkozás ma nem javasolt.';

    // — Izomcsoportok —
    const muscles = $('[data-list="rc-muscles"]');
    muscles.replaceChildren();
    report.muscles.forEach((muscle, index) => {
      const row = cloneTemplate('tpl-rc-muscle');
      row.style.setProperty('--i', index);
      $('.rc-muscle-label', row).textContent = muscle.label;
      /* A known jelző a motorból jön: hamis, ha se naplózott edzés, se
         bejelentett izomláz/fájdalom nincs mögötte. Ilyenkor a 100% nem
         eredmény, hanem az adat hiánya — nem is mutatjuk százaléknak. */
      $('.rc-muscle-value', row).textContent = muscle.known === false ? '—' : `${muscle.readiness}%`;
      fillBar($('.rc-bar', row), muscle.known === false ? 0 : muscle.readiness, muscle.label);

      // A meta-sor megmondja, mire épül a becslés — a szám így nem varázslat
      const meta = [];
      if (muscle.known === false) meta.push('még nincs adat');
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
      // A második feltétel teszi ismételhetővé: a kiúszó animáció alatt az
      // ablak még `is-open`, így egy közben érkező zárás (pl. gombnyomás ÉS
      // oldalváltás együtt) egy második, árva időzítőt indítana.
      if (!modal.classList.contains('is-open') || modal.classList.contains('is-closing')) return;
      if (prefersReducedMotion) {
        hide();
        return;
      }
      modal.classList.add('is-closing'); // a kiúszó animáció alatt még látszik
      hideTimer = setTimeout(hide, CLOSE_ANIM_MS);
    };

    $$('[data-close-modal]', modal).forEach((el) => el.addEventListener('click', close));

    /* Oldalváltás (a telefon vissza gombja, a nav gyűrű, egy gyorsbillentyű)
       zárja az ablakot. Enélkül a modal az ÚJ oldal fölött maradt nyitva —
       a felhasználó egy másik képernyőn találta magát egy odanem illő
       ablakkal. Az értesítés-panel ugyanezt csinálja már. */
    window.addEventListener('hashchange', close);

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
    /* Oldalváltás = elutasítás. A createModalController az ablakot már zárja,
       de az ígéretet itt kell lezárni: enélkül az `await confirmAction(...)`
       hívó (gyakorlat eltávolítása, terv betöltése) örökre függve maradna. */
    window.addEventListener('hashchange', () => settle(false));

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

  /** Gyakorlat rekord-előzmény modál — a "Korábbi rekordok" listaelemre
      kattintva nyílik, és időrendben (régitől az újig) mutatja az adott
      gyakorlat összes korábbi rekordját, hogy a fejlődés követhető legyen. */
  function setupPrModal() {
    const modal = $('#prModal');
    const exerciseLabel = $('.pr-modal-exercise', modal);
    const historyList = $('[data-pr-history]', modal);
    const controller = createModalController(modal);

    return {
      async open(exerciseName) {
        exerciseLabel.textContent = exerciseName;
        historyList.replaceChildren();
        controller.open();

        try {
          const history = await api.getPrHistory(exerciseName);
          historyList.replaceChildren();
          history.forEach((entry, index) => {
            const item = cloneTemplate('tpl-pr-history-item');
            item.style.setProperty('--i', index);
            let detailText = entry.detail;
            if (entry.oneRM !== null && entry.oneRM > 0) {
              detailText += ` • 1RM: ${entry.oneRM.toFixed(1)} kg`;
            }
            $('.wk-pr-detail', item).textContent = detailText;
            $('.wk-pr-date', item).textContent = entry.date;
            historyList.appendChild(item);
          });
        } catch (err) {
          console.error(err);
        }
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

    /* Szerepkör. EGYETLEN valódi kapcsoló van: „edzek másokat" (a fiók
       is_coach jelzője). A „van edződ" NEM állítható — az egy elfogadott
       meghívásból következik —, ezért csak kiírjuk. Korábban mindkettő
       localStorage-kapcsoló volt, tehát a felület olyan szerepkört is
       mutathatott, ami mögött nem állt semmi. */
    const roleHint = $('[data-role-hint]');
    const roleRow = cloneTemplate('tpl-setting-toggle');
    $('.st-toggle-label', roleRow).textContent = 'Edzek másokat';
    const roleToggle = $('.st-switch', roleRow);
    roleToggle.setAttribute('aria-label', 'Edzői szerepkör');
    roleList.appendChild(roleRow);

    // A modal a saját másolatán dolgozik: a profil a nyitásokkor frissül.
    let roles = { coachesAthletes: Boolean(user.coachesAthletes), hasCoach: Boolean(user.hasCoach) };

    const syncRoleToggles = () => {
      roleToggle.setAttribute('aria-checked', String(roles.coachesAthletes));
      roleToggle.closest('.st-toggle').classList.toggle('is-off', !roles.coachesAthletes);
      roleHint.textContent = roles.hasCoach
        ? 'Van edződ — ezt nem itt kell beállítani, az elfogadott meghívásból következik.'
        : 'Nincs edződ. Ha valaki edzőként meghív, a meghívás az Edző oldalon jelenik meg.';
    };

    /* Átbillentéskor a szerverre megy, és CSAK a sikeres válasz után változik
       a felület — különben a kapcsoló olyan állapotot mutatna, ami a
       szerveren nem áll fenn. */
    roleList.addEventListener('click', async (event) => {
      if (!event.target.closest('.st-switch')) return;
      try {
        const updated = await api.setCoachRole(!roles.coachesAthletes);
        roles = { ...roles, coachesAthletes: Boolean(updated.isCoach) };
      } catch (err) {
        showToast('A szerepkör mentése nem sikerült', 'error');
        return;
      }
      invalidateCache('/api/user');
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

    /* Kijelentkezés. Utána TELJES újratöltés, nem csak képernyőváltás: a
       memóriában lévő cache-ek és a felépült oldalak az előző fiók adatait
       tartalmazzák, azokat nem szabad a következő belépésbe átvinni. */
    $('[data-action="logout"]').addEventListener('click', async () => {
      try {
        await api.logout();
      } catch (err) {
        console.error('Kijelentkezési hiba:', err);
      }
      window.location.reload();
    });

    return {
      async open() {
        nameInput.value = prefs.get('displayName', '') || '';
        nameInput.placeholder = user.name;
        $('[data-st-account]').textContent = `Bejelentkezve: ${user.username ?? user.name}`;
        syncToggles();
        syncRoleToggles();
        controller.open();
        /* A szerepkör-állapot a szerverről frissül — a nyitás nem várhat a
           hálózatra, ezért az ablak MÁR nyitva van, amikor ez befut. */
        try {
          const fresh = await api.refreshUser();
          roles = { coachesAthletes: Boolean(fresh.coachesAthletes), hasCoach: Boolean(fresh.hasCoach) };
          syncRoleToggles();
        } catch { /* marad a korábbi állapot */ }
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

    /* A legutóbb LETÖLTÖTT lista. Nyitáskor mindig frissítjük: az értesítés
       más eszközön/másik fiók műveletéből is keletkezhet, tehát az induláskori
       pillanatkép elavulhat. */
    let notifications = await api.getNotifications();

    /** A némított kategóriák nem számítanak bele az „új" darabszámba. */
    const unreadCount = () => {
      const mutedCats = prefs.get('notifCats', {});
      return notifications.filter((n) => n.unread && !mutedCats[n.cat]).length;
    };

    const updateBadge = (pop = false) => {
      const count = unreadCount();
      badge.hidden = count === 0;
      badge.textContent = String(count);
      badge.setAttribute('aria-label', `${count} új értesítés`);
      if (pop && count > 0 && !prefersReducedMotion) {
        badge.classList.remove('is-pop');
        void badge.offsetWidth; // szándékos reflow: az animáció újraindításához
        badge.classList.add('is-pop');
      }
    };

    const renderList = () => {
      list.replaceChildren();
      // Az üres állapot MOST azt jelenti, hogy tényleg nincs esemény —
      // nem azt, hogy elolvastuk őket.
      emptyState.hidden = notifications.length > 0;

      const mutedCats = prefs.get('notifCats', {}); // a beállítások modal kapcsolói
      notifications.forEach((notif, index) => {
        const li = document.createElement('li');
        li.className = 'notif-item';
        if (mutedCats[notif.cat]) li.classList.add('notif-item--muted');
        if (!notif.unread) li.classList.add('notif-item--read');
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

    /** Friss lista a szerverről — hiba esetén a korábbi marad, nem ürül ki. */
    const refresh = async () => {
      try {
        notifications = await api.getNotifications();
      } catch (err) {
        console.error('Az értesítések frissítése nem sikerült:', err);
      }
      renderList();
      updateBadge();
    };

    const setOpen = (open) => {
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) {
        renderList();
        refresh();
      }
    };

    button.addEventListener('click', () => setOpen(panel.hidden));

    $('[data-action="clear-notifications"]').addEventListener('click', async () => {
      try {
        await api.markNotificationsRead();
      } catch (err) {
        showToast('Nem sikerült olvasottnak jelölni', 'error');
        return;
      }
      notifications = notifications.map((n) => ({ ...n, unread: false }));
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

    updateBadge(true); // betöltéskor egy finom „pop" hívja fel a figyelmet a badge-re

    return { updateBadge, refresh };
  }

  function setupDashboard(settingsModal) {
    // settingsModal null lehet, ha a betöltése hibázott — a gomb ilyenkor inaktív
    $('[data-action="settings"]').addEventListener('click', () => settingsModal?.open());
    $('[data-action="open-workout"]').addEventListener('click', () => navigate('workout'));
  }

  /* ---- Testsúly-napló ----
     A bejegyzéseket a napi check-in írja (PUT /api/checkin → weight_log,
     naponta egy sor); ez a modul csak MEGJELENÍT: a trend-diagramot a
     Regeneráció oldalon és a Δ statot az áttekintőn. Amint van saját
     bejegyzés, a diagram KIZÁRÓLAG azokat mutatja, a skálát pedig a tényleges
     értékekhez igazítjuk — a korábbi 80–86 kg-os fix skálán minden ezen kívüli
     testsúly a diagram aljára lapult, a tengelyfeliratok pedig hazudtak. A
     seed-görbe csak addig látszik, amíg nincs egyetlen valódi bejegyzés sem —
     és ilyenkor a kártya ki is mondja, hogy demo-adatot néz a felhasználó. */
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

  /** A szerverről betöltött testsúly-bejegyzések ({ id, kg, date }), rögzítési
      sorrendben. A check-in varázsló is ebből olvassa a legutóbbi mérést. */
  let weightLog = [];

  /** A legutóbbi testsúly-bejegyzés, vagy null. */
  const latestWeightEntry = () => (weightLog.length ? weightLog[weightLog.length - 1] : null);

  /** A MAI bejegyzés, ha van. A szerver dátumformátumára (ÉÉÉÉ.HH.NN) épül —
      ugyanaz, amit a naplóbejegyzések visznek. */
  function todayWeightEntry() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const key = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
    return weightLog.find((entry) => entry.date === key) ?? null;
  }

  /** A testsúly-nézetek újrarajzolása a `weightLog`-ból. */
  function syncWeightViews({ animateDelta = false } = {}) {
    const chart = $('[data-chart="bodyWeight"]');
    const lastEl = $('[data-weight-last]');
    const emptyEl = $('[data-weight-empty]');
    const deltaEl = $('[data-stat="weightDelta"]');
    // A Δ statot kísérő „kg" mértékegység — egyetlen bejegyzésnél elrejtjük
    const deltaUnitEl = deltaEl?.parentElement && $('.db-stat-unit', deltaEl.parentElement);

    if (weightLog.length === 0) {
      // Marad a seed-görbe — de kimondjuk, hogy az nem a felhasználó adata,
      // és a Δ sem mutat 0-t olyan változásra, amit soha nem mértünk.
      if (emptyEl) emptyEl.hidden = false;
      if (lastEl) lastEl.hidden = true;
      if (deltaEl) deltaEl.textContent = '–';
      if (deltaUnitEl) deltaUnitEl.hidden = true;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    if (chart) renderChart(chart, weightChartData(weightLog));

    const latest = weightLog[weightLog.length - 1];
    if (deltaEl) {
      // Δ csak akkor értelmes, ha van mihez viszonyítani. Korábban az első
      // bejegyzés egy beégetett demo-testsúlyhoz (84.6 kg) mérte magát, és
      // ezért teljesen valótlan változást mutatott.
      if (weightLog.length > 1) {
        const delta = latest.kg - weightLog[weightLog.length - 2].kg;
        if (animateDelta) animateNumber(deltaEl, delta, { duration: 600, format: formatDelta });
        else deltaEl.textContent = formatDelta(delta);
        if (deltaUnitEl) deltaUnitEl.hidden = false;
      } else {
        deltaEl.textContent = '–';
        if (deltaUnitEl) deltaUnitEl.hidden = true;
      }
    }

    if (lastEl) {
      lastEl.hidden = false;
      lastEl.textContent = `Utolsó mérés: ${formatNumber(latest.kg)} kg · ${latest.date}`;
    }
  }

  /** A napló újratöltése a szerverről + újrarajzolás. A Regeneráció oldal
      megnyitása hívja (az adat máshol — akár másik fülön — is változhatott). */
  async function refreshWeightLog() {
    weightLog = await api.getWeightLog();
    syncWeightViews();
  }

  /** A check-in válaszában érkező testsúly-bejegyzés beolvasztása. Naponta egy
      sor van, ezért az azonos id-jű bejegyzést CSERÉLJÜK, nem hozzáfűzzük —
      különben a napi újramentés fantom-oszlopot rakna a diagramra. */
  function mergeWeightEntry(entry) {
    if (!entry) return;
    const index = weightLog.findIndex((item) => item.id === entry.id);
    weightLog = index >= 0
      ? weightLog.map((item, i) => (i === index ? entry : item))
      : [...weightLog, entry];
    syncWeightViews({ animateDelta: true });
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
      // A testsúly nem a check-in sorból, hanem a testsúly-naplóból jön: ha ma
      // már mértél (itt vagy a varázslóban), azt az értéket szerkeszted tovább
      // — naponta egy bejegyzés van, a mentés felülír.
      weightInput.value = numberOrEmpty(todayWeightEntry()?.kg);

      [...CHECKIN_SCALES, MOOD_SCALE].forEach(([name]) => writeScale(scaleFor(name), checkin?.[name] ?? null));
      MUSCLE_GROUPS.forEach(([key]) => {
        writeScale(scaleFor(`soreness.${key}`), checkin?.soreness?.[key] ?? null);
        writeScale(scaleFor(`pain.${key}`), checkin?.pain?.[key] ?? null);
      });
      writeScale(scaleFor('pain.general'), checkin?.pain?.general ?? null);

      stateEl.textContent = checkin ? 'ma már kitöltötted — módosítható' : 'ma még nincs kitöltve';
      stateEl.dataset.filled = String(Boolean(checkin));

      // A varázslóra vivő gomb felirata is az aznapi állapotot tükrözi
      const ctaTitle = $('[data-rc-checkin-cta-title]', page);
      if (ctaTitle) {
        ctaTitle.textContent = checkin ? 'Mai check-in módosítása' : 'Napi check-in kitöltése';
      }
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
        mergeWeightEntry(weightEntry); // a trend-diagram és a Δ stat frissítése
        applyCheckinSaved(checkin, readiness);
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

    /** A mentett check-in kirajzolása. A részletes űrlap és a varázsló is ezt
        hívja mentés után, hogy a Regeneráció oldal mindkét út után ugyanúgy
        frissüljön (űrlap-értékek + riport-kártyák + készenlét-gyűrű). */
    applyCheckinSaved = (checkin, readiness) => {
      fillForm(checkin);
      renderRecovery(readiness);
      /* A friss check-in új képet ad a mai állapotról — ez az a pillanat,
         amikor a mai edzésre vonatkozó javaslatnak értelme van. Ha nincs mit
         javasolni, az ablak fel sem ugrik. */
      adviceModal?.maybeShow();
    };

    /** Friss riport + check-in a szerverről. A pageEffects és az edzés
        lezárása is ezt hívja. */
    refreshRecovery = async () => {
      // A testsúly-napló is ide tartozik: a trend-kártya ezen az oldalon van,
      // és a fillForm a mai bejegyzésből tölti a testsúly-mezőt.
      const [report, checkin] = await Promise.all([
        api.getReadiness(), api.getCheckin(), refreshWeightLog(),
      ]);
      fillForm(checkin);
      renderRecovery(report);
    };

    await refreshRecovery();
  }

  /* ======================================================================
     6b. Napi check-in varázsló (#checkin)
     Egy kérdés / egy képernyő. Ugyanabba a check-in sorba ír, mint a
     Regeneráció oldal részletes űrlapja — a kettő közti szerződést lásd a
     `carried` mezőnél.
     ====================================================================== */

  /** A mindig jelen lévő lépések. A testtérképeket a kapu-válaszok fűzik be
      (lásd ciStepOrder) — ezért nincs külön „ugorj ide" logika sehol. */
  const CI_BASE_STEPS = ['intro', 'sleep', 'sleepq', 'energy', 'stress', 'weight', 'soreGate'];

  /** A skála-lépések kulcsa → a CHECKIN_SCALES mezőneve. */
  const CI_SCALE_STEPS = { sleepq: 'sleepQuality', energy: 'energy', stress: 'stress' };

  const CI_SLEEP_PRESETS = [6, 7, 7.5, 8, 8.5];
  const CI_SLEEP_MIN = 0;
  const CI_SLEEP_MAX = 12;

  /* A testsúly-lépés. A tartomány a szerverével egyezik (server.js) — a
     kliens csak beszédesebb hibát ad, nem enged át mást. */
  const CI_WEIGHT_MIN = 30;
  const CI_WEIGHT_MAX = 300;
  /** Gyorsgombok a viszonyítási mérés köré, kilóban. */
  const CI_WEIGHT_PRESET_OFFSETS = [-0.5, 0, 0.5];
  /** A ± gombok kiindulópontja, ha még soha nem mértél. */
  const CI_WEIGHT_FALLBACK = 80;

  /**
   * Testtérkép-régiók a 220×420-as rajzterületen: [izomkulcs, x, y, szélesség, magasság].
   * A bal/jobb páros téglalapok SZÁNDÉKOSAN ugyanarra az izomkulcsra mutatnak:
   * az adatmodell nem oldalfüggő (server/muscles.js), tehát a két téglalap egyetlen
   * logikai vezérlő két fele. A két nézet uniója pontosan a kilenc MUSCLE_GROUPS
   * kulcs — egyik csoport sem érhetetlen el.
   */
  const CI_BODY_REGIONS = {
    front: [
      ['shoulders', 24, 52, 42, 24], ['shoulders', 154, 52, 42, 24],
      ['chest', 72, 56, 76, 42],
      ['arms', 8, 82, 34, 100], ['arms', 178, 82, 34, 100],
      ['core', 74, 102, 72, 72],
      ['quads', 58, 182, 44, 98], ['quads', 118, 182, 44, 98],
      ['calves', 60, 288, 40, 84], ['calves', 120, 288, 40, 84],
    ],
    back: [
      ['shoulders', 24, 52, 42, 24], ['shoulders', 154, 52, 42, 24],
      ['back', 72, 56, 76, 60],
      ['arms', 8, 82, 34, 100], ['arms', 178, 82, 34, 100],
      ['glutes', 66, 160, 88, 46],
      ['hamstrings', 58, 212, 44, 70], ['hamstrings', 118, 212, 44, 70],
      ['calves', 60, 288, 40, 84], ['calves', 120, 288, 40, 84],
    ],
  };

  /** A két kapu-lépés szövegei és a hozzájuk tartozó állapot-kulcs. */
  const CI_GATES = {
    soreGate: {
      key: 'sore', eyebrow: 'Részletes kitöltés', title: 'Van izomlázad valahol?',
      sub: 'Az edzés utáni szokásos izommerevség. Ha nincs, kihagyjuk ezt a lépést.',
      no: ['Nincs izomlázam', 'Ugorhatunk tovább'],
      yes: ['Van, megjelölöm', 'Koppints az érintett izmokra'],
    },
    painGate: {
      key: 'pain', eyebrow: 'Fájdalom · sérülés', title: 'Van éles fájdalmad vagy sérülésed?',
      sub: 'Ez más, mint az izomláz. A 7-es vagy nagyobb érték letiltja az érintett izmot terhelő gyakorlatokat.',
      no: ['Nincs, csak izomláz', 'Ugorhatunk az összegzésre'],
      yes: ['Van fájdalom vagy sérülés', 'Jelöld be, hol érzed'],
    },
  };

  /** A két testtérkép-mód. A `field` az answers-beli kulcs is egyben. */
  const CI_MAP_MODES = {
    soreness: {
      field: 'soreness', max: 5, defaultValue: 3, noun: 'izomláz',
      eyebrow: 'Részletes kitöltés', title: 'Hol van izomlázad?',
      sub: 'Koppints egy izomra, majd csúsztasd fel/le az erősséghez. Amit kihagysz, az 0 marad.',
      legend: '1 = alig érezhető · 5 = nagyon erős izomláz.',
    },
    painMap: {
      field: 'pain', max: 10, defaultValue: 5, noun: 'fájdalom',
      eyebrow: 'Fájdalom · sérülés', title: 'Hol fáj pontosan?',
      sub: 'Koppints a fájó területre, majd csúsztasd fel/le az erősséghez (1–10).',
      legend: '1 = enyhe · 10 = nagyon erős. A 7-es vagy nagyobb érték letiltja az izmot terhelő gyakorlatokat.',
    },
  };

  /** Hány képernyő-pixel egy értéklépés húzáskor. */
  const CI_DRAG_PX_PER_STEP = 14;
  /** Automatikus továbblépés késleltetése koppintás után. */
  const CI_ADVANCE_MS = 260;
  const CI_PRESET_ADVANCE_MS = 140;
  /** A motor 7-TŐL tiltja a gyakorlatokat (server/recovery.js:486), nem 7 fölött. */
  const CI_PAIN_BLOCK = 7;

  const CI_READINESS_VERDICTS = { ok: 'Jó készenlét', warn: 'Közepes', bad: 'Óvatosan ma' };

  const ciMuscleLabel = (key) => MUSCLE_GROUPS.find(([k]) => k === key)?.[1] ?? key;
  const ciClamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /** Csak a pozitív értékek — a 0 a részletes űrlapon érvényes „semmi", a
      térképen viszont ez a NEM megjelölt állapot. */
  function ciPickPositive(map, skipKey = null) {
    const out = {};
    for (const [key, value] of Object.entries(map ?? {})) {
      if (key !== skipKey && Number(value) > 0) out[key] = Number(value);
    }
    return out;
  }

  /**
   * A varázsló állapota.
   *
   * A `carried` a legfontosabb mező. A PUT /api/checkin TELJES SORT ír felül
   * (server/db.js:249 — ON CONFLICT … SET minden oszlopra), és a törzsből
   * hiányzó mezőből a server.js readOptionalNumber-e null-t csinál. A varázsló
   * szándékosan nem kérdez közérzetet, folyadékot és általános fájdalmat —
   * ezeket ezért betöltéskor ide tesszük el, és mentéskor VÁLTOZATLANUL
   * visszaküldjük. Enélkül a részletes űrlapon aznap megadott értékek
   * némán NULL-ra állnának.
   *
   * A testsúly nem itt, hanem az `answers`-ben van: a varázsló KÉRDEZI (a
   * dashboard külön rögzítő űrlapja helyett). A szerver nem a checkins sorba,
   * hanem a weight_log-ba írja, naponta egy sorba — az újramentés felülír,
   * nem duplikál (server/db.js addWeightEntry).
   */
  let ci = null;

  const ciEmptyState = () => ({
    step: 'intro',
    sessionDate: null,   // a betöltés helyi napja — napváltáskor újraindul
    loaded: false,       // lekértük-e már a mai állapotot a szervertől
    saved: false,
    readiness: null,     // a szerver riportja; helyi becslést NEM számolunk
    hadCheckin: false,   // volt-e ma már check-in (az összegzésre ugráshoz)
    dirty: false,        // változott-e valami a betöltött állapothoz képest
    mapView: 'front',
    gates: { sore: null, pain: null },
    answers: {
      sleepHours: null, sleepQuality: null, energy: null, stress: null,
      weightKg: null,    // null = ma nem mértél; ilyenkor nem születik bejegyzés
      soreness: {},      // { chest: 3, … } 1..5, csak a megjelöltek
      pain: {},          // { back: 8, … }  1..10, 'general' NÉLKÜL
    },
    carried: { mood: null, hydration: null, painGeneral: null },
  });

  /** A lépések aktuális sorrendje. A kapuk maguk a sorrend: ha nincs izomláz,
      a 'soreness' egyszerűen nincs a listában, és a sima „következő" a
      fájdalom-kapun landol. */
  function ciStepOrder() {
    const steps = [...CI_BASE_STEPS];
    if (ci.gates.sore === 'yes') steps.push('soreness');
    steps.push('painGate');
    if (ci.gates.pain === 'yes') steps.push('painMap');
    steps.push('summary');
    return steps;
  }

  /** A folyamatsávban számolt lépések (az intro és az összegzés nem kérdés). */
  const ciCountedSteps = () => ciStepOrder().filter((s) => s !== 'intro' && s !== 'summary');

  async function setupCheckinWizard() {
    const page = $('[data-page="checkin"]');
    if (!page) return;

    const head = $('[data-ci-head]', page);
    const body = $('[data-ci-body]', page);
    const progress = $('[data-ci-progress]', page);
    const stepLabel = $('[data-ci-step-label]', page);
    const announce = $('[data-ci-announce]', page);

    let advanceTimer = null;

    const cancelAdvance = () => { clearTimeout(advanceTimer); advanceTimer = null; };

    /** Automatikus továbblépés koppintás után. A hívók billentyűs aktiválásnál
        (event.detail === 0) NEM hívják: a fókusz elrántása döntés közben rossz
        élmény, ott a „Tovább" gomb a kiút. Csökkentett mozgás mellett nincs
        várakozás — az animált átmenet úgyis el van némítva. */
    function advanceSoon(delay) {
      cancelAdvance();
      if (prefersReducedMotion) { goNext(); return; }
      advanceTimer = setTimeout(goNext, delay);
    }

    function setStep(name) {
      cancelAdvance();
      ci.step = name;
      renderStep();
    }

    function goNext() {
      const order = ciStepOrder();
      const index = order.indexOf(ci.step);
      setStep(order[Math.min(index + 1, order.length - 1)]);
    }

    function goBack() {
      const order = ciStepOrder();
      const index = order.indexOf(ci.step);
      setStep(order[Math.max(index - 1, 0)]);
    }

    /* ---- Fejléc ---- */

    function syncHead() {
      const counted = ciCountedSteps();
      const index = counted.indexOf(ci.step);
      const total = counted.length;
      head.hidden = ci.step === 'intro';

      const percent = index >= 0 ? ((index + 1) / total) * 100 : (ci.step === 'summary' ? 100 : 0);
      progress.style.width = percent + '%';
      stepLabel.textContent = index >= 0 ? `${index + 1}/${total}` : '';
      // A sáv és a „3/6" aria-hidden — a lépésszám itt hangzik el, egyszer.
      announce.textContent = index >= 0 ? `${index + 1}. lépés a ${total}-ből` : '';
    }

    /* ---- Lépés-renderelés ---- */

    const RENDERERS = {
      intro: renderIntro,
      sleep: renderSleep,
      sleepq: () => renderScale('sleepq'),
      energy: () => renderScale('energy'),
      stress: () => renderScale('stress'),
      weight: renderWeight,
      soreGate: () => renderGate('soreGate'),
      painGate: () => renderGate('painGate'),
      soreness: () => renderMap('soreness'),
      painMap: () => renderMap('painMap'),
      summary: renderSummary,
    };

    function renderStep() {
      const step = RENDERERS[ci.step]?.();
      if (!step) return;
      body.replaceChildren(step);
      // A data-step újraírása indítja újra a belépő animációt.
      body.dataset.step = ci.step;
      syncHead();

      const heading = $('h2', body);
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    }

    const ciDateStr = () => new Date().toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' });

    function renderIntro() {
      const step = cloneTemplate('tpl-ci-intro');
      $('[data-ci-date]', step).textContent = ciDateStr();
      // Félbehagyott munkamenetnél a „Kezdés" félrevezető lenne.
      if (ci.hadCheckin) $('[data-ci-start-label]', step).textContent = 'Folytatás';
      $('[data-action="checkin-next"]', step).addEventListener('click', () => goNext());
      if (onboardingLock) applyOnboardingIntro(step);
      return step;
    }

    /* Az első check-in introja. Ugyanaz a sablon, más szöveg: itt még nem
       „napi rutin" a dolog, hanem az egyetlen út befelé — a kezdőnek azt kell
       megértenie, MIÉRT kérdezünk, mielőtt bármit kitöltene. */
    function applyOnboardingIntro(step) {
      // Csak a felvezető szó cserélődik — a dátum-span a helyén marad.
      $('.ci-eyebrow', step).firstChild.nodeValue = 'Első lépés · ';
      $('.ci-display', step).replaceChildren(
        'Kezdjük', document.createElement('br'), 'a készenléttel',
      );
      $('.ci-lead', step).textContent = 'Ez az első check-ined. Ebből számolja ki a rendszer, '
        + 'mennyire vagy ma terhelhető — pár gyors kérdés, kevesebb mint egy perc.';
      $('.ci-footnote', step).textContent = 'Az adataid csak hozzád tartoznak.';

      /* A „Mégse" itt sehová nem vezetne: az app többi oldala zárva van. A
         kijárat ezért a kijelentkezés — a check-in kötelező, de a lap nem
         csapda (a #checkin-en nincs se beállítás-, se kilépés-gomb, azok a
         dashboard fejlécében ülnek). */
      const exit = $('.ci-exit', step);
      exit.textContent = 'Kijelentkezés';
      exit.href = '#';
      exit.addEventListener('click', async (event) => {
        event.preventDefault();
        try { await api.logout(); } catch { /* a kilépést akkor is bevisszük */ }
        window.location.reload();
      });
    }

    /* ---- Alvás ---- */

    function renderSleep() {
      const step = cloneTemplate('tpl-ci-sleep');
      const input = $('#ci-sleep', step);
      input.value = ci.answers.sleepHours ?? 7.5;

      const presets = $('[data-ci-presets]', step);
      const syncPresets = () => {
        $$('button', presets).forEach((btn) => {
          btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === Number(input.value)));
        });
      };

      // A ± gombokat a megosztott handleStepClick lépteti (min/max/step onnan
      // jön). A varázsló lépései cserélődnek, ezért a hívás ide kerül: a lapon
      // nincs olyan delegált kezelő, ami elvégezné. A léptetés `input`
      // eseményt vált ki, az alábbi listener menti és szinkronizálja a
      // preseteket — itt már csak az automatikus továbblépést kell leállítani.
      step.addEventListener('click', (event) => {
        if (!handleStepClick(event)) return;
        cancelAdvance();
      });
      input.addEventListener('input', () => { syncPresets(); commitSleep(); });

      CI_SLEEP_PRESETS.forEach((value) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ci-preset';
        btn.dataset.value = String(value);
        btn.textContent = formatNumber(value);
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', `${formatNumber(value)} óra`);
        btn.addEventListener('click', (event) => {
          input.value = value;
          syncPresets();
          commitSleep();
          // Billentyűs aktiválás (detail === 0) nem léptet magától.
          if (event.detail !== 0) advanceSoon(CI_PRESET_ADVANCE_MS);
        });
        presets.appendChild(btn);
      });
      syncPresets();

      $('[data-action="checkin-next"]', step).addEventListener('click', () => {
        commitSleep();
        goNext();
      });

      function commitSleep() {
        const value = Number(input.value);
        // A felhasználó látta a kiírt számot, tehát az a válasza — de a
        // tartományon kívüli kézi bevitelt nem küldjük tovább.
        ci.answers.sleepHours = Number.isFinite(value)
          ? ciClamp(value, CI_SLEEP_MIN, CI_SLEEP_MAX)
          : null;
        ci.dirty = true;
      }

      return step;
    }

    /* ---- Testsúly ----
       A napi testsúly rögzítése. Ez váltja ki a dashboard korábbi külön
       űrlapját: a mérés a check-in része, az eredménye pedig a Regeneráció
       oldal trend-diagramján látszik. */

    /** A viszonyítási bejegyzés a gyorsgombokhoz és a ± kiindulópontjához:
        a mai mérés, ha ma már volt, egyébként a legutóbbi. */
    const ciWeightReference = () => todayWeightEntry() ?? latestWeightEntry();

    function renderWeight() {
      const step = cloneTemplate('tpl-ci-weight');
      const input = $('#ci-weight', step);
      const presets = $('[data-ci-presets]', step);
      const note = $('[data-ci-weight-note]', step);
      const reference = ciWeightReference();
      const todayEntry = todayWeightEntry();

      // A mezőt SZÁNDÉKOSAN nem töltjük ki a legutóbbi méréssel: egy előre
      // beírt szám a „Tovább" gombbal olyan méréssé válna, ami meg sem történt.
      // A ma már rögzített érték viszont szerkeszthető — azt visszaadjuk.
      input.value = ci.answers.weightKg === null ? '' : formatNumber(ci.answers.weightKg);

      const syncStep = () => {
        const value = ci.answers.weightKg;
        $$('button', presets).forEach((btn) => {
          btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === value));
        });
        note.textContent = weightNote(value);
      };

      /** A mező alatti magyarázó sor: mihez képest van a beírt érték, illetve
          mi történik, ha üresen hagyod. */
      function weightNote(value) {
        if (value === null) {
          return reference
            ? `Üresen hagyva kihagyjuk — az utolsó mérésed ${formatNumber(reference.kg)} kg (${reference.date}).`
            : 'Üresen hagyva kihagyjuk — ma nem kerül bejegyzés a testsúly-naplóba.';
        }
        if (todayEntry) {
          return `Ma már rögzítettél ${formatNumber(todayEntry.kg)} kg-ot — a mentés ezt írja felül.`;
        }
        if (!reference) return 'Ez lesz az első bejegyzésed a testsúly-naplóban.';
        const diff = value - reference.kg;
        return Math.abs(diff) < 0.05
          ? `Ugyanannyi, mint a legutóbbi mérésed (${reference.date}).`
          : `${formatDelta(diff)} kg a legutóbbi méréshez képest (${reference.date}).`;
      }

      function commitWeight() {
        const raw = input.value.trim();
        const value = Number(raw);
        ci.answers.weightKg = raw === '' || !Number.isFinite(value)
          ? null
          : ciClamp(Math.round(value * 10) / 10, CI_WEIGHT_MIN, CI_WEIGHT_MAX);
        ci.dirty = true;
        syncStep();
      }

      // Gépelés közben nem írunk vissza a mezőbe (a félkész „8" nem ugrik
      // 30-ra), elhagyáskor viszont a látott és a tárolt érték egyezzen.
      input.addEventListener('input', commitWeight);
      input.addEventListener('blur', () => {
        input.value = ci.answers.weightKg === null ? '' : formatNumber(ci.answers.weightKg);
      });

      // A ± gombokat a megosztott handleStepClick lépteti; üres mezőnél viszont
      // 0-ról indulna (és a min miatt 30-ra ugrana), ezért az első koppintás
      // csak beülteti a viszonyítási értéket, és ott meg is áll.
      step.addEventListener('click', (event) => {
        if (!event.target.closest('.wk-num-step')) return;
        cancelAdvance();
        if (input.value.trim() !== '') return;
        event.stopPropagation();
        input.value = formatNumber(reference?.kg ?? CI_WEIGHT_FALLBACK);
        commitWeight();
      });

      if (reference) {
        CI_WEIGHT_PRESET_OFFSETS.forEach((offset) => {
          const value = Math.round((reference.kg + offset) * 10) / 10;
          if (value < CI_WEIGHT_MIN || value > CI_WEIGHT_MAX) return;
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ci-preset';
          btn.dataset.value = String(value);
          btn.textContent = formatNumber(value);
          btn.setAttribute('aria-pressed', 'false');
          btn.setAttribute('aria-label', `${formatNumber(value)} kilogramm`);
          btn.addEventListener('click', (event) => {
            input.value = formatNumber(value);
            commitWeight();
            // Billentyűs aktiválás (detail === 0) nem léptet magától.
            if (event.detail !== 0) advanceSoon(CI_PRESET_ADVANCE_MS);
          });
          presets.appendChild(btn);
        });
        presets.hidden = presets.childElementCount === 0;
      }

      $('[data-ci-weight-skip]', step).addEventListener('click', () => {
        input.value = '';
        commitWeight(); // → null: ma nincs mérés
        goNext();
      });

      $('[data-action="checkin-next"]', step).addEventListener('click', () => {
        commitWeight();
        goNext();
      });

      syncStep();
      return step;
    }

    /* ---- 1–5 skálák ---- */

    function renderScale(stepName) {
      const field = CI_SCALE_STEPS[stepName];
      const [, , [low, high], question] = CHECKIN_SCALES.find(([name]) => name === field);

      const step = cloneTemplate('tpl-ci-scale');
      $('[data-ci-title]', step).textContent = question;
      $('[data-ci-low]', step).textContent = `1 · ${low}`;
      $('[data-ci-high]', step).textContent = `5 · ${high}`;

      const group = $('[data-ci-scale]', step);
      group.setAttribute('aria-label', question);
      const nextBtn = $('[data-action="checkin-next"]', step);

      const syncButtons = () => {
        $$('button', group).forEach((btn) => {
          btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === ci.answers[field]));
        });
        nextBtn.disabled = ci.answers[field] === null;
      };

      const choose = (value, { auto }) => {
        ci.answers[field] = value;
        ci.dirty = true;
        syncButtons();
        if (auto) advanceSoon(CI_ADVANCE_MS);
      };

      for (let value = 1; value <= 5; value += 1) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ci-scale-btn';
        btn.dataset.value = String(value);
        btn.textContent = String(value);
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', `${value} — ${value === 1 ? low : value === 5 ? high : 'közepes'}`);
        btn.addEventListener('click', (event) => choose(value, { auto: event.detail !== 0 }));
        group.appendChild(btn);
      }
      syncButtons();

      // Számbillentyűk: a setupShortcuts ezen az oldalon félreáll, itt viszont
      // a válasz gyors útja (a designból hiányzó billentyűzet-affordancia).
      step.addEventListener('keydown', (event) => {
        const value = Number(event.key);
        if (!Number.isInteger(value) || value < 1 || value > 5) return;
        event.preventDefault();
        choose(value, { auto: false });
        nextBtn.focus();
      });

      nextBtn.addEventListener('click', () => goNext());
      return step;
    }

    /* ---- Kapuk ---- */

    function renderGate(stepName) {
      const gate = CI_GATES[stepName];
      const step = cloneTemplate('tpl-ci-gate');
      $('[data-ci-eyebrow]', step).textContent = gate.eyebrow;
      $('[data-ci-title]', step).textContent = gate.title;
      $('[data-ci-sub]', step).textContent = gate.sub;

      const wrap = $('[data-ci-gates]', step);
      [['no', 'ok'], ['yes', 'accent']].forEach(([answer, tone]) => {
        const [label, sub] = gate[answer];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ci-gate';
        btn.dataset.tone = tone;
        btn.setAttribute('aria-pressed', String(ci.gates[gate.key] === answer));

        const title = document.createElement('span');
        title.className = 'ci-gate-label';
        title.textContent = label;
        const note = document.createElement('span');
        note.className = 'ci-gate-sub';
        note.textContent = sub;
        btn.append(title, note);

        btn.addEventListener('click', () => {
          ci.gates[gate.key] = answer;
          ci.dirty = true;
          // A „nincs" válasz törli a korábban megjelölt értékeket is —
          // különben egy meggondolt válasz némán hagyná bent őket.
          if (answer === 'no') ci.answers[gate.key === 'sore' ? 'soreness' : 'pain'] = {};
          // A sorrend most már tartalmazza (vagy nem) a térkép-lépést.
          goNext();
        });
        wrap.appendChild(btn);
      });
      return step;
    }

    /* ---- Testtérkép ---- */

    function renderMap(stepName) {
      const mode = CI_MAP_MODES[stepName];
      const store = () => ci.answers[mode.field];

      const step = cloneTemplate('tpl-ci-map');
      $('[data-ci-eyebrow]', step).textContent = mode.eyebrow;
      $('[data-ci-title]', step).textContent = mode.title;
      $('[data-ci-sub]', step).textContent = mode.sub;
      $('[data-ci-legend]', step).textContent = mode.legend;

      const map = $('[data-ci-map]', step);
      const values = $('[data-ci-values]', step);

      $$('.wk-toggle-btn', step).forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.view === ci.mapView));
        btn.addEventListener('click', () => {
          ci.mapView = btn.dataset.view;
          renderStep(); // nézetváltás: teljes újrarajzolás rendben van
        });
      });

      /** Egy izomcsoport minden (látható) téglalapjának frissítése. Húzás
          közben CSAK ez fut — a lépés újrarenderelése megölné a pointer
          capture-t, és a húzás némán megszakadna. */
      function paintRegion(key) {
        const value = store()[key];
        const on = value > 0;
        $$(`[data-region="${key}"]`, map).forEach((btn) => {
          btn.textContent = on ? String(value) : '';
          btn.setAttribute('aria-pressed', String(on));
          btn.setAttribute('aria-label', on
            ? `${ciMuscleLabel(key)} — ${mode.noun} ${value} / ${mode.max}`
            : `${ciMuscleLabel(key)} — nincs megjelölve`);
        });
      }

      function setValue(key, value) {
        store()[key] = ciClamp(value, 1, mode.max);
        ci.dirty = true;
        paintRegion(key);
        renderValueRows();
      }

      function clearValue(key) {
        delete store()[key];
        ci.dirty = true;
        paintRegion(key);
        renderValueRows();
      }

      CI_BODY_REGIONS[ci.mapView].forEach(([key, x, y, w, h], index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ci-region';
        btn.dataset.region = key;
        btn.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

        // A tükör-párból csak az első kerül az akadálymentességi fába és a
        // tab-sorrendbe: egy izomcsoport = egy vezérlő. (A pointer-események
        // az aria-hidden ellenére is működnek a másikon.)
        const isMirror = CI_BODY_REGIONS[ci.mapView]
          .findIndex(([k]) => k === key) !== index;
        if (isMirror) {
          btn.setAttribute('aria-hidden', 'true');
          btn.tabIndex = -1;
        }

        bindRegion(btn, key);
        map.appendChild(btn);
        paintRegion(key);
      });

      /** Pointer-húzás: lenyomásra kijelöl az alapértékkel, függőleges
          mozgásra léptet, elmozdulás nélküli felengedés egy MÁR kijelölt
          régión pedig töröl. */
      function bindRegion(btn, key) {
        let pointerId = null;
        let startY = 0;
        let startValue = 0;
        let wasSelected = false;
        let moved = false;

        btn.addEventListener('pointerdown', (event) => {
          if (pointerId !== null) return;
          pointerId = event.pointerId;
          wasSelected = store()[key] > 0;
          startValue = wasSelected ? store()[key] : mode.defaultValue;
          startY = event.clientY;
          moved = false;
          try { btn.setPointerCapture(pointerId); } catch { /* nem kritikus */ }
          setValue(key, startValue);
          event.preventDefault();
        });

        btn.addEventListener('pointermove', (event) => {
          if (event.pointerId !== pointerId) return;
          const delta = Math.round((startY - event.clientY) / CI_DRAG_PX_PER_STEP);
          if (delta !== 0) moved = true;
          setValue(key, startValue + delta);
        });

        const end = (event) => {
          if (event.pointerId !== pointerId) return;
          try { btn.releasePointerCapture(pointerId); } catch { /* már elengedve */ }
          pointerId = null;
          if (!moved && wasSelected) clearValue(key);
        };
        btn.addEventListener('pointerup', end);
        btn.addEventListener('pointercancel', end);

        // A húzás billentyűzetes tükre. Enélkül a lépés pointer nélkül
        // teljesíthetetlen lenne.
        btn.addEventListener('keydown', (event) => {
          const current = store()[key] ?? 0;
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            event.preventDefault();
            setValue(key, current ? current + 1 : mode.defaultValue);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            event.preventDefault();
            if (current <= 1) clearValue(key); else setValue(key, current - 1);
          } else if (event.key === 'Delete' || event.key === 'Backspace') {
            event.preventDefault();
            clearValue(key);
          }
        });
        btn.addEventListener('click', (event) => {
          // Billentyűs aktiválás: a pointerdown-ág nem futott le.
          if (event.detail !== 0) return;
          if (store()[key] > 0) clearValue(key); else setValue(key, mode.defaultValue);
        });
      }

      /** A térkép alatti pontos-érték sorok. Ezek a KANONIKUS vezérlők:
          a térképen húzni kell, itt billentyűzettel is választható az érték. */
      function renderValueRows() {
        const keys = Object.keys(store()).filter((key) => store()[key] > 0);
        values.replaceChildren(...keys.map((key) => {
          const row = cloneTemplate('tpl-ci-value-row');
          $('[data-ci-name]', row).textContent = ciMuscleLabel(key);

          const chips = $('[data-ci-chips]', row);
          chips.setAttribute('aria-label', `${ciMuscleLabel(key)} — ${mode.noun} értéke`);
          for (let value = 1; value <= mode.max; value += 1) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'rc-chip ci-chip';
            if (mode.field === 'pain') chip.classList.add('ci-chip--pain');
            chip.textContent = String(value);
            chip.setAttribute('aria-pressed', String(store()[key] === value));
            chip.setAttribute('aria-label', `${ciMuscleLabel(key)} — ${mode.noun} ${value}`);
            chip.addEventListener('click', () => setValue(key, value));
            chips.appendChild(chip);
          }

          const warn = $('[data-ci-warn]', row);
          warn.hidden = !(mode.field === 'pain' && store()[key] >= CI_PAIN_BLOCK);
          return row;
        }));
      }
      renderValueRows();

      $('[data-action="checkin-next"]', step).addEventListener('click', () => goNext());
      return step;
    }

    /* ---- Összegzés ---- */

    function renderSummary() {
      const step = cloneTemplate('tpl-ci-summary');
      $('[data-ci-date]', step).textContent = ciDateStr();

      const { answers, carried } = ci;
      const named = (map) => Object.keys(map).map((key) => ciMuscleLabel(key));

      const painParts = Object.entries(answers.pain)
        .map(([key, value]) => `${ciMuscleLabel(key)} ${value}`);
      // Az általános fájdalmat a varázsló nem kérdezi, de ha a részletes űrlap
      // megadta, kiírjuk — különben néma ellentmondás lenne a „nincs
      // fájdalmam" válasszal.
      if (carried.painGeneral !== null) painParts.push(`általános ${carried.painGeneral}`);

      const rows = [
        ['Alvás', answers.sleepHours === null ? '–' : `${formatNumber(answers.sleepHours)} óra`],
        ['Alvásminőség', `${answers.sleepQuality ?? '–'} / 5`],
        ['Energiaszint', `${answers.energy ?? '–'} / 5`],
        ['Stresszszint', `${answers.stress ?? '–'} / 5`],
        // A kihagyott testsúly nem hiányzó adat, hanem válasz: ma nem mértél.
        ['Testsúly', answers.weightKg === null
          ? 'Ma nem mértem'
          : `${formatNumber(answers.weightKg)} kg`],
        ['Izomláz', named(answers.soreness).join(', ') || 'Nincs'],
        ['Fájdalom', painParts.join(', ') || 'Nincs'],
      ];
      // A varázslóból kimaradó, de eltárolt mezők — hogy látszódjon, mi megy
      // vissza változatlanul.
      if (carried.mood !== null) rows.push(['Közérzet', `${carried.mood} / 5`]);
      if (carried.hydration !== null) rows.push(['Folyadék', `${formatNumber(carried.hydration)} liter`]);

      const list = $('[data-ci-summary]', step);
      list.replaceChildren(...rows.map(([label, value]) => {
        const row = cloneTemplate('tpl-ci-summary-row');
        $('.ci-summary-label', row).textContent = label;
        $('.ci-summary-value', row).textContent = value;
        return row;
      }));

      // A készenlét CSAK a szervertől jöhet. Amíg a friss válaszokat nem
      // mentettük, nincs mit kiírni — kitalált számot nem teszünk a lapra.
      const showScore = ci.readiness !== null && ci.hadCheckin && !ci.dirty;
      renderReadiness(step, showScore ? ci.readiness.overall : null, { animate: false });

      // Ebben a munkamenetben mentve → a gomb helyén a visszajelzés áll.
      // Előre kitöltött, változatlan állapot → a pontszám már látszik, de a
      // mentés elérhető marad (a részletes űrlap közben írhatott bele).
      const saveBtn = $('[data-action="checkin-save"]', step);
      saveBtn.hidden = ci.saved;
      $('[data-ci-saved]', step).hidden = !ci.saved;
      $('[data-ci-done-link]', step).hidden = !(ci.saved || showScore);

      saveBtn.addEventListener('click', () => submit(saveBtn, step));
      return step;
    }

    /** A készenlét-kártya kitöltése. `overall === null` → magyarázó sor a
        szám helyett. */
    function renderReadiness(step, overall, { animate }) {
      const pending = $('[data-ci-pending]', step);
      const scoreWrap = $('[data-ci-score-wrap]', step);
      const barWrap = $('[data-ci-bar-wrap]', step);
      const verdict = $('[data-ci-verdict]', step);

      const known = overall !== null && overall !== undefined;
      pending.hidden = known;
      scoreWrap.hidden = !known;
      barWrap.hidden = !known;
      verdict.textContent = '';
      if (!known) return;

      const tone = readinessTone(overall);
      const card = $('[data-ci-readiness]', step);
      card.dataset.tone = tone;
      verdict.textContent = CI_READINESS_VERDICTS[tone];
      $('[data-ci-bar]', step).style.width = overall + '%';

      const num = $('[data-ci-score]', step);
      if (animate) animateNumber(num, overall, { from: 0, duration: 900 });
      else num.textContent = String(overall);
    }

    /* ---- Mentés ---- */

    /**
     * A PUT /api/checkin törzse. Lásd a `carried` kommentjét: a végpont teljes
     * sort cserél, ezért MINDEN mező szerepel — a nem kérdezettek változatlanul.
     */
    function buildBody() {
      const { answers, carried } = ci;
      return {
        sleepHours: answers.sleepHours,
        sleepQuality: answers.sleepQuality,
        energy: answers.energy,
        stress: answers.stress,
        // Az izomláz és a fájdalom teljes cseréje SZÁNDÉKOS: a „nincs
        // izomlázam" válasznak törölnie kell tudnia a korábbi értékeket.
        soreness: { ...answers.soreness },
        pain: {
          ...answers.pain,
          ...(carried.painGeneral !== null ? { general: carried.painGeneral } : {}),
        },
        mood: carried.mood,           // nem kérdezzük — vissza, különben NULL lesz
        hydration: carried.hydration, // ugyanígy
        // A testsúly nem a check-in sorba megy: a szerver a weight_log-ba
        // írja, naponta egy bejegyzésbe (felülír, nem duplikál). A null azt
        // jelenti, hogy ma nem mértél — ilyenkor a napló érintetlen marad.
        weightKg: answers.weightKg,
      };
    }

    async function submit(btn, step) {
      btn.disabled = true;
      try {
        const { checkin, weightEntry, readiness } = await api.saveCheckin(buildBody());
        mergeWeightEntry(weightEntry); // trend-diagram (Regeneráció) + Δ stat
        ci.readiness = readiness;
        ci.saved = true;
        ci.dirty = false;
        ci.hadCheckin = true;

        /* Az első check-in megvan — az app kinyílik. Navigálni NEM kell: a
           felhasználó az összegzésen marad, és itt látja meg az első valódi
           készenléti pontszámát; a „Vissza a regenerációhoz" link innentől
           működő kijárat. */
        if (onboardingLock) setOnboardingLock(false);

        // A Regeneráció oldal és az áttekintő ugyanebből a motorból él
        applyCheckinSaved?.(checkin, readiness);
        renderDashboard().catch((err) => console.error('Áttekintő frissítési hiba:', err));

        renderReadiness(step, readiness.overall, { animate: true });
        btn.hidden = true;
        $('[data-ci-saved]', step).hidden = false;
        $('[data-ci-done-link]', step).hidden = false;
        showToast('Check-in mentve');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült menteni a check-int', 'error');
      } finally {
        btn.disabled = false;
      }
    }

    /* ---- Betöltés ---- */

    /**
     * A mai állapot beolvasása. Egyetlen kérés elég: a riport az `overall`
     * mellett a check-in nyers értékeit is visszaadja (`checkin.values`).
     * `fresh` esetén a válaszok is felülíródnak; egyébként CSAK a hordozott
     * mezők frissülnek, hogy a félbehagyott kitöltés ne vesszen el.
     */
    async function load({ fresh }) {
      // A testsúly-napló is kell: ebből tölti a testsúly-lépés a viszonyítási
      // mérést, és ebből derül ki, ma volt-e már mérés.
      const [report] = await Promise.all([api.getReadiness(), refreshWeightLog()]);
      const checkin = report.checkin.values;

      ci.readiness = report;
      ci.hadCheckin = report.checkin.present;
      ci.carried = {
        mood: checkin?.mood ?? null,
        hydration: checkin?.hydration ?? null,
        painGeneral: checkin?.pain?.general ?? null,
      };
      if (!fresh) return;

      ci.answers = {
        sleepHours: checkin?.sleepHours ?? null,
        sleepQuality: checkin?.sleepQuality ?? null,
        energy: checkin?.energy ?? null,
        stress: checkin?.stress ?? null,
        // A testsúly a naplóból jön (nem a check-in sorból): ha ma már mértél,
        // azt az értéket szerkeszted tovább, különben üresen indul.
        weightKg: todayWeightEntry()?.kg ?? null,
        soreness: ciPickPositive(checkin?.soreness),
        pain: ciPickPositive(checkin?.pain, 'general'),
      };
      // A kapukat a betöltött térképekből VEZETJÜK LE — ettől lép a vissza
      // gomb a kitöltött összegzésről a helyes lépésekre.
      ci.gates = {
        sore: !checkin ? null : Object.keys(ci.answers.soreness).length ? 'yes' : 'no',
        pain: !checkin ? null : Object.keys(ci.answers.pain).length ? 'yes' : 'no',
      };
      ci.dirty = false;
      ci.saved = false;
      ci.loaded = true;
      ci.mapView = 'front';
      // Ha ma már van check-in, egyből az összegzés — onnan a vissza gombbal
      // bármelyik lépés módosítható.
      ci.step = ci.hadCheckin ? 'summary' : 'intro';
    }

    /** Az oldal megnyitásakor fut. Új munkamenetet kezd, ha még nem töltöttünk
        be (ide tartozik a setup-időben előre rajzolt intro is), ha közben napot
        váltottunk, vagy ha az előzőt már elmentettük. Egyébként megőrzi a
        félbehagyott kitöltés helyét, és csak a hordozott mezőket frissíti. */
    refreshCheckinWizard = async () => {
      const today = new Date().toDateString();
      const fresh = ci === null || !ci.loaded || ci.sessionDate !== today || ci.saved;
      if (fresh) ci = { ...ciEmptyState(), sessionDate: today };
      await load({ fresh });
      renderStep();
    };

    page.addEventListener('click', (event) => {
      // A ± léptetők (alvás, testsúly) a megosztott primitívre épülnek: a
      // min/max/step a mezőről jön, a lépés `input` eseményt vált ki, amire a
      // lépés saját kezelője beírja a választ. Delegálva, mert a lépések
      // renderelésenként újraépülnek.
      if (handleStepClick(event)) return;
      if (event.target.closest('[data-action="checkin-back"]')) goBack();
    });

    // Az intro már setup-időben felkerül: a showPage a pageEffects ELŐTT
    // fókuszálja a lap első h2-jét, tehát az első megnyitáskor már kell lennie
    // renderelt lépésnek.
    ci = { ...ciEmptyState(), sessionDate: new Date().toDateString() };
    renderStep();

    // Napváltáskor a következő megnyitás tiszta lappal indul.
    onDayChange(() => { ci = null; });
  }

  async function setupWorkout(videoModal, prModal, picker, confirmAction) {
    const page = $('[data-page="workout"]');
    const titleInput = $('#workout-name');
    const titleError = $('#workout-name-error');
    const list = $('[data-list="exercises"]', page);

    /** Az üres állapot csak addig látszik, amíg nincs gyakorlat a naplóban. */
    const syncEmpty = () => { $('[data-workout-empty]').hidden = list.children.length > 0; };

    // Az új szettek alapértékei (ha egy gyakorlatnak még nincs szettje)
    const defaultSet = await api.getDefaultSet();

    // Az összes nyomon követett exercise maximum — az input módosításakor
    // PR-detektáláshoz kell (valós idejű PR jelzéshez)
    let exerciseMaxes = await api.getExerciseMaxes();

    // A napló kártyái: kapcsolható PR-jelvény, „+ Szett" gomb és sorszám-
    // választó (a sorrend átrendezéséhez — lásd enableOrderSelect)
    const exerciseOptions = {
      prToggle: true, withAddSet: true, reorder: true, supersets: true, removable: true,
    };

    // Melyik tervből indult az aktuális edzés (null = szabad edzés). A Tervek
    // oldali haladás ebből párosít, nem a terv nevéből.
    let currentPlanId = null;

    /** Az edzés aktuális állapota a DOM-ból (gyakorlatok + szettek + „kész" jelölés). */
    const readCurrentWorkout = () => $$('.wk-exercise', page).map((card) => ({
      name: $('.wk-exercise-name', card).textContent.trim(),
      pr: $('.wk-pr', card).getAttribute('aria-pressed') === 'true',
      superset: $('.wk-superset-link', card).getAttribute('aria-pressed') === 'true',
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

    // A gyakorlatok sorrendje a sorszám-választóval módosítható — az
    // átrendezés után ugyanaz az autosave menti, mint egy szett-szerkesztést.
    enableOrderSelect(list, autosave);
    // A szettek típusa (bemelegítő / munkasorozat / drop set) a sor számára
    // kötött lenyílóval állítható; a váltás is a piszkozattal mentődik.
    enableSetTypeSelect(list, autosave);

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

    /** Egy gyakorlat PR-jelzésének frissítése — kizárólag a teljesített
        (pipált) szettek 1RM-jét nézi; a nem pipált szettekbe írt számok nem
        számítanak, függetlenül attól, hogy van-e egyáltalán pipált szett.
        Ha a gyakorlatnak nincs korábbi rekordja, bármelyik pipált, érvényes
        szám PR-nak számít. A gomb `aria-pressed` állapotát írja — ez az
        egyetlen, kizárólag a képlet által vezérelt állapot. */
    const updateExercisePrIndicator = (exerciseCard) => {
      if (!exerciseCard) return;
      const prBtn = $('.wk-pr', exerciseCard);
      const exerciseName = $('.wk-exercise-name', exerciseCard)?.textContent?.trim();
      if (!prBtn || !exerciseName) return;

      const setRows = $$('.wk-set-list .wk-set-row', exerciseCard);
      let bestCompleted1rm = 0;

      // Az Epley-képlet: 1RM = weight * (1 + reps / 30)
      for (const row of setRows) {
        const set = readSetRow(row);
        if (!set.done) continue;

        const reps = Number(set.reps);
        const weight = Number(set.weight);
        if (!Number.isFinite(reps) || !Number.isFinite(weight) || reps < 1 || weight <= 0) continue;

        const oneRM = weight * (1 + reps / 30);
        if (oneRM > bestCompleted1rm) bestCompleted1rm = oneRM;
      }

      // Nincs korábbi rekord az exercise-hez → bármilyen érvényes szám PR-nak számít
      const currentMax = exerciseMaxes[exerciseName] ?? 0;
      const hasPotentialPr = bestCompleted1rm > 0 && bestCompleted1rm > currentMax;
      prBtn.setAttribute('aria-pressed', String(hasPotentialPr));
    };

    /** Az összes exercise PR jelzésének frissítése — az edzés betöltésekor
        és az applyTemplate után meghívjuk, hogy az összes szett PR státusza
        szinkronban legyen az exerciseMaxes-szel. */
    const refreshAllPrIndicators = () => {
      $$('.wk-exercise', page).forEach(updateExercisePrIndicator);
    };

    /** A szervertől kapott induló tartalom betöltése a naplóba. */
    const applyTemplate = (template) => {
      if (!template) return;
      currentPlanId = template.planId ?? null;
      titleInput.value = template.name;
      list.replaceChildren();
      template.exercises.forEach((exercise) => {
        list.appendChild(renderExercise(exercise, exerciseOptions));
      });
      refreshExerciseList(list);
      if (template.source === 'plan') showToast(`Mai terv betöltve: ${template.name}`);
      syncEmpty();
      // Az összes PR jelzés frissítése az új template után
      refreshAllPrIndicators();
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
      if (event.target.matches('.wk-num-input')) {
        // Valós idejű PR detektálás
        updateExercisePrIndicator(event.target.closest('.wk-exercise'));
        autosave();
      }
    });

    // A mező elhagyásakor az RPE visszakerül az 1–10 skálára (gépelés közben
    // nem nyúlunk hozzá). Az input-figyelő már mentett, ezért csak akkor
    // mentünk újra, ha a szorítás tényleg átírta az értéket.
    page.addEventListener('change', (event) => {
      if (clampRpeInput(event.target)) autosave();
    });

    /** Gyakorlat teljes eltávolítása a naplóból. A teljesített szettekre
        ugyanúgy rákérdezünk, mint a gyakorlat-választóban: az elvesztésük
        visszavonhatatlan. Az utolsó gyakorlat is kivehető — a piszkozat-végpont
        az üres listát is elfogadja, a napló pedig az üres állapotra vált. */
    const removeExercise = async (card) => {
      const name = $('.wk-exercise-name', card).textContent.trim();
      const doneSets = $$('.wk-set-check', card)
        .filter((check) => check.getAttribute('aria-pressed') === 'true').length;
      if (doneSets > 0) {
        const ok = await confirmAction(
          `A(z) „${name}” gyakorlaton ${doneSets} teljesített szett van. Az eltávolítással ezek elvesznek.`,
          { title: 'Eltávolítod a gyakorlatot?', confirmLabel: 'Eltávolítás' },
        );
        if (!ok) return;
      }
      card.remove();
      syncEmpty();
      // A sorszámok és a szuperszett-csoportok a maradék listára igazodnak
      refreshExerciseList(list);
      autosave();
      showToast(`${name} eltávolítva`);
    };

    // Delegált kattintáskezelés — a dinamikusan hozzáadott sorokra is érvényes.
    page.addEventListener('click', (event) => {
      // A kártyát a kezelők lefutása előtt mentjük el: törléskor a sor kikerül
      // a DOM-ból, utána már nem lenne elérhető az őse.
      const exerciseCard = event.target.closest('.wk-exercise');

      // Szett-értékek léptetése, illetve szett hozzáadása / törlése
      if (handleStepClick(event)) return; // a kiváltott input esemény menti
      if (handleAddSetClick(event, defaultSet, autosave)) {
        updateExercisePrIndicator(exerciseCard);
        return;
      }
      if (handleRemoveSetClick(event, autosave)) {
        updateExercisePrIndicator(exerciseCard);
        return;
      }

      const check = event.target.closest('.wk-set-check');
      if (check) {
        const pressed = check.getAttribute('aria-pressed') === 'true';
        check.setAttribute('aria-pressed', String(!pressed));
        if (!pressed) markWorkoutStarted(); // az első pipa indítja az edzés-órát
        updateExercisePrIndicator(exerciseCard); // a pipa állapota is számít a PR-képletbe
        autosave();
        return;
      }

      // Szuperszett-kapocs: az előző gyakorlathoz köti / elválasztja ezt a
      // kártyát. A csoportkeretet és a sorszámokat a refreshExerciseList rajzolja
      // újra, az állapot a piszkozattal mentődik.
      const supersetLink = event.target.closest('.wk-superset-link');
      if (supersetLink) {
        const linked = supersetLink.getAttribute('aria-pressed') === 'true';
        supersetLink.setAttribute('aria-pressed', String(!linked));
        refreshExerciseList(list);
        autosave();
        return;
      }

      // A megerősítés miatt aszinkron; a kezelő maga szinkron marad, ezért
      // nem várjuk meg (a törlés a saját ágán fejezi be magát).
      if (event.target.closest('.wk-exercise-remove')) {
        removeExercise(exerciseCard);
        return;
      }

      const videoBtn = event.target.closest('.wk-video-btn');
      if (videoBtn) {
        videoModal.open(videoBtn.dataset.exercise);
        return;
      }

      const prItem = event.target.closest('.wk-pr-item');
      if (prItem) {
        prModal.open(prItem.dataset.exercise);
        return;
      }
    });

    // Billentyűzetes elérés: a .wk-pr-item nem <button>, mert vizuálisan
    // listasorként illeszkedik — Enter/Szóköz-zel mégis nyithatónak kell
    // lennie (role="button" tabindex="0" a sablonon).
    page.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const prItem = event.target.closest('.wk-pr-item');
      if (!prItem) return;
      event.preventDefault();
      prModal.open(prItem.dataset.exercise);
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
          refreshExerciseList(list);
          autosave();
          // Új gyakorlat hozzáadásakor azonnal frissítsd a PR detektálást
          refreshAllPrIndicators();
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
        /* A mentett edzés AZONOSÍTÓJA is bekerül: az összegző visszajelzés-
           blokkja erre az edzésre küld. Enélkül nem tudná, mire hivatkozzon. */
        setLastSummary({
          ...summary,
          workoutId: saved.id,
          feedbackSent: false,
          /* A gyakorlatnevek a MENTETT sorrendben: a megjegyzés a tömbön
             belüli INDEXRE hivatkozik, ezért a kettőnek együtt kell járnia. */
          exercises: saved.exercises.map((exercise) => exercise.name),
        });

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
      refreshExerciseList(list);
      syncEmpty();
      prefs.set(WORKOUT_START_KEY, null); // friss edzés — az óra az első pipával indul újra
      autosave();
      return true;
    };

    /** A napló újratöltése a szerverről. A készenlét-javaslat elfogadása
        után kell: az adatot a SZERVER módosította (a piszkozatban), a
        képernyőn lévő állapot ettől elavult. */
    const reloadFromServer = async () => {
      applyTemplate(await api.getWorkoutTemplate());
      syncEmpty();
    };

    return { loadPlan, reloadFromServer };
  }

  /**
   * A gyakorlat-kártya illusztrációja. A katalógus nagyobbik fele a külső
   * datasetből jön, ahol minden gyakorlathoz tartozik egy álló thumbnail és
   * egy animált gif (© Gym visual) — a kézzel kurált gyakorlatokhoz viszont
   * nincs média, ezért a kép ilyenkor rejtve marad.
   *
   * Alapban a thumbnail látszik, és csak rámutatásra / fókuszra vált gifre.
   * Ez szándékos: 1200+ egyszerre animáló gif a listában értelmetlenül
   * pörgetné a CPU-t, a mozgás pedig zavaró. A csere csak akkor indul, ha a
   * gif már betöltött, hogy ne villanjon üresre a kártya.
   *
   * Ha a média nincs letöltve (npm run exdb:media), a kép betöltése elhasal —
   * ilyenkor elrejtjük, és a lista pontosan úgy néz ki, mint korábban.
   */
  function setupThumb(img, entry) {
    if (!img || !entry.image) return;
    img.src = `/exercises/${entry.image}`;
    img.hidden = false;
    img.addEventListener('error', () => { img.hidden = true; }, { once: true });
    if (!entry.gif) return;

    const still = img.src;
    const animated = `/exercises/${entry.gif}`;
    let preloaded = false;
    const play = () => {
      if (preloaded) { img.src = animated; return; }
      const probe = new Image();
      probe.addEventListener('load', () => { preloaded = true; img.src = animated; }, { once: true });
      probe.src = animated;
    };
    const stop = () => { img.src = still; };

    const card = img.closest('.ep-item');
    card.addEventListener('pointerenter', play);
    card.addEventListener('pointerleave', stop);
    card.addEventListener('focusin', play);
    card.addEventListener('focusout', stop);
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

    /* A kártyák egyszer épülnek fel; a szűrés csak elrejt/megmutat.
       A katalógus 1400+ elemű, ezért a kártyák egy DocumentFragmentbe
       készülnek el, és EGY beszúrással kerülnek a listába — így a böngésző
       egyszer számol elrendezést, nem elemenként. A kártyák tényleges
       kirajzolását a CSS `content-visibility: auto` halasztja a láthatóságig
       (lásd .ep-item a style.css-ben). */
    const fragment = document.createDocumentFragment();
    catalog.forEach((entry) => {
      const item = cloneTemplate('tpl-picker-item');
      item.dataset.name = entry.name;
      item.dataset.group = entry.group;
      // A keresés a felszerelésre is illeszkedjen: a katalógus nagy része a
      // külső datasetből jön, ahol a variánsokat a felszerelés különbözteti
      // meg — így a „kettlebell” beírásával azok is előjönnek, amiknek a
      // magyar nevében a szó nem szerepel.
      item.dataset.search = [entry.name, entry.equipment].filter(Boolean).join(' ').toLowerCase();
      $('.ep-item-name', item).textContent = entry.name;
      $('.ep-item-tag', item).textContent = entry.tag;
      $('.ep-item-muscles', item).textContent = entry.muscles;
      setupThumb($('.ep-item-thumb', item), entry);
      fragment.appendChild(item);
    });
    list.appendChild(fragment);

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

    /** Szűrés + a fejléc és a gombállapotok szinkronja a cél állapotával.
        A keresés/szűrés cél (context) nélkül is működik — csak a ✓/→
        gombállapot múlik a célon, mert csak annak van mihez igazodnia. */
    const refresh = () => {
      if (context) $('[data-picker-workout]').textContent = context.nameInput.value.trim() || 'Névtelen';
      const query = searchInput.value.trim().toLowerCase();
      const added = context ? namesInTarget() : null;
      let visibleCount = 0;
      $$('.ep-item', list).forEach((item) => {
        const matches = (activeGroup === 'Mind' || item.dataset.group === activeGroup)
          && item.dataset.search.includes(query);
        item.hidden = !matches;
        if (matches) visibleCount += 1;
        if (!context) return;

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
    /* Kinek készül a terv: null = magamnak, különben { id, name } — a kliens,
       akinek az edző kiosztja. A mentés útja ebből dől el, ezért a felület is
       kiírja (pb-for): egy rejtett állapot itt más fiókjába írna némán. */
    let assignTo = null;
    const forLine = $('[data-pb-for]', page);
    const showTarget = () => {
      forLine.hidden = assignTo === null;
      if (assignTo) {
        forLine.textContent = editingId
          ? `${assignTo.name} kiosztott terve — a módosítást a kliens is látni fogja`
          : `Új terv ${assignTo.name} számára — kiosztás mentéskor`;
      }
    };

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

    /** Üres builder egy új tervhez. A címzettet is nullázza: enélkül egy
        korábbi kiosztás után a következő „új terv" némán a kliensé lenne. */
    const startNew = () => {
      editingId = null;
      assignTo = null;
      showTarget();
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
      assignTo = null;
      showTarget();
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
        const client = assignTo; // a startNew() nullázza, ezért a toasthoz eltesszük

        if (client) {
          if (editingId) await api.updateAssignedPlan(editingId, name, exercises, days);
          else await api.assignPlan(client.id, name, exercises, days);
        } else if (editingId) {
          await api.updatePlan(editingId, name, exercises, days);
        } else {
          await api.savePlan(name, exercises, days);
        }

        // A Tervek oldal a SAJÁT terveké — kiosztásnál nincs mit frissíteni rajta.
        if (!client) await renderPlans();

        showToast(client
          ? `${editingId ? 'Frissítve' : 'Kiosztva'}: „${name}" — ${client.name}`
          : (editingId ? 'Terv frissítve' : 'Terv elmentve'));
        startNew();
        navigate(client ? 'coach' : 'plans');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült menteni a tervet', 'error');
      } finally {
        saveBtn.disabled = false;
      }
    });

    /** Új terv KIOSZTÁSA egy kliensnek (az edzői modálból). */
    const startNewForClient = (client) => {
      startNew();
      assignTo = client;
      nameInput.value = '';
      nameInput.placeholder = 'A terv neve';
      showTarget();
    };

    /** Egy MÁR kiosztott terv szerkesztése (szintén az edzői modálból). */
    const loadClientPlan = (client, plan) => {
      loadPlan(plan);
      assignTo = client;
      showTarget();
    };

    return { startNew, loadPlan, startNewForClient, loadClientPlan };
  }

  /** Összegző oldal: a fő gomb zárja a kört az áttekintés felé
      (a „Vissza az edzéshez" link sima #workout hash-hivatkozás). */
  /** Az edzés utáni visszajelzés két skálája: [mező, címke, [1-es, 5-ös vég]].
      A buildScale ugyanaz a chip-primitív, amit a check-in használ — így a
      két felület egyformán viselkedik (a `null` itt is „nem adta meg"). */
  const FEEDBACK_SCALES = [
    ['difficulty', 'Mennyire volt nehéz?', ['könnyű', 'nagyon nehéz']],
    ['mood', 'Hogy érezted magad?', ['rosszul', 'remekül']],
  ];

  function setupSummary() {
    $('[data-action="summary-dashboard"]').addEventListener('click', () => navigate('dashboard'));

    const section = $('[data-su-feedback]');
    const form = $('[data-form="workout-feedback"]', section);
    const scalesWrap = $('[data-su-feedback-scales]', section);
    const noteInput = $('#su-feedback-note');
    const doneEl = $('[data-su-feedback-done]', section);
    const leadEl = $('[data-su-feedback-lead]', section);
    const submit = $('.su-feedback-send', section);

    FEEDBACK_SCALES.forEach(([name, label, [low, high]]) => {
      scalesWrap.appendChild(buildScale({ name, label, min: 1, max: 5, hint: `1 = ${low} · 5 = ${high}` }));
    });

    // A buildScale a `data-field` attribútumba teszi a mező nevét.
    const scaleFor = (name) => $(`[data-field="${name}"]`, scalesWrap);

    /** A blokk állapotának beállítása a friss összegzésből. A `refreshSummaryFeedback`
        néven kívülről is hívható — a renderSummary minden megnyitáskor hívja. */
    /* ---- Megjegyzés egy gyakorlathoz ---- */
    const noteSection = $('[data-su-note]');
    const noteForm = $('[data-form="exercise-note"]', noteSection);
    const noteSelect = $('#su-note-exercise');
    const noteText = $('#su-note-text');
    const noteList = $('[data-su-note-list]', noteSection);
    const noteSend = $('.su-feedback-send', noteSection);

    /** A lezárt edzéshez tartozó megjegyzések kirajzolása. Csak az EHHEZ az
        edzéshez tartozókat mutatjuk: a cél "edzésId:index" alakú. */
    const renderNotes = (byTarget) => {
      const workoutId = lastSummary?.workoutId;
      const rows = [];
      for (const [target, list] of Object.entries(byTarget ?? {})) {
        const [id, index] = String(target).split(':');
        if (Number(id) !== workoutId) continue;
        const name = lastSummary.exercises?.[Number(index)] ?? 'Gyakorlat';
        for (const comment of list) rows.push({ name, comment });
      }
      noteList.replaceChildren(...rows.map(({ name, comment }) => {
        const li = document.createElement('li');
        li.className = 'su-note-item';
        const who = document.createElement('b');
        who.textContent = name;
        li.append(who, document.createTextNode(` — ${comment.text}`));
        return li;
      }));
    };

    const loadNotes = async () => {
      if (!myUserId) return;
      try {
        renderNotes(await api.getCommentsByTarget(myUserId, 'exercise'));
      } catch (err) {
        // A megjegyzés-lista másodlagos: a hiánya ne rontsa el az összegzőt.
        if (err.code !== SESSION_LOST) console.error('A megjegyzések betöltése nem sikerült:', err);
      }
    };

    noteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const workoutId = lastSummary?.workoutId;
      const text = noteText.value.trim();
      if (!workoutId || !text) return;

      noteSend.disabled = true;
      try {
        await api.addComment(myUserId, 'exercise', `${workoutId}:${noteSelect.value}`, text);
        noteText.value = '';
        await loadNotes();
        showToast('Megjegyzés hozzáfűzve');
      } catch (err) {
        if (err.code !== SESSION_LOST) {
          console.error(err);
          showToast(err.message || 'A megjegyzést nem sikerült menteni', 'error');
        }
      } finally {
        noteSend.disabled = false;
      }
    });

    refreshSummaryFeedback = () => {
      /* A megjegyzés-blokk edző NÉLKÜL is látszik: a saját naplód része
         marad. Csak mentett edzés kell hozzá — a mély-linkkel megnyitott
         összegzőn nincs mire hivatkozni. */
      const names = lastSummary?.exercises ?? [];
      noteSection.hidden = !lastSummary?.workoutId || names.length === 0;
      if (!noteSection.hidden) {
        noteSelect.replaceChildren(...names.map((name, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = name;
          return option;
        }));
        noteText.value = '';
        loadNotes();
      }

      /* Két feltétel kell: (1) MOST zárult le egy edzés, tehát van azonosító
         (mély-linkkel megnyitott összegzőn nincs), és (2) van edző, akinek a
         visszajelzés szólna. */
      const workoutId = lastSummary?.workoutId ?? null;
      const visible = Boolean(workoutId) && hasCoachLink;
      section.hidden = !visible;
      if (!visible) return;

      // Új edzés → tiszta lap. A már elküldött visszajelzést nem írjuk felül.
      const alreadySent = lastSummary.feedbackSent === true;
      form.hidden = alreadySent;
      doneEl.hidden = !alreadySent;
      leadEl.hidden = alreadySent;
      if (alreadySent) return;

      FEEDBACK_SCALES.forEach(([name]) => writeScale(scaleFor(name), null));
      noteInput.value = '';
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const workoutId = lastSummary?.workoutId;
      if (!workoutId) return;

      const body = {
        difficulty: readScale(scaleFor('difficulty')),
        mood: readScale(scaleFor('mood')),
        note: noteInput.value.trim(),
      };
      /* Üres visszajelzést nem küldünk el: az edzőnek egy csupa-null sor
         semmit nem mond, viszont értesítést szülne. */
      if (body.difficulty === null && body.mood === null && !body.note) {
        showToast('Adj meg legalább egy értéket vagy írj pár szót', 'error');
        return;
      }

      submit.disabled = true;
      try {
        await api.saveWorkoutFeedback(workoutId, body);
        lastSummary.feedbackSent = true;
        refreshSummaryFeedback();
        showToast('Visszajelzés elküldve');
      } catch (err) {
        if (err.code !== SESSION_LOST) {
          console.error(err);
          showToast(err.message || 'A visszajelzést nem sikerült elküldeni', 'error');
        }
      } finally {
        submit.disabled = false;
      }
    });

    refreshSummaryFeedback();
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
      /* A fejléc „Cél" száma is innen jön: a cél mostantól szerkeszthető,
         tehát nem elég egyszer, betöltéskor kiírni. */
      const goalCalEl = $('[data-goal="calories"]');
      if (goalCalEl) goalCalEl.textContent = formatNumber(totals.goal.calories);
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

    /* ---- Napi cél ----
       Két forrásból jöhet: amit az EDZŐ tűzött ki, és amit a felhasználó maga
       állított be. A sajátja az erősebb, de az edzőé megmarad — ha eltér tőle,
       azt ki is írjuk, és egy kattintással visszaállhat rá. */
    const goalSection = $('.nu-goal');
    const goalValueEl = $('[data-nu-goal-value]', goalSection);
    const goalSourceEl = $('[data-nu-goal-source]', goalSection);
    const goalDiffEl = $('[data-nu-goal-diff]', goalSection);
    const goalDiffTextEl = $('[data-nu-goal-diff-text]', goalSection);
    const goalForm = $('[data-form="nutrition-goal"]', goalSection);
    const goalEditBtn = $('[data-action="edit-goal"]', goalSection);
    const goalRevertBtn = $('[data-action="revert-goal"]', goalSection);
    const goalCaloriesInput = $('#nu-goal-calories');
    const goalProteinInput = $('#nu-goal-protein');
    const goalSaveBtn = $('.nu-goal-save', goalSection);

    /** Honnan jön a szám — ezt mindig kiírjuk, mert a puszta érték nem
        mondaná meg, hogy az edződ tűzte-e ki vagy te magad. */
    const GOAL_SOURCE_TEXT = {
      own: () => 'A saját célod.',
      coach: (goal) => `${goal.setBy ?? 'Az edződ'} tűzte ki.`,
      default: () => 'Alapértelmezett cél — állítsd be a sajátodat.',
    };

    const renderGoal = (goal) => {
      if (!goal) return;
      goalValueEl.textContent = `${formatNumber(goal.calories)} kcal · ${formatNumber(goal.protein)} g fehérje`;
      goalSourceEl.textContent = (GOAL_SOURCE_TEXT[goal.source] ?? GOAL_SOURCE_TEXT.default)(goal);

      /* Az eltérés csak akkor jelenik meg, ha tényleg van edzői cél ÉS más a
         szám. Az azonos érték nem eltérés — arról hallgatunk. */
      goalDiffEl.hidden = !goal.differs;
      if (goal.differs) {
        goalDiffTextEl.textContent =
          `${goal.coach.setBy ?? 'Az edződ'} célja: ${formatNumber(goal.coach.calories)} kcal · `
          + `${formatNumber(goal.coach.protein)} g fehérje — eltértél tőle.`;
      }

      // A szerkesztő mezői mindig az ÉRVÉNYES célról indulnak.
      goalCaloriesInput.value = Math.round(goal.calories);
      goalProteinInput.value = Math.round(goal.protein);
    };

    const setGoalFormOpen = (open) => {
      goalForm.hidden = !open;
      goalEditBtn.setAttribute('aria-expanded', String(open));
      goalEditBtn.textContent = open ? 'Mégse' : 'Módosítom';
      if (open) goalCaloriesInput.focus();
    };

    goalEditBtn.addEventListener('click', () => setGoalFormOpen(goalForm.hidden));

    goalForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      goalSaveBtn.disabled = true;
      try {
        renderGoal(await api.saveNutritionGoal(
          Number(goalCaloriesInput.value), Number(goalProteinInput.value),
        ));
        setGoalFormOpen(false);
        // A napi összesítő ugyanezt a célt méri — újra le kell kérni.
        applyTotals(await api.getNutrition());
        refreshDailyStats().catch(console.error);
        showToast('Napi cél mentve');
      } catch (err) {
        if (err.code !== SESSION_LOST) {
          console.error(err);
          showToast(err.message || 'A célt nem sikerült menteni', 'error');
        }
      } finally {
        goalSaveBtn.disabled = false;
      }
    });

    goalRevertBtn.addEventListener('click', async () => {
      goalRevertBtn.disabled = true;
      try {
        renderGoal(await api.clearNutritionGoal());
        setGoalFormOpen(false);
        applyTotals(await api.getNutrition());
        refreshDailyStats().catch(console.error);
        showToast('Visszaálltál az edződ céljára');
      } catch (err) {
        if (err.code !== SESSION_LOST) {
          console.error(err);
          showToast(err.message || 'A visszaállítás nem sikerült', 'error');
        }
      } finally {
        goalRevertBtn.disabled = false;
      }
    });

    renderGoal(totals.goal);

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
      showToast(`${food.name} · ${formatNumber(grams)} ${food.unit || 'g'} hozzáadva · +${formatNumber(entry.kcal)} kcal`);
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
        /* Ha a mai készenlét szerint van tiltott gyakorlat, azt a betöltés
           visszajelzése mondja meg — nem elég a kártyán apró betűvel. */
        const blocked = plan.safety?.blocked ?? [];
        if (blocked.length > 0) {
          showToast(
            `„${plan.name}” betöltve — ${blocked.length} gyakorlatot a mai készenléted alapján kerülj el`,
            'error',
          );
        } else {
          showToast(`„${plan.name}” betöltve az edzésnaplóba`);
        }
        navigate('workout');
      }).catch((err) => console.error('Terv betöltési hiba:', err));
    });

    // Új terv készítése — üres terv-építővel
    $('[data-action="new-plan"]').addEventListener('click', () => {
      planBuilder?.startNew();
      navigate('plan-builder');
    });
  }

  /** Közös chat-vezérlő. MINDKÉT nézet ezt használja: az edző a sportoló-
      modálban, a kliens az Edző oldalon — a szál ugyanaz a sor a comments
      táblában, csak más szemszögből. A szálat a (kliens, edző) pár azonosítja,
      ezért egy több edzővel dolgozó kliens szálai nem keverednek.

      Frissítés POLLOZÁSSAL: a TEENDOK.txt szerint erre a méretre ez elég, és
      nem kér új infrastruktúrát (SSE/WS). Csak akkor kérdez, ha a szál
      LÁTSZIK — zárt modál mögött nincs értelme hálózatot enni.

      A `getThread()` a szál azonosítóját adja: { subjectId, coachId, name },
      vagy null, ha épp nincs kiválasztva beszélgetés. */
  const CHAT_POLL_MS = 8000;

  function createChatController({ feed, form, input, getThread, isFeedVisible }) {
    let messages = [];
    /* Melyik szál látszik ÉPPEN. Beszélgetés-váltáskor ebből tudjuk, hogy a
       képernyőn még az előző kliens üzenetei vannak — azokat azonnal le kell
       törölni, nem a hálózat válaszáig mutogatni. */
    let shownThread = null;
    /* Versenyhelyzet ellen: a felhasználó válthat beszélgetést, amíg egy
       lekérés fut. Csak a LEGUTÓBB indított betöltés rajzolhat. */
    let loadToken = 0;

    const sameThread = (a, b) => Boolean(a && b
      && a.subjectId === b.subjectId && a.coachId === b.coachId);

    const scrollFeedToEnd = () => { feed.scrollTop = feed.scrollHeight; };

    const render = () => {
      feed.replaceChildren();
      if (messages.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'co-empty';
        empty.textContent = 'Még nincs üzenet ebben a beszélgetésben.';
        feed.appendChild(empty);
        return;
      }
      for (const message of messages) {
        const me = message.authorId === myUserId;
        feed.appendChild(createCoachNote({
          meta: `${me ? 'Te' : message.authorName} · ${message.time}`,
          text: message.text,
          me,
        }));
      }
      scrollFeedToEnd();
    };

    /** A szál betöltése a szerverről. `quiet` esetén a hiba nem szól bele a
        felületbe — a háttér-pollozás ne dobáljon hibaüzenetet a felhasználóra. */
    async function load({ quiet = false } = {}) {
      const thread = getThread();
      if (!thread) { messages = []; shownThread = null; render(); return; }

      /* Szálváltás: a régi üzenetek AZONNAL eltűnnek. Enélkül a válasz
         megérkezéséig az előző kliens üzenetei látszanának. */
      if (!sameThread(shownThread, thread)) {
        messages = [];
        shownThread = thread;
        render();
      }

      const token = (loadToken += 1);
      try {
        const list = await api.getComments(thread.subjectId, 'chat', thread.coachId);
        // Közben másik beszélgetésre válthattak — az elavult válasz nem rajzol.
        if (token !== loadToken || !sameThread(thread, getThread())) return;
        messages = list;
        shownThread = thread;
        render();
      } catch (err) {
        if (err.code === SESSION_LOST || quiet) return;
        console.error('Az üzenetek betöltése nem sikerült:', err);
        showToast('Nem sikerült betölteni az üzeneteket', 'error');
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      const thread = getThread();
      if (!text || !thread) return;

      const submit = $('button[type="submit"]', form);
      if (submit) submit.disabled = true;
      try {
        const saved = await api.addComment(thread.subjectId, 'chat', thread.coachId, text);
        form.reset();
        // Csak akkor fűzzük hozzá, ha még mindig ez a szál látszik.
        if (sameThread(thread, getThread())) {
          messages = [...messages, saved];
          render();
        }
        input.focus();
      } catch (err) {
        if (err.code !== SESSION_LOST) {
          console.error(err);
          showToast(err.message || 'Az üzenetet nem sikerült elküldeni', 'error');
        }
      } finally {
        if (submit) submit.disabled = false;
      }
    });

    /* Egyetlen időzítő szolgálja ki az összes chat-felületet: ha a szál nem
       látszik, egyszerűen kihagyjuk a kört. Az unref-nek itt nincs párja —
       a böngészőben az interval nem tart életben semmit. */
    setInterval(() => {
      if (!isFeedVisible() || !getThread()) return;
      load({ quiet: true });
    }, CHAT_POLL_MS);

    return { load };
  }

  /** A modálban megjelenő részletes statok (a kártya statjai + extra mezők). */
  const ATHLETE_MODAL_STATS = [
    ...ATHLETE_CARD_STATS,
    ['Heti edzések', (a) => a.weekly],
    ['Aktív terv', (a) => a.plan ?? 'nincs'],
    // Mennyi adat áll a készenlét mögött — ugyanaz a skála, amit a kliens
    // a Regeneráció oldalán lát.
    ['Készenlét alapja', (a) => CONFIDENCE_LABELS[a.readinessConfidence] ?? '—'],
  ];

  /** Sportoló részletmodál: összegzés, gyors műveletek és VALÓDI üzenetváltás
      a klienssel. A modal-plumbing a közös vezérlőé. */
  async function setupAthleteModal() {
    const modal = $('#athleteModal');
    const controller = createModalController(modal);
    const badge = $('.co-modal-badge', modal);
    const titleEl = $('#athleteModalTitle');
    const tierEl = $('.co-modal-tier', modal);
    const alertEl = $('[data-modal-alert]', modal);
    const statsEl = $('[data-modal-stats]', modal);
    const feedbackEl = $('[data-modal-feedback]', modal);
    const notesEl = $('[data-modal-notes]', modal);
    const goalStateEl = $('[data-modal-goal-state]', modal);
    const goalForm = $('[data-form="client-nutrition-goal"]', modal);
    const goalCaloriesInput = $('#co-goal-calories');
    const goalProteinInput = $('#co-goal-protein');
    const noteListEl = $('[data-modal-note-list]', modal);
    const feedbackMetaEl = $('[data-feedback-meta]', modal);
    const feedbackNoteEl = $('[data-feedback-note]', modal);
    const activityEl = $('[data-modal-activity]', modal);
    const msgButton = $('[data-action="message"]', modal);
    const msgSection = $('[data-msg-section]', modal);
    const plansList = $('[data-modal-plans]', modal);
    const plansEmpty = $('[data-modal-plans-empty]', modal);
    const feed = $('[data-msg-feed]', modal);

    /* A terv-építő KÉSŐBB épül fel, mint ez a modál (a gyakorlat-választóra
       vár), ezért utólag kapcsoljuk be — ld. attachPlanBuilder. Amíg nincs,
       a terv-gombok nem visznek sehova, nem hibáznak. */
    let planBuilder = null;
    let clientPlans = [];

    // A hétnap-rövidítések a terv-építőével azonos sorrendben (0 = hétfő).
    const MODAL_DAY_LABELS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
    const form = $('[data-form="athlete-message"]', modal);
    const input = $('#athlete-message');

    let current = null;

    /* A szálat a (kliens, edző) pár azonosítja. Ebben a nézetben MI vagyunk
       az edző, a subject pedig a megnyitott sportoló. */
    const chat = createChatController({
      feed,
      form,
      input,
      getThread: () => (current ? { subjectId: Number(current.id), coachId: myUserId } : null),
      isFeedVisible: () => !msgSection.hidden,
    });

    /** A kliens napi célja az edző szemszögéből. Három eset van, és mind a
        hármat ki kell mondani: még nincs kitűzött cél; a kitűzött cél él; vagy
        a kliens mást állított be — ez utóbbi a legfontosabb, mert némán
        egyikük sem írhatja felül a másikat. */
    function renderClientGoal(athlete) {
      const goal = athlete.nutritionGoal;
      if (!goal) { goalStateEl.textContent = ''; return; }

      if (goal.source === 'own') {
        goalStateEl.textContent = goal.coach
          ? `A kitűzött célod ${formatNumber(goal.coach.calories)} kcal · `
            + `${formatNumber(goal.coach.protein)} g, de ${athlete.name} `
            + `${formatNumber(goal.calories)} kcal · ${formatNumber(goal.protein)} g-ot állított be magának.`
          : `${athlete.name} saját célja: ${formatNumber(goal.calories)} kcal · `
            + `${formatNumber(goal.protein)} g fehérje. Amit kitűzöl, azt ő látni fogja.`;
      } else if (goal.source === 'coach') {
        goalStateEl.textContent = `Érvényben: ${formatNumber(goal.calories)} kcal · `
          + `${formatNumber(goal.protein)} g fehérje — ezt te tűzted ki.`;
      } else {
        goalStateEl.textContent = 'Még nincs kitűzött cél — az alapértelmezett szám szól.';
      }

      // A mezők a jelenleg ÉRVÉNYES célról indulnak.
      goalCaloriesInput.value = Math.round(goal.calories);
      goalProteinInput.value = Math.round(goal.protein);
    }

    goalForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!current) return;
      const submit = $('button[type="submit"]', goalForm);
      submit.disabled = true;
      try {
        const saved = await api.setClientNutritionGoal(
          Number(current.id), Number(goalCaloriesInput.value), Number(goalProteinInput.value),
        );
        /* A helyi másolatot is frissítjük, hogy a modál újranyitása nélkül is
           a friss állapot látsszon (a kártyák a következő refresh-kor jönnek). */
        current.nutritionGoal = saved;
        renderClientGoal(current);
        showToast('Napi cél kitűzve');
      } catch (err) {
        if (err.code !== SESSION_LOST) {
          console.error(err);
          showToast(err.message || 'A célt nem sikerült kitűzni', 'error');
        }
      } finally {
        submit.disabled = false;
      }
    });

    /** Egy megjegyzés-sor a modálban, saját válasz-mezővel. A válasz UGYANABBA
        a szálba megy (azonos cél), csak más szerzővel — ettől lesz egy
        beszélgetés a gyakorlatról, nem két külön lista. */
    function noteRow(note, athlete) {
      const item = document.createElement('li');
      item.className = 'co-note-item';

      const head = document.createElement('p');
      head.className = 'co-note-head';
      head.textContent = `${note.exercise} · „${note.workout}" ${note.date} · ${note.authorName} · ${note.time}`;

      const body = document.createElement('p');
      body.className = 'co-note-body';
      body.textContent = note.text;

      const form = document.createElement('form');
      form.className = 'co-note-reply';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 1000;
      input.placeholder = 'Válasz erre a gyakorlatra…';
      input.setAttribute('aria-label', `Válasz — ${note.exercise}`);
      const send = document.createElement('button');
      send.type = 'submit';
      send.textContent = 'Küldés';
      form.append(input, send);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        send.disabled = true;
        try {
          await api.addComment(Number(athlete.id), 'exercise', note.target, text);
          input.value = '';
          showToast('Megjegyzés elküldve');
          // A friss sor a következő megnyitáskor jön le a szerverről; itt
          // azonnal kiírjuk, hogy a küldés látható eredményt adjon.
          const mine = document.createElement('p');
          mine.className = 'co-note-body';
          mine.textContent = `Te: ${text}`;
          item.insertBefore(mine, form);
        } catch (err) {
          if (err.code !== SESSION_LOST) {
            console.error(err);
            showToast(err.message || 'A megjegyzést nem sikerült elküldeni', 'error');
          }
        } finally {
          send.disabled = false;
        }
      });

      item.append(head, body, form);
      return item;
    }

    /** A kliens gyakorlat-megjegyzései. Ha nincs egy sem, a blokk rejtve
        marad — üres kerettel nem sugalljuk, hogy van mit nézni. */
    function renderExerciseNotes(athlete) {
      const notes = athlete.exerciseNotes ?? [];
      notesEl.hidden = notes.length === 0;
      noteListEl.replaceChildren(...notes.map((note) => noteRow(note, athlete)));
    }

    const setMessageOpen = (open, { focus = false } = {}) => {
      msgSection.hidden = !open;
      msgButton.setAttribute('aria-expanded', String(open));
      if (open) {
        chat.load();
        if (focus) input.focus();
      }
    };

    /** A kliens terveinek listája. Szerkeszteni CSAK az általunk kiosztottakat
        lehet (plan.mine) — a kliens saját tervét látjuk, de nem írhatjuk át. */
    async function renderClientPlans(client) {
      plansList.replaceChildren();
      plansEmpty.hidden = true;
      try {
        clientPlans = await api.getClientPlans(client.id);
      } catch (err) {
        console.error('A kliens terveinek betöltése nem sikerült:', err);
        clientPlans = [];
      }
      // Közben másik klienst nyithattak meg — akkor ez a válasz már elavult.
      if (!current || String(current.id) !== String(client.id)) return;

      plansEmpty.hidden = clientPlans.length > 0;
      clientPlans.forEach((plan) => {
        const item = cloneTemplate('tpl-co-plan');
        $('.co-modal-plan-name', item).textContent = plan.name;

        const days = plan.days.length
          ? plan.days.map((d) => MODAL_DAY_LABELS[d]).join(', ')
          : 'nincs napra téve';
        $('.co-modal-plan-meta', item).textContent = plan.mine
          ? [`${plan.exercises.length} gyakorlat`, days, plan.changeNote].filter(Boolean).join(' · ')
          : `${plan.exercises.length} gyakorlat · ${days} · a kliens saját terve`;

        const edit = $('[data-action="edit-client-plan"]', item);
        edit.hidden = !plan.mine;
        edit.dataset.planId = plan.id;
        plansList.appendChild(item);
      });
    }

    /** A modálban látott klienst a terv-építő alakjára hozza. */
    const currentClient = () => ({ id: Number(current.id), name: current.name });

    // Új terv kiosztása — a terv-építő edzői módban nyílik
    $('[data-action="assign-plan"]', modal).addEventListener('click', () => {
      if (!planBuilder) return;
      planBuilder.startNewForClient(currentClient());
      controller.close();
      navigate('plan-builder');
    });

    // Egy már kiosztott terv szerkesztése
    plansList.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action="edit-client-plan"]');
      if (!btn || !planBuilder) return;
      const plan = clientPlans.find((p) => p.id === Number(btn.dataset.planId));
      if (!plan) return;
      planBuilder.loadClientPlan(currentClient(), plan);
      controller.close();
      navigate('plan-builder');
    });

    msgButton.addEventListener('click', () => setMessageOpen(msgSection.hidden, { focus: true }));

    return {
      open(athlete) {
        current = athlete;

        const rating = athleteRating(athlete);
        const tier = athleteTier(rating);
        badge.className = `co-modal-badge co-tier--${tier.key}`;
        $('.co-modal-rating', badge).textContent = rating === null ? '—' : String(rating);
        $('.co-modal-tag', badge).hidden = true; // ld. a kártya jelvényét
        titleEl.textContent = athlete.name;
        tierEl.textContent = rating === null ? tier.label : `${tier.label} · ${rating} pont`;

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

        /* A legutóbbi edzés utáni visszajelzés. A számok mellett ez az
           egyetlen olyan sor, ami a kliens SAJÁT megélését hozza — ezért van
           külön blokkban, nem a statok között. */
        const feedback = athlete.lastFeedback;
        feedbackEl.hidden = !feedback;
        if (feedback) {
          const parts = [`„${feedback.workout}" · ${feedback.date}`];
          if (feedback.difficulty !== null) parts.push(`nehézség ${feedback.difficulty}/5`);
          if (feedback.mood !== null) parts.push(`közérzet ${feedback.mood}/5`);
          feedbackMetaEl.textContent = parts.join(' · ');
          feedbackNoteEl.hidden = !feedback.note;
          feedbackNoteEl.textContent = feedback.note ?? '';
        }

        renderExerciseNotes(athlete);
        renderClientGoal(athlete);

        activityEl.replaceChildren();
        athlete.recent.forEach((entry, index) => {
          const li = document.createElement('li');
          li.style.setProperty('--i', index);
          li.textContent = entry;
          activityEl.appendChild(li);
        });

        setMessageOpen(false);
        controller.open();
        /* A tervek hálózatról jönnek — a modál NEM vár rájuk: azonnal nyílik,
           a lista utólag töltődik be. */
        renderClientPlans(athlete);
      },

      /** A terv-építő utólagos bekötése (az init hívja, amint felépült). */
      attachPlanBuilder(builder) {
        planBuilder = builder;
      },
    };
  }

  /** A készenlét-javaslat ablaka.

      A biztonsági réteg eddig csak JELÖLT (a terv-kártyán apró betűvel).
      Ez a felület kérdez: felsorolja, mit venne lejjebb vagy hagyna ki MA,
      és a felhasználó dönt. Két dolog fontos benne:

      · a javaslat SOHA nem a tervet írja át, csak a mai naplót — a terv az
        edzőé, és ha némán változna, ő azt hinné, a kliens az ő tervét csinálta;
      · elutasításkor semmi nem történik, és nem is kérdezünk rá újra ugyanabban
        a körben — a következő check-in viszont újra felveti, ha még indokolt.

      A műveleteket a SZERVER számolja újra elfogadáskor; ez a felület csak
      megjeleníti őket. */
  function setupAdviceModal() {
    const modal = $('#adviceModal');
    const controller = createModalController(modal);
    const lead = $('#adviceModalText');
    const list = $('[data-advice-list]', modal);

    // Az edzésnapló vezérlője később épül fel — utólag kapcsoljuk be.
    let workout = null;

    /** A művelet emberi neve. A „kihagyás" és a „leállás" nem ugyanaz:
        az utóbbinál már van teljesített szett, azt nem tesszük meg nem
        történtté — csak a hátralévő rész marad el. */
    const ACTION_LABELS = {
      reduce: 'Levesz',
      skip: 'Kihagy',
      stop: 'Leáll',
    };

    const render = (advice) => {
      lead.textContent = advice.name
        ? `A(z) „${advice.name}" mai naplójában ${advice.items.length} gyakorlatot érdemes visszavenni:`
        : `${advice.items.length} gyakorlatot érdemes ma visszavenni:`;

      list.replaceChildren();
      advice.items.forEach((item) => {
        const el = cloneTemplate('tpl-advice-item');
        if (item.action !== 'reduce') el.classList.add('ad-item--drop');
        $('.ad-item-action', el).textContent = ACTION_LABELS[item.action] ?? item.action;
        $('.ad-item-name', el).textContent = item.action === 'reduce'
          ? `${item.name} — −${item.percent}%`
          : item.name;
        $('.ad-item-detail', el).textContent = `${item.detail} · ${item.reason}`;
        list.appendChild(el);
      });
    };

    $('[data-advice-decline]', modal).addEventListener('click', () => controller.close());

    $('[data-advice-accept]', modal).addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const { applied } = await api.applySessionAdvice();
        // A szerver a piszkozatot írta át — a képernyőn lévő napló elavult.
        await workout?.reloadFromServer();
        showToast(applied === 1
          ? 'A mai naplód egy gyakorlaton módosult'
          : `A mai naplód ${applied} gyakorlaton módosult`);
        controller.close();
      } catch (err) {
        console.error('A javaslat alkalmazása nem sikerült:', err);
        showToast(err.message || 'A javaslat alkalmazása nem sikerült', 'error');
      } finally {
        button.disabled = false;
      }
    });

    return {
      /** Lekéri a javaslatot, és CSAK akkor nyit ablakot, ha van mit mondani.
          Hiba esetén csendben nem történik semmi: a check-in mentése sikerült,
          azt nem szabad egy másodlagos lekérés hibájával elrontani. */
      async maybeShow() {
        try {
          const advice = await api.getSessionAdvice();
          if (!advice?.items?.length) return;
          render(advice);
          controller.open();
        } catch (err) {
          console.error('A készenlét-javaslat lekérése nem sikerült:', err);
        }
      },

      /** Az edzésnapló vezérlőjének utólagos bekötése (az init hívja). */
      attachWorkout(controllerRef) {
        workout = controllerRef;
      },
    };
  }

  /** Az Edző oldal két felülete — VALÓDI edző–kliens kapcsolatokból.

      Az oldal korábban seed-adaton állt: fix „Kovács Bence" fejléc és hat
      kitalált sportoló, a szerepköröket pedig localStorage-kapcsolók adták.
      Mostantól mindkét nézet egyetlen lekérésből épül (`/api/coach/overview`),
      és a szerepkör is a szerverről jön:
        · van edződ (ELFOGADOTT kapcsolat) + edzel másokat → nézetváltó,
        · csak az egyik → az a nézet,
        · egyik sem → üres állapot.

      A beérkezett meghívás a KLIENS nézetben akkor is megjelenik, ha még nincs
      edződ — különben nem tudnád elfogadni.

      Minden művelet teljes újratöltéssel zárul: az igazság forrása a szerver,
      nem a képernyőn maradt állapot. */
  async function setupCoachSurfaces(athleteModal, confirmAction) {
    const page = $('[data-page="coach"]');
    const toggle = $('[data-coach-toggle]', page);
    const emptyState = $('[data-coach-empty]', page);
    const views = {
      client: $('[data-view="client"]', page),
      manager: $('[data-view="manager"]', page),
    };
    const coachHead = $('[data-coach-head]', page);
    const noCoachText = $('[data-no-coach]', page);
    const receivedPanel = $('[data-invites-received]', page);
    const receivedList = $('[data-list="invites-received"]', page);
    const sentList = $('[data-list="invites-sent"]', page);
    const clientFeed = $('[data-client-feed]', page);
    const composer = $('[data-form="coach-message"]', page);
    const inviteForm = $('[data-form="invite-client"]', page);
    const inviteInput = $('#co-invite-username');

    /* A szerver által látott állapot. Üresen indul: ha a lekérés hibázik, az
       oldal üres állapotot mutat — nem korábbi, esetleg már nem érvényes adatot. */
    let state = { isCoach: false, clients: [], invitesSent: [], coaches: [], invitesReceived: [] };

    /* Itt MI vagyunk a kliens: a subject a saját fiókunk, a partner az
       edzőnk. Több edző esetén az elsővel folyik a szál — a nézet egyelőre
       egy edzőt mutat. Edző nélkül nincs szál, és a szerkesztő is rejtve van. */
    const chat = createChatController({
      feed: clientFeed,
      form: composer,
      input: $('#coach-message'),
      getThread: () => {
        const link = state.coaches[0];
        return link && myUserId ? { subjectId: myUserId, coachId: link.coach.id } : null;
      },
      isFeedVisible: () => !views.client.hidden,
    });

    /** Egy meghívás sora. Ugyanaz az alak mindkét irányban; a különbség, hogy
        elfogadható-e (beérkezett) vagy csak visszavonható (kiküldött). */
    function inviteRow(link, { incoming }) {
      const item = cloneTemplate('tpl-co-invite');
      const who = incoming ? link.coach : link.client;
      $('.co-invite-name', item).textContent = who.name;
      $('.co-invite-meta', item).textContent = `@${who.username}`;

      const accept = $('[data-action="accept-invite"]', item);
      const remove = $('[data-action="remove-link"]', item);
      accept.hidden = !incoming;
      accept.dataset.link = link.id;
      remove.dataset.link = link.id;
      remove.textContent = incoming ? 'Elutasítom' : 'Visszavonom';
      return item;
    }

    /** Kliens nézet: az edződ, a beérkezett meghívások és a vele folytatott
        üzenetváltás. */
    function renderClientView() {
      const link = state.coaches[0] ?? null;

      coachHead.hidden = !link;
      clientFeed.hidden = !link;
      composer.hidden = !link;
      // A „még nincs edződ" szöveg felesleges, ha épp döntened kell egy meghívásról.
      noCoachText.hidden = Boolean(link) || state.invitesReceived.length > 0;

      if (link) {
        $('[data-coach-name]', page).textContent = link.coach.name;
        $('[data-coach-role]', page).textContent = `Edződ · @${link.coach.username}`;
        $('[data-action="end-coach-link"]', page).dataset.link = link.id;
        chat.load();
      }

      receivedPanel.hidden = state.invitesReceived.length === 0;
      receivedList.replaceChildren(
        ...state.invitesReceived.map((invite) => inviteRow(invite, { incoming: true })),
      );
    }

    /** Edzői nézet: a kiküldött meghívások és a kliensek kártyái. */
    function renderManagerView() {
      sentList.replaceChildren(
        ...state.invitesSent.map((invite) => inviteRow(invite, { incoming: false })),
      );
      renderCoachPanel(state.clients);
    }

    /** A nézetek kapcsolása a tényleges szerepkörök szerint. */
    function apply({ animate = false } = {}) {
      const isClient = state.coaches.length > 0 || state.invitesReceived.length > 0;
      const both = isClient && state.isCoach;
      const view = both
        ? (prefs.get('coachView', 'client') === 'manager' ? 'manager' : 'client')
        : isClient ? 'client' : state.isCoach ? 'manager' : null;

      toggle.hidden = !both;
      emptyState.hidden = view !== null;
      views.client.hidden = view !== 'client';
      views.manager.hidden = view !== 'manager';

      $$('.co-toggle-btn', toggle).forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.coachView === view));
      });

      if (view === 'manager' && animate) animateCoachRatings();
    }

    /** A teljes állapot újratöltése a szerverről, majd újrarajzolás. */
    async function refresh({ animate = false } = {}) {
      try {
        state = await api.getCoachOverview();
      } catch (err) {
        console.error('Az edzői adatok betöltése nem sikerült:', err);
        showToast('Az edzői adatok betöltése nem sikerült', 'error');
        return;
      }
      renderClientView();
      renderManagerView();
      apply({ animate });
    }

    /* A kliens-kártyák és a riasztás-sorok a részletmodált nyitják. A kliens a
       FRISS állapotból kerül elő, nem egy induláskor lementett listából. */
    page.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-athlete]');
      if (!trigger) return;
      const client = state.clients.find((item) => item.id === trigger.dataset.athlete);
      if (client) athleteModal?.open(client);
    });

    toggle.addEventListener('click', (event) => {
      const btn = event.target.closest('.co-toggle-btn');
      if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
      prefs.set('coachView', btn.dataset.coachView);
      apply({ animate: true });
    });

    /* Meghívás küldése. A szerver hibaüzenete beszédes (nincs ilyen fiók, már
       a kliensed, már meghívtad) — azt mutatjuk, nem általánosítunk. */
    inviteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = inviteInput.value.trim();
      if (!username) return;
      try {
        const link = await api.inviteClient(username);
        inviteInput.value = '';
        showToast(`${link.client.name} meghívva — az elfogadásáig nem látod az adatait`);
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      await refresh();
    });

    /* Elfogadás / elutasítás / visszavonás / kapcsolatbontás — mind a kapcsolat
       azonosítójára megy. A már ÉLŐ kapcsolat bontása megerősítést kér: egy
       félrenyúlás miatt nem szűnhet meg némán az együttműködés. */
    page.addEventListener('click', async (event) => {
      const accept = event.target.closest('[data-action="accept-invite"]');
      const remove = event.target.closest('[data-action="remove-link"], [data-action="end-coach-link"]');
      if (!accept && !remove) return;

      const id = Number((accept ?? remove).dataset.link);
      const isActiveLink = Boolean(event.target.closest('[data-action="end-coach-link"]'));
      if (isActiveLink && confirmAction) {
        const ok = await confirmAction(
          'Az edződ ezután nem látja a naplóidat és a készenlétedet. Később újra meghívhat.',
          { title: 'Kapcsolat bontása?', confirmLabel: 'Bontás' },
        );
        if (!ok) return;
      }

      try {
        if (accept) {
          const link = await api.acceptInvite(id);
          showToast(`${link.coach.name} mostantól az edződ`);
        } else {
          await api.removeCoachLink(id);
          showToast('A kapcsolat megszűnt');
        }
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
      // A szerepkörök is változhattak („van edződ") — a profil cache-e eldobandó.
      await api.refreshUser().catch(() => {});
      await refresh();
    });

    await refresh();
    return { refresh };
  }

  /** Gyorsbillentyűk: 1–5 oldalváltás. Gépelés közben és nyitott modal
      mellett inaktív — utóbbi nélkül a háttérben lévő oldal átváltott,
      miközben az ablak nyitva maradt előtte. */
  const isModalOpen = () =>
    Boolean($('.video-modal.is-open, .settings-modal.is-open, .athlete-modal.is-open, .confirm-modal.is-open, .pr-modal.is-open'));

  function setupShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isModalOpen()) return;
      if (event.target instanceof Element
        && event.target.matches('input, textarea, select, [contenteditable]')) return;
      // A check-in varázslóban az 1–5 a VÁLASZ, nem oldalváltás: a skálák és a
      // testtérkép gombok (nem input-ok), így a fenti input-őr nem védi meg
      // őket. A számbillentyűket ott a varázsló saját kezelője dolgozza fel.
      if (currentPage() === 'checkin') return;
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
    ]);

    // Megerősítő ablak — szinkron felépítésű, mert több setup is erre épül
    // (köztük az edzői felület: a kapcsolat bontása megerősítést kér).
    const confirmAction = setupConfirmDialog();
    /* A készenlét-javaslat ablaka. A setupRecovery ELŐTT kell felépülnie:
       a check-in mentése onnan hívja a maybeShow-t. */
    adviceModal = setupAdviceModal();
    const athleteModal = await safe(setupAthleteModal);

    /* A szerepkör-alapú nézetek a router előtt állnak be, hogy az induló oldal
       effektjei (pl. kártya-pontszámok) már a jó nézetet lássák. Az edzői
       panel tartalmát is ez tölti be — a kliensek a szerverről jönnek. */
    const coachSurfaces = await safe(() => setupCoachSurfaces(athleteModal, confirmAction));

    setupRouter();

    const videoModal = setupVideoModal();
    const prModal = setupPrModal();
    const notifPanel = await safe(setupNotifications);
    const settingsModal = await safe(() => setupSettingsModal({
      onRolesChange: () => coachSurfaces?.refresh({ animate: true }),
      onNotifCatsChange: () => notifPanel?.updateBadge(),
    }));
    setupDashboard(settingsModal);
    // A testsúly-napló a Regeneráció oldal trend-kártyáját és az áttekintő Δ
    // statját tölti — a setupRecovery ELŐTT, mert az a mai bejegyzésből tölti
    // a részletes űrlap testsúly-mezőjét.
    await safe(refreshWeightLog);
    await safe(setupRecovery);
    // A setupRecovery UTÁN: a varázsló mentése az ott beállított
    // applyCheckinSaved-en keresztül frissíti a Regeneráció oldalt.
    await safe(setupCheckinWizard);
    /* Onboarding: a setupRouter (ami ELŐBB fut) már a check-inre navigált, de
       a `pageEffects.checkin` akkor még egy null frissítőt talált — a lap a
       setup-időben rajzolt introt mutatja, szerver-állapot nélkül. Itt pótoljuk,
       hogy a varázsló ugyanabból az állapotból induljon, mint bármely másik
       megnyitáskor (pl. ha a fiók a testsúlyt már rögzítette). */
    if (onboardingLock) await safe(refreshCheckinWizard);
    // A közös gyakorlat-választó — az edzésnapló és a terv-építő is ezt célozza át
    const picker = await safe(() => setupExercisePicker(confirmAction));
    const workout = await safe(() => setupWorkout(videoModal, prModal, picker, confirmAction));
    // A javaslat elfogadása a szerveren írja át a piszkozatot — a naplót
    // utána újra kell tölteni, ezért kell a modálnak az edzés vezérlője.
    adviceModal.attachWorkout(workout);
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
    // A sportoló-modál terv-gombjai csak innentől visznek a terv-építőbe:
    // a modál korábban épül fel (a coach felület kell hozzá), a builder később.
    athleteModal?.attachPlanBuilder(planBuilder);
    setupPlans(planBuilder, workout);
    setupSummary();
    setupShortcuts();
    setupConnectivity();

    setupNavRing($('#navKnob'), (dir) => navigate(DIR_TO_PAGE[dir] ?? 'dashboard'));

    // Napváltás-figyelő: éjfél után az áttekintő napi statjai nullázódnak, és
    // a check-in emlékeztető is visszatér — az új napra még nincs check-in.
    // (A táplálkozás-oldali frissítő a setupNutrition-ben iratkozik fel.)
    onDayChange(refreshDailyStats);
    startDayWatcher();

    if (hadError) {
      showToast('Nem minden adat töltődött be — próbáld frissíteni az oldalt', 'error');
    }
  }

  /* ======================================================================
     Belépő képernyő (au-*)
     Az app előtt áll: amíg nincs érvényes munkamenet, a szerver minden
     /api/* végponton 401-et ad, tehát nincs mit renderelni mögötte. Ezért
     nem modál — nem lehet bezárni, nincs háttér-átkattintás.
     ====================================================================== */
  function setupAuthGate() {
    const screen = $('#authScreen');
    const form = $('[data-form="auth"]');
    const titleEl = $('#authTitle');
    const leadEl = $('[data-au-lead]');
    const errorEl = $('[data-au-error]');
    const submitBtn = $('[data-au-submit]');
    const switchBtn = $('[data-au-switch]');
    const switchTextEl = $('[data-au-switch-text]');
    const passwordInput = $('#au-password');

    let mode = 'login';   // 'login' | 'register'
    let onSuccess = null; // a sikeres belépés után futtatandó lépés

    const MODES = {
      login: {
        title: 'Belépés',
        lead: 'Jelentkezz be a saját edzésnaplódhoz.',
        submit: 'Belépés',
        switchText: 'Még nincs fiókod?',
        switchLabel: 'Regisztráció',
        autocomplete: 'current-password',
      },
      register: {
        title: 'Regisztráció',
        lead: 'Hozz létre egy fiókot — az adataid csak hozzád tartoznak.',
        submit: 'Fiók létrehozása',
        switchText: 'Van már fiókod?',
        switchLabel: 'Belépés',
        autocomplete: 'new-password',
      },
    };

    const showError = (message) => {
      errorEl.textContent = message;
      errorEl.hidden = !message;
    };

    const applyMode = () => {
      const config = MODES[mode];
      titleEl.textContent = config.title;
      leadEl.textContent = config.lead;
      submitBtn.textContent = config.submit;
      switchTextEl.textContent = config.switchText;
      switchBtn.textContent = config.switchLabel;
      passwordInput.autocomplete = config.autocomplete;
      $$('[data-au-only="register"]').forEach((el) => { el.hidden = mode !== 'register'; });
      showError('');
    };

    switchBtn.addEventListener('click', () => {
      mode = mode === 'login' ? 'register' : 'login';
      applyMode();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = $('#au-username').value.trim();
      const password = passwordInput.value;
      const displayName = $('#au-display-name').value.trim();

      showError('');
      submitBtn.disabled = true;
      try {
        /* A válasz `onboarding` mezője dönti el, kell-e első check-in. A
           belépés is hozza — így az a fiók is a varázslóra kerül, amelyik
           regisztrált, de a check-int félbehagyta és később lépett vissza. */
        const account = mode === 'register'
          ? await api.register(username, displayName, password)
          : await api.login(username, password);
        setOnboardingLock(Boolean(account?.onboarding));

        form.reset();
        screen.hidden = true;
        screen.setAttribute('aria-hidden', 'true');
        onSuccess?.();
      } catch (err) {
        showError(err.message);
        passwordInput.focus();
        passwordInput.select();
      } finally {
        submitBtn.disabled = false;
      }
    });

    /** A képernyő megnyitása. `firstRun` esetén rögtön a regisztráció látszik
        (még egyetlen fiók sincs), `next` pedig a siker utáni lépés. */
    const open = ({ firstRun = false, next = null, message = '' } = {}) => {
      mode = firstRun ? 'register' : 'login';
      onSuccess = next;
      applyMode();
      if (message) showError(message);
      screen.hidden = false;
      screen.setAttribute('aria-hidden', 'false');
      $('#au-username').focus();
    };

    return { open, isOpen: () => !screen.hidden };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const gate = setupAuthGate();

    /* Munkamenet-vesztés MENET KÖZBEN (lejárt süti, másik eszközről történt
       kijelentkezés). Ilyenkor a felépült felület már az előző fiók adatait
       mutatja, ezért belépés után teljes újratöltés jön — nem próbáljuk
       darabonként frissíteni. A jelző azt is megakadályozza, hogy több
       párhuzamos 401 többször nyissa meg a képernyőt. */
    let sessionLostHandled = false;
    onSessionLost = () => {
      if (sessionLostHandled || gate.isOpen()) return;
      sessionLostHandled = true;
      gate.open({
        next: () => window.location.reload(),
        message: 'A munkamenet lejárt — jelentkezz be újra.',
      });
    };

    try {
      const { user, firstRun } = await api.me();
      if (user) {
        // A zár az init ELŐTT áll be: a setupRouter már ebből választ induló
        // oldalt. Ez adja az újratöltés-túlélést is — a félbehagyott első
        // check-in után a frissítés megint a varázslóra tesz le.
        setOnboardingLock(Boolean(user.onboarding));
        await init();
      } else {
        // Az első betöltésnél még nincs mit eldobni, ezért itt elég az init.
        gate.open({
          firstRun,
          next: () => init().catch((err) => console.error('Inicializálási hiba:', err)),
        });
      }
    } catch (err) {
      console.error('Inicializálási hiba:', err);
    }
  });

})();
