/** Az edzői panel elemei: KPI-sor, sportoló-lista, állapot, üzenetek, meghívók, terv-ajánlatok. */

import { DAY_LABELS } from '../core/constants.js';
import { $, cloneTemplate } from '../core/dom.js';
import { dayStatus } from '../core/plan-week.js';
import { CONFIDENCE_LABELS, hasReadiness } from './recovery.js';

/** Egy üzenet-buborék. A `me` a saját üzeneteket tolja jobbra — a szerver a
    néző szemszögéből jelöli meg őket (ld. messageNote). */
function createCoachNote({ meta, text, me = false }) {
  const article = cloneTemplate('tpl-coach-note');
  if (me) article.classList.add('co-note--me');
  $('.co-note-meta', article).textContent = meta;
  $('.co-note-text', article).textContent = text;
  return article;
}

/* ---- Edzői panel: sportoló-sorok ----
   A sorok VALÓDI sportolók valódi adatából épülnek (GET /api/athletes):
   az összpontszámot a szerver számolja (server/coaching.js) a készenlét és a
   terv-követés átlagaként, terv híján magából a készenlétből. A szint (arany
   ≥ 85, ezüst ≥ 70, alatta bronz) ebből jön.
   A sor azonosítója a KAPCSOLAT azonosítója: a sportoló belső id-jét a
   szerver nem is adja ki. */
const athleteTier = (rating) =>
  rating === null || rating === undefined
    ? // Nincs mérhető jel (se készenlét, se terv-követés) — ez nem „bronz"
      { key: 'none', label: 'Még nincs pontszám', short: 'Nincs pont' }
    : rating >= 85
      ? { key: 'gold', label: 'Arany szint', short: 'Arany' }
      : rating >= 70
        ? { key: 'silver', label: 'Ezüst szint', short: 'Ezüst' }
        : { key: 'bronze', label: 'Bronz szint', short: 'Bronz' };

/** Hiányzó érték helyén gondolatjel. A „még nincs adat" NEM nulla: terv
    nélkül nincs terv-követés, edzés nélkül nincs utolsó edzés. */
const orDash = (value) => (value === null || value === undefined ? '—' : value);

/** A trend csak akkor kerül a szám mellé, ha érdemi: pár pontos ingadozás
    zaj, attól nem kell nyilat rajzolni. */
const TREND_MIN = 10;

/** „75%", érdemi változásnál „75% ↓20" — az irány az utolsó két hét az
    előző kettőhöz mérve (a szerver számolja). */
const adherenceText = (a) => {
  if (a.adherence === null) return '—';
  const trend = a.adherenceTrend ?? 0;
  if (Math.abs(trend) < TREND_MIN) return `${a.adherence}%`;
  return `${a.adherence}% ${trend > 0 ? '↑' : '↓'}${Math.abs(trend)}`;
};

/** A kártyán megjelenő statok (címke + érték-képző) — a részletnézet bővebb listát mutat. */
const ATHLETE_CARD_STATS = [
  ['Készenlét', (a) => (hasReadiness(a.readiness) ? `${a.readiness}%` : '—')],
  ['Terv-követés', adherenceText],
  ['Sorozat', (a) => `${a.streak} nap`],
  ['Utolsó edzés', (a) => orDash(a.lastWorkout)],
];

/** A részletnézet bővebb stat-listája (a kártya statjai + extra mezők). A
    sportolói panel oldalsávja UGYANEZT mutatja — a sportoló pontosan azt
    látja magáról, amit az edzője.
    A megbízhatóság szándékosan itt van: napló nélküli fiókra a motor 100%
    készenlétet ad (nincs mit levonni), és enélkül az edző „arany szintnek"
    olvasná azt, ami valójában adathiány. */
const percentOrDash = (value) => (value == null ? '—' : `${value}%`);

