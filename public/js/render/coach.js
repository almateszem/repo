/** Az edzői panel elemei: sportoló-kártyák, meghívók, terv-ajánlatok. */

import { DAY_LABELS } from '../core/constants.js';
import { $, cloneTemplate } from '../core/dom.js';
import { hasReadiness } from './recovery.js';

/** Egy üzenet-buborék. A `me` a saját üzeneteket tolja jobbra — a szerver a
    néző szemszögéből jelöli meg őket (ld. messageNote). */
function createCoachNote({ meta, text, me = false }) {
  const article = cloneTemplate('tpl-coach-note');
  if (me) article.classList.add('co-note--me');
  $('.co-note-meta', article).textContent = meta;
  $('.co-note-text', article).textContent = text;
  return article;
}

/* ---- Edzői panel: állapot-sáv + sportoló-kártyák ----
   A kártyák VALÓDI sportolók valódi adatából épülnek (GET /api/athletes):
   az összpontszámot a szerver számolja (server/coaching.js) a készenlét és a
   terv-követés átlagaként, terv híján magából a készenlétből. A szint (arany
   ≥ 85, ezüst ≥ 70, alatta bronz) ebből jön — FIFA-kártya ihletésű megjelenés.
   A kártya azonosítója a KAPCSOLAT azonosítója: a sportoló belső id-jét a
   szerver nem is adja ki. */
const athleteTier = (rating) => (rating >= 85
  ? { key: 'gold', label: 'Arany szint' }
  : rating >= 70
    ? { key: 'silver', label: 'Ezüst szint' }
    : { key: 'bronze', label: 'Bronz szint' });

/** Hiányzó érték helyén gondolatjel. A „még nincs adat" NEM nulla: terv
    nélkül nincs terv-követés, edzés nélkül nincs utolsó edzés. */
const orDash = (value) => (value === null || value === undefined ? '—' : value);

/** A kártyán megjelenő statok (címke + érték-képző) — a modál bővebb listát mutat. */
const ATHLETE_CARD_STATS = [
  ['Készenlét', (a) => (hasReadiness(a.readiness) ? `${a.readiness}%` : '—')],
  ['Terv-követés', (a) => (a.adherence === null ? '—' : `${a.adherence}%`)],
  ['Sorozat', (a) => `${a.streak} nap`],
  ['Utolsó edzés', (a) => orDash(a.lastWorkout)],
];

function renderAthleteCard(athlete, index) {
  const card = cloneTemplate('tpl-athlete-card');
  const rating = athlete.rating;
  const tier = athleteTier(rating);

  card.classList.add(`co-tier--${tier.key}`);
  card.dataset.athlete = athlete.linkId;
  card.style.setProperty('--i', index);
  card.setAttribute('aria-label', [
    `${athlete.name} — ${rating} pont, ${tier.label}`,
    athlete.alert ? 'figyelmet igényel' : null,
    athlete.unread > 0 ? `${athlete.unread} olvasatlan üzenet` : null,
    'részletek megnyitása',
  ].filter(Boolean).join(' — '));

  const ratingEl = $('.co-card-rating', card);
  ratingEl.textContent = rating;
  ratingEl.dataset.rating = rating;
  $('.co-card-tag', card).textContent = athlete.goal ?? '—';
  $('.co-card-name', card).textContent = athlete.name;
  $('.co-card-alert', card).hidden = !athlete.alert;

  /* Olvasatlan-jelvény. A darabszám a jelvényben látszik, a képernyőolvasó
     pedig a kártya aria-label-jéből kapja meg — a jelvény maga aria-hidden,
     hogy a szám ne hangozzon el másodszor, kontextus nélkül. */
  const unreadEl = $('.co-card-unread', card);
  unreadEl.hidden = !athlete.unread;
  unreadEl.textContent = athlete.unread > 9 ? '9+' : String(athlete.unread);

  /* A szál utolsó üzenete idézve: az edző így a kártyáról látja, hol tart a
     beszélgetés. Olvasatlan hátraléknál kiemelve. */
  const msgEl = $('.co-card-msg', card);
  msgEl.hidden = !athlete.lastMessage;
  if (athlete.lastMessage) {
    const who = athlete.lastMessage.mine ? 'Te' : athlete.name.split(' ')[0];
    msgEl.textContent = `${who}: ${athlete.lastMessage.text}`;
    msgEl.classList.toggle('co-card-msg--unread', athlete.unread > 0);
  }

  const stats = $('.co-card-stats', card);
  ATHLETE_CARD_STATS.forEach(([label, getValue]) => {
    const stat = document.createElement('span');
    stat.className = 'co-card-stat';
    const value = document.createElement('span');
    value.className = 'co-card-stat-value';
    value.textContent = getValue(athlete);
    const labelEl = document.createElement('span');
    labelEl.className = 'co-card-stat-label';
    labelEl.textContent = label;
    stat.append(value, labelEl);
    stats.appendChild(stat);
  });

  return card;
}

