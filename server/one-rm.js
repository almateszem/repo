/**
 * Podium — az 1RM-képlet
 * ------------------------------------------------------------------------
 * Külön, függőség nélküli modul: a PR-követés (records.js → db.js) ezt
 * importálja, nem az egész Recovery Engine-t.
 */
import { clamp } from './numbers.js';

/**
 * Az app EGYETLEN 1RM-képlete (Epley). A PR-követés (db.js), az erőfelmérés,
 * a naplóbeli PR-jelző (public/js/workout/pr-indicator.js, teszttel összekötve) és a
 * Recovery Engine is ezt használja.
 *
 *   1RM = súly × (1 + ismétlés / 30),   DE egy ismétlésnél maga a súly.
 *
 * A nyers Epley egyetlen ismétlésre is 3,3%-ot ad hozzá: egy 100 kg-os szingli
 * „103,3 kg-os csúcs" lett, holott pontosan 100 kg-ot emeltél. Az egyismétléses
 * kivétel a képlet szokásos alkalmazása. Korábban a motor a teljes görbét
 * eltolta (ismétlés − 1), a PR-követés pedig a nyers képletet használta —
 * ugyanarra a szettre két különböző szám jött ki.
 *
 * @param {number} weight súly (kg)
 * @param {number} reps   ténylegesen elvégzett ismétlés
 * @param {number} [rir]  tartalék ismétlés — a becsült KAPACITÁSHOZ hozzáadódik
 * @returns {number|null} null, ha nem számolható
 */
export function estimate1RM(weight, reps, rir = 0) {
  if (!(reps >= 1) || !(weight > 0)) return null;
  const total = reps + rir;
  return total <= 1 ? weight : weight * (1 + total / 30);
}

/** RIR-korrigált becslés a Recovery Engine-nek. Az RPE-ből következtetünk a
    tartalékra (RIR = 10 − RPE); ha nincs RPE, RPE 8-at feltételezünk (2
    ismétlés tartalék), ami a naplózás tipikus esete. RPE 10-en ugyanazt adja,
    mint a PR-követés. */
export function epley1RM(reps, weight, rpe) {
  return estimate1RM(weight, reps, clamp(10 - (rpe ?? 8), 0, 5));
}
