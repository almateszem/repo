/**
 * FitTrack Pro — a gyakorlatok NAPLÓZÁSI MÓDJA
 * ============================================
 * Két mód van, és a különbség az, hogy MIT ír be a felhasználó egy sorba:
 *
 *   'reps'      ismétlés + súly + RPE. Ez minden gyakorlat alapértelmezése,
 *               és minden korábban naplózott soré is — a mód nélküli régi
 *               sorok tehát változatlanul viselkednek.
 *   'duration'  eltöltött idő + intenzitás. A futópad, a szobabicikli és a
 *               többi olyan mozgás, amit nem ismétlésben mérnek.
 *
 * A mód a GYAKORLAT tulajdonsága, nem a felhasználó útvonaláé. Az, hogy a
 * választóban melyik chip volt kiválasztva, sehol nem tárolódik, és a
 * kereséssel a chip meg is kerülhető — a „Kardió chipről adtam hozzá” tehát
 * nem létező információ. A mód ezért a katalógus-sorra van ráégetve, még az
 * összeállításkor (data/catalog.js → buildExerciseCatalog).
 *
 * A feloldás RÉTEGZETT, ugyanazzal a logikával, mint a resolveExerciseLoad:
 *   1. a katalógus-sor kimondott `logMode` mezője (a kurált sorokon ez áll),
 *   2. a Kardió csoporton BELÜL a név mintázata,
 *   3. különben 'reps'.
 *
 * A második réteg nem kényelmi kérdés. A katalógus nagyobbik fele GENERÁLT
 * (exercises.exdb.js, kézzel nem szerkeszthető, a build újraírja), és ott
 * ugyanaz a mozgás más néven is szerepel: a „Futás” és a „Futás (gépes)”
 * ugyanúgy időalapú, mint a kurált „Szabadtéri futás” és „Futópad”. Enélkül
 * két majdnem azonos nevű gyakorlat két különböző felületet adna, ráadásul
 * csak a következő adatbázis-újraépítésig.
 *
 * A mintázat SZÁNDÉKOSAN csak a Kardió csoportra fut. A „Farmer séta” és a
 * „Plank” szintén időalapú mozgás, de azok átállítása külön döntés — egy
 * szótöredék nem sodorhatja el a súlyzós sorokat.
 */

import { normalizeName } from './muscles.js';

/** A két naplózási mód. A 'reps' az alapértelmezés MINDENHOL: hiányzó vagy
    ismeretlen érték esetén is ez érvényes, mert az app egész eddigi
    előzménye ilyen. */
export const LOG_MODES = ['reps', 'duration'];

export const DEFAULT_LOG_MODE = 'reps';

/**
 * Az időalapú sorok INTENZITÁS-fokozatai, érzet alapján.
 *
 * Öt fokozat, mert a skálának el kell bírnia a különbséget a regeneráló séta
 * és a maximális intervallum között; háromnál a közepes fokozat mindent
 * elnyelne.
 *
 * A kulcs az, ami MENTŐDIK, a címke csak megjelenítés. Ha egyszer átfogalmazzuk
 * a feliratot, a már naplózott sorok nem válnak értelmezhetetlenné — ugyanez
 * az elv él a mérési helyeknél (MEASUREMENT_SITES) és a szett-típusoknál.
 *
 * KÉT SZÁM tartozik minden fokozathoz, és ez nem redundancia.
 *
 *   met     A kalóriához. Külső terhelés: az energiaköltség, ami nagyjából
 *           arányos az intenzitással.
 *   strain  A fáradtsághoz. Belső terhelés, MEREDEKEBB skálán: a maximális
 *           intervallum nem másfélszer, hanem sokszorosan drágább a
 *           közepesnél, és sokkal lassabban áll helyre.
 *
 * Ugyanez a kettősség már él a súlyzós oldalon: a tonnatömeg lineárisan
 * skálázódik az RPE-vel (0.2 meredekség), az izomkárosodás meredekebben (0.3),
 * az idegrendszer pedig külön felárat kap a legmagasabb sávban. Három csatorna,
 * három görbe — itt is.
 *
 * Miért nem a MET hajtja a fáradtságot is: a MET azt méri, amit CSINÁLTÁL, nem
 * azt, hogy NEKED mennyibe került. Ugyanaz a tempó az edzett futónál a
 * kapacitása felét viszi el, a kezdőnél a kilencven százalékát, a MET-jük mégis
 * közel azonos. Az érzet alapú fokozat viszont eleve egyénre vetített — ezért
 * az a fáradtság helyes bemenete.
 */
