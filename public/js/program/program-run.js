/**
 * Podium — a blokkos program futtatása a felületen
 * ------------------------------------------------------------------------
 * Az aktiválás (a hiányzó TM-ek és 1RM-ek bekérése, a TM-javaslat az 1RM
 * 90%-a), a program helyzete és teendői az Edzés oldal tetején, a ciklus
 * végi és a ciklus közbeni TM-javaslat jóváhagyó kártyája, és a Tervek
 * oldali program-kártya gombjai (aktiválás, kikapcsolás, ugratás).
 * A TM-et az app sosem írja át magától: minden kártya jóváhagyásra vár.
 */
import { api } from '../shared/api.js';
import { $ } from '../shared/dom.js';
import { hooks } from '../shared/page-hooks.js';
import { showToast } from '../shared/toast.js';
import { fill, h } from './h.js';
import { hu, parseKg } from './program-model.js';

/** A jóváhagyó kártya mezőinek beolvasása: az átírt (vagy változatlan)
    érték minden sorra; érvénytelennél hiba és a rossz sorok indexe. */
export function readDecisions(items, texts) {
  const decisions = {};
  const bad = [];
  items.forEach((s, i) => {
    const v = parseKg(texts[i]);
    if (v == null) bad.push(i);
    else decisions[s.exercise] = v;
  });
  return bad.length ? { error: 'Minden TM legyen pozitív szám (pl. 112,5).', bad } : { decisions };
}

const arrow = (s) => (s.suggested > s.current ? '↑' : s.suggested < s.current ? '↓' : '=');

/** A javaslat-táblázat: gyakorlat, jelenlegi → új TM (átírható), indoklás. */
function suggestionTable(items) {
  return h(
    'div',
    { class: 'pr-table', attrs: { role: 'table' } },
    h(
      'div',
      { class: 'pr-tr is-head', attrs: { role: 'row' } },
      ['Gyakorlat', 'Jelenlegi', '', 'Új TM', 'Miért'].map((t) =>
        h('span', { text: t, attrs: { role: 'columnheader' } }),
      ),
    ),
    items.map((s, i) =>
      h(
        'div',
        { class: 'pr-tr', attrs: { role: 'row' } },
        h('span', { class: 'pr-ex', text: s.exercise }),
        h('span', { text: `${hu(s.current)} kg` }),
        h('span', {
          class: `pr-dir ${s.suggested > s.current ? 'is-up' : s.suggested < s.current ? 'is-down' : ''}`,
          text: arrow(s),
        }),
        h(
          'span',
          {},
          h('input', {
            class: 'pr-input',
            value: hu(s.suggested),
            data: { prTm: i },
            attrs: { inputmode: 'decimal', 'aria-label': `${s.exercise} új TM (kg)` },
          }),
          ' kg',
        ),
        h('span', { class: 'pr-why', text: s.reason }),
      ),
    ),
  );
}

/** A kártya mezőiből a döntések; hibánál a rossz mezőket megjelöli. */
function decisionsFrom(card, items) {
  const inputs = [...card.querySelectorAll('[data-pr-tm]')];
  const res = readDecisions(
    items,
    inputs.map((i) => i.value),
  );
  inputs.forEach((input, i) => input.classList.toggle('is-bad', res.bad?.includes(i) ?? false));
  if (res.error) showToast(res.error, 'error');
  return res.decisions ?? null;
}

const button = (text, cls = '') =>
  h('button', { class: `pr-btn ${cls}`, text, attrs: { type: 'button' } });

/** Ciklus vége: az új TM-ek jóváhagyása, utána indul a következő ciklus. */
function renderReviewCard(container, review, { onDone }) {
  const ok = button('Jóváhagyom, indulhat a következő ciklus', 'is-primary');
  const card = h(
    'section',
    { class: 'pr-card' },
    h('h3', { class: 'pr-title', text: `${review.program.cycle}. ciklus vége · új TM-ek` }),
    h('p', {
      class: 'pr-help',
      text: 'Az app a szabályaid alapján javasol. Bármelyik értéket átírhatod — a TM csak a jóváhagyás után változik.',
    }),
    suggestionTable(review.suggestions),
    h('div', { class: 'pr-actions' }, ok),
  );
  ok.addEventListener('click', async () => {
    const decisions = decisionsFrom(card, review.suggestions);
    if (!decisions) return;
    ok.disabled = true;
    try {
      const state = await api.approveProgramReview(review.planId, decisions);
      showToast(`Indul a ${state.cycle}. ciklus az új TM-ekkel`);
      await onDone();
    } catch (err) {
      showToast(err.message || 'Nem sikerült jóváhagyni', 'error');
      ok.disabled = false;
    }
  });
  fill(container, card);
}

/** Ciklus közben egy szabály beütött: elfogadás (onnan építkeznek tovább a
    szabályok) vagy elvetés (a TM marad). */
