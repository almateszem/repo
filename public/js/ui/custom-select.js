/** Saját lenyíló a natív <select> helyett — az egész appban egy recept.

    Miért: a natív opciólistát a böngésző/OS rajzolja, és a sötét témában
    rosszul — Windowson fehér lista, benne a világos szöveg olvashatatlan.
    Az edzésnapló lenyílói (sorszám, szett-típus, intenzitás) már saját
    felépítésűek; ez ugyanazt a nyelvet adja minden más <select>-nek.

    Hogyan: a natív <select> a helyén MARAD (láthatatlanul), és továbbra is ő
    az igazság forrása — az értéke, a `change` eseménye, az űrlap és a meglévő
    kód (`select.value = …`, `replaceChildren(new Option(…))`) változatlanul
    működik. Mellé kerül egy gomb (a select saját osztályaival, így a mező a
    helyén ugyanúgy néz ki) és egy listbox. A kettő szinkronját a select
    figyelése tartja: az opciók cseréje (MutationObserver), a programozott
    értékadás (a `value`/`selectedIndex` példány-szintű felülírása) és az
    űrlap-visszaállítás. */

import { $$ } from '../core/dom.js';

let seq = 0;
/** Egyszerre egy nyitott lenyíló — a nyitott bezárója. */
let closeOpen = null;

const CHEVRON =
  '<svg class="ds-select-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

const proto = HTMLSelectElement.prototype;
const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
const indexDesc = Object.getOwnPropertyDescriptor(proto, 'selectedIndex');

