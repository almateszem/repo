/**
 * Podium — terhelés-könyvelés a mentett edzésekből
 * ------------------------------------------------------------------------
 * A Recovery Engine (recovery.js) bemenete: szettenkénti terhelés és inger,
 * az újdonság-szorzó, és az edzések napi bontása (summarizeWorkouts). Tiszta
 * számítás, adatbázis nélkül.
 */
import {
  MUSCLE_KEYS,
  resolveExerciseLoad,
  isAxialLift,
  eccentricClass,
  emptyMuscleMap,
  normalizeName,
} from './muscles.js';
// A kardió fokozatainak CR-10 értéke: a szesszió-RPE terhelés bemenete.
import { INTENSITY_LEVELS, DEFAULT_INTENSITY } from './logmode.js';
// A saját testsúlyos gyakorlatok alapterhelése — ugyanaz, mint a PR-követésé.
import { effectiveLoad } from './data/bodyweight-load.js';
import { dayKey, daysAgo, daysBetween } from './dates.js';
import { clamp, num } from './numbers.js';
import { epley1RM } from './one-rm.js';

/* A terhelés-számítás paraméterei. Az ablakokat és a referencia-testsúlyt a
   recovery.js is használja (innen importálja). */

export const CHRONIC_WINDOW_DAYS = 28; // ennyiből képezzük a személyes referenciát (0…27. nap)
export const MUSCLE_WINDOW_DAYS = 7; // az izomkárosodás ennél régebbről már elhanyagolható

/** Az újdonság-szorzó paraméterei (kiinduló értékek a kutatási riportból). */
const NOVELTY = {
  gapFreeWeeks: 3, // eddig a kihagyás nem számít
  gapMax: 0.8, // a kihagyás-görbe plafonja 1 + gapMax
  gapScaleWeeks: 10,
  newExercise: 1.3,
  newEccentric: 1.5,
  lookbackDays: 56, // „új gyakorlat": ennyi napban legfeljebb egyszer
  minHistoryDays: 28, // ennél rövidebb előzménynél nincs újdonság-szorzó
  meaningfulStimulus: 1, // ennyi szett-egység nullázza a kihagyás-órát
  cap: 2.5, // újdonság × excentrikus szorzó felső korlátja
};

/** Referencia-testsúly, amihez az abszolút terhelés-referenciák skálázódnak. */
export const REF_BODY_WEIGHT = 80;

/** PR-próbálkozás CNS-felárának plafonja gyakorlatonként, tonnában, 80 kg-os
    sportolóra. */
const PR_CNS_SURCHARGE = 0.4;

/** A PR-felár a rekordot hozó szett terhelésének ennyiszerese (a plafonig):
    egy tipikus nehéz rekordszett (kb. 0,5 t) éppen a 0,4 t-s plafont éri el,
    egy könnyű izolációs rekord viszont csak a saját kis terhelésével arányos. */
const PR_CNS_RECORD_FACTOR = 0.8;

/* ======================================================================
   Terhelés-számítás a mentett edzésekből
   ====================================================================== */

