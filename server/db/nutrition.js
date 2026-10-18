/**
 * Podium — adatréteg: táplálkozás
 * ------------------------------------------------------------------------
 * Táplálkozási napló, víznapló, napi cél, edzői étrend, saját ételek és a
 * vonalkód-gyorsítótár.
 */
import { db } from './connection.js';
import { getCollection } from './schema.js';

/** A naplózott ételek, rögzítési sorrendben. */
export function getNutritionLog(userId) {
  return db
    .prepare(
      `SELECT id, name, grams, kcal, protein, carbs, fat, date
                     FROM nutrition_log WHERE user_id = ? ORDER BY id`,
    )
    .all(userId);
}

/** Egy adott nap naplózott ételei, rögzítési sorrendben. A Táplálkozás oldal
    mai naplója ebből épül — enélkül a felhasználó csak összesítést látott, és
    egy téves koppintást nem tudott visszavonni. */
export function getNutritionLogForDate(userId, date) {
  return db
    .prepare(
      `SELECT id, name, grams, kcal, protein, carbs, fat, date
                     FROM nutrition_log WHERE user_id = ? AND date = ? ORDER BY id`,
    )
    .all(userId, date);
}

/** Az étel tápértéke az adagra vetítve. Egy helyen él: a naplózás, az adag
    javítása, az edzői étrend tétele és a „Legutóbbiak" sor is ezt hívja, hogy
    ugyanarra a bemenetre ugyanazt adják (a (kcal × g) / 100 és a
    kcal × (g / 100) néha másra kerekít). A `base` a `baseGrams` grammra
    vonatkozik — alapesetben 100 g, az alapérték nélküli régi naplósornál a
    saját adagja. A kalória egész, a makrók egy tizedesre: így a napi összeg
    sem gyűjt lebegőpontos szemetet (pl. 0.30000000000000004 g zsír). */
function scaleMacros(base, grams, baseGrams = 100) {
  const factor = grams / baseGrams;
  const round1 = (value) => Math.round(value * factor * 10) / 10;
  return {
    kcal: Math.round(base.kcal * factor),
    protein: round1(base.protein),
    carbs: round1(base.carbs),
    fat: round1(base.fat),
  };
}

/** A legutóbb naplózott, egymástól KÜLÖNBÖZŐ ételek (legújabb elöl), mindegyik
    a legutóbbi adagjával. A Táplálkozás oldal „Legutóbbiak" sora ebből épül:
    ugyanazt az ételt újra naplózni a leggyakoribb művelet.

    Csak a ma is naplózható ételek kerülnek bele (findFoodForUser): egy azóta
    törölt saját étel újranaplózása 400-zal bukna el. A kalória a MOSTANI
    tápértékből és a legutóbbi adagból számolódik — ezt fogja a naplózás is
    rögzíteni. */
export function getRecentFoods(userId, limit = 8) {
  const rows = db
    .prepare(
      `SELECT name, grams FROM nutrition_log n
        WHERE user_id = ?
          AND id = (SELECT MAX(id) FROM nutrition_log m
                     WHERE m.user_id = n.user_id AND m.name = n.name)
        ORDER BY id DESC
        LIMIT ?`,
    )
    // Tartalék a kiszűrt (már nem naplózható) nevekre
    .all(userId, limit * 3);

  const recent = [];
  for (const row of rows) {
    const food = findFoodForUser(userId, row.name);
    if (!food) continue;
    recent.push({
      name: row.name,
      grams: row.grams,
      unit: food.unit || 'g',
      kcal: scaleMacros(food, row.grams).kcal,
    });
    if (recent.length === limit) break;
  }
  return recent;
}

/* ---- Víznapló ---- */

/** Egy nap víz-bejegyzései, legfrissebb elöl, a napi összeggel együtt.
    Milliliterben tároljuk: a +250 ml lépés egész szám, a liter csak
    megjelenítés — így nem gyűlik lebegőpontos hiba a nap folyamán. */
