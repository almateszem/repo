/**
 * Késleltetett kötés a router és az oldalak vezérlői között.
 *
 * A lapok vezérlői később, az init során épülnek fel, és többük egymásra is
 * épül. Amit egy MÁSIK modul hív (a router, az api réteg, egy másik vezérlő),
 * az ide iratkozik fel — így nem keletkezik kör a modulgráfban. Az oldal-
 * megnyitáskor futó feladatok NEM itt élnek: azokat a vezérlők a routerben
 * regisztrálják (nav/router.js → onPageShow).
 *
 * A slotok az első hívásig `null`-ok, ezért a hívó oldalon mindig `?.()` áll.
 */

/** Vezérlők által feltöltött visszahívások. */
export const hooks = {
  /** Munkamenet-vesztés menet közben (lejárt süti, másik eszközről kiléptetés).
      A setupAuthGate tölti fel; az api réteg hívja 401-re. */
  onSessionLost: null,

  /** A gyakorlat-választó CÉLJÁNAK átállítása — a setupExercisePicker állítja
      be. Az edzésnapló és a terv-építő paraméterben kapja a választót, de a
      profiloldal ELŐBB áll fel nála (app/init.js), ezért az innen éri el. */
  useExercisePicker: null,

  /** A Regeneráció oldal frissítője — a setupRecovery állítja be. Az oldal
      megnyitása és az edzés lezárása is hívja. */
  refreshRecovery: null,

  /** A heti volumen-diagram frissítője — a setupWeeklyCompare állítja be.
      Az edzés lezárása hívja, hogy a friss szettek azonnal látszódjanak. */
  refreshVolumeChart: null,

  /** Az edzés utáni visszajelzés blokkjának frissítője — a setupSummary
      állítja be; az összegző kirajzolása hívja. */
  refreshSummaryFeedback: null,

  /** A profiloldal frissítője — a setupProfile állítja be. Az oldal minden
      megnyitása (onPageShow) és a beállítások mentése hívja. */
  refreshProfile: null,

  /** A mentett check-in kirajzolása a Regeneráció oldalra — a setupRecovery
      állítja be. A hosszú űrlap ÉS a varázsló is ezt hívja mentés után, így a
      két írási út nem sodródhat szét. */
  applyCheckinSaved: null,

  /** Az edződ étrendjének frissítője — a setupNutrition állítja be. A
      Táplálkozás oldal megnyitása (onPageShow) és az edzői kapcsolat változása
      hívja: az étrendet az EDZŐ írja, tehát bármikor változhat, amíg máshol
      jársz. */
  refreshCoachMeals: null,

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

  /** Van-e a fióknak edzői tevékenysége: edzője, sportolója vagy függő
      meghívója (kapott vagy küldött). A nav gyűrű „fel" iránya ebből dől el:
      igen → Edző, nem → Regeneráció. Az Edző oldal frissítése tölti
      (setupCoachPage → refresh). */
  coachActive: false,
};