/* ----------------------------------------------------------------------
   Kardió: szesszió-RPE (Foster) → tonna-egyenérték   (kalibrálva 2026-09-17)
   ----------------------------------------------------------------------
   Az időalapú sorban nincs ismétlés és súly, tehát a tonnatömeg nulla — a
   motor korábban egy kemény futóhetet pihenőhétnek látott. A terhelés mértéke
   itt a SZESSZIÓ-RPE: perc × a fokozat CR-10 értéke (logmode.js →
   INTENSITY_LEVELS), egysége AU. A módszer súlyzós és állóképességi edzésre is
   validált (Sweet és mtsai 2004: ugyanazok az alanyok kerékpáron és súlyzóval)
   — ezért híd a kettő között. KORLÁT: súlyzós edzésnél a szesszió-RPE
   gyengébben korrelál más terhelés-mérőszámokkal (Haddad és mtsai 2017
   áttekintése: r = 0,52 vs. 0,82), tehát a két mód AU-ja nem tökéletesen
   összemérhető. Az átváltás becslés, nem mérés.

   Az AU → tonna átváltás EGY kalibrált szám, 2026-09-17-én ONLINE FORRÁSOKKAL
   ellenőrizve és 0,025-ről 0,02-re csökkentve. Két levezetés közé esik:
     · ELMÉLETI, edzett férfira: egy kemény súlyzós nap ≈ 60 perc × 7-es
       szesszió-RPE = 420 AU (a Foster-skálán 7 = „nagyon nehéz"; Day és mtsai
       2004-ben a 90%-os 1RM-es edzés szesszió-RPE-je 6,9 volt), és ≈ 22 szett ×
       8 ism. × ~52 kg átlagsúly ≈ 9,2 t (az izolációs gyakorlatok lehúzzák az
       átlagot) → 0,022 t/AU;
     · MÉRT: junior női rögbisek (71 kg) súlyzós edzésein 5181 kg / 316 AU és
       4516 kg / 332 AU, a relatív tonnatömeggel 80 kg-ra skálázva 0,019 és
       0,015 t/AU. Edzett, erősebb versenyzőnél ez alsó becslés.
   Tehát 1 AU = 0,02 t. Példák 80 kg-on: 45 perc „Magas" futás 4,5 t, 90 perc
   „Magas" 9 t (kemény súlyzós nap). Az ABS_FATIGUE_REF (25 t) ezzel is
   összhangban van: kétnaponta ismételt ~12 t-s napoknál telik be.

   A TESTSÚLY-skálázás azért kell, mert a referencia is skálázódik vele
   (absFatigueRef): a tonnatömeg a nehezebb sportolónál természetesen nagyobb,
   a szesszió-RPE viszont nem. Így ugyanaz az edzés ugyanakkora hányadát adja a
   referenciának 60 és 100 kg-on is.

   Az IDEGRENDSZER csak a „Magas" és „Maximális" fokozaton kap a terhelés
   feléből: az alacsony intenzitású aerob munka nem terheli a CNS-t, a kemény
   intervall igen, de kevésbé, mint egy nehéz axiális emelés (annál a CNS a
   tonna 1-2,1-szerese). IZOMCSOPORT-terhelés szándékosan NINCS: a mozgások
   közt nagyon eltér (a futás eccentrikus lábizom-károsodást okoz, a kerékpár
   alig), és ahhoz külön kalibráció kellene. */
const SRPE_TONNES_PER_AU = 0.02;
const CARDIO_CNS_SHARE = 0.5;
const CARDIO_CNS_INTENSITIES = new Set(['high', 'max']);

/** Egy teljesített időalapú sor terhelése tonna-egyenértékben. Az ismeretlen
    fokozat a skála közepét kapja — ugyanúgy, ahogy a mentés normalizálja. */
function cardioSetLoad(set, bodyWeight) {
  if (!set?.done) return 0;
  const seconds = num(set.duration);
  if (seconds === null || seconds <= 0) return 0;
  const level = INTENSITY_LEVELS[set.intensity] ?? INTENSITY_LEVELS[DEFAULT_INTENSITY];
  return (seconds / 60) * level.cr10 * SRPE_TONNES_PER_AU * (bodyWeight / REF_BODY_WEIGHT);
}

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
    fáradtságra és az idegrendszeri költségre.
    A `baseLoad` a saját testsúlyos gyakorlat alapterhelése (a testsúly hányada,
    bodyweight-load.js → effectiveLoad); a beírt súly erre kerül rá, ahogy a
    PR-követésnél is. Más gyakorlatnál 0. */
