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
  getWorkouts, getWorkoutsSince, getWorkoutDates, getWeightLogSince, getUserPlanSchedules,
  addWorkout, updateWorkout, deleteWorkout,
  getWorkoutDraft, saveWorkoutDraft, clearWorkoutDraft,
  getUserPlans, addPlan, updatePlan, getPlanForDay,
  getCheckin, getCheckins, saveCheckin, hasAnyCheckin,
  getNutritionGoal, saveNutritionGoal, clearOwnNutritionGoal,
  saveWorkoutFeedback, getAthleteFeedbackSince,
  setDeclaredMax, getDeclaredMaxes,
  deletePlan, updateWeightEntry, deleteWeightEntry, updateNutritionEntry,
  getComments, getCommentsByTarget, addComment, deleteComment,
  calculateEpley1RM, bestCompletedSet, getExerciseMax, getAllExerciseMaxes,
  createUser, getUser, getUserWithHash, hasAnyUser, getUserCreatedAt,
  updateUserPassword, deleteUserSessions, deleteUser,
  createSession, getSessionUser, deleteSession, purgeExpiredSessions,
  getUserGoal, setUserGoal, findUserByUsername,
  createCoachInvite, getCoachLink, getActiveCoach, getPendingCoachInvites,
  getCoachAthletes, acceptCoachInvite, deleteCoachLink,
  getMessages, getLastMessage, addMessage, markMessagesRead, getUnreadCounts,
  getRecentExerciseMaxes,
  getPlan, assignPlan, getPlanAssignment, getPendingPlanOffers,
  getAnsweredPlanOffers, resolvePlanAssignment,
  getFoodsForUser, findFoodForUser, addCustomFood, deleteCustomFood,
  getCustomFoodByBarcode, readBarcodeCache, writeBarcodeCache,
} from './db.js';
// Vonalkód-feloldás: a normalizálás/ellenőrzés és az Open Food Facts hívás.
import { normalizeBarcode, fetchProduct } from './openfoodfacts.js';
import { FOOD_GROUPS } from './data/foods.hu.js';
import {
  hashPassword, verifyPassword, createSessionToken, hashToken,
  parseCookies, serializeCookie, isLockedOut, recordFailure, clearFailures,
  USERNAME_RE, PASSWORD_MIN, normalizeUsername,
} from './auth.js';
// A készenlét-motor és a közös dátum-segédek. A dátumkezelés szándékosan egy
// helyen (recovery.js) lakik, hogy a szerver és a motor sose csússzon el.
import { computeReadiness, parseDate, dayKey, DAY_MS } from './recovery.js';
// Az edzői panel sportoló-összegzője. Szintén tiszta számítás: a végpont
// gyűjti az adatot, a modul számol belőle (server/coaching.js).
import { buildAthleteCard } from './coaching.js';
// Az értesítés-panel sorai. Szintén tiszta összeállítás: a végpont gyűjti az
// eseményeket, a modul formázza őket (server/notifications.js).
import { buildNotifications } from './notifications.js';
import { MUSCLE_KEYS, MUSCLE_GROUPS, resolveExerciseLoad, normalizeName } from './muscles.js';
// Kérés-korlátozás. Tiszta számláló, adatbázis és Express nélkül — a limitek
// és a kulcsválasztás itt, a szerveren dőlnek el (server/ratelimit.js).
import { createRateLimiter } from './ratelimit.js';

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

/* ---- Kérés-korlátozás ----
   Három külön korlát, mert három külön dolgot védenek. A számláló memóriában
   él (ld. server/ratelimit.js) — újraindításkor nullázódik, több példánynál
   példányonként számol; ezt vállaljuk.

   A KULCS ott dönt, ahol a támadási felület van. A regisztráció az egyetlen
   olyan írás, amihez nem kell fiók, tehát ott csak a kérés forrása marad
   fogódzónak; minden más végpont belépést követel, ott viszont a FIÓK a
   helyes kulcs (egy fiók sok IP-ről is nyomhatja, és egy megosztott IP mögül
   sokan dolgozhatnak).

   A limitek szándékosan bőkezűek: a valódi használatot nem szabad zavarniuk.
   Az autosave a legsűrűbb író (500 ms debounce → legfeljebb 2 mentés/mp),
   annak a duplája fér bele. */
const MINUTE = 60 * 1000;

/** Új fiókok egy forrásból. A szám tudatosan bőkezű: egy edzőterem vagy egy
    iroda közös IP-je mögül többen is regisztrálhatnak egyszerre, és őket nem
    szabad kizárni. Egy fiók-gyártó szkriptet ez így is megállít. */
const registerLimiter = createRateLimiter({ limit: 30, windowMs: 60 * MINUTE });

/** Írások fiókonként. Az autosave legrosszabb esetének a duplája. */
const writeLimiter = createRateLimiter({ limit: 240, windowMs: MINUTE });

/** Üzenetküldés fiókonként — külön, szigorúbb korlát: itt a spam MÁSIK
    EMBER felületén jelenik meg, nem csak a szerveren okoz terhelést. */
const messageLimiter = createRateLimiter({ limit: 20, windowMs: MINUTE });

/** A kérés forrása. Reverse proxy mögött ehhez `app.set('trust proxy', …)`
    kell, különben minden kérés a proxy címéről érkezőnek látszik — a
    regisztrációs korlát ilyenkor az egész forgalomra közösen számol. */
const requestSource = (req) => req.ip || req.socket?.remoteAddress || 'ismeretlen';

/** Elutasítás 429-cel, a szokásos Retry-After fejléccel. */
function tooManyRequests(res, retryAfter, message) {
  res.setHeader('Retry-After', String(retryAfter));
  return res.status(429).json({ error: message });
}

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
/** A fiók-objektum kiegészítése az `onboarding` jelzővel: igaz, amíg a fiók
    egyetlen check-int sem mentett. A felület ilyenkor a check-in varázslóra
    tereli — enélkül a friss fiók üres Áttekintésre érkezne, ahol a Recovery
    Engine (helyesen) `null` készenlétet mutat, mert nincs mire alapoznia.
    Azért „soha nem volt check-inje" és nem „most regisztrált": ez utóbbi
    csak a kliens pillanatnyi állapota lenne, ez viszont túléli a frissítést. */
const withOnboarding = (user) => ({ ...user, onboarding: !hasAnyCheckin(user.id) });

app.get('/api/auth/me', (req, res) => {
  const token = sessionToken(req);
  const user = token ? getSessionUser(hashToken(token)) : null;
  if (!user) return res.status(401).json({ error: 'Nincs bejelentkezve.', firstRun: !hasAnyUser() });
  res.json(withOnboarding(user));
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
  /* A korlát a HIBÁS próbálkozásokra is áll: enélkül a foglalt nevek
     végigpróbálása (409) ingyen lenne, és a fiók-gyártó szkriptnek elég
     lenne érvénytelen törzzsel melegen tartania a szervert. */
  const quota = registerLimiter.hit(requestSource(req));
  if (!quota.allowed) {
    return tooManyRequests(res, quota.retryAfter, 'Túl sok regisztráció innen. Próbáld később.');
  }

  const parsed = parseCredentials(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const displayName = String(req.body?.displayName ?? '').trim().slice(0, 40) || parsed.username;

  const created = createUser(parsed.username, displayName, await hashPassword(parsed.password));
  if (!created) return res.status(409).json({ error: 'Ez a felhasználónév már foglalt.' });

  startSession(req, res, created.user.id);
  res.status(201).json({ ...withOnboarding(created.user), adoptedLegacy: created.adoptedLegacy });
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
  res.json(withOnboarding({ id: row.id, username: row.username, displayName: row.display_name }));
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
  // A kérés napja (a kliens naptára szerint) — minden végpont ezt használja,
  // hogy egy kérésen belül biztosan ugyanaz a nap szerepeljen mindenhol.
  req.today = requestDate(req);
  next();
});

/* ---- Írás-korlát fiókonként ----
   Az előző réteghez hasonlóan ez is SZÁNDÉKOSAN az útvonalak előtt áll: egy
   később felvett író végpont automatikusan védett lesz.

   Csak az ÍRÁSOKAT korlátozzuk. Az olvasás sem ingyen van, de ott nincs mit
   felhalmozni: egy elszabadult olvasó legfeljebb magát lassítja, míg az írás
   sorokat hagy maga után az adatbázisban — és a szinkron SQLite miatt minden
   egyes írás az egész event loopot blokkolja. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

app.use('/api', (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) return next();
  const quota = writeLimiter.hit(req.user.id);
  if (!quota.allowed) {
    return tooManyRequests(res, quota.retryAfter, 'Túl sok kérés. Várj egy kicsit, aztán próbáld újra.');
  }
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

/** A szerver saját helyi napja — tartalék, ha a kliens nem mond dátumot. */
const serverToday = () => formatDate(new Date());

/* ---- A kérés napja ----
   A naplózás EGY napra könyvel: edzés, check-in, étkezés, testsúly. Melyik
   nap ez? Korábban a SZERVER helyi napja, ami hibás: egy UTC-s szerveren a
   magyar felhasználónak este 10 után már a következő napra ment minden —
   visszamenőleg torzítva a sorozatot, a heti volument és a készenlétet.

   Ezért a napot a KLIENS mondja meg (X-Client-Date fejléc, a böngésző helyi
   naptára szerint). Két dolgot ellenőrzünk rajta:
     - alakilag pontosan "ÉÉÉÉ.HH.NN", és visszaalakítva ugyanaz (tehát nem
       csúszik át egy „2026.13.45" a Date átfordulásán);
     - a szerver napjától legfeljebb EGY napra tér el. Ennyi minden létező
       időzónára elég (UTC-12 … UTC+14), viszont megakadályozza, hogy valaki
       tetszőleges napra írja vissza a saját előzményét.
   Hiányzó vagy gyanús fejléc esetén marad a szerver napja. */
const CLIENT_DATE_RE = /^\d{4}\.\d{2}\.\d{2}$/;
const CLIENT_DATE_HEADER = 'x-client-date';

function requestDate(req) {
  const raw = String(req.get(CLIENT_DATE_HEADER) ?? '').trim();
  if (!CLIENT_DATE_RE.test(raw)) return serverToday();

  const parsed = parseDate(raw);
  if (Number.isNaN(parsed.getTime()) || formatDate(parsed) !== raw) return serverToday();

  const server = serverToday();
  return Math.abs(dayKey(raw) - dayKey(server)) <= DAY_MS ? raw : server;
}

/** Egy "ÉÉÉÉ.HH.NN" dátum eltolása napokkal (negatív = visszafelé). */
const shiftDate = (dateStr, days) => {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatDate(date);
};

/** Egy nap hétnap-indexe, hétfőtől számolva (0 = hétfő … 6 = vasárnap). */
const weekdayOf = (dateStr) => (parseDate(dateStr).getDay() + 6) % 7;

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
   (A weight-log NEM itt van: saját táblából, dedikált route-tal jön.
    A /api/foods SEM: mióta a felhasználó saját ételt is felvihet, a válasz
    fiókfüggő — dedikált route-ot kapott a táplálkozási végpontok között.)
   ====================================================================== */
const READ_ENDPOINTS = {
  // A /api/notifications NINCS köztük: nem referencia-adat többé, hanem a
  // hívó valódi eseményeiből épül (ld. lentebb, „Értesítések").
  '/api/default-set': 'defaultSet',
  '/api/exercise-catalog': 'exerciseCatalog',
  // A választható edzés-célok (kulcs + kártya-címke + felirat). A sportolók
  // listája NINCS köztük: az nem referencia-adat, hanem valódi kapcsolat —
  // ld. lentebb, „Edző–sportoló kapcsolatok".
  '/api/goals': 'goals',
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

/** Egy edzés-cél kulcsa → a kártyán megjelenő rövid címke ("ERŐ"), vagy null.
    A lista a seedből jön (data.js → goals), tehát egy helyen bővíthető. */
const goalTag = (key) => (getCollection('goals') || []).find((goal) => goal.key === key)?.tag ?? null;

/** A bejelentkezett fiók felületi alakja. A korábbi szerepkör-jelzők
    (hasCoach / coachesAthletes) kikerültek belőle: a szerepkör nem a fiók
    tulajdonsága, hanem a kapcsolatokból következik — az Edző oldal a
    /api/coach és a /api/athletes válaszából tudja, melyik nézetben van dolga. */
const userPayload = (user) => ({
  name: user.displayName,
  username: user.username,
  goal: getUserGoal(user.id),
});

app.get('/api/user', (req, res) => res.json(userPayload(req.user)));

/** Az edzés-cél beállítása (beállítások → Edzés-cél). Csak a seedben szereplő
    kulcs fogadható el; az üres érték a „nincs megadva". */
app.put('/api/user', (req, res) => {
  const raw = req.body?.goal;
  const goal = raw === null || raw === undefined || raw === '' ? null : String(raw);
  if (goal !== null && !(getCollection('goals') || []).some((item) => item.key === goal)) {
    return res.status(400).json({ error: 'Ismeretlen edzés-cél.' });
  }
  setUserGoal(req.user.id, goal);
  res.json(userPayload(req.user));
});

/* ======================================================================
   Fiók-műveletek — jelszóváltoztatás és fióktörlés
   ----------------------------------------------------------------------
   Mindkettő BEJELENTKEZÉST és a JELENLEGI JELSZÓT is kéri. A munkamenet-süti
   önmagában nem elég: egy őrizetlenül hagyott gépnél épp ez a két művelet az,
   amivel a kárt okozni lehet (kizárás a fiókból, illetve az adat végleges
   elvesztése).

   Ezek a végpontok a hozzáférés-védelem UTÁN állnak, tehát az /api/auth/*
   előtaggal együtt is bejelentkezést követelnek — ellentétben a belépéssel és
   a regisztrációval, amik értelemszerűen nem.
   ====================================================================== */

/** Jelszóváltoztatás. A válasz új munkamenetet is ad: a régi sütik (más
    eszközök, esetleg egy megszerzett token) érvényüket vesztik. */
app.put('/api/auth/password', async (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');

  if (newPassword.length < PASSWORD_MIN) {
    return res.status(400).json({ error: `Az új jelszó legalább ${PASSWORD_MIN} karakter legyen.` });
  }

  // A jelenlegi jelszó próbálgatását ugyanaz a számláló fékezi, mint a belépését
  if (isLockedOut(req.user.username)) {
    return res.status(429).json({
      error: 'Túl sok sikertelen próbálkozás. Próbáld újra néhány perc múlva.',
    });
  }

  const row = getUserWithHash(req.user.username);
  if (!row || !await verifyPassword(currentPassword, row.password_hash)) {
    recordFailure(req.user.username);
    return res.status(401).json({ error: 'A jelenlegi jelszó nem stimmel.' });
  }
  clearFailures(req.user.username);

  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'Az új jelszó nem lehet ugyanaz, mint a régi.' });
  }

  updateUserPassword(req.user.id, await hashPassword(newPassword));
  // Minden korábbi munkamenet megszűnik, és rögtön nyitunk egy újat ENNEK a
  // böngészőnek — így a jelszót változtató fél nem esik ki a saját fiókjából.
  deleteUserSessions(req.user.id);
  startSession(req, res, req.user.id);
  res.json({ ok: true });
});

