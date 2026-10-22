import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../fake-dom.js';

// A számolás az étrend-szerkesztővel egy modulban él, ami DOM-segédeket is
// importál — ezért előbb a fake DOM, utána a dinamikus import.
installFakeDom();
const { scaleFood, sumMacros } = await import('../../../../public/js/coach/meals.js');

const SULT_CSIRKE = { kcal: 165, protein: 31, carbs: 0, fat: 3.6 };

test('az adagra számolás: kcal egészre, makrók egy tizedesre', () => {
  assert.deepEqual(scaleFood(SULT_CSIRKE, 200), { kcal: 330, protein: 62, carbs: 0, fat: 7.2 });
  assert.deepEqual(scaleFood(SULT_CSIRKE, 33), { kcal: 54, protein: 10.2, carbs: 0, fat: 1.2 });
});

test('az összeg nem gyűjt lebegőpontos szemetet', () => {
  const items = [
    { kcal: 1, protein: 0.1, carbs: 0.2, fat: 0.1 },
    { kcal: 2, protein: 0.2, carbs: 0.1, fat: 0.2 },
  ];
  assert.deepEqual(sumMacros(items), { kcal: 3, protein: 0.3, carbs: 0.3, fat: 0.3 });
  assert.deepEqual(sumMacros([]), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});
