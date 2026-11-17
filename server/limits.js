/**
 * Podium — a napló, a terv és a blokkos program közös korlátai
 * ------------------------------------------------------------------------
 * Egy helyen, mert a blokkos program a napló alakjában generálja a napjait:
 * ha a kettő más-más korlátot ismer, érvényes program olyan napot adhat,
 * amit a mentés elutasít (és ez csak az edzés végén derül ki).
 */

/** A gyakorlat neve. A katalógus leghosszabb neve 67 karakter — egy teszt
    őrzi, hogy mind beleférjen (tests/server/name-and-program-limits.test.js). */
export const EXERCISE_NAME_MAX = 80;

/** Az edzés (és a programnap címének) hossza. A programnap címe
    „<hét címkéje> · <nap neve>", ezért a program ezt is ellenőrzi. */
export const WORKOUT_NAME_MAX = 60;

/** Egy gyakorlat szettjei egy edzésben. A blokkos programban a szett-sorok
    ismétlődése (count) kibontva számít. */
export const MAX_SETS_PER_EXERCISE = 50;
