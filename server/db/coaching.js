/**
 * Podium — adatréteg: edző–sportoló kapcsolatok
 * ------------------------------------------------------------------------
 * Kapcsolatok, üzenetek, terv-kiosztás, megjegyzések, az edzés-visszajelzések
 * edzői nézete.
 */
import { workoutDays } from '../plan-week.js';
import { toPublicUser } from './accounts.js';
import { db } from './connection.js';

/* ======================================================================
   Edző–sportoló kapcsolatok és üzenetek
   ----------------------------------------------------------------------
   A kapcsolat IRÁNYÍTOTT: az edző hívja meg a sportolót (pending), és a
   sportoló fogadja el (active). Beleegyezés nélkül tehát senki adata nem
   látszik a másik oldalon — a végpontok mindenhol az AKTÍV kapcsolatot kérik.

   A sportolónak egyszerre EGY aktív edzője lehet (a felület is egy edzőt
   mutat); edzőként viszont bárki tarthat több sportolót.
   ====================================================================== */

/** A SQLite datetime('now') alakja ("2026-08-25 18:30:07", UTC) → ISO-8601.
    A felület relatív időt ír ki belőle ("2 órája"), ahhoz kell a zóna. */
export const toIso = (stamp) => (stamp ? `${String(stamp).replace(' ', 'T')}Z` : null);

/** Meghívó: az edző hívja a sportolót. Visszaadja a létrejött kapcsolatot
    (getCoachLink alakjában), vagy null-t, ha ez a pár EBBEN AZ IRÁNYBAN már
    létezik (függő vagy élő). A fordított irányt a hívó zárja ki
    (server.js): az önmagában érvényes sor lenne, csak épp értelmetlen. */
export function createCoachInvite(coachId, athleteId) {
  if (coachId === athleteId) return null;
  if (
    db
      .prepare('SELECT 1 FROM coach_links WHERE coach_id = ? AND athlete_id = ?')
      .get(coachId, athleteId)
  ) {
    return null;
  }
  const { lastInsertRowid } = db
    .prepare("INSERT INTO coach_links (coach_id, athlete_id, status) VALUES (?, ?, 'pending')")
    .run(coachId, athleteId);
  return getCoachLink(Number(lastInsertRowid));
}

/** Egy kapcsolat a saját azonosítója alapján (a végpontok ebből döntik el,
    hogy a hívó fél egyáltalán érintett-e). Ismeretlen id-re null. */
export function getCoachLink(linkId) {
  const row = db
    .prepare(
      `SELECT id, coach_id, athlete_id, status, created_at, responded_at
                          FROM coach_links WHERE id = ?`,
    )
    .get(linkId);
  return row
    ? {
        id: row.id,
        coachId: row.coach_id,
        athleteId: row.athlete_id,
        status: row.status,
        createdAt: toIso(row.created_at),
        respondedAt: toIso(row.responded_at),
      }
    : null;
}

/** A sportoló ÉLŐ edzője, vagy null. */
export function getActiveCoach(athleteId) {
  const row = db
    .prepare(
      `
    SELECT l.id AS link_id, l.responded_at, u.username, u.display_name, u.goal
    FROM coach_links l JOIN users u ON u.id = l.coach_id
    WHERE l.athlete_id = ? AND l.status = 'active'
    ORDER BY l.id LIMIT 1
  `,
    )
    .get(athleteId);
  // A `since` az elfogadás pillanata: a sportolói panel „X napja dolgoztok
  // együtt" sora ebből számol.
  return row ? { linkId: row.link_id, since: toIso(row.responded_at), ...toPublicUser(row) } : null;
}

/** A sportolóhoz érkezett, még el nem fogadott meghívók (legújabb elöl). */
export function getPendingCoachInvites(athleteId) {
  return db
    .prepare(
      `
    SELECT l.id AS link_id, l.created_at, u.username, u.display_name, u.goal
    FROM coach_links l JOIN users u ON u.id = l.coach_id
    WHERE l.athlete_id = ? AND l.status = 'pending'
    ORDER BY l.id DESC
  `,
    )
    .all(athleteId)
    .map((row) => ({
      linkId: row.link_id,
      at: toIso(row.created_at),
      coach: toPublicUser(row),
    }));
}

/**
 * Az edző sportolói a megadott állapotban ('active' vagy 'pending').
 * A sor tartalmazza a sportoló BELSŐ azonosítóját is: a hívó (server.js)
 * ebből olvassa ki a sportoló naplóit a kártya-statokhoz. A hálózatra
 * kimenő alakba az id nem kerül bele — ott a linkId az azonosító.
 */
