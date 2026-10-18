/**
 * Podium — az edzés- és a terv-törzs ellenőrzése
 * ------------------------------------------------------------------------
 * A beküldött gyakorlat-lista, szettek, hétnapok normalizálása és a
 * terv-/edzés-törzs ellenőrzése. Tiszta függvények.
 */
import { DEFAULT_LOG_MODE, isLogMode, normalizeDuration, normalizeIntensity } from '../logmode.js';
import { normalizeWeek, weekFromLegacy } from '../plan-week.js';

/** A beküldött hétnap-lista normalizálása: egyedi, rendezett 0–6 indexek. */
const normalizeDays = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .sort((a, b) => a - b);

/** RPE normalizálása: az üres érték üres marad (az RPE nem kötelező),
    egyébként 1–10 közé szorul, fél fokozatra kerekítve. A felület is ezt a
    skálát engedi, de a tárolt adat nem függhet a kliens jóindulatától — a
    recovery-motor (rpeFactor, epley1RM) erre a tartományra van hangolva. */
function normalizeRpe(raw) {
  // A számot kiszedjük a szövegből is: a régi bejegyzések „RPE 8" alakúak
  // lehetnek (a db.js migrációja ugyanígy bánik velük).
  const match = String(raw ?? '')
    .replace(',', '.')
    .match(/\d+(\.\d+)?/);
  if (!match) return '';
  return String(Math.min(Math.max(Math.round(Number(match[0]) * 2) / 2, 1), 10));
}

/* A szett típusa: bemelegítő / munkasorozat / drop set. Ismeretlen vagy
   hiányzó értékre (régi bejegyzések) a pozíció szerinti alap érvényes — az
   első szett bemelegítés, onnantól munkasorozat, ugyanúgy, mint a felületen. */
const SET_TYPES = ['warmup', 'work', 'drop'];
/** A szett típusa. A drop set mindig az ELŐTTE lévő szettről csökkent le, ezért
    érvényes szülője kell legyen: a lista élén nincs mihez kapcsolódnia, és
    bemelegítőről sem csökkentenek le. Mindkét esetben munkasorozattá szelídül
    (az első sor bemelegítővé, az az alapértéke). Rokon szabály a gyakorlatok
    `superset` mezőjénél: ott is a szomszédság hordozza a kapcsolatot. */
const normalizeSetType = (raw, index, prevType) => {
  if (!SET_TYPES.includes(raw)) return index === 0 ? 'warmup' : 'work';
  if (raw !== 'drop') return raw;
  if (index === 0) return 'warmup';
  return prevType === 'warmup' ? 'work' : 'drop';
};

/** A beküldött gyakorlat-lista mezőnkénti normalizálása. A kliens a DOM-ból
    olvassa az értékeket, ezért itt kényszerítjük ki az elvárt alakot;
    érvénytelen szerkezetre null-t ad (→ 400-as válasz). */
/** Egy szett szám-mezője (ism./súly) normalizálva.

    A mező SZÖVEG marad — a régi, mértékegységgel együtt mentett értékeket
    („12 rep", „60% TM") nem bántjuk. Ami viszont számként olvasható, az nem
    lehet negatív: a negatív súly negatív tonnatömeget adna, és a Recovery
    Engine fáradtság-modelljében LEVONÓDNA — egy hamis sorral felfelé lehetne
    tolni a saját készenléti pontszámot. A véges szám a kanonikus alakjában
    tárolódik (".5" → "0.5", "1e2" → "100"): ezt korábban egy induláskori
    migráció próbálta utólag, és közben csonkított. */
function nonNegativeField(value) {
  const text = String(value ?? '').slice(0, 20);
  if (text.trim() === '') return text; // az üres mező üres marad (nem 0)
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return text; // nem szám: a mai módon, szövegként
  // Véges szám: a kanonikus alak (".5" → "0.5", "1e2" → "100"), negatív → 0
  return parsed < 0 ? '0' : String(parsed);
}

/* A mentett szerkezet felső korlátja. Enélkül egy 100 KB-os törzs (üres
   szettekkel) ~3 MB-ként tárolódott, és a getWorkouts minden olvasásnál
   szinkron JSON.parse-szal fejtette vissza — a szinkron SQLite miatt MINDEN
   felhasználó kérését blokkolva. A számok messze a valódi használat fölött
   vannak: egy edzés jellemzően 4-10 gyakorlat, gyakorlatonként 3-6 szett. */
const MAX_EXERCISES = 50;
const MAX_SETS_PER_EXERCISE = 50;

/** A méretkorlát ellenőrzése a normalizálás ELŐTT, hogy a túl nagy törzs
    konkrét hibaüzenetet kapjon — csendes levágás adatvesztés lenne. */
export function exerciseLimitError(raw) {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_EXERCISES) return `Legfeljebb ${MAX_EXERCISES} gyakorlat menthető.`;
  if (
    raw.some((entry) => Array.isArray(entry?.sets) && entry.sets.length > MAX_SETS_PER_EXERCISE)
  ) {
    return `Gyakorlatonként legfeljebb ${MAX_SETS_PER_EXERCISE} szett menthető.`;
  }
  return null;
}

