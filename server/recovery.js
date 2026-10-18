/**
 * Podium — Recovery Engine
 * ==============================
 * A napi készenléti állapot (Readiness Score) és a belőle következő edzés-
 * ajánlások motorja. Ez a modul SZÁNDÉKOSAN nem ismeri az adatbázist: minden
 * bemenetet paraméterként kap, és tiszta (mellékhatás nélküli) függvényekből
 * áll. Így a teljes matematika unit-tesztelhető kitalált adatokkal
 * (server/recovery.test.js), a szerver pedig csak adatot ad neki.
 *
 * A KÉPLET
 * --------
 *   Readiness = 100 × Σ(wᵢ × sᵢ) / Σ(wᵢ)     — csak a JELEN LÉVŐ komponensekre
 *
 * A bázissúlyok (BASE_WEIGHTS) az eredeti, hét komponensre tervezett alakban
 * maradnak, de a HRV/pulzus komponens nincs implementálva: az alkalmazásban
 * nincs okosóra-integráció, és kitalált értéket nem teszünk a képletbe. A
 * súlya futásidőben, arányosan oszlik szét a többi komponens között — ezt a
 * nevezőben lévő Σ(wᵢ) intézi el magától.
 *
 * Ugyanez a mechanizmus kezeli a részlegesen kitöltött check-int is: ha nem
 * adtál meg stresszt, a 0.10 magától szétoszlik. A pontszám így SOSEM torzul
 * hiányzó adattól — csak a megbízhatósága csökken, amit külön jelzünk
 * (confidence + a hiányzó mezők listája).
 *
 * A FÁRADTSÁG-MODELL
 * ------------------
 * Az edzésterhelés hatása nem lineárisan „kopik le", hanem exponenciálisan
 * csillapodik (Banister-féle impulzus-válasz):  hatás = terhelés × e^(−Δt/τ).
 * A τ időállandó dönti el, milyen gyorsan felejt a rendszer:
 *   - izomcsoportonként külön (muscles.js TAU_BY_GROUP): 1.5–3.0 nap,
 *   - az általános terhelésre 3 nap,
 *   - az idegrendszerre 3.5 nap (a CNS lassabban áll helyre, mint az izom).
 *
 * REFERENCIÁK ÉS „NINCS ELÉG ADAT"
 * --------------------------------
 * Minden terhelés a SAJÁT előzményhez mérve értelmes. Ahol van elég előzmény,
 * a motor a felhasználó saját átlagához normalizál; ahol nincs, egy testsúlyra
 * skálázott abszolút referenciára esik vissza, és a riport ezt `confidence`-szel
 * jelzi. Kitalált számot sehol nem ad vissza: ami nem számolható, az `null`.
 */

import { MUSCLE_GROUPS, MUSCLE_KEYS, PAIN_BLOCK, TAU_BY_GROUP } from './muscles.js';
import { dayKey, daysAgo } from './dates.js';
import { clamp, clamp01, formatDecimal, mean, num } from './numbers.js';
import {
  CHRONIC_WINDOW_DAYS,
  MUSCLE_WINDOW_DAYS,
  REF_BODY_WEIGHT,
  buildNoveltyIndex,
  dailyAverage,
  decayedSum,
  summarizeWorkouts,
} from './training-load.js';
import { exerciseReadiness } from './exercise-advice.js';

/* Átmeneti újraexportok: a motor részei saját modulba kerültek (dates.js,
   numbers.js, one-rm.js, training-load.js, exercise-advice.js). A szerver már
   közvetlenül onnan importál; a régi útvonal a tesztek kedvéért él még. */
export { DAY_MS, parseDate, dayKey, shiftDayKey, daysBetween } from './dates.js';
export { formatDecimal } from './numbers.js';
export { estimate1RM, epley1RM } from './one-rm.js';
export { failureWeight, buildNoveltyIndex } from './training-load.js';
export { reduceWeight } from './exercise-advice.js';

/* ======================================================================
   Hangolható paraméterek — egy helyen, hogy a modell átlátható és a
   tesztekből ellenőrizhető maradjon. (A terhelés-számításéi a
   training-load.js-ben, az ajánlásé az exercise-advice.js-ben élnek.)
   ====================================================================== */

/** A képlet bázissúlyai. A `hrv` szándékosan hiányzik (nincs adatforrás),
    a súlya arányosan újraoszlik.

    A `mood` 2026-09-13 óta VALÓDI komponens. Korábban csak a mood===1 sapkán
    át hatott, tehát 2 és 5 között pontosan semmit nem számított, 1-ről 2-re
    viszont akár 40-ről 89-re ugrott a pontszám. A Hooper-index ugyanezt a
    szubjektív négyest kéri (fáradtság, stressz, izomláz, alvásminőség), és a
    szakirodalom szerint érzékenyebb jel, mint a HRV — okosóra nélkül tehát a
    kérdőív súlyát növelni ésszerű, nem csökkenteni. */