export function getCoachAthletes(coachId, status = 'active') {
  return db
    .prepare(
      `
    SELECT l.id AS link_id, l.created_at, l.responded_at, u.id AS user_id,
           u.username, u.display_name, u.goal
    FROM coach_links l JOIN users u ON u.id = l.athlete_id
    WHERE l.coach_id = ? AND l.status = ?
    ORDER BY l.id
  `,
    )
    .all(coachId, status)
    .map((row) => ({
      linkId: row.link_id,
      at: toIso(row.created_at),
      // Mikor fogadta el a sportoló. Csak élő kapcsolatnál van értéke — az
      // értesítés-panel ebből tudja, hogy „X elfogadta a meghívódat".
      respondedAt: toIso(row.responded_at),
      userId: row.user_id,
      ...toPublicUser(row),
    }));
}

/** Meghívó elfogadása. A hívó előbb ellenőrzi, hogy a sportolónak nincs-e már
    élő edzője — ez a függvény csak az állapotot állítja át. */
export function acceptCoachInvite(linkId) {
  const { changes } = db
    .prepare(
      "UPDATE coach_links SET status = 'active', responded_at = datetime('now') WHERE id = ? AND status = 'pending'",
    )
    .run(linkId);
  return changes > 0 ? getCoachLink(linkId) : null;
}

/** Kapcsolat bontása: visszautasított/visszavont meghívó és leválás is ez.
    Az üzenetek a CASCADE miatt vele tűnnek el.

    AZ EDZŐI TÁPLÁLKOZÁSI CÉL IS VELE MEGY. Enélkül a volt edző utolsó
    kalória/fehérje célja a bontás után is hajtotta a Táplálkozás oldalt: a
    getNutritionGoal akkor még nem nézte, él-e a kapcsolat, a sportoló pedig
    nem tudta törölni (a clearOwnNutritionGoal csak az 'own' sort viszi). Egy
    idegen száma maradt a napi célon, örökre. (Ma már az olvasás is szűr — ld.
    LIVE_COACH_GOAL —, a sort mégis eltakarítjuk, ne maradjon gazdátlanul.)

    CSAK az ÉLŐ kapcsolatnál töröljük: egy visszautasított meghívó
    visszavonása nem nyúlhat ahhoz a célhoz, amit egy MÁSIK, korábbi edző
    hagyott ott — azt a saját bontása viszi majd el.

    És CSAK azt a célt, amit EZ az edző tűzött ki (set_by). A coach_links csak
    a (coach_id, athlete_id) párra egyedi, tehát az adatbázisban egy
    sportolónak két élő edzője is lehet — az egyik bontása nem viheti el a
    másik számát.

    A kettő egy tranzakcióban megy: félúton megszakadva vagy a kapcsolat
    maradna a cél nélkül, vagy fordítva. */
