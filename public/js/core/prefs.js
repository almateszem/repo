/** Felhasználói preferenciák — localStorage, a szervertől függetlenül. */

/** Felhasználói preferenciák — egyetlen JSON kulcs alatt, hibatűrően. */
const PREFS_KEY = 'podium:prefs';
// A projekt régi (FitTrack) nevén mentett kulcs — olvasáskor átvesszük.
const LEGACY_PREFS_KEY = 'fittrackpro:prefs';

const prefs = {
  read() {
    try {
      const stored = localStorage.getItem(PREFS_KEY) ?? localStorage.getItem(LEGACY_PREFS_KEY);
      return JSON.parse(stored) || {};
    } catch {
      return {};
    }
  },
  get(key, fallback) {
    const value = this.read()[key];
    return value === undefined ? fallback : value;
  },
  set(key, value) {
    try {
      const all = this.read();
      all[key] = value;
      localStorage.setItem(PREFS_KEY, JSON.stringify(all));
    } catch {
      /* privát mód — a demo prefek nélkül is működik */
    }
  },
};

export { prefs };
