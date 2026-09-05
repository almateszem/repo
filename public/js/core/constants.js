/** Oldal- és naptár-konstansok. Több modul osztozik rajtuk, ezért állnak külön. */

/** Hétnapok hétfőtől (0 = hétfő), ahogy a szerver is indexeli őket
    (plans.days). A terv-építő chipjei és a felajánlott terv ütemezése is
    innen kapja a feliratot — a kettő nem csúszhat el egymástól. */
const DAY_LABELS = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

const DAY_NAMES = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];

/** Értesítés-kategóriák a beállítások modal kapcsolóihoz (notification.cat).
    A lista pontosan azt a hármat sorolja, amit a szerver valóban KÜLDENI tud
    (server/notifications.js) — a korábbi hat kategória a demo-listával együtt
    kikerült, mert négyükhöz (terv kiosztva/módosítva, edzői megjegyzés, heti
    riport) nem tartozott és ma sem tartozik valódi esemény. */
const NOTIF_CATEGORIES = [
  { key: 'message', label: 'Új üzenet' },
  { key: 'coach', label: 'Edző-kapcsolat' },
  { key: 'plan', label: 'Terv kiosztva' },
  { key: 'pr', label: 'Egyéni csúcs' },
];

/** Az oldalak, a nav gyűrű irányai és a gyorsbillentyűk megfeleltetése.
    A 'summary', a 'plan-builder', az 'exercise-picker' és a 'checkin'
    flow-oldalak: a hash-router ismeri őket, de szándékosan nincsenek a nav
    gyűrű irányai és a gyorsbillentyűk között (az „Edzés befejezése", az
    „+ Új terv", a „+ Gyakorlat hozzáadása", ill. az áttekintő check-in
    emlékeztetője és a Regeneráció oldal gombja visz oda). */
const PAGES = ['dashboard', 'recovery', 'workout', 'nutrition', 'plans', 'coach', 'profile', 'summary', 'plan-builder', 'exercise-picker', 'checkin'];

const FLOW_PAGES = ['summary', 'plan-builder', 'exercise-picker', 'checkin']; // friss megnyitáskor nem állnak vissza

const DIR_TO_PAGE = {
  up: 'coach', down: 'plans', left: 'workout', right: 'nutrition',
  home: 'dashboard',
};

// A gyorsbillentyűk a desktop side-nav sorrendjét követik.
// A Regeneráció oldal szándékosan nincs a nav gyűrű négy iránya között —
// mobilon az áttekintő készenlét-kártyája visz oda (lásd .db-readiness).
const KEY_TO_PAGE = { 1: 'dashboard', 2: 'recovery', 3: 'coach', 4: 'plans', 5: 'workout', 6: 'nutrition' };

export { DAY_LABELS, DAY_NAMES, DIR_TO_PAGE, FLOW_PAGES, KEY_TO_PAGE, NOTIF_CATEGORIES, PAGES };
