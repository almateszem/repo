/**
 * Podium — a képletkészítő ablak
 * ------------------------------------------------------------------------
 * Egy szett súlya (vagy egy szabály feltételének / akciójának képlete)
 * Scratch-féle riporter-blokkokból. A vásznon helyek (szaggatott keret) és
 * egymásba ágyazott blokkok; a palettáról húzással, vagy „hely kijelölése →
 * blokkra kattintás” módon kerül egy blokk a helyére (érintőképernyőn is).
 * A művelet egy meglévő értékre téve körbeöleli azt. Gépelés csak a szám-
 * mezőben van (pl. „85%”), képletet begépelni nem lehet.
 */
import { showToast } from '../shared/toast.js';
import { h } from './h.js';
import {
  STAT_LABELS,
  canUseNode,
  formulaLabel,
  getAt,
  insertBlock,
  insertIntoRoot,
  removeAt,
  setAt,
} from './program-model.js';

const num = (v, pct = false) => ({ t: 'num', v, pct });
const PALETTE = [
  [
    'Értékek',
    [num(50, true), num(20), { t: 'tm' }, { t: 'orm', ex: null }, { t: 'bw' }, { t: 'newOrm' }],
  ],
  [
    'Teljesítmény',
    ['doneEx', 'totalEx', 'doneAll', 'totalAll', 'amrapReps', 'amrapTarget'].map((k) => ({
      t: 'stat',
      k,
    })),
  ],
  ['Check-in', ['pain', 'readiness', 'sleep'].map((k) => ({ t: 'stat', k }))],
  ['Műveletek', ['*', '+', '-'].map((op) => ({ t: 'op', op, a: null, b: null }))],
];
const TONE = {
  num: 'num',
  tm: 'var',
  orm: 'var',
  bw: 'var',
  newOrm: 'new',
  stat: 'stat',
  op: 'op',
};

let W = null; // a nyitott ablak állapota: { cfg, root, sel }
let overlay = null;
let paletteDrag = null;
let externalDrag = () => null;

/** A blokktár húzása is célba érhet az ablakban: a builder adja a forrást. */
export function acceptExternalDrag(getNode) {
  externalDrag = getNode;
}

/** Szám-mező beolvasása: „85%” → százalék, „12,5” → 12.5; rossz → null. */
function parseNum(text) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(%?)\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const v = Number(m[1].replace(',', '.'));
  return v <= 10000 ? num(v, m[2] === '%') : null;
}

function commit(root, sel = W.sel) {
  W.root = root;
  W.sel = sel;
  W.cfg.onChange(root);
  render();
}

/** Blokk a kijelölt helyre (vagy a gyökérbe), a hely-szabály ellenőrzésével. */
function place(node, path = W.sel) {
  const msg = canUseNode(node, W.cfg.where);
  if (msg) {
    showToast(msg, 'error');
    return;
  }
  if (path == null) return commit(insertIntoRoot(W.root, node), null);
  const { root, nextSel } = insertBlock(W.root, path, node);
  commit(root, nextSel);
}

/** A nyitott ablakba tesz egy blokkot (a blokktár kattintása). Igaz, ha volt
    nyitott ablak — ilyenkor a blokktár nem keres más célt. */
export function pushToFormulaWindow(node) {
  if (!W) return false;
  place(node);
  return true;
}

const removeBtn = (path) =>
  h('button', {
    class: 'fw-remove',
    text: '×',
    data: { fwAct: 'remove', path },
    attrs: { type: 'button', 'aria-label': 'Blokk kivétele' },
  });

/** Egy hely a vásznon: üres hely vagy blokk, egymásba ágyazva. */
function slot(node, path) {
  const selected = W.sel === path;
  if (!node) {
    return h('button', {
      class: `fw-slot${selected ? ' is-sel' : ''}`,
      text: '□',
      data: { fwAct: 'select', path },
      attrs: { type: 'button', 'aria-label': 'Üres hely — kijelölés' },
    });
  }
  const cls = `fw-block t-${TONE[node.t] ?? 'var'}${selected ? ' is-sel' : ''}`;
  if (node.t === 'op') {
    return h(
      'span',
      { class: cls, data: { fwAct: 'select', path } },
      h('span', { class: 'fw-paren', text: '(' }),
      slot(node.a, path ? `${path}.a` : 'a'),
      h(
        'select',
        { class: 'fw-op', data: { fwOp: path }, attrs: { 'aria-label': 'Művelet' } },
        ['*', '+', '-'].map((op) => {
          const o = h('option', { text: { '*': '×', '+': '+', '-': '−' }[op], value: op });
          o.selected = op === node.op;
          return o;
        }),
      ),
      slot(node.b, path ? `${path}.b` : 'b'),
      h('span', { class: 'fw-paren', text: ')' }),
      removeBtn(path),
    );
  }
  if (node.t === 'num') {
    return h(
      'span',
      { class: cls, data: { fwAct: 'select', path } },
      h('input', {
        class: 'fw-num',
        value: formulaLabel(node),
        data: { fwNum: path },
        attrs: { inputmode: 'decimal', 'aria-label': 'Szám vagy százalék (pl. 85%)' },
      }),
      removeBtn(path),
    );
  }
  if (node.t === 'orm') {
    const exercises = [...new Set(W.cfg.exercises ?? [])];
    return h(
      'span',
      { class: cls, data: { fwAct: 'select', path } },
      '1RM: ',
      h(
        'select',
        {
          class: 'fw-orm',
          data: { fwOrm: path },
          attrs: { 'aria-label': 'Melyik gyakorlat 1RM-je' },
        },
        [['', 'ez a gyakorlat'], ...exercises.map((e) => [e, e])].map(([v, label]) => {
          const o = h('option', { text: label, value: v });
          o.selected = (node.ex ?? '') === v;
          return o;
        }),
      ),
      removeBtn(path),
    );
  }
  return h(
    'span',
    { class: cls, data: { fwAct: 'select', path } },
    node.t === 'stat' ? STAT_LABELS[node.k] : formulaLabel(node),
    removeBtn(path),
  );
}

