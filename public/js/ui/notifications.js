/** Értesítés-panel. */

import { api } from '../core/api.js';
import { $, prefersReducedMotion } from '../core/dom.js';
import { prefs } from '../core/prefs.js';
import { showToast } from '../core/toast.js';
import { relativeTime } from './chat.js';

/**
 * Értesítés-panel: az avatarra nyílik. A tartalma VALÓDI eseményekből jön
 * (GET /api/notifications), tehát magától is változik — a panel minden
 * megnyitásakor frisset kérünk.
 *
 * Az „olvasott" állapot egy LÁTOTT-IDŐPONT (prefs → notifSeenAt), nem egy
 * mindent elrejtő kapcsoló. Korábban a „mind olvasott" kiürítette a panelt,
 * és onnantól a valódi tartalom sem látszott volna benne. Most a sorok
 * maradnak, csak az újdonságot jelző pötty tűnik el róluk, és a jelvény
 * ennél frissebb eseményeket számol.
 */
async function setupNotifications() {
  const button = $('[data-action="notifications"]');
  const panel = $('[data-notif-panel]');
  const badge = $('[data-notif-badge]');
  const list = $('[data-list="notifications"]');
  const emptyState = $('.notif-empty', panel);

  /* A legutóbbi „mind olvasott" időpontja ISO-8601-ben. Üresen minden
     értesítés újnak számít — ez az első indulás helyes viselkedése. */
  let seenAt = prefs.get('notifSeenAt', '');
  let notifications = [];

  const isNew = (notif) => !seenAt || notif.at > seenAt;
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
     mondja ki, hogy „ne szóljon", nem azt, hogy „ne is lássam". A pötty
     viszont csak a látott-időpontnál frissebb sorokon marad. */
  const renderList = () => {
    list.replaceChildren();
    const mutedCats = prefs.get('notifCats', {});
    emptyState.hidden = notifications.length > 0;

    notifications.forEach((notif, index) => {
      const li = document.createElement('li');
      li.className = 'notif-item';
      if (mutedCats[notif.cat]) li.classList.add('notif-item--muted');
      if (!isNew(notif)) li.classList.add('notif-item--seen');
      li.style.setProperty('--i', index);

      const dot = document.createElement('span');
      dot.className = 'notif-dot';

      const body = document.createElement('div');
      const text = document.createElement('span');
      text.textContent = notif.text;
      const time = document.createElement('span');
      time.className = 'notif-time';
      // A szerver ISO-időbélyeget küld — a „mikor" a böngésző zónájában áll elő
      time.textContent = relativeTime(notif.at);
      body.append(text, time);

      li.append(dot, body);
      list.appendChild(li);
    });
  };

  const setOpen = async (open) => {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (!open) return;
    renderList();      // előbb a meglévő tartalom, hogy ne legyen üres pillanat
    await load();      // majd a friss lista
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
    if (!panel.hidden && !event.target.closest('[data-notif-panel], [data-action="notifications"]')) {
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
