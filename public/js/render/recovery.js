/** A készenléti riport és a check-in skálák kirajzolása. */

import { $, $$, cloneTemplate } from '../core/dom.js';

/** A kilenc izomcsoport kulcsa és magyar címkéje — a szerver
    MUSCLE_GROUPS-ával azonos sorrendben (server/muscles.js). A check-in
    izomláz- és fájdalom-mezői ebből épülnek. */
const MUSCLE_GROUPS = [
  ['chest', 'Mell'], ['back', 'Hát'], ['shoulders', 'Váll'], ['arms', 'Karok'],
  ['quads', 'Quadriceps'], ['hamstrings', 'Hamstring'], ['glutes', 'Farizom'],
  ['calves', 'Vádli'], ['core', 'Törzs'],
];

/** A gyors check-in 1–5-ös skálái:
    [mező-név, rövid címke, [1-es végpont, 5-ös végpont], varázsló-kérdés].
    A negyedik elem CSAK a lépésenkénti varázslónak kell (ott a kérdés a
    képernyő címe); a Regeneráció oldal részletes űrlapja az első hármat
    használja. Egy táblában tartjuk, hogy a két felület ne sodródjon szét. */
const CHECKIN_SCALES = [
  ['sleepQuality', 'Alvásminőség', ['nagyon rossz', 'kiváló'], 'Milyen volt az alvásod?'],
  ['energy', 'Energiaszint', ['kimerült', 'tele energiával'], 'Mennyi energiád van ma?'],
  ['stress', 'Stresszszint', ['nyugodt', 'nagyon feszült'], 'Mennyire vagy feszült?'],
];

/** A részletes blokk közérzet-skálája (ugyanaz a komponens). */
const MOOD_SCALE = ['mood', 'Közérzet', ['beteg vagyok', 'remekül']];

/** Készenlét-sáv → állapot-kulcs. A CSS ebből színez (ok / warn / bad). */
const readinessTone = (value) => (value >= 80 ? 'ok' : value >= 60 ? 'warn' : 'bad');

const CONFIDENCE_LABELS = { high: 'Megbízható', medium: 'Közepes', low: 'Tájékoztató' };

/**
 * Egy 0–5 vagy 1–5 skála felépítése chip-csoportként. Az érték az
 * aria-pressed attribútumban él (a terv-építő nap-chipjeivel azonos minta),
 * így nincs a DOM mellett külön állapot, amit szinkronban kéne tartani.
 * A `null` érték érvényes: azt jelenti, hogy a felhasználó nem adta meg —
 * a motor ilyenkor újraosztja a súlyt.
 */
function buildScale({ name, label, min, max, hint }) {
  const scale = cloneTemplate('tpl-scale');
  scale.dataset.field = name;
  $('.rc-scale-label', scale).textContent = label;
  $('.rc-scale-hint', scale).textContent = hint ?? '';

  const chips = $('.rc-scale-chips', scale);
  chips.setAttribute('aria-label', label);
  for (let value = min; value <= max; value += 1) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'rc-chip';
    chip.textContent = String(value);
    chip.dataset.value = String(value);
    chip.setAttribute('aria-pressed', 'false');
    chip.setAttribute('aria-label', `${label}: ${value}`);
    chip.addEventListener('click', () => {
      // Az aktív chip újbóli megnyomása törli a választást — így egy
      // véletlen kattintás visszavonható „nem adtam meg" állapotra.
      const active = chip.getAttribute('aria-pressed') === 'true';
      $$('.rc-chip', chips).forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', String(!active));
    });
    chips.appendChild(chip);
  }
  return scale;
}

/** Egy chip-skála aktuális értéke, vagy null, ha nincs kiválasztva. */
const readScale = (scaleEl) => {
  const active = $('.rc-chip[aria-pressed="true"]', scaleEl);
  return active ? Number(active.dataset.value) : null;
};

