/**
 * Podium — a szabályok szerkesztője a programozó oldalon
 * ------------------------------------------------------------------------
 * Szabályonként: mikor fut (minden edzés után / minden hét után / a ciklus
 * végén), HA [feltétel], AKKOR [TM-változtatás], KÜLÖNBEN [változtatás vagy
 * nincs]. Az összehasonlítás két oldala képlet: a blokktárból húzható rá
 * érték, teljesítmény- vagy check-in blokk, kattintásra a képletkészítő
 * nyílik. Alatta a gyakorlatonkénti lépésköz („TM + lépésköz”).
 */
import { fill, h } from './h.js';
import { formulaLabel, hu } from './program-model.js';

const ON = [
  ['workout', 'minden edzés után'],
  ['week', 'minden hét után'],
  ['cycle', 'a ciklus végén'],
];
const CMP = [
  ['<', '<'],
  ['<=', '≤'],
  ['=', '='],
  ['>=', '≥'],
  ['>', '>'],
];
const ACTIONS = [
  ['step', 'TM + lépésköz'],
  ['addKg', 'TM + x kg'],
  ['addPct', 'TM ± x%'],
  ['set', 'TM = képlet'],
];
const num = (v, pct = false) => ({ t: 'num', v, pct });

/** Azok a gyakorlatok, amelyek bármely szett-képlete TM-et használ. */
export function tmExercisesOf(program) {
  const out = [];
  const hasTm = (n) => Boolean(n) && (n.t === 'tm' || (n.t === 'op' && (hasTm(n.a) || hasTm(n.b))));
  for (const w of program.weeks)
    for (const d of w.days)
      for (const e of d.exercises)
        if (e.sets.some((s) => hasTm(s.weight)) && !out.includes(e.name)) out.push(e.name);
  return out;
}

const select = (options, value, data, label) =>
  h(
    'select',
    { class: 'pgm-select', data, attrs: { 'aria-label': label } },
    options.map(([v, text]) => {
      const o = h('option', { text, value: v });
      o.selected = v === value;
      return o;
    }),
  );

/** Egy akció új alakja a választott fajtára. */
function actionOf(kind, prev) {
  switch (kind) {
    case 'none':
      return null;
    case 'step':
      return { t: 'step' };
    case 'addKg':
      return { t: 'addKg', kg: prev?.t === 'addKg' ? prev.kg : 5 };
    case 'addPct':
      return { t: 'addPct', pct: prev?.t === 'addPct' ? prev.pct : -10 };
    default:
      return {
        t: 'set',
        formula:
          prev?.t === 'set'
            ? prev.formula
            : { t: 'op', op: '*', a: num(95, true), b: { t: 'newOrm' } },
      };
  }
}

/**
 * A Szabályok kártya kirajzolása a `container`-be. A `deps`:
 * { onChange(program), defaultSteps, pillsFor(formula), openFormula(cfg) }.
 */
