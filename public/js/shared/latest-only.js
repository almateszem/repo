/** Generációs őr („csak a legfrissebb"): egy lassú, régebbi kérés válasza ne
    írjon a felületre, ha közben újabb kérés indult, vagy egy mentés tette
    elavulttá. Ugyanaz a minta, mint a lapozott listában (shared/paged-list.js). */

function createLatestOnly() {
  let generation = 0;
  return {
    /** Új kérés: a visszaadott tokennel kérdezhető, érvényes-e még. */
    begin: () => ++generation,
    /** Igaz, ha azóta nem indult újabb kérés és nem volt invalidate. */
    isCurrent: (token) => token === generation,
    /** Minden futó kérés elavul (pl. sikeres mentés után). */
    invalidate: () => {
      generation += 1;
    },
  };
}

export { createLatestOnly };
