/**
 * Podium — a szerver indítása a bemutató-adatbázissal (server/demo.db).
 * Platformfüggetlen: a `PODIUM_DB=… node …` alak Windowson (cmd) nem működik.
 * Az adatbázist előbb a `npm run seed:demo` hozza létre.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DB = path.join(__dirname, '..', 'server', 'demo.db');

if (!existsSync(DEMO_DB)) {
  console.error('Nincs még bemutató-adatbázis. Futtasd előbb: npm run seed:demo');
  process.exit(1);
}
process.env.PODIUM_DB = DEMO_DB;
await import('../server/server.js');
