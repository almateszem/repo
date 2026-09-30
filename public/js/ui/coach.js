/** Edző oldal: edzői panel (KPI-k, sportoló-lista), sportoló-részletnézet, meghívók. */

import { api } from '../core/api.js';
import { $, $$ } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { shared } from '../core/page-hooks.js';
import { prefs } from '../core/prefs.js';
import { showToast } from '../core/toast.js';
import { animateCoachRatings } from '../nav/router.js';
import {
  athleteTier,
  renderAthleteList,
  renderCoachPanel,
  renderStatList,
} from '../render/coach.js';
import { renderPlans } from '../render/plans.js';
import { createChatController, relativeTime } from './chat.js';
import { setupClientView } from './coach-client.js';
import { setupCoachMeals } from './coach-meals.js';

const DETAIL_TABS = ['overview', 'nutrition', 'plan', 'messages'];

/** Sportoló részletnézet az Edzői panelen, a sportoló-lista HELYÉN: a saját
    naplójából számolt összegzés, napi cél, terv-kiosztás, valódi
    üzenetváltás és a kapcsolat bontása — belső fülekre bontva. Az `onUnlink`
    az Edző oldalt frissíti, miután a sportoló lekerült a panelről. */
function setupAthleteDetail({ confirmAction, onUnlink, onRead, onAssign } = {}) {
  const page = $('[data-page="coach"]');
  const managerView = $('[data-view="manager"]', page);
  const root = $('[data-athlete-detail]', page);
  const listEl = $('.co-list', managerView);
  const badge = $('.co-modal-badge', root);
  const titleEl = $('#co-detail-title');
  const tierEl = $('.co-modal-tier', root);
  const alertEl = $('[data-modal-alert]', root);
  const statsEl = $('[data-modal-stats]', root);
  const notesEl = $('[data-modal-notes]', root);
  const noteListEl = $('[data-modal-note-list]', root);
  const feedbackEl = $('[data-modal-feedback]', root);
  const feedbackMetaEl = $('[data-feedback-meta]', root);
  const feedbackNoteEl = $('[data-feedback-note]', root);
  const goalStateEl = $('[data-modal-goal-state]', root);
  const goalForm = $('[data-form="athlete-nutrition-goal"]', root);
  const goalCaloriesInput = $('#co-goal-calories');
  const goalProteinInput = $('#co-goal-protein');
  const waterStateEl = $('[data-water-goal-state]', root);
  const waterForm = $('[data-form="athlete-water-goal"]', root);
  const waterInput = $('#co-water-liters');
  const waterResetBtn = $('[data-action="reset-water-goal"]', root);
  const activityEl = $('[data-modal-activity]', root);
  const tabList = $('[role="tablist"]', root);
  const tabs = $$('[role="tab"]', root);
  const panels = $$('[data-tab-panel]', root);
  const unreadEl = $('[data-tab-unread]', root);
  const feed = $('[data-msg-feed]', root);
  const form = $('[data-form="athlete-message"]', root);
  const input = $('#athlete-message');

  let current = null;
  let activeTab = 'overview';
  // A sor, amelyikről a nézet nyílt — bezáráskor ide tér vissza a fókusz
  let returnFocus = null;

  const isShown = () => !root.hidden && !managerView.hidden && !page.hidden;

  // Étrend: étkezések a napi cél mellé. Ha az edző az étrend összegét
  // átveszi célnak, a cél-blokk is újrarajzolódik.
  const meals = setupCoachMeals(root, {
    getCurrent: () => current,
    onGoalChange: () => renderAthleteGoal(current),
    confirmAction,
  });

  const chat = createChatController({
    feed,
    form,
    input,
    getLinkId: () => current?.linkId ?? null,
    /* Csak a LÁTHATÓ szál frissül magától és nyugtázódik olvasottként: nyitott
       részletnézet ÉS aktív Üzenetek fül (más fülön a szálat senki nem olvassa). */
    isVisible: () => isShown() && activeTab === 'messages',
    onRead,
  });

  /* ---- Terv kiosztása ----
     Az edző a SAJÁT tervei közül választ. A lista a fül megnyitásakor
     frissül: időközben készülhetett új terv a Tervek oldalon. */
  const planSelect = $('[data-plan-select]', root);
  const planEmpty = $('[data-plan-empty]', root);
  const planForm = $('[data-form="assign-plan"]', root);
  const planNote = $('#assign-plan-note');

  async function loadOwnPlans() {
    let plans = [];
    try {
      plans = await api.getPlans();
    } catch (err) {
      console.error('A tervek betöltése nem sikerült:', err);
      showToast('A terveid most nem tölthetők be', 'error');
    }
    planSelect.replaceChildren();
    plans.forEach((plan) => planSelect.appendChild(new Option(plan.name, plan.id)));
    // Terv nélkül nincs mit kiosztani — a magyarázat mondja meg, mi a teendő
    planEmpty.hidden = plans.length > 0;
    planForm.hidden = plans.length === 0;
  }

  /** Fülváltás. A Terv fül a tervlistát, az Üzenetek fül a szálat tölti be
      belépéskor — a többi fül tartalma az `open`-kor már kirajzolódott. */
  function setTab(name, { focus = false } = {}) {
    activeTab = name;
    tabs.forEach((tab) => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== name;
    });

    if (name === 'plan') {
      planNote.value = '';
      loadOwnPlans();
    } else if (name === 'messages') {
      chat.reset(); // másik sportoló szála jöhet — a régi nem maradhat kint
      chat.load();
    }
  }

  tabList.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && tab.dataset.tab !== activeTab) setTab(tab.dataset.tab);
  });

  // Nyilakkal lépkedés a fülek között (WAI-ARIA tabs minta)
  tabList.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = DETAIL_TABS.indexOf(activeTab);
    const next = DETAIL_TABS[(index + step + DETAIL_TABS.length) % DETAIL_TABS.length];
    setTab(next, { focus: true });
  });

  planForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const athlete = current;
    const planId = Number(planSelect.value);
    if (!athlete || !Number.isInteger(planId)) return;

    const submit = $('button[type="submit"]', planForm);
    submit.disabled = true;
    try {
      const offer = await api.assignPlan(athlete.linkId, planId, planNote.value.trim());
      planNote.value = '';
      showToast(`„${offer.name}” kiosztva — ${athlete.name} elfogadására vár`);
      await onAssign?.();
    } catch (err) {
      showToast(err.message || 'A tervet nem sikerült kiosztani', 'error');
    }
    submit.disabled = false;
  });

  function close({ restoreFocus = true } = {}) {
    if (root.hidden) return;
    root.hidden = true;
    listEl.hidden = false;
    current = null;
    chat.reset();
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  // Escape: vissza a listára. A nyitott modál (pl. a bontás megerősítése) a
  // saját Escape-jét kezeli — ilyenkor a fókusz nincs a nézeten belül.
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) close();
  });

  // A kapcsolat bontása: a sportoló lekerül a panelről, és az üzenetváltás
  // is törlődik — ezért kérdezünk rá.
  $('[data-action="remove-athlete"]', root).addEventListener('click', async () => {
    const athlete = current;
    if (!athlete) return;
    const confirmed = await confirmAction(
      `${athlete.name} lekerül az edzői panelről, és az üzenetváltásotok is törlődik.`,
      { title: 'Kapcsolat bontása', confirmLabel: 'Bontás' },
    );
    if (!confirmed) return;
    try {
      await api.removeAthlete(athlete.linkId);
      close({ restoreFocus: false });
      showToast(`${athlete.name} kapcsolata bontva`);
      await onUnlink?.();
    } catch (err) {
      showToast(err.message || 'A kapcsolatot nem sikerült bontani', 'error');
    }
  });

  /** Egy megjegyzés-sor, saját válasz-mezővel. A válasz UGYANABBA a szálba
      megy (azonos cél), csak más szerzővel — ettől lesz egy beszélgetés a
      gyakorlatról, nem két külön lista. */
  function noteRow(note, athlete) {
    const item = document.createElement('li');
    item.className = 'co-note-item';

    const head = document.createElement('p');
    head.className = 'co-note-head';
    // „Te", ha az edző maga írta — ugyanaz a szemszög-jelölés, mint a chatben.
    const who = note.mine ? 'Te' : note.authorName;
    head.textContent = `${note.exercise} · „${note.workout}" ${note.date} · ${who} · ${relativeTime(note.at)}`;

    const body = document.createElement('p');
    body.className = 'co-note-body';
    body.textContent = note.text;

    const form = document.createElement('form');
    form.className = 'co-note-reply';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 1000;
    input.placeholder = 'Válasz erre a gyakorlatra…';
    input.setAttribute('aria-label', `Válasz — ${note.exercise}`);
    const send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Küldés';
    form.append(input, send);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        await api.addAthleteComment(athlete.linkId, note.target, text);
        input.value = '';
        showToast('Megjegyzés elküldve');
        // A friss sor a következő megnyitáskor jön le a szerverről; itt
        // azonnal kiírjuk, hogy a küldés látható eredményt adjon.
        const mine = document.createElement('p');
        mine.className = 'co-note-body';
        mine.textContent = `Te: ${text}`;
        item.insertBefore(mine, form);
      } catch (err) {
        console.error(err);
        showToast(err.message || 'A megjegyzést nem sikerült elküldeni', 'error');
      } finally {
        send.disabled = false;
      }
    });

    item.append(head, body, form);
    return item;
  }

  /** A sportoló gyakorlat-megjegyzései. Ha nincs egy sem, a blokk rejtve
      marad — üres kerettel nem sugalljuk, hogy van mit nézni. */
  function renderExerciseNotes(athlete) {
    const notes = athlete.exerciseNotes ?? [];
    notesEl.hidden = notes.length === 0;
    noteListEl.replaceChildren(...notes.map((note) => noteRow(note, athlete)));
  }

  /** A sportoló legutóbbi edzés utáni visszajelzése. A számok mellett ez az
      egyetlen olyan sor, ami a sportoló SAJÁT megélését hozza — ezért van
      külön blokkban, nem a statok között. */
  function renderAthleteFeedback(athlete) {
    const feedback = athlete.lastFeedback;
    feedbackEl.hidden = !feedback;
    if (!feedback) return;

    const parts = [`„${feedback.workout}" · ${feedback.date}`];
    if (feedback.difficulty !== null) parts.push(`nehézség ${feedback.difficulty}/5`);
    if (feedback.mood !== null) parts.push(`közérzet ${feedback.mood}/5`);
    feedbackMetaEl.textContent = parts.join(' · ');
    feedbackNoteEl.hidden = !feedback.note;
    feedbackNoteEl.textContent = feedback.note ?? '';
  }

  /** A sportoló napi célja az edző szemszögéből. Az edzői cél zárol: amit
      kitűzöl, az érvényes, és a sportoló nem módosíthatja. */
  function renderAthleteGoal(athlete, { keepInputs = false } = {}) {
    const goal = athlete.nutritionGoal;
    if (!goal) {
      goalStateEl.textContent = '';
      return;
    }

    if (goal.source === 'coach') {
      goalStateEl.textContent =
        `Érvényben: ${formatNumber(goal.calories)} kcal · ` +
        `${formatNumber(goal.protein)} g fehérje — ezt te tűzted ki, ${athlete.name} nem módosíthatja.`;
    } else if (goal.source === 'own') {
      goalStateEl.textContent =
        `${athlete.name} saját célja: ${formatNumber(goal.calories)} kcal · ` +
        `${formatNumber(goal.protein)} g fehérje. Amit kitűzöl, az felülírja, és ő nem módosíthatja.`;
    } else {
      goalStateEl.textContent =
        'Még nincs kitűzött cél — az alapértelmezett szám szól. Amit kitűzöl, azt ő nem módosíthatja.';
    }

    // Háttér-frissítéskor a félig begépelt értéket nem írjuk felül
    if (keepInputs) return;
    goalCaloriesInput.value = Math.round(goal.calories);
    goalProteinInput.value = Math.round(goal.protein);
  }

  /** A víz-cél állapota. Edzői cél nélkül a sportoló testsúlyából számolt
      érték szól — ezt is kimondjuk, hogy az üres mező ne tűnjön hibának. */
  function renderAthleteWater(athlete, { keepInputs = false } = {}) {
    const waterMl = athlete.nutritionGoal?.waterMl ?? null;
    waterStateEl.textContent = waterMl
      ? `Érvényben: ${formatNumber(waterMl / 1000)} liter — ezt te tűzted ki, ${athlete.name} nem módosíthatja.`
      : `Nincs kitűzött víz-cél — ${athlete.name} célja a testsúlyából számolódik (~33 ml/kg).`;
    waterResetBtn.hidden = !waterMl;
    if (keepInputs) return;
    waterInput.value = waterMl ? String(waterMl / 1000) : '';
  }

  /** A víz-cél mentése vagy elvetése — a válasz a sportoló friss célja. */
  async function updateWater(work, message) {
    if (!current) return;
    const submit = $('button[type="submit"]', waterForm);
    submit.disabled = true;
    waterResetBtn.disabled = true;
    try {
      current.nutritionGoal = await work(current.linkId);
      renderAthleteWater(current);
      showToast(message);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'A víz-célt nem sikerült menteni', 'error');
    } finally {
      submit.disabled = false;
      waterResetBtn.disabled = false;
    }
  }

  waterForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const liters = Number(waterInput.value);
    updateWater((linkId) => api.setAthleteWaterGoal(linkId, liters), 'Víz-cél kitűzve');
  });

  waterResetBtn.addEventListener('click', () =>
    updateWater(
      (linkId) => api.clearAthleteWaterGoal(linkId),
      'A víz-cél újra a testsúlyból számolódik',
    ),
  );

  goalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!current) return;
    const submit = $('button[type="submit"]', goalForm);
    submit.disabled = true;
    try {
      current.nutritionGoal = await api.setAthleteNutritionGoal(
        current.linkId,
        Number(goalCaloriesInput.value),
        Number(goalProteinInput.value),
      );
      renderAthleteGoal(current);
      meals.renderTotal();
      showToast('Napi cél kitűzve');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'A célt nem sikerült kitűzni', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  /** A fejléc, a statok és az Áttekintés fül kirajzolása. Az `open` és a
      háttér-frissítés (`sync`) is ezt hívja. */
  function render(athlete, { keepInputs = false } = {}) {
    renderAthleteGoal(athlete, { keepInputs });
    renderAthleteWater(athlete, { keepInputs });
    meals.render(athlete, { keepInputs });
    renderAthleteFeedback(athlete);
    renderExerciseNotes(athlete);

    const tier = athleteTier(athlete.rating);
    badge.className = `co-modal-badge co-tier--${tier.key}`;
    $('.co-modal-rating', badge).textContent = athlete.rating ?? '—';
    $('.co-modal-tag', badge).textContent = athlete.goal ?? '—';
    titleEl.textContent = athlete.name;
    tierEl.textContent =
      athlete.rating === null
        ? `${tier.label} · @${athlete.username}`
        : `${tier.label} · ${athlete.rating} pont · @${athlete.username}`;

    alertEl.hidden = !athlete.alert;
    if (athlete.alert) alertEl.textContent = `Figyelmet igényel: ${athlete.alert}`;

    renderStatList(statsEl, athlete);

    activityEl.replaceChildren();
    const entries = athlete.recent.length > 0 ? athlete.recent : ['Még nincs naplózott aktivitás.'];
    entries.forEach((entry, index) => {
      const li = document.createElement('li');
      li.style.setProperty('--i', index);
      li.textContent = entry;
      activityEl.appendChild(li);
    });

    // Az Üzenetek fül csukott állapotban is kiírja a hátralékot
    unreadEl.hidden = athlete.unread === 0;
    unreadEl.textContent = athlete.unread > 0 ? ` · ${athlete.unread} új` : '';
  }

  return {
    open(athlete, { trigger = null } = {}) {
      const switching = current?.linkId !== athlete.linkId;
      current = athlete;
      if (trigger) returnFocus = trigger;

      render(athlete);

      /* A nézet megjelenése MEGELŐZI a fülét: a chat láthatóság-feltétele a
         látható nézetet nézi, és csak látható szálat nyugtázunk olvasottként
         (fordított sorrendben a betöltés nem jelölné meg az üzeneteket). */
      listEl.hidden = true;
      root.hidden = false;
      // Olvasatlan üzenettel a szál nyílik: azért kattintott, mert a jelvény hívta
      if (switching || athlete.unread > 0) {
        setTab(athlete.unread > 0 ? 'messages' : 'overview');
      }
      root.focus({ preventScroll: true });
      root.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },

    /** Háttér-frissítés után a nyitott sportoló friss adatai. Ha már nincs a
        panelen (pl. közben ő vált le), a nézet bezárul. */
    sync(athletes) {
      if (!current) return;
      const fresh = athletes.find((item) => item.linkId === current.linkId);
      if (!fresh) {
        close({ restoreFocus: false });
        return;
      }
      current = fresh;
      render(fresh, { keepInputs: true });
    },

    close,
  };
}

