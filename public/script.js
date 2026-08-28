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

  /** 401 esetén elindítja a visszaterelést, és jelzett hibát dob. */
  function handleUnauthorized() {
    onSessionLost();
    const err = new Error('A munkamenet lejárt — jelentkezz be újra.');
    err.code = SESSION_LOST;
    return err;
  }

  /* ---- A kliens naptári napja ----
     A naplózás egy NAPRA könyvel (edzés, check-in, étkezés, testsúly), és azt
     a napot korábban a szerver helyi ideje adta. Ez hibás volt: egy UTC-s
     szerveren a magyar felhasználónak este 10 után már a következő napra ment
     minden. Ezért minden kérés viszi a böngésző szerinti mai napot, és a
     szerver ezt használja (ld. server.js → requestDate; a fejlécet ott
     ellenőrzi is, hogy ne lehessen vele tetszőleges napra visszaírni). */
  const CLIENT_DATE_HEADER = 'X-Client-Date';

  const clientDate = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  };

  /** Minden kéréshez járó fejlécek. Nem tárolt érték: éjfél után (vagy ha a
      gép időzónája menet közben változik) magától a helyes napot küldi. */
  const requestHeaders = (extra) => ({ [CLIENT_DATE_HEADER]: clientDate(), ...extra });

  /** GET egy JSON-végpontra, egységes hibakezeléssel. */
  async function getJson(path) {
    const res = await fetch(path, { headers: requestHeaders() });
    if (res.status === 401) throw handleUnauthorized();
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  }

  /** GET, amely a szerver `error` üzenetét adja tovább, nem csak a státuszt.
      A vonalkód-feloldás hibái tartalmas magyar mondatok („ezt a kódot az OFF
      sem ismeri", „most nem elérhető") — ezeket a felhasználó látja, a
      „GET /api/… → 404" viszont semmit nem mond neki. A státusz az `err.status`
      mezőn marad elérhető a hívónak. */
  async function getJsonDetailed(path) {
    const res = await fetch(path);
    if (res.status === 401) throw handleUnauthorized();
    const detail = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(detail?.error || `GET ${path} → ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return detail;
  }

  /** JSON-törzsű kérés (POST/PUT) egy végpontra. Hiba esetén a szerver `error`
      üzenetét dobja, ha van, különben a HTTP-státuszt. A választ JSON-ként adja vissza. */
  async function sendJson(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: requestHeaders({ 'Content-Type': 'application/json' }),
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

  /** Törlő kérés — a SIKERES válasz üres (204), ezért azt nem olvassuk
      JSON-ként. A HIBÁS választ viszont igen: a szerver `error` mezője a
      felhasználónak szóló mondat („Nincs ilyen edzés…"), és a toast azt
      mutatja meg — nem a nyers HTTP-státuszt. */
  async function del(path) {
    const res = await fetch(path, { method: 'DELETE', headers: requestHeaders() });
    if (res.status === 401) throw handleUnauthorized();
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.error || `DELETE ${path} → ${res.status}`);
    }
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
    // Friss fiók-adat a cache megkerülésével (edzés-cél mentése, kapcsolat változása után)
    refreshUser:       () => { invalidateCache('/api/user'); return getJsonCached('/api/user'); },
    // Az edzés-cél mentése — a válasz a fiók frissített felületi alakja
    saveGoal:          (goal) => putJson('/api/user', { goal }),
    // Nem cache-elt: a profiloldal összesítői minden edzés-mentés után változnak
    getProfile:        () => getJson('/api/profile'),
    // Nem cache-elt: a dailyStats a naplózással és a nap váltásával változik
    getDashboard:      () => getJson('/api/dashboard'),
    getCharts:         () => getJsonCached('/api/charts'),
    // Friss chart-adat a cache megkerülésével (edzés naplózása után)
    refreshCharts:     () => { invalidateCache('/api/charts'); return getJsonCached('/api/charts'); },
    // A /api/foods FIÓKFÜGGŐ (elöl a saját ételek), de a cache-elés így is
    // helyes: fiókváltáskor az app teljes oldalt tölt. Saját étel felvitele
    // vagy törlése után viszont el kell dobni — erre való a refreshFoods.
    getFoods:          () => getJsonCached('/api/foods'),
    refreshFoods:      () => { invalidateCache('/api/foods'); return getJsonCached('/api/foods'); },
    // Nem cache-elt: a saját tervek mentés/szerkesztés után változnak
    getPlans:          () => getJson('/api/plans'),
    // Nem cache-elt: a PR-lista a mentett edzésekből épül, mentés után frissül
    getPrs:            () => getJson('/api/prs'),
    getPrHistory:      (exercise) => getJson(`/api/prs/history?exercise=${encodeURIComponent(exercise)}`),
    // Nem cache-elt: az exercise maxes-ek az edzés közben változhatnak
    getExerciseMaxes:  () => getJson('/api/exercise-maxes'),
    /* Nem cache-elt: a lista a hívó VALÓDI eseményeiből áll össze (olvasatlan
       üzenet, meghívó, friss PR), tehát a panel minden megnyitásakor frisset
       kérünk — a munkamenetre eltett válasz órákig hazudna. */
    getNotifications:  () => getJson('/api/notifications'),
    getDefaultSet:     () => getJsonCached('/api/default-set'),
    getExerciseCatalog: () => getJsonCached('/api/exercise-catalog'),
    // A választható edzés-célok (kulcs + kártya-címke + felirat) — referencia-adat
    getGoals:          () => getJsonCached('/api/goals'),

    /* ---- Edző–sportoló kapcsolat ----
       EGYIK sem cache-elt: a kapcsolatok, a sportolók állapota és az üzenetek
       a másik fél lépéseitől is változnak, tehát minden megnyitáskor friss
       adat kell. */
    getCoach:          () => getJson('/api/coach'),
    acceptCoachInvite: (linkId) => postJson(`/api/coach/invites/${linkId}/accept`),
    declineCoachInvite: (linkId) => del(`/api/coach/invites/${linkId}`),
    leaveCoach:        () => del('/api/coach'),
    getAthletes:       () => getJson('/api/athletes'),
    inviteAthlete:     (username) => postJson('/api/athletes', { username }),
    removeAthlete:     (linkId) => del(`/api/athletes/${linkId}`),
    /* Terv-kiosztás. Az edző a SAJÁT tervei közül ajánl fel egyet; a sportoló
       fiókjába csak az elfogadás után kerül be — másolatként, a meglévő
       tervei mellé. */
    assignPlan:        (linkId, planId, note) => postJson(`/api/athletes/${linkId}/plan`, { planId, note }),
    acceptPlanOffer:   (id) => postJson(`/api/plan-offers/${id}/accept`),
    declinePlanOffer:  (id) => del(`/api/plan-offers/${id}`),
    // Üzenetváltás — ugyanaz a szál mindkét oldalról, a kapcsolat azonosítójával
    getMessages:       (linkId) => getJson(`/api/messages/${linkId}`),
    sendMessage:       (linkId, text) => postJson(`/api/messages/${linkId}`, { text }),
    // A szál nyugtázása: a másik fél üzenetei olvasottá válnak. A felület
    // akkor küldi, amikor a hírfolyam TÉNYLEG látszik — nem minden lekérésnél.
    markMessagesRead:  (linkId) => postJson(`/api/messages/${linkId}/read`),
    // A testsúly-napló. Írni nem innen írunk: a testsúlyt a napi check-in
    // kérdi, és a PUT /api/checkin weightKg mezője rögzíti (naponta egy sor).
    getWeightLog:      () => getJson('/api/weight-log'),
    getNutrition:      () => getJson('/api/nutrition'),
    // A mai naplózott tételek — a Táplálkozás oldal „Mai napló" listájához
    getNutritionLog:   () => getJson('/api/nutrition/log'),
    // Étel naplózása név + adag (gramm) alapján — a válasz { entry, totals }.
    // A makrókat a szerver számolja át az adagra, a kliens csak a grammot küldi.
    addNutritionEntry: (name, grams) => postJson('/api/nutrition/log', { name, grams }),
    // Naplóbejegyzés visszavonása — a válasz a frissített napi összesítő
    removeNutritionEntry: (id) => sendJson('DELETE', `/api/nutrition/log/${id}`),

    /* ---- Saját ételek + vonalkód ----
       A kalóriát a szerver számolja a makrókból (Atwater 4/4/9); a kcalMode
       'manual' esetén a megadott érték marad, de a szerver akkor is sávban tartja. */
    addCustomFood:     (food) => postJson('/api/foods/custom', food),
    removeCustomFood:  (id) => del(`/api/foods/custom/${id}`),
    // Vonalkód feloldása: saját étel → szerver-cache → Open Food Facts.
    // getJsonDetailed, mert itt a szerver magyar hibaüzenete a lényeg.
    lookupBarcode:     (code) => getJsonDetailed(`/api/foods/barcode/${encodeURIComponent(code)}`),
    getWorkouts:       () => getJson('/api/workouts'),
    // Edzés mentése — a szerver visszaadja a mentett { id, name, date, exercises }-t.
    // A planId azt rögzíti, melyik tervből indult az edzés (a Tervek oldali
    // haladás ebből párosít, nem névegyezésből).
    saveWorkout:       (name, exercises, planId) => postJson('/api/workouts', { name, exercises, planId }),
    // Mentett edzés javítása. A dátumot NEM küldjük: az edzés a saját napján
    // marad — a javítás nem helyezi át a naplóban.
    updateWorkout:     (id, name, exercises) => putJson(`/api/workouts/${id}`, { name, exercises }),
    // Mentett edzés törlése. A szerver az egyéni csúcsokat is újraszámolja,
    // ezért utána a PR-lista és a diagramok is frissítendők.
    deleteWorkout:     (id) => del(`/api/workouts/${id}`),
    // Az épp szerkesztett edzés piszkozata — betöltéskor visszaáll, minden változtatás menti
    getWorkoutDraft:   () => getJson('/api/workout-draft'),
    saveWorkoutDraft:  (name, exercises, planId, workoutId) =>
      putJson('/api/workout-draft', { name, exercises, planId, workoutId }),
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
    /* Jelszóváltoztatás és fióktörlés. Mindkettő a JELENLEGI jelszót is kéri —
       a munkamenet-süti önmagában nem elég hozzájuk. A jelszóváltás válasza új
       sütit ad (a többi eszköz munkamenete megszűnik), a törlésé pedig törli a
       sütit; utána a felület újratölt, és a belépő képernyőre esik vissza. */
    changePassword: (currentPassword, newPassword) =>
      putJson('/api/auth/password', { currentPassword, newPassword }),
    deleteAccount: (password) => postJson('/api/auth/delete-account', { password }),
  };

  /** Hétnapok hétfőtől (0 = hétfő), ahogy a szerver is indexeli őket
      (plans.days). A terv-építő chipjei és a felajánlott terv ütemezése is
      innen kapja a feliratot — a kettő nem csúszhat el egymástól. */
  const DAY_LABELS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
  const DAY_NAMES = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];

  /** Értesítés-kategóriák a beállítások modal kapcsolóihoz (notification.cat).
      A lista pontosan azt a hármat sorolja, amit a szerver valóban KÜLDENI tud
      (server/notifications.js) — a korábbi hat kategória a demo-listával együtt
      kikerült, mert négyükhöz (terv kiosztva/módosítva, edzői megjegyzés, heti
      riport) nem tartozott és ma sem tartozik valódi esemény. */
  const NOTIF_CATEGORIES = [
    { key: 'message', label: 'Új üzenet' },
    { key: 'coach', label: 'Edző-kapcsolat' },
    { key: 'plan', label: 'Terv kiosztva' },
    { key: 'pr', label: 'Egyéni csúcs' },
  ];

  /** Az oldalak, a nav gyűrű irányai és a gyorsbillentyűk megfeleltetése.
      A 'summary', a 'plan-builder', az 'exercise-picker' és a 'checkin'
      flow-oldalak: a hash-router ismeri őket, de szándékosan nincsenek a nav
      gyűrű irányai és a gyorsbillentyűk között (az „Edzés befejezése", az
      „+ Új terv", a „+ Gyakorlat hozzáadása", ill. az áttekintő check-in
      emlékeztetője és a Regeneráció oldal gombja visz oda). */
  const PAGES = ['dashboard', 'recovery', 'workout', 'nutrition', 'plans', 'coach', 'profile', 'summary', 'plan-builder', 'exercise-picker', 'checkin'];
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

  /** Külső szkript LUSTA betöltése, URL-enként egyszer (az ígéret cache-elt).
      Bundler nincs a projektben, a ZXing vonalkód-dekóder viszont 336 KB —
      ezt nem tesszük minden oldalbetöltés útjába. Csak akkor tölt le, ha a
      felhasználó ténylegesen szkennel, ÉS a natív BarcodeDetector nem elérhető.
      Hibánál a bejegyzést töröljük, hogy egy későbbi próbálkozás újrakezdhesse. */
  const loadedScripts = new Map();
  function loadScript(src) {
    if (!loadedScripts.has(src)) {
      loadedScripts.set(src, new Promise((resolve, reject) => {
        const element = document.createElement('script');
        element.src = src;
        element.async = true;
        element.onload = resolve;
        element.onerror = () => {
          loadedScripts.delete(src);
          reject(new Error(`Nem sikerült betölteni: ${src}`));
        };
        document.head.appendChild(element);
      }));
    }
    return loadedScripts.get(src);
  }

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
      /* Az Edző oldal MÁSIK EMBER adatát mutatja (a sportolóid állapotát, az
         edződ üzeneteit), ami a saját gépeléseinktől függetlenül változik —
         ezért minden megnyitáskor friss adatot kérünk. A frissítő rajzolja ki
         a kártyákat is, és az ő végén pörögnek fel a pontszámok. */
      if (refreshCoachPage) refreshCoachPage();
      else {
        const manager = $('[data-page="coach"] [data-view="manager"]');
        if (manager && !manager.hidden) animateCoachRatings();
      }
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
    profile() {
      // Az összesítők minden edzés-mentéssel változnak, ezért megnyitáskor
      // mindig a szervertől kérjük őket — nincs külön értesítési lánc.
      refreshProfile?.().catch((err) => console.error('Profil frissítési hiba:', err));
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

  /** A profiloldal frissítője — a setupProfile állítja be. Az oldal minden
      megnyitása hívja (a pageEffects-en át). */
  let refreshProfile = null;

  /** Az Edző oldal frissítője — a setupCoachPage állítja be. Az oldal minden
      megnyitása hívja (a pageEffects-en át): a kapcsolatok, a sportolók
      állapota és az üzenetek a másik fél lépéseitől is változnak. */
  let refreshCoachPage = null;

  /** A mentett check-in kirajzolása a Regeneráció oldalra — a setupRecovery
      állítja be. A hosszú űrlap ÉS a varázsló is ezt hívja mentés után, így
      a két írási út nem sodródhat szét. */
  let applyCheckinSaved = null;

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
    nutrition: 'Táplálkozás', plans: 'Tervek', coach: 'Edző', profile: 'Profil',
    summary: 'Edzés-összegző', 'plan-builder': 'Terv-építő',
    'exercise-picker': 'Gyakorlat hozzáadása', checkin: 'Napi check-in',
  };

  /** Az oldalak ikonjai a nav gyűrű gombjához — az index.html tetején lévő közös
      sprite symbol-id-jei. Ugyanaz a 11 kulcs, mint a PAGE_TITLES-ben, hogy a
      kettő ne sodródjon szét. Az Edző és a Profil oldal is a már meglévő
      #icon-user-t használja — hogy melyiken állsz, a gomb neve és a hint-sor
      mondja meg (mindkettő a PAGE_TITLES-ből). */
  const PAGE_ICONS = {
    dashboard: 'icon-page-dashboard', recovery: 'icon-page-recovery',
    workout: 'icon-page-workout', nutrition: 'icon-page-nutrition',
    plans: 'icon-page-plans', coach: 'icon-user', profile: 'icon-user',
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

  /** Egy „Korábbi edzések" sor ({ id, date, detail, rpe }) <li>-vé építve.
      Az id a sor gombjaira is rákerül: a javítás és a törlés ebből tudja,
      melyik mentett edzésről van szó. */
  function historyEntryEl(entry) {
    const li = cloneTemplate('tpl-history-entry');
    li.dataset.workoutId = entry.id;
    $('.wk-history-date', li).textContent = entry.date;
    $('.wk-history-detail', li).textContent = entry.detail;
    $('.wk-history-rpe', li).textContent = entry.rpe;

    // A gombok felirata („Javítás", „✕") önmagában nem mondja meg, MELYIK
    // edzésről van szó — képernyőolvasóval a lista csupa azonos gomb lenne.
    const label = `${entry.date} · ${entry.detail}`;
    $('[data-action="reopen-workout"]', li).setAttribute('aria-label', `${label} javítása`);
    $('[data-action="delete-workout"]', li).setAttribute('aria-label', `${label} törlése`);
    $('[data-action="delete-workout"]', li).title = 'Edzés törlése';
    return li;
  }

  /** Egy mentett edzés → „Korábbi edzések" sor (név + teljesített/összes szett). */
  function workoutHistoryEntry(workout) {
    const sets = workout.exercises.flatMap((exercise) => exercise.sets || []);
    const done = sets.filter((set) => set.done).length;
    return {
      id: workout.id, date: workout.date, detail: workout.name,
      rpe: `${done}/${sets.length} szett`,
    };
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

  /** Az étel-lista feltöltése. A `list` opcionális: ha a hívó már lekérte az
      ételeket (setupNutrition), ne kérje le másodszor is — így a lista és a
      naplózás ugyanabból az egy válaszból épül, és nem csúszhatnak el.
      A SAJÁT ételek a szervertől elöl jönnek, és jelvényt + törlés-gombot kapnak. */
  async function renderFoods(foodList = null) {
    const foods = foodList ?? await api.getFoods();
    const list = $('[data-list="foods"]');
    list.replaceChildren(); // újrahíváskor se duplázódjon a lista
    foods.forEach((food) => {
      const item = cloneTemplate('tpl-food');
      // A kereső erre szűr, nem a teljes szövegre. A kategória is bele megy:
      // 437 étel közt a „tejtermék” vagy a „hüvelyes” beírása használhatóbb
      // belépő, mint végiggörgetni a listát. A márka a vonalkódról felvitt
      // termékeknél az, amiről a felhasználó felismeri őket.
      item.dataset.foodName = [food.name, food.group, food.brand]
        .filter(Boolean).join(' ').toLowerCase();

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

      // Saját étel: jelvény + törlés. A beépített katalógus elemei nem
      // törölhetők, azok minden fióknak közösek.
      if (food.custom) {
        item.classList.add('nu-food--custom');
        $('.nu-food-badge', item).hidden = false;
        const removeBtn = $('.nu-food-remove', item);
        removeBtn.hidden = false;
        removeBtn.dataset.customFoodId = food.id;
        removeBtn.title = 'Saját étel törlése';
        removeBtn.setAttribute('aria-label', `${food.name} törlése a saját ételek közül`);
      }

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

  /** Egy üzenet-buborék. A `me` a saját üzeneteket tolja jobbra — a szerver a
      néző szemszögéből jelöli meg őket (ld. messageNote). */
  function createCoachNote({ meta, text, me = false }) {
    const article = cloneTemplate('tpl-coach-note');
    if (me) article.classList.add('co-note--me');
    $('.co-note-meta', article).textContent = meta;
    $('.co-note-text', article).textContent = text;
    return article;
  }

  /* ---- Edzői panel: állapot-sáv + sportoló-kártyák ----
     A kártyák VALÓDI sportolók valódi adatából épülnek (GET /api/athletes):
     az összpontszámot a szerver számolja (server/coaching.js) a készenlét és a
     terv-követés átlagaként, terv híján magából a készenlétből. A szint (arany
     ≥ 85, ezüst ≥ 70, alatta bronz) ebből jön — FIFA-kártya ihletésű megjelenés.
     A kártya azonosítója a KAPCSOLAT azonosítója: a sportoló belső id-jét a
     szerver nem is adja ki. */
  const athleteTier = (rating) => (rating >= 85
    ? { key: 'gold', label: 'Arany szint' }
    : rating >= 70
      ? { key: 'silver', label: 'Ezüst szint' }
      : { key: 'bronze', label: 'Bronz szint' });

  /** Hiányzó érték helyén gondolatjel. A „még nincs adat" NEM nulla: terv
      nélkül nincs terv-követés, edzés nélkül nincs utolsó edzés. */
  const orDash = (value) => (value === null || value === undefined ? '—' : value);

  /** A kártyán megjelenő statok (címke + érték-képző) — a modál bővebb listát mutat. */
  const ATHLETE_CARD_STATS = [
    ['Készenlét', (a) => `${a.readiness}%`],
    ['Terv-követés', (a) => (a.adherence === null ? '—' : `${a.adherence}%`)],
    ['Sorozat', (a) => `${a.streak} nap`],
    ['Utolsó edzés', (a) => orDash(a.lastWorkout)],
  ];

  function renderAthleteCard(athlete, index) {
    const card = cloneTemplate('tpl-athlete-card');
    const rating = athlete.rating;
    const tier = athleteTier(rating);

    card.classList.add(`co-tier--${tier.key}`);
    card.dataset.athlete = athlete.linkId;
    card.style.setProperty('--i', index);
    card.setAttribute('aria-label', [
      `${athlete.name} — ${rating} pont, ${tier.label}`,
      athlete.alert ? 'figyelmet igényel' : null,
      athlete.unread > 0 ? `${athlete.unread} olvasatlan üzenet` : null,
      'részletek megnyitása',
    ].filter(Boolean).join(' — '));

    const ratingEl = $('.co-card-rating', card);
    ratingEl.textContent = rating;
    ratingEl.dataset.rating = rating;
    $('.co-card-tag', card).textContent = athlete.goal ?? '—';
    $('.co-card-name', card).textContent = athlete.name;
    $('.co-card-alert', card).hidden = !athlete.alert;

    /* Olvasatlan-jelvény. A darabszám a jelvényben látszik, a képernyőolvasó
       pedig a kártya aria-label-jéből kapja meg — a jelvény maga aria-hidden,
       hogy a szám ne hangozzon el másodszor, kontextus nélkül. */
    const unreadEl = $('.co-card-unread', card);
    unreadEl.hidden = !athlete.unread;
    unreadEl.textContent = athlete.unread > 9 ? '9+' : String(athlete.unread);

    /* A szál utolsó üzenete idézve: az edző így a kártyáról látja, hol tart a
       beszélgetés. Olvasatlan hátraléknál kiemelve. */
    const msgEl = $('.co-card-msg', card);
    msgEl.hidden = !athlete.lastMessage;
    if (athlete.lastMessage) {
      const who = athlete.lastMessage.mine ? 'Te' : athlete.name.split(' ')[0];
      msgEl.textContent = `${who}: ${athlete.lastMessage.text}`;
      msgEl.classList.toggle('co-card-msg--unread', athlete.unread > 0);
    }

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

  /** Egy meghívó-sor. A gombokat a hívó adja meg ({ label, action, variant }),
      mert a két irány mást kínál: a beérkezőt elfogadni/elutasítani lehet, a
      kiküldöttet visszavonni. A kattintást az Edző oldal delegálása kezeli. */
  function renderInviteRow({ linkId, name, username, goal }, actions) {
    const li = document.createElement('li');
    li.className = 'co-invite';

    const info = document.createElement('div');
    info.className = 'co-invite-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'co-invite-name';
    nameEl.textContent = name;
    const metaEl = document.createElement('span');
    metaEl.className = 'co-invite-meta';
    metaEl.textContent = goal ? `@${username} · ${goal}` : `@${username}`;
    info.append(nameEl, metaEl);

    const buttons = document.createElement('div');
    buttons.className = 'co-invite-actions';
    actions.forEach(({ label, action, variant }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `co-invite-btn${variant ? ` co-invite-btn--${variant}` : ''}`;
      button.dataset.inviteAction = action;
      button.dataset.linkId = linkId;
      button.textContent = label;
      buttons.appendChild(button);
    });

    li.append(info, buttons);
    return li;
  }

  /**
   * Egy felajánlott terv sora a sportoló oldalán. A meghívó-sorral azonos
   * alakú, de TÖBBET mond: a terv neve mellett ott a gyakorlatok száma és az
   * ütemezett napok is — a sportolónak látnia kell, MIT fogad el, mielőtt a
   * saját tervei közé kerül.
   */
  function renderPlanOffer(offer) {
    const li = document.createElement('li');
    li.className = 'co-invite';

    const info = document.createElement('div');
    info.className = 'co-invite-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'co-invite-name';
    nameEl.textContent = offer.name;

    const metaEl = document.createElement('span');
    metaEl.className = 'co-invite-meta';
    const days = (offer.days ?? []).map((day) => DAY_LABELS[day]).filter(Boolean);
    metaEl.textContent = [
      offer.from,
      `${offer.exercises.length} gyakorlat`,
      days.length ? days.join(', ') : null,
    ].filter(Boolean).join(' · ');
    info.append(nameEl, metaEl);

    // Az edző kísérő sora, ha írt ilyet — külön sorban, idézve
    if (offer.note) {
      const noteEl = document.createElement('span');
      noteEl.className = 'co-invite-note';
      noteEl.textContent = `„${offer.note}”`;
      info.appendChild(noteEl);
    }

    const buttons = document.createElement('div');
    buttons.className = 'co-invite-actions';
    [
      { label: 'Elfogadás', action: 'accept-offer', variant: 'primary' },
      { label: 'Elutasítás', action: 'decline-offer' },
    ].forEach(({ label, action, variant }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `co-invite-btn${variant ? ` co-invite-btn--${variant}` : ''}`;
      button.dataset.offerAction = action;
      button.dataset.offerId = offer.id;
      button.textContent = label;
      buttons.appendChild(button);
    });

    li.append(info, buttons);
    return li;
  }

  /** Állapot-sáv + kártya-rács feltöltése a lekért sportolókból. A payload a
      GET /api/athletes válasza: { athletes, invites }. */
  function renderCoachPanel({ athletes, invites }) {
    $('[data-athlete-count]').textContent = athletes.length;

    const banner = $('[data-banner]');
    const icon = $('.co-banner-icon', banner);
    const title = $('.co-banner-title', banner);
    const alertList = $('[data-list="alerts"]');
    const okText = $('.co-banner-ok-text', banner);
    const flagged = athletes.filter((athlete) => athlete.alert);

    // Sportoló nélkül nincs mit összegezni — a sáv és a rács helyett az
    // üres állapot magyarázza el, hogyan lesz sportolód.
    banner.hidden = athletes.length === 0;
    $('[data-athletes-empty]').hidden = athletes.length > 0;

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
        button.dataset.athlete = athlete.linkId;
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

    const sent = $('[data-list="sent-invites"]');
    sent.replaceChildren();
    invites.forEach((invite) => sent.appendChild(renderInviteRow(invite, [
      { label: 'Visszavonás', action: 'cancel-invite' },
    ])));
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

  /* ======================================================================
     Vonalkód-olvasó (sc-*)
     ----------------------------------------------------------------------
     Három szint, ebben a sorrendben:
       1. natív BarcodeDetector — nulla letöltés, a platform gyorsított
          dekódere. Androidon/ChromeOS-en elérhető;
       2. lustán betöltött ZXing UMD — asztali Chrome-on (Windows), Firefoxon
          és Safarin ez az egyetlen működő út;
       3. kézi beírás — NEM vészmegoldás, hanem egyenrangú út: sima http-n
          (a gép LAN-IP-jéről nézve) a böngésző a kamerát oda sem adja, és a
          szkennelés fizikailag is bukhat (karcos csomagolás, rossz fény).
     ====================================================================== */

  const ZXING_URL = '/vendor/zxing/index.min.js';
  // Élelmiszer-csomagoláson gyakorlatilag ezek fordulnak elő. A szűkítés nem
  // kozmetika: minden engedélyezett formátum külön dekódert futtat képkockánként.
  const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
  // ~8 kép/mp. A dekódolás CPU-igényes; 60 fps-en a ZXing úgysem végezne, a
  // telefon akkuja viszont elfogyna.
  const SCAN_INTERVAL_MS = 120;
  const SCAN_CANVAS_W = 640;

  /** A getUserMedia hibái emberi nyelven. A böngésző `err.name`-je pontos, de
      a felhasználónak semmit nem mond. */
  const CAMERA_ERRORS = {
    NotAllowedError: 'A kamerához nem adtál engedélyt. A böngésző címsorában visszavonhatod '
      + 'a tiltást — addig írd be a kódot kézzel.',
    SecurityError: 'A böngésző letiltotta a kamerát ezen az oldalon.',
    NotFoundError: 'Nem találtunk kamerát ezen az eszközön.',
    OverconstrainedError: 'Nem találtunk használható hátsó kamerát.',
    NotReadableError: 'A kamerát épp egy másik alkalmazás használja.',
  };

  /**
   * A vonalkód-olvasó modál vezérlője.
   *
   * @returns {{ scan: () => Promise<string|null> }}
   *   A `scan()` a beolvasott (nyers) vonalkóddal oldódik fel, vagy null-lal,
   *   ha a felhasználó megszakította. SOHA nem dob: a hibák a modálon belül,
   *   magyarul jelennek meg, és a kézi beírás mindig marad.
   */
  function setupScanner() {
    const modal = $('#scannerModal');
    const controller = createModalController(modal);
    const stage = $('[data-sc-stage]', modal);
    const video = $('[data-sc-video]', modal);
    const torchBtn = $('[data-sc-torch]', modal);
    const statusEl = $('[data-sc-status]', modal);
    const errorEl = $('[data-sc-error]', modal);
    const manualForm = $('[data-form="manual-barcode"]', modal);
    const manualInput = $('#sc-manual-code', modal);

    let pending = null;      // a futó scan() feloldója
    let stream = null;
    let rafId = 0;
    let canvas = null;
    let zxingReader = null;

    const setStatus = (text) => { statusEl.textContent = text; };
    const setError = (text) => {
      errorEl.textContent = text || '';
      errorEl.hidden = !text;
    };

    /* A legkritikusabb függvény az egész felületen. Track-stop nélkül a
       kamera-LED égve marad a modál bezárása után is (a felhasználó joggal
       hiszi, hogy figyeljük), és a KÖVETKEZŐ megnyitás NotReadableError-t kap,
       mert az eszköz még foglalt. Ezért MINDEN kilépési út ezen megy át. */
    const stopCamera = () => {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (zxingReader) { try { zxingReader.reset(); } catch { /* nincs mit tenni */ } }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
        stream = null;
      }
      video.srcObject = null;
      stage.hidden = true;
      torchBtn.hidden = true;
      torchBtn.setAttribute('aria-pressed', 'false');
    };

    /** Az ígéret lezárása EGYSZER, minden kilépési úton — előbb a kamera áll le. */
    const settle = (code) => {
      stopCamera();
      const resolve = pending;
      pending = null;
      controller.close();
      if (resolve) resolve(code ?? null);
    };

    // A modál saját záró-útjai (✕, háttér, Escape, hashchange) a controllerben
    // vannak; azok a `close`-t hívják, nem a settle-t — ezért itt is figyelünk,
    // különben a scan() ígérete örökre függőben maradna.
    $$('[data-close-modal]', modal).forEach((el) => el.addEventListener('click', () => settle(null)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('is-open')) settle(null);
    });
    window.addEventListener('hashchange', () => { if (pending) settle(null); });
    // Háttérbe került fül: a rAF magától megáll, a kamera-LED viszont nem.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && stream) stopCamera();
    });
    window.addEventListener('beforeunload', stopCamera);

    /** ZXing-alapú dekóder a canvas-képkockára. Csak akkor hívjuk, ha a
        natív BarcodeDetector nem használható. */
    const createZxingDetector = () => {
      const ZX = window.ZXing;
      if (!ZX?.MultiFormatReader) throw new Error('A ZXing dekóder nem érhető el.');

      const reader = new ZX.MultiFormatReader();
      const hints = new Map([
        [ZX.DecodeHintType.POSSIBLE_FORMATS, [
          ZX.BarcodeFormat.EAN_13, ZX.BarcodeFormat.EAN_8,
          ZX.BarcodeFormat.UPC_A, ZX.BarcodeFormat.UPC_E, ZX.BarcodeFormat.CODE_128,
        ]],
        // A csomagolás ritkán fekszik síkban a kamera előtt; a TRY_HARDER a
        // ferde és a gyengébb kontrasztú képet is megpróbálja.
        [ZX.DecodeHintType.TRY_HARDER, true],
      ]);
      reader.setHints(hints);
      zxingReader = reader;

      return (videoEl) => {
        if (!videoEl.videoWidth) return null;
        if (!canvas) canvas = document.createElement('canvas');
        // 640 px-re skálázunk: a dekódoláshoz bőven elég, és a nagyobb kép
        // képkockánként milliszekundumokat vinne el.
        const scale = SCAN_CANVAS_W / videoEl.videoWidth;
        canvas.width = SCAN_CANVAS_W;
        canvas.height = Math.round(videoEl.videoHeight * scale);
        canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);

        const source = new ZX.HTMLCanvasElementLuminanceSource(canvas);
        const bitmap = new ZX.BinaryBitmap(new ZX.HybridBinarizer(source));
        try {
          // decodeWithState: a setHints-szel beállított olvasókat újrahasználja
          // — folyamatos szkennelésnél ez a gyorsabb út.
          return reader.decodeWithState(bitmap).getText();
        } catch {
          // NotFoundException minden olyan képkockán, amin nincs kód — ez a
          // szkennelés NORMÁLIS állapota, nem hiba.
          return null;
        }
      };
    };

    /** A használható dekóder: natív, ha van, különben lustán betöltött ZXing. */
    const createDetector = async () => {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = SCAN_FORMATS.filter((format) => supported.includes(format));
          if (formats.length) {
            const detector = new window.BarcodeDetector({ formats });
            // A natív detect() közvetlenül a <video>-t is elfogadja — nem kell canvas.
            return async (videoEl) => (await detector.detect(videoEl))[0]?.rawValue ?? null;
          }
        } catch {
          // Van BarcodeDetector, de nem használható (pl. nincs mögötte platform-
          // támogatás) — essünk vissza a ZXingre, ne a kézi beírásra.
        }
      }
      await loadScript(ZXING_URL);
      return createZxingDetector();
    };

    /** Vaku — csak ott, ahol az eszköz tudja (jellemzően telefonok hátsó kamerája). */
    const setupTorch = (track) => {
      const capabilities = track.getCapabilities?.() ?? {};
      if (!('torch' in capabilities)) return;

      torchBtn.hidden = false;
      let torchOn = false;
      torchBtn.onclick = async () => {
        torchOn = !torchOn;
        try {
          await track.applyConstraints({ advanced: [{ torch: torchOn }] });
        } catch {
          // Néhány eszköz jelenti a képességet, de az alkalmazása mégis elbukik.
          torchOn = false;
        }
        torchBtn.setAttribute('aria-pressed', String(torchOn));
      };
    };

    const start = async () => {
      setError('');
      setStatus('Kamera indítása…');

      /* A getUserMedia CSAK biztonságos kontextusban él: https VAGY localhost.
         Sima http-n, a gép LAN-IP-jéről (telefonról a gépre) a böngésző NEM ad
         kamerát. Ezt ki kell mondani: enélkül „nem működik a szkenner"-ként
         jelentik, és nincs mit debugolni rajta. */
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setStatus('');
        setError('A kamera csak https-en vagy localhoston érhető el. Telefonról, a gép '
          + 'IP-címéről nyitva a böngésző letiltja — írd be a vonalkódot kézzel.');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (err) {
        setStatus('');
        setError(CAMERA_ERRORS[err.name] || 'A kamerát nem sikerült elindítani — írd be a kódot kézzel.');
        return;
      }

      video.srcObject = stream;
      stage.hidden = false;
      try {
        await video.play();
      } catch {
        // Az autoplay-tiltás ritka némított videónál, de nem végzetes: a
        // képkockák a detektáló ciklusban akkor is elérhetők lehetnek.
      }
      setupTorch(stream.getVideoTracks()[0]);

      let detect;
      try {
        setStatus('Dekóder betöltése…');
        detect = await createDetector();
      } catch {
        stopCamera();
        setStatus('');
        setError('A vonalkód-dekódert nem sikerült betölteni — írd be a kódot kézzel.');
        return;
      }
      setStatus('Irányítsd a kamerát a vonalkódra.');

      /* requestAnimationFrame, nem setInterval: a rAF magától megáll, ha a fül
         háttérbe kerül vagy a képernyő lezár — a setInterval a telefon akkuját
         égetné dekódolással egy fekete képkockán. */
      let lastRun = 0;
      let busy = false;
      let lastCode = null;
      const tick = async (now) => {
        rafId = requestAnimationFrame(tick);
        if (!stream || busy || now - lastRun < SCAN_INTERVAL_MS) return;
        lastRun = now;
        busy = true;
        try {
          const code = await detect(video);
          /* KÉT egymás utáni azonos leolvasás kell. Egyetlen képkocka
             félreolvasása így nem visz be rossz terméket — a mod-10 ellenőrző-
             szám sem fog ki minden hibán, és egy rossz étel csendben elrontaná
             a napi bevitelt. */
          if (code && code === lastCode) {
            navigator.vibrate?.(30);
            settle(code);
            return;
          }
          lastCode = code;
        } catch {
          // Képkockánkénti hiba: a következőn újrapróbáljuk.
        } finally {
          busy = false;
        }
      };
      rafId = requestAnimationFrame(tick);
    };

    // Kézi beírás — a validálást (hossz, ellenőrzőszám) a szerver végzi.
    manualForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = manualInput.value.trim();
      if (code) settle(code);
    });

    return {
      scan() {
        return new Promise((resolve) => {
          // Ha valamiért már fut egy szkennelés, azt megszakítjuk — két
          // párhuzamos kamera-stream sosem lenne jó.
          if (pending) settle(null);
          pending = resolve;
          manualInput.value = '';
          setError('');
          controller.open();
          start();
        });
      },
    };
  }

  /* ======================================================================
     Saját étel modál (cf-*)
     ----------------------------------------------------------------------
     A kalóriát a makrókból számoljuk (Atwater 4/4/9) és élőben mutatjuk, de a
     mező szerkeszthető: a csomagoláson lévő érték a rost, a poliolok és az
     alkohol miatt jogosan eltérhet a képlettől. A ↻ visszakapcsol automatikusra.
     ====================================================================== */

  const ATWATER = { protein: 4, carbs: 4, fat: 9 };

  /* Honnan jött az előre kitöltött tápérték — és mit érdemes tudni róla. A
     kulcsok a /api/foods/barcode válaszának `source` mezőjéhez igazodnak; ami
     nincs itt, az „manual", és nem ír ki semmit. */
  const SOURCE_NOTES = {
    openfoodfacts: 'Open Food Facts adat — vesd össze a csomagolással, mielőtt mentesz.',
    gyujto: 'A saját bolti gyűjtésünkből — vesd össze a csomagolással, mielőtt mentesz.',
  };

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

    /* A kategória-opciók az étel-listából jönnek, nem a FOOD_GROUPS kliens-
       oldali másolatából: így nincs két igazság, és a szerver FOOD_GROUPS-
       alapú validálásával sem csúszhat el. A saját ételek 'Saját étel'
       csoportja kimarad — az nem valódi kategória, csak megjelenítési alap. */
    const foods = await api.getFoods();
    const groups = [...new Set(foods.filter((f) => !f.custom).map((f) => f.group))]
      .filter(Boolean).sort((a, b) => a.localeCompare(b, 'hu'));
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

    const numberOf = (input) => {
      const value = Number(String(input.value).replace(',', '.'));
      return Number.isFinite(value) ? value : 0;
    };

    const computeKcal = () => Math.round(
      numberOf(proteinInput) * ATWATER.protein
      + numberOf(carbsInput) * ATWATER.carbs
      + numberOf(fatInput) * ATWATER.fat,
    );

    /** A kalória-mező és az állapotszöveg összehangolása a jelenlegi móddal. */
    const syncKcal = () => {
      const computed = computeKcal();
      // A programozott értékadás NEM vált ki `input` eseményt, tehát ez nem
      // billenti át kézi módba — nincs visszacsatolási hurok.
      if (kcalMode === 'auto') kcalInput.value = String(computed);
      kcalState.textContent = kcalMode === 'auto'
        ? 'a makrókból számolva'
        : `kézi érték · a képlet szerint ${computed} kcal`;
      kcalReset.hidden = kcalMode === 'auto';
      kcalInput.classList.toggle('is-manual', kcalMode === 'manual');
    };

    [proteinInput, carbsInput, fatInput].forEach((input) => {
      input.addEventListener('input', syncKcal);
    });
    kcalInput.addEventListener('input', () => { kcalMode = 'manual'; syncKcal(); });
    kcalReset.addEventListener('click', () => {
      kcalMode = 'auto';
      syncKcal();
      kcalInput.focus();
    });

    // Az egység a mezők jelentését változtatja meg (100 g vagy 100 ml) —
    // a legend ezt mondja ki, hogy ne legyen kétértelmű.
    const syncUnit = () => { basisEl.textContent = `100 ${unitSelect.value}`; };
    unitSelect.addEventListener('change', syncUnit);

    /** A modál megnyitása, opcionálisan előre kitöltve (vonalkódról). */
    const open = (prefill = null) => {
      form.reset();
      kcalMode = 'auto';
      prefillSource = SOURCE_NOTES[prefill?.source] ? prefill.source : 'manual';
      setError('');

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
        if (labelKcal !== null && labelKcal !== undefined && Math.round(labelKcal) !== computeKcal()) {
          kcalMode = 'manual';
          kcalInput.value = String(Math.round(labelKcal));
        }
      }

      sourceEl.textContent = SOURCE_NOTES[prefillSource] ?? '';
      sourceEl.hidden = !sourceEl.textContent;

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
        // A `source` a válaszból jön, nem beégetve: a begyűjtött bolti termék
        // (source: 'local') MÁS eredetű, mint az Open Food Facts adata, és a
        // modál is mást ír ki róla.
        open({ ...hit.product, source: hit.source === 'local' ? 'gyujto' : 'openfoodfacts' });
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
      saveButtons.forEach((button) => { button.disabled = true; });
      try {
        const saved = await api.addCustomFood({
          name: nameInput.value,
          group: groupSelect.value,
          unit: unitSelect.value,
          protein: numberOf(proteinInput),
          carbs: numberOf(carbsInput),
          fat: numberOf(fatInput),
          kcal: numberOf(kcalInput),
          kcalMode,
          barcode: barcodeInput.value.trim() || undefined,
          source: prefillSource,
        });
        await onSaved?.(saved);
        controller.close();
        showToast(`${saved.name} felvéve a saját ételeid közé`);
        // Az adagválasztó CSAK a záró animáció után nyíljon, különben egy
        // pillanatra két modál látszana egymáson.
        if (thenLog) requestAnimationFrame(() => onLog?.(saved));
      } catch (err) {
        // A szerver üzenete (409 duplikátum, 400 validálás) magyarul, az
        // űrlapon marad — a bevitt adat NEM vész el.
        if (err.code !== SESSION_LOST) setError(err.message || 'Nem sikerült menteni az ételt');
      } finally {
        saveButtons.forEach((button) => { button.disabled = false; });
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

  /** Beállítások modal: profilnév, értesítés-kapcsolók, edzés-cél, adat-export.
      A név és az értesítés-kapcsolók a prefs-be (localStorage) mentődnek; az
      edzés-cél viszont a FIÓKÉ (szerver), mert az edződ is azt látja a
      kártyádon. Az onNotifCatsChange az értesítés-jelvényt frissíti élőben,
      ha egy kapcsoló átbillen.

      A korábbi szerepkör-kapcsolók („Van edződ" / „Edzel másokat") innen
      kikerültek: a szerepkör már nem demo-kapcsoló, hanem valódi kapcsolatból
      következik — az Edző oldalon lehet meghívni és elfogadni. */
  async function setupSettingsModal({ onNotifCatsChange, confirmAction } = {}) {
    const modal = $('#settingsModal');
    const controller = createModalController(modal);
    const nameInput = $('#st-display-name');
    const usernameEl = $('.db-username');
    const toggleList = $('[data-list="settings-toggles"]');
    const goalSelect = $('#st-goal');

    // A fiók adatai (név-tartalék, aktuális edzés-cél) — egyszer lekérve
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

    /* Edzés-cél: a lista a szerverről jön (data.js → goals), hogy a címke és a
       felirat egy helyen éljen. Az üres érték a „nincs megadva" — ilyenkor az
       edzői kártyán „—" áll, nem egy kitalált cél. */
    const goals = await api.getGoals();
    goalSelect.replaceChildren(new Option('Nincs megadva', ''));
    goals.forEach(({ key, tag, label }) => {
      goalSelect.appendChild(new Option(`${label} · ${tag}`, key));
    });
    goalSelect.value = user.goal ?? '';

    // Azonnal mentődik (mint a többi beállítás). Hibánál visszaáll a mentett
    // értékre, hogy a legördülő ne mutasson mást, mint ami a szerveren van.
    goalSelect.addEventListener('change', async () => {
      try {
        const updated = await api.saveGoal(goalSelect.value);
        user.goal = updated.goal;
        await api.refreshUser();
        showToast('Edzés-cél mentve');
      } catch (err) {
        goalSelect.value = user.goal ?? '';
        showToast(err.message || 'Az edzés-célt nem sikerült menteni', 'error');
      }
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
       tartalmazzák, azokat nem szabad a következő belépésbe átvinni.
       MINDEN kilépő gomb: ez a modalban és a profiloldalon is ott van, a $
       (első találat) az egyiket némán kihagyta volna. */
    /* ---- Fiók-műveletek: jelszóváltoztatás és fióktörlés ----
       Mindkettő a JELENLEGI jelszót is kéri (a munkamenet önmagában nem elég),
       ezért nyílik hozzájuk külön űrlap. A hibát a szerver mondja meg, azt
       írjuk ki az űrlap alá — nem toastban, mert ott a mező mellett kell
       látszania, amihez tartozik. */
    const accountForms = {
      password: { form: $('[data-form="change-password"]', modal), error: $('[data-password-error]', modal) },
      delete: { form: $('[data-form="delete-account"]', modal), error: $('[data-delete-error]', modal) },
    };

    /** Egy fiók-űrlap nyitása/zárása. Nyitáskor a másik bezárul: a kettő
        egymás mellett csak összezavarná, melyik jelszó melyikhez tartozik. */
    const openAccountForm = (which, open) => {
      Object.entries(accountForms).forEach(([key, { form, error }]) => {
        const show = key === which && open;
        form.hidden = !show;
        if (!show) {
          form.reset();
          error.hidden = true;
        }
        const trigger = $(`[data-action="toggle-${key}"]`, modal);
        trigger.setAttribute('aria-expanded', String(show));
      });
      if (open) $('input', accountForms[which].form).focus();
    };

    /** Mindkét űrlap bezárása (a modál megnyitásakor és sikeres művelet után).
        Nem csak rendrakás: a begépelt jelszó nem maradhat ott a mezőben egy
        bezárt-újranyitott ablak után. */
    const closeAccountForms = () => openAccountForm(null, false);

    const showFormError = (target, message) => {
      target.textContent = message;
      target.hidden = !message;
    };

    $('[data-action="toggle-password"]', modal).addEventListener('click', () => {
      openAccountForm('password', accountForms.password.form.hidden);
    });
    $('[data-action="toggle-delete"]', modal).addEventListener('click', () => {
      openAccountForm('delete', accountForms.delete.form.hidden);
    });

    accountForms.password.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const current = $('#st-password-current').value;
      const next = $('#st-password-new').value;
      showFormError(accountForms.password.error, '');
      try {
        await api.changePassword(current, next);
        closeAccountForms();
        showToast('Jelszó megváltoztatva');
      } catch (err) {
        showFormError(accountForms.password.error, err.message || 'A jelszót nem sikerült megváltoztatni');
      }
    });

    accountForms.delete.form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = $('#st-delete-password').value;
      showFormError(accountForms.delete.error, '');

      /* A jelszó megerősítésnek is számít, de a törlés visszafordíthatatlan —
         ezért kérdezünk rá külön is, ugyanazzal az ablakkal, amivel minden
         más adatvesztés előtt. */
      const confirmed = await confirmAction(
        'A fiókod és MINDEN adatod véglegesen törlődik. Ez nem vonható vissza.',
        { title: 'Fiók törlése', confirmLabel: 'Törlés' },
      );
      if (!confirmed) return;

      try {
        await api.deleteAccount(password);
        window.location.reload(); // a belépő képernyőre esünk vissza
      } catch (err) {
        showFormError(accountForms.delete.error, err.message || 'A fiókot nem sikerült törölni');
      }
    });

    $$('[data-action="logout"]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.logout();
        } catch (err) {
          console.error('Kijelentkezési hiba:', err);
        }
        window.location.reload();
      });
    });

    return {
      open() {
        nameInput.value = prefs.get('displayName', '') || '';
        nameInput.placeholder = user.name;
        $('[data-st-account]').textContent = `Bejelentkezve: ${user.username ?? user.name}`;
        closeAccountForms();
        syncToggles();
        // Az edzés-cél a szerveren él: a modál megnyitásakor a legutóbb
        // mentett értékre állunk vissza (a fiók adata a betöltéskor kelt).
        goalSelect.value = user.goal ?? '';
        controller.open();
      },
    };
  }

  /**
   * Értesítés-panel: az avatarra nyílik. A tartalma VALÓDI eseményekből jön
   * (GET /api/notifications), tehát magától is változik — a panel minden
   * megnyitásakor frisset kérünk.
   *
   * Az „olvasott" állapot egy LÁTOTT-IDŐPONT (prefs → notifSeenAt), nem egy
   * mindent elrejtő kapcsoló. Korábban a „mind olvasott" kiürítette a panelt,
   * és onnantól a valódi tartalom sem látszott volna benne. Most a sorok
   * maradnak, csak az újdonságot jelző pötty tűnik el róluk, és a jelvény
   * ennél frissebb eseményeket számol.
   */
  async function setupNotifications() {
    const button = $('[data-action="notifications"]');
    const panel = $('[data-notif-panel]');
    const badge = $('[data-notif-badge]');
    const list = $('[data-list="notifications"]');
    const emptyState = $('.notif-empty', panel);

    /* A legutóbbi „mind olvasott" időpontja ISO-8601-ben. Üresen minden
       értesítés újnak számít — ez az első indulás helyes viselkedése. */
    let seenAt = prefs.get('notifSeenAt', '');
    let notifications = [];

    const isNew = (notif) => !seenAt || notif.at > seenAt;
    const visible = () => {
      const mutedCats = prefs.get('notifCats', {}); // a beállítások modal kapcsolói
      return notifications.filter((notif) => !mutedCats[notif.cat]);
    };

    /** Friss lekérés. A hiba némán elhal: a panel a korábbi tartalmat mutatja,
        és a következő megnyitás újrapróbálja — egy pillanatnyi hálózati hiba
        miatt nem villoghat üresre a lista. */
    async function load() {
      try {
        notifications = await api.getNotifications();
      } catch (err) {
        console.error('Értesítések betöltési hiba:', err);
      }
    }

    const updateBadge = (pop = false) => {
      // A némított kategóriák nem számítanak bele az "új" darabszámba
      const count = visible().filter(isNew).length;
      badge.hidden = count === 0;
      badge.textContent = String(count);
      badge.setAttribute('aria-label', `${count} új értesítés`);
      if (pop && !prefersReducedMotion) {
        badge.classList.remove('is-pop');
        void badge.offsetWidth; // szándékos reflow: az animáció újraindításához
        badge.classList.add('is-pop');
      }
    };

    /* A némított kategória sorai bent maradnak, csak halványan: a kapcsoló azt
       mondja ki, hogy „ne szóljon", nem azt, hogy „ne is lássam". A pötty
       viszont csak a látott-időpontnál frissebb sorokon marad. */
    const renderList = () => {
      list.replaceChildren();
      const mutedCats = prefs.get('notifCats', {});
      emptyState.hidden = notifications.length > 0;

      notifications.forEach((notif, index) => {
        const li = document.createElement('li');
        li.className = 'notif-item';
        if (mutedCats[notif.cat]) li.classList.add('notif-item--muted');
        if (!isNew(notif)) li.classList.add('notif-item--seen');
        li.style.setProperty('--i', index);

        const dot = document.createElement('span');
        dot.className = 'notif-dot';

        const body = document.createElement('div');
        const text = document.createElement('span');
        text.textContent = notif.text;
        const time = document.createElement('span');
        time.className = 'notif-time';
        // A szerver ISO-időbélyeget küld — a „mikor" a böngésző zónájában áll elő
        time.textContent = relativeTime(notif.at);
        body.append(text, time);

        li.append(dot, body);
        list.appendChild(li);
      });
    };

    const setOpen = async (open) => {
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (!open) return;
      renderList();      // előbb a meglévő tartalom, hogy ne legyen üres pillanat
      await load();      // majd a friss lista
      if (panel.hidden) return; // időközben becsukták
      renderList();
      updateBadge();
    };

    button.addEventListener('click', () => setOpen(panel.hidden));

    /* „Mind olvasott": a látott-időpontot a LEGFRISSEBB értesítésre állítjuk,
       nem a mostani órára. Így egy időközben (a panel nyitva léte alatt)
       beérkező, még le nem kért esemény sem tűnik el olvasottként. */
    $('[data-action="clear-notifications"]').addEventListener('click', () => {
      const newest = notifications[0]?.at;
      if (!newest) return;
      seenAt = newest;
      prefs.set('notifSeenAt', seenAt);
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

    await load();
    updateBadge(true); // betöltéskor egy finom "pop" hívja fel a figyelmet a badge-re

    return { updateBadge };
  }

  function setupDashboard(settingsModal) {
    /* MINDEN beállítás-gomb, nem csak az első: a fogaskerék az áttekintőn és a
       „Beállítások" a profiloldalon is ide fut. A $ (első találat) itt némán
       kihagyta volna a másikat.
       A settingsModal null lehet, ha a betöltése hibázott — a gomb ilyenkor inaktív. */
    $$('[data-action="settings"]').forEach((btn) => {
      btn.addEventListener('click', () => settingsModal?.open());
    });
    $('[data-action="open-workout"]').addEventListener('click', () => navigate('workout'));
    // Az avatar+név gomb: korábban az értesítés-panelt nyitotta, most a profil
    // oldalra visz (az értesítéseknek saját harang gombjuk van mellette).
    $('[data-action="profile"]').addEventListener('click', () => navigate('profile'));
  }

  /* ---- Profiloldal (pf-*) ----
     Csak megjelenít: a fiók adatai és a naplózott edzésekből számolt
     összesítők. Az egyetlen szerkeszthető mező (a megjelenített név) a
     beállítások modalban maradt, ide csak egy gomb vezet. */

  /** Egész számokhoz — a formatNumber egy tizedesig kerekít, ami a felpörgetés
      közben tört értékeket villantana fel a darabszámoknál. */
  const formatWhole = (value) => String(Math.round(value));

  async function setupProfile() {
    const page = $('[data-page="profile"]');
    const factList = $('.pf-fact-list', page);
    const emptyEl = $('[data-pf-empty]', page);

    /** Egy részletsor beállítása; érték nélkül a sor rejtve marad. */
    const setFact = (key, text) => {
      const row = $(`[data-pf-fact="${key}"]`, page);
      if (!row) return;
      row.hidden = text === null;
      if (text !== null) $(`[data-pf-value="${key}"]`, page).textContent = text;
    };

    refreshProfile = async () => {
      const profile = await api.getProfile();
      const { stats } = profile;

      // A megjelenített név ugyanaz, mint az áttekintőn: a saját (localStorage)
      // név elsőbbséget élvez a szerver szerinti névvel szemben.
      $('[data-pf-name]', page).textContent = prefs.get('displayName', profile.name);
      $('[data-pf-username]', page).textContent = `@${profile.username}`;

      const joinedEl = $('[data-pf-joined]', page);
      joinedEl.hidden = !profile.joinedAt;
      if (profile.joinedAt) joinedEl.textContent = `Tag ${profile.joinedAt} óta`;

      [['workouts', stats.workouts], ['streak', stats.streak],
        ['prs', stats.prs], ['workSets', stats.workSets]].forEach(([key, value]) => {
        animateNumber($(`[data-pf-stat="${key}"]`, page), value, { from: 0, format: formatWhole });
      });

      setFact('firstWorkout', stats.firstWorkoutDate);
      setFact('lastWorkout', stats.lastWorkoutDate);
      setFact('weight', stats.weight ? `${formatNumber(stats.weight.current)} kg` : null);
      // A delta csak több mérésből értelmes — egyetlen bejegyzésnél a szerver
      // null-t ad, és a sor kimarad.
      setFact('weightDelta', stats.weight?.delta === null || stats.weight === null
        ? null
        : `${formatDelta(stats.weight.delta)} kg`);

      // Ha egyetlen részletsor sincs, a lista helyett a magyarázó szöveg áll ott
      const anyFact = $$('.pf-fact', page).some((row) => !row.hidden);
      factList.hidden = !anyFact;
      emptyEl.hidden = anyFact;
    };

    /* A setupRouter MÁR lefutott, amikor ide érünk. Ha az app épp a
       profiloldalon nyílt (a lastPage visszaállította), a pageEffects akkor
       még null refreshProfile-t talált — az oldal üres számokkal maradt volna
       az első oldalváltásig. Minden más induláskor nincs kérés: az oldal a
       megnyitásakor tölt. */
    if (currentPage() === 'profile') await refreshProfile();
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
  /* A varázsló korábban 12 óránál elvágta az alvást, a részletes űrlap és a
     szerver viszont 24-ig fogad el. Az eltérés némán csonkította a bevitelt
     (betegség, bepótolt alvás után 13 órából 12 lett), ezért a varázsló is
     0–24-gyel fut. */
  const CI_SLEEP_MAX = 24;

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
      return step;
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

    /* Melyik MENTETT edzést javítjuk épp (null = új edzés). A piszkozattal
       együtt utazik, tehát újratöltés után is megmarad — enélkül a befejezés
       új, mai edzést hozna létre a javítás helyett. */
    let currentWorkoutId = null;
    let currentWorkoutDate = '';

    const editingBar = $('[data-editing-workout]');
    const editingText = $('[data-editing-text]', editingBar);
    const finishLabel = $('[data-action="finish-workout"] span');
    const FINISH_TEXT = finishLabel.textContent;

    /** A szerkesztés-sáv és a befejező gomb felirata a jelen állapothoz.
        A gomb szövege is változik: „Edzés befejezése" azt ígérné, hogy új sor
        keletkezik a naplóban — javításkor viszont a meglévő sor frissül. */
    const syncEditingState = () => {
      const editing = currentWorkoutId !== null;
      editingBar.hidden = !editing;
      if (editing) {
        // A dátum a mentett edzésekből oldódik fel, és ez eggyel későbbi kérés:
        // amíg nincs meg, dátum nélkül is értelmes mondatot írunk ki.
        editingText.textContent = currentWorkoutDate
          ? `A(z) ${currentWorkoutDate} napi edzésedet javítod — a mentés a meglévő sort frissíti, nem hoz létre újat.`
          : 'Egy korábbi edzésedet javítod — a mentés a meglévő sort frissíti, nem hoz létre újat.';
      }
      finishLabel.textContent = editing ? 'Módosítások mentése' : FINISH_TEXT;
    };

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
    /** Felső korlát a debounce halogatására. A debounce minden változtatásnál
        újraindul, tehát folyamatos gépelésnél (500 ms-nál sűrűbb leütéseknél)
        magától sosem sülne el — az ELSŐ függő változtatástól számítva ennyi idő
        után mindenképp mentünk. */
    const AUTOSAVE_MAX_WAIT_MS = 5000;
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
    /** Az első még el nem mentett változtatás időpontja — ehhez mérjük a
        max-waitet. null, ha nincs függő mentés. */
    let pendingSince = null;
    /** Az utoljára SIKERESEN elküldött törzs sorosítva. Ha a mentés pillanatában
        ugyanez jönne ki, a kérés kimarad: a debounce akkor is elsül, ha az
        állapot közben visszaállt (beírsz egy értéket, majd visszaírod az
        eredetit; vagy a szett-típus oda-vissza váltása). */
    let lastSentBody = null;
    /** Fut-e épp mentés. Egyszerre csak egy: a párhuzamos kérések feldolgozási
        sorrendje nem garantált, és egy későn beérkező válasz elavult állapotot
        rögzítene a lastSentBody-ba — utána a valódi változás maradna ki. */
    let inFlight = false;

    /** A piszkozat-végpont törzse a DOM aktuális állapotából. Egy helyen áll,
        mert a debounce-olt mentés és a lapelrejtéskori keepalive-kérés
        ugyanazt küldi — és így az összehasonlításuk is azonos alakú. */
    const buildDraftBody = () => ({
      name: titleInput.value.trim(),
      exercises: readCurrentWorkout(),
      planId: currentPlanId,
      workoutId: currentWorkoutId,
    });

    const flush = async () => {
      autosaveTimer = null;
      retryTimer = null; // ha újrapróbálkozásból futunk, az az időzítő már elsült

      // Fut egy mentés → megvárjuk. A pendingSince ilyenkor SZÁNDÉKOSAN marad:
      // a max-wait határideje az első változtatástól ketyeg tovább.
      if (inFlight) {
        autosaveTimer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
        return;
      }
      pendingSince = null;

      const body = buildDraftBody();
      const serialized = JSON.stringify(body);
      if (serialized === lastSentBody) {
        // Nincs mit menteni. Ha épp hibaállapot látszik, az ilyenkor félrevezető:
        // a szerveren pontosan ez az állapot van, csak azóta jutottunk vissza ide.
        if (statusEl.dataset.state === 'error') setStatus('saved', `Mentve · ${clockNow()}`);
        return;
      }

      setStatus('saving', 'Mentés…');
      inFlight = true;
      try {
        await api.saveWorkoutDraft(body.name, body.exercises, body.planId, body.workoutId);
        lastSentBody = serialized;
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
      } finally {
        inFlight = false;
      }
    };

    const autosave = () => {
      // Bármilyen változtatás után újra él az edzés: az összegző megint az
      // aktuális naplóállapotot mutassa, ne a legutóbbi lezárás pillanatképét.
      setLastSummary(null);
      // Új változtatás → a hibás kör újraindul az elejéről
      clearTimeout(retryTimer);
      retryTimer = null;
      retryStep = 0;

      // Az első függő változtatás indítja a max-wait óráját; a továbbiak már
      // csak a debounce-t tolják, a határidőt nem.
      if (pendingSince === null) pendingSince = Date.now();
      const untilDeadline = pendingSince + AUTOSAVE_MAX_WAIT_MS - Date.now();
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(flush, Math.max(0, Math.min(AUTOSAVE_DEBOUNCE_MS, untilDeadline)));
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
      pendingSince = null;
      inFlight = false;
      // A piszkozat törlődik (az edzés lezárult), tehát az „ezt már elküldtük"
      // emlék is érvénytelen: a következő edzés első mentése akkor is menjen ki,
      // ha véletlenül pont ugyanaz a szerkezet.
      lastSentBody = null;
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
      pendingSince = null;
      const serialized = JSON.stringify(buildDraftBody());
      // Ugyanaz, mint ami már kint van → nincs kérés. A lastSentBody-t viszont
      // NEM írjuk át a küldéskor: a keepalive-kérés eredményét nem látjuk, és
      // egy sikeresnek hitt, valójában elveszett mentés rosszabb, mint egy
      // fölösleges ismétlés a visszatérés utáni első változtatáskor.
      if (serialized === lastSentBody) return;
      fetch('/api/workout-draft', {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
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
      currentWorkoutId = template.workoutId ?? null;
      titleInput.value = template.name;
      list.replaceChildren();
      template.exercises.forEach((exercise) => {
        list.appendChild(renderExercise(exercise, exerciseOptions));
      });
      refreshExerciseList(list);
      if (template.source === 'plan') showToast(`Mai terv betöltve: ${template.name}`);
      syncEmpty();
      // Minden template-betöltés után: a napváltáskori csere is ide fut be, és
      // ott a javítás-állapot is megszűnhet (ha a mai terv veszi át a helyét).
      syncEditingState();
      // Az összes PR jelzés frissítése az új template után
      refreshAllPrIndicators();
    };

    // Az induló tartalom a szervertől: aznapi piszkozat, vagy — új napon —
    // a mai hétnapra ütemezett terv. Ha nincs egyik sem, a napló üres, és az
    // üres állapot hívja a Tervek oldalt / a gyakorlat-hozzáadást.
    applyTemplate(await api.getWorkoutTemplate());
    syncEmpty();

    /* A visszanyitott edzés DÁTUMA nem utazik a piszkozattal — a sávhoz viszont
       kell, ezért a mentett edzésekből oldjuk fel. Ha az edzés időközben
       eltűnt (másik lapon törölték), a javítás tárgytalan: a tartalom marad, de
       új edzésként mentődik — ez ugyanaz a viselkedés, amit a szerver is választ
       a törléskor (deleteWorkout → a piszkozat workout_id-ja NULL-ra vált). */
    if (currentWorkoutId !== null) {
      const saved = await api.getWorkouts();
      currentWorkoutDate = saved.find((workout) => workout.id === currentWorkoutId)?.date ?? '';
      if (!currentWorkoutDate) currentWorkoutId = null;
    }
    syncEditingState();

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

    /** A napló kiürítése és a piszkozat elengedése — az edzés lezárása és a
        javítás is ezzel zárul, ugyanabban a sorrendben (előbb a függő mentést
        állítjuk le, különben visszaírná a most törölt piszkozatot). */
    const clearEditor = async () => {
      cancelAutosave();
      await api.clearWorkoutDraft().catch((err) => {
        console.error('A piszkozat törlése sikertelen:', err);
      });
      list.replaceChildren();
      titleInput.value = '';
      currentPlanId = null;
      currentWorkoutId = null;
      currentWorkoutDate = '';
      prefs.set(WORKOUT_START_KEY, null); // az edzés-óra a következő első pipával indul
      syncEmpty();
      syncEditingState();
    };

    /** Amit egy napló-változás (törlés vagy javítás) után frissíteni kell.
        Ugyanaz a négy felület, ami az edzés lezárásakor is — plusz az
        exerciseMaxes: a szerver a csúcsokat is újraszámolta, és a szerkesztő
        élő PR-jelzése ebből a térképből dolgozik. Elavult másolattal a
        következő edzésnél hamis (vagy elmaradt) PR-jelvényt mutatna. */
    const refreshAfterWorkoutChange = async () => {
      exerciseMaxes = await api.getExerciseMaxes();
      refreshAllPrIndicators();
      renderPrs().catch(console.error);
      refreshVolumeChart?.().catch(console.error);
      renderDashboard().catch(console.error);
      refreshRecovery?.().catch(console.error);
    };

    /** A javítás mentése: a MEGLÉVŐ edzés felülírása a saját dátumán. A lista
        sorát a helyén cseréljük — a lista elejére szúrás azt hazudná, hogy ez
        a legfrissebb edzés. */
    const finishEdit = async () => {
      const updated = await api.updateWorkout(
        currentWorkoutId, titleInput.value.trim(), readCurrentWorkout(),
      );
      const row = $(`[data-list="history"] [data-workout-id="${updated.id}"]`);
      row?.replaceWith(historyEntryEl(workoutHistoryEntry(updated)));

      await clearEditor();
      await refreshAfterWorkoutChange();
      showToast('Az edzés módosításai mentve');
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
        /* Javítás alatt álló edzésnél NEM új sor keletkezik: a meglévőt írjuk
           felül, a saját dátumán. Az összegző ilyenkor kimarad — az egy most
           befejezett edzést ünnepelne, közben egy régit javítottunk. */
        if (currentWorkoutId !== null) {
          await finishEdit();
          return;
        }

        // Az összegző értékeit még a kiürítés előtt rögzítjük
        const summary = summarizeWorkout();
        const saved = await api.saveWorkout(titleInput.value.trim(), readCurrentWorkout(), currentPlanId);

        // A függő automatikus mentés leállítása (különben visszaírná a most
        // törölt piszkozatot) és a napló kiürítése — programozott változás,
        // tehát nem indít újabb automatikus mentést.
        await clearEditor();
        setLastSummary(summary);

        // A naplózott edzés azonnal megjelenik a „Korábbi edzések" tetején,
        // a PR-lista, a heti volumen és az áttekintő számai is frissülnek.
        // A friss edzés a készenlét-becslésbe is azonnal beépül (izomcsoportok,
        // CNS, gyakorlat-ajánlások) — nem kell megvárni a következő betöltést.
        const history = $('[data-list="history"]');
        history.insertBefore(historyEntryEl(workoutHistoryEntry(saved)), history.firstChild);
        syncHistoryEmpty();
        await refreshAfterWorkoutChange();
        showToast('Edzés befejezve és naplózva');
        navigate('summary');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült menteni az edzést', 'error');
      } finally {
        finishBtn.disabled = false;
      }
    });

    /** Hány teljesített szett van most a naplóban — a felülíró műveletek
        (terv betöltése, edzés visszanyitása) ez alapján kérdeznek rá. */
    const doneSetCount = () => $$('.wk-set-check', page)
      .filter((check) => check.getAttribute('aria-pressed') === 'true').length;

    /** Mentett edzés visszanyitása javításra: a tartalma a szerkesztőbe kerül,
        és a befejezés majd a MEGLÉVŐ sort frissíti. */
    const reopenWorkout = async (workout) => {
      const doneSets = doneSetCount();
      if (doneSets > 0) {
        const ok = await confirmAction(
          `A megkezdett edzésedben ${doneSets} teljesített szett van. A(z) ${workout.date} napi edzés javításra nyitása ezeket felülírja.`,
          { title: 'Felülírod a megkezdett edzést?', confirmLabel: 'Javítás megnyitása' },
        );
        if (!ok) return;
      }

      currentPlanId = workout.planId ?? null;
      currentWorkoutId = workout.id;
      currentWorkoutDate = workout.date;
      titleInput.value = workout.name;
      titleInput.classList.remove('has-error');
      titleError.hidden = true;
      list.replaceChildren();
      workout.exercises.forEach((exercise) => {
        list.appendChild(renderExercise(exercise, exerciseOptions));
      });
      refreshExerciseList(list);
      syncEmpty();
      syncEditingState();
      refreshAllPrIndicators();
      /* Az edzés-óra nullázódik: a megkezdett edzés helyére egy RÉGI edzés
         került, tehát a korábbi indulási időhöz már nincs mit mérni. */
      prefs.set(WORKOUT_START_KEY, null);
      autosave();
      navigate('workout');
      showToast(`A(z) ${workout.date} napi edzés javításra megnyitva`);
    };

    /* A „Korábbi edzések" sorainak műveletei. Delegálva, a táplálkozás-napló
       mintájára: a lista teljesen újrarajzolódik, egyedi kezelők nem élnék túl. */
    $('[data-list="history"]').addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('[data-workout-id]');
      const id = Number(row?.dataset.workoutId);
      if (!Number.isInteger(id)) return;

      /* A teljes lista lekérése egy kattintásra: a szerkesztőnek a gyakorlat-
         lista is kell (a sorban csak a szett-szám látszik), és így egyben
         friss is — ha az edzést közben egy másik lapon törölték, azt itt
         tudjuk meg, nem a mentésnél. */
      const workout = (await api.getWorkouts()).find((entry) => entry.id === id);
      if (!workout) {
        row.remove();
        syncHistoryEmpty();
        showToast('Ez az edzés már nem létezik', 'error');
        return;
      }

      if (btn.dataset.action === 'reopen-workout') {
        await reopenWorkout(workout);
        return;
      }

      const ok = await confirmAction(
        `A(z) ${workout.date} napi „${workout.name}” edzés véglegesen törlődik. Ha egyéni csúcsot hozott, a rekord a következő legjobb edzésedre áll vissza.`,
        { title: 'Törlöd az edzést?', confirmLabel: 'Törlés' },
      );
      if (!ok) return;

      try {
        await api.deleteWorkout(id);
        row.remove();
        syncHistoryEmpty();
        /* Ha épp ezt az edzést javítottuk, a javítás tárgytalan — a szerver a
           piszkozat hivatkozását is elengedte, tehát a szerkesztő tartalma
           marad, de innentől új edzésként mentődik. */
        if (currentWorkoutId === id) {
          currentWorkoutId = null;
          currentWorkoutDate = '';
          syncEditingState();
          autosave();
        }
        await refreshAfterWorkoutChange();
        showToast('Edzés törölve');
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült törölni az edzést', 'error');
      }
    });

    /* A javítás megszakítása. Az EREDETI edzés érintetlen marad — csak a
       szerkesztőben álló, még el nem mentett módosítások vesznek el, ezért
       nem kérdezünk rá külön. */
    $('[data-action="cancel-workout-edit"]').addEventListener('click', async () => {
      await clearEditor();
      showToast('Szerkesztés megszakítva — az edzés változatlan');
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
      const doneSets = doneSetCount();
      if (doneSets > 0) {
        const ok = await confirmAction(
          `A megkezdett edzésedben ${doneSets} teljesített szett van. A(z) „${plan.name}” betöltése ezeket felülírja.`,
          { title: 'Felülírod a megkezdett edzést?', confirmLabel: 'Terv betöltése' },
        );
        if (!ok) return false;
      }

      currentPlanId = plan.id ?? null;
      // A terv betöltése ÚJ edzést kezd: ha épp egy régit javítottunk, az a
      // szál itt lezárul — különben a terv tartalma írná felül a mentett edzést.
      currentWorkoutId = null;
      currentWorkoutDate = '';
      syncEditingState();
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

    return { loadPlan };
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

    // Hétnap-chipek (0 = hétfő) — a kijelölt napokon a terv az Edzés oldalra töltődik
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
    // `let`, nem `const`: saját étel felvitele/törlése után újratöltjük.
    let foods = await api.getFoods();
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

    /* Az élő szűrés önálló függvényben: a lista újraépítése után (saját étel
       felvitele/törlése) újra érvényre kell juttatni, különben a beírt keresés
       némán feloldódna, és a felhasználó hirtelen mind a 437 ételt látná. */
    const applyFilter = () => {
      const query = searchInput.value.trim().toLowerCase();
      let visibleCount = 0;
      $$('.nu-food').forEach((item) => {
        const matches = item.dataset.foodName.includes(query);
        item.hidden = !matches;
        if (matches) visibleCount += 1;
      });
      emptyState.hidden = visibleCount > 0;
    };
    searchInput.addEventListener('input', applyFilter);

    /* Az étel-lista újratöltése saját étel felvitele/törlése után. A kliens-
       oldali cache-t EL KELL DOBNI (api.refreshFoods), különben a lista a
       munkamenet végéig a betöltéskori állapotot mutatná — a /api/charts már
       ugyanezt a mintát követi. Egyetlen hálózati kör: a friss válasz a cache-be
       kerül, a renderFoods pedig már a memóriabeli tömböt kapja meg. */
    const refreshFoods = async () => {
      foods = await api.refreshFoods();
      await renderFoods(foods);
      applyFilter();
    };

    /** Az adagválasztó megnyitása egy ételre — a napi összesítővel és a mai,
        EBBŐL az ételből származó bejegyzésekkel. A lista nyila és a saját étel
        „Mentés és naplózás" gombja is ezt hívja. */
    const openFoodDetail = (food) => {
      if (!foodDetail) return false;
      foodDetail.open(food, {
        totals,
        entries: logEntries.filter((entry) => entry.name === food.name),
      });
      return true;
    };

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

      if (openFoodDetail(food)) return;

      try {
        await logFood(food, 100);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'Nem sikerült hozzáadni az ételt', 'error');
      }
    });

    return { logFood, refreshFoods, openFoodDetail };
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

  /** Relatív idő az üzenet ISO-8601 időbélyegéből. Az üzenetek percre pontos
      ideje nem érdekes, a „mikor" viszont igen — a hét fölött ezért dátumra
      vált. (A szerver UTC-t küld, a Date a böngésző zónájában értelmezi.) */
  function relativeTime(iso) {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return '';
    const minutes = Math.round((Date.now() - at.getTime()) / 60000);
    if (minutes < 1) return 'most';
    if (minutes < 60) return `${minutes} perce`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} órája`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'tegnap';
    if (days < 7) return `${days} napja`;
    return at.toLocaleDateString('hu-HU');
  }

  /** Egy üzenet buborékja a szerver által küldött alakból. A `mine` dönti el,
      hogy saját (jobbra igazított) üzenet-e — a szerver a NÉZŐ szemszögéből
      küldi, tehát ugyanaz a sor az edzőnél és a sportolónál más oldalra kerül.

      A `read` is a néző szemszöge: a SAJÁT üzenetnél azt jelenti, hogy a másik
      fél elolvasta (ezt írjuk ki a meta végére), a beérkezőnél azt, hogy én már
      láttam — az olvasatlan beérkező kapja a kiemelést. */
  function messageNote(message) {
    const readMark = message.mine && message.read ? ' · olvasva' : '';
    const note = createCoachNote({
      meta: `${message.mine ? 'Te' : message.author} · ${relativeTime(message.at)}${readMark}`,
      text: message.text,
      me: message.mine,
    });
    if (!message.mine && !message.read) note.classList.add('co-note--unread');
    return note;
  }

  /** Az olvasatlan blokk elé kerülő elválasztó. Nélküle egy hosszabb szálban
      nem látszik, honnan újdonság a tartalom. */
  function unreadDivider(count) {
    const divider = document.createElement('p');
    divider.className = 'co-msg-divider';
    divider.textContent = count === 1 ? 'Új üzenet' : `${count} új üzenet`;
    return divider;
  }

  /** Az üzenet-szál halk frissítése: ennyi időnként kérjük le újra a LÁTHATÓ
      beszélgetést, hogy a másik fél üzenete magától megjelenjen. */
  const COACH_POLL_MS = 20_000;

  /** Üres/hibás szál helyén álló magyarázó sor. */
  function feedNotice(text) {
    const p = document.createElement('p');
    p.className = 'co-msg-empty';
    p.textContent = text;
    return p;
  }

  /**
   * Üzenet-szál vezérlő. VALÓDI backend áll mögötte: a küldött üzenet a másik
   * fél fiókjába kerül, és a szál mindkét oldalról ugyanaz (a kapcsolat
   * azonosítója köti össze). Ugyanez szolgálja ki a kliens nézet edző-chatjét
   * és a sportoló-modál chatjét — a különbség csak a getLinkId().
   *
   * A késve érkező válaszra figyelni kell: mire a kérés visszaér, a felhasználó
   * már másik beszélgetést nézhet. Ezért minden válasznál újra megkérdezzük,
   * ugyanaz-e még az aktív kapcsolat.
   *
   * @param {Function} options.isVisible  látszik-e ÉPP a hírfolyam. Kettőt dönt
   *        el: kérdezzük-e a szervert a halk frissítéskor, és nyugtázhatjuk-e
   *        olvasottként a beérkezett üzeneteket. Rejtett szálat nem jelölünk
   *        olvasottnak — az „olvasva" különben azt hazudná a másik félnek, hogy
   *        látták az üzenetét.
   * @param {Function} options.onRead  olvasás-nyugtázás után fut (a jelvények
   *        frissítéséhez). Nem kötelező.
   */
  function createChatController({ feed, form, input, getLinkId, isVisible = () => true, onRead }) {
    const scrollFeedToEnd = () => { feed.scrollTop = feed.scrollHeight; };

    /* A legutóbb kirajzolt szál ujjlenyomata: az üzenet-azonosítók ÉS az
       olvasottság. Ha a frissítés ugyanazt hozza, NEM rajzolunk újra — a
       replaceChildren különben minden körben az aljára ugrasztaná a
       hírfolyamot, miközben a felhasználó épp a korábbi üzeneteket olvassa.
       Az olvasottság is része, különben az „olvasva" jelölés csak a következő
       ÚJ üzenetnél jelenne meg. */
    let lastSignature = null;
    const signatureOf = (messages) => messages
      .map((message) => `${message.id}${message.read ? 'r' : ''}`).join(',');

    const render = (messages) => {
      const signature = signatureOf(messages);
      if (signature === lastSignature) return;
      lastSignature = signature;

      feed.replaceChildren();
      if (messages.length === 0) {
        feed.appendChild(feedNotice('Még nincs üzenet — írj elsőként.'));
        return;
      }
      // Az elválasztó a legelső olvasatlan BEÉRKEZŐ üzenet elé kerül
      const unread = messages.filter((message) => !message.mine && !message.read);
      const firstUnreadId = unread[0]?.id ?? null;
      messages.forEach((message) => {
        if (message.id === firstUnreadId) feed.appendChild(unreadDivider(unread.length));
        feed.appendChild(messageNote(message));
      });
      scrollFeedToEnd();
    };

    /** Beszélgetés-váltáskor a hívó ezzel jelzi, hogy a következő töltés
        MINDENKÉPP rajzoljon (a másik szál tartalma nem maradhat a képernyőn). */
    const reset = () => {
      lastSignature = null;
      feed.replaceChildren(); // amíg a friss szál megjön, ne a másiké álljon itt
    };

    /** A szál lekérése és kirajzolása. Szándékosan nincs „Betöltés…" jelző: a
        korábbi tartalom marad a képernyőn, amíg a friss meg nem érkezik — így
        a 20 másodpercenkénti frissítés sem villog.

        A kirajzolás UTÁN nyugtázzuk az olvasást: a felhasználó ekkor már látja
        az elválasztót és a kiemelt buborékokat, tehát a jelölés igaz. */
    async function load() {
      const linkId = getLinkId();
      if (!linkId) return;
      try {
        const thread = await api.getMessages(linkId);
        if (getLinkId() !== linkId) return; // időközben másik beszélgetés lett aktív
        render(thread.messages);
        if (thread.unread > 0 && isVisible()) await acknowledge(linkId);
      } catch (err) {
        console.error('Üzenetek betöltési hiba:', err);
        if (getLinkId() !== linkId) return;
        lastSignature = null; // a következő sikeres töltés újra kirajzolja a szálat
        feed.replaceChildren(feedNotice('Az üzenetek most nem tölthetők be.'));
      }
    }

    /* Az olvasás-nyugtázás némán bukik: a szál kirajzolva már ott van, a
       következő kör újrapróbálja. Hibaüzenettel zavarni a felhasználót olyasmi
       miatt, amit nem is kért, csak elterelés lenne. */
    async function acknowledge(linkId) {
      try {
        const { read } = await api.markMessagesRead(linkId);
        if (read > 0) await onRead?.();
      } catch (err) {
        console.error('Az üzenetek nyugtázása nem sikerült:', err);
      }
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const linkId = getLinkId();
      const text = input.value.trim();
      if (!linkId || !text) return;

      try {
        const message = await api.sendMessage(linkId, text);
        form.reset();
        if (getLinkId() !== linkId) return;
        $('.co-msg-empty', feed)?.remove();
        feed.appendChild(messageNote(message));
        /* Az ujjlenyomatot is vezetjük: enélkül a következő halk frissítés
           „változásnak" látná a saját, már kint lévő üzenetünket, és a teljes
           újrarajzolással a hírfolyam aljára rántaná az olvasót. */
        if (lastSignature !== null) {
          lastSignature = [lastSignature, String(message.id)].filter(Boolean).join(',');
        }
        scrollFeedToEnd();
      } catch (err) {
        showToast(err.message || 'Az üzenetet nem sikerült elküldeni', 'error');
      }
      input.focus();
    });

    /* Halk frissítés: amíg a hírfolyam látszik, időnként lekérjük a szálat —
       így a másik fél üzenete magától megjelenik, websocket nélkül. Rejtett
       fülön/nézetben nem kérdezünk (ott úgysem látszana), és a hiba némán
       elhal: a következő kör újrapróbálja. */
    setInterval(() => {
      if (document.hidden || !isVisible()) return;
      load();
    }, COACH_POLL_MS);

    return { load, reset };
  }

  /** A modálban megjelenő részletes statok (a kártya statjai + extra mezők).
      A megbízhatóság szándékosan itt van: napló nélküli fiókra a motor 100%
      készenlétet ad (nincs mit levonni), és enélkül az edző „arany szintnek"
      olvasná azt, ami valójában adathiány. */
  const ATHLETE_MODAL_STATS = [
    ...ATHLETE_CARD_STATS,
    ['Heti edzések', (a) => a.weekly],
    ['Aktív terv', (a) => orDash(a.plan)],
    ['Készenlét alapja', (a) => CONFIDENCE_LABELS[a.confidence] ?? '—'],
  ];

  /** Sportoló részletmodál: a saját naplójából számolt összegzés, valódi
      üzenetváltás, és a kapcsolat bontása. Az `onUnlink` az Edző oldalt
      frissíti, miután a sportoló lekerült a panelről. */
  function setupAthleteModal({ confirmAction, onUnlink, onRead, onAssign } = {}) {
    const modal = $('#athleteModal');
    const controller = createModalController(modal);
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

    const chat = createChatController({
      feed,
      form,
      input,
      getLinkId: () => current?.linkId ?? null,
      /* A modál chatje eddig egyszer töltött be, és utána megállt: a sportoló
         válasza csak a modál újranyitásakor jelent meg. A látható szál most itt
         is frissül magától — a feltétel a nyitott modál ÉS a kinyitott
         üzenet-blokk (a csukott blokk tartalmát senki nem olvassa el). */
      isVisible: () => modal.classList.contains('is-open') && !msgSection.hidden,
      onRead,
    });

    const setMessageOpen = (open, { focus = false } = {}) => {
      msgSection.hidden = !open;
      msgButton.setAttribute('aria-expanded', String(open));
      if (!open) return;
      setPlanOpen(false); // a két blokk kizárja egymást — a modál különben nagyon hosszú lenne
      chat.reset(); // másik sportoló szála jöhet — a régi nem maradhat kint
      chat.load();
      if (focus) input.focus();
    };

    msgButton.addEventListener('click', () => setMessageOpen(msgSection.hidden, { focus: true }));

    /* ---- Terv kiosztása ----
       Az edző a SAJÁT tervei közül választ. A lista a blokk kinyitásakor
       frissül: időközben készülhetett új terv a Tervek oldalon. */
    const planButton = $('[data-action="assign-plan"]', modal);
    const planSection = $('[data-plan-section]', modal);
    const planSelect = $('[data-plan-select]', modal);
    const planEmpty = $('[data-plan-empty]', modal);
    const planForm = $('[data-form="assign-plan"]', modal);
    const planNote = $('#assign-plan-note');

    async function loadOwnPlans() {
      let plans = [];
      try {
        plans = await api.getPlans();
      } catch (err) {
        console.error('A tervek betöltése nem sikerült:', err);
        showToast('A terveid most nem tölthetők be', 'error');
      }
      planSelect.replaceChildren();
      plans.forEach((plan) => planSelect.appendChild(new Option(plan.name, plan.id)));
      // Terv nélkül nincs mit kiosztani — a magyarázat mondja meg, mi a teendő
      planEmpty.hidden = plans.length > 0;
      planForm.hidden = plans.length === 0;
    }

    function setPlanOpen(open, { focus = false } = {}) {
      planSection.hidden = !open;
      planButton.setAttribute('aria-expanded', String(open));
      if (!open) return;
      planNote.value = '';
      loadOwnPlans().then(() => {
        if (focus && !planSelect.disabled) planSelect.focus();
      });
    }

    planButton.addEventListener('click', () => {
      const opening = planSection.hidden;
      if (opening) setMessageOpen(false);
      setPlanOpen(opening, { focus: true });
    });

    planForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const athlete = current;
      const planId = Number(planSelect.value);
      if (!athlete || !Number.isInteger(planId)) return;

      const submit = $('button[type="submit"]', planForm);
      submit.disabled = true;
      try {
        const offer = await api.assignPlan(athlete.linkId, planId, planNote.value.trim());
        setPlanOpen(false);
        showToast(`„${offer.name}” kiosztva — ${athlete.name} elfogadására vár`);
        await onAssign?.();
      } catch (err) {
        showToast(err.message || 'A tervet nem sikerült kiosztani', 'error');
      }
      submit.disabled = false;
    });

    // A kapcsolat bontása: a sportoló lekerül a panelről, és az üzenetváltás
    // is törlődik — ezért kérdezünk rá.
    $('[data-action="remove-athlete"]', modal).addEventListener('click', async () => {
      const athlete = current;
      const confirmed = await confirmAction(
        `${athlete.name} lekerül az edzői panelről, és az üzenetváltásotok is törlődik.`,
        { title: 'Kapcsolat bontása', confirmLabel: 'Bontás' },
      );
      if (!confirmed) return;
      try {
        await api.removeAthlete(athlete.linkId);
        controller.close();
        showToast(`${athlete.name} kapcsolata bontva`);
        await onUnlink?.();
      } catch (err) {
        showToast(err.message || 'A kapcsolatot nem sikerült bontani', 'error');
      }
    });

    return {
      open(athlete) {
        current = athlete;

        const tier = athleteTier(athlete.rating);
        badge.className = `co-modal-badge co-tier--${tier.key}`;
        $('.co-modal-rating', badge).textContent = athlete.rating;
        $('.co-modal-tag', badge).textContent = athlete.goal ?? '—';
        titleEl.textContent = athlete.name;
        tierEl.textContent = `${tier.label} · ${athlete.rating} pont · @${athlete.username}`;

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
        const entries = athlete.recent.length > 0
          ? athlete.recent
          : ['Még nincs naplózott aktivitás.'];
        entries.forEach((entry, index) => {
          const li = document.createElement('li');
          li.style.setProperty('--i', index);
          li.textContent = entry;
          activityEl.appendChild(li);
        });

        /* Olvasatlan üzenettel a szál nyitva indul: azért kattintott a
           kártyára, mert a jelvény hívta oda. A gomb felirata is kiírja a
           hátralékot, hogy csukott állapotban is látszódjon. */
        msgButton.textContent = athlete.unread > 0 ? `Üzenet · ${athlete.unread} új` : 'Üzenet';
        /* A modál nyitása MEGELŐZI a szálét: a chat láthatóság-feltétele a
           nyitott modált nézi, és csak látható szálat nyugtázunk olvasottként
           (fordított sorrendben a betöltés nem jelölné meg az üzeneteket). */
        controller.open();
        setPlanOpen(false); // másik sportolóhoz nyílt: a félbehagyott kiosztás ne maradjon kint
        setMessageOpen(athlete.unread > 0);
      },
    };
  }

  /* ---- Az Edző oldal ----
     Mindkét nézet MINDIG elérhető: ugyanaz a fiók lehet valakinek az edzője és
     valaki másnak a sportolója. A tartalom viszont valódi kapcsolatból jön:
       - kliens nézet: a saját edződ szála + a hozzád érkezett meghívók;
       - edzői nézet: a sportolóid kártyái + a kiküldött meghívók.
     Az alapértelmezett nézet ahhoz igazodik, amiben a fióknak épp van adata;
     a felhasználó választását a prefs megjegyzi. */

  async function setupCoachPage(athleteModal, confirmAction) {
    const page = $('[data-page="coach"]');
    const toggle = $('[data-coach-toggle]', page);
    const views = {
      client: $('[data-view="client"]', page),
      manager: $('[data-view="manager"]', page),
    };
    const clientThread = $('[data-coach-thread]', page);
    const noCoachText = $('[data-coach-none]', page);
    const inviteLead = $('[data-invite-lead]', page);
    const inviteBadge = $('[data-invite-badge]', page);
    const athleteBadge = $('[data-athlete-badge]', page);
    const inviteList = $('[data-list="coach-invites"]', page);
    const offerLead = $('[data-offer-lead]', page);
    const offerList = $('[data-list="plan-offers"]', page);
    const sentLead = $('[data-sent-lead]', page);
    const inviteForm = $('[data-form="invite-athlete"]', page);
    const inviteInput = $('#co-invite-username');

    // A saját edződ szála — a kapcsolat azonosítója a /api/coach válaszából jön
    let coachData = { coach: null, invites: [], planOffers: [] };
    let panel = { athletes: [], invites: [] };

    /** Látszik-e ÉPP az edződdel folytatott beszélgetés. Enélkül a halk
        frissítés a rejtett oldalon is kérdezne, az olvasás-nyugtázás pedig
        olyan üzeneteket jelölne olvasottnak, amiket a felhasználó nem is
        látott — az edző oldalán hamis „olvasva" jelenne meg. */
    const clientThreadVisible = () => !page.hidden && !views.client.hidden && !clientThread.hidden;

    const chat = createChatController({
      feed: $('[data-client-feed]', page),
      form: $('[data-form="coach-message"]', page),
      input: $('#coach-message'),
      getLinkId: () => coachData.coach?.linkId ?? null,
      isVisible: clientThreadVisible,
      // Az olvasás után a jelvény már nem stimmel — friss számokat kérünk
      onRead: () => refresh(),
    });

    // A saját felhasználónév: ezzel tud meghívni az edző, ezért ki van írva
    const user = await api.getUser();
    $('[data-my-username]', page).textContent = `@${user.username}`;

    function renderClient() {
      const { coach, invites, planOffers = [] } = coachData;
      clientThread.hidden = !coach;
      // A hosszú magyarázat csak akkor kell, ha nincs se edző, se meghívó
      noCoachText.hidden = Boolean(coach) || invites.length > 0;
      inviteLead.hidden = invites.length === 0;

      if (coach) {
        $('[data-coach-name]', page).textContent = coach.name;
        $('[data-coach-role]', page).textContent = `Edződ · @${coach.username}`;
      }

      inviteList.replaceChildren();
      invites.forEach((invite) => inviteList.appendChild(renderInviteRow(invite, [
        { label: 'Elfogadás', action: 'accept-invite', variant: 'primary' },
        { label: 'Elutasítás', action: 'decline-invite' },
      ])));

      offerLead.hidden = planOffers.length === 0;
      offerList.replaceChildren();
      planOffers.forEach((offer) => offerList.appendChild(renderPlanOffer(offer)));
    }

    /**
     * Jelvények a nézetváltón. MINDKÉT nézet kap egyet, mert a megjegyzett
     * nézetválasztás miatt a felhasználó bármelyikben nyithatja az oldalt — a
     * másik oldalon várakozó meghívó vagy olvasatlan üzenet enélkül
     * észrevétlen maradna. A kettőt egy szám fogja össze („mennyi vár rád
     * ott"), a felolvasott címke viszont kibontja, miből áll.
     */
    function renderToggleBadges() {
      const setBadge = (badge, count, describe) => {
        const button = badge.closest('.co-toggle-btn');
        badge.textContent = count > 0 ? String(count) : '';
        badge.hidden = count === 0;
        if (count > 0) button.setAttribute('aria-label', describe());
        else button.removeAttribute('aria-label');
      };

      const invites = coachData.invites.length;
      const offers = (coachData.planOffers ?? []).length;
      const coachUnread = coachData.coach?.unread ?? 0;
      setBadge(inviteBadge, invites + offers + coachUnread, () => [
        'Edződ',
        invites > 0 ? `${invites} új meghívó` : null,
        offers > 0 ? `${offers} felajánlott terv` : null,
        coachUnread > 0 ? `${coachUnread} olvasatlan üzenet` : null,
      ].filter(Boolean).join(' — '));

      const athleteUnread = panel.athletes.reduce((sum, athlete) => sum + athlete.unread, 0);
      setBadge(athleteBadge, athleteUnread, () => `Edzetteim — ${athleteUnread} olvasatlan üzenet`);
    }

    /** Az alapértelmezett nézet: amelyik oldalon a fióknak épp van dolga. */
    const defaultView = () => {
      if (coachData.coach || coachData.invites.length > 0) return 'client';
      if (panel.athletes.length > 0 || panel.invites.length > 0) return 'manager';
      return 'client';
    };

    const apply = ({ animate = false } = {}) => {
      const view = prefs.get('coachView', null) ?? defaultView();
      views.client.hidden = view !== 'client';
      views.manager.hidden = view !== 'manager';
      $$('.co-toggle-btn', toggle).forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.coachView === view));
      });
      if (view === 'manager' && animate) animateCoachRatings();
    };

    /** Mindkét oldal újratöltése. Az oldalra lépéskor és minden olyan művelet
        után fut, ami a kapcsolatokat módosítja. */
    async function refresh({ animate = false } = {}) {
      [coachData, panel] = await Promise.all([api.getCoach(), api.getAthletes()]);
      renderClient();
      renderCoachPanel(panel);
      sentLead.hidden = panel.invites.length === 0;
      apply({ animate });
      renderToggleBadges(); // az apply UTÁN: a nézetváltó ekkor áll a helyére
      /* A szálat csak akkor töltjük, ha látszik is. Az edzői nézetben állva
         nincs értelme lekérni — és ami fontosabb: a nem látott üzenetet nem
         nyugtázhatjuk olvasottként. */
      if (clientThreadVisible()) chat.load();
    }

    toggle.addEventListener('click', (event) => {
      const btn = event.target.closest('.co-toggle-btn');
      if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
      prefs.set('coachView', btn.dataset.coachView);
      apply({ animate: true });
      // A kliens nézetre váltva a szál most lett látható: itt kérjük le (és
      // nyugtázzuk), nem várva a következő halk frissítésre.
      if (clientThreadVisible()) chat.load();
    });

    // Meghívás felhasználónévvel — a hibát (nincs ilyen fiók, már kapcsolatban
    // vagytok) a szerver üzenete mondja meg, azt írjuk ki.
    inviteForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = inviteInput.value.trim();
      if (!username) return;
      try {
        const invite = await api.inviteAthlete(username);
        inviteForm.reset();
        await refresh();
        showToast(`Meghívó elküldve — ${invite.name} elfogadására vár`);
      } catch (err) {
        showToast(err.message || 'A meghívó nem ment el', 'error');
      }
      inviteInput.focus();
    });

    $('[data-action="leave-coach"]', page).addEventListener('click', async () => {
      const coach = coachData.coach;
      if (!coach) return;
      const confirmed = await confirmAction(
        `${coach.name} innentől nem látja az adataidat, és az üzenetváltásotok is törlődik.`,
        { title: 'Leválás az edzőről', confirmLabel: 'Leválás' },
      );
      if (!confirmed) return;
      try {
        await api.leaveCoach();
        await refresh();
        showToast('Leváltál az edződről');
      } catch (err) {
        showToast(err.message || 'A leválás nem sikerült', 'error');
      }
    });

    /* Egyetlen delegált kattintás-kezelő: a meghívó-gombok és a sportoló-
       kártyák is dinamikusan születnek, tehát nem lehet rájuk közvetlenül
       kötni. A kártya/riasztás-sor a részletmodált nyitja. */
    page.addEventListener('click', async (event) => {
      const inviteBtn = event.target.closest('[data-invite-action]');
      if (inviteBtn) {
        const linkId = Number(inviteBtn.dataset.linkId);
        const action = inviteBtn.dataset.inviteAction;
        try {
          if (action === 'accept-invite') await api.acceptCoachInvite(linkId);
          else if (action === 'decline-invite') await api.declineCoachInvite(linkId);
          else if (action === 'cancel-invite') await api.removeAthlete(linkId);
          await refresh();
          if (action === 'accept-invite') showToast('Meghívó elfogadva');
        } catch (err) {
          showToast(err.message || 'A művelet nem sikerült', 'error');
        }
        return;
      }

      /* Terv-ajánlat: az elfogadás ÚJ tervet hoz létre a sportoló fiókjában,
         a meglévők mellé — a Tervek oldal ezért elavul, azt is frissítjük. */
      const offerBtn = event.target.closest('[data-offer-action]');
      if (offerBtn) {
        const offerId = Number(offerBtn.dataset.offerId);
        const accepting = offerBtn.dataset.offerAction === 'accept-offer';
        try {
          if (accepting) {
            const plan = await api.acceptPlanOffer(offerId);
            showToast(`„${plan.name}” bekerült a terveid közé`);
            // A Tervek oldal listája ettől elavult — frissen húzzuk le
            await renderPlans();
          } else {
            await api.declinePlanOffer(offerId);
          }
          await refresh();
        } catch (err) {
          showToast(err.message || 'A művelet nem sikerült', 'error');
        }
        return;
      }

      const trigger = event.target.closest('[data-athlete]');
      if (!trigger) return;
      const athlete = panel.athletes.find((item) => String(item.linkId) === trigger.dataset.athlete);
      if (athlete) athleteModal?.open(athlete);
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
    const confirmAction = setupConfirmDialog();

    /* Az Edző oldal a router ELŐTT épül fel, hogy az induló oldal effektjei
       (pl. a kártya-pontszámok animációja) már a jó nézetet lássák. A
       részletmodál előbb kell nála: a kártyák azt nyitják, a modálból indított
       kapcsolat-bontás pedig visszafelé frissíti az oldalt. */
    let coachPage = null;
    const athleteModal = await safe(() => setupAthleteModal({
      confirmAction,
      onUnlink: () => coachPage?.refresh(),
      // A modálban elolvasott üzenetek után a kártya és a nézetváltó jelvénye
      // is elavult — a panel újratöltése hozza helyre.
      onRead: () => coachPage?.refresh(),
      // Kiosztás után szintén: az értesítés-panel és a kártyák is változhatnak
      onAssign: () => coachPage?.refresh(),
    }));
    coachPage = await safe(() => setupCoachPage(athleteModal, confirmAction));
    /* Az oldalra lépéskor futó frissítés hibáját itt nyeljük el: a korábbi
       tartalom marad a képernyőn, és a következő megnyitás újrapróbálja —
       egy pillanatnyi hálózati hiba miatt nem üresedhet ki az oldal. */
    refreshCoachPage = () => coachPage?.refresh({ animate: true })
      .catch((err) => console.error('Edző oldal frissítési hiba:', err));

    setupRouter();

    const videoModal = setupVideoModal();
    const prModal = setupPrModal();
    const notifPanel = await safe(setupNotifications);
    const settingsModal = await safe(() => setupSettingsModal({
      onNotifCatsChange: () => notifPanel?.updateBadge(),
      confirmAction,
    }));
    setupDashboard(settingsModal);
    // A setupDashboard UTÁN: a profiloldal „Beállítások" gombját is az köti be
    // (minden [data-action="settings"] elemre), a tartalmat pedig a
    // pageEffects tölti fel az oldal első megnyitásakor.
    await safe(setupProfile);
    // A testsúly-napló a Regeneráció oldal trend-kártyáját és az áttekintő Δ
    // statját tölti — a setupRecovery ELŐTT, mert az a mai bejegyzésből tölti
    // a részletes űrlap testsúly-mezőjét.
    await safe(refreshWeightLog);
    await safe(setupRecovery);
    // A setupRecovery UTÁN: a varázsló mentése az ott beállított
    // applyCheckinSaved-en keresztül frissíti a Regeneráció oldalt.
    await safe(setupCheckinWizard);
    // A közös gyakorlat-választó — az edzésnapló és a terv-építő is ezt célozza át
    const picker = await safe(() => setupExercisePicker(confirmAction));
    const workout = await safe(() => setupWorkout(videoModal, prModal, picker, confirmAction));
    await safe(setupWeeklyCompare);
    // Az étel-modál és a Táplálkozás oldal kölcsönösen hivatkoznak egymásra
    // (a nyíl nyitja a modált, a modál naplóz az oldal állapotán keresztül),
    // ezért a naplózó függvény a felépült oldalról kerül be utólag.
    let nutrition = null;
    const foodDetail = setupFoodDetail({
      onAdd: (food, grams) => nutrition.logFood(food, grams),
    });
    nutrition = await safe(() => setupNutrition(foodDetail));

    /* Saját étel + vonalkód-olvasó. A szkenner szinkron épül fel (nem kér
       adatot); a saját-étel modál viszont a felépült Táplálkozás oldalra
       támaszkodik: onnan frissíti a listát, és onnan nyitja az adagválasztót.
       Ha a setupNutrition elbukott (safe → null), a gombok nem szállnak el —
       az opcionális láncolás miatt csendben nem csinálnak semmit. */
    const scanner = setupScanner();
    await safe(() => setupCustomFood({
      scanner,
      confirmAction,
      onSaved: () => nutrition?.refreshFoods(),
      onLog: (food) => nutrition?.openFoodDetail(food),
    }));

    const planBuilder = await safe(() => setupPlanBuilder(picker));
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
        if (mode === 'register') await api.register(username, displayName, password);
        else await api.login(username, password);

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
