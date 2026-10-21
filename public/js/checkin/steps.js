/**
 * Podium — a check-in választós lépései
 * ------------------------------------------------------------------------
 * Bevezető, kapuk (izomláz / fájdalom), 1–5-ös skálák, testtérkép és az
 * összegzés. A számbeviteli lépések (alvás, testsúly) a steps-input.js-ben.
 */

import { api } from '../shared/api.js';
import { $, $$, cloneTemplate } from '../shared/dom.js';
import { shared } from '../shared/page-hooks.js';
import { navigate, setOnboardingLock } from '../app/router.js';
import {
  CI_ADVANCE_MS,
  CI_GATES,
  CI_MAP_MODES,
  CI_PAIN_BLOCK,
  CI_READINESS_VERDICTS,
  CI_SCALE_STEPS,
  ci,
  ciDateStr,
  ciMuscleLabel,
} from './session.js';
import { CHECKIN_SCALES, readinessTone } from '../shared/readiness.js';
import { createBodyMap } from '../recovery/bodymap.js';
import { animateNumber, formatNumber, formatWhole } from '../shared/format.js';

/* ======================================================================
   Bevezető
   ====================================================================== */

/** A varázsló nyitólépése — köszöntés és a kezdés gomb. */

function renderIntro(nav) {
  const step = cloneTemplate('tpl-ci-intro');
  $('[data-ci-date]', step).textContent = ciDateStr();
  // Félbehagyott munkamenetnél a „Kezdés" félrevezető lenne.
  if (ci.hadCheckin) $('[data-ci-start-label]', step).textContent = 'Folytatás';
  if (shared.onboardingLock) applyOnboardingIntro(step);
  return applyIntroActions(step, nav);
}

/* Az első check-in introja. Ugyanaz a sablon, más szöveg: itt még nem
   „napi rutin" a dolog, hanem az egyetlen út befelé — a kezdőnek azt kell
   megértenie, MIÉRT kérdezünk, mielőtt bármit kitöltene. */
function applyOnboardingIntro(step) {
  // Csak a felvezető szó cserélődik — a dátum-span a helyén marad.
  $('.ci-eyebrow', step).firstChild.nodeValue = 'Első lépés · ';
  $('.ci-display', step).replaceChildren('Kezdjük', document.createElement('br'), 'a készenléttel');
  $('.ci-lead', step).textContent = 'Pár gyors kérdés, ebből számolunk készenlétet.';
  $('.ci-footnote', step).textContent = 'Az adataid csak hozzád tartoznak.';

  /* A „Mégse" itt sehová nem vezetne: az app többi oldala zárva van. A fő
     kiút ezért a lenti „Most kihagyom", a másodlagos a kijelentkezés (a
     #checkin-en nincs se beállítás-, se kilépés-gomb, azok a fejlécben ülnek,
     amit a zár elrejt). */
  const exit = $('.ci-exit', step);
  exit.textContent = 'Kijelentkezés';
  exit.href = '#';
  exit.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      await api.logout();
    } catch {
      /* a kilépést akkor is bevisszük */
    }
    window.location.reload();
  });

  /* Aki most nem akar check-int (pl. edző, aki csak a sportolóit kezelné),
     az erre a munkamenetre továbbléphet. Nem tartós: újratöltéskor a szerver
     `onboarding` jelzője visszahozza a varázslót, amíg nincs első check-in. */
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'ci-skip';
  skip.textContent = 'Most kihagyom';
  skip.addEventListener('click', () => {
    setOnboardingLock(false);
    navigate('dashboard');
  });
  exit.before(skip);
}

/** Az intro gombjának bekötése — a két ág után közös. */
function applyIntroActions(step, nav) {
  $('[data-action="checkin-next"]', step).addEventListener('click', () => nav.goNext());
  return step;
}

/* ======================================================================
   Kapuk
   ====================================================================== */

/** Kapu-lépések: van-e izomláz / fájdalom. A válasz dönti el a következő lépést. */

/* ---- Kapuk ---- */

