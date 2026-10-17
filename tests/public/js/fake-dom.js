/** Minimális DOM-helyettesítő a kliens-modulok teszteléséhez (jsdom nincs).
    Minden szelektor — a gyökértől függetlenül — ugyanazt az elemet adja
    vissza, így a teszt a `elementFor(szelektor)`-ral éri el, amit a modul
    kikeresett. Csak annyit tud, amennyit a tesztelt modulok használnak; a
    globálisokat (window, document) az `installFakeDom` állítja be, a modul
    importálása ELŐTT kell hívni. */

const elements = new Map();

class FakeElement {
  constructor() {
    this.value = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.children = [];
    this.style = { setProperty() {} };
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    // cloneTemplate: $('#id').content.firstElementChild.cloneNode(true)
    this.content = { firstElementChild: { cloneNode: () => this } };
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }

  /** Az esemény kiváltása a regisztrált kezelőkön. */
  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] ?? []) {
      listener({ preventDefault() {}, target: this, detail: 1, ...event });
    }
  }

  querySelector(selector) {
    return elementFor(selector);
  }

  querySelectorAll() {
    return [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  focus() {}

  remove() {}

  closest() {
    return null;
  }

  reset() {}
}

/** A szelektorhoz tartozó (első kéréskor létrehozott) elem. */
export function elementFor(selector) {
  if (!elements.has(selector)) elements.set(selector, new FakeElement());
  return elements.get(selector);
}

export function installFakeDom() {
  globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.document = {
    activeElement: null,
    head: new FakeElement(),
    body: new FakeElement(),
    querySelector: elementFor,
    querySelectorAll: () => [],
    createElement: () => new FakeElement(),
    createTextNode: (text) => text,
    addEventListener() {},
  };
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
}
