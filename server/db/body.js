/**
 * Podium — adatréteg: test és közérzet
 * ------------------------------------------------------------------------
 * Testsúly-napló, testösszetétel (körfogat, testzsír) és a napi check-in.
 */
import { isBodyweightExercise } from '../data/bodyweight-load.js';
import { weightOnDate } from '../records.js';
import { db } from './connection.js';
import { recomputeExerciseMaxes } from './training.js';

/** A testsúly-bejegyzések a valódi táblából, rögzítési sorrendben. */
export function getWeightLog(userId) {
  return db
    .prepare('SELECT id, kg, date FROM weight_log WHERE user_id = ? ORDER BY id')
    .all(userId);
}

/** A `sinceDate` óta rögzített testsúlyok, a getWeightLog sorrendjében
    (legrégebbi elöl). Az edzői kártyához ennyi elég: a készenlét-motor csak a
    LEGUTOLSÓ mérést használja (a terhelés-referenciák skálázásához), a
    „legutóbbi aktivitás" pedig négy eseményt mutat. Napi méréssel a teljes
    napló évente ~365 sorral hízik — sportolónként, minden panel-frissítésnél. */
export function getWeightLogSince(userId, sinceDate) {
  return db
    .prepare('SELECT id, kg, date FROM weight_log WHERE user_id = ? AND date >= ? ORDER BY id')
    .all(userId, sinceDate);
}

/** A LEGUTOLSÓ dátumú testsúly (kg), vagy null. Egy sor, nem a napló: az edzői
    kártya ablakozva olvas (getWeightLogSince), a motor terhelés-referenciája
    viszont a teljes napló legutolsó mérésére skálázódik — a sportoló saját
    riportja is ezt látja. Azonos dátumnál a korábban rögzített, ahogy a motor
    stabil rendezése is választ (computeReadiness → latestWeight). */
export function getLatestWeight(userId) {
  const row = db
    .prepare('SELECT kg FROM weight_log WHERE user_id = ? ORDER BY date DESC, id ASC LIMIT 1')
    .get(userId);
  return row ? row.kg : null;
}

/* ---- Testösszetétel (körfogat, testzsír) ---- */

/** Egy fiók mérései, legfrissebb elöl. A felület ebből rajzol trendet és
    tölti fel az űrlapot a legutóbbi értékekkel. */
export function getMeasurements(userId) {
  return db
    .prepare(
      `SELECT id, date, site, value FROM body_measurements
                     WHERE user_id = ? ORDER BY date DESC, id DESC`,
    )
    .all(userId);
}

/** Mérések mentése egy napra. Helyenként EGY sor van naponta: az aznapi
    újramérés felülír, nem duplikál. A `values` csak az érintett helyeket
    tartalmazza — amit nem adtak meg, azt nem bántjuk. */
export function saveMeasurements(userId, date, values) {
  const upsert = db.prepare(`
    INSERT INTO body_measurements (user_id, date, site, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, date, site) DO UPDATE SET value = excluded.value
  `);
  for (const [site, value] of Object.entries(values)) upsert.run(userId, date, site, value);
  return getMeasurements(userId);
}

/** Egy mérés törlése. Csak a SAJÁT sorát — idegen id-re false jön. */
export function deleteMeasurement(userId, id) {
  return (
    db.prepare('DELETE FROM body_measurements WHERE id = ? AND user_id = ?').run(id, userId)
      .changes > 0
  );
}

/** Egy DB-sor → a Recovery Engine által várt check-in alak (JSON-mezők
    visszafejtve, a hiányzó értékek null-ok maradnak). */
const toCheckin = (row) =>
  row
    ? {
        date: row.date,
        sleepHours: row.sleep_hours,
        sleepQuality: row.sleep_quality,
        energy: row.energy,
        stress: row.stress,
        mood: row.mood,
        hydration: row.hydration,
        soreness: JSON.parse(row.soreness || '{}'),
        pain: JSON.parse(row.pain || '{}'),
      }
    : null;

/* A folyadék NEM a check-in sorából jön, hanem a víznaplóból (egy forrás):
   a check-in űrlapján megadott liter is oda íródik (replaceWaterDay). Így egy
   korty víz nem hoz létre „kitöltött" check-in sort, és a kortyok törlése
   után nem marad 0 a NULL helyett. Az oszlop csak a régi adatbázisokban él. */
const CHECKIN_COLUMNS = `date, sleep_hours, sleep_quality, energy, stress, mood,
                         (SELECT SUM(w.ml) FROM water_log w
                           WHERE w.user_id = checkins.user_id AND w.date = checkins.date)
                           / 1000.0 AS hydration,
                         soreness, pain`;

/** Egy adott nap check-inje, vagy null. */
export function getCheckin(userId, date) {
  return toCheckin(
    db
      .prepare(
        `SELECT ${CHECKIN_COLUMNS} FROM checkins
                               WHERE user_id = ? AND date = ?`,
      )
      .get(userId, date),
  );
}

/** A legutóbbi `limit` check-in, legújabb elöl. A motor ebből számolja az
    alvásadósságot és a becslés megbízhatóságát. */
export function getCheckins(userId, limit = 60) {
  return db
    .prepare(
      `SELECT ${CHECKIN_COLUMNS} FROM checkins
                     WHERE user_id = ? ORDER BY date DESC LIMIT ?`,
    )
    .all(userId, limit)
    .map(toCheckin);
}

/** Volt-e ennek a fióknak VALAHA check-inje. A felület ebből tudja, hogy a
    friss fiókot a check-in varázslóra kell terelnie: a regisztráció ténye
    csak pillanatnyi kliens-állapot, ez viszont túléli az oldal-újratöltést. */