export const INTENSITY_LEVELS = {
  veryLow: { label: 'Nagyon könnyű', met: 3, strain: 1 },
  low: { label: 'Könnyű', met: 5, strain: 2 },
  moderate: { label: 'Közepes', met: 7, strain: 4 },
  high: { label: 'Magas', met: 9, strain: 7 },
  max: { label: 'Maximális', met: 12, strain: 11 },
};

export const INTENSITY_KEYS = Object.keys(INTENSITY_LEVELS);

/** Az alapértelmezett fokozat: a skála közepe. */
export const DEFAULT_INTENSITY = 'moderate';

/** Egy időalapú sor felső időkorlátja másodpercben (24 óra). Nem valós edzés-
    hossz, hanem elgépelés-korlát: a tárolt érték maradjon értelmezhető szám. */
export const MAX_DURATION_SECONDS = 24 * 60 * 60;

/* A Kardió csoporton belüli, névre illesztett minták. Ékezet nélküli, kisbetűs
   alakon futnak (lásd normalizeName), ezért ékezetes betű nem szerepelhet
   bennük. Amit fognak, az a generált katalógus gép- és helyváltoztatásos
   kardiója: futás, kerékpár, elliptikus, lépcsőzőgép, kötélugrás, evezőgép.
   Amit szándékosan NEM: a burpee, a box jump, a kettlebell swing, a thruster
   és a wall ball — azokat ismétlésben és kilóban naplózzák, tehát maradnak
   szett-alapúak, ahogy a súllyal végzett kardiónál megbeszéltük. */
const DURATION_NAME_PATTERNS = [
  /futas|futopad/,
  /kerekpar|szobabicikli|spinning/,
  /elliptikus/,
  /lepcso/,
  /kotelugras|ugralokotel/,
  /evezogep|skierg|assault/,
  /medvejaras/,
];

/* ---- Gyakorlat-profil: becsapódás-jelleg és testsúly-viselés ----

   BECSAPÓDÁS. Egy óra futás és egy óra szobabicikli lehet azonos MET-en, a
   lábnak mégsem ugyanaz: a futás excentrikus és ütközéses, a bicikli
   koncentrikus és ütközésmentes. A KALÓRIA tényleg ugyanannyi, az
   IZOMKÁROSODÁS nem — ezért a szorzó csak az izom-csatornán hat, a szisztémás
   terhelésen és a kalórián nem.

   TESTSÚLY-VISELÉS. Ülve a gép tartja a sportolót, tehát egy súlymellény
   tömege ott nem kerül semmibe. A mező a felületen ilyenkor is ott marad (a
   mellényt fel lehessen jegyezni), de a képletből kimarad.

   Három sáv elég, folytonos skála nem kell. Az ismeretlen sor a KÖZÉPSŐ sávot
   kapja: a nulla azt állítaná, hogy nincs izomkárosodás, az egy pedig
   futás-szintűt — egyik sem tudás, és a ház szabálya szerint a „nincs adat"
   nem lehet a legkedvezőbb feltételezés. */

/** Ülve végzett, gép által megtámasztott mozgás. */
const SEATED_PATTERNS = [/szobabicikli|spinning|kerekpar|evezogep|assault/];

/** Ütközéses, excentrikusan terhelő mozgás. */
const HIGH_IMPACT_PATTERNS = [/futas|futopad|sprint|ugralokotel|kotelugras|lepcso/];

const IMPACT_HIGH = 1;
const IMPACT_STANDING = 0.5;
const IMPACT_SEATED = 0.3;

/** Igaz, ha a megadott érték a két ismert mód egyike. */
export const isLogMode = (value) => LOG_MODES.includes(value);

/**
 * Egy KATALÓGUS-SOR kardió-profilja. A logMode-hoz hasonlóan a katalógus
 * összeállításakor fut le, soronként egyszer, és onnantól a kiírt mezők az
 * egyetlen forrás. Szett-alapú soron nincs értelme, ezért ott semleges.
 *
 * @param {object} entry katalógus-bejegyzés
 * @returns {{ impact: number, carriesBodyWeight: boolean }}
 */
