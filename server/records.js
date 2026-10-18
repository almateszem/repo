/**
 * Podium — a rekord-szabály
 * ---------------------------------------
 * Melyik szett a gyakorlat REKORDJA, és mennyi a becsült 1RM-je. Tiszta
 * függvények, adatbázis nélkül: a db.js (PR-követés, csúcs-újraépítés), a
 * server.js (PR-lista) és a coaching.js (az edző „Legutóbbi aktivitás" sora)
 * is innen veszi — így mindenhol UGYANAZ a szett számít rekordnak.
 *
 * Itt él a PR-lista eleme (prEntry) és a profil rekord-csempéinek számítása
 * (firstLoggedMaxes, exerciseRecords) is: a végpontok (server.js) csak az
 * adatot olvassák ki és adják át.
 */

import { estimate1RM } from './one-rm.js';
import { formatDecimal } from './numbers.js';
import { effectiveLoad, isBodyweightExercise } from './data/bodyweight-load.js';
import { strengthStandards, strengthTier } from './data/strength-standards.js';

/** A becsült 1RM a PR-követéshez: az app közös Epley-képlete (one-rm.js →
    estimate1RM, egy ismétlésnél maga a súly). A szett mezői szövegként is
    jöhetnek; nem számolható értékre 0. */
export function calculateEpley1RM(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r)) return 0;
  return estimate1RM(w, r) ?? 0;
}

/**
 * A gyakorlat REKORDOT HOZÓ szettje: a teljesítettek közül a legmagasabb
 * becsült 1RM-ű. Ha egy sor sincs bepipálva, nincs ilyen szett (null) — egy
 * előre kitöltött, el nem végzett sor nem lehet rekord. A `fallbackToFirst`
 * a pipák előtti naplónak szól (workouts.pr_rule = 0): ott pipa híján az
 * első sor számított, és ezeknek a soroknak a csúcsai nem veszhetnek el.
 *
 * Ez az egyetlen hely, ahol ez a szabály ki van mondva, és ennek oka van. A
 * szabály eddig kétszer, két ágon élt: az addWorkout a legjobb szettből
 * döntött PR-ről, a /api/prs listája viszont az ELSŐ teljesítettet írta ki.
 * Amíg minden szett egyforma volt, ez ritkán tért el; a szett-típusok óta
 * viszont az első sor alapból BEMELEGÍTŐ, tehát a lista rendszeresen egy
 * könnyű bemelegítést hirdetett rekordnak (10 × 40 kg a 5 × 100 helyett),
 * miközben a mellette álló csúcs a valódi értéket mutatta.
 *
 * A `baseLoad` a saját testsúlyos gyakorlatoké: ott a beírt kilogramm csak a
 * RÁADÁS, a terhelés zöme a testsúly. Enélkül a rangsor is hibás volna — nulla
 * súllyal minden szett 1RM-je 0, tehát a „legjobb" mindig az ELSŐ pipált sor
 * lenne, nem a legtöbb ismétléses.
 *
 * @param {Array<object>} sets egy gyakorlat szettjei
 * @param {{ fallbackToFirst?: boolean, baseLoad?: number }} [options]
 *        fallbackToFirst: pipa híján az első sor legyen-e a rekord;
 *        baseLoad: minden szett súlyához hozzáadandó alapterhelés (kg)
 * @returns {object|null} a rekordot hozó szett, vagy null
 */
export function bestCompletedSet(sets = [], { fallbackToFirst = false, baseLoad = 0 } = {}) {
  let best = null;
  let best1rm = 0;
  for (const set of sets) {
    if (!set?.done) continue;
    const oneRM = calculateEpley1RM(Number(set.weight || 0) + baseLoad, set.reps);
    if (best === null || oneRM > best1rm) {
      best = set;
      best1rm = oneRM;
    }
  }
  return best ?? (fallbackToFirst ? (sets[0] ?? null) : null);
}

/** A testsúly egy adott napon a megadott naplóból: az utolsó bejegyzés a
    napon vagy előtte. Ha a napló csak később kezdődik, a legkorábbi bejegyzés
    — az a legjobb közelítés. Bejegyzés híján 0, és a hívó onnan tudja, hogy
    nem tippelünk. (A db.js weightForDate-je ezt hívja a beolvasott naplóval.) */
