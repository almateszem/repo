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
  getCheckin, getCheckins, saveCheckin, hasAnyCheckin,
  calculateEpley1RM, bestCompletedSet, getExerciseMax, getAllExerciseMaxes,
  createUser, getUserWithHash, hasAnyUser,
  createSession, getSessionUser, deleteSession, purgeExpiredSessions,
  findUserByUsername, setCoachRole, isCoachOf,
  inviteClient, acceptInvite, removeCoachLink,
  listClientsOfCoach, listCoachesOfClient,
  getPlanById, updateAssignedPlan,
  addNotification, getNotifications, markNotificationsRead,
} from './db.js';
import {
  hashPassword, verifyPassword, createSessionToken, hashToken,
  parseCookies, serializeCookie, isLockedOut, recordFailure, clearFailures,
  USERNAME_RE, PASSWORD_MIN, normalizeUsername,
} from './auth.js';
// A készenlét-motor és a közös dátum-segédek. A dátumkezelés szándékosan egy
// helyen (recovery.js) lakik, hogy a szerver és a motor sose csússzon el.
import { computeReadiness, parseDate, dayKey, DAY_MS } from './recovery.js';
import { MUSCLE_KEYS, MUSCLE_GROUPS, resolveExerciseLoad } from './muscles.js';

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

/** A fiók-objektum kiegészítése az `onboarding` jelzővel: igaz, amíg a fiók
    egyetlen check-int sem mentett. A felület ilyenkor a check-in varázslóra
    tereli — enélkül a friss fiók üres Áttekintésre érkezne, ahol a Recovery
    Engine (helyesen) `null` készenlétet mutat, mert nincs mire alapoznia.
    Azért „soha nem volt check-inje" és nem „most regisztrált": ez utóbbi
    csak a kliens pillanatnyi állapota lenne, ez viszont túléli a frissítést. */
const withOnboarding = (user) => ({ ...user, onboarding: !hasAnyCheckin(user.id) });

