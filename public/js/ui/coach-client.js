/** Edző oldal, sportolói nézet („Edződ"): az edzői panel tükörképe a
    sportoló szemszögéből — KPI-k, jelzés, fülek (Áttekintés / Étrend / Terv /
    Üzenetek) és az oldalsáv, ami megmutatja, mit lát rólad az edződ. */

import { api } from '../core/api.js';
import { $, $$ } from '../core/dom.js';
import { hooks } from '../core/page-hooks.js';
import { showToast } from '../core/toast.js';
import {
  renderActivePlan,
  renderClientKpis,
  renderClientMeals,
  renderClientScore,
  renderClientStatus,
  renderClientTodo,
  renderGoalText,
  renderPlanHistory,
  renderWaterText,
} from '../render/coach-client.js';
import { renderInviteRow, renderPlanOffer } from '../render/coach.js';
import { createChatController } from './chat.js';
import { exerciseNoteRow } from './exercise-notes.js';

const CLIENT_TABS = ['overview', 'nutrition', 'plan', 'messages'];

/** Hány napja él a kapcsolat — a fejléc „X napja dolgoztok együtt" sora. */
function sinceText(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  return days < 1 ? 'ma kezdtetek' : `${days} napja dolgoztok együtt`;
}

/**
 * @param {HTMLElement} options.page   az Edző oldal
 * @param {HTMLElement} options.view   a sportolói nézet konténere
 * @param {Function} options.onChange  olvasás-nyugtázás vagy naplózás után fut
 *        (az Edző oldal újratölti a számokat és a jelvényeket)
 */
