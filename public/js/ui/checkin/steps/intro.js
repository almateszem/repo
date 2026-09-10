/** A varázsló nyitólépése — köszöntés és a kezdés gomb. */

import { api } from '../../../core/api.js';
import { $, cloneTemplate } from '../../../core/dom.js';
import { shared } from '../../../core/page-hooks.js';
import { ciDateStr } from '../helpers.js';
import { ci } from '../session.js';

function renderIntro(nav) {
  const step = cloneTemplate('tpl-ci-intro');
  $('[data-ci-date]', step).textContent = ciDateStr();
  // Félbehagyott munkamenetnél a „Kezdés" félrevezető lenne.
  if (ci.hadCheckin) $('[data-ci-start-label]', step).textContent = 'Folytatás';
  if (shared.onboardingLock) applyOnboardingIntro(step);
  return applyIntroActions(step, nav);
}

/* Az első check-in introja. Ugyanaz a sablon, más szöveg: itt még nem
   „napi rutin" a dolog, hanem az egyetlen út befelé — a kezdőnek azt kell
   megértenie, MIÉRT kérdezünk, mielőtt bármit kitöltene. */
function applyOnboardingIntro(step) {
  // Csak a felvezető szó cserélődik — a dátum-span a helyén marad.
  $('.ci-eyebrow', step).firstChild.nodeValue = 'Első lépés · ';
  $('.ci-display', step).replaceChildren(
    'Kezdjük', document.createElement('br'), 'a készenléttel',
  );
  $('.ci-lead', step).textContent = 'Ez az első check-ined. Ebből számolja ki a rendszer, '
    + 'mennyire vagy ma terhelhető — pár gyors kérdés, kevesebb mint egy perc.';
  $('.ci-footnote', step).textContent = 'Az adataid csak hozzád tartoznak.';

  /* A „Mégse" itt sehová nem vezetne: az app többi oldala zárva van. A
     kijárat ezért a kijelentkezés — a check-in kötelező, de a lap nem
     csapda (a #checkin-en nincs se beállítás-, se kilépés-gomb, azok a
     dashboard fejlécében ülnek). */
  const exit = $('.ci-exit', step);
  exit.textContent = 'Kijelentkezés';
  exit.href = '#';
  exit.addEventListener('click', async (event) => {
    event.preventDefault();
    try { await api.logout(); } catch { /* a kilépést akkor is bevisszük */ }
    window.location.reload();
  });
}

/** Az intro gombjának bekötése — a két ág után közös. */
function applyIntroActions(step, nav) {
  $('[data-action="checkin-next"]', step).addEventListener('click', () => nav.goNext());
  return step;
}

export { applyIntroActions, applyOnboardingIntro, renderIntro };
