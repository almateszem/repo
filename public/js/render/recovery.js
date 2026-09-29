/** A készenléti riport és a check-in skálák kirajzolása. */

import { $, $$, cloneTemplate } from '../core/dom.js';
import {
  MAP_CANVAS,
  MAP_FIGURES,
  MAP_RINGS,
  MOBILE_COLUMNS,
  RC_SPARE_BELOW,
  componentSummary,
  muscleNote,
  ringDashOffset,
  ringState,
  spareList,
} from './recovery-map.js';

/** A tizenkét izomcsoport kulcsa és magyar címkéje — a szerver
    MUSCLE_GROUPS-ával azonos sorrendben (server/muscles.js). A check-in
    izomláz- és fájdalom-mezői ebből épülnek. */
const MUSCLE_GROUPS = [
  ['chest', 'Mell'],
  ['shoulders', 'Váll'],
  ['biceps', 'Bicepsz'],
  ['triceps', 'Tricepsz'],
  ['traps', 'Trapéz'],
  ['back', 'Hát'],
  ['lowerBack', 'Alsó hát'],
  ['core', 'Has / core'],
  ['quads', 'Quad'],
  ['hamstrings', 'Hamstring'],
  ['glutes', 'Farizom'],
  ['calves', 'Vádli'],
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
    chip.setAttribute(
      'aria-pressed',
      String(value !== null && value !== undefined && Number(chip.dataset.value) === Number(value)),
    );
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
const NO_READINESS_TEXT =
  'Még nincs elég adat a készenléthez — töltsd ki a napi check-int, ' + 'vagy naplózz egy edzést.';

const hasReadiness = (value) => value !== null && value !== undefined;

/** Egy jelző-pötty (izomláz / fájdalom) a „Ma kíméld" sorhoz és a
    gyűrűk alá. A felolvasó a címkét kapja, nem a színt. */
function dot(kind, label) {
  const el = document.createElement('span');
  el.className = `rc-dot rc-dot--${kind}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** Egy gyűrű SVG-csoportként az asztali vászonra: háttérkör, érték-ív,
    szám, címke, pöttyök. (cx, cy) a középpont a 848×700-as vásznon. */
function wideRing(muscle, { x, y }) {
  const state = ringState(muscle);
  const r = 34;
  const g = svgEl('g', { class: `rc-ring rc-ring--${state.tone}` });
  if (state.tone === 'none') {
    g.append(svgEl('circle', { class: 'rc-ring-empty', cx: x, cy: y, r }));
    const dash = svgEl('text', { class: 'rc-ring-num rc-ring-num--none', x, y: y + 8 });
    dash.textContent = '—';
    g.append(dash);
  } else {
    const circumference = 2 * Math.PI * r;
    g.append(svgEl('circle', { class: 'rc-ring-bg', cx: x, cy: y, r }));
    g.append(
      svgEl('circle', {
        class: 'rc-ring-fg',
        cx: x,
        cy: y,
        r,
        'stroke-dasharray': circumference.toFixed(2),
        'stroke-dashoffset': ringDashOffset(state.value, r).toFixed(2),
        transform: `rotate(-90 ${x} ${y})`,
      }),
    );
    const num = svgEl('text', { class: 'rc-ring-num', x, y: y + 8 });
    num.textContent = String(state.value);
    const pct = svgEl('tspan', { class: 'rc-ring-pct', dx: 2 });
    pct.textContent = '%';
    num.append(pct);
    g.append(num);
  }
  const label = svgEl('text', { class: 'rc-ring-label', x, y: y + r + 20 });
  label.textContent = muscle.label;
  g.append(label);
  if (state.tone === 'none') {
    const none = svgEl('text', { class: 'rc-ring-label rc-ring-label--none', x, y: y + r + 34 });
    none.textContent = 'Nincs adat';
    g.append(none);
  }
  const dots = [state.sore && 'sore', state.pain && 'pain'].filter(Boolean);
  dots.forEach((kind, i) => {
    const offset = (i - (dots.length - 1) / 2) * 13;
    g.append(
      svgEl('circle', {
        class: `rc-ring-dot rc-ring-dot--${kind}`,
        cx: x + offset,
        cy: y + r + 34,
        r: 4,
      }),
    );
  });
  g.setAttribute('aria-label', ringAria(muscle, state));
  g.setAttribute('role', 'img');
  return g;
}

/** A felolvasó szövege: név, érték vagy „nincs adat", jelzések. */
function ringAria(muscle, state) {
  const parts = [muscle.label, state.tone === 'none' ? 'nincs adat' : `${state.value}%`];
  if (state.sore) parts.push('izomláz');
  if (state.pain) parts.push('fájdalom');
  return parts.join(', ');
}

/** Egy gyűrű HTML-elemként (tablet / mobil oszlop). A `size` a pixelméret. */
function compactRing(muscle, size) {
  const state = ringState(muscle);
  const r = size / 2 - 3;
  const c = size / 2;
  const item = document.createElement('div');
  item.className = `rc-cring rc-ring--${state.tone}`;
  item.setAttribute('role', 'img');
  item.setAttribute('aria-label', ringAria(muscle, state));

  const box = document.createElement('div');
  box.className = 'rc-cring-box';
  box.style.width = box.style.height = `${size}px`;
  const svg = svgEl('svg', {
    width: size,
    height: size,
    viewBox: `0 0 ${size} ${size}`,
    'aria-hidden': 'true',
  });
  if (state.tone === 'none') {
    svg.append(svgEl('circle', { class: 'rc-ring-empty', cx: c, cy: c, r }));
  } else {
    svg.append(svgEl('circle', { class: 'rc-ring-bg', cx: c, cy: c, r }));
    svg.append(
      svgEl('circle', {
        class: 'rc-ring-fg',
        cx: c,
        cy: c,
        r,
        'stroke-dasharray': (2 * Math.PI * r).toFixed(2),
        'stroke-dashoffset': ringDashOffset(state.value, r).toFixed(2),
        transform: `rotate(-90 ${c} ${c})`,
      }),
    );
  }
  const num = document.createElement('span');
  num.className = 'rc-cring-num';
  num.textContent = state.tone === 'none' ? '—' : String(state.value);
  if (state.tone !== 'none') {
    const pct = document.createElement('span');
    pct.className = 'rc-cring-pct';
    pct.textContent = '%';
    num.append(pct);
  }
  box.append(svg, num);

  const label = document.createElement('span');
  label.className = 'rc-cring-label';
  label.textContent = muscle.label;
  const dots = document.createElement('span');
  dots.className = 'rc-cring-dots';
  if (state.sore) dots.append(dot('sore', 'izomláz'));
  if (state.pain) dots.append(dot('pain', 'fájdalom'));
  item.append(box, label, dots);
  return item;
}

function figureImg(view) {
  const img = document.createElement('img');
  img.className = 'rc-figure';
  img.src = `img/body-${view}.svg`;
  img.alt = view === 'front' ? 'Elülső izomcsoportok' : 'Hátsó izomcsoportok';
  return img;
}

function ringColumn(keys, byKey, size) {
  const col = document.createElement('div');
  col.className = 'rc-map-col';
  keys.forEach((key) => col.append(compactRing(byKey.get(key), size)));
  return col;
}

/** Az izomtérkép mindhárom változata (asztali / tablet / mobil). */
function renderMuscleMap(muscles, view = 'front') {
  const host = $('[data-rc-map]');
  if (!host) return;
  const byKey = new Map(muscles.map((muscle) => [muscle.key, muscle]));

  // — Asztali: egy skálázódó SVG —
  const wide = svgEl('svg', {
    class: 'rc-map-wide',
    viewBox: `0 0 ${MAP_CANVAS.width} ${MAP_CANVAS.height}`,
    role: 'group',
    'aria-label': 'Izomcsoportok regenerációja — elöl és hátul',
  });
  for (const side of ['front', 'back']) {
    const f = MAP_FIGURES[side];
    wide.append(
      svgEl('image', {
        href: `img/body-${side}.svg`,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
      }),
    );
    const caption = svgEl('text', { class: 'rc-map-caption', x: f.x + f.width / 2, y: f.labelY });
    caption.textContent = side === 'front' ? 'Elöl' : 'Hátul';
    wide.append(caption);
  }
  const lines = svgEl('g', { class: 'rc-map-lines', 'aria-hidden': 'true' });
  for (const ring of [...MAP_RINGS.front, ...MAP_RINGS.back]) {
    const [x1, y1, x2, y2] = ring.line;
    lines.append(svgEl('line', { x1, y1, x2, y2 }));
    lines.append(svgEl('circle', { class: 'rc-map-anchor', cx: x2, cy: y2, r: 2.5 }));
  }
  wide.append(lines);
  for (const ring of [...MAP_RINGS.front, ...MAP_RINGS.back]) {
    wide.append(wideRing(byKey.get(ring.key), ring));
  }

  // — Tablet: elöl-oszlop | két figura | hátul-oszlop —
  const split = document.createElement('div');
  split.className = 'rc-map-split';
  const figures = ['front', 'back'].map((side) => {
    const fig = document.createElement('figure');
    fig.className = 'rc-map-figure';
    const caption = document.createElement('figcaption');
    caption.textContent = side === 'front' ? 'Elöl' : 'Hátul';
    fig.append(figureImg(side), caption);
    return fig;
  });
  split.append(
    ringColumn(
      MAP_RINGS.front.map((r) => r.key),
      byKey,
      68,
    ),
    ...figures,
    ringColumn(
      MAP_RINGS.back.map((r) => r.key),
      byKey,
      56,
    ),
  );

  // — Mobil: egy nézet, a figura két oldalán —
  const tabbed = document.createElement('div');
  tabbed.className = 'rc-map-tabbed';
  const figure = document.createElement('div');
  figure.className = 'rc-map-figure';
  figure.append(figureImg(view));
  tabbed.append(
    ringColumn(MOBILE_COLUMNS[view].left, byKey, 60),
    figure,
    ringColumn(MOBILE_COLUMNS[view].right, byKey, 60),
  );

  host.replaceChildren(wide, split, tabbed);
}

/** A készenléti riport kirajzolása. A `report` a GET /api/readiness válasza. */
function renderRecovery(report) {
  const page = $('[data-page="recovery"]');
  if (!page || !report) return;
  page.rcReport = report;

  // — Összesített pontszám —
  const overall = report.overall;
  const known = hasReadiness(overall);
  $('[data-rc-score]').textContent = known ? String(overall) : '—';

  $('[data-rc-verdict]').textContent = !known
    ? NO_READINESS_TEXT
    : overall >= 85
      ? 'Készen állsz — ma mehet a nehezebb edzés.'
      : overall >= 70
        ? 'Rendben vagy — tartsd a tervezett terhelést.'
        : overall >= 55
          ? 'Fáradt vagy — érdemes visszavenni a volumenből.'
          : 'A tested pihenést kér — ma inkább könnyű nap.';

  /* Mi húz vissza: csak ha a nap NEM „készen állsz" — ott nincs mit indokolni.
     A szám a komponens saját 0–100-as pontszáma, nem a hozzájárulása.
     Sapkás napon rejtve: ott a számot a sapka állította (pl. fájdalom), amit
     a komponens-lista nem ismer — a sor egy ártatlan komponenst nevezne meg,
     az okot pedig úgyis kimondja a sapkák listája. */
  const limiter = $('[data-rc-limiter]');
  const limiting = report.limiting;
  limiter.hidden = !known || overall >= 85 || !limiting || report.caps.length > 0;
  limiter.textContent = limiter.hidden
    ? ''
    : `Leginkább visszahúz: ${limiting.label} (${limiting.score})`;

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

  // — Miből jön a pontszám —
  const { present, missing } = componentSummary(report.components);
  const components = $('[data-list="rc-components"]');
  components.replaceChildren();
  present.forEach((component, index) => {
    const row = cloneTemplate('tpl-rc-component');
    row.style.setProperty('--i', index);
    row.style.setProperty('--value', component.score);
    row.dataset.tone = component.score >= 80 ? 'ok' : 'rest';
    $('.rc-comp-label', row).textContent = component.label;
    $('.rc-comp-value', row).textContent = String(component.score);
    $('.rc-comp-weight', row).textContent = `Súly ${component.weight}%`;
    const note = component.key === 'muscle' ? muscleNote(report.muscles) : null;
    const noteEl = $('.rc-comp-note', row);
    noteEl.hidden = !note;
    noteEl.textContent = note ?? '';
    components.appendChild(row);
  });
  const missingEl = $('[data-rc-comps-missing]');
  missingEl.hidden = missing.length === 0;
  $('[data-rc-comps-missing-text]').textContent = missing.length
    ? `Nincs adat: ${missing.map((label) => label.toLowerCase()).join(', ')}`
    : '';
  // Mobilon összecsukva ez az egy sor látszik a bontásból.
  $('[data-rc-comps-summary]').textContent = present
    .map((component) => `${component.label} ${component.score}`)
    .join(' · ');

  // — Ma kíméld —
  const spare = spareList(report.muscles);
  const spareEl = $('[data-list="rc-spare"]');
  spareEl.replaceChildren();
  spare.forEach((row) => {
    const item = document.createElement('li');
    item.className = 'rc-spare-row';
    const name = document.createElement('span');
    name.className = 'rc-spare-name';
    name.textContent = row.label;
    if (row.sore) name.append(dot('sore', 'izomláz'));
    if (row.pain) name.append(dot('pain', 'fájdalom'));
    const value = document.createElement('span');
    value.className = 'rc-spare-value';
    value.textContent = `${row.readiness}%`;
    const bar = document.createElement('span');
    bar.className = 'rc-spare-bar';
    const fill = document.createElement('span');
    fill.className = 'rc-spare-fill';
    fill.style.width = `${row.readiness}%`;
    bar.append(fill);
    item.append(name, value, bar);
    spareEl.appendChild(item);
  });
  $('[data-rc-spare]').hidden = spare.length === 0;
  $('[data-rc-spare-note]').textContent =
    `${RC_SPARE_BELOW}% alatt ezeket ma ne terheld intenzíven.`;

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
      meta.push(
        muscle.lastLoadedDaysAgo === 0
          ? 'ma terhelted'
          : `${muscle.lastLoadedDaysAgo} napja terhelted`,
      );
    }
    if (muscle.soreness !== null) meta.push(`izomláz ${muscle.soreness}/10`);
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
      basisEl.textContent =
        'A bemondott erőfelmérésed alapján — a mai összesített készenlétedre mérve.';
    }

    $('[data-lift-load]', item).textContent = lift.loadDelta;
    $('[data-lift-volume]', item).textContent = lift.volumeDelta;
    lifts.appendChild(item);
  });
  $('[data-rc-lifts-empty]').hidden = report.exercises.length > 0;

  // — Izomtérkép —
  renderMuscleMap(report.muscles, page.dataset.rcView ?? 'front');
}

/* ======================================================================
   7. Interakciók
   ====================================================================== */

export {
  CHECKIN_SCALES,
  CONFIDENCE_LABELS,
  MOOD_SCALE,
  MUSCLE_GROUPS,
  buildScale,
  hasReadiness,
  readScale,
  readinessTone,
  renderMuscleMap,
  renderRecovery,
  writeScale,
};