/** Beléptetve vagyok-e? A felület ezzel dönti el, mutassa-e a belépő
    képernyőt. A firstRun jelzi, hogy még egyetlen fiók sincs — ilyenkor a
    felület rögtön a regisztrációt kínálja. */
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
  const parsed = parseCredentials(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const displayName = String(req.body?.displayName ?? '').trim().slice(0, 40) || parsed.username;

  const created = createUser(parsed.username, displayName, await hashPassword(parsed.password));
  if (!created) return res.status(409).json({ error: 'Ez a felhasználónév már foglalt.' });

  startSession(req, res, created.user.id);
  /* Az onboarding itt majdnem mindig igaz — kivéve az ELSŐ fiókot, ha az
     megörökölte a fiókok előtti check-ineket (adoptLegacyData). */
  res.status(201).json({
    ...withOnboarding(created.user),
    adoptedLegacy: created.adoptedLegacy,
  });
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
  '/api/default-set': 'defaultSet',
  '/api/exercise-catalog': 'exerciseCatalog',
  '/api/athlete-replies': 'athleteReplies',
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

/* A profil-végpont. A NÉV és a SZEREPKÖRÖK is a bejelentkezett fiókból
   jönnek — korábban a szerepkör-jelzők a seedből származtak, tehát mindenki
   ugyanazt a demo-beállítást kapta.
     · coachesAthletes = a users.is_coach jelző (a felhasználó maga kapcsolja),
     · hasCoach        = van-e ELFOGADOTT coach_clients sora. Ez szándékosan
       nem külön jelző: így nem lehet edző nélkül „edzőset" mutatni. */
app.get('/api/user', (req, res) => {
  const seedUser = getCollection('user') || {};
  res.json({
    ...seedUser,
    name: req.user.displayName,
    username: req.user.username,
    coachesAthletes: req.user.isCoach,
    hasCoach: listCoachesOfClient(req.user.id).length > 0,
  });
});

/* ======================================================================
   Edző–kliens kapcsolat
   ----------------------------------------------------------------------
   Idáig az Edző oldal minden adata a seedből jött (fix sportolók, fix
   készenlét). Innentől valódi: az edző MEGHÍVJA a klienst, a kliens
   ELFOGADJA, és az edzői panel a kliens tényleges naplóiból számol.

   A kereszt-fiók olvasás egyetlen kapuja a resolveClientId — minden olyan
   végpontnak ezen kell átmennie, amelyik nem a saját fiók adatát adja
   vissza. Az izolációt a server/coach.test.js őrzi.
   ====================================================================== */

/** Hány napja volt az adott dátum? (0 = ma). Ismeretlen dátumra null. */
const daysSince = (dateStr) => (dateStr ? Math.round((dayKey(today()) - dayKey(dateStr)) / DAY_MS) : null);

/** Emberi címke a napok számából — a kártya „Utolsó edzés" statjához. */
function relativeDay(dateStr) {
  const days = daysSince(dateStr);
  if (days === null) return 'nincs';
  if (days <= 0) return 'ma';
  if (days === 1) return 'tegnap';
  return `${days} napja`;
}

/** A terv-követés a legutóbbi 4 hétre: az ütemezett napok hány százalékán
    volt tényleg edzés.

    Két nap NEM számít bele, és mindkét kizárás szándékos:
      · a MAI — a mai edzés még előtte lehet, mulasztásnak venni igazságtalan;
      · minden nap, amelyre az adott terv MÉG NEM LÉTEZETT — egy tegnap
        felvett heti terv nem tehet visszamenőleg mulasztóvá senkit.
    Ha így egyetlen mérhető nap sem marad (új fiók, friss terv, vagy nincs
    napra tett terv), az eredmény null: a felület „—"-t ír, nem 0%-ot.
    Egy kitalált 0% ugyanis pontosan az ellenkezőjét állítaná a valóságnak. */
const ADHERENCE_DAYS = 28;
function adherenceOf(workouts, plans) {
  const scheduled = plans.filter((plan) => plan.days.length > 0);
  if (scheduled.length === 0) return null;

  const trained = new Set(workouts.map((workout) => dayKey(workout.date)));
  const todayKeyValue = dayKey(today());
  let expected = 0;
  let done = 0;
  for (let i = 1; i <= ADHERENCE_DAYS; i += 1) {
    const stamp = todayKeyValue - i * DAY_MS;
    const weekday = (new Date(stamp).getDay() + 6) % 7;
    const wasScheduled = scheduled.some(
      (plan) => plan.days.includes(weekday) && dayKey(plan.date) <= stamp,
    );
    if (!wasScheduled) continue;
    expected += 1;
    if (trained.has(stamp)) done += 1;
  }
  return expected === 0 ? null : Math.round((done / expected) * 100);
}

/** „3/4" — ezen a héten hány NAPON edzett, a heti ütemezett napokhoz mérve.
    Ütemezés nélkül csak a megtett edzésnapok száma látszik. */
function weeklyLabel(workouts, plans) {
  const thisMonday = mondayOf(new Date());
  const trainedDays = new Set(
    workouts.filter((w) => mondayOf(parseDate(w.date)) === thisMonday).map((w) => dayKey(w.date)),
  ).size;
  const scheduled = new Set(plans.flatMap((plan) => plan.days)).size;
  return scheduled > 0 ? `${trainedDays}/${scheduled}` : String(trainedDays);
}

/** A kliens legutóbbi tényleges eseményei — edzés, PR, check-in, testsúly.
    Kitalált szöveg nincs benne: ami nincs naplózva, az nem jelenik meg. */
const ACTIVITY_LIMIT = 5;
function recentActivity(userId, workouts) {
  const events = [];

  for (const workout of workouts) {
    events.push({ date: workout.date, text: `${workout.name} — ${relativeDay(workout.date)}` });
    for (const exercise of workout.exercises) {
      if (exercise.pr) {
        events.push({ date: workout.date, text: `Új PR: ${exercise.name} — ${relativeDay(workout.date)}` });
      }
    }
  }
  for (const checkin of getCheckins(userId, 10)) {
    events.push({ date: checkin.date, text: `Check-in kitöltve — ${relativeDay(checkin.date)}` });
  }
  for (const entry of getWeightLog(userId).slice(-3)) {
    events.push({ date: entry.date, text: `Testsúly: ${entry.kg} kg — ${relativeDay(entry.date)}` });
  }

  return events
    .sort((a, b) => dayKey(b.date) - dayKey(a.date))
    .slice(0, ACTIVITY_LIMIT)
    .map((event) => event.text);
}

/** A figyelmeztetés SORRENDBEN: a legsürgetőbb ok nyer. Mindegyik tényleges
    adathiányból vagy tényleges értékből jön, nem becslésből. */
const STALE_WORKOUT_DAYS = 7;
const STALE_CHECKIN_DAYS = 3;
const LOW_READINESS = 60;
function clientAlert({ workouts, checkins, overall, lastWorkoutDate }) {
  if (workouts.length === 0 && checkins.length === 0) return 'Még nincs naplózott adata';
  if (workouts.length === 0) return 'Még nem naplózott edzést';

  const sinceWorkout = daysSince(lastWorkoutDate);
  if (sinceWorkout >= STALE_WORKOUT_DAYS) return `${sinceWorkout} napja nem edzett`;
  if (overall < LOW_READINESS) return `Alacsony készenlét (${overall})`;

  const sinceCheckin = daysSince(checkins[0]?.date);
  if (sinceCheckin === null || sinceCheckin >= STALE_CHECKIN_DAYS) return 'Nincs friss check-in';
  return null;
}

/** Egy kliens kártyaadata az edzői panelhez — MINDEN mezője számolt érték.
    A készenlét-motort kliensenként egyszer futtatjuk (~10-20 ms): pár
    kliensnél ez rendben van, száznál már gyorsítótár kellene. */
function clientCard(link) {
  const userId = link.client.id;
  const workouts = getWorkouts(userId);
  const plans = getUserPlans(userId);
  const checkins = getCheckins(userId, 30);
  const readiness = readinessReport(userId, workouts);

  const lastWorkoutDate = workouts.length
    ? workouts.reduce((latest, w) => (dayKey(w.date) > dayKey(latest) ? w.date : latest), workouts[0].date)
    : null;
  const activePlan = getPlanForDay(userId, todayWeekday()) || plans[0] || null;

  return {
    linkId: link.id,
    id: String(userId),
    name: link.client.name,
    username: link.client.username,
    readiness: readiness.overall,
    // A megbízhatóság végigkíséri a számot: az edző lássa, mennyi adat van mögötte.
    readinessConfidence: readiness.confidence,
    adherence: adherenceOf(workouts, plans),
    streak: trainingStreak(workouts),
    lastWorkout: relativeDay(lastWorkoutDate),
    weekly: weeklyLabel(workouts, plans),
    plan: activePlan ? activePlan.name : null,
    alert: clientAlert({ workouts, checkins, overall: readiness.overall, lastWorkoutDate }),
    recent: recentActivity(userId, workouts),
  };
}

/** Az Edző oldal EGY lekérésben: a saját szerepköröm, a klienseim kártyái,
    a kiküldött és a beérkezett meghívások, és az edzőim. */
app.get('/api/coach/overview', (req, res) => {
  const me = req.user;
  res.json({
    isCoach: me.isCoach,
    clients: listClientsOfCoach(me.id).map(clientCard),
    invitesSent: listClientsOfCoach(me.id, 'pending'),
    coaches: listCoachesOfClient(me.id),
    invitesReceived: listCoachesOfClient(me.id, 'pending'),
  });
});

/** Edzői szerepkör be-/kikapcsolása. Ez CSAK a felületet nyitja meg — adatot
    önmagában nem tesz elérhetővé, ahhoz elfogadott kapcsolat kell. */
app.post('/api/coach/role', (req, res) => {
  res.json(setCoachRole(req.user.id, Boolean(req.body?.isCoach)));
});

/** Meghívás felhasználónévre. A kliensnek el kell fogadnia — enélkül az edző
    semmit nem lát belőle.
    (A „nincs ilyen felhasználó" válasz elárulja, foglalt-e egy név. Ez a
    regisztrációnál úgyis kiderül, a meghíváshoz viszont elengedhetetlen a
    visszajelzés — különben az elgépelt név némán nyelődne el.) */
app.post('/api/coach/invites', (req, res) => {
  if (!req.user.isCoach) {
    return res.status(403).json({ error: 'Ehhez előbb kapcsold be az edzői szerepkört a Beállításokban.' });
  }
  const username = normalizeUsername(req.body?.username);
  if (!username) return res.status(400).json({ error: 'Adj meg egy felhasználónevet.' });

  const target = findUserByUsername(username);
  if (!target) return res.status(404).json({ error: 'Nincs ilyen felhasználó.' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Magadat nem hívhatod meg kliensnek.' });

  const { link, error } = inviteClient(req.user.id, target.id);
  if (link) addNotification(target.id, 'invite', `${req.user.displayName} edzőként meghívott`);
  if (error) {
    return res.status(409).json({
      error: error === 'already-active'
        ? `${target.displayName} már a kliensed.`
        : `${target.displayName} már kapott meghívást — még nem fogadta el.`,
    });
  }
  res.status(201).json(link);
});

/** A kliens elfogadja a meghívást. Csak a SAJÁT, függő meghívása fogadható el. */
app.post('/api/coach/invites/:id/accept', (req, res) => {
  const link = acceptInvite(req.user.id, Number(req.params.id));
  if (!link) return res.status(404).json({ error: 'A meghívás nem található, vagy már nem függőben van.' });
  // Az EDZŐ kapja: neki kell megtudnia, hogy mostantól látja a klienst.
  addNotification(link.coach.id, 'invite', `${link.client.name} elfogadta a meghívásodat`);
  res.json(link);
});

/** Kapcsolat bontása: elutasított meghívás vagy lezárt együttműködés.
    Mindkét fél kezdeményezheti — a kliens sem ragadhat bele. */
app.delete('/api/coach/links/:id', (req, res) => {
  if (!removeCoachLink(req.user.id, Number(req.params.id))) {
    return res.status(404).json({ error: 'Nincs ilyen kapcsolatod.' });
  }
  res.status(204).end();
});

/** A KERESZT-FIÓK OLVASÁS EGYETLEN KAPUJA.
    Visszaadja a kért fiók azonosítóját, ha a hívó jogosult rá (saját adat,
    vagy elfogadott edző–kliens kapcsolat), különben null — és ilyenkor MÁR
    KIÍRTA a hibaválaszt, tehát a hívónak csak vissza kell térnie.

    A jogosulatlan kérés szándékosan 404-et kap, nem 403-at: a 403 elárulná,
    hogy az adott azonosítón létezik fiók. */
function resolveClientId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Érvénytelen azonosító.' });
    return null;
  }
  if (id !== req.user.id && !isCoachOf(req.user.id, id)) {
    res.status(404).json({ error: 'Nincs ilyen kliensed.' });
    return null;
  }
  return id;
}

/** A kliens teljes készenléti riportja az edzőnek — ugyanaz a számítás, amit
    a kliens a Regeneráció oldalán lát. Ez az első kereszt-fiók olvasás az
    appban; minden továbbinak ugyanezen a kapun kell átmennie. */
app.get('/api/coach/clients/:id/readiness', (req, res) => {
  const clientId = resolveClientId(req, res);
  if (clientId === null) return;
  res.json(readinessReport(clientId));
});

/* ======================================================================
   Kiosztott edzéstervek
   ----------------------------------------------------------------------
   A kiosztott tervnek a KLIENS a tulajdonosa (plans.user_id), de az EDZŐ a
   szerzője (plans.author_id). Ebből következik minden szabály:
     · a kliens edzeni tud belőle, de nem szerkesztheti (PUT /api/plans/:id
       403-at ad rá),
     · az edző a saját szerzőségű tervet módosíthatja — de csak amíg él a
       kapcsolat,
     · a terven ott a nyom, hogy MIKOR és KI módosította utoljára.
   ====================================================================== */

/** Az edzőnek szánt kapu: a kliens azonosítója, ha TÉNYLEG a kliense.
    A saját fiókot itt NEM engedjük át (arra a sima /api/plans való) — így a
    kiosztás művelete sosem keveredhet a saját tervek kezelésével. */
function resolveOwnClientId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Érvénytelen azonosító.' });
    return null;
  }
  if (!isCoachOf(req.user.id, id)) {
    res.status(404).json({ error: 'Nincs ilyen kliensed.' });
    return null;
  }
  return id;
}