const ATHLETE_DETAIL_STATS = [
  ...ATHLETE_CARD_STATS,
  ['Heti edzések', (a) => a.weekly],
  ['Aktív terv', (a) => orDash(a.plan)],
  // Az elmúlt 4 hét edzéseiből hány indult tervből — a többi szabad edzés
  ['Terv szerinti edzés', (a) => orDash(a.planWorkouts)],
  // A terv-követés bontása (csak az edző kiosztott tervére): hány ütemezett
  // napon edzett a kijelölt napon, és azokon mennyi szett / mennyire talált az RPE
  ['Jó napon elvégezve', (a) => orDash(a.adherenceDetail?.onDay)],
  ['Szett-teljesítés', (a) => percentOrDash(a.adherenceDetail?.sets)],
  ['RPE-egyezés', (a) => percentOrDash(a.adherenceDetail?.rpe)],
  ['Készenlét alapja', (a) => CONFIDENCE_LABELS[a.confidence] ?? '—'],
];

/** Egy stat-lista (`dl`) feltöltése — a részletnézet és a sportolói panel közös rajzolója. */
function renderStatList(dl, athlete, stats = ATHLETE_DETAIL_STATS) {
  dl.replaceChildren(
    ...stats.map(([label, getValue]) => {
      const stat = document.createElement('div');
      stat.className = 'co-modal-stat';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = getValue(athlete);
      stat.append(dt, dd);
      return stat;
    }),
  );
}

/** A sorban sávval is megjelenő százalékos statok. 50 alatt pirosak: ott már
    érdemes ránézni a sportolóra. */
const PERCENT_STATS = {
  Készenlét: (a) => (hasReadiness(a.readiness) ? a.readiness : null),
  'Terv-követés': (a) => a.adherence ?? null,
};
const LOW_THRESHOLD = 50;

function renderStat(label, athlete, getValue) {
  const stat = document.createElement('span');
  stat.className = 'co-stat';
  const labelEl = document.createElement('span');
  labelEl.className = 'co-stat-label';
  labelEl.textContent = label;
  const value = document.createElement('span');
  value.className = 'co-stat-val';
  value.textContent = getValue(athlete);
  stat.append(labelEl, value);

  const getPercent = PERCENT_STATS[label];
  if (getPercent) {
    const pct = getPercent(athlete);
    value.classList.toggle('is-empty', pct === null);
    value.classList.toggle('is-low', pct !== null && pct < LOW_THRESHOLD);
    const bar = document.createElement('span');
    bar.className = 'co-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.max(0, Math.min(100, pct ?? 0))}%`;
    bar.appendChild(fill);
    stat.appendChild(bar);
  } else {
    value.classList.toggle('is-empty', value.textContent === '—');
  }
  return stat;
}

function renderAthleteCard(athlete, index) {
  const card = cloneTemplate('tpl-athlete-card');
  const rating = athlete.rating;
  const tier = athleteTier(rating);

  card.classList.add(`co-tier--${tier.key}`);
  card.classList.toggle('is-alert', Boolean(athlete.alert));
  card.dataset.athlete = athlete.linkId;
  card.style.setProperty('--i', index);
  card.setAttribute(
    'aria-label',
    [
      rating === null
        ? `${athlete.name} — ${tier.label}`
        : `${athlete.name} — ${rating} pont, ${tier.label}`,
      athlete.alert ? 'figyelmet igényel' : null,
      athlete.unread > 0 ? `${athlete.unread} olvasatlan üzenet` : null,
      'részletek megnyitása',
    ]
      .filter(Boolean)
      .join(' — '),
  );

  const scoreEl = $('.co-score-num', card);
  scoreEl.textContent = orDash(rating);
  scoreEl.dataset.rating = orDash(rating);
  $('.co-score-tag', card).textContent = tier.short;
  $('.co-row-name', card).textContent = athlete.name;
  $('.co-badge--alert', card).hidden = !athlete.alert;

  /* Olvasatlan-jelvény. A darabszám a jelvényben látszik, a képernyőolvasó
     pedig a sor aria-label-jéből kapja meg — a jelvény maga aria-hidden,
     hogy a szám ne hangozzon el másodszor, kontextus nélkül. */
  const unreadEl = $('.co-row-unread', card);
  unreadEl.hidden = !athlete.unread;
  unreadEl.textContent = athlete.unread > 9 ? '9+' : String(athlete.unread);

  // A név alatti sor: a riasztás oka, ha van — különben a cél
  $('.co-who-sub', card).textContent =
    athlete.alert || athlete.goal || 'Még nincs adat — első edzésre vár';

  const stats = $('.co-stats', card);
  ATHLETE_CARD_STATS.forEach(([label, getValue]) =>
    stats.appendChild(renderStat(label, athlete, getValue)),
  );

  return card;
}

