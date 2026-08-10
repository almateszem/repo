/**
 * FitTrack Pro — exercises-dataset → saját katalógus leképezés
 * ===========================================================
 * A külső adatforrás: https://github.com/hasaneyldrm/exercises-dataset
 * (1324 gyakorlat, 180×180 gif + thumbnail). A szöveges adat MIT licenc
 * alatt van; a MÉDIA © Gym visual, és csak 180×180-ban, attribúcióval
 * terjeszthető — lásd a repo NOTICE.md-jét és scripts/fetch-exdb-media.js-t.
 *
 * Ez a modul CSAK a leképezést tartalmazza (adat, nem I/O), hogy tesztelhető
 * és átnézhető maradjon. A tényleges generálást a scripts/build-exdb.js
 * végzi, ami ebből állítja elő a server/data/exercises.exdb.js-t.
 *
 * Miért kell leképezés egyáltalán
 * -------------------------------
 * A dataset izom-szótára jóval finomabb (19 target + 40 secondary érték),
 * mint a mi kilenc regenerációs csoportunk (server/muscles.js MUSCLE_GROUPS),
 * és NINCS benne súlyozás — csak „elsődleges” és „másodlagos” izomlista.
 * A Recovery Engine viszont súlyokat vár, amiknek az összege 1. Ezért a
 * `load` itt SZÁRMAZTATOTT érték: az elsődleges izom kapja a súly 60%-át, a
 * másodlagosak osztoznak a maradék 40%-on. Ez becslés, nem mérés — az így
 * készült sorok `loadSource: 'derived'` jelölést kapnak, hogy a kézzel
 * megadott (`data.js`) súlyoktól megkülönböztethetők legyenek.
 */

/** A dataset `muscle_group` mezőjét SZÁNDÉKOSAN nem használjuk: zajos, gyakran
    ellentmond a `target`-nek (pl. a 3/4 sit-up target='abs', de
    muscle_group='hip flexors'). A `target` + `secondary_muscles` páros
    következetes, a leképezés csak ezekre épül. */

/** Dataset izomnév → server/muscles.js MUSCLE_GROUPS kulcs.
    A `null` azt jelenti: nincs megfelelő regenerációs csoportunk (nyak,
    illetve a „cardiovascular system”, ami nem izom) — az ilyen bejegyzést a
    load-számítás kihagyja. A lista LEFEDI a dataset összes előforduló
    értékét; ha a forrás bővül, a build script hangosan elszáll az ismeretlen
    néven, nem pedig csendben kihagyja. */
export const MUSCLE_TO_GROUP = {
  // — Törzs —
  abs: 'core',
  abdominals: 'core',
  'lower abs': 'core',
  obliques: 'core',
  'hip flexors': 'core',
  core: 'core',
  'serratus anterior': 'core',
  // — Hát —
  spine: 'back',
  'lower back': 'back',
  'upper back': 'back',
  back: 'back',
  lats: 'back',
  'latissimus dorsi': 'back',
  rhomboids: 'back',
  traps: 'back',
  trapezius: 'back',
  'levator scapulae': 'back',
  // — Mell —
  pectorals: 'chest',
  chest: 'chest',
  'upper chest': 'chest',
  // — Váll —
  delts: 'shoulders',
  deltoids: 'shoulders',
  shoulders: 'shoulders',
  'rear deltoids': 'shoulders',
  'rotator cuff': 'shoulders',
  // — Kar —
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  brachialis: 'arms',
  wrists: 'arms',
  'wrist flexors': 'arms',
  'wrist extensors': 'arms',
  hands: 'arms',
  'grip muscles': 'arms',
  // — Comb —
  quads: 'quads',
  quadriceps: 'quads',
  adductors: 'quads',
  'inner thighs': 'quads',
  groin: 'quads',
  hamstrings: 'hamstrings',
  // — Far —
  glutes: 'glutes',
  abductors: 'glutes',
  // — Vádli —
  calves: 'calves',
  soleus: 'calves',
  ankles: 'calves',
  'ankle stabilizers': 'calves',
  feet: 'calves',
  shins: 'calves',
  // — Nincs megfelelő csoport —
  'cardiovascular system': null,
  sternocleidomastoid: null,
};

