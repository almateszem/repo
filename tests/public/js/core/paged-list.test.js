import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SIZE, createPagedList, createPagedQuery, debounce } from '../../../../public/js/core/paged-list.js';

/** Kívülről feloldható ígéret — a kérések sorrendjét a teszt dönti el. */
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/** Kamu fetchPage: minden hívást feljegyez, a választ a teszt adja meg. */
function fakeFetch() {
  const calls = [];
  const fetchPage = (params) => {
    const call = { params, ...deferred() };
    calls.push(call);
    return call.promise;
  };
  return { calls, fetchPage };
}

function setup() {
  const { calls, fetchPage } = fakeFetch();
  const items = [];
  const states = [];
  const paged = createPagedQuery({
    fetchPage,
    onItems: (page, { append }) => {
      if (!append) items.length = 0;
      items.push(...page);
    },
    onState: (state) => states.push(state),
  });
  return { calls, items, states, paged };
}

const pageOf = (names, total, nextOffset) => ({ items: names, total, nextOffset });

test('setQuery az első lapot kéri, 0-s offsettel és a lapmérettel', async () => {
  const { calls, items, states, paged } = setup();
  const done = paged.setQuery({ q: 'gugg' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.q, 'gugg');
  assert.equal(calls[0].params.offset, 0);
  assert.equal(calls[0].params.limit, PAGE_SIZE);
  assert.ok(calls[0].params.signal, 'megszakítható');
  assert.equal(states.at(-1).status, 'loading');

  calls[0].resolve(pageOf(['a', 'b'], 2, null));
  await done;
  assert.deepEqual(items, ['a', 'b']);
  assert.deepEqual(states.at(-1), { status: 'ready', total: 2 });
  assert.equal(paged.hasMore, false);
});

test('loadMore a következő lapot fűzi hozzá, null után megáll', async () => {
  const { calls, items, paged } = setup();
  const first = paged.setQuery({ q: '' });
  calls[0].resolve(pageOf(['a', 'b'], 3, 2));
  await first;

  const more = paged.loadMore();
  assert.equal(calls[1].params.offset, 2);
  calls[1].resolve(pageOf(['c'], 3, null));
  await more;
  assert.deepEqual(items, ['a', 'b', 'c']);

  await paged.loadMore();
  assert.equal(calls.length, 2, 'nincs több lap — nem kér újra');
});

test('egyszerre csak egy kérés fut: töltés közben a loadMore nem kér', async () => {
  const { calls, paged } = setup();
  paged.setQuery({ q: '' });
  await paged.loadMore();
  assert.equal(calls.length, 1);
});

test('setQuery előtt a loadMore nem kér semmit', async () => {
  const { calls, paged } = setup();
  await paged.loadMore();
  assert.equal(calls.length, 0);
});

test('a későn érkező régi válasz nem kerül a listára', async () => {
  const { calls, items, states, paged } = setup();
  const old = paged.setQuery({ q: 'g' });
  const fresh = paged.setQuery({ q: 'gugg' });
  assert.equal(calls[0].params.signal.aborted, true, 'a régi kérés megszakadt');

  calls[1].resolve(pageOf(['Guggolás'], 1, null));
  await fresh;
  calls[0].resolve(pageOf(['Gyors', 'Guggolás'], 2, null));
  await old;

  assert.deepEqual(items, ['Guggolás']);
  assert.deepEqual(states.at(-1), { status: 'ready', total: 1 });
});

test('megszakított kérés hibája csendben elmarad', async () => {
  const { calls, states, paged } = setup();
  const old = paged.setQuery({ q: 'g' });
  paged.setQuery({ q: 'gu' });
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  calls[0].reject(abort);
  await old;
  assert.ok(!states.some((state) => state.status === 'error'));
});

test('hiba után a loadMore nem ismétel magától, a retry ugyanazt a lapot kéri', async () => {
  const { calls, items, states, paged } = setup();
  const first = paged.setQuery({ q: '' });
  calls[0].resolve(pageOf(['a'], 2, 1));
  await first;

  const failing = paged.loadMore();
  calls[1].reject(new Error('hálózat'));
  await failing;
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).firstPage, false);

  await paged.loadMore();
  assert.equal(calls.length, 2, 'hibás állapotban nem ismétel magától');

  const again = paged.retry();
  assert.equal(calls[2].params.offset, 1, 'ugyanazt a lapot kéri újra');
  calls[2].resolve(pageOf(['b'], 2, null));
  await again;
  assert.deepEqual(items, ['a', 'b']);
  assert.equal(states.at(-1).status, 'ready');
});