export function getWaterDay(userId, date) {
  const entries = db
    .prepare(
      `SELECT id, ml, logged_at AS loggedAt FROM water_log
                              WHERE user_id = ? AND date = ?
                              ORDER BY id DESC`,
    )
    .all(userId, date);
  return { totalMl: entries.reduce((sum, row) => sum + row.ml, 0), entries };
}

/** Egy korty rögzítése. Visszaadja a nap frissített állapotát. */
export function addWaterEntry(userId, date, ml) {
  db.prepare('INSERT INTO water_log (user_id, date, ml) VALUES (?, ?, ?)').run(userId, date, ml);
  return getWaterDay(userId, date);
}

/** Egy bejegyzés törlése. A user_id is feltétel, hogy idegen sorra ne
    lehessen törölni — ilyenkor nem talál sort, és a végpont 404-et ad. */
export function deleteWaterEntry(userId, entryId) {
  return (
    db.prepare('DELETE FROM water_log WHERE id = ? AND user_id = ?').run(entryId, userId).changes >
    0
  );
}

/** A nap naplójának lecserélése EGYETLEN bejegyzésre. A check-in űrlapján
    kézzel beírt literérték hívja: ott a felhasználó a NAPI ÖSSZEGET mondja
    meg, nem egy kortyot, tehát a korábbi tételek már nem érvényesek. Az
    időbélyegek elvesznek — cserébe a két felület sosem mond két számot. */
export function replaceWaterDay(userId, date, ml) {
  db.prepare('DELETE FROM water_log WHERE user_id = ? AND date = ?').run(userId, date);
  if (ml > 0)
    db.prepare('INSERT INTO water_log (user_id, date, ml) VALUES (?, ?, ?)').run(userId, date, ml);
  return getWaterDay(userId, date);
}

/* ---- Napi táplálkozási cél ----
   Az érvényes cél: 'coach' → 'own' → seed alapérték. Az edzői cél ZÁROL: amíg
   él, a sportoló nem írhatja felül (a PUT /api/nutrition/goal 403-at ad).
   Edzői cél csak az AKTUÁLIS, élő kapcsolatban álló edzőtől számít — a
   leválás vagy edzőváltás után a régi edző sora nem zárhatja a fiókot, és
   a sportoló saját célja újra érvénybe lép. */

/** Egy cél-sor a felület alakjában (a szerző nevével együtt). */
const toGoalRow = (row) =>
  row
    ? {
        calories: row.calories,
        protein: row.protein,
        setBy: row.set_by_name ?? null,
        setAt: row.updated_at,
      }
    : null;

const GOAL_SELECT = `
  SELECT g.calories, g.protein, g.updated_at, g.set_by, u.display_name AS set_by_name
  FROM nutrition_goals g LEFT JOIN users u ON u.id = g.set_by`;

/* Az edzői sor CSAK élő kapcsolat mellett érvényes: a beállító edzőnek most
   is aktív edzőjének kell lennie. A bontás (deleteCoachLink) ugyan elviszi a
   sort, de ha az edző a FIÓKJÁT törli, a kapcsolat vele megy, a set_by pedig
   NULL lesz — a sor ott maradna, és egy gazdátlan szám hajtaná a napi célt
   örökre. Ugyanígy a takarítás előtti fájlokon maradt sorok. Olvasáskor
   szűrünk, nem írunk: a sor csak nem érvényes. */
const LIVE_COACH_GOAL = `
  AND EXISTS (SELECT 1 FROM coach_links l
              WHERE l.coach_id = g.set_by AND l.athlete_id = g.user_id
                AND l.status = 'active')`;

