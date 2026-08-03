/**
 * FitTrack Pro — Express szerver
 * ------------------------------
 * Egyetlen origin: ugyanez a szerver szolgálja ki a statikus frontendet
 * (a public/ mappából) ÉS a REST API-t (/api/*). Így nincs CORS, és egyetlen
 * `npm start` elindítja az egészet.
 *
 * Az adat a SQLite adatbázisból jön (server/db.js) — a végpontok azt olvassák/
 * írják, a frontend `api` rétege pedig ezeket a végpontokat hívja.
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getCollection, getWeightLog, getSnapshot,
  addWeightEntry, getNutritionTotals, addNutritionEntry,
  getWorkouts, addWorkout, getWorkoutDraft, saveWorkoutDraft,
  getUserPlans, addPlan, updatePlan, getPlanForDay,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public'); // a statikus frontend mappája

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // a POST/PUT végpontokhoz (JSON törzs olvasása)

/** A mai dátum HELYI idő szerint, a frontend által várt formátumban
    (pl. "2026.07.26"). Nem toISOString: az UTC-t adna, és éjfél után
    előző napi dátumot könyvelne. */
const today = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
};

/** A mai hétnap indexe, hétfőtől számolva (0 = hétfő … 6 = vasárnap). */
const todayWeekday = () => (new Date().getDay() + 6) % 7;

/** A tervek hétnap-címkéi — a kártya-metában és a kliens chipjein is ez a sorrend. */
const DAY_LABELS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

/** A beküldött hétnap-lista normalizálása: egyedi, rendezett 0–6 indexek. */
const normalizeDays = (raw) => (Array.isArray(raw) ? raw : [])
  .map(Number)
  .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  .filter((d, i, arr) => arr.indexOf(d) === i)
  .sort((a, b) => a - b);

/* ======================================================================
   API — az adat-seam szerver-oldali vége.
   A frontend `api.getX()` metódusai ezeket a végpontokat hívják. Az olvasó-
   végpontok egy-egy collections-kulcsot adnak vissza; az útvonal → kulcs
   megfeleltetés egy helyen, hogy a lista könnyen bővíthető legyen.
   (A weight-log NEM itt van: saját táblából, dedikált route-tal jön.)
   ====================================================================== */
const READ_ENDPOINTS = {
  '/api/user': 'user',
  '/api/foods': 'foods',
  '/api/athletes': 'athletes',
  '/api/notifications': 'notifications',
  '/api/default-set': 'defaultSet',
  '/api/exercise-catalog': 'exerciseCatalog',
  '/api/athlete-replies': 'athleteReplies',
  '/api/coach-notes': 'coachNotes',
  '/api/coach-replies': 'coachReplies',
};

for (const [route, key] of Object.entries(READ_ENDPOINTS)) {
  app.get(route, (req, res) => res.json(getCollection(key)));
}

/** Az Edzés oldal induló tartalma, prioritás szerint: aznapi piszkozat →
    a mai hétnapra ütemezett terv → korábbi (nem mai) piszkozat → null
    (ilyenkor a kliens üres edzésnaplót mutat). Így éjfél után a napra
    beállított terv automatikusan az edzésnaplóba töltődik, de egy megkezdett
    mai edzést sosem ír felül. A dashboard edzésneve is ebből jön. */
function workoutTemplate() {
  const draft = getWorkoutDraft();
  if (draft && draft.date === today()) {
    return { source: 'draft', name: draft.name, exercises: draft.exercises };
  }
  const plan = getPlanForDay(todayWeekday());
  if (plan) {
    return { source: 'plan', name: plan.name, exercises: plan.exercises };
  }
  if (draft) {
    return { source: 'draft', name: draft.name, exercises: draft.exercises };
  }
  return null;
}

// Áttekintő — a napi kalória/fehérje statot a táplálkozási naplóból számoljuk,
// hogy a dashboard és a Táplálkozás oldal ugyanazt az adatot mutassa; az
// aktuális edzésnév az edzésnapló induló tartalmából jön (vagy null).
app.get('/api/dashboard', (req, res) => {
  const dashboard = getCollection('dashboard');
  const totals = getNutritionTotals(today());
  dashboard.dailyStats = {
    calories: Math.round(totals.intake),
    caloriesTarget: totals.goal.calories,
    protein: Math.round(totals.protein),
  };
  dashboard.workoutName = workoutTemplate()?.name?.trim() || null;
  res.json(dashboard);
});

