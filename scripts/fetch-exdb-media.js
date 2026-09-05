/**
 * FitTrack Pro — gyakorlat-média letöltése
 * ========================================
 * A generált katalógus (server/data/exercises.exdb.js) által HIVATKOZOTT
 * képeket és gifeket tölti le a public/exercises/ alá. Csak azt, amire
 * tényleg szükség van — a forrás-repo teljes klónozása 125 MB, és a nem
 * használt gyakorlatok média-fájljaira nincs okunk helyet pazarolni.
 *
 * Futtatás:
 *   npm run exdb:media            — minden hivatkozott fájl
 *   npm run exdb:media -- --limit 50   — csak az első 50 gyakorlat (gyors próba)
 *
 * A letöltés FOLYTATHATÓ: a már meglévő fájlokat átugorja, tehát megszakítás
 * után elég újra elindítani.
 *
 * ⚠ LICENC — ezt fontos érteni
 * ---------------------------
 * A képek és gifek NEM a dataset szerzőjéé, hanem a Gym visual-é
 * (https://gymvisual.com/), és a forrás-repo NOTICE.md-je kiköti:
 *   · kizárólag 180×180-as felbontásban terjeszthetők (ezért a letöltő nem
 *     méretez át és nem konvertál semmit),
 *   · minden megjelenésnél ott kell lennie a `© Gym visual` jelölésnek
 *     (ezt a felület a gyakorlat-választóban ki is teszi),
 *   · a repo klónozása önmagában NEM ad jogot a médiára — saját, éles
 *     felhasználáshoz a Gym visual feltételeit kell megnézni.
 * Ezért is marad a média a .gitignore mögött: a projekt a HIVATKOZÁST tárolja,
 * nem a fájlokat.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exdbExercises, exdbMediaForCurated } from '../server/data/exercises.exdb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const TARGET_DIR = path.join(ROOT, 'public', 'exercises');
const BASE_URL = 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/';

/** Egyszerre ennyi fájl tölt. Nyers raw.githubusercontent — a túl magas
    párhuzamosság itt nem gyorsít, viszont 429-et hozhat. */
const CONCURRENCY = 8;

const ATTRIBUTION = `Az ebben a könyvtárban lévő képek és animációk forrása:

    © Gym visual — https://gymvisual.com/

Közvetítő: https://github.com/hasaneyldrm/exercises-dataset (NOTICE.md)

Feltételek: kizárólag 180×180-as felbontásban terjeszthetők, a fenti
attribúció megtartásával. A fájlok NEM részei a git repónak (.gitignore) —
a scripts/fetch-exdb-media.js tölti le őket. Éles, nyilvános használat előtt
a Gym visual feltételeit külön meg kell nézni:
https://gymvisual.com/content/3-terms-and-conditions-of-use
`;

/** A letöltendő fájlok listája a katalógusból, duplikátumok nélkül. */
function mediaPaths(exercises) {
  const paths = new Set();
  for (const exercise of exercises) {
    paths.add(exercise.image);
    paths.add(exercise.gif);
  }
  return [...paths];
}

/** Egy fájl letöltése, ha még nincs meg. Visszaadja, mi történt. */
async function fetchOne(relPath) {
  const target = path.join(TARGET_DIR, relPath);
  try {
    const stat = await fs.stat(target);
    if (stat.size > 0) return 'skipped';
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const res = await fetch(BASE_URL + relPath);
  if (!res.ok) return `hiba HTTP ${res.status}`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Előbb ideiglenes néven írunk, majd átnevezünk: egy megszakított futás így
  // nem hagy csonka fájlt, amit a következő futás késznek hinne.
  const tmp = `${target}.part`;
  await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
  await fs.rename(tmp, target);
  return 'downloaded';
}

/** Feladatsor `CONCURRENCY` párhuzamos munkással. */
async function runPool(items, worker) {
  let index = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      await worker(items[current], current);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;
  if (Number.isNaN(limit) || limit <= 0) throw new Error('A --limit pozitív egész szám kell legyen.');

  // A kurált gyakorlatokhoz párosított média is kell: azok a sorok nincsenek
  // benne az exdbExercises listában (a kurált változat nyert), a felület
  // viszont az ő képüket mutatja az alapgyakorlatoknál.
  const exercises = [...exdbExercises, ...exdbMediaForCurated].slice(0, limit);
  const paths = mediaPaths(exercises);

  await fs.mkdir(TARGET_DIR, { recursive: true });
  await fs.writeFile(path.join(TARGET_DIR, 'ATTRIBUTION.txt'), ATTRIBUTION, 'utf8');

  console.log(`${exercises.length} gyakorlat · ${paths.length} médiafájl → ${path.relative(ROOT, TARGET_DIR)}`);
  if (limit === Infinity) console.log('(a teljes készlet ~115 MB; a futás bármikor megszakítható és folytatható)\n');

  const counts = { downloaded: 0, skipped: 0, failed: 0 };
  const errors = [];
  await runPool(paths, async (relPath) => {
    const result = await fetchOne(relPath);
    if (result === 'downloaded') counts.downloaded += 1;
    else if (result === 'skipped') counts.skipped += 1;
    else { counts.failed += 1; errors.push(`${relPath}: ${result}`); }

    const done = counts.downloaded + counts.skipped + counts.failed;
    if (done % 100 === 0 || done === paths.length) {
      process.stdout.write(`\r  ${done}/${paths.length} — letöltve ${counts.downloaded}, meglévő ${counts.skipped}, hiba ${counts.failed}`);
    }
  });

  console.log('\n');
  if (errors.length) {
    console.log(`✗ ${errors.length} fájl nem jött le:`);
    for (const line of errors.slice(0, 10)) console.log(`   ${line}`);
    if (errors.length > 10) console.log(`   … és még ${errors.length - 10}`);
    console.log('  Futtasd újra — a meglévőket átugorja.');
    process.exitCode = 1;
  } else {
    console.log('✓ Kész.');
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
});
