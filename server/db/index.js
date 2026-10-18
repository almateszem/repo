/**
 * Podium — SQLite adatréteg (beépített node:sqlite): belépési pont
 * ------------------------------------------------------
 * Pragmatikus hibrid séma + világos adatszétválasztás:
 *   - collections: kulcs-érték tábla a CSAK OLVASHATÓ referencia/seed adatnak
 *     (dashboard, charts, foods, athletes…). Ez minden indításkor a data.js-ből
 *     szinkronizálódik (INSERT OR REPLACE) — így a data.js a forrása, a
 *     módosítások (és séma-bővítések) maguktól érvényre jutnak. Ez az adat
 *     MINDEN felhasználónak közös, mert referencia-adat.
 *   - users / sessions: fiókok és munkamenetek.
 *   - weight_log / nutrition_log / workouts / plans / workout_draft / checkins /
 *     exercise_maxes:
 *     a FELHASZNÁLÓI adat. Minden sor egy fiókhoz tartozik (user_id), és a
 *     modul MINDEN lekérdezése szűr rá — a felhasználók nem látják egymás
 *     adatát. A seed ezeket nem érinti, megmaradnak.
 *
 * A DB fájl: server/podium.db — a szerver újraindítását túléli. Ez az
 * egyetlen modul, amely a tárolást ismeri; ha később Postgresre váltanánk,
 * elég ezt átírni.
 */

/*
 * A modulok (server/db/): connection, schema, migrations, accounts, coaching,
 * nutrition, body, training. Egyik sem fut le importkor (a connection csak
 * megnyitja a fájlt): az indulási lépéseket ez a fájl hívja, EXPLICIT
 * sorrendben, miután minden modul betöltődött — a migrációk így nem a
 * function-hoistingon múlnak.
 */
/* ======================================================================
   Olvasás — MINDEN függvény első paramétere a felhasználó azonosítója.
   Ez szándékos: így egy lekérdezést nem lehet „véletlenül" szűretlenül
   hívni, mert a userId hiánya azonnal hibás eredményt adna.
   ====================================================================== */

import { configureConnection } from './connection.js';
import { createIndexes, createSchema, seedCollections } from './schema.js';
import {
  assertSupportedSchema,
  ensureColumns,
  readSchemaVersion,
  runMigrations,
} from './migrations.js';
import { purgeExpiredSessions } from './accounts.js';

// 1. A túl régi fájlhoz nem nyúlunk (a naplózási mód is írna bele)
assertSupportedSchema();
configureConnection();
// 2. A séma, a régi fájlok oszlopai és a verziózott átalakítások
createSchema();
const schemaVersion = readSchemaVersion();
runMigrations(schemaVersion, ensureColumns(schemaVersion));
// 3. Indexek (a migrációk UTÁN) és a referencia-kollekciók
createIndexes();
seedCollections();
// 4. A lejárt munkamenetek takarítása (bejelentkezéskor és naponta is fut)
purgeExpiredSessions();

export { transaction, closeDatabase } from './connection.js';
export { getCollection } from './schema.js';
export { ENSURED_COLUMNS } from './migrations.js';
export * from './accounts.js';
export * from './coaching.js';
export * from './nutrition.js';
export * from './body.js';
export * from './training.js';
/* A rekord-szabály (calculateEpley1RM, bestCompletedSet) a server/records.js
   tiszta moduljában él — a server/coaching.js adatbázis nélkül importálja. Innen
   tovább-exportáljuk, hogy a meglévő hívók változatlanok maradjanak. */
export { bestCompletedSet, calculateEpley1RM } from '../records.js';