// Tervek — a felhasználó saját (terv-építőben mentett) tervei, legújabb elöl.
// A kártya-alak (name/meta/progress) itt áll össze egy helyen; az id/exercises/
// days a kliens szerkesztő-gombjához kell. A progress a MAI teljesítést méri:
// a terv nevével ma mentett edzés = 100%, különben — ha a terv épp az edzés-
// naplóban van (aznapi piszkozat) — a pipált szettek aránya; máskülönben 0.
app.get('/api/plans', (req, res) => {
  const todayDate = today();
  const draft = getWorkoutDraft();
  const savedToday = new Set(
    getWorkouts().filter((w) => w.date === todayDate).map((w) => w.name),
  );
  const progressFor = (plan) => {
    if (savedToday.has(plan.name)) return 100;
    if (draft && draft.date === todayDate && draft.name === plan.name) {
      const sets = draft.exercises.flatMap((exercise) => exercise.sets);
      const done = sets.filter((set) => set.done).length;
      return sets.length ? Math.round((done / sets.length) * 100) : 0;
    }
    return 0;
  };
  res.json(getUserPlans().map((plan) => {
    const daysLabel = plan.days.length
      ? ` · ${plan.days.map((d) => DAY_LABELS[d]).join(', ')}`
      : '';
    return {
      id: plan.id,
      name: plan.name,
      meta: `Saját terv · ${plan.exercises.length} gyakorlat${daysLabel}`,
      progress: progressFor(plan),
      own: true,
      exercises: plan.exercises,
      days: plan.days,
    };
  }));
});

app.get('/api/workout-template', (req, res) => res.json(workoutTemplate()));

// Korábbi rekordok — a mentett edzések PR-ral megjelölt gyakorlataiból
// (legújabb elöl). A detail az első teljesített (vagy első) szett összegzése.
app.get('/api/prs', (req, res) => {
  const prs = [];
  for (const workout of getWorkouts()) {
    for (const exercise of workout.exercises) {
      if (!exercise.pr) continue;
      const set = exercise.sets.find((s) => s.done) || exercise.sets[0];
      prs.push({
        exercise: exercise.name,
        detail: set ? `${set.reps} @ ${set.weight}` : workout.name,
        date: workout.date,
      });
    }
  }
  res.json(prs.slice(0, 6));
});

/** "ÉÉÉÉ.HH.NN" → helyi Date (a mentett edzések dátum-formátuma). */
const parseDate = (str) => {
  const [year, month, day] = str.split('.').map(Number);
  return new Date(year, month - 1, day);
};

/** Az adott nap hetének hétfője, helyi éjfélre normalizálva (timestamp). */
const mondayOf = (date) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

/** Heti volumen-összehasonlítás a mentett edzésekből: teljesített szettek
    naponta, erre és a múlt hétre. A két hét közös skálán van, hogy a
    váltógombbal az oszlopok összevethetők legyenek. */
function volumeCharts() {
  const thisMonday = mondayOf(new Date());
  const lastMonday = thisMonday - 7 * 24 * 60 * 60 * 1000;
  const thisWeek = Array(7).fill(0);
  const lastWeek = Array(7).fill(0);

  for (const workout of getWorkouts()) {
    const date = parseDate(workout.date);
    const monday = mondayOf(date);
    const bucket = monday === thisMonday ? thisWeek : monday === lastMonday ? lastWeek : null;
    if (!bucket) continue;
    bucket[(date.getDay() + 6) % 7] += workout.exercises
      .flatMap((exercise) => exercise.sets)
      .filter((set) => set.done).length;
  }

  const scale = Math.max(4, Math.ceil(Math.max(...thisWeek, ...lastWeek) / 4) * 4);
  const axis = [scale, (scale / 4) * 3, scale / 2, scale / 4].map(String);
  const heights = (week) => week.map((count) => Math.max(4, Math.round((count / scale) * 100)));
  const totalThis = thisWeek.reduce((a, b) => a + b, 0);
  const totalLast = lastWeek.reduce((a, b) => a + b, 0);
  const delta = totalThis - totalLast;

  return {
    volumeThisWeek: {
      heights: heights(thisWeek),
      axis,
      total: totalThis,
      note: delta === 0
        ? 'ugyanannyi, mint a múlt héten'
        : `${delta > 0 ? '+' : ''}${delta} szett a múlt héthez képest`,
      ariaLabel: 'Teljesített szettek naponta — ez a hét',
    },
    volumeLastWeek: {
      heights: heights(lastWeek),
      axis,
      total: totalLast,
      note: 'a múlt hét összes teljesített szettje',
      ariaLabel: 'Teljesített szettek naponta — múlt hét',
    },
  };
}

// Chartok — a seed-görbék mellé a szerver számolja a heti volumen-
// összehasonlítást a mentett edzésekből.
app.get('/api/charts', (req, res) => res.json({ ...getCollection('charts'), ...volumeCharts() }));

// Testsúly-napló — a valódi weight_log táblából
app.get('/api/weight-log', (req, res) => res.json(getWeightLog()));

// Napi táplálkozási összesítő (alap + a MAI naplózott ételek)
app.get('/api/nutrition', (req, res) => res.json(getNutritionTotals(today())));

// Mentett edzések (legújabb elöl)
app.get('/api/workouts', (req, res) => res.json(getWorkouts()));

// Az épp szerkesztett edzés piszkozata ({ name, exercises }) vagy null
app.get('/api/workout-draft', (req, res) => res.json(getWorkoutDraft()));

// Teljes adat-pillanatkép — a beállítások „Adatok exportálása" gombjához
app.get('/api/export', (req, res) => res.json(getSnapshot()));

