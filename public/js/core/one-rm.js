/**
 * A becsült 1RM a naplóbeli PR-jelzőhöz.
 *
 * UGYANAZ a képlet, mint a szerveren (server/recovery.js → estimate1RM, amit a
 * PR-követés is használ): Epley, de egy ismétlésnél maga a súly. A kliens nem
 * importálhat a server/ mappából, ezért itt másolat él — a one-rm.test.js a
 * kettőt egymáshoz köti, hogy ne sodródhassanak szét. Ha a jelző más számot
 * számolna, mint a mentés, a „PR" gomb világítana egy olyan szettre, amit a
 * szerver nem fogad el rekordnak (vagy fordítva).
 *
 * @param {number} weight súly (kg)
 * @param {number} reps   elvégzett ismétlés
 * @returns {number} a becslés, vagy 0, ha nem számolható
 */
export function estimate1RM(weight, reps) {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || reps < 1 || weight <= 0) return 0;
  return reps <= 1 ? weight : weight * (1 + reps / 30);
}
