/**
 * Podium — edzőváltáskor a régi edző megjegyzései is mennek (A4)
 * ------------------------------------------------------------------------
 * A kapcsolat bontásakor az üzenetek, az edző táplálkozási célja, étrendje
 * és víz-célja törlődött — a gyakorlat-megjegyzései nem. Az új edző így a
 * sportoló kártyáján látta a régi edző megjegyzéseit (névvel), a sportoló
 * pedig nem tudta törölni őket (megjegyzést csak a szerzője törölhet).
 * A sportoló SAJÁT megjegyzései maradnak — azok az ő naplójához tartoznak.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const workDir = mkdtempSync(path.join(tmpdir(), 'podium-unlink-comments-'));
process.env.PODIUM_DB = path.join(workDir, 'unlink.db');
const db = await import('../../server/db.js');
after(() => {
  db.closeDatabase();
  rmSync(workDir, { recursive: true, force: true });
});

let seq = 0;
const user = (name) => {
  seq += 1;
  return db.createUser(`${name}${seq}`, name, 'x').user.id;
};
function link(coachId, athleteId) {
  const l = db.createCoachInvite(coachId, athleteId);
  db.acceptCoachInvite(l.id);
  return l.id;
}
const authors = (athleteId) =>
  Object.values(db.getCommentsByTarget(athleteId, 'exercise', athleteId))
    .flat()
    .map((c) => c.text);

test('a bontás a régi edző megjegyzéseit törli, a sportolóét megtartja', () => {
  const coach = user('edzo');
  const athlete = user('sportolo');
  const linkId = link(coach, athlete);
  db.addComment(coach, athlete, 'exercise', '1:0', 'edzői tanács');
  db.addComment(athlete, athlete, 'exercise', '1:0', 'saját jegyzet');

  db.deleteCoachLink(linkId);
  assert.deepEqual(authors(athlete), ['saját jegyzet']);
});

test('a bontás egy MÁSIK edző megjegyzéseihez nem nyúl', () => {
  const regi = user('regi');
  const uj = user('uj');
  const athlete = user('sportolo');
  const regiLink = link(regi, athlete);
  db.addComment(regi, athlete, 'exercise', '1:0', 'régi edző');
  db.deleteCoachLink(regiLink);
  link(uj, athlete);
  db.addComment(uj, athlete, 'exercise', '1:0', 'új edző');

  // Egy harmadik, függő meghívó visszavonása semmit nem töröl
  const harmadik = user('harmadik');
  const pending = db.createCoachInvite(harmadik, athlete);
  db.deleteCoachLink(pending.id);
  assert.deepEqual(authors(athlete), ['új edző']);
});

test('az edző fióktörlése a sportolónál hagyott megjegyzéseit is viszi', () => {
  const coach = user('torlodo');
  const athlete = user('sportolo');
  link(coach, athlete);
  db.addComment(coach, athlete, 'exercise', '1:0', 'edzői tanács');
  db.addComment(athlete, athlete, 'exercise', '1:0', 'saját jegyzet');

  db.deleteUser(coach);
  assert.deepEqual(authors(athlete), ['saját jegyzet']);
});
