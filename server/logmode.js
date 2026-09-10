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
 * SZÁM SZÁNDÉKOSAN NINCS mellettük. A terhelés-számítás (perc × fokozat) még
 * nem készült el, és egy kalibrálatlan szorzót beírni rosszabb volna, mint
 * megvárni: a Recovery Engine ebből a mezőből fog dolgozni, ott pedig egy
 * kitalált arány csendben torzítaná a készenléti pontszámot.
 */
export const INTENSITY_LEVELS = {
  veryLow: { label: 'Nagyon könnyű' },
  low: { label: 'Könnyű' },
  moderate: { label: 'Közepes' },
  high: { label: 'Magas' },
  max: { label: 'Maximális' },
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

/** Igaz, ha a megadott érték a két ismert mód egyike. */
export const isLogMode = (value) => LOG_MODES.includes(value);

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

/** Egy naplózott sor intenzitása. Ismeretlen vagy hiányzó értékre a skála
    közepe jár — üresen hagyni nem lehet, mert a fokozat maga a mérés. */
export const normalizeIntensity = (value) =>
  (INTENSITY_KEYS.includes(value) ? value : DEFAULT_INTENSITY);

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
