/** Lapozott, szerveroldalon keresett lista — a gyakorlat-választó és az
    étel-lista közös motorja.

    Két réteg:
      · createPagedQuery — DOM-mentes állapotgép (melyik lap jön, melyik
        válasz érvényes). Node-ban tesztelt (paged-list.test.js), ezért a modul
        felső szintje nem nyúlhat a `window`-hoz/`document`-hez.
      · createPagedList — a DOM-réteg: kirajzolja a lapokat, a lista végén egy
        őrelemet figyel (IntersectionObserver), és ott mutatja a „Betöltés…" /
        „Újra" állapotot. */

const PAGE_SIZE = 40;

/** A gépelés késleltetése: ennyi szünet után megy ki a keresés, nem minden
    leütésre. */
const SEARCH_DELAY_MS = 250;

/** Az őrelem ennyivel a látótér alja ELŐTT jelez — a következő lap már
    töltődik, mire a felhasználó odaér. */
const PREFETCH_MARGIN = '400px 0px';

function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

function createPagedQuery({ fetchPage, onItems, onState }) {
  let query = null;
  let nextOffset = 0;
  let total = 0;
  let status = 'idle';
  /* Minden setQuery új „nemzedéket" indít. A régi nemzedék válasza akkor sem
     kerülhet a listára, ha a fetch nem vette figyelembe a megszakítást. */
  let generation = 0;
  let controller = null;

  async function load() {
    const gen = generation;
    const offset = nextOffset;
    controller = new AbortController();
    status = 'loading';
    onState({ status, total });

    let page;
    try {
      page = await fetchPage({ ...query, offset, limit: PAGE_SIZE, signal: controller.signal });
    } catch (error) {
      // A felhasználó továbbgépelt: ez nem hiba, csak elavult kérés.
      if (gen !== generation || error?.name === 'AbortError') return;
      status = 'error';
      onState({ status, total, firstPage: offset === 0, error });
      return;
    }
    if (gen !== generation) return;

    onItems(page.items, { append: offset > 0 });
    total = page.total;
    nextOffset = page.nextOffset;
    status = 'ready';
    onState({ status, total });
  }

  return {
    /** Új keresés: a futó kérés megszakad, a lista elölről indul. */
    setQuery(next) {
      generation += 1;
      controller?.abort();
      query = { ...next };
      nextOffset = 0;
      total = 0;
      return load();
    },
    /** A következő lap, ha van — töltés közben és hiba után nem kér. */
    loadMore() {
      if (status !== 'ready' || nextOffset === null) return Promise.resolve();
      return load();
    },
    /** Hiba után ugyanazt a lapot kéri újra. */
    retry() {
      if (status !== 'error') return Promise.resolve();
      return load();
    },
    get status() {
      return status;
    },
    get hasMore() {
      return nextOffset !== null;
    },
  };
}

function createPagedList({ list, fetchPage, renderItem, onPage = () => {}, onState = () => {} }) {
  /* Az őrelem a lista UTÁN áll, nem benne: a lista lehet <ul> is, és a
     „Betöltés…" / „Újra" sor nem lista-elem. */
  const sentinel = document.createElement('div');
  sentinel.className = 'paged-sentinel';
  sentinel.setAttribute('aria-live', 'polite');
  list.after(sentinel);
  let sentinelVisible = false;

  const renderSentinel = ({ status }) => {
    if (status === 'loading') {
      sentinel.textContent = 'Betöltés…';
      return;
    }
    if (status === 'error') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'paged-retry tap-target';
      retryBtn.textContent = 'Újra';
      retryBtn.addEventListener('click', () => paged.retry());
      sentinel.replaceChildren('Nem sikerült betölteni — ', retryBtn);
      return;
    }
    sentinel.replaceChildren();
  };

  const paged = createPagedQuery({
    fetchPage,
    onItems(items, { append }) {
      const nodes = items.map(renderItem);
      if (append) list.append(...nodes);
      else list.replaceChildren(...nodes);
      onPage(items, nodes, { append });
    },
    onState(state) {
      renderSentinel(state);
      // Ha már az első lap sem jött le, a hibasor álljon a lista helyén
      if (state.status === 'error' && state.firstPage) list.replaceChildren();
      onState(state);
      /* Rövid lap vagy magas képernyő: az őrelem a betöltés után is látszik,
         és az IntersectionObserver nem jelez újra (nem változott semmi) —
         ilyenkor magunk kérjük a következőt. */
      if (state.status === 'ready' && sentinelVisible) paged.loadMore();
    },
  });

  /* Rejtett oldalon (display: none) az őrelem nem metszi a látóteret, tehát
     háttérben nem töltünk; az oldal megjelenésekor a megfigyelő újra jelez. */
  new IntersectionObserver(
    ([entry]) => {
      sentinelVisible = entry.isIntersecting;
      if (sentinelVisible) paged.loadMore();
    },
    { rootMargin: PREFETCH_MARGIN },
  ).observe(sentinel);

  return {
    setQuery: (query) => paged.setQuery(query),
    retry: () => paged.retry(),
  };
}

export { PAGE_SIZE, SEARCH_DELAY_MS, createPagedList, createPagedQuery, debounce };