export const BASE_WEIGHTS = {
  sleep: 0.25,
  muscle: 0.15,
  energy: 0.15,
  stress: 0.1,
  mood: 0.1,
  load: 0.15,
  nutrition: 0.05,
};

const COMPONENT_LABELS = {
  sleep: 'Alvás',
  muscle: 'Izom-regeneráció',
  energy: 'Energiaszint',
  stress: 'Stressz-regeneráció',
  mood: 'Közérzet',
  load: 'Edzésterhelés',
  nutrition: 'Táplálkozás',
};

/* Szubjektív padló: ha a sportoló egyszerre kimerült ÉS stresszes, a pihent
   izom és a nulla terhelés (együtt a nevező harmada) nem húzhatja „edzhetsz"
   tartományba a napot. Ugyanaz a 40, mint a nagyon rossz közérzetnél. */
const SUBJECTIVE_FLOOR = { maxEnergy: 2, minStress: 4, cap: 40 };

const TAU_LOAD = 3.0; // nap — az általános edzésterhelés csillapítása
const TAU_CNS = 3.5; // nap — az idegrendszer lassabban áll helyre

const LOAD_WINDOW_DAYS = 14; // ennyi nap terhelését összegezzük

/** A megbízhatóság küszöbei: „magas"-hoz ennyi check-in kell a 28 napos
    ablakban (és PERSONAL_REF_MIN_TRAINING_DAYS edzésnap), „közepes"-hez
    legalább ennyi valódi edzésnap (a korábbi „5 nap előzmény" párja). */
const CONFIDENT_CHECKINS = 7;
const MEDIUM_CONFIDENCE_TRAINING_DAYS = 2;

/** Ennyi valódi edzésnap (terhelést hordozó nap a 28 napos ablakban) után a
    személyes referencia teljes súllyal számít; addig folytonosan keveredik az
    általánossal. Kb. heti 3 edzés két hétig — a korábbi 14 napos küszöbnek
    felel meg, de az előzmény MENNYISÉGÉT méri, nem a legrégebbi edzés korát. */
const PERSONAL_REF_MIN_TRAINING_DAYS = 6;

const FATIGUE_REF_MULT = 10; // személyes referencia: napi átlagterhelés × ennyi
const MUSCLE_REF_MULT = 2.5; // a gyors és a lassú tároló együtt; kalibrálva: recovery-calibration.test.js

/** A gyors (metabolikus) tároló időállandója napban. A motor napra kerekít,
    így ez gyakorlatilag csak az edzés napját érinti. */
const FAST_TAU = 0.4;

/** Az alvás célideje órában. EGY szám két helyen: az időtartam-görbe itt éri el
    a teljes pontot, és az alvásadósság is ehhez mér. Korábban az adósság 8
    órához mért, tehát egy „tökéletes" 7,5 órás éjszaka is adósságot termelt. */
const SLEEP_TARGET_HOURS = 7.5;

/* Napi folyadék-cél literben, ~33 ml/testsúlykg. Exportált, mert a Táplálkozás
   oldali vízmérőnek UGYANEZT a célt kell mutatnia, amit a motor számol —
   két külön cél két külön „teljesítettem" érzést adna. */
export const hydrationTarget = (bodyWeight) => 0.033 * (bodyWeight ?? REF_BODY_WEIGHT);

/** Abszolút referencia-terhelés (tonna) 80 kg-os sportolóra, előzmény híján. */
const ABS_FATIGUE_REF = 25;
const ABS_CNS_REF = 18;

/** Csoportonkénti abszolút referencia SZETT-EGYSÉGBEN (nem tonnában — lásd a
    setStimulus magyarázatát): mennyi egy tipikus, kemény edzés az adott
    izomcsoportra. A nagy izmok szessziónként több közvetlen szettet kapnak. */
const ABS_GROUP_REF = {
  chest: 5.0,
  back: 5.0,
  traps: 5.0,
  lowerBack: 5.0,
  quads: 5.0,
  shoulders: 4.2,
  hamstrings: 4.2,
  glutes: 4.2,
  biceps: 3.5,
  triceps: 3.5,
  calves: 3.5,
  core: 3.5,
};

/* ======================================================================
   Komponens-pontszámok (mind 0–1, vagy null ha nem számolható)
   ====================================================================== */

/**
 * Alvás: 60% időtartam + 40% minőség, majd alvásadósság-levonás.
 * Az időtartam-görbe trapéz: 4 óra alatt 0, 7.5 óránál 1.0, 9 óráig plató,
 * 10.5 óra felett 0.85 (a túl sok alvás jellemzően rossz alvásminőség jele,
 * de nem büntetjük komolyan).
 */
