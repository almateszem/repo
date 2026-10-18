/**
 * Podium — dátum-segédek
 * ------------------------------------------------------------------------
 * A mentett adatok „ÉÉÉÉ.HH.NN" formátumához: tiszta függvények, adatbázis és
 * motor nélkül. A Recovery Engine, a terv-hét, az edzői összegző és a szerver
 * is innen importál, hogy egyetlen implementáció legyen.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "ÉÉÉÉ.HH.NN" → helyi Date. */
export const parseDate = (str) => {
  const [year, month, day] = String(str).split('.').map(Number);
  return new Date(year, month - 1, day);
};

/** Egy "ÉÉÉÉ.HH.NN" dátum helyi éjfélre normalizált timestampje — így két nap
    akkor és csak akkor egyezik, ha ugyanaz a naptári nap. */
export const dayKey = (str) => {
  const d = parseDate(str);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Egy nap-kulcs (helyi éjfél) eltolása `days` NAPTÁRI nappal.

    Nem `key ± n × DAY_MS`: az óraátállítás napja 23 vagy 25 órás, és a
    24 órás lépés ilyenkor az előző nap 23:00-jára vagy a nap 01:00-jára esik
    — egy olyan kulcsra, ami egyetlen naplózott napéval sem egyezik. A
    setDate a helyi naptárban lép, tehát az éjfél éjfél marad. */
export const shiftDayKey = (key, days) => {
  const date = new Date(key);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

/** Két nap-kulcs különbsége egész napokban. A kerekítés az óraátállítás
    ±1 óráját nyeli el (a 25 órás nap is egy nap). */
export const daysBetween = (fromKey, toKey) => Math.round((toKey - fromKey) / DAY_MS);

/** Egy Date → "ÉÉÉÉ.HH.NN", HELYI idő szerint (pl. "2026.07.26"). Nem
    toISOString: az UTC-t adna, és éjfél után előző napi dátumot könyvelne. */
export const formatDate = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
};

/** Egy "ÉÉÉÉ.HH.NN" dátum eltolása napokkal (negatív = visszafelé). */
export const shiftDate = (dateStr, days) => {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatDate(date);
};

/** Egy nap-kulcs hétnapja hétfőtől számolva (0 = hétfő … 6 = vasárnap). */
export const weekdayOf = (key) => (new Date(key).getDay() + 6) % 7;

/** Hány nappal ezelőtt volt `date` a `todayKey` naphoz képest (negatív = jövő). */
export const daysAgo = (date, todayKey) => daysBetween(dayKey(date), todayKey);
