/**
 * FitTrack Pro — gyakorlat-katalógus generátor a külső datasetből
 * ==============================================================
 * Forrás: https://github.com/hasaneyldrm/exercises-dataset (1324 gyakorlat)
 * Kimenet: server/data/exercises.exdb.js — GENERÁLT fájl, kézzel NE szerkeszd.
 *
 * Futtatás:  npm run exdb:build
 *
 * Mit csinál
 * ----------
 *   1. Letölti (ha még nincs meg) a dataset exercises.json-ját a .exdb/
 *      munkakönyvtárba. Az a könyvtár .gitignore-olt: 17 MB, nem tartozik a
 *      repóba, és a build bármikor újra elő tudja állítani.
 *   2. Kiszűri, amit nem tudunk értelmesen megjeleníteni (nyak-gyakorlatok:
 *      nincs hozzájuk illő szűrő-chip és regenerációs izomcsoport).
 *   3. Lefordítja a nevet az exdb.names.hu.js szótárral. Ami MARADÉK NÉLKÜL
 *      lefordul, az bekerül; ami nem, az a jelentésbe megy — a katalógusra
 *      sosem kerül angol név.
 *   4. Származtatja a `load` súlyokat (exdb.map.js deriveLoad), a címkét és a
 *      kártya izom-szövegét.
 *   5. Kihagyja azt, aminek a magyar neve ütközik a KÉZZEL kurált
 *      katalógussal (server/data.js) — ott a kézi adat a jobb, mert a `load`
 *      súlyai mértek, nem becsültek.
 *
 * A futás végén összefoglalót ír, és a .exdb/report.txt-be kirakja a ki nem
 * fordult neveket az ismeretlen szavak gyakoriságával — abból látszik, melyik
 * új szótári sor hozná a legtöbb új gyakorlatot.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveLoad, deriveTag, musclesLabel, BODY_PART_TO_GROUP, EQUIPMENT_LABEL_HU } from '../server/data/exdb.map.js';
import { PHRASES, NAME_OVERRIDES, PARENTHETICAL_DROP } from '../server/data/exdb.names.hu.js';
import { exercises as curatedExercises } from '../server/data/exercises.hu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WORK_DIR = path.join(ROOT, 'server', 'data', '.exdb');
const SOURCE_JSON = path.join(WORK_DIR, 'exercises.json');
const OUT_FILE = path.join(ROOT, 'server', 'data', 'exercises.exdb.js');
const REPORT_FILE = path.join(WORK_DIR, 'report.txt');
const SOURCE_URL = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json';

/* ======================================================================
   Névfordítás
   ====================================================================== */

/** A szótár kereshető alakja: kifejezés → magyar. A build ellenőrzi, hogy
    nincs duplikált kulcs — egy véletlen második `['press', …]` sor csendben
    felülírná az elsőt, és az egész katalóguson meglátszana. */
function buildPhraseMap() {
  const map = new Map();
  for (const [phrase, hu] of PHRASES) {
    const key = phrase.toLowerCase();
    if (map.has(key)) throw new Error(`Duplikált szótári kulcs: "${phrase}" (exdb.names.hu.js)`);
    map.set(key, hu);
  }
  // A leghosszabb kifejezés nyer, ezért tudnunk kell, hány szavas a leghosszabb.
  const maxWords = Math.max(...[...map.keys()].map((k) => k.split(' ').length));
  return { map, maxWords };
}

/** A forrás néhány neve sérült kódolással érkezik (`sled 45в° leg press`):
    cp1251-ben olvasott UTF-8 fok-jel. Ezt és a többi tipográfiai zajt itt
    takarítjuk, MIELŐTT bármit keresnénk a szótárban. */
