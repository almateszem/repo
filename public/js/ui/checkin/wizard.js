/**
 * A napi check-in varázsló.
 *
 * Ez a modul a VÁZ: a lépések sorrendje, a fejléc, a mentés és a betöltés.
 * Maguk a lépések a steps/ alatt élnek, egy-egy fájlban — mindegyik egy DOM-
 * csomópontot ad vissza, és a navigációt egyetlen `nav` objektumon át éri el.
 * Így a lépés nem ismeri a varázsló belsejét, a varázsló pedig nem ismeri a
 * lépések markupját.
 */

import { api } from '../../core/api.js';
import { onDayChange } from '../../core/day.js';
import { $, prefersReducedMotion } from '../../core/dom.js';
import { hooks, shared } from '../../core/page-hooks.js';
import { showToast } from '../../core/toast.js';
import { setOnboardingLock } from '../../nav/router.js';
import { renderDashboard } from '../../render/dashboard.js';
import { handleStepClick } from '../../render/sets.js';
import { ciPickPositive } from './helpers.js';
import { ci, ciCountedSteps, ciStepOrder, clearSession, resetSession } from './session.js';
import { mergeWeightEntry, refreshWeightLog, todayWeightEntry } from '../weight.js';
import { renderIntro } from './steps/intro.js';
import { renderSleep } from './steps/sleep.js';
import { renderScale } from './steps/scale.js';
import { renderWeight } from './steps/weight.js';
import { renderGate } from './steps/gate.js';
import { renderMap } from './steps/map.js';
import { renderReadiness, renderSummary } from './steps/summary.js';