test('az első lap hibája firstPage-ként jelez', async () => {
  const { calls, states, paged } = setup();
  const first = paged.setQuery({ q: '' });
  calls[0].reject(new Error('hálózat'));
  await first;
  assert.equal(states.at(-1).status, 'error');
  assert.equal(states.at(-1).firstPage, true);
});

test('debounce: csak az utolsó hívás fut le, a késleltetés után', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const fn = debounce((value) => calls.push(value), 250);
  fn('a');
  fn('b');
  t.mock.timers.tick(249);
  assert.deepEqual(calls, []);
  t.mock.timers.tick(1);
  assert.deepEqual(calls, ['b']);
});

test('debounce: a cancel elejti a függő hívást', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const fn = debounce((value) => calls.push(value), 250);
  fn('a');
  fn.cancel();
  t.mock.timers.tick(500);
  assert.deepEqual(calls, []);
});

/* ---- A DOM-réteg (createPagedList) kamu DOM-mal és IntersectionObserverrel ---- */

const fakeElement = () => ({
  setAttribute() {},
  addEventListener() {},
  after() {},
  append() {},
  replaceChildren() {},
});

/** Kamu IntersectionObserver: a teszt maga jelez (`notify`), és látja, hányszor
    kérték az őrelem megfigyelését (`observeCount`). */
function fakeObserverEnv(t) {
  const env = { observeCount: 0, callback: null };
  globalThis.document = { createElement: fakeElement };
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      env.callback = callback;
    }
    observe() {
      env.observeCount += 1;
    }
    unobserve() {}
  };
  env.notify = (isIntersecting) => env.callback([{ isIntersecting }]);
  t.after(() => {
    delete globalThis.document;
    delete globalThis.IntersectionObserver;
  });
  return env;
}

test('lista: a betöltés alatti láthatóság nem kér magától még egy lapot', async (t) => {
  const env = fakeObserverEnv(t);
  const { calls, fetchPage } = fakeFetch();
  const paged = createPagedList({ list: fakeElement(), fetchPage, renderItem: fakeElement });

  const first = paged.setQuery({ q: '' });
  // Az üres lista miatt az őrelem látszik, amíg az első lap úton van
  env.notify(true);
  calls[0].resolve(pageOf(['a', 'b'], 4, 2));
  await first;

  /* A 40 új sor kitolta az őrelemet a látótérből, de a megfigyelő még nem
     jelzett újra — a régi „látszik" alapján nem szabad továbbtölteni. */
  assert.equal(calls.length, 1, 'egy jelzésre egy lap');
});

test('lista: betöltés után friss jelzést kér, és ha az őrelem látszik, továbbtölt', async (t) => {
  const env = fakeObserverEnv(t);
  const { calls, fetchPage } = fakeFetch();
  const paged = createPagedList({ list: fakeElement(), fetchPage, renderItem: fakeElement });
  const observedAtStart = env.observeCount;

  const first = paged.setQuery({ q: '' });
  calls[0].resolve(pageOf(['a', 'b'], 4, 2));
  await first;
  assert.ok(env.observeCount > observedAtStart, 'a ready után újra megfigyeli az őrelemet');

  // Rövid lap / magas képernyő: a friss jelzés szerint az őrelem még látszik
  env.notify(true);
  assert.equal(calls.length, 2, 'a friss jelzésre jön a következő lap');
  assert.equal(calls[1].params.offset, 2);
});
