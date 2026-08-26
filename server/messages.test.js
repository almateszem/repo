/**
 * FitTrack Pro — az üzenetek olvasottság-jelölése az ADATRÉTEG szintjén
 * ---------------------------------------------------------------------
 * A coach.test.js a végpontokon át bizonyítja, hogy az olvasatlan-számláló a
 * felületre is kijut. Itt két olyan dolog a kérdés, ami HTTP-n nem látszik:
 *
 *   1. A MIGRÁCIÓ: a read_at oszlop utólag került a messages táblába. Egy
 *      korábbi adatbázisban már ott ülnek üzenetek — azoknak olvasatlanul kell
 *      átjönniük (nem tudhatjuk, látta-e őket a címzett), és az oszlopra épülő
 *      részleges indexnek is létre kell jönnie a meglévő fájlon.
 *   2. A számláló EGY lekérdezéses alakja: a getUnreadCounts az összes szálat
 *      egyszerre adja vissza, tehát a szálakat és a két szerepet (edző /
 *      sportoló) nem keverheti össze.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const workDir = mkdtempSync(path.join(tmpdir(), 'fittrack-msg-'));
const DB_PATH = path.join(workDir, 'messages.db');

/* ---- A read_at ELŐTTI séma, két üzenettel ----
   Csak az a három tábla kell hozzá, amit a szál érint; a többit az adatréteg
   a szokásos CREATE TABLE IF NOT EXISTS ágon hozza majd létre. */
{
  const old = new DatabaseSync(DB_PATH);
  old.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE coach_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      coach_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      athlete_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), responded_at TEXT,
      UNIQUE (coach_id, athlete_id), CHECK (coach_id != athlete_id));
    -- A régi üzenet-tábla: read_at oszlop MÉG NINCS benne
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL REFERENCES coach_links(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);

  const addUser = old.prepare(
    'INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)',
  );
  addUser.run('edzo', 'Kovács Bence', 'x');      // id 1
  addUser.run('sportolo', 'Nagy Petra', 'x');    // id 2
  addUser.run('masik', 'Tóth Dani', 'x');        // id 3
  old.prepare("INSERT INTO coach_links (coach_id, athlete_id, status) VALUES (1, 2, 'active')").run();
  old.prepare("INSERT INTO coach_links (coach_id, athlete_id, status) VALUES (1, 3, 'active')").run();

  const addMessage = old.prepare('INSERT INTO messages (link_id, sender_id, body) VALUES (?, ?, ?)');
  addMessage.run(1, 1, 'Régi üzenet az edzőtől');
  addMessage.run(1, 2, 'Régi válasz a sportolótól');
  old.close();
}

/* Az adatréteg importáláskor migrál — ezért a felépítés UTÁN töltjük be. */
process.env.FITTRACK_DB = DB_PATH;
const db = await import('./db.js');

process.on('exit', () => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

test('a read_at oszlop és a részleges index a meglévő adatbázison is létrejön', () => {
  const raw = new DatabaseSync(DB_PATH);

  const columns = raw.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  assert.ok(columns.includes('read_at'), 'a migráció pótolta a read_at oszlopot');

  const indexes = raw.prepare('PRAGMA index_list(messages)').all().map((i) => i.name);
  assert.ok(indexes.includes('idx_messages_unread'), 'az oszlopra épülő index is felépült');

  assert.equal(
    raw.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 2,
    'egyetlen régi üzenet sem veszett el',
  );
  raw.close();
});

test('a migrált üzenetek OLVASATLANOK — nem hazudunk olvasást', () => {
  // Az edző szemszögéből a sportoló üzenete a hátralék (a sajátja sosem az)
  assert.equal(db.getUnreadCounts(1).get(1), 1);
  assert.equal(db.getUnreadCounts(2).get(1), 1, 'és fordítva ugyanígy');

  const thread = db.getMessages(1);
  assert.deepEqual(thread.map((m) => m.readAt), [null, null]);
});

test('a nyugtázás CSAK a másik fél üzeneteit érinti, és idempotens', () => {
  assert.equal(db.markMessagesRead(1, 1), 1, 'az edző egy üzenetet olvasott el');
  assert.equal(db.markMessagesRead(1, 1), 0, 'másodszorra már nincs mit megjelölni');

  const [fromCoach, fromAthlete] = db.getMessages(1);
  assert.equal(fromCoach.readAt, null, 'az edző saját üzenete nem lett olvasott');
  assert.ok(fromAthlete.readAt, 'a sportoló üzenete viszont igen');

  assert.equal(db.getUnreadCounts(1).has(1), false, 'az edzőnek nincs több hátraléka');
  assert.equal(db.getUnreadCounts(2).get(1), 1, 'a sportolóé érintetlen maradt');
});

test('a számláló szálanként külön vezet, és csak a saját szálakat adja', () => {
  db.addMessage(2, 3, 'A másik sportoló ír');
  db.addMessage(2, 3, 'És még egyszer');

  const forCoach = db.getUnreadCounts(1);
  assert.equal(forCoach.get(2), 2, 'a másik szál külön számít');
  assert.equal(forCoach.has(1), false, 'az elolvasott szál nem szerepel a listában');

  // A harmadik fél csak a SAJÁT szálát látja, az elsőt nem
  const forOther = db.getUnreadCounts(3);
  assert.equal(forOther.has(1), false, 'idegen szál hátraléka nem szivárog át');
  assert.equal(forOther.has(2), false, 'a saját üzenetei nem a saját hátraléka');
});

test('a kapcsolat bontásával a szál hátraléka is eltűnik', () => {
  db.deleteCoachLink(2);
  assert.equal(db.getUnreadCounts(1).size, 0, 'a törölt szál nem hagy maga után számot');
});
