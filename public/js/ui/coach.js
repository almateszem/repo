/** Edző oldal: sportoló-kártyák, sportoló-ablak, meghívók. */

import { api } from '../core/api.js';
import { $, $$ } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { shared } from '../core/page-hooks.js';
import { prefs } from '../core/prefs.js';
import { showToast } from '../core/toast.js';
import { animateCoachRatings } from '../nav/router.js';
import { ATHLETE_CARD_STATS, athleteTier, orDash, renderCoachPanel, renderInviteRow, renderPlanOffer } from '../render/coach.js';
import { renderPlans } from '../render/plans.js';
import { CONFIDENCE_LABELS } from '../render/recovery.js';
import { createChatController, relativeTime } from './chat.js';
import { createModalController } from './modals.js';

/** A modálban megjelenő részletes statok (a kártya statjai + extra mezők).
    A megbízhatóság szándékosan itt van: napló nélküli fiókra a motor 100%
    készenlétet ad (nincs mit levonni), és enélkül az edző „arany szintnek"
    olvasná azt, ami valójában adathiány. */
const ATHLETE_MODAL_STATS = [
  ...ATHLETE_CARD_STATS,
  ['Heti edzések', (a) => a.weekly],
  ['Aktív terv', (a) => orDash(a.plan)],
  ['Készenlét alapja', (a) => CONFIDENCE_LABELS[a.confidence] ?? '—'],
];

/** Sportoló részletmodál: a saját naplójából számolt összegzés, valódi
    üzenetváltás, és a kapcsolat bontása. Az `onUnlink` az Edző oldalt
    frissíti, miután a sportoló lekerült a panelről. */