function renderGate(stepName, nav) {
  const gate = CI_GATES[stepName];
  const step = cloneTemplate('tpl-ci-gate');
  $('[data-ci-eyebrow]', step).textContent = gate.eyebrow;
  $('[data-ci-title]', step).textContent = gate.title;
  $('[data-ci-sub]', step).textContent = gate.sub;

  const wrap = $('[data-ci-gates]', step);
  [
    ['no', 'ok'],
    ['yes', 'accent'],
  ].forEach(([answer, tone]) => {
    const [label, sub] = gate[answer];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ci-gate';
    btn.dataset.tone = tone;
    btn.setAttribute('aria-pressed', String(ci.gates[gate.key] === answer));

    const title = document.createElement('span');
    title.className = 'ci-gate-label';
    title.textContent = label;
    btn.append(title);
    if (sub) {
      const note = document.createElement('span');
      note.className = 'ci-gate-sub';
      note.textContent = sub;
      btn.append(note);
    }

    btn.addEventListener('click', () => {
      ci.gates[gate.key] = answer;
      ci.dirty = true;
      // A „nincs" válasz törli a korábban megjelölt értékeket is —
      // különben egy meggondolt válasz némán hagyná bent őket.
      if (answer === 'no') ci.answers[gate.key === 'sore' ? 'soreness' : 'pain'] = {};
      // A sorrend most már tartalmazza (vagy nem) a térkép-lépést.
      nav.goNext();
    });
    wrap.appendChild(btn);
  });
  return step;
}

/* ======================================================================
   Skálák
   ====================================================================== */

/** 1–5 skálák (alvásminőség, energia, stressz) — egy renderelő mindháromnak. */

/* ---- 1–5 skálák ---- */

function renderScale(stepName, nav) {
  const field = CI_SCALE_STEPS[stepName];
  const [, , [low, high], question] = CHECKIN_SCALES.find(([name]) => name === field);

  const step = cloneTemplate('tpl-ci-scale');
  $('[data-ci-title]', step).textContent = question;
  $('[data-ci-low]', step).textContent = `1 · ${low}`;
  $('[data-ci-high]', step).textContent = `5 · ${high}`;

  const group = $('[data-ci-scale]', step);
  group.setAttribute('aria-label', question);
  const nextBtn = $('[data-action="checkin-next"]', step);

  const syncButtons = () => {
    $$('button', group).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === ci.answers[field]));
    });
    nextBtn.disabled = ci.answers[field] === null;
  };

  const choose = (value, { auto }) => {
    ci.answers[field] = value;
    ci.dirty = true;
    syncButtons();
    if (auto) nav.advanceSoon(CI_ADVANCE_MS);
  };

  for (let value = 1; value <= 5; value += 1) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ci-scale-btn';
    btn.dataset.value = String(value);
    btn.textContent = String(value);
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute(
      'aria-label',
      `${value} — ${value === 1 ? low : value === 5 ? high : 'közepes'}`,
    );
    btn.addEventListener('click', (event) => choose(value, { auto: event.detail !== 0 }));
    group.appendChild(btn);
  }
  syncButtons();

  // Számbillentyűk: a setupShortcuts ezen az oldalon félreáll, itt viszont
  // a válasz gyors útja (a designból hiányzó billentyűzet-affordancia).
  step.addEventListener('keydown', (event) => {
    const value = Number(event.key);
    if (!Number.isInteger(value) || value < 1 || value > 5) return;
    event.preventDefault();
    choose(value, { auto: false });
    nextBtn.focus();
  });

  nextBtn.addEventListener('click', () => nav.goNext());
  return step;
}

/* ======================================================================
   Testtérkép
   ====================================================================== */

/** Test-térkép lépés: a közös bodymap komponens beillesztése a varázslóba. */

function renderMap(stepName, nav) {
  const mode = CI_MAP_MODES[stepName];

  const step = cloneTemplate('tpl-ci-map');
  $('[data-ci-eyebrow]', step).textContent = mode.eyebrow;
  $('[data-ci-title]', step).textContent = mode.title;
  $('[data-ci-sub]', step).textContent = mode.sub;
  $('[data-ci-legend]', step).textContent = mode.legend;

  const map = createBodyMap({
    max: mode.max,
    defaultValue: mode.defaultValue,
    noun: mode.noun,
    values: ci.answers[mode.field],
    muscleLabel: ciMuscleLabel,
    blockFrom: mode.field === 'pain' ? CI_PAIN_BLOCK : null,
    onChange: () => {
      ci.dirty = true;
    },
  });
  $('[data-ci-map]', step).replaceWith(map.el);

  $('[data-action="checkin-next"]', step).addEventListener('click', () => nav.goNext());
  return step;
}

/* ======================================================================
   Összegzés
   ====================================================================== */

/** Összegzés és a mentés utáni készenléti kártya. */

