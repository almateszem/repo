/**
 * Podium — táplálkozás
 * ------------------------------------------------------------------------
 * Étel-katalógus, táplálkozási napló, víznapló, napi cél (a sajátja és az
 * edzőé), edzői étrend, saját ételek és vonalkód.
 */
import { parseNames, parsePageParams } from '../catalog-search.js';
import { dayKey } from '../dates.js';
import {
  addCustomFood,
  addNutritionEntry,
  addWaterEntry,
  clearOwnNutritionGoal,
  clearWaterGoal,
  countCoachMeals,
  createCoachMeal,
  deleteCoachMeal,
  deleteCustomFood,
  deleteNutritionEntry,
  deleteWaterEntry,
  findFoodForUser,
  getCoachMeals,
  getCollection,
  getCustomFoodByBarcode,
  getNutritionGoal,
  getNutritionLogForDate,
  getNutritionTotals,
  getRecentFoods,
  getWaterDay,
  getWeightLog,
  logCoachMeal,
  readBarcodeCache,
  saveNutritionGoal,
  saveWaterGoal,
  updateCoachMeal,
  updateNutritionEntry,
  writeBarcodeCache,
} from '../db.js';
import { MAX_PORTION_GRAMS, parseCustomFood } from '../foods-validate.js';
import { formatDecimal } from '../numbers.js';
import { fetchProduct, normalizeBarcode } from '../openfoodfacts.js';
import { hydrationTarget } from '../recovery.js';
import { barcodeLookupLimiter, tooManyRequests } from '../http/session.js';
import { readOptionalNumber } from './training.js';
import { linkFor } from '../http/access.js';

/* ---- Víznapló ----
   A napi folyadékbevitel a Recovery Engine bemenete (nutritionScore). A
   víznapló az egyetlen forrás: a motor (readinessInput) és a check-in
   (db.js → CHECKIN_COLUMNS) is innen olvas, tehát egy korty nem hoz létre
   check-in sort. A kliens így a Táplálkozás oldalról is a készenlétet mozgatja. */

const WATER_SIP = { min: 1, max: 3000 }; // ml, egy bejegyzés
const WATER_DAY_MAX = 15000; // ml, a napi összeg felső határa

/** A nap víz-állapota a céllal együtt. A cél az edző által kitűzött érték,
    ha van (`targetSource: 'coach'`); különben UGYANABBÓL a képletből jön,
    amit a Recovery Engine használ (~33 ml/testsúlykg). A motor is ugyanezt a
    sorrendet követi — ha a felület más célt mondana, a „teljesítettem"
    érzés és a pontszám szétcsúszna. */
function waterDay(userId, date) {
  const day = getWaterDay(userId, date);
  const goal = getNutritionGoal(userId);
  if (goal.waterMl) {
    return { ...day, targetMl: goal.waterMl, targetSource: 'coach' };
  }
  const latest = [...getWeightLog(userId)].sort((a, b) => dayKey(b.date) - dayKey(a.date))[0];
  return {
    ...day,
    targetMl: Math.round(hydrationTarget(latest?.kg ?? null) * 1000),
    targetSource: 'auto',
  };
}

/* ---- Napi táplálkozási cél ----
   Korábban EGY fix érték szolgálta ki az összes fiókot (data.js →
   nutritionGoal), és sehol nem lehetett szerkeszteni.

   Két forrás van: amit az EDZŐ tűzött ki, és amit a felhasználó MAGA
   állított be. Az edzőé az erősebb, és zárol: amíg a mostani edző célja él,
   a sportoló nem módosíthatja. Edző nélkül (vagy leválás után) a saját cél
   szól. */
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

/** Az EDZŐ tűz ki célt a sportolójának. Ez azonnal érvényes, és zárol: a
    sportoló nem írhatja felül. A saját célját nem töröljük — ha később
    leválik az edzőről, az lép újra érvénybe.
    A kapu ugyanaz, mint a terv-kiosztásé: csak az edző oldala, csak ÉLŐ
    kapcsolatba. */
/** Az EDZŐ víz-célja literben ({ liters }). A sportoló nem módosíthatja; a
    DELETE visszaállítja a testsúlyból számolt célra. Ugyanaz a kapu, mint a
    kalória-célnál. */