/** Fióktörlés. Végleges: a naplók, a tervek, a kapcsolatok és az üzenetek is
    eltűnnek — az utóbbiak a MÁSIK félnél is. A jelszó megerősítésként kell. */
app.post('/api/auth/delete-account', async (req, res) => {
  const password = String(req.body?.password ?? '');

  if (isLockedOut(req.user.username)) {
    return res.status(429).json({
      error: 'Túl sok sikertelen próbálkozás. Próbáld újra néhány perc múlva.',
    });
  }

  const row = getUserWithHash(req.user.username);
  if (!row || !await verifyPassword(password, row.password_hash)) {
    recordFailure(req.user.username);
    return res.status(401).json({ error: 'A jelszó nem stimmel — a fiók nem törlődött.' });
  }
  clearFailures(req.user.username);

  deleteUser(req.user.id);
  setSessionCookie(req, res, null); // a süti is menjen, ne maradjon halott munkamenet
  res.json({ ok: true });
});

/** Munkasorozat-e ez a szett? Teljesített, és nem bemelegítő.
    A „volumen" edzéselméletben munkasorozatot jelent — a bemelegítés nem
    számít bele. A szabály EGY helyen él, mert három fogyasztója van: a
    profiloldal összesítője, a heti volumen-diagram és (a maga másolatában)
    az edzői panel összegzője (server/coaching.js). A drop set önálló
    sorozatnak számít itt; a Recovery Engine az izomkárosodásnál súlyozza le
    (0.5), de darabszámra az is elvégzett munka. */
const isWorkSet = (set) => Boolean(set?.done) && set?.type !== 'warmup';

/** A profiloldal adatai: a fiók alapadatai és az eddigi teljesítmény
    összesítése. Szándékosan NEM a /api/user bővítése: az a seed-fájl demo-
    mezőit is visszaadja (és cache-elt a kliensen), itt viszont kizárólag a
    saját, naplózott adat számít, és minden edzés-mentés után frissülnie kell. */
app.get('/api/profile', (req, res) => {
  const userId = req.user.id;
  const workouts = getWorkouts(userId);

  // Egy bejáráson: a PR-t elért gyakorlatok és a teljesített munkasorozatok.
  // A bemelegítő szettek szándékosan kimaradnak — a „volumen" edzéselméletben
  // munkasorozatot jelent, és a Recovery Engine is így számol.
  const prExercises = new Set();
  let workSets = 0;
  for (const workout of workouts) {
    for (const exercise of workout.exercises) {
      if (exercise.pr) prExercises.add(exercise.name);
      for (const set of exercise.sets) {
        if (isWorkSet(set)) workSets += 1;
      }
    }
  }

  // A testsúly-változás a napló ELSŐ és UTOLSÓ bejegyzése között. Egyetlen
  // bejegyzésnél a delta 0 — az nem „nem változott", hanem „még nincs mihez
  // mérni", ezért ilyenkor null megy ki, és a felület el is hagyja a sort.
  const weightLog = getWeightLog(userId);
  const firstWeight = weightLog[0];
  const lastWeight = weightLog[weightLog.length - 1];

  /* A users.created_at UTC ("2026-03-12 08:41:07"); a felület a többi dátumhoz
     hasonló alakot vár, ezért itt fordítjuk át. Az érvényesség-ellenőrzés nem
     elhagyható: egy kézzel szerkesztett vagy régi formátumú sorból a
     formatDate némán "NaN.NaN.NaN"-t írna ki — a hiányzó dátum ennél jobb,
     azt a felület el is rejti. */
  const createdAt = getUserCreatedAt(userId);
  const joined = createdAt ? new Date(`${createdAt.replace(' ', 'T')}Z`) : null;

  res.json({
    name: req.user.displayName,
    username: req.user.username,
    joinedAt: joined && !Number.isNaN(joined.getTime()) ? formatDate(joined) : null,
    stats: {
      workouts: workouts.length,
      streak: trainingStreak(workouts, req.today),
      prs: prExercises.size,
      workSets,
      // A getWorkouts() legújabb elöl ad vissza, tehát a lista két vége
      // az utolsó és az első edzés.
      lastWorkoutDate: workouts[0]?.date ?? null,
      firstWorkoutDate: workouts[workouts.length - 1]?.date ?? null,
      weight: lastWeight
        ? {
          current: lastWeight.kg,
          delta: weightLog.length > 1
            ? Math.round((lastWeight.kg - firstWeight.kg) * 10) / 10
            : null,
          entries: weightLog.length,
        }
        : null,
    },
  });
});

/* ======================================================================
   Edző–sportoló kapcsolatok és üzenetek
   ----------------------------------------------------------------------
   Itt lesz az Edző oldal valódi: a sportolók VALÓDI fiókok, a stat-jaik a
   SAJÁT naplójukból számolnak (server/coaching.js), az üzenetek pedig
   ténylegesen a másik félhez érkeznek meg.

   A kapcsolat mindig BELEEGYEZÉSSEL jön létre: az edző meghív egy
   felhasználónevet (pending), és amíg a sportoló el nem fogadja, az edző
   SEMMIT nem lát az adataiból. Minden végpont ellenőrzi, hogy a hívó a
   kapcsolat melyik oldala — a kapcsolat azonosítója (linkId) önmagában nem
   jogosít semmire.
   ====================================================================== */

/** Egy üzenet legfeljebb ennyi karakter (a felület input-ja is ennyit enged). */
const MESSAGE_MAX = 280;

/** Ennyi napra visszamenőleg olvassuk be a sportoló edzéseit a kártyához.
    A leghosszabb ablak, amit a kártya bármelyik számítása használ, 28 nap (a
    készenlét-motor személyes referenciája és a terv-követés is ennyi) — a
    ráadás napok csak biztonsági tartalék, hogy egy határeset se csússzon ki. */
const CARD_WINDOW_DAYS = 35;

/** Egy sportoló kártyája: a kapcsolat + a sportoló saját naplóiból számolt
    összegzés. A sportoló BELSŐ azonosítója nem kerül ki a válaszba — kifelé a
    kapcsolat azonosítója (linkId) azonosít.

    A `viewerId` az EDZŐ (a panelt néző fél): az utolsó üzenet `mine` jelölése
    és az olvasatlan-számláló is az ő szemszögéből értendő. */
/** A sportoló legutóbbi gyakorlat-megjegyzései, FELOLDOTT gyakorlatnévvel.
    A megjegyzés célja "edzésId:index" — ebből az edző önmagában semmit nem
    tudna kiolvasni, a nevet pedig csak a sportoló edzésnaplója ismeri.
    A hiányzó célt kihagyjuk: ha az edzés kicsúszott az ablakból vagy törölték,
    a megjegyzésnek nincs mihez tartoznia — kitalált nevet nem teszünk alá. */
const EXERCISE_NOTE_LIMIT = 6;
function exerciseNotes(userId, workouts) {
  const byTarget = getCommentsByTarget(userId, 'exercise');
  const notes = [];

  for (const [target, list] of Object.entries(byTarget)) {
    const [workoutId, index] = String(target).split(':');
    const workout = workouts.find((w) => String(w.id) === workoutId);
    const exercise = workout?.exercises?.[Number(index)];
    if (!workout || !exercise) continue;
    for (const comment of list) {
      notes.push({
        ...comment, target, exercise: exercise.name,
        workout: workout.name, date: workout.date,
      });
    }
  }
  // A legfrissebb elöl: a sor-azonosító a beszúrás sorrendje.
  return notes.sort((a, b) => b.id - a.id).slice(0, EXERCISE_NOTE_LIMIT);
}