/** Dataset izomnév → a kártyán megjelenő magyar címke. Finomabb, mint a
    MUSCLE_GROUPS kilenc neve: a felületen „Széles hát” informatívabb, mint a
    csoportosított „Hát”. */
export const MUSCLE_LABEL_HU = {
  abs: 'Hasizom',
  abdominals: 'Hasizom',
  'lower abs': 'Alsó hasizom',
  obliques: 'Ferde hasizom',
  'hip flexors': 'Csípőhajlító',
  core: 'Törzs',
  'serratus anterior': 'Fűrészizom',
  spine: 'Gerincfeszítő',
  'lower back': 'Deréktáj',
  'upper back': 'Felső hát',
  back: 'Hát',
  lats: 'Széles hát',
  'latissimus dorsi': 'Széles hát',
  rhomboids: 'Rombuszizom',
  traps: 'Csuklyás',
  trapezius: 'Csuklyás',
  'levator scapulae': 'Lapockaemelő',
  pectorals: 'Mell',
  chest: 'Mell',
  'upper chest': 'Felső mell',
  delts: 'Váll',
  deltoids: 'Váll',
  shoulders: 'Váll',
  'rear deltoids': 'Hátsó váll',
  'rotator cuff': 'Rotátorköpeny',
  biceps: 'Bicepsz',
  triceps: 'Tricepsz',
  forearms: 'Alkar',
  brachialis: 'Karizom',
  wrists: 'Csukló',
  'wrist flexors': 'Csuklóhajlító',
  'wrist extensors': 'Csuklófeszítő',
  hands: 'Kéz',
  'grip muscles': 'Fogásizom',
  quads: 'Quadriceps',
  quadriceps: 'Quadriceps',
  adductors: 'Combközelítő',
  'inner thighs': 'Belső comb',
  groin: 'Ágyék',
  hamstrings: 'Hamstring',
  glutes: 'Farizom',
  abductors: 'Combtávolító',
  calves: 'Vádli',
  soleus: 'Lábikra',
  ankles: 'Boka',
  'ankle stabilizers': 'Bokastabilizátor',
  feet: 'Lábfej',
  shins: 'Sípcsont',
  'cardiovascular system': 'Keringés',
  sternocleidomastoid: 'Nyak',
};

/** Dataset `body_part` → a felület szűrő-chipje (exercises.hu.js GROUPS).
    A `null` kihagyást jelent: a 'neck' mindössze 2 gyakorlat, és egyik
    chipünkbe sem illik. */
export const BODY_PART_TO_GROUP = {
  chest: 'Mell',
  back: 'Hát',
  shoulders: 'Váll',
  'upper arms': 'Kar',
  'lower arms': 'Kar',
  'upper legs': 'Láb',
  'lower legs': 'Láb',
  waist: 'Törzs',
  cardio: 'Kardió',
  neck: null,
};

/** Kardió-gyakorlatok tartalék terhelés-profilja. A dataset ezeknél
    target='cardiovascular system'-et ad, ami nem izom — ha másodlagos izom
    sincs megadva, ezt a általános alsótest-domináns profilt használjuk
    (futás/kerékpár/kötélugrás jellegű mozgás). */
export const CARDIO_FALLBACK_LOAD = {
  quads: 0.35, calves: 0.25, hamstrings: 0.15, glutes: 0.15, core: 0.1,
};

/** Összetett mozgásra utaló kulcsszavak a névben. Az `Összetett`/`Izolációs`
    címkét a dataset nem tartalmazza (nincs `mechanic` mezője), ezért a
    névből + a terhelt csoportok számából becsüljük. Ez a lista dönt először;
    csak ha egyik minta sem talál, jön a csoportszám-alapú tartalék. */