/** Egy chip-skála beállítása (null → semmi sincs kiválasztva). */
const writeScale = (scaleEl, value) => {
  $$('.rc-chip', scaleEl).forEach((chip) => {
    chip.setAttribute('aria-pressed', String(value !== null && value !== undefined && Number(chip.dataset.value) === Number(value)));
  });
};

/** Egy 0–100 érték kiírása sávra: szélesség, ARIA és állapot-szín. */
function fillBar(barEl, value, label) {
  barEl.setAttribute('aria-valuenow', String(value));
  barEl.setAttribute('aria-label', `${label} — ${value}%`);
  barEl.dataset.tone = readinessTone(value);
  $('.pl-progress-fill', barEl).style.width = `${value}%`;
}

/* A készenlét NULL, ha a motornak nincs mire alapoznia (vadonatúj fiók: se
   check-in, se naplózott edzés). Ezt sem 0-nak, sem 100-nak nem szabad
   mutatni — előbbi „pihenj ma"-t, utóbbi „tökéletes állapot"-ot állítana
   ott, ahol semmit nem tudunk. (server/recovery.js) */
const NO_READINESS_TEXT = 'Még nincs elég adat a készenléthez — töltsd ki a napi check-int, '
  + 'vagy naplózz egy edzést.';

const hasReadiness = (value) => value !== null && value !== undefined;

