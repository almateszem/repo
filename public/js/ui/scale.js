/**
 * Podium — chip-skála (1–5) a kattintás-kezeléssel
 * ------------------------------------------------------------------------
 * Az építés a render/recovery.js-é (renderScale); itt a választás kötődik
 * rá. Az érték az aria-pressed attribútumban él, a readScale/writeScale
 * (render/recovery.js) onnan olvas és oda ír.
 */
import { $$ } from '../core/dom.js';
import { renderScale } from '../render/recovery.js';

/** Egy skála felépítése választható chipekkel. Az aktív chip újbóli
    megnyomása törli a választást — így egy véletlen kattintás visszavonható
    „nem adtam meg" állapotra. */
export function buildScale(options) {
  const scale = renderScale(options);
  const chips = $$('.rc-chip', scale);
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const active = chip.getAttribute('aria-pressed') === 'true';
      chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', String(!active));
    });
  });
  return scale;
}
