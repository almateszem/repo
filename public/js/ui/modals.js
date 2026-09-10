/** Közös modális vezérlő és a rá épülő kis ablakok. */

import { api } from '../core/api.js';
import { $, $$, cloneTemplate, prefersReducedMotion } from '../core/dom.js';
import { showToast } from '../core/toast.js';

/** Közös modal-vezérlő: backdrop/gomb zárás, Escape, fókusz-csapda,
    fókusz-visszaállítás, reduced-motion. A videó- és a beállítások
    modal is erre épül. */
function createModalController(modal) {
  const CLOSE_ANIM_MS = 190;
  let lastFocused = null;
  let hideTimer = null;

  const open = () => {
    clearTimeout(hideTimer);
    lastFocused = document.activeElement;
    modal.classList.remove('is-closing');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    $('button[data-close-modal]', modal).focus();
  };

  const hide = () => {
    modal.classList.remove('is-open', 'is-closing');
    modal.setAttribute('aria-hidden', 'true');
    if (lastFocused) lastFocused.focus();
  };

  const close = () => {
    // A második feltétel teszi ismételhetővé: a kiúszó animáció alatt az
    // ablak még `is-open`, így egy közben érkező zárás (pl. gombnyomás ÉS
    // oldalváltás együtt) egy második, árva időzítőt indítana.
    if (!modal.classList.contains('is-open') || modal.classList.contains('is-closing')) return;
    if (prefersReducedMotion) {
      hide();
      return;
    }
    modal.classList.add('is-closing'); // a kiúszó animáció alatt még látszik
    hideTimer = setTimeout(hide, CLOSE_ANIM_MS);
  };

  $$('[data-close-modal]', modal).forEach((el) => el.addEventListener('click', close));

  /* Oldalváltás (a telefon vissza gombja, a nav gyűrű, egy gyorsbillentyű)
     zárja az ablakot. Enélkül a modal az ÚJ oldal fölött maradt nyitva —
     a felhasználó egy másik képernyőn találta magát egy odanem illő
     ablakkal. Az értesítés-panel ugyanezt csinálja már. */
  window.addEventListener('hashchange', close);

  document.addEventListener('keydown', (event) => {
    if (!modal.classList.contains('is-open')) return;

    if (event.key === 'Escape') {
      close();
      return;
    }

    // Fókusz-csapda: Tab-bal nem lehet a háttérbe lépni, amíg a modal nyitva van.
    // A [tabindex="0"] is kell: az étel-modál gramm-választója nem gomb, de
    // billentyűzettel kezelhető — enélkül a csapda átugraná.
    if (event.key === 'Tab') {
      const focusables = $$('button, [href], input, select, textarea, [tabindex="0"]', modal)
        .filter((el) => !el.disabled && !el.closest('[hidden]'));
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  return { open, close };
}

/**
 * Megerősítő ablak adatvesztéssel járó műveletekhez. A natív
 * `window.confirm()` helyett: az app design-nyelvén szólal meg, és a
 * fókuszkezelése a többi modáléval azonos (fókusz-csapda, Escape,
 * visszaadott fókusz). Promise<boolean>-t ad — a hívó `await`-tel használja.
 *
 * A fókusz szándékosan a „Mégse" gombra kerül: a megerősítendő művelet
 * visszafordíthatatlan, a véletlen Enter ne hajtsa végre.
 */
function setupAdviceModal() {
  const modal = $('#adviceModal');
  const controller = createModalController(modal);
  const lead = $('#adviceModalText');
  const list = $('[data-advice-list]', modal);

  // Az edzésnapló vezérlője később épül fel — utólag kapcsoljuk be.
  let workout = null;

  /** A művelet emberi neve. A „kihagyás" és a „leállás" nem ugyanaz:
      az utóbbinál már van teljesített szett, azt nem tesszük meg nem
      történtté — csak a hátralévő rész marad el. */
  const ACTION_LABELS = {
    reduce: 'Levesz',
    skip: 'Kihagy',
    stop: 'Leáll',
  };

  const render = (advice) => {
    lead.textContent = advice.name
      ? `A(z) „${advice.name}" mai naplójában ${advice.items.length} gyakorlatot érdemes visszavenni:`
      : `${advice.items.length} gyakorlatot érdemes ma visszavenni:`;

    list.replaceChildren();
    advice.items.forEach((item) => {
      const el = cloneTemplate('tpl-advice-item');
      if (item.action !== 'reduce') el.classList.add('ad-item--drop');
      $('.ad-item-action', el).textContent = ACTION_LABELS[item.action] ?? item.action;
      $('.ad-item-name', el).textContent = item.action === 'reduce'
        ? `${item.name} — −${item.percent}%`
        : item.name;
      $('.ad-item-detail', el).textContent = `${item.detail} · ${item.reason}`;
      list.appendChild(el);
    });
  };

  $('[data-advice-decline]', modal).addEventListener('click', () => controller.close());

  $('[data-advice-accept]', modal).addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { applied } = await api.applySessionAdvice();
      // A szerver a piszkozatot írta át — a képernyőn lévő napló elavult.
      await workout?.reloadFromServer();
      showToast(applied === 1
        ? 'A mai naplód egy gyakorlaton módosult'
        : `A mai naplód ${applied} gyakorlaton módosult`);
      controller.close();
    } catch (err) {
      console.error('A javaslat alkalmazása nem sikerült:', err);
      showToast(err.message || 'A javaslat alkalmazása nem sikerült', 'error');
    } finally {
      button.disabled = false;
    }
  });

  return {
    /** Lekéri a javaslatot, és CSAK akkor nyit ablakot, ha van mit mondani.
        Hiba esetén csendben nem történik semmi: a check-in mentése sikerült,
        azt nem szabad egy másodlagos lekérés hibájával elrontani. */
    async maybeShow() {
      try {
        const advice = await api.getSessionAdvice();
        if (!advice?.items?.length) return;
        render(advice);
        controller.open();
      } catch (err) {
        console.error('A készenlét-javaslat lekérése nem sikerült:', err);
      }
    },

    /** Az edzésnapló vezérlőjének utólagos bekötése (az init hívja). */
    attachWorkout(controllerRef) {
      workout = controllerRef;
    },
  };
}

