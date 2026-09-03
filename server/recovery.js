/**
 * FitTrack Pro — Recovery Engine
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

import {
  MUSCLE_GROUPS, MUSCLE_KEYS, TAU_BY_GROUP,
  resolveExerciseLoad, isAxialLift, emptyMuscleMap, normalizeName,
} from './muscles.js';

/* ======================================================================
   Dátum-segédek — a mentett adatok „ÉÉÉÉ.HH.NN" formátumához.
   (A server.js is innen importálja őket, hogy egyetlen implementáció legyen.)
   ====================================================================== */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** "ÉÉÉÉ.HH.NN" → helyi Date. */
export const parseDate = (str) => {
  const [year, month, day] = String(str).split('.').map(Number);
  return new Date(year, month - 1, day);
};

/** Egy "ÉÉÉÉ.HH.NN" dátum helyi éjfélre normalizált timestampje — így két nap
    akkor és csak akkor egyezik, ha ugyanaz a naptári nap. */
export const dayKey = (str) => {
  const d = parseDate(str);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Hány nappal ezelőtt volt `date` a `todayKey` naphoz képest (negatív = jövő). */
const daysAgo = (date, todayKey) => Math.round((todayKey - dayKey(date)) / DAY_MS);

/* ======================================================================
   Általános segédek
   ====================================================================== */

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Számmá alakítás úgy, hogy az üres/érvénytelen érték `null` legyen — nem 0.
    Ez fontos: a „nem adta meg" és a „nulla" két különböző dolog. */
const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/* ======================================================================
   Hangolható paraméterek — egy helyen, hogy a modell átlátható és a
   tesztekből ellenőrizhető maradjon.
   ====================================================================== */

/** A képlet bázissúlyai. A `hrv` szándékosan hiányzik (nincs adatforrás),
    a súlya arányosan újraoszlik. */
export const BASE_WEIGHTS = {
  sleep: 0.25,
  muscle: 0.15,
  energy: 0.15,
  stress: 0.10,
  load: 0.15,
  nutrition: 0.05,
};

const COMPONENT_LABELS = {
  sleep: 'Alvás',
  muscle: 'Izom-regeneráció',
  energy: 'Energiaszint',
  stress: 'Stressz-regeneráció',
  load: 'Edzésterhelés',
  nutrition: 'Táplálkozás',
};

const TAU_LOAD = 3.0;   // nap — az általános edzésterhelés csillapítása
const TAU_CNS = 3.5;    // nap — az idegrendszer lassabban áll helyre

const LOAD_WINDOW_DAYS = 14;    // ennyi nap terhelését összegezzük
const CHRONIC_WINDOW_DAYS = 28; // ennyiből képezzük a személyes referenciát
const MUSCLE_WINDOW_DAYS = 7;   // az izomkárosodás ennél régebbről már elhanyagolható

/** Ennyi nap előzmény kell ahhoz, hogy a személyes referenciát használjuk az
    abszolút (testsúlyra skálázott) helyett. */
const PERSONAL_REF_MIN_DAYS = 14;

const FATIGUE_REF_MULT = 10;  // személyes referencia: napi átlagterhelés × ennyi
const MUSCLE_REF_MULT = 1.5;  // ennyiszer tipikus szesszió visz egy csoportot nulláig

/** Referencia-testsúly, amihez az abszolút terhelés-referenciák skálázódnak. */
const REF_BODY_WEIGHT = 80;

/** Abszolút referencia-terhelés (tonna) 80 kg-os sportolóra, előzmény híján. */
const ABS_FATIGUE_REF = 25;
const ABS_CNS_REF = 18;

/** Csoportonkénti abszolút referencia SZETT-EGYSÉGBEN (nem tonnában — lásd a
    setStimulus magyarázatát): mennyi egy tipikus, kemény edzés az adott
    izomcsoportra. A nagy izmok szessziónként több közvetlen szettet kapnak. */
const ABS_GROUP_REF = {
  chest: 5.0, back: 5.0, quads: 5.0,
  shoulders: 4.2, hamstrings: 4.2, glutes: 4.2,
  arms: 3.5, calves: 3.5, core: 3.5,
};

/** A fő emelések: ezekre akkor is adunk becslést, ha csak egyszer szerepeltek.
    Ékezet nélküli, kisbetűs alakban tároljuk, mert így párosítunk. */
const MAIN_LIFTS = ['fekvenyomas', 'guggolas', 'felhuzas'];

/** Egy általános gyakorlathoz ennyi naplózott alkalom kell a becsléshez. */
const MIN_SESSIONS = 3;

/** Legfeljebb ennyi gyakorlatra adunk ajánlást (a leggyakoribbak nyernek). */
const MAX_EXERCISE_RECS = 6;

/* ======================================================================
   Terhelés-számítás a mentett edzésekből
   ====================================================================== */

/** Egy szett RPE-szorzója: ugyanaz a tonnatömeg RPE 9-en jóval többe kerül,
    mint RPE 6-on. RPE 8 a semleges pont. Hiányzó RPE-re 1.0 (nem büntetünk
    olyanért, amit nem írt be a felhasználó). */
const rpeFactor = (rpe) => (rpe === null ? 1 : clamp(1 + (rpe - 8) * 0.2, 0.8, 1.4));

/**
 * Egy szett IZOMKÁROSODÁS-szorzója a típusa alapján. A naplóban a szettnek
 * három típusa lehet (`warmup` / `work` / `drop`, lásd normalizeSetType a
 * server.js-ben), és ez az ingerre nézve nem mindegy:
 *
 *   - **bemelegítő** — definíció szerint előkészítés, nem munkasorozat. A
 *     felület MINDEN gyakorlat első sorát erre állítja alapból, tehát ha
 *     beleszámítana, minden gyakorlat kapna egy fantom munkasorozatot.
 *   - **munkasorozat** — a teljes inger, ez a mérce.
 *   - **drop set** — nem önálló sorozat, hanem az előző FOLYTATÁSA lecsökkentett
 *     súllyal, már fáradt izommal. Valódi többletkárosodást okoz, de nem
 *     annyit, mint egy friss munkasorozat.
 *
 * A típus nélküli (a szett-típusok bevezetése ELŐTT mentett) szettek teljes
 * munkasorozatnak számítanak — akkor még minden sor az volt.
 */
const SET_TYPE_STIMULUS = { warmup: 0, work: 1, drop: 0.5 };
const typeStimulusFactor = (type) => (type in SET_TYPE_STIMULUS ? SET_TYPE_STIMULUS[type] : 1);

/** Egy teljesített szett SZISZTÉMÁS terhelése tonnában (ismétlés × súly / 1000),
    RPE-vel súlyozva. A nem teljesített (be nem pipált) szettek nem számítanak.
    A tonnatömeg az össz-mechanikai munkát méri — ez jó proxy az általános
    fáradtságra és az idegrendszeri költségre. */
function setLoad(set) {
  if (!set?.done) return 0;
  const reps = num(set.reps);
  const weight = num(set.weight);
  if (reps === null || weight === null || reps <= 0 || weight <= 0) return 0;
  return ((reps * weight) / 1000) * rpeFactor(num(set.rpe));
}

/** Az izomkárosodás mérőszáma NEM a tonnatömeg, hanem a bukáshoz közeli
    szettek száma („szett-egység"). Ennek oka, hogy a tonnatömeg félrevezet
    lokális szinten: egy nehéz 5×5 guggolás kevesebb tonnát ad, mint egy
    könnyű, sok ismétléses lábtolás — miközben sokkal jobban lever. A
    hipertrófia-irodalom is szettben méri a heti volument, nem tonnában.
    Egy szett ~1 egység, RPE-vel skálázva (0.6 … 1.7), majd a szett TÍPUSÁVAL
    súlyozva (bemelegítő 0, munkasorozat 1, drop set 0.5).
    A súly itt szándékosan nem feltétel: a saját testsúlyos gyakorlatok
    (húzódzkodás, plank, fekvőtámasz) is valódi izomkárosodást okoznak. */
function setStimulus(set) {
  if (!set?.done) return 0;
  const reps = num(set.reps);
  if (reps === null || reps <= 0) return 0;
  const typeFactor = typeStimulusFactor(set.type);
  if (typeFactor === 0) return 0;
  const rpe = num(set.rpe);
  return (rpe === null ? 1 : clamp(1 + (rpe - 8) * 0.3, 0.6, 1.7)) * typeFactor;
}

/** RIR-korrigált Epley-becslés az egyismétléses maximumra. Az RPE-ből
    következtetünk a tartalékra (RIR = 10 − RPE); ha nincs RPE, RPE 8-at
    feltételezünk (2 ismétlés tartalék), ami a naplózás tipikus esete. */
export function epley1RM(reps, weight, rpe) {
  if (!(reps > 0) || !(weight > 0)) return null;
  const rir = clamp(10 - (rpe ?? 8), 0, 5);
  // A −1 azért kell, hogy egy RPE 10-es szingli épp a saját súlyát adja vissza
  // (a nyers Epley 1 ismétlésnél is 3%-ot ad hozzá).
  return weight * (1 + (reps + rir - 1) / 30);
}

/**
 * A mentett edzések feldolgozása egyetlen menetben, napi bontásban.
 * Visszaadja: napi összterhelés, napi CNS-terhelés, napi izomcsoport-terhelés,
 * valamint gyakorlatonként az alkalmak listája (dátum + becsült 1RM).
 */
function summarizeWorkouts(workouts, todayKey, catalog) {
  const byDay = new Map();      // daysAgo → { load, cns, muscles }
  const exercises = new Map();  // név → { name, sessions: [{ daysAgo, best1RM, sets }] }

  const dayBucket = (ago) => {
    if (!byDay.has(ago)) byDay.set(ago, { load: 0, cns: 0, muscles: emptyMuscleMap() });
    return byDay.get(ago);
  };

  for (const workout of workouts) {
    const ago = daysAgo(workout.date, todayKey);
    // A jövőbeli (elrontott dátumú) és a nagyon régi edzések kimaradnak
    if (!Number.isFinite(ago) || ago < 0 || ago > CHRONIC_WINDOW_DAYS) continue;
    const bucket = dayBucket(ago);

    for (const exercise of workout.exercises ?? []) {
      const muscleLoad = resolveExerciseLoad(exercise.name, catalog);
      const axial = isAxialLift(exercise.name);
      let exerciseLoad = 0;
      let exerciseStimulus = 0;
      let best1RM = null;
      let doneSets = 0;

      for (const set of exercise.sets ?? []) {
        // Az izomkárosodás szett-típusonként eltérően számít (a bemelegítő
        // nullát ad) — a TONNATÖMEG viszont a bemelegítésé is valódi elvégzett
        // munka, ezért a szisztémás terhelés és a CNS minden teljesített
        // szettet lát. A két mérőszám itt szándékosan külön kapun megy át.
        exerciseStimulus += setStimulus(set);

        const load = setLoad(set);
        if (load === 0) continue; // saját testsúlyos vagy be nem pipált szett: izmot terhel, tonnát nem
        doneSets += 1;
        exerciseLoad += load;

        const estimate = epley1RM(num(set.reps), num(set.weight), num(set.rpe));
        if (estimate !== null && (best1RM === null || estimate > best1RM)) best1RM = estimate;

        // — CNS-költség —
        // Az idegrendszert az axiális összetett emelések és a bukáshoz közeli
        // szettek terhelik igazán. A felárak ÖSSZEADÓDNAK, nem szorzódnak:
        // szorzással egyetlen nehéz, magas RPE-s szesszió (1.5 × 2 = 3×)
        // egymaga nullázná a CNS-t, ami irreális.
        const rpe = num(set.rpe);
        let surcharge = 0;
        if (axial) surcharge += 0.5;
        if (rpe !== null && rpe >= 9) surcharge += 0.6;
        else if (rpe !== null && rpe >= 8.5) surcharge += 0.3;

        bucket.cns += load * (1 + surcharge);
        if (exercise.pr) bucket.cns += 0.4; // PR-próbálkozás: fix ráfizetés szettenként
      }

      bucket.load += exerciseLoad;
      for (const [group, share] of Object.entries(muscleLoad)) {
        bucket.muscles[group] += exerciseStimulus * share;
      }

      if (doneSets > 0) {
        const key = exercise.name.trim();
        if (!exercises.has(key)) exercises.set(key, { name: key, sessions: [] });
        exercises.get(key).sessions.push({ daysAgo: ago, best1RM, load: exerciseLoad, sets: doneSets });
      }
    }
  }

  return { byDay, exercises };
}

/** Exponenciálisan csillapított összeg: Σ érték_d × e^(−d/τ) az ablakon belül. */
function decayedSum(byDay, tau, windowDays, pick) {
  let total = 0;
  for (const [ago, bucket] of byDay) {
    if (ago > windowDays) continue;
    total += pick(bucket) * Math.exp(-ago / tau);
  }
  return total;
}

/** Napi átlag az elmúlt `windowDays` napra — a pihenőnapokat is beleértve
    (ezért osztunk a napok számával, nem az edzésnapokéval). */
function dailyAverage(byDay, windowDays, pick) {
  let total = 0;
  for (const [ago, bucket] of byDay) {
    if (ago > windowDays) continue;
    total += pick(bucket);
  }
  return total / windowDays;
}

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
  if (hours < 7.5) return (hours - 4) / 3.5;
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

  // Alvásadósság: az elmúlt 3 nap 8 órához mért hiánya, legfeljebb −0.15.
  // Egy jó éjszaka nem törli el három rossz éjszaka hatását.
  const recentHours = recentCheckins
    .filter((entry) => entry.daysAgo >= 0 && entry.daysAgo <= 2)
    .map((entry) => num(entry.sleepHours))
    .filter((value) => value !== null);
  if (recentHours.length >= 2) {
    const debt = recentHours.reduce((sum, value) => sum + Math.max(0, 8 - value), 0);
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
const hasNutritionEntries = (totals) => Boolean(totals) && (num(totals.intake) > 0 || num(totals.protein) > 0);

/**
 * Táplálkozás / hidratáció. Az alultápláltságot büntetjük, a többletet nem:
 * a regeneráció szempontjából az számít, hogy megvan-e a szükséges bevitel.
 * A `nutrition` lehet null (nincs naplózás) — ilyenkor csak a hidratáció
 * számít, és ha az sincs, a komponens egésze kimarad a képletből.
 */
export function nutritionScore(nutrition, hydrationLiters, bodyWeight) {
  const parts = [];
  const calorieGoal = num(nutrition?.goal?.calories);
  const proteinGoal = num(nutrition?.goal?.protein);

  if (calorieGoal) parts.push([0.5, clamp01(num(nutrition.intake) / calorieGoal)]);
  if (proteinGoal) parts.push([0.3, clamp01(num(nutrition.protein) / proteinGoal)]);
  if (hydrationLiters !== null) {
    const target = 0.033 * (bodyWeight ?? REF_BODY_WEIGHT); // ~33 ml/testsúlykg
    parts.push([0.2, clamp01(hydrationLiters / target)]);
  }

  if (!parts.length) return null;
  const weightSum = parts.reduce((sum, [w]) => sum + w, 0);
  return parts.reduce((sum, [w, value]) => sum + w * value, 0) / weightSum;
}

/* ======================================================================
   Izomcsoport-readiness
   ====================================================================== */

function muscleReadiness({ byDay, checkin, hasHistory, hasAnyWorkout }) {
  const soreness = checkin?.soreness ?? {};
  const pain = checkin?.pain ?? {};

  // Személyes referencia csoportonként: a nem-nulla napi terhelések átlaga
  // (vagyis egy tipikus „ezt az izmot megdolgoztató nap") az elmúlt 28 napból.
  const personalRef = {};
  for (const group of MUSCLE_KEYS) {
    const nonZero = [];
    for (const [ago, bucket] of byDay) {
      if (ago <= CHRONIC_WINDOW_DAYS && bucket.muscles[group] > 0) nonZero.push(bucket.muscles[group]);
    }
    personalRef[group] = nonZero.length >= 2 ? mean(nonZero) : 0;
  }

  return MUSCLE_KEYS.map((group) => {
    const tau = TAU_BY_GROUP[group];
    const damage = decayedSum(byDay, tau, MUSCLE_WINDOW_DAYS, (bucket) => bucket.muscles[group]);

    // A szett-egység nem skálázódik testsúllyal (öt szett az öt szett) —
    // ellentétben a tonna-alapú fáradtság- és CNS-referenciákkal.
    const absoluteRef = ABS_GROUP_REF[group];
    const base = hasHistory && personalRef[group] > 0
      ? Math.max(personalRef[group], absoluteRef * 0.5)
      : absoluteRef;
    const modelled = 100 * (1 - clamp01(damage / (base * MUSCLE_REF_MULT)));

    /* Szubjektív izomláz (0–5) bekeverése, ha a check-inben megadta.

       A keverés SÚLYA attól függ, tud-e egyáltalán mondani valamit a modell:
         · ha van naplózott terhelés ezen a csoporton (damage > 0), a modell
           dominál (0.6), mert az objektív terhelést ismeri;
         · ha NINCS (damage === 0), akkor a „100% friss" nem tudás, hanem az
           információ HIÁNYA. Ilyenkor 0.6-os súllyal elnyomná a felhasználó
           saját jelzését — pedig az az egyetlen jel, ami van. Ezért ott az
           érzet önmagában adja a pontszámot.

       Ez nem elméleti eset: terhelés-előzmény nélkül a régi keverés a
       maximális, 5/5-ös izomlázat is csak 60%-ig engedte le. */
    const reportedSoreness = num(soreness[group]);
    const subjective = reportedSoreness === null
      ? null
      : (1 - clamp01(reportedSoreness / 5)) * 100;
    const readiness = subjective === null
      ? modelled
      : damage > 0
        ? 0.6 * modelled + 0.4 * subjective
        : subjective;

    // Fájdalom-sapka: 7/10 felett a csoport nem edzhető normál intenzitással,
    // bármit is mond a terhelés-modell.
    const reportedPain = num(pain[group]);
    const capped = reportedPain !== null && reportedPain >= 7
      ? Math.min(readiness, 30)
      : readiness;

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
      source: reportedSoreness === null ? 'model' : (damage > 0 ? 'blend' : 'reported'),
      lastLoadedDaysAgo,
    };
  });
}

/* ======================================================================
   CNS readiness
   ====================================================================== */

function cnsReadiness({ byDay, sleep, bodyWeight, hasHistory, hasAnyWorkout }) {
  const scale = (bodyWeight ?? REF_BODY_WEIGHT) / REF_BODY_WEIGHT;
  const load = decayedSum(byDay, TAU_CNS, LOAD_WINDOW_DAYS, (bucket) => bucket.cns);

  const absoluteRef = ABS_CNS_REF * scale;
  const chronic = dailyAverage(byDay, CHRONIC_WINDOW_DAYS, (bucket) => bucket.cns);
  const ref = hasHistory
    ? Math.max(chronic * FATIGUE_REF_MULT, absoluteRef * 0.4)
    : absoluteRef;

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
   Gyakorlat-specifikus readiness + ajánlás
   ====================================================================== */

/** A pontszámból konkrét edzésdöntés. Ez a rendszer valódi kimenete —
    a szám csak az indoklás. */
function recommend(readiness, { prWindow }) {
  if (readiness >= 90 && prWindow) {
    return { verdict: 'pr', loadDelta: '+2.5–5 kg', volumeDelta: 'normál', text: '+2.5–5 kg is várhatóan teljesíthető' };
  }
  if (readiness >= 90) return { verdict: 'strong', loadDelta: 'normál', volumeDelta: 'normál', text: 'nyugodtan mehet a nehezebb sorozat' };
  if (readiness >= 80) return { verdict: 'normal', loadDelta: 'normál', volumeDelta: 'normál', text: 'normál intenzitás' };
  if (readiness >= 70) return { verdict: 'trim', loadDelta: 'normál', volumeDelta: '−1 szett', text: 'normál súly, −1 szett' };
  if (readiness >= 60) return { verdict: 'reduce', loadDelta: '−5–10%', volumeDelta: '−25%', text: 'csökkentett súly és volumen' };
  return { verdict: 'skip', loadDelta: '−15%', volumeDelta: '−50%', text: 'technikai nap vagy hagyd ki' };
}

/**
 * Gyakorlat-ajánlások.
 *
 * A jelöltek KÉT forrásból jönnek:
 *   · naplózott edzésekből (`exercises`) — itt van frissesség-adat is,
 *   · az erőfelmérésen BEMONDOTT gyakorlatokból (`declared`) — ezekről csak
 *     annyit tudunk, hogy a felhasználó ismeri őket. Enélkül a friss fiók
 *     hetekig egyetlen ajánlást sem kapna: a naplózott út három alkalmat kér
 *     (MIN_SESSIONS), a három fő emelés kivételével.
 *
 * A BEMONDOTT gyakorlatról viszont CSAK annyit tudunk, hogy a felhasználó
 * ismeri. Se frissesség, se izomcsoport-szintű regeneráció nincs mögötte —
 * ezért az ilyen ajánlás az ÖSSZESÍTETT készenlétre épül, ami a mai check-int
 * tükrözi. Ha az sincs (`overall === null`), a gyakorlat KIMARAD: semmit nem
 * tudunk, és a „nincs adat" nem lehet „tökéletes állapot". A `basis` mező
 * mindkét esetben kimondja, min alapul a szám.
 */
function exerciseReadiness({ exercises, muscles, cns, catalog, declared = [], overall = null }) {
  const byKey = Object.fromEntries(muscles.map((m) => [m.key, m.readiness]));
  const painfulGroups = new Set(muscles.filter((m) => m.pain !== null && m.pain >= 7).map((m) => m.key));

  const logged = [...exercises.values()]
    .map((entry) => ({ ...entry, isMain: MAIN_LIFTS.includes(normalizeName(entry.name)) }))
    .filter((entry) => entry.isMain || entry.sessions.length >= MIN_SESSIONS);

  /* A bemondott gyakorlatok csak akkor kerülnek be, ha naplózott adat NINCS
     róluk — ahol van, ott a mérés a jobb forrás. */
  const loggedNames = new Set(logged.map((entry) => normalizeName(entry.name)));
  /* Összesített készenlét nélkül a bemondott gyakorlatról semmit nem tudnánk
     mondani — ilyenkor inkább nem mondunk semmit. */
  const declaredOnly = overall === null ? [] : declared
    .filter((entry) => !loggedNames.has(normalizeName(entry.name)))
    .map((entry) => ({ name: entry.name, sessions: [], isMain: MAIN_LIFTS.includes(normalizeName(entry.name)) }));

  const candidates = [...logged, ...declaredOnly]
    .sort((a, b) => (Number(b.isMain) - Number(a.isMain)) || (b.sessions.length - a.sessions.length))
    .slice(0, MAX_EXERCISE_RECS);

  return candidates.map((entry) => {
    const load = resolveExerciseLoad(entry.name, catalog);
    const groups = Object.entries(load);

    // A gyakorlat izom-readinesse: a terhelt csoportok súlyozott átlaga.
    // Ha egyik izomcsoportot sem ismerjük fel, a teljes izom-átlagra esünk
    // vissza — így ismeretlen gyakorlatnév sem ad hamis biztonságérzetet.
    const muscleScore = groups.length
      ? groups.reduce((sum, [group, share]) => sum + byKey[group] * share, 0)
      : mean(muscles.map((m) => m.readiness));

    /* Frissesség: eltelt-e annyi idő, amennyi ehhez a gyakorlathoz szokott.
       BEMONDOTT gyakorlatnál nincs ilyen adat — a súlya ilyenkor a másik két
       tényező között oszlik szét, nem tippelünk helyette értéket. */
    const sorted = [...entry.sessions].sort((a, b) => a.daysAgo - b.daysAgo);
    const hasSessions = sorted.length > 0;
    const sinceLast = hasSessions ? sorted[0].daysAgo : null;

    let readiness;
    if (hasSessions) {
      const gaps = sorted.slice(1).map((session, i) => session.daysAgo - sorted[i].daysAgo);
      const typicalGap = gaps.length ? clamp(median(gaps), 2, 7) : 3.5;
      const freshness = clamp01(sinceLast / typicalGap) * 100;
      readiness = 0.45 * muscleScore + 0.30 * cns + 0.25 * freshness;
    } else {
      /* Bemondott gyakorlat: az izomcsoport-szintű regeneráció és a frissesség
         is hiányzik, ezért az ÖSSZESÍTETT készenlétet vesszük — az legalább a
         mai check-inre épül. A muscleScore itt 100 volna (a „nem terhelted"
         alapértelmezés), ami ismeretlen izomra hamis biztonságérzet. */
      readiness = overall;
    }

    // Ha a gyakorlat fájdalmas izomcsoportot terhel, letiltjuk — a fájdalom
    // felülír minden terhelés-alapú becslést.
    const hitsPainful = groups.some(([group]) => painfulGroups.has(group));
    if (hitsPainful) readiness = Math.min(readiness, 30);

    // PR-ablak csak akkor, ha a becsült 1RM az utolsó három alkalommal is
    // emelkedő trendet mutat — a jó közérzet önmagában nem elég indok.
    const estimates = sorted.slice(0, 3).map((session) => session.best1RM).filter((v) => v !== null);
    const prWindow = estimates.length >= 3 && estimates[0] > estimates[estimates.length - 1];

    const rounded = Math.round(clamp(readiness, 0, 100));
    return {
      name: entry.name,
      readiness: rounded,
      sessions: entry.sessions.length,
      daysSinceLast: sinceLast,
      /* Mire épül a szám: naplózott alkalmakra, vagy csak a bemondott
         erőfelmérésre. A felületnek ezt ki kell mondania — a bemondás nem
         mérés. */
      basis: hasSessions ? 'logged' : 'declared',
      painBlocked: hitsPainful,
      ...(hitsPainful
        ? { verdict: 'avoid', loadDelta: '—', volumeDelta: '—', text: 'kerüld ma — fájdalmat jeleztél' }
        : recommend(rounded, { prWindow })),
    };
  });
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
 * @param {object}   input.nutrition  { today, yesterday } táplálkozási összesítők
 * @param {Array}    input.weightLog  testsúly-bejegyzések ({ kg, date })
 * @param {Array}    input.catalog    gyakorlat-katalógus (izom-súlyokkal)
 * @param {string}   input.today      a mai nap "ÉÉÉÉ.HH.NN" alakban
 * @param {Array}    input.declaredMaxes  az erőfelmérésen bemondott csúcsok
 *                                       ({ name, max1rm }) — ezekből is lesz ajánlás
 */
export function computeReadiness({
  checkins = [], workouts = [], nutrition = null, weightLog = [], catalog = [], today,
  declaredMaxes = [],
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

  // — Testsúly (a terhelés-referenciák skálázásához)
  const latestWeight = [...weightLog]
    .sort((a, b) => dayKey(b.date) - dayKey(a.date))[0];
  const bodyWeight = num(latestWeight?.kg) ?? REF_BODY_WEIGHT;

  // — Edzésadatok
  const { byDay, exercises } = summarizeWorkouts(workouts, todayKey, catalog);
  const historyDays = byDay.size
    ? Math.max(...[...byDay.keys()]) + 1
    : 0;
  const hasHistory = historyDays >= PERSONAL_REF_MIN_DAYS;

  // — Izomcsoportok
  /* Naplózott-e VALAHA edzést? Ez választja el a „nem terhelted" (érvényes
     következtetés) esetet a „nem tudunk róla semmit" esettől. */
  const hasAnyWorkout = (Array.isArray(workouts) ? workouts : []).some((entry) => {
    const key = dayKey(entry?.date);
    // Érvényes dátum ÉS nem a jövő: a motor mindenhol így szűr (daysAgo >= 0),
    // és egy elgépelt/jövőbeli sor nem tehet „naplózó felhasználóvá" senkit.
    return Number.isFinite(key) && key <= todayKey;
  });
  const muscles = muscleReadiness({ byDay, checkin, hasHistory, hasAnyWorkout });

  // — Komponensek
  const sleep = sleepScore(checkin, normalized);
  const cns = cnsReadiness({ byDay, sleep, bodyWeight, hasHistory, hasAnyWorkout });

  /* Izom-komponens: a csoportok „soft-min" átlaga — a legrosszabb csoport
     nagyobb súlyt kap, hogy egy tönkrement lábnap ne tűnjön el a friss
     felsőtest átlagában.

     CSAK az ISMERT csoportokból számol. Ha egyikről sem tudunk semmit, a
     komponens null: kimarad a képletből, és a súlya szétoszlik — ahogy
     minden más hiányzó adaté. Korábban ilyenkor 100 ment a képletbe, tehát
     a tudatlanság tökéletes állapotnak látszott. */
  const knownMuscles = muscles.filter((m) => m.known);
  const muscleValues = knownMuscles.map((m) => m.readiness / 100);
  const muscleComponent = muscleValues.length === 0
    ? null
    : (() => {
      const muscleAvg = mean(muscleValues);
      return clamp01(muscleAvg - 0.5 * (muscleAvg - Math.min(...muscleValues)));
    })();

  // Edzésterhelés-regeneráció
  const fatigue = decayedSum(byDay, TAU_LOAD, LOAD_WINDOW_DAYS, (bucket) => bucket.load);
  const chronicDaily = dailyAverage(byDay, CHRONIC_WINDOW_DAYS, (bucket) => bucket.load);
  const absFatigueRef = ABS_FATIGUE_REF * (bodyWeight / REF_BODY_WEIGHT);
  const fatigueRef = hasHistory
    ? Math.max(chronicDaily * FATIGUE_REF_MULT, absFatigueRef * 0.4)
    : absFatigueRef;
  /* Ugyanaz a szabály a terhelésre: ha SOSEM naplózott edzést, a „nulla
     fáradtság" nem mérés, hanem üres napló. Aki viszont naplóz, annál a
     „régen edzettél" már érvényes következtetés — ott a 100 helyes. */
  const loadComponent = hasAnyWorkout ? clamp01(1 - fatigue / fatigueRef) : null;

  const scores = {
    sleep,
    muscle: muscleComponent,
    energy: scaleUp(checkin ? checkin.energy : null),
    stress: scaleDown(checkin ? checkin.stress : null),
    load: loadComponent,
    // A regeneráció szempontjából a TEGNAPI bevitel a mérvadó: a check-in
    // reggel készül, amikor a mai étkezések még előtted vannak. Ha tegnapról
    // nincs naplózás, a mai napra esünk vissza.
    nutrition: nutritionScore(
      hasNutritionEntries(nutrition?.yesterday) ? nutrition.yesterday
        : hasNutritionEntries(nutrition?.today) ? nutrition.today : null,
      checkin ? checkin.hydration : null,
      bodyWeight,
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
    if (generalPain >= 7 && overall > 45) {
      overall = 45;
      caps.push('Erős fájdalmat jeleztél — a készenlét 45%-ra korlátozva.');
    }
    if (checkin?.mood === 1 && overall > 40) {
      overall = 40;
      caps.push('Nagyon rossz közérzet — a készenlét 40%-ra korlátozva.');
    }
  }

  // — Megbízhatóság: mennyire van mire alapozni
  const checkinCount = normalized.filter((entry) => entry.daysAgo < CHRONIC_WINDOW_DAYS).length;
  let confidence = 'low';
  let confidenceNote;
  if (checkin && historyDays >= PERSONAL_REF_MIN_DAYS && checkinCount >= 7) {
    confidence = 'high';
    confidenceNote = 'A saját előzményedhez mérve — megbízható becslés.';
  } else if (checkin && historyDays >= 5) {
    confidence = 'medium';
    confidenceNote = `Részben általános referenciával — még ${Math.max(0, PERSONAL_REF_MIN_DAYS - historyDays)} nap edzés-előzmény kell a személyre szabott becsléshez.`;
  } else if (checkin) {
    confidence = 'low';
    confidenceNote = 'Kevés edzés-előzmény — a terhelés-becslés általános referenciával fut.';
  } else {
    confidence = 'low';
    confidenceNote = 'Nincs mai check-in — a pontszám csak az edzésnaplóra és a táplálkozásra épül.';
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
      exercises, muscles, cns: cns.readiness ?? 100, catalog,
      declared: declaredMaxes, overall,
    }),
    caps,
    // Az áttekintő „Regeneráció" kártyájának három sora — a mérésekből
    // képzett szöveg, nem demo-adat.
    recovery: {
      sleep: checkin?.sleepHours !== null && checkin?.sleepHours !== undefined
        ? `${checkin.sleepHours} óra`
        : '—',
      fatigue: describe(loadComponent, ['Nagyon magas', 'Magas', 'Közepes', 'Alacsony']),
      soreness: describe(muscleComponent, ['Erős', 'Közepes', 'Enyhe', 'Nincs']),
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