function render() {
  if (!W) {
    overlay?.remove();
    overlay = null;
    return;
  }
  const { cfg } = W;
  const palette = PALETTE.map(([group, nodes]) => {
    const usable = nodes.filter((n) => !canUseNode(n, cfg.where));
    if (!usable.length) return null;
    return h(
      'div',
      { class: 'fw-group' },
      h('p', { class: 'fw-group-label', text: group }),
      usable.map((n, i) =>
        h('button', {
          class: `fw-pal t-${TONE[n.t]}`,
          text:
            n.t === 'op' ? formulaLabel(n) : n.t === 'orm' ? '1RM: gyakorlat ▾' : formulaLabel(n),
          data: { fwPal: JSON.stringify(n), i },
          attrs: { type: 'button', draggable: 'true' },
        }),
      ),
    );
  });
  const box = h(
    'div',
    {
      class: 'fw-box',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Képletkészítő' },
    },
    h(
      'header',
      { class: 'fw-head' },
      h('p', { class: 'fw-title', text: cfg.title }),
      h('button', {
        class: 'fw-close',
        text: '✕',
        data: { fwAct: 'close' },
        attrs: { type: 'button', 'aria-label': 'Bezárás' },
      }),
    ),
    h('div', { class: 'fw-canvas', data: { fwAct: 'select-root' } }, slot(W.root, '')),
    h('p', {
      class: 'fw-hint',
      text:
        W.sel == null
          ? 'Kattints egy helyre, majd egy blokkra — vagy húzd a blokkot a helyére.'
          : 'Kijelölt hely: kattints egy blokkra a palettán vagy a blokktárban.',
    }),
    h('div', { class: 'fw-palette' }, palette),
    h(
      'footer',
      { class: 'fw-foot' },
      h('span', { class: 'fw-result', text: cfg.preview(W.root) }),
      cfg.noFree
        ? null
        : h('button', {
            class: 'fw-btn',
            text: 'Napon döntöd el',
            data: { fwAct: 'free' },
            attrs: { type: 'button' },
          }),
      h('button', {
        class: 'fw-btn is-primary',
        text: 'Kész',
        data: { fwAct: 'close' },
        attrs: { type: 'button' },
      }),
    ),
  );
  if (!overlay) {
    overlay = h('div', { class: 'fw-overlay' });
    bind(overlay);
    document.body.append(overlay);
  }
  const focused = document.activeElement?.dataset?.fwNum;
  overlay.replaceChildren(box);
  if (focused != null) overlay.querySelector(`[data-fw-num="${focused}"]`)?.focus();
}

function close() {
  W = null;
  render();
}

function bind(el) {
  el.addEventListener('click', (event) => {
    if (event.target === el) return close();
    const pal = event.target.closest('[data-fw-pal]');
    if (pal) return place(JSON.parse(pal.dataset.fwPal));
    const act = event.target.closest('[data-fw-act]');
    if (!act || event.target.closest('input, select')) return;
    const path = act.dataset.path ?? '';
    switch (act.dataset.fwAct) {
      case 'close':
        return close();
      case 'free':
        W.cfg.onChange(null);
        return close();
      case 'remove':
        return commit(removeAt(W.root, path), path);
      case 'select':
        W.sel = path;
        return render();
      case 'select-root':
        W.sel = W.root ? null : '';
        return render();
      default:
    }
  });
  el.addEventListener('change', (event) => {
    const t = event.target;
    if (t.dataset.fwNum != null) {
      const n = parseNum(t.value);
      if (!n) {
        showToast('Számot írj, pl. 85% vagy 12,5', 'error');
        return render();
      }
      return commit(setAt(W.root, t.dataset.fwNum, n));
    }
    if (t.dataset.fwOp != null) {
      const path = t.dataset.fwOp;
      return commit(setAt(W.root, path, { ...getAt(W.root, path), op: t.value }));
    }
    if (t.dataset.fwOrm != null) {
      return commit(setAt(W.root, t.dataset.fwOrm, { t: 'orm', ex: t.value || null }));
    }
  });
  el.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  el.addEventListener('dragstart', (event) => {
    const pal = event.target.closest?.('[data-fw-pal]');
    if (!pal) return;
    paletteDrag = JSON.parse(pal.dataset.fwPal);
    event.dataTransfer.setData('text/plain', 'fw-block');
  });
  el.addEventListener('dragover', (event) => {
    if ((paletteDrag || externalDrag()) && event.target.closest('[data-path], .fw-canvas'))
      event.preventDefault();
  });
  el.addEventListener('drop', (event) => {
    const node = paletteDrag ?? externalDrag();
    paletteDrag = null;
    if (!node) return;
    event.preventDefault();
    const target = event.target.closest('[data-path]');
    place(node, target ? target.dataset.path : null);
  });
}

/**
 * Az ablak megnyitása. A `where` a hely-szabály ('set' | 'cond' | 'act');
 * a `preview(formula)` az eredménysor szövege; az `onChange` minden
 * változásnál a teljes képletet kapja (null = „a napon döntöd el”).
 */
export function openFormulaWindow(cfg) {
  W = { cfg, root: cfg.formula ?? null, sel: cfg.formula ? null : '' };
  render();
  overlay.querySelector('.fw-close')?.focus();
}