export function weightOnDate(log, date) {
  let best = null;
  let earliest = null;
  for (const entry of log ?? []) {
    if (entry.date <= date && (!best || entry.date >= best.date)) best = entry;
    // A tartalék a legkorábbi DÁTUMÚ bejegyzés, nem a legelőször rögzített:
    // egy utólag bepótolt régi mérés is lehet a legkorábbi.
    if (!earliest || entry.date < earliest.date) earliest = entry;
  }
  return (best ?? earliest)?.kg ?? 0;
}

/** Egy PR-jelölt gyakorlat-előfordulás listaelemmé alakítása: a detail a
    rekordot hozó szett összegzése, valamint a becsült 1RM az Epley-képlettel.
    A szett kiválasztása a bestCompletedSet-tel történik — ugyanazzal,
    amivel az addWorkout PR-nek jelölte a gyakorlatot. Korábban itt az ELSŐ
    teljesített szett szerepelt, ami a szett-típusok óta jellemzően a
    bemelegítés: a lista a könnyű bemelegítő sorozatot hirdette rekordnak.
    A `maxRecord` a gyakorlat eddig nyomon követett csúcsa (db.js →
    getExerciseMax), vagy null. */
export function prEntry(workout, exercise, { weightLog, maxRecord }) {
  /* Saját testsúlyos gyakorlatnál a terhelés zöme a test: ugyanazt az
     alapterhelést kell használni, mint amivel az addWorkout a PR-t megítélte,
     különben a lista más számot hirdetne, mint amit a rekord mögött tárolunk. */
  const baseLoad = effectiveLoad(exercise.name, 0, weightOnDate(weightLog, workout.date));

  // A mértékegység már nem az értékben van (szám-mezők), ezért itt tesszük hozzá
  // Csak kijelzés, és csak PR-jelölt gyakorlatra: a pipák előtti sorok
  // részletszövegéhez a régi visszaesés (első sor) kell.
  const set = bestCompletedSet(exercise.sets, { fallbackToFirst: true, baseLoad });

  // Az Epley-képlettel kiszámított 1RM
  let oneRM = 0;
  if (set && set.reps && (Number(set.weight) > 0 || baseLoad > 0)) {
    oneRM = calculateEpley1RM(Number(set.weight || 0) + baseLoad, set.reps);
  }

  // A kerekítés mindkét ágon kell: enélkül a nyomon követett maximum nélküli
  // sorokban a nyers lebegőpontos érték (101.33333333333333) ment ki.
  const rounded = (value) => Math.round(value * 10) / 10;

  return {
    exercise: exercise.name,
    /* Saját testsúlyosnál a „8 ism. @ 0 kg" félrevezető volna — ott a beírt
       szám a RÁADÁS, a terhelés a test. A jelölés ezt mondja ki. */
    detail: set
      ? baseLoad > 0
        ? `${set.reps} ism. @ testsúly${Number(set.weight) > 0 ? ` +${formatDecimal(set.weight)} kg` : ''}`
        : `${set.reps} ism. @ ${formatDecimal(set.weight)} kg`
      : workout.name,
    oneRM: oneRM > 0 ? rounded(oneRM) : null, // 1 tizedesjegy pontosság
    maxOneRM: maxRecord ? rounded(maxRecord.max1rm) : rounded(oneRM),
    date: workout.date,
  };
}

/* ---- Fejlődés egy gyakorlatban ----
   Az érem azt mutatja, mennyit fejlődtél EBBEN a gyakorlatban — nem azt, hogy
   másokhoz vagy más gyakorlatokhoz képest hol tartasz. Ennek oka van: a
   kilogramm gyakorlatok között nem összemérhető (egy 1,0× testsúlyos felhúzás
   kezdő szint, ugyanez bicepsz hajlításban világrekord), gyakorlatonkénti
   erőstandard-táblánk pedig nincs — a katalógus 1400+ soros, és a
   `felszerelés` mezője sem megbízható (a Felhúzásé például „Gumiszalag").
   Önmagadhoz mérve viszont minden gyakorlat egyformán kezelhető.

   A TESTSÚLY azért van benne, mert enélkül az arány hazudna: 100 kg
   fekvenyomás 70 kg-osan más teljesítmény, mint 85 kg-osan. Az összevetés
   ezért két ARÁNY között történik (1RM / testsúly), nem két súly között —
   mindkettőnél a HOZZÁ TARTOZÓ napi testsúllyal. */

