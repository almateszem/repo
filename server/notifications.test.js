/**
 * FitTrack Pro — az értesítés-panel összeállítása
 * ------------------------------------------------
 * A modul tiszta függvény, tehát adatbázis és HTTP nélkül vizsgálható. A
 * kérdés itt nem az, hogy „megjelenik-e valami", hanem hogy pontosan azt
 * mondja-e, ami TÖRTÉNT: a szálanként egy sor, az időrend, és hogy időbélyeg
 * nélküli esemény ne szivárogjon be a listába.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotifications } from './notifications.js';

const iso = (h) => `2026-08-26T${String(h).padStart(2, '0')}:00:00Z`;

test('üres bemenetre üres lista — nem találunk ki tartalmat', () => {
  assert.deepEqual(buildNotifications(), []);
  assert.deepEqual(buildNotifications({}), []);
});

test('egy olvasatlan üzenet idézve, több pedig összevonva jelenik meg', () => {
  const [single] = buildNotifications({
    unreadThreads: [{ linkId: 1, partner: 'Kovács Bence', unread: 1, lastText: 'Szép munka!', at: iso(9) }],
  });
  assert.equal(single.cat, 'message');
  assert.equal(single.text, 'Új üzenet — Kovács Bence: „Szép munka!”');

  const [many] = buildNotifications({
    unreadThreads: [{ linkId: 1, partner: 'Kovács Bence', unread: 4, lastText: 'Szép munka!', at: iso(9) }],
  });
  assert.equal(many.text, '4 új üzenet — Kovács Bence');
});

test('szálanként EGY sor születik, nem üzenetenként', () => {
  const items = buildNotifications({
    unreadThreads: [
      { linkId: 1, partner: 'Kovács Bence', unread: 12, lastText: 'a', at: iso(9) },
      { linkId: 2, partner: 'Nagy Petra', unread: 3, lastText: 'b', at: iso(10) },
    ],
  });
  assert.equal(items.length, 2, 'két szál = két sor, a 15 üzenet ellenére');
  assert.deepEqual(items.map((i) => i.id), ['message:2', 'message:1']);
});

test('a hosszú üzenet csonkolva, egy sorba fogva kerül be', () => {
  const [item] = buildNotifications({
    unreadThreads: [{
      linkId: 1, partner: 'Bence', unread: 1, at: iso(9),
      lastText: `Sziasztok,\n  ${'nagyon '.repeat(20)}hosszú üzenet`,
    }],
  });
  assert.ok(!item.text.includes('\n'), 'a sortörés kiesik');
  assert.ok(!item.text.includes('  '), 'a többszörös szóköz is');
  assert.ok(item.text.endsWith('…”'), `csonkolva ér véget: ${item.text}`);
  assert.ok(item.text.length < 100, 'nem nyúlik el a panelen');
});

test('a kapcsolat két iránya külön szöveget kap', () => {
  const items = buildNotifications({
    incomingInvites: [{ linkId: 5, coach: 'Kovács Bence', at: iso(8) }],
    acceptedLinks: [{ linkId: 6, athlete: 'Nagy Petra', at: iso(9) }],
  });
  assert.deepEqual(items.map((i) => i.text), [
    'Nagy Petra elfogadta a meghívódat',
    'Kovács Bence edzőnek hívott meg',
  ]);
  assert.deepEqual(items.map((i) => i.cat), ['coach', 'coach'], 'egy kategóriába esnek');
});

test('a PR sora kimondja, hogy becsült 1RM', () => {
  const [item] = buildNotifications({
    recentPrs: [{ exercise: 'Guggolás', max1rm: 142.37, at: iso(7) }],
  });
  assert.equal(item.cat, 'pr');
  assert.equal(item.text, 'Új egyéni csúcs: Guggolás — 142 kg (becsült 1RM)');
});

test('a lista időrendben áll, legfrissebb elöl', () => {
  const items = buildNotifications({
    unreadThreads: [{ linkId: 1, partner: 'B', unread: 1, lastText: 'x', at: iso(12) }],
    incomingInvites: [{ linkId: 2, coach: 'C', at: iso(6) }],
    acceptedLinks: [{ linkId: 3, athlete: 'D', at: iso(18) }],
    recentPrs: [{ exercise: 'E', max1rm: 100, at: iso(9) }],
  });
  assert.deepEqual(items.map((i) => i.at), [iso(18), iso(12), iso(9), iso(6)]);
});

test('időbélyeg nélküli esemény NEM kerül a listába', () => {
  /* Ez a modul egyetlen szűrője, és szándékos: a panel relatív időt ír ki
     minden sor mellé. Időpont nélkül csak kitalálni lehetne — pont azt, amiért
     a korábbi demo-lista („5 órája") hiteltelen volt. */
  const items = buildNotifications({
    acceptedLinks: [
      { linkId: 1, athlete: 'Van ideje', at: iso(9) },
      { linkId: 2, athlete: 'Nincs ideje', at: null },
    ],
  });
  assert.deepEqual(items.map((i) => i.text), ['Van ideje elfogadta a meghívódat']);
});

test('a panel nem nő korlátlanul', () => {
  const items = buildNotifications({
    unreadThreads: Array.from({ length: 30 }, (_, i) => ({
      linkId: i, partner: `P${i}`, unread: 1, lastText: 'x', at: iso(i % 24),
    })),
  });
  assert.equal(items.length, 12);
});
