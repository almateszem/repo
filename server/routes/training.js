/**
 * Podium — edzés és regeneráció
 * ------------------------------------------------------------------------
 * Gyakorlat-katalógus, áttekintő, készenlét és check-in, tervek, edzésnapló
 * és piszkozat, PR-ek és rekordok, diagramok, testsúly és testösszetétel,
 * erőfelmérés, edzés utáni visszajelzés.
 */
import { parsePageParams } from '../catalog-search.js';
import { volumeCharts } from '../charts.js';
import { bodyweightFactors, effectiveLoad } from '../data/bodyweight-load.js';
import { isPerHand, strengthStandards } from '../data/strength-standards.js';
import {
  addPlan,
  addWeightEntry,
  addWorkout,
  calculateEpley1RM,
  clearWorkoutDraft,
  deleteMeasurement,
  deletePlan,
  deleteWeightEntry,
  deleteWorkout,
  getActivePlan,
  getAllExerciseMaxes,
  getCheckin,
  getCollection,
  getDeclaredMaxes,
  getExerciseMax,
  getMeasurements,
  getNutritionTotals,
  getUserBirthYear,
  getUserPlans,
  getUserSex,
  getWaterDay,
  getWeightLog,
  getWorkoutDraft,
  getWorkouts,
  getWorkoutsForRecords,
  replaceWaterDay,
  saveCheckin,
  saveMeasurements,
  saveWorkoutDraft,
  saveWorkoutFeedback,
  setActivePlan,
  setDeclaredMax,
  transaction,
  updatePlan,
  updateWeightEntry,
  updateWorkout,
  weightForDate,
} from '../db.js';
import { INTENSITY_LEVELS } from '../logmode.js';
import { MUSCLE_KEYS, normalizeName, splitLegacyMuscleMap } from '../muscles.js';
import { formatDecimal } from '../numbers.js';
import { allWeekExercises, cycleDay, dayEntry, dayLabel } from '../plan-week.js';
import { exerciseRecords, firstLoggedMaxes, prEntry } from '../records.js';
import { planSafetyChecker } from '../session-advice.js';
import { suggestExercises } from '../suggestions.js';
import { requestDate } from '../http/session.js';
import {
  adviceFor,
  applySessionAdvice,
  readinessReport,
  trainingStreak,
  workoutTemplate,
} from '../services/session-plan.js';
import {
  exerciseLimitError,
  normalizeExercises,
  parsePlanBody,
  parseWorkoutBody,
} from '../validation/workout-body.js';

/** A törzsben érkező, NEM KÖTELEZŐ sor-azonosító (terv- vagy edzés-id) —
    hiányzó/érvénytelen értékre null. A piszkozatnál mindkettő így viselkedik:
    terv nélkül szabad edzés, edzés-azonosító nélkül új edzés. */
const parseRowId = (raw) => (Number.isInteger(raw) && raw > 0 ? raw : null);

/** Egy opcionális szám-mező beolvasása tartomány-ellenőrzéssel.
    Üres/hiányzó érték → null (a motor ezt „nem adta meg"-ként kezeli, nem
    nullaként). Érvénytelen vagy tartományon kívüli érték → hiba. */
export function readOptionalNumber(raw, { min, max, integer = false }) {
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

/** Izomcsoportonkénti térkép (izomláz és fájdalom is 0–10) normalizálása:
    csak ismert izomkulcs és érvényes szám marad benne. A fájdalomnál a
    'general' kulcs is engedett (általános, nem csoporthoz kötött fájdalom). */
function normalizeMuscleMap(raw, max, allowGeneral = false) {
  const valid = {};
  if (!raw || typeof raw !== 'object') return valid;
  // Egy még frissítetlen (9 csoportos) böngészőlap "arms"-t küldhet — ezt
  // biceps/triceps közt osztjuk, különben az ismeretlen kulcs némán kiesne, és
  // egy fájdalom-bejegyzés veszne el. A "back"-et szándékosan NEM bontjuk itt
  // szét (LEGACY_SPLIT.back-kel): az új kliens "back"-je csak a széles hátat
  // jelenti, a régié pedig hát+trapéz+alsó hát keverékét — a kettő utólag nem
  // különböztethető meg, ezért "back" változatlanul marad.
  for (const [key, rawValue] of Object.entries(raw)) {
    const known =
      MUSCLE_KEYS.includes(key) || key === 'arms' || (allowGeneral && key === 'general');
    if (!known) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || value > max) continue;
    valid[key] = Math.round(value);
  }
  // A szétosztás a tartomány-ellenőrzés UTÁN jön: különben egy hibás arms=11
  // max-szal felülírná az érvényes biceps=8-at, majd a szűrés kidobná — és
  // vele egy valódi, tiltást okozó fájdalmat is.
  return splitLegacyMuscleMap(valid, ['arms']);
}

