/** Profiloldal: adatok, összesítők, fiókműveletek. */

import { api } from '../core/api.js';
import { $, $$, cloneTemplate } from '../core/dom.js';
import { animateNumber, formatNumber } from '../core/format.js';
import { hooks } from '../core/page-hooks.js';
import { prefs } from '../core/prefs.js';
import { showToast } from '../core/toast.js';
import { currentPage, navigate } from '../nav/router.js';
import { formatDelta } from './weight.js';

/** Egész számokhoz — a formatNumber egy tizedesig kerekít, ami a felpörgetés
    közben tört értékeket villantana fel a darabszámoknál. */
const formatWhole = (value) => String(Math.round(value));

/* ---- Rekord-érmek ----
   KÉT mérce van, és a kártya mindig kiírja, melyik szólt.

   1. ERŐSZINT (standard): ahol van a nemedhez tartozó küszöb (server/data/
      strength-standards.js), ott az adja az érmet. Nem, testsúly és életkor
      szerint mér, tehát egy évek óta edző újonc az ELSŐ rekordjánál a valós
      szintjét kapja. Öt szint, négy érem: kezdő és újonc bronz, középhaladó
      ezüst, haladó arany, elit gyémánt.
   2. SAJÁT FEJLŐDÉS (progress): ahol nincs standard, ott egyedül ez dönt —
      a saját kiindulópontodhoz mérünk, testsúlyra korrigálva. Ahol van
      standard, ott kiegészítésként a felirat végére kerül.

   Ha egyik sincs (nincs nem megadva ÉS nincs mihez mérni), az érem semleges
   marad: a „nem tudjuk" nem ugyanaz, mint a „gyenge". */
const PROGRESS_DIAMOND = 40;
const PROGRESS_GOLD = 20;
const PROGRESS_SILVER = 8;

/** Az érem fokozata és a hozzá tartozó kártya-felirat, vagy null. */
const LEVEL_LABEL = {
  beginner: 'Kezdő',
  novice: 'Újonc',
  intermediate: 'Középhaladó',
  advanced: 'Haladó',
  elite: 'Elit',
};

/** A fejlődés rövid alakja. Az előjel kiírva: a -3% és a 3% két különböző hír. */
const progressText = ({ percent }) => `${percent > 0 ? '+' : ''}${percent}%`;

function medalFor(record) {
  if (record?.standard) {
    const { tier, level, approximate } = record.standard;
    /* A „≈" a gépi és kábeles gyakorlatok jele: ott a kilogramm gépenként
       mást jelent, a szint tájékoztató. A jelmagyarázat alatt ki van mondva. */
    const label = `${approximate ? '≈ ' : ''}${LEVEL_LABEL[level] ?? level}`;
    return {
      tier,
      meta: record.progress ? `${label} · ${progressText(record.progress)}` : label,
    };
  }
  if (record?.progress) {
    const { percent } = record.progress;
    const tier =
      percent >= PROGRESS_DIAMOND
        ? 'diamond'
        : percent >= PROGRESS_GOLD
          ? 'gold'
          : percent >= PROGRESS_SILVER
            ? 'silver'
            : 'bronze';
    return { tier, meta: `${progressText(record.progress)} az első óta` };
  }
  /* Az ELSŐ rekord bronz, nem szürke. A fejlődés-mérce két pontot kér, de attól
     még van rekordod — a szürke korong azt sugallná, hogy valami hiányzik vagy
     elromlott, pedig csak még nincs mihez mérni. A bronz a belépő fokozat: van
     eredményed, innen lehet feljebb lépni. */
  if (record?.needs === 'second-session') return { tier: 'bronze', meta: 'első rekord' };

  return null;
}

/** Amikor nincs érem, a kártya AZT írja ki, mi hiányzik hozzá. A néma szürke
    korong megkülönböztethetetlen attól, mintha a színkódolás elromlott volna —
    és a felhasználó a saját teljesítményének hiszi, ami valójában egy kitöltetlen
    beállítás. */