/** Egy meghívó-sor. A gombokat a hívó adja meg ({ label, action, variant }),
    mert a két irány mást kínál: a beérkezőt elfogadni/elutasítani lehet, a
    kiküldöttet visszavonni. A kattintást az Edző oldal delegálása kezeli. */
function renderInviteRow({ linkId, name, username }, actions) {
  const li = document.createElement('li');
  li.className = 'co-invite';

  const info = document.createElement('div');
  info.className = 'co-invite-info';
  const nameEl = document.createElement('span');
  nameEl.className = 'co-invite-name';
  nameEl.textContent = name;
  const metaEl = document.createElement('span');
  metaEl.className = 'co-invite-meta';
  metaEl.textContent = `@${username}`;
  info.append(nameEl, metaEl);

  const buttons = document.createElement('div');
  buttons.className = 'co-invite-actions';
  actions.forEach(({ label, action, variant }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `co-invite-btn${variant ? ` co-invite-btn--${variant}` : ''}`;
    button.dataset.inviteAction = action;
    button.dataset.linkId = linkId;
    button.textContent = label;
    buttons.appendChild(button);
  });

  li.append(info, buttons);
  return li;
}

/**
 * Egy felajánlott terv sora a sportoló oldalán. A meghívó-sorral azonos
 * alakú, de TÖBBET mond: a terv neve mellett ott a gyakorlatok száma és az
 * ütemezett napok is — a sportolónak látnia kell, MIT fogad el, mielőtt a
 * saját tervei közé kerül.
 */
function renderPlanOffer(offer) {
  const li = document.createElement('li');
  li.className = 'co-invite';

  const info = document.createElement('div');
  info.className = 'co-invite-info';
  const nameEl = document.createElement('span');
  nameEl.className = 'co-invite-name';
  nameEl.textContent = offer.name;

  const metaEl = document.createElement('span');
  metaEl.className = 'co-invite-meta';
  const days = offer.days ?? [];
  metaEl.textContent = [offer.from, `${days.length} edzésnap`].filter(Boolean).join(' · ');

  // A hét napról napra: „H: Push · Sze: Pull · P: = H" — a pihenőnap kimarad
  const weekEl = document.createElement('span');
  weekEl.className = 'co-invite-meta';
  weekEl.textContent = days
    .map((day) => `${DAY_LABELS[day]}: ${dayStatus(offer.week, day)}`)
    .join(' · ');
  info.append(nameEl, metaEl, weekEl);

  // Az edző kísérő sora, ha írt ilyet — külön sorban, idézve
  if (offer.note) {
    const noteEl = document.createElement('span');
    noteEl.className = 'co-invite-note';
    noteEl.textContent = `„${offer.note}”`;
    info.appendChild(noteEl);
  }

  const buttons = document.createElement('div');
  buttons.className = 'co-invite-actions';
  [
    { label: 'Elfogadás', action: 'accept-offer', variant: 'primary' },
    { label: 'Elutasítás', action: 'decline-offer' },
  ].forEach(({ label, action, variant }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `co-invite-btn${variant ? ` co-invite-btn--${variant}` : ''}`;
    button.dataset.offerAction = action;
    button.dataset.offerId = offer.id;
    button.textContent = label;
    buttons.appendChild(button);
  });

  li.append(info, buttons);
  return li;
}

/** Átlag a meglévő értékekből — a hiányzó adat nem nulla, kimarad. */
function average(values) {
  const present = values.filter((value) => value !== null && value !== undefined);
  return present.length
    ? Math.round(present.reduce((sum, value) => sum + value, 0) / present.length)
    : null;
}

/** A szűrők: mind / figyelmet igényel / terv szerint (nincs riasztás, és
    van mit pontozni). */
const ATHLETE_FILTERS = [
  ['all', 'Mind', () => true],
  ['alert', 'Figyelj rá', (a) => Boolean(a.alert)],
  ['ok', 'Terv szerint', (a) => !a.alert && a.rating !== null && a.rating !== undefined],
];