/** Egy fiók cél-sora forrás szerint ('own' vagy 'coach'), vagy null. */
/* Modulon belüli segéd — kifelé a getNutritionGoal ad teljes képet. */
function getNutritionGoalRow(userId, source) {
  const live = source === 'coach' ? LIVE_COACH_GOAL : '';
  return db
    .prepare(`${GOAL_SELECT} WHERE g.user_id = ? AND g.source = ?${live}`)
    .get(userId, source);
}

/** A felhasználóra ÉRVÉNYES cél, a származásával együtt. A `locked` azt
    mondja meg, hogy a szám az edzőé-e — ilyenkor a sportoló nem módosíthatja. */
export function getNutritionGoal(userId) {
  const link = db
    .prepare("SELECT coach_id FROM coach_links WHERE athlete_id = ? AND status = 'active'")
    .get(userId);
  const coachRow = getNutritionGoalRow(userId, 'coach');
  // Csak a MOSTANI edző célja számít — a korábbié nem zárhatja a fiókot
  const coach = link && coachRow?.set_by === link.coach_id ? toGoalRow(coachRow) : null;
  const own = toGoalRow(getNutritionGoalRow(userId, 'own'));
  const fallback = getCollection('nutritionGoal') || { calories: 0, protein: 0 };

  const active = coach ?? own ?? { ...fallback, setBy: null, setAt: null };
  const source = coach ? 'coach' : own ? 'own' : 'default';

  /* A víz-cél külön sor, de ugyanaz a kapu: csak a mostani edzőé él. Ha
     nincs, null — a hívó a testsúlyos képletre esik vissza. */
  const water = link
    ? db
        .prepare('SELECT ml FROM water_goals WHERE user_id = ? AND set_by = ?')
        .get(userId, link.coach_id)
    : null;

  return {
    calories: active.calories,
    protein: active.protein,
    source,
    setBy: active.setBy,
    setAt: active.setAt,
    locked: source === 'coach',
    waterMl: water?.ml ?? null,
  };
}

/** Az edzői víz-cél mentése (ml). */
export function saveWaterGoal(userId, ml, setBy) {
  db.prepare(
    `INSERT INTO water_goals (user_id, ml, set_by, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       ml = excluded.ml, set_by = excluded.set_by, updated_at = excluded.updated_at`,
  ).run(userId, ml, setBy);
  return getNutritionGoal(userId);
}

/** Az edzői víz-cél elvetése — a cél visszaáll a testsúlyos képletre. */
export function clearWaterGoal(userId) {
  db.prepare('DELETE FROM water_goals WHERE user_id = ?').run(userId);
  return getNutritionGoal(userId);
}

/** Cél mentése/felülírása egy forrásra. A `setBy` az, AKI beállította — az
    edzői sornál az edző, a sajátnál a felhasználó maga. */
export function saveNutritionGoal(userId, source, { calories, protein }, setBy) {
  db.prepare(
    `
    INSERT INTO nutrition_goals (user_id, source, calories, protein, set_by, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, source) DO UPDATE SET
      calories = excluded.calories, protein = excluded.protein,
      set_by = excluded.set_by, updated_at = excluded.updated_at
  `,
  ).run(userId, source, calories, protein, setBy);
  return getNutritionGoal(userId);
}

/** A SAJÁT cél törlése — ezzel a felhasználó visszaáll az alapértékre (ha
    közben edzői cél él, az marad érvényben). Az edzői sort ez nem bántja. */
export function clearOwnNutritionGoal(userId) {
  db.prepare("DELETE FROM nutrition_goals WHERE user_id = ? AND source = 'own'").run(userId);
  return getNutritionGoal(userId);
}

/* ---- Edzői étrend: étkezések ----
   Az edző állítja össze, a sportoló látja és egy gombbal naplózza. A napi
   céltól FÜGGETLEN: az étrend összege csak viszonyítás, a cél külön szám. */

/** Egy tétel makrói az adagra — ugyanaz a vetítés (scaleMacros), mint a
    naplózásé, hogy a naplózott bejegyzés pontosan azt adja, amit az étrend
    ígért. */