/** Egy natív <select> felöltöztetése. Kétszer nem fut le ugyanarra. */
function enhanceSelect(select) {
  if (select.dataset.dsSelect) return;
  select.dataset.dsSelect = '1';
  const uid = `ds-select-${++seq}`;

  const wrap = document.createElement('div');
  wrap.className = 'ds-select';
  select.before(wrap);

  // A gomb a select osztályait örökli: a mező mérete, kerete, betűje marad
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `${select.className} ds-select-trigger`.trim();
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${uid}-list`);
  const valueEl = document.createElement('span');
  valueEl.className = 'ds-select-value';
  valueEl.id = `${uid}-value`;
  trigger.append(valueEl);
  trigger.insertAdjacentHTML('beforeend', CHEVRON);

  // Akadálymentes név: a select címkéje (<label for>) + az aktuális érték
  const label = select.id && document.querySelector(`label[for="${select.id}"]`);
  if (label) {
    label.id ||= `${uid}-label`;
    trigger.setAttribute('aria-labelledby', `${label.id} ${valueEl.id}`);
  } else if (select.getAttribute('aria-label')) {
    trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
  }

  const menu = document.createElement('ul');
  menu.className = 'ds-select-menu';
  menu.id = `${uid}-list`;
  menu.setAttribute('role', 'listbox');
  menu.tabIndex = -1;
  menu.hidden = true;
  if (label) menu.setAttribute('aria-labelledby', label.id);

  select.className = 'ds-select-native';
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  wrap.append(select, trigger, menu);

  // A címkére kattintás a (láthatatlan) selectet fókuszálná — a gombra tereljük
  select.addEventListener('focus', () => trigger.focus());

  let active = -1; // a billentyűzettel kijelölt opció indexe nyitott állapotban

  const options = () => [...select.options];
  const optionEls = () => $$('.ds-select-option', menu);

  /** A gomb felirata és a lista a select állapotából. */
  const render = () => {
    const current = select.options[select.selectedIndex];
    valueEl.textContent = current?.textContent.trim() || '—';
    trigger.classList.toggle('is-placeholder', !current || current.value === '');
    trigger.disabled = select.disabled || select.options.length === 0;
    menu.replaceChildren(
      ...options().map((option, index) => {
        const li = document.createElement('li');
        li.className = 'ds-select-option';
        li.id = `${uid}-opt-${index}`;
        li.setAttribute('role', 'option');
        li.dataset.index = index;
        li.textContent = option.textContent.trim();
        li.setAttribute('aria-selected', String(index === select.selectedIndex));
        if (option.disabled) li.setAttribute('aria-disabled', 'true');
        return li;
      }),
    );
  };

  const setActive = (index) => {
    const els = optionEls();
    if (els.length === 0) return;
    active = Math.max(0, Math.min(index, els.length - 1));
    els.forEach((el, i) => el.classList.toggle('is-active', i === active));
    trigger.setAttribute('aria-activedescendant', els[active].id);
    els[active].scrollIntoView({ block: 'nearest' });
  };

  const close = () => {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    if (closeOpen === close) closeOpen = null;
  };

  const open = () => {
    if (trigger.disabled || !menu.hidden) return;
    closeOpen?.();
    render();
    // Lefelé nyílik; ha alul nincs elég hely, felfelé
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    wrap.classList.toggle('opens-up', below < 260 && rect.top > below);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    setActive(Math.max(0, select.selectedIndex));
    closeOpen = close;
  };

  /** Választás: a NATÍV select kapja az értéket, és a szokásos események
      futnak le — a meglévő `change`-figyelők így észre sem veszik a cserét. */
  const choose = (index) => {
    const option = select.options[index];
    if (!option || option.disabled) return;
    const changed = index !== select.selectedIndex;
    indexDesc.set.call(select, index);
    render();
    close();
    trigger.focus();
    if (changed) {
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  trigger.addEventListener('click', () => (menu.hidden ? open() : close()));

  menu.addEventListener('click', (event) => {
    const li = event.target.closest('.ds-select-option');
    if (li) choose(Number(li.dataset.index));
  });
  // Egérrel a mutatott opció legyen a kijelölt — a billentyű onnan folytatja
  menu.addEventListener('mousemove', (event) => {
    const li = event.target.closest('.ds-select-option');
    if (li && Number(li.dataset.index) !== active) setActive(Number(li.dataset.index));
  });

  // Gépelés: az első betűk szerint ugrik (mint a natív selectnél)
  let typed = '';
  let typedTimer = 0;
  const typeahead = (key) => {
    typed += key.toLowerCase();
    clearTimeout(typedTimer);
    typedTimer = setTimeout(() => (typed = ''), 600);
    const index = options().findIndex((option) =>
      option.textContent.trim().toLowerCase().startsWith(typed),
    );
    if (index === -1) return;
    if (menu.hidden) choose(index);
    else setActive(index);
  };

  trigger.addEventListener('keydown', (event) => {
    const { key } = event;
    if (menu.hidden) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(key)) {
        event.preventDefault();
        open();
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey) {
        typeahead(key);
      }
      return;
    }
    const last = optionEls().length - 1;
    const moves = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: last,
      PageDown: active + 8,
      PageUp: active - 8,
    };
    if (key in moves) {
      event.preventDefault();
      setActive(moves[key]);
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault();
      choose(active);
    } else if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // a modált ne zárja be — csak a listát
      close();
    } else if (key === 'Tab') {
      close();
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey) {
      typeahead(key);
    }
  });

  // Kívülre kattintás / a fókusz elvándorlása bezár
  document.addEventListener('pointerdown', (event) => {
    if (!wrap.contains(event.target)) close();
  });
  trigger.addEventListener('blur', (event) => {
    if (!wrap.contains(event.relatedTarget)) close();
  });

  /* ---- Szinkron a natív selecttel ---- */
  // Opciók cseréje (pl. `replaceChildren(new Option(…))`), letiltás
  new MutationObserver(render).observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['disabled', 'selected', 'label'],
  });
  // Programozott értékadás: `select.value = …` nem vált ki eseményt, ezért a
  // példányon felülírjuk — a prototípus viselkedése marad, csak utána rajzolunk
  Object.defineProperty(select, 'value', {
    configurable: true,
    get: () => valueDesc.get.call(select),
    set: (value) => {
      valueDesc.set.call(select, value);
      render();
    },
  });
  Object.defineProperty(select, 'selectedIndex', {
    configurable: true,
    get: () => indexDesc.get.call(select),
    set: (index) => {
      indexDesc.set.call(select, index);
      render();
    },
  });
  select.addEventListener('change', render);
  select.form?.addEventListener('reset', () => setTimeout(render));

  render();
}

/** A gyökér alatti összes <select> felöltöztetése (idempotens). */
function enhanceSelects(root = document) {
  $$('select', root).forEach(enhanceSelect);
}

export { enhanceSelect, enhanceSelects };
