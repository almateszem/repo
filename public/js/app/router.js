/**
 * Router — hash-alapú oldalváltás.
 *
 * A cím (#workout, #coach…) tükrözi az aktív oldalt, így a vissza gomb és a
 * link-megosztás is működik; az utolsó oldal localStorage-ból áll vissza.
 * Az oldal-megjelenéskor futó feladatokat a lapok vezérlői regisztrálják
 * (onPageShow) — így a router nem függ az oldalak vezérlőitől.
 */

import {
  DIR_TO_PAGE,
  FLOW_PAGES,
  NAV_UP_FALLBACK,
  PAGE_SECTION,
  PAGES,
} from '../shared/constants.js';
import { $, $$, prefersReducedMotion } from '../shared/dom.js';
import { animateNumber, formatWhole } from '../shared/format.js';
import { shared } from '../shared/page-hooks.js';
import { prefs } from '../shared/prefs.js';

/* ---- Oldal-megnyitás: onPageShow ----
   Ami „az oldal megnyílt" pillanatban fut (friss adat, számláló-animáció),
   az ide iratkozik fel, oldalanként akárhány feladattal. A lapok vezérlői a
   saját setupjukban regisztrálnak; a router csak a nevet ismeri, a vezérlőket nem. */

/** oldalnév → a megnyitáskor futó feladatok, a regisztrálás sorrendjében. */
const pageShowHandlers = new Map();

/** A legutóbb megjelenített oldal — az első showPage előtt null. */
let shownPage = null;

/** Feladat az oldal minden megnyitására. Ha az oldal MÁR látszik (az app a
    vezérlő felépülése előtt nyílt meg rajta), a feladat azonnal le is fut,
    és a visszatérési értékét (pl. az ígéretét) adja vissza — így nem kell
    kézzel pótolni az induláskor elmaradt megnyitást. `catchUp: false`, ha a
    vezérlő a setupjában amúgy is betölt, és a pótlás kétszer kérne. */
function onPageShow(name, fn, { catchUp = true } = {}) {
  if (!pageShowHandlers.has(name)) pageShowHandlers.set(name, []);
  pageShowHandlers.get(name).push(fn);
  return catchUp && shownPage === name ? fn() : undefined;
}