function kpi(label, value, unit, sub, modifier) {
  const el = document.createElement('div');
  el.className = 'co-kpi';
  const labelEl = document.createElement('p');
  labelEl.className = 'ds-eyebrow';
  labelEl.textContent = label;
  const valueEl = document.createElement('p');
  valueEl.className = 'co-kpi-value';
  const num = document.createElement('span');
  num.className = `co-kpi-num${modifier ? ` ${modifier}` : ''}`;
  num.textContent = value;
  const unitEl = document.createElement('span');
  unitEl.className = 'co-kpi-unit';
  unitEl.textContent = unit;
  valueEl.append(num, unitEl);
  const subEl = document.createElement('p');
  subEl.className = 'co-kpi-sub';
  subEl.textContent = sub;
  el.append(labelEl, valueEl, subEl);
  return el;
}

function renderCoachKpis(athletes) {
  const unread = athletes.reduce((sum, a) => sum + a.unread, 0);
  const readiness = average(athletes.map((a) => (hasReadiness(a.readiness) ? a.readiness : null)));
  const adherence = average(athletes.map((a) => a.adherence));
  const flagged = athletes.filter((a) => a.alert).length;

  $('[data-kpis]').replaceChildren(
    kpi(
      'Aktív sportolók',
      athletes.length,
      '',
      unread ? `${unread} olvasatlan üzenet` : 'nincs olvasatlan üzenet',
    ),
    kpi(
      'Átl. készenlét',
      orDash(readiness),
      readiness === null ? '' : '/100',
      readiness === null ? 'még nincs check-in' : 'a legutóbbi check-inekből',
      readiness === null ? 'is-empty' : '',
    ),
    kpi(
      'Átl. terv-követés',
      orDash(adherence),
      adherence === null ? '' : '%',
      adherence === null ? 'még nincs kiosztott terv' : 'jó nap · szett · RPE a terv szerint',
      adherence === null ? 'is-empty' : '',
    ),
    kpi(
      'Figyelmet igényel',
      flagged,
      '',
      flagged ? 'lásd a riasztásokat' : 'nincs sürgős teendő',
      flagged ? 'is-alert' : '',
    ),
  );
}

function renderCoachFilters(athletes, active) {
  $('[data-filters]').replaceChildren(
    ...ATHLETE_FILTERS.map(([key, label, test]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'co-filter';
      button.dataset.filter = key;
      button.setAttribute('aria-pressed', String(key === active));
      const count = document.createElement('span');
      count.className = 'co-filter-n';
      count.textContent = athletes.filter(test).length;
      button.append(label, count);
      return button;
    }),
  );
}

/** Állapot-blokk: „minden rendben", vagy a riasztások listája. A riasztás-
    sor a sportoló modálját nyitja (data-athlete). */
function renderCoachStatus(athletes) {
  const banner = $('[data-banner]');
  const flagged = athletes.filter((athlete) => athlete.alert);
  // Sportoló nélkül nincs mit összegezni — az üres állapot beszél helyette
  banner.hidden = athletes.length === 0;

  const icon = (text) => {
    const el = document.createElement('span');
    el.className = 'co-status-ico';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = text;
    return el;
  };

  if (flagged.length === 0) {
    const box = document.createElement('div');
    box.className = 'co-status';
    const text = document.createElement('span');
    text.className = 'co-status-text';
    const strong = document.createElement('strong');
    strong.textContent = 'Minden rendben';
    const note = document.createElement('span');
    note.textContent = 'Minden sportolód a terv szerint halad — nincs sürgős teendőd.';
    text.append(strong, note);
    box.append(icon('✓'), text);
    banner.replaceChildren(box);
    return;
  }

  const box = document.createElement('div');
  box.className = 'co-alerts';
  const head = document.createElement('div');
  head.className = 'co-alerts-head';
  head.append(icon('!'), `${flagged.length} sportoló figyelmet igényel`);
  box.appendChild(head);
  flagged.forEach((athlete) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'co-alert-item';
    button.dataset.athlete = athlete.linkId;
    button.setAttribute('aria-haspopup', 'dialog');
    const text = document.createElement('span');
    const name = document.createElement('b');
    name.textContent = athlete.name;
    const reason = document.createElement('small');
    reason.textContent = athlete.alert;
    text.append(name, reason);
    const arrow = document.createElement('i');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    button.append(text, arrow);
    box.appendChild(button);
  });
  banner.replaceChildren(box);
}