/** A kezenkénti súlyú gyakorlatok — EGY forrásból, hogy a napló felirata
    („Súly·kg/kéz") és a profil csempéje („/ kéz") sose mondjon mást. Az
    erőstandard `perHand` jelzője a mérvadó (azon múlik az érem), és mellé a
    katalógus kézisúlyzós sorai, ahol standard nincs. Lustán épül, egyszer. */
let perHandCache = null;
function perHandNames() {
  if (!perHandCache) {
    perHandCache = new Set(
      (getCollection('exerciseCatalog') || [])
        .filter((item) => item.equipment === 'Kézisúlyzó' || isPerHand(item.name))
        .map((item) => item.name),
    );
    for (const name of Object.keys(strengthStandards)) if (isPerHand(name)) perHandCache.add(name);
  }
  return perHandCache;
}

// A MAI naplózott ételek tételesen — a Táplálkozás oldal „Mai napló" listájához

/* ---- Testösszetétel: körfogat és testzsír ----
   A weight_log egyetlen számot tárol, de a puszta kilogramm nem mondja meg,
   MI épült és mi fogyott — egy versenyző a mellette futó körfogatot követi.

   A mérési helyek értékkészlete ZÁRT: elgépelt kulcsra a trend szétesne. A
   tartományok bőven megengedőek, csak a nyilvánvalóan hibás bevitelt fogják
   meg (egy 300 cm-es felkar elgépelés, nem mérés). */
const MEASUREMENT_SITES = {
  chest: { label: 'Mell', unit: 'cm', min: 40, max: 200 },
  arm: { label: 'Felkar', unit: 'cm', min: 15, max: 80 },
  waist: { label: 'Derék', unit: 'cm', min: 40, max: 200 },
  hip: { label: 'Csípő', unit: 'cm', min: 40, max: 200 },
  thigh: { label: 'Comb', unit: 'cm', min: 25, max: 120 },
  calf: { label: 'Vádli', unit: 'cm', min: 20, max: 80 },
  bodyfat: { label: 'Testzsír', unit: '%', min: 3, max: 60 },
};

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

/* ---- Erőfelmérés (fresh start) ----
   A friss fiók ma hetekig „vakon" használja az appot: a gyakorlat-ajánlások
   három naplózott alkalmat kérnek (exercise-advice.js → MIN_SESSIONS), a három fő
   emelés kivételével. Az erőfelmérésen a felhasználó BEMONDJA, mit tud —
   ebből a motor azonnal tud ajánlani.

   Amit NEM teszünk: a felmérést nem írjuk be edzésként a naplóba. Az
   hazudna egy meg nem történt edzést a sorozatba és a volumen-diagramba.
   A bemondott érték külön forrásként él (exercise_maxes.source = 'declared'),
   és a riport `basis` mezője kimondja, min alapul az ajánlás. */
const ASSESSMENT_MAX_ENTRIES = 12;
/* Az ismétlés felső határa 12: az Epley-becslés 10–12 ismétlés fölött már
   erősen túlbecsül (30 ismétlésnél a súly kétszerese lenne az 1RM), és a
   felmérés erre a számra épít ajánlást. */
const ASSESSMENT_RANGES = { weight: [1, 500], reps: [1, 12] };

/* ---- Edzés utáni visszajelzés ----
   STRUKTURÁLT mező, nem üzenet: a nehézség és a közérzet számként tárolódik,
   tehát később elemezhető. A szabad szöveg mellette fut. Mindhárom
   elhagyható — a „nem küldött" és a „rosszat jelzett" két külön dolog. */
