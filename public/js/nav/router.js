/**
 * Router — hash-alapú oldalváltás.
 *
 * A cím (#workout, #coach…) tükrözi az aktív oldalt, így a vissza gomb és a
 * link-megosztás is működik; az utolsó oldal localStorage-ból áll vissza.
 * Az oldal-megjelenéskor futó effektek a core/page-hooks.js horgain át érik
 * el a lapok vezérlőit — így a router nem függ a ui/ modulaktól.
 */

import { DIR_TO_PAGE, FLOW_PAGES, PAGES } from '../core/constants.js';
import { $, $$, prefersReducedMotion } from '../core/dom.js';
import { animateNumber } from '../core/format.js';
import { hooks, shared } from '../core/page-hooks.js';
import { prefs } from '../core/prefs.js';
import { dashboardData } from '../render/dashboard.js';
import { renderPlans } from '../render/plans.js';
import { hasReadiness } from '../render/recovery.js';
import { renderSummary } from '../render/summary.js';

/** Oldal-megjelenéskor futó effektek (számláló-animációk stb.). */
const pageEffects = {
  dashboard() {
    if (dashboardData && hasReadiness(dashboardData.readiness)) {
      animateNumber($('.db-percent-num'), dashboardData.readiness, { from: 0, duration: 900 });
    }
  },
  coach() {
    /* Az Edző oldal MÁSIK EMBER adatát mutatja (a sportolóid állapotát, az
       edződ üzeneteit), ami a saját gépeléseinktől függetlenül változik —
       ezért minden megnyitáskor friss adatot kérünk. A frissítő rajzolja ki
       a kártyákat is, és az ő végén pörögnek fel a pontszámok. */
    if (hooks.refreshCoachPage) hooks.refreshCoachPage();
    else {
      const manager = $('[data-page="coach"] [data-view="manager"]');
      if (manager && !manager.hidden) animateCoachRatings();
    }
  },
  summary() {
    renderSummary(); // az edzésnapló élő DOM-állapotából számol + felpörgeti a számokat
  },
  plans() {
    // A terv-kártyák progress-e a mai pipált szetteket követi — megnyitáskor frissül
    renderPlans().catch((err) => console.error('Tervek frissítési hiba:', err));
  },
  recovery() {
    // A készenlét az edzés naplózásával is változik, ezért minden
    // megnyitáskor újraszámoltatjuk a szerverrel.
    hooks.refreshRecovery?.().catch((err) => console.error('Regeneráció frissítési hiba:', err));
  },
  'exercise-picker'() {
    // A setupExercisePicker tölti fel; megjelenéskor frissíti a cél nevét
    // és a hozzáadás-gombok állapotát az aktuális cél-lista szerint.
    hooks.refreshExercisePicker?.();
  },
  checkin() {
    // Friss riport (készenlét + a mai check-in értékei) minden megnyitáskor.
    // A lépés-pozíció csak új munkamenetnél áll vissza — lásd
    // refreshCheckinWizard.
    hooks.refreshCheckinWizard?.().catch((err) => console.error('Check-in frissítési hiba:', err));
  },
  profile() {
    // Az összesítők minden edzés-mentéssel változnak, ezért megnyitáskor
    // mindig a szervertől kérjük őket — nincs külön értesítési lánc.
    hooks.refreshProfile?.().catch((err) => console.error('Profil frissítési hiba:', err));
  },
};

/** A sportoló-kártyák pontszámainak felpörgetése (oldal- és nézetváltáskor). */
function animateCoachRatings() {
  $$('[data-page="coach"] .co-card-rating').forEach((el) => {
    animateNumber(el, Number(el.dataset.rating) || 0, { from: 0, duration: 700 });
  });
}

/** Az aktuális oldal a hash-ből, vagy null, ha a hash nem oldalnév.
    A null fontos: a `#app-main` (skip link), a `#title-…` horgonyok és a
    régi/elgépelt linkek NEM oldalváltások. Korábban minden ismeretlen hash
    'dashboard'-ra fordult, ezért az „Ugrás a tartalomhoz" link — pont az
    akadálymentességi segédeszköz — bármelyik oldalról az Áttekintésre
    dobta a felhasználót. */

