/**
 * Testtérkép — izomláz és fájdalom megjelölése egy emberalakon.
 *
 * Két hívója van: a napi check-in varázsló térkép-lépése és a Regeneráció
 * oldal részletes űrlapja. Azért közös komponens, mert a kettőnek ugyanaz a
 * viselkedése kell — és ebből a viselkedésből három dolog az, ami újraírásnál
 * csendben el szokott tűnni:
 *
 *   1. Húzás közben CSAK az érintett régió festődik újra. A teljes újrarajzolás
 *      megölné a pointer capture-t, és a húzás némán megszakadna.
 *   2. A térképen húzni kell — ezért a térkép alatti chip-sorok NEM kijelzők,
 *      hanem egyenértékű, billentyűzetről is járható út. Minden chip 44px.
 *   3. A tükör-párból csak az egyik van a fókusz-sorrendben: egy izomcsoport
 *      egy vezérlő, akkor is, ha két alakzat rajzolja.
 */

import { $$ } from '../../core/dom.js';
import { BODY_HEAD, BODY_REGIONS, BODY_SILHOUETTE, BODY_VIEW_BOX } from './paths.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Hány képernyő-pixel egy értéklépés húzáskor. */
const DRAG_PX_PER_STEP = 14;

const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function createBodyMap({
  max, defaultValue, noun, values, muscleLabel,
  blockFrom = null, extraRows = [], onChange,
}) {
  let view = 'front';

  const el = document.createElement('div');
  el.className = 'bm';

  // — Nézetváltó —
  const toggle = document.createElement('div');
  toggle.className = 'ds-seg bm-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Testnézet');
  for (const [key, label] of [['front', 'Elöl'], ['back', 'Hátul']]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ds-seg-btn';
    btn.dataset.view = key;
    btn.textContent = label;
    btn.addEventListener('click', () => setView(key));
    toggle.appendChild(btn);
  }
  el.appendChild(toggle);

  const stage = document.createElement('div');
  stage.className = 'bm-stage';
  el.appendChild(stage);

  const rows = document.createElement('div');
  rows.className = 'bm-rows';
  el.appendChild(rows);

  /** Egy izomcsoport minden látható alakzatának frissítése. Húzás közben
      CSAK ez fut (lásd a fájl fejlécének 1. pontját). */
  function paintRegion(key) {
    const value = values[key];
    const on = value > 0;
    $$(`[data-region="${key}"]`, stage).forEach((node) => {
      node.setAttribute('aria-pressed', String(on));
      node.setAttribute('aria-label', on
        ? `${muscleLabel(key)} — ${noun} ${value} / ${max}`
        : `${muscleLabel(key)} — nincs megjelölve`);
    });
    $$(`[data-region-label="${key}"]`, stage).forEach((node) => {
      node.textContent = on ? String(value) : '';
    });
  }

  function setValue(key, value) {
    const next = clamp(value, 1, max);
    // Változatlan érték nem rajzol újra és nem jelez változást: húzás közben
    // ez lépésenként tucatnyi fölösleges újraépítés lenne, és egy puszta
    // koppintás a már kijelölt régión „piszkosnak" jelölné a check-int.
    if (values[key] === next) return;
    values[key] = next;
    paintRegion(key);
    renderRows();
    onChange?.();
  }

  function clearValue(key) {
    delete values[key];
    paintRegion(key);
    renderRows();
    onChange?.();
  }

  /** Pointer-húzás: lenyomásra kijelöl az alapértékkel, függőleges mozgásra
      léptet, elmozdulás nélküli felengedés egy MÁR kijelölt régión töröl. */
  function bindRegion(node, key) {
    let pointerId = null;
    let startY = 0;
    let startValue = 0;
    let wasSelected = false;
    let moved = false;

    node.addEventListener('pointerdown', (event) => {
      if (pointerId !== null) return;
      pointerId = event.pointerId;
      wasSelected = values[key] > 0;
      startValue = wasSelected ? values[key] : defaultValue;
      startY = event.clientY;
      moved = false;
      try { node.setPointerCapture(pointerId); } catch { /* nem kritikus */ }
      setValue(key, startValue);
      event.preventDefault();
    });

    node.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      const delta = Math.round((startY - event.clientY) / DRAG_PX_PER_STEP);
      if (delta !== 0) moved = true;
      setValue(key, startValue + delta);
    });

    const end = (event) => {
      if (event.pointerId !== pointerId) return;
      try { node.releasePointerCapture(pointerId); } catch { /* már elengedve */ }
      pointerId = null;
      if (!moved && wasSelected) clearValue(key);
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);

    // A húzás billentyűzetes tükre. Enélkül a lépés pointer nélkül
    // teljesíthetetlen lenne.
    node.addEventListener('keydown', (event) => {
      const current = values[key] ?? 0;
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        event.preventDefault();
        setValue(key, current ? current + 1 : defaultValue);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        event.preventDefault();
        if (current <= 1) clearValue(key); else setValue(key, current - 1);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        clearValue(key);
      } else if (event.key === 'Enter' || event.key === ' ') {
        // A role="button" szerződésének kötelező része. Az SVG path nem
        // valódi <button>, tehát a böngésző nem szintetizál click-et —
        // enélkül a felhasználó első próbálkozása némán nem csinál semmit.
        event.preventDefault();
        if (values[key] > 0) clearValue(key); else setValue(key, defaultValue);
      }
    });
    node.addEventListener('click', (event) => {
      // Billentyűs aktiválás: a pointerdown-ág nem futott le.
      if (event.detail !== 0) return;
      if (values[key] > 0) clearValue(key); else setValue(key, defaultValue);
    });
  }

  const MIRROR = `translate(${BODY_VIEW_BOX.width},0) scale(-1,1)`;

  function renderStage() {
    const svg = svgEl('svg', {
      viewBox: `0 0 ${BODY_VIEW_BOX.width} ${BODY_VIEW_BOX.height}`,
      class: 'bm-svg',
    });

    // — Sziluett: bal fél + tükörképe, plusz a fej —
    for (const transform of ['', MIRROR]) {
      const group = svgEl('g', { class: 'bm-silhouette' });
      if (transform) group.setAttribute('transform', transform);
      for (const d of BODY_SILHOUETTE[view]) group.appendChild(svgEl('path', { d }));
      svg.appendChild(group);
    }
    svg.appendChild(svgEl('circle', {
      class: 'bm-silhouette-head', cx: BODY_HEAD.cx, cy: BODY_HEAD.cy, r: BODY_HEAD.r,
    }));

    // — Régiók. A tükörképek aria-hidden-ek: egy izomcsoport egy vezérlő. —
    const regions = BODY_REGIONS[view];
    const addRegion = (region, mirrored) => {
      const node = svgEl('path', { class: 'bm-region', d: region.d, role: 'button' });
      node.dataset.region = region.key;
      if (mirrored) {
        node.setAttribute('aria-hidden', 'true');
      } else {
        node.setAttribute('tabindex', '0');
      }
      bindRegion(node, region.key);
      return node;
    };

    const plain = svgEl('g', { class: 'bm-regions' });
    for (const region of regions) plain.appendChild(addRegion(region, false));
    svg.appendChild(plain);

    const mirror = svgEl('g', { class: 'bm-regions', transform: MIRROR });
    for (const region of regions.filter((r) => r.mirrored)) {
      mirror.appendChild(addRegion(region, true));
    }
    svg.appendChild(mirror);

    // — Feliratok. Külön, NEM tükrözött rétegben: a tükrözött csoportban a
    //   szám tükörírással jelenne meg. —
    const labels = svgEl('g', { class: 'bm-labels', 'aria-hidden': 'true' });
    for (const region of regions) {
      const positions = region.mirrored
        ? [region.labelX, BODY_VIEW_BOX.width - region.labelX]
        : [region.labelX];
      for (const x of positions) {
        const text = svgEl('text', { x, y: region.labelY, 'text-anchor': 'middle' });
        text.dataset.regionLabel = region.key;
        labels.appendChild(text);
      }
    }
    svg.appendChild(labels);

    stage.replaceChildren(svg);
    for (const region of regions) paintRegion(region.key);
  }

  /** A térkép alatti pontos-érték sorok. Ezek a KANONIKUS vezérlők. */
  function renderRows() {
    // Melyik chipen állt a fókusz? A sorokat teljesen újraépítjük, tehát az
    // aktív gomb kikerül a dokumentumból — enélkül a billentyűzetes
    // felhasználó minden egyes érték után a lap tetejéről tabolhatna vissza.
    // Márpedig a chipek ÉPPEN a billentyűzetes út.
    const active = document.activeElement;
    const focused = active && rows.contains(active)
      ? { key: active.dataset.chipKey, value: active.dataset.chipValue }
      : null;

    const marked = Object.keys(values).filter((key) => values[key] > 0
      && !extraRows.some((row) => row.key === key));
    const entries = [
      ...marked.map((key) => ({ key, label: muscleLabel(key), blocks: true })),
      ...extraRows.map((row) => ({ ...row, blocks: false })),
    ];

    rows.replaceChildren(...entries.map(({ key, label, blocks }) => {
      const row = document.createElement('div');
      row.className = 'bm-row';

      const name = document.createElement('span');
      name.className = 'bm-row-name';
      name.textContent = label;
      row.appendChild(name);

      const chips = document.createElement('div');
      chips.className = 'bm-chips';
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', `${label} — ${noun} értéke`);
      for (let value = 1; value <= max; value += 1) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'bm-chip';
        chip.dataset.chipKey = key;
        chip.dataset.chipValue = String(value);
        chip.textContent = String(value);
        chip.setAttribute('aria-pressed', String(values[key] === value));
        chip.setAttribute('aria-label', `${label} — ${noun} ${value}`);
        chip.addEventListener('click', () => {
          // Minden érték visszavonható, az extra sorokban is: a „nincs
          // megadva" valódi, mentett állapot (pain.general), nem csak
          // kezdeti üresség. Ha nem lehetne visszatérni rá, egy
          // félrekoppintás véglegesen rögzítene egy letiltó fájdalomértéket.
          if (values[key] === value) clearValue(key); else setValue(key, value);
        });
        chips.appendChild(chip);
      }
      row.appendChild(chips);

      // A „letiltva" jelzés CSAK a régióhoz köthető sorokra vonatkozik. Az
      // extra sorok (általános fájdalom) nem tiltanak gyakorlatot: a motor a
      // painfulGroups halmazt kizárólag az izomcsoportonkénti pain[group]
      // értékekből építi, az általános fájdalom csak az összesített
      // készenlétet sapkázza. A jelzés ott olyan következményt ígérne, ami
      // sosem következik be.
      if (blocks && blockFrom !== null && values[key] >= blockFrom) {
        const warn = document.createElement('span');
        warn.className = 'bm-row-warn';
        warn.textContent = 'letiltva';
        row.appendChild(warn);
      }
      return row;
    }));

    if (focused?.key) restoreFocus(focused);
  }

  /** A fókusz visszahelyezése a sorok újraépítése után. */
  function restoreFocus({ key, value }) {
    const sameChip = rows.querySelector(
      `[data-chip-key="${key}"][data-chip-value="${value}"]`);
    if (sameChip) { sameChip.focus(); return; }
    // A sor eltűnt, mert az érték törlődött. A fókusz ilyenkor az izomcsoport
    // térkép-régiójára megy: az ugyanannak az adatnak a másik vezérlője,
    // tehát a felhasználó ott folytathatja, ahol abbahagyta.
    stage.querySelector(`[data-region="${key}"][tabindex="0"]`)?.focus();
  }

  function setView(next) {
    view = next;
    $$('.ds-seg-btn', toggle).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === view));
    });
    renderStage();
  }

  setView('front');
  renderRows();

  return {
    el,
    refresh() { renderStage(); renderRows(); },
  };
}

export { createBodyMap };
