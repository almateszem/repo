/**
 * A Regeneráció oldal felső részének tiszta logikája — DOM nélkül.
 *
 * A kirajzolás (render/recovery.js) csak fogyasztja: ami itt dől el, az
 * egységtesztből ellenőrizhető (recovery-map.test.js). A szám mindig a
 * szerver riportjából jön (server/recovery.js computeReadiness); itt csak
 * válogatás, sorrend és geometria van.
 */

/** 40% alatt a csoport a „Ma kíméld" listára kerül. Csak megjelenítési
    szűrő: a szerver nem használja, a riport formátuma nem függ tőle. (A
    szerver ajánlójának „regenerált" határa a READY_THRESHOLD = 80 a
    server/suggestions.js-ben — az a gyűrű zöld küszöbének párja.) */
export const RC_SPARE_BELOW = 40;

/** Ettől zöld a gyűrű („80%+ kész"). A szerver párja: READY_THRESHOLD. */
export const RC_READY_FROM = 80;

/** Egy izomcsoport gyűrűjének állapota. A `known: false` csoport 100-asa nem
    eredmény, hanem adathiány — ezért ott nincs szám, csak „—". A riportból
    hiányzó csoport (null / undefined) ugyanígy adathiány, nem hiba. */
export function ringState(muscle) {
  if (!muscle || muscle.known === false)
    return { tone: 'none', value: null, sore: false, pain: false };
  return {
    tone: muscle.readiness >= RC_READY_FROM ? 'ok' : 'rest',
    value: muscle.readiness,
    sore: (muscle.soreness ?? 0) > 0,
    pain: (muscle.pain ?? 0) > 0,
  };
}

/** A „Ma kíméld" lista: az ismert, küszöb alatti csoportok, a legfáradtabb
    elöl. Azonos értéknél a riport (= a felület) sorrendje marad. */
export function spareList(muscles = []) {
  return (muscles ?? [])
    .filter((muscle) => muscle.known !== false && muscle.readiness < RC_SPARE_BELOW)
    .map((muscle, index) => ({ muscle, index }))
    .sort((a, b) => a.muscle.readiness - b.muscle.readiness || a.index - b.index)
    .map(({ muscle }) => {
      const state = ringState(muscle);
      return {
        key: muscle.key,
        label: muscle.label,
        readiness: muscle.readiness,
        sore: state.sore,
        pain: state.pain,
      };
    });
}

/** A gyűrű kitöltetlen ívének hossza (stroke-dashoffset) egy 0–100 értékhez. */
export function ringDashOffset(value, r) {
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(value, 0), 100);
  return circumference * (1 - clamped / 100);
}

/** A komponens-bontás két része: a jelen lévő sorok és a hiányzók címkéi
    („Nincs adat: közérzet, …"). */
export function componentSummary(components = []) {
  const list = components ?? [];
  return {
    present: list
      .filter((component) => component.present)
      .map(({ key, label, score, weight }) => ({ key, label, score, weight })),
    missing: list.filter((component) => !component.present).map((c) => c.label),
  };
}

/** Az izom-komponens sora alatti magyarázat: hány csoportból jön az érték, és
    hány csoportról nincs adat. Ha egyikről sincs, nincs mit mondani.
    NEM „átlag": a szerver soft-mint számol (átlag − 0,5·(átlag − minimum),
    ld. server/recovery.js), hogy egy tönkrement csoport ne tűnjön el a
    többi között — a felirat ezt mondja ki röviden. */
export function muscleNote(muscles = []) {
  const list = muscles ?? [];
  const known = list.filter((muscle) => muscle.known !== false).length;
  if (known === 0) return null;
  const unknown = list.length - known;
  const base = `${known} izomcsoportból, a leggyengébb felé súlyozva`;
  return unknown > 0 ? `${base} · ${unknown} csoport adat nélkül` : base;
}

/* ======================================================================
   A térkép geometriája — a design 848×700-as vásznának koordinátái.
   A gyűrű (x, y) a KÖZÉPPONT; a `line` az összekötő vonal a gyűrű
   szélétől a figurán lévő pontig ([x1, y1, x2, y2]).
   ====================================================================== */

export const MAP_CANVAS = { width: 848, height: 700 };

export const MAP_FIGURES = {
  front: { x: 222, y: 120, width: 220, height: 380, labelY: 520 },
  back: { x: 452, y: 120, width: 220, height: 380, labelY: 520 },
};

export const MAP_RINGS = {
  front: [
    { key: 'shoulders', x: 148, y: 153, line: [185, 166, 285, 202] },
    { key: 'chest', x: 76, y: 243, line: [115, 238, 317, 209] },
    { key: 'biceps', x: 64, y: 353, line: [99, 335, 278, 245] },
    { key: 'core', x: 98, y: 463, line: [128, 438, 331, 266] },
    { key: 'quads', x: 168, y: 578, line: [189, 545, 313, 351] },
  ],
  back: [
    { key: 'traps', x: 648, y: 42, line: [627, 75, 563, 180] },
    { key: 'back', x: 788, y: 128, line: [751, 141, 543, 215] },
    { key: 'triceps', x: 788, y: 258, line: [749, 255, 513, 234] },
    { key: 'lowerBack', x: 788, y: 398, line: [753, 380, 563, 281] },
    { key: 'glutes', x: 752, y: 516, line: [725, 488, 548, 307] },
    { key: 'hamstrings', x: 632, y: 600, line: [619, 563, 543, 350] },
    { key: 'calves', x: 510, y: 618, line: [516, 579, 541, 407] },
  ],
};

/** Mobilon egyszerre egy nézet látszik; a gyűrűk a figura két oldalán. */
export const MOBILE_COLUMNS = {
  front: { left: ['shoulders', 'chest', 'biceps'], right: ['core', 'quads'] },
  back: {
    left: ['traps', 'back', 'triceps', 'lowerBack'],
    right: ['glutes', 'hamstrings', 'calves'],
  },
};
