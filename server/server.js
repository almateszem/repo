/**
 * FitTrack Pro — Express szerver
 * ------------------------------
 * Egyetlen origin: ugyanez a szerver szolgálja ki a statikus frontendet
 * (a public/ mappából) ÉS a REST API-t (/api/*). Így nincs CORS, és egyetlen
 * `npm start` elindítja az egészet.
 *
 * Az adat a SQLite adatbázisból jön (server/db.js) — a végpontok azt olvassák/
 * írják, a frontend `api` rétege pedig ezeket a végpontokat hívja.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCollection, getWeightLog, getSnapshot,
  addWeightEntry, getNutritionTotals, addNutritionEntry,
  getNutritionLogForDate, deleteNutritionEntry,
  getWorkouts, addWorkout, getWorkoutDraft, saveWorkoutDraft, clearWorkoutDraft,
  getUserPlans, addPlan, updatePlan, getPlanForDay,
  getCheckin, getCheckins, saveCheckin,
  calculateEpley1RM, getExerciseMax, getAllExerciseMaxes,
  createUser, getUserWithHash, hasAnyUser,
  createSession, getSessionUser, deleteSession, purgeExpiredSessions,
} from './db.js';
import {
  hashPassword, verifyPassword, createSessionToken, hashToken,
  parseCookies, serializeCookie, isLockedOut, recordFailure, clearFailures,
  USERNAME_RE, PASSWORD_MIN, normalizeUsername,
} from './auth.js';
// A készenlét-motor és a közös dátum-segédek. A dátumkezelés szándékosan egy
// helyen (recovery.js) lakik, hogy a szerver és a motor sose csússzon el.
import { computeReadiness, parseDate, dayKey, DAY_MS } from './recovery.js';
import { MUSCLE_KEYS } from './muscles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public'); // a statikus frontend mappája

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // a POST/PUT végpontokhoz (JSON törzs olvasása)

/* ======================================================================
   Fiókok — belépés, munkamenet, hozzáférés-védelem
   ----------------------------------------------------------------------
   Minden /api/* végpont bejelentkezést követel, az /api/auth/* kivételével.
   A munkamenetet HttpOnly süti hordozza; az adatbázisban csak a token
   SHA-256 lenyomata van (ld. server/auth.js).
   ====================================================================== */

const SESSION_COOKIE = 'fittrack_session';
const SESSION_DAYS = 30;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

/* A Secure jelző csak HTTPS-en való kiszolgáláskor kell — localhoston
   bekapcsolva a böngésző eldobná a sütit, és senki nem tudna belépni.
   Reverse proxy mögött az x-forwarded-proto árulja el a valódi sémát. */
const isSecureRequest = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

/** A munkamenet-süti kiadása (belépés/regisztráció) vagy törlése (kilépés). */
function setSessionCookie(req, res, token) {
  res.setHeader('Set-Cookie', serializeCookie(SESSION_COOKIE, token ?? '', {
    maxAge: token ? SESSION_MAX_AGE : 0,
    secure: isSecureRequest(req),
  }));
}

/** A kérés sütijéből kiolvasott munkamenet-token (vagy null). */
const sessionToken = (req) => parseCookies(req.get('cookie'))[SESSION_COOKIE] || null;

/** Új munkamenet a felhasználónak: token a sütibe, lenyomat az adatbázisba. */
function startSession(req, res, userId) {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  createSession(hashToken(token), userId, expiresAt);
  setSessionCookie(req, res, token);
}

/* ---- Auth-végpontok (ezek NEM igényelnek bejelentkezést) ---- */

/** Beléptetve vagyok-e? A felület ezzel dönti el, mutassa-e a belépő
    képernyőt. A firstRun jelzi, hogy még egyetlen fiók sincs — ilyenkor a
    felület rögtön a regisztrációt kínálja. */
app.get('/api/auth/me', (req, res) => {
  const token = sessionToken(req);
  const user = token ? getSessionUser(hashToken(token)) : null;
  if (!user) return res.status(401).json({ error: 'Nincs bejelentkezve.', firstRun: !hasAnyUser() });
  res.json(user);
});

/** A regisztrációs/belépési törzs ellenőrzése. Hibánál { error }-t ad. */
function parseCredentials(body) {
  const username = normalizeUsername(body?.username);
  if (!USERNAME_RE.test(username)) {
    return {
      error: 'A felhasználónév 3–24 karakter lehet, és csak angol kisbetűt, számot, '
        + 'pontot, kötőjelet vagy aláhúzást tartalmazhat.',
    };
  }
  const password = String(body?.password ?? '');
  if (password.length < PASSWORD_MIN) {
    return { error: `A jelszó legalább ${PASSWORD_MIN} karakter legyen.` };
  }
  return { username, password };
}

