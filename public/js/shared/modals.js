/** Közös modális vezérlő és a rá épülő kis ablakok. */

import { api } from './api.js';
import { $, $$, cloneTemplate, prefersReducedMotion } from './dom.js';
import { formatNumber } from './format.js';
import { showToast } from './toast.js';

/* ---- Modál-verem ----
   A nyitott modálok sorrendben (a legfelső a végén). Egymásra nyíló ablakoknál
   (megerősítés a beállítások fölött, szkenner → saját étel → étel-modál) az
   Escape és a Tab-csapda CSAK a legfelsőre hat, és a záró ablak csak akkor ad
   vissza fókuszt, ha alatta nincs nyitott. Korábban minden modál saját
   figyelőt tartott: az Escape egyszerre zárta mindet, a 190 ms-os hide() pedig
   a már nyitott új modál MÖGÉ rántotta a fókuszt. */
const modalStack = []; // [{ modal, close }]

const topEntry = () => modalStack[modalStack.length - 1] ?? null;

/** A modál-e a legfelső nyitott ablak (a szkenner saját Escape-figyelője ezt nézi). */
const isTopModal = (modal) => topEntry()?.modal === modal;

const removeFromStack = (modal) => {
  const index = modalStack.findIndex((entry) => entry.modal === modal);
  if (index !== -1) modalStack.splice(index, 1);
};

/* EGYETLEN közös figyelő a modulban: a legfelső modál Escape-je és
   fókusz-csapdája. */
document.addEventListener('keydown', (event) => {
  const top = topEntry();
  if (!top) return;

  if (event.key === 'Escape') {
    top.close();
    return;
  }

  // Fókusz-csapda: Tab-bal nem lehet a háttérbe lépni, amíg a modal nyitva van.
  // A [tabindex="0"] is kell: az étel-modál gramm-választója nem gomb, de
  // billentyűzettel kezelhető — enélkül a csapda átugraná.
  if (event.key === 'Tab') {
    const focusables = $$(
      'button, [href], input, select, textarea, [tabindex="0"]',
      top.modal,
    ).filter((el) => !el.disabled && !el.closest('[hidden]'));
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

/** Közös modal-vezérlő: backdrop/gomb zárás, Escape, fókusz-csapda,
    fókusz-visszaállítás, reduced-motion. A videó- és a beállítások
    modal is erre épül. A `close()` ígéretet ad, ami a tényleges elrejtéskor
    teljesül — egy következő modál ezt várja meg, nem egy képkockát. */
function createModalController(modal) {
  const CLOSE_ANIM_MS = 190;
  let lastFocused = null;
  let hideTimer = null;
  let closing = null; // a futó zárás ígérete (a kiúszó animáció alatt)
  let finishClosing = null;

  const open = () => {
    clearTimeout(hideTimer);
    finishClosing?.(); // egy félbehagyott zárás ígérete se maradjon függőben
    closing = null;
    finishClosing = null;
    lastFocused = document.activeElement;
    modal.classList.remove('is-closing');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    removeFromStack(modal);
    modalStack.push({ modal, close });
    $('button[data-close-modal]', modal).focus();
  };

  const hide = () => {
    modal.classList.remove('is-open', 'is-closing');
    modal.setAttribute('aria-hidden', 'true');
    removeFromStack(modal);
    /* Fókusz vissza — de nem egy nyitott modál MÖGÉ: ha alatta (vagy a kiúszás
       közben) másik modál nyitva van, csak akkor, ha a kiváltó elem abban van
       (pl. a beállítások törlés-gombja a megerősítés után). Egy közben nyílt
       új modál (átadás) így megtartja a fókuszt. */
    const top = topEntry();
    if (lastFocused && (!top || top.modal.contains(lastFocused))) lastFocused.focus();
    finishClosing?.();
    closing = null;
    finishClosing = null;
  };

  const close = () => {
    // A második feltétel teszi ismételhetővé: a kiúszó animáció alatt az
    // ablak még `is-open`, így egy közben érkező zárás (pl. gombnyomás ÉS
    // oldalváltás együtt) egy második, árva időzítőt indítana — ilyenkor a
    // futó zárás ígéretét adjuk vissza.
    if (closing) return closing;
    if (!modal.classList.contains('is-open')) return Promise.resolve();
    if (prefersReducedMotion) {
      hide();
      return Promise.resolve();
    }
    closing = new Promise((resolve) => {
      finishClosing = resolve;
    });
    modal.classList.add('is-closing'); // a kiúszó animáció alatt még látszik
    hideTimer = setTimeout(hide, CLOSE_ANIM_MS);
    return closing;
  };

  $$('[data-close-modal]', modal).forEach((el) => el.addEventListener('click', close));

  /* Oldalváltás (a telefon vissza gombja, a nav gyűrű, egy gyorsbillentyű)
     zárja az ablakot. Enélkül a modal az ÚJ oldal fölött maradt nyitva —
     a felhasználó egy másik képernyőn találta magát egy odanem illő
     ablakkal. Az értesítés-panel ugyanezt csinálja már. */
  window.addEventListener('hashchange', close);

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

  /** A megjelenített javaslat ujjlenyomata — az elfogadás ezt küldi vissza. */
  let shownToken = null;

  const render = (advice) => {
    shownToken = advice.token ?? null;
    lead.textContent = advice.name
      ? `A(z) „${advice.name}" mai naplójában ${advice.items.length} gyakorlatot érdemes visszavenni:`
      : `${advice.items.length} gyakorlatot érdemes ma visszavenni:`;

    list.replaceChildren();
    advice.items.forEach((item) => {
      const el = cloneTemplate('tpl-advice-item');
      if (item.action !== 'reduce') el.classList.add('ad-item--drop');
      $('.ad-item-action', el).textContent = ACTION_LABELS[item.action] ?? item.action;
      $('.ad-item-name', el).textContent =
        item.action === 'reduce' ? `${item.name} — −${item.percent}%` : item.name;
      $('.ad-item-detail', el).textContent = `${item.detail} · ${item.reason}`;
      list.appendChild(el);
    });
  };

  $('[data-advice-decline]', modal).addEventListener('click', () => controller.close());

  $('[data-advice-accept]', modal).addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { applied, template } = await api.applySessionAdvice(shownToken);
      // A szerver a piszkozatot írta át — a képernyőn lévő napló elavult.
      workout?.replaceFromServer(template);
      showToast(
        applied === 1
          ? 'A mai naplód egy gyakorlaton módosult'
          : `A mai naplód ${applied} gyakorlaton módosult`,
      );
      controller.close();
    } catch (err) {
      console.error('A javaslat alkalmazása nem sikerült:', err);
      showToast(err.message || 'A javaslat alkalmazása nem sikerült', 'error');
      /* 409: a javaslat elavult (a napló változott, vagy már elfogadták) —
         nincs mit újra megpróbálni, a friss naplót viszont betöltjük. */
      if (err.status === 409) {
        if (err.detail?.template) workout?.replaceFromServer(err.detail.template);
        controller.close();
      }
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
  $$('[data-close-modal]', modal).forEach((el) =>
    el.addEventListener('click', () => settle(false)),
  );
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
    kattintva nyílik, és legújabb elöl mutatja az adott gyakorlat összes
    korábbi rekordját (ahogy a /api/prs/history adja), hogy a fejlődés a
    legfrissebb eredménytől visszafelé követhető legyen. */
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
            detailText += ` • 1RM: ${formatNumber(entry.oneRM)} kg`;
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

export {
  createModalController,
  isTopModal,
  setupAdviceModal,
  setupConfirmDialog,
  setupPrModal,
  setupVideoModal,
};
