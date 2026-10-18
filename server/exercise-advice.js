/**
 * Podium — gyakorlat-specifikus készenlét és ajánlás
 * ------------------------------------------------------------------------
 * A Recovery Engine (recovery.js) kimenetének utolsó lépése: a naplózott és a
 * bemondott gyakorlatokra konkrét edzésdöntés (verdict, súly-javaslat). Tiszta
 * számítás, adatbázis nélkül.
 */
import { PAIN_BLOCK, resolveExerciseLoad, normalizeName } from './muscles.js';
import { clamp, clamp01, mean, median } from './numbers.js';

/** A fő emelések: ezekre akkor is adunk becslést, ha csak egyszer szerepeltek.
    Ékezet nélküli, kisbetűs alakban tároljuk, mert így párosítunk. */
const MAIN_LIFTS = ['fekvenyomas', 'guggolas', 'felhuzas'];

/** Egy általános gyakorlathoz ennyi naplózott alkalom kell a becsléshez. */
const MIN_SESSIONS = 3;

/** Legfeljebb ennyi gyakorlatra adunk ajánlást (a leggyakoribbak nyernek). */
const MAX_EXERCISE_RECS = 6;

/* ======================================================================
   Gyakorlat-specifikus readiness + ajánlás
   ====================================================================== */

/** A pontszámból konkrét edzésdöntés. Ez a rendszer valódi kimenete —
    a szám csak az indoklás. */
function recommend(readiness, { prWindow }) {
  if (readiness >= 90 && prWindow) {
    return {
      verdict: 'pr',
      loadDelta: '+2.5–5 kg',
      volumeDelta: 'normál',
      text: '+2.5–5 kg is várhatóan teljesíthető',
    };
  }
  if (readiness >= 90)
    return {
      verdict: 'strong',
      loadDelta: 'normál',
      volumeDelta: 'normál',
      text: 'nyugodtan mehet a nehezebb sorozat',
    };
  if (readiness >= 80)
    return {
      verdict: 'normal',
      loadDelta: 'normál',
      volumeDelta: 'normál',
      text: 'normál intenzitás',
    };
  if (readiness >= 70)
    return {
      verdict: 'trim',
      loadDelta: 'normál',
      volumeDelta: '−1 szett',
      text: 'normál súly, −1 szett',
    };
  if (readiness >= 60)
    return {
      verdict: 'reduce',
      loadDelta: '−5–10%',
      volumeDelta: '−25%',
      text: 'csökkentett súly és volumen',
    };
  return {
    verdict: 'skip',
    loadDelta: '−15%',
    volumeDelta: '−50%',
    text: 'technikai nap vagy hagyd ki',
  };
}

/** A súlycsökkentés a konditerem valóságához igazodik: tárcsa-lépcsőre,
    lefelé kerekítve. Egy „87,3 kg" javaslat használhatatlan volna. Elsőként a
    2,5 kg-os lépcső; ha az a kis súlyon aránytalanul sokat venne le (10 kg-ról
    7,5-re = 25% a kért 10% helyett), a finomabb lépcsők jönnek (kézisúlyzó,
    mikrotárcsa). */
const PLATE_STEPS_KG = [2.5, 1, 0.5];
/** A tényleges levétel legfeljebb ennyiszerese lehet a javasoltnak. */
const MAX_REDUCTION_OVERSHOOT = 1.5;
/** A csökkentett súly, vagy null, ha nincs értelmes lépcső: a súly nem mehet
    nullára (2 kg → 0 kg nem visszavétel, hanem a gyakorlat elhagyása), és a
    levétel nem lehet a kért arány MAX_REDUCTION_OVERSHOOT-szorosánál több. */
export const reduceWeight = (kg, ratio) => {
  const target = kg * (1 - ratio);
  for (const step of PLATE_STEPS_KG) {
    // A lebegőpontos maradék (pl. 9.000000001 / 1) ne vigyen egy lépcsővel lejjebb
    const reduced = Math.floor(target / step + 1e-9) * step;
    if (reduced > 0 && reduced < kg && (kg - reduced) / kg <= ratio * MAX_REDUCTION_OVERSHOOT) {
      return reduced;
    }
  }
  return null;
};

/**
 * Gyakorlat-ajánlások.
 *
 * A jelöltek KÉT forrásból jönnek:
 *   · naplózott edzésekből (`exercises`) — itt van frissesség-adat is,
 *   · az erőfelmérésen BEMONDOTT gyakorlatokból (`declared`) — ezekről csak
 *     annyit tudunk, hogy a felhasználó ismeri őket. Enélkül a friss fiók
 *     hetekig egyetlen ajánlást sem kapna: a naplózott út három alkalmat kér
 *     (MIN_SESSIONS), a három fő emelés kivételével.
 *
 * A BEMONDOTT gyakorlatról viszont CSAK annyit tudunk, hogy a felhasználó
 * ismeri. Se frissesség, se izomcsoport-szintű regeneráció nincs mögötte —
 * ezért az ilyen ajánlás az ÖSSZESÍTETT készenlétre épül, ami a mai check-int
 * tükrözi. Ha az sincs (`overall === null`), a gyakorlat KIMARAD: semmit nem
 * tudunk, és a „nincs adat" nem lehet „tökéletes állapot". A `basis` mező
 * mindkét esetben kimondja, min alapul a szám.
 */