export function renderRules(container, program, deps) {
  const change = (fn) => {
    const next = structuredClone(program);
    fn(next);
    deps.onChange(next);
  };
  const slotBtn = (formula, dz, path, title, where) => {
    const b = h(
      'button',
      {
        class: `pgm-weight pgm-rule-slot${formula ? '' : ' is-free'}`,
        data: { dz, path, ruleSlot: path },
        attrs: { type: 'button', title: 'Képlet szerkesztése — vagy húzz ide egy blokkot' },
      },
      formula ? deps.pillsFor(formula) : h('span', { class: 'pgm-free', text: '□ húzz ide' }),
    );
    b.addEventListener('click', () =>
      deps.openFormula({
        title,
        formula,
        where,
        noFree: true,
        onChange: (f) =>
          change((p) => {
            const [ri, key] = path.split('.');
            if (dz === 'cond') p.rules[ri].when[key] = f;
            else p.rules[ri][key].formula = f;
          }),
      }),
    );
    return b;
  };

  const actionRow = (rule, ri, key, label) => {
    const a = rule[key];
    const kinds = key === 'otherwise' ? [['none', 'nincs'], ...ACTIONS] : ACTIONS;
    const kindSel = select(kinds, a?.t ?? 'none', { ruleAct: `${ri}.${key}` }, label);
    kindSel.addEventListener('change', () =>
      change((p) => {
        p.rules[ri][key] = actionOf(kindSel.value, p.rules[ri][key]);
      }),
    );
    let extra = null;
    if (a?.t === 'addKg' || a?.t === 'addPct') {
      const field = a.t === 'addKg' ? 'kg' : 'pct';
      extra = h('input', {
        class: 'pgm-num',
        value: hu(a[field]),
        attrs: { inputmode: 'decimal', 'aria-label': a.t === 'addKg' ? 'kg' : 'százalék' },
      });
      extra.addEventListener('change', () => {
        const v = Number(String(extra.value).replace(',', '.'));
        if (!Number.isFinite(v) || v < -100 || v > 100) return deps.onChange(program);
        change((p) => {
          p.rules[ri][key][field] = v;
        });
      });
      extra = [extra, h('span', { class: 'pgm-x', text: a.t === 'addKg' ? 'kg' : '%' })];
    } else if (a?.t === 'set') {
      extra = slotBtn(a.formula, 'act', `${ri}.${key}`, `${label}: TM = képlet`, 'act');
    }
    return h(
      'div',
      { class: 'pgm-row is-branch' },
      h('span', { class: 'pgm-tag t-rule', text: label.toUpperCase() }),
      kindSel,
      extra,
    );
  };

  const ruleNode = (rule, ri) => {
    const onSel = select(ON, rule.on ?? 'cycle', { ruleOn: ri }, 'Mikor fut a szabály');
    onSel.addEventListener('change', () =>
      change((p) => {
        p.rules[ri].on = onSel.value;
      }),
    );
    const condSel = select(
      [
        ['record', 'volt új 1RM-rekord a próbán'],
        ['cmp', 'összehasonlítás'],
      ],
      rule.when.t,
      { ruleCond: ri },
      'Feltétel fajtája',
    );
    condSel.addEventListener('change', () =>
      change((p) => {
        p.rules[ri].when =
          condSel.value === 'record'
            ? { t: 'record' }
            : {
                t: 'cmp',
                op: '<',
                a: { t: 'stat', k: 'amrapReps' },
                b: { t: 'stat', k: 'amrapTarget' },
              };
      }),
    );
    let cmp = null;
    if (rule.when.t === 'cmp') {
      const opSel = select(CMP, rule.when.op, { ruleOp: ri }, 'Összehasonlítás');
      opSel.addEventListener('change', () =>
        change((p) => {
          p.rules[ri].when.op = opSel.value;
        }),
      );
      cmp = [
        slotBtn(rule.when.a, 'cond', `${ri}.a`, 'Feltétel bal oldala', 'cond'),
        opSel,
        slotBtn(rule.when.b, 'cond', `${ri}.b`, 'Feltétel jobb oldala', 'cond'),
      ];
    }
    const del = h('button', {
      class: 'pgm-btn',
      text: '✕',
      attrs: { type: 'button', 'aria-label': 'Szabály törlése', title: 'Szabály törlése' },
    });
    del.addEventListener('click', () =>
      change((p) => {
        p.rules.splice(ri, 1);
      }),
    );
    return h(
      'div',
      { class: 'pgm-rule' },
      h(
        'div',
        { class: 'pgm-row is-rule' },
        h('span', { class: 'pgm-tag t-rule', text: 'SZABÁLY' }),
        onSel,
        del,
      ),
      h(
        'div',
        { class: 'pgm-children' },
        h(
          'div',
          { class: 'pgm-row is-branch' },
          h('span', { class: 'pgm-tag t-rule', text: 'HA' }),
          condSel,
          cmp,
        ),
        actionRow(rule, ri, 'then', 'Akkor'),
        actionRow(rule, ri, 'otherwise', 'Különben'),
      ),
    );
  };

  const addBtn = h('button', {
    class: 'pgm-add-week',
    text: '+ Szabály',
    attrs: { type: 'button' },
  });
  addBtn.addEventListener('click', () =>
    change((p) => {
      p.rules.push({ on: 'cycle', when: { t: 'record' }, then: { t: 'step' }, otherwise: null });
    }),
  );

  const stepRows = tmExercisesOf(program).map((ex) => {
    const value = program.steps[ex] ?? deps.defaultSteps?.[ex] ?? 2.5;
    const input = h('input', {
      class: 'pgm-num',
      value: hu(value),
      data: { step: ex },
      attrs: { inputmode: 'decimal', 'aria-label': `${ex} lépésköze (kg)` },
    });
    input.addEventListener('change', () => {
      const v = Number(String(input.value).replace(',', '.'));
      if (!Number.isFinite(v) || v < 0 || v > 50) return deps.onChange(program);
      change((p) => {
        p.steps[ex] = v;
      });
    });
    return h(
      'div',
      { class: 'pgm-row is-step' },
      h('span', { class: 'pgm-ex-name', text: ex }),
      input,
      h('span', { class: 'pgm-x', text: 'kg' }),
    );
  });

  fill(
    container,
    h('h3', { class: 'pgm-rules-title ds-eyebrow', text: 'Szabályok' }),
    h('p', {
      class: 'pgm-hint',
      text: 'A szabály TM-et javasol, a döntés a tiéd. Húzz ide egy Szabály blokkot, vagy egy értéket a „Ha” sor egyik oldalára.',
    }),
    program.rules.map(ruleNode),
    addBtn,
    stepRows.length
      ? h(
          'div',
          { class: 'pgm-steps' },
          h('p', { class: 'pgm-group-label', text: 'Lépésköz a „TM + lépésköz” akcióhoz' }),
          stepRows,
        )
      : null,
  );
}

/** Egy szabály feltétele egy sorban (a Tervek kártya és a tesztek olvassák). */
export const ruleText = (rule) =>
  rule.when.t === 'record'
    ? 'HA volt új 1RM-rekord'
    : `HA ${formulaLabel(rule.when.a)} ${CMP.find(([v]) => v === rule.when.op)[1]} ${formulaLabel(rule.when.b)}`;