function setupConfirmDialog() {
  const modal = $('#confirmModal');
  const controller = createModalController(modal);
  const titleEl = $('#confirmModalTitle');
  const textEl = $('#confirmModalText');
  const okBtn = $('[data-confirm-ok]', modal);
  const cancelBtn = $('[data-confirm-cancel]', modal);

  let resolve = null;
  /** Egyszer lezáró elsütés — a nyitva maradt ígéret hamissal zárul. */
  const settle = (value) => {
    const pending = resolve;
    resolve = null;
    controller.close();
    pending?.(value);
  };

  okBtn.addEventListener('click', () => settle(true));
  cancelBtn.addEventListener('click', () => settle(false));
  // Bezárás (✕, backdrop) és Escape = elutasítás. A createModalController
  // ezekre már zárja az ablakot; itt csak az ígéretet kell lezárni.
  $$('[data-close-modal]', modal).forEach((el) => el.addEventListener('click', () => settle(false)));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-open')) settle(false);
  });
  /* Oldalváltás = elutasítás. A createModalController az ablakot már zárja,
     de az ígéretet itt kell lezárni: enélkül az `await confirmAction(...)`
     hívó (gyakorlat eltávolítása, terv betöltése) örökre függve maradna. */
  window.addEventListener('hashchange', () => settle(false));

  return (message, { title = 'Biztosan folytatod?', confirmLabel = 'Folytatás' } = {}) =>
    new Promise((res) => {
      settle(false); // egyszerre csak egy kérdés áll fenn
      resolve = res;
      titleEl.textContent = title;
      textEl.textContent = message;
      okBtn.textContent = confirmLabel;
      controller.open();
      cancelBtn.focus();
    });
}

function setupVideoModal() {
  const modal = $('#videoModal');
  const exerciseLabel = $('.video-modal-exercise', modal);
  const controller = createModalController(modal);

  return {
    open(exerciseName) {
      exerciseLabel.textContent = exerciseName;
      controller.open();
    },
  };
}

/** Gyakorlat rekord-előzmény modál — a "Korábbi rekordok" listaelemre
    kattintva nyílik, és időrendben (régitől az újig) mutatja az adott
    gyakorlat összes korábbi rekordját, hogy a fejlődés követhető legyen. */
function setupPrModal() {
  const modal = $('#prModal');
  const exerciseLabel = $('.pr-modal-exercise', modal);
  const historyList = $('[data-pr-history]', modal);
  const controller = createModalController(modal);

  return {
    async open(exerciseName) {
      exerciseLabel.textContent = exerciseName;
      historyList.replaceChildren();
      controller.open();

      try {
        const history = await api.getPrHistory(exerciseName);
        historyList.replaceChildren();
        history.forEach((entry, index) => {
          const item = cloneTemplate('tpl-pr-history-item');
          item.style.setProperty('--i', index);
          let detailText = entry.detail;
          if (entry.oneRM !== null && entry.oneRM > 0) {
            detailText += ` • 1RM: ${entry.oneRM.toFixed(1)} kg`;
          }
          $('.wk-pr-detail', item).textContent = detailText;
          $('.wk-pr-date', item).textContent = entry.date;
          historyList.appendChild(item);
        });
      } catch (err) {
        console.error(err);
      }
    },
  };
}

export { createModalController, setupAdviceModal, setupConfirmDialog, setupPrModal, setupVideoModal };
