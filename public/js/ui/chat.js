/** Közös chat-vezérlő az edző–sportoló üzenetváltáshoz. */

import { api } from '../core/api.js';
import { $ } from '../core/dom.js';
import { showToast } from '../core/toast.js';
import { createCoachNote } from '../render/coach.js';

/** Relatív idő az üzenet ISO-8601 időbélyegéből. Az üzenetek percre pontos
    ideje nem érdekes, a „mikor" viszont igen — a hét fölött ezért dátumra
    vált. (A szerver UTC-t küld, a Date a böngésző zónájában értelmezi.) */
function relativeTime(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const minutes = Math.round((Date.now() - at.getTime()) / 60000);
  if (minutes < 1) return 'most';
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'tegnap';
  if (days < 7) return `${days} napja`;
  return at.toLocaleDateString('hu-HU');
}

/** Egy üzenet buborékja a szerver által küldött alakból. A `mine` dönti el,
    hogy saját (jobbra igazított) üzenet-e — a szerver a NÉZŐ szemszögéből
    küldi, tehát ugyanaz a sor az edzőnél és a sportolónál más oldalra kerül.

    A `read` is a néző szemszöge: a SAJÁT üzenetnél azt jelenti, hogy a másik
    fél elolvasta (ezt írjuk ki a meta végére), a beérkezőnél azt, hogy én már
    láttam — az olvasatlan beérkező kapja a kiemelést. */
function messageNote(message) {
  const readMark = message.mine && message.read ? ' · olvasva' : '';
  const note = createCoachNote({
    meta: `${message.mine ? 'Te' : message.author} · ${relativeTime(message.at)}${readMark}`,
    text: message.text,
    me: message.mine,
  });
  if (!message.mine && !message.read) note.classList.add('co-note--unread');
  return note;
}

/** Az olvasatlan blokk elé kerülő elválasztó. Nélküle egy hosszabb szálban
    nem látszik, honnan újdonság a tartalom. */
function unreadDivider(count) {
  const divider = document.createElement('p');
  divider.className = 'co-msg-divider';
  divider.textContent = count === 1 ? 'Új üzenet' : `${count} új üzenet`;
  return divider;
}

/** Az üzenet-szál halk frissítése: ennyi időnként kérjük le újra a LÁTHATÓ
    beszélgetést, hogy a másik fél üzenete magától megjelenjen. */
const COACH_POLL_MS = 20_000;

/** Üres/hibás szál helyén álló magyarázó sor. */
function feedNotice(text) {
  const p = document.createElement('p');
  p.className = 'co-msg-empty';
  p.textContent = text;
  return p;
}

/**
 * Üzenet-szál vezérlő. VALÓDI backend áll mögötte: a küldött üzenet a másik
 * fél fiókjába kerül, és a szál mindkét oldalról ugyanaz (a kapcsolat
 * azonosítója köti össze). Ugyanez szolgálja ki a kliens nézet edző-chatjét
 * és a sportoló-modál chatjét — a különbség csak a getLinkId().
 *
 * A késve érkező válaszra figyelni kell: mire a kérés visszaér, a felhasználó
 * már másik beszélgetést nézhet. Ezért minden válasznál újra megkérdezzük,
 * ugyanaz-e még az aktív kapcsolat.
 *
 * @param {Function} options.isVisible  látszik-e ÉPP a hírfolyam. Kettőt dönt
 *        el: kérdezzük-e a szervert a halk frissítéskor, és nyugtázhatjuk-e
 *        olvasottként a beérkezett üzeneteket. Rejtett szálat nem jelölünk
 *        olvasottnak — az „olvasva" különben azt hazudná a másik félnek, hogy
 *        látták az üzenetét.
 * @param {Function} options.onRead  olvasás-nyugtázás után fut (a jelvények
 *        frissítéséhez). Nem kötelező.
 */
