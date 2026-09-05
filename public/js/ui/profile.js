/** Profiloldal: adatok, összesítők, fiókműveletek. */

import { api } from '../core/api.js';
import { $, $$ } from '../core/dom.js';
import { animateNumber, formatNumber } from '../core/format.js';
import { hooks } from '../core/page-hooks.js';
import { prefs } from '../core/prefs.js';
import { showToast } from '../core/toast.js';
import { currentPage } from '../nav/router.js';
import { formatDelta } from './weight.js';

/** Egész számokhoz — a formatNumber egy tizedesig kerekít, ami a felpörgetés
    közben tört értékeket villantana fel a darabszámoknál. */
const formatWhole = (value) => String(Math.round(value));

async function setupProfile() {
  const page = $('[data-page="profile"]');
  const factList = $('.pf-fact-list', page);
  const emptyEl = $('[data-pf-empty]', page);

  /** Egy részletsor beállítása; érték nélkül a sor rejtve marad. */
  const setFact = (key, text) => {
    const row = $(`[data-pf-fact="${key}"]`, page);
    if (!row) return;
    row.hidden = text === null;
    if (text !== null) $(`[data-pf-value="${key}"]`, page).textContent = text;
  };

  /* ---- Erőfelmérés ----
     A friss fiók enélkül hetekig nem kap gyakorlat-ajánlást: a naplózott út
     három alkalmat kér (recovery.js → MIN_SESSIONS). A bemondott érték nem
     mérés — a felület ezt ki is mondja. */
  const assessList = $('[data-pf-assess-list]', page);
  const assessEmpty = $('[data-pf-assess-empty]', page);
  const assessForm = $('[data-form="strength-assessment"]', page);
  const assessExercise = $('#pf-assess-exercise');
  const assessWeight = $('#pf-assess-weight');
  const assessReps = $('#pf-assess-reps');
  const assessSave = $('.pf-assess-save', page);
  const assessOptions = $('#pf-assess-options');

  /* A gyakorlat-nevek a katalógusból: a szerver csak ismert nevet fogad el
     (kitalált névre az izomcsoportokat sem ismernénk, tehát ajánlani sem
     tudnánk belőle). A lista cache-elt, egyszer töltjük le. */
  let catalogLoaded = false;
  const loadCatalogOptions = async () => {
    if (catalogLoaded) return;
    try {
      const catalog = await api.getExerciseCatalog();
      assessOptions.replaceChildren(...catalog.map((item) => {
        const option = document.createElement('option');
        option.value = item.name;
        return option;
      }));
      catalogLoaded = true;
    } catch (err) {
      // A datalist csak kényelem — nélküle is be lehet gépelni a nevet.
      console.error('A gyakorlat-lista betöltése nem sikerült:', err);
    }
  };

  const renderAssessment = (entries) => {
    assessEmpty.hidden = entries.length > 0;
    assessList.replaceChildren(...entries.map((entry) => {
      const li = document.createElement('li');
      li.className = 'pf-assess-item';
      const name = document.createElement('b');
      name.textContent = entry.name;
      const value = document.createElement('span');
      value.textContent = `${formatNumber(entry.max1rm)} kg (becsült 1RM)`;
      li.append(name, value);
      return li;
    }));
  };

  assessForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    assessSave.disabled = true;
    try {
      const res = await api.saveStrengthAssessment([{
        exercise: assessExercise.value.trim(),
        weight: Number(assessWeight.value),
        reps: Number(assessReps.value),
      }]);
      assessForm.reset();
      renderAssessment(await api.getStrengthAssessment());
      // A készenléti riport azonnal változik: innentől van mit ajánlani.
      hooks.refreshRecovery?.().catch((err) => console.error('Regeneráció frissítési hiba:', err));
      showToast(res.entries[0].stored
        ? 'Felmérés mentve'
        : 'A naplózott csúcsod magasabb — az marad érvényben');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'A felmérést nem sikerült menteni', 'error');
    } finally {
      assessSave.disabled = false;
    }
  });

  hooks.refreshProfile = async () => {
    loadCatalogOptions();
    renderAssessment(await api.getStrengthAssessment());
    const profile = await api.getProfile();
    const { stats } = profile;

    // A megjelenített név ugyanaz, mint az áttekintőn: a saját (localStorage)
    // név elsőbbséget élvez a szerver szerinti névvel szemben.
    $('[data-pf-name]', page).textContent = prefs.get('displayName', profile.name);
    $('[data-pf-username]', page).textContent = `@${profile.username}`;

    const joinedEl = $('[data-pf-joined]', page);
    joinedEl.hidden = !profile.joinedAt;
    if (profile.joinedAt) joinedEl.textContent = `Tag ${profile.joinedAt} óta`;

    [['workouts', stats.workouts], ['streak', stats.streak],
      ['prs', stats.prs], ['workSets', stats.workSets]].forEach(([key, value]) => {
      animateNumber($(`[data-pf-stat="${key}"]`, page), value, { from: 0, format: formatWhole });
    });

    setFact('firstWorkout', stats.firstWorkoutDate);
    setFact('lastWorkout', stats.lastWorkoutDate);
    setFact('weight', stats.weight ? `${formatNumber(stats.weight.current)} kg` : null);
    // A delta csak több mérésből értelmes — egyetlen bejegyzésnél a szerver
    // null-t ad, és a sor kimarad.
    setFact('weightDelta', stats.weight?.delta === null || stats.weight === null
      ? null
      : `${formatDelta(stats.weight.delta)} kg`);

    // Ha egyetlen részletsor sincs, a lista helyett a magyarázó szöveg áll ott
    const anyFact = $$('.pf-fact', page).some((row) => !row.hidden);
    factList.hidden = !anyFact;
    emptyEl.hidden = anyFact;
  };

  /* A setupRouter MÁR lefutott, amikor ide érünk. Ha az app épp a
     profiloldalon nyílt (a lastPage visszaállította), a pageEffects akkor
     még null refreshProfile-t talált — az oldal üres számokkal maradt volna
     az első oldalváltásig. Minden más induláskor nincs kérés: az oldal a
     megnyitásakor tölt. */
  if (currentPage() === 'profile') await hooks.refreshProfile();
}

export { setupProfile };
