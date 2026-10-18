/**
 * Podium — adatréteg: fiókok és munkamenetek
 * ------------------------------------------------------------------------
 * Fiókok, munkamenetek, a fiók törlése és a teljes adat-pillanatkép.
 */
import { getCheckins, getWeightLog } from './body.js';
import { db } from './connection.js';
import { getNutritionLog, listCustomFoods } from './nutrition.js';
import { getAllExerciseMaxes, getUserPlans, getWorkoutDraft, getWorkouts } from './training.js';

/* A FELHASZNÁLÓI adatot tartó táblák — mindegyik sorát a `user_id` köti a
   fiókhoz. Egy helyen felsorolva: a fiók törlése ezeken megy végig. Ha új
   ilyen tábla születik, ITT kell felvenni. (Az egyfelhasználós → többfelhasználós
   migráció kikerült, lásd a baseline-őrt: migrations.js.) */
const USER_DATA_TABLES = [
  'weight_log',
  'nutrition_log',
  'workouts',
  'plans',
  'workout_draft',
  'checkins',
  'exercise_maxes',
];

/* ======================================================================
   Fiókok és munkamenetek
   ====================================================================== */

/** Egy felhasználó sora → a felület által látott alak (jelszó nélkül!). */
const toUser = (row) =>
  row ? { id: row.id, username: row.username, displayName: row.display_name } : null;

/** Egy felhasználó NYILVÁNOS alakja: ennyit lát róla a kapcsolat másik
    oldala (meghíváskor, a sportoló-kártyán, az üzenet-szálban). Az id
    szándékosan nincs benne — a felület a kapcsolat azonosítójával dolgozik. */
export const toPublicUser = (row) =>
  row ? { username: row.username, name: row.display_name, goal: row.goal ?? null } : null;

/** Felhasználó a (már kisbetűsített) felhasználónév alapján, a hash-sel együtt
    — kizárólag a belépés ellenőrzéséhez. */
export function getUserWithHash(username) {
  return (
    db
      .prepare('SELECT id, username, display_name, password_hash FROM users WHERE username = ?')
      .get(username) || null
  );
}

/** Felhasználó azonosító alapján (jelszó nélkül). */
export function getUser(id) {
  return toUser(db.prepare('SELECT id, username, display_name FROM users WHERE id = ?').get(id));
}

/** A fiók létrehozásának időpontja, ahogy a users.created_at tárolja
    (datetime('now') → "2026-03-12 08:41:07", UTC). Nem a getUser() adja vissza:
    a munkamenet-feloldás minden kérésben lefut, és ez az egy mező csak a
    profiloldal „Tag … óta" sorának kell. Ismeretlen fiókra null. */
export function getUserCreatedAt(id) {
  return db.prepare('SELECT created_at FROM users WHERE id = ?').get(id)?.created_at ?? null;
}

/** A fiók edzés-célja (a data.js goals-listájának kulcsa), vagy null. */
export function getUserGoal(id) {
  return db.prepare('SELECT goal FROM users WHERE id = ?').get(id)?.goal ?? null;
}

/** A fiók edzés-céljának beállítása. A null a „nincs megadva" — a hívó
    (server.js) ellenőrzi, hogy a kulcs szerepel-e a goals-listában. */
export function setUserGoal(id, goal) {
  db.prepare('UPDATE users SET goal = ? WHERE id = ?').run(goal, id);
  return getUserGoal(id);
}

/** A fiók neme ('male' | 'female'), vagy null, ha nincs megadva. */
export function getUserSex(id) {
  return db.prepare('SELECT sex FROM users WHERE id = ?').get(id)?.sex ?? null;
}

/** A fiók nemének beállítása. A null a „nincs megadva" — a hívó (server.js)
    ellenőrzi, hogy az érték a SEXES listában szerepel-e. */
export function setUserSex(id, sex) {
  db.prepare('UPDATE users SET sex = ? WHERE id = ?').run(sex, id);
  return getUserSex(id);
}

/** A fiók születési éve, vagy null, ha nincs megadva. */
export function getUserBirthYear(id) {
  return db.prepare('SELECT birth_year FROM users WHERE id = ?').get(id)?.birth_year ?? null;
}

/** A születési év beállítása. A null a „nincs megadva" — a hívó (server.js)
    ellenőrzi a tartományt. */
export function setUserBirthYear(id, year) {
  db.prepare('UPDATE users SET birth_year = ? WHERE id = ?').run(year, id);
  return getUserBirthYear(id);
}

/** Felhasználó keresése a (már kisbetűsített) felhasználónév alapján — a
    meghíváshoz. */
export function findUserByUsername(username) {
  const row = db
    .prepare('SELECT id, username, display_name, goal FROM users WHERE username = ?')
    .get(username);
  return row ? { id: row.id, ...toPublicUser(row) } : null;
}

/** Van-e már fiók? A felület ebből tudja, hogy az első regisztráció
    következik-e. */
export function hasAnyUser() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

/**
 * Új fiók. A hívó adja a MÁR kisbetűsített felhasználónevet és a MÁR
 * elkészített jelszó-hasht (a hashelés a server/auth.js dolga).
 * Visszaadja: { user }. Foglalt névre null-t ad.
 */
export function createUser(username, displayName, passwordHash) {
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return null;

  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)')
    .run(username, displayName, passwordHash);
  const id = Number(lastInsertRowid);

  return { user: getUser(id) };
}

/** A fiók jelszó-hashének cseréje (a hashelés a hívó dolga, ld. auth.js). */
export function updateUserPassword(id, passwordHash) {
  return (
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id).changes > 0
  );
}

