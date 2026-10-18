/**
 * Podium — az edzői és a sportolói nézet közös építőkockái
 * ------------------------------------------------------------------------
 * A szint-jelvény, a stat-listák, a KPI-csempe, a trend-küszöb és a
 * terv-ajánlat info-blokkja: az edző panelja (render/coach.js) és a
 * sportolói nézet (render/coach-client.js) UGYANEZT rajzolja — a sportoló
 * pontosan azt látja magáról, amit az edzője.
 */
import { dayLabel, dayStatus } from '../core/plan-week.js';
import { CONFIDENCE_LABELS, hasReadiness } from './recovery.js';

/* ---- Edzői panel: sportoló-sorok ----
   A sorok VALÓDI sportolók valódi adatából épülnek (GET /api/athletes):
   az összpontszámot a szerver számolja (server/coaching.js) a készenlét és a
   terv-követés átlagaként, terv híján magából a készenlétből. A szint (arany
   ≥ 85, ezüst ≥ 70, alatta bronz) ebből jön.
   A sor azonosítója a KAPCSOLAT azonosítója: a sportoló belső id-jét a
   szerver nem is adja ki. */
export const athleteTier = (rating, confidence = null) =>
  rating === null || rating === undefined
    ? // Nincs mérhető jel (se készenlét, se terv-követés) — ez nem „bronz"
      { key: 'none', label: 'Még nincs pontszám', short: 'Nincs pont' }
    : confidence === 'low'
      ? /* Kevés napló: a motor általános referenciával számol, a magas szám
           így nem „arany" teljesítmény, hanem adathiány. A pontszám marad,
           de szint nem jár hozzá. */
        { key: 'none', label: 'Kevés adat', short: 'Kevés adat' }
      : rating >= 85
        ? { key: 'gold', label: 'Arany szint', short: 'Arany' }
        : rating >= 70
          ? { key: 'silver', label: 'Ezüst szint', short: 'Ezüst' }
          : { key: 'bronze', label: 'Bronz szint', short: 'Bronz' };

/** Hiányzó érték helyén gondolatjel. A „még nincs adat" NEM nulla: terv
    nélkül nincs terv-követés, edzés nélkül nincs utolsó edzés. */
export const orDash = (value) => (value === null || value === undefined ? '—' : value);

/** A trend csak akkor kerül a szám mellé, ha érdemi: pár pontos ingadozás
    zaj, attól nem kell nyilat rajzolni. */
export const TREND_MIN = 10;

/** „75%", érdemi változásnál „75% ↓20" — az irány az utolsó két hét az
    előző kettőhöz mérve (a szerver számolja). */
const adherenceText = (a) => {
  if (a.adherence === null) return '—';
  const trend = a.adherenceTrend ?? 0;
  if (Math.abs(trend) < TREND_MIN) return `${a.adherence}%`;
  return `${a.adherence}% ${trend > 0 ? '↑' : '↓'}${Math.abs(trend)}`;
};

/** A kártyán megjelenő statok (címke + érték-képző) — a részletnézet bővebb listát mutat. */
export const ATHLETE_CARD_STATS = [
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

export const ATHLETE_DETAIL_STATS = [
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
export function renderStatList(dl, athlete, stats = ATHLETE_DETAIL_STATS) {
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

export function kpi(label, value, unit, sub, modifier) {
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

/** A hét napról napra: „H: Push · Sze: Pull · P: = H" — a pihenőnap kimarad. */
const weekText = (offer) =>
  (offer.days ?? []).map((day) => `${dayLabel(day)}: ${dayStatus(offer.week, day)}`).join(' · ');

/** Egy terv-ajánlat info-blokkja: név, a `meta` sor, a hét napról napra és
    az edző kísérő sora (ha írt ilyet — külön sorban, idézve). */
export function planInfoEl(offer, meta) {
  const info = document.createElement('div');
  info.className = 'co-invite-info';
  const name = document.createElement('span');
  name.className = 'co-invite-name';
  name.textContent = offer.name;
  const metaEl = document.createElement('span');
  metaEl.className = 'co-invite-meta';
  metaEl.textContent = meta;
  const week = document.createElement('span');
  week.className = 'co-invite-meta';
  week.textContent = weekText(offer);
  info.append(name, metaEl, week);
  if (offer.note) {
    const note = document.createElement('span');
    note.className = 'co-invite-note';
    note.textContent = `„${offer.note}”`;
    info.appendChild(note);
  }
  return info;
}
