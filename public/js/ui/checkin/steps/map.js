/** Test-térkép: izomláz- és fájdalom-régiók megjelölése, húzható erősséggel. */

import { $, $$, cloneTemplate } from '../../../core/dom.js';
import { CI_BODY_REGIONS, CI_DRAG_PX_PER_STEP, CI_MAP_MODES, CI_PAIN_BLOCK } from '../constants.js';
import { ciClamp, ciMuscleLabel } from '../helpers.js';
import { ci } from '../session.js';

/* ---- Testtérkép ---- */

function renderMap(stepName, nav) {
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
      nav.renderStep(); // nézetváltás: teljes újrarajzolás rendben van
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

  $('[data-action="checkin-next"]', step).addEventListener('click', () => nav.goNext());
  return step;
}

export { renderMap };