const WATER_GOAL_LITERS = { min: 0.5, max: 10 };
/* ---- Edzői étrend: étkezések ----
   Az edző a napi cél mellé étkezéseket is összeállíthat (pl. „Reggeli":
   200 g csirkemell + 150 g rizs). A kcal-t és a makrókat a SZERVER számolja
   a katalógusból — a kliens csak az étel nevét és a grammot küldi, ugyanúgy,
   mint a naplózásnál. A napi céltól független: annak összege csak viszonyítás. */
const MEAL_LIMITS = { nameMax: 40, itemsMax: 30, mealsMax: 10 };

/** Egy étkezés törzsének beolvasása: { name, items: [{ name, grams }] }.
    Az ételt az EDZŐ fiókjából oldjuk fel (katalógus + a saját ételei) — a
    tárolt makró-másolat miatt a sportolónak nem kell ismernie. Hibánál
    { error }-t ad. */
function parseMealBody(coachId, body) {
  const name = String(body?.name ?? '').trim();
  if (!name || name.length > MEAL_LIMITS.nameMax) {
    return { error: `Az étkezés neve 1–${MEAL_LIMITS.nameMax} karakter legyen.` };
  }
  const rawItems = body?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: 'Adj legalább egy ételt az étkezéshez.' };
  }
  if (rawItems.length > MEAL_LIMITS.itemsMax) {
    return { error: `Egy étkezésben legfeljebb ${MEAL_LIMITS.itemsMax} tétel lehet.` };
  }

  const items = [];
  for (const raw of rawItems) {
    const foodName = String(raw?.name ?? '').trim();
    const food = findFoodForUser(coachId, foodName);
    if (!food) return { error: `Ismeretlen étel: ${foodName || '(üres)'}` };
    const grams = Number(raw?.grams);
    if (!Number.isFinite(grams) || grams < 1 || grams > MAX_PORTION_GRAMS) {
      return { error: `${food.name}: az adag 1 és ${MAX_PORTION_GRAMS} g között adható meg.` };
    }
    items.push({ food, grams: Math.round(grams) });
  }
  return { meal: { name, items } };
}

/** Az útvonalak bekötése. Ugyanarra az app-ra, amit a server.js épít — NEM
    express.Router és NEM al-alkalmazás: a guardAsyncRoutes csak az app
    metódusait foltozza (errors.js), egy Router async kezelőjének hibájára
    nem jönne válasz, egy al-alkalmazás pedig elveszítené a trust proxy
    beállítást. */
