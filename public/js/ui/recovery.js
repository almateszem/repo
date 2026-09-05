/** A Regeneráció oldal: hosszú check-in űrlap és a készenléti riport. */

import { api } from '../core/api.js';
import { $, $$ } from '../core/dom.js';
import { formatNumber } from '../core/format.js';
import { hooks } from '../core/page-hooks.js';
import { showToast } from '../core/toast.js';
import { renderDashboard } from '../render/dashboard.js';
import { CHECKIN_SCALES, MOOD_SCALE, MUSCLE_GROUPS, buildScale, readScale, renderRecovery, writeScale } from '../render/recovery.js';
import { handleStepClick } from '../render/sets.js';
import { refreshMeasurements, renderMeasurements, setMeasurements } from './measurements.js';
import { mergeWeightEntry, refreshWeightLog, todayWeightEntry } from './weight.js';

/** A Regeneráció oldal: a napi check-in űrlap felépítése és mentése, majd a
    készenléti riport kirajzolása. A számítás teljes egészében a szerveren
    (server/recovery.js) fut — a kliens csak beküld és megjelenít. */
async function setupRecovery() {
  const page = $('[data-page="recovery"]');
  /* Testösszetétel-mérés mentése. Az üresen hagyott mező NEM törlés, csak
     „most nem mértem" — a szerver is így kezeli. */
  const bodyForm = $('[data-form="measurements"]', page);
  const bodySave = $('.rc-body-save', page);
  bodyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = {};
    $$('[data-body-fields] input', page).forEach((input) => {
      if (input.value !== '') values[input.dataset.site] = Number(input.value);
    });
    if (Object.keys(values).length === 0) {
      showToast('Adj meg legalább egy mérést', 'error');
      return;
    }
    bodySave.disabled = true;
    try {
      setMeasurements(await api.saveMeasurements(values));
      renderMeasurements();
      showToast('Mérés mentve');
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Nem sikerült menteni a mérést', 'error');
    } finally {
      bodySave.disabled = false;
    }
  });

  if (!page) return;

  const form = $('[data-form="checkin"]', page);
  const stateEl = $('[data-checkin-state]', page);
  const scalesWrap = $('[data-list="checkin-scales"]', page);
  const sorenessWrap = $('[data-list="checkin-soreness"]', page);
  const painWrap = $('[data-list="checkin-pain"]', page);
  const sleepInput = $('#checkin-sleep');
  const hydrationInput = $('#checkin-hydration');
  const weightInput = $('#checkin-weight');

  // — Az űrlap dinamikus részei —
  CHECKIN_SCALES.forEach(([name, label, [low, high]]) => {
    scalesWrap.appendChild(buildScale({ name, label, min: 1, max: 5, hint: `1 = ${low} · 5 = ${high}` }));
  });
  MUSCLE_GROUPS.forEach(([key, label]) => {
    sorenessWrap.appendChild(buildScale({ name: `soreness.${key}`, label, min: 0, max: 5 }));
    painWrap.appendChild(buildScale({ name: `pain.${key}`, label, min: 0, max: 10 }));
  });
  painWrap.appendChild(buildScale({ name: 'pain.general', label: 'Általános fájdalom', min: 0, max: 10 }));
  {
    const [name, label, [low, high]] = MOOD_SCALE;
    $('.rc-extra-fields', page).before(buildScale({ name, label, min: 1, max: 5, hint: `1 = ${low} · 5 = ${high}` }));
  }

  /** Egy skála a mező-neve alapján. */
  const scaleFor = (name) => $(`.rc-scale[data-field="${name}"]`, page);

  /** Az űrlap kitöltése a szerverről kapott check-inből (vagy ürítése). */
  const fillForm = (checkin) => {
    const numberOrEmpty = (value) => (value === null || value === undefined ? '' : String(value));
    sleepInput.value = numberOrEmpty(checkin?.sleepHours);
    hydrationInput.value = numberOrEmpty(checkin?.hydration);
    // A testsúly nem a check-in sorból, hanem a testsúly-naplóból jön: ha ma
    // már mértél (itt vagy a varázslóban), azt az értéket szerkeszted tovább
    // — naponta egy bejegyzés van, a mentés felülír.
    weightInput.value = numberOrEmpty(todayWeightEntry()?.kg);

    [...CHECKIN_SCALES, MOOD_SCALE].forEach(([name]) => writeScale(scaleFor(name), checkin?.[name] ?? null));
    MUSCLE_GROUPS.forEach(([key]) => {
      writeScale(scaleFor(`soreness.${key}`), checkin?.soreness?.[key] ?? null);
      writeScale(scaleFor(`pain.${key}`), checkin?.pain?.[key] ?? null);
    });
    writeScale(scaleFor('pain.general'), checkin?.pain?.general ?? null);

    stateEl.textContent = checkin ? 'ma már kitöltötted — módosítható' : 'ma még nincs kitöltve';
    stateEl.dataset.filled = String(Boolean(checkin));

    // A varázslóra vivő gomb felirata is az aznapi állapotot tükrözi
    const ctaTitle = $('[data-rc-checkin-cta-title]', page);
    if (ctaTitle) {
      ctaTitle.textContent = checkin ? 'Mai check-in módosítása' : 'Napi check-in kitöltése';
    }
  };

  /** Az űrlap beolvasása a PUT /api/checkin törzsévé. Az üres mezők null-ként
      mennek: a motor a „nem adta meg" esetet nem nullaként, hanem
      súly-újraosztással kezeli. */
  const readForm = () => {
    const numberOrNull = (input) => (input.value.trim() === '' ? null : Number(input.value));
    const body = {
      sleepHours: numberOrNull(sleepInput),
      hydration: numberOrNull(hydrationInput),
      weightKg: numberOrNull(weightInput),
      soreness: {},
      pain: {},
    };
    [...CHECKIN_SCALES, MOOD_SCALE].forEach(([name]) => { body[name] = readScale(scaleFor(name)); });
    MUSCLE_GROUPS.forEach(([key]) => {
      const soreness = readScale(scaleFor(`soreness.${key}`));
      if (soreness !== null) body.soreness[key] = soreness;
      const pain = readScale(scaleFor(`pain.${key}`));
      if (pain !== null) body.pain[key] = pain;
    });
    const generalPain = readScale(scaleFor('pain.general'));
    if (generalPain !== null) body.pain.general = generalPain;
    return body;
  };

  // A ± léptetőgombok ugyanúgy működnek, mint az edzésnaplóban
  form.addEventListener('click', (event) => { handleStepClick(event); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = readForm();

    // Kliens-oldali előellenőrzés a beszédesebb hibaüzenetért; a szerver
    // ugyanezt újra elvégzi (a kliens értékeiben nem bízunk).
    if (body.sleepHours !== null && (!Number.isFinite(body.sleepHours) || body.sleepHours < 0 || body.sleepHours > 24)) {
      showToast('Az alvás időtartama 0 és 24 óra között adható meg', 'error');
      sleepInput.focus();
      return;
    }
    if (body.weightKg !== null && (!Number.isFinite(body.weightKg) || body.weightKg < 30 || body.weightKg > 300)) {
      showToast('Adj meg érvényes testsúlyt (30–300 kg)', 'error');
      weightInput.focus();
      return;
    }

    const submit = $('.rc-save', form);
    submit.disabled = true;
    try {
      // A válasz a friss riportot is tartalmazza — nem kell külön lekérni
      const { checkin, weightEntry, readiness } = await api.saveCheckin(body);
      mergeWeightEntry(weightEntry); // a trend-diagram és a Δ stat frissítése
      hooks.applyCheckinSaved(checkin, readiness);
      showToast(weightEntry
        ? `Check-in mentve · testsúly ${formatNumber(weightEntry.kg)} kg`
        : 'Check-in mentve');
      // Az áttekintő készenlét-gyűrűje ugyanebből a motorból jön
      renderDashboard().catch((err) => console.error('Áttekintő frissítési hiba:', err));
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Nem sikerült menteni a check-int', 'error');
    } finally {
      submit.disabled = false;
    }
  });

  /** A mentett check-in kirajzolása. A részletes űrlap és a varázsló is ezt
      hívja mentés után, hogy a Regeneráció oldal mindkét út után ugyanúgy
      frissüljön (űrlap-értékek + riport-kártyák + készenlét-gyűrű). */
  hooks.applyCheckinSaved = (checkin, readiness) => {
    fillForm(checkin);
    renderRecovery(readiness);
    /* A friss check-in új képet ad a mai állapotról — ez az a pillanat,
       amikor a mai edzésre vonatkozó javaslatnak értelme van. Ha nincs mit
       javasolni, az ablak fel sem ugrik. */
    hooks.adviceModal?.maybeShow();
  };

  /** Friss riport + check-in a szerverről. A pageEffects és az edzés
      lezárása is ezt hívja. */
  hooks.refreshRecovery = async () => {
    // A testsúly-napló is ide tartozik: a trend-kártya ezen az oldalon van,
    // és a fillForm a mai bejegyzésből tölti a testsúly-mezőt.
    const [report, checkin] = await Promise.all([
      api.getReadiness(), api.getCheckin(), refreshWeightLog(),
      // A testösszetétel is ezen az oldalon él, a testsúly-kártya mellett.
      refreshMeasurements(),
    ]);
    fillForm(checkin);
    renderRecovery(report);
  };

  await hooks.refreshRecovery();
}

/* ======================================================================
   6b. Napi check-in varázsló (#checkin)
   Egy kérdés / egy képernyő. Ugyanabba a check-in sorba ír, mint a
   Regeneráció oldal részletes űrlapja — a kettő közti szerződést lásd a
   `carried` mezőnél.
   ====================================================================== */

export { setupRecovery };