export function sleepDurationScore(hours) {
  if (hours === null) return null;
  if (hours <= 4) return 0;
  if (hours < SLEEP_TARGET_HOURS) return (hours - 4) / (SLEEP_TARGET_HOURS - 4);
  if (hours <= 9) return 1;
  if (hours >= 10.5) return 0.85;
  return 1 - ((hours - 9) / 1.5) * 0.15;
}

export function sleepScore(checkin, recentCheckins) {
  const hours = num(checkin?.sleepHours);
  const quality = num(checkin?.sleepQuality);
  if (hours === null && quality === null) return null;

  const parts = [];
  const duration = sleepDurationScore(hours);
  if (duration !== null) parts.push([0.6, duration]);
  if (quality !== null) parts.push([0.4, clamp01((quality - 1) / 4)]);

  const weightSum = parts.reduce((sum, [w]) => sum + w, 0);
  let score = parts.reduce((sum, [w, value]) => sum + w * value, 0) / weightSum;

  // Alvásadósság: az elmúlt 3 nap célidőhöz mért hiánya, legfeljebb −0.15.
  // Egy jó éjszaka nem törli el három rossz éjszaka hatását.
  const recentHours = recentCheckins
    .filter((entry) => entry.daysAgo >= 0 && entry.daysAgo <= 2)
    .map((entry) => num(entry.sleepHours))
    .filter((value) => value !== null);
  if (recentHours.length >= 2) {
    const debt = recentHours.reduce(
      (sum, value) => sum + Math.max(0, SLEEP_TARGET_HOURS - value),
      0,
    );
    score -= Math.min(0.15, (debt / recentHours.length) * 0.05);
  }

  return clamp01(score);
}

/** 1–5 skála → 0–1. A magasabb érték a jobb (energia, közérzet). */
const scaleUp = (value) => (value === null ? null : clamp01((value - 1) / 4));

/** 1–5 skála → 0–1 fordítva. A magasabb érték a rosszabb (stressz). */
const scaleDown = (value) => (value === null ? null : clamp01((5 - value) / 4));

/** Van-e egyáltalán naplózott étel az adott napi összesítőben. A „nem
    naplóztam" NEM azonos a „nem ettem"-mel — üres naplóból nem következtetünk
    alultápláltságra. */
const hasNutritionEntries = (totals) =>
  Boolean(totals) && (num(totals.intake) > 0 || num(totals.protein) > 0);

/**
 * Táplálkozás / hidratáció. Az alultápláltságot büntetjük, a többletet nem:
 * a regeneráció szempontjából az számít, hogy megvan-e a szükséges bevitel.
 * A `nutrition` lehet null (nincs naplózás) — ilyenkor csak a hidratáció
 * számít, és ha az sincs, a komponens egésze kimarad a képletből.
 * A `hydrationGoal` (liter) az edző által kitűzött víz-cél; null esetén a
 * testsúlyból számolt cél szól.
 */
export function nutritionScore(nutrition, hydrationLiters, bodyWeight, hydrationGoal = null) {
  const parts = [];
  /* Az ALAPÉRTELMEZETT cél (source: 'default') nem a felhasználóé: minden
     fióknak ugyanaz a beégetett szám (2900 kcal / 170 g). Ehhez mérve egy
     55 kg-os, 1800 kcal-t evő felhasználó „alultáplált" lenne. Ilyenkor nincs
     mihez mérni — a kalória és a fehérje kimarad, a folyadék marad. */
  const goal = nutrition?.goal?.source === 'default' ? null : nutrition?.goal;
  const calorieGoal = num(goal?.calories);
  const proteinGoal = num(goal?.protein);

  if (calorieGoal) parts.push([0.5, clamp01(num(nutrition.intake) / calorieGoal)]);
  if (proteinGoal) parts.push([0.3, clamp01(num(nutrition.protein) / proteinGoal)]);
  if (hydrationLiters !== null) {
    // Az edző által kitűzött víz-cél, ha van — különben a testsúlyos képlet
    const target = hydrationGoal ?? hydrationTarget(bodyWeight);
    parts.push([0.2, clamp01(hydrationLiters / target)]);
  }

  if (!parts.length) return null;
  const weightSum = parts.reduce((sum, [w]) => sum + w, 0);
  return parts.reduce((sum, [w, value]) => sum + w * value, 0) / weightSum;
}

/* ======================================================================
   Izomcsoport-readiness
   ====================================================================== */

/** Egy izomcsoport károsodása a két tároló összegeként, és hogy az ablakon
    belül érte-e szokatlan terhelés (az új gyakorlat az erősebb jel). */