/** A zár be-/kikapcsolása. A body attribútuma a CSS-nek szól: az is elrejti
    a navigációt, mert egy kattintásra visszapattanó menü rossz élmény. */
function setOnboardingLock(on) {
  shared.onboardingLock = on;
  document.body.toggleAttribute('data-onboarding', on);
}

function pageFromHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  return PAGES.includes(hash) ? hash : null;
}

/** Az oldalak emberi neve — a mobil nav-hint és a fókusz-bejelentés használja. */
const PAGE_TITLES = {
  dashboard: 'Áttekintés', recovery: 'Regeneráció', workout: 'Edzés',
  nutrition: 'Táplálkozás', plans: 'Tervek', coach: 'Edző', profile: 'Profil',
  summary: 'Edzés-összegző', 'plan-builder': 'Terv-építő',
  'exercise-picker': 'Gyakorlat hozzáadása', checkin: 'Napi check-in',
};

/** Az oldalak ikonjai a nav gyűrű gombjához — az index.html tetején lévő közös
    sprite symbol-id-jei. Ugyanaz a 11 kulcs, mint a PAGE_TITLES-ben, hogy a
    kettő ne sodródjon szét. Az Edző és a Profil oldal is a már meglévő
    #icon-user-t használja — hogy melyiken állsz, a gomb neve és a hint-sor
    mondja meg (mindkettő a PAGE_TITLES-ből). */
const PAGE_ICONS = {
  dashboard: 'icon-page-dashboard', recovery: 'icon-page-recovery',
  workout: 'icon-page-workout', nutrition: 'icon-page-nutrition',
  plans: 'icon-page-plans', coach: 'icon-user', profile: 'icon-user',
  summary: 'icon-page-summary', 'plan-builder': 'icon-page-plan-builder',
  'exercise-picker': 'icon-page-exercise-picker', checkin: 'icon-page-checkin',
};

/** Az éppen látható oldal (a DOM az igazságforrás — a hash lehet horgony is). */
const currentPage = () => $('.app-page:not([hidden])')?.dataset.page ?? 'dashboard';

/** A mobil nav gyűrű „itt vagy" jelzése. A gyűrűnek négy iránya van, az
    Áttekintés és a Regeneráció nincs köztük — ezért a hint-sor mindig
    kiírja az oldal nevét, a négy címke közül pedig kiemeli az aktuálisat
    (ha van ilyen). Enélkül mobilon semmi nem mutatta, hol vagy. */
function syncNavRingState(name) {
  const label = $('[data-nav-current]');
  if (label) label.textContent = PAGE_TITLES[name] ?? '';
  $$('.nl').forEach((el) => {
    const dir = el.className.match(/nl--(\w+)/)?.[1];
    const dirKey = { up: 'up', dn: 'down', lt: 'left', rt: 'right' }[dir];
    el.classList.toggle('is-current', DIR_TO_PAGE[dirKey] === name);
  });

  /* A gombon lévő ikon az egyetlen jelzés, ami MINDEN oldalra működik: a négy
     iránycímke az Áttekintésnél, a Regenerációnál és a flow-oldalakon egyszerre
     sötét marad. */
  const knob = $('#navKnob');
  const icon = knob?.querySelector('.nav-knob-icon');
  const symbol = PAGE_ICONS[name];
  if (icon) {
    icon.hidden = !symbol; // ismeretlen oldalnál üres gomb, nem törött <use>
    if (symbol) {
      icon.querySelector('use')?.setAttribute('href', `#${symbol}`);
      icon.classList.remove('is-swap');
      void icon.offsetWidth; // reflow: enélkül azonos elemen nem indul újra az animáció
      icon.classList.add('is-swap');
    }
  }
  // Az ikon aria-hidden, így a gomb neve mondja meg a képernyőolvasónak, hol vagy.
  if (knob) {
    knob.setAttribute('aria-label',
      `Navigáció — jelenlegi oldal: ${PAGE_TITLES[name] ?? 'ismeretlen'}. `
      + 'Húzd a kívánt irányba, vagy koppints az áttekintéshez.');
  }
}

