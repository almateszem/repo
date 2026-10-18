/**
 * Podium — a diagramok adatai (heti volumen, 14 napos tonnázs-trend)
 * ------------------------------------------------------------------------
 * Tiszta számítás a mentett edzésekből, adatbázis nélkül: a /api/charts
 * végpont (server.js) adja át a naplót.
 */
import { daysBetween, parseDate, shiftDayKey } from './dates.js';

/** Munkasorozat-e ez a szett? Teljesített, és nem bemelegítő.
    A „volumen" edzéselméletben munkasorozatot jelent — a bemelegítés nem
    számít bele. A szabály EGY helyen él, mert három fogyasztója van: a
    profiloldal összesítője (server.js), a heti volumen-diagram és (a maga
    másolatában) az edzői panel összegzője (server/coaching.js). A drop set önálló
    sorozatnak számít itt; a Recovery Engine az izomkárosodásnál súlyozza le
    (0.5), de darabszámra az is elvégzett munka.
    Az IDŐALAPÚ (kardió) sor nem munkasorozat: szett-típusa nincs, és egy 45
    perces futás egy bicepszsorozattal egyenlő volt a diagramon. Az ilyen sor
    alakjáról ismerhető fel (`duration` mező) — a mentés csak ott írja ki. */
export const isWorkSet = (set) =>
  Boolean(set?.done) && set?.type !== 'warmup' && set?.duration === undefined;

/** Az adott nap hetének hétfője, helyi éjfélre normalizálva (timestamp). */
const mondayOf = (date) => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

/** Gördülő 14 napos tonnázs-trend az áttekintőre. A heti diagramtól két
    dologban különbözik: NEM naptári hétre vág (a „hétfő" önkényes határ egy
    trendnél), és nem sorozatot számol, hanem elmozdított súlyt — ez az, ami
    a terhelésről szól. A mai nap mindig az utolsó oszlop.

    Tizennégy napot küldünk akkor is, ha a mobil csak hetet mutat: a skála így
    ugyanaz marad a két nézetben, és az oszlopok összevethetők. A mobil a
    régebbi hetet CSS-ben rejti el, nem külön lekéréssel. */
export function volumeTrend(workouts, today) {
  const DAYS = 14;
  const last = parseDate(today);
  const end = new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime();
  const tonnage = Array(DAYS).fill(0);
  const dayNames = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];

  for (const workout of workouts) {
    const date = parseDate(workout.date);
    const at = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const index = DAYS - 1 - daysBetween(at, end);
    if (index < 0 || index >= DAYS) continue;
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        // A szettek szám-mezői stringként is érkezhetnek a naplóból, ezért
        // itt kifejezetten számmá alakítunk — üres mező 0-t ér, nem NaN-t.
        if (isWorkSet(set)) tonnage[index] += (Number(set.reps) || 0) * (Number(set.weight) || 0);
      }
    }
  }

  // Üres előzménynél a skála 1, hogy ne osszunk nullával; a 0 kg-os napok
  // ilyenkor is a minimum-magasságú csonkot kapják, nem tűnnek el.
  const peak = Math.max(1, ...tonnage);
  // Egy tonna alatt kilóban beszélünk: a „0,8 t" kevesebbet mond, mint a
  // „800 kg", és a magyar tizedesjel vessző, nem pont.
  const peakLabel =
    peak >= 1000
      ? `${String(Math.round((peak / 1000) * 10) / 10).replace('.', ',')} t`
      : `${Math.round(peak)} kg`;
  const labels = tonnage.map((_, i) => {
    const d = new Date(shiftDayKey(end, -(DAYS - 1 - i)));
    return dayNames[(d.getDay() + 6) % 7];
  });

  // Üres előzménynél nem írunk ki „0 t" tetőt: az egy mért nullának látszana,
  // pedig csak nincs még mit mérni.
  const total = tonnage.reduce((a, b) => a + b, 0);
  return {
    heights: tonnage.map((kg) => (kg > 0 ? Math.max(6, Math.round((kg / peak) * 100)) : 2)),
    axis: total > 0 ? [peakLabel, '', '', '0'] : ['', '', '', ''],
    labels,
    accentIndex: DAYS - 1,
    total,
    ariaLabel: 'Elmozdított súly naponta — utolsó 14 nap',
  };
}

/** Heti volumen-összehasonlítás a mentett edzésekből: MUNKASOROZATOK naponta,
    erre és a múlt hétre. A két hét közös skálán van, hogy a váltógombbal az
    oszlopok összevethetők legyenek.
    A bemelegítő szettek szándékosan kimaradnak: a „volumen" edzéselméletben
    munkasorozatot jelent, és a Recovery Engine meg a profiloldal is így
    számol — a diagram korábban minden bepipált szettet számolt, tehát
    ugyanarra a hétre nagyobb számot mutatott, mint a profil. */
export function volumeCharts(workouts, today) {
  const thisMonday = mondayOf(parseDate(today));
  // Naptári hét, nem 168 óra: az óraátállítás hetében a 168 órás lépés nem
  // hétfő éjfélre esett, és a múlt hét diagramja üres maradt.
  const lastMonday = shiftDayKey(thisMonday, -7);
  const thisWeek = Array(7).fill(0);
  const lastWeek = Array(7).fill(0);

  for (const workout of workouts) {
    const date = parseDate(workout.date);
    const monday = mondayOf(date);
    const bucket = monday === thisMonday ? thisWeek : monday === lastMonday ? lastWeek : null;
    if (!bucket) continue;
    bucket[(date.getDay() + 6) % 7] += workout.exercises
      .flatMap((exercise) => exercise.sets)
      .filter(isWorkSet).length;
  }

  const scale = Math.max(4, Math.ceil(Math.max(...thisWeek, ...lastWeek) / 4) * 4);
  const axis = [scale, (scale / 4) * 3, scale / 2, scale / 4].map(String);
  const heights = (week) => week.map((count) => Math.max(4, Math.round((count / scale) * 100)));
  const totalThis = thisWeek.reduce((a, b) => a + b, 0);
  const totalLast = lastWeek.reduce((a, b) => a + b, 0);
  const delta = totalThis - totalLast;

  return {
    volumeThisWeek: {
      heights: heights(thisWeek),
      axis,
      total: totalThis,
      note:
        delta === 0
          ? 'ugyanannyi, mint a múlt héten'
          : `${delta > 0 ? '+' : ''}${delta} munkasorozat a múlt héthez képest`,
      ariaLabel: 'Munkasorozatok naponta — ez a hét',
    },
    volumeLastWeek: {
      heights: heights(lastWeek),
      axis,
      total: totalLast,
      note: 'a múlt hét összes munkasorozata',
      ariaLabel: 'Munkasorozatok naponta — múlt hét',
    },

    volumeTrend: volumeTrend(workouts, today),
  };
}