export const COMPOUND_PATTERNS = [
  /\bpress\b/, /\bsquat/, /\bdeadlift\b/, /\brow\b/, /\bpull-?up\b/, /\bchin-?up\b/,
  /\bdip\b/, /\bdips\b/, /\blunge/, /\bclean\b/, /\bsnatch\b/, /\bjerk\b/,
  /\bthruster\b/, /\bpulldown\b/, /\bpush-?up\b/, /\bstep-?up\b/, /\bburpee\b/,
  /\bgood morning\b/, /\bhip thrust\b/, /\bmuscle-?up\b/, /\bswing\b/,
  /\bbridge\b/, /\bcarry\b/, /\bwalk\b/, /\bcrawl\b/, /\bget-?up\b/, /\bclimber\b/,
  /\bhandstand\b/, /\bplanche\b/, /\bpike\b/, /\binchworm\b/, /\bjumping jack\b/,
];

/** Izolációs mozgásra utaló kulcsszavak. Csak akkor számít, ha a
    COMPOUND_PATTERNS egyike sem talált. */
export const ISOLATION_PATTERNS = [
  /\bcurl\b/, /\braise\b/, /\bextension\b/, /\bfly\b/, /\bflye\b/, /\bcrunch\b/,
  /\bkickback\b/, /\bpushdown\b/, /\bshrug\b/, /\badduction\b/,
  /\babduction\b/, /\brotation\b/, /\bpullover\b/, /\bcalf\b/, /\bwrist\b/,
  /\bpull-?in\b/, /\btwist\b/, /\bside bend\b/, /\bkick\b/,
];

/** Nyújtó- és mobilizáló gyakorlatok. Ezek NEM erősítő mozgások: a
    dataset 56 „… stretch” sort tartalmaz, és félrevezető volna őket
    összetett/izolációs erőgyakorlatként címkézni. Külön címkét kapnak,
    ami a szűrésnél is beszédesebb. */
export const MOBILITY_PATTERNS = [
  /\bstretch\b/, /\bmobility\b/, /\bpose\b/,
];

/** Felszerelés → magyar címke. A build ezt a `equipmentHu` mezőbe teszi (a
    kártya alcímében hasznos), a NÉV fordítását viszont a szótár végzi —
    a kettő szándékosan külön, mert a névben a felszerelés melléknévi
    alakban szerepel („Kézisúlyzós”), itt viszont főnévi a jó („Kézisúlyzó”). */
export const EQUIPMENT_LABEL_HU = {
  'body weight': 'Saját testsúly',
  dumbbell: 'Kézisúlyzó',
  cable: 'Kábelgép',
  barbell: 'Rúd',
  'olympic barbell': 'Olimpiai rúd',
  'ez barbell': 'EZ-rúd',
  'trap bar': 'Trap-rúd',
  'leverage machine': 'Gép',
  'smith machine': 'Smith-gép',
  'sled machine': 'Szánkó-gép',
  band: 'Gumiszalag',
  'resistance band': 'Gumiszalag',
  kettlebell: 'Kettlebell',
  weighted: 'Súlyozott',
  assisted: 'Segített',
  'stability ball': 'Fitneszlabda',
  'bosu ball': 'Bosu-labda',
  'medicine ball': 'Medicinlabda',
  rope: 'Kötél',
  roller: 'Henger',
  'wheel roller': 'Haskerék',
  hammer: 'Kalapács',
  tire: 'Gumiabroncs',
  'stationary bike': 'Szobakerékpár',
  'elliptical machine': 'Elliptikus tréner',
  'stepmill machine': 'Lépcsőzőgép',
  'skierg machine': 'SkiErg',
  'upper body ergometer': 'Kar-ergométer',
};