export function hasAnyCheckin(userId) {
  return Boolean(db.prepare('SELECT 1 FROM checkins WHERE user_id = ? LIMIT 1').get(userId));
}

/** Egy nap check-injének mentése/felülírása. A megadott mezők közül csak az
    érvényeseket írjuk; a hiányzók NULL-ként maradnak (ld. a tábla kommentjét).
    Ismételt mentéskor a sor frissül — a felület így szerkeszthetőként kezeli
    az aznapi check-int. Visszaadja a mentett sort. */
export function saveCheckin(userId, date, fields) {
  /* A hiányzó kulcs és a szándékos „nem adta meg" ugyanaz: NULL. A végpont
     mindig mind a hat mezőt kitölti, de az adatréteg részleges objektumot is
     elfogad — undefined-ot ugyanis a SQLite nem tud paraméterként kötni, és
     azon egy hiányzó kulcs miatt elszállna a mentés. */
  const value = (raw) => (raw === undefined ? null : raw);

  db.prepare(
    `
    INSERT INTO checkins (user_id, date, sleep_hours, sleep_quality, energy, stress, mood,
                          soreness, pain, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, date) DO UPDATE SET
      sleep_hours = excluded.sleep_hours, sleep_quality = excluded.sleep_quality,
      energy      = excluded.energy,      stress        = excluded.stress,
      mood        = excluded.mood,
      soreness    = excluded.soreness,    pain          = excluded.pain,
      updated_at  = excluded.updated_at
  `,
  ).run(
    userId,
    date,
    value(fields.sleepHours),
    value(fields.sleepQuality),
    value(fields.energy),
    value(fields.stress),
    value(fields.mood),
    JSON.stringify(fields.soreness ?? {}),
    JSON.stringify(fields.pain ?? {}),
  );
  return getCheckin(userId, date);
}

/** A testsúly egy adott napon: az utolsó bejegyzés a napon vagy előtte. Ha a
    napló csak később kezdődik, a legkorábbi bejegyzés — az a legjobb
    közelítés. Bejegyzés híján 0, és a hívó onnan tudja, hogy nem tippelünk.
    A ciklusban hívó a `log`-ot egyszer olvassa be és adja át — különben minden
    edzés minden gyakorlata újra lekérdezné a teljes testsúly-naplót. */
export function weightForDate(userId, date, log = getWeightLog(userId)) {
  return weightOnDate(log, date);
}

/* ---- Írás ---- */

/** A nap testsúly-bejegyzése; visszaadja a { id, kg, date } sort.
    FELHASZNÁLÓNKÉNT ÉS NAPONTA EGY SOR: ha az adott fióknak arra a napra már
    van bejegyzése, azt írjuk felül.
    A testsúlyt a napi check-in kérdi (Regeneráció → check-in varázsló), amit
    a nap folyamán bármikor újra lehet menteni — sima INSERT-tel minden mentés
    új oszlopot rakott volna a trend-diagramra ugyanarról a napról. */
/** Egy testsúly-bejegyzés javítása. CSAK az értéket — a dátumot nem: a
    javítás nem áthelyezés (ugyanaz az elv, mint a mentett edzésnél). Idegen
    sorra nem talál semmit. Visszaadja a frissített sort, vagy null-t. */
export function updateWeightEntry(userId, id, kg) {
  const { changes } = db
    .prepare('UPDATE weight_log SET kg = ? WHERE id = ? AND user_id = ?')
    .run(kg, id, userId);
  if (changes > 0) recomputeAfterWeightChange(userId);
  return changes > 0
    ? db.prepare('SELECT id, kg, date FROM weight_log WHERE id = ?').get(id)
    : null;
}

/** Testsúly-bejegyzés törlése. Egy elgépelt, kiugró érték a 12 elemű
    trend-kártya skáláját lapos vonallá nyomja, és a Testsúly Δ statot is
    elviszi — enélkül nem volt út a javításához. */
export function deleteWeightEntry(userId, id) {
  const deleted =
    db.prepare('DELETE FROM weight_log WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
  if (deleted) recomputeAfterWeightChange(userId);
  return deleted;
}

/** A saját testsúlyos gyakorlatok csúcsa a NAPI testsúlyból számol
    (bodyweight-load.js), tehát egy testsúly-bejegyzés felvétele, javítása vagy
    törlése a tárolt csúcsot is elavulttá teszi. Csak akkor számolunk újra, ha a
    naplóban van ilyen gyakorlat — a többi felhasználónál ez felesleges munka. */
function recomputeAfterWeightChange(userId) {
  const rows = db.prepare('SELECT exercises FROM workouts WHERE user_id = ?').all(userId);
  const hasBodyweight = rows.some((row) => {
    try {
      return JSON.parse(row.exercises).some((exercise) => isBodyweightExercise(exercise?.name));
    } catch {
      return false;
    }
  });
  if (hasBodyweight) recomputeExerciseMaxes(userId);
}

export function addWeightEntry(userId, kg, date) {
  const existing = db
    .prepare('SELECT id FROM weight_log WHERE user_id = ? AND date = ? ORDER BY id DESC')
    .get(userId, date);
  if (existing) {
    db.prepare('UPDATE weight_log SET kg = ? WHERE id = ?').run(kg, Number(existing.id));
    recomputeAfterWeightChange(userId);
    return db.prepare('SELECT id, kg, date FROM weight_log WHERE id = ?').get(Number(existing.id));
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO weight_log (user_id, kg, date) VALUES (?, ?, ?)')
    .run(userId, kg, date);
  recomputeAfterWeightChange(userId);
  return db
    .prepare('SELECT id, kg, date FROM weight_log WHERE id = ?')
    .get(Number(lastInsertRowid));
}
