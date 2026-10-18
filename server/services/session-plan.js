/**
 * Podium — a mai edzés és a készenlét
 * ------------------------------------------------------------------------
 * A mai napló sablonja (workoutTemplate), a készenléti riport, és a
 * készenlét-alapú javaslat alkalmazása (session-advice.js) — több route-fájl
 * közös szolgáltatásai.
 */
import { streakFromDates } from '../coaching.js';
import { shiftDate } from '../dates.js';
import {
  getActivePlan,
  getCheckins,
  getCollection,
  getDeclaredMaxes,
  getNutritionTotals,
  getPlanForDay,
  getWaterDay,
  getWeightLog,
  getWorkoutDraft,
  getWorkouts,
  saveWorkoutDraft,
} from '../db.js';
import { cycleDay } from '../plan-week.js';
import { computeReadiness } from '../recovery.js';
import { applyAdvice, sessionAdvice } from '../session-advice.js';

/** Az Edzés oldal induló tartalma, prioritás szerint: aznapi piszkozat →
    a mai hétnapra ütemezett terv → korábbi (nem mai) piszkozat → null
    (ilyenkor a kliens üres edzésnaplót mutat). Így éjfél után a napra
    beállított terv automatikusan az edzésnaplóba töltődik, de egy megkezdett
    mai edzést sosem ír felül. A dashboard edzésneve is ebből jön. */
export function workoutTemplate(userId, today) {
  /* A workoutId is átmegy: ha a piszkozat egy VISSZANYITOTT edzésé, akkor a
     felület újratöltés után is tudja, hogy javítás van folyamatban — különben
     a befejezés új, MAI edzést hozna létre a javítás helyett. */
  const fromDraft = (draft) => ({
    source: 'draft',
    name: draft.name,
    exercises: draft.exercises,
    planId: draft.planId,
    workoutId: draft.workoutId,
  });

  const draft = getWorkoutDraft(userId);
  if (draft && draft.date === today) return fromDraft(draft);

  const activePlan = getActivePlan(userId);
  const plan = activePlan && getPlanForDay(userId, cycleDay(activePlan, today));
  if (plan) {
    return {
      source: 'plan',
      name: plan.name,
      exercises: plan.exercises,
      planId: plan.id,
      workoutId: null,
    };
  }
  if (draft) return fromDraft(draft);
  return null;
}

/** A mai edzésre vonatkozó javaslat (session-advice.js). A készenlétet csak
    akkor számolja, ha a mai naplóban van mit átnézni. */
export function adviceFor(userId, todayDate, template = workoutTemplate(userId, todayDate)) {
  const empty = !template || !Array.isArray(template.exercises) || template.exercises.length === 0;
  return sessionAdvice(
    template,
    empty ? null : readinessReport(userId, todayDate),
    getCollection('exerciseCatalog') || [],
  );
}

/** A javaslat alkalmazása a mai naplóra.

    A javaslatokat ÚJRASZÁMOLJUK — a kliens listáját nem fogadjuk el
    bemenetként. Enélkül egy hamisított kérés tetszőleges gyakorlatot
    törölhetne a naplóból. */
export function applySessionAdvice(userId, todayDate, token) {
  const template = workoutTemplate(userId, todayDate);
  const { items, token: current } = adviceFor(userId, todayDate, template);
  if (items.length === 0) return { applied: 0 };
  if (token !== current) return { applied: 0, stale: true };

  const exercises = applyAdvice(template.exercises, items);

  /* A piszkozat DÁTUMA marad, ami volt, ha a javaslat a piszkozatból
     dolgozott — így az elfogadás nem datálja át némán egy korábbi,
     félbehagyott edzést. Ha a mai TERVBŐL (a tegnapi piszkozat helyett), akkor
     mai: a felület is a mai tervet mutatja. A workoutId is marad: egy
     javításra visszanyitott edzés különben a befejezéskor új edzés lenne. */
  const draft = getWorkoutDraft(userId);
  saveWorkoutDraft(
    userId,
    template.name,
    exercises,
    template.source === 'draft' ? draft.date : todayDate,
    template.planId ?? null,
    template.workoutId ?? null,
  );
  return { applied: items.length };
}

/** Hány napja edzel megszakítás nélkül. A mai naptól számol visszafelé; ha ma
    még nem volt edzés, tegnaptól — így a sorozat nem törik meg attól, hogy a
    mai edzés még előtted áll.
    A mentett edzéseket és a mai napot is a hívó adja át: a getWorkouts() a
    fiókok bevezetése óta kötelező `userId`-t vár, a nap pedig a KLIENS
    naptárából jön (req.today), nem a szerver helyi idejéből. */
export function trainingStreak(workouts, today) {
  return streakFromDates(
    workouts.map((workout) => workout.date),
    today,
  );
}

/** A teljes készenléti riport összeállítása. Az adatgyűjtés itt van, a
    SZÁMÍTÁS a recovery.js-ben — az a modul nem ismeri az adatbázist, ezért
    külön tesztelhető (server/recovery.test.js). */
/** A motor táplálkozási bemenete: a mai és a tegnapi összesítő, a hozzájuk
    tartozó folyadékkal (literben, a víznaplóból; kortyok nélkül null). A motor
    a tegnapi bevitelt preferálja (reggel a mai még előtted van), és a maira
    esik vissza, ha tegnapról nincs naplózás. */
export function nutritionInput(userId, todayDate) {
  const yesterday = shiftDate(todayDate, -1);
  const liters = (date) => {
    const day = getWaterDay(userId, date);
    return day.entries.length > 0 ? day.totalMl / 1000 : null;
  };
  return {
    today: getNutritionTotals(userId, todayDate),
    yesterday: getNutritionTotals(userId, yesterday),
    hydration: { today: liters(todayDate), yesterday: liters(yesterday) },
  };
}

export function readinessReport(userId, todayDate, workouts = getWorkouts(userId)) {
  return computeReadiness({
    checkins: getCheckins(userId, 60),
    workouts,
    nutrition: nutritionInput(userId, todayDate),
    weightLog: getWeightLog(userId),
    catalog: getCollection('exerciseCatalog') || [],
    // Az erőfelmérésen bemondott csúcsok: ezekből is lesz gyakorlat-ajánlás,
    // akkor is, ha a fiók még egyetlen edzést sem naplózott.
    declaredMaxes: getDeclaredMaxes(userId),
    today: todayDate,
  });
}
