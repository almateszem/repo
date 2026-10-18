/**
 * Podium — fölöslegesen exportált nevek keresése
 * ------------------------------------------------------------------------
 * Minden exportált név, amely a saját modulján KÍVÜL sehol nem szerepel
 * azonosítóként (sem importban, sem `modul.név` hozzáférésként, sem a
 * tesztekben). Az ilyen export vagy halott, vagy csak belül használt — az
 * utóbbinál az `export` kulcsszó hazudik a modul felületéről.
 *
 * Szándékosan durva és óvatos: ami BÁRHOL máshol előfordul a névvel, az
 * használtnak számít (inkább maradjon egy fölösleges export, mint hogy egy
 * élő név listára kerüljön). A tests/unused-exports.test.js futtatja.
 *
 * Használat: node scripts/check-exports.js  (a kimenet: fájl: név)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A vizsgált forrás (exportálók) és a hivatkozók köre. */
const SOURCE_DIRS = ['server', 'public/js'];
const REFERENCE_DIRS = ['server', 'public', 'tests', 'scripts'];
/** Generált vagy adat-modulok: az exportjuk a build/seed felülete — nem
    vizsgáljuk őket, de HIVATKOZÓKÉNT számítanak. */
const SKIP_SOURCES = /server[\\/]data[\\/]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(m?js|html)$/.test(name)) out.push(full);
  }
  return out;
}

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(
    /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) {
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (name) names.add(name);
    }
  }
  return names;
}

export function unusedExports() {
  const sources = SOURCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))).filter(
    (f) => f.endsWith('.js') && !SKIP_SOURCES.test(f),
  );
  const references = REFERENCE_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
  const texts = new Map(
    references.map((file) => [file, stripComments(readFileSync(file, 'utf8'))]),
  );

  const result = [];
  for (const file of sources) {
    const own = texts.get(file) ?? stripComments(readFileSync(file, 'utf8'));
    for (const name of exportedNames(own)) {
      const re = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
      const usedElsewhere = [...texts].some(([other, text]) => other !== file && re.test(text));
      if (!usedElsewhere) result.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}: ${name}`);
    }
  }
  return result.sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const list = unusedExports();
  console.log(list.join('\n') || '(nincs)');
}
