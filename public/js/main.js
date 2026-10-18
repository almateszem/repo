/**
 * Belépési pont.
 *
 * A böngésző ezt tölti be (`<script type="module" src="js/main.js">`), és
 * innen ágazik szét minden: a belépő kapu, majd sikeres munkamenet esetén az
 * init, ami a lapok vezérlőit felépíti és összeköti.
 */

import { api } from './core/api.js';
import { $ } from './core/dom.js';
import { hooks } from './core/page-hooks.js';
import { prefs } from './core/prefs.js';
import { setOnboardingLock } from './nav/router.js';
import { init, setupAuthGate } from './app/init.js';
import { startWithRetry } from './app/startup.js';

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

  /* Induláskori kapcsolat-hiba: korábban csak a konzolba ment, és az app üres
     vázként állt. Most a belépő képernyő helyén hiba-állapot látszik, és a
     próba magától megismétlődik (app/startup.js). CSAK az api.me() megy újra:
     egy init() közbeni hiba nem indíthat második initet. */
  const errorScreen = $('#startupError');
  const errorText = $('[data-startup-error-text]', errorScreen);
  const setErrorScreen = (open) => {
    errorScreen.hidden = !open;
    errorScreen.setAttribute('aria-hidden', String(!open));
  };

  const boot = startWithRetry(() => api.me(), {
    onError: (err, { retrying }) => {
      console.error('Inicializálási hiba:', err);
      errorText.textContent = retrying
        ? `${err.message} Újrapróbálás hamarosan…`
        : `${err.message} Próbáld újra az alábbi gombbal.`;
      setErrorScreen(true);
    },
    onSuccess: ({ user, firstRun }) => {
      setErrorScreen(false);
      if (user) {
        // A beállítások a fiókhoz kötődnek — az első prefs-olvasás (az init
        // induló oldala) ELŐTT.
        prefs.bind(user.username);
        // A zár az init ELŐTT áll be: a setupRouter már ebből választ induló
        // oldalt. Ez adja az újratöltés-túlélést is — a félbehagyott első
        // check-in után a frissítés megint a varázslóra tesz le.
        setOnboardingLock(Boolean(user.onboarding));
        init().catch((err) => console.error('Inicializálási hiba:', err));
      } else {
        // Az első betöltésnél még nincs mit eldobni, ezért itt elég az init.
        gate.open({
          firstRun,
          next: () => init().catch((err) => console.error('Inicializálási hiba:', err)),
        });
      }
    },
  });
  $('[data-action="startup-retry"]', errorScreen).addEventListener('click', () => boot.retry());
});
