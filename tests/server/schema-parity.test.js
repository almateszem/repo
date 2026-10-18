/**
 * Podium — a friss és a migrált adatbázis sémája azonos
 * ------------------------------------------------------------------------
 * Minden oszlop a CREATE TABLE-ben él; az ensureColumn csak a régi (a CREATE
 * előtt létrehozott) adatbázisokat hozza ugyanide. Ha a kettő DDL-je elcsúszik
 * (más DEFAULT, más típus), egy régi adatbázis csendben más sémával fut. A
 * teszt egy friss adatbázisból eltávolítja az ensureColumn-nal kezelt
 * oszlopokat (ez a „régi" állapot), újra betölti rá az adatréteget, és
 * táblánként összeveti a PRAGMA table_info-t a friss adatbáziséval.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_MODULE = pathToFileURL(path.join(__dirname, '..', '..', 'server', 'db.js')).href;
const workDir = mkdtempSync(path.join(tmpdir(), 'podium-schema-'));
after(() => rmSync(workDir, { recursive: true, force: true }));

/** Az adatréteg betöltése (importkor migrál); kiírja az ensureColumn listáját. */
const boot = (file) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--input-type=module',
        '-e',
        `const db = await import(${JSON.stringify(DB_MODULE)});
         process.stdout.write(JSON.stringify(db.ENSURED_COLUMNS));
         db.closeDatabase();`,
      ],
      { env: { ...process.env, PODIUM_DB: file }, encoding: 'utf8' },
    )
      .split('\n')
      .at(-1),
  );

/** Táblánként a table_info oszlopai név szerint (a hozzáadott oszlop a végére
    kerül, ezért a sorrend nem számít). */
const schemaOf = (file) => {
  const raw = new DatabaseSync(file);
  const tables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name)
    .sort();
  const schema = {};
  for (const table of tables) {
    schema[table] = raw
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map(({ name, type, notnull, dflt_value: dflt, pk }) => ({ name, type, notnull, dflt, pk }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  raw.close();
  return schema;
};

test('friss DB-n minden oszlopot a CREATE TABLE hoz létre', () => {
  const ensured = boot(path.join(workDir, 'create-only.db'));
  assert.ok(ensured.length > 0, 'van ensureColumn-nal kezelt oszlop');
  const added = ensured.filter((c) => c.added).map((c) => `${c.table}.${c.column}`);
  assert.deepEqual(added, [], 'az ensureColumn friss adatbázison nem pótol semmit');
});

test('friss DB sémája = a régi állapotból migrált DB sémája', () => {
  const fresh = path.join(workDir, 'fresh.db');
  const ensured = boot(fresh);

  // „Régi" állapot: a friss fájl, az ensureColumn-oszlopok nélkül
  const migrated = path.join(workDir, 'migrated.db');
  copyFileSync(fresh, migrated);
  const raw = new DatabaseSync(migrated);
  raw.exec('DROP INDEX IF EXISTS idx_messages_unread'); // a read_at-re épül
  for (const { table, column } of ensured) {
    raw.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
  raw.exec('PRAGMA user_version = 0'); // a pótlás verziózott lépés
  raw.close();
  boot(migrated);

  assert.deepEqual(schemaOf(migrated), schemaOf(fresh));
});