/** Legutóbbi üzenetek: a szálak utolsó üzenete, olvasatlan elöl. Egy sor a
    sportoló modálját nyitja — olvasatlannál az eleve nyitott szállal. */
function renderCoachMessages(athletes) {
  const withMessage = athletes
    .filter((athlete) => athlete.lastMessage)
    .sort((a, b) => b.unread - a.unread)
    .slice(0, 4);
  $('[data-messages-block]').hidden = withMessage.length === 0;
  $('[data-coach-messages]').replaceChildren(
    ...withMessage.map((athlete) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `co-msg-row${athlete.unread ? ' is-unread' : ''}`;
      button.dataset.athlete = athlete.linkId;
      button.setAttribute('aria-haspopup', 'dialog');
      const avatar = document.createElement('span');
      avatar.className = 'co-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.innerHTML = '<svg viewBox="0 0 24 24"><use href="#icon-user" /></svg>';
      const text = document.createElement('span');
      text.className = 'co-msg-text';
      const name = document.createElement('b');
      name.textContent = athlete.name;
      const body = document.createElement('span');
      body.textContent = `${athlete.lastMessage.mine ? 'Te: ' : ''}${athlete.lastMessage.text}`;
      text.append(name, body);
      button.append(avatar, text);
      if (athlete.unread) {
        const badge = document.createElement('span');
        badge.className = 'co-badge';
        badge.textContent = athlete.unread > 9 ? '9+' : String(athlete.unread);
        button.appendChild(badge);
      }
      return button;
    }),
  );
}

/** A sportoló-lista a szűrés és a névkeresés után. Hálózati hívás nélkül is
    újrarajzolható — a szűrőgombok és a keresőmező ezt hívják. */
function renderAthleteList(athletes, { filter = 'all', query = '' } = {}) {
  const test = (ATHLETE_FILTERS.find(([key]) => key === filter) ?? ATHLETE_FILTERS[0])[2];
  const q = query.trim().toLowerCase();
  const shown = athletes.filter((a) => test(a) && (!q || a.name.toLowerCase().includes(q)));

  renderCoachFilters(athletes, filter);
  $('[data-athlete-count]').textContent = `${shown.length}/${athletes.length}`;

  $('[data-list="athletes"]').replaceChildren(
    ...shown.map((athlete, index) => renderAthleteCard(athlete, index)),
  );

  const empty = $('[data-athletes-filtered-empty]');
  empty.hidden = athletes.length === 0 || shown.length > 0;
  empty.textContent = q
    ? `Nincs „${query.trim()}” nevű sportolód.`
    : filter === 'alert'
      ? 'Senki nem igényel figyelmet — szép munka.'
      : 'Még nincs olyan sportolód, akinek van pontszáma.';
}

/** Az edzői nézet feltöltése a lekért sportolókból. A payload a
    GET /api/athletes válasza: { athletes, invites }; a `view` a lista
    kliens-oldali szűrése ({ filter, query }). */
function renderCoachPanel({ athletes, invites }, view = {}) {
  const hasAthletes = athletes.length > 0;
  // Sportoló nélkül a KPI-sor, az eszközsáv és a táblázatfej helyett az üres
  // állapot magyarázza el, hogyan lesz sportolód.
  $('[data-kpis]').hidden = !hasAthletes;
  $('[data-athlete-tools]').hidden = !hasAthletes;
  $('[data-athlete-head]').hidden = !hasAthletes;
  $('[data-athlete-legend]').hidden = !hasAthletes;
  $('[data-athletes-empty]').hidden = hasAthletes;

  renderCoachKpis(athletes);
  renderCoachStatus(athletes);
  renderCoachMessages(athletes);
  renderAthleteList(athletes, view);

  const sent = $('[data-list="sent-invites"]');
  sent.replaceChildren();
  invites.forEach((invite) =>
    sent.appendChild(renderInviteRow(invite, [{ label: 'Visszavonás', action: 'cancel-invite' }])),
  );
}

export {
  ATHLETE_CARD_STATS,
  ATHLETE_DETAIL_STATS,
  athleteTier,
  createCoachNote,
  kpi,
  orDash,
  renderAthleteList,
  renderCoachPanel,
  renderInviteRow,
  renderPlanOffer,
  renderStatList,
};
