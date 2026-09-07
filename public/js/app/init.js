/** Indítás: a vezérlők felépítése és összekötése, belépési kapu. */

import { api } from '../core/api.js';
import { DIR_TO_PAGE } from '../core/constants.js';
import { onDayChange, startDayWatcher } from '../core/day.js';
import { $, $$ } from '../core/dom.js';
import { hooks, shared } from '../core/page-hooks.js';
import { showToast } from '../core/toast.js';
import { setupNavRing } from '../nav/navring.js';
import { navigate, setOnboardingLock, setupRouter } from '../nav/router.js';
import { refreshDailyStats, renderCharts, renderDashboard, renderUserName } from '../render/dashboard.js';
import { renderFoods } from '../render/foods.js';
import { renderPlans } from '../render/plans.js';
import { renderPrs } from '../render/prs.js';
import { renderWorkout } from '../render/workout.js';
import { setupCheckinWizard } from '../ui/checkin/wizard.js';
import { setupAthleteModal, setupCoachPage } from '../ui/coach.js';
import { setupConnectivity } from '../ui/connectivity.js';
import { setupCustomFood } from '../ui/custom-food.js';
import { setupDashboard } from '../ui/dashboard.js';
import { setupExercisePicker } from '../ui/exercise-picker.js';
import { setupFoodDetail } from '../ui/food-detail.js';
import { setupAdviceModal, setupConfirmDialog, setupPrModal, setupVideoModal } from '../ui/modals.js';
import { setupNotifications } from '../ui/notifications.js';
import { setupNutrition } from '../ui/nutrition.js';
import { setupPlanBuilder } from '../ui/plan-builder.js';
import { setupPlans } from '../ui/plans.js';
import { setupProfile } from '../ui/profile.js';
import { setupRecovery } from '../ui/recovery.js';
import { setupScanner } from '../ui/scanner.js';
import { setupSettingsModal } from '../ui/settings.js';
import { setupShortcuts } from '../ui/shortcuts.js';
import { setupSummary, setupWeeklyCompare } from '../ui/summary.js';
import { refreshWeightLog } from '../ui/weight.js';
import { setupWorkout } from '../ui/workout.js';

/* ======================================================================
   8. Init
   ====================================================================== */
