/**
 * FitTrack Pro — kérés-korlátozás
 * --------------------------------
 * Rögzített ablakos számláló, memóriában. Nulla új függőség, és szándékosan
 * nem elosztott: újraindításkor nullázódik, több példánynál példányonként
 * számol. Ezt vállaljuk — a cél nem egy elszánt támadó megállítása, hanem
 * hogy egy elszabadult kliens (végtelen ciklusba került autosave), egy
 * megunt „nyomjuk a gombot" és a fiók-gyártó szkript ne tudja megfektetni a
 * szinkron SQLite-on futó szervert.
 *
 * A modul nem ismeri sem az adatbázist, sem az Expresst — tiszta függvény,
 * ezért külön tesztelhető (server/ratelimit.test.js). Az idő is átadható,
 * hogy a teszteknek ne kelljen várniuk.
 *
 * MIÉRT RÖGZÍTETT ABLAK, és nem csúszó: a rögzített ablak legrosszabb esetben
 * kétszeres burst-öt enged át két ablak határán. Ez itt tudatos csere — a
 * csúszó ablakhoz kulcsonként időbélyeg-listát kellene tartani, ami pont a
 * memóriát terhelné, amit védeni akarunk. A limitek elég bőkezűek ahhoz, hogy
 * a kétszeres burst se legyen baj.
 */

/** Ennyi kulcs fölött söprünk a lejárt bejegyzésekért (ld. sweep). */
const SWEEP_THRESHOLD = 1000;

/**
 * Új korlátozó.
 *
 * @param {number} options.limit    ennyi kérés fér bele egy ablakba
 * @param {number} options.windowMs az ablak hossza ezredmásodpercben
 */
export function createRateLimiter({ limit, windowMs }) {
  /** kulcs → { count, startedAt } */
  const entries = new Map();

  /* A lejárt bejegyzések takarítása. Enélkül a map minden valaha látott
     kulcsot megtartana — IP-alapú korlátozásnál ez lassú memóriaszivárgás.
     Csak akkor fut, amikor a map már érdemben megnőtt, tehát a szokásos
     forgalomban gyakorlatilag ingyen van. */
  function sweep(now) {
    for (const [key, entry] of entries) {
      if (now - entry.startedAt >= windowMs) entries.delete(key);
    }
  }

  return {
    /**
     * Egy kérés könyvelése.
     * @returns {{allowed: boolean, remaining: number, retryAfter: number}}
     *          a retryAfter MÁSODPERCBEN, a Retry-After fejléchez
     */
    hit(key, now = Date.now()) {
      if (entries.size > SWEEP_THRESHOLD) sweep(now);

      const entry = entries.get(key);
      if (!entry || now - entry.startedAt >= windowMs) {
        entries.set(key, { count: 1, startedAt: now });
        return { allowed: true, remaining: limit - 1, retryAfter: 0 };
      }

      entry.count += 1;
      if (entry.count <= limit) {
        return { allowed: true, remaining: limit - entry.count, retryAfter: 0 };
      }

      /* A túllépés is számít: aki tovább veri, annak az ablak vége felől
         nézve ugyanannyit kell várnia — nem tolódik ki, de nem is rövidül. */
      const waitMs = windowMs - (now - entry.startedAt);
      return { allowed: false, remaining: 0, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
    },

    /** Egy kulcs számlálójának nullázása (pl. sikeres belépés után). */
    reset: (key) => entries.delete(key),

    /** Csak a teszteknek: hány kulcsot tartunk épp nyilván. */
    size: () => entries.size,
  };
}