/** A kliens tervei az edzőnek — jelölve, melyiket ő osztotta ki. */
app.get('/api/coach/clients/:id/plans', (req, res) => {
  const clientId = resolveOwnClientId(req, res);
  if (clientId === null) return;

  res.json(getUserPlans(clientId).map((plan) => ({
    id: plan.id,
    name: plan.name,
    days: plan.days,
    exercises: plan.exercises,
    // Csak a SAJÁT szerzőségű tervet szerkesztheti — a kliens saját tervéhez
    // nem nyúlhat hozzá, azt csak látja.
    mine: plan.authorId === req.user.id,
    coachAuthored: plan.coachAuthored,
    authorName: plan.authorName,
    changeNote: plan.updatedAt ? `Módosítva ${relativeTime(plan.updatedAt)} · ${plan.updatedByName ?? '—'}` : null,
  })));
});

/** Terv kiosztása a kliensnek. A terv a kliens fiókjába kerül, az edző
    szerzőségével — a kliens azonnal látja a Tervek oldalán. */
app.post('/api/coach/clients/:id/plans', (req, res) => {
  const clientId = resolveOwnClientId(req, res);
  if (clientId === null) return;

  const plan = parsePlanBody(req.body);
  if (plan.error) return res.status(400).json({ error: plan.error });

  const created = addPlan(clientId, plan.name, today(), plan.exercises, plan.days, req.user.id);
  addNotification(clientId, 'plan', `${req.user.displayName} kiosztotta a(z) „${created.name}" tervet`);
  res.status(201).json(created);
});