function athleteCard(athlete, today, viewerId, unread = 0) {
  /* Az edzés-napló ABLAKOZVA jön be. A kártya minden számítása belefér a
     CARD_WINDOW_DAYS ablakba: a készenlét-motor 28 napnál régebbit amúgy is
     eldob (recovery.js -> summarizeWorkouts), a terv-követés ablaka szintén
     28 nap, a heti állás egy hét, a „legutóbbi aktivitás" pedig négy elem.
     Ami ezen kívülre nyúlik — a sorozat hossza és az utolsó edzés napja —, azt
     a NAPOK listája adja: az a teljes előzményt látja, de gyakorlat-listát nem
     olvas, tehát olcsó. Egy éves naplónál ez ~183 JSON.parse helyett ~12. */
  const since = shiftDate(today, -CARD_WINDOW_DAYS);

  /* A napló ABLAKOZVA jön be, és ugyanaz a három sor szolgálja ki a
     készenlét-motort meg a kártyát is — kétszer nem olvassuk fel. A check-in
     és a testsúly ugyanabból az okból szűkíthető, mint az edzés: a motor az
     alvásadóssághoz 3 napot néz, a megbízhatósághoz 28-at, a testsúlyból
     pedig egyedül a LEGUTOLSÓ mérés érdekli. */
  const workouts = getWorkoutsSince(athlete.userId, since);
  const checkins = getCheckins(athlete.userId, CARD_WINDOW_DAYS);
  const weightLog = getWeightLogSince(athlete.userId, since);
  const workoutDates = getWorkoutDates(athlete.userId);

  const readiness = computeReadiness({
    checkins,
    workouts,
    nutrition: {
      today: getNutritionTotals(athlete.userId, today),
      yesterday: getNutritionTotals(athlete.userId, shiftDate(today, -1)),
    },
    weightLog,
    catalog: getCollection('exerciseCatalog') || [],
    today,
  });

  const lastMessage = getLastMessage(athlete.linkId);
  /* A sportoló napi célja a származásával együtt: az edző így látja, hogy a
     kitűzött célja érvényben van-e, vagy a sportoló mást állított be. A
     buildAthleteCard-on KÍVÜL adjuk hozzá, mert az a modul tiszta függvény —
     nem ismeri az adatbázist. */
  const nutritionGoal = getNutritionGoal(athlete.userId);
  /* A LEGUTÓBBI edzés utáni visszajelzés. Enélkül az edző csak a számokat
     látná: hogy a sportoló hogyan ÉLTE MEG az edzést, csak tőle tudható meg.
     A workouts id szerint csökkenő sorrendű, tehát az első találat a legfrissebb. */
  const fedback = workouts.find((w) => w.feedback);
  const lastFeedback = fedback
    ? { ...fedback.feedback, workout: fedback.name, date: fedback.date }
    : null;
  return Object.assign(buildAthleteCard({
    athlete: { ...athlete, goal: goalTag(athlete.goal) },
    workouts,
    workoutDates,
    plans: getUserPlanSchedules(athlete.userId),
    checkins,
    weightLog,
    readiness: readiness.overall,
    confidence: readiness.confidence,
    streak: streakFromDates(workoutDates, today),
    lastMessage: lastMessage && { ...lastMessage, mine: lastMessage.senderId === viewerId },
    unread,
    today,
  }), {
    nutritionGoal,
    lastFeedback,
    /* Gyakorlat-megjegyzések. Itt oldjuk fel a nevet, mert a sportoló
       edzésnaplója csak a szerveren van meg. */
    exerciseNotes: exerciseNotes(athlete.userId, workouts),
  });
}

/** Egy függő meghívó felületi alakja (mindkét irányban ugyanaz a mezőkészlet). */
const invitePayload = ({ linkId, at, username, name, goal }) => ({
  linkId, at, username, name, goal: goalTag(goal),
});

/* ---- Edzői oldal ---- */

/** A saját sportolóim + az általam kiküldött, még függő meghívók.
    Az olvasatlan-hátralék MINDEN szálra egyetlen lekérdezésből jön — kártyánként
    külön COUNT-ot futtatni sok sportolónál érezhetően drágább lenne. */
app.get('/api/athletes', (req, res) => {
  const unread = getUnreadCounts(req.user.id);
  res.json({
    athletes: getCoachAthletes(req.user.id, 'active')
      .map((athlete) => athleteCard(athlete, req.today, req.user.id, unread.get(athlete.linkId) ?? 0)),
    invites: getCoachAthletes(req.user.id, 'pending').map(invitePayload),
  });
});

/** Sportoló meghívása felhasználónévvel. A meghívó függő marad, amíg a másik
    fél el nem fogadja — addig az edző nem lát az adataiból semmit. */
app.post('/api/athletes', (req, res) => {
  const username = normalizeUsername(req.body?.username);
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'Add meg a sportoló felhasználónevét.' });
  }
  const target = findUserByUsername(username);
  // Az „ismeretlen név" és a „saját név" külön üzenetet kap: itt nincs mit
  // titkolni (a hívó belépett), viszont a gépelési hiba így azonnal kiderül.
  if (!target) return res.status(404).json({ error: 'Nincs ilyen felhasználó.' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'Magadat nem hívhatod meg sportolónak.' });
  }

  /* A fordított irány kizárva: ha ő az edződ, nem lehet egyszerre a
     sportolód is. Technikailag működne (két külön sor), de két külön
     üzenet-szálat adna UGYANAZZAL az emberrel — a felületen pedig nem
     látszana, melyikbe írsz. */
  const myCoach = getActiveCoach(req.user.id);
  if (myCoach && myCoach.username === target.username) {
    return res.status(409).json({ error: 'Ő az edződ — előbb válj le róla.' });
  }

  const link = createCoachInvite(req.user.id, target.id);
  if (!link) return res.status(409).json({ error: 'Ezzel a felhasználóval már van kapcsolatod.' });

  res.status(201).json(invitePayload({
    linkId: link.id, at: link.createdAt, username: target.username, name: target.name, goal: target.goal,
  }));
});

/** A kapcsolat bontása az EDZŐ oldaláról: függő meghívó visszavonása vagy
    élő kapcsolat lezárása. Az üzenetváltás is törlődik vele (CASCADE). */
app.delete('/api/athletes/:linkId', (req, res) => {
  const link = getCoachLink(Number(req.params.linkId));
  if (!link || link.coachId !== req.user.id) {
    return res.status(404).json({ error: 'Nincs ilyen kapcsolat.' });
  }
  deleteCoachLink(link.id);
  res.status(204).end();
});

/* ---- Sportolói oldal ---- */

/** Az edzőm felületi alakja. Az olvasatlan üzenetek száma is benne van — ebből
    lesz a nézetváltó jelvénye, hogy a másik nézetben se maradjon észrevétlen. */
const coachPayload = (coach, userId) => (coach
  ? { ...coach, goal: goalTag(coach.goal), unread: getUnreadCounts(userId).get(coach.linkId) ?? 0 }
  : null);

/** A saját edzőm (vagy null), a hozzám érkezett meghívók, és az edzőm által
    felajánlott, még el nem fogadott tervek. */
app.get('/api/coach', (req, res) => {
  res.json({
    coach: coachPayload(getActiveCoach(req.user.id), req.user.id),
    invites: getPendingCoachInvites(req.user.id).map(({ linkId, at, coach: from }) => ({
      linkId, at, ...from, goal: goalTag(from.goal),
    })),
    planOffers: getPendingPlanOffers(req.user.id)
      .map((offer) => offerPayload(offer, { from: offer.coach.name })),
  });
});

/** Meghívó elfogadása. Egyszerre EGY edző lehet — előbb le kell válni a
    régiről, különben nem lenne eldönthető, kinek a felülete a „kliens nézet". */
app.post('/api/coach/invites/:linkId/accept', (req, res) => {
  const link = getCoachLink(Number(req.params.linkId));
  if (!link || link.athleteId !== req.user.id || link.status !== 'pending') {
    return res.status(404).json({ error: 'Nincs ilyen meghívó.' });
  }
  if (getActiveCoach(req.user.id)) {
    return res.status(409).json({ error: 'Már van edződ — előbb válj le róla.' });
  }
  // Ugyanaz a szabály a másik irányból: a saját sportolóm nem lehet az edzőm.
  if (getCoachAthletes(req.user.id, 'active').some((athlete) => athlete.userId === link.coachId)) {
    return res.status(409).json({ error: 'Ő a sportolód — előbb bontsd azt a kapcsolatot.' });
  }
  acceptCoachInvite(link.id);
  res.json({ coach: coachPayload(getActiveCoach(req.user.id), req.user.id) });
});

/** Meghívó elutasítása (a sportoló oldaláról). */
app.delete('/api/coach/invites/:linkId', (req, res) => {
  const link = getCoachLink(Number(req.params.linkId));
  if (!link || link.athleteId !== req.user.id || link.status !== 'pending') {
    return res.status(404).json({ error: 'Nincs ilyen meghívó.' });
  }
  deleteCoachLink(link.id);
  res.status(204).end();
});

/** Leválás az edzőről. Innentől nem látja az adataimat. */
app.delete('/api/coach', (req, res) => {
  const coach = getActiveCoach(req.user.id);
  if (!coach) return res.status(404).json({ error: 'Nincs edződ.' });
  deleteCoachLink(coach.linkId);
  res.status(204).end();
});

/* ---- Üzenetek (a kapcsolat mindkét oldala ugyanazt a szálat használja) ---- */

/** A kapcsolat, ha ÉL és a hívó tényleg az egyik oldala — különben null.
    Ez az egyetlen hely, ahol az üzenet-szálhoz való hozzáférés eldől. */
function activeLinkFor(user, rawLinkId) {
  const link = getCoachLink(Number(rawLinkId));
  if (!link || link.status !== 'active') return null;
  if (link.coachId !== user.id && link.athleteId !== user.id) return null;
  return link;
}

/** A szál másik oldalán álló fél (a válasz fejlécéhez). */
function partnerOf(link, user) {
  const isCoach = link.coachId === user.id;
  const other = getUser(isCoach ? link.athleteId : link.coachId);
  return {
    username: other?.username ?? null,
    name: other?.displayName ?? 'Ismeretlen',
    role: isCoach ? 'athlete' : 'coach',
  };
}

/** Egy üzenet felületi alakja. A `mine` a NÉZŐ szemszöge — ebből tudja a
    felület, melyik buborék kerül jobbra.

    A `read` jelentése is a nézőtől függ, és ez szándékos: a SAJÁT üzenetemnél
    azt jelenti, hogy a másik fél elolvasta („olvasva" jelölés), a beérkezőnél
    pedig azt, hogy én már láttam — ez utóbbiak kapnak kiemelést a szálban. */
const messagePayload = (message, userId) => ({
  id: message.id,
  mine: message.senderId === userId,
  author: message.author,
  text: message.text,
  at: message.at,
  read: message.readAt !== null,
});

/** A szál lekérése. Az olvasottá jelölés NEM itt történik: a felület akkor
    nyugtázza (POST .../read), amikor a hírfolyam tényleg látszik — a 20
    másodpercenkénti halk frissítés önmagában nem jelenti, hogy el is olvasták. */
app.get('/api/messages/:linkId', (req, res) => {
  const link = activeLinkFor(req.user, req.params.linkId);
  if (!link) return res.status(404).json({ error: 'Nincs ilyen beszélgetés.' });
  const messages = getMessages(link.id).map((message) => messagePayload(message, req.user.id));
  res.json({
    linkId: link.id,
    partner: partnerOf(link, req.user),
    messages,
    unread: messages.filter((message) => !message.mine && !message.read).length,
  });
});

app.post('/api/messages/:linkId', (req, res) => {
  const link = activeLinkFor(req.user, req.params.linkId);
  if (!link) return res.status(404).json({ error: 'Nincs ilyen beszélgetés.' });

  /* Az általános írás-korláton FELÜL: a szemetet itt egy másik ember nézi
     végig, nem csak a szerver nyeli le. Percenként 20 üzenet a leggyorsabb
     gépelőnek is elég. */
  const quota = messageLimiter.hit(req.user.id);
  if (!quota.allowed) {
    return tooManyRequests(res, quota.retryAfter, 'Túl gyorsan írsz — várj egy kicsit.');
  }

  const text = String(req.body?.text ?? '').trim().slice(0, MESSAGE_MAX);
  if (!text) return res.status(400).json({ error: 'Az üzenet nem lehet üres.' });

  res.status(201).json(messagePayload(addMessage(link.id, req.user.id, text), req.user.id));
});

/** A szál nyugtázása: a másik fél üzenetei olvasottá válnak. Idempotens —
    hátralék nélkül is 200-at ad, `read: 0`-val. */
app.post('/api/messages/:linkId/read', (req, res) => {
  const link = activeLinkFor(req.user, req.params.linkId);
  if (!link) return res.status(404).json({ error: 'Nincs ilyen beszélgetés.' });
  res.json({ read: markMessagesRead(link.id, req.user.id) });
});

