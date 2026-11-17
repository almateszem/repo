/**
 * Podium — a programnap a szerkesztőben és a program-sávban (kliens)
 * --------------------------------------------------------------------------
 * P5: a programnap piszkozata (a szerver a program helyzetével adja vissza)
 *     programnapként viselkedik: látszik a sáv, és a befejezés után jön a
 *     következő nap.
 * P4: ugratás vagy kikapcsolás után a szerkesztőben álló programnap
 *     kiürül — a szabad edzéshez nem nyúlunk.
 * P3: a piszkozat mellé érkező nyitott javaslat kártyája a napló fölé kerül.
 * F2: a befejezés utáni betöltés „Következő programnap"-ot ír, nem „Mai"-t.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { elementFor, installFakeDom } from '../fake-dom.js';

installFakeDom();
const { createContentLoader } = await import('../../../../public/js/workout/loading.js');
const { setupProgramRun } = await import('../../../../public/js/program/program-run.js');
const { hooks } = await import('../../../../public/js/shared/page-hooks.js');

const PROGRAM = { cycle: 1, pos: 1, total: 3, title: '1. hét · B nap' };
const MID = [{ exercise: 'Guggolás', current: 100, suggested: 70, reason: 'kiégés' }];

/** Egy betöltő a szerkesztő állapotával; a sávot a valódi setupProgramRun rajzolja. */
function loader(editing) {
  const titleInput = { value: 'Régi nap', classList: { remove() {} } };
  const list = globalThis.document.createElement('ul');
  const { applyTemplate } = createContentLoader({
    page: globalThis.document.createElement('section'),
    list,
    titleInput,
    titleError: {},
    exerciseOptions: {},
    editing,
    syncEmpty() {},
    syncEditingState() {},
    refreshPrIndicators() {},
    autosave() {},
    confirmAction: async () => true,
  });
  return { applyTemplate, titleInput };
}

setupProgramRun({ reload: async () => {} });
const slot = elementFor('[data-program-slot]');
const toastText = () => elementFor('.toast-region').children[0]?.textContent ?? '';

test('P5: a programnap piszkozata programnap — látszik a sáv', () => {
  const editing = { source: null, planId: null };
  const { applyTemplate } = loader(editing);
  applyTemplate({
    source: 'draft',
    name: '1. hét · B nap',
    exercises: [],
    planId: 7,
    workoutId: null,
    program: PROGRAM,
    missing: [],
    mid: null,
  });
  assert.equal(editing.source, 'program');
  assert.equal(editing.planId, 7);
  assert.equal(slot.hidden, false);
  assert.equal(slot.children[0].className, 'pr-strip');
});

test('P5: a sima piszkozat sima piszkozat marad, sáv nélkül', () => {
  const editing = { source: null, planId: null };
  loader(editing).applyTemplate({
    source: 'draft',
    name: 'Saját',
    exercises: [],
    planId: null,
    workoutId: null,
  });
  assert.equal(editing.source, 'draft');
  assert.equal(slot.hidden, true);
});

test('P3: a piszkozat melletti nyitott javaslat kártyája a napló fölé kerül', () => {
  const editing = { source: null, planId: null };
  loader(editing).applyTemplate({
    source: 'draft',
    name: '1. hét · B nap',
    exercises: [],
    planId: 7,
    workoutId: null,
    program: PROGRAM,
    missing: [],
    mid: MID,
  });
  assert.equal(slot.hidden, false);
  assert.equal(slot.children[0].className, 'pr-card is-mid');
  assert.equal(editing.planId, 7, 'a napló tartalma marad');
});

test('P4: ugratás után (javaslat-kártya, edzés nélkül) a programnap kiürül', () => {
  const editing = { source: 'program', planId: 7, workoutId: null };
  const { applyTemplate, titleInput } = loader(editing);
  applyTemplate({ source: 'program-review', planId: 7, program: { cycle: 1 }, suggestions: MID });
  assert.equal(editing.planId, null);
  assert.equal(titleInput.value, '');
});

test('P4: kikapcsolás után (nincs sablon) a programnap kiürül', () => {
  const editing = { source: 'program', planId: 7, workoutId: null };
  const { applyTemplate, titleInput } = loader(editing);
  applyTemplate(null);
  assert.equal(editing.planId, null);
  assert.equal(titleInput.value, '');
});

test('P4: a szabad edzés megmarad, ha nem programnap állt a szerkesztőben', () => {
  const editing = { source: 'draft', planId: null, workoutId: null };
  const { applyTemplate, titleInput } = loader(editing);
  applyTemplate(null);
  assert.equal(titleInput.value, 'Régi nap');
});

test('F2: a befejezés utáni betöltés „Következő programnap"-ot ír', () => {
  const template = {
    source: 'program',
    name: '1. hét · B nap',
    exercises: [],
    planId: 7,
    workoutId: null,
    program: PROGRAM,
    missing: [],
  };
  loader({ source: null }).applyTemplate(template, { afterFinish: true });
  assert.equal(toastText(), 'Következő programnap: 1. hét · B nap');
  loader({ source: null }).applyTemplate(template);
  assert.equal(toastText(), 'Mai programnap: 1. hét · B nap');
});

test('a hook a sávot rajzolja (a betöltő a hooks-on át éri el)', () => {
  assert.equal(typeof hooks.programTemplate, 'function');
});