/** Regisztráció. Az ELSŐ fiók megörökli a fiókok bevezetése előtti adatokat
    (ld. db.js → adoptLegacyData), a válasz ezt jelzi is. */
app.post('/api/auth/register', async (req, res) => {
  const parsed = parseCredentials(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const displayName = String(req.body?.displayName ?? '').trim().slice(0, 40) || parsed.username;

  const created = createUser(parsed.username, displayName, await hashPassword(parsed.password));
  if (!created) return res.status(409).json({ error: 'Ez a felhasználónév már foglalt.' });

  startSession(req, res, created.user.id);
  res.status(201).json({ ...created.user, adoptedLegacy: created.adoptedLegacy });
});

/** Belépés. A hibaüzenet szándékosan nem árulja el, a név vagy a jelszó
    volt-e rossz — így nem lehet vele létező fiókokat feltérképezni. */
app.post('/api/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password ?? '');
  const wrong = { error: 'Hibás felhasználónév vagy jelszó.' };

  if (isLockedOut(username)) {
    return res.status(429).json({
      error: 'Túl sok sikertelen próbálkozás. Próbáld újra néhány perc múlva.',
    });
  }

  const row = getUserWithHash(username);
  // Az archív („korábbi adatok") fiók jelszó-hashe üres — a verifyPassword
  // erre mindig hamisat ad, tehát vele nem lehet belépni.
  if (!row || !await verifyPassword(password, row.password_hash)) {
    recordFailure(username);
    return res.status(401).json(wrong);
  }

  clearFailures(username);
  startSession(req, res, row.id);
  res.json({ id: row.id, username: row.username, displayName: row.display_name });
});

/** Kijelentkezés — a munkamenet törlődik az adatbázisból és a sütiből is. */
app.post('/api/auth/logout', (req, res) => {
  const token = sessionToken(req);
  if (token) deleteSession(hashToken(token));
  setSessionCookie(req, res, null);
  res.status(204).end();
});

/* ---- Hozzáférés-védelem: innentől minden /api/* végpont bejelentkezést kér.
   Ez SZÁNDÉKOSAN az összes többi útvonal ELŐTT áll: egy később felvett
   végpont automatikusan védett lesz, nem kell rá külön gondolni. ---- */
app.use('/api', (req, res, next) => {
  const token = sessionToken(req);
  const user = token ? getSessionUser(hashToken(token)) : null;
  if (!user) return res.status(401).json({ error: 'Nincs bejelentkezve.' });
  req.user = user;
  next();
});

/* A lejárt munkamenetek napi takarítása. Az unref() miatt ez az időzítő nem
   tartja életben a folyamatot (pl. teszt után nem akad be a leállás). */
setInterval(purgeExpiredSessions, 24 * 60 * 60 * 1000).unref();

/** A mai dátum HELYI idő szerint, a frontend által várt formátumban
    (pl. "2026.07.26"). Nem toISOString: az UTC-t adna, és éjfél után
    előző napi dátumot könyvelne. */
const formatDate = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
};

const today = () => formatDate(new Date());

/** Egy "ÉÉÉÉ.HH.NN" dátum eltolása napokkal (negatív = visszafelé). */
const shiftDate = (dateStr, days) => {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatDate(date);
};

/** A mai hétnap indexe, hétfőtől számolva (0 = hétfő … 6 = vasárnap). */
const todayWeekday = () => (new Date().getDay() + 6) % 7;

/** A tervek hétnap-címkéi — a kártya-metában és a kliens chipjein is ez a sorrend. */
const DAY_LABELS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

/** A beküldött hétnap-lista normalizálása: egyedi, rendezett 0–6 indexek. */
const normalizeDays = (raw) => (Array.isArray(raw) ? raw : [])
  .map(Number)
  .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  .filter((d, i, arr) => arr.indexOf(d) === i)
  .sort((a, b) => a - b);

/* ======================================================================
   API — az adat-seam szerver-oldali vége.
   A frontend `api.getX()` metódusai ezeket a végpontokat hívják. Az olvasó-
   végpontok egy-egy collections-kulcsot adnak vissza; az útvonal → kulcs
   megfeleltetés egy helyen, hogy a lista könnyen bővíthető legyen.
   (A weight-log NEM itt van: saját táblából, dedikált route-tal jön.)
   ====================================================================== */
const READ_ENDPOINTS = {
  '/api/foods': 'foods',
  '/api/athletes': 'athletes',
  '/api/notifications': 'notifications',
  '/api/default-set': 'defaultSet',
  '/api/exercise-catalog': 'exerciseCatalog',
  '/api/athlete-replies': 'athleteReplies',
  '/api/coach-notes': 'coachNotes',
  '/api/coach-replies': 'coachReplies',
};

