/** A napi check-in varázsló: lépések, kapuk, fájdalomtérkép, összegzés. */

import { api } from '../core/api.js';
import { onDayChange } from '../core/day.js';
import { $, $$, cloneTemplate, prefersReducedMotion } from '../core/dom.js';
import { animateNumber, formatNumber } from '../core/format.js';
import { hooks, shared } from '../core/page-hooks.js';
import { showToast } from '../core/toast.js';
import { setOnboardingLock } from '../nav/router.js';
import { renderDashboard } from '../render/dashboard.js';
import { CHECKIN_SCALES, readinessTone } from '../render/recovery.js';
import { handleStepClick } from '../render/sets.js';
import { CI_ADVANCE_MS, CI_BASE_STEPS, CI_BODY_REGIONS, CI_DRAG_PX_PER_STEP, CI_GATES, CI_MAP_MODES, CI_PAIN_BLOCK, CI_PRESET_ADVANCE_MS, CI_READINESS_VERDICTS, CI_SCALE_STEPS, CI_SLEEP_MAX, CI_SLEEP_MIN, CI_SLEEP_PRESETS, CI_WEIGHT_FALLBACK, CI_WEIGHT_MAX, CI_WEIGHT_MIN, CI_WEIGHT_PRESET_OFFSETS } from './checkin-constants.js';
import { ciClamp, ciEmptyState, ciMuscleLabel, ciPickPositive } from './checkin-helpers.js';
import { formatDelta, latestWeightEntry, mergeWeightEntry, refreshWeightLog, todayWeightEntry } from './weight.js';

/**
 * A varázsló állapota.
 *
 * A `carried` a legfontosabb mező. A PUT /api/checkin TELJES SORT ír felül
 * (server/db.js:249 — ON CONFLICT … SET minden oszlopra), és a törzsből
 * hiányzó mezőből a server.js readOptionalNumber-e null-t csinál. A varázsló
 * szándékosan nem kérdez közérzetet, folyadékot és általános fájdalmat —
 * ezeket ezért betöltéskor ide tesszük el, és mentéskor VÁLTOZATLANUL
 * visszaküldjük. Enélkül a részletes űrlapon aznap megadott értékek
 * némán NULL-ra állnának.
 *
 * A testsúly nem itt, hanem az `answers`-ben van: a varázsló KÉRDEZI (a
 * dashboard külön rögzítő űrlapja helyett). A szerver nem a checkins sorba,
 * hanem a weight_log-ba írja, naponta egy sorba — az újramentés felülír,
 * nem duplikál (server/db.js addWeightEntry).
 */
let ci = null;

/** A lépések aktuális sorrendje. A kapuk maguk a sorrend: ha nincs izomláz,
    a 'soreness' egyszerűen nincs a listában, és a sima „következő" a
    fájdalom-kapun landol. */
function ciStepOrder() {
  const steps = [...CI_BASE_STEPS];
  if (ci.gates.sore === 'yes') steps.push('soreness');
  steps.push('painGate');
  if (ci.gates.pain === 'yes') steps.push('painMap');
  steps.push('summary');
  return steps;
}

/** A folyamatsávban számolt lépések (az intro és az összegzés nem kérdés). */
const ciCountedSteps = () => ciStepOrder().filter((s) => s !== 'intro' && s !== 'summary');

