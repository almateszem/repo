/**
 * FitTrack Pro — izomcsoport-taxonómia és gyakorlat → izom leképezés
 * ------------------------------------------------------------------
 * A Recovery Engine csak akkor tud izomcsoportonként regenerációt becsülni,
 * ha meg tudja mondani, egy adott gyakorlat MELYIK izmot mennyire terhelte.
 * Ez a modul ezt a leképezést adja, két rétegben:
 *
 *   1. Katalógus (data.js `exerciseCatalog[].load`) — kézzel megadott
 *      hozzájárulási súlyok, összegük 1. Ez a pontos réteg.
 *   2. Kulcsszavas becslés — az edzésnaplóba szabad szöveggel is beírható
 *      gyakorlatnév (lásd normalizeExercises a server.js-ben), ezekhez a
 *      névből következtetünk.
 *
 * Ha egyik réteg sem talál, a gyakorlat NEM kerül egyetlen izomcsoporthoz sem
 * (üres load): beleszámít az általános terhelésbe és a CNS-be, de nem terhel
 * hamisan olyan izmot, amiről nem tudunk semmit.
 *
 * Nincs benne állapot és nem importál adatbázist — önmagában tesztelhető.
 */

/** A kilenc izomcsoport kulcsa → magyar címke. A sorrend a felület sorrendje
    (felsőtest fentről lefelé, majd alsótest, végül a törzs). */
export const MUSCLE_GROUPS = {
  chest: 'Mell',
  back: 'Hát',
  shoulders: 'Váll',
  arms: 'Karok',
  quads: 'Quadriceps',
  hamstrings: 'Hamstring',
  glutes: 'Farizom',
  calves: 'Vádli',
  core: 'Törzs',
};

export const MUSCLE_KEYS = Object.keys(MUSCLE_GROUPS);

/** Regenerációs időállandó (nap) izomcsoportonként — a csillapítási görbe
    „felezési tempója". A kis izmok gyorsabban állnak helyre; a hamstring, a
    farizom és a törzs lassabban, mert jellemzően nagy eccentricus terhelést
    kapnak (nyújtott állapotban terhelődnek, ami több izomkárosodást okoz). */
export const TAU_BY_GROUP = {
  arms: 1.5,
  calves: 1.5,
  shoulders: 1.5,
  chest: 2.2,
  back: 2.2,
  quads: 2.2,
  hamstrings: 3.0,
  glutes: 3.0,
  core: 3.0,
};

/** Kulcsszó → izom-hozzájárulás a szabad szöveggel beírt gyakorlatnevekhez.
    Sorrend SZÁMÍT: az első illeszkedő minta nyer, ezért a specifikusabb
    minták (pl. „ferde fekvenyomás") előbb állnak, mint az általánosak
    („nyomás"). A minták kisbetűsített, ékezet nélkülire normalizált néven
    futnak (lásd normalizeName), így „Felhúzás" és „felhuzas" is talál. */