/* Mezőszűrés a válaszhoz. A kollekció a DB-ben TELJES marad (a Recovery
   Engine szerver oldalon a `load` súlyokból dolgozik) — csak a hálózatra
   nem küldjük ki azt, amire a felületnek nincs szüksége.
   A gyakorlat-katalógus 1401 sor: a `load` és a `loadSource` elhagyása a
   válasz negyedét lefaragja, és a kliens egyiket sem használja (a kártya a
   névből, a címkéből, az izom-szövegből és a képből áll össze). */
const RESPONSE_PROJECTIONS = {
  exerciseCatalog: (catalog) => catalog.map(
    ({ load, loadSource, extId, ...visible }) => visible,
  ),
};

for (const [route, key] of Object.entries(READ_ENDPOINTS)) {
  app.get(route, (req, res) => {
    const value = getCollection(key);
    const project = RESPONSE_PROJECTIONS[key];
    res.json(project && Array.isArray(value) ? project(value) : value);
  });
}

/* A profil-végpont. A NÉV a bejelentkezett fiókból jön, a szerepkör-jelzők
   (van-e edződ, edzel-e másokat) továbbra is a seedből: azok a demo-felületek
   kapcsolói, nem fiók-tulajdonságok. */
app.get('/api/user', (req, res) => {
  const seedUser = getCollection('user') || {};
  res.json({ ...seedUser, name: req.user.displayName, username: req.user.username });
});

/** Az Edzés oldal induló tartalma, prioritás szerint: aznapi piszkozat →
    a mai hétnapra ütemezett terv → korábbi (nem mai) piszkozat → null
    (ilyenkor a kliens üres edzésnaplót mutat). Így éjfél után a napra
    beállított terv automatikusan az edzésnaplóba töltődik, de egy megkezdett
    mai edzést sosem ír felül. A dashboard edzésneve is ebből jön. */
function workoutTemplate(userId) {
  const draft = getWorkoutDraft(userId);
  if (draft && draft.date === today()) {
    return { source: 'draft', name: draft.name, exercises: draft.exercises, planId: draft.planId };
  }
  const plan = getPlanForDay(userId, todayWeekday());
  if (plan) {
    return { source: 'plan', name: plan.name, exercises: plan.exercises, planId: plan.id };
  }
  if (draft) {
    return { source: 'draft', name: draft.name, exercises: draft.exercises, planId: draft.planId };
  }
  return null;
}

/** A törzsben érkező terv-azonosító — hiányzó/érvénytelen értékre null
    (szabad edzés, nem tervből indult). */
const parsePlanId = (raw) => (Number.isInteger(raw) && raw > 0 ? raw : null);

// Áttekintő — minden mezője számolt érték. A készenlét és a regenerációs sorok
// a Recovery Engine-ből, a napi kalória/fehérje a táplálkozási naplóból (hogy
// a dashboard és a Táplálkozás oldal ugyanazt mutassa), az aktuális edzésnév
// az edzésnapló induló tartalmából (vagy null).
app.get('/api/dashboard', (req, res) => {
  const userId = req.user.id;
  const dashboard = getCollection('dashboard') || {};
  const totals = getNutritionTotals(userId, today());
  // A mentett edzéseket egyszer olvassuk be, és mindkét fogyasztónak átadjuk:
  // korábban a streak és a készenléti riport külön-külön beolvasta és
  // JSON-ből visszafejtette a TELJES workouts táblát.
  const workouts = getWorkouts(userId);
  const readiness = readinessReport(userId, workouts);

  dashboard.streak = trainingStreak(workouts);
  dashboard.readiness = readiness.overall;
  dashboard.recovery = readiness.recovery;
  // A készenlét-kártya feliratához: mennyire megbízható a szám, és van-e
  // egyáltalán mai check-in (ha nincs, a felület kitöltésre hív).
  dashboard.readinessConfidence = readiness.confidence;
  dashboard.checkinPresent = readiness.checkin.present;
  dashboard.dailyStats = {
    calories: Math.round(totals.intake),
    caloriesTarget: totals.goal.calories,
    protein: Math.round(totals.protein),
  };
  dashboard.workoutName = workoutTemplate(userId)?.name?.trim() || null;
  res.json(dashboard);
});

/* ======================================================================
   Recovery Engine — készenléti riport és napi check-in
   ====================================================================== */

// A teljes riport: összesített készenlét, komponens-bontás, izomcsoportok,
// CNS, gyakorlat-ajánlások, megbízhatóság.
app.get('/api/readiness', (req, res) => res.json(readinessReport(req.user.id)));

// A mai check-in (vagy null, ha még nem töltötted ki)
app.get('/api/checkin', (req, res) => res.json(getCheckin(req.user.id, today())));

/** Egy opcionális szám-mező beolvasása tartomány-ellenőrzéssel.
    Üres/hiányzó érték → null (a motor ezt „nem adta meg"-ként kezeli, nem
    nullaként). Érvénytelen vagy tartományon kívüli érték → hiba. */
