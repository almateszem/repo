/**
 * Podium — a programozó oldal (blokkos program szerkesztése)
 * ------------------------------------------------------------------------
 * Notion-szerű sorszerkesztő: minden sor egy blokk (hét → nap → gyakorlat →
 * szett), bal oldalt `⋮⋮` fogantyúval, a fajta monospace címkéjével; a
 * beágyazást vékony segédvonal mutatja. A szett súlya képlet-blokkokból áll
 * (kattintásra a képletkészítő nyílik), mellette élő kg-előnézet a saját
 * TM-ekből. Bal oldalt a blokktár: húzással vagy „kijelöl → kattint” módon
 * (telefonon is) kerül minden blokk a helyére. Gépelős képletbevitel nincs.
 */
import { api } from '../shared/api.js';
import { $ } from '../shared/dom.js';
import { showToast } from '../shared/toast.js';
import { navigate } from '../app/router.js';
import { renderPlans } from '../plans/plans.js';
import {
  CATS,
  addDay,
  addSet,
  addWeek,
  applyDrop,
  moveExercise,
  removeDay,
  removeExercise,
  removeSet,
  removeWeek,
  sideItems,
  starterProgram,
  weekRowSummary,
} from './block-library.js';
import {
  duplicateDay,
  duplicateWeek,
  evalFormula,
  formulaLabel,
  hu,
  missingText,
  roundToPlate,
} from './program-model.js';
import { acceptExternalDrag, openFormulaWindow, pushToFormulaWindow } from './formula-window.js';
import { renderRules } from './rule-editor.js';
import { fill, h } from './h.js';

