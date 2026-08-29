/**
 * Étel-kategóriák — KÖZÖS modul
 * =============================
 * A FitTrack étel-katalógusának kategóriái. Azért él itt, a public/ alatt,
 * mert három helyen kell, és nem lehet belőle három igazság:
 *
 *   - a szerver ebből validál (server/data/foods.hu.js re-exportálja);
 *   - a FitTrack felülete a legördülőt ebből építi (az étel-listán át);
 *   - a **Gyűjtő** (public/gyujto/) a böngészőben, szerver nélkül, OFFLINE is
 *     — a boltban nincs kitől megkérdezni, milyen kategóriák léteznek.
 *
 * A sorrend a megjelenítés sorrendje.
 */
export const FOOD_GROUPS = [
  'Hús, baromfi', 'Felvágott', 'Hal, tenger gyümölcse', 'Tojás', 'Tejtermék',
  'Gabona, pékáru', 'Köret, burgonya', 'Hüvelyes, növényi fehérje', 'Zöldség',
  'Gyümölcs', 'Olajos mag', 'Olaj, zsiradék', 'Édesség, snack', 'Ital',
  'Sportkiegészítő', 'Készétel', 'Fűszer, szósz',
];