function readOptionalNumber(raw, { min, max, integer = false }) {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    return { error: `Az érték ${min} és ${max} között adható meg.` };
  }
  return { value: integer ? Math.round(value) : value };
}

/** A check-in szám-mezői: [törzs-kulcs, tartomány, emberi név]. */
const CHECKIN_FIELDS = [
  ['sleepHours', { min: 0, max: 24 }, 'alvás időtartam'],
  ['sleepQuality', { min: 1, max: 5, integer: true }, 'alvásminőség'],
  ['energy', { min: 1, max: 5, integer: true }, 'energiaszint'],
  ['stress', { min: 1, max: 5, integer: true }, 'stresszszint'],
  ['mood', { min: 1, max: 5, integer: true }, 'közérzet'],
  ['hydration', { min: 0, max: 15 }, 'folyadékbevitel'],
];

/** Izomcsoportonkénti térkép (izomláz 0–5, fájdalom 0–10) normalizálása:
    csak ismert izomkulcs és érvényes szám marad benne. A fájdalomnál a
    'general' kulcs is engedett (általános, nem csoporthoz kötött fájdalom). */
function normalizeMuscleMap(raw, max, allowGeneral = false) {
  const clean = {};
  if (!raw || typeof raw !== 'object') return clean;
  for (const [key, rawValue] of Object.entries(raw)) {
    if (!MUSCLE_KEYS.includes(key) && !(allowGeneral && key === 'general')) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || value > max) continue;
    clean[key] = Math.round(value);
  }
  return clean;
}

/** A mai check-in mentése/felülírása. Minden mező opcionális — a felület a
    gyors (5 mezős) és a részletes kitöltést is ide küldi, és a nap folyamán
    bármikor pontosítható. A dátumot a szerver adja.
    A testsúly NEM a check-in sorba kerül: ha a törzsben jön, a testsúly-naplóba
    írjuk, hogy egyetlen forrás maradjon (és a Regeneráció oldal trend-diagramja
    frissüljön). Naponta egy bejegyzés — az újramentés felülír, nem duplikál. */
app.put('/api/checkin', (req, res) => {
  const userId = req.user.id;
  const body = req.body ?? {};
  const fields = {};

  for (const [key, range, label] of CHECKIN_FIELDS) {
    const parsed = readOptionalNumber(body[key], range);
    if (parsed.error) return res.status(400).json({ error: `${label}: ${parsed.error}` });
    fields[key] = parsed.value;
  }
  fields.soreness = normalizeMuscleMap(body.soreness, 5);
  fields.pain = normalizeMuscleMap(body.pain, 10, true);

  // Opcionális testsúly — a weight_log táblába, ugyanazzal a validálással,
  // mint a /api/weight-log végponton. Üres/hiányzó mező = ma nincs mérés,
  // ilyenkor a korábbi bejegyzések érintetlenül maradnak.
  let weightEntry = null;
  if (body.weightKg !== null && body.weightKg !== undefined && body.weightKg !== '') {
    const kg = Number(body.weightKg);
    if (!Number.isFinite(kg) || kg < 30 || kg > 300) {
      return res.status(400).json({ error: 'Érvénytelen testsúly — 30 és 300 kg között adható meg.' });
    }
    weightEntry = addWeightEntry(userId, kg, today());
  }

  const checkin = saveCheckin(userId, today(), fields);
  // Rögtön a friss riportot is visszaadjuk, hogy a kliensnek ne kelljen
  // külön kérnie — a mentés után azonnal frissülhet a gyűrű.
  res.json({ checkin, weightEntry, readiness: readinessReport(userId) });
});

// Tervek — a felhasználó saját (terv-építőben mentett) tervei, legújabb elöl.
// A kártya-alak (name/meta/progress) itt áll össze egy helyen; az id/exercises/
// days a kliens szerkesztő-gombjához kell. A progress a MAI teljesítést méri:
// a terv nevével ma mentett edzés = 100%, különben — ha a terv épp az edzés-
// naplóban van (aznapi piszkozat) — a pipált szettek aránya; máskülönben 0.
app.get('/api/plans', (req, res) => {
  const userId = req.user.id;
  const todayDate = today();
  const draft = getWorkoutDraft(userId);
  const workoutsToday = getWorkouts(userId).filter((w) => w.date === todayDate);
  // Azonosító szerint párosítunk, névre csak a plan_id oszlop előtt mentett
  // (régi) edzéseknél esünk vissza — két azonos nevű terv így nem osztozik
  // egymás haladásán.
  const savedPlanIds = new Set(workoutsToday.map((w) => w.planId).filter((id) => id != null));
  const savedLegacyNames = new Set(workoutsToday.filter((w) => w.planId == null).map((w) => w.name));
  const draftMatches = (plan) => draft && draft.date === todayDate
    && (draft.planId != null ? draft.planId === plan.id : draft.name === plan.name);

  const progressFor = (plan) => {
    if (savedPlanIds.has(plan.id) || savedLegacyNames.has(plan.name)) return 100;
    if (draftMatches(plan)) {
      const sets = draft.exercises.flatMap((exercise) => exercise.sets);
      const done = sets.filter((set) => set.done).length;
      return sets.length ? Math.round((done / sets.length) * 100) : 0;
    }
    return 0;
  };
  res.json(getUserPlans(userId).map((plan) => {
    const daysLabel = plan.days.length
      ? ` · ${plan.days.map((d) => DAY_LABELS[d]).join(', ')}`
      : '';
    return {
      id: plan.id,
      name: plan.name,
      meta: `Saját terv · ${plan.exercises.length} gyakorlat${daysLabel}`,
      progress: progressFor(plan),
      own: true,
      exercises: plan.exercises,
      days: plan.days,
    };
  }));
});