export function normalizeExercises(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const exercises = [];
  for (const entry of raw) {
    const name = String(entry?.name ?? '')
      .trim()
      .slice(0, 60);
    // Szett nélküli gyakorlat nem értelmes: a felületen üres kártyaként
    // jelenne meg, és a haladás-számításokból is kilógna.
    if (!name || !Array.isArray(entry?.sets) || entry.sets.length === 0) return null;

    /* A NAPLÓZÁSI MÓD a beküldött soré, nem a katalógusé — pedig a katalógus
       az, ami tudja. Szándékos: a mód a mentéskor RÁÉG a sorra, és onnantól az
       adat dönt, nem a mai besorolás. Ha innen minden mentéskor újraoldanánk,
       akkor egy katalógus-átsorolás visszamenőleg átírná a tavalyi naplót, és
       ami rosszabb: egy RÉGI, ismétlésben naplózott futópad-sor javításkor
       időalapúvá válna, és az ismétlései némán elvesznének. A hiányzó mód
       'reps', ahogy az app egész eddigi előzményéé. Ugyanaz a bizalmi szint,
       mint a PR- és a szuperszett-jelzőé: a felület a katalógusból kapja,
       amit a szerver maga égetett rá. */
    const logMode = isLogMode(entry?.logMode) ? entry.logMode : DEFAULT_LOG_MODE;

    // Sorrendben, nem map-pel: a szett típusa az ELŐZŐ szett MÁR NORMALIZÁLT
    // típusától is függ (drop set nem követhet bemelegítőt).
    const sets = [];
    for (const [index, set] of entry.sets.entries()) {
      /* Időalapú sor: idő + intenzitás. Ismétlés, RPE és szett-típus NINCS —
         a bemelegítő/munkasorozat/drop hármas egy futásra értelmezhetetlen.
         A súly megmarad, de csak FELJEGYZÉSKÉNT a körülményről (súlymellény,
         szán): egyetlen számítás sem szorozza vele, mert mindegyik ismétléssel
         szoroz. A sorok darabszámát nem korlátozzuk egyre — a felület egyet ad,
         de a szerkezet így egy későbbi fázis-bontással is elbírna. */
      sets.push(
        logMode === 'duration'
          ? {
              duration: normalizeDuration(set?.duration),
              intensity: normalizeIntensity(set?.intensity),
              weight: nonNegativeField(set?.weight),
              done: Boolean(set?.done),
            }
          : {
              reps: nonNegativeField(set?.reps),
              weight: nonNegativeField(set?.weight),
              rpe: normalizeRpe(set?.rpe),
              type: normalizeSetType(set?.type, index, sets[index - 1]?.type),
              done: Boolean(set?.done),
            },
      );
    }

    exercises.push({
      name,
      /* Időalapú sorra nincs PR. Nem csak azért, mert az Epley-becslés úgyis
         nullát adna súly és ismétlés híján: a jelzőt a kliens küldi, és egy
         beragadt vagy hamisított igaz érték jelvényt tenne egy olyan sorra,
         aminek nincs mihez mérnie magát. */
      pr: logMode === 'duration' ? false : Boolean(entry.pr),
      // Szuperszett: „az előttem lévő gyakorlattal egy körben". A csoportokat
      // tehát a lista sorrendje adja ki (egymást követő true-k = egy csoport),
      // nem külön azonosító. A lista első elemének nincs mihez kapcsolódnia.
      superset: exercises.length > 0 && Boolean(entry.superset),
      // Csak akkor írjuk ki, ha eltér az alapértelmezéstől: a meglévő sorok
      // alakja így bájtra változatlan marad.
      ...(logMode !== DEFAULT_LOG_MODE && { logMode }),
      sets,
    });
  }
  return exercises;
}

/** Egy nap (vagy a régi alakú terv) gyakorlat-listájának validálása a
    normalizeWeek-nek: { exercises } vagy { error }. */
function parseDayExercises(
  raw,
  emptyError = 'az edzésnapnak legalább egy érvényes gyakorlatot kell tartalmaznia.',
) {
  const tooBig = exerciseLimitError(raw);
  if (tooBig) return { error: tooBig };
  const exercises = normalizeExercises(raw);
  return exercises ? { exercises } : { error: emptyError };
}

/** A terv-törzs közös validálása: { name, week } (a heti bontás, plan-week.js).
    A régi { name, exercises, days } alakot is elfogadja — a korábbi kliens
    és a régi tervek így nem törnek; ilyenkor a hét a régi szabállyal áll elő.
    Hibánál { error }-t ad. */
export function parsePlanBody(body) {
  const name = String(body?.name ?? '').trim();
  if (!name || name.length > 60) {
    return { error: 'A terv neve kötelező (legfeljebb 60 karakter).' };
  }
  if (body?.week === undefined) {
    const day = parseDayExercises(
      body?.exercises,
      'A tervnek legalább egy érvényes gyakorlatot kell tartalmaznia.',
    );
    if (day.error) return { error: day.error };
    return { name, week: weekFromLegacy(day.exercises, normalizeDays(body?.days)) };
  }
  const result = normalizeWeek(body.week, (raw) => parseDayExercises(raw));
  return result.error ? { error: result.error } : { name, week: result.week };
}

/** Az edzés-törzs (name/exercises) közös validálása — a mentés és a javítás
    ugyanazt követeli meg. Hibánál { error }-t ad, a parsePlanBody mintájára. */
export function parseWorkoutBody(body) {
  const name = String(body?.name ?? '').trim();
  if (!name || name.length > 60) {
    return { error: 'Az edzés neve kötelező (legfeljebb 60 karakter).' };
  }
  const tooBig = exerciseLimitError(body?.exercises);
  if (tooBig) return { error: tooBig };
  const exercises = normalizeExercises(body?.exercises);
  if (!exercises) {
    return { error: 'Az edzésnek legalább egy érvényes gyakorlatot kell tartalmaznia.' };
  }
  return { name, exercises };
}