/* ---- Összegzés ---- */

function renderSummary(nav) {
  const step = cloneTemplate('tpl-ci-summary');
  $('[data-ci-date]', step).textContent = ciDateStr();

  const { answers, carried } = ci;
  const named = (map) => Object.keys(map).map((key) => ciMuscleLabel(key));

  const painParts = Object.entries(answers.pain).map(
    ([key, value]) => `${ciMuscleLabel(key)} ${value}`,
  );
  // Az általános fájdalmat a varázsló nem kérdezi, de ha a részletes űrlap
  // megadta, kiírjuk — különben néma ellentmondás lenne a „nincs
  // fájdalmam" válasszal.
  if (carried.painGeneral !== null) painParts.push(`általános ${carried.painGeneral}`);

  const rows = [
    ['Alvás', answers.sleepHours === null ? '–' : `${formatNumber(answers.sleepHours)} óra`],
    ['Alvásminőség', `${answers.sleepQuality ?? '–'} / 5`],
    ['Energiaszint', `${answers.energy ?? '–'} / 5`],
    ['Stresszszint', `${answers.stress ?? '–'} / 5`],
    // A kihagyott testsúly nem hiányzó adat, hanem válasz: ma nem mértél.
    [
      'Testsúly',
      answers.weightKg === null ? 'Ma nem mértem' : `${formatNumber(answers.weightKg)} kg`,
    ],
    ['Izomláz', named(answers.soreness).join(', ') || 'Nincs'],
    ['Fájdalom', painParts.join(', ') || 'Nincs'],
  ];
  // A varázslóból kimaradó, de eltárolt mezők — hogy látszódjon, mi megy
  // vissza változatlanul.
  if (carried.mood !== null) rows.push(['Közérzet', `${carried.mood} / 5`]);
  if (carried.hydration !== null)
    rows.push(['Folyadék', `${formatNumber(carried.hydration)} liter`]);

  const list = $('[data-ci-summary]', step);
  list.replaceChildren(
    ...rows.map(([label, value]) => {
      const row = cloneTemplate('tpl-ci-summary-row');
      $('.ci-summary-label', row).textContent = label;
      $('.ci-summary-value', row).textContent = value;
      return row;
    }),
  );

  // A készenlét CSAK a szervertől jöhet. Amíg a friss válaszokat nem
  // mentettük, nincs mit kiírni — kitalált számot nem teszünk a lapra.
  const showScore = ci.readiness !== null && ci.hadCheckin && !ci.dirty;
  renderReadiness(step, showScore ? ci.readiness.overall : null, { animate: false });

  // Ebben a munkamenetben mentve → a gomb helyén a visszajelzés áll.
  // Előre kitöltött, változatlan állapot → a pontszám már látszik, de a
  // mentés elérhető marad (a részletes űrlap közben írhatott bele).
  const saveBtn = $('[data-action="checkin-save"]', step);
  saveBtn.hidden = ci.saved;
  $('[data-ci-saved]', step).hidden = !ci.saved;
  $('[data-ci-done-link]', step).hidden = !(ci.saved || showScore);

  saveBtn.addEventListener('click', () => nav.submit(saveBtn, step));
  return step;
}

/** A készenlét-kártya kitöltése. `overall === null` → magyarázó sor a
    szám helyett. */
function renderReadiness(step, overall, { animate }) {
  const pending = $('[data-ci-pending]', step);
  const scoreWrap = $('[data-ci-score-wrap]', step);
  const barWrap = $('[data-ci-bar-wrap]', step);
  const verdict = $('[data-ci-verdict]', step);

  const known = overall !== null && overall !== undefined;
  pending.hidden = known;
  scoreWrap.hidden = !known;
  barWrap.hidden = !known;
  verdict.textContent = '';
  if (!known) return;

  const tone = readinessTone(overall);
  const card = $('[data-ci-readiness]', step);
  card.dataset.tone = tone;
  verdict.textContent = CI_READINESS_VERDICTS[tone];
  $('[data-ci-bar]', step).style.width = overall + '%';

  const num = $('[data-ci-score]', step);
  // A pontszám egész — formatWhole nélkül a felpörgetés tizedeseket villantana.
  if (animate) animateNumber(num, overall, { from: 0, duration: 900, format: formatWhole });
  else num.textContent = String(overall);
}

export { renderGate, renderIntro, renderMap, renderReadiness, renderScale, renderSummary };
