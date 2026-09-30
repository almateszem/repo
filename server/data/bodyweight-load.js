/**
 * FitTrack Pro — saját testsúlyos gyakorlatok terhelése (KURÁLT adat)
 * ==================================================================
 * Egy húzódzkodásnál a napló 0 kg-ot lát, pedig a terhelés a saját tested —
 * egy 70 kg-os embernek nyolc húzódzkodás nem „nulla". Az estimate1RM
 * `weight <= 0`-ra nem ad becslést, így ezek a gyakorlatok SOHA nem kerültek
 * be az exercise_maxes-be: nem lett rekordjuk, nem lett PR-jük, és a profil
 * rekord-csempéin sem kaphattak érmet.
 *
 * Ez a tábla mondja meg, a testsúly MEKKORA HÁNYADA nehezedik a dolgozó
 * izmokra. A beírt kilogramm ehhez ADÓDIK: az a pluszsúly (öv, mellény).
 *
 *     terhelés = testsúly × tényező + beírt súly
 *
 * MIÉRT KÉZZEL ÍRT LISTA, ÉS NEM A KATALÓGUS `felszerelés` MEZŐJE
 * --------------------------------------------------------------
 * Mert az utóbbi erre nem megbízható. A generált katalógusban az „Álló
 * egykezes evezés" és az „Álló evezés" is „Saját testsúly" címkét visel, pedig
 * kézisúlyzóval is végezhető — egy téves besorolás ott azt jelentené, hogy egy
 * 50 kg-os sor 120 kg-os terhelésként könyvelődne. A hiányzó bejegyzés ehhez
 * képest ártalmatlan: a gyakorlat marad a mai viselkedésnél.
 *
 * AMI SZÁNDÉKOSAN KIMARADT
 * ------------------------
 *   · „Segített húzódzkodás" és társai. Ott a gép CSÖKKENTI a terhelést, tehát
 *     a beírt szám ELŐJELE fordított — hozzáadva kétszeresen tévednénk.
 *   · Fordított evezés, padon tolódzkodás. A testsúly rájuk eső hányada a
 *     törzsszögtől függ, és az sorról sorra más — nincs egy szám, ami igaz.
 *   · Plank és társai. Izometrikus tartás, nincs ismétlés, amiből 1RM-et
 *     lehetne becsülni.
 */

/** Gyakorlat → a testsúly dolgozó izmokra eső hányada. */
export const bodyweightFactors = {
  /* Függesztett gyakorlatok: a teljes testsúly a karon és a háton van. */
  Húzódzkodás: 1,
  'Alsó fogású húzódzkodás': 1,
  'Semleges fogású húzódzkodás': 1,
  Tolódzkodás: 1,
  'Mellre tolódzkodás': 1,

  /* Fekvőtámasz: a kéztámaszra a testsúly nagyjából kétharmada nehezedik (a
     lábfej viszi a többit), ez a szakirodalomban is ~0,64-0,75 között szór.
     KÖZELÍTÉS, nem mérés — de nagyságrendileg helyes, és jóval közelebb van az
     igazsághoz, mint a jelenlegi nulla. */
  Fekvőtámasz: 0.65,
  'Széles fekvőtámasz': 0.65,
  'Szűk fekvőtámasz': 0.65,
  'Lábemeléses fekvőtámasz': 0.7,
  'Robbanékony fekvőtámasz': 0.65,
};

/** Saját testsúlyos-e a gyakorlat (van-e rá tényezőnk). */
export const isBodyweightExercise = (exercise) => Boolean(bodyweightFactors[exercise]);

/**
 * Egy szett TÉNYLEGES terhelése kilogrammban.
 *
 * Nem saját testsúlyos gyakorlatnál a beírt súly maga a terhelés. Saját
 * testsúlyosnál a testsúly hányada plusz a beírt (rá akasztott) súly — ha
 * viszont nincs testsúly-bejegyzés, 0-t adunk vissza, nem tippelünk: a hívó
 * ilyenkor ugyanúgy „nincs rekord"-ot lát, mint eddig, és a felület meg tudja
 * mondani, hogy testsúlyt kell naplózni.
 *
 * @param {string} exercise   gyakorlat neve
 * @param {number} weight     a naplóba beírt súly (kg)
 * @param {number} bodyweight a napi testsúly (kg), vagy 0 ha nincs
 * @returns {number} a terhelés kilogrammban
 */
export function effectiveLoad(exercise, weight, bodyweight) {
  const factor = bodyweightFactors[exercise];
  const added = Number(weight);
  if (!factor) return Number.isFinite(added) ? added : 0;
  if (!(bodyweight > 0)) return 0;
  return bodyweight * factor + (Number.isFinite(added) && added > 0 ? added : 0);
}