function muscleDamage(byDay, group) {
  const fast = decayedSum(byDay, FAST_TAU, MUSCLE_WINDOW_DAYS, (bucket) => bucket.muscles[group]);
  const slow = decayedSum(
    byDay,
    TAU_BY_GROUP[group],
    MUSCLE_WINDOW_DAYS,
    (bucket) => bucket.slow[group],
  );
  let unusual = null;
  for (const [ago, bucket] of byDay) {
    if (ago > MUSCLE_WINDOW_DAYS) continue;
    const reason = bucket.unusual[group];
    if (reason === 'novelty' || (reason === 'gap' && !unusual)) unusual = reason;
  }
  return { damage: fast + slow, unusual };
}

/** A személyes referencia súlya (0…1): a valódi edzésnapok száma a 28 napos
    ablakban, PERSONAL_REF_MIN_TRAINING_DAYS-nál telítve. A pipa nélküli vagy
    terhelés nélküli edzés napja nem számít. Egy helyen számolva, mert a CNS-,
    a fáradtság- és az izom-referencia is ezzel keveredik. */
function personalRefWeight(byDay) {
  return clamp01(trainingDayCount(byDay) / PERSONAL_REF_MIN_TRAINING_DAYS);
}

/** A valódi edzésnapok száma a 28 napos ablakban (terhelést hordozó nap). A
    referencia-súly és a megbízhatóság is ebből számol, hogy a kettő ne
    mondjon ellent egymásnak. */
function trainingDayCount(byDay) {
  let trainingDays = 0;
  for (const [ago, bucket] of byDay) {
    if (ago < CHRONIC_WINDOW_DAYS && bucket.load > 0) trainingDays += 1;
  }
  return trainingDays;
}

/** Az általános és a személyes referencia keveréke a súly szerint. Korábban a
    kettő közt lépcsős kapcsoló volt: egy jelentéktelen edzés egy nappal
    korábbra tolása a CNS-t 66-ról 20-ra vitte. */
const blendRef = (general, personal, weight) => (1 - weight) * general + weight * personal;

function muscleReadiness({ byDay, checkin, refWeight, hasAnyWorkout }) {
  const soreness = checkin?.soreness ?? {};
  const pain = checkin?.pain ?? {};

  // Személyes referencia csoportonként: a nem-nulla napi terhelések átlaga
  // (vagyis egy tipikus „ezt az izmot megdolgoztató nap") az elmúlt 28 napból.
  const personalRef = {};
  for (const group of MUSCLE_KEYS) {
    const nonZero = [];
    for (const [ago, bucket] of byDay) {
      if (ago < CHRONIC_WINDOW_DAYS && bucket.muscles[group] > 0)
        nonZero.push(bucket.muscles[group]);
    }
    personalRef[group] = nonZero.length >= 2 ? mean(nonZero) : 0;
  }

  return MUSCLE_KEYS.map((group) => {
    const { damage, unusual } = muscleDamage(byDay, group);

    // A szett-egység nem skálázódik testsúllyal (öt szett az öt szett) —
    // ellentétben a tonna-alapú fáradtság- és CNS-referenciákkal.
    const absoluteRef = ABS_GROUP_REF[group];
    const base = blendRef(
      absoluteRef,
      personalRef[group] > 0 ? Math.max(personalRef[group], absoluteRef) : absoluteRef,
      refWeight,
    );
    const modelled = 100 * (1 - clamp01(damage / (base * MUSCLE_REF_MULT)));

    /* Szubjektív izomláz (0–10) bekeverése, ha a check-inben megadta.

       A keverés SÚLYA attól függ, tud-e egyáltalán mondani valamit a modell:
         · ha van naplózott terhelés ezen a csoporton (damage > 0), a modell
           dominál (0.6), mert az objektív terhelést ismeri;
         · ha NINCS (damage === 0), akkor a „100% friss" nem tudás, hanem az
           információ HIÁNYA. Ilyenkor 0.6-os súllyal elnyomná a felhasználó
           saját jelzését — pedig az az egyetlen jel, ami van. Ezért ott az
           érzet önmagában adja a pontszámot.

       Ez nem elméleti eset: terhelés-előzmény nélkül a régi keverés a
       maximális izomlázat is csak 60%-ig engedte le. */
    const reportedSoreness = num(soreness[group]);
    const subjective =
      reportedSoreness === null ? null : (1 - clamp01(reportedSoreness / 10)) * 100;
    const readiness =
      subjective === null ? modelled : damage > 0 ? 0.6 * modelled + 0.4 * subjective : subjective;

    // Fájdalom-sapka: 7/10 felett a csoport nem edzhető normál intenzitással,
    // bármit is mond a terhelés-modell.
    const reportedPain = num(pain[group]);
    const capped =
      reportedPain !== null && reportedPain >= PAIN_BLOCK ? Math.min(readiness, 30) : readiness;

    // Mikor terhelted utoljára ezt a csoportot? (a felület ezt is kiírja)
    let lastLoadedDaysAgo = null;
    for (const [ago, bucket] of byDay) {
      if (bucket.muscles[group] > 0 && (lastLoadedDaysAgo === null || ago < lastLoadedDaysAgo)) {
        lastLoadedDaysAgo = ago;
      }
    }

    /* Tudunk-e egyáltalán MONDANI valamit erről a csoportról?
       Igen, ha (a) a felhasználó jelzett rá izomlázat vagy fájdalmat, vagy
       (b) egyáltalán naplóz edzéseket — mert akkor a „nem terhelted" is
       érvényes következtetés. Ha egyik sem áll, a 100 nem eredmény, hanem
       az adat hiánya; a jelzőt a felület és az összesítés is figyeli. */
    const known = hasAnyWorkout || reportedSoreness !== null || reportedPain !== null;

    return {
      key: group,
      label: MUSCLE_GROUPS[group],
      readiness: Math.round(clamp(capped, 0, 100)),
      known,
      soreness: reportedSoreness,
      pain: reportedPain,
      source: reportedSoreness === null ? 'model' : damage > 0 ? 'blend' : 'reported',
      lastLoadedDaysAgo,
      unusual,
    };
  });
}