app.get('/api/workout-template', (req, res) => res.json(workoutTemplate(req.user.id)));

/** Egy PR-jelölt gyakorlat-előfordulás listaelemmé alakítása: a detail az
    első teljesített (vagy első) szett összegzése, valamint a becsült 1RM
    az Epley-képlettel. */
function prEntryFor(userId, workout, exercise) {
  // A mértékegység már nem az értékben van (szám-mezők), ezért itt tesszük hozzá
  const set = exercise.sets.find((s) => s.done) || exercise.sets[0];

  // Az Epley-képlettel kiszámított 1RM
  let oneRM = 0;
  if (set && set.weight && set.reps) {
    oneRM = calculateEpley1RM(set.weight, set.reps);
  }

  // Az eddig nyomon követett maximum
  const maxRecord = getExerciseMax(userId, exercise.name);

  return {
    exercise: exercise.name,
    detail: set ? `${set.reps} ism. @ ${set.weight} kg` : workout.name,
    oneRM: oneRM > 0 ? Math.round(oneRM * 10) / 10 : null, // 1 tizedesjegy pontosság
    maxOneRM: maxRecord ? Math.round(maxRecord.max1rm * 10) / 10 : oneRM,
    date: workout.date,
  };
}

// Korábbi rekordok — gyakorlatonként egy sor, a jelenlegi (legutóbbi
// PR-jelölt) rekorddal. A getWorkouts() legújabb elöl ad vissza edzéseket,
// ezért az adott gyakorlatnál elsőként talált PR-jelölt előfordulás
// pontosan a jelenlegi rekord.
app.get('/api/prs', (req, res) => {
  const latestByExercise = new Map();
  for (const workout of getWorkouts(req.user.id)) {
    for (const exercise of workout.exercises) {
      if (!exercise.pr || latestByExercise.has(exercise.name)) continue;
      latestByExercise.set(exercise.name, prEntryFor(req.user.id, workout, exercise));
    }
  }
  res.json([...latestByExercise.values()]);
});

// Egy adott gyakorlat összes korábbi rekordja legújabb elöl, hogy a
// fejlődés a legfrissebb eredménytől visszafelé követhető legyen. Query
// paraméterben kapja a gyakorlat nevét, mert az útvonal-illesztést törné
// a benne előforduló szóköz/ékezet/perjel.
app.get('/api/prs/history', (req, res) => {
  const exerciseName = req.query.exercise;
  const history = [];
  for (const workout of getWorkouts(req.user.id)) {
    for (const exercise of workout.exercises) {
      if (exercise.name !== exerciseName || !exercise.pr) continue;
      history.push(prEntryFor(req.user.id, workout, exercise));
    }
  }
  res.json(history);
});

/** Az összes nyomon követett exercise maximum (1RM értékek).
    A frontend ezt használja valós idejű PR detektáláshoz szerkesztéskor. */
app.get('/api/exercise-maxes', (req, res) => {
  const maxes = getAllExerciseMaxes(req.user.id);
  // Könnyebb kereshetőséghez exercise_name → max1rm térkép formátum
  const maxMap = {};
  for (const record of maxes) {
    maxMap[record.exercise_name] = Math.round(record.max_1rm * 10) / 10;
  }
  res.json(maxMap);
});

/** Hány napja edzel megszakítás nélkül. A mai naptól számol visszafelé; ha ma
    még nem volt edzés, tegnaptól — így a sorozat nem törik meg attól, hogy a
    mai edzés még előtted áll. */
function trainingStreak(workouts = getWorkouts()) {
  const trainedDays = new Set(workouts.map((w) => dayKey(w.date)));
  const todayKey = dayKey(today());

  let streak = 0;
  let cursor = trainedDays.has(todayKey) ? todayKey : todayKey - DAY_MS;
  while (trainedDays.has(cursor)) {
    streak += 1;
    cursor -= DAY_MS;
  }
  return streak;
}