/** Gyakorlatonként az ELSŐ naplózott 1RM — ehhez méri magát a mostani csúcs.
    Csak a naplóból: a bemondott felmérés nem kiindulópont, hanem becslés, és a
    `source` mezője úgyis eltűnik, amint egy mért szett felülírja.

    A `sessions` a külön EDZÉSEK száma, nem a külön napoké. A különbség nem
    elméleti: aki egy napon belül két edzést naplóz (vagy javít egyet, majd
    felvesz mellé egy másikat), az két adatpontot hozott létre — napokban
    számolva viszont egynek látszana, és a fejlődése sosem indulna el.

    Az edzések DÁTUM szerint jönnek (db.js → getWorkoutsForRecords, nem
    rögzítési sorrendben): egy utólag
    bepótolt múlt havi edzés a kiindulópont, nem a múlt heti. A rekordot hozó
    szettet ugyanazzal a szabállyal választjuk, amivel az edzést mentették
    (pr_rule) — egy kipipálatlan, előre kitöltött sor nem kiindulópont. */
export function firstLoggedMaxes(workouts, weightLog) {
  const first = new Map();
  for (const workout of workouts) {
    // Az ADOTT NAP testsúlya: a saját testsúlyos gyakorlatok kiindulópontja is
    // akkori terhelés, nem mai.
    const bodyweightThen = weightOnDate(weightLog, workout.date);

    for (const exercise of workout.exercises) {
      const baseLoad = effectiveLoad(exercise.name, 0, bodyweightThen);
      const set = bestCompletedSet(exercise.sets, {
        fallbackToFirst: workout.prRule === 0,
        baseLoad,
      });
      const oneRM = set ? calculateEpley1RM(Number(set.weight || 0) + baseLoad, set.reps) : 0;
      if (oneRM <= 0) continue;

      /* A CSÚCSOT hozó szett adatai is kellenek, de nem a számoláshoz: a
         saját testsúlyos gyakorlatok kártyáján a rekord az, AMIT CSINÁLTÁL —
         „14 ism." vagy „+20 kg" —, nem a belőle számolt 98,7 kg. Azt a számot
         soha nem emelted meg tolódzkodásnál, és nem is így mondanád el. */
      const peak = {
        oneRM,
        addedWeight: Number(set.weight || 0),
        reps: Number(set.reps) || 0,
      };

      const entry = first.get(exercise.name);
      if (!entry) {
        first.set(exercise.name, { max1rm: oneRM, date: workout.date, sessions: 1, peak });
      } else {
        entry.sessions += 1;
        if (oneRM > entry.peak.oneRM) entry.peak = peak;
      }
    }
  }
  return first;
}

/** A profil rekord-csempéinek sorai: a csúcs, az erőszint-érem (ahol van
    standard), a saját fejlődés és — ha egyik mérce sem szól — hogy mi
    hiányzik. A `records` a getAllExerciseMaxes sorai; a `first` a
    firstLoggedMaxes térképe; a `perHand` a kezenkénti súlyú gyakorlatok
    neve (server.js → perHandNames). */
