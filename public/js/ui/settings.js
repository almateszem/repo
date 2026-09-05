/** Beállítások ablak. */

import { api } from '../core/api.js';
import { NOTIF_CATEGORIES } from '../core/constants.js';
import { $, $$, cloneTemplate } from '../core/dom.js';
import { prefs } from '../core/prefs.js';
import { showToast } from '../core/toast.js';
import { createModalController } from './modals.js';

/** Beállítások modal: profilnév, értesítés-kapcsolók, edzés-cél, adat-export.
    A név és az értesítés-kapcsolók a prefs-be (localStorage) mentődnek; az
    edzés-cél viszont a FIÓKÉ (szerver), mert az edződ is azt látja a
    kártyádon. Az onNotifCatsChange az értesítés-jelvényt frissíti élőben,
    ha egy kapcsoló átbillen.

    A korábbi szerepkör-kapcsolók („Van edződ" / „Edzel másokat") innen
    kikerültek: a szerepkör már nem demo-kapcsoló, hanem valódi kapcsolatból
    következik — az Edző oldalon lehet meghívni és elfogadni. */
async function setupSettingsModal({ onNotifCatsChange, confirmAction } = {}) {
  const modal = $('#settingsModal');
  const controller = createModalController(modal);
  const nameInput = $('#st-display-name');
  const usernameEl = $('.db-username');
  const toggleList = $('[data-list="settings-toggles"]');
  const goalSelect = $('#st-goal');

  // A fiók adatai (név-tartalék, aktuális edzés-cél) — egyszer lekérve
  const user = await api.getUser();
  // A név kiírását a renderUserName végzi — ez a modal csak szerkeszti

  // Kapcsoló-sorok a kategóriákból (template-klónozással)
  NOTIF_CATEGORIES.forEach(({ key, label }) => {
    const row = cloneTemplate('tpl-setting-toggle');
    $('.st-toggle-label', row).textContent = label;
    const toggle = $('.st-switch', row);
    toggle.dataset.cat = key;
    toggle.setAttribute('aria-label', `${label} értesítések`);
    toggleList.appendChild(row);
  });

  const syncToggles = () => {
    const mutedCats = prefs.get('notifCats', {});
    $$('.st-switch', toggleList).forEach((toggle) => {
      const isOn = !mutedCats[toggle.dataset.cat];
      toggle.setAttribute('aria-checked', String(isOn));
      toggle.closest('.st-toggle').classList.toggle('is-off', !isOn);
    });
  };

  // A kapcsolók azonnal érvényesülnek (prefs + értesítés-panel és -jelvény)
  toggleList.addEventListener('click', (event) => {
    const toggle = event.target.closest('.st-switch');
    if (!toggle) return;
    const mutedCats = { ...prefs.get('notifCats', {}) };
    if (mutedCats[toggle.dataset.cat]) delete mutedCats[toggle.dataset.cat];
    else mutedCats[toggle.dataset.cat] = true;
    prefs.set('notifCats', mutedCats);
    syncToggles();
    onNotifCatsChange?.();
  });

  /* Edzés-cél: a lista a szerverről jön (data.js → goals), hogy a címke és a
     felirat egy helyen éljen. Az üres érték a „nincs megadva" — ilyenkor az
     edzői kártyán „—" áll, nem egy kitalált cél. */
  const goals = await api.getGoals();
  goalSelect.replaceChildren(new Option('Nincs megadva', ''));
  goals.forEach(({ key, tag, label }) => {
    goalSelect.appendChild(new Option(`${label} · ${tag}`, key));
  });
  goalSelect.value = user.goal ?? '';

  // Azonnal mentődik (mint a többi beállítás). Hibánál visszaáll a mentett
  // értékre, hogy a legördülő ne mutasson mást, mint ami a szerveren van.
  goalSelect.addEventListener('change', async () => {
    try {
      const updated = await api.saveGoal(goalSelect.value);
      user.goal = updated.goal;
      await api.refreshUser();
      showToast('Edzés-cél mentve');
    } catch (err) {
      goalSelect.value = user.goal ?? '';
      showToast(err.message || 'Az edzés-célt nem sikerült menteni', 'error');
    }
  });

  // Adat-export: a teljes adat-pillanatkép letöltése JSON-ként + toast (demo)
  $('[data-action="export-data"]').addEventListener('click', async () => {
    try {
      const snapshot = await api.exportAll();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'fittrack-pro-demo.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch { /* ha a letöltés nem elérhető, a toast akkor is jelez */ }
    showToast('Adatok exportálva · demo');
  });

  /* A név — a kapcsolókhoz hasonlóan — azonnal érvényesül gépelés közben,
     így a „Mentés" gomb nem hazudik olyan műveletet, ami valójában már
     megtörtént (a kapcsolók eddig is azonnal hatottak). Kiürített mezőnél
     a szerver szerinti névre esünk vissza, nem a korábbi egyéni névre —
     korábban ez némán, visszajelzés nélkül maradt a régin. */
  const applyName = () => {
    const name = nameInput.value.trim();
    if (name) prefs.set('displayName', name);
    else prefs.set('displayName', undefined);
    usernameEl.textContent = name || user.name;
  };

  nameInput.addEventListener('input', applyName);
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') controller.close();
  });

  $('[data-action="save-settings"]').addEventListener('click', () => {
    applyName();
    controller.close();
  });

  /* Kijelentkezés. Utána TELJES újratöltés, nem csak képernyőváltás: a
     memóriában lévő cache-ek és a felépült oldalak az előző fiók adatait
     tartalmazzák, azokat nem szabad a következő belépésbe átvinni.
     MINDEN kilépő gomb: ez a modalban és a profiloldalon is ott van, a $
     (első találat) az egyiket némán kihagyta volna. */
  /* ---- Fiók-műveletek: jelszóváltoztatás és fióktörlés ----
     Mindkettő a JELENLEGI jelszót is kéri (a munkamenet önmagában nem elég),
     ezért nyílik hozzájuk külön űrlap. A hibát a szerver mondja meg, azt
     írjuk ki az űrlap alá — nem toastban, mert ott a mező mellett kell
     látszania, amihez tartozik. */
  const accountForms = {
    password: { form: $('[data-form="change-password"]', modal), error: $('[data-password-error]', modal) },
    delete: { form: $('[data-form="delete-account"]', modal), error: $('[data-delete-error]', modal) },
  };

  /** Egy fiók-űrlap nyitása/zárása. Nyitáskor a másik bezárul: a kettő
      egymás mellett csak összezavarná, melyik jelszó melyikhez tartozik. */
  const openAccountForm = (which, open) => {
    Object.entries(accountForms).forEach(([key, { form, error }]) => {
      const show = key === which && open;
      form.hidden = !show;
      if (!show) {
        form.reset();
        error.hidden = true;
      }
      const trigger = $(`[data-action="toggle-${key}"]`, modal);
      trigger.setAttribute('aria-expanded', String(show));
    });
    if (open) $('input', accountForms[which].form).focus();
  };

  /** Mindkét űrlap bezárása (a modál megnyitásakor és sikeres művelet után).
      Nem csak rendrakás: a begépelt jelszó nem maradhat ott a mezőben egy
      bezárt-újranyitott ablak után. */
  const closeAccountForms = () => openAccountForm(null, false);

  const showFormError = (target, message) => {
    target.textContent = message;
    target.hidden = !message;
  };

  $('[data-action="toggle-password"]', modal).addEventListener('click', () => {
    openAccountForm('password', accountForms.password.form.hidden);
  });
  $('[data-action="toggle-delete"]', modal).addEventListener('click', () => {
    openAccountForm('delete', accountForms.delete.form.hidden);
  });

  accountForms.password.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = $('#st-password-current').value;
    const next = $('#st-password-new').value;
    showFormError(accountForms.password.error, '');
    try {
      await api.changePassword(current, next);
      closeAccountForms();
      showToast('Jelszó megváltoztatva');
    } catch (err) {
      showFormError(accountForms.password.error, err.message || 'A jelszót nem sikerült megváltoztatni');
    }
  });

  accountForms.delete.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = $('#st-delete-password').value;
    showFormError(accountForms.delete.error, '');

    /* A jelszó megerősítésnek is számít, de a törlés visszafordíthatatlan —
       ezért kérdezünk rá külön is, ugyanazzal az ablakkal, amivel minden
       más adatvesztés előtt. */
    const confirmed = await confirmAction(
      'A fiókod és MINDEN adatod véglegesen törlődik. Ez nem vonható vissza.',
      { title: 'Fiók törlése', confirmLabel: 'Törlés' },
    );
    if (!confirmed) return;

    try {
      await api.deleteAccount(password);
      window.location.reload(); // a belépő képernyőre esünk vissza
    } catch (err) {
      showFormError(accountForms.delete.error, err.message || 'A fiókot nem sikerült törölni');
    }
  });

  $$('[data-action="logout"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.logout();
      } catch (err) {
        console.error('Kijelentkezési hiba:', err);
      }
      window.location.reload();
    });
  });

  return {
    open() {
      nameInput.value = prefs.get('displayName', '') || '';
      nameInput.placeholder = user.name;
      $('[data-st-account]').textContent = `Bejelentkezve: ${user.username ?? user.name}`;
      closeAccountForms();
      syncToggles();
      // Az edzés-cél a szerveren él: a modál megnyitásakor a legutóbb
      // mentett értékre állunk vissza (a fiók adata a betöltéskor kelt).
      goalSelect.value = user.goal ?? '';
      controller.open();
    },
  };
}

export { setupSettingsModal };