function normalizeSourceName(raw) {
  return raw
    .replace(/в°/g, '°')
    .replace(/[‘’]/g, "'")
    .replace(/_/g, ' ')            // `row_shoulder` — elgépelt aláhúzás a forrásban
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Szám- és jelszerű tokenek (3/4, 45°, 2) fordítás nélkül átmennek. */
const PASSTHROUGH = /^[\d]+([/.,°-][\d°]*)*$/;

/**
 * Egy név fordítása. Visszaad `{ hu }`-t siker esetén, vagy `{ unknown: [...] }`-t,
 * ha maradt lefordítatlan szó.
 */
function translateName(rawName, phrases) {
  let name = normalizeSourceName(rawName);
  let suffix = '';

  // 1. Verzió-utótag (`… v. 2`, `… v2`). A forrásban ez ugyanannak a
  //    gyakorlatnak egy másik kameraállású felvétele, tehát önálló gyakorlat
  //    — a magyar névben jelöljük, különben ütközne az alapváltozattal.
  const version = name.match(/\s+v\.?\s*(\d+)$/);
  if (version) {
    name = name.slice(0, version.index).trim();
    suffix = ` (${version[1]}. változat)`;
  }

  // 2. Zárójeles kiegészítés a név végén. NEM fix listából fordítjuk, hanem
  //    ugyanazzal a szótárral, mint a nevet — így a szótár bővítése a
  //    zárójeles részeket is automatikusan megnyitja.
  const paren = name.match(/\s*\(([^)]*)\)\s*$/);
  if (paren) {
    const inner = paren[1].trim().replace(/,/g, '');
    name = name.slice(0, paren.index).trim();
    if (inner in PARENTHETICAL_DROP) {
      // `(male)`, `(POV)` — felvételi jelölés, a névbe nem való.
    } else {
      const innerHu = translatePhrase(inner, phrases);
      if (innerHu.unknown) return { unknown: innerHu.unknown.map((w) => `(${w})`) };
      suffix = ` (${innerHu.hu})${suffix}`;
    }
  }

  // 3. A név KÖZEPÉN álló zárójel (`cable one arm (with rope) extension`).
  //    Itt a zárójel csak pontosít, nem tagol — a jelölést eldobjuk, a
  //    tartalma a névbe olvad, és a szokásos módon fordul.
  name = name.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();

  // 4. Teljes névre illeszkedő kivétel.
  if (name in NAME_OVERRIDES) return { hu: NAME_OVERRIDES[name] + suffix };

  const translated = translatePhrase(name, phrases);
  if (translated.unknown) return { unknown: translated.unknown };
  const hu = translated.hu;
  return { hu: hu.charAt(0).toUpperCase() + hu.slice(1) + suffix };
}

/**
 * Szótári fordítás egy szóláncra, leghosszabb-találat-előnnyel. Ez a
 * translateName magja; külön függvény, mert a zárójeles kiegészítésekre
 * ugyanez fut le.
 */