/** A programozó oldal vezérlője: { startNew(), open(planId) }. */
export function setupProgramBuilder(confirmAction) {
  const page = $('.app-page[data-page="program-builder"]');
  const nameInput = $('#program-name', page);
  const main = $('[data-pgm-main]', page);
  const catsEl = $('[data-pgm-cats]', page);
  const blocksEl = $('[data-pgm-blocks]', page);
  const saveBtn = $('[data-action="save-program"]', page);

  const S = {
    id: null,
    program: starterProgram(),
    collapsed: new Set(),
    pick: null, // a ⋮⋮ fogantyúval kijelölt sor céljának adatai
    cat: 'struct',
    exq: '',
    exercises: [],
    ctx: { trainingMaxes: {}, oneRms: {}, bodyweight: null },
    defaultSteps: {},
  };
  let dragItem = null;
  let sideList = [];
  // A blokktárból a nyitott képletkészítőbe is lehet húzni
  acceptExternalDrag(() => (dragItem?.kind === 'node' ? dragItem.n : null));

  /** A program gyakorlatai és az ismert 1RM-ek — az „1RM: gyakorlat” választója. */
  const programExercises = () => [
    ...S.program.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises.map((e) => e.name))),
    ...Object.keys(S.ctx.oneRms),
  ];

  /* ---- adatok ---- */
  async function loadContext() {
    const [tms, orms] = await Promise.all([
      api.getTrainingMaxes().catch(() => ({})),
      api.getExerciseMaxes().catch(() => ({})),
    ]);
    S.ctx = { trainingMaxes: tms, oneRms: orms, bodyweight: null };
  }
  async function searchExercises() {
    try {
      const res = await api.searchExercises({ q: S.exq, limit: 40 });
      S.exercises = res.items.map((i) => i.name);
    } catch {
      S.exercises = [];
    }
    if (S.cat === 'ex') renderSide();
  }

  const setProgram = (next) => {
    S.program = next;
    render();
  };

  /* ---- élő előnézet ---- */
  function preview(formula, exercise) {
    if (!formula) return { text: '', bad: false }; // a súly-mező maga mondja ki
    try {
      const kg = roundToPlate(evalFormula(formula, { ...S.ctx, exercise }));
      return { text: `${hu(kg)} kg`, bad: false };
    } catch (err) {
      return { text: missingText(err), bad: true };
    }
  }

  /* ---- sorok ---- */
  const grip = (data) =>
    h('button', {
      class: 'pgm-grip',
      text: '⋮⋮',
      data: { act: 'pick', ...data },
      attrs: { type: 'button', 'aria-label': 'Sor kijelölése a blokktárhoz', title: 'Kijelölés' },
    });
  const btn = (text, act, data, label) =>
    h('button', {
      class: 'pgm-btn',
      text,
      data: { act, ...data },
      attrs: { type: 'button', 'aria-label': label ?? text, title: label ?? text },
    });
  const isPicked = (data) =>
    S.pick &&
    S.pick.dz === data.dz &&
    ['w', 'd', 'e', 's'].every((k) => String(S.pick[k] ?? '') === String(data[k] ?? ''));
  const row = (kind, data, ...kids) =>
    h(
      'div',
      { class: `pgm-row is-${kind}${isPicked(data) ? ' is-picked' : ''}` },
      grip(data),
      kids,
    );

  function formulaPills(formula, data) {
    return h(
      'button',
      {
        class: `pgm-weight${formula ? '' : ' is-free'}`,
        data: { act: 'formula', ...data },
        attrs: { type: 'button', title: 'Súlyképlet szerkesztése' },
      },
      formula ? pillsFor(formula) : h('span', { class: 'pgm-free', text: 'a napon döntöd el' }),
    );
  }

  function setRow(set, w, d, e, s, exName) {
    const data = { dz: 'setw', w, d, e, s };
    const pv = preview(set.weight, exName);
    return h(
      'div',
      { class: 'pgm-node', data },
      row(
        'set',
        data,
        h('span', { class: 'pgm-tag t-set', text: 'SZETT' }),
        h('input', {
          class: 'pgm-num',
          value: set.count,
          data: { field: 'count', w, d, e, s },
          attrs: { inputmode: 'numeric', 'aria-label': 'Szettek száma' },
        }),
        h('span', { class: 'pgm-x', text: '×' }),
        h('input', {
          class: 'pgm-num',
          value: set.reps,
          data: { field: 'reps', w, d, e, s },
          attrs: { inputmode: 'numeric', 'aria-label': 'Ismétlés' },
        }),
        h('button', {
          class: `pgm-amrap${set.amrap ? ' is-on' : ''}`,
          text: set.amrap ? `${set.reps}+ AMRAP` : 'AMRAP',
          data: { act: 'amrap', w, d, e, s },
          attrs: { type: 'button', 'aria-pressed': String(set.amrap) },
        }),
        formulaPills(set.weight, data),
        h('span', { class: `pgm-preview${pv.bad ? ' is-missing' : ''}`, text: pv.text }),
        btn('✕', 'del-set', { w, d, e, s }, 'Szett törlése'),
      ),
    );
  }

  function exerciseNode(ex, w, d, e) {
    const data = { dz: 'ex', w, d, e };
    return h(
      'div',
      { class: 'pgm-node', data },
      row(
        'ex',
        data,
        h('button', {
          class: `pgm-tag t-ex${ex.role === 'main' ? ' is-main' : ''}`,
          text: ex.role === 'main' ? 'FŐ' : 'KIEG',
          data: { act: 'role', w, d, e },
          attrs: { type: 'button', title: 'Fő / kiegészítő gyakorlat' },
        }),
        h('span', { class: 'pgm-ex-name', text: ex.name }),
        btn('↑', 'ex-up', { w, d, e }, 'Feljebb'),
        btn('↓', 'ex-down', { w, d, e }, 'Lejjebb'),
        btn('+ szett', 'add-set', { w, d, e }, 'Új szett-sor'),
        btn('✕', 'del-ex', { w, d, e }, 'Gyakorlat törlése'),
      ),
      h(
        'div',
        { class: 'pgm-children' },
        ex.sets.map((set, s) => setRow(set, w, d, e, s, ex.name)),
      ),
    );
  }

  function dayNode(day, w, d) {
    const data = { dz: 'day', w, d };
    return h(
      'div',
      { class: 'pgm-node', data },
      row(
        'day',
        data,
        h('span', { class: 'pgm-tag t-day', text: `${d + 1}. NAP` }),
        h('input', {
          class: 'pgm-name',
          value: day.name,
          data: { field: 'dayName', w, d },
          attrs: {
            maxlength: '40',
            placeholder: 'a nap neve (nem kötelező)',
            'aria-label': 'A nap neve',
          },
        }),
        btn('+ gyakorlat', 'add-ex', { w, d }, 'Gyakorlat hozzáadása'),
        btn('⧉', 'dup-day', { w, d }, 'Nap másolása'),
        btn('✕', 'del-day', { w, d }, 'Nap törlése'),
      ),
      h(
        'div',
        { class: 'pgm-children' },
        day.exercises.length
          ? day.exercises.map((ex, e) => exerciseNode(ex, w, d, e))
          : h('p', { class: 'pgm-empty', text: 'Húzz ide egy gyakorlatot a blokktárból.' }),
      ),
    );
  }

  function weekNode(week, w) {
    const data = { dz: 'week', w };
    const closed = S.collapsed.has(w);
    return h(
      'div',
      { class: 'pgm-node', data },
      row(
        'week',
        data,
        h('button', {
          class: 'pgm-toggle',
          text: closed ? '▸' : '▾',
          data: { act: 'toggle', w },
          attrs: {
            type: 'button',
            'aria-expanded': String(!closed),
            'aria-label': 'Hét ki/becsukása',
          },
        }),
        h('span', { class: 'pgm-tag t-week', text: 'HÉT' }),
        h('input', {
          class: 'pgm-name',
          value: week.label,
          data: { field: 'weekLabel', w },
          attrs: { maxlength: '40', 'aria-label': 'A hét címkéje' },
        }),
        closed ? h('span', { class: 'pgm-summary', text: weekRowSummary(week) }) : null,
        btn('+ nap', 'add-day', { w }, 'Új nap'),
        btn('⧉', 'dup-week', { w }, 'Hét másolása'),
        btn('✕', 'del-week', { w }, 'Hét törlése'),
      ),
      closed
        ? null
        : h(
            'div',
            { class: 'pgm-children' },
            week.days.map((day, d) => dayNode(day, w, d)),
          ),
    );
  }

  function render() {
    const rulesCard = h('section', {
      class: 'pgm-rules',
      data: { dz: 'rules' },
      attrs: { 'aria-label': 'Szabályok' },
    });
    renderRules(rulesCard, S.program, {
      onChange: setProgram,
      defaultSteps: S.defaultSteps,
      pillsFor,
      openFormula: (cfg) =>
        openFormulaWindow({
          ...cfg,
          exercises: programExercises(),
          preview: (f) => (f ? formulaLabel(f) : 'üres — a szabály nem fut, amíg ki nem töltöd'),
        }),
    });
    fill(
      main,
      ...S.program.weeks.map((week, w) => weekNode(week, w)),
      h('button', {
        class: 'pgm-add-week',
        text: '+ Hét',
        data: { act: 'add-week' },
        attrs: { type: 'button' },
      }),
      rulesCard,
    );
    renderSide();
  }

  /* ---- blokktár ---- */
  function renderSide() {
    fill(
      catsEl,
      ...CATS.map((c) => {
        const b = h('button', {
          class: `pgm-cat c-${c.tone}${c.k === S.cat ? ' is-on' : ''}`,
          data: { cat: c.k },
          attrs: { type: 'button', role: 'tab', 'aria-selected': String(c.k === S.cat) },
        });
        c.label.split('|').forEach((part, i) => {
          if (i) b.append(document.createElement('br'));
          b.append(part);
        });
        return b;
      }),
    );
    const cat = CATS.find((c) => c.k === S.cat);
    sideList = sideItems(S.cat, S.exercises);
    const hadFocus = document.activeElement?.dataset?.pgmSearch != null;
    const search =
      S.cat === 'ex'
        ? h('input', {
            class: 'pgm-search',
            value: S.exq,
            data: { pgmSearch: '' },
            attrs: { placeholder: 'Keresés…', 'aria-label': 'Gyakorlat keresése' },
          })
        : null;
    fill(
      blocksEl,
      h(
        'p',
        { class: 'pgm-hint', text: cat.hint },
        S.pick ? h('b', { text: ' Kijelölve egy sor: kattints egy blokkra.' }) : null,
      ),
      search,
      ...sideList.map((it, i) =>
        h('button', {
          class: `pgm-block b-${it.tone}${it.kind === 'node' ? ' is-reporter' : ''}`,
          text: it.lab,
          data: { pl: i },
          attrs: { type: 'button', draggable: 'true' },
        }),
      ),
    );
    if (hadFocus && search) {
      search.focus();
      search.setSelectionRange(S.exq.length, S.exq.length);
    }
  }

  function drop(item, target) {
    const res = applyDrop(S.program, item, target);
    if (res.error) {
      showToast(res.error, 'error');
      return;
    }
    S.pick = null;
    if (item.kind === 'struct' && item.what === 'week') S.collapsed.clear();
    setProgram(res.program);
  }

  catsEl.addEventListener('click', (event) => {
    const b = event.target.closest('[data-cat]');
    if (!b) return;
    S.cat = b.dataset.cat;
    renderSide();
    if (S.cat === 'ex' && S.exercises.length === 0) searchExercises();
  });
  let searchTimer = null;
  blocksEl.addEventListener('input', (event) => {
    if (event.target.dataset.pgmSearch == null) return;
    S.exq = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchExercises, 200);
  });
  blocksEl.addEventListener('click', (event) => {
    const el = event.target.closest('[data-pl]');
    if (!el) return;
    const item = sideList[Number(el.dataset.pl)];
    if (!item) return;
    // Nyitott képletkészítőnél a kijelölt helyére kerül
    if (item.kind === 'node' && pushToFormulaWindow(item.n)) return;
    if (S.pick) return drop(item, S.pick);
    if (item.kind === 'struct' && item.what === 'week') return drop(item, {});
    showToast('Húzd a blokkot a helyére, vagy előbb jelölj ki egy sort a ⋮⋮ fogantyúval.');
  });
  blocksEl.addEventListener('dragstart', (event) => {
    const el = event.target.closest?.('[data-pl]');
    if (!el) return;
    dragItem = sideList[Number(el.dataset.pl)];
    event.dataTransfer.setData('text/plain', 'pgm-block');
    event.dataTransfer.effectAllowed = 'copy';
  });
  const clearHover = () =>
    page.querySelectorAll('.is-drop-hover').forEach((x) => x.classList.remove('is-drop-hover'));
  document.addEventListener('dragend', () => {
    dragItem = null;
    clearHover();
  });
  main.addEventListener('dragover', (event) => {
    if (!dragItem) return;
    const t = event.target.closest('[data-dz]');
    clearHover();
    if (t || (dragItem.kind === 'struct' && dragItem.what === 'week')) {
      event.preventDefault();
      t?.classList.add('is-drop-hover');
    }
  });
  main.addEventListener('drop', (event) => {
    if (!dragItem) return;
    event.preventDefault();
    const t = event.target.closest('[data-dz]');
    const item = dragItem;
    dragItem = null;
    clearHover();
    drop(item, t ? { ...t.dataset } : {});
  });

  /* ---- sor-műveletek ---- */
  const at = (data) => [Number(data.w), Number(data.d), Number(data.e), Number(data.s)];
  async function confirmRemove(what) {
    return (
      (await confirmAction?.(
        `Biztosan törlöd ${what}? A mentésig visszaállítható a Vissza gombbal.`,
        {
          title: 'Törlés',
          confirmLabel: 'Törlöm',
        },
      )) ?? true
    );
  }

  main.addEventListener('click', async (event) => {
    const el = event.target.closest('[data-act]');
    if (!el) return;
    const data = el.dataset;
    const [w, d, e, s] = at(data);
    const p = S.program;
    switch (data.act) {
      case 'pick': {
        const target = { ...el.closest('[data-dz]').dataset };
        S.pick = isPicked(target) ? null : target;
        page.classList.toggle('pgm-side-open', Boolean(S.pick));
        return render();
      }
      case 'toggle':
        if (S.collapsed.has(w)) S.collapsed.delete(w);
        else S.collapsed.add(w);
        return render();
      case 'add-week':
        S.collapsed.clear();
        return setProgram(addWeek(p));
      case 'add-day':
        return setProgram(addDay(p, w));
      case 'dup-week':
        S.collapsed.clear();
        return setProgram(duplicateWeek(p, w));
      case 'dup-day':
        return setProgram(duplicateDay(p, w, d));
      case 'add-set':
        return setProgram(addSet(p, w, d, e));
      case 'ex-up':
        return setProgram(moveExercise(p, w, d, e, -1));
      case 'ex-down':
        return setProgram(moveExercise(p, w, d, e, 1));
      case 'role': {
        const next = structuredClone(p);
        const ex = next.weeks[w].days[d].exercises[e];
        ex.role = ex.role === 'main' ? 'accessory' : 'main';
        return setProgram(next);
      }
      case 'amrap': {
        const next = structuredClone(p);
        const set = next.weeks[w].days[d].exercises[e].sets[s];
        set.amrap = !set.amrap;
        return setProgram(next);
      }
      case 'add-ex':
        S.pick = { dz: 'day', w: String(w), d: String(d) };
        S.cat = 'ex';
        page.classList.add('pgm-side-open');
        render();
        if (S.exercises.length === 0) searchExercises();
        return showToast('Válassz gyakorlatot a blokktárból — a kijelölt napra kerül.');
      case 'formula': {
        const ex = p.weeks[w].days[d].exercises[e];
        return openFormulaWindow({
          title: `${ex.name} · ${ex.sets[s].reps} ism.`,
          formula: ex.sets[s].weight,
          where: 'set',
          exercises: programExercises(),
          preview: (f) => (f ? `= ${preview(f, ex.name).text}` : 'a napon döntöd el'),
          onChange: (formula) => {
            const next = structuredClone(S.program);
            next.weeks[w].days[d].exercises[e].sets[s].weight = formula;
            setProgram(next);
          },
        });
      }
      case 'del-set':
        if (p.weeks[w].days[d].exercises[e].sets.length === 1)
          return showToast('Egy gyakorlatnak legalább egy szett-sora legyen.', 'error');
        return setProgram(removeSet(p, w, d, e, s));
      case 'del-ex':
        if (await confirmRemove(`a(z) „${p.weeks[w].days[d].exercises[e].name}” gyakorlatot`))
          setProgram(removeExercise(S.program, w, d, e));
        return;
      case 'del-day':
        if (p.weeks[w].days.length === 1)
          return showToast('Egy hétnek legalább egy napja legyen.', 'error');
        if (await confirmRemove('ezt a napot')) setProgram(removeDay(S.program, w, d));
        return;
      case 'del-week':
        if (p.weeks.length === 1)
          return showToast('A programnak legalább egy hete legyen.', 'error');
        if (await confirmRemove('ezt a hetet')) {
          S.collapsed.clear();
          setProgram(removeWeek(S.program, w));
        }
        return;
      default:
    }
  });

  main.addEventListener('change', (event) => {
    const el = event.target;
    const field = el.dataset?.field;
    if (!field) return;
    const [w, d, e, s] = at(el.dataset);
    const next = structuredClone(S.program);
    if (field === 'weekLabel') next.weeks[w].label = el.value.trim().slice(0, 40);
    else if (field === 'dayName') next.weeks[w].days[d].name = el.value.trim().slice(0, 40);
    else {
      const n = Math.round(Number(String(el.value).replace(',', '.')));
      const [min, max] = field === 'count' ? [1, 20] : [0, 100];
      if (!Number.isFinite(n) || n < min || n > max) {
        showToast(
          `${field === 'count' ? 'A szettek száma' : 'Az ismétlés'} ${min}–${max} között lehet.`,
          'error',
        );
        return render();
      }
      next.weeks[w].days[d].exercises[e].sets[s][field] = n;
    }
    setProgram(next);
  });

  $('[data-action="program-side"]', page).addEventListener('click', () =>
    page.classList.toggle('pgm-side-open'),
  );
  $('[data-action="program-back"]', page).addEventListener('click', () => navigate('plans'));

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('Adj nevet a programnak.', 'error');
      nameInput.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      const plan = S.id
        ? await api.updateProgram(S.id, name, S.program)
        : await api.createProgram(name, S.program);
      S.id = plan.id;
      showToast(`„${name}” mentve`);
      await renderPlans().catch(() => {});
      navigate('plans');
    } catch (err) {
      showToast(err.message || 'Nem sikerült menteni a programot', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  /** Képlet a sorban: színezett „pill”-ek (szám szürke, változó sárga,
      teljesítmény lila, művelet zöld). A címke a formulaLabel-é. */
  function pillsFor(formula) {
    const tone =
      formula?.t === 'num'
        ? 'num'
        : formula?.t === 'op'
          ? 'op'
          : formula?.t === 'stat'
            ? 'stat'
            : formula?.t === 'newOrm'
              ? 'new'
              : 'var';
    if (formula?.t !== 'op')
      return h('span', {
        class: `pgm-pill p-${formula ? tone : 'slot'}`,
        text: formulaLabel(formula),
      });
    return h(
      'span',
      { class: 'pgm-pill p-op' },
      pillsFor(formula.a),
      h('span', { class: 'pgm-opsign', text: { '*': '×', '+': '+', '-': '−' }[formula.op] }),
      pillsFor(formula.b),
    );
  }

  async function reset(state) {
    Object.assign(S, { collapsed: new Set(), pick: null, ...state });
    page.classList.remove('pgm-side-open');
    render();
    await loadContext();
    render();
  }

  return {
    startNew() {
      nameInput.value = 'Új program';
      reset({ id: null, program: starterProgram(), defaultSteps: {} });
    },
    async open(planId) {
      const data = await api.getProgram(planId);
      nameInput.value = data.plan.name;
      // a 2. héttől alapból becsukva: a hosszú program is elfér
      const collapsed = new Set(data.plan.program.weeks.map((_, i) => i).filter((i) => i > 0));
      await reset({ id: planId, program: data.plan.program, defaultSteps: data.defaultSteps });
      S.collapsed = collapsed;
      render();
    },
  };
}
