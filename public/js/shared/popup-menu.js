/**
 * Podium — a napló saját lenyílói (sorszám, szett-típus, intenzitás, plusz súly)
 * ------------------------------------------------------------------------
 * A natív <select> listája böngészőnként másképp (és ebben a témában csúnyán)
 * rajzolódik ki, ezért a napló sorain saját lenyílók ülnek. A nyitás, a zárás
 * és a billentyűzet egy helyen él: a gyökérre (a gyakorlat-lista) egy
 * delegált kattintás-figyelő kerül, a dokumentumra pedig EGYETLEN közös
 * pointerdown- és keydown-figyelő, akárhány lenyíló és lista van — a sorok
 * jönnek-mennek, figyelő nem szivárog.
 *
 * A billentyűzet a custom-select mintáját követi: a gombon ↓/↑ nyit, nyitott
 * listában ↓/↑/Home/End lép, a gépelt betűk a felirat eleje szerint ugranak,
 * Enter/Szóköz választ (az opció gomb), Escape zár és a gombra viszi vissza a
 * fókuszt.
 */
import { $ } from './dom.js';

/** A nyitott lenyílók: { trigger, menu, wrap }. */
const open = new Set();

function close(entry) {
  entry.menu.hidden = true;
  entry.trigger.setAttribute('aria-expanded', 'false');
  open.delete(entry);
}

function closeAll() {
  [...open].forEach(close);
}

/** A lenyíló választható (nem tiltott) opciói. */
const enabledOptions = (menu) =>
  [...menu.querySelectorAll('[role="option"]')].filter((option) => !option.disabled);

function focusOption(menu, index) {
  const options = enabledOptions(menu);
  if (options.length === 0) return;
  options[Math.max(0, Math.min(index, options.length - 1))].focus();
}

/** Billentyűzetes nyitáskor a kijelölt opcióra (vagy az elsőre) áll. */
function focusSelected(menu) {
  const options = enabledOptions(menu);
  const selected = options.findIndex((option) => option.getAttribute('aria-selected') === 'true');
  focusOption(menu, Math.max(0, selected));
}

let typed = '';
let typedTimer = 0;
function typeahead(menu, key) {
  typed += key.toLowerCase();
  clearTimeout(typedTimer);
  typedTimer = setTimeout(() => (typed = ''), 600);
  const index = enabledOptions(menu).findIndex((option) =>
    option.textContent.trim().toLowerCase().startsWith(typed),
  );
  if (index !== -1) focusOption(menu, index);
}

const entryOf = (element) => [...open].find((entry) => entry.wrap.contains(element));

/** A billentyűzet a nyitott listákon (és a nyitható gombokon). */
function onKeydown(event) {
  const { key } = event;
  if (key === 'Escape') {
    const entry = entryOf(document.activeElement);
    if (open.size === 0) return;
    closeAll();
    if (entry) entry.trigger.focus();
    return;
  }

  const entry = entryOf(event.target);
  if (!entry) {
    // Csukott lista gombja: ↓/↑ nyit (a kattintás útját járja, hogy a nyitás
    // előtti előkészítés — pl. a tiltott opciók — is lefusson)
    const trigger = event.target.closest?.('[aria-haspopup="listbox"]');
    const known =
      trigger && specs.some((spec) => spec.root.contains(trigger) && trigger.matches(spec.trigger));
    if (known && (key === 'ArrowDown' || key === 'ArrowUp')) {
      event.preventDefault();
      trigger.click();
      const opened = entryOf(trigger);
      if (opened) focusSelected(opened.menu);
    }
    return;
  }
  if (entry.menu.getAttribute('role') !== 'listbox') return;

  const options = enabledOptions(entry.menu);
  const current = options.indexOf(document.activeElement);
  const moves = {
    ArrowDown: current + 1,
    ArrowUp: current === -1 ? options.length - 1 : current - 1,
    Home: 0,
    End: options.length - 1,
  };
  if (key in moves) {
    event.preventDefault();
    focusOption(entry.menu, moves[key]);
  } else if (key.length === 1 && key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    typeahead(entry.menu, key);
  }
}

/** Kattintás minden nyitott lenyílón kívülre → zárás. */
function onPointerdown(event) {
  [...open].forEach((entry) => {
    if (!entry.wrap.contains(event.target)) close(entry);
  });
}

/** A bekötött lenyíló-fajták: { root, trigger } — a ↓/↑ nyitáshoz ebből tudni,
    hogy a fókuszban lévő gomb a mienk-e. */
const specs = [];
let installed = false;

/**
 * Egy lenyíló-fajta bekötése a gyökér alatt, delegálva.
 *
 * @param {Element} root      a gyakorlat-lista (a sorok jöhetnek-mehetnek alatta)
 * @param {object}  spec
 * @param {string}  spec.trigger   a nyitó gomb szelektora
 * @param {string}  spec.menu      a lenyíló szelektora — a gomb szülőjén belül
 * @param {string}  [spec.option]  az opció szelektora (a plusz súly menüjében nincs)
 * @param {(trigger: Element, menu: Element) => void} [spec.onOpen]
 *        nyitás ELŐTT fut (pl. az aktuálisan érvénytelen opciók tiltása)
 * @param {(option: Element) => void} [spec.onChoose]
 *        a választás — a lenyíló ekkor már zárva van
 * @param {(trigger: Element, menu: Element) => void} [spec.afterOpen]
 *        nyitás UTÁN fut (pl. a fókusz a menü mezőjébe)
 */
export function bindPopupMenu(root, { trigger, menu, option, onOpen, onChoose, afterOpen }) {
  if (!installed) {
    document.addEventListener('pointerdown', onPointerdown);
    document.addEventListener('keydown', onKeydown);
    installed = true;
  }
  specs.push({ root, trigger });

  root.addEventListener('click', (event) => {
    const button = event.target.closest(trigger);
    if (button && root.contains(button)) {
      const wrap = button.parentElement;
      const list = $(menu, wrap);
      onOpen?.(button, list);
      const willOpen = list.hidden;
      closeAll();
      if (willOpen) {
        const entry = { trigger: button, menu: list, wrap };
        list.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        open.add(entry);
        afterOpen?.(button, list);
      }
      return;
    }

    if (!option) return;
    const chosen = event.target.closest(option);
    if (!chosen || !root.contains(chosen)) return;
    // A rejtett listában maradt fókusz a <body>-ra esne: vissza a gombra
    const owner = entryOf(chosen);
    const hadFocus = owner?.menu.contains(document.activeElement);
    closeAll();
    if (hadFocus) owner.trigger.focus();
    onChoose?.(chosen);
  });
}