/* ======================================================================
   Terv-kiosztás
   ----------------------------------------------------------------------
   Az edző FELAJÁNL egy tervet, a sportoló elfogadja vagy elutasítja —
   ugyanaz az elv, mint a kapcsolaté: ami a másik fiókjában megjelenik, ahhoz
   a másik beleegyezése kell. Közvetlenül beírni a plans táblájába két okból
   sem szabad: tervet TÖRÖLNI nem lehet az appban (amit egyszer belepakolunk,
   azt nem tudná kiszedni), és a saját tervei közé se kerülhet olyasmi, amit
   nem ő tett oda.

   Ami átmegy, az PILLANATKÉP: az edző későbbi szerkesztése nem változtatja
   meg némán a sportolónál lévő példányt.
   ====================================================================== */

/** Az edző kísérő sora a kiosztáshoz — legfeljebb ennyi karakter. */
const PLAN_NOTE_MAX = 200;

/** Egy terv-ajánlat felületi alakja. A gyakorlat-lista is benne van: a
    sportolónak látnia kell, MIT fogad el. */
const offerPayload = (offer, from) => ({
  id: offer.id,
  name: offer.name,
  exercises: offer.exercises,
  days: offer.days,
  note: offer.note,
  at: offer.at,
  ...from,
});

/** Terv kiosztása a kapcsolat sportolójának. Törzs: { planId, note }.
    A terv az EDZŐ saját tervei közül való — a végpont nem terv-szerkesztő. */
app.post('/api/athletes/:linkId/plan', (req, res) => {
  const link = getCoachLink(Number(req.params.linkId));
  // Csak az edző oldala oszthat ki, és csak ÉLŐ kapcsolatba
  if (!link || link.coachId !== req.user.id || link.status !== 'active') {
    return res.status(404).json({ error: 'Nincs ilyen kapcsolat.' });
  }

  const planId = Number(req.body?.planId);
  if (!Number.isInteger(planId)) {
    return res.status(400).json({ error: 'Válaszd ki, melyik tervet osztod ki.' });
  }
  const plan = getPlan(req.user.id, planId);
  if (!plan) return res.status(404).json({ error: 'Nincs ilyen terved.' });

  const note = String(req.body?.note ?? '').trim().slice(0, PLAN_NOTE_MAX) || null;
  const assignment = assignPlan(link.id, {
    name: plan.name, exercises: plan.exercises, days: plan.days, note,
  });
  res.status(201).json(offerPayload(assignment, { linkId: link.id }));
});

/** A hozzám érkezett ajánlat, ha tényleg az enyém és még függő — különben null. */
function pendingOfferFor(userId, rawId) {
  const offer = getPlanAssignment(Number(rawId));
  if (!offer || offer.status !== 'pending') return null;
  const link = getCoachLink(offer.linkId);
  if (!link || link.status !== 'active' || link.athleteId !== userId) return null;
  return offer;
}

/** Ajánlat elfogadása: a terv MÁSOLATKÉNT kerül a sportoló tervei közé.
    A meglévő terveihez nem nyúlunk — ez mindig hozzáadás, sosem felülírás. */
app.post('/api/plan-offers/:id/accept', (req, res) => {
  const offer = pendingOfferFor(req.user.id, req.params.id);
  if (!offer) return res.status(404).json({ error: 'Nincs ilyen terv-ajánlat.' });

  resolvePlanAssignment(offer.id, 'accepted');
  const plan = addPlan(req.user.id, offer.name, req.today, offer.exercises, offer.days);
  res.status(201).json(plan);
});

/** Ajánlat elutasítása. A sor megmarad (lezárt állapotban), hogy az edző
    lássa a választ — de a sportolónál nem lóg ott tovább. */
app.delete('/api/plan-offers/:id', (req, res) => {
  const offer = pendingOfferFor(req.user.id, req.params.id);
  if (!offer) return res.status(404).json({ error: 'Nincs ilyen terv-ajánlat.' });
  resolvePlanAssignment(offer.id, 'declined');
  res.status(204).end();
});

/* ======================================================================
   Értesítések
   ----------------------------------------------------------------------
   A panel tartalma a HÍVÓ valódi eseményeiből áll össze — a korábbi,
   mindenkinek egyforma demo-lista kikerült a data.js-ből. Az összeállítás
   tiszta függvény (server/notifications.js); itt csak összegyűjtjük neki az
   adatot.
   ====================================================================== */

/** Ennyi napra visszamenőleg számít frissnek egy egyéni csúcs. */
const PR_NOTICE_DAYS = 14;

app.get('/api/notifications', (req, res) => {
  const userId = req.user.id;

  /* Olvasatlan üzenetek szálanként. A számláló egy lekérdezésből jön, a
     partner nevéért és az idézett szövegért szálanként megyünk vissza — de
     csak azokért a szálakért, ahol tényleg van hátralék. */
  const unreadThreads = [];
  for (const [linkId, unread] of getUnreadCounts(userId)) {
    const link = getCoachLink(linkId);
    if (!link) continue;
    const last = getLastMessage(linkId);
    if (!last) continue;
    const partner = getUser(link.coachId === userId ? link.athleteId : link.coachId);
    unreadThreads.push({
      linkId,
      partner: partner?.displayName ?? 'Ismeretlen',
      unread,
      lastText: last.text,
      at: last.at,
    });
  }

  const since = formatDate(new Date(dayKey(req.today) - PR_NOTICE_DAYS * DAY_MS));

  res.json(buildNotifications({
    unreadThreads,
    incomingInvites: getPendingCoachInvites(userId)
      .map(({ linkId, at, coach }) => ({ linkId, at, coach: coach.name })),
    /* Az elfogadás pillanata: csak élő kapcsolatnál van, és csak akkor
       értesítés, ha a sportoló tényleg lépett (a responded_at üres marad
       azoknál a soroknál, amik nem meghívóból lettek aktívak). */
    acceptedLinks: getCoachAthletes(userId, 'active')
      .filter((athlete) => athlete.respondedAt)
      .map((athlete) => ({ linkId: athlete.linkId, at: athlete.respondedAt, athlete: athlete.name })),
    // A sportoló oldala: nekem felajánlott, még függő tervek
    planOffers: getPendingPlanOffers(userId)
      .map((offer) => ({ id: offer.id, plan: offer.name, coach: offer.coach.name, at: offer.at })),
    // Az edző oldala: az általam kiosztott tervekre érkezett válaszok
    answeredPlans: getAnsweredPlanOffers(userId).map((offer) => ({
      id: offer.id,
      plan: offer.name,
      athlete: offer.athlete.name,
      accepted: offer.status === 'accepted',
      at: offer.respondedAt,
    })),
    recentPrs: getRecentExerciseMaxes(userId, since),
    // Az edző oldala: a sportolói friss edzés-visszajelzései.
    athleteFeedback: getAthleteFeedbackSince(userId, since),
  }));
});

/** Az Edzés oldal induló tartalma, prioritás szerint: aznapi piszkozat →
    a mai hétnapra ütemezett terv → korábbi (nem mai) piszkozat → null
    (ilyenkor a kliens üres edzésnaplót mutat). Így éjfél után a napra
    beállított terv automatikusan az edzésnaplóba töltődik, de egy megkezdett
    mai edzést sosem ír felül. A dashboard edzésneve is ebből jön. */
function workoutTemplate(userId, today) {
  /* A workoutId is átmegy: ha a piszkozat egy VISSZANYITOTT edzésé, akkor a
     felület újratöltés után is tudja, hogy javítás van folyamatban — különben
     a befejezés új, MAI edzést hozna létre a javítás helyett. */
  const fromDraft = (draft) => ({
    source: 'draft', name: draft.name, exercises: draft.exercises,
    planId: draft.planId, workoutId: draft.workoutId,
  });

  const draft = getWorkoutDraft(userId);
  if (draft && draft.date === today) return fromDraft(draft);

  const plan = getPlanForDay(userId, weekdayOf(today));
  if (plan) {
    return { source: 'plan', name: plan.name, exercises: plan.exercises, planId: plan.id, workoutId: null };
  }
  if (draft) return fromDraft(draft);
  return null;
}

/** A törzsben érkező, NEM KÖTELEZŐ sor-azonosító (terv- vagy edzés-id) —
    hiányzó/érvénytelen értékre null. A piszkozatnál mindkettő így viselkedik:
    terv nélkül szabad edzés, edzés-azonosító nélkül új edzés. */
const parseRowId = (raw) => (Number.isInteger(raw) && raw > 0 ? raw : null);

// Áttekintő — minden mezője számolt érték. A készenlét és a regenerációs sorok
// a Recovery Engine-ből, a napi kalória/fehérje a táplálkozási naplóból (hogy
// a dashboard és a Táplálkozás oldal ugyanazt mutassa), az aktuális edzésnév
// az edzésnapló induló tartalmából (vagy null).
app.get('/api/dashboard', (req, res) => {
  const userId = req.user.id;
  const dashboard = getCollection('dashboard') || {};
  const totals = getNutritionTotals(userId, req.today);
  // A mentett edzéseket egyszer olvassuk be, és mindkét fogyasztónak átadjuk:
  // korábban a streak és a készenléti riport külön-külön beolvasta és
  // JSON-ből visszafejtette a TELJES workouts táblát.
  const workouts = getWorkouts(userId);
  const readiness = readinessReport(userId, req.today, workouts);

  dashboard.streak = trainingStreak(workouts, req.today);
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
  dashboard.workoutName = workoutTemplate(userId, req.today)?.name?.trim() || null;
  res.json(dashboard);
});

/* ======================================================================
   Recovery Engine — készenléti riport és napi check-in
   ====================================================================== */

// A teljes riport: összesített készenlét, komponens-bontás, izomcsoportok,
// CNS, gyakorlat-ajánlások, megbízhatóság.
app.get('/api/readiness', (req, res) => res.json(readinessReport(req.user.id, req.today)));

/* ======================================================================
   Biztonsági átnézés — a készenlét felülírja a tervet
   ----------------------------------------------------------------------
   A kiosztott tervhez a kliens nem nyúlhat. Egyetlen dolog szólhat bele:
   a mai készenléte. A rendszer NEM írja át a tervet (az elrejtené az edző
   elől, mi történt) — hanem MEGJELÖLI, mi kockázatos ma, és miért.

   A jelzés minden gyakorlatra működik, nem csak arra, amire van előzmény:
   a gyakorlat → izomcsoport leképezésből dolgozik, nem a naplóból.
   ====================================================================== */

/** 7/10 vagy afölötti fájdalom = tiltás. Ugyanaz a küszöb, amivel a
    Recovery Engine a gyakorlat-ajánlásokat is letiltja — egy helyen kell
    igaznak lennie, nem kettőn. */
const PAIN_BLOCK = 7;
/** E alatti izom-készenlétnél óvatosságra intünk (de nem tiltunk).

    A szám a MOTOR SKÁLÁJÁHOZ igazodik, nem érzésre van megválasztva. Ahol a
    terhelés-modellnek VAN adata a csoportról, ott a bejelentett izomlázat
    0.4 súllyal keveri be (recovery.js → muscleReadiness). Ha tehát a modell
    frissnek látja az izmot (100), de a felhasználó 5/5-ös izomlázat jelez,
    az eredmény 60 — vagyis egy 45%-os küszöb ezt az esetet néma maradna,
    pedig pont ilyenkor kell visszavenni.
    (Ha a modellnek NINCS adata a csoportról, a bejelentett érzet önmagában
    adja a pontszámot — ott az 5/5 már 0-t ad.)
    A 70 egyben a recovery.js recommend() létrájának ugyanazon foka, ahol az
    „normál súly, −1 szett"-re vált. */