export function register(app, { catalogSearch }) {
  app.get('/api/food-groups', (req, res) => res.json(catalogSearch.foodGroups()));

  /* Az edzői étrend-szerkesztő ezzel oldja fel a már bent lévő tételek
     tápértékét. A neveket a nyers URL-ből olvassuk: az Express query-parsere
     20 ismétlődő `name` felett tömb helyett objektumot ad. */
  app.get('/api/foods/by-name', (req, res) => {
    const raw = new URLSearchParams(req.originalUrl.split('?')[1] ?? '').getAll('name');
    const parsed = parseNames(raw);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    res.json(catalogSearch.findFoodsByName(req.user.id, parsed.names));
  });

  app.get('/api/water', (req, res) => {
    res.json(waterDay(req.user.id, req.today));
  });

  app.post('/api/water', (req, res) => {
    const parsed = readOptionalNumber(req.body?.ml, { ...WATER_SIP, integer: true });
    if (parsed.error || parsed.value === null) {
      return res.status(400).json({ error: parsed.error || 'Hiányzó mennyiség.' });
    }
    const current = getWaterDay(req.user.id, req.today);
    if (current.totalMl + parsed.value > WATER_DAY_MAX) {
      return res.status(400).json({ error: 'A napi folyadékbevitel legfeljebb 15 liter lehet.' });
    }
    addWaterEntry(req.user.id, req.today, parsed.value);
    res.status(201).json(waterDay(req.user.id, req.today));
  });

  app.delete('/api/water/:id', (req, res) => {
    const id = Number(req.params.id);
    // 404 és nem 403: a létezés ténye sem szivároghat ki idegen sorra.
    if (!Number.isInteger(id) || !deleteWaterEntry(req.user.id, id)) {
      return res.status(404).json({ error: 'Nincs ilyen bejegyzés.' });
    }
    res.json(waterDay(req.user.id, req.today));
  });

  /** Az étel-lista, lapozva: elöl a hívó SAJÁT ételei, utánuk a beépített
      katalógus; a keresés a névre, a kategóriára és a márkára
      (server/catalog-search.js). Ezért nem maradhatott a READ_ENDPOINTS
      generikus ágán — az felhasználó-független kollekciókat szolgál ki. */
  app.get('/api/foods', (req, res) => {
    const params = parsePageParams(req.query);
    if (params.error) return res.status(400).json({ error: params.error });
    res.json(catalogSearch.searchFoods(req.user.id, params));
  });

  // Napi táplálkozási összesítő (alap + a MAI naplózott ételek)
  app.get('/api/nutrition', (req, res) => res.json(getNutritionTotals(req.user.id, req.today)));

  /** A SAJÁT cél beállítása — csak akkor, ha nincs érvényben edzői cél. */
  app.put('/api/nutrition/goal', (req, res) => {
    // Az edző által kitűzött cél zárol — csak az edző módosíthatja
    if (getNutritionGoal(req.user.id).locked) {
      return res.status(403).json({ error: 'Ezt a célt az edződ tűzte ki — csak ő módosíthatja.' });
    }
    const { goal, error } = parseGoalBody(req.body);
    if (error) return res.status(400).json({ error });
    res.json(saveNutritionGoal(req.user.id, 'own', goal, req.user.id));
  });

  /** A saját cél elvetése — ezzel visszaállsz az alapértékre. Az edzői sort
      nem érinti (ha az él, továbbra is az szól). */
  app.delete('/api/nutrition/goal', (req, res) => res.json(clearOwnNutritionGoal(req.user.id)));

  app.put('/api/athletes/:linkId/water-goal', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, { as: 'coach' });
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    const liters = Number(req.body?.liters);
    if (
      !Number.isFinite(liters) ||
      liters < WATER_GOAL_LITERS.min ||
      liters > WATER_GOAL_LITERS.max
    ) {
      return res.status(400).json({
        error: `A napi víz-cél ${formatDecimal(WATER_GOAL_LITERS.min)} és ${formatDecimal(WATER_GOAL_LITERS.max)} liter között adható meg.`,
      });
    }
    res.json(saveWaterGoal(link.athleteId, Math.round(liters * 1000), req.user.id));
  });

  app.delete('/api/athletes/:linkId/water-goal', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, { as: 'coach' });
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    res.json(clearWaterGoal(link.athleteId));
  });

  app.put('/api/athletes/:linkId/nutrition-goal', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, { as: 'coach' });
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    const { goal, error } = parseGoalBody(req.body);
    if (error) return res.status(400).json({ error });
    res.json(saveNutritionGoal(link.athleteId, 'coach', goal, req.user.id));
  });

  app.get('/api/nutrition/log', (req, res) =>
    res.json(getNutritionLogForDate(req.user.id, req.today)),
  );

  // A legutóbb naplózott ételek a legutóbbi adaggal — a „Legutóbbiak" sorhoz
  app.get('/api/nutrition/recent', (req, res) => res.json(getRecentFoods(req.user.id)));

  /** Étel naplózása. Törzs: { name, grams }. A szerver a foods-ból keresi ki a
      makrókat (a kliens értékeiben nem bízunk), és a megadott adagra számolja át
      őket. A grams elhagyható — ilyenkor a korábbi viselkedés szerint 100 g.
      A válasz { entry, totals }: a létrejött bejegyzés (a mai napló listájához,
      id-vel a törléshez) és a friss összesítő. */
  app.post('/api/nutrition/log', (req, res) => {
    const name = String(req.body?.name ?? '');
    // A saját étel is naplózható; névütközéskor az ÖVÉ nyer (findFoodForUser).
    // Az addNutritionEntry innentől sem tud róla, hogy az étel „saját": a
    // nutrition_log a nevet és a kiszámolt makrókat MÁSOLATBAN tárolja, ezért a
    // saját étel későbbi törlése a régi bejegyzéseket és összesítőket nem sérti.
    const food = findFoodForUser(req.user.id, name);
    if (!food) {
      return res
        .status(400)
        .json({ error: 'Ismeretlen étel — csak a listában szereplő adható a naplóhoz.' });
    }

    const grams = req.body?.grams === undefined ? 100 : Number(req.body.grams);
    if (!Number.isFinite(grams) || grams < 1 || grams > MAX_PORTION_GRAMS) {
      return res.status(400).json({
        error: `Érvénytelen adag — 1 és ${MAX_PORTION_GRAMS} g között adható meg.`,
      });
    }

    res.status(201).json(addNutritionEntry(req.user.id, food, req.today, Math.round(grams)));
  });

  app.post('/api/athletes/:linkId/meals', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, { as: 'coach' });
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    const { meal, error } = parseMealBody(req.user.id, req.body);
    if (error) return res.status(400).json({ error });
    if (countCoachMeals(link.athleteId) >= MEAL_LIMITS.mealsMax) {
      return res
        .status(400)
        .json({ error: `Legfeljebb ${MEAL_LIMITS.mealsMax} étkezés állítható össze.` });
    }
    res.status(201).json(createCoachMeal(link.athleteId, req.user.id, meal, req.today));
  });

  app.put('/api/athletes/:linkId/meals/:mealId', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, { as: 'coach' });
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    const { meal, error } = parseMealBody(req.user.id, req.body);
    if (error) return res.status(400).json({ error });
    const meals = updateCoachMeal(
      link.athleteId,
      Number(req.params.mealId),
      req.user.id,
      meal,
      req.today,
    );
    if (!meals) return res.status(404).json({ error: 'Nincs ilyen étkezés.' });
    res.json(meals);
  });

  app.delete('/api/athletes/:linkId/meals/:mealId', (req, res) => {
    const access = linkFor(req.user, req.params.linkId, { as: 'coach' });
    if (!access.link) return res.status(access.code).json({ error: access.error });
    const { link } = access;
    const meals = deleteCoachMeal(link.athleteId, Number(req.params.mealId), req.today);
    if (!meals) return res.status(404).json({ error: 'Nincs ilyen étkezés.' });
    res.json(meals);
  });

  /** A SAJÁT étrendem — amit az edzőm állított össze, a mai „megette"
      jelzéssel (a felület a már megetteket elrejti). */
  app.get('/api/nutrition/meals', (req, res) => res.json(getCoachMeals(req.user.id, req.today)));

  /** Egy étkezés naplózása a MAI napra, minden tételével — naponta egyszer.
      A válasz { entries, totals, meals }: a mai napló új sorai, a friss
      összesítő és a frissített étrend. */
  app.post('/api/nutrition/meals/:id/log', (req, res) => {
    const result = logCoachMeal(req.user.id, Number(req.params.id), req.today);
    if (!result) return res.status(404).json({ error: 'Nincs ilyen étkezés.' });
    if (result.alreadyEaten) {
      return res.status(409).json({ error: 'Ezt az étkezést ma már naplóztad.' });
    }
    res.status(201).json(result);
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
      return res
        .status(400)
        .json({ error: `Az adag 1 és ${MAX_PORTION_GRAMS} gramm között adható meg.` });
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
      return res
        .status(404)
        .json({ error: 'Ez a bejegyzés nem törölhető — csak a mai napló módosítható.' });
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

  /** Saját étel felvitele (az ellenőrzés: foods-validate.js → parseCustomFood). */
  app.post('/api/foods/custom', (req, res) => {
    const parsed = parseCustomFood(req.body, getCollection('foods') || []);
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });

    const saved = addCustomFood(req.user.id, parsed.food);
    if (!saved) {
      return res
        .status(409)
        .json({ error: 'Már van ilyen nevű vagy ilyen vonalkódú saját ételed.' });
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

    /* Innentől kimegyünk a hálózatra — EZ a drága ág, tehát a korlát is itt
       ül, nem a végpont elején (ld. barcodeLookupLimiter). */
    const quota = barcodeLookupLimiter.hit(req.user.id);
    if (!quota.allowed) {
      return tooManyRequests(
        res,
        quota.retryAfter,
        'Túl sok vonalkód-keresés egymás után. Várj egy kicsit, vagy vidd fel kézzel.',
      );
    }

    const result = await fetchProduct(barcode);
    if (!result.ok) {
      // Hálózati hiba: NEM cache-eljük — holnap (vagy egy perc múlva) sikerülhet.
      // Az okát naplózzuk, hogy egy tartós hiba ne maradjon néma.
      console.warn(`Open Food Facts (${barcode}): ${result.reason}`);
      return res.status(502).json({
        error: 'Az Open Food Facts most nem elérhető — próbáld később, vagy vidd fel kézzel.',
      });
    }
    writeBarcodeCache(barcode, result.product);
    if (!result.product) return res.status(404).json(notFound);
    res.json({ source: 'openfoodfacts', barcode, product: result.product });
  });
}
