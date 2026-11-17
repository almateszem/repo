/** Értesítés-panel. */

import { api } from '../shared/api.js';
import { $, prefersReducedMotion } from '../shared/dom.js';
import { prefs } from '../shared/prefs.js';
import { showToast } from '../shared/toast.js';
import { relativeTime } from '../shared/format.js';

/**
 * Értesítés-panel: az avatarra nyílik. A tartalma VALÓDI eseményekből jön
 * (GET /api/notifications), tehát magától is változik — a panel minden
 * megnyitásakor frisset kérünk.
 *
 * Az „olvasott" állapot IDŐPONT-alapú, nem egy mindent elrejtő kapcsoló:
 *   · „Összes olvasott" → a látott-időpont (prefs → notifSeenAt) a
 *     legfrissebb sorra áll, és ami nem frissebb nála, az lekerül a panelről;
 *   · egy sorra kattintva csak az az egy (prefs → notifSeenIds: id → at).
 * Mindkettő az esemény IDŐPONTJÁT jegyzi, nem a sort: ha ugyanabban a
 * szálban új üzenet jön (frissebb `at`), a sor újra megjelenik.
 *
 * A sorra kattintás a forráshoz visz (a szerver adja a `target`-et, az
 * `onOpen` hajtja végre — app/init.js).
 */
async function setupNotifications({ onOpen } = {}) {
  const button = $('[data-action="notifications"]');
  const panel = $('[data-notif-panel]');
  const badge = $('[data-notif-badge]');
  const list = $('[data-list="notifications"]');
  const emptyState = $('.notif-empty', panel);

  /* A legutóbbi „mind olvasott" időpontja ISO-8601-ben. Üresen minden
     értesítés újnak számít — ez az első indulás helyes viselkedése. */
  let seenAt = prefs.get('notifSeenAt', '');
  // Egyenként (kattintással) olvasottnak jelölt sorok: id → az esemény ideje
  let seenIds = prefs.get('notifSeenIds', {});
  let notifications = [];

  const isNew = (notif) =>
    (!seenAt || notif.at > seenAt) && !(seenIds[notif.id] && seenIds[notif.id] >= notif.at);

  /** A már nem létező sorok kiesnek a mapből, hogy ne nőjön a végtelenségig. */
  const pruneSeenIds = () => {
    const live = new Set(notifications.map((notif) => notif.id));
    const kept = Object.fromEntries(Object.entries(seenIds).filter(([id]) => live.has(id)));
    if (Object.keys(kept).length !== Object.keys(seenIds).length) {
      seenIds = kept;
      prefs.set('notifSeenIds', seenIds);
    }
  };
  const visible = () => {
    const mutedCats = prefs.get('notifCats', {}); // a beállítások modal kapcsolói
    return notifications.filter((notif) => !mutedCats[notif.cat]);
  };

  /** Friss lekérés. A hiba némán elhal: a panel a korábbi tartalmat mutatja,
      és a következő megnyitás újrapróbálja — egy pillanatnyi hálózati hiba
      miatt nem villoghat üresre a lista. */
  async function load() {
    try {
      notifications = await api.getNotifications();
      pruneSeenIds();
    } catch (err) {
      console.error('Értesítések betöltési hiba:', err);
    }
  }

  const updateBadge = (pop = false) => {
    // A némított kategóriák nem számítanak bele az "új" darabszámba
    const count = visible().filter(isNew).length;
    badge.hidden = count === 0;
    badge.textContent = String(count);
    badge.setAttribute('aria-label', `${count} új értesítés`);
    if (pop && !prefersReducedMotion) {
      badge.classList.remove('is-pop');
      void badge.offsetWidth; // szándékos reflow: az animáció újraindításához
      badge.classList.add('is-pop');
    }
  };

  /* A némított kategória sorai bent maradnak, csak halványan: a kapcsoló azt
     mondja ki, hogy „ne szóljon", nem azt, hogy „ne is lássam". Az olvasott
     sor viszont lekerül. */
  const renderList = () => {
    list.replaceChildren();
    const mutedCats = prefs.get('notifCats', {});
    const unseen = notifications.filter(isNew);
    emptyState.hidden = unseen.length > 0;

    unseen.forEach((notif, index) => {
      const li = document.createElement('li');
      li.className = 'notif-item';
      if (mutedCats[notif.cat]) li.classList.add('notif-item--muted');
      li.style.setProperty('--i', index);

      /* Az egész sor egy gomb: billentyűzettel is elérhető, és a kattintás a
         forráshoz visz. Cél nélküli sornál (régi szerver) is olvasottá tesz. */
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'notif-link';
      link.addEventListener('click', () => openNotification(notif));

      const dot = document.createElement('span');
      dot.className = 'notif-dot';

      // span, nem div: gombban csak „phrasing" tartalom állhat (flex-elemként blokk lesz)
      const body = document.createElement('span');
      const text = document.createElement('span');
      text.textContent = notif.text;
      const time = document.createElement('span');
      time.className = 'notif-time';
      // A szerver ISO-időbélyeget küld — a „mikor" a böngésző zónájában áll elő
      time.textContent = relativeTime(notif.at);
      body.append(text, time);

      link.append(dot, body);
      li.append(link);
      list.appendChild(li);
    });
  };

  /** Egy sor megnyitása: olvasottnak jelöljük, a panel bezárul, és a cél
      oldal nyílik. A zárás előbb jön, hogy a fókusz ne egy eltűnő sorban
      ragadjon. */
  function openNotification(notif) {
    seenIds = { ...seenIds, [notif.id]: notif.at };
    prefs.set('notifSeenIds', seenIds);
    updateBadge();
    setOpen(false);
    if (notif.target) onOpen?.(notif.target);
  }

  const setOpen = async (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    renderList(); // előbb a meglévő tartalom, hogy ne legyen üres pillanat
    await load(); // majd a friss lista
    if (panel.hidden) return; // időközben becsukták
    renderList();
    updateBadge();
  };

  button.addEventListener('click', () => setOpen(panel.hidden));

  /* „Mind olvasott": a látott-időpontot a LEGFRISSEBB értesítésre állítjuk,
     nem a mostani órára. Így egy időközben (a panel nyitva léte alatt)
     beérkező, még le nem kért esemény sem tűnik el olvasottként. */
  $('[data-action="clear-notifications"]').addEventListener('click', () => {
    const newest = notifications[0]?.at;
    if (!newest) return;
    seenAt = newest;
    prefs.set('notifSeenAt', seenAt);
    renderList();
    updateBadge();
    showToast('Minden értesítés olvasottnak jelölve');
  });

  // Kattintás a panelen kívülre / Escape / oldalváltás → zárás
  document.addEventListener('pointerdown', (event) => {
    if (
      !panel.hidden &&
      !event.target.closest('[data-notif-panel], [data-action="notifications"]')
    ) {
      setOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      button.focus();
    }
  });
  window.addEventListener('hashchange', () => setOpen(false));

  await load();
  updateBadge(true); // betöltéskor egy finom "pop" hívja fel a figyelmet a badge-re

  return { updateBadge };
}

export { setupNotifications };