export function exerciseReadiness({
  exercises,
  muscles,
  cns,
  catalog,
  declared = [],
  overall = null,
  ceiling = null,
}) {
  const byKey = Object.fromEntries(muscles.map((m) => [m.key, m.readiness]));
  const painfulGroups = new Set(
    muscles.filter((m) => m.pain !== null && m.pain >= PAIN_BLOCK).map((m) => m.key),
  );

  const logged = [...exercises.values()]
    .map((entry) => ({ ...entry, isMain: MAIN_LIFTS.includes(normalizeName(entry.name)) }))
    .filter((entry) => entry.isMain || entry.sessions.length >= MIN_SESSIONS);

  /* A bemondott gyakorlatok csak akkor kerülnek be, ha naplózott adat NINCS
     róluk — ahol van, ott a mérés a jobb forrás. */
  const loggedNames = new Set(logged.map((entry) => normalizeName(entry.name)));
  /* Összesített készenlét nélkül a bemondott gyakorlatról semmit nem tudnánk
     mondani — ilyenkor inkább nem mondunk semmit. */
  const declaredOnly =
    overall === null
      ? []
      : declared
          .filter((entry) => !loggedNames.has(normalizeName(entry.name)))
          .map((entry) => ({
            name: entry.name,
            sessions: [],
            isMain: MAIN_LIFTS.includes(normalizeName(entry.name)),
          }));

  const candidates = [...logged, ...declaredOnly]
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || b.sessions.length - a.sessions.length)
    .slice(0, MAX_EXERCISE_RECS);

  return candidates.map((entry) => {
    const load = resolveExerciseLoad(entry.name, catalog);
    const groups = Object.entries(load);

    // A gyakorlat izom-readinesse: a terhelt csoportok súlyozott átlaga.
    // Ha egyik izomcsoportot sem ismerjük fel, a teljes izom-átlagra esünk
    // vissza — így ismeretlen gyakorlatnév sem ad hamis biztonságérzetet.
    const muscleScore = groups.length
      ? groups.reduce((sum, [group, share]) => sum + byKey[group] * share, 0)
      : mean(muscles.map((m) => m.readiness));

    /* Frissesség: eltelt-e annyi idő, amennyi ehhez a gyakorlathoz szokott.
       BEMONDOTT gyakorlatnál nincs ilyen adat — a súlya ilyenkor a másik két
       tényező között oszlik szét, nem tippelünk helyette értéket. */
    const sorted = [...entry.sessions].sort((a, b) => a.daysAgo - b.daysAgo);
    const hasSessions = sorted.length > 0;
    const sinceLast = hasSessions ? sorted[0].daysAgo : null;

    let readiness;
    if (hasSessions) {
      const gaps = sorted.slice(1).map((session, i) => session.daysAgo - sorted[i].daysAgo);
      const typicalGap = gaps.length ? clamp(median(gaps), 2, 7) : 3.5;
      const freshness = clamp01(sinceLast / typicalGap) * 100;
      readiness = 0.45 * muscleScore + 0.3 * cns + 0.25 * freshness;
    } else {
      /* Bemondott gyakorlat: az izomcsoport-szintű regeneráció és a frissesség
         is hiányzik, ezért az ÖSSZESÍTETT készenlétet vesszük — az legalább a
         mai check-inre épül. A muscleScore itt 100 volna (a „nem terhelted"
         alapértelmezés), ami ismeretlen izomra hamis biztonságérzet. */
      readiness = overall;
    }

    /* Sapkás napon (fájdalom, nagyon rossz közérzet, kimerültség + stressz) a
       gyakorlat sem lehet jobb a napnál. A naplózott gyakorlat pontszáma
       ugyanis az izomból, az idegrendszerből és a frissességből jön — a mai
       szubjektív állapotot nem látja, és egy hete pihent guggolásra 1-es
       közérzet mellett is PR-t ajánlott volna. */
    if (ceiling !== null) readiness = Math.min(readiness, ceiling);

    // Ha a gyakorlat fájdalmas izomcsoportot terhel, letiltjuk — a fájdalom
    // felülír minden terhelés-alapú becslést.
    const hitsPainful = groups.some(([group]) => painfulGroups.has(group));
    if (hitsPainful) readiness = Math.min(readiness, 30);

    // PR-ablak csak akkor, ha a becsült 1RM az utolsó három alkalommal
    // FOLYAMATOSAN emelkedett — a jó közérzet önmagában nem elég indok.
    // (Korábban csak a legutolsót vetette össze a harmadikkal, így egy
    // 100 → 120 → 101 visszaesés is PR-ablakot adott.) Legfrissebb elöl.
    const estimates = sorted
      .slice(0, 3)
      .map((session) => session.best1RM)
      .filter((v) => v !== null);
    const prWindow =
      estimates.length >= 3 && estimates[0] > estimates[1] && estimates[1] > estimates[2];

    const rounded = Math.round(clamp(readiness, 0, 100));
    return {
      name: entry.name,
      readiness: rounded,
      sessions: entry.sessions.length,
      daysSinceLast: sinceLast,
      /* Mire épül a szám: naplózott alkalmakra, vagy csak a bemondott
         erőfelmérésre. A felületnek ezt ki kell mondania — a bemondás nem
         mérés. */
      basis: hasSessions ? 'logged' : 'declared',
      painBlocked: hitsPainful,
      ...(hitsPainful
        ? {
            verdict: 'avoid',
            loadDelta: '—',
            volumeDelta: '—',
            text: 'kerüld ma — fájdalmat jeleztél',
          }
        : recommend(rounded, { prWindow })),
    };
  });
}