/* ======================================================================
   CNS readiness
   ====================================================================== */

function cnsReadiness({ byDay, sleep, bodyWeight, refWeight, hasAnyWorkout }) {
  const scale = (bodyWeight ?? REF_BODY_WEIGHT) / REF_BODY_WEIGHT;
  const load = decayedSum(byDay, TAU_CNS, LOAD_WINDOW_DAYS, (bucket) => bucket.cns);

  const absoluteRef = ABS_CNS_REF * scale;
  const chronic = dailyAverage(byDay, CHRONIC_WINDOW_DAYS, (bucket) => bucket.cns);
  const ref = blendRef(
    absoluteRef,
    Math.max(chronic * FATIGUE_REF_MULT, absoluteRef * 0.4),
    refWeight,
  );

  // A rossz alvás közvetlenül rontja az idegrendszeri állapotot — legfeljebb
  // 25%-ot vág le. Ha nincs alvásadat, nem szorzunk (nem találunk ki értéket).
  const sleepFactor = sleep === null ? 1 : 0.75 + 0.25 * sleep;
  /* Edzés-előzmény nélkül nincs mit mondani: a nulla CNS-terhelés ilyenkor
     üres napló, nem mérés. A readiness null — a felület „nincs adat"-ot ír,
     nem „friss idegrendszert". */
  if (!hasAnyWorkout) return { readiness: null, load, ref };

  const readiness = 100 * (1 - clamp01(load / ref)) * sleepFactor;
  return { readiness: Math.round(clamp(readiness, 0, 100)), load, ref };
}

/* ======================================================================
   Check-in normalizálás
   ====================================================================== */

/** Egy nyers check-in sor egységes alakra hozása (a hiányzó mezők null-ok). */
function normalizeCheckin(raw) {
  if (!raw) return null;
  return {
    date: raw.date,
    sleepHours: num(raw.sleepHours),
    sleepQuality: num(raw.sleepQuality),
    energy: num(raw.energy),
    stress: num(raw.stress),
    mood: num(raw.mood),
    hydration: num(raw.hydration),
    soreness: raw.soreness ?? {},
    pain: raw.pain ?? {},
  };
}

/** A gyors check-in kötelező mezői — ezek hiányát nevesítve jelezzük. */
const QUICK_FIELDS = [
  ['sleepHours', 'alvás időtartam'],
  ['sleepQuality', 'alvásminőség'],
  ['energy', 'energiaszint'],
  ['stress', 'stresszszint'],
];

/* ======================================================================
   A fő belépési pont
   ====================================================================== */

/**
 * A teljes készenléti riport kiszámítása.
 *
 * @param {object}   input
 * @param {Array}    input.checkins   napi check-in sorok (bármilyen sorrendben)
 * @param {Array}    input.workouts   mentett edzések ({ name, date, exercises })
 * @param {object}   input.nutrition  { today, yesterday } táplálkozási összesítők, és
 *                                    hydration: { today, yesterday } (liter | null)
 * @param {Array}    input.weightLog  testsúly-bejegyzések ({ kg, date })
 * @param {Array}    input.catalog    gyakorlat-katalógus (izom-súlyokkal)
 * @param {string}   input.today      a mai nap "ÉÉÉÉ.HH.NN" alakban
 * @param {Array}    input.declaredMaxes  az erőfelmérésen bemondott csúcsok
 *                                       ({ name, max1rm }) — ezekből is lesz ajánlás
 *
 * Ablakozott napló esetén (edzői kártya) a hívó a TELJES naplóból adhatja át
 * azt a hármat, ami az ablakon túlra nyúlik; ha elhagyja, a motor a kapott
 * `workouts` / `weightLog` listából számolja őket (a sportoló útja):
 * @param {number|null} [input.bodyWeight]       a legutolsó testsúly (kg); null: nincs mérés
 * @param {boolean}     [input.hasAnyWorkout]    naplózott-e valaha (nem jövőbeli) edzést
 * @param {string|null} [input.firstWorkoutDate] az első edzés napja ("ÉÉÉÉ.HH.NN")
 */