async function init() {
  // Egy init-lépés hibája (pl. egy végpont nem válaszol) ne vigye el a
  // többit: naplózzuk, a hibás szekció üresen marad, a többi működik.
  let hadError = false;
  const safe = (task) => Promise.resolve()
    .then(task)
    .catch((err) => {
      hadError = true;
      console.error('Betöltési hiba:', err);
      return null;
    });

  // Kezdeti tartalom betöltése — a renderelők az api-n keresztül kérnek
  // adatot a backendtől. Párhuzamosan, mert függetlenek.
  await Promise.all([
    safe(renderCharts),
    safe(renderDashboard),
    safe(renderUserName),
    safe(renderWorkout),
    safe(renderPrs),
    safe(renderFoods),
    safe(renderPlans),
  ]);

  // Megerősítő ablak — szinkron felépítésű, mert több setup is erre épül
  const confirmAction = setupConfirmDialog();
  /* A készenlét-javaslat ablaka. A setupRecovery ELŐTT kell felépülnie:
     a check-in mentése onnan hívja a maybeShow-t. */
  hooks.adviceModal = setupAdviceModal();

  /* Az Edző oldal a router ELŐTT épül fel, hogy az induló oldal effektjei
     (pl. a kártya-pontszámok animációja) már a jó nézetet lássák. A
     részletmodál előbb kell nála: a kártyák azt nyitják, a modálból indított
     kapcsolat-bontás pedig visszafelé frissíti az oldalt. */
  let coachPage = null;
  const athleteModal = await safe(() => setupAthleteModal({
    confirmAction,
    onUnlink: () => coachPage?.refresh(),
    // A modálban elolvasott üzenetek után a kártya és a nézetváltó jelvénye
    // is elavult — a panel újratöltése hozza helyre.
    onRead: () => coachPage?.refresh(),
    // Kiosztás után szintén: az értesítés-panel és a kártyák is változhatnak
    onAssign: () => coachPage?.refresh(),
  }));
  coachPage = await safe(() => setupCoachPage(athleteModal, confirmAction));
  /* Az oldalra lépéskor futó frissítés hibáját itt nyeljük el: a korábbi
     tartalom marad a képernyőn, és a következő megnyitás újrapróbálja —
     egy pillanatnyi hálózati hiba miatt nem üresedhet ki az oldal. */
  hooks.refreshCoachPage = () => coachPage?.refresh({ animate: true })
    .catch((err) => console.error('Edző oldal frissítési hiba:', err));

  setupRouter();

  const videoModal = setupVideoModal();
  const prModal = setupPrModal();
  const notifPanel = await safe(setupNotifications);
  const settingsModal = await safe(() => setupSettingsModal({
    onNotifCatsChange: () => notifPanel?.updateBadge(),
    confirmAction,
  }));
  setupDashboard(settingsModal);
  // A setupDashboard UTÁN: a profiloldal „Beállítások" gombját is az köti be
  // (minden [data-action="settings"] elemre), a tartalmat pedig a
  // pageEffects tölti fel az oldal első megnyitásakor.
  await safe(setupProfile);
  // A testsúly-napló a Regeneráció oldal trend-kártyáját és az áttekintő Δ
  // statját tölti — a setupRecovery ELŐTT, mert az a mai bejegyzésből tölti
  // a részletes űrlap testsúly-mezőjét.
  await safe(refreshWeightLog);
  await safe(setupRecovery);
  // A setupRecovery UTÁN: a varázsló mentése az ott beállított
  // applyCheckinSaved-en keresztül frissíti a Regeneráció oldalt.
  await safe(setupCheckinWizard);
  /* Onboarding: a setupRouter (ami ELŐBB fut) már a check-inre navigált, de
     a `pageEffects.checkin` akkor még egy null frissítőt talált — a lap a
     setup-időben rajzolt introt mutatja, szerver-állapot nélkül. Itt pótoljuk. */
  if (shared.onboardingLock) await safe(hooks.refreshCheckinWizard);
  // A közös gyakorlat-választó — az edzésnapló és a terv-építő is ezt célozza át
  const picker = await safe(() => setupExercisePicker(confirmAction));
  const workout = await safe(() => setupWorkout(videoModal, prModal, picker, confirmAction));
  // A javaslat elfogadása a szerveren írja át a piszkozatot — a naplót
  // utána újra kell tölteni, ezért kell a modálnak az edzés vezérlője.
  hooks.adviceModal.attachWorkout(workout);
  await safe(setupWeeklyCompare);
  // Az étel-modál és a Táplálkozás oldal kölcsönösen hivatkoznak egymásra
  // (a nyíl nyitja a modált, a modál naplóz az oldal állapotán keresztül),
  // ezért a naplózó függvény a felépült oldalról kerül be utólag.
  let nutrition = null;
  const foodDetail = setupFoodDetail({
    onAdd: (food, grams) => nutrition.logFood(food, grams),
  });
  nutrition = await safe(() => setupNutrition(foodDetail));

  /* Saját étel + vonalkód-olvasó. A szkenner szinkron épül fel (nem kér
     adatot); a saját-étel modál viszont a felépült Táplálkozás oldalra
     támaszkodik: onnan frissíti a listát, és onnan nyitja az adagválasztót.
     Ha a setupNutrition elbukott (safe → null), a gombok nem szállnak el —
     az opcionális láncolás miatt csendben nem csinálnak semmit. */
  const scanner = setupScanner();
  await safe(() => setupCustomFood({
    scanner,
    confirmAction,
    onSaved: () => nutrition?.refreshFoods(),
    onLog: (food) => nutrition?.openFoodDetail(food),
  }));

  const planBuilder = await safe(() => setupPlanBuilder(picker));
  setupPlans(planBuilder, workout, confirmAction);
  setupSummary();
  setupShortcuts();
  setupConnectivity();

  setupNavRing($('#navKnob'), (dir) => navigate(DIR_TO_PAGE[dir] ?? 'dashboard'));

  // Napváltás-figyelő: éjfél után az áttekintő napi statjai nullázódnak, és
  // a check-in emlékeztető is visszatér — az új napra még nincs check-in.
  // (A táplálkozás-oldali frissítő a setupNutrition-ben iratkozik fel.)
  onDayChange(refreshDailyStats);
  startDayWatcher();

  if (hadError) {
    showToast('Nem minden adat töltődött be — próbáld frissíteni az oldalt', 'error');
  }
}