const LOW_MUSCLE_READINESS = 70;
/** Egy gyakorlatot akkor tekintünk az izomcsoport terhelőjének, ha a terhelés
    legalább ennyi — a jelentéktelen másodlagos terhelésre nem figyelmeztetünk. */
const RELEVANT_LOAD = 0.2;

/** Egy fiókhoz egyszer elkészített átnéző. Visszaad egy függvényt, ami egy
    gyakorlat-listára megmondja, mi tiltott és mi kockázatos MA. */
function planSafetyChecker(userId, todayDate) {
  const report = readinessReport(userId, todayDate);
  const catalog = getCollection('exerciseCatalog') || [];
  const byKey = Object.fromEntries(report.muscles.map((m) => [m.key, m]));

  return (exercises) => {
    const blocked = [];
    const caution = [];

    for (const exercise of exercises) {
      const load = resolveExerciseLoad(exercise.name, catalog);
      const groups = Object.entries(load).filter(([, share]) => share >= RELEVANT_LOAD);

      const painful = groups.filter(([key]) => (byKey[key]?.pain ?? 0) >= PAIN_BLOCK);
      if (painful.length > 0) {
        blocked.push({
          name: exercise.name,
          reason: `fájdalmat jeleztél ide: ${painful.map(([key]) => MUSCLE_GROUPS[key]).join(', ')}`,
        });
        continue;
      }

      const tired = groups.filter(([key]) => (byKey[key]?.readiness ?? 100) < LOW_MUSCLE_READINESS);
      if (tired.length > 0) {
        caution.push({
          name: exercise.name,
          reason: `még nem állt helyre: ${tired.map(([key]) => MUSCLE_GROUPS[key]).join(', ')}`,
        });
      }
    }

    if (blocked.length === 0 && caution.length === 0) return null;
    return { blocked, caution };
  };
}

/* ======================================================================
   Készenlét-alapú javaslat a MAI edzésre
   ----------------------------------------------------------------------
   A terv-kártya jelzése („ma kerüld ezt") passzív: látni kell, de nem
   csinál semmit. Ez a réteg konkrét, ELFOGADHATÓ javaslatot ad a mai
   naplóra — a check-in után felugró ablakban, Elfogadom / Most nem
   gombbal.

   Amit a javaslat MÓDOSÍT, az a mai edzésnapló (a piszkozat), SOHA nem a
   terv. A terv az edzőé; ha a rendszer belenyúlna, az edző azt hinné, a
   kliens az ő tervét csinálta végig.

   Két dolgot sosem bánt:
     · a MÁR TELJESÍTETT szetteket — azok megtörténtek,
     · a nem szám súlyokat (saját testsúlyos gyakorlat) — ott nincs mit levenni.
   ====================================================================== */

/** A súlycsökkentés a konditerem valóságához igazodik: 2,5 kg-os lépcső,
    lefelé kerekítve. Egy „87,3 kg" javaslat használhatatlan volna. */
const PLATE_STEP_KG = 2.5;
/** E alatti izom-készenlétnél nagyobb levételt javaslunk. Ide már csak
    tényleges terhelés-halmozódással lehet lejutni (az izomláz önmagában
    60-ig visz), ezért indokolt a nagyobb lépés. */
const VERY_LOW_MUSCLE = 55;
const REDUCE_HARD = 0.15;
const REDUCE_SOFT = 0.10;

const reduceWeight = (kg, ratio) => Math.max(0, Math.floor((kg * (1 - ratio)) / PLATE_STEP_KG) * PLATE_STEP_KG);
/** Szám → a naplóban használt szöveges alak (fölösleges tizedes nélkül). */
const weightText = (value) => String(Math.round(value * 10) / 10);

/** A mai edzésre vonatkozó javaslatok. A MAI NAPLÓ tartalmából dolgozik
    (piszkozat vagy a napra ütemezett terv) — tehát abból, amit a felhasználó
    ténylegesen csinálni fog, nem egy elvont terv-listából.

    A visszatérés { name, items }; üres items = nincs mit javasolni, és
    ilyenkor a felület fel sem dobja az ablakot. */
function sessionAdvice(userId, todayDate) {
  const template = workoutTemplate(userId, todayDate);
  if (!template || !Array.isArray(template.exercises) || template.exercises.length === 0) {
    return { name: null, items: [] };
  }

  const report = readinessReport(userId, todayDate);
  const catalog = getCollection('exerciseCatalog') || [];
  const byKey = Object.fromEntries(report.muscles.map((m) => [m.key, m]));
  const items = [];

  template.exercises.forEach((exercise, index) => {
    const pending = (exercise.sets ?? []).filter((set) => !set.done);
    if (pending.length === 0) return; // már kész — nincs mit javasolni

    const groups = Object.entries(resolveExerciseLoad(exercise.name, catalog))
      .filter(([, share]) => share >= RELEVANT_LOAD)
      .map(([key]) => byKey[key])
      .filter(Boolean);

    const painful = groups.filter((group) => (group.pain ?? 0) >= PAIN_BLOCK);
    if (painful.length > 0) {
      /* Ha már van teljesített szett, a gyakorlatot nem lehet meg nem
         történtté tenni — ilyenkor a maradék marad el ('stop'). */
      const started = pending.length < exercise.sets.length;
      items.push({
        index,
        name: exercise.name,
        action: started ? 'stop' : 'skip',
        reason: `fájdalmat jeleztél ide: ${painful.map((g) => g.label).join(', ')}`,
        detail: started
          ? `a hátralévő ${pending.length} szett kimarad`
          : 'a gyakorlat kimarad a mai naplóból',
      });
      return;
    }

    const worst = groups.slice().sort((a, b) => a.readiness - b.readiness)[0];
    if (!worst || worst.readiness >= LOW_MUSCLE_READINESS) return;

    const ratio = worst.readiness < VERY_LOW_MUSCLE ? REDUCE_HARD : REDUCE_SOFT;
    // Csak akkor van értelme javasolni, ha tényleg lejjebb tudunk menni.
    const weights = pending
      .map((set) => Number(set.weight))
      .filter((kg) => Number.isFinite(kg) && kg > 0);
    const heaviest = Math.max(0, ...weights);
    if (heaviest === 0 || reduceWeight(heaviest, ratio) >= heaviest) return;

    items.push({
      index,
      name: exercise.name,
      action: 'reduce',
      percent: Math.round(ratio * 100),
      reason: `${worst.label} még nem állt helyre (${worst.readiness}%)`,
      detail: `a legnehezebb szett ${weightText(heaviest)} kg → ${weightText(reduceWeight(heaviest, ratio))} kg`,
    });
  });

  return { name: template.name, items };
}

/** A javaslat alkalmazása a mai naplóra.

    A javaslatokat ÚJRASZÁMOLJUK — a kliens listáját nem fogadjuk el
    bemenetként. Enélkül egy hamisított kérés tetszőleges gyakorlatot
    törölhetne a naplóból. */
function applySessionAdvice(userId, todayDate) {
  const template = workoutTemplate(userId, todayDate);
  const { items } = sessionAdvice(userId, todayDate);
  if (items.length === 0) return { applied: 0 };

  const byIndex = new Map(items.map((item) => [item.index, item]));
  const exercises = [];

  template.exercises.forEach((exercise, index) => {
    const advice = byIndex.get(index);
    if (!advice) {
      exercises.push(exercise);
      return;
    }
    if (advice.action === 'skip') return;                       // kimarad a naplóból
    if (advice.action === 'stop') {
      exercises.push({ ...exercise, sets: exercise.sets.filter((set) => set.done) });
      return;
    }
    const ratio = advice.percent / 100;
    exercises.push({
      ...exercise,
      sets: exercise.sets.map((set) => {
        const kg = Number(set.weight);
        if (set.done || !Number.isFinite(kg) || kg <= 0) return set;
        return { ...set, weight: weightText(reduceWeight(kg, ratio)) };
      }),
    });
  });

  /* A piszkozat DÁTUMA marad, ami volt — ha ma még nincs piszkozat (a terv
     töltődött be), akkor mai. Így az elfogadás nem datálja át némán egy
     korábbi, félbehagyott edzést. */
  const draft = getWorkoutDraft(userId);
  saveWorkoutDraft(userId, template.name, exercises, draft?.date ?? todayDate, template.planId ?? null);
  return { applied: items.length };
}

app.get('/api/readiness/advice', (req, res) => res.json(sessionAdvice(req.user.id, req.today)));

/** Elfogadás. A válasz a friss napló, hogy a felület egy körből frissüljön. */
app.post('/api/readiness/advice/apply', (req, res) => {
  const result = applySessionAdvice(req.user.id, req.today);
  res.json({ ...result, template: workoutTemplate(req.user.id, req.today) });
});

// A mai check-in (vagy null, ha még nem töltötted ki)
app.get('/api/checkin', (req, res) => res.json(getCheckin(req.user.id, req.today)));

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
    weightEntry = addWeightEntry(userId, kg, req.today);
  }

  const checkin = saveCheckin(userId, req.today, fields);
  // Rögtön a friss riportot is visszaadjuk, hogy a kliensnek ne kelljen
  // külön kérnie — a mentés után azonnal frissülhet a gyűrű.
  res.json({ checkin, weightEntry, readiness: readinessReport(userId, req.today) });
});

// Tervek — a felhasználó saját (terv-építőben mentett) tervei, legújabb elöl.
// A kártya-alak (name/meta/progress) itt áll össze egy helyen; az id/exercises/
// days a kliens szerkesztő-gombjához kell. A progress a MAI teljesítést méri:
// a terv nevével ma mentett edzés = 100%, különben — ha a terv épp az edzés-
// naplóban van (aznapi piszkozat) — a pipált szettek aránya; máskülönben 0.
app.get('/api/plans', (req, res) => {
  const userId = req.user.id;
  const todayDate = req.today;
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
  /* A biztonsági átnézéshez a készenléti riport KELL, de fejenként egyszer
     elég: minden terv ugyanazt a mai állapotot méri. */
  const plans = getUserPlans(userId);
  const safetyOf = plans.length ? planSafetyChecker(userId, todayDate) : () => null;

  res.json(plans.map((plan) => {
    const daysLabel = plan.days.length
      ? ` · ${plan.days.map((d) => DAY_LABELS[d]).join(', ')}`
      : '';
    return {
      id: plan.id,
      name: plan.name,
      meta: `Saját terv · ${plan.exercises.length} gyakorlat${daysLabel}`,
      progress: progressFor(plan),
      own: true,
      /* Mi kockázatos MA ebben a tervben, és miért. A terv NEM íródik át —
         csak megjelöljük; az átírás elrejtené az edző elől, mi történt. */
      safety: safetyOf(plan.exercises),
      exercises: plan.exercises,
      days: plan.days,
    };
  }));
});


/** Terv törlése. Csak a sajátodat — az elfogadott edzői terv is a te sorod
    (az elfogadás másolatot hoz létre), tehát az is kiszedhető. A terv-lista
    eddig KIZÁRÓLAG nőni tudott. */
app.delete('/api/plans/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen terv-azonosító.' });
  }
  if (!deletePlan(req.user.id, id)) {
    return res.status(404).json({ error: 'Nincs ilyen terved — lehet, hogy időközben törölték.' });
  }
  res.status(204).end();
});

app.get('/api/workout-template', (req, res) => res.json(workoutTemplate(req.user.id, req.today)));

/** Egy PR-jelölt gyakorlat-előfordulás listaelemmé alakítása: a detail a
    rekordot hozó szett összegzése, valamint a becsült 1RM az Epley-képlettel.
    A szett kiválasztása a db.js bestCompletedSet-jével történik — ugyanazzal,
    amivel az addWorkout PR-nek jelölte a gyakorlatot. Korábban itt az ELSŐ
    teljesített szett szerepelt, ami a szett-típusok óta jellemzően a
    bemelegítés: a lista a könnyű bemelegítő sorozatot hirdette rekordnak. */