/** A készenléti riport kirajzolása. A `report` a GET /api/readiness válasza. */
function renderRecovery(report) {
  const page = $('[data-page="recovery"]');
  if (!page || !report) return;

  // — Összesített pontszám + gyűrű —
  const overall = report.overall;
  const known = hasReadiness(overall);
  const ring = $('[data-rc-ring]');
  ring.style.setProperty('--readiness', known ? overall : 0);
  ring.dataset.tone = known ? readinessTone(overall) : 'none';
  ring.setAttribute('aria-label', known ? `${overall} pont készenlét` : 'Készenlét: nincs elég adat');
  $('.rc-score-num').textContent = known ? String(overall) : '—';

  $('[data-rc-verdict]').textContent = !known
    ? NO_READINESS_TEXT
    : overall >= 85
    ? 'Készen állsz — ma mehet a nehezebb edzés.'
    : overall >= 70
      ? 'Rendben vagy — tartsd a tervezett terhelést.'
      : overall >= 55
        ? 'Fáradt vagy — érdemes visszavenni a volumenből.'
        : 'A tested pihenést kér — ma inkább könnyű nap.';

  // — Megbízhatóság —
  const badge = $('[data-rc-confidence-badge]');
  badge.textContent = CONFIDENCE_LABELS[report.confidence] ?? report.confidence;
  badge.dataset.level = report.confidence;
  $('[data-rc-confidence-text]').textContent = report.confidenceNote ?? '';

  // — Sapkák (fájdalom, betegség) —
  const caps = $('[data-list="rc-caps"]');
  caps.replaceChildren();
  report.caps.forEach((text) => {
    const item = document.createElement('li');
    item.className = 'rc-cap';
    item.textContent = text;
    caps.appendChild(item);
  });
  caps.hidden = report.caps.length === 0;

  // — Komponens-bontás —
  const components = $('[data-list="rc-components"]');
  components.replaceChildren();
  report.components.forEach((component, index) => {
    const row = cloneTemplate('tpl-rc-component');
    row.style.setProperty('--i', index);
    row.classList.toggle('rc-component--absent', !component.present);
    $('.rc-component-label', row).textContent = component.label;
    $('.rc-component-weight', row).textContent = component.present ? `${component.weight}%` : 'nincs adat';
    $('.rc-component-value', row).textContent = component.present ? `${component.score}` : '—';
    fillBar($('.rc-bar', row), component.present ? component.score : 0, component.label);
    components.appendChild(row);
  });

  // — CNS —
  /* Null, ha nincs edzés-előzmény: a nulla terhelés ott üres napló, nem
     friss idegrendszer. */
  const cns = report.cns.readiness;
  $('[data-rc-cns]').textContent = hasReadiness(cns) ? String(cns) : '—';
  $('[data-rc-cns-note]').textContent = !hasReadiness(cns)
    ? 'Még nincs naplózott edzésed — ebből nem becsülhető idegrendszeri terhelés.'
    : cns >= 80
      ? 'Friss idegrendszer — a nehéz, alacsony ismétléses munka rendben van.'
      : cns >= 60
        ? 'Enyhén terhelt — kerüld a maximum-közeli szetteket.'
        : 'Terhelt idegrendszer — nehéz guggolás, felhúzás és PR-próbálkozás ma nem javasolt.';

  // — Izomcsoportok —
  const muscles = $('[data-list="rc-muscles"]');
  muscles.replaceChildren();
  report.muscles.forEach((muscle, index) => {
    const row = cloneTemplate('tpl-rc-muscle');
    row.style.setProperty('--i', index);
    $('.rc-muscle-label', row).textContent = muscle.label;
    /* A known jelző a motorból jön: hamis, ha se naplózott edzés, se
       bejelentett izomláz/fájdalom nincs mögötte. Ilyenkor a 100% nem
       eredmény, hanem az adat hiánya — nem is mutatjuk százaléknak. */
    $('.rc-muscle-value', row).textContent = muscle.known === false ? '—' : `${muscle.readiness}%`;
    fillBar($('.rc-bar', row), muscle.known === false ? 0 : muscle.readiness, muscle.label);

    // A meta-sor megmondja, mire épül a becslés — a szám így nem varázslat
    const meta = [];
    if (muscle.known === false) meta.push('még nincs adat');
    if (muscle.lastLoadedDaysAgo !== null) {
      meta.push(muscle.lastLoadedDaysAgo === 0 ? 'ma terhelted' : `${muscle.lastLoadedDaysAgo} napja terhelted`);
    }
    if (muscle.soreness !== null) meta.push(`izomláz ${muscle.soreness}/5`);
    if (muscle.pain !== null && muscle.pain > 0) meta.push(`fájdalom ${muscle.pain}/10`);
    $('.rc-muscle-meta', row).textContent = meta.join(' · ');
    muscles.appendChild(row);
  });

  // — Gyakorlat-ajánlások —
  const lifts = $('[data-list="rc-lifts"]');
  lifts.replaceChildren();
  report.exercises.forEach((lift, index) => {
    const item = cloneTemplate('tpl-rc-lift');
    item.style.setProperty('--i', index);
    item.dataset.verdict = lift.verdict;
    $('.rc-lift-name', item).textContent = lift.name;
    $('.rc-lift-score', item).textContent = `${lift.readiness}%`;
    $('.rc-lift-score', item).dataset.tone = readinessTone(lift.readiness);
    $('.rc-lift-text', item).textContent = lift.text;
    /* A bemondott erőfelmérésen alapuló ajánlás mögött nincs naplózott
       alkalom: se frissesség, se izomcsoport-szintű regeneráció. A szám az
       összesített készenlétre épül — ezt kimondjuk, mert a bemondás nem mérés. */
    const basisEl = $('[data-lift-basis]', item);
    basisEl.hidden = lift.basis !== 'declared';
    if (!basisEl.hidden) {
      basisEl.textContent = 'A bemondott erőfelmérésed alapján — a mai összesített készenlétedre mérve.';
    }

    $('[data-lift-load]', item).textContent = lift.loadDelta;
    $('[data-lift-volume]', item).textContent = lift.volumeDelta;
    lifts.appendChild(item);
  });
  $('[data-rc-lifts-empty]').hidden = report.exercises.length > 0;
}

/* ======================================================================
   7. Interakciók
   ====================================================================== */

export { CHECKIN_SCALES, CONFIDENCE_LABELS, MOOD_SCALE, MUSCLE_GROUPS, buildScale, hasReadiness, readScale, readinessTone, renderRecovery, writeScale };