function setupAthleteModal({ confirmAction, onUnlink, onRead, onAssign } = {}) {
  const modal = $('#athleteModal');
  const controller = createModalController(modal);
  const badge = $('.co-modal-badge', modal);
  const titleEl = $('#athleteModalTitle');
  const tierEl = $('.co-modal-tier', modal);
  const alertEl = $('[data-modal-alert]', modal);
  const statsEl = $('[data-modal-stats]', modal);
  const notesEl = $('[data-modal-notes]', modal);
  const noteListEl = $('[data-modal-note-list]', modal);
  const feedbackEl = $('[data-modal-feedback]', modal);
  const feedbackMetaEl = $('[data-feedback-meta]', modal);
  const feedbackNoteEl = $('[data-feedback-note]', modal);
  const goalStateEl = $('[data-modal-goal-state]', modal);
  const goalForm = $('[data-form="athlete-nutrition-goal"]', modal);
  const goalCaloriesInput = $('#co-goal-calories');
  const goalProteinInput = $('#co-goal-protein');
  const activityEl = $('[data-modal-activity]', modal);
  const msgButton = $('[data-action="message"]', modal);
  const msgSection = $('[data-msg-section]', modal);
  const feed = $('[data-msg-feed]', modal);
  const form = $('[data-form="athlete-message"]', modal);
  const input = $('#athlete-message');

  let current = null;

  const chat = createChatController({
    feed,
    form,
    input,
    getLinkId: () => current?.linkId ?? null,
    /* A modál chatje eddig egyszer töltött be, és utána megállt: a sportoló
       válasza csak a modál újranyitásakor jelent meg. A látható szál most itt
       is frissül magától — a feltétel a nyitott modál ÉS a kinyitott
       üzenet-blokk (a csukott blokk tartalmát senki nem olvassa el). */
    isVisible: () => modal.classList.contains('is-open') && !msgSection.hidden,
    onRead,
  });

  const setMessageOpen = (open, { focus = false } = {}) => {
    msgSection.hidden = !open;
    msgButton.setAttribute('aria-expanded', String(open));
    if (!open) return;
    setPlanOpen(false); // a két blokk kizárja egymást — a modál különben nagyon hosszú lenne
    chat.reset(); // másik sportoló szála jöhet — a régi nem maradhat kint
    chat.load();
    if (focus) input.focus();
  };

  msgButton.addEventListener('click', () => setMessageOpen(msgSection.hidden, { focus: true }));

  /* ---- Terv kiosztása ----
     Az edző a SAJÁT tervei közül választ. A lista a blokk kinyitásakor
     frissül: időközben készülhetett új terv a Tervek oldalon. */
  const planButton = $('[data-action="assign-plan"]', modal);
  const planSection = $('[data-plan-section]', modal);
  const planSelect = $('[data-plan-select]', modal);
  const planEmpty = $('[data-plan-empty]', modal);
  const planForm = $('[data-form="assign-plan"]', modal);
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

  function setPlanOpen(open, { focus = false } = {}) {
    planSection.hidden = !open;
    planButton.setAttribute('aria-expanded', String(open));
    if (!open) return;
    planNote.value = '';
    loadOwnPlans().then(() => {
      if (focus && !planSelect.disabled) planSelect.focus();
    });
  }

  planButton.addEventListener('click', () => {
    const opening = planSection.hidden;
    if (opening) setMessageOpen(false);
    setPlanOpen(opening, { focus: true });
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
      setPlanOpen(false);
      showToast(`„${offer.name}” kiosztva — ${athlete.name} elfogadására vár`);
      await onAssign?.();
    } catch (err) {
      showToast(err.message || 'A tervet nem sikerült kiosztani', 'error');
    }
    submit.disabled = false;
  });

  // A kapcsolat bontása: a sportoló lekerül a panelről, és az üzenetváltás
  // is törlődik — ezért kérdezünk rá.
  $('[data-action="remove-athlete"]', modal).addEventListener('click', async () => {
    const athlete = current;
    const confirmed = await confirmAction(
      `${athlete.name} lekerül az edzői panelről, és az üzenetváltásotok is törlődik.`,
      { title: 'Kapcsolat bontása', confirmLabel: 'Bontás' },
    );
    if (!confirmed) return;
    try {
      await api.removeAthlete(athlete.linkId);
      controller.close();
      showToast(`${athlete.name} kapcsolata bontva`);
      await onUnlink?.();
    } catch (err) {
      showToast(err.message || 'A kapcsolatot nem sikerült bontani', 'error');
    }
  });

  /** Egy megjegyzés-sor a modálban, saját válasz-mezővel. A válasz UGYANABBA
      a szálba megy (azonos cél), csak más szerzővel — ettől lesz egy
      beszélgetés a gyakorlatról, nem két külön lista. */
  function noteRow(note, athlete) {
    const item = document.createElement('li');
    item.className = 'co-note-item';

    const head = document.createElement('p');
    head.className = 'co-note-head';
    head.textContent = `${note.exercise} · „${note.workout}" ${note.date} · ${note.authorName} · ${relativeTime(note.at)}`;

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

  /** A sportoló napi célja az edző szemszögéből. Három eset van, és mind a
      hármat ki kell mondani: még nincs kitűzött cél; a kitűzött cél él; vagy
      a sportoló mást állított be — ez utóbbi a legfontosabb, mert némán
      egyikük sem írhatja felül a másikat. */
  function renderAthleteGoal(athlete) {
    const goal = athlete.nutritionGoal;
    if (!goal) { goalStateEl.textContent = ''; return; }

    if (goal.source === 'own') {
      goalStateEl.textContent = goal.coach
        ? `A kitűzött célod ${formatNumber(goal.coach.calories)} kcal · `
          + `${formatNumber(goal.coach.protein)} g, de ${athlete.name} `
          + `${formatNumber(goal.calories)} kcal · ${formatNumber(goal.protein)} g-ot állított be magának.`
        : `${athlete.name} saját célja: ${formatNumber(goal.calories)} kcal · `
          + `${formatNumber(goal.protein)} g fehérje. Amit kitűzöl, azt ő látni fogja.`;
    } else if (goal.source === 'coach') {
      goalStateEl.textContent = `Érvényben: ${formatNumber(goal.calories)} kcal · `
        + `${formatNumber(goal.protein)} g fehérje — ezt te tűzted ki.`;
    } else {
      goalStateEl.textContent = 'Még nincs kitűzött cél — az alapértelmezett szám szól.';
    }

    goalCaloriesInput.value = Math.round(goal.calories);
    goalProteinInput.value = Math.round(goal.protein);
  }

  goalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!current) return;
    const submit = $('button[type="submit"]', goalForm);
    submit.disabled = true;
    try {
      current.nutritionGoal = await api.setAthleteNutritionGoal(
        current.linkId, Number(goalCaloriesInput.value), Number(goalProteinInput.value),
      );
      renderAthleteGoal(current);
      showToast('Napi cél kitűzve');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'A célt nem sikerült kitűzni', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  return {
    open(athlete) {
      current = athlete;

      renderAthleteGoal(athlete);
      renderAthleteFeedback(athlete);
      renderExerciseNotes(athlete);

      const tier = athleteTier(athlete.rating);
      badge.className = `co-modal-badge co-tier--${tier.key}`;
      $('.co-modal-rating', badge).textContent = athlete.rating;
      $('.co-modal-tag', badge).textContent = athlete.goal ?? '—';
      titleEl.textContent = athlete.name;
      tierEl.textContent = `${tier.label} · ${athlete.rating} pont · @${athlete.username}`;

      alertEl.hidden = !athlete.alert;
      if (athlete.alert) alertEl.textContent = `Figyelmet igényel: ${athlete.alert}`;

      statsEl.replaceChildren();
      ATHLETE_MODAL_STATS.forEach(([label, getValue]) => {
        const stat = document.createElement('div');
        stat.className = 'co-modal-stat';
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = getValue(athlete);
        stat.append(dt, dd);
        statsEl.appendChild(stat);
      });

      activityEl.replaceChildren();
      const entries = athlete.recent.length > 0
        ? athlete.recent
        : ['Még nincs naplózott aktivitás.'];
      entries.forEach((entry, index) => {
        const li = document.createElement('li');
        li.style.setProperty('--i', index);
        li.textContent = entry;
        activityEl.appendChild(li);
      });

      /* Olvasatlan üzenettel a szál nyitva indul: azért kattintott a
         kártyára, mert a jelvény hívta oda. A gomb felirata is kiírja a
         hátralékot, hogy csukott állapotban is látszódjon. */
      msgButton.textContent = athlete.unread > 0 ? `Üzenet · ${athlete.unread} új` : 'Üzenet';
      /* A modál nyitása MEGELŐZI a szálét: a chat láthatóság-feltétele a
         nyitott modált nézi, és csak látható szálat nyugtázunk olvasottként
         (fordított sorrendben a betöltés nem jelölné meg az üzeneteket). */
      controller.open();
      setPlanOpen(false); // másik sportolóhoz nyílt: a félbehagyott kiosztás ne maradjon kint
      setMessageOpen(athlete.unread > 0);
    },
  };
}

