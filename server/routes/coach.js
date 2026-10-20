/**
 * Podium — edző–sportoló kapcsolatok
 * ------------------------------------------------------------------------
 * Kapcsolatok és meghívók, üzenetek, terv-kiosztás, értesítések és a
 * gyakorlat-megjegyzések.
 */
import { USERNAME_RE, normalizeUsername } from '../auth.js';
import { buildAthleteCard, streakFromDates } from '../coaching.js';
import { shiftDate } from '../dates.js';
import {
  acceptCoachInvite,
  addComment,
  addMessage,
  addPlan,
  assignPlan,
  createCoachInvite,
  deleteCoachLink,
  deleteComment,
  findUserByUsername,
  getActiveCoach,
  getAnsweredPlanOffers,
  getAssignedPlanTargets,
  getAthleteFeedbackSince,
  getAthletePlanHistory,
  getCheckins,
  getCoachAthletes,
  getCoachLink,
  getCoachMeals,
  getCollection,
  getCommentsByTarget,
  getLastMessage,
  getLatestWeight,
  getMessages,
  getNutritionGoal,
  getPendingCoachInvites,
  getPendingPlanOffers,
  getPlan,
  getRecentExerciseMaxes,
  getUnreadCounts,
  getUser,
  getUserGoal,
  getUserPlanSchedules,
  getWeightLogSince,
  getWorkoutDates,
  getWorkoutsSince,
  markMessagesRead,
  resolvePlanAssignment,
  setActivePlan,
  transaction,
} from '../db.js';
import { buildNotifications } from '../notifications.js';
import { computeReadiness } from '../recovery.js';
import { goalTag } from './auth.js';
import { linkFor, pendingOfferFor } from '../http/access.js';

/** A meghívó: a sportoló oldaláról, FÜGGŐ kapcsolat. */
const INVITE = { as: 'athlete', status: 'pending', notFound: 'Nincs ilyen meghívó.' };
/** Az üzenet-szál: bármelyik oldalról, ÉLŐ kapcsolat. */
const THREAD = { notFound: 'Nincs ilyen beszélgetés.' };
import { messageLimiter, tooManyRequests } from '../http/session.js';
import { nutritionInput } from '../services/session-plan.js';

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

/** Ennyi napra visszamenőleg olvassuk be a sportoló check-injeit és testsúlyát a
    kártyához; a terv-követés és a személyes referencia 28 napot néz, a többi
    napnyi csak biztonsági tartalék, hogy egy határeset se csússzon ki. */
const CARD_WINDOW_DAYS = 35;

/** Az edzésnapló ablaka a kártyán: 56 nap újdonság-visszatekintés + 7 nap izom-ablak.
    Rövidebb naplóból a megszokott gyakorlatok újnak látszanának a készenlét-motornak. */
const CARD_READINESS_WINDOW_DAYS = 63;

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
function exerciseNotes(userId, workouts, viewerId) {
  const byTarget = getCommentsByTarget(userId, 'exercise', viewerId);
  const notes = [];

  for (const [target, list] of Object.entries(byTarget)) {
    const [workoutId, index] = String(target).split(':');
    const workout = workouts.find((w) => String(w.id) === workoutId);
    const exercise = workout?.exercises?.[Number(index)];
    if (!workout || !exercise) continue;
    for (const comment of list) {
      notes.push({
        /* A `mine` már a NÉZŐ szemszögéből jön (db.js → toComment) — a szerző
           belső azonosítója ki sem jön az adatrétegből. */
        ...comment,
        target,
        exercise: exercise.name,
        workout: workout.name,
        date: workout.date,
      });
    }
  }
  // A legfrissebb elöl: a sor-azonosító a beszúrás sorrendje.
  return notes.sort((a, b) => b.id - a.id).slice(0, EXERCISE_NOTE_LIMIT);
}