function setLoad(set, baseLoad = 0) {
  if (!set?.done) return 0;
  const reps = num(set.reps);
  const weight = (num(set.weight) ?? 0) + baseLoad;
  if (reps === null || reps <= 0 || weight <= 0) return 0;
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

/** A lassú tároló súlya a bukás közelsége szerint (RIR = 10 − RPE). Edzetteknél
    a bukástól távoli munka után 6–24 óra alatt helyreáll a teljesítmény, a
    bukásig vitt munka után 2–5 napos farok marad. Hiányzó RPE: RIR 2. */
export function failureWeight(rpe, reps) {
  if (rpe === null) return 0.55;
  const rir = Math.round(10 - rpe);
  if (rir <= 0) return reps >= 12 ? 1.3 : 1;
  if (rir === 1) return 0.75;
  if (rir === 2) return 0.55;
  if (rir === 3) return 0.4;
  return 0.2;
}

/** Egy teljesített szett lassú-tároló egysége, az izom-részesedés és az
    excentrikus szorzó előtt. Az RPE itt csak a bukás-súlyon át hat. */
function slowSetUnits(set) {
  if (!set?.done) return 0;
  const reps = num(set.reps);
  if (reps === null || reps <= 0) return 0;
  const typeFactor = typeStimulusFactor(set.type);
  if (typeFactor === 0) return 0;
  return typeFactor * failureWeight(num(set.rpe), reps);
}

/** Kihagyás utáni újdonság: 3 hétig 1, utána sima görbén nő (26 hétnél ~1,72). */
function gapNovelty(weeks) {
  if (weeks <= NOVELTY.gapFreeWeeks) return 1;
  return (
    1 + NOVELTY.gapMax * (1 - Math.exp(-(weeks - NOVELTY.gapFreeWeeks) / NOVELTY.gapScaleWeeks))
  );
}

/** A lassú tároló szorzója: excentrikus jelleg × újdonság, együtt legfeljebb
    NOVELTY.cap, hogy a két, részben azonos jelenség ne számítson kétszer. */
function slowMultiplier(novelty, eccentric) {
  return Math.min(eccentric * novelty, NOVELTY.cap);
}

/**
 * Újdonság-szorzó edzésenként, gyakorlatonként és izomcsoportonként, az adott
 * edzés előtti előzményből. Az egész naplót bejárja (a 28 napon túlit is), de
 * csak a MUSCLE_WINDOW_DAYS ablakba eső edzésekhez ad eredményt.
 *
 * Az „érett előzmény" alapja az első edzés napja. Ha a hívó ablakozott naplót
 * ad át (edzői kártya), a TELJES napló első edzésnapját `historyStartKey`-ként
 * kívülről kell megadnia — különben az ablak első edzése számítana kezdetnek.
 *
 * @returns {Map<object, Array<Object<string, {value: number, reason: 'novelty'|'gap'|null}>|null>>}
 *   kulcs: a workout objektum; érték: a gyakorlatok sorrendjében egy-egy
 *   csoport → szorzó térkép (időalapú sornál null).
 */
export function buildNoveltyIndex(workouts, todayKey, catalog, historyStartKey = null) {
  const dated = (Array.isArray(workouts) ? workouts : [])
    .map((workout) => ({ workout, key: dayKey(workout?.date) }))
    .filter(({ key }) => Number.isFinite(key) && key <= todayKey)
    .sort((a, b) => a.key - b.key);
  const index = new Map();
  if (!dated.length) return index;

  const firstKey = Number.isFinite(historyStartKey) ? historyStartKey : dated[0].key;
  const lastMeaningful = {}; // csoport – nap-kulcs
  const exerciseDays = new Map(); // normalizált név – nap-kulcsok

  for (const { workout, key } of dated) {
    const mature = daysBetween(firstKey, key) >= NOVELTY.minHistoryDays;
    const groupStimulus = emptyMuscleMap();
    const trainedNames = new Set();
    const perExercise = [];

    for (const exercise of workout.exercises ?? []) {
      if (exercise.logMode === 'duration') {
        perExercise.push(null);
        continue;
      }
      const load = resolveExerciseLoad(exercise.name, catalog);
      const stimulus = (exercise.sets ?? []).reduce((sum, set) => sum + setStimulus(set), 0);
      const name = normalizeName(exercise.name);
      const byGroup = {};

      if (mature && stimulus > 0) {
        const previous = (exerciseDays.get(name) ?? []).filter((day) => {
          const gap = daysBetween(day, key);
          return gap > 0 && gap <= NOVELTY.lookbackDays;
        });
        const exerciseNovelty =
          previous.length <= 1
            ? eccentricClass(exercise.name) > 1
              ? NOVELTY.newEccentric
              : NOVELTY.newExercise
            : 1;
        for (const [group, share] of Object.entries(load)) {
          const last = lastMeaningful[group];
          // Kihagyásról csak korábbi és mostani érdemi terhelés közt beszélünk: a
          // mellékizmok (pl. core) és a sosem edzett csoportok az új gyakorlat szabályát kapják.
          const gap =
            last !== undefined && stimulus * share >= NOVELTY.meaningfulStimulus
              ? gapNovelty(daysBetween(last, key) / 7)
              : 1;
          const value = Math.max(gap, exerciseNovelty);
          byGroup[group] = {
            value,
            reason: value === 1 ? null : exerciseNovelty >= gap ? 'novelty' : 'gap',
          };
        }
      }
      perExercise.push(byGroup);

      if (stimulus > 0) trainedNames.add(name);
      for (const [group, share] of Object.entries(load)) groupStimulus[group] += stimulus * share;
    }

    // A frissítés az edzés után jön, hogy egy gyakorlat önmagát ne lássa előzménynek.
    for (const name of trainedNames) {
      const days = exerciseDays.get(name) ?? [];
      if (days[days.length - 1] !== key) days.push(key);
      exerciseDays.set(name, days);
    }
    for (const group of MUSCLE_KEYS) {
      if (groupStimulus[group] >= NOVELTY.meaningfulStimulus) lastMeaningful[group] = key;
    }
    if (daysBetween(key, todayKey) <= MUSCLE_WINDOW_DAYS) index.set(workout, perExercise);
  }
  return index;
}

/**
 * A mentett edzések feldolgozása egyetlen menetben, napi bontásban.
 * Visszaadja: napi összterhelés, napi CNS-terhelés, napi izomcsoport-terhelés,
 * valamint gyakorlatonként az alkalmak listája (dátum + becsült 1RM).
 */
export function summarizeWorkouts(workouts, todayKey, catalog, bodyWeight, novelty = new Map()) {
  const byDay = new Map(); // daysAgo → { load, cns, muscles, slow, unusual }
  /* normalizált név → { name, sessions: [{ daysAgo, best1RM, sets }] }. A kulcs
     ékezet- és kisbetű-független (normalizeName), mint a bemondott csúcsok
     összefésülése: a „Fekvenyomás" és a „fekvenyomas" egy ajánlás. A
     megjelenített név a katalógusbeli alak, ennek híján az első látott. */
  const exercises = new Map();
  const catalogNames = new Map(
    (Array.isArray(catalog) ? catalog : [])
      .filter((item) => item?.name)
      .map((item) => [normalizeName(item.name), item.name]),
  );

  // muscles: a gyors tároló, slow: a lassú tároló (mindkettő szett-egység);
  // unusual: volt-e aznap újdonság-szorzós terhelés a csoporton.
  const dayBucket = (ago) => {
    if (!byDay.has(ago)) {
      byDay.set(ago, {
        load: 0,
        cns: 0,
        muscles: emptyMuscleMap(),
        slow: emptyMuscleMap(),
        unusual: Object.fromEntries(MUSCLE_KEYS.map((key) => [key, null])),
      });
    }
    return byDay.get(ago);
  };

  for (const workout of workouts) {
    const ago = daysAgo(workout.date, todayKey);
    // A jövőbeli (elrontott dátumú) és a nagyon régi edzések kimaradnak
    // A krónikus ablak a 0…27. nap: PONTOSAN 28 nap, mert a napi átlag 28-cal
    // oszt. Korábban a 28. napot is beolvasta, tehát 29 nap terhelése ment 28
    // nap átlagába.
    if (!Number.isFinite(ago) || ago < 0 || ago >= CHRONIC_WINDOW_DAYS) continue;
    const bucket = dayBucket(ago);

    const workoutNovelty = novelty.get(workout) ?? [];
    for (const [exerciseIndex, exercise] of (workout.exercises ?? []).entries()) {
      /* Időalapú (kardió) sor: szisztémás terhelés, kemény fokozaton CNS is —
         izom és gyakorlat-ajánlás nincs (lásd cardioSetLoad fölött). */
      if (exercise.logMode === 'duration') {
        for (const set of exercise.sets ?? []) {
          const load = cardioSetLoad(set, bodyWeight);
          bucket.load += load;
          if (CARDIO_CNS_INTENSITIES.has(set.intensity)) bucket.cns += load * CARDIO_CNS_SHARE;
        }
        continue;
      }

      const muscleLoad = resolveExerciseLoad(exercise.name, catalog);
      const axial = isAxialLift(exercise.name);
      /* Saját testsúlyos gyakorlatnál a terhelés zöme a test: ugyanaz az
         alapterhelés, amivel a PR-követés is számol (a legutolsó testsúllyal;
         más gyakorlatnál 0). Enélkül a tisztán testsúlyos edzés tonnája, CNS-e
         és 1RM-je nulla volt. */
      const baseLoad = effectiveLoad(exercise.name, 0, bodyWeight);
      let exerciseLoad = 0;
      let exerciseStimulus = 0;
      let exerciseSlow = 0;
      let best1RM = null;
      let recordSetLoad = null; // a best1RM-et hozó szett terhelése
      let doneSets = 0;

      for (const set of exercise.sets ?? []) {
        // Az izomkárosodás szett-típusonként eltérően számít (a bemelegítő
        // nullát ad) — a TONNATÖMEG viszont a bemelegítésé is valódi elvégzett
        // munka, ezért a szisztémás terhelés és a CNS minden teljesített
        // szettet lát. A két mérőszám itt szándékosan külön kapun megy át.
        exerciseStimulus += setStimulus(set);
        exerciseSlow += slowSetUnits(set);

        const load = setLoad(set, baseLoad);
        if (load === 0) continue; // be nem pipált vagy súly nélküli (nem testsúlyos) szett: izmot terhel, tonnát nem
        doneSets += 1;
        exerciseLoad += load;

        const estimate = epley1RM(num(set.reps), (num(set.weight) ?? 0) + baseLoad, num(set.rpe));
        if (estimate !== null && (best1RM === null || estimate > best1RM)) {
          best1RM = estimate;
          recordSetLoad = load;
        }

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
      }

      /* PR-próbálkozás: gyakorlatonként EGYSZER, a rekordot hozó szett
         terhelésével arányos ráfizetés, plafonnal. Korábban szettenként járt
         (a bemelegítőkre is), a `pr` pedig gyakorlat-szintű jelző — egy könnyű
         karedzés így ~1,6 t felárat kapott ~0,5 t valódi munkára. A plafon
         tonnában mért, ezért a testsúllyal skálázódik, ahogy a CNS-referencia
         is (cnsReadiness). Teljesített, terhelésű szett nélkül nincs felár. */
      if (exercise.pr && recordSetLoad !== null) {
        bucket.cns += Math.min(
          PR_CNS_SURCHARGE * (bodyWeight / REF_BODY_WEIGHT),
          PR_CNS_RECORD_FACTOR * recordSetLoad,
        );
      }

      bucket.load += exerciseLoad;
      const eccentric = eccentricClass(exercise.name);
      const groupNovelty = workoutNovelty[exerciseIndex] ?? {};
      for (const [group, share] of Object.entries(muscleLoad)) {
        bucket.muscles[group] += exerciseStimulus * share;
        if (exerciseSlow > 0) {
          const { value, reason } = groupNovelty[group] ?? { value: 1, reason: null };
          bucket.slow[group] += exerciseSlow * share * slowMultiplier(value, eccentric);
          // A jelzés a felhasználónak szól: a mellékizom kis részesedése nem szokatlan terhelés.
          const meaningful = exerciseStimulus * share >= NOVELTY.meaningfulStimulus;
          if (
            meaningful &&
            (reason === 'novelty' || (reason === 'gap' && !bucket.unusual[group]))
          ) {
            bucket.unusual[group] = reason;
          }
        }
      }

      if (doneSets > 0) {
        const key = normalizeName(exercise.name);
        if (!exercises.has(key)) {
          exercises.set(key, { name: catalogNames.get(key) ?? exercise.name.trim(), sessions: [] });
        }
        exercises
          .get(key)
          .sessions.push({ daysAgo: ago, best1RM, load: exerciseLoad, sets: doneSets });
      }
    }
  }

  return { byDay, exercises };
}

/** Exponenciálisan csillapított összeg: Σ érték_d × e^(−d/τ) az ablakon belül. */
export function decayedSum(byDay, tau, windowDays, pick) {
  let total = 0;
  for (const [ago, bucket] of byDay) {
    if (ago > windowDays) continue;
    total += pick(bucket) * Math.exp(-ago / tau);
  }
  return total;
}

/** Napi átlag az elmúlt `windowDays` napra — a pihenőnapokat is beleértve
    (ezért osztunk a napok számával, nem az edzésnapokéval). */
export function dailyAverage(byDay, windowDays, pick) {
  let total = 0;
  for (const [ago, bucket] of byDay) {
    if (ago >= windowDays) continue; // 0…windowDays−1: pontosan windowDays nap
    total += pick(bucket);
  }
  return total / windowDays;
}