async function setupCheckinWizard() {
  const page = $('[data-page="checkin"]');
  if (!page) return;

  const head = $('[data-ci-head]', page);
  const body = $('[data-ci-body]', page);
  const progress = $('[data-ci-progress]', page);
  const stepLabel = $('[data-ci-step-label]', page);
  const announce = $('[data-ci-announce]', page);

  let advanceTimer = null;

  const cancelAdvance = () => { clearTimeout(advanceTimer); advanceTimer = null; };

  /** Automatikus továbblépés koppintás után. A hívók billentyűs aktiválásnál
      (event.detail === 0) NEM hívják: a fókusz elrántása döntés közben rossz
      élmény, ott a „Tovább" gomb a kiút. Csökkentett mozgás mellett nincs
      várakozás — az animált átmenet úgyis el van némítva. */
  function advanceSoon(delay) {
    cancelAdvance();
    if (prefersReducedMotion) { goNext(); return; }
    advanceTimer = setTimeout(goNext, delay);
  }

  function setStep(name) {
    cancelAdvance();
    ci.step = name;
    renderStep();
  }

  function goNext() {
    const order = ciStepOrder();
    const index = order.indexOf(ci.step);
    setStep(order[Math.min(index + 1, order.length - 1)]);
  }

  function goBack() {
    const order = ciStepOrder();
    const index = order.indexOf(ci.step);
    setStep(order[Math.max(index - 1, 0)]);
  }

  /* ---- Fejléc ---- */

  function syncHead() {
    const counted = ciCountedSteps();
    const index = counted.indexOf(ci.step);
    const total = counted.length;
    head.hidden = ci.step === 'intro';

    const percent = index >= 0 ? ((index + 1) / total) * 100 : (ci.step === 'summary' ? 100 : 0);
    progress.style.width = percent + '%';
    stepLabel.textContent = index >= 0 ? `${index + 1}/${total}` : '';
    // A sáv és a „3/6" aria-hidden — a lépésszám itt hangzik el, egyszer.
    announce.textContent = index >= 0 ? `${index + 1}. lépés a ${total}-ből` : '';
  }

  /* ---- Lépés-renderelés ---- */

  const RENDERERS = {
    intro: renderIntro,
    sleep: renderSleep,
    sleepq: () => renderScale('sleepq'),
    energy: () => renderScale('energy'),
    stress: () => renderScale('stress'),
    weight: renderWeight,
    soreGate: () => renderGate('soreGate'),
    painGate: () => renderGate('painGate'),
    soreness: () => renderMap('soreness'),
    painMap: () => renderMap('painMap'),
    summary: renderSummary,
  };

  function renderStep() {
    const step = RENDERERS[ci.step]?.();
    if (!step) return;
    body.replaceChildren(step);
    // A data-step újraírása indítja újra a belépő animációt.
    body.dataset.step = ci.step;
    syncHead();

    const heading = $('h2', body);
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }

  const ciDateStr = () => new Date().toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' });

  function renderIntro() {
    const step = cloneTemplate('tpl-ci-intro');
    $('[data-ci-date]', step).textContent = ciDateStr();
    // Félbehagyott munkamenetnél a „Kezdés" félrevezető lenne.
    if (ci.hadCheckin) $('[data-ci-start-label]', step).textContent = 'Folytatás';
    if (shared.onboardingLock) applyOnboardingIntro(step);
    return applyIntroActions(step);
  }

  /* Az első check-in introja. Ugyanaz a sablon, más szöveg: itt még nem
     „napi rutin" a dolog, hanem az egyetlen út befelé — a kezdőnek azt kell
     megértenie, MIÉRT kérdezünk, mielőtt bármit kitöltene. */
  function applyOnboardingIntro(step) {
    // Csak a felvezető szó cserélődik — a dátum-span a helyén marad.
    $('.ci-eyebrow', step).firstChild.nodeValue = 'Első lépés · ';
    $('.ci-display', step).replaceChildren(
      'Kezdjük', document.createElement('br'), 'a készenléttel',
    );
    $('.ci-lead', step).textContent = 'Ez az első check-ined. Ebből számolja ki a rendszer, '
      + 'mennyire vagy ma terhelhető — pár gyors kérdés, kevesebb mint egy perc.';
    $('.ci-footnote', step).textContent = 'Az adataid csak hozzád tartoznak.';

    /* A „Mégse" itt sehová nem vezetne: az app többi oldala zárva van. A
       kijárat ezért a kijelentkezés — a check-in kötelező, de a lap nem
       csapda (a #checkin-en nincs se beállítás-, se kilépés-gomb, azok a
       dashboard fejlécében ülnek). */
    const exit = $('.ci-exit', step);
    exit.textContent = 'Kijelentkezés';
    exit.href = '#';
    exit.addEventListener('click', async (event) => {
      event.preventDefault();
      try { await api.logout(); } catch { /* a kilépést akkor is bevisszük */ }
      window.location.reload();
    });
  }

  /** Az intro gombjának bekötése — a két ág után közös. */
  function applyIntroActions(step) {
    $('[data-action="checkin-next"]', step).addEventListener('click', () => goNext());
    return step;
  }

  /* ---- Alvás ---- */

  function renderSleep() {
    const step = cloneTemplate('tpl-ci-sleep');
    const input = $('#ci-sleep', step);
    input.value = ci.answers.sleepHours ?? 7.5;

    const presets = $('[data-ci-presets]', step);
    const syncPresets = () => {
      $$('button', presets).forEach((btn) => {
        btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === Number(input.value)));
      });
    };

    // A ± gombokat a megosztott handleStepClick lépteti (min/max/step onnan
    // jön). A varázsló lépései cserélődnek, ezért a hívás ide kerül: a lapon
    // nincs olyan delegált kezelő, ami elvégezné. A léptetés `input`
    // eseményt vált ki, az alábbi listener menti és szinkronizálja a
    // preseteket — itt már csak az automatikus továbblépést kell leállítani.
    step.addEventListener('click', (event) => {
      if (!handleStepClick(event)) return;
      cancelAdvance();
    });
    input.addEventListener('input', () => { syncPresets(); commitSleep(); });

    CI_SLEEP_PRESETS.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ci-preset';
      btn.dataset.value = String(value);
      btn.textContent = formatNumber(value);
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', `${formatNumber(value)} óra`);
      btn.addEventListener('click', (event) => {
        input.value = value;
        syncPresets();
        commitSleep();
        // Billentyűs aktiválás (detail === 0) nem léptet magától.
        if (event.detail !== 0) advanceSoon(CI_PRESET_ADVANCE_MS);
      });
      presets.appendChild(btn);
    });
    syncPresets();

    $('[data-action="checkin-next"]', step).addEventListener('click', () => {
      commitSleep();
      goNext();
    });

    function commitSleep() {
      const value = Number(input.value);
      // A felhasználó látta a kiírt számot, tehát az a válasza — de a
      // tartományon kívüli kézi bevitelt nem küldjük tovább.
      ci.answers.sleepHours = Number.isFinite(value)
        ? ciClamp(value, CI_SLEEP_MIN, CI_SLEEP_MAX)
        : null;
      ci.dirty = true;
    }

    return step;
  }

  /* ---- Testsúly ----
     A napi testsúly rögzítése. Ez váltja ki a dashboard korábbi külön
     űrlapját: a mérés a check-in része, az eredménye pedig a Regeneráció
     oldal trend-diagramján látszik. */

  /** A viszonyítási bejegyzés a gyorsgombokhoz és a ± kiindulópontjához:
      a mai mérés, ha ma már volt, egyébként a legutóbbi. */
  const ciWeightReference = () => todayWeightEntry() ?? latestWeightEntry();

  function renderWeight() {
    const step = cloneTemplate('tpl-ci-weight');
    const input = $('#ci-weight', step);
    const presets = $('[data-ci-presets]', step);
    const note = $('[data-ci-weight-note]', step);
    const reference = ciWeightReference();
    const todayEntry = todayWeightEntry();

    // A mezőt SZÁNDÉKOSAN nem töltjük ki a legutóbbi méréssel: egy előre
    // beírt szám a „Tovább" gombbal olyan méréssé válna, ami meg sem történt.
    // A ma már rögzített érték viszont szerkeszthető — azt visszaadjuk.
    input.value = ci.answers.weightKg === null ? '' : formatNumber(ci.answers.weightKg);

    const syncStep = () => {
      const value = ci.answers.weightKg;
      $$('button', presets).forEach((btn) => {
        btn.setAttribute('aria-pressed', String(Number(btn.dataset.value) === value));
      });
      note.textContent = weightNote(value);
    };

    /** A mező alatti magyarázó sor: mihez képest van a beírt érték, illetve
        mi történik, ha üresen hagyod. */
    function weightNote(value) {
      if (value === null) {
        return reference
          ? `Üresen hagyva kihagyjuk — az utolsó mérésed ${formatNumber(reference.kg)} kg (${reference.date}).`
          : 'Üresen hagyva kihagyjuk — ma nem kerül bejegyzés a testsúly-naplóba.';
      }
      if (todayEntry) {
        return `Ma már rögzítettél ${formatNumber(todayEntry.kg)} kg-ot — a mentés ezt írja felül.`;
      }
      if (!reference) return 'Ez lesz az első bejegyzésed a testsúly-naplóban.';
      const diff = value - reference.kg;
      return Math.abs(diff) < 0.05
        ? `Ugyanannyi, mint a legutóbbi mérésed (${reference.date}).`
        : `${formatDelta(diff)} kg a legutóbbi méréshez képest (${reference.date}).`;
    }

    function commitWeight() {
      const raw = input.value.trim();
      const value = Number(raw);
      ci.answers.weightKg = raw === '' || !Number.isFinite(value)
        ? null
        : ciClamp(Math.round(value * 10) / 10, CI_WEIGHT_MIN, CI_WEIGHT_MAX);
      ci.dirty = true;
      syncStep();
    }

    // Gépelés közben nem írunk vissza a mezőbe (a félkész „8" nem ugrik
    // 30-ra), elhagyáskor viszont a látott és a tárolt érték egyezzen.
    input.addEventListener('input', commitWeight);
    input.addEventListener('blur', () => {
      input.value = ci.answers.weightKg === null ? '' : formatNumber(ci.answers.weightKg);
    });

    // A ± gombokat a megosztott handleStepClick lépteti; üres mezőnél viszont
    // 0-ról indulna (és a min miatt 30-ra ugrana), ezért az első koppintás
    // csak beülteti a viszonyítási értéket, és ott meg is áll.
    step.addEventListener('click', (event) => {
      if (!event.target.closest('.wk-num-step')) return;
      cancelAdvance();
      if (input.value.trim() !== '') return;
      event.stopPropagation();
      input.value = formatNumber(reference?.kg ?? CI_WEIGHT_FALLBACK);
      commitWeight();
    });

    if (reference) {
      CI_WEIGHT_PRESET_OFFSETS.forEach((offset) => {
        const value = Math.round((reference.kg + offset) * 10) / 10;
        if (value < CI_WEIGHT_MIN || value > CI_WEIGHT_MAX) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ci-preset';
        btn.dataset.value = String(value);
        btn.textContent = formatNumber(value);
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', `${formatNumber(value)} kilogramm`);
        btn.addEventListener('click', (event) => {
          input.value = formatNumber(value);
          commitWeight();
          // Billentyűs aktiválás (detail === 0) nem léptet magától.
          if (event.detail !== 0) advanceSoon(CI_PRESET_ADVANCE_MS);
        });
        presets.appendChild(btn);
      });
      presets.hidden = presets.childElementCount === 0;
    }

    $('[data-ci-weight-skip]', step).addEventListener('click', () => {
      input.value = '';
      commitWeight(); // → null: ma nincs mérés
      goNext();
    });

    $('[data-action="checkin-next"]', step).addEventListener('click', () => {
      commitWeight();
      goNext();
    });

    syncStep();
    return step;
  }

  /* ---- 1–5 skálák ---- */

  function renderScale(stepName) {
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
      if (auto) advanceSoon(CI_ADVANCE_MS);
    };

    for (let value = 1; value <= 5; value += 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ci-scale-btn';
      btn.dataset.value = String(value);
      btn.textContent = String(value);
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', `${value} — ${value === 1 ? low : value === 5 ? high : 'közepes'}`);
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

    nextBtn.addEventListener('click', () => goNext());
    return step;
  }

  /* ---- Kapuk ---- */

  function renderGate(stepName) {
    const gate = CI_GATES[stepName];
    const step = cloneTemplate('tpl-ci-gate');
    $('[data-ci-eyebrow]', step).textContent = gate.eyebrow;
    $('[data-ci-title]', step).textContent = gate.title;
    $('[data-ci-sub]', step).textContent = gate.sub;

    const wrap = $('[data-ci-gates]', step);
    [['no', 'ok'], ['yes', 'accent']].forEach(([answer, tone]) => {
      const [label, sub] = gate[answer];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ci-gate';
      btn.dataset.tone = tone;
      btn.setAttribute('aria-pressed', String(ci.gates[gate.key] === answer));

      const title = document.createElement('span');
      title.className = 'ci-gate-label';
      title.textContent = label;
      const note = document.createElement('span');
      note.className = 'ci-gate-sub';
      note.textContent = sub;
      btn.append(title, note);

      btn.addEventListener('click', () => {
        ci.gates[gate.key] = answer;
        ci.dirty = true;
        // A „nincs" válasz törli a korábban megjelölt értékeket is —
        // különben egy meggondolt válasz némán hagyná bent őket.
        if (answer === 'no') ci.answers[gate.key === 'sore' ? 'soreness' : 'pain'] = {};
        // A sorrend most már tartalmazza (vagy nem) a térkép-lépést.
        goNext();
      });
      wrap.appendChild(btn);
    });
    return step;
  }

  /* ---- Testtérkép ---- */

  function renderMap(stepName) {
    const mode = CI_MAP_MODES[stepName];
    const store = () => ci.answers[mode.field];

    const step = cloneTemplate('tpl-ci-map');
    $('[data-ci-eyebrow]', step).textContent = mode.eyebrow;
    $('[data-ci-title]', step).textContent = mode.title;
    $('[data-ci-sub]', step).textContent = mode.sub;
    $('[data-ci-legend]', step).textContent = mode.legend;

    const map = $('[data-ci-map]', step);
    const values = $('[data-ci-values]', step);

    $$('.wk-toggle-btn', step).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === ci.mapView));
      btn.addEventListener('click', () => {
        ci.mapView = btn.dataset.view;
        renderStep(); // nézetváltás: teljes újrarajzolás rendben van
      });
    });

    /** Egy izomcsoport minden (látható) téglalapjának frissítése. Húzás
        közben CSAK ez fut — a lépés újrarenderelése megölné a pointer
        capture-t, és a húzás némán megszakadna. */
    function paintRegion(key) {
      const value = store()[key];
      const on = value > 0;
      $$(`[data-region="${key}"]`, map).forEach((btn) => {
        btn.textContent = on ? String(value) : '';
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', on
          ? `${ciMuscleLabel(key)} — ${mode.noun} ${value} / ${mode.max}`
          : `${ciMuscleLabel(key)} — nincs megjelölve`);
      });
    }

    function setValue(key, value) {
      store()[key] = ciClamp(value, 1, mode.max);
      ci.dirty = true;
      paintRegion(key);
      renderValueRows();
    }

    function clearValue(key) {
      delete store()[key];
      ci.dirty = true;
      paintRegion(key);
      renderValueRows();
    }

    CI_BODY_REGIONS[ci.mapView].forEach(([key, x, y, w, h], index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ci-region';
      btn.dataset.region = key;
      btn.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;

      // A tükör-párból csak az első kerül az akadálymentességi fába és a
      // tab-sorrendbe: egy izomcsoport = egy vezérlő. (A pointer-események
      // az aria-hidden ellenére is működnek a másikon.)
      const isMirror = CI_BODY_REGIONS[ci.mapView]
        .findIndex(([k]) => k === key) !== index;
      if (isMirror) {
        btn.setAttribute('aria-hidden', 'true');
        btn.tabIndex = -1;
      }

      bindRegion(btn, key);
      map.appendChild(btn);
      paintRegion(key);
    });

    /** Pointer-húzás: lenyomásra kijelöl az alapértékkel, függőleges
        mozgásra léptet, elmozdulás nélküli felengedés egy MÁR kijelölt
        régión pedig töröl. */
    function bindRegion(btn, key) {
      let pointerId = null;
      let startY = 0;
      let startValue = 0;
      let wasSelected = false;
      let moved = false;

      btn.addEventListener('pointerdown', (event) => {
        if (pointerId !== null) return;
        pointerId = event.pointerId;
        wasSelected = store()[key] > 0;
        startValue = wasSelected ? store()[key] : mode.defaultValue;
        startY = event.clientY;
        moved = false;
        try { btn.setPointerCapture(pointerId); } catch { /* nem kritikus */ }
        setValue(key, startValue);
        event.preventDefault();
      });

      btn.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointerId) return;
        const delta = Math.round((startY - event.clientY) / CI_DRAG_PX_PER_STEP);
        if (delta !== 0) moved = true;
        setValue(key, startValue + delta);
      });

      const end = (event) => {
        if (event.pointerId !== pointerId) return;
        try { btn.releasePointerCapture(pointerId); } catch { /* már elengedve */ }
        pointerId = null;
        if (!moved && wasSelected) clearValue(key);
      };
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);

      // A húzás billentyűzetes tükre. Enélkül a lépés pointer nélkül
      // teljesíthetetlen lenne.
      btn.addEventListener('keydown', (event) => {
        const current = store()[key] ?? 0;
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
          event.preventDefault();
          setValue(key, current ? current + 1 : mode.defaultValue);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
          event.preventDefault();
          if (current <= 1) clearValue(key); else setValue(key, current - 1);
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          clearValue(key);
        }
      });
      btn.addEventListener('click', (event) => {
        // Billentyűs aktiválás: a pointerdown-ág nem futott le.
        if (event.detail !== 0) return;
        if (store()[key] > 0) clearValue(key); else setValue(key, mode.defaultValue);
      });
    }

    /** A térkép alatti pontos-érték sorok. Ezek a KANONIKUS vezérlők:
        a térképen húzni kell, itt billentyűzettel is választható az érték. */
    function renderValueRows() {
      const keys = Object.keys(store()).filter((key) => store()[key] > 0);
      values.replaceChildren(...keys.map((key) => {
        const row = cloneTemplate('tpl-ci-value-row');
        $('[data-ci-name]', row).textContent = ciMuscleLabel(key);

        const chips = $('[data-ci-chips]', row);
        chips.setAttribute('aria-label', `${ciMuscleLabel(key)} — ${mode.noun} értéke`);
        for (let value = 1; value <= mode.max; value += 1) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'rc-chip ci-chip';
          if (mode.field === 'pain') chip.classList.add('ci-chip--pain');
          chip.textContent = String(value);
          chip.setAttribute('aria-pressed', String(store()[key] === value));
          chip.setAttribute('aria-label', `${ciMuscleLabel(key)} — ${mode.noun} ${value}`);
          chip.addEventListener('click', () => setValue(key, value));
          chips.appendChild(chip);
        }

        const warn = $('[data-ci-warn]', row);
        warn.hidden = !(mode.field === 'pain' && store()[key] >= CI_PAIN_BLOCK);
        return row;
      }));
    }
    renderValueRows();

    $('[data-action="checkin-next"]', step).addEventListener('click', () => goNext());
    return step;
  }

  /* ---- Összegzés ---- */

  function renderSummary() {
    const step = cloneTemplate('tpl-ci-summary');
    $('[data-ci-date]', step).textContent = ciDateStr();

    const { answers, carried } = ci;
    const named = (map) => Object.keys(map).map((key) => ciMuscleLabel(key));

    const painParts = Object.entries(answers.pain)
      .map(([key, value]) => `${ciMuscleLabel(key)} ${value}`);
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
      ['Testsúly', answers.weightKg === null
        ? 'Ma nem mértem'
        : `${formatNumber(answers.weightKg)} kg`],
      ['Izomláz', named(answers.soreness).join(', ') || 'Nincs'],
      ['Fájdalom', painParts.join(', ') || 'Nincs'],
    ];
    // A varázslóból kimaradó, de eltárolt mezők — hogy látszódjon, mi megy
    // vissza változatlanul.
    if (carried.mood !== null) rows.push(['Közérzet', `${carried.mood} / 5`]);
    if (carried.hydration !== null) rows.push(['Folyadék', `${formatNumber(carried.hydration)} liter`]);

    const list = $('[data-ci-summary]', step);
    list.replaceChildren(...rows.map(([label, value]) => {
      const row = cloneTemplate('tpl-ci-summary-row');
      $('.ci-summary-label', row).textContent = label;
      $('.ci-summary-value', row).textContent = value;
      return row;
    }));

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

    saveBtn.addEventListener('click', () => submit(saveBtn, step));
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
    if (animate) animateNumber(num, overall, { from: 0, duration: 900 });
    else num.textContent = String(overall);
  }

  /* ---- Mentés ---- */

  /**
   * A PUT /api/checkin törzse. Lásd a `carried` kommentjét: a végpont teljes
   * sort cserél, ezért MINDEN mező szerepel — a nem kérdezettek változatlanul.
   */
  function buildBody() {
    const { answers, carried } = ci;
    return {
      sleepHours: answers.sleepHours,
      sleepQuality: answers.sleepQuality,
      energy: answers.energy,
      stress: answers.stress,
      // Az izomláz és a fájdalom teljes cseréje SZÁNDÉKOS: a „nincs
      // izomlázam" válasznak törölnie kell tudnia a korábbi értékeket.
      soreness: { ...answers.soreness },
      pain: {
        ...answers.pain,
        ...(carried.painGeneral !== null ? { general: carried.painGeneral } : {}),
      },
      mood: carried.mood,           // nem kérdezzük — vissza, különben NULL lesz
      hydration: carried.hydration, // ugyanígy
      // A testsúly nem a check-in sorba megy: a szerver a weight_log-ba
      // írja, naponta egy bejegyzésbe (felülír, nem duplikál). A null azt
      // jelenti, hogy ma nem mértél — ilyenkor a napló érintetlen marad.
      weightKg: answers.weightKg,
    };
  }

  async function submit(btn, step) {
    btn.disabled = true;
    try {
      const { checkin, weightEntry, readiness } = await api.saveCheckin(buildBody());
      mergeWeightEntry(weightEntry); // trend-diagram (Regeneráció) + Δ stat
      ci.readiness = readiness;
      ci.saved = true;
      ci.dirty = false;
      ci.hadCheckin = true;

      /* Az első check-in megvan — az app kinyílik. Navigálni NEM kell: a
         felhasználó az összegzésen marad, és itt látja meg az első valódi
         készenléti pontszámát. */
      if (shared.onboardingLock) setOnboardingLock(false);

      // A Regeneráció oldal és az áttekintő ugyanebből a motorból él
      hooks.applyCheckinSaved?.(checkin, readiness);
      renderDashboard().catch((err) => console.error('Áttekintő frissítési hiba:', err));

      renderReadiness(step, readiness.overall, { animate: true });
      btn.hidden = true;
      $('[data-ci-saved]', step).hidden = false;
      $('[data-ci-done-link]', step).hidden = false;
      showToast('Check-in mentve');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Nem sikerült menteni a check-int', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /* ---- Betöltés ---- */

  /**
   * A mai állapot beolvasása. Egyetlen kérés elég: a riport az `overall`
   * mellett a check-in nyers értékeit is visszaadja (`checkin.values`).
   * `fresh` esetén a válaszok is felülíródnak; egyébként CSAK a hordozott
   * mezők frissülnek, hogy a félbehagyott kitöltés ne vesszen el.
   */
  async function load({ fresh }) {
    // A testsúly-napló is kell: ebből tölti a testsúly-lépés a viszonyítási
    // mérést, és ebből derül ki, ma volt-e már mérés.
    const [report] = await Promise.all([api.getReadiness(), refreshWeightLog()]);
    const checkin = report.checkin.values;

    ci.readiness = report;
    ci.hadCheckin = report.checkin.present;
    ci.carried = {
      mood: checkin?.mood ?? null,
      hydration: checkin?.hydration ?? null,
      painGeneral: checkin?.pain?.general ?? null,
    };
    if (!fresh) return;

    ci.answers = {
      sleepHours: checkin?.sleepHours ?? null,
      sleepQuality: checkin?.sleepQuality ?? null,
      energy: checkin?.energy ?? null,
      stress: checkin?.stress ?? null,
      // A testsúly a naplóból jön (nem a check-in sorból): ha ma már mértél,
      // azt az értéket szerkeszted tovább, különben üresen indul.
      weightKg: todayWeightEntry()?.kg ?? null,
      soreness: ciPickPositive(checkin?.soreness),
      pain: ciPickPositive(checkin?.pain, 'general'),
    };
    // A kapukat a betöltött térképekből VEZETJÜK LE — ettől lép a vissza
    // gomb a kitöltött összegzésről a helyes lépésekre.
    ci.gates = {
      sore: !checkin ? null : Object.keys(ci.answers.soreness).length ? 'yes' : 'no',
      pain: !checkin ? null : Object.keys(ci.answers.pain).length ? 'yes' : 'no',
    };
    ci.dirty = false;
    ci.saved = false;
    ci.loaded = true;
    ci.mapView = 'front';
    // Ha ma már van check-in, egyből az összegzés — onnan a vissza gombbal
    // bármelyik lépés módosítható.
    ci.step = ci.hadCheckin ? 'summary' : 'intro';
  }

  /** Az oldal megnyitásakor fut. Új munkamenetet kezd, ha még nem töltöttünk
      be (ide tartozik a setup-időben előre rajzolt intro is), ha közben napot
      váltottunk, vagy ha az előzőt már elmentettük. Egyébként megőrzi a
      félbehagyott kitöltés helyét, és csak a hordozott mezőket frissíti. */
  hooks.refreshCheckinWizard = async () => {
    const today = new Date().toDateString();
    const fresh = ci === null || !ci.loaded || ci.sessionDate !== today || ci.saved;
    if (fresh) ci = { ...ciEmptyState(), sessionDate: today };
    await load({ fresh });
    renderStep();
  };

  page.addEventListener('click', (event) => {
    // A ± léptetők (alvás, testsúly) a megosztott primitívre épülnek: a
    // min/max/step a mezőről jön, a lépés `input` eseményt vált ki, amire a
    // lépés saját kezelője beírja a választ. Delegálva, mert a lépések
    // renderelésenként újraépülnek.
    if (handleStepClick(event)) return;
    if (event.target.closest('[data-action="checkin-back"]')) goBack();
  });

  // Az intro már setup-időben felkerül: a showPage a pageEffects ELŐTT
  // fókuszálja a lap első h2-jét, tehát az első megnyitáskor már kell lennie
  // renderelt lépésnek.
  ci = { ...ciEmptyState(), sessionDate: new Date().toDateString() };
  renderStep();

  // Napváltáskor a következő megnyitás tiszta lappal indul.
  onDayChange(() => { ci = null; });
}

export { setupCheckinWizard };