/** A teljes készenléti riport összeállítása. Az adatgyűjtés itt van, a
    SZÁMÍTÁS a recovery.js-ben — az a modul nem ismeri az adatbázist, ezért
    külön tesztelhető (server/recovery.test.js). */
function readinessReport(userId, workouts = getWorkouts(userId)) {
  const todayDate = today();
  return computeReadiness({
    checkins: getCheckins(userId, 60),
    workouts,
    // A motor a tegnapi bevitelt preferálja (reggel a mai még előtted van),
    // és a maira esik vissza, ha tegnapról nincs naplózás.
    nutrition: {
      today: getNutritionTotals(userId, todayDate),
      yesterday: getNutritionTotals(userId, shiftDate(todayDate, -1)),
    },
    weightLog: getWeightLog(userId),
    catalog: getCollection('exerciseCatalog') || [],
    today: todayDate,
  });
}

/** Az adott nap hetének hétfője, helyi éjfélre normalizálva (timestamp). */
const mondayOf = (date) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

/** Heti volumen-összehasonlítás a mentett edzésekből: teljesített szettek
    naponta, erre és a múlt hétre. A két hét közös skálán van, hogy a
    váltógombbal az oszlopok összevethetők legyenek. */
function volumeCharts(userId) {
  const thisMonday = mondayOf(new Date());
  const lastMonday = thisMonday - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = Array(7).fill(0);
  const lastWeek = Array(7).fill(0);

  for (const workout of getWorkouts(userId)) {
    const date = parseDate(workout.date);
    const monday = mondayOf(date);
    const bucket = monday === thisMonday ? thisWeek : monday === lastMonday ? lastWeek : null;
    if (!bucket) continue;
    bucket[(date.getDay() + 6) % 7] += workout.exercises
      .flatMap((exercise) => exercise.sets)
      .filter((set) => set.done).length;
  }

  const scale = Math.max(4, Math.ceil(Math.max(...thisWeek, ...lastWeek) / 4) * 4);
  const axis = [scale, (scale / 4) * 3, scale / 2, scale / 4].map(String);
  const heights = (week) => week.map((count) => Math.max(4, Math.round((count / scale) * 100)));
  const totalThis = thisWeek.reduce((a, b) => a + b, 0);
  const totalLast = lastWeek.reduce((a, b) => a + b, 0);
  const delta = totalThis - totalLast;

  return {
    volumeThisWeek: {
      heights: heights(thisWeek),
      axis,
      total: totalThis,
      note: delta === 0
        ? 'ugyanannyi, mint a múlt héten'
        : `${delta > 0 ? '+' : ''}${delta} szett a múlt héthez képest`,
      ariaLabel: 'Teljesített szettek naponta — ez a hét',
    },
    volumeLastWeek: {
      heights: heights(lastWeek),
      axis,
      total: totalLast,
      note: 'a múlt hét összes teljesített szettje',
      ariaLabel: 'Teljesített szettek naponta — múlt hét',
    },
  };
}

// Chartok — a seed-görbék mellé a szerver számolja a heti volumen-
// összehasonlítást a mentett edzésekből.
app.get('/api/charts', (req, res) => res.json({ ...getCollection('charts'), ...volumeCharts(req.user.id) }));

// Testsúly-napló — a valódi weight_log táblából
app.get('/api/weight-log', (req, res) => res.json(getWeightLog(req.user.id)));

// Napi táplálkozási összesítő (alap + a MAI naplózott ételek)
app.get('/api/nutrition', (req, res) => res.json(getNutritionTotals(req.user.id, today())));

// A MAI naplózott ételek tételesen — a Táplálkozás oldal „Mai napló" listájához
app.get('/api/nutrition/log', (req, res) => res.json(getNutritionLogForDate(req.user.id, today())));

// Mentett edzések (legújabb elöl)
app.get('/api/workouts', (req, res) => res.json(getWorkouts(req.user.id)));

// Az épp szerkesztett edzés piszkozata ({ name, exercises }) vagy null
app.get('/api/workout-draft', (req, res) => res.json(getWorkoutDraft(req.user.id)));

// Teljes adat-pillanatkép — a beállítások „Adatok exportálása" gombjához
app.get('/api/export', (req, res) => res.json(getSnapshot(req.user.id)));

/* ======================================================================
   Write-végpontok (POST) — a SQLite adatbázist módosítják (perzisztens).
   ====================================================================== */

/** A mai testsúly rögzítése. Törzs: { kg }. A dátumot a szerver adja, és
    naponta egy bejegyzés van: az aznapi érték felülíródik (addWeightEntry).
    A felület ezt a végpontot már nem hívja — a testsúlyt a napi check-in
    kérdi, és a PUT /api/checkin írja ide. Nyitva marad, mert a testsúly-napló
    önálló erőforrás (GET + írás egy helyen). */
