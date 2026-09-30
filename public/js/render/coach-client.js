/** A sportolói nézet („Edződ") elemei: KPI-sor, jelzés, pontszám, teendők,
    étrend és terv-előzmény. Tiszta rajzolók — a vezérlő a js/ui/coach-client.js.
    A bemenet a GET /api/coach válasza; a `me` UGYANAZ a kártya, amit az
    edződ a panelján rólad lát. */

import { DAY_LABELS } from '../core/constants.js';
import { $ } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { dayStatus } from '../core/plan-week.js';
import { ATHLETE_DETAIL_STATS, athleteTier, kpi, orDash, renderStatList } from './coach.js';
import { CONFIDENCE_LABELS, hasReadiness } from './recovery.js';

/** A terv-követés alsora. Érdemi változásnál (legalább 10 pont) a trendet
    mondja ki — ugyanaz a küszöb, amitől az edző kártyáján nyíl jelenik meg. */
function adherenceSub(me, hasCoachPlan) {
  if (me.adherence === null) {
    // Elfogadott terv mellett a hiány azt jelenti: még nem volt ütemezett nap
    return hasCoachPlan ? 'még nem volt ütemezett edzésnap' : 'még nincs elfogadott edzői terv';
  }
  const trend = me.adherenceTrend ?? 0;
  if (Math.abs(trend) < 10) return 'az edződ tervéhez mérve · 4 hét';
  return `${trend > 0 ? '↑' : '↓'}${Math.abs(trend)} pont az előző két héthez képest`;
}

/** A KPI-sor: a négy szám, amire az edződ a legtöbbet néz. A `hasCoachPlan`
    azt mondja meg, fogadott-e már el tervet az edzőjétől. */
function renderClientKpis(el, me, { hasCoachPlan = false } = {}) {
  const readiness = hasReadiness(me.readiness) ? me.readiness : null;
  const [done, target] = String(me.weekly ?? '').split('/');
  el.replaceChildren(
    kpi(
      'Készenlét',
      orDash(readiness),
      readiness === null ? '' : '/100',
      readiness === null
        ? 'még nincs check-in'
        : `alapja: ${(CONFIDENCE_LABELS[me.confidence] ?? '—').toLowerCase()}`,
      readiness === null ? 'is-empty' : '',
    ),
    kpi(
      'Terv-követés',
      orDash(me.adherence),
      me.adherence === null ? '' : '%',
      adherenceSub(me, hasCoachPlan),
      me.adherence === null ? 'is-empty' : '',
    ),
    kpi(
      'Heti edzések',
      orDash(done || null),
      target && target !== '–' ? `/${target}` : '',
      target && target !== '–' ? 'e héten a tervedből' : 'nincs ütemezett nap',
    ),
    kpi(
      'Sorozat',
      me.streak,
      'nap',
      me.lastWorkout ? `utolsó edzés: ${me.lastWorkout}` : 'még nincs edzés',
    ),
  );
}

/** Az állapot-sáv: amit az edződ jelzésként lát a panelján — vagy „minden
    rendben". A sportoló így nem a hallgatásból tudja meg, hogy lemaradt. */
function renderClientStatus(el, me) {
  const box = document.createElement('div');
  box.className = me.alert ? 'co-modal-alert co-client-alert' : 'co-status';
  if (me.alert) {
    box.textContent = `Az edződ panelján jelzés: ${me.alert}`;
  } else {
    const icon = document.createElement('span');
    icon.className = 'co-status-ico';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✓';
    const text = document.createElement('span');
    text.className = 'co-status-text';
    const strong = document.createElement('strong');
    strong.textContent = 'Minden rendben';
    const note = document.createElement('span');
    note.textContent = 'Az edződ panelján nincs rólad jelzés — tartsd a tempót.';
    text.append(strong, note);
    box.append(icon, text);
  }
  el.replaceChildren(box);
}

/** Az oldalsáv „Az edződ panelján" blokkja: szint-jelvény és stat-lista. */
function renderClientScore(block, me) {
  const tier = athleteTier(me.rating);
  const badge = $('[data-client-badge]', block);
  badge.className = `co-modal-badge co-tier--${tier.key}`;
  $('.co-modal-rating', badge).textContent = orDash(me.rating);
  $('.co-modal-tag', badge).textContent = me.goal ?? '—';
  $('[data-client-tier]', block).textContent =
    me.rating === null || me.rating === undefined
      ? tier.label
      : `${tier.label} · ${me.rating} pont`;
  renderStatList($('[data-client-stats]', block), me, ATHLETE_DETAIL_STATS);
}

/** „Vár rád": ami most a te lépésed. Minden sor a megfelelő fülre visz. */
function renderClientTodo(list, { offers, unread, meals }) {
  const left = meals.filter((meal) => !meal.eatenToday).length;
  const items = [
    offers > 0 && ['plan', `${offers} felajánlott terv vár a döntésedre`],
    unread > 0 && ['messages', `${unread} olvasatlan üzenet az edződtől`],
    left > 0 && ['nutrition', `Ma még ${left}/${meals.length} étkezés van hátra az étrendedből`],
  ].filter(Boolean);

  if (items.length === 0) {
    const li = document.createElement('li');
    li.className = 'co-client-todo-empty';
    li.textContent = 'Nincs teendőd — minden naprakész.';
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...items.map(([tab, text]) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'co-alert-item co-client-todo-item';
      button.dataset.clientGoto = tab;
      const label = document.createElement('span');
      label.textContent = text;
      const arrow = document.createElement('i');
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      button.append(label, arrow);
      li.appendChild(button);
      return li;
    }),
  );
}

