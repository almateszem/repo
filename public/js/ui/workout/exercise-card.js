/**
 * Podium — egy gyakorlat-kártya közös segédei (edzésnapló, gyakorlat-választó)
 * ------------------------------------------------------------------------
 * A „kipipált szettek" számolása és az eltávolítás előtti megerősítés egy
 * helyen: korábban négy, illetve két helyen állt szó szerint ugyanígy.
 */
import { $$ } from '../../shared/dom.js';

/** Hány teljesített (kipipált) szett van a gyökér alatt — egy kártyán vagy
    az egész naplóban. */
export const countDoneSets = (root) =>
  $$('.wk-set-check', root).filter((check) => check.getAttribute('aria-pressed') === 'true').length;

/** Rákérdezés egy gyakorlat eltávolítása előtt, ha van rajta teljesített
    szett: az elvesztésük visszavonhatatlan. Frissen hozzáadott (még nem
    teljesített) gyakorlatnál nincs kérdés. Igaz, ha mehet az eltávolítás. */
export async function confirmRemoveExercise(card, name, confirmAction) {
  const doneSets = countDoneSets(card);
  if (doneSets === 0) return true;
  return confirmAction(
    `A(z) „${name}” gyakorlaton ${doneSets} teljesített szett van. Az eltávolítással ezek elvesznek.`,
    { title: 'Eltávolítod a gyakorlatot?', confirmLabel: 'Eltávolítás' },
  );
}