export function deleteCoachLink(linkId) {
  const link = db
    .prepare('SELECT coach_id, athlete_id, status FROM coach_links WHERE id = ?')
    .get(linkId);
  if (!link) return false;

  db.exec('BEGIN IMMEDIATE');
  try {
    const { changes } = db.prepare('DELETE FROM coach_links WHERE id = ?').run(linkId);
    if (changes > 0 && link.status === 'active') {
      db.prepare(
        "DELETE FROM nutrition_goals WHERE user_id = ? AND source = 'coach' AND set_by = ?",
      ).run(link.athlete_id, link.coach_id);
      // Az edző étrendje és víz-célja is vele megy — a sportoló nem tudná
      // törölni, az új edző pedig a sajátjaként látná.
      for (const table of ['coach_meals', 'water_goals']) {
        db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND set_by = ?`).run(
          link.athlete_id,
          link.coach_id,
        );
      }
    }
    db.exec('COMMIT');
    return changes > 0;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Egy üzenet-sor → a felület által látott alak. A `mine` a NÉZŐ szemszöge,
    ezért a hívó adja hozzá (ld. server.js). */
const toMessage = (row) => ({
  id: row.id,
  senderId: row.sender_id,
  author: row.display_name,
  text: row.body,
  at: toIso(row.created_at),
  readAt: toIso(row.read_at),
});

/** A négy üzenet-lekérdezés ugyanazt a mezőkészletet adja vissza (ezt várja a
    toMessage), ezért a SELECT-lista egy helyen él. */
const MESSAGE_COLUMNS = `
  m.id, m.sender_id, m.body, m.created_at, m.read_at, u.display_name
  FROM messages m JOIN users u ON u.id = m.sender_id
`;

/** Egy kapcsolat üzenetei időrendben (a legutóbbi `limit` darab). */
export function getMessages(linkId, limit = 100) {
  return db
    .prepare(
      `
    SELECT ${MESSAGE_COLUMNS}
    WHERE m.link_id = ? ORDER BY m.id DESC LIMIT ?
  `,
    )
    .all(linkId, limit)
    .map(toMessage)
    .reverse();
}

/** A kapcsolat legutóbbi üzenete, vagy null (a sportoló-kártya idézi). */
export function getLastMessage(linkId) {
  const row = db
    .prepare(
      `
    SELECT ${MESSAGE_COLUMNS}
    WHERE m.link_id = ? ORDER BY m.id DESC LIMIT 1
  `,
    )
    .get(linkId);
  return row ? toMessage(row) : null;
}

/** Üzenet küldése egy kapcsolatba. A küldő fél jogosultságát a végpont
    ellenőrzi (csak a kapcsolat két oldala írhat bele). */
export function addMessage(linkId, senderId, body) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO messages (link_id, sender_id, body) VALUES (?, ?, ?)')
    .run(linkId, senderId, body);
  const row = db.prepare(`SELECT ${MESSAGE_COLUMNS} WHERE m.id = ?`).get(Number(lastInsertRowid));
  return toMessage(row);
}

/**
 * A szál olvasottnak jelölése a NÉZŐ szemszögéből: a másik fél még olvasatlan
 * üzenetei kapnak időbélyeget. A sajátjait senki nem „olvassa el" — azok
 * read_at-je a címzett olvasását jelöli, tehát a sender_id != ? feltétel nem
 * finomkodás, hanem a mező jelentése.
 *
 * @returns {number} hány üzenet vált olvasottá (0 = nem volt hátralék)
 */
export function markMessagesRead(linkId, readerId) {
  return db
    .prepare(
      `
    UPDATE messages SET read_at = datetime('now')
    WHERE link_id = ? AND sender_id != ? AND read_at IS NULL
  `,
    )
    .run(linkId, readerId).changes;
}

/**
 * A felhasználó ÖSSZES szálának olvasatlan-hátraléka egyetlen lekérdezésben:
 * { [linkId]: darabszám }, csak a nem-nulla szálakkal.
 *
 * Szándékosan nem szálanként számolunk: az edzői panel 20-30 sportolónál
 * ugyanennyi külön COUNT-ot futtatna, és a szinkron SQLite miatt mindegyik a
 * teljes event loopot blokkolná (ld. TEENDOK.txt, teljesítmény-szakasz).
 */
export function getUnreadCounts(userId) {
  const rows = db
    .prepare(
      `
    SELECT m.link_id, COUNT(*) AS unread
    FROM messages m JOIN coach_links l ON l.id = m.link_id
    WHERE m.read_at IS NULL AND m.sender_id != ?
      AND (l.coach_id = ? OR l.athlete_id = ?)
    GROUP BY m.link_id
  `,
    )
    .all(userId, userId, userId);
  return new Map(rows.map((row) => [row.link_id, row.unread]));
}

/* ---- Terv-kiosztás ---- */

/** Egy kiosztás-sor → a felület által látott alak. A hét a terv-építőé
    (plan-week.js); a `days` belőle számolt. */
const toAssignment = (row) => {
  const week = JSON.parse(row.week);
  return {
    id: row.id,
    linkId: row.link_id,
    name: row.name,
    week,
    days: workoutDays(week),
    note: row.note,
    status: row.status,
    at: toIso(row.created_at),
    respondedAt: toIso(row.responded_at),
  };
};

/* A kiosztás mezői. Kétszer kell: egyszer önmagában, egyszer `a.` előtaggal a
   kapcsolat- és felhasználó-JOIN-os lekérdezésekhez (ott a display_name miatt
   a csillag nem volna egyértelmű). */
const ASSIGNMENT_FIELDS = [
  'id',
  'link_id',
  'name',
  'week',
  'note',
  'status',
  'created_at',
  'responded_at',
];

const ASSIGNMENT_COLUMNS = ASSIGNMENT_FIELDS.join(', ');

const ASSIGNMENT_COLUMNS_A = ASSIGNMENT_FIELDS.map((field) => `a.${field}`).join(', ');

/** Terv felajánlása a kapcsolat sportolójának. A hívó (server.js) ellenőrzi,
    hogy a kapcsolat él-e, és hogy tényleg az EDZŐ oldala kéri. */
export function assignPlan(linkId, { name, week, note = null }) {
  const { lastInsertRowid } = db
    .prepare(
      `
    INSERT INTO plan_assignments (link_id, name, week, exercises, days, note)
    VALUES (?, ?, ?, '[]', ?, ?)
  `,
    )
    .run(linkId, name, JSON.stringify(week), JSON.stringify(workoutDays(week)), note);
  return getPlanAssignment(Number(lastInsertRowid));
}

/** Egy kiosztás a saját azonosítója alapján (a végpont ebből dönti el, hogy a
    hívó egyáltalán érintett-e). Ismeretlen id-re null. */
export function getPlanAssignment(id) {
  const row = db.prepare(`SELECT ${ASSIGNMENT_COLUMNS} FROM plan_assignments WHERE id = ?`).get(id);
  return row ? toAssignment(row) : null;
}

/**
 * A sportolóhoz érkezett, még FÜGGŐ terv-ajánlatok (legújabb elöl), az edző
 * nevével együtt. Csak élő kapcsolatból: a felfüggesztett/megszűnt kapcsolat
 * ajánlata nem lóghat ott a sportolónál.
 */
export function getPendingPlanOffers(athleteId) {
  return db
    .prepare(
      `
    SELECT ${ASSIGNMENT_COLUMNS_A}, u.display_name, u.username
    FROM plan_assignments a
    JOIN coach_links l ON l.id = a.link_id
    JOIN users u ON u.id = l.coach_id
    WHERE l.athlete_id = ? AND l.status = 'active' AND a.status = 'pending'
    ORDER BY a.id DESC
  `,
    )
    .all(athleteId)
    .map((row) => ({
      ...toAssignment(row),
      coach: { username: row.username, name: row.display_name },
    }));
}

/**
 * Az edző által kiosztott tervek, amikre a sportoló MÁR válaszolt — az
 * értesítés-panel ebből tudja, hogy „X elfogadta a … tervet". Csak a
 * `limit` legutóbbi, a sportoló nevével.
 */
export function getAnsweredPlanOffers(coachId, limit = 10) {
  return db
    .prepare(
      `
    SELECT ${ASSIGNMENT_COLUMNS_A}, u.display_name, u.username
    FROM plan_assignments a
    JOIN coach_links l ON l.id = a.link_id
    JOIN users u ON u.id = l.athlete_id
    WHERE l.coach_id = ? AND a.status != 'pending'
    ORDER BY a.responded_at DESC LIMIT ?
  `,
    )
    .all(coachId, limit)
    .map((row) => ({
      ...toAssignment(row),
      athlete: { username: row.username, name: row.display_name },
    }));
}

/**
 * Egy kapcsolat MEGVÁLASZOLT terv-ajánlatai a sportoló szemszögéből — a
 * sportolói panel Terv fülének előzménye. A legutóbb megválaszolt elöl.
 */
export function getAthletePlanHistory(linkId, limit = 10) {
  return db
    .prepare(
      `
    SELECT ${ASSIGNMENT_COLUMNS} FROM plan_assignments
    WHERE link_id = ? AND status != 'pending'
    ORDER BY responded_at DESC, id DESC LIMIT ?
  `,
    )
    .all(linkId, limit)
    .map(toAssignment);
}

/** A kiosztás lezárása ('accepted' vagy 'declined'). Csak FÜGGŐ sort mozdít
    meg, tehát a kétszer elküldött válasz nem írja felül az elsőt. */
export function resolvePlanAssignment(id, status) {
  const { changes } = db
    .prepare(
      `
    UPDATE plan_assignments SET status = ?, responded_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `,
    )
    .run(status, id);
  return changes > 0 ? getPlanAssignment(id) : null;
}

/* ---- Megjegyzések ----
   A hozzáférést NEM ez a modul dönti el — az a server.js kapuja. Itt csak az
   olvasás és az írás van. */

/** Egy DB-sor → a felület által várt alak. A szerző nevét is hozzuk, hogy a
    lista egyetlen lekérésből kirajzolható legyen.

    A `mine` a NÉZŐ szemszöge — ugyanaz a minta, mint a toMessage-nél, és
    ugyanezért: a felületnek azt kell tudnia, „én írtam-e", nem azt, hogy KI
    írta. A korábbi `authorId` a sportoló BELSŐ user-id-jét adta ki az
    edzőnek (a kód saját kommentje szerint pont ez nem kerülhet ki), miközben
    a frontend soha nem használta — csak az authorName-et. */
const toComment = (row, viewerId) => ({
  id: row.id,
  mine: row.author_id === viewerId,
  authorName: row.author_name,
  targetId: row.target_id,
  text: row.text,
  // ISO-ra alakítva, mint az üzeneteknél: a relatív időt a KLIENS képzi, ő
  // ismeri a felhasználó időzónáját.
  at: toIso(row.created_at),
});

const COMMENT_SELECT = `
  SELECT c.id, c.author_id, c.target_id, c.text, c.created_at,
         u.display_name AS author_name
  FROM comments c JOIN users u ON u.id = c.author_id`;

/** Egy cél megjegyzései, időrendben (a legrégebbi elöl — így olvasható).
    A `viewerId` az, AKI olvassa (a `mine` jelzőhöz) — nem feltétlenül a
    `subjectId`: az edző a sportolója megjegyzéseit kéri le. */
export function getComments(subjectId, targetType, targetId, viewerId) {
  return db
    .prepare(
      `${COMMENT_SELECT}
    WHERE c.subject_id = ? AND c.target_type = ? AND c.target_id = ?
    ORDER BY c.id ASC`,
    )
    .all(subjectId, targetType, String(targetId))
    .map((row) => toComment(row, viewerId));
}

/** Egy típus ÖSSZES megjegyzése célonként csoportosítva. Az összegző oldal így
    egyetlen kérésből tudja, melyik gyakorlathoz tartozik megjegyzés. */
export function getCommentsByTarget(subjectId, targetType, viewerId) {
  const rows = db
    .prepare(
      `${COMMENT_SELECT}
    WHERE c.subject_id = ? AND c.target_type = ?
    ORDER BY c.id ASC`,
    )
    .all(subjectId, targetType)
    .map((row) => toComment(row, viewerId));
  const grouped = {};
  for (const row of rows) (grouped[row.targetId] ??= []).push(row);
  return grouped;
}

/** Új megjegyzés. Visszaadja a mentett sort (a szerző nevével együtt). */
export function addComment(authorId, subjectId, targetType, targetId, text) {
  const { lastInsertRowid } = db
    .prepare(
      `
    INSERT INTO comments (author_id, subject_id, target_type, target_id, text)
    VALUES (?, ?, ?, ?, ?)`,
    )
    .run(authorId, subjectId, targetType, String(targetId ?? ''), text);
  // A friss megjegyzést mindig a SZERZŐJE kapja vissza — a `mine` tehát igaz.
  return toComment(db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(lastInsertRowid), authorId);
}

/** Megjegyzés törlése. CSAK a szerző törölhet, ezért az author_id is feltétel —
    így egy idegen id-vel küldött kérés nem talál sort, és 404-et kap. */
export function deleteComment(commentId, authorId) {
  return (
    db.prepare('DELETE FROM comments WHERE id = ? AND author_id = ?').run(commentId, authorId)
      .changes > 0
  );
}

/** Az edző sportolóinak friss edzés-visszajelzései (a `sinceDate` óta).
    Ez az edzői oldal egyik értesítés-forrása: hogy a sportoló hogyan ÉLTE MEG
    az edzést, a naplóból nem számolható ki — csak tőle tudható meg.
    Csak ÉLŐ kapcsolat számít, ugyanúgy, mint mindenhol máshol. */
export function getAthleteFeedbackSince(coachId, sinceDate) {
  return db
    .prepare(
      `
    SELECT w.id, w.name, w.feedback_difficulty, w.feedback_at,
           u.display_name AS athlete_name
    FROM workouts w
    JOIN coach_links cl ON cl.athlete_id = w.user_id AND cl.status = 'active'
    JOIN users u ON u.id = w.user_id
    WHERE cl.coach_id = ? AND w.feedback_at IS NOT NULL AND w.date >= ?
    ORDER BY w.feedback_at DESC
  `,
    )
    .all(coachId, sinceDate)
    .map((row) => ({
      id: row.id,
      workout: row.name,
      athlete: row.athlete_name,
      difficulty: row.feedback_difficulty,
      at: toIso(row.feedback_at),
    }));
}
