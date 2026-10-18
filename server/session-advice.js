/**
 * Podium — a mai edzés biztonsági átnézése és a készenlét-alapú javaslat
 * ------------------------------------------------------------------------
 * Tiszta számítás: a mai készenléti riportot, a gyakorlat-katalógust és a mai
 * naplót a hívó (server.js) olvassa ki és adja át. A piszkozat mentése is a
 * hívóé.
 */
import { createHash } from 'node:crypto';
import { MUSCLE_GROUPS, PAIN_BLOCK, resolveExerciseLoad } from './muscles.js';
import { formatDecimal } from './numbers.js';
import { reduceWeight } from './exercise-advice.js';

/* ======================================================================
   Biztonsági átnézés — a készenlét felülírja a tervet
   ----------------------------------------------------------------------
   A kiosztott tervhez a kliens nem nyúlhat. Egyetlen dolog szólhat bele:
   a mai készenléte. A rendszer NEM írja át a tervet (az elrejtené az edző
   elől, mi történt) — hanem MEGJELÖLI, mi kockázatos ma, és miért.

   A jelzés minden gyakorlatra működik, nem csak arra, amire van előzmény:
   a gyakorlat → izomcsoport leképezésből dolgozik, nem a naplóból.
   ====================================================================== */

/** E alatti izom-készenlétnél óvatosságra intünk (de nem tiltunk).

    A szám a MOTOR SKÁLÁJÁHOZ igazodik, nem érzésre van megválasztva. Ahol a
    terhelés-modellnek VAN adata a csoportról, ott a bejelentett izomlázat
    0.4 súllyal keveri be (recovery.js → muscleReadiness). Ha tehát a modell
    frissnek látja az izmot (100), de a felhasználó 5/5-ös izomlázat jelez,
    az eredmény 60 — vagyis egy 45%-os küszöb ezt az esetet néma maradna,
    pedig pont ilyenkor kell visszavenni.
    (Ha a modellnek NINCS adata a csoportról, a bejelentett érzet önmagában
    adja a pontszámot — ott az 5/5 már 0-t ad.)
    A 70 egyben a exercise-advice.js recommend() létrájának ugyanazon foka, ahol az
    „normál súly, −1 szett"-re vált. */
const LOW_MUSCLE_READINESS = 70;
/** Egy gyakorlatot akkor tekintünk az izomcsoport terhelőjének, ha a terhelés
    legalább ennyi — a jelentéktelen másodlagos terhelésre nem figyelmeztetünk. */
const RELEVANT_LOAD = 0.2;

/** Egy fiókhoz egyszer elkészített átnéző a mai készenléti riportból
    (recovery.js → computeReadiness) és a gyakorlat-katalógusból. Visszaad egy
    függvényt, ami egy gyakorlat-listára megmondja, mi tiltott és mi
    kockázatos MA. */
export function planSafetyChecker(report, catalog) {
  const byKey = Object.fromEntries(report.muscles.map((m) => [m.key, m]));

  return (exercises) => {
    const blocked = [];
    const caution = [];

    for (const exercise of exercises) {
      const load = resolveExerciseLoad(exercise.name, catalog);
      const groups = Object.entries(load).filter(([, share]) => share >= RELEVANT_LOAD);

      const painful = groups.filter(([key]) => (byKey[key]?.pain ?? 0) >= PAIN_BLOCK);
      if (painful.length > 0) {
        blocked.push({
          name: exercise.name,
          reason: `fájdalmat jeleztél ide: ${painful.map(([key]) => MUSCLE_GROUPS[key]).join(', ')}`,
        });
        continue;
      }

      const tired = groups.filter(([key]) => (byKey[key]?.readiness ?? 100) < LOW_MUSCLE_READINESS);
      if (tired.length > 0) {
        caution.push({
          name: exercise.name,
          reason: `még nem állt helyre: ${tired.map(([key]) => MUSCLE_GROUPS[key]).join(', ')}`,
        });
      }
    }

    if (blocked.length === 0 && caution.length === 0) return null;
    return { blocked, caution };
  };
}

/* ======================================================================
   Készenlét-alapú javaslat a MAI edzésre
   ----------------------------------------------------------------------
   A terv-kártya jelzése („ma kerüld ezt") passzív: látni kell, de nem
   csinál semmit. Ez a réteg konkrét, ELFOGADHATÓ javaslatot ad a mai
   naplóra — a check-in után felugró ablakban, Elfogadom / Most nem
   gombbal.

   Amit a javaslat MÓDOSÍT, az a mai edzésnapló (a piszkozat), SOHA nem a
   terv. A terv az edzőé; ha a rendszer belenyúlna, az edző azt hinné, a
   kliens az ő tervét csinálta végig.

   Két dolgot sosem bánt:
     · a MÁR TELJESÍTETT szetteket — azok megtörténtek,
     · a nem szám súlyokat (saját testsúlyos gyakorlat) — ott nincs mit levenni.
   ====================================================================== */

/** E alatti izom-készenlétnél nagyobb levételt javaslunk. Ide már csak
    tényleges terhelés-halmozódással lehet lejutni (az izomláz önmagában
    60-ig visz), ezért indokolt a nagyobb lépés. */