async function setupCheckinWizard() {
const page = $('[data-page="checkin"]');
if (!page) return;

const head = $('[data-ci-head]', page);
const body = $('[data-ci-body]', page);
const progress = $('[data-ci-progress]', page);
const stepLabel = $('[data-ci-step-label]', page);
const announce = $('[data-ci-announce]', page);

let advanceTimer = null;

const cancelAdvance = () => { clearTimeout(advanceTimer); advanceTimer = null; };

/** Automatikus továbblépés koppintás után. A hívók billentyűs aktiválásnál
    (event.detail === 0) NEM hívják: a fókusz elrántása döntés közben rossz
    élmény, ott a „Tovább" gomb a kiút. Csökkentett mozgás mellett nincs
    várakozás — az animált átmenet úgyis el van némítva. */
function advanceSoon(delay) {
  cancelAdvance();
  if (prefersReducedMotion) { goNext(); return; }
  advanceTimer = setTimeout(goNext, delay);
}

function setStep(name) {
  cancelAdvance();
  ci.step = name;
  renderStep();
}

function goNext() {
  const order = ciStepOrder();
  const index = order.indexOf(ci.step);
  setStep(order[Math.min(index + 1, order.length - 1)]);
}

function goBack() {
  const order = ciStepOrder();
  const index = order.indexOf(ci.step);
  setStep(order[Math.max(index - 1, 0)]);
}

/* ---- Fejléc ---- */

function syncHead() {
  const counted = ciCountedSteps();
  const index = counted.indexOf(ci.step);
  const total = counted.length;
  head.hidden = ci.step === 'intro';

  const percent = index >= 0 ? ((index + 1) / total) * 100 : (ci.step === 'summary' ? 100 : 0);
  progress.style.width = percent + '%';
  stepLabel.textContent = index >= 0 ? `${index + 1}/${total}` : '';
  // A sáv és a „3/6" aria-hidden — a lépésszám itt hangzik el, egyszer.
  announce.textContent = index >= 0 ? `${index + 1}. lépés a ${total}-ből` : '';
}

/* ---- Lépés-renderelés ---- */

function renderStep() {
  const step = RENDERERS[ci.step]?.();
  if (!step) return;
  body.replaceChildren(step);
  // A data-step újraírása indítja újra a belépő animációt.
  body.dataset.step = ci.step;
  syncHead();

  const heading = $('h2', body);
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

  /* A lépések felé mutató felület. Egyetlen objektum, hogy a lépés-modulok
     szerződése egy helyen látszódjon — és hogy ne kelljen hét paramétert
     végigfűzni rajtuk. */
  const nav = { goNext, goBack, setStep, renderStep, advanceSoon, cancelAdvance, submit };

  /** Lépésnév → renderelő. A renderelők a steps/ alatt élnek. */
  const RENDERERS = {
    intro: () => renderIntro(nav),
    sleep: () => renderSleep(nav),
    sleepq: () => renderScale('sleepq', nav),
    energy: () => renderScale('energy', nav),
    stress: () => renderScale('stress', nav),
    weight: () => renderWeight(nav),
    soreGate: () => renderGate('soreGate', nav),
    painGate: () => renderGate('painGate', nav),
    soreness: () => renderMap('soreness', nav),
    painMap: () => renderMap('painMap', nav),
    summary: () => renderSummary(nav),
  };

/* ---- Mentés ---- */

/**
 * A PUT /api/checkin törzse. Lásd a `carried` kommentjét: a végpont teljes
 * sort cserél, ezért MINDEN mező szerepel — a nem kérdezettek változatlanul.
 */
function buildBody() {
  const { answers, carried } = ci;
  return {
    sleepHours: answers.sleepHours,
    sleepQuality: answers.sleepQuality,
    energy: answers.energy,
    stress: answers.stress,
    // Az izomláz és a fájdalom teljes cseréje SZÁNDÉKOS: a „nincs
    // izomlázam" válasznak törölnie kell tudnia a korábbi értékeket.
    soreness: { ...answers.soreness },
    pain: {
      ...answers.pain,
      ...(carried.painGeneral !== null ? { general: carried.painGeneral } : {}),
    },
    mood: carried.mood,           // nem kérdezzük — vissza, különben NULL lesz
    hydration: carried.hydration, // ugyanígy
    // A testsúly nem a check-in sorba megy: a szerver a weight_log-ba
    // írja, naponta egy bejegyzésbe (felülír, nem duplikál). A null azt
    // jelenti, hogy ma nem mértél — ilyenkor a napló érintetlen marad.
    weightKg: answers.weightKg,
  };
}

async function submit(btn, step) {
  btn.disabled = true;
  try {
    const { checkin, weightEntry, readiness } = await api.saveCheckin(buildBody());
    mergeWeightEntry(weightEntry); // trend-diagram (Regeneráció) + Δ stat
    ci.readiness = readiness;
    ci.saved = true;
    ci.dirty = false;
    ci.hadCheckin = true;

    /* Az első check-in megvan — az app kinyílik. Navigálni NEM kell: a
       felhasználó az összegzésen marad, és itt látja meg az első valódi
       készenléti pontszámát. */
    if (shared.onboardingLock) setOnboardingLock(false);

    // A Regeneráció oldal és az áttekintő ugyanebből a motorból él
    hooks.applyCheckinSaved?.(checkin, readiness);
    renderDashboard().catch((err) => console.error('Áttekintő frissítési hiba:', err));

    renderReadiness(step, readiness.overall, { animate: true });
    btn.hidden = true;
    $('[data-ci-saved]', step).hidden = false;
    $('[data-ci-done-link]', step).hidden = false;
    showToast('Check-in mentve');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Nem sikerült menteni a check-int', 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ---- Betöltés ---- */

/**
 * A mai állapot beolvasása. Egyetlen kérés elég: a riport az `overall`
 * mellett a check-in nyers értékeit is visszaadja (`checkin.values`).
 * `fresh` esetén a válaszok is felülíródnak; egyébként CSAK a hordozott
 * mezők frissülnek, hogy a félbehagyott kitöltés ne vesszen el.
 */
async function load({ fresh }) {
  // A testsúly-napló is kell: ebből tölti a testsúly-lépés a viszonyítási
  // mérést, és ebből derül ki, ma volt-e már mérés.
  const [report] = await Promise.all([api.getReadiness(), refreshWeightLog()]);
  const checkin = report.checkin.values;

  ci.readiness = report;
  ci.hadCheckin = report.checkin.present;
  ci.carried = {
    mood: checkin?.mood ?? null,
    hydration: checkin?.hydration ?? null,
    painGeneral: checkin?.pain?.general ?? null,
  };
  if (!fresh) return;

  ci.answers = {
    sleepHours: checkin?.sleepHours ?? null,
    sleepQuality: checkin?.sleepQuality ?? null,
    energy: checkin?.energy ?? null,
    stress: checkin?.stress ?? null,
    // A testsúly a naplóból jön (nem a check-in sorból): ha ma már mértél,
    // azt az értéket szerkeszted tovább, különben üresen indul.
    weightKg: todayWeightEntry()?.kg ?? null,
    soreness: ciPickPositive(checkin?.soreness),
    pain: ciPickPositive(checkin?.pain, 'general'),
  };
  // A kapukat a betöltött térképekből VEZETJÜK LE — ettől lép a vissza
  // gomb a kitöltött összegzésről a helyes lépésekre.
  ci.gates = {
    sore: !checkin ? null : Object.keys(ci.answers.soreness).length ? 'yes' : 'no',
    pain: !checkin ? null : Object.keys(ci.answers.pain).length ? 'yes' : 'no',
  };
  ci.dirty = false;
  ci.saved = false;
  ci.loaded = true;
  ci.mapView = 'front';
  // Ha ma már van check-in, egyből az összegzés — onnan a vissza gombbal
  // bármelyik lépés módosítható.
  ci.step = ci.hadCheckin ? 'summary' : 'intro';
}

/** Az oldal megnyitásakor fut. Új munkamenetet kezd, ha még nem töltöttünk
    be (ide tartozik a setup-időben előre rajzolt intro is), ha közben napot
    váltottunk, vagy ha az előzőt már elmentettük. Egyébként megőrzi a
    félbehagyott kitöltés helyét, és csak a hordozott mezőket frissíti. */
hooks.refreshCheckinWizard = async () => {
  const today = new Date().toDateString();
  const fresh = !ci.loaded || ci.sessionDate !== today || ci.saved;
  if (fresh) resetSession(today);
  await load({ fresh });
  renderStep();
};

page.addEventListener('click', (event) => {
  // A ± léptetők (alvás, testsúly) a megosztott primitívre épülnek: a
  // min/max/step a mezőről jön, a lépés `input` eseményt vált ki, amire a
  // lépés saját kezelője beírja a választ. Delegálva, mert a lépések
  // renderelésenként újraépülnek.
  if (handleStepClick(event)) return;
  if (event.target.closest('[data-action="checkin-back"]')) goBack();
});

// Az intro már setup-időben felkerül: a showPage a pageEffects ELŐTT
// fókuszálja a lap első h2-jét, tehát az első megnyitáskor már kell lennie
// renderelt lépésnek.
resetSession(new Date().toDateString());
renderStep();

// Napváltáskor a következő megnyitás tiszta lappal indul.
onDayChange(clearSession);
}

export { setupCheckinWizard };