app.post('/api/weight-log', (req, res) => {
  const kg = Number(req.body?.kg);
  if (!Number.isFinite(kg) || kg < 30 || kg > 300) {
    return res.status(400).json({ error: 'Érvénytelen testsúly — 30 és 300 kg között adható meg.' });
  }
  // 200, nem 201: a mentés a nap meglévő bejegyzését is felülírhatja.
  res.json(addWeightEntry(req.user.id, kg, today()));
});

/** Étel naplózása. Törzs: { name, grams }. A szerver a foods-ból keresi ki a
    makrókat (a kliens értékeiben nem bízunk), és a megadott adagra számolja át
    őket. A grams elhagyható — ilyenkor a korábbi viselkedés szerint 100 g.
    A válasz { entry, totals }: a létrejött bejegyzés (a mai napló listájához,
    id-vel a törléshez) és a friss összesítő. */
const MAX_PORTION_GRAMS = 2000;
app.post('/api/nutrition/log', (req, res) => {
  const name = String(req.body?.name ?? '');
  const food = (getCollection('foods') || []).find((f) => f.name === name);
  if (!food) {
    return res.status(400).json({ error: 'Ismeretlen étel — csak a listában szereplő adható a naplóhoz.' });
  }

  const grams = req.body?.grams === undefined ? 100 : Number(req.body.grams);
  if (!Number.isFinite(grams) || grams < 1 || grams > MAX_PORTION_GRAMS) {
    return res.status(400).json({
      error: `Érvénytelen adag — 1 és ${MAX_PORTION_GRAMS} g között adható meg.`,
    });
  }

  res.status(201).json(addNutritionEntry(req.user.id, food, today(), Math.round(grams)));
});

/** Naplóbejegyzés törlése (visszavonás). Csak a mai bejegyzés törölhető;
    a válasz a frissített napi összesítő. */
app.delete('/api/nutrition/log/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen bejegyzés-azonosító.' });
  }
  const totals = deleteNutritionEntry(req.user.id, id, today());
  if (!totals) {
    return res.status(404).json({ error: 'Ez a bejegyzés nem törölhető — csak a mai napló módosítható.' });
  }
  res.json(totals);
});

/** RPE normalizálása: az üres érték üres marad (az RPE nem kötelező),
    egyébként 1–10 közé szorul, fél fokozatra kerekítve. A felület is ezt a
    skálát engedi, de a tárolt adat nem függhet a kliens jóindulatától — a
    recovery-motor (rpeFactor, epley1RM) erre a tartományra van hangolva. */
function normalizeRpe(raw) {
  // A számot kiszedjük a szövegből is: a régi bejegyzések „RPE 8" alakúak
  // lehetnek (a db.js migrációja ugyanígy bánik velük).
  const match = String(raw ?? '').replace(',', '.').match(/\d+(\.\d+)?/);
  if (!match) return '';
  return String(Math.min(Math.max(Math.round(Number(match[0]) * 2) / 2, 1), 10));
}

/* A szett típusa: bemelegítő / munkasorozat / drop set. Ismeretlen vagy
   hiányzó értékre (régi bejegyzések) a pozíció szerinti alap érvényes — az
   első szett bemelegítés, onnantól munkasorozat, ugyanúgy, mint a felületen. */
const SET_TYPES = ['warmup', 'work', 'drop'];
/** A szett típusa. A drop set mindig az ELŐTTE lévő szettről csökkent le, ezért
    érvényes szülője kell legyen: a lista élén nincs mihez kapcsolódnia, és
    bemelegítőről sem csökkentenek le. Mindkét esetben munkasorozattá szelídül
    (az első sor bemelegítővé, az az alapértéke). Rokon szabály a gyakorlatok
    `superset` mezőjénél: ott is a szomszédság hordozza a kapcsolatot. */
const normalizeSetType = (raw, index, prevType) => {
  if (!SET_TYPES.includes(raw)) return index === 0 ? 'warmup' : 'work';
  if (raw !== 'drop') return raw;
  if (index === 0) return 'warmup';
  return prevType === 'warmup' ? 'work' : 'drop';
};

/** A beküldött gyakorlat-lista mezőnkénti normalizálása. A kliens a DOM-ból
    olvassa az értékeket, ezért itt kényszerítjük ki az elvárt alakot;
    érvénytelen szerkezetre null-t ad (→ 400-as válasz). */