function renderMidCard(container, mid, { onDone }) {
  const accept = button('Elfogadom', 'is-primary');
  const reject = button('Elvetem');
  const card = h(
    'section',
    { class: 'pr-card is-mid' },
    h('h3', { class: 'pr-title', text: 'Szabály szerinti javaslat' }),
    h('p', {
      class: 'pr-help',
      text: 'Az utolsó edzés vagy hét alapján egy szabály beütött. Ha elfogadod, ez lesz az új TM, és a szabályok innen építkeznek tovább.',
    }),
    suggestionTable(mid.suggestions),
    h('div', { class: 'pr-actions' }, accept, reject),
  );
  const decide = async (decisions, msg) => {
    accept.disabled = true;
    reject.disabled = true;
    try {
      await api.decideProgramMid(mid.planId, decisions);
      showToast(msg);
      await onDone();
    } catch (err) {
      showToast(err.message || 'Nem sikerült menteni a döntést', 'error');
      accept.disabled = false;
      reject.disabled = false;
    }
  };
  accept.addEventListener('click', () => {
    const decisions = decisionsFrom(card, mid.suggestions);
    if (decisions) decide(decisions, 'Elfogadva — a következő edzés már ezzel számol');
  });
  reject.addEventListener('click', () => decide(null, 'Elvetve — a TM-ek maradnak'));
  fill(container, card);
}

/* ---- Aktiválás ---- */
let overlay = null;
const closeActivation = () => {
  overlay?.remove();
  overlay = null;
};

/** Az aktiválási párbeszéd: gyakorlatonként a TM (javaslat: az 1RM 90%-a),
    és a képletekhez hiányzó 1RM-ek. A sikeres aktiválás után `onDone`. */
async function openActivation(planId, { onDone }) {
  const [needs, info] = await Promise.all([
    api.getProgramActivation(planId),
    api.getProgram(planId),
  ]);
  const tms = info.trainingMaxes;
  const field = (kind, ex, value, note) =>
    h(
      'label',
      { class: 'pr-field' },
      h('span', { class: 'pr-field-tag', text: kind === 'tm' ? 'TM' : '1RM' }),
      h('span', { class: 'pr-ex', text: ex }),
      h('input', {
        class: 'pr-input',
        value: value == null ? '' : hu(value),
        data: { [kind === 'tm' ? 'prActTm' : 'prActOrm']: ex },
        attrs: {
          inputmode: 'decimal',
          placeholder: 'kg',
          'aria-label': `${ex} ${kind === 'tm' ? 'TM' : '1RM'} (kg)`,
        },
      }),
      ' kg',
      note ? h('span', { class: 'pr-note', text: note }) : null,
    );
  const missingTms = needs.trainingMaxes;
  const tmRows = missingTms.map((n) =>
    field('tm', n.exercise, n.suggested, n.suggested != null ? '1RM × 90%' : 'nincs 1RM — add meg'),
  );
  const ormRows = needs.oneRms.map((ex) => field('orm', ex, null, null));
  const known = Object.keys(tms).filter((ex) => !missingTms.some((n) => n.exercise === ex));
  const ok = button('Aktiválás', 'is-primary');
  const cancel = button('Mégse');
  const box = h(
    'div',
    {
      class: 'pr-dialog',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Program aktiválása' },
    },
    h('h3', { class: 'pr-title', text: `${info.plan.name} aktiválása` }),
    h('p', {
      class: 'pr-help',
      text: 'A program a training maxokból (TM) számol. Ahol van 1RM, a javaslat annak 90%-a, 2,5 kg-ra kerekítve; ahol nincs, add meg kézzel. Tizedesvessző is jó.',
    }),
    tmRows,
    ormRows.length
      ? [h('p', { class: 'pr-group', text: 'A képletekhez hiányzó 1RM-ek' }), ormRows]
      : null,
    known.length
      ? h('p', {
          class: 'pr-note',
          text: `Már beállítva: ${known.map((ex) => `${ex} ${hu(tms[ex])} kg`).join(', ')}`,
        })
      : null,
    !tmRows.length && !ormRows.length
      ? h('p', { class: 'pr-help', text: 'Minden érték megvan — indulhat.' })
      : null,
    h('div', { class: 'pr-actions' }, ok, cancel),
  );
  closeActivation();
  overlay = h('div', { class: 'fw-overlay' }, box);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeActivation();
  });
  cancel.addEventListener('click', closeActivation);
  ok.addEventListener('click', async () => {
    const read = (attr) => {
      const out = {};
      let good = true;
      box.querySelectorAll(`[data-${attr}]`).forEach((input) => {
        const v = parseKg(input.value);
        input.classList.toggle('is-bad', v == null);
        if (v == null) good = false;
        else out[input.dataset[attr === 'pr-act-tm' ? 'prActTm' : 'prActOrm']] = v;
      });
      return good ? out : null;
    };
    const trainingMaxes = read('pr-act-tm');
    const oneRms = read('pr-act-orm');
    if (!trainingMaxes || !oneRms) {
      showToast('Minden mezőbe pozitív szám kell (pl. 112,5).', 'error');
      return;
    }
    ok.disabled = true;
    try {
      await api.activateProgram(planId, trainingMaxes, oneRms);
      closeActivation();
      showToast('A program aktív — az Edzés oldalon vár az első napod');
      await onDone?.();
    } catch (err) {
      showToast(err.message || 'Nem sikerült aktiválni', 'error');
      ok.disabled = false;
    }
  });
  document.body.append(overlay);
  box.querySelector('input')?.focus();
}