/* ======================================================================
   Write-végpontok (POST) — a SQLite adatbázist módosítják (perzisztens).
   ====================================================================== */

/** Új testsúly-bejegyzés. Törzs: { kg }. A dátumot a szerver adja. */
app.post('/api/weight-log', (req, res) => {
  const kg = Number(req.body?.kg);
  if (!Number.isFinite(kg) || kg < 30 || kg > 300) {
    return res.status(400).json({ error: 'Érvénytelen testsúly — 30 és 300 kg között adható meg.' });
  }
  res.status(201).json(addWeightEntry(kg, today()));
});

/** Étel naplózása. Törzs: { name }. A szerver a foods-ból keresi ki a makrókat
    (a kliens értékeiben nem bízunk), és a frissített napi összesítőt adja vissza. */
app.post('/api/nutrition/log', (req, res) => {
  const name = String(req.body?.name ?? '');
  const food = (getCollection('foods') || []).find((f) => f.name === name);
  if (!food) {
    return res.status(400).json({ error: 'Ismeretlen étel — csak a listában szereplő adható a naplóhoz.' });
  }
  res.status(201).json(addNutritionEntry(food, today()));
});

/** A beküldött gyakorlat-lista mezőnkénti normalizálása. A kliens a DOM-ból
    olvassa az értékeket, ezért itt kényszerítjük ki az elvárt alakot;
    érvénytelen szerkezetre null-t ad (→ 400-as válasz). */
function normalizeExercises(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const exercises = [];
  for (const entry of raw) {
    const name = String(entry?.name ?? '').trim().slice(0, 60);
    if (!name || !Array.isArray(entry?.sets)) return null;
    exercises.push({
      name,
      pr: Boolean(entry.pr),
      sets: entry.sets.map((set) => ({
        reps: String(set?.reps ?? '').slice(0, 20),
        weight: String(set?.weight ?? '').slice(0, 20),
        rpe: String(set?.rpe ?? '').slice(0, 10),
        done: Boolean(set?.done),
      })),
    });
  }
  return exercises;
}

/** A terv-törzs (name/exercises/days) közös validálása. Hibánál { error }-t ad. */
function parsePlanBody(body) {
  const name = String(body?.name ?? '').trim();
  if (!name || name.length > 60) {
    return { error: 'A terv neve kötelező (legfeljebb 60 karakter).' };
  }
  const exercises = normalizeExercises(body?.exercises);
  if (!exercises) {
    return { error: 'A tervnek legalább egy érvényes gyakorlatot kell tartalmaznia.' };
  }
  return { name, exercises, days: normalizeDays(body?.days) };
}

/** Edzésterv mentése (terv-építő). Törzs: { name, exercises, days }. A dátumot a szerver adja. */
app.post('/api/plans', (req, res) => {
  const plan = parsePlanBody(req.body);
  if (plan.error) return res.status(400).json({ error: plan.error });
  res.status(201).json(addPlan(plan.name, today(), plan.exercises, plan.days));
});

/** Meglévő terv szerkesztése. Törzs: { name, exercises, days }. */
app.put('/api/plans/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Érvénytelen terv-azonosító.' });
  const plan = parsePlanBody(req.body);
  if (plan.error) return res.status(400).json({ error: plan.error });
  const updated = updatePlan(id, plan.name, plan.exercises, plan.days);
  if (!updated) return res.status(404).json({ error: 'Nincs ilyen terv — lehet, hogy időközben törölték.' });
  res.json(updated);
});

/** Edzés mentése. Törzs: { name, exercises }. A dátumot a szerver adja. */
app.post('/api/workouts', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 60) {
    return res.status(400).json({ error: 'Az edzés neve kötelező (legfeljebb 60 karakter).' });
  }
  const exercises = normalizeExercises(req.body?.exercises);
  if (!exercises) {
    return res.status(400).json({ error: 'Az edzésnek legalább egy érvényes gyakorlatot kell tartalmaznia.' });
  }
  res.status(201).json(addWorkout(name, today(), exercises));
});

/** Piszkozat automatikus mentése minden változtatáskor. Törzs: { name, exercises }.
    A végleges mentéssel szemben a név itt üres is lehet (még nem kötelező),
    és az üres gyakorlatlista is érvényes. */
app.put('/api/workout-draft', (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  const raw = req.body?.exercises;
  const exercises = Array.isArray(raw) && raw.length === 0 ? [] : normalizeExercises(raw);
  if (!exercises) {
    return res.status(400).json({ error: 'Érvénytelen piszkozat-szerkezet.' });
  }
  res.json(saveWorkoutDraft(name, exercises, today()));
});

/* ======================================================================
   Statikus frontend — az API-útvonalak UTÁN, kizárólag a public/ mappából.
   A szerver-belső (kód, DB-fájl, node_modules) így eleve nem érhető el
   http-n, nem kell hozzá tiltólista.
   ====================================================================== */
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`FitTrack Pro szerver fut: http://localhost:${PORT}`);
});
