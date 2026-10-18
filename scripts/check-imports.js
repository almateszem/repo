/**
 * Podium — a statikus importok nevei léteznek-e
 * ------------------------------------------------------------------------
 * Minden `import { név } from './…'` neve szerepel-e a célmodul exportjai
 * között (az `export * from` láncokat is követve). Az ESLint ezt nem nézi,
 * a böngésző viszont az EGÉSZ modulgráfot elutasítja egyetlen hiányzó névre —
 * a felület el sem indul. A tests/import-names.test.js futtatja.
 *
 * Használat: node scripts/check-imports.js
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ');
const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const cache = new Map();

function exportsOf(file) {
  if (cache.has(file)) return cache.get(file);
  const names = new Set();
  cache.set(file, names);
  const src = stripComments(readFileSync(file, 'utf8'));
  for (const m of src.matchAll(
    /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([\w$]+)/gm,
  )) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (name) names.add(name);
    }
  }
  for (const m of src.matchAll(/^export\s*\*\s*from\s*'([^']+)'/gm)) {
    for (const name of exportsOf(path.resolve(path.dirname(file), m[1]))) names.add(name);
  }
  return names;
}

export function missingImports() {
  const problems = [];
  for (const file of DIRS.flatMap((dir) => walk(path.join(ROOT, dir)))) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']+)'/g)) {
      const target = path.resolve(path.dirname(file), m[2]);
      let available;
      try {
        available = exportsOf(target);
      } catch {
        problems.push(`${relative(file)}: nincs ilyen modul: ${m[2]}`);
        continue;
      }
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0];
        if (name && !available.has(name)) problems.push(`${relative(file)}: '${name}' — ${m[2]}`);
      }
    }
  }
  return problems.sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(missingImports().join('\n') || '(minden import rendben)');
}
