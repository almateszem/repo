/** Oldal- és naptár-konstansok. Több modul osztozik rajtuk, ezért állnak külön. */

/** Hétnapok hétfőtől (0 = hétfő). A ciklusos terv napjainak neve ezt
    ismétli (a 8. naptól „(2.)" utótaggal — core/plan-week.js → dayTitle,
    dayLabel), a terv-építő és a felajánlott terv is innen kapja a feliratot. */
const DAY_LABELS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

const DAY_NAMES = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];

/** Értesítés-kategóriák a beállítások modal kapcsolóihoz (notification.cat).
    A lista pontosan azt az ötöt sorolja, amit a szerver valóban KÜLDENI tud
    (server/notifications.js → NOTIF_CATEGORY), ugyanabban a sorrendben — egy
    szerződés-teszt veti össze a kettőt. A korábbi demo-kategóriák (terv
    módosítva, edzői megjegyzés, heti riport) mögött nem volt valódi esemény;
    a „feedback" viszont kimaradt, így az edzői visszajelzés nem volt némítható. */
const NOTIF_CATEGORIES = [
  { key: 'message', label: 'Új üzenet' },
  { key: 'coach', label: 'Edző-kapcsolat' },
  { key: 'plan', label: 'Terv kiosztva' },
  { key: 'pr', label: 'Egyéni csúcs' },
  { key: 'feedback', label: 'Edzés-visszajelzés' },
];

/** Az oldalak, a nav gyűrű irányai és a gyorsbillentyűk megfeleltetése.
    A 'summary', a 'plan-builder', az 'exercise-picker', a 'workout-picker'
    és a 'checkin' flow-oldalak: a hash-router ismeri őket, de szándékosan
    nincsenek a nav gyűrű irányai és a gyorsbillentyűk között (az „Edzés
    befejezése", az „+ Új terv", a „+ Gyakorlat hozzáadása", a „Meglévő
    edzés betöltése", ill. az áttekintő check-in
    emlékeztetője és a Regeneráció oldal gombja visz oda). */
const PAGES = [
  'dashboard',
  'recovery',
  'workout',
  'nutrition',
  'plans',
  'coach',
  'profile',
  'summary',
  'plan-builder',
  'exercise-picker',
  'workout-picker',
  'checkin',
];

const FLOW_PAGES = ['summary', 'plan-builder', 'exercise-picker', 'workout-picker', 'checkin']; // friss megnyitáskor nem állnak vissza

const DIR_TO_PAGE = {
  up: 'coach',
  down: 'plans',
  left: 'workout',
  right: 'nutrition',
  home: 'dashboard',
};

/** A „fel" irány adaptív: az Edző oldalra visz, ha a fióknak van edzői
    tevékenysége (edző, sportoló vagy meghívó — lásd shared.coachActive),
    egyébként ide. Az Edző oldal ilyenkor a Profilból érhető el. */
const NAV_UP_FALLBACK = 'recovery';

/** A flow-oldalak „szülője": az a side-nav elem, amelyik alatt a felhasználó
    jár. Az asztali oldalsáv ezt emeli ki, hogy a flow-oldalon se vesszen el a
    „hol vagyok". A gyakorlat-választóé a hívótól függ (terv-építő, edzés vagy
    profil), ezért az nincs itt — lásd a router pageSection()-jét. */
const PAGE_SECTION = {
  summary: 'workout',
  'plan-builder': 'plans',
  'workout-picker': 'plans',
  checkin: 'recovery',
};

// A gyorsbillentyűk a desktop side-nav sorrendjét követik.
const KEY_TO_PAGE = {
  1: 'dashboard',
  2: 'workout',
  3: 'nutrition',
  4: 'recovery',
  5: 'plans',
  6: 'coach',
  7: 'profile',
};

/** Nyitott modál felismerése: a createModalController `is-open`-t tesz a
    gyökérre, a kártya pedig közvetlen gyerekként `aria-modal`. Így minden
    modál benne van, a következő is — nincs kézzel bővítendő lista. A belépő
    képernyő szándékosan kimarad: az is aria-modal, de sosem kap `is-open`-t.
    A szerkezetet a ui/shortcuts.test.js őrzi. */
const OPEN_MODAL_SELECTOR = '.is-open > [aria-modal="true"]';

export {
  DAY_LABELS,
  DAY_NAMES,
  DIR_TO_PAGE,
  FLOW_PAGES,
  KEY_TO_PAGE,
  NAV_UP_FALLBACK,
  NOTIF_CATEGORIES,
  OPEN_MODAL_SELECTOR,
  PAGE_SECTION,
  PAGES,
};
