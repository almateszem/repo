/**
 * Podium — a rekord-szabály
 * ---------------------------------------
 * Melyik szett a gyakorlat REKORDJA, és mennyi a becsült 1RM-je. Tiszta
 * függvények, adatbázis nélkül: a db.js (PR-követés, csúcs-újraépítés), a
 * server.js (PR-lista) és a coaching.js (az edző „Legutóbbi aktivitás" sora)
 * is innen veszi — így mindenhol UGYANAZ a szett számít rekordnak.
 */

import { estimate1RM } from './recovery.js';

/** A becsült 1RM a PR-követéshez: az app közös Epley-képlete (recovery.js →
    estimate1RM, egy ismétlésnél maga a súly). A szett mezői szövegként is
    jöhetnek; nem számolható értékre 0. */
export function calculateEpley1RM(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r)) return 0;
  return estimate1RM(w, r) ?? 0;
}

/**
 * A gyakorlat REKORDOT HOZÓ szettje: a teljesítettek közül a legmagasabb
 * becsült 1RM-ű. Ha egy sor sincs bepipálva, nincs ilyen szett (null) — egy
 * előre kitöltött, el nem végzett sor nem lehet rekord. A `fallbackToFirst`
 * a pipák előtti naplónak szól (workouts.pr_rule = 0): ott pipa híján az
 * első sor számított, és ezeknek a soroknak a csúcsai nem veszhetnek el.
 *
 * Ez az egyetlen hely, ahol ez a szabály ki van mondva, és ennek oka van. A
 * szabály eddig kétszer, két ágon élt: az addWorkout a legjobb szettből
 * döntött PR-ről, a /api/prs listája viszont az ELSŐ teljesítettet írta ki.
 * Amíg minden szett egyforma volt, ez ritkán tért el; a szett-típusok óta
 * viszont az első sor alapból BEMELEGÍTŐ, tehát a lista rendszeresen egy
 * könnyű bemelegítést hirdetett rekordnak (10 × 40 kg a 5 × 100 helyett),
 * miközben a mellette álló csúcs a valódi értéket mutatta.
 *
 * A `baseLoad` a saját testsúlyos gyakorlatoké: ott a beírt kilogramm csak a
 * RÁADÁS, a terhelés zöme a testsúly. Enélkül a rangsor is hibás volna — nulla
 * súllyal minden szett 1RM-je 0, tehát a „legjobb" mindig az ELSŐ pipált sor
 * lenne, nem a legtöbb ismétléses.
 *
 * @param {Array<object>} sets egy gyakorlat szettjei
 * @param {{ fallbackToFirst?: boolean, baseLoad?: number }} [options]
 *        fallbackToFirst: pipa híján az első sor legyen-e a rekord;
 *        baseLoad: minden szett súlyához hozzáadandó alapterhelés (kg)
 * @returns {object|null} a rekordot hozó szett, vagy null
 */
export function bestCompletedSet(sets = [], { fallbackToFirst = false, baseLoad = 0 } = {}) {
  let best = null;
  let best1rm = 0;
  for (const set of sets) {
    if (!set?.done) continue;
    const oneRM = calculateEpley1RM(Number(set.weight || 0) + baseLoad, set.reps);
    if (best === null || oneRM > best1rm) {
      best = set;
      best1rm = oneRM;
    }
  }
  return best ?? (fallbackToFirst ? (sets[0] ?? null) : null);
}

/** A testsúly egy adott napon a megadott naplóból: az utolsó bejegyzés a
    napon vagy előtte. Ha a napló csak később kezdődik, a legkorábbi bejegyzés
    — az a legjobb közelítés. Bejegyzés híján 0, és a hívó onnan tudja, hogy
    nem tippelünk. (A db.js weightForDate-je ezt hívja a beolvasott naplóval.) */
export function weightOnDate(log, date) {
  let best = null;
  let earliest = null;
  for (const entry of log ?? []) {
    if (entry.date <= date && (!best || entry.date >= best.date)) best = entry;
    // A tartalék a legkorábbi DÁTUMÚ bejegyzés, nem a legelőször rögzített:
    // egy utólag bepótolt régi mérés is lehet a legkorábbi.
    if (!earliest || entry.date < earliest.date) earliest = entry;
  }
  return (best ?? earliest)?.kg ?? 0;
}