const VERY_LOW_MUSCLE = 55;
const REDUCE_HARD = 0.15;
const REDUCE_SOFT = 0.1;

/** Szám → a naplóban TÁROLT szöveges alak (fölösleges tizedes nélkül, ponttal —
    a szett-mező számként olvasandó). A felületi mondatba a formatDecimal kerül. */
const weightText = (value) => String(Math.round(value * 10) / 10);

/** A mai edzésre vonatkozó javaslatok. A MAI NAPLÓ tartalmából dolgozik
    (piszkozat vagy a napra ütemezett terv) — tehát abból, amit a felhasználó
    ténylegesen csinálni fog, nem egy elvont terv-listából.

    A visszatérés { name, items }; üres items = nincs mit javasolni, és
    ilyenkor a felület fel sem dobja az ablakot. Üres naplónál a `report`
    null is lehet: a hívó ilyenkor nem számol készenlétet. */
export function sessionAdvice(template, report, catalog) {
  if (!template || !Array.isArray(template.exercises) || template.exercises.length === 0) {
    return { name: null, items: [] };
  }

  const byKey = Object.fromEntries(report.muscles.map((m) => [m.key, m]));
  const items = [];

  template.exercises.forEach((exercise, index) => {
    const pending = (exercise.sets ?? []).filter((set) => !set.done);
    if (pending.length === 0) return; // már kész — nincs mit javasolni

    const groups = Object.entries(resolveExerciseLoad(exercise.name, catalog))
      .filter(([, share]) => share >= RELEVANT_LOAD)
      .map(([key]) => byKey[key])
      .filter(Boolean);

    const painful = groups.filter((group) => (group.pain ?? 0) >= PAIN_BLOCK);
    if (painful.length > 0) {
      /* Ha már van teljesített szett, a gyakorlatot nem lehet meg nem
         történtté tenni — ilyenkor a maradék marad el ('stop'). */
      const started = pending.length < exercise.sets.length;
      items.push({
        index,
        name: exercise.name,
        action: started ? 'stop' : 'skip',
        reason: `fájdalmat jeleztél ide: ${painful.map((g) => g.label).join(', ')}`,
        detail: started
          ? `a hátralévő ${pending.length} szett kimarad`
          : 'a gyakorlat kimarad a mai naplóból',
      });
      return;
    }

    const worst = groups.slice().sort((a, b) => a.readiness - b.readiness)[0];
    if (!worst || worst.readiness >= LOW_MUSCLE_READINESS) return;

    const ratio = worst.readiness < VERY_LOW_MUSCLE ? REDUCE_HARD : REDUCE_SOFT;
    // Csak akkor van értelme javasolni, ha tényleg lejjebb tudunk menni.
    const weights = pending
      .map((set) => Number(set.weight))
      .filter((kg) => Number.isFinite(kg) && kg > 0);
    const heaviest = Math.max(0, ...weights);
    if (heaviest === 0 || reduceWeight(heaviest, ratio) === null) return;

    items.push({
      index,
      name: exercise.name,
      action: 'reduce',
      percent: Math.round(ratio * 100),
      reason: `${worst.label} még nem állt helyre (${worst.readiness}%)`,
      detail: `a legnehezebb szett ${formatDecimal(heaviest)} kg → ${formatDecimal(reduceWeight(heaviest, ratio))} kg`,
    });
  });

  return { name: template.name, items, token: adviceToken(template, items) };
}

/** A javaslat ujjlenyomata: a napló tartalma és a belőle számolt tételek.
    Az elfogadás ezt kéri vissza — ha a napló közben változott (vagy a
    javaslatot már elfogadták, és a súlyok egyszer már lejjebb mentek), a
    régi ujjlenyomat nem egyezik, és a második kattintás nem csökkent újra. */
function adviceToken(template, items) {
  return createHash('sha256')
    .update(JSON.stringify([template.name, template.exercises, items]))
    .digest('base64url')
    .slice(0, 22);
}

/** A javaslat tételei (sessionAdvice) a napló gyakorlat-listáján: a
    kihagyott gyakorlat kimarad, a leállított a teljesített szettjeire rövidül,
    a csökkentettnél a még el nem végzett szettek súlya megy lejjebb. A
    teljesített szettekhez és a nem szám súlyokhoz nem nyúl. */
export function applyAdvice(exercises, items) {
  const byIndex = new Map(items.map((item) => [item.index, item]));
  const advised = [];

  exercises.forEach((exercise, index) => {
    const advice = byIndex.get(index);
    if (!advice) {
      advised.push(exercise);
      return;
    }
    if (advice.action === 'skip') return; // kimarad a naplóból
    if (advice.action === 'stop') {
      advised.push({ ...exercise, sets: exercise.sets.filter((set) => set.done) });
      return;
    }
    const ratio = advice.percent / 100;
    advised.push({
      ...exercise,
      sets: exercise.sets.map((set) => {
        const kg = Number(set.weight);
        if (set.done || !Number.isFinite(kg) || kg <= 0) return set;
        // A könnyebb szettnél nem biztos, hogy van értelmes lépcső — az marad
        const reduced = reduceWeight(kg, ratio);
        return reduced === null ? set : { ...set, weight: weightText(reduced) };
      }),
    });
  });

  return advised;
}
