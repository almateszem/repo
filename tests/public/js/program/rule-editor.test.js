/**
 * Podium — a szabályszerkesztő tiszta részei (public/js/program/rule-editor.js)
 * --------------------------------------------------------------------------
 * Az új program alapszabálya (Viktoré), a feltétel sorbeli szövege és a
 * lépésköz-lista gyakorlatai. A DOM-os részt a böngészős végigjátszás nézi.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { starterProgram } from '../../../../public/js/program/block-library.js';
import { ruleText, tmExercisesOf } from '../../../../public/js/program/rule-editor.js';

test('az alapszabály: a ciklus végén HA rekord AKKOR 95% × új 1RM KÜLÖNBEN lépésköz', () => {
  const [rule] = starterProgram().rules;
  assert.equal(rule.on, 'cycle');
  assert.equal(ruleText(rule), 'HA volt új 1RM-rekord');
  assert.deepEqual(rule.then, {
    t: 'set',
    formula: { t: 'op', op: '*', a: { t: 'num', v: 95, pct: true }, b: { t: 'newOrm' } },
  });
  assert.deepEqual(rule.otherwise, { t: 'step' });
});

test('összehasonlító feltétel szövege: teljesített (mind) < 80% × összes (mind)', () => {
  const rule = {
    on: 'workout',
    when: {
      t: 'cmp',
      op: '<',
      a: { t: 'stat', k: 'doneAll' },
      b: { t: 'op', op: '*', a: { t: 'num', v: 80, pct: true }, b: { t: 'stat', k: 'totalAll' } },
    },
    then: { t: 'addPct', pct: -30 },
    otherwise: null,
  };
  assert.equal(ruleText(rule), 'HA teljesített (mind) < 80% × összes (mind)');
});

test('a lépésköz-lista a TM-es gyakorlatokat sorolja, egyszer', () => {
  const p = starterProgram();
  p.weeks[0].days[0].exercises.push(
    {
      name: 'Kitörés',
      role: 'accessory',
      sets: [{ count: 3, reps: 10, amrap: false, weight: null }],
    },
    {
      name: 'Guggolás',
      role: 'accessory',
      sets: [{ count: 1, reps: 5, amrap: false, weight: { t: 'tm' } }],
    },
  );
  assert.deepEqual(tmExercisesOf(p), ['Guggolás']);
});
