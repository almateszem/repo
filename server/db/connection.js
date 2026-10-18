/**
 * Podium — adatréteg: az adatbázis-kapcsolat
 * ------------------------------------------------------------------------
 * A fájl feloldása (PODIUM_DB), a kapcsolat, a naplózási mód és a
 * tranzakció-segéd. Az importja csak megnyitja a fájlt — a beállítást és a
 * sémát az index.js hívja, explicit sorrendben.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Alapból server/podium.db; a PODIUM_DB env-változóval felülírható (pl. teszthez).
// A projekt korábban FitTrack néven futott: a régi FITTRACK_DB változót és a
// régi server/fittrack.db fájlt is elfogadjuk, hogy az átnevezés után egy
// meglévő telepítés ne üres adatbázissal induljon.
const DEFAULT_DB = path.join(__dirname, '..', 'podium.db');
const LEGACY_DB = path.join(__dirname, '..', 'fittrack.db');
export const DB_PATH =
  process.env.PODIUM_DB ||
  process.env.FITTRACK_DB ||
  (!existsSync(DEFAULT_DB) && existsSync(LEGACY_DB) ? LEGACY_DB : DEFAULT_DB);

/* Volt-e már adatbázis, mielőtt megnyitottuk? Ez a legolcsóbb ELLENŐRIZHETŐ
   jele annak, hogy a fájl tényleg megmarad a deployok között: sok hostingon
   (Heroku, Render, Fly volume nélkül) a fájlrendszer ephemeral, és minden
   újraindításkor üres lappal indulnánk — a felhasználók naplója pedig
   csendben eltűnne. Egy „új adatbázis jött létre" sor minden indításkor
   ennek a pontos tünete, és a naplóban azonnal látszik.
   Ld. TEENDOK.txt → ÜZEMELTETÉS, és a README „Élesítés" szakasza. */
export const dbExisted = existsSync(DB_PATH);

export const db = new DatabaseSync(DB_PATH);

/* ---- Naplózási mód ----
   WAL: az olvasók nem blokkolják az írót és fordítva — a piszkozat-autosave
   így nem akad össze a dashboard olvasásaival. A synchronous = NORMAL a WAL
   szokásos párja: áramszünetnél a legutolsó tranzakció elveszhet, de az
   adatbázis nem sérül. Cserébe nincs fsync minden mentésnél.
   A beállítás a DB-fájlba íródik, tehát a meglévő fájlokon is érvényre jut. */
export function configureConnection() {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  // A user_id idegen kulcsok (ON DELETE CASCADE) csak bekapcsolva élnek.
  db.exec('PRAGMA foreign_keys = ON');
}

/** Többlépéses írás atomikusan: hibánál minden lépése visszagördül, a hiba
    továbbmegy. SAVEPOINT-tal, nem BEGIN-nel — így egy meglévő BEGIN
    IMMEDIATE-be (pl. deleteWorkout → recomputeExerciseMaxes) és egy másik
    transaction-be is beágyazható. */
export function transaction(fn) {
  db.exec('SAVEPOINT podium_tx');
  try {
    const result = fn();
    db.exec('RELEASE podium_tx');
    return result;
  } catch (err) {
    db.exec('ROLLBACK TO podium_tx');
    db.exec('RELEASE podium_tx');
    throw err;
  }
}

/** Az adatbázis-kapcsolat lezárása.

    A szervernek erre nincs szüksége (a folyamat végéig nyitva tartja a fájlt),
    a TESZTEKNEK viszont igen: azok ideiglenes könyvtárba dolgoznak, és azt a
    futás végén letörlik. Windowson egy NYITOTT fájlt nem lehet törölni — a
    takarítás EPERM-mel elszállt, és a teszt „megbukott" úgy, hogy közben
    minden állítása teljesült. Ezért a takarítás előtt le kell zárni. */
export function closeDatabase() {
  db.close();
}
