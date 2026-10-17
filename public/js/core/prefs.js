/** Felhasználói preferenciák — localStorage, a szervertől függetlenül. */

/** Felhasználói preferenciák — FIÓKONKÉNT egy JSON kulcs alatt
    (`podium:prefs:<felhasználónév>`), hibatűrően. Korábban egyetlen
    böngésző-szintű kulcs volt: közös gépen a második fiók örökölte az első
    nevét, olvasott-idejét és nézetét. */
const PREFS_PREFIX = 'podium:prefs:';
// A régi, közös kulcsok: a jelenlegi és a projekt régi (FitTrack) nevén mentett.
const SHARED_PREFS_KEY = 'podium:prefs';
const LEGACY_PREFS_KEY = 'fittrackpro:prefs';

/** A megkötött fiók kulcsa, vagy null. Megkötés előtt (belépő képernyő) a
    beállítások csak a memóriában élnek: közös kulcsra semmi nem íródik. */
let boundKey = null;
let unboundPrefs = {};

/** A felhasználónév normalizált alakja — ugyanúgy, ahogy a szerver azonosít
    (server/auth.js → normalizeUsername). */
const normalizeUsername = (raw) =>
  String(raw ?? '')
    .trim()
    .toLowerCase();

const prefs = {
  /** A fiók megkötése — a sikeres /api/auth/me, belépés vagy regisztráció
      UTÁN, az első olvasás előtt. Ha a fióknak még nincs saját kulcsa, a régi
      közös kulcs tartalmát ő veszi át; a közös kulcsok ezután törlődnek, így
      egy második fiók már tiszta lappal indul. */
  bind(username) {
    const name = normalizeUsername(username);
    if (!name) return;
    boundKey = PREFS_PREFIX + name;
    unboundPrefs = {};
    try {
      if (localStorage.getItem(boundKey) === null) {
        const shared =
          localStorage.getItem(SHARED_PREFS_KEY) ?? localStorage.getItem(LEGACY_PREFS_KEY);
        if (shared !== null) localStorage.setItem(boundKey, shared);
      }
      localStorage.removeItem(SHARED_PREFS_KEY);
      localStorage.removeItem(LEGACY_PREFS_KEY);
    } catch {
      /* privát mód — a demo prefek nélkül is működik */
    }
  },
  /** Kijelentkezéskor: innentől semmi nem olvas és nem ír a fiók kulcsára. */
  unbind() {
    boundKey = null;
    unboundPrefs = {};
  },
  read() {
    if (!boundKey) return unboundPrefs;
    try {
      return JSON.parse(localStorage.getItem(boundKey)) || {};
    } catch {
      return {};
    }
  },
  get(key, fallback) {
    const value = this.read()[key];
    return value === undefined ? fallback : value;
  },
  set(key, value) {
    if (!boundKey) {
      unboundPrefs[key] = value;
      return;
    }
    try {
      const all = this.read();
      all[key] = value;
      localStorage.setItem(boundKey, JSON.stringify(all));
    } catch {
      /* privát mód — a demo prefek nélkül is működik */
    }
  },
};

export { prefs };