/* ---- Az Edző oldal ----
   Mindkét nézet MINDIG elérhető: ugyanaz a fiók lehet valakinek az edzője és
   valaki másnak a sportolója. A tartalom viszont valódi kapcsolatból jön:
     - kliens nézet: a saját edződ szála + a hozzád érkezett meghívók;
     - edzői nézet: a sportolóid kártyái + a kiküldött meghívók.
   Az alapértelmezett nézet ahhoz igazodik, amiben a fióknak épp van adata;
   a felhasználó választását a prefs megjegyzi. */

async function setupCoachPage(athleteDetail, confirmAction) {
  const page = $('[data-page="coach"]');
  const toggle = $('[data-coach-toggle]', page);
  const views = {
    client: $('[data-view="client"]', page),
    manager: $('[data-view="manager"]', page),
  };
  const inviteBadge = $('[data-invite-badge]', page);
  const athleteBadge = $('[data-athlete-badge]', page);
  const sentLead = $('[data-sent-lead]', page);
  const inviteForm = $('[data-form="invite-athlete"]', page);
  const inviteInput = $('#co-invite-username');

  // A saját edződ és a róla szóló adatok — a GET /api/coach válasza
  let coachData = { coach: null, me: null, invites: [], planOffers: [], planHistory: [] };
  let panel = { athletes: [], invites: [] };
  // Az edzői lista kliens-oldali szűrése — újrarajzoláshoz nem kell hálózat
  const listView = { filter: 'all', query: '' };
  const searchInput = $('[data-athlete-search]', page);
  const headingEl = $('[data-coach-heading]', page);
  const eyebrowEl = $('[data-coach-eyebrow]', page);

  /* A sportolói nézet (az edzői panel tükörképe). Olvasás-nyugtázás vagy
     étkezés-naplózás után a jelvények és a számok elavultak — újratöltünk. */
  const client = setupClientView({ page, view: views.client, onChange: () => refresh() });

  // A saját felhasználónév: ezzel tud meghívni az edző, ezért ki van írva
  const user = await api.getUser();
  $('[data-my-username]', page).textContent = `@${user.username}`;

  /**
   * Jelvények a nézetváltón. MINDKÉT nézet kap egyet, mert a megjegyzett
   * nézetválasztás miatt a felhasználó bármelyikben nyithatja az oldalt — a
   * másik oldalon várakozó meghívó vagy olvasatlan üzenet enélkül
   * észrevétlen maradna. A kettőt egy szám fogja össze („mennyi vár rád
   * ott"), a felolvasott címke viszont kibontja, miből áll.
   */
  function renderToggleBadges() {
    const setBadge = (badge, count, describe) => {
      const button = badge.closest('.co-toggle-btn');
      badge.textContent = count > 0 ? String(count) : '';
      badge.hidden = count === 0;
      if (count > 0) button.setAttribute('aria-label', describe());
      else button.removeAttribute('aria-label');
    };

    const invites = coachData.invites.length;
    const offers = (coachData.planOffers ?? []).length;
    const coachUnread = coachData.coach?.unread ?? 0;
    setBadge(inviteBadge, invites + offers + coachUnread, () =>
      [
        'Edződ',
        invites > 0 ? `${invites} új meghívó` : null,
        offers > 0 ? `${offers} felajánlott terv` : null,
        coachUnread > 0 ? `${coachUnread} olvasatlan üzenet` : null,
      ]
        .filter(Boolean)
        .join(' — '),
    );

    const athleteUnread = panel.athletes.reduce((sum, athlete) => sum + athlete.unread, 0);
    setBadge(athleteBadge, athleteUnread, () => `Edzetteim — ${athleteUnread} olvasatlan üzenet`);
  }

  /** Az alapértelmezett nézet: amelyik oldalon a fióknak épp van dolga. */
  const defaultView = () => {
    if (coachData.coach || coachData.invites.length > 0) return 'client';
    if (panel.athletes.length > 0 || panel.invites.length > 0) return 'manager';
    return 'client';
  };

  const apply = ({ animate = false } = {}) => {
    const view = prefs.get('coachView', null) ?? defaultView();
    views.client.hidden = view !== 'client';
    views.manager.hidden = view !== 'manager';
    // A fejléc a nézetet nevezi meg: az edzői nézet egy irányítópult
    headingEl.textContent = view === 'manager' ? 'Edzői panel' : 'Edződ';
    eyebrowEl.textContent = view === 'manager' ? 'Edző · Heti áttekintés' : 'Edző';
    $$('.co-toggle-btn', toggle).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.coachView === view));
    });
    if (view === 'manager' && animate) animateCoachRatings();
  };

  /** Mindkét oldal újratöltése. Az oldalra lépéskor és minden olyan művelet
      után fut, ami a kapcsolatokat módosítja. */
  async function refresh({ animate = false } = {}) {
    [coachData, panel] = await Promise.all([api.getCoach(), api.getAthletes()]);
    /* Az összegző visszajelzés-blokkja ebből tudja, van-e edző, akinek a
       visszajelzés szólna. */
    shared.hasCoachLink = Boolean(coachData.coach);
    client.render(coachData);
    renderCoachPanel(panel, listView);
    // A nyitott részletnézet is a friss számokat mutassa (vagy záruljon be)
    athleteDetail?.sync(panel.athletes);
    sentLead.hidden = panel.invites.length === 0;
    apply({ animate });
    renderToggleBadges(); // az apply UTÁN: a nézetváltó ekkor áll a helyére
    /* A szálat csak akkor töltjük, ha látszik is (sportolói nézet, Üzenetek
       fül) — a nem látott üzenetet nem nyugtázhatjuk olvasottként. */
    client.shown();
  }

  toggle.addEventListener('click', (event) => {
    const btn = event.target.closest('.co-toggle-btn');
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
    prefs.set('coachView', btn.dataset.coachView);
    // Visszatérve az edzői nézetre a lista fogadjon, ne egy régi sportoló
    athleteDetail?.close({ restoreFocus: false });
    apply({ animate: true });
    // A kliens nézetre váltva a szál most lett látható: itt kérjük le (és
    // nyugtázzuk), nem várva a következő halk frissítésre.
    client.shown();
  });

  searchInput.addEventListener('input', () => {
    listView.query = searchInput.value;
    renderAthleteList(panel.athletes, listView);
  });

  // Meghívás felhasználónévvel — a hibát (nincs ilyen fiók, már kapcsolatban
  // vagytok) a szerver üzenete mondja meg, azt írjuk ki.
  inviteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = inviteInput.value.trim();
    if (!username) return;
    try {
      const invite = await api.inviteAthlete(username);
      inviteForm.reset();
      await refresh();
      showToast(`Meghívó elküldve — ${invite.name} elfogadására vár`);
    } catch (err) {
      showToast(err.message || 'A meghívó nem ment el', 'error');
    }
    inviteInput.focus();
  });

  $('[data-action="leave-coach"]', page).addEventListener('click', async () => {
    const coach = coachData.coach;
    if (!coach) return;
    const confirmed = await confirmAction(
      `${coach.name} innentől nem látja az adataidat, és az üzenetváltásotok is törlődik.`,
      { title: 'Leválás az edzőről', confirmLabel: 'Leválás' },
    );
    if (!confirmed) return;
    try {
      await api.leaveCoach();
      await refresh();
      showToast('Leváltál az edződről');
    } catch (err) {
      showToast(err.message || 'A leválás nem sikerült', 'error');
    }
  });

  /* Egyetlen delegált kattintás-kezelő: a meghívó-gombok és a sportoló-
     kártyák is dinamikusan születnek, tehát nem lehet rájuk közvetlenül
     kötni. A kártya/üzenet-sor a részletnézetet nyitja a lista helyén. */
  page.addEventListener('click', async (event) => {
    const filterBtn = event.target.closest('[data-filter]');
    if (filterBtn) {
      listView.filter = filterBtn.dataset.filter;
      renderAthleteList(panel.athletes, listView);
      return;
    }

    const inviteBtn = event.target.closest('[data-invite-action]');
    if (inviteBtn) {
      const linkId = Number(inviteBtn.dataset.linkId);
      const action = inviteBtn.dataset.inviteAction;
      try {
        if (action === 'accept-invite') await api.acceptCoachInvite(linkId);
        else if (action === 'decline-invite') await api.declineCoachInvite(linkId);
        else if (action === 'cancel-invite') await api.removeAthlete(linkId);
        await refresh();
        if (action === 'accept-invite') showToast('Meghívó elfogadva');
      } catch (err) {
        showToast(err.message || 'A művelet nem sikerült', 'error');
      }
      return;
    }

    /* Terv-ajánlat: az elfogadás ÚJ tervet hoz létre a sportoló fiókjában,
       a meglévők mellé — a Tervek oldal ezért elavul, azt is frissítjük. */
    const offerBtn = event.target.closest('[data-offer-action]');
    if (offerBtn) {
      const offerId = Number(offerBtn.dataset.offerId);
      const accepting = offerBtn.dataset.offerAction === 'accept-offer';
      try {
        if (accepting) {
          const plan = await api.acceptPlanOffer(offerId);
          showToast(`„${plan.name}” bekerült a terveid közé`);
          // A Tervek oldal listája ettől elavult — frissen húzzuk le
          await renderPlans();
        } else {
          await api.declinePlanOffer(offerId);
        }
        await refresh();
      } catch (err) {
        showToast(err.message || 'A művelet nem sikerült', 'error');
      }
      return;
    }

    if (event.target.closest('[data-action="close-athlete"]')) {
      athleteDetail?.close();
      return;
    }

    const trigger = event.target.closest('[data-athlete]');
    if (!trigger) return;
    const athlete = panel.athletes.find((item) => String(item.linkId) === trigger.dataset.athlete);
    if (athlete) athleteDetail?.open(athlete, { trigger });
  });

  await refresh();
  return { refresh };
}

export { setupAthleteDetail, setupCoachPage };
