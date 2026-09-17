/**
 * FitTrack Pro — ajánlott gyakorlatok a gyakorlat-választóhoz
 * ----------------------------------------------------------
 * A választó magától javasol gyakorlatokat, KÉT EGYENRANGÚ jelből:
 *
 *   1. AZ EDZÉS CÍMÉBŐL — „Lábnap", „Push #3", „Hát + bicepsz". Ez önmagában
 *      törékeny: az emberek „Hétfő" vagy „A nap" néven is mentenek, és akkor
 *      a cím semmit nem mond.
 *   2. A REGENERÁLTSÁGBÓL — a Recovery Engine izomcsoportonkénti készenléte.
 *      Ez az a jel, ami nem függ attól, hogyan nevezte el valaki az edzést.
 *
 * Döntések (TEENDOK, 2026-08-26), amiket ez a modul betart:
 *   · minden javaslat KIMONDJA, miért került oda („a címből: Láb",
 *     „Mell 92% regenerált") — két összekevert jel indoklás nélkül
 *     kiszámíthatatlannak látszana;
 *   · fájdalommal letiltott izomcsoport (7/10 felett) SOSEM kerül be, és ezt a
 *     cím sem írhatja felül — az a gyakorlat sem, ami csak másodlagosan terheli;
 *   · ha a címből nincs értelmezhető szó, a lista a regeneráltságra esik
 *     vissza, nem marad üres.
 *
 * Tiszta függvény: nem ismeri az adatbázist, a server.js gyűjti össze a
 * bemenetet (server/suggestions.test.js).
 */
import { MUSCLE_GROUPS, MUSCLE_KEYS, normalizeName, resolveExerciseLoad } from './muscles.js';

/** Ettől a készenléttől számít egy izomcsoport „regeneráltnak". A recovery.js
    ajánlás-sávjaiban 80 a „normál intenzitás" alja — ami ez alatt van, arra a
    motor már visszafogást javasol, tehát oda nem hívunk be magunktól. */
export const READY_THRESHOLD = 80;

/** Ennyi gyakorlat jut egy izomcsoportra, és ennyi a teljes lista. A választó
    tetején ül: ha hosszabb, a katalógust tolja le a képernyőről. */
const PER_GROUP = 2;
const MAX_SUGGESTIONS = 8;

/** A cím túl hosszú szövegét nem elemezzük tovább — a névmező amúgy is rövid. */
const MAX_TITLE_LENGTH = 120;

const LOWER_BODY = ['quads', 'hamstrings', 'glutes', 'calves'];

/**
 * Cím-szavak → izomcsoportok.
 *
 * Két illesztési mód, mert a magyar összetett szó („Lábnap", „Hátnap") és a
 * rövid, sok mindent jelentő szó („hat", „kar", „leg") mást kíván:
 *   · `prefix` — a szó ezzel KEZDŐDIK. Ékezettel együtt illesztünk, így a
 *     „hát" nem találja el a „hatodik"-ot, a „láb" a „labdá"-t. Ékezet nélküli
 *     minta az ékezettelenített szón is fut („comb", „push").
 *   · `exact` — a TELJES szó, ékezet nélkül. Ide kerül minden, ami prefixként
 *     félrevinne: a „leg" a „legjobb"-at, a „has" a „hasonló"-t is elkapná.
 *     Az ékezet nélkül gépelt magyar szó is itt él („lab", „vall").
 */
const TITLE_RULES = [
  { label: 'Mell', groups: ['chest'], prefix: ['mell'], exact: ['chest'] },
  { label: 'Hát', groups: ['back'], prefix: ['hát'], exact: ['hatnap', 'back'] },
  {
    label: 'Váll',
    groups: ['shoulders'],
    prefix: ['váll'],
    exact: ['vall', 'vallnap', 'shoulder', 'shoulders', 'delts'],
  },
  {
    label: 'Kar',
    groups: ['arms'],
    prefix: ['karnap', 'karok', 'bicepsz', 'tricepsz', 'alkar'],
    exact: ['kar', 'arm', 'arms', 'bicep', 'biceps', 'tricep', 'triceps'],
  },
  {
    label: 'Láb',
    groups: LOWER_BODY,
    prefix: ['láb', 'comb'],
    exact: ['lab', 'labnap', 'leg', 'legs', 'legday'],
  },
  {
    label: 'Farizom',
    groups: ['glutes'],
    prefix: ['farizom', 'fenék'],
    exact: ['far', 'fenek', 'glute', 'glutes', 'booty'],
  },
  { label: 'Vádli', groups: ['calves'], prefix: ['vádli'], exact: ['vadli', 'calf', 'calves'] },
  {
    label: 'Törzs',
    groups: ['core'],
    prefix: ['törzs', 'hasizom', 'hasnap'],
    exact: ['torzs', 'has', 'core', 'abs'],
  },
  {
    label: 'Push',
    groups: ['chest', 'shoulders', 'arms'],
    prefix: ['push', 'nyomó'],
    exact: ['nyomo'],
  },
  { label: 'Pull', groups: ['back', 'arms'], prefix: ['pull', 'húzó'], exact: ['huzo'] },
  {
    label: 'Felsőtest',
    groups: ['chest', 'back', 'shoulders', 'arms'],
    prefix: ['felsőtest', 'upper'],
    exact: ['felso', 'felsotest'],
  },
  {
    label: 'Alsótest',
    groups: LOWER_BODY,
    prefix: ['alsótest', 'lower'],
    exact: ['also', 'alsotest'],
  },
  {
    label: 'Teljes test',
    groups: MUSCLE_KEYS,
    prefix: ['teljestest', 'fullbody'],
    exact: ['full', 'teljes', 'fbw'],
  },
];

