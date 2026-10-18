/**
 * Podium — az edző–sportoló hozzáférés kapuja
 * ------------------------------------------------------------------------
 * A kapcsolat azonosítója (linkId) önmagában nem jogosít semmire: minden
 * végpont azt is ellenőrzi, hogy a hívó a kapcsolat melyik oldala, és hogy a
 * kapcsolat a kellő állapotban van-e. Ez az egy hely dönt róla — egységes
 * válaszokkal: 400 a nem szám azonosítóra, 404 a nem létező vagy nem saját
 * kapcsolatra (nem 403: a létezését sem áruljuk el).
 */
import { getCoachLink, getPlanAssignment } from '../db.js';

/** Egy útvonal-paraméter pozitív egész azonosítóként, vagy null. */
function parseIdParam(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const BAD_ID = { code: 400, error: 'Érvénytelen azonosító.' };

/**
 * A kapcsolat, ha a hívó hozzáférhet: { link }, különben { code, error }.
 *
 * @param {object} user        a bejelentkezett felhasználó (req.user)
 * @param {*}      rawId       az útvonal-paraméter (req.params.linkId)
 * @param {object} [options]
 * @param {'coach'|'athlete'} [options.as]  melyik oldalnak kell lennie (elhagyva: bármelyik)
 * @param {string|null} [options.status='active']  a kapcsolat kért állapota (null: mindegy)
 * @param {string} [options.notFound]  a 404 üzenete
 */
export function linkFor(
  user,
  rawId,
  { as, status = 'active', notFound = 'Nincs ilyen kapcsolat.' } = {},
) {
  const id = parseIdParam(rawId);
  if (id === null) return BAD_ID;
  const link = getCoachLink(id);
  const side =
    as === 'coach'
      ? link?.coachId === user.id
      : as === 'athlete'
        ? link?.athleteId === user.id
        : link?.coachId === user.id || link?.athleteId === user.id;
  if (!link || !side || (status !== null && link.status !== status)) {
    return { code: 404, error: notFound };
  }
  return { link };
}

/** A hívóhoz érkezett, még FÜGGŐ terv-ajánlat ÉLŐ kapcsolatból: { offer },
    különben { code, error } — ugyanazokkal a szabályokkal, mint a linkFor. */
export function pendingOfferFor(user, rawId) {
  const id = parseIdParam(rawId);
  if (id === null) return BAD_ID;
  const offer = getPlanAssignment(id);
  const notFound = { code: 404, error: 'Nincs ilyen terv-ajánlat.' };
  if (!offer || offer.status !== 'pending') return notFound;
  const { link } = linkFor(user, offer.linkId, { as: 'athlete' });
  return link ? { offer } : notFound;
}