/** A kiosztott terv módosítása. Két feltételnek KELL egyszerre állnia: az
    edző a terv szerzője, ÉS a kapcsolat még él. A második nélkül egy
    felmondott edző örökre szerkeszthetné a régi kliense tervét. */
app.put('/api/coach/plans/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Érvénytelen terv-azonosító.' });

  const existing = getPlanById(id);
  if (!existing || existing.authorId !== req.user.id) {
    return res.status(404).json({ error: 'Nincs ilyen általad kiosztott terv.' });
  }
  if (!isCoachOf(req.user.id, existing.userId)) {
    return res.status(403).json({ error: 'A kapcsolat megszűnt — ezt a tervet már nem módosíthatod.' });
  }

  const plan = parsePlanBody(req.body);
  if (plan.error) return res.status(400).json({ error: plan.error });

  const updated = updateAssignedPlan(req.user.id, id, plan.name, plan.exercises, plan.days);
  if (!updated) return res.status(404).json({ error: 'Nincs ilyen terv — lehet, hogy időközben törölték.' });

  addNotification(existing.userId, 'planChange', `${req.user.displayName} módosította a(z) „${updated.name}" tervet`);
  res.json(updated);
});

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
function planSafetyChecker(userId) {
  const report = readinessReport(userId);
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
function sessionAdvice(userId) {
  const template = workoutTemplate(userId);
  if (!template || !Array.isArray(template.exercises) || template.exercises.length === 0) {
    return { name: null, items: [] };
  }

  const report = readinessReport(userId);
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
function applySessionAdvice(userId) {
  const template = workoutTemplate(userId);
  const { items } = sessionAdvice(userId);
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
  saveWorkoutDraft(userId, template.name, exercises, draft?.date ?? today(), template.planId ?? null);
  return { applied: items.length };
}

app.get('/api/readiness/advice', (req, res) => res.json(sessionAdvice(req.user.id)));

/** Elfogadás. A válasz a friss napló, hogy a felület egy körből frissüljön. */
app.post('/api/readiness/advice/apply', (req, res) => {
  const result = applySessionAdvice(req.user.id);
  res.json({ ...result, template: workoutTemplate(req.user.id) });
});

/* ======================================================================
   Értesítések
   ----------------------------------------------------------------------
   Valódi eseményekből, fiókonként. Az „olvasott" állapot a szerveren él
   (users.notifications_read_at), nem a böngésző localStorage-ában — így
   nem tűnik el a lista attól, hogy egyszer rányomtak az „olvasottra".
   ====================================================================== */

/** Emberi időmegjelölés az UTC-időbélyegből. A DB 'ÉÉÉÉ-HH-NN ÓÓ:PP:MM'
    alakot tárol UTC-ben — a 'Z' nélkül a böngésző helyi időnek venné, és
    a friss értesítés órákkal ezelőttinek látszana. */
function relativeTime(stamp) {
  const ms = Date.now() - new Date(`${String(stamp).replace(' ', 'T')}Z`).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'az imént';
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'tegnap' : `${days} napja`;
}

app.get('/api/notifications', (req, res) => {
  res.json(getNotifications(req.user.id).map((item) => ({
    id: item.id,
    cat: item.cat,
    text: item.text,
    time: relativeTime(item.createdAt),
    unread: item.unread,
  })));
});

/** „Mindet olvasottnak." A lista NEM ürül ki tőle — csak az „új" jelzés
    tűnik el. A korábbi viselkedés (minden eltüntetése) valódi eseményeknél
    előzmény-vesztés lenne. */
app.post('/api/notifications/read', (req, res) => {
  markNotificationsRead(req.user.id);
  res.status(204).end();
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
  /* A biztonsági átnézéshez a készenléti riport KELL, de fejenként egyszer
     elég: minden terv ugyanazt a mai állapotot méri. */
  const plans = getUserPlans(userId);
  const safetyOf = plans.length ? planSafetyChecker(userId) : () => null;

  res.json(plans.map((plan) => {
    const daysLabel = plan.days.length
      ? ` · ${plan.days.map((d) => DAY_LABELS[d]).join(', ')}`
      : '';
    const owner = plan.coachAuthored ? `${plan.authorName} terve` : 'Saját terv';
    return {
      id: plan.id,
      name: plan.name,
      meta: `${owner} · ${plan.exercises.length} gyakorlat${daysLabel}`,
      progress: progressFor(plan),
      /* own = szerkesztheti-e a felületen. A kiosztott tervet csak az edző
         állíthatja; a kliens edzeni tud belőle, átírni nem. */
      own: !plan.coachAuthored,
      coachAuthored: plan.coachAuthored,
      // „Mikor, ki módosította" — csak a kiosztott terveknél érdekes.
      changeNote: plan.coachAuthored && plan.updatedAt
        ? `Módosítva ${relativeTime(plan.updatedAt)} · ${plan.updatedByName ?? '—'}`
        : null,
      safety: safetyOf(plan.exercises),
      exercises: plan.exercises,
      days: plan.days,
    };
  }));
});

app.get('/api/workout-template', (req, res) => res.json(workoutTemplate(req.user.id)));

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
    A mentett edzéseket a hívó adja át: a getWorkouts() a fiókok bevezetése óta
    kötelező `userId`-t vár, tehát paraméter nélküli alapérték nem képezhető. */
function trainingStreak(workouts) {
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
/** Egy szett szám-mezője (ism./súly) normalizálva.

    A mező SZÖVEG marad — a régi, mértékegységgel együtt mentett értékeket
    („12 rep", „60% TM") a migráció alakítja számmá, azokat itt nem bántjuk.
    Ami viszont számként olvasható, az nem lehet negatív: a negatív súly
    negatív tonnatömeget adna, és a fáradtság-modellben LEVONÓDNA — egy
    hamis sorral felfelé lehetne tolni a saját készenléti pontszámot. */
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
  res.status(201).json(addPlan(req.user.id, plan.name, today(), plan.exercises, plan.days));
});

/** Meglévő terv szerkesztése. Törzs: { name, exercises, days }. */
app.put('/api/plans/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Érvénytelen terv-azonosító.' });
  const plan = parsePlanBody(req.body);
  if (plan.error) return res.status(400).json({ error: plan.error });

  const updated = updatePlan(req.user.id, id, plan.name, plan.exercises, plan.days);
  if (updated) return res.json(updated);

  /* Nem ment át. Két oka lehet, és a kettőt meg kell különböztetni: az edzői
     tervnél a felhasználó a SAJÁT tervét látja, csak nem szerkesztheti —
     erre a „nincs ilyen terv" félrevezető volna. Idegen fiók tervéről
     viszont nem árulunk el semmit: az marad 404. */
  const existing = getPlanById(id);
  if (existing && existing.userId === req.user.id && existing.coachAuthored) {
    return res.status(403).json({
      error: `Ezt a tervet ${existing.authorName} osztotta ki — csak ő módosíthatja. Edzeni tudsz belőle.`,
    });
  }
  res.status(404).json({ error: 'Nincs ilyen terv — lehet, hogy időközben törölték.' });
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

/* A TÉNYLEGESEN kiosztott portot írjuk ki, nem a kért PORT-ot. A kettő
   rendszerint ugyanaz, de PORT=0 esetén az operációs rendszer választ szabad
   portot — így indul a végponti teszt (server/api.test.js) is, ami ebből a
   sorból olvassa ki, hova küldje a kéréseket. */
const server = app.listen(PORT, () => {
  console.log(`FitTrack Pro szerver fut: http://localhost:${server.address().port}`);
});
