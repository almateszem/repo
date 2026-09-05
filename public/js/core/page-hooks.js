/**
 * Késleltetett kötés a router és az oldalak vezérlői között.
 *
 * A router megnyitáskor frissíteni akarja az oldalt, de nem ismerheti a lapok
 * vezérlőit: azok később, az init során épülnek fel, és többük egymásra is
 * épül. A vezérlők ezért ide iratkoznak fel, a router pedig innen hív —
 * így a nav/ nem függ a ui/-tól, és nem keletkezik kör a modulgráfban.
 *
 * A slotok az első hívásig `null`-ok, ezért a hívó oldalon mindig `?.()` áll.
 */

/** Vezérlők által feltöltött visszahívások. */
export const hooks = {
  /** Munkamenet-vesztés menet közben (lejárt süti, másik eszközről kiléptetés).
      A setupAuthGate tölti fel; az api réteg hívja 401-re. */
  onSessionLost: null,

  /** A gyakorlat-választó frissítője — a setupExercisePicker állítja be.
      Megjelenéskor frissíti a cél nevét és a hozzáadás-gombok állapotát. */
  refreshExercisePicker: null,

  /** A Regeneráció oldal frissítője — a setupRecovery állítja be. Az oldal
      megnyitása és az edzés lezárása is hívja. */
  refreshRecovery: null,

  /** A heti volumen-diagram frissítője — a setupWeeklyCompare állítja be.
      Az edzés lezárása hívja, hogy a friss szettek azonnal látszódjanak. */
  refreshVolumeChart: null,

  /** Az edzés utáni visszajelzés blokkjának frissítője — a setupSummary
      állítja be; az összegző kirajzolása hívja. */
  refreshSummaryFeedback: null,

  /** A check-in varázsló frissítője — a setupCheckinWizard állítja be. Friss
      riportot kér minden megnyitáskor; a lépés-pozíció csak új munkamenetnél
      áll vissza. */
  refreshCheckinWizard: null,

  /** A profiloldal frissítője — a setupProfile állítja be. Az oldal minden
      megnyitása hívja (a pageEffects-en át). */
  refreshProfile: null,

  /** Az Edző oldal frissítője — a setupCoachPage állítja be. Az oldal minden
      megnyitása hívja: a kapcsolatok, a sportolók állapota és az üzenetek a
      másik fél lépéseitől is változnak. */
  refreshCoachPage: null,

  /** A mentett check-in kirajzolása a Regeneráció oldalra — a setupRecovery
      állítja be. A hosszú űrlap ÉS a varázsló is ezt hívja mentés után, így a
      két írási út nem sodródhat szét. */
  applyCheckinSaved: null,

  /** A készenlét-javaslat ablaka — az init állítja be. A check-in mentése után
      ugrik fel, ha van mit javasolni. Azért késleltetett, mert a setupRecovery-
      nél KÉSŐBB épül fel (az edzésnapló vezérlője kell hozzá), a check-in
      mentése viszont onnan fut. */
  adviceModal: null,
};

/** A router és a vezérlők közös jelzői. */
export const shared = {
  /** Az onboarding zárja: a kötelező első check-in alatt nincs navigáció.
      A setOnboardingLock írja (nav/router.js). */
  onboardingLock: false,

  /** Van-e elfogadott edződ. Az edzés utáni visszajelzés blokkja ebből dől el:
      edző nélkül nincs kinek küldeni.

      SZÁNDÉKOSAN nem a /api/user-ből jön: az a végpont nem ad „hasCoach"
      mezőt, mert a szerepkör nem a felhasználó tulajdonsága, hanem a
      kapcsolatokból következik. A jelzőt ezért az Edző oldal állapota tölti
      fel (setupCoachPage → refresh), ami az induláskor amúgy is lefut. */
  hasCoachLink: false,
};