function athleteCard(athlete, today, viewerId, unread = 0) {
  /* Az edzés-napló ABLAKOZVA jön be. A kártya minden számítása belefér a
     CARD_READINESS_WINDOW_DAYS ablakba: a készenlét-motor az újdonság-szorzóhoz
     63 napot néz (training-load.js -> buildNoveltyIndex), a terv-követés ablaka 28
     nap, a heti állás egy hét, a „legutóbbi aktivitás" pedig négy elem.
     Ami ezen kívülre nyúlik — a sorozat hossza és az utolsó edzés napja —, azt
     a NAPOK listája adja: az a teljes előzményt látja, de gyakorlat-listát nem
     olvas, tehát olcsó. Egy éves naplónál ez ~183 JSON.parse helyett ~21. */
  const since = shiftDate(today, -CARD_WINDOW_DAYS);

  /* A napló ABLAKOZVA jön be, és ugyanaz a három sor szolgálja ki a
     készenlét-motort meg a kártyát is — kétszer nem olvassuk fel. A check-in
     és a testsúly ugyanabból az okból szűkíthető, mint az edzés: a motor az
     alvásadóssághoz 3 napot néz, a megbízhatósághoz 28-at, a testsúlyból
     pedig egyedül a LEGUTOLSÓ mérés érdekli. */
  const workouts = getWorkoutsSince(athlete.userId, shiftDate(today, -CARD_READINESS_WINDOW_DAYS));
  const checkins = getCheckins(athlete.userId, CARD_WINDOW_DAYS);
  const weightLog = getWeightLogSince(athlete.userId, since);
  const workoutDates = getWorkoutDates(athlete.userId);

  /* Az ablakon túlra három bemenet nyúlik, ezeket a teljes naplóból adjuk át
     (olcsón: egy sor, illetve a dátum-lista) — különben a kártya más számot
     mutatna, mint a sportoló saját riportja: a testsúly-referencia, a „valaha
     edzett-e", és az első edzés napja (az újdonság-szorzó érett előzménye). */
  const pastDates = workoutDates.filter((date) => date <= today); // csökkenő sorrend
  const readiness = computeReadiness({
    checkins,
    workouts,
    nutrition: nutritionInput(athlete.userId, today),
    weightLog,
    catalog: getCollection('exerciseCatalog') || [],
    today,
    bodyWeight: getLatestWeight(athlete.userId),
    hasAnyWorkout: pastDates.length > 0,
    firstWorkoutDate: pastDates[pastDates.length - 1] ?? null,
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
  return Object.assign(
    buildAthleteCard({
      athlete: { ...athlete, goal: goalTag(athlete.goal) },
      workouts,
      workoutDates,
      plans: getUserPlanSchedules(athlete.userId),
      // A terv-követés mércéje: amit EZ az edző osztott ki, az ő példányában
      assignedPlans: getAssignedPlanTargets(athlete.userId, athlete.linkId),
      checkins,
      weightLog,
      readiness: readiness.overall,
      confidence: readiness.confidence,
      streak: streakFromDates(workoutDates, today),
      lastMessage: lastMessage && { ...lastMessage, mine: lastMessage.senderId === viewerId },
      unread,
      today,
    }),
    {
      nutritionGoal,
      // Az edző által összeállított étrend — a részletnézet ebből rajzol
      // „megette" jelzéssel a mai napra
      meals: getCoachMeals(athlete.userId, today),
      lastFeedback,
      /* Gyakorlat-megjegyzések. Itt oldjuk fel a nevet, mert a sportoló
       edzésnaplója csak a szerveren van meg. */
      exerciseNotes: exerciseNotes(athlete.userId, workouts, viewerId),
    },
  );
}

/** Egy függő meghívó felületi alakja — mindkét irányban ez az egy hely.
    Az edzés-cél tudatosan NEM megy ki: az a MÁSIK fél fiók-beállítása, és a
    beleegyezés előtt semmi dolga a hálózaton. A meghívó eldöntéséhez nem is
    kell: az edző a felhasználónevet maga írta be, a sportolónak pedig az a
    kérdés, KI hívja, nem hogy milyen célra edz. A cél a sportoló-kártyán és
    az aktív edző fejlécén jelenik meg, tehát csak élő kapcsolatban. */
const invitePayload = ({ linkId, at, username, name }) => ({
  linkId,
  at,
  username,
  name,
});

/* ---- Sportolói oldal ---- */

/** Az edzőm felületi alakja. Az olvasatlan üzenetek száma is benne van — ebből
    lesz a nézetváltó jelvénye, hogy a másik nézetben se maradjon észrevétlen. */
const coachPayload = (coach, userId) =>
  coach
    ? {
        ...coach,
        goal: goalTag(coach.goal),
        unread: getUnreadCounts(userId).get(coach.linkId) ?? 0,
      }
    : null;

/* ---- Üzenetek (a kapcsolat mindkét oldala ugyanazt a szálat használja) ---- */

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

/** Egy terv-ajánlat felületi alakja. A teljes hét benne van: a sportolónak
    látnia kell, MIT fogad el. */
const offerPayload = (offer, from) => ({
  id: offer.id,
  name: offer.name,
  week: offer.week,
  days: offer.days,
  note: offer.note,
  at: offer.at,
  ...from,
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

/** A megjegyzés célja: "edzésId:gyakorlat-index" (ld. db.js comments tábla).
    Korábban tetszőleges hosszú szöveg is bekerült — tárolva és indexelve. */
const COMMENT_TARGET_RE = /^\d{1,15}:\d{1,3}$/;

/** A szöveg és a cél beolvasása. Hibánál { error }-t ad. */
function parseCommentBody(body) {
  const text = String(body?.text ?? '').trim();
  if (!text) return { error: 'Üres megjegyzést nem mentünk el.' };
  if (text.length > COMMENT_MAX_LENGTH) {
    return { error: `Legfeljebb ${COMMENT_MAX_LENGTH} karakter.` };
  }
  const target = String(body?.targetId ?? '');
  if (!COMMENT_TARGET_RE.test(target)) return { error: 'Érvénytelen megjegyzés-cél.' };
  return { text, target };
}

/** Az útvonalak bekötése. Ugyanarra az app-ra, amit a server.js épít — NEM
    express.Router és NEM al-alkalmazás: a guardAsyncRoutes csak az app
    metódusait foltozza (errors.js), egy Router async kezelőjének hibájára
    nem jönne válasz, egy al-alkalmazás pedig elveszítené a trust proxy
    beállítást. */
export function register(app) {
  /* ---- Edzői oldal ---- */

  /** A saját sportolóim + az általam kiküldött, még függő meghívók.
      Az olvasatlan-hátralék MINDEN szálra egyetlen lekérdezésből jön — kártyánként
      külön COUNT-ot futtatni sok sportolónál érezhetően drágább lenne. */
  app.get('/api/athletes', (req, res) => {
    const unread = getUnreadCounts(req.user.id);
    res.json({
      athletes: getCoachAthletes(req.user.id, 'active').map((athlete) =>
        athleteCard(athlete, req.today, req.user.id, unread.get(athlete.linkId) ?? 0),
      ),
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
    if (!link)
      return res.status(409).json({ error: 'Ezzel a felhasználóval már van kapcsolatod.' });

    res.status(201).json(
      invitePayload({
        linkId: link.id,
        at: link.createdAt,
        username: target.username,
        name: target.name,
      }),
    );
  });

  /** A kapcsolat bontása az EDZŐ oldaláról: függő meghívó visszavonása vagy
      élő kapcsolat lezárása. Az üzenetváltás is törlődik vele (CASCADE). */
  app.delete('/api/athletes/:linkId', (req, res) => {
    // Függő meghívó és élő kapcsolat is bontható — az állapot itt mindegy
    const access = linkFor(req.user, req.params.linkId, { as: 'coach', status: null });
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    deleteCoachLink(link.id);
    res.status(204).end();
  });

  /** A saját edzőm (vagy null), a hozzám érkezett meghívók, és az edzőm által
      felajánlott, még el nem fogadott tervek.

      Élő kapcsolatban két mező még:
        - `me`: UGYANAZ a kártya, amit az edzőm a panelján rólam lát — ugyanazzal
          a számítással (athleteCard). A sportolói panel ebből rajzol, így a két
          oldal sosem mond mást ugyanarról a számról.
        - `planHistory`: az edzőm korábbi, már megválaszolt terv-ajánlatai. */
  app.get('/api/coach', (req, res) => {
    const coach = coachPayload(getActiveCoach(req.user.id), req.user.id);
    const me = coach
      ? athleteCard(
          {
            linkId: coach.linkId,
            userId: req.user.id,
            username: req.user.username,
            name: req.user.displayName,
            goal: getUserGoal(req.user.id),
          },
          req.today,
          req.user.id,
          coach.unread,
        )
      : null;
    res.json({
      coach,
      me,
      planHistory: coach
        ? getAthletePlanHistory(coach.linkId).map((offer) =>
            offerPayload(offer, { status: offer.status, respondedAt: offer.respondedAt }),
          )
        : [],
      invites: getPendingCoachInvites(req.user.id).map(({ linkId, at, coach: from }) =>
        invitePayload({ linkId, at, ...from }),
      ),
      planOffers: getPendingPlanOffers(req.user.id).map((offer) =>
        offerPayload(offer, { from: offer.coach.name }),
      ),
    });
  });

  /** Meghívó elfogadása. Egyszerre EGY edző lehet — előbb le kell válni a
      régiről, különben nem lenne eldönthető, kinek a felülete a „kliens nézet". */
  app.post('/api/coach/invites/:linkId/accept', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, INVITE);
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    if (getActiveCoach(req.user.id)) {
      return res.status(409).json({ error: 'Már van edződ — előbb válj le róla.' });
    }
    // Ugyanaz a szabály a másik irányból: a saját sportolóm nem lehet az edzőm.
    if (
      getCoachAthletes(req.user.id, 'active').some((athlete) => athlete.userId === link.coachId)
    ) {
      return res.status(409).json({ error: 'Ő a sportolód — előbb bontsd azt a kapcsolatot.' });
    }
    acceptCoachInvite(link.id);
    res.json({ coach: coachPayload(getActiveCoach(req.user.id), req.user.id) });
  });

  /** Meghívó elutasítása (a sportoló oldaláról). */
  app.delete('/api/coach/invites/:linkId', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, INVITE);
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
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

  /** A szál lekérése. Az olvasottá jelölés NEM itt történik: a felület akkor
      nyugtázza (POST .../read), amikor a hírfolyam tényleg látszik — a 20
      másodpercenkénti halk frissítés önmagában nem jelenti, hogy el is olvasták. */
  app.get('/api/messages/:linkId', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, THREAD);
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    const messages = getMessages(link.id).map((message) => messagePayload(message, req.user.id));
    res.json({
      linkId: link.id,
      partner: partnerOf(link, req.user),
      messages,
      unread: messages.filter((message) => !message.mine && !message.read).length,
    });
  });

  app.post('/api/messages/:linkId', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, THREAD);
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;

    /* Az általános írás-korláton FELÜL: a szemetet itt egy másik ember nézi
       végig, nem csak a szerver nyeli le. Percenként 20 üzenet a leggyorsabb
       gépelőnek is elég. */
    const quota = messageLimiter.hit(req.user.id);
    if (!quota.allowed) {
      return tooManyRequests(res, quota.retryAfter, 'Túl gyorsan írsz — várj egy kicsit.');
    }

    const text = String(req.body?.text ?? '')
      .trim()
      .slice(0, MESSAGE_MAX);
    if (!text) return res.status(400).json({ error: 'Az üzenet nem lehet üres.' });

    res.status(201).json(messagePayload(addMessage(link.id, req.user.id, text), req.user.id));
  });

  /** A szál nyugtázása: a másik fél üzenetei olvasottá válnak. Idempotens —
      hátralék nélkül is 200-at ad, `read: 0`-val. */
  app.post('/api/messages/:linkId/read', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, THREAD);
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    res.json({ read: markMessagesRead(link.id, req.user.id) });
  });

  /** Terv kiosztása a kapcsolat sportolójának. Törzs: { planId, note }.
      A terv az EDZŐ saját tervei közül való — a végpont nem terv-szerkesztő. */
  app.post('/api/athletes/:linkId/plan', (req, res) => {
    // Csak az edző oldala oszthat ki, és csak ÉLŐ kapcsolatba
    const access = linkFor(req.user, req.params.linkId, { as: 'coach' });
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;

    const planId = Number(req.body?.planId);
    if (!Number.isInteger(planId)) {
      return res.status(400).json({ error: 'Válaszd ki, melyik tervet osztod ki.' });
    }
    const plan = getPlan(req.user.id, planId);
    if (!plan) return res.status(404).json({ error: 'Nincs ilyen terved.' });

    const note =
      String(req.body?.note ?? '')
        .trim()
        .slice(0, PLAN_NOTE_MAX) || null;
    const assignment = assignPlan(link.id, { name: plan.name, week: plan.week, note });
    res.status(201).json(offerPayload(assignment, { linkId: link.id }));
  });

  /** Ajánlat elfogadása: a terv MÁSOLATKÉNT kerül a sportoló tervei közé, és
      ez lesz az AKTÍV. A terv-követés ehhez a tervhez mér, az Edzés oldal pedig
      csak az aktívat tölti be — inaktívan a sportoló a régi tervét edzené, az
      edző pedig 0%-os követést látna. A meglévő tervek megmaradnak, csak
      kikapcsolnak; a Tervek oldalon vissza lehet váltani. */
  app.post('/api/plan-offers/:id/accept', (req, res) => {
    const access = pendingOfferFor(req.user, req.params.id);
    if (!access.offer) return res.status(access.code).json({ error: access.error });
    const { offer } = access;

    // A lezárás, a másolat és az aktiválás egy lépés: félúton nem marad
    // elfogadott ajánlat terv nélkül
    const active = transaction(() => {
      resolvePlanAssignment(offer.id, 'accepted');
      // Az assignmentId köti a tervet az edzőhöz: a terv-követés ehhez mér
      const added = addPlan(req.user.id, offer.name, req.today, offer.week, offer.id);
      return setActivePlan(req.user.id, added.id, true, req.today);
    });
    res.status(201).json(active);
  });

  /** Ajánlat elutasítása. A sor megmarad (lezárt állapotban), hogy az edző
      lássa a választ — de a sportolónál nem lóg ott tovább. */
  app.delete('/api/plan-offers/:id', (req, res) => {
    const access = pendingOfferFor(req.user, req.params.id);
    if (!access.offer) return res.status(access.code).json({ error: access.error });
    const { offer } = access;
    resolvePlanAssignment(offer.id, 'declined');
    res.status(204).end();
  });

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

    const since = shiftDate(req.today, -PR_NOTICE_DAYS);

    res.json(
      buildNotifications({
        unreadThreads,
        incomingInvites: getPendingCoachInvites(userId).map(({ linkId, at, coach }) => ({
          linkId,
          at,
          coach: coach.name,
        })),
        /* Az elfogadás pillanata: csak élő kapcsolatnál van, és csak akkor
         értesítés, ha a sportoló tényleg lépett (a responded_at üres marad
         azoknál a soroknál, amik nem meghívóból lettek aktívak). */
        acceptedLinks: getCoachAthletes(userId, 'active')
          .filter((athlete) => athlete.respondedAt)
          .map((athlete) => ({
            linkId: athlete.linkId,
            at: athlete.respondedAt,
            athlete: athlete.name,
          })),
        // A sportoló oldala: nekem felajánlott, még függő tervek
        planOffers: getPendingPlanOffers(userId).map((offer) => ({
          id: offer.id,
          plan: offer.name,
          coach: offer.coach.name,
          at: offer.at,
        })),
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
      }),
    );
  });

  /* ---- A saját megjegyzéseim ---- */

  app.get('/api/comments/by-target', (req, res) => {
    res.json(getCommentsByTarget(req.user.id, COMMENT_TYPE, req.user.id));
  });

  app.post('/api/comments', (req, res) => {
    const { text, target, error } = parseCommentBody(req.body);
    if (error) return res.status(400).json({ error });
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

  /* ---- A sportolóm megjegyzései (az EDZŐ oldala) ----
     Olvasni a részletnézet exerciseNotes mezőjéből lehet (athleteCard). */

  /** Az edzői megjegyzés UGYANABBA a szálba megy, csak más szerzővel — ettől
      lesz egy beszélgetés a gyakorlatról, nem két külön lista. */
  app.post('/api/athletes/:linkId/comments', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, { as: 'coach' });
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    const athleteId = link.athleteId;
    const { text, target, error } = parseCommentBody(req.body);
    if (error) return res.status(400).json({ error });
    res.status(201).json(addComment(req.user.id, athleteId, COMMENT_TYPE, target, text));
  });
}
