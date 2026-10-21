/**
 * Podium — modul áthelyezése az importok átírásával (ideiglenes eszköz)
 * ------------------------------------------------------------------------
 * A funkció-mappákba rendezéshez (docs/superpowers/plans/2026-10-20-…):
 * `git mv`, majd a server, public/js, tests, scripts minden .js fájljában
 * minden relatív specifikátort (`from '…'`, `import '…'`, `import('…')`),
 * amely a régi fájlra mutat, az újra írja át. Az áthelyezett fájl saját
 * relatív importjait az új helyéhez igazítja. A terv végén törlendő.
 *
 * Használat (utak a repo gyökeréhez képest):
 *   node scripts/move-module.js <régi> <új>
 *   node scripts/move-module.js --redirect <régi> <új>   (csak az importálók)
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['server', 'public/js', 'tests', 'scripts'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)'(\.{1,2}\/[^']+)'/g;

function specifierFor(fromFile, target) {
  const spec = path.relative(path.dirname(fromFile), target).split(path.sep).join('/');
  return spec.startsWith('.') ? spec : `./${spec}`;
}

const args = process.argv.slice(2);
const redirect = args[0] === '--redirect';
const [oldRel, newRel] = redirect ? args.slice(1) : args;
if (!oldRel || !newRel) {
  console.error('Használat: node scripts/move-module.js [--redirect] <régi> <új>');
  process.exit(1);
}
const oldAbs = path.resolve(ROOT, oldRel);
const newAbs = path.resolve(ROOT, newRel);

if (!redirect) {
  mkdirSync(path.dirname(newAbs), { recursive: true });
  execFileSync('git', ['mv', oldRel, newRel], { cwd: ROOT, stdio: 'inherit' });
}

const changed = [];
for (const file of DIRS.flatMap((dir) => walk(path.join(ROOT, dir)))) {
  // Az áthelyezett fájl specifikátorai még a régi helyéhez képest relatívak.
  const resolvedFrom = !redirect && file === newAbs ? oldAbs : file;
  const src = readFileSync(file, 'utf8');
  const out = src.replace(SPECIFIER, (match, head, spec) => {
    const resolved = path.resolve(path.dirname(resolvedFrom), spec);
    const target = resolved === oldAbs ? newAbs : resolved;
    const next = specifierFor(file, target);
    return next === spec ? match : `${head}'${next}'`;
  });
  if (out !== src) {
    writeFileSync(file, out);
    changed.push(path.relative(ROOT, file).split(path.sep).join('/'));
  }
}
console.log(changed.length ? changed.join('\n') : '(nincs átírt import)');
