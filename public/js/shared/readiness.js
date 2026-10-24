/**
 * Podium — a készenlét és a check-in skálák közös darabjai
 * ------------------------------------------------------------------------
 * Az izomcsoportok, a check-in skálák, a készenlét-sáv és -megbízhatóság
 * címkéi, valamint az 1–5-ös chip-skála (építés, kattintás, olvasás, írás).
 * A Regeneráció, a check-in, az Áttekintő, az edzői nézetek és az edzés
 * összegzője is használja. Az érték az aria-pressed attribútumban él.
 */
import { $, $$, cloneTemplate } from './dom.js';

/** A tizenkét izomcsoport kulcsa és magyar címkéje — a szerver
    MUSCLE_GROUPS-ával azonos sorrendben (server/muscles.js). A check-in
    izomláz- és fájdalom-mezői ebből épülnek. */
const MUSCLE_GROUPS = [
  ['chest', 'Mell'],
  ['shoulders', 'Váll'],
  ['biceps', 'Bicepsz'],
  ['triceps', 'Tricepsz'],
  ['traps', 'Trapéz'],
  ['back', 'Hát'],
  ['lowerBack', 'Alsó hát'],
  ['core', 'Has / core'],
  ['quads', 'Quad'],
  ['hamstrings', 'Hamstring'],
  ['glutes', 'Farizom'],
  ['calves', 'Vádli'],
];

/** A gyors check-in 1–5-ös skálái:
    [mező-név, rövid címke, [1-es végpont, 5-ös végpont], varázsló-kérdés].
    A negyedik elem CSAK a lépésenkénti varázslónak kell (ott a kérdés a
    képernyő címe); a Regeneráció oldal részletes űrlapja az első hármat
    használja. Egy táblában tartjuk, hogy a két felület ne sodródjon szét. */
const CHECKIN_SCALES = [
  ['sleepQuality', 'Alvásminőség', ['nagyon rossz', 'kiváló'], 'Milyen volt az alvásod?'],
  ['energy', 'Energiaszint', ['kimerült', 'tele energiával'], 'Mennyi energiád van ma?'],
  ['stress', 'Stresszszint', ['nyugodt', 'nagyon feszült'], 'Mennyire vagy feszült?'],
];

/** Készenlét-sáv → állapot-kulcs. A CSS ebből színez (ok / warn / bad). */
const readinessTone = (value) => (value >= 80 ? 'ok' : value >= 60 ? 'warn' : 'bad');

const CONFIDENCE_LABELS = { high: 'Megbízható', medium: 'Közepes', low: 'Tájékoztató' };

/** Van-e készenléti érték — NULL, ha a motornak nincs mire alapoznia
    (server/recovery.js); ilyenkor sem 0-t, sem 100-at nem mutatunk. */
const hasReadiness = (value) => value !== null && value !== undefined;

/**
 * Egy 0–5 vagy 1–5 skála felépítése chip-csoportként. Az érték az
 * aria-pressed attribútumban él (a terv-építő nap-chipjeivel azonos minta),
 * így nincs a DOM mellett külön állapot, amit szinkronban kéne tartani.
 * A `null` érték érvényes: azt jelenti, hogy a felhasználó nem adta meg —
 * a motor ilyenkor újraosztja a súlyt.
 */
function renderScale({ name, label, min, max, hint }) {
  const scale = cloneTemplate('tpl-scale');
  scale.dataset.field = name;
  $('.rc-scale-label', scale).textContent = label;
  $('.rc-scale-hint', scale).textContent = hint ?? '';

  const chips = $('.rc-scale-chips', scale);
  chips.setAttribute('aria-label', label);
  for (let value = min; value <= max; value += 1) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'rc-chip';
    chip.textContent = String(value);
    chip.dataset.value = String(value);
    chip.setAttribute('aria-pressed', 'false');
    chip.setAttribute('aria-label', `${label}: ${value}`);
    chips.appendChild(chip);
  }
  return scale;
}

/** Egy chip-skála aktuális értéke, vagy null, ha nincs kiválasztva. */
const readScale = (scaleEl) => {
  const active = $('.rc-chip[aria-pressed="true"]', scaleEl);
  return active ? Number(active.dataset.value) : null;
};

/** Egy chip-skála beállítása (null → semmi sincs kiválasztva). */
const writeScale = (scaleEl, value) => {
  $$('.rc-chip', scaleEl).forEach((chip) => {
    chip.setAttribute(
      'aria-pressed',
      String(value !== null && value !== undefined && Number(chip.dataset.value) === Number(value)),
    );
  });
};

/** Egy skála felépítése választható chipekkel. Az aktív chip újbóli
    megnyomása törli a választást — így egy véletlen kattintás visszavonható
    „nem adtam meg" állapotra. */
function buildScale(options) {
  const scale = renderScale(options);
  const chips = $$('.rc-chip', scale);
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const active = chip.getAttribute('aria-pressed') === 'true';
      chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', String(!active));
    });
  });
  return scale;
}

export {
  CHECKIN_SCALES,
  CONFIDENCE_LABELS,
  MUSCLE_GROUPS,
  buildScale,
  hasReadiness,
  readScale,
  readinessTone,
  writeScale,
};