/**
 * Az edzés címéből felismert izomcsoportok: kulcs → a felismerő szabály
 * címkéje (az indoklásban ez áll: „a címből: Láb"). Több szabálynál az ELSŐ
 * címke marad — a „Láb + farizom" farizma így „Láb" marad, nem kettőződik.
 */
export function groupsFromTitle(title) {
  const lower = String(title ?? '')
    .slice(0, MAX_TITLE_LENGTH)
    .toLowerCase();
  const words = lower.split(/[^\p{L}]+/u).filter(Boolean);
  const found = new Map();

  for (const word of words) {
    const plain = normalizeName(word);
    for (const rule of TITLE_RULES) {
      const hit =
        rule.exact.includes(plain) ||
        rule.prefix.some((prefix) => word.startsWith(prefix) || plain.startsWith(prefix));
      if (!hit) continue;
      for (const group of rule.groups) if (!found.has(group)) found.set(group, rule.label);
    }
  }
  return found;
}

/** A gyakorlat elsődleges izomcsoportja: a legnagyobb súlyú a terhelésben. */
function primaryGroup(load) {
  let best = null;
  for (const [group, share] of Object.entries(load)) {
    if (best === null || share > load[best]) best = group;
  }
  return best;
}

/**
 * Ajánlott gyakorlatok.
 *
 * @param {object}   input
 * @param {string}   input.title    az edzés (vagy terv) neve, ahogy a mezőben áll
 * @param {object}   [input.report] a computeReadiness riportja; hiányában csak
 *                                  a cím számít (a terv-építő ilyen: a mai
 *                                  készenlét egy jövőbeli tervről nem mond semmit)
 * @param {Array}    input.catalog  a TELJES gyakorlat-katalógus (a `load`-dal)
 * @param {Array}    [input.workouts] a felhasználó mentett edzései — ami
 *                                  gyakran szerepel bennük, az előrébb kerül
 * @returns {{ titleLabels: string[], readiness: 'used'|'unknown'|'off',
 *             suggestions: Array<{ name: string, group: string,
 *                                  reasons: Array<{ kind: string, text: string }> }> }}
 */