/* ======================================================================
   Belépő képernyő (au-*)
   Az app előtt áll: amíg nincs érvényes munkamenet, a szerver minden
   /api/* végponton 401-et ad, tehát nincs mit renderelni mögötte. Ezért
   nem modál — nem lehet bezárni, nincs háttér-átkattintás.
   ====================================================================== */
function setupAuthGate() {
  const screen = $('#authScreen');
  const form = $('[data-form="auth"]');
  const titleEl = $('#authTitle');
  const leadEl = $('[data-au-lead]');
  const errorEl = $('[data-au-error]');
  const submitBtn = $('[data-au-submit]');
  const switchBtn = $('[data-au-switch]');
  const switchTextEl = $('[data-au-switch-text]');
  const passwordInput = $('#au-password');

  let mode = 'login';   // 'login' | 'register'
  let onSuccess = null; // a sikeres belépés után futtatandó lépés

  const MODES = {
    login: {
      title: 'Belépés',
      lead: 'Jelentkezz be a saját edzésnaplódhoz.',
      submit: 'Belépés',
      switchText: 'Még nincs fiókod?',
      switchLabel: 'Regisztráció',
      autocomplete: 'current-password',
    },
    register: {
      title: 'Regisztráció',
      lead: 'Hozz létre egy fiókot — az adataid csak hozzád tartoznak.',
      submit: 'Fiók létrehozása',
      switchText: 'Van már fiókod?',
      switchLabel: 'Belépés',
      autocomplete: 'new-password',
    },
  };

  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  };

  const applyMode = () => {
    const config = MODES[mode];
    titleEl.textContent = config.title;
    leadEl.textContent = config.lead;
    submitBtn.textContent = config.submit;
    switchTextEl.textContent = config.switchText;
    switchBtn.textContent = config.switchLabel;
    passwordInput.autocomplete = config.autocomplete;
    $$('[data-au-only="register"]').forEach((el) => { el.hidden = mode !== 'register'; });
    showError('');
  };

  switchBtn.addEventListener('click', () => {
    mode = mode === 'login' ? 'register' : 'login';
    applyMode();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#au-username').value.trim();
    const password = passwordInput.value;
    const displayName = $('#au-display-name').value.trim();

    showError('');
    submitBtn.disabled = true;
    try {
      /* A válasz `onboarding` mezője dönti el, kell-e első check-in. A
         belépés is hozza — így az a fiók is a varázslóra kerül, amelyik
         regisztrált, de a check-int félbehagyta és később lépett vissza. */
      const account = mode === 'register'
        ? await api.register(username, displayName, password)
        : await api.login(username, password);
      setOnboardingLock(Boolean(account?.onboarding));

      form.reset();
      screen.hidden = true;
      screen.setAttribute('aria-hidden', 'true');
      onSuccess?.();
    } catch (err) {
      showError(err.message);
      passwordInput.focus();
      passwordInput.select();
    } finally {
      submitBtn.disabled = false;
    }
  });

  /** A képernyő megnyitása. `firstRun` esetén rögtön a regisztráció látszik
      (még egyetlen fiók sincs), `next` pedig a siker utáni lépés. */
  const open = ({ firstRun = false, next = null, message = '' } = {}) => {
    mode = firstRun ? 'register' : 'login';
    onSuccess = next;
    applyMode();
    if (message) showError(message);
    screen.hidden = false;
    screen.setAttribute('aria-hidden', 'false');
    $('#au-username').focus();
  };

  return { open, isOpen: () => !screen.hidden };
}

export { init, setupAuthGate };