/* ---- Az Edző oldal ----
   Mindkét nézet MINDIG elérhető: ugyanaz a fiók lehet valakinek az edzője és
   valaki másnak a sportolója. A tartalom viszont valódi kapcsolatból jön:
     - kliens nézet: a saját edződ szála + a hozzád érkezett meghívók;
     - edzői nézet: a sportolóid kártyái + a kiküldött meghívók.
   Az alapértelmezett nézet ahhoz igazodik, amiben a fióknak épp van adata;
   a felhasználó választását a prefs megjegyzi. */

async function setupCoachPage(athleteModal, confirmAction) {
  const page = $('[data-page="coach"]');
  const toggle = $('[data-coach-toggle]', page);
  const views = {
    client: $('[data-view="client"]', page),
    manager: $('[data-view="manager"]', page),
  };
  const clientThread = $('[data-coach-thread]', page);
  const noCoachText = $('[data-coach-none]', page);
  const inviteLead = $('[data-invite-lead]', page);
  const inviteBadge = $('[data-invite-badge]', page);
  const athleteBadge = $('[data-athlete-badge]', page);
  const inviteList = $('[data-list="coach-invites"]', page);
  const offerLead = $('[data-offer-lead]', page);
  const offerList = $('[data-list="plan-offers"]', page);
  const sentLead = $('[data-sent-lead]', page);
  const inviteForm = $('[data-form="invite-athlete"]', page);
  const inviteInput = $('#co-invite-username');

  // A saját edződ szála — a kapcsolat azonosítója a /api/coach válaszából jön
  let coachData = { coach: null, invites: [], planOffers: [] };
  let panel = { athletes: [], invites: [] };

  /** Látszik-e ÉPP az edződdel folytatott beszélgetés. Enélkül a halk
      frissítés a rejtett oldalon is kérdezne, az olvasás-nyugtázás pedig
      olyan üzeneteket jelölne olvasottnak, amiket a felhasználó nem is
      látott — az edző oldalán hamis „olvasva" jelenne meg. */
  const clientThreadVisible = () => !page.hidden && !views.client.hidden && !clientThread.hidden;

  const chat = createChatController({
    feed: $('[data-client-feed]', page),
    form: $('[data-form="coach-message"]', page),
    input: $('#coach-message'),
    getLinkId: () => coachData.coach?.linkId ?? null,
    isVisible: clientThreadVisible,
    // Az olvasás után a jelvény már nem stimmel — friss számokat kérünk
    onRead: () => refresh(),
  });

  // A saját felhasználónév: ezzel tud meghívni az edző, ezért ki van írva
  const user = await api.getUser();
  $('[data-my-username]', page).textContent = `@${user.username}`;

  function renderClient() {
    const { coach, invites, planOffers = [] } = coachData;
    clientThread.hidden = !coach;
    // A hosszú magyarázat csak akkor kell, ha nincs se edző, se meghívó
    noCoachText.hidden = Boolean(coach) || invites.length > 0;
    inviteLead.hidden = invites.length === 0;

    if (coach) {
      $('[data-coach-name]', page).textContent = coach.name;
      $('[data-coach-role]', page).textContent = `Edződ · @${coach.username}`;
    }

    inviteList.replaceChildren();
    invites.forEach((invite) => inviteList.appendChild(renderInviteRow(invite, [
      { label: 'Elfogadás', action: 'accept-invite', variant: 'primary' },
      { label: 'Elutasítás', action: 'decline-invite' },
    ])));

    offerLead.hidden = planOffers.length === 0;
    offerList.replaceChildren();
    planOffers.forEach((offer) => offerList.appendChild(renderPlanOffer(offer)));
  }

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
    setBadge(inviteBadge, invites + offers + coachUnread, () => [
      'Edződ',
      invites > 0 ? `${invites} új meghívó` : null,
      offers > 0 ? `${offers} felajánlott terv` : null,
      coachUnread > 0 ? `${coachUnread} olvasatlan üzenet` : null,
    ].filter(Boolean).join(' — '));

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
    renderClient();
    renderCoachPanel(panel);
    sentLead.hidden = panel.invites.length === 0;
    apply({ animate });
    renderToggleBadges(); // az apply UTÁN: a nézetváltó ekkor áll a helyére
    /* A szálat csak akkor töltjük, ha látszik is. Az edzői nézetben állva
       nincs értelme lekérni — és ami fontosabb: a nem látott üzenetet nem
       nyugtázhatjuk olvasottként. */
    if (clientThreadVisible()) chat.load();
  }

  toggle.addEventListener('click', (event) => {
    const btn = event.target.closest('.co-toggle-btn');
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
    prefs.set('coachView', btn.dataset.coachView);
    apply({ animate: true });
    // A kliens nézetre váltva a szál most lett látható: itt kérjük le (és
    // nyugtázzuk), nem várva a következő halk frissítésre.
    if (clientThreadVisible()) chat.load();
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
     kötni. A kártya/riasztás-sor a részletmodált nyitja. */
  page.addEventListener('click', async (event) => {
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

    const trigger = event.target.closest('[data-athlete]');
    if (!trigger) return;
    const athlete = panel.athletes.find((item) => String(item.linkId) === trigger.dataset.athlete);
    if (athlete) athleteModal?.open(athlete);
  });

  await refresh();
  return { refresh };
}

export { setupAthleteModal, setupCoachPage };