export function suggestExercises({ title, report = null, catalog, workouts = [] }) {
  const fromTitle = groupsFromTitle(title);

  /* A fájdalom a riport NYERS mezőjéből jön, nem a readiness-számból: a 30-as
     sapka egy alacsony számot ad, de a tiltás nem „alacsony készenlét",
     hanem kizárás — ezt a cím sem írhatja felül. */
  const muscles = report?.muscles ?? [];
  const painful = new Set(muscles.filter((m) => m.pain !== null && m.pain >= 7).map((m) => m.key));

  /* A regeneráltság csak akkor jel, ha a motor tud róla valamit (known). A
     friss fiók 100-asa nem „teljesen pihent", hanem adathiány — ugyanaz a
     csapda, amit a recovery.js is kerül.
     Sapkás napon (rossz közérzet, kimerültség + stressz, fájdalom) egy izom
     sem lehet jobb a napnál: különben egy pihent mellre „92% regenerált"
     indoklással hívnánk be valakit, akinek a motor könnyű napot mond. */
  const ceiling = report?.caps?.length > 0 && report.overall !== null ? report.overall : null;
  const readinessOf = new Map(
    muscles
      .filter((m) => m.known)
      .map((m) => [m.key, ceiling === null ? m.readiness : Math.min(m.readiness, ceiling)]),
  );
  const readiness = !report ? 'off' : readinessOf.size > 0 ? 'used' : 'unknown';

  /* Izomcsoportok sorrendje. A két jel EGYENRANGÚ, és ezt a sorrend is
     betartja: elöl az, amit MINDKÉT jel támogat, utána a csak-cím és a
     csak-regenerált csoportok VÁLTAKOZVA.
     Nem elég a készenlét szerint rendezni: egy kemény lábnap másnapján a
     „Lábnap" cím csoportjai 40% körül állnak, a pihent felsőtest 100%-on — a
     rendezés a cím összes csoportját a lista végére, a nyolcas korlát mögé
     tolta, és a „Lábnap"-ra egyetlen lábgyakorlat sem jött (valódi adaton
     mérve). A váltakozás mellett egyik jel sem szoríthatja ki a másikat. */
  const byScore = (a, b) => (b.score ?? -1) - (a.score ?? -1);
  const candidates = MUSCLE_KEYS.filter((key) => !painful.has(key)).map((key) => {
    const score = readinessOf.get(key) ?? null;
    return {
      key,
      score,
      inTitle: fromTitle.has(key),
      ready: score !== null && score >= READY_THRESHOLD,
    };
  });
  const both = candidates.filter((g) => g.inTitle && g.ready).sort(byScore);
  const titleOnly = candidates.filter((g) => g.inTitle && !g.ready).sort(byScore);
  const readyOnly = candidates.filter((g) => !g.inTitle && g.ready).sort(byScore);
  const groups = [...both];
  for (let i = 0; i < Math.max(titleOnly.length, readyOnly.length); i++) {
    if (titleOnly[i]) groups.push(titleOnly[i]);
    if (readyOnly[i]) groups.push(readyOnly[i]);
  }

  if (groups.length === 0) {
    return { titleLabels: uniqueLabels(fromTitle, painful), readiness, suggestions: [] };
  }

  // Amit a felhasználó már csinált, az előrébb: egy ajánlás, amit ismer,
  // többet ér egy katalógus-különlegességnél.
  const history = new Map();
  for (const workout of workouts) {
    for (const exercise of workout.exercises ?? []) {
      const key = normalizeName(exercise.name);
      history.set(key, (history.get(key) ?? 0) + 1);
    }
  }

  /* Jelöltek izomcsoportonként. Kimarad a kardió és a nyújtás (izom-
     regenerációhoz nem köthető ajánlás), és minden gyakorlat, ami BÁRMELYIK
     fájdalmas csoportot terheli — másodlagosan is. */
  const byGroup = new Map(groups.map((group) => [group.key, []]));
  catalog.forEach((entry, order) => {
    if (entry.logMode === 'duration' || entry.group === 'Kardió' || entry.tag === 'Nyújtás') return;
    const load = resolveExerciseLoad(entry.name, catalog);
    if (Object.keys(load).some((group) => painful.has(group))) return;
    const bucket = byGroup.get(primaryGroup(load));
    if (!bucket) return;
    bucket.push({
      entry,
      order,
      used: history.get(normalizeName(entry.name)) ?? 0,
      curated: entry.loadSource === 'curated',
      compound: entry.tag === 'Összetett',
    });
  });

  const seen = new Set();
  const suggestions = [];
  for (const group of groups) {
    const picks = byGroup
      .get(group.key)
      .sort(
        (a, b) =>
          b.used - a.used ||
          Number(b.curated) - Number(a.curated) ||
          Number(b.compound) - Number(a.compound) ||
          a.order - b.order,
      )
      .filter(({ entry }) => !seen.has(entry.name))
      .slice(0, PER_GROUP);

    for (const { entry } of picks) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      seen.add(entry.name);
      suggestions.push({
        name: entry.name,
        group: group.key,
        reasons: reasonsFor(group, fromTitle),
      });
    }
  }

  return { titleLabels: uniqueLabels(fromTitle, painful), readiness, suggestions };
}

/** Az indoklás sorai. A regeneráltságot a címből jött javaslatnál is
    kiírjuk, ha alacsony — különben a „Láb" cím egy 45%-os lábra is
    rábólintana szó nélkül. */
function reasonsFor(group, fromTitle) {
  const reasons = [];
  if (group.inTitle) reasons.push({ kind: 'title', text: `a címből: ${fromTitle.get(group.key)}` });
  if (group.score !== null) {
    const label = MUSCLE_GROUPS[group.key];
    reasons.push(
      group.ready
        ? { kind: 'ready', text: `${label} ${group.score}% regenerált` }
        : { kind: 'low', text: `${label} csak ${group.score}% regenerált` },
    );
  }
  return reasons;
}

/** A felismert cím-címkék (a felület kiírja, mit értett a címből). A
    fájdalom miatt kizárt csoport címkéje is benne marad, ha más csoportja
    él — a „Láb" attól még láb, hogy a vádli fáj. */
function uniqueLabels(fromTitle, painful) {
  const labels = [];
  for (const [group, label] of fromTitle) {
    if (!painful.has(group) && !labels.includes(label)) labels.push(label);
  }
  return labels;
}