const KEYWORD_MAP = [
  // — Alsótest, összetett —
  // A vállvonogatás („felhúzás állig") előbb áll, mint a felhúzás/deadlift,
  // különben a rövidebb „felhuz" minta nyelné el.
  [/felhuzas.?allig|shrug|vallvonogat/, { back: 0.6, shoulders: 0.4 }],
  [/roman|rdl|merev.?labu/, { hamstrings: 0.5, glutes: 0.3, back: 0.15, core: 0.05 }],
  [/felhuz|deadlift|huzas.?fold/, { hamstrings: 0.3, back: 0.35, glutes: 0.25, core: 0.1 }],
  [/hack.?guggol|elso.?guggol|front.?squat/, { quads: 0.6, glutes: 0.2, core: 0.2 }],
  [/guggol|squat/, { quads: 0.55, glutes: 0.25, core: 0.2 }],
  [/kitores|lunge|bolgar|split.?squat/, { quads: 0.45, glutes: 0.35, hamstrings: 0.1, core: 0.1 }],
  [/labtolas|leg.?press|lab.?nyomas/, { quads: 0.7, glutes: 0.3 }],
  [/csipo.?tolas|hip.?thrust|far.?hid|glute.?bridge/, { glutes: 0.7, hamstrings: 0.25, core: 0.05 }],
  [/comb.?hajlit|leg.?curl|labhajlit/, { hamstrings: 1 }],
  [/comb.?nyujt|leg.?extension|labnyujt/, { quads: 1 }],
  [/vadli|calf|labujjhegy/, { calves: 1 }],

  // — Mell —
  [/ferde.?fekvenyom|incline/, { chest: 0.65, shoulders: 0.2, arms: 0.15 }],
  [/fekvenyom|bench|mellnyomas|mell.?nyomas/, { chest: 0.6, shoulders: 0.15, arms: 0.25 }],
  [/tolodzk|dip/, { chest: 0.5, arms: 0.35, shoulders: 0.15 }],
  [/tarazas|fly|keresztez|butterfly|pillango/, { chest: 0.9, shoulders: 0.1 }],
  [/fekvotamasz|push.?up/, { chest: 0.55, arms: 0.25, shoulders: 0.15, core: 0.05 }],

  // — Hát —
  [/huzodzk|pull.?up|chin.?up/, { back: 0.7, arms: 0.25, core: 0.05 }],
  [/lehuzas|lat.?pulldown/, { back: 0.75, arms: 0.25 }],
  [/evezes|row|hajolt/, { back: 0.7, arms: 0.2, shoulders: 0.1 }],
  [/pulover|pullover/, { back: 0.7, chest: 0.2, arms: 0.1 }],
  [/hiperextenzio|hyperextension|torok?emel/, { back: 0.4, hamstrings: 0.3, glutes: 0.3 }],

  // — Váll —
  [/arnold|vallbol.?nyom|vall.?nyom|overhead.?press|katonai/, { shoulders: 0.65, arms: 0.25, core: 0.1 }],
  [/oldalemel|lateral.?raise/, { shoulders: 1 }],
  [/hatso.?vall|rear.?delt|face.?pull/, { shoulders: 0.7, back: 0.3 }],
  [/elolemel|front.?raise/, { shoulders: 1 }],

  // — Kar —
  [/bicepsz|bicep|hajlitas.?sulyzo|kalapacs|hammer/, { arms: 1 }],
  [/tricepsz|tricep|nyujtas.?kabel|homlok.?nyomas|skull/, { arms: 1 }],
  [/alkar|forearm|csuklo/, { arms: 1 }],

  // — Törzs —
  [/plank|deszka|holt.?bogar|dead.?bug/, { core: 1 }],
  // A minták ékezet nélküli, kisbetűs alakon futnak (lásd normalizeName) —
  // ezért itt sem szerepelhet ékezetes betű.
  [/felules|crunch|haspres|has.?gyakorlat|labemel|hasizom/, { core: 1 }],
  [/oblique|ferde.?has|orosz.?csavar|russian.?twist|farmer/, { core: 0.85, arms: 0.15 }],
];

/** Ékezet- és kisbetű-független alak a név-összevetéshez és a kulcsszó-
    illesztéshez („Fekvenyomás" → „fekvenyomas"). Azért kell exportálni, mert
    a recovery.js is ezzel párosítja a fő emeléseket — így az ékezet nélkül
    beírt „guggolas" is felismerhető marad. */
export const normalizeName = (name) => String(name ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '') // a szétbontott ékezet-jelek eldobása
  .trim();

/** A megadott súlyok megtisztítása: csak ismert izomkulcs, csak pozitív szám,
    és a végén 1-re normalizálva — így egy elgépelt katalógus-bejegyzés sem
    tudja aránytalanul felnagyítani vagy elnyelni egy gyakorlat terhelését. */
function normalizeLoad(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const clean = {};
  let total = 0;
  for (const [key, value] of Object.entries(raw)) {
    const weight = Number(value);
    if (!MUSCLE_KEYS.includes(key) || !Number.isFinite(weight) || weight <= 0) continue;
    clean[key] = weight;
    total += weight;
  }
  if (total === 0) return null;
  for (const key of Object.keys(clean)) clean[key] /= total;
  return clean;
}

