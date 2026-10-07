/** A terv-építő „Meglévő edzés betöltése" tiszta segédei: a régi „same"
    napok feloldása, a betöltött gyakorlatok másolása és a választó keresése.
    DOM nélkül, hogy node:test-tel tesztelhetők legyenek. */

/** Gyakorlatlista mély másolata tervbe: a terv sablon, ezért egyik gyakorlat
    sem rekord, és egyik szett sincs teljesítve (a naplóból jövő is). */
const copyExercises = (exercises) =>
  (exercises ?? []).map((exercise) => ({
    ...exercise,
    pr: false,
    sets: (exercise.sets ?? []).map((set) => ({ ...set, done: false })),
  }));

/** A régi tervek „ugyanaz, mint" napjai a terv-építőben a hivatkozott nap
    MÁSOLATÁVÁ válnak — a kezelőfelület már nem ismer kapcsolt napot. A
    szerver a „same"-et továbbra is elfogadja, így a nem szerkesztett régi
    tervek változatlanul futnak. Érvénytelen hivatkozás pihenő lesz. */
const inlineSameDays = (week) =>
  week.map((entry) => {
    if (entry?.type === 'workout') {
      return { type: 'workout', name: entry.name ?? '', exercises: copyExercises(entry.exercises) };
    }
    const source = entry?.type === 'same' ? week[entry.of] : null;
    if (source?.type === 'workout') {
      return {
        type: 'workout',
        name: source.name ?? '',
        exercises: copyExercises(source.exercises),
      };
    }
    return { type: 'rest' };
  });

/** A választó keresője: az edzés nevére vagy bármelyik gyakorlatára illeszt. */
const matchesQuery = (source, query) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [source.name, ...source.exercises.map((exercise) => exercise.name)].some((text) =>
    String(text ?? '')
      .toLowerCase()
      .includes(needle),
  );
};

export { copyExercises, inlineSameDays, matchesQuery };