function createChatController({ feed, form, input, getLinkId, isVisible = () => true, onRead }) {
  const scrollFeedToEnd = () => { feed.scrollTop = feed.scrollHeight; };

  /* A legutóbb kirajzolt szál ujjlenyomata: az üzenet-azonosítók ÉS az
     olvasottság. Ha a frissítés ugyanazt hozza, NEM rajzolunk újra — a
     replaceChildren különben minden körben az aljára ugrasztaná a
     hírfolyamot, miközben a felhasználó épp a korábbi üzeneteket olvassa.
     Az olvasottság is része, különben az „olvasva" jelölés csak a következő
     ÚJ üzenetnél jelenne meg. */
  let lastSignature = null;
  const signatureOf = (messages) => messages
    .map((message) => `${message.id}${message.read ? 'r' : ''}`).join(',');

  const render = (messages) => {
    const signature = signatureOf(messages);
    if (signature === lastSignature) return;
    lastSignature = signature;

    feed.replaceChildren();
    if (messages.length === 0) {
      feed.appendChild(feedNotice('Még nincs üzenet — írj elsőként.'));
      return;
    }
    // Az elválasztó a legelső olvasatlan BEÉRKEZŐ üzenet elé kerül
    const unread = messages.filter((message) => !message.mine && !message.read);
    const firstUnreadId = unread[0]?.id ?? null;
    messages.forEach((message) => {
      if (message.id === firstUnreadId) feed.appendChild(unreadDivider(unread.length));
      feed.appendChild(messageNote(message));
    });
    scrollFeedToEnd();
  };

  /** Beszélgetés-váltáskor a hívó ezzel jelzi, hogy a következő töltés
      MINDENKÉPP rajzoljon (a másik szál tartalma nem maradhat a képernyőn). */
  const reset = () => {
    lastSignature = null;
    feed.replaceChildren(); // amíg a friss szál megjön, ne a másiké álljon itt
  };

  /** A szál lekérése és kirajzolása. Szándékosan nincs „Betöltés…" jelző: a
      korábbi tartalom marad a képernyőn, amíg a friss meg nem érkezik — így
      a 20 másodpercenkénti frissítés sem villog.

      A kirajzolás UTÁN nyugtázzuk az olvasást: a felhasználó ekkor már látja
      az elválasztót és a kiemelt buborékokat, tehát a jelölés igaz. */
  async function load() {
    const linkId = getLinkId();
    if (!linkId) return;
    try {
      const thread = await api.getMessages(linkId);
      if (getLinkId() !== linkId) return; // időközben másik beszélgetés lett aktív
      render(thread.messages);
      if (thread.unread > 0 && isVisible()) await acknowledge(linkId);
    } catch (err) {
      console.error('Üzenetek betöltési hiba:', err);
      if (getLinkId() !== linkId) return;
      lastSignature = null; // a következő sikeres töltés újra kirajzolja a szálat
      feed.replaceChildren(feedNotice('Az üzenetek most nem tölthetők be.'));
    }
  }

  /* Az olvasás-nyugtázás némán bukik: a szál kirajzolva már ott van, a
     következő kör újrapróbálja. Hibaüzenettel zavarni a felhasználót olyasmi
     miatt, amit nem is kért, csak elterelés lenne. */
  async function acknowledge(linkId) {
    try {
      const { read } = await api.markMessagesRead(linkId);
      if (read > 0) await onRead?.();
    } catch (err) {
      console.error('Az üzenetek nyugtázása nem sikerült:', err);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const linkId = getLinkId();
    const text = input.value.trim();
    if (!linkId || !text) return;

    try {
      const message = await api.sendMessage(linkId, text);
      form.reset();
      if (getLinkId() !== linkId) return;
      $('.co-msg-empty', feed)?.remove();
      feed.appendChild(messageNote(message));
      /* Az ujjlenyomatot is vezetjük: enélkül a következő halk frissítés
         „változásnak" látná a saját, már kint lévő üzenetünket, és a teljes
         újrarajzolással a hírfolyam aljára rántaná az olvasót. */
      if (lastSignature !== null) {
        lastSignature = [lastSignature, String(message.id)].filter(Boolean).join(',');
      }
      scrollFeedToEnd();
    } catch (err) {
      showToast(err.message || 'Az üzenetet nem sikerült elküldeni', 'error');
    }
    input.focus();
  });

  /* Halk frissítés: amíg a hírfolyam látszik, időnként lekérjük a szálat —
     így a másik fél üzenete magától megjelenik, websocket nélkül. Rejtett
     fülön/nézetben nem kérdezünk (ott úgysem látszana), és a hiba némán
     elhal: a következő kör újrapróbálja. */
  setInterval(() => {
    if (document.hidden || !isVisible()) return;
    load();
  }, COACH_POLL_MS);

  return { load, reset };
}

export { createChatController, relativeTime };