/** A sportoló-sorok pontszámainak felpörgetése (oldal- és nézetváltáskor). */
function animateCoachRatings() {
  $$('.app-page[data-page="coach"] .co-score-num').forEach((el) => {
    // Az értékelés egész pontszám — a tizedesek csak zajt vinnének a kártyákra.
    animateNumber(el, Number(el.dataset.rating) || 0, {
      from: 0,
      duration: 700,
      format: formatWhole,
    });
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

/** Az oldalak emberi neve — a nav gomb neve és a fókusz-bejelentés használja. */
const PAGE_TITLES = {
  dashboard: 'Áttekintés',
  recovery: 'Regeneráció',
  workout: 'Edzés',
  nutrition: 'Táplálkozás',
  plans: 'Tervek',
  coach: 'Edző',
  profile: 'Profil',
  summary: 'Edzés-összegző',
  'plan-builder': 'Terv-építő',
  'exercise-picker': 'Gyakorlat hozzáadása',
  'workout-picker': 'Edzés betöltése',
  checkin: 'Napi check-in',
};

/** Az oldalak ikonjai a nav gyűrű gombjához — az index.html tetején lévő közös
    sprite symbol-id-jei. Ugyanaz a 12 kulcs, mint a PAGE_TITLES-ben, hogy a
    kettő ne sodródjon szét. Az Edző és a Profil oldal is a már meglévő
    #icon-user-t használja — hogy melyiken állsz, a gomb neve mondja meg
    (a PAGE_TITLES-ből). */
const PAGE_ICONS = {
  dashboard: 'icon-page-dashboard',
  recovery: 'icon-page-recovery',
  workout: 'icon-page-workout',
  nutrition: 'icon-page-nutrition',
  plans: 'icon-page-plans',
  coach: 'icon-user',
  profile: 'icon-user',
  summary: 'icon-page-summary',
  'plan-builder': 'icon-page-plan-builder',
  'exercise-picker': 'icon-page-exercise-picker',
  'workout-picker': 'icon-page-plan-builder',
  checkin: 'icon-page-checkin',
};

/** Az éppen látható oldal (a DOM az igazságforrás — a hash lehet horgony is). */
const currentPage = () => $('.app-page:not([hidden])')?.dataset.page ?? 'dashboard';

/** A nav gyűrű iránya → oldal. A „fel" adaptív: edzői tevékenységnél az Edző,
    egyébként a Regeneráció (lásd NAV_UP_FALLBACK). */
function dirToPage(dir) {
  if (dir === 'up' && !shared.coachActive) return NAV_UP_FALLBACK;
  return DIR_TO_PAGE[dir] ?? 'dashboard';
}

/** A négy iránycímke: a „fel" címke követi az adaptív célt (↑ Edző vagy
    ↑ Regeneráció), és az aktuális oldalra mutató kiemelődik. */
function syncNavRingLabels(name) {
  $$('.nl').forEach((el) => {
    const dir = el.dataset.navDir;
    const target = dirToPage(dir);
    if (dir === 'up') el.textContent = `↑ ${PAGE_TITLES[target]}`;
    el.classList.toggle('is-current', target === name);
  });
}

/** A mobil nav gyűrű „itt vagy" jelzése: a címkék kiemelése, a gomb ikonja
    pedig minden oldalra jelzi, hol vagy. */
function syncNavRingState(name) {
  syncNavRingLabels(name);

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
    knob.setAttribute(
      'aria-label',
      `Navigáció — jelenlegi oldal: ${PAGE_TITLES[name] ?? 'ismeretlen'}. ` +
        'Húzd a kívánt irányba, vagy koppints az áttekintéshez.',
    );
  }
}

/** Melyik side-nav elem alatt van az oldal. A flow-oldalaké a PAGE_SECTION-ből
    jön; a gyakorlat-választóé onnan, ahonnan érkeztünk (terv-építő → Tervek,
    edzésnapló → Edzés, profil → Profil). Alapértelmezése a Tervek, mint a
    választó vissza-gombjának is. */
function pageSection(name, from) {
  if (name !== 'exercise-picker') return PAGE_SECTION[name] ?? name;
  if (!from || from === name) return 'plans';
  return PAGE_SECTION[from] ?? from;
}

/** Az éppen kiemelt side-nav elem — oldalváltáskor számoljuk, hogy ugyanarra
    az oldalra való újrahívás (azonos hash) ne írja felül a hívótól függőt. */
let activeSection = null;

function showPage(name) {
  const previous = currentPage();
  const changed = previous !== name;
  if (changed || activeSection === null) activeSection = pageSection(name, previous);

  $$('.app-page').forEach((page) => {
    page.hidden = page.dataset.page !== name;
  });
  // Az oldal maga aria-current="page"; a flow-oldal szülő-eleme "true" — a
  // CSS mindkettőt kiemeli, a képernyőolvasó pedig csak az előbbit mondja oldalnak.
  $$('.side-nav-link').forEach((link) => {
    const target = link.getAttribute('href').slice(1);
    if (target === name) link.setAttribute('aria-current', 'page');
    else if (target === activeSection) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
  syncNavRingState(name);
  // A CSS ebből tudja elrejteni a gyűrűt a folyamat-oldalakon (A1).
  document.body.dataset.page = name;

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
  shownPage = name;
  (pageShowHandlers.get(name) ?? []).forEach((fn) => fn());
}

function navigate(name) {
  // Onboarding alatt a check-in az egyetlen úti cél (nav gyűrű, gyorsbillentyűk).
  if (shared.onboardingLock && name !== 'checkin') return;
  if (pageFromHash() === name)
    showPage(name); // azonos hash-nél nem jön hashchange event
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

/** A gyűrű újraszinkronizálása az aktuális oldalra — az Edző oldal hívja, ha
    megváltozott, hogy a „fel" irány hová visz. */
const refreshNavRing = () => syncNavRingLabels(currentPage());

export {
  animateCoachRatings,
  currentPage,
  dirToPage,
  navigate,
  onPageShow,
  refreshNavRing,
  setOnboardingLock,
  setupRouter,
};