/** Az érvényes napi cél, és hogy KI tűzte ki. */
function renderGoalText(goal) {
  if (!goal) return '—';
  const value = `${formatNumber(goal.calories)} kcal · ${formatNumber(goal.protein)} g fehérje`;
  if (goal.source === 'coach') {
    return `${value} — ${goal.setBy ?? 'az edződ'} tűzte ki, csak ő módosíthatja.`;
  }
  if (goal.source === 'own') {
    return `${value} — a saját célod. Az edződ még nem tűzött ki mást.`;
  }
  return `${value} — alapértelmezett cél. Az edződ még nem tűzött ki mást.`;
}

function renderWaterText(goal) {
  const waterMl = goal?.waterMl ?? null;
  return waterMl
    ? `${formatNumber(waterMl / 1000)} liter — az edződ tűzte ki, csak ő módosíthatja.`
    : 'Nincs edzői víz-cél — a célod a testsúlyodból számolódik (~33 ml/kg).';
}

/** Az edző étkezései a mai állapottal. A még meg nem evett kap „Megettem"
    gombot — ugyanaz a naplózás, mint a Táplálkozás oldalon. */
function renderClientMeals(list, meals) {
  list.replaceChildren(
    ...meals.map((meal) => {
      const li = document.createElement('li');
      li.className = 'co-meal';
      const head = document.createElement('div');
      head.className = 'co-meal-head';
      const info = document.createElement('div');
      info.className = 'co-meal-info';
      const name = document.createElement('span');
      name.className = 'co-meal-name';
      name.textContent = meal.name;
      const macros = document.createElement('span');
      macros.className = 'co-meal-macros';
      macros.textContent = meal.items
        .map((item) => `${item.name} ${formatNumber(item.grams)} g`)
        .join(' · ');
      info.append(name, macros);
      const kcal = document.createElement('span');
      kcal.className = 'co-meal-kcal';
      kcal.textContent = `${formatNumber(meal.kcal)} kcal`;
      head.append(info, kcal);

      if (meal.eatenToday) {
        const eaten = document.createElement('span');
        eaten.className = 'co-meal-eaten';
        eaten.textContent = 'Megvan';
        head.appendChild(eaten);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'co-invite-btn co-invite-btn--primary';
        button.dataset.clientMeal = meal.id;
        button.textContent = 'Megettem';
        button.setAttribute('aria-label', `${meal.name} naplózása a mai napra`);
        head.appendChild(button);
      }
      li.appendChild(head);
      return li;
    }),
  );
}

/** A hét napról napra: „H: Push · Sze: Pull" — a pihenőnap kimarad. */
const weekText = (offer) =>
  (offer.days ?? []).map((day) => `${DAY_LABELS[day]}: ${dayStatus(offer.week, day)}`).join(' · ');

/** Az aktív edzői terv: a legutóbb ELFOGADOTT ajánlat — a terv-követés is ehhez mér. */
function renderActivePlan(el, history) {
  const active = history.find((offer) => offer.status === 'accepted');
  if (!active) {
    const p = document.createElement('p');
    p.className = 'co-goal-state';
    p.textContent =
      'Még nem fogadtál el tervet az edződtől. Amíg nincs, a terv-követésed sem mérhető.';
    el.replaceChildren(p);
    return;
  }
  const box = document.createElement('div');
  box.className = 'co-invite co-client-plan';
  const info = document.createElement('div');
  info.className = 'co-invite-info';
  const name = document.createElement('span');
  name.className = 'co-invite-name';
  name.textContent = active.name;
  const meta = document.createElement('span');
  meta.className = 'co-invite-meta';
  meta.textContent = `${(active.days ?? []).length} edzésnap · elfogadva ${formatDay(active.respondedAt)}`;
  const week = document.createElement('span');
  week.className = 'co-invite-meta';
  week.textContent = weekText(active);
  info.append(name, meta, week);
  if (active.note) {
    const note = document.createElement('span');
    note.className = 'co-invite-note';
    note.textContent = `„${active.note}”`;
    info.appendChild(note);
  }
  const link = document.createElement('a');
  link.className = 'co-ghost-btn';
  link.href = '#plans';
  link.textContent = 'Tervek →';
  box.append(info, link);
  el.replaceChildren(box);
}

const formatDay = (iso) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('hu-HU');
};

const STATUS_LABELS = { accepted: 'Elfogadva', declined: 'Elutasítva' };

/** A korábbi, már megválaszolt ajánlatok. */
function renderPlanHistory(list, history) {
  list.replaceChildren(
    ...history.map((offer) => {
      const li = document.createElement('li');
      li.className = 'co-client-history-item';
      const name = document.createElement('span');
      name.className = 'co-client-history-name';
      name.textContent = offer.name;
      const date = document.createElement('span');
      date.className = 'co-client-history-date';
      date.textContent = formatDay(offer.respondedAt);
      const status = document.createElement('span');
      status.className = `co-client-history-status is-${offer.status}`;
      status.textContent = STATUS_LABELS[offer.status] ?? offer.status;
      li.append(name, date, status);
      return li;
    }),
  );
}

export {
  renderActivePlan,
  renderClientKpis,
  renderClientMeals,
  renderClientScore,
  renderClientStatus,
  renderClientTodo,
  renderGoalText,
  renderPlanHistory,
  renderWaterText,
};
