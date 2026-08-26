/**
 * FitTrack Pro — az értesítés-panel tartalma
 * -------------------------------------------
 * Ez a modul VÁLTJA KI azt, amit korábban a data.js beégetett demo-listája
 * játszott el (egy nem létező edző, kitalált tervekkel és „5 órája" idővel).
 * A panel innentől VALÓDI eseményekből épül, és pontosan négyből:
 *
 *   · olvasatlan üzenet egy élő edző–sportoló szálban,
 *   · hozzám érkezett, még függő edző-meghívó,
 *   · az általam kiküldött meghívó elfogadása,
 *   · friss egyéni csúcs (PR) a saját naplómból.
 *
 * MINDEGYIKNEK VAN IGAZI IDŐBÉLYEGE. Ez nem apróság: ez a szűrő döntötte el,
 * mi kerülhet ide. A „töltsd ki a check-int" és a „sorozat mérföldkő" például
 * kimaradt — azok ÁLLAPOTOK, nem események, tehát csak kitalált időponttal
 * lehetne kiírni őket, és a panel megint azt mutatná, ami nem igaz. (A
 * check-in emlékeztetője amúgy is ott van az áttekintőn, ahol dolga van.)
 *
 * A recovery.js-hez és a coaching.js-hez hasonlóan NEM ismeri sem az
 * adatbázist, sem az Expresst: tiszta függvények, tehát külön tesztelhető
 * (server/notifications.test.js), és a végpont dolga marad összegyűjteni a
 * bemenetet (server.js).
 */

/** Ennyi karakter után vágjuk az idézett üzenetet a panelen. */
const PREVIEW_MAX = 60;

/** Ennyi értesítésnél többet nem mutatunk — a panel áttekintés, nem napló. */
const LIMIT = 12;

/** Idézet-részlet: egy sorba fogott, hosszan csonkolt üzenet-szöveg. */
function preview(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

/**
 * A panel sorai, legfrissebb elöl.
 *
 * A rendezés az `at` időbélyegre megy, ami minden forrásnál valódi UTC
 * időpont. Az azonos időbélyeg (pl. két meghívó egyszerre) stabilan marad: a
 * sort() az egyenlő elemek sorrendjét megtartja, és a forrásokat itt fixen
 * sorra vesszük.
 *
 * @param {object[]} input.unreadThreads  { linkId, partner, unread, lastText, at }
 * @param {object[]} input.incomingInvites { linkId, coach, at } — hozzám jött meghívó
 * @param {object[]} input.acceptedLinks  { linkId, athlete, at } — az én meghívóm, elfogadva
 * @param {object[]} input.recentPrs      { exercise, max1rm, at }
 */
export function buildNotifications({
  unreadThreads = [], incomingInvites = [], acceptedLinks = [], recentPrs = [],
} = {}) {
  const items = [];

  /* Szálanként EGY sor, nem üzenetenként: egy beszélgősebb partner különben
     kiszorítaná a panelről az összes többi értesítést. */
  for (const thread of unreadThreads) {
    items.push({
      id: `message:${thread.linkId}`,
      cat: 'message',
      text: thread.unread === 1
        ? `Új üzenet — ${thread.partner}: „${preview(thread.lastText)}”`
        : `${thread.unread} új üzenet — ${thread.partner}`,
      at: thread.at,
    });
  }

  for (const invite of incomingInvites) {
    items.push({
      id: `invite:${invite.linkId}`,
      cat: 'coach',
      text: `${invite.coach} edzőnek hívott meg`,
      at: invite.at,
    });
  }

  for (const link of acceptedLinks) {
    items.push({
      id: `accepted:${link.linkId}`,
      cat: 'coach',
      text: `${link.athlete} elfogadta a meghívódat`,
      at: link.at,
    });
  }

  for (const pr of recentPrs) {
    items.push({
      id: `pr:${pr.exercise}`,
      cat: 'pr',
      // A tárolt érték becsült 1RM (Epley), ezért „becsült" — nem az a súly,
      // amit ténylegesen megemelt, és ezt nem mossuk el.
      text: `Új egyéni csúcs: ${pr.exercise} — ${Math.round(pr.max1rm)} kg (becsült 1RM)`,
      at: pr.at,
    });
  }

  return items
    .filter((item) => Boolean(item.at))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, LIMIT);
}
