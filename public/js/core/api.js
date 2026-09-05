/**
 * api réteg — az egyetlen hely, ahol az app „adatot kér".
 *
 * Minden getter a backend egy /api/* végpontját hívja (fetch). A frontend nem
 * tárol adatot: az egyetlen forrás a szerver (SQLite — server/db.js). A
 * csak-olvasható referencia-végpontok válasza cache-elt, mert több modul is
 * ugyanazt kéri le induláskor.
 */

import { hooks } from './page-hooks.js';

const SESSION_LOST = 'session-lost';

/** 401 esetén elindítja a visszaterelést, és jelzett hibát dob. */
function handleUnauthorized() {
  hooks.onSessionLost();
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
  getMeasurementSites: () => getJsonCached('/api/measurements/sites'),
  getMeasurements:   () => getJson('/api/measurements'),
  saveMeasurements:  (values) => putJson('/api/measurements', { values }),
  deleteMeasurement: (id) => del(`/api/measurements/${id}`),
  deletePlan:        (id) => del(`/api/plans/${id}`),
  updateWeightEntry: (id, kg) => putJson(`/api/weight-log/${id}`, { kg }),
  deleteWeightEntry: (id) => del(`/api/weight-log/${id}`),
  // A válasz az ÉRINTETT nap összesítője — régebbi nap is javítható.
  updateNutritionEntry: (id, grams) => putJson(`/api/nutrition/log/${id}`, { grams }),
  getProfile:        () => getJson('/api/profile'),
  /* ---- Erőfelmérés ----
     A BEMONDOTT csúcsok. Nem mérés: viszonyítási alap, amit a naplózott
     edzés felülír — a riport `basis` mezője ki is mondja, min alapul. */
  getStrengthAssessment: () => getJson('/api/strength-assessment'),
  saveStrengthAssessment: (entries) => postJson('/api/strength-assessment', { entries }),
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
  /* ---- Napi cél ----
     Két forrás lehet (edzői / saját); a válasz mindkettőt hozza, hogy a
     felület ki tudja írni, honnan jön a szám és eltértél-e az edzőitől. */
  saveNutritionGoal: (calories, protein) => putJson('/api/nutrition/goal', { calories, protein }),
  // A válasz a FRISS cél (a visszaállás utáni állapot), ezért sendJson.
  clearNutritionGoal: () => sendJson('DELETE', '/api/nutrition/goal'),
  setAthleteNutritionGoal: (linkId, calories, protein) =>
    putJson(`/api/athletes/${linkId}/nutrition-goal`, { calories, protein }),
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
  /* Edzés utáni visszajelzés az edzőnek: strukturált (nehézség, közérzet) +
     szabad szöveg. Ugyanarra az edzésre újraküldve felülír. */
  /* ---- Megjegyzések egy gyakorlathoz ----
     A címzés a ház szabályát követi: a sajátodat id nélkül éred el, a
     sportolódét a KAPCSOLAT azonosítójával — a belső user-id nem kerül ki. */
  getMyCommentsByTarget: () => getJson('/api/comments/by-target'),
  addMyComment: (targetId, text) => postJson('/api/comments', { targetId, text }),
  addAthleteComment: (linkId, targetId, text) =>
    postJson(`/api/athletes/${linkId}/comments`, { targetId, text }),
  saveWorkoutFeedback: (workoutId, feedback) => putJson(`/api/workouts/${workoutId}/feedback`, feedback),
  saveWorkout:       (name, exercises, planId) => postJson('/api/workouts', { name, exercises, planId }),
  // Mentett edzés javítása. A dátumot NEM küldjük: az edzés a saját napján
  // marad — a javítás nem helyezi át a naplóban.
  updateWorkout:     (id, name, exercises) => putJson(`/api/workouts/${id}`, { name, exercises }),
  // Mentett edzés törlése. A szerver az egyéni csúcsokat is újraszámolja,
  // ezért utána a PR-lista és a diagramok is frissítendők.
  deleteWorkout:     (id) => del(`/api/workouts/${id}`),
  // Az épp szerkesztett edzés piszkozata — betöltéskor visszaáll, minden változtatás menti
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
  /* Készenlét-alapú javaslat a MAI naplóra. Az apply ÚJRASZÁMOLJA a
     javaslatot a szerveren — a kliens listáját nem fogadja el bemenetként,
     különben egy hamisított kérés tetszőleges gyakorlatot törölhetne. */
  getSessionAdvice:  () => getJson('/api/readiness/advice'),
  applySessionAdvice: () => postJson('/api/readiness/advice/apply'),
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

export { SESSION_LOST, api, del };