function setupClientView({ page, view, onChange }) {
  const kpisEl = $('[data-client-kpis]', view);
  const thread = $('[data-coach-thread]', view);
  const noCoachText = $('[data-coach-none]', view);
  const inviteLead = $('[data-invite-lead]', view);
  const inviteList = $('[data-list="coach-invites"]', view);
  const offerSection = $('[data-offer-section]', view);
  const offerList = $('[data-list="plan-offers"]', view);
  const offerCount = $('[data-client-offer-count]', view);
  const unreadEl = $('[data-client-unread]', view);
  const tabList = $('[data-client-tabs]', view);
  const tabs = $$('[role="tab"]', tabList);
  const panels = $$('[data-client-panel]', view);
  const scoreBlock = $('[data-client-score]', view);
  const feedbackEl = $('[data-client-feedback]', view);
  const notesEl = $('[data-client-notes]', view);
  const noteListEl = $('[data-client-note-list]', view);
  const activityEl = $('[data-client-activity]', view);
  const mealList = $('[data-client-meals]', view);
  const historySection = $('[data-client-history-section]', view);

  let data = { coach: null, me: null, invites: [], planOffers: [], planHistory: [] };
  let activeTab = 'overview';

  /* A szál csak akkor frissül magától és nyugtázódik olvasottként, ha
     TÉNYLEG látszik: az oldal, a sportolói nézet és az Üzenetek fül is. Más
     fülön a szálat senki nem olvassa — az „olvasva" hazugság volna. */
  const isChatVisible = () =>
    !page.hidden && !view.hidden && !thread.hidden && activeTab === 'messages';

  const chat = createChatController({
    feed: $('[data-client-feed]', view),
    form: $('[data-form="coach-message"]', view),
    input: $('#coach-message'),
    getLinkId: () => data.coach?.linkId ?? null,
    isVisible: isChatVisible,
    onRead: () => onChange?.(),
  });

  function setTab(name, { focus = false } = {}) {
    activeTab = name;
    tabs.forEach((tab) => {
      const selected = tab.dataset.clientTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.clientPanel !== name;
    });
    if (name === 'messages') chat.load();
  }

  tabList.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && tab.dataset.clientTab !== activeTab) setTab(tab.dataset.clientTab);
  });

  // Nyilakkal lépkedés a fülek között (WAI-ARIA tabs minta)
  tabList.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = CLIENT_TABS.indexOf(activeTab);
    const next = CLIENT_TABS[(index + step + CLIENT_TABS.length) % CLIENT_TABS.length];
    setTab(next, { focus: true });
  });

  // A „Vár rád" sorai a megfelelő fülre visznek
  view.addEventListener('click', (event) => {
    const goto = event.target.closest('[data-client-goto]');
    if (goto) setTab(goto.dataset.clientGoto, { focus: true });
  });

  /* „Megettem": az étkezés minden tétele a mai naplóba kerül. A Táplálkozás
     oldal és az edző panelje is ebből frissül — a hook a Táplálkozás oldalé. */
  mealList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-client-meal]');
    if (!button) return;
    const meal = data.me?.meals?.find((m) => m.id === Number(button.dataset.clientMeal));
    if (!meal) return;
    button.disabled = true;
    try {
      await api.logMeal(meal.id);
      showToast(`${meal.name} naplózva`);
      hooks.refreshCoachMeals?.().catch(console.error);
      await onChange?.();
    } catch (err) {
      button.disabled = false;
      console.error(err);
      showToast(err.message || 'Az étkezést nem sikerült naplózni', 'error');
    }
  });

  function renderOverview(me) {
    renderClientTodo($('[data-client-todo]', view), {
      offers: data.planOffers.length,
      unread: data.coach?.unread ?? 0,
      meals: me.meals ?? [],
    });

    const feedback = me.lastFeedback;
    feedbackEl.hidden = !feedback;
    if (feedback) {
      const parts = [`„${feedback.workout}" · ${feedback.date}`];
      if (feedback.difficulty !== null) parts.push(`nehézség ${feedback.difficulty}/5`);
      if (feedback.mood !== null) parts.push(`közérzet ${feedback.mood}/5`);
      $('[data-client-feedback-meta]', view).textContent = parts.join(' · ');
      const noteEl = $('[data-client-feedback-note]', view);
      noteEl.hidden = !feedback.note;
      noteEl.textContent = feedback.note ?? '';
    }

    // Háttér-frissítéskor a félig begépelt választ nem dobjuk el
    const typing = noteListEl.contains(document.activeElement);
    const notes = me.exerciseNotes ?? [];
    notesEl.hidden = notes.length === 0;
    if (!typing) {
      noteListEl.replaceChildren(...notes.map((note) => exerciseNoteRow(note, api.addMyComment)));
    }

    const entries = me.recent.length > 0 ? me.recent : ['Még nincs naplózott aktivitás.'];
    activityEl.replaceChildren(
      ...entries.map((entry, index) => {
        const li = document.createElement('li');
        li.style.setProperty('--i', index);
        li.textContent = entry;
        return li;
      }),
    );
  }

  function renderNutrition(me) {
    $('[data-client-goal]', view).textContent = renderGoalText(me.nutritionGoal);
    $('[data-client-water]', view).textContent = renderWaterText(me.nutritionGoal);
    const meals = me.meals ?? [];
    $('[data-client-meals-empty]', view).hidden = meals.length > 0;
    renderClientMeals(mealList, meals);
  }

  function renderPlanTab() {
    const offers = data.planOffers;
    offerSection.hidden = offers.length === 0;
    offerList.replaceChildren(...offers.map(renderPlanOffer));
    offerCount.hidden = offers.length === 0;
    offerCount.textContent = offers.length > 0 ? String(offers.length) : '';

    renderActivePlan($('[data-client-active-plan]', view), data.planHistory);
    historySection.hidden = data.planHistory.length === 0;
    renderPlanHistory($('[data-client-history]', view), data.planHistory);
  }

  /** A nézet kirajzolása a GET /api/coach válaszából. */
  function render(next) {
    const switching = next.coach?.linkId !== data.coach?.linkId;
    data = { planOffers: [], planHistory: [], me: null, ...next };
    const { coach, me, invites } = data;

    thread.hidden = !coach;
    // A hosszú magyarázat csak akkor kell, ha nincs se edző, se meghívó
    noCoachText.hidden = Boolean(coach) || invites.length > 0;
    inviteLead.hidden = invites.length === 0;
    inviteList.replaceChildren(
      ...invites.map((invite) =>
        renderInviteRow(invite, [
          { label: 'Elfogadás', action: 'accept-invite', variant: 'primary' },
          { label: 'Elutasítás', action: 'decline-invite' },
        ]),
      ),
    );

    // Edző nélkül nincs mit mérni: az oldalsáv a „mit látna" magyarázat marad
    kpisEl.hidden = !me;
    scoreBlock.hidden = !me;
    $('[data-privacy-title]', view).textContent = coach
      ? 'Mit lát rólad az edződ?'
      : 'Mit látna rólad egy edző?';
    $('[data-privacy-note]', view).textContent = coach
      ? 'Leválással a hozzáférése azonnal megszűnik, az üzenetváltásotok pedig törlődik.'
      : 'Csak az elfogadott meghívó után — és csak addig, amíg le nem válsz róla.';

    if (switching) chat.reset(); // másik edző szála nem maradhat kint
    if (!coach || !me) return;

    $('[data-coach-name]', view).textContent = coach.name;
    $('[data-coach-role]', view).textContent = [
      `Edződ · @${coach.username}`,
      coach.since ? sinceText(coach.since) : null,
    ]
      .filter(Boolean)
      .join(' · ');

    renderClientKpis(kpisEl, me, {
      hasCoachPlan: data.planHistory.some((offer) => offer.status === 'accepted'),
    });
    renderClientStatus($('[data-client-status]', view), me);
    renderClientScore(scoreBlock, me);
    renderOverview(me);
    renderNutrition(me);
    renderPlanTab();

    unreadEl.hidden = coach.unread === 0;
    unreadEl.textContent = coach.unread > 0 ? String(coach.unread) : '';

    if (isChatVisible()) chat.load();
  }

  return {
    render,
    /** A nézet most lett látható (nézetváltás): a nyitott szálat itt kérjük
        le és nyugtázzuk, nem várva a következő frissítésre. */
    shown() {
      if (isChatVisible()) chat.load();
    },
  };
}

export { setupClientView };