const FEEDBACK_NOTE_MAX = 500;

/** Az útvonalak bekötése. Ugyanarra az app-ra, amit a server.js épít — NEM
    express.Router és NEM al-alkalmazás: a guardAsyncRoutes csak az app
    metódusait foltozza (errors.js), egy Router async kezelőjének hibájára
    nem jönne válasz, egy al-alkalmazás pedig elveszítené a trust proxy
    beállítást. */
export function register(app, { catalogSearch }) {
  app.get('/api/exercises', (req, res) => {
    const params = parsePageParams(req.query);
    if (params.error) return res.status(400).json({ error: params.error });
    res.json(catalogSearch.searchExercises(params));
  });

  app.get('/api/exercise-groups', (req, res) => res.json(catalogSearch.exerciseGroups()));

  // Áttekintő — minden mezője számolt érték. A készenlét és a regenerációs sorok
  // a Recovery Engine-ből, a napi kalória/fehérje a táplálkozási naplóból (hogy
  // a dashboard és a Táplálkozás oldal ugyanazt mutassa), az aktuális edzésnév
  // az edzésnapló induló tartalmából (vagy null).
  app.get('/api/dashboard', (req, res) => {
    const userId = req.user.id;
    // Saját másolat: a felhasználó-specifikus mezők nem a getCollection
    // (csak olvasható, akár megosztott) objektumára íródnak.
    const dashboard = { ...(getCollection('dashboard') || {}) };
    const totals = getNutritionTotals(userId, req.today);
    // A mentett edzéseket egyszer olvassuk be (req.workouts, http/session.js), és
    // mindkét fogyasztónak átadjuk: korábban a streak és a készenléti riport
    // külön-külön beolvasta és JSON-ből visszafejtette a TELJES workouts táblát.
    const workouts = req.workouts();
    const readiness = readinessReport(userId, req.today, workouts);

    dashboard.streak = trainingStreak(workouts, req.today);
    dashboard.readiness = readiness.overall;
    dashboard.recovery = readiness.recovery;
    // Az ítélet-mondathoz (verdictText): ugyanazok a jelzések, mint a Regeneráción.
    dashboard.cns = readiness.cns;
    dashboard.exercises = readiness.exercises;
    // A készenlét-kártya feliratához: mennyire megbízható a szám, és van-e
    // egyáltalán mai check-in (ha nincs, a felület kitöltésre hív).
    dashboard.readinessConfidence = readiness.confidence;
    dashboard.checkinPresent = readiness.checkin.present;
    dashboard.dailyStats = {
      calories: Math.round(totals.intake),
      caloriesTarget: totals.goal.calories,
      protein: Math.round(totals.protein),
      // A teljes makró-bontás is ide tartozik: az áttekintő a kalória-sáv alatt
      // ugyanazt a három számot mutatja, amit a Táplálkozás oldal — enélkül a
      // felületnek két külön kérésből kellene összeraknia egyetlen sort.
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
      proteinTarget: totals.goal.protein,
    };
    /* A mai edzés a jobb oldali hasábra: nem csak a neve, hanem a gyakorlatai
       is. A sorozat/ismétlés/súly az ELSŐ szettből jön — a terv sorai egyforma
       szettekből állnak, és a felület itt előnézetet ad, nem naplót. */
    const template = workoutTemplate(userId, req.today);
    dashboard.workoutName = template?.name?.trim() || null;
    /* Az aktív terv szerint ma pihenőnap van (és nincs megkezdett edzés): a
       felület ezt írja ki a „Kezdj új edzést" helyett. Külön jelző, nem edzésnév —
       a név az edzésnapló címének is az alapértéke lenne. */
    const activePlan = template ? null : getActivePlan(userId);
    dashboard.restDay = Boolean(
      activePlan && !dayEntry(activePlan.week, cycleDay(activePlan, req.today)),
    );
    dashboard.workoutPlan = template
      ? {
          name: template.name?.trim() || null,
          exercises: (template.exercises || []).map((exercise) => {
            const first = exercise.sets?.[0];
            const count = exercise.sets?.length ?? 0;
            const reps = Number(first?.reps) || 0;
            const weight = Number(first?.weight) || 0;
            return {
              name: exercise.name,
              detail: [
                count && reps ? `${count} × ${reps}` : null,
                weight ? `${formatDecimal(weight)} kg` : null,
              ]
                .filter(Boolean)
                .join(' · '),
            };
          }),
        }
      : null;
    res.json(dashboard);
  });

  /* ======================================================================
     Recovery Engine — készenléti riport és napi check-in
     ====================================================================== */

  // A teljes riport: összesített készenlét, komponens-bontás, izomcsoportok,
  // CNS, gyakorlat-ajánlások, megbízhatóság.
  app.get('/api/readiness', (req, res) => res.json(readinessReport(req.user.id, req.today)));

  /* Ajánlott gyakorlatok a gyakorlat-választó tetejére (server/suggestions.js).
     ?title= az edzés vagy terv neve; ?readiness=1 kéri a mai készenlétet is
     második jelnek. A terv-építő NEM kéri: egy jövőbeli tervről a mai
     regeneráltság semmit nem mond, ott csak a cím számít. */
  app.get('/api/exercise-suggestions', (req, res) => {
    const userId = req.user.id;
    const title = typeof req.query.title === 'string' ? req.query.title : '';
    const workouts = req.workouts();
    const report =
      req.query.readiness === '1' ? readinessReport(userId, req.today, workouts) : null;
    const result = suggestExercises({
      title,
      report,
      catalog: getCollection('exerciseCatalog') || [],
      workouts,
    });
    /* A javaslat a kártya mezőit is hozza: a választó már nem tartja a teljes
       katalógust, amiben név szerint kikereshetné őket. */
    const cards = new Map(
      catalogSearch
        .findExercisesByName(result.suggestions.map((suggestion) => suggestion.name))
        .map((card) => [card.name, card]),
    );
    res.json({
      ...result,
      suggestions: result.suggestions
        .filter((suggestion) => cards.has(suggestion.name))
        .map((suggestion) => ({ ...cards.get(suggestion.name), ...suggestion })),
    });
  });

  app.get('/api/readiness/advice', (req, res) =>
    res.json(adviceFor(req.user.id, req.today, undefined, req.workouts)),
  );

  /** Elfogadás. A válasz a friss napló, hogy a felület egy körből frissüljön. */
  app.post('/api/readiness/advice/apply', (req, res) => {
    const { stale, ...result } = applySessionAdvice(
      req.user.id,
      req.today,
      req.body?.token,
      req.workouts,
    );
    const template = workoutTemplate(req.user.id, req.today);
    if (stale) {
      return res.status(409).json({
        error: 'A mai napló időközben változott — a javaslatot nem alkalmaztuk.',
        template,
      });
    }
    res.json({ ...result, template });
  });

  // A mai check-in (vagy null, ha még nem töltötted ki)
  app.get('/api/checkin', (req, res) => res.json(getCheckin(req.user.id, req.today)));

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
    fields.soreness = normalizeMuscleMap(body.soreness, 10);
    fields.pain = normalizeMuscleMap(body.pain, 10, true);

    // Opcionális testsúly — a weight_log táblába, ugyanazzal a validálással,
    // mint a testsúly-javításnál (PUT /api/weight-log/:id). Üres/hiányzó mező = ma nincs mérés,
    // ilyenkor a korábbi bejegyzések érintetlenül maradnak.
    let weightKg = null;
    if (body.weightKg !== null && body.weightKg !== undefined && body.weightKg !== '') {
      const kg = Number(body.weightKg);
      // Ugyanaz a tartomány, mint a testsúly-javításnál (WEIGHT_RANGE)
      if (!Number.isFinite(kg) || kg < WEIGHT_RANGE.min || kg > WEIGHT_RANGE.max) {
        return res.status(400).json({
          error: `Érvénytelen testsúly — ${WEIGHT_RANGE.min} és ${WEIGHT_RANGE.max} kg között adható meg.`,
        });
      }
      weightKg = kg;
    }

    // A testsúly, a víz és a check-in sor egy mentés: egy közbeni hiba nem
    // hagy félig mentett napot (db.js → transaction)
    const { checkin, weightEntry } = transaction(() => {
      const weightEntry = weightKg === null ? null : addWeightEntry(userId, weightKg, req.today);

      /* A folyadék KÉT helyen írható: itt literben (a nap összege), a Táplálkozás
         oldalon kortyonként. Egy forrás van, a víznapló (a check-in onnan olvassa),
         ezért az űrlapon megadott érték lecseréli a nap víznaplóját — a felhasználó
         ott az összegről nyilatkozik, nem egy kortyról. A mezőt üresen hagyva a
         napló érintetlen marad, hogy a gyors check-in ne törölje a napközben
         rögzített kortyokat. Ha a beküldött érték ml-re kerekítve megegyezik a
         nap összegével (változatlanul visszaküldött mező), a napló marad: a
         kortyok bontása nem vész el, és egy másik eszköz kortyait sem írja felül. */
      if (fields.hydration !== null) {
        const ml = Math.round(fields.hydration * 1000);
        if (ml !== getWaterDay(userId, req.today).totalMl) replaceWaterDay(userId, req.today, ml);
      }

      return { checkin: saveCheckin(userId, req.today, fields), weightEntry };
    });
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
    const workoutsToday = req.workouts().filter((w) => w.date === todayDate);
    // Azonosító szerint párosítunk, névre csak a plan_id oszlop előtt mentett
    // (régi) edzéseknél esünk vissza — két azonos nevű terv így nem osztozik
    // egymás haladásán.
    const savedPlanIds = new Set(workoutsToday.map((w) => w.planId).filter((id) => id != null));
    const savedLegacyNames = new Set(
      workoutsToday.filter((w) => w.planId == null).map((w) => w.name),
    );
    const draftMatches = (plan) =>
      draft &&
      draft.date === todayDate &&
      (draft.planId != null ? draft.planId === plan.id : draft.name === plan.name);

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
    const safetyOf = plans.length
      ? planSafetyChecker(
          readinessReport(userId, todayDate, req.workouts()),
          getCollection('exerciseCatalog') || [],
        )
      : () => null;

    res.json(
      plans.map((plan) => {
        const daysLabel = plan.days.length
          ? ` · ${plan.days.map((d) => dayLabel(d)).join(', ')}`
          : '';
        return {
          id: plan.id,
          name: plan.name,
          meta: `${plan.assignmentId ? 'Edzői terv' : 'Saját terv'} · ${plan.days.length} edzésnap${daysLabel}`,
          progress: progressFor(plan),
          active: plan.active,
          /* Mi kockázatos MA ebben a tervben, és miért — a hét összes edzésnapjára
           együtt. A terv NEM íródik át — csak megjelöljük; az átírás elrejtené
           az edző elől, mi történt. */
          safety: safetyOf(allWeekExercises(plan.week)),
          week: plan.week,
          days: plan.days,
          // A ciklus horgonyához (plan-week.js → cycleAnchor) a kliensnek is kell
          date: plan.date,
          activeSince: plan.activeSince,
        };
      }),
    );
  });

  /** Terv törlése. Csak a sajátodat — az elfogadott edzői terv is a te sorod
      (az elfogadás másolatot hoz létre), tehát az is kiszedhető. A terv-lista
      eddig KIZÁRÓLAG nőni tudott. */
  app.delete('/api/plans/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Érvénytelen terv-azonosító.' });
    }
    if (!deletePlan(req.user.id, id, req.today)) {
      return res
        .status(404)
        .json({ error: 'Nincs ilyen terved — lehet, hogy időközben törölték.' });
    }
    res.status(204).end();
  });

  /** A terv aktívvá tétele vagy kikapcsolása. Törzs: { active: bool }. Egyszerre
      egy aktív terv van — csak annak a hete töltődik az Edzés oldalra. */
  app.post('/api/plans/:id/active', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Érvénytelen terv-azonosító.' });
    }
    const plan = setActivePlan(req.user.id, id, req.body?.active !== false, req.today);
    if (!plan) return res.status(404).json({ error: 'Nincs ilyen terved.' });
    res.json(plan);
  });

  app.get('/api/workout-template', (req, res) => res.json(workoutTemplate(req.user.id, req.today)));

  // Korábbi rekordok — gyakorlatonként egy sor, a jelenlegi (legutóbbi
  // PR-jelölt) rekorddal. A getWorkouts() legújabb elöl ad vissza edzéseket,
  // ezért az adott gyakorlatnál elsőként talált PR-jelölt előfordulás
  // pontosan a jelenlegi rekord.
  app.get('/api/prs', (req, res) => {
    const latestByExercise = new Map();
    const weightLog = getWeightLog(req.user.id);
    for (const workout of getWorkouts(req.user.id)) {
      for (const exercise of workout.exercises) {
        if (!exercise.pr || latestByExercise.has(exercise.name)) continue;
        latestByExercise.set(
          exercise.name,
          prEntry(workout, exercise, {
            weightLog,
            maxRecord: getExerciseMax(req.user.id, exercise.name),
          }),
        );
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
    const weightLog = getWeightLog(req.user.id);
    for (const workout of getWorkouts(req.user.id)) {
      for (const exercise of workout.exercises) {
        if (exercise.name !== exerciseName || !exercise.pr) continue;
        history.push(
          prEntry(workout, exercise, {
            weightLog,
            maxRecord: getExerciseMax(req.user.id, exercise.name),
          }),
        );
      }
    }
    res.json(history);
  });

  /** Az összes nyomon követett exercise maximum (1RM értékek).
      A frontend ezt használja valós idejű PR detektáláshoz szerkesztéskor. */
  app.get('/api/exercise-maxes', (req, res) => {
    const maxes = getAllExerciseMaxes(req.user.id);
    /* Könnyebb kereshetőséghez exercise_name → max1rm térkép formátum. A NYERS
       csúcs megy le, nem kerekítve: a napló valós idejű PR-jelzője ehhez mér, és
       egy kerekített csúcs mellett a rekord-szett pontos megismétlése is
       „rekordnak" látszott (80×8: tárolt 101,333…, kerekítve 101,3). */
    const maxMap = {};
    for (const record of maxes) {
      maxMap[record.exercise_name] = record.max_1rm;
    }
    res.json(maxMap);
  });

  /** A napló súly-oszlopának konvenciói: melyik gyakorlatnál kezenkénti a súly,
      melyiknél RÁADÁS a testsúlyon (tényezővel), és a mai testsúly. Az utóbbi
      kettőből számol az élő PR-jelző ugyanúgy, ahogy a szerver mentéskor —
      különben a saját testsúlyos gyakorlat jelzője sosem gyulladna ki. A
      testsúlyos lista a kurált táblából jön (data/bodyweight-load.js), nem a
      katalógus `felszerelés` mezőjéből — az utóbbi erre nem megbízható. */
  app.get('/api/weight-conventions', (req, res) =>
    res.json({
      perHand: [...perHandNames()],
      bodyweightFactors,
      bodyweightKg: weightForDate(req.user.id, requestDate(req)),
    }),
  );

  /** Ugyanaz az adat, de SORONKÉNT, a dátummal és a forrással együtt.
      A profil rekord-csempéi ezt kérik: ott a felhasználó tetszőleges
      gyakorlatot tűzhet ki, és a csempének a számon túl azt is ki kell írnia,
      MIKOR és MIRE épül — a naplózott csúcs és a bemondott becslés nem ugyanaz
      az állítás. A /api/exercise-maxes lapos térképe erre nem elég, viszont azon
      az edzésnapló valós idejű PR-jelzése ül, ezért NEM írjuk át a alakját. */
  app.get('/api/exercise-records', (req, res) => {
    const weightLog = getWeightLog(req.user.id);
    /* Az életkor évre pontos: a születési évet kérjük el, nem a dátumot. Az egy
       év bizonytalanság a küszöbön legfeljebb egy-két százalék — ennyiért nem
       éri meg pontosabb személyes adatot tárolni. */
    const birthYear = getUserBirthYear(req.user.id);
    const age = birthYear ? Number(requestDate(req).slice(0, 4)) - birthYear : null;

    res.json(
      exerciseRecords(getAllExerciseMaxes(req.user.id), {
        first: firstLoggedMaxes(getWorkoutsForRecords(req.user.id), weightLog),
        weightLog,
        bodyweight: weightForDate(req.user.id, requestDate(req), weightLog),
        sex: getUserSex(req.user.id),
        age,
        perHand: perHandNames(),
      }),
    );
  });

  // Chartok — a seed-görbék mellé a szerver számolja a heti volumen-
  // összehasonlítást a mentett edzésekből.
  app.get('/api/charts', (req, res) =>
    res.json({ ...getCollection('charts'), ...volumeCharts(req.workouts(), req.today) }),
  );

  // Testsúly-napló — a valódi weight_log táblából
  app.get('/api/weight-log', (req, res) => res.json(getWeightLog(req.user.id)));

  /** A mérési helyek listája a felületnek — a címkék és a mértékegységek is
      innen jönnek, hogy a két oldal ne sodródjon szét. */
  app.get('/api/measurements/sites', (req, res) =>
    res.json(Object.entries(MEASUREMENT_SITES).map(([key, site]) => ({ key, ...site }))),
  );

  app.get('/api/measurements', (req, res) => res.json(getMeasurements(req.user.id)));

  /** Az időalapú sorok intenzitás-fokozatai a felületnek. A címke is innen jön,
      ugyanazért, amiért a mérési helyeké: a mentett adat a KULCS, a felirat csak
      megjelenítés, és a kettő nem sodródhat szét. */
  app.get('/api/cardio-intensities', (req, res) =>
    res.json(Object.entries(INTENSITY_LEVELS).map(([key, level]) => ({ key, ...level }))),
  );

  /** Mérések mentése a MAI napra. Törzs: { values: { waist: 84, bodyfat: 12.5 } }.
      Csak az érintett helyeket írjuk — amit nem adtak meg, azt nem bántjuk.
      Az aznapi újramérés felülír, nem duplikál. */
  app.put('/api/measurements', (req, res) => {
    const raw = req.body?.values;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return res.status(400).json({ error: 'Adj meg legalább egy mérést.' });
    }

    const values = {};
    for (const [site, input] of Object.entries(raw)) {
      /* Object.hasOwn, nem sima indexelés: a `constructor`, a `toString` és a
         többi prototípus-kulcs a puszta `MEASUREMENT_SITES[site]`-ra IGAZ
         értéket ad (egy függvényt), így átcsúszna a szűrőn — és mivel a
         tartomány-ellenőrzés a spec.min/max-ból dolgozik, ami ilyenkor
         undefined, a `{"constructor": 999999}` bármilyen számot eltárolna egy
         sosem létező mérési helyre. */
      if (!Object.hasOwn(MEASUREMENT_SITES, site)) {
        return res.status(400).json({ error: `Ismeretlen mérési hely: ${site}` });
      }
      const spec = MEASUREMENT_SITES[site];
      // Az üres mező nem törlés — a felület azt hagyja ki, amit nem mértek.
      if (input === null || input === undefined || input === '') continue;
      const value = Number(input);
      if (!Number.isFinite(value) || value < spec.min || value > spec.max) {
        return res.status(400).json({
          error: `${spec.label}: ${spec.min} és ${spec.max} ${spec.unit} között adható meg.`,
        });
      }
      values[site] = Math.round(value * 10) / 10;
    }
    if (Object.keys(values).length === 0) {
      return res.status(400).json({ error: 'Adj meg legalább egy mérést.' });
    }

    res.json(saveMeasurements(req.user.id, req.today, values));
  });

  /** Egy mérés törlése — az elgépelt sor a trendet is elviszi. */
  app.delete('/api/measurements/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Érvénytelen azonosító.' });
    }
    if (!deleteMeasurement(req.user.id, id)) {
      return res.status(404).json({ error: 'Nincs ilyen mérésed.' });
    }
    res.status(204).end();
  });

  // Mentett edzések (legújabb elöl)
  app.get('/api/workouts', (req, res) => res.json(getWorkouts(req.user.id)));

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

  /** Edzésterv mentése (terv-építő). Törzs: { name, week }. A dátumot a szerver adja. */
  app.post('/api/plans', (req, res) => {
    const plan = parsePlanBody(req.body);
    if (plan.error) return res.status(400).json({ error: plan.error });
    res.status(201).json(addPlan(req.user.id, plan.name, req.today, plan.week));
  });

  /** Meglévő terv szerkesztése. Törzs: { name, week }. */
  app.put('/api/plans/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      return res.status(400).json({ error: 'Érvénytelen terv-azonosító.' });
    const plan = parsePlanBody(req.body);
    if (plan.error) return res.status(400).json({ error: plan.error });
    const updated = updatePlan(req.user.id, id, plan.name, plan.week);
    if (!updated)
      return res.status(404).json({ error: 'Nincs ilyen terv — lehet, hogy időközben törölték.' });
    res.json(updated);
  });

  /** Edzés mentése. Törzs: { name, exercises }. A dátumot a szerver adja. */
  app.post('/api/workouts', (req, res) => {
    const workout = parseWorkoutBody(req.body);
    if (workout.error) return res.status(400).json({ error: workout.error });
    res
      .status(201)
      .json(
        addWorkout(
          req.user.id,
          workout.name,
          req.today,
          workout.exercises,
          parseRowId(req.body?.planId),
        ),
      );
  });

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
    const bodyweightToday = weightForDate(req.user.id, req.today);

    const parsed = [];
    for (const entry of raw) {
      const name = known.get(normalizeName(String(entry?.exercise ?? '')));
      if (!name) {
        return res
          .status(400)
          .json({ error: `Ismeretlen gyakorlat: ${String(entry?.exercise ?? '')}` });
      }
      for (const [key, [min, max]] of Object.entries(ASSESSMENT_RANGES)) {
        const value = Number(entry?.[key]);
        if (!Number.isFinite(value) || value < min || value > max) {
          return res
            .status(400)
            .json({ error: `${name}: a(z) ${key} ${min} és ${max} között adható meg.` });
        }
      }
      /* Ugyanaz az Epley-képlet ÉS ugyanaz a terhelés, amivel a naplózott
         szettek számolnak: saját testsúlyos gyakorlatnál a beírt szám a ráadás,
         a terhelés zöme a test (bodyweight-load.js). Testsúly-bejegyzés nélkül
         nincs mihez adni — ott a beírt szám marad, mint eddig. */
      const load = effectiveLoad(name, entry.weight, bodyweightToday);
      parsed.push({ name, max1rm: calculateEpley1RM(load > 0 ? load : entry.weight, entry.reps) });
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

  /** Edzés utáni visszajelzés küldése a SAJÁT edzésre. Az adatréteg a user_id-re
      is szűr, tehát idegen edzés id-jére nem talál sort → 404. */
  app.put('/api/workouts/:id/feedback', (req, res) => {
    const workoutId = Number(req.params.id);
    if (!Number.isInteger(workoutId) || workoutId <= 0) {
      return res.status(400).json({ error: 'Érvénytelen azonosító.' });
    }

    const fields = {};
    for (const [key, label] of [
      ['difficulty', 'nehézség'],
      ['mood', 'közérzet'],
    ]) {
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
      return res
        .status(400)
        .json({ error: `A megjegyzés legfeljebb ${FEEDBACK_NOTE_MAX} karakter.` });
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
    if (!updated)
      return res.status(404).json({ error: 'Nincs ilyen edzés — lehet, hogy időközben törölték.' });
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
    const name = String(req.body?.name ?? '')
      .trim()
      .slice(0, 60);
    const raw = req.body?.exercises;
    const tooBig = exerciseLimitError(raw);
    if (tooBig) return res.status(400).json({ error: tooBig });
    const exercises = Array.isArray(raw) && raw.length === 0 ? [] : normalizeExercises(raw);
    if (!exercises) {
      return res.status(400).json({ error: 'Érvénytelen piszkozat-szerkezet.' });
    }
    res.json(
      saveWorkoutDraft(
        req.user.id,
        name,
        exercises,
        req.today,
        parseRowId(req.body?.planId),
        parseRowId(req.body?.workoutId),
      ),
    );
  });

  /** A piszkozat törlése — az edzés lezárása után hívja a kliens. Így ugyanaznap
      új edzés kezdhető, és a napra ütemezett terv is újra betöltődhet. */
  app.delete('/api/workout-draft', (req, res) => {
    clearWorkoutDraft(req.user.id);
    res.status(204).end();
  });
}