function scaleMealItem(item) {
  return {
    name: item.name,
    grams: item.grams,
    ...scaleMacros(
      {
        kcal: item.base_kcal,
        protein: item.base_protein,
        carbs: item.base_carbs,
        fat: item.base_fat,
      },
      item.grams,
    ),
  };
}

/** Egy coach_meals sor → a felület alakja, tételenként és összesítve. Az
    `eatenToday` a lekérdezés napjára szól (a sor `eaten` oszlopa). */
function toMeal(row) {
  const items = JSON.parse(row.items).map(scaleMealItem);
  const sum = (key) => Math.round(items.reduce((acc, item) => acc + item[key], 0) * 10) / 10;
  return {
    id: row.id,
    name: row.name,
    items,
    kcal: sum('kcal'),
    protein: sum('protein'),
    carbs: sum('carbs'),
    fat: sum('fat'),
    setBy: row.set_by_name ?? null,
    updatedAt: row.updated_at,
    eatenToday: Boolean(row.eaten),
  };
}

/* Az étkezés CSAK élő kapcsolat mellett érvényes — ugyanaz a kapu, mint a
   LIVE_COACH_GOAL-nál. A bontás és a fióktörlés takarít, ez a régebbi
   fájlokon ottmaradt (vagy set_by = NULL) sorok ellen véd. */
const LIVE_COACH_MEAL = `
  AND EXISTS (SELECT 1 FROM coach_links cl
              WHERE cl.coach_id = m.set_by AND cl.athlete_id = m.user_id
                AND cl.status = 'active')`;

/** A sportoló étrendje, az edző által megadott sorrendben, azzal együtt,
    hogy a megadott NAPON melyik étkezést ette már meg. */
export function getCoachMeals(userId, date) {
  return db
    .prepare(
      `SELECT m.id, m.name, m.items, m.updated_at, u.display_name AS set_by_name,
              (l.meal_id IS NOT NULL) AS eaten
       FROM coach_meals m
       LEFT JOIN users u ON u.id = m.set_by
       LEFT JOIN coach_meal_logs l ON l.meal_id = m.id AND l.date = ?
       WHERE m.user_id = ?${LIVE_COACH_MEAL}
       ORDER BY m.position, m.id`,
    )
    .all(date, userId)
    .map(toMeal);
}

/** Hány étkezés van már — a felső korlát ellenőrzéséhez. */
export function countCoachMeals(userId) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM coach_meals m WHERE m.user_id = ?${LIVE_COACH_MEAL}`)
    .get(userId).n;
}

/** A tételek tárolt alakja: a név, az adag és a 100 g-os makrók másolata. */
const storedMealItems = (items) =>
  JSON.stringify(
    items.map(({ food, grams }) => ({
      name: food.name,
      grams,
      base_kcal: food.kcal,
      base_protein: food.protein,
      base_carbs: food.carbs,
      base_fat: food.fat,
    })),
  );

/** Új étkezés a sportoló étrendjének végére. Az `items` már feloldott
    ételeket tartalmaz: [{ food, grams }]. A friss étrendet adja vissza (a
    `date` napjára szóló „megette" jelzéssel). */
export function createCoachMeal(userId, setBy, { name, items }, date) {
  const { next } = db
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM coach_meals WHERE user_id = ?')
    .get(userId);
  db.prepare(
    `INSERT INTO coach_meals (user_id, set_by, name, position, items)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, setBy, name, next, storedMealItems(items));
  return getCoachMeals(userId, date);
}