export function exerciseRecords(records, { first, weightLog, bodyweight, sex, age, perHand }) {
  return records.map((record) => {
    const baseline = first.get(record.exercise_name);

    /* KÉT mérce. Ahol van a nemhez tartozó erőstandard, ott az ADJA AZ
       ÉRMET: a „hol tartok ebben a gyakorlatban?" kérdésre ez a válasz, és
       egy tapasztalt újonc így az első rekordjánál a valós szintjét kapja.
       A saját fejlődés mellette is jön — a kártya kiegészítésként mutatja —,
       ahol pedig nincs standard, ott egyedül az dönt. */
    const standard = strengthTier(record.exercise_name, sex, record.max_1rm, bodyweight, age);
    const progress = progressFor(record, baseline, weightLog);

    return {
      name: record.exercise_name,
      max1rm: Math.round(record.max_1rm * 10) / 10,
      date: record.date,
      source: record.source,
      standard,
      progress,
      /* A beírt súly kezenkénti-e. A kártyának ki kell írnia, különben a
         kilogramm és a testsúly-szorzó ellentmond egymásnak: 34,7 kg és
         1,0× testsúly 67 kg-on csak úgy fér össze, ha a 34,7 egy kézé. */
      perHand: perHand.has(record.exercise_name),
      /* Saját testsúlyosnál a kártya NEM a számolt terhelést írja ki: a
         rekord az, amit ténylegesen csináltál. A testsúly benne marad a
         szint-számításban (a `standard` arányában), de a megjelenített
         értékbe nem adjuk hozzá — egy tolódzkodásnál a „98,7 kg" olyan
         szám, amit soha nem emeltél meg, és nem is így mondanád el. */
      bodyweightBased: isBodyweightExercise(record.exercise_name),
      achievement: isBodyweightExercise(record.exercise_name) ? (baseline?.peak ?? null) : null,
      /* Ha EGYIK mérce sem szólal meg, a felület nem hallgathat: a néma
         szürke érem megkülönböztethetetlen attól, mintha a színkódolás
         elromlott volna. A `needs` megmondja, MI hiányzik.

         Csak a STANDARD hiánya számít: az a fő mérce. Ha a fejlődés már
         adott érmet, de a gyakorlathoz volna erőszint, csak a nem hiányzik,
         a felület akkor is szól — különben a kártya a kisebbik mércén
         ragadna, és senki nem tudná meg, hogy egy beállítás választja el a
         valódi szintjétől. */
      needs: standard ? null : missingFor(record, sex, bodyweight, baseline),
    };
  });
}

/** Mi hiányzik ahhoz, hogy a rekord érmet kapjon. Csak akkor hívjuk, ha az
    erőszint nem szólalt meg (a fejlődés-mérce ettől még adhatott érmet).

    A TESTSÚLY áll elöl, mert az MINDKÉT mércéhez kell (az erőszint és a
    fejlődés is arányt számol) — a nem ezzel szemben csak az egyiket nyitja ki.
    A legvégén az áll, amiért edzeni kell, nem beállítani. */
function missingFor(record, sex, bodyweight, first) {
  if (!(bodyweight > 0)) return 'bodyweight';
  if (strengthStandards[record.exercise_name] && !sex) return 'sex';
  // Innen csak a fejlődés-mérce jöhet szóba; ha az már szólt, nincs hiány.
  if (!first || first.sessions < 2) return 'second-session';
  return null;
}

/** A fejlődés százalékban, vagy null, ha nincs mihez mérni. A null NEM nulla:
    „még nem tudjuk" és „nem fejlődtél" két külön állítás, és a felület is
    másképp mutatja őket (semleges érem vs. bronz). Null jön, ha nincs
    naplózott kiindulópont, egyetlen edzésed van az adott gyakorlatból, nincs
    testsúly-bejegyzés, nulla lenne az osztó — vagy ha a csúcs BEMONDOTT
    érték: azt a naplózott kiindulóponthoz mérni becslést mérne méréshez.

    Mindkét arány a SAJÁT napjának testsúlyával számol: a kiindulópont az első
    edzés napjáéval, a csúcs a csúcs napjáéval — nem a maival. */
function progressFor(record, first, weightLog) {
  if (!first || first.sessions < 2 || weightLog.length === 0) return null;
  if (record.source === 'declared') return null;

  const weightThen = weightOnDate(weightLog, first.date);
  const weightAtRecord = weightOnDate(weightLog, record.date);
  if (!weightThen || !weightAtRecord) return null;

  const ratioThen = first.max1rm / weightThen;
  const ratioNow = record.max_1rm / weightAtRecord;
  if (ratioThen <= 0) return null;

  return {
    percent: Math.round((ratioNow / ratioThen - 1) * 100),
    fromMax1rm: Math.round(first.max1rm * 10) / 10,
    fromDate: first.date,
  };
}