/* A katalógus név-indexe. Korábban minden egyes gyakorlatnál végigfutott egy
   catalog.find(), ami az 1401 soros katalógus MINDEN elemére újra meghívta a
   normalizeName-et — hívásonként 1,69 ms, és a készenlét-számítás 28 napos
   ablakában minden gyakorlatra lefut. Ez tette ki a /api/dashboard 250 ms-ából
   a 234-et (üres katalógussal ugyanaz a számítás 5 ms volt).

   Az index katalógus-tömbönként egyszer épül fel, és WeakMap tartja: ha a
   hívó eldobja a tömböt, az index is felszabadul — a modul így állapotmentes
   marad kívülről nézve. A db.js egyazon katalógus-tömböt adja vissza minden
   kérésnél (getCollection cache), így a gyakorlatban egyszer épül fel.

   A tárolt érték a KÉSZ, 1-re normalizált súly-objektum (vagy null, ha a sor
   load-ja érvénytelen). Ezt közösen adjuk vissza minden hívónak, tehát az
   eredményt módosítani TILOS — a recovery.js csak olvassa. */
const loadIndexCache = new WeakMap();

function catalogLoadIndex(catalog) {
  let index = loadIndexCache.get(catalog);
  if (index) return index;

  index = new Map();
  for (const item of catalog) {
    const key = normalizeName(item?.name);
    // Az első találat nyer, ahogy a korábbi catalog.find() esetén is — a
    // kurált sorok elöl állnak, a névütközésnél ezek maradnak érvényben.
    if (key && !index.has(key)) index.set(key, normalizeLoad(item?.load));
  }
  loadIndexCache.set(catalog, index);
  return index;
}

/**
 * Egy gyakorlatnév → izom-hozzájárulások ({ quads: 0.55, … }, összegük 1),
 * vagy üres objektum, ha egyik réteg sem ismerte fel.
 *
 * A visszaadott objektum megosztott (ld. a fenti index), ezért csak olvasni
 * szabad.
 *
 * @param {string} name    a naplózott gyakorlat neve (katalógusból vagy kézzel)
 * @param {Array}  catalog a data.js exerciseCatalog tömbje (opcionális)
 */
export function resolveExerciseLoad(name, catalog = []) {
  const normalized = normalizeName(name);
  if (!normalized) return {};

  // 1. réteg: pontos katalógus-találat (a névegyezés ékezet-független).
  // A null érték is találat abban az értelemben, hogy a sor létezik, de a
  // load-ja érvénytelen — ilyenkor a korábbi viselkedés szerint a kulcsszavas
  // rétegre esünk vissza, nem a következő azonos nevű sorra.
  const fromCatalog = catalogLoadIndex(catalog).get(normalized);
  if (fromCatalog) return fromCatalog;

  // 2. réteg: kulcsszavas becslés a névből
  for (const [pattern, load] of KEYWORD_MAP) {
    if (pattern.test(normalized)) return normalizeLoad(load) || {};
  }

  return {}; // ismeretlen — csak az általános terhelésbe és a CNS-be számít
}

/** Igaz, ha a gyakorlat axiálisan terhelt, nagy összetett emelés (guggolás,
    felhúzás, állva végzett nyomás, fekvenyomás). Ezek viselik a legnagyobb
    idegrendszeri költséget, ezért a CNS-becslés külön kezeli őket. */
export function isAxialLift(name) {
  const normalized = normalizeName(name);
  return /guggol|squat|felhuz|deadlift|roman|rdl|fekvenyom|bench|vallbol.?nyom|overhead.?press|katonai/
    .test(normalized);
}

/** Egy üres, minden izomcsoportot tartalmazó számláló-objektum ({ chest: 0, … }).
    A terhelés-összegzők ebből indulnak, hogy sosem legyen hiányzó kulcs. */
export const emptyMuscleMap = () => Object.fromEntries(MUSCLE_KEYS.map((key) => [key, 0]));