function prEntryFor(userId, workout, exercise) {
  // A mértékegység már nem az értékben van (szám-mezők), ezért itt tesszük hozzá
  const set = bestCompletedSet(exercise.sets);

  // Az Epley-képlettel kiszámított 1RM
  let oneRM = 0;
  if (set && set.weight && set.reps) {
    oneRM = calculateEpley1RM(set.weight, set.reps);
  }

  // Az eddig nyomon követett maximum
  const maxRecord = getExerciseMax(userId, exercise.name);
  // A kerekítés mindkét ágon kell: enélkül a nyomon követett maximum nélküli
  // sorokban a nyers lebegőpontos érték (101.33333333333333) ment ki.
  const rounded = (value) => Math.round(value * 10) / 10;

  return {
    exercise: exercise.name,
    detail: set ? `${set.reps} ism. @ ${set.weight} kg` : workout.name,
    oneRM: oneRM > 0 ? rounded(oneRM) : null, // 1 tizedesjegy pontosság
    maxOneRM: maxRecord ? rounded(maxRecord.max1rm) : rounded(oneRM),
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
  /* A query-paraméter nem feltétlenül sztring: hiányozhat, és ismétlődő
     megadásnál (?exercise=a&exercise=b) az Express TÖMBÖT ad. Mindkét esetben
     a névegyezés sosem teljesült, tehát a végpont üres listával válaszolt —
     ami megkülönböztethetetlen volt attól, hogy a gyakorlathoz tényleg nincs
     rekord. Az ilyen kérés mostantól hangosan hibás, a szerver többi
     végpontjához hasonlóan. Az ISMERT alakú, de ismeretlen nevű gyakorlat
     viszont továbbra is üres lista — az nem hiba, csak nincs még rekordja. */
  const exerciseName = req.query.exercise;
  if (typeof exerciseName !== 'string' || !exerciseName.trim()) {
    return res.status(400).json({
      error: 'Add meg pontosan egy gyakorlat nevét az `exercise` paraméterben.',
    });
  }

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
    mai edzés még előtted áll.
    A mentett edzéseket és a mai napot is a hívó adja át: a getWorkouts() a
    fiókok bevezetése óta kötelező `userId`-t vár, a nap pedig a KLIENS
    naptárából jön (req.today), nem a szerver helyi idejéből. */
function trainingStreak(workouts, today) {
  return streakFromDates(workouts.map((workout) => workout.date), today);
}

/** Ugyanaz, edzés-objektumok helyett puszta NAPOKBÓL. Az edzői panel ezt
    hívja: ott a napok listája a teljes előzményből jön (getWorkoutDates), az
    edzések viszont ablakozva — a sorozat pedig tetszőlegesen régre nyúlhat,
    tehát nem szorítható az ablakba. */
function streakFromDates(dates, today) {
  const trainedDays = new Set(dates.map(dayKey));
  const todayKey = dayKey(today);

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
function readinessReport(userId, todayDate, workouts = getWorkouts(userId)) {
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
    // Az erőfelmérésen bemondott csúcsok: ezekből is lesz gyakorlat-ajánlás,
    // akkor is, ha a fiók még egyetlen edzést sem naplózott.
    declaredMaxes: getDeclaredMaxes(userId),
    today: todayDate,
  });
}

/** Az adott nap hetének hétfője, helyi éjfélre normalizálva (timestamp). */
const mondayOf = (date) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

/** Heti volumen-összehasonlítás a mentett edzésekből: MUNKASOROZATOK naponta,
    erre és a múlt hétre. A két hét közös skálán van, hogy a váltógombbal az
    oszlopok összevethetők legyenek.
    A bemelegítő szettek szándékosan kimaradnak: a „volumen" edzéselméletben
    munkasorozatot jelent, és a Recovery Engine meg a profiloldal is így
    számol — a diagram korábban minden bepipált szettet számolt, tehát
    ugyanarra a hétre nagyobb számot mutatott, mint a profil. */
function volumeCharts(userId, today) {
  const thisMonday = mondayOf(parseDate(today));
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
      .filter(isWorkSet).length;
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
        : `${delta > 0 ? '+' : ''}${delta} munkasorozat a múlt héthez képest`,
      ariaLabel: 'Munkasorozatok naponta — ez a hét',
    },
    volumeLastWeek: {
      heights: heights(lastWeek),
      axis,
      total: totalLast,
      note: 'a múlt hét összes munkasorozata',
      ariaLabel: 'Munkasorozatok naponta — múlt hét',
    },
  };
}

// Chartok — a seed-görbék mellé a szerver számolja a heti volumen-
// összehasonlítást a mentett edzésekből.
app.get('/api/charts', (req, res) => res.json({ ...getCollection('charts'), ...volumeCharts(req.user.id, req.today) }));

// Testsúly-napló — a valódi weight_log táblából
app.get('/api/weight-log', (req, res) => res.json(getWeightLog(req.user.id)));

/** Az étel-lista: elöl a hívó SAJÁT ételei, utánuk a beépített katalógus.
    Ezért nem maradhatott a READ_ENDPOINTS generikus ágán — az felhasználó-
    független kollekciókat szolgál ki. A getCollection('foods') tömbje
    megosztott és cache-elt: a getFoodsForUser ÚJ tömböt képez belőle. */
app.get('/api/foods', (req, res) => res.json(getFoodsForUser(req.user.id)));

// Napi táplálkozási összesítő (alap + a MAI naplózott ételek)
app.get('/api/nutrition', (req, res) => res.json(getNutritionTotals(req.user.id, req.today)));

// A MAI naplózott ételek tételesen — a Táplálkozás oldal „Mai napló" listájához

/* ---- Napi táplálkozási cél ----
   Korábban EGY fix érték szolgálta ki az összes fiókot (data.js →
   nutritionGoal), és sehol nem lehetett szerkeszteni.

   Két forrás van, és mindkettő megmarad: amit az EDZŐ tűzött ki, és amit a
   felhasználó MAGA állított be. Az érvényes cél a sajátja, ha van; különben
   az edzőé. A kettő együtt él tovább, hogy az eltérés látsszon — a néma
   felülírás mindkét irányban rossz volna. */
const GOAL_RANGES = {
  calories: { min: 500, max: 10000, label: 'napi kalória' },
  protein: { min: 0, max: 500, label: 'napi fehérje' },
};

/** A cél törzsének beolvasása. Mindkét mező KÖTELEZŐ: egy fél célhoz nem
    lehet mérni a bevitelt. Hibánál { error }-t ad. */
function parseGoalBody(body) {
  const goal = {};
  for (const [key, { min, max, label }] of Object.entries(GOAL_RANGES)) {
    const raw = body?.[key];
    if (raw === null || raw === undefined || raw === '') {
      return { error: `A(z) ${label} megadása kötelező.` };
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      return { error: `${label}: az érték ${min} és ${max} között adható meg.` };
    }
    goal[key] = Math.round(value);
  }
  return { goal };
}

/** A rám érvényes cél, a származásával együtt. */
app.get('/api/nutrition/goal', (req, res) => res.json(getNutritionGoal(req.user.id)));

/** A SAJÁT cél beállítása. Ez felülírja az edzőit — de nem törli: az edzői
    sor megmarad, és a felület kiírja, hogy eltértél tőle. */
app.put('/api/nutrition/goal', (req, res) => {
  const { goal, error } = parseGoalBody(req.body);
  if (error) return res.status(400).json({ error });
  res.json(saveNutritionGoal(req.user.id, 'own', goal, req.user.id));
});

/** A saját cél elvetése — ezzel visszaállsz az edzői célra (vagy az
    alapértékre). Az edzői sort nem érinti. */
app.delete('/api/nutrition/goal', (req, res) => res.json(clearOwnNutritionGoal(req.user.id)));

/** Az EDZŐ tűz ki célt a sportolójának. A sportoló saját célját szándékosan
    NEM töröljük: ha ő korábban beállított egyet, az marad érvényben, és a
    felület jelzi neki, hogy az edző mást szeretne.
    A kapu ugyanaz, mint a terv-kiosztásé: csak az edző oldala, csak ÉLŐ
    kapcsolatba. */
app.put('/api/athletes/:linkId/nutrition-goal', (req, res) => {
  const link = getCoachLink(Number(req.params.linkId));
  if (!link || link.coachId !== req.user.id || link.status !== 'active') {
    return res.status(404).json({ error: 'Nincs ilyen kapcsolat.' });
  }
  const { goal, error } = parseGoalBody(req.body);
  if (error) return res.status(400).json({ error });
  res.json(saveNutritionGoal(link.athleteId, 'coach', goal, req.user.id));
});

app.get('/api/nutrition/log', (req, res) => res.json(getNutritionLogForDate(req.user.id, req.today)));

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
/** A testsúly elfogadott tartománya. Egy helyen, mert három végpont méri:
    a rögzítés, a javítás és a check-in. */
const WEIGHT_RANGE = { min: 30, max: 300 };

app.post('/api/weight-log', (req, res) => {
  const kg = Number(req.body?.kg);
  if (!Number.isFinite(kg) || kg < WEIGHT_RANGE.min || kg > WEIGHT_RANGE.max) {
    return res.status(400).json({
      error: `Érvénytelen testsúly — ${WEIGHT_RANGE.min} és ${WEIGHT_RANGE.max} kg között adható meg.`,
    });
  }
  // 200, nem 201: a mentés a nap meglévő bejegyzését is felülírhatja.
  res.json(addWeightEntry(req.user.id, kg, req.today));
});

/** Étel naplózása. Törzs: { name, grams }. A szerver a foods-ból keresi ki a
    makrókat (a kliens értékeiben nem bízunk), és a megadott adagra számolja át
    őket. A grams elhagyható — ilyenkor a korábbi viselkedés szerint 100 g.
    A válasz { entry, totals }: a létrejött bejegyzés (a mai napló listájához,
    id-vel a törléshez) és a friss összesítő. */
const MAX_PORTION_GRAMS = 2000;
app.post('/api/nutrition/log', (req, res) => {
  const name = String(req.body?.name ?? '');
  // A saját étel is naplózható; névütközéskor az ÖVÉ nyer (findFoodForUser).
  // Az addNutritionEntry innentől sem tud róla, hogy az étel „saját": a
  // nutrition_log a nevet és a kiszámolt makrókat MÁSOLATBAN tárolja, ezért a
  // saját étel későbbi törlése a régi bejegyzéseket és összesítőket nem sérti.
  const food = findFoodForUser(req.user.id, name);
  if (!food) {
    return res.status(400).json({ error: 'Ismeretlen étel — csak a listában szereplő adható a naplóhoz.' });
  }

  const grams = req.body?.grams === undefined ? 100 : Number(req.body.grams);
  if (!Number.isFinite(grams) || grams < 1 || grams > MAX_PORTION_GRAMS) {
    return res.status(400).json({
      error: `Érvénytelen adag — 1 és ${MAX_PORTION_GRAMS} g között adható meg.`,
    });
  }

  res.status(201).json(addNutritionEntry(req.user.id, food, req.today, Math.round(grams)));
});


/** Testsúly-bejegyzés javítása. CSAK az érték — a dátum nem adható meg: a
    javítás nem áthelyezés (ugyanaz az elv, mint a mentett edzésnél). */
app.put('/api/weight-log/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen bejegyzés-azonosító.' });
  }
  const kg = Number(req.body?.kg);
  if (!Number.isFinite(kg) || kg < WEIGHT_RANGE.min || kg > WEIGHT_RANGE.max) {
    return res.status(400).json({
      error: `A testsúly ${WEIGHT_RANGE.min} és ${WEIGHT_RANGE.max} kg között adható meg.`,
    });
  }
  const updated = updateWeightEntry(req.user.id, id, kg);
  if (!updated) return res.status(404).json({ error: 'Nincs ilyen bejegyzésed.' });
  res.json(updated);
});

/** Testsúly-bejegyzés törlése. Egy elgépelt, kiugró érték a trend-kártya
    skáláját lapos vonallá nyomja — eddig nem volt út a javításához. */
