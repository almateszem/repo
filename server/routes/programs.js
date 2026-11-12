/**
 * Podium — a blokkos programok végpontjai
 * ------------------------------------------------------------------------
 * Létrehozás és szerkesztés (a programozó oldal), aktiválás a hiányzó
 * TM-ekkel, ugratás, és a szabályok TM-javaslatainak jóváhagyása. Minden
 * végpont bejelentkezést kér (a session-őr előtte fut), és csak a hívó
 * saját programjához fér hozzá: idegen vagy ismeretlen id-re 404.
 */
import {
  addProgramPlan,
  getCollection,
  getPlan,
  getProgramState,
  getTrainingMaxHistory,
  getTrainingMaxes,
  updateProgramPlan,
} from '../db.js';
import { normalizeProgram, tmExercises } from '../program/program.js';
import { defaultStep } from '../program/rules.js';
import {
  activateProgram,
  activationNeeds,
  approveReview,
  clampAfterEdit,
  decideMid,
  skipProgram,
} from '../services/program-run.js';

const NOT_FOUND = 'Nincs ilyen programod — lehet, hogy időközben törölték.';

/** A kg-térkép ({gyakorlat: kg}) beolvasása: véges szám, 0 < x ≤ 1000.
    Hiányzó térkép üres; bármely rossz érték hibát ad. */
function readKgMap(raw) {
  if (raw == null) return { value: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Érvénytelen értékek.' };
  const value = {};
  for (const [name, v] of Object.entries(raw)) {
    const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
    if (!Number.isFinite(n) || n <= 0 || n > 1000)
      return { error: `${name}: az érték 0 és 1000 kg közötti szám legyen.` };
    value[name] = n;
  }
  return { value };
}

/** A törzs { name, program } ellenőrzése. */
function readProgramBody(body) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) return { error: 'Adj nevet a programnak.' };
  const { program, error } = normalizeProgram(body?.program);
  return error ? { error } : { name, program };
}

export function register(app) {
  /** A hívó saját programja az :id alapján, vagy 404-es válasz (null). */
  const ownProgram = (req, res) => {
    const id = Number(req.params.id);
    const plan = Number.isInteger(id) && id > 0 ? getPlan(req.user.id, id) : null;
    if (!plan || plan.kind !== 'program') {
      res.status(404).json({ error: NOT_FOUND });
      return null;
    }
    return plan;
  };

  app.post('/api/programs', (req, res) => {
    const parsed = readProgramBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    res.status(201).json(addProgramPlan(req.user.id, parsed.name, req.today, parsed.program));
  });

  app.put('/api/programs/:id', (req, res) => {
    if (!ownProgram(req, res)) return;
    const parsed = readProgramBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const plan = updateProgramPlan(req.user.id, Number(req.params.id), parsed.name, parsed.program);
    clampAfterEdit(req.user.id, plan);
    res.json(plan);
  });

  app.get('/api/programs/:id', (req, res) => {
    const plan = ownProgram(req, res);
    if (!plan) return;
    const catalog = getCollection('exerciseCatalog') || [];
    res.json({
      plan,
      state: getProgramState(req.user.id, plan.id),
      trainingMaxes: getTrainingMaxes(req.user.id),
      history: getTrainingMaxHistory(req.user.id),
      defaultSteps: Object.fromEntries(
        tmExercises(plan.program).map((ex) => [ex, defaultStep(ex, { steps: {} }, catalog)]),
      ),
    });
  });

  app.get('/api/programs/:id/activation', (req, res) => {
    const plan = ownProgram(req, res);
    if (plan) res.json(activationNeeds(req.user.id, plan));
  });

  app.post('/api/programs/:id/activate', (req, res) => {
    const plan = ownProgram(req, res);
    if (!plan) return;
    const tms = readKgMap(req.body?.trainingMaxes);
    const orms = readKgMap(req.body?.oneRms);
    const bad = tms.error || orms.error;
    if (bad) return res.status(400).json({ error: bad, needs: activationNeeds(req.user.id, plan) });
    const result = activateProgram(
      req.user.id,
      plan,
      { trainingMaxes: tms.value, oneRms: orms.value },
      req.today,
    );
    if (result.error) return res.status(400).json(result);
    res.json(result);
  });

  app.post('/api/programs/:id/skip', (req, res) => {
    const plan = ownProgram(req, res);
    if (!plan) return;
    const result = skipProgram(req.user.id, plan, req.body?.to);
    if (result.error) return res.status(409).json(result);
    res.json(result);
  });

  app.get('/api/programs/:id/review', (req, res) => {
    const plan = ownProgram(req, res);
    if (!plan) return;
    const state = getProgramState(req.user.id, plan.id);
    if (!state?.pending)
      return res.status(404).json({ error: 'Nincs jóváhagyásra váró áttekintés.' });
    res.json({ suggestions: state.pending });
  });

  app.post('/api/programs/:id/review', (req, res) => {
    const plan = ownProgram(req, res);
    if (!plan) return;
    const decisions = readKgMap(req.body?.decisions);
    if (decisions.error) return res.status(400).json({ error: decisions.error });
    const result = approveReview(req.user.id, plan, decisions.value, req.today);
    if (result.error) return res.status(409).json(result);
    res.json(result);
  });

  app.post('/api/programs/:id/mid', (req, res) => {
    const plan = ownProgram(req, res);
    if (!plan) return;
    let decisions = null;
    if (req.body?.reject !== true) {
      const parsed = readKgMap(req.body?.decisions);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      decisions = parsed.value;
    }
    const result = decideMid(req.user.id, plan, decisions, req.today);
    if (result.error) return res.status(409).json(result);
    res.json(result);
  });

  app.get('/api/training-maxes', (req, res) => res.json(getTrainingMaxes(req.user.id)));
}
