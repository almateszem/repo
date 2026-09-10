/**
 * Belépési pont.
 *
 * A böngésző ezt tölti be (`<script type="module" src="js/main.js">`), és
 * innen ágazik szét minden: a belépő kapu, majd sikeres munkamenet esetén az
 * init, ami a lapok vezérlőit felépíti és összeköti.
 */

import { api } from './core/api.js';
import { hooks } from './core/page-hooks.js';
import { setOnboardingLock } from './nav/router.js';
import { init, setupAuthGate } from './app/init.js';

document.addEventListener('DOMContentLoaded', async () => {
  const gate = setupAuthGate();

  /* Munkamenet-vesztés MENET KÖZBEN (lejárt süti, másik eszközről történt
     kijelentkezés). Ilyenkor a felépült felület már az előző fiók adatait
     mutatja, ezért belépés után teljes újratöltés jön — nem próbáljuk
     darabonként frissíteni. A jelző azt is megakadályozza, hogy több
     párhuzamos 401 többször nyissa meg a képernyőt. */
  let sessionLostHandled = false;
  hooks.onSessionLost = () => {
    if (sessionLostHandled || gate.isOpen()) return;
    sessionLostHandled = true;
    gate.open({
      next: () => window.location.reload(),
      message: 'A munkamenet lejárt — jelentkezz be újra.',
    });
  };

  try {
    const { user, firstRun } = await api.me();
    if (user) {
      // A zár az init ELŐTT áll be: a setupRouter már ebből választ induló
      // oldalt. Ez adja az újratöltés-túlélést is — a félbehagyott első
      // check-in után a frissítés megint a varázslóra tesz le.
      setOnboardingLock(Boolean(user.onboarding));
      await init();
    } else {
      // Az első betöltésnél még nincs mit eldobni, ezért itt elég az init.
      gate.open({
        firstRun,
        next: () => init().catch((err) => console.error('Inicializálási hiba:', err)),
      });
    }
  } catch (err) {
    console.error('Inicializálási hiba:', err);
  }
});