/** Egy meghívó-sor. A gombokat a hívó adja meg ({ label, action, variant }),
    mert a két irány mást kínál: a beérkezőt elfogadni/elutasítani lehet, a
    kiküldöttet visszavonni. A kattintást az Edző oldal delegálása kezeli. */
function renderInviteRow({ linkId, name, username, goal }, actions) {
  const li = document.createElement('li');
  li.className = 'co-invite';

  const info = document.createElement('div');
  info.className = 'co-invite-info';
  const nameEl = document.createElement('span');
  nameEl.className = 'co-invite-name';
  nameEl.textContent = name;
  const metaEl = document.createElement('span');
  metaEl.className = 'co-invite-meta';
  metaEl.textContent = goal ? `@${username} · ${goal}` : `@${username}`;
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
  const days = (offer.days ?? []).map((day) => DAY_LABELS[day]).filter(Boolean);
  metaEl.textContent = [
    offer.from,
    `${offer.exercises.length} gyakorlat`,
    days.length ? days.join(', ') : null,
  ].filter(Boolean).join(' · ');
  info.append(nameEl, metaEl);

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

/** Állapot-sáv + kártya-rács feltöltése a lekért sportolókból. A payload a
    GET /api/athletes válasza: { athletes, invites }. */
function renderCoachPanel({ athletes, invites }) {
  $('[data-athlete-count]').textContent = athletes.length;

  const banner = $('[data-banner]');
  const icon = $('.co-banner-icon', banner);
  const title = $('.co-banner-title', banner);
  const alertList = $('[data-list="alerts"]');
  const okText = $('.co-banner-ok-text', banner);
  const flagged = athletes.filter((athlete) => athlete.alert);

  // Sportoló nélkül nincs mit összegezni — a sáv és a rács helyett az
  // üres állapot magyarázza el, hogyan lesz sportolód.
  banner.hidden = athletes.length === 0;
  $('[data-athletes-empty]').hidden = athletes.length > 0;

  banner.classList.toggle('co-banner--alert', flagged.length > 0);
  banner.classList.toggle('co-banner--ok', flagged.length === 0);
  alertList.replaceChildren();

  if (flagged.length > 0) {
    icon.textContent = '!';
    title.textContent = `${flagged.length} sportoló figyelmet igényel`;
    okText.hidden = true;
    flagged.forEach((athlete) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'co-banner-item';
      button.dataset.athlete = athlete.linkId;
      button.setAttribute('aria-haspopup', 'dialog');

      const name = document.createElement('span');
      name.className = 'co-banner-name';
      name.textContent = athlete.name;
      const reason = document.createElement('span');
      reason.className = 'co-banner-reason';
      reason.textContent = athlete.alert;

      button.append(name, reason);
      li.appendChild(button);
      alertList.appendChild(li);
    });
  } else {
    icon.textContent = '✓';
    title.textContent = 'Minden rendben';
    okText.hidden = false;
  }

  const grid = $('[data-list="athletes"]');
  grid.replaceChildren(); // újrahíváskor se duplázódjanak a kártyák
  athletes.forEach((athlete, index) => grid.appendChild(renderAthleteCard(athlete, index)));

  const sent = $('[data-list="sent-invites"]');
  sent.replaceChildren();
  invites.forEach((invite) => sent.appendChild(renderInviteRow(invite, [
    { label: 'Visszavonás', action: 'cancel-invite' },
  ])));
}

export { ATHLETE_CARD_STATS, athleteTier, createCoachNote, orDash, renderCoachPanel, renderInviteRow, renderPlanOffer };