app.delete('/api/weight-log/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen bejegyzés-azonosító.' });
  }
  if (!deleteWeightEntry(req.user.id, id)) {
    return res.status(404).json({ error: 'Nincs ilyen bejegyzésed.' });
  }
  res.status(204).end();
});


/** Naplóbejegyzés adagjának javítása. A makrók arányosan számolódnak át a
    tárolt értékekből — a nutrition_log szándékosan másolatban tárolja őket.
    A RÉGEBBI napok is javíthatók: az elgépelt adag ott is alulméri a napi
    bevitelt, ami a készenlét táplálkozás-komponensébe is beszivárog. */
app.put('/api/nutrition/log/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen bejegyzés-azonosító.' });
  }
  const grams = Number(req.body?.grams);
  if (!Number.isFinite(grams) || grams < 1 || grams > MAX_PORTION_GRAMS) {
    return res.status(400).json({ error: `Az adag 1 és ${MAX_PORTION_GRAMS} gramm között adható meg.` });
  }
  const updated = updateNutritionEntry(req.user.id, id, Math.round(grams));
  if (!updated) return res.status(404).json({ error: 'Nincs ilyen bejegyzésed.' });
  res.json(updated);
});

/** Naplóbejegyzés törlése (visszavonás). Csak a mai bejegyzés törölhető;
    a válasz a frissített napi összesítő. */
app.delete('/api/nutrition/log/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen bejegyzés-azonosító.' });
  }
  const totals = deleteNutritionEntry(req.user.id, id, req.today);
  if (!totals) {
    return res.status(404).json({ error: 'Ez a bejegyzés nem törölhető — csak a mai napló módosítható.' });
  }
  res.json(totals);
});

/* ======================================================================
   Saját ételek + vonalkód
   ----------------------------------------------------------------------
   A beépített katalógus 437 általános referencia-étel. Egy konkrét bolti
   termék tápértéke ettől jócskán eltérhet (két csokoládé között 100 kcal is
   lehet), ezért a felhasználó felvihet sajátot — kézzel, vagy a csomagolás
   vonalkódjáról, az Open Food Facts adataival előre kitöltve.
   ====================================================================== */

const CUSTOM_NAME_MIN = 2;
const CUSTOM_NAME_MAX = 60;
const MACRO_MAX = 100;        // g / 100 g — ennél több fizikailag nem fér bele
const MACRO_SUM_MAX = 100.5;  // fél gramm tűrés a kerekítésnek
const KCAL_MAX = 900;         // 100 g tiszta zsír ~900 kcal
/** Atwater-tényezők: ennyi kcal-t ad egy gramm makrotápanyag. */
const ATWATER = { protein: 4, carbs: 4, fat: 9 };

/** Egy makró-mező: véges szám, 0 és 100 g között, egy tizedesre kerekítve
    (mint a nutrition_log-ban) — érvénytelenre null. */
const macroValue = (raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MACRO_MAX) return null;
  return Math.round(value * 10) / 10;
};

/** Adag-előbeállítások: [['1 adag', 150], …] — max 4 db, 1–2000 g/ml.
    A rosszul megadott elemeket csendben eldobjuk: ez kényelmi mező, nem
    kötelező adat, egy hibás gyorsgomb miatt nem érdemes elutasítani a mentést. */
const normalizePortions = (raw) => (Array.isArray(raw) ? raw : [])
  .map((portion) => [String(portion?.[0] ?? '').trim().slice(0, 24), Math.round(Number(portion?.[1]))])
  .filter(([label, value]) => label && Number.isFinite(value) && value >= 1 && value <= MAX_PORTION_GRAMS)
  .slice(0, 4);

/** Saját étel felvitele. Törzs:
      { name, group?, unit?, brand?, protein, carbs, fat,
        kcal?, kcalMode?, barcode?, portions?, source? }

    A makrók 100 g / 100 ml alapmennyiségre értendők — ugyanúgy, mint a
    beépített katalógusban, így a naplózás semmit nem tud meg arról, hogy az
    étel „saját".

    A kalóriát ALAPBÓL a szerver számolja az Atwater-tényezőkkel (4/4/9), a
    felület pedig élőben mutatja ugyanezt. Ha a felhasználó felülírja
    (kcalMode: 'manual'), elfogadjuk — a csomagoláson lévő érték a rost, a
    poliolok és az alkohol miatt jogosan eltérhet —, de csak ésszerű sávban: a
    képlettől való nagy eltérés jóval valószínűbben elgépelés, mint tény. */
app.post('/api/foods/custom', (req, res) => {
  const name = String(req.body?.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < CUSTOM_NAME_MIN || name.length > CUSTOM_NAME_MAX) {
    return res.status(400).json({
      error: `Az étel neve ${CUSTOM_NAME_MIN} és ${CUSTOM_NAME_MAX} karakter között lehet.`,
    });
  }

  const unit = req.body?.unit === 'ml' ? 'ml' : 'g';

  const group = String(req.body?.group ?? '').trim();
  if (group && !FOOD_GROUPS.includes(group)) {
    return res.status(400).json({ error: 'Ismeretlen kategória.' });
  }

  const protein = macroValue(req.body?.protein);
  const carbs = macroValue(req.body?.carbs);
  const fat = macroValue(req.body?.fat);
  if (protein === null || carbs === null || fat === null) {
    return res.status(400).json({
      error: `A fehérje, a szénhidrát és a zsír 0 és ${MACRO_MAX} g között adható meg (100 ${unit}-ra).`,
    });
  }
  if (protein + carbs + fat > MACRO_SUM_MAX) {
    return res.status(400).json({
      error: `A három makró összege nem lehet több 100 g-nál 100 ${unit}-ban.`,
    });
  }

  const computed = Math.round(
    protein * ATWATER.protein + carbs * ATWATER.carbs + fat * ATWATER.fat,
  );
  let kcal = computed;
  const manual = req.body?.kcalMode === 'manual' && req.body?.kcal !== undefined;
  if (manual) {
    const raw = Number(req.body.kcal);
    if (!Number.isFinite(raw) || raw < 0 || raw > KCAL_MAX) {
      return res.status(400).json({
        error: `A kalória 0 és ${KCAL_MAX} kcal között adható meg (100 ${unit}-ra).`,
      });
    }
    // Tűrés: a nagyobbik a fix 50 kcal-ból és a számított 30%-ából. A fix
    // alsó határ a kis értékek miatt kell (10 kcal-nál a 30% három kcal lenne).
    const tolerance = Math.max(50, Math.round(computed * 0.3));
    if (Math.abs(raw - computed) > tolerance) {
      return res.status(400).json({
        error: `A megadott ${Math.round(raw)} kcal nem fér össze a makrókkal `
             + `(a képlet szerint ${computed} kcal). Ellenőrizd a makrókat, `
             + 'vagy számoltasd újra a kalóriát.',
      });
    }
    kcal = Math.round(raw);
  }

  let barcode = null;
  const rawBarcode = req.body?.barcode;
  if (rawBarcode !== undefined && rawBarcode !== null && rawBarcode !== '') {
    barcode = normalizeBarcode(rawBarcode);
    if (!barcode) {
      return res.status(400).json({
        error: 'Érvénytelen vonalkód — 8, 12, 13 vagy 14 számjegy, helyes ellenőrzőszámmal.',
      });
    }
  }

  // A név NEM ütközhet a beépített katalógussal: a naplózás NÉVVEL hivatkozik
  // az ételre, két azonos név eltérő tápértékkel megfejthetetlen lenne.
  if ((getCollection('foods') || []).some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'Ez a név szerepel az alap étel-listában — válassz másikat.' });
  }

  const saved = addCustomFood(req.user.id, {
    name,
    brand: String(req.body?.brand ?? '').trim().slice(0, 60),
    group,
    unit,
    kcal,
    protein,
    carbs,
    fat,
    kcalAuto: !manual,
    barcode,
    portions: normalizePortions(req.body?.portions),
    source: req.body?.source === 'openfoodfacts' ? 'openfoodfacts' : 'manual',
  });
  if (!saved) {
    return res.status(409).json({ error: 'Már van ilyen nevű vagy ilyen vonalkódú saját ételed.' });
  }
  res.status(201).json(saved);
});

/** Saját étel törlése. A MÁR LENAPLÓZOTT bejegyzéseket nem érinti: a
    nutrition_log a nevet és a makrókat másolatban tárolja, a korábbi napok
    összesítői tehát nem változnak meg visszamenőleg. */
app.delete('/api/foods/custom/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen étel-azonosító.' });
  }
  if (!deleteCustomFood(req.user.id, id)) {
    return res.status(404).json({ error: 'Nincs ilyen saját ételed.' });
  }
  res.status(204).end();
});

/** Vonalkód feloldása. A keresés sorrendje — minden lépés megspórol egy
    hálózati kört a következőhöz képest:
      1. a hívó SAJÁT, ilyen vonalkódú étele → a felület egyből naplózásra
         kínálja, nem kérdezi meg újra a tápértékeket;
      2. friss cache-sor (barcode_cache);
      3. Open Food Facts (szerver-oldali proxy, azonosított User-Agenttel).
    A válasz `source` mezője megmondja, honnan jött — a felület ebből tudja,
    hogy „mentve" vagy „kitöltendő" állapotot mutasson. */