function normalizeExercises(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const exercises = [];
  for (const entry of raw) {
    const name = String(entry?.name ?? '').trim().slice(0, 60);
    // Szett nélküli gyakorlat nem értelmes: a felületen üres kártyaként
    // jelenne meg, és a haladás-számításokból is kilógna.
    if (!name || !Array.isArray(entry?.sets) || entry.sets.length === 0) return null;

    // Sorrendben, nem map-pel: a szett típusa az ELŐZŐ szett MÁR NORMALIZÁLT
    // típusától is függ (drop set nem követhet bemelegítőt).
    const sets = [];
    for (const [index, set] of entry.sets.entries()) {
      sets.push({
        reps: String(set?.reps ?? '').slice(0, 20),
        weight: String(set?.weight ?? '').slice(0, 20),
        rpe: normalizeRpe(set?.rpe),
        type: normalizeSetType(set?.type, index, sets[index - 1]?.type),
        done: Boolean(set?.done),
      });
    }

    exercises.push({
      name,
      pr: Boolean(entry.pr),
      // Szuperszett: „az előttem lévő gyakorlattal egy körben". A csoportokat
      // tehát a lista sorrendje adja ki (egymást követő true-k = egy csoport),
      // nem külön azonosító. A lista első elemének nincs mihez kapcsolódnia.
      superset: exercises.length > 0 && Boolean(entry.superset),
      sets,
    });
  }
  return exercises;
}

/** A terv-törzs (name/exercises/days) közös validálása. Hibánál { error }-t ad. */
function parsePlanBody(body) {
  const name = String(body?.name ?? '').trim();
  if (!name || name.length > 60) {
    return { error: 'A terv neve kötelező (legfeljebb 60 karakter).' };
  }
  const exercises = normalizeExercises(body?.exercises);
  if (!exercises) {
    return { error: 'A tervnek legalább egy érvényes gyakorlatot kell tartalmaznia.' };
  }
  return { name, exercises, days: normalizeDays(body?.days) };
}

/** Edzésterv mentése (terv-építő). Törzs: { name, exercises, days }. A dátumot a szerver adja. */
app.post('/api/plans', (req, res) => {
  const plan = parsePlanBody(req.body);
  if (plan.error) return res.status(400).json({ error: plan.error });
  res.status(201).json(addPlan(req.user.id, plan.name, today(), plan.exercises, plan.days));
});

/** Meglévő terv szerkesztése. Törzs: { name, exercises, days }. */
app.put('/api/plans/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Érvénytelen terv-azonosító.' });
  const plan = parsePlanBody(req.body);
  if (plan.error) return res.status(400).json({ error: plan.error });
  const updated = updatePlan(req.user.id, id, plan.name, plan.exercises, plan.days);
  if (!updated) return res.status(404).json({ error: 'Nincs ilyen terv — lehet, hogy időközben törölték.' });
  res.json(updated);
});

/** Edzés mentése. Törzs: { name, exercises }. A dátumot a szerver adja. */
app.post('/api/workouts', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 60) {
    return res.status(400).json({ error: 'Az edzés neve kötelező (legfeljebb 60 karakter).' });
  }
  const exercises = normalizeExercises(req.body?.exercises);
  if (!exercises) {
    return res.status(400).json({ error: 'Az edzésnek legalább egy érvényes gyakorlatot kell tartalmaznia.' });
  }
  res.status(201).json(addWorkout(req.user.id, name, today(), exercises, parsePlanId(req.body?.planId)));
});

/** Piszkozat automatikus mentése minden változtatáskor. Törzs: { name, exercises }.
    A végleges mentéssel szemben a név itt üres is lehet (még nem kötelező),
    és az üres gyakorlatlista is érvényes. */
app.put('/api/workout-draft', (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  const raw = req.body?.exercises;
  const exercises = Array.isArray(raw) && raw.length === 0 ? [] : normalizeExercises(raw);
  if (!exercises) {
    return res.status(400).json({ error: 'Érvénytelen piszkozat-szerkezet.' });
  }
  res.json(saveWorkoutDraft(req.user.id, name, exercises, today(), parsePlanId(req.body?.planId)));
});

/** A piszkozat törlése — az edzés lezárása után hívja a kliens. Így ugyanaznap
    új edzés kezdhető, és a napra ütemezett terv is újra betöltődhet. */
app.delete('/api/workout-draft', (req, res) => {
  clearWorkoutDraft(req.user.id);
  res.status(204).end();
});

/* Ismeretlen API-útvonal: JSON-hibát adunk, nem az express.static HTML-es
   404-ét — így a kliens hibakezelése (ami JSON `error` mezőt olvas) értelmes
   üzenetet kap elgépelt vagy megszűnt végpont esetén is. */
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Nincs ilyen végpont: ${req.method} /api${req.path}` });
});

/* ======================================================================
   Statikus frontend — az API-útvonalak UTÁN, kizárólag a public/ mappából.
   A szerver-belső (kód, DB-fájl, node_modules) így eleve nem érhető el
   http-n, nem kell hozzá tiltólista.
   ====================================================================== */
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`FitTrack Pro szerver fut: http://localhost:${PORT}`);
});