function translatePhrase(text, { map, maxWords }) {
  const tokens = text.split(' ').filter(Boolean);
  const parts = [];
  const unknown = [];
  let i = 0;
  while (i < tokens.length) {
    let matched = false;
    for (let len = Math.min(maxWords, tokens.length - i); len >= 1; len -= 1) {
      const key = tokens.slice(i, i + len).join(' ');
      if (map.has(key)) {
        const hu = map.get(key);
        if (hu) parts.push(hu);
        i += len;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Többes szám visszavezetése egyes számra: „dips” → „dip”,
    // „presses” → „press”. Csak akkor, ha az egyes szám ismert a szótárban.
    const token = tokens[i];
    const singular = [/es$/, /s$/].map((re) => token.replace(re, '')).find((s) => s !== token && map.has(s));
    if (PASSTHROUGH.test(token)) {
      parts.push(token);
    } else if (token === '-' || token === '—') {
      // a puszta kötőjel kimarad a magyar névből
    } else if (singular !== undefined) {
      const hu = map.get(singular);
      if (hu) parts.push(hu);
    } else {
      unknown.push(token);
    }
    i += 1;
  }

  if (unknown.length) return { unknown };

  const hu = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (!hu) return { unknown: ['<üres fordítás>'] };
  return { hu };
}

/* ======================================================================
   Forrás beszerzése
   ====================================================================== */

async function loadSource() {
  await fs.mkdir(WORK_DIR, { recursive: true });
  try {
    return JSON.parse(await fs.readFile(SOURCE_JSON, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  console.log(`↓ exercises.json letöltése (~17 MB)…`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`A dataset letöltése nem sikerült: HTTP ${res.status}`);
  const text = await res.text();
  await fs.writeFile(SOURCE_JSON, text);
  console.log(`  → ${path.relative(ROOT, SOURCE_JSON)}`);
  return JSON.parse(text);
}

/* ======================================================================
   Build
   ====================================================================== */

async function main() {
  const source = await loadSource();
  const phrases = buildPhraseMap();

  // A kézzel kurált nevek — ezek MINDIG nyernek a generálttal szemben.
  const curatedNames = new Set(curatedExercises.map((e) => e.name.toLowerCase()));

  const entries = [];
  const mediaForCurated = [];             // kurált gyakorlatokhoz átvehető média
  const mediaSeen = new Set();
  const seen = new Map();                 // magyar név → már bevett extId
  const stats = { total: source.length, skippedGroup: 0, untranslated: 0, duplicate: 0, curatedWins: 0, noLoad: 0 };
  const failures = [];
  const unknownTally = new Map();

  for (const record of source) {
    const group = BODY_PART_TO_GROUP[record.body_part];
    if (group === undefined) throw new Error(`Ismeretlen body_part: "${record.body_part}"`);
    if (group === null) { stats.skippedGroup += 1; continue; }

    const translated = translateName(record.name, phrases);
    if (translated.unknown) {
      stats.untranslated += 1;
      failures.push({ id: record.id, name: record.name, unknown: translated.unknown });
      for (const word of translated.unknown) unknownTally.set(word, (unknownTally.get(word) || 0) + 1);
      continue;
    }
    const name = translated.hu;

    // Ütközés egy kurált gyakorlattal: a sor NEM kerül a katalógusba (ott a
    // kézi `load` a jobb), de a médiáját külön listába tesszük — a
    // catalog.js abból pótolja a kurált gyakorlatok illusztrációját.
    if (curatedNames.has(name.toLowerCase())) {
      stats.curatedWins += 1;
      if (!mediaSeen.has(name.toLowerCase())) {
        mediaSeen.add(name.toLowerCase());
        mediaForCurated.push({
          name,
          equipment: EQUIPMENT_LABEL_HU[record.equipment] || record.equipment,
          extId: record.id,
          image: record.image,
          gif: record.gif_url,
        });
      }
      continue;
    }
    if (seen.has(name.toLowerCase())) { stats.duplicate += 1; continue; }

    const load = deriveLoad(record);
    if (!load) { stats.noLoad += 1; continue; }

    seen.set(name.toLowerCase(), record.id);
    entries.push({
      name,
      tag: deriveTag(record.name, load),
      muscles: musclesLabel(record),
      group,
      load,
      loadSource: 'derived',
      equipment: EQUIPMENT_LABEL_HU[record.equipment] || record.equipment,
      extId: record.id,
      image: record.image,
      gif: record.gif_url,
    });
  }

  stats.variantsDropped = collapseVariants(entries, curatedNames);
  entries.sort((a, b) => a.group.localeCompare(b.group, 'hu') || a.name.localeCompare(b.name, 'hu'));
  matchCuratedBySuffix(curatedExercises, entries, mediaForCurated, mediaSeen);
  stats.mediaForCurated = mediaForCurated.length;
  mediaForCurated.sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  await fs.writeFile(OUT_FILE, renderModule(entries, mediaForCurated), 'utf8');
  await fs.writeFile(REPORT_FILE, renderReport(failures, unknownTally), 'utf8');

  const byGroup = entries.reduce((acc, e) => ({ ...acc, [e.group]: (acc[e.group] || 0) + 1 }), {});
  console.log(`\n✓ ${entries.length} gyakorlat → ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`  csoportonként: ${Object.entries(byGroup).map(([g, n]) => `${g} ${n}`).join(' · ')}`);
  console.log(`\n  forrás összesen        ${stats.total}`);
  console.log(`  kihagyva (nyak)        ${stats.skippedGroup}`);
  console.log(`  nem fordult le         ${stats.untranslated}   → ${path.relative(ROOT, REPORT_FILE)}`);
  console.log(`  kurált nyert           ${stats.curatedWins}`);
  console.log(`  kurálthoz párosított média ${stats.mediaForCurated} / ${curatedExercises.length}`);
  console.log(`  magyar név ütközés     ${stats.duplicate}`);
  console.log(`  variáns kigyomlálva    ${stats.variantsDropped}`);
  console.log(`  nincs terhelés         ${stats.noLoad}`);
}

/**
 * A `… (2. változat)` sorok gyomlálása. A forrásban ezek NEM külön
 * gyakorlatok, csak ugyanannak a mozgásnak egy másik kameraállású felvétele.
 *
 *   · Ha az alapváltozat is bent van a katalógusban, a variáns FELESLEGES —
 *     kiesik. Egy 1400 elemű listában semmit nem ad, hogy ugyanaz a
 *     gyakorlat kétszer szerepel, viszont a keresést hígítja.
 *   · Ha nincs alapváltozat (a forrás csak a „2. változat”-ot tartalmazza),
 *     a jelölés félrevezető — mihez képest második? Ilyenkor a sor marad, de
 *     a nevéről lekerül a toldalék.
 *
 * @returns {number} a kidobott sorok száma
 */
function collapseVariants(entries, curatedNames) {
  const VARIANT = / \(\d+\. változat\)$/;
  const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
  let dropped = 0;

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!VARIANT.test(entry.name)) continue;

    const base = entry.name.replace(VARIANT, '');
    const baseKey = base.toLowerCase();
    if (names.has(baseKey) || curatedNames.has(baseKey)) {
      entries.splice(i, 1);
      names.delete(entry.name.toLowerCase());
      dropped += 1;
    } else {
      names.delete(entry.name.toLowerCase());
      entry.name = base;
      names.add(baseKey);
    }
  }
  return dropped;
}

/**
 * Média-párosítás a kurált gyakorlatokhoz NÉVUTÓTAG alapján.
 *
 * A kurált nevek szándékosan generikusak („Fekvenyomás”, „Guggolás”), a
 * generáltak viszont a felszerelést is kimondják („Rudas fekvenyomás”),
 * mert a forrásban minden variáns külön sor. Emiatt a pontos névegyezés
 * alig talál — pedig épp az alapgyakorlatokhoz kellene a legjobban az
 * illusztráció.
 *
 * A szabály: a generált név szó-határon VÉGZŐDJÖN a kurált névvel, és a
 * csoportjuk egyezzen. Több találatból előbb a FELSZERELÉS dönt (a rúd a
 * legtipikusabb tanuló-kép, utána a saját testsúly, és csak a végén a
 * gumiszalag), holtversenyben pedig a LEGRÖVIDEBB név nyer, mert az a
 * legkevesebb módosítót tartalmazó, tehát a legalapabb változat — a
 * „Fekvenyomás”-hoz a sima rudas fekvenyomás kerül, nem a „Ferde szűk
 * fogású kézisúlyzós fekvenyomás”.
 */
const EQUIPMENT_RANK = [
  'Rúd', 'Saját testsúly', 'Kézisúlyzó', 'Gép', 'Smith-gép', 'Kábelgép',
  'EZ-rúd', 'Kettlebell', 'Fitneszlabda', 'Gumiszalag',
];
const equipmentRank = (equipment) => {
  const index = EQUIPMENT_RANK.indexOf(equipment);
  return index === -1 ? EQUIPMENT_RANK.length : index;
};
function matchCuratedBySuffix(curated, generated, mediaForCurated, mediaSeen) {
  for (const exercise of curated) {
    const key = exercise.name.toLowerCase();
    if (mediaSeen.has(key)) continue;         // pontos névegyezés már volt

    const candidates = generated.filter((entry) => {
      const name = entry.name.toLowerCase();
      if (!name.endsWith(key)) return false;
      // Szó-határ: a „…vádliemelés” ne illeszkedjen az „emelés”-re.
      return name.length === key.length || name[name.length - key.length - 1] === ' ';
    });
    if (!candidates.length) continue;

    /* A csoportegyezés PREFERENCIA, nem feltétel. A két oldal csoportosítása
       ugyanis nem mindig fedi egymást: a felhúzás nálunk 'Hát', a forrásban
       viszont 'upper legs' → 'Láb'. A mozgás neve azonos, tehát a gif akkor
       is a jót mutatja — kár lenne emiatt kép nélkül hagyni. */
    const best = candidates.reduce((a, b) => {
      const byGroup = Number(b.group === exercise.group) - Number(a.group === exercise.group);
      if (byGroup !== 0) return byGroup > 0 ? b : a;
      const byEquipment = equipmentRank(b.equipment) - equipmentRank(a.equipment);
      if (byEquipment !== 0) return byEquipment < 0 ? b : a;
      return b.name.length < a.name.length ? b : a;
    });
    mediaSeen.add(key);
    mediaForCurated.push({
      name: exercise.name,
      equipment: best.equipment,
      extId: best.extId,
      image: best.image,
      gif: best.gif,
    });
  }
}

/** A generált modul szövege. Szándékosan olvasható (soronként egy gyakorlat),
    hogy a git diff értelmes maradjon, amikor a szótár bővül. */
function renderModule(entries, mediaForCurated) {
  const header = `/**
 * FitTrack Pro — GENERÁLT gyakorlat-katalógus. KÉZZEL NE SZERKESZD.
 * ================================================================
 * Előállítja: scripts/build-exdb.js  (npm run exdb:build)
 * Forrás: https://github.com/hasaneyldrm/exercises-dataset
 *   · szöveges adat: MIT licenc
 *   · média (image/gif): © Gym visual — https://gymvisual.com/
 *     Csak 180×180-ban, attribúcióval terjeszthető. A fájlokat a
 *     scripts/fetch-exdb-media.js tölti le a public/exercises/ alá; azok
 *     .gitignore-oltak, a repóba NEM kerülnek be.
 *
 * A \`load\` súlyok SZÁRMAZTATOTTAK (loadSource: 'derived'): a forrásban nincs
 * súlyozás, csak elsődleges/másodlagos izomlista — a 60/40 becslést az
 * exdb.map.js deriveLoad() végzi. Ahol kézzel mért súly van (server/data.js),
 * ott az nyer: az ütköző neveket a build kihagyja.
 *
 * Gyakorlatok: ${entries.length}
 */

export const exdbExercises = [
`;
  const body = entries.map((e) => {
    const load = Object.entries(e.load).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `  { name: ${q(e.name)}, tag: ${q(e.tag)}, muscles: ${q(e.muscles)}, group: ${q(e.group)},\n`
      + `    load: { ${load} }, loadSource: 'derived', equipment: ${q(e.equipment)},\n`
      + `    extId: ${q(e.extId)}, image: ${q(e.image)}, gif: ${q(e.gif)} },`;
  }).join('\n');

  const mediaHeader = `

/**
 * Média a KURÁLT gyakorlatokhoz. Ezek a nevek ütköztek a kézzel írt
 * katalógussal (server/data/exercises.hu.js), ezért maguk a gyakorlatok nem
 * kerültek be — a \`load\` súlyaik becsültek lettek volna, a kuráltaké viszont
 * szándékos döntés. Az illusztrációjukat viszont kár lenne eldobni: pont a
 * legfontosabb alapgyakorlatokról van szó. A catalog.js ezt a listát
 * olvasztja rá név szerint a kurált sorokra.
 *
 * Bejegyzések: ${mediaForCurated.length}
 */

export const exdbMediaForCurated = [
`;
  const mediaBody = mediaForCurated.map((e) => (
    `  { name: ${q(e.name)}, equipment: ${q(e.equipment)},\n`
    + `    extId: ${q(e.extId)}, image: ${q(e.image)}, gif: ${q(e.gif)} },`
  )).join('\n');

  return `${header}${body}\n];\n${mediaHeader}${mediaBody}\n];\n`;
}

const q = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** A jelentés a szótár bővítéséhez: mely szavak blokkolják a legtöbb nevet. */
function renderReport(failures, unknownTally) {
  const ranked = [...unknownTally].sort((a, b) => b[1] - a[1]);
  const lines = [
    'LE NEM FORDULT GYAKORLATNEVEK',
    '=============================',
    'A katalógusba csak maradék nélkül lefordított név kerül be. Az alábbi',
    'szavak felvétele a server/data/exdb.names.hu.js PHRASES listájába nyitja',
    'meg a legtöbb további gyakorlatot.',
    '',
    `Ismeretlen szavak gyakoriság szerint (${ranked.length} db):`,
    '',
    ...ranked.map(([word, count]) => `  ${String(count).padStart(4)}×  ${word}`),
    '',
    '',
    `Érintett nevek (${failures.length} db):`,
    '',
    ...failures.map((f) => `  ${f.id}  ${f.name}   [${f.unknown.join(', ')}]`),
  ];
  return lines.join('\n');
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
});