function showPage(name) {
  const changed = currentPage() !== name;

  $$('.app-page').forEach((page) => {
    page.hidden = page.dataset.page !== name;
  });
  $$('.side-nav-link').forEach((link) => {
    const target = link.getAttribute('href').slice(1);
    if (target === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  syncNavRingState(name);

  /* Oldalváltáskor a görgetés és a fókusz is az új oldalra kerül. Korábban
     egyik sem történt meg: a Regeneráció aljáról az Áttekintésre lépve a lap
     közepén találtad magad, a képernyőolvasó fókusza pedig egy épp elrejtett
     elemen maradt. */
  if (changed) {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    const heading = $(`.app-page[data-page="${name}"] h2`);
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }

  // A flow-oldalak nem számítanak "utolsó oldalnak" — friss megnyitáskor nem állnak vissza
  if (!FLOW_PAGES.includes(name)) prefs.set('lastPage', name);
  pageEffects[name]?.();
}

function navigate(name) {
  // Onboarding alatt a check-in az egyetlen úti cél (nav gyűrű, gyorsbillentyűk).
  if (shared.onboardingLock && name !== 'checkin') return;
  if (pageFromHash() === name) showPage(name); // azonos hash-nél nem jön hashchange event
  else location.hash = name;
}

function setupRouter() {
  // Csak a valódi oldalnevekre váltunk. Ismeretlen hash (skip link, horgony,
  // elgépelt link) esetén az aktuális oldal marad — nem dobjuk vissza a
  // felhasználót az Áttekintésre.
  window.addEventListener('hashchange', () => {
    const page = pageFromHash();
    /* Onboarding alatt a side-nav sima linkjei és a kézzel írt hash is ide
       fut be — a navigate() őre azokat nem látja, ezért itt terelünk vissza.
       A `page &&` nem elhagyható: a nem-oldalnév hash (a `#app-main` skip
       link, a `#title-…` horgonyok) NEM oldalváltás, azt békén hagyjuk —
       különben pont az akadálymentességi ugrólink törne el. */
    if (shared.onboardingLock && page && page !== 'checkin') {
      location.hash = 'checkin';
      return;
    }
    if (page) showPage(page);
  });

  /* Onboarding: a lastPage visszaállítása előtt döntünk, és a flow-hash
     törlése ELŐTT — az kitörölné a #checkin-t. Egyben azt is megelőzi, hogy
     az új fiók az ELŐZŐ felhasználó utolsó oldalára essen: a prefs.lastPage
     böngésző-globális, nem fiókonkénti. */
  if (shared.onboardingLock) {
    navigate('checkin');
    return;
  }

  // A flow-oldalak (összegző / terv-építő / gyakorlat-választó) csak a
  // saját indító gombjukon át nyílnak meg helyesen — az állítja be az
  // előfeltételt (lastSummary / editingId / a választó `context`-je).
  // Ha az app hidegen úgy indul, hogy a hash MÁR egy flow-oldalra mutat
  // — pl. a telefon vissza gombja megölte, majd a rendszer a régi URL-lel
  // állította vissza az oldalt —, ez az előfeltétel hiányzik: a
  // gyakorlat-választón például a hozzáadás-gomb némán nem csinál semmit.
  // Indításkor ezért úgy kezeljük ezt a hash-t, mintha üres lenne.
  if (FLOW_PAGES.includes(pageFromHash())) location.hash = '';

  // Friss megnyitáskor (hash nélkül) az utoljára használt oldal áll vissza.
  const lastPage = prefs.get('lastPage');
  if (!location.hash && lastPage && PAGES.includes(lastPage) && lastPage !== 'dashboard') {
    location.hash = lastPage; // a hashchange handler jeleníti meg
  } else {
    showPage(pageFromHash() ?? 'dashboard');
  }
}

export { animateCoachRatings, currentPage, navigate, setOnboardingLock, setupRouter };