/**
 * Származtatott terhelés-eloszlás egy dataset-rekordból.
 *
 * Az elsődleges izom (`target`) kapja a súly 60%-át, a másodlagosak
 * (`secondary_muscles`) egyenlő arányban osztoznak a maradék 40%-on. Ha a
 * másodlagosak közt szerepel az elsődlegessel AZONOS csoport (pl. target
 * 'biceps' → arms, secondary 'forearms' → szintén arms), akkor a részük az
 * elsődlegeshez adódik — így nem hígul fel a súly egy amúgy izolációs
 * gyakorlatnál.
 *
 * A visszaadott súlyok két tizedesre kerekítettek, és az összegük PONTOSAN 1:
 * a kerekítési maradékot a legnagyobb tétel nyeli el. Erre azért van szükség,
 * mert az importáló validációja a hibás összegű sorokat elutasítja.
 *
 * @param {{target: string, secondary_muscles?: string[]}} record dataset-rekord
 * @returns {Record<string, number>|null} csoport → súly, vagy null ha nem képezhető
 */
export function deriveLoad(record) {
  const unknown = (name) => !(name in MUSCLE_TO_GROUP);
  if (unknown(record.target)) throw new Error(`Ismeretlen target izom: "${record.target}"`);

  const primary = MUSCLE_TO_GROUP[record.target];
  const secondaries = (record.secondary_muscles || []).map((name) => {
    if (unknown(name)) throw new Error(`Ismeretlen secondary izom: "${name}"`);
    return MUSCLE_TO_GROUP[name];
  }).filter(Boolean);

  // Százalékpontban (egész számokkal) számolunk, hogy a kerekítés pontos legyen.
  const points = new Map();
  const add = (key, value) => points.set(key, (points.get(key) || 0) + value);

  if (primary && secondaries.length) {
    add(primary, 60);
    const share = 40 / secondaries.length;
    for (const key of secondaries) add(key, share);
  } else if (primary) {
    add(primary, 100);                       // nincs másodlagos: tiszta izoláció
  } else if (secondaries.length) {
    const share = 100 / secondaries.length;  // a target nem izom (kardió/nyak)
    for (const key of secondaries) add(key, share);
  } else if (record.target === 'cardiovascular system') {
    return { ...CARDIO_FALLBACK_LOAD };      // se target, se secondary: általános kardió-profil
  } else {
    return null;                             // nem képezhető (pl. nyak-gyakorlat)
  }

  // Kerekítés egészre, majd a maradék rárakása a legnagyobb tételre.
  const rounded = [...points].map(([key, value]) => [key, Math.round(value)]);
  const drift = 100 - rounded.reduce((sum, [, value]) => sum + value, 0);
  if (drift !== 0) {
    const biggest = rounded.reduce((a, b) => (b[1] > a[1] ? b : a));
    biggest[1] += drift;
  }

  return Object.fromEntries(
    rounded.filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => [key, value / 100]),
  );
}

/**
 * 'Összetett' vagy 'Izolációs' címke a névből és a terhelt csoportok számából.
 * @param {string} name a gyakorlat ANGOL neve (a minták arra illeszkednek)
 * @param {Record<string, number>} load a származtatott terhelés-eloszlás
 */
export function deriveTag(name, load) {
  const lower = name.toLowerCase();
  // A nyújtás megelőzi a többit: a „standing hamstring stretch” a `standing`
  // miatt könnyen erőgyakorlatnak látszana.
  if (MOBILITY_PATTERNS.some((re) => re.test(lower))) return 'Nyújtás';
  if (COMPOUND_PATTERNS.some((re) => re.test(lower))) return 'Összetett';
  if (ISOLATION_PATTERNS.some((re) => re.test(lower))) return 'Izolációs';
  // Tartalék: háromnál több terhelt izomcsoport már összetett mozgás.
  return Object.keys(load || {}).length >= 3 ? 'Összetett' : 'Izolációs';
}

/**
 * A kártyán megjelenő izom-szöveg: az elsődleges izom, plusz legfeljebb két
 * másodlagos, „ · ” elválasztóval — ugyanabban a formában, ahogy a kézzel
 * írt katalógus `muscles` mezője néz ki.
 */
export function musclesLabel(record) {
  const seen = new Set();
  const labels = [];
  for (const name of [record.target, ...(record.secondary_muscles || [])]) {
    const label = MUSCLE_LABEL_HU[name];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length === 3) break;
  }
  return labels.join(' · ');
}