export function computeReadiness({
  checkins = [],
  workouts = [],
  nutrition = null,
  weightLog = [],
  catalog = [],
  today,
  declaredMaxes = [],
  bodyWeight: knownBodyWeight,
  hasAnyWorkout: knownAnyWorkout,
  firstWorkoutDate = null,
}) {
  const todayKey = dayKey(today);

  // — Check-inek: a maiak a szubjektív komponensekhez, a korábbiak az
  //   alvásadóssághoz és a megbízhatóság megítéléséhez kellenek.
  const normalized = checkins
    .map(normalizeCheckin)
    .filter((entry) => entry && Number.isFinite(dayKey(entry.date)))
    .map((entry) => ({ ...entry, daysAgo: daysAgo(entry.date, todayKey) }))
    .filter((entry) => entry.daysAgo >= 0)
    .sort((a, b) => a.daysAgo - b.daysAgo);

  const checkin = normalized.find((entry) => entry.daysAgo === 0) ?? null;
  const yesterdayCheckin = normalized.find((entry) => entry.daysAgo === 1) ?? null;

  /* — Táplálkozás: melyik nap a mérvadó, és melyik nap folyadéka tartozik hozzá.
     A bevitelnél a TEGNAPI az alap (a check-in reggel készül, amikor a mai
     étkezések még előtted vannak). A folyadéknak UGYANARRA a napra kell
     vonatkoznia: a mai érték délelőtt szükségszerűen hiányos, és egyetlen
     pohár víz nem jelent kimerültséget. Korábban a mai folyadék ment be a
     tegnapi bevitel mellé — ezért adott egy friss fióknak egyetlen rögzített
     korty rögtön alacsony pontszámot a „még nincs mire alapozni" helyett. */
  const useYesterdayNutrition = hasNutritionEntries(nutrition?.yesterday);
  const nutritionSource = useYesterdayNutrition
    ? nutrition.yesterday
    : hasNutritionEntries(nutrition?.today)
      ? nutrition.today
      : null;
  /* A folyadék a víznaplóból jön (nutrition.hydration: { today, yesterday },
     liter vagy null) — check-in nélküli napon is van. Ha a hívó nem adja
     meg, a check-in sor mezője a tartalék. */
  const hydrationOf = (which, entry) =>
    nutrition?.hydration ? (num(nutrition.hydration[which]) ?? null) : (entry?.hydration ?? null);
  const nutritionHydration =
    useYesterdayNutrition || nutritionSource === null
      ? hydrationOf('yesterday', yesterdayCheckin)
      : hydrationOf('today', checkin);

  // — Testsúly (a terhelés-referenciák skálázásához)
  const latestWeight = [...weightLog].sort((a, b) => dayKey(b.date) - dayKey(a.date))[0];
  const bodyWeight =
    (knownBodyWeight === undefined ? num(latestWeight?.kg) : num(knownBodyWeight)) ??
    REF_BODY_WEIGHT;

  // — Edzésadatok
  const novelty = buildNoveltyIndex(
    workouts,
    todayKey,
    catalog,
    firstWorkoutDate ? dayKey(firstWorkoutDate) : null,
  );
  const { byDay, exercises } = summarizeWorkouts(workouts, todayKey, catalog, bodyWeight, novelty);
  // A legrégebbi edzés kora már csak tájékoztató (meta); a referenciák súlyát
  // és a megbízhatóságot a valódi edzésnapok száma adja.
  const historyDays = byDay.size ? Math.max(...[...byDay.keys()]) + 1 : 0;
  const refWeight = personalRefWeight(byDay);

  // — Izomcsoportok
  /* Naplózott-e VALAHA edzést? Ez választja el a „nem terhelted" (érvényes
     következtetés) esetet a „nem tudunk róla semmit" esettől. */
  const hasAnyWorkout =
    knownAnyWorkout ??
    (Array.isArray(workouts) ? workouts : []).some((entry) => {
      const key = dayKey(entry?.date);
      // Érvényes dátum ÉS nem a jövő: a motor mindenhol így szűr (daysAgo >= 0),
      // és egy elgépelt/jövőbeli sor nem tehet „naplózó felhasználóvá" senkit.
      return Number.isFinite(key) && key <= todayKey;
    });
  const muscles = muscleReadiness({ byDay, checkin, refWeight, hasAnyWorkout });

  // — Komponensek
  const sleep = sleepScore(checkin, normalized);
  const cns = cnsReadiness({ byDay, sleep, bodyWeight, refWeight, hasAnyWorkout });

  /* Izom-komponens: a csoportok „soft-min" átlaga — a legrosszabb csoport
     nagyobb súlyt kap, hogy egy tönkrement lábnap ne tűnjön el a friss
     felsőtest átlagában.

     CSAK az ISMERT csoportokból számol. Ha egyikről sem tudunk semmit, a
     komponens null: kimarad a képletből, és a súlya szétoszlik — ahogy
     minden más hiányzó adaté. Korábban ilyenkor 100 ment a képletbe, tehát
     a tudatlanság tökéletes állapotnak látszott. */
  const knownMuscles = muscles.filter((m) => m.known);
  const muscleValues = knownMuscles.map((m) => m.readiness / 100);
  const muscleComponent =
    muscleValues.length === 0
      ? null
      : (() => {
          const muscleAvg = mean(muscleValues);
          return clamp01(muscleAvg - 0.5 * (muscleAvg - Math.min(...muscleValues)));
        })();

  // Edzésterhelés-regeneráció
  const fatigue = decayedSum(byDay, TAU_LOAD, LOAD_WINDOW_DAYS, (bucket) => bucket.load);
  const chronicDaily = dailyAverage(byDay, CHRONIC_WINDOW_DAYS, (bucket) => bucket.load);
  const absFatigueRef = ABS_FATIGUE_REF * (bodyWeight / REF_BODY_WEIGHT);
  const fatigueRef = blendRef(
    absFatigueRef,
    Math.max(chronicDaily * FATIGUE_REF_MULT, absFatigueRef * 0.4),
    refWeight,
  );
  /* Ugyanaz a szabály a terhelésre: ha SOSEM naplózott edzést, a „nulla
     fáradtság" nem mérés, hanem üres napló. Aki viszont naplóz, annál a
     „régen edzettél" már érvényes következtetés — ott a 100 helyes. */
  const loadComponent = hasAnyWorkout ? clamp01(1 - fatigue / fatigueRef) : null;

  const scores = {
    sleep,
    muscle: muscleComponent,
    energy: scaleUp(checkin ? checkin.energy : null),
    stress: scaleDown(checkin ? checkin.stress : null),
    mood: scaleUp(checkin ? checkin.mood : null),
    load: loadComponent,
    // A regeneráció szempontjából a TEGNAPI bevitel a mérvadó: a check-in
    // reggel készül, amikor a mai étkezések még előtted vannak. Ha tegnapról
    // nincs naplózás, a mai napra esünk vissza.
    nutrition: nutritionScore(
      nutritionSource,
      nutritionHydration,
      bodyWeight,
      // A víz-cél a MAI összesítőből: az a napló nélküli napon is hozza a célt
      nutrition?.today?.goal?.waterMl ? nutrition.today.goal.waterMl / 1000 : null,
    ),
  };

  // — A súlyozott átlag CSAK a jelen lévő komponensekre. A hiányzók súlya
  //   automatikusan újraoszlik, mert a nevezőben sem szerepelnek.
  let weightSum = 0;
  let weighted = 0;
  for (const [key, weight] of Object.entries(BASE_WEIGHTS)) {
    if (scores[key] === null) continue;
    weightSum += weight;
    weighted += weight * scores[key];
  }
  let overall = weightSum > 0 ? Math.round(100 * (weighted / weightSum)) : null;

  const components = Object.entries(BASE_WEIGHTS).map(([key, weight]) => ({
    key,
    label: COMPONENT_LABELS[key],
    score: scores[key] === null ? null : Math.round(scores[key] * 100),
    weight: weightSum > 0 && scores[key] !== null ? Math.round((weight / weightSum) * 100) : 0,
    present: scores[key] !== null,
  }));

  // — Sapkák: olyan állapotok, amiket egy súlyozott átlag elmosna, pedig
  //   felülírják az egész napot.
  const caps = [];
  if (overall !== null) {
    const generalPain = Math.max(
      num(checkin?.pain?.general) ?? 0,
      ...MUSCLE_KEYS.map((key) => num(checkin?.pain?.[key]) ?? 0),
    );
    if (generalPain >= PAIN_BLOCK && overall > 45) {
      overall = 45;
      caps.push('Erős fájdalmat jeleztél — a készenlét 45%-ra korlátozva.');
    }
    if (checkin?.mood === 1 && overall > 40) {
      overall = 40;
      caps.push('Nagyon rossz közérzet — a készenlét 40%-ra korlátozva.');
    }
    const { maxEnergy, minStress, cap } = SUBJECTIVE_FLOOR;
    const energy = checkin?.energy ?? null;
    const stress = checkin?.stress ?? null;
    // Mindkét jel KELL: a hiányzó mezőből nem következtetünk rossz állapotra.
    if (
      energy !== null &&
      stress !== null &&
      energy <= maxEnergy &&
      stress >= minStress &&
      overall > cap
    ) {
      overall = cap;
      caps.push(
        `Alacsony energia és magas stressz — a készenlét ${cap}%-ra korlátozva, bármennyire pihent az izom.`,
      );
    }
  }

  /* A leggyengébb JELEN LÉVŐ komponens: a végszám mellé ez mondja meg, mi húz
     vissza. Két gyökeresen más nap (pihent izom + szörnyű közérzet, ill.
     fáradt izom + remek közérzet) adhatja ugyanazt a számot. Egyenlőségnél a
     nagyobb súlyú nyer — az mozdítja jobban a pontszámot. */
  const limiting =
    components
      .filter((component) => component.present)
      .sort((a, b) => a.score - b.score || BASE_WEIGHTS[b.key] - BASE_WEIGHTS[a.key])
      .map(({ key, label, score }) => ({ key, label, score }))[0] ?? null;

  // — Megbízhatóság: mennyire van mire alapozni
  const checkinCount = normalized.filter((entry) => entry.daysAgo < CHRONIC_WINDOW_DAYS).length;
  /* A megbízhatóság ugyanabból a bizonyítékból számol, mint a referenciák
     súlya (valódi edzésnapok, D-011), nem a legrégebbi edzés korából — a
     kettő korábban eltérhetett. „Közepes"-nél okonként külön mondat, így nem
     jöhet ki „még 0 nap", ha valójában a check-in kevés. */
  const trainingDays = trainingDayCount(byDay);
  const missingTrainingDays = PERSONAL_REF_MIN_TRAINING_DAYS - trainingDays;
  const missingCheckins = CONFIDENT_CHECKINS - checkinCount;
  let confidence;
  let confidenceNote;
  if (checkin && missingTrainingDays <= 0 && missingCheckins <= 0) {
    confidence = 'high';
    confidenceNote = 'A saját előzményedhez mérve — megbízható becslés.';
  } else if (checkin && trainingDays >= MEDIUM_CONFIDENCE_TRAINING_DAYS) {
    confidence = 'medium';
    confidenceNote = [
      'Részben általános referenciával —',
      missingTrainingDays > 0 ? `még ${missingTrainingDays} edzésnap kell` : null,
      missingTrainingDays > 0 && missingCheckins > 0 ? 'és' : null,
      missingCheckins > 0 ? `még ${missingCheckins} napi check-in kell` : null,
      'a személyre szabott becsléshez.',
    ]
      .filter(Boolean)
      .join(' ');
  } else if (checkin) {
    confidence = 'low';
    confidenceNote = 'Kevés edzés-előzmény — a terhelés-becslés általános referenciával fut.';
  } else {
    confidence = 'low';
    confidenceNote =
      'Nincs mai check-in — a pontszám csak az edzésnaplóra és a táplálkozásra épül.';
  }

  const missing = checkin
    ? QUICK_FIELDS.filter(([key]) => checkin[key] === null).map(([, label]) => label)
    : QUICK_FIELDS.map(([, label]) => label);

  return {
    date: today,
    overall,
    confidence,
    confidenceNote,
    checkin: { present: Boolean(checkin), missing, values: checkin },
    components,
    muscles,
    cns: { readiness: cns.readiness },
    exercises: exerciseReadiness({
      exercises,
      muscles,
      cns: cns.readiness ?? 100,
      catalog,
      declared: declaredMaxes,
      overall,
      // A sapka az egész napot írja felül — a gyakorlatokét is.
      ceiling: caps.length > 0 ? overall : null,
    }),
    caps,
    limiting,
    // Az áttekintő „Regeneráció" kártyájának három sora — a mérésekből
    // képzett szöveg, nem demo-adat.
    recovery: {
      sleep:
        checkin?.sleepHours !== null && checkin?.sleepHours !== undefined
          ? `${formatDecimal(checkin.sleepHours)} óra`
          : '—',
      fatigue: describe(loadComponent, ['Nagyon magas', 'Magas', 'Közepes', 'Alacsony']),
      /* Az izom-komponens null, ha se edzés-előzmény, se jelzett izomláz nincs.
         Ha viszont van mai check-in, a felhasználó ott nyilatkozott: nem jelzett
         izomlázat — ez „Nincs", nem ismeretlen. */
      soreness:
        muscleComponent === null && checkin
          ? 'Nincs'
          : describe(muscleComponent, ['Erős', 'Közepes', 'Enyhe', 'Nincs']),
    },
    meta: { historyDays, checkinCount, bodyWeight },
  };
}

/** 0–1 pontszám → négyfokú szöveges skála (a rosszabbtól a jobb felé). */
function describe(score, labels) {
  if (score === null) return '—';
  if (score < 0.45) return labels[0];
  if (score < 0.65) return labels[1];
  if (score < 0.85) return labels[2];
  return labels[3];
}
