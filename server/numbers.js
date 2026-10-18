/**
 * Podium — általános szám-segédek
 * ------------------------------------------------------------------------
 * A Recovery Engine moduljai (recovery.js, training-load.js, exercise-advice.js,
 * one-rm.js) közösen használják őket; külön modulban, hogy egyik se a másikon
 * át érje el őket.
 */

/** Szám a felületen megjelenő SZÖVEGBE: max 1 tizedes, magyar
    tizedesvesszővel („82,5"). Ugyanaz a szabály, mint a kliens formatNumber-e
    (public/js/core/format.js) — a szerver által összerakott mondatok (edzői
    kártya, javaslatok) így nem írnak pontot a kliens vesszője mellé. */
export const formatDecimal = (value) =>
  String(Math.round(Number(value) * 10) / 10).replace('.', ',');

export const clamp01 = (value) => Math.min(1, Math.max(0, value));
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Számmá alakítás úgy, hogy az üres/érvénytelen érték `null` legyen — nem 0.
    Ez fontos: a „nem adta meg" és a „nulla" két különböző dolog. */
export const num = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

export const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

export const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
