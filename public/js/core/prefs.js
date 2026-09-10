/** Felhasználói preferenciák — localStorage, a szervertől függetlenül. */

/** Felhasználói preferenciák — egyetlen JSON kulcs alatt, hibatűrően. */
const PREFS_KEY = 'fittrackpro:prefs';

const prefs = {
  read() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch { return {}; }
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
    } catch { /* privát mód — a demo prefek nélkül is működik */ }
  },
};

export { prefs };