app.get('/api/foods/barcode/:code', async (req, res) => {
  const barcode = normalizeBarcode(req.params.code);
  if (!barcode) {
    return res.status(400).json({
      error: 'Érvénytelen vonalkód — 8, 12, 13 vagy 14 számjegy, helyes ellenőrzőszámmal.',
    });
  }

  const own = getCustomFoodByBarcode(req.user.id, barcode);
  if (own) return res.json({ source: 'saved', barcode, food: own });

  const notFound = { error: 'Ezt a vonalkódot az Open Food Facts sem ismeri — vidd fel kézzel.' };

  const cached = readBarcodeCache(barcode);
  if (cached) {
    return cached.found
      ? res.json({ source: 'cache', barcode, product: cached.product })
      : res.status(404).json(notFound);
  }

  const result = await fetchProduct(barcode);
  if (!result.ok) {
    // Hálózati hiba: NEM cache-eljük — holnap (vagy egy perc múlva) sikerülhet.
    return res.status(502).json({
      error: 'Az Open Food Facts most nem elérhető — próbáld később, vagy vidd fel kézzel.',
    });
  }
  writeBarcodeCache(barcode, result.product);
  if (!result.product) return res.status(404).json(notFound);
  res.json({ source: 'openfoodfacts', barcode, product: result.product });
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
/** Egy szett szám-mezője (ism./súly) normalizálva.

    A mező SZÖVEG marad — a régi, mértékegységgel együtt mentett értékeket
    („12 rep", „60% TM") nem bántjuk. Ami viszont számként olvasható, az nem
    lehet negatív: a negatív súly negatív tonnatömeget adna, és a Recovery
    Engine fáradtság-modelljében LEVONÓDNA — egy hamis sorral felfelé lehetne
    tolni a saját készenléti pontszámot. */
function nonNegativeField(value) {
  const text = String(value ?? '').slice(0, 20);
  const parsed = Number(text);
  if (Number.isFinite(parsed) && parsed < 0) return '0';
  return text;
}

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
        reps: nonNegativeField(set?.reps),
        weight: nonNegativeField(set?.weight),
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
  res.status(201).json(addPlan(req.user.id, plan.name, req.today, plan.exercises, plan.days));
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

/** Az edzés-törzs (name/exercises) közös validálása — a mentés és a javítás
    ugyanazt követeli meg. Hibánál { error }-t ad, a parsePlanBody mintájára. */
function parseWorkoutBody(body) {
  const name = String(body?.name ?? '').trim();
  if (!name || name.length > 60) {
    return { error: 'Az edzés neve kötelező (legfeljebb 60 karakter).' };
  }
  const exercises = normalizeExercises(body?.exercises);
  if (!exercises) {
    return { error: 'Az edzésnek legalább egy érvényes gyakorlatot kell tartalmaznia.' };
  }
  return { name, exercises };
}

/** Edzés mentése. Törzs: { name, exercises }. A dátumot a szerver adja. */
app.post('/api/workouts', (req, res) => {
  const workout = parseWorkoutBody(req.body);
  if (workout.error) return res.status(400).json({ error: workout.error });
  res.status(201).json(
    addWorkout(req.user.id, workout.name, req.today, workout.exercises, parseRowId(req.body?.planId)),
  );
});



/* ======================================================================
   Megjegyzések egy gyakorlathoz
   ----------------------------------------------------------------------
   Nem üzenetek: az edző–sportoló beszélgetés a messages táblában él. Ez egy
   konkrét gyakorlathoz tapad („fájt a vállam a 3. szettnél"), és ugyanabban a
   szálban látszik mindkét fél megjegyzése.

   A CÍMZÉS a ház szabályát követi: a saját megjegyzéseidet id nélkül éred el,
   a sportolódéit a KAPCSOLAT azonosítójával. A sportoló belső user-id-je nem
   kerül ki az edzőhöz — erre külön teszt is van (coach.test.js).
   ====================================================================== */

const COMMENT_TYPE = 'exercise';
const COMMENT_MAX_LENGTH = 1000;

/** A szöveg beolvasása. Hibánál { error }-t ad. */
function parseCommentBody(body) {
  const text = String(body?.text ?? '').trim();
  if (!text) return { error: 'Üres megjegyzést nem mentünk el.' };
  if (text.length > COMMENT_MAX_LENGTH) {
    return { error: `Legfeljebb ${COMMENT_MAX_LENGTH} karakter.` };
  }
  return { text };
}

/** A kapcsolat sportolójának azonosítója, ha a hívó az EDZŐ oldala és a
    kapcsolat él — különben null (a válasz ilyenkor 404). */
function athleteOfLink(user, rawLinkId) {
  const link = getCoachLink(Number(rawLinkId));
  if (!link || link.coachId !== user.id || link.status !== 'active') return null;
  return link.athleteId;
}

/* ---- A saját megjegyzéseim ---- */

app.get('/api/comments', (req, res) => {
  const target = String(req.query.target ?? '');
  res.json(getComments(req.user.id, COMMENT_TYPE, target));
});

app.get('/api/comments/by-target', (req, res) => {
  res.json(getCommentsByTarget(req.user.id, COMMENT_TYPE));
});

app.post('/api/comments', (req, res) => {
  const { text, error } = parseCommentBody(req.body);
  if (error) return res.status(400).json({ error });
  const target = String(req.body?.targetId ?? '');
  res.status(201).json(addComment(req.user.id, req.user.id, COMMENT_TYPE, target, text));
});

app.delete('/api/comments/:commentId', (req, res) => {
  const commentId = Number(req.params.commentId);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    return res.status(400).json({ error: 'Érvénytelen azonosító.' });
  }
  if (!deleteComment(commentId, req.user.id)) {
    return res.status(404).json({ error: 'Nincs ilyen megjegyzésed.' });
  }
  res.status(204).end();
});

/* ---- A sportolóm megjegyzései (az EDZŐ oldala) ---- */

app.get('/api/athletes/:linkId/comments', (req, res) => {
  const athleteId = athleteOfLink(req.user, req.params.linkId);
  if (athleteId === null) return res.status(404).json({ error: 'Nincs ilyen kapcsolat.' });
  const target = String(req.query.target ?? '');
  res.json(getComments(athleteId, COMMENT_TYPE, target));
});

/** Az edzői megjegyzés UGYANABBA a szálba megy, csak más szerzővel — ettől
    lesz egy beszélgetés a gyakorlatról, nem két külön lista. */
app.post('/api/athletes/:linkId/comments', (req, res) => {
  const athleteId = athleteOfLink(req.user, req.params.linkId);
  if (athleteId === null) return res.status(404).json({ error: 'Nincs ilyen kapcsolat.' });
  const { text, error } = parseCommentBody(req.body);
  if (error) return res.status(400).json({ error });
  const target = String(req.body?.targetId ?? '');
  res.status(201).json(addComment(req.user.id, athleteId, COMMENT_TYPE, target, text));
});


/* ---- Erőfelmérés (fresh start) ----
   A friss fiók ma hetekig „vakon" használja az appot: a gyakorlat-ajánlások
   három naplózott alkalmat kérnek (recovery.js → MIN_SESSIONS), a három fő
   emelés kivételével. Az erőfelmérésen a felhasználó BEMONDJA, mit tud —
   ebből a motor azonnal tud ajánlani.

   Amit NEM teszünk: a felmérést nem írjuk be edzésként a naplóba. Az
   hazudna egy meg nem történt edzést a sorozatba és a volumen-diagramba.
   A bemondott érték külön forrásként él (exercise_maxes.source = 'declared'),
   és a riport `basis` mezője kimondja, min alapul az ajánlás. */
const ASSESSMENT_MAX_ENTRIES = 12;
const ASSESSMENT_RANGES = { weight: [1, 500], reps: [1, 30] };

/** Az erőfelmérés rögzítése. Törzs: { entries: [{ exercise, weight, reps }] }.
    A gyakorlatnak a KATALÓGUSBAN kell lennie — kitalált névre nem építünk
    ajánlást, mert az izomcsoportjait sem ismernénk. */
app.post('/api/strength-assessment', (req, res) => {
  const raw = req.body?.entries;
  if (!Array.isArray(raw) || raw.length === 0) {
    return res.status(400).json({ error: 'Adj meg legalább egy gyakorlatot.' });
  }
  if (raw.length > ASSESSMENT_MAX_ENTRIES) {
    return res.status(400).json({ error: `Legfeljebb ${ASSESSMENT_MAX_ENTRIES} gyakorlat.` });
  }

  const catalog = getCollection('exerciseCatalog') || [];
  const known = new Map(catalog.map((item) => [normalizeName(item.name), item.name]));

  const parsed = [];
  for (const entry of raw) {
    const name = known.get(normalizeName(String(entry?.exercise ?? '')));
    if (!name) {
      return res.status(400).json({ error: `Ismeretlen gyakorlat: ${String(entry?.exercise ?? '')}` });
    }
    for (const [key, [min, max]] of Object.entries(ASSESSMENT_RANGES)) {
      const value = Number(entry?.[key]);
      if (!Number.isFinite(value) || value < min || value > max) {
        return res.status(400).json({ error: `${name}: a(z) ${key} ${min} és ${max} között adható meg.` });
      }
    }
    // Ugyanaz az Epley-képlet, amivel a naplózott szettek is számolnak.
    parsed.push({ name, max1rm: calculateEpley1RM(entry.weight, entry.reps) });
  }

  const stored = parsed.map(({ name, max1rm }) => {
    const result = setDeclaredMax(req.user.id, name, max1rm, req.today);
    return {
      exercise: name,
      // A ténylegesen ÉRVÉNYES csúcs kerekítve — ha volt mért érték, az marad.
      max1rm: Math.round(result.max1rm * 10) / 10,
      stored: result.stored,
    };
  });

  res.status(201).json({ entries: stored, readiness: readinessReport(req.user.id, req.today) });
});

/** A bemondott csúcsok — a felmérés űrlapja ebből tölti fel magát újranyitáskor. */
app.get('/api/strength-assessment', (req, res) => res.json(getDeclaredMaxes(req.user.id)));

/* ---- Edzés utáni visszajelzés ----
   STRUKTURÁLT mező, nem üzenet: a nehézség és a közérzet számként tárolódik,
   tehát később elemezhető. A szabad szöveg mellette fut. Mindhárom
   elhagyható — a „nem küldött" és a „rosszat jelzett" két külön dolog. */
const FEEDBACK_NOTE_MAX = 500;

/** Edzés utáni visszajelzés küldése a SAJÁT edzésre. Az adatréteg a user_id-re
    is szűr, tehát idegen edzés id-jére nem talál sort → 404. */
app.put('/api/workouts/:id/feedback', (req, res) => {
  const workoutId = Number(req.params.id);
  if (!Number.isInteger(workoutId) || workoutId <= 0) {
    return res.status(400).json({ error: 'Érvénytelen azonosító.' });
  }

  const fields = {};
  for (const [key, label] of [['difficulty', 'nehézség'], ['mood', 'közérzet']]) {
    const raw = req.body?.[key];
    if (raw === null || raw === undefined || raw === '') {
      fields[key] = null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return res.status(400).json({ error: `${label}: az érték 1 és 5 között adható meg.` });
    }
    fields[key] = value;
  }
  const note = String(req.body?.note ?? '').trim();
  if (note.length > FEEDBACK_NOTE_MAX) {
    return res.status(400).json({ error: `A megjegyzés legfeljebb ${FEEDBACK_NOTE_MAX} karakter.` });
  }
  fields.note = note || null;

  const updated = saveWorkoutFeedback(req.user.id, workoutId, fields);
  if (!updated) return res.status(404).json({ error: 'Nincs ilyen edzésed.' });
  res.json(updated);
});

/**
 * Mentett edzés javítása. Törzs: { name, exercises } — ugyanaz, mint a mentésé.
 *
 * A DÁTUMOT szándékosan nem lehet megadni: az edzés a saját napján marad. A
 * javítás nem áthelyezés, és a szerver amúgy sem enged tetszőleges napra írni
 * (ld. az X-Client-Date ellenőrzését) — a javított edzés mai edzéssé válása
 * elcsúsztatná a sorozatot, a heti volument és a készenlét 28 napos ablakát.
 */
app.put('/api/workouts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen edzés-azonosító.' });
  }
  const workout = parseWorkoutBody(req.body);
  if (workout.error) return res.status(400).json({ error: workout.error });

  const updated = updateWorkout(req.user.id, id, workout.name, workout.exercises);
  if (!updated) return res.status(404).json({ error: 'Nincs ilyen edzés — lehet, hogy időközben törölték.' });
  res.json(updated);
});

/** Mentett edzés törlése. Az egyéni csúcsok újraszámolása az adatrétegben
    történik (deleteWorkout) — a napló és a rekordok csak együtt igazak. */
app.delete('/api/workouts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Érvénytelen edzés-azonosító.' });
  }
  if (!deleteWorkout(req.user.id, id)) {
    return res.status(404).json({ error: 'Nincs ilyen edzés — lehet, hogy időközben törölték.' });
  }
  res.status(204).end();
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
  res.json(saveWorkoutDraft(
    req.user.id, name, exercises, req.today,
    parseRowId(req.body?.planId), parseRowId(req.body?.workoutId),
  ));
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

/* A ZXing vonalkód-dekóder UMD-bundle-je. Bundler nincs a projektben, a
   public/ mappát viszont nem szemeteljük tele egy 336 KB-os függőség
   másolatával — ezért a node_modules-ból EZT AZ EGY mappát tesszük ki,
   semmi mást. A frontend lustán, csak a szkennelés indításakor tölti be, és
   ha a csomag nincs telepítve, a 404-re a kézi vonalkód-beírásra vált.
   A statikus kiszolgálás nem enged ki a mappából (az express.static a
   ../-t tartalmazó útvonalakat elutasítja), tehát a node_modules többi
   része továbbra sem érhető el. */
app.use('/vendor/zxing', express.static(
  path.join(__dirname, '..', 'node_modules', '@zxing', 'library', 'umd'),
));

app.use(express.static(PUBLIC_DIR));

/* A TÉNYLEGESEN kiosztott portot írjuk ki, nem a kért PORT-ot. A kettő
   rendszerint ugyanaz, de PORT=0 esetén az operációs rendszer választ szabad
   portot — így indul a végponti teszt (server/api.test.js) is, ami ebből a
   sorból olvassa ki, hova küldje a kéréseket. */
const server = app.listen(PORT, () => {
  console.log(`FitTrack Pro szerver fut: http://localhost:${server.address().port}`);
});