/** Étkezés felülírása. Idegen vagy ismeretlen id-re null (→ 404). */
export function updateCoachMeal(userId, mealId, setBy, { name, items }, date) {
  const { changes } = db
    .prepare(
      `UPDATE coach_meals SET name = ?, items = ?, set_by = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .run(name, storedMealItems(items), setBy, mealId, userId);
  return changes > 0 ? getCoachMeals(userId, date) : null;
}

/** Étkezés törlése. Idegen vagy ismeretlen id-re null (→ 404). */
export function deleteCoachMeal(userId, mealId, date) {
  const { changes } = db
    .prepare('DELETE FROM coach_meals WHERE id = ? AND user_id = ?')
    .run(mealId, userId);
  return changes > 0 ? getCoachMeals(userId, date) : null;
}

/** Egy étkezés MINDEN tételének naplózása a megadott napra, egy
    tranzakcióban — félúton megszakadva fél étkezés kerülne a naplóba.
    A makrók a tárolt másolatból jönnek, nem a katalógusból.
    Naponta EGYSZER: a második próbálkozás { alreadyEaten: true }-t ad, és
    semmit nem ír. Idegen vagy ismeretlen étkezésre null. */
export function logCoachMeal(userId, mealId, date) {
  const row = db
    .prepare(`SELECT items FROM coach_meals m WHERE m.id = ? AND m.user_id = ?${LIVE_COACH_MEAL}`)
    .get(mealId, userId);
  if (!row) return null;

  db.exec('BEGIN IMMEDIATE');
  try {
    /* A jelölés MEGELŐZI a naplózást, ugyanabban a tranzakcióban: a
       PRIMARY KEY dönti el, ki volt az első — két gyors koppintás sem
       írhat kétszer a naplóba. */
    const { changes } = db
      .prepare('INSERT OR IGNORE INTO coach_meal_logs (meal_id, date) VALUES (?, ?)')
      .run(mealId, date);
    if (changes === 0) {
      db.exec('ROLLBACK');
      return { alreadyEaten: true };
    }
    const entries = JSON.parse(row.items).map((item) =>
      insertNutritionEntry(
        userId,
        {
          name: item.name,
          kcal: item.base_kcal,
          protein: item.base_protein,
          carbs: item.base_carbs,
          fat: item.base_fat,
        },
        date,
        item.grams,
      ),
    );
    db.exec('COMMIT');
    return {
      entries,
      totals: getNutritionTotals(userId, date),
      meals: getCoachMeals(userId, date),
    };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** A napi táplálkozási összesítő egy adott napra: az AZNAP naplózott ételek
    összege, valamint az érvényes napi cél (a felület a célhoz méri a
    bevitelt). */

/** A napi táplálkozási összesítő egy adott napra: az AZNAP naplózott ételek
    összege, valamint az edző által kitűzött napi cél (a felület a célhoz
    méri a bevitelt). */
export function getNutritionTotals(userId, date) {
  const sum = db
    .prepare(
      `
    SELECT COALESCE(SUM(kcal), 0)    AS intake,
           COALESCE(SUM(protein), 0) AS protein,
           COALESCE(SUM(carbs), 0)   AS carbs,
           COALESCE(SUM(fat), 0)     AS fat
    FROM nutrition_log
    WHERE user_id = ? AND date = ?
  `,
    )
    .get(userId, date);
  return { ...sum, goal: getNutritionGoal(userId) };
}

/* ======================================================================
   Saját ételek — a felhasználó által felvitt, illetve vonalkódról beolvasott
   termékek. A beépített katalógussal AZONOS alakot adnak vissza (100 g-ra
   vonatkozó makrók), csak a `custom: true` jelző különbözteti meg őket — így
   a naplózás, az adagválasztó és az étel-kártya változtatás nélkül működik.
   ====================================================================== */

/** Egy custom_foods sor → a felület (és a naplózás) által várt étel-alak.
    A `per` címkét ugyanúgy képezzük, mint a catalog.js a seed-ételeknél —
    enélkül az étel-kártya „undefined"-ot írna ki. */
const toCustomFood = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        brand: row.brand || undefined,
        // A csoport nélküli saját ételek is kapjanak besorolást: a felület a
        // group mezőt írja ki a kártyára, és keresni is lehet rá.
        group: row.food_group || 'Saját étel',
        unit: row.unit,
        per: `100 ${row.unit}`,
        kcal: row.kcal,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
        kcalAuto: row.kcal_auto === 1,
        portions: JSON.parse(row.portions || '[]'),
        barcode: row.barcode || undefined,
        source: row.source,
        custom: true,
      }
    : null;

const CUSTOM_FOOD_COLS = `id, name, brand, food_group, unit, kcal, protein, carbs, fat,
                          kcal_auto, barcode, portions, source`;

/** A hívó saját ételei, felvitel sorrendjében. */
export function listCustomFoods(userId) {
  return db
    .prepare(`SELECT ${CUSTOM_FOOD_COLS} FROM custom_foods WHERE user_id = ? ORDER BY id`)
    .all(userId)
    .map(toCustomFood);
}

/** Saját étel név szerint (kis/nagybetű-érzéketlen — a name COLLATE NOCASE). */
export function getCustomFoodByName(userId, name) {
  return toCustomFood(
    db
      .prepare(
        `SELECT ${CUSTOM_FOOD_COLS} FROM custom_foods
                                  WHERE user_id = ? AND name = ?`,
      )
      .get(userId, name),
  );
}

/** Saját étel vonalkód szerint — a beolvasás ezzel zárható rövidre (ha a
    terméket már felvitte, nincs se hálózati kör, se újabb kitöltés). */
export function getCustomFoodByBarcode(userId, barcode) {
  return toCustomFood(
    db
      .prepare(
        `SELECT ${CUSTOM_FOOD_COLS} FROM custom_foods
                                  WHERE user_id = ? AND barcode = ?`,
      )
      .get(userId, barcode),
  );
}

/** Névütközés a hívó saját ételei közt, ÉKEZETEKKEL EGYÜTT.
    A tábla COLLATE NOCASE-e csak ASCII-t hajt: SQL szinten a „Túró Rudi" és a
    „TÚRÓ RUDI" két külön sor lenne, a felhasználó viszont joggal ugyanannak az
    ételnek látja őket. A JS toLowerCase() Unicode-ot is kezel, és a saját lista
    néhány tucat elem — bőven megéri végigolvasni. */
const customNameTaken = (userId, name) => {
  const needle = String(name).toLowerCase();
  return listCustomFoods(userId).some((food) => food.name.toLowerCase() === needle);
};

/** Saját étel felvitele. A validálást a végpont végzi; ide már tiszta, 100 g-ra
    normalizált adat érkezik. Ütközésnél (azonos név vagy vonalkód ugyanannál a
    fióknál) null-t ad — a hívó ebből 409-et képez. */
export function addCustomFood(userId, food) {
  if (customNameTaken(userId, food.name)) return null;
  if (food.barcode && getCustomFoodByBarcode(userId, food.barcode)) return null;

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO custom_foods (user_id, name, brand, food_group, unit, kcal,
                               protein, carbs, fat, kcal_auto, barcode, portions, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      food.name,
      food.brand ?? '',
      food.group ?? '',
      food.unit,
      food.kcal,
      food.protein,
      food.carbs,
      food.fat,
      food.kcalAuto ? 1 : 0,
      food.barcode ?? null,
      JSON.stringify(food.portions ?? []),
      food.source ?? 'manual',
    );
  return toCustomFood(
    db
      .prepare(`SELECT ${CUSTOM_FOOD_COLS} FROM custom_foods WHERE id = ?`)
      .get(Number(lastInsertRowid)),
  );
}

/** Saját étel törlése. Ismeretlen id-re vagy MÁS felhasználó ételére false —
    a hívó ebből 404-et képez. A már lenaplózott bejegyzések NEM sérülnek: a
    nutrition_log a nevet és a kiszámolt makrókat MÁSOLATBAN tárolja, tehát a
    korábbi napok összesítői változatlanok maradnak. */
export function deleteCustomFood(userId, id) {
  return (
    db.prepare('DELETE FROM custom_foods WHERE id = ? AND user_id = ?').run(id, userId).changes > 0
  );
}

/** A hívónak megjelenítendő teljes étel-lista: elöl a sajátjai (azokat keresi
    a leggyakrabban), utána a beépített katalógus.
    FONTOS: a getCollection('foods') tömbje MEGOSZTOTT és cache-elt — ezért ÚJ
    tömböt képzünk a spreaddel, belepush-olni tilos lenne. */
export function getFoodsForUser(userId) {
  return [...listCustomFoods(userId), ...(getCollection('foods') || [])];
}

/** Naplózható étel keresése név szerint. A SAJÁT étel nyer: a beépített
    katalógus később bővülhet egy olyan névvel, amit a felhasználó már felvitt
    — ilyenkor is az ő tápértékei az érvényesek. */
export function findFoodForUser(userId, name) {
  return (
    getCustomFoodByName(userId, name) ||
    (getCollection('foods') || []).find((f) => f.name === name) ||
    null
  );
}

/* ---- Vonalkód-gyorsítótár ---- */

/** Friss cache-sor vagy null. A frissesség HATÁRA a találattól függ: egy
    megtalált termék tápértéke ritkán változik (30 nap), a „nem ismerjük"
    viszont holnap már lehet más (1 nap — az OFF közösségi adatbázis, naponta
    ezrével kerülnek bele termékek).
    A CASE-t szándékosan SQL-ben számoljuk: a SQLite dátumformátuma
    („ÉÉÉÉ-HH-NN óó:pp:mm") JS-ben nem szabványosan parse-olható. */
export function readBarcodeCache(barcode) {
  const row = db
    .prepare(
      `
    SELECT found, payload FROM barcode_cache
    WHERE barcode = ?
      AND fetched_at > datetime('now', CASE found WHEN 1 THEN '-30 days' ELSE '-1 day' END)
  `,
    )
    .get(barcode);
  if (!row) return null;
  return { found: row.found === 1, product: row.found === 1 ? JSON.parse(row.payload) : null };
}

/** Cache-írás. A `product === null` a negatív találatot rögzíti. */
export function writeBarcodeCache(barcode, product) {
  db.prepare(
    `INSERT INTO barcode_cache (barcode, found, payload, fetched_at)
              VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(barcode) DO UPDATE SET
                found = excluded.found, payload = excluded.payload,
                fetched_at = excluded.fetched_at`,
  ).run(barcode, product ? 1 : 0, JSON.stringify(product ?? {}));
}

/** A lejárt cache-sorok takarítása. A readBarcodeCache úgyis csak a friss
    sort adja vissza, tehát a lejárt sorok nem rossz adatot okoznak — csak
    korlátlanul gyűlnek, és a NEGATÍV találatok gyűlnek a leggyorsabban (egy
    végigsorolt kódtartomány minden kérése hagy egyet, és egy nap után
    mindegyik használhatatlan). A határok ugyanazok, mint az olvasásnál:
    talált 30 nap, nem talált 1 nap.
    @returns {number} a törölt sorok száma */
export function purgeBarcodeCache() {
  return db
    .prepare(
      `DELETE FROM barcode_cache
       WHERE fetched_at <= datetime('now', CASE found WHEN 1 THEN '-30 days' ELSE '-1 day' END)`,
    )
    .run().changes;
}

/** Étel naplózása a megadott adaggal (a makrók a szerver-oldali food
    objektumból, 100 g-ra vonatkozó alapértékekből átszámolva — a kliens által
    küldött tápértékekben nem bízunk, csak az adag grammjában).
    Visszaadja a létrejött bejegyzést és a frissített napi összesítőt. */
export function addNutritionEntry(userId, food, date, grams = 100) {
  const entry = insertNutritionEntry(userId, food, date, grams);
  return { entry, totals: getNutritionTotals(userId, date) };
}

/** Egy naplósor beszúrása összesítő nélkül — a több tételt egyszerre író
    hívó (logCoachMeal) a végén EGYSZER számol összesítőt. */
function insertNutritionEntry(userId, food, date, grams) {
  const scaled = scaleMacros(food, grams);

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO nutrition_log (user_id, name, grams, kcal, protein, carbs, fat, date,
                                 base_kcal, base_protein, base_carbs, base_fat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      food.name,
      grams,
      scaled.kcal,
      scaled.protein,
      scaled.carbs,
      scaled.fat,
      date,
      food.kcal,
      food.protein,
      food.carbs,
      food.fat,
    );
  return db
    .prepare(
      `SELECT id, name, grams, kcal, protein, carbs, fat, date
                            FROM nutrition_log WHERE id = ?`,
    )
    .get(Number(lastInsertRowid));
}

/** Egy naplóbejegyzés törlése (a Táplálkozás oldal ✕ gombja). Csak a MAI
    bejegyzés törölhető: a korábbi napok összesítői már beépültek a
    készenlét-számításba, azokat visszamenőleg nem írjuk át. Ismeretlen, nem
    aznapi vagy MÁS FELHASZNÁLÓ id-jére null-t ad — a hívó ebből 404-et képez. */
/** Egy naplóbejegyzés adagjának javítása.
 *
 * A makrókat ARÁNYOSAN számoljuk át a tárolt értékekből, nem az étel-
 * katalógusból: a nutrition_log szándékosan MÁSOLATBAN tárolja a makrókat
 * (ezért nem sérti a régi bejegyzéseket, ha egy saját étel később eltűnik).
 * Ha a katalógusból számolnánk újra, ez az elv törne meg.
 *
 * A dátumra NEM szűrünk: a tegnapi elgépelést is javítani kell tudni. A
 * válasz az ÉRINTETT NAP összesítője, nem a mai — különben a felület egy
 * másik nap számait frissítené.
 */
export function updateNutritionEntry(userId, id, grams) {
  const row = db
    .prepare(
      `SELECT grams, kcal, protein, carbs, fat, date,
              base_kcal, base_protein, base_carbs, base_fat
                          FROM nutrition_log WHERE id = ? AND user_id = ?`,
    )
    .get(id, userId);
  if (!row || !(row.grams > 0)) return null;

  /* Ha a sor tárolja a KEREKÍTETLEN 100 g-os alapértéket, abból számolunk —
     ugyanúgy, mint a naplózáskor. A régi (alapérték nélküli) soroknál marad
     az arányosítás a tárolt, adagra vetített értékből. */
  const hasBase = [row.base_kcal, row.base_protein, row.base_carbs, row.base_fat].every(
    (value) => value !== null,
  );
  const scaled = hasBase
    ? scaleMacros(
        {
          kcal: row.base_kcal,
          protein: row.base_protein,
          carbs: row.base_carbs,
          fat: row.base_fat,
        },
        grams,
      )
    : scaleMacros(row, grams, row.grams);
  db.prepare(
    `UPDATE nutrition_log
                 SET grams = ?, kcal = ?, protein = ?, carbs = ?, fat = ?
               WHERE id = ? AND user_id = ?`,
  ).run(grams, scaled.kcal, scaled.protein, scaled.carbs, scaled.fat, id, userId);

  return { date: row.date, totals: getNutritionTotals(userId, row.date) };
}

/** Naplóbejegyzés törlése. A dátumot a hívó adja meg — a mai napló
    visszavonásához ez elég, és a régebbi napokat véletlenül nem bántja. */
export function deleteNutritionEntry(userId, id, date) {
  const { changes } = db
    .prepare('DELETE FROM nutrition_log WHERE id = ? AND user_id = ? AND date = ?')
    .run(id, userId, date);
  return changes > 0 ? getNutritionTotals(userId, date) : null;
}