const MISSING_TEXT = {
  sex: 'Add meg a nemed',
  bodyweight: 'Naplózz testsúlyt',
};

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

  /* ---- Rekordok ----
     A rács csempéit a felhasználó maga tűzi ki: a „+" a közös gyakorlat-
     választóra visz, és amit ott kipipál, az ITT jelenik meg kártyaként.

     Miért a kliens tárolja a listát (prefs → localStorage), és nem a szerver?
     Mert ez NEM adat, hanem nézet-beállítás: melyik négy-öt gyakorlatot akarja
     szem előtt tartani. A rekord maga a szerveré (/api/exercise-records) — a
     kliens csak a neveket jegyzi meg, az értéket minden megnyitáskor frissen
     kéri. Így egy edzés utáni új csúcs magától átírja a csempét.

     A választó alapesetben LISTÁHOZ ad kártyát; a profilnak csak a NÉV kell,
     ezért `onPick`-es célt ad át (lásd exercise-picker.js). A pipa két irányba
     működik: ugyanaz a kattintás le is veszi a csempét. */
  const RECORD_SLOTS = 12;
  const RECORDS_PREF = 'profileRecords';
  const recordGrid = $('[data-pf-record-grid]', page);

  /* A mentett nevek. A prefs bármit visszaadhat (kézzel szerkesztett
     localStorage, régebbi formátum), ezért szűrjük — egy hibás bejegyzéstől
     nem borulhat fel az egész szekció. */
  let pickedNames = (prefs.get(RECORDS_PREF, []) || []).filter(
    (name) => typeof name === 'string' && name.trim(),
  );

  /** Gyakorlatnév → rekord ({ max1rm, date, source }). A megnyitáskor töltjük;
      amíg üres, a kártyák a „még nincs rekord" alakot viselik. */
  let recordsByName = new Map();
  /* Külön a „még nem töltöttük le" és a „nem sikerült letölteni" állapot: az
     előbbi átmeneti, az utóbbit ki kell mondani, különben a felhasználó a
     saját teljesítményének hiszi az üres kártyát. */
  let recordsFailed = false;

  const recordsLead = $('.pf-records-lead', page);
  const tierLegend = $('.pf-tier-legend', page);
  const tierNote = $('.pf-tier-note', page);
  const recordsNotice = $('[data-pf-records-notice]', page);

  const renderRecords = () => {
    // Üres rácson nincs mit magyarázni: az érem-szabály csak kártyával együtt
    // mond bármit.
    recordsLead.hidden = pickedNames.length === 0;
    tierLegend.hidden = pickedNames.length === 0;
    tierNote.hidden = pickedNames.length === 0;

    /* Egyetlen kitöltetlen beállítás az ÖSSZES érmet elnémítja — ezt egy
       kártya-felirat nem tudja elmondani elég hangosan, mert ugyanaz a hiány
       mind a tizenkettőn ott áll. Ezért a szekció tetején is szólunk, és
       odavezetünk, ahol orvosolható. */
    const hiany = pickedNames
      .map((name) => recordsByName.get(name)?.needs)
      .find((needs) => needs === 'sex' || needs === 'bodyweight');
    recordsNotice.hidden = !hiany;
    if (hiany) {
      $('[data-pf-notice-text]', page).textContent =
        hiany === 'sex'
          ? 'A valós erőszinthez meg kell adnod a nemed — a küszöbök nemenként eltérnek. Addig az érem csak a saját fejlődésedet mutatja.'
          : 'Az érmekhez testsúly kell: a teljesítményt ahhoz mérjük.';
      $('[data-pf-notice-action]', page).hidden = hiany !== 'sex';
    }

    const cards = pickedNames.map((name) => {
      const card = cloneTemplate('tpl-pf-record');
      const record = recordsByName.get(name);
      $('.pf-record-label', card).textContent = name;

      /* Rekord nélküli kitűzés nem hiba: pont ez a hasznos eset — kitűzöl egy
         gyakorlatot, amit még nem csináltál, és a csempe megmondja, hogy
         nincs mit felmutatni benne. */
      /* A kiírt rekord az, AMIT CSINÁLTÁL.

         Saját testsúlyosnál ez a teljesítmény maga — „14 ism." vagy súllyal
         „+20 kg" —, nem a belőle számolt terhelés. A testsúly benne marad a
         szint-számításban (azt a meta-sor arányában látod), de a rekordba nem
         adjuk hozzá: a 98,7 kg olyan szám volna, amit tolódzkodásnál soha nem
         emeltél meg, és nem is így mondanád el.

         Kézisúlyzósnál a beírt súly EGY kézisúlyzóé — ott a „/ kéz" jelölés
         teszi egyértelművé, hogy a mellette álló testsúly-szorzó a kettő
         összegéből számol. */
      $('.pf-record-value', card).textContent = !record
        ? '—'
        : record.achievement
          ? record.achievement.addedWeight > 0
            ? `+${formatNumber(record.achievement.addedWeight)} kg`
            : `${record.achievement.reps} ism.`
          : `${formatNumber(record.max1rm)} kg${record.perHand ? ' / kéz' : ''}`;


      /* Az érem csak akkor kap színt, ha van mérce. A felirat mindig azt
         mondja meg, MI alapján — színkód magyarázat nélkül nem információ,
         és önmagában a szín amúgy sem lehet az egyetlen hordozó. */
      const medal = medalFor(record);
      if (medal) $('.pf-medal', card).classList.add(`pf-medal--${medal.tier}`);
      $('.pf-record-meta', card).textContent = medal
        ? medal.meta
        : record
          ? (MISSING_TEXT[record.needs] ?? 'Még nincs mihez mérni')
          : recordsFailed
            ? 'A rekord nem tölthető be'
            : 'Még nincs rekordod';
      return card;
    });

    /* Mindig marad legalább egy „+": tele ráccsal különben nem lenne út
       vissza a választóhoz, tehát levenni sem lehetne semmit. */
    const slots = Math.max(RECORD_SLOTS - cards.length, 1);
    recordGrid.replaceChildren(
      ...cards,
      ...Array.from({ length: slots }, () => {
        const slot = cloneTemplate('tpl-pf-record-slot');
        $('.pf-record-add', slot).addEventListener('click', openRecordPicker);
        return slot;
      }),
    );
  };

  /** Egy gyakorlat fel- vagy levétele a rácsról. A választóban a pipa ezt
      hívja, és onnan derül ki a gomb új állapota is (→ / ✓). */
  const toggleRecord = (name) => {
    pickedNames = pickedNames.includes(name)
      ? pickedNames.filter((picked) => picked !== name)
      : [...pickedNames, name];
    prefs.set(RECORDS_PREF, pickedNames);
    renderRecords();
  };

  function openRecordPicker() {
    hooks.useExercisePicker?.({
      backPage: 'profile',
      backLabel: 'Vissza a profilhoz',
      subtitleNoun: 'a rekordokhoz',
      toastTarget: 'a rekordokhoz',
      pickedNames: () => pickedNames,
      onPick: toggleRecord,
    });
    navigate('exercise-picker');
  }

  renderRecords();

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
      assessOptions.replaceChildren(
        ...catalog.map((item) => {
          const option = document.createElement('option');
          option.value = item.name;
          return option;
        }),
      );
      catalogLoaded = true;
    } catch (err) {
      // A datalist csak kényelem — nélküle is be lehet gépelni a nevet.
      console.error('A gyakorlat-lista betöltése nem sikerült:', err);
    }
  };

  const renderAssessment = (entries) => {
    assessEmpty.hidden = entries.length > 0;
    assessList.replaceChildren(
      ...entries.map((entry) => {
        const li = document.createElement('li');
        li.className = 'pf-assess-item';
        const name = document.createElement('b');
        name.textContent = entry.name;
        const value = document.createElement('span');
        value.textContent = `${formatNumber(entry.max1rm)} kg (becsült 1RM)`;
        li.append(name, value);
        return li;
      }),
    );
  };

  assessForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    assessSave.disabled = true;
    try {
      const res = await api.saveStrengthAssessment([
        {
          exercise: assessExercise.value.trim(),
          weight: Number(assessWeight.value),
          reps: Number(assessReps.value),
        },
      ]);
      assessForm.reset();
      renderAssessment(await api.getStrengthAssessment());
      // A készenléti riport azonnal változik: innentől van mit ajánlani.
      hooks.refreshRecovery?.().catch((err) => console.error('Regeneráció frissítési hiba:', err));
      showToast(
        res.entries[0].stored
          ? 'Felmérés mentve'
          : 'A naplózott csúcsod magasabb — az marad érvényben',
      );
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
    /* A két kérés független egymástól, tehát párhuzamosan megy — sorosan az
       oldal kétszer annyi ideig állna félkészen.

       A rekordok hibáját KÜLÖN kezeljük, és nem dobjuk tovább. Egy elhasalt
       /api/exercise-records korábban az EGÉSZ frissítőt megbuktatta: az
       összesítők, a részletek és a felmérés is üresen maradt, a csempéken
       pedig semleges érem állt — ami pontosan úgy néz ki, mintha a
       színkódolás nem működne. A hiba valódi oka (elavult szerver-példány,
       hálózati hiba) így a konzolig sem jutott el láthatóan. */
    const [profile, records] = await Promise.all([
      api.getProfile(),
      api.getExerciseRecords().catch((err) => {
        console.error('A rekordok betöltése nem sikerült:', err);
        return null;
      }),
    ]);

    recordsFailed = records === null;
    recordsByName = new Map((records ?? []).map((record) => [record.name, record]));
    renderRecords();
    const { stats } = profile;

    // A megjelenített név ugyanaz, mint az áttekintőn: a saját (localStorage)
    // név elsőbbséget élvez a szerver szerinti névvel szemben.
    $('[data-pf-name]', page).textContent = prefs.get('displayName', profile.name);
    $('[data-pf-username]', page).textContent = `@${profile.username}`;

    const joinedEl = $('[data-pf-joined]', page);
    joinedEl.hidden = !profile.joinedAt;
    if (profile.joinedAt) joinedEl.textContent = `Tag ${profile.joinedAt} óta`;

    [
      ['workouts', stats.workouts],
      ['streak', stats.streak],
      ['prs', stats.prs],
      ['workSets', stats.workSets],
    ].forEach(([key, value]) => {
      animateNumber($(`[data-pf-stat="${key}"]`, page), value, { from: 0, format: formatWhole });
    });

    setFact('firstWorkout', stats.firstWorkoutDate);
    setFact('lastWorkout', stats.lastWorkoutDate);
    setFact('weight', stats.weight ? `${formatNumber(stats.weight.current)} kg` : null);
    // A delta csak több mérésből értelmes — egyetlen bejegyzésnél a szerver
    // null-t ad, és a sor kimarad.
    setFact(
      'weightDelta',
      stats.weight?.delta === null || stats.weight === null
        ? null
        : `${formatDelta(stats.weight.delta)} kg`,
    );

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