/** A fiók ÖSSZES munkamenetének törlése — jelszóváltáskor hívjuk, hogy a
    korábban kiadott sütik (más eszközök, esetleg egy ellopott token) ne
    maradjanak érvényben. A hívó ezután új munkamenetet nyit magának. */
export function deleteUserSessions(userId) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
}

/**
 * A fiók és MINDEN hozzá tartozó adat törlése, egyetlen tranzakcióban.
 *
 * A törlés SZÁNDÉKOSAN nem bízza magát az idegenkulcs-CASCADE-re: a séma új
 * adatbázisokon tartalmazza ugyan (`REFERENCES users(id) ON DELETE CASCADE`),
 * a fiókok előtti fájlokon viszont a `user_id` oszlopok ALTER TABLE-lel
 * születtek, megszorítás nélkül. Ott a users-sor törlése gazdátlan sorokat
 * hagyna maga után — épp azt az adatot, amit a felhasználó töröltetni akart.
 *
 * Az edző–sportoló kapcsolatok mindkét irányban megszűnnek, a hozzájuk tartozó
 * üzenetekkel együtt: a másik fél sem őrizheti tovább a beszélgetést.
 */
export function deleteUser(userId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `DELETE FROM messages
                WHERE link_id IN (SELECT id FROM coach_links WHERE coach_id = ? OR athlete_id = ?)`,
    ).run(userId, userId);
    // Öv és nadrágtartó: ha egy üzenet valahogy kapcsolat nélkül maradt volna
    db.prepare('DELETE FROM messages WHERE sender_id = ?').run(userId);
    db.prepare('DELETE FROM coach_links WHERE coach_id = ? OR athlete_id = ?').run(userId, userId);
    // Az edzőként kitűzött célok a sportolóknál: a kapcsolattal együtt mennek,
    // ahogy a bontásnál is (deleteCoachLink). A getNutritionGoal enélkül is
    // figyelmen kívül hagyná őket — így viszont nem maradnak ott gazdátlanul.
    db.prepare("DELETE FROM nutrition_goals WHERE source = 'coach' AND set_by = ?").run(userId);
    // Ugyanígy az edzőként összeállított étrend és víz-cél
    db.prepare('DELETE FROM coach_meals WHERE set_by = ?').run(userId);
    db.prepare('DELETE FROM water_goals WHERE set_by = ?').run(userId);

    for (const table of USER_DATA_TABLES) {
      db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
    }
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    const { changes } = db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    db.exec('COMMIT');
    return changes > 0;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Munkamenet létrehozása a token lenyomatához. */
export function createSession(tokenHash, userId, expiresAt) {
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    tokenHash,
    userId,
    expiresAt,
  );
}

/** A munkamenethez tartozó felhasználó, vagy null (ismeretlen vagy lejárt
    token). A lejárt sorokat menet közben takarítjuk. */
export function getSessionUser(tokenHash) {
  const row = db
    .prepare(
      `
    SELECT u.id, u.username, u.display_name, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `,
    )
    .get(tokenHash);
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    deleteSession(tokenHash);
    return null;
  }
  return toUser(row);
}

/** Kijelentkezés — a munkamenet törlése. */
export function deleteSession(tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

/** A lejárt munkamenetek takarítása (induláskor, bejelentkezéskor és naponta).
    A feltétel a tárolással azonos alakú paraméter (ISO-8601, „…T…Z"): a
    korábbi datetime('now') szóközös alakjához mérve a ma lejárt sor csak
    másnap törlődött. */
export function purgeExpiredSessions() {
  const { changes } = db
    .prepare('DELETE FROM sessions WHERE expires_at <= ?')
    .run(new Date().toISOString());
  return changes;
}

/** Teljes pillanatkép a beállítások exportjához: a közös referencia-adat és a
    HÍVÓ SAJÁT naplói. Más felhasználó adata sosem kerül bele. */
export function getSnapshot(userId) {
  const snapshot = {};
  for (const { key, value } of db.prepare('SELECT key, value FROM collections').all()) {
    snapshot[key] = JSON.parse(value);
  }
  snapshot.weightLog = getWeightLog(userId);
  snapshot.nutritionLog = getNutritionLog(userId);
  // A saját ételek is a felhasználó adata — a naplóból nem rekonstruálhatók
  // (a nutrition_log az adagra átszámolt makrókat tárolja, nem a 100 g-osakat).
  snapshot.customFoods = listCustomFoods(userId);
  snapshot.workouts = getWorkouts(userId);
  snapshot.workoutDraft = getWorkoutDraft(userId);
  snapshot.userPlans = getUserPlans(userId);
  snapshot.checkins = getCheckins(userId, 1000);
  /* Az egyéni csúcsok is a felhasználó adata. Az edzésekből elvileg
     visszaszámolhatók (ezt teszi a recomputeExerciseMaxes), de a „teljes
     pillanatkép" akkor teljes, ha nem kell hozzá újraszámolni semmit — és a
     csúcs DÁTUMA is megmarad, ami a naplóból csak közvetve jönne ki.
     A mezőnevek itt a getExerciseMax alakját követik (max1rm), nem a tábla
     oszlopneveit — a snapshot többi része is a felület felőli alakot használja.
     A getAllExerciseMaxes nyers sorait ezért képezzük át, nem őt írjuk át:
     azon a /api/exercise-maxes végpont ül. */
  snapshot.exerciseMaxes = getAllExerciseMaxes(userId).map((row) => ({
    exercise: row.exercise_name,
    max1rm: row.max_1rm,
    date: row.date,
  }));
  return snapshot;
}