/* ---- Tervek oldal: a program-kártya ---- */

/** A program helyzete egy sorban: „2. ciklus · 1. hét · Guggolásnap · 5/16. nap”. */
export function stateLine(plan) {
  const st = plan.state;
  if (!st) return 'Még nem indult — aktiváld, és az app bekéri a TM-eket.';
  if (st.review) return `${st.cycle}. ciklus vége — az új TM-ek jóváhagyásra várnak`;
  const base = `${st.cycle}. ciklus · ${st.title} · ${st.pos + 1}/${st.total}. nap`;
  return st.mid ? `${base} · szabály-javaslat vár` : base;
}

/** A program-kártya saját gombjai (aktiválás / kikapcsolás, ugratás). */
export function programCardActions(plan, { onChange, confirmAction }) {
  const wrap = h('div', { class: 'pr-card-actions' });
  if (!plan.active) {
    const act = button(plan.state ? 'Folytatás' : 'Aktiválás', 'is-primary');
    act.addEventListener('click', () =>
      openActivation(plan.id, { onDone: onChange }).catch((err) =>
        showToast(err.message || 'Nem sikerült megnyitni az aktiválást', 'error'),
      ),
    );
    wrap.append(act);
    return wrap;
  }
  const off = button('Kikapcsolás');
  off.addEventListener('click', async () => {
    try {
      await api.setPlanActive(plan.id, false);
      showToast('Kikapcsolva — újraaktiváláskor ott folytatod, ahol abbahagytad');
      await onChange();
    } catch (err) {
      showToast(err.message || 'Nem sikerült kikapcsolni', 'error');
    }
  });
  const skips = [
    ['day', 'Következő nap', 'a mai programnapot'],
    ['week', 'Következő hét', 'a hét hátralévő napjait'],
    ['cycle-end', 'Ciklus vége', 'a ciklus hátralévő napjait'],
  ].map(([to, label, what]) => {
    const b = button(label);
    b.addEventListener('click', async () => {
      const ok = await confirmAction?.(
        `Átugrod ${what}? A kihagyott napok nem számítanak bele a szabályokba.`,
        { title: 'Ugratás', confirmLabel: 'Ugrás' },
      );
      if (!ok) return;
      try {
        await api.skipProgram(plan.id, to);
        showToast('Ugratva');
        await onChange();
      } catch (err) {
        showToast(err.message || 'Nem sikerült ugratni', 'error');
      }
    });
    return b;
  });
  wrap.append(h('span', { class: 'pr-group', text: 'Ugratás:' }), ...skips, off);
  return wrap;
}

/* ---- Edzés oldal: a program sávja ---- */

/**
 * Az Edzés oldal tetején a program helyzete (és hiányzó értéknél a pótlás),
 * vagy edzés helyett a jóváhagyó kártya. A `reload` újratölti a mai sablont.
 */
export function setupProgramRun({ reload }) {
  const slot = $('[data-program-slot]');
  const onDone = async () => reload();
  hooks.programTemplate = (template) => {
    if (!slot) return;
    const src = template?.source;
    slot.hidden = !src?.startsWith('program');
    document.body.classList.toggle(
      'has-program-gate',
      src === 'program-review' || src === 'program-mid',
    );
    if (src === 'program-review') return renderReviewCard(slot, template, { onDone });
    if (src === 'program-mid') return renderMidCard(slot, template, { onDone });
    if (src !== 'program') return fill(slot);
    const p = template.program;
    const missing = template.missing ?? [];
    const fix = missing.length ? button('Pótlás') : null;
    fix?.addEventListener('click', () =>
      openActivation(template.planId, { onDone }).catch((err) => showToast(err.message, 'error')),
    );
    const label = (m) =>
      m.kind === 'tm'
        ? `nincs TM: ${m.exercise}`
        : m.kind === 'orm'
          ? `nincs 1RM: ${m.exercise}`
          : 'nincs testsúly';
    fill(
      slot,
      h(
        'div',
        { class: 'pr-strip' },
        h('span', { class: 'pr-strip-tag', text: 'PROGRAM' }),
        h('span', { text: `${p.cycle}. ciklus · ${p.title} · ${p.pos + 1}/${p.total}. nap` }),
      ),
      missing.length
        ? h(
            'p',
            { class: 'pr-warn' },
            `Hiányzó érték: ${missing.map(label).join(', ')}. A súly ott üres marad. `,
            fix,
          )
        : null,
    );
  };
}