export function resolveCardioProfile(entry) {
  const name = normalizeName(entry?.name);
  if (SEATED_PATTERNS.some((pattern) => pattern.test(name))) {
    return { impact: IMPACT_SEATED, carriesBodyWeight: false };
  }
  if (HIGH_IMPACT_PATTERNS.some((pattern) => pattern.test(name))) {
    return { impact: IMPACT_HIGH, carriesBodyWeight: true };
  }
  return { impact: IMPACT_STANDING, carriesBodyWeight: true };
}

/**
 * Egy KATALÓGUS-SOR naplózási módja. A katalógus összeállításakor fut le,
 * soronként egyszer, és onnantól a kiírt `logMode` mező az egyetlen forrás —
 * a felület és a szerver is azt olvassa, nem ezt a függvényt.
 *
 * @param {object} entry katalógus-bejegyzés ({ name, group, logMode? })
 * @returns {'reps'|'duration'}
 */
export function resolveLogMode(entry) {
  if (isLogMode(entry?.logMode)) return entry.logMode;
  if (entry?.group !== 'Kardió') return DEFAULT_LOG_MODE;
  const name = normalizeName(entry?.name);
  return DURATION_NAME_PATTERNS.some((pattern) => pattern.test(name))
    ? 'duration'
    : DEFAULT_LOG_MODE;
}

/* A katalógus kardió-profil INDEXE. Ugyanaz a minta, mint a muscles.js
   név-indexénél, és ugyanazért: a készenlét-számítás 28 napnyi edzés MINDEN
   gyakorlatára lekérdezi, egy katalógus-bejárás fejenként itt is érezhető
   volna. Katalógus-tömbönként egyszer épül, WeakMap tartja, tehát a modul
   kívülről állapotmentes marad. */
const profileIndexCache = new WeakMap();

function cardioProfileIndex(catalog) {
  if (profileIndexCache.has(catalog)) return profileIndexCache.get(catalog);
  const index = new Map();
  for (const entry of catalog) {
    const key = normalizeName(entry?.name);
    if (!key || entry?.logMode !== 'duration' || index.has(key)) continue;
    index.set(key, {
      impact: Number(entry.impact) || IMPACT_STANDING,
      carriesBodyWeight: entry.carriesBodyWeight !== false,
    });
  }
  profileIndexCache.set(catalog, index);
  return index;
}

/** Egy NAPLÓZOTT gyakorlatnév kardió-profilja a katalógusból. Ismeretlen névre
    a semleges középső sáv jár, ugyanazzal az indoklással, mint a
    resolveCardioProfile alapértelmezésénél: a nulla azt állítaná, hogy nincs
    izomkárosodás, az egy pedig futás-szintűt. */
export function cardioProfileFor(name, catalog = []) {
  return cardioProfileIndex(catalog).get(normalizeName(name))
    ?? { impact: IMPACT_STANDING, carriesBodyWeight: true };
}

/** Egy naplózott sor intenzitása. Ismeretlen vagy hiányzó értékre a skála
    közepe jár — üresen hagyni nem lehet, mert a fokozat maga a mérés. */
export const normalizeIntensity = (value) =>
  (INTENSITY_KEYS.includes(value) ? value : DEFAULT_INTENSITY);

/** Egy fokozat MET-értéke (kalória) és strain-értéke (fáradtság). Ismeretlen
    kulcsra a skála közepe jár, ugyanúgy, mint a normalizeIntensity-nél. */
export const intensityMet = (key) =>
  (INTENSITY_LEVELS[key] ?? INTENSITY_LEVELS[DEFAULT_INTENSITY]).met;

export const intensityStrain = (key) =>
  (INTENSITY_LEVELS[key] ?? INTENSITY_LEVELS[DEFAULT_INTENSITY]).strain;

/**
 * Egy naplózott sor időtartama MÁSODPERCBEN, szövegként tárolva (a szett többi
 * szám-mezője is így él).
 *
 * Miért másodperc, ha a felület egész PERCET kér be: a tárolt mérték finomabb
 * maradhat, mint a beviteli. Így a képlet és egy későbbi, pontosabb bevitel sem
 * kíván hozzányúlást a már mentett adathoz. A felhasználó egy-két másodpercet
 * úgysem tud érdemben megmondani egy kardió edzésről.
 */
export function normalizeDuration(value) {
  const seconds = Math.floor(Number(String(value ?? '').trim()));
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return String(Math.min(seconds, MAX_DURATION_SECONDS));
}
