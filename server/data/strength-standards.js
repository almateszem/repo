/**
 * FitTrack Pro — erőszint-küszöbök (KURÁLT, forrásból levezetett adat)
 * ===================================================================
 * A kérdés, amire ez a fájl felel: „hol tartok EBBEN a gyakorlatban a hozzám
 * hasonló (nemű, testsúlyú, korú) emberekhez képest?". Nem a saját
 * fejlődésedet méri — az a profil másik mércéje —, hanem a gyakorlati
 * szintedet. Egy évek óta edző ember, aki most kezdi használni az appot, így az
 * ELSŐ rekordjánál a valódi szintjét kapja, nem egy „kezdő" bronzot.
 *
 * FORRÁS
 * ------
 * Strength Level (strengthlevel.com) közösségi erőstandardjai, 2026.09.
 * A szintek ott populációs percentilisek:
 *
 *     beginner     (Kezdő)        a felhasználók  5%-ánál erősebb
 *     novice       (Újonc)                       20%-ánál
 *     intermediate (Középhaladó)                 50%-ánál
 *     advanced     (Haladó)                      80%-ánál
 *     elite        (Elit)                        95%-ánál
 *
 * Fontos torzítás, amit vállalunk: a mintát edzők adják, nem a teljes
 * népesség. Az ő „kezdőjük" erősebb egy valódi kezdőnél — ez a skála tehát
 * szigorú, nem hízelgő.
 *
 * MIT TÁROLUNK — ÉS MIT NEM
 * ------------------------
 * A forrás oldalai testsúly-sávonként (50…140 kg) adnak kilogrammot. Azt a
 * táblát NEM másoljuk át: gyakorlatonként, nemenként és szintenként KÉT
 * számot tartunk, egy illesztett hatványgörbe paramétereit:
 *
 *     küszöb(testsúly) = kg · (testsúly / referencia)^exp
 *
 * A referencia-testsúly férfinál 80, nőnél 60 kg; a `kg` a küszöb ott, az
 * `exp` azt mondja meg, milyen meredeken nő a küszöb a testsúllyal. Ez nem
 * egyenes arány, és ez a lényeg: egy 110 kg-os ember TÖBBET emel, mint egy
 * 70 kg-os, de testsúlyarányosan KEVESEBBET — egyetlen szorzó („1,5×
 * testsúly") a nehéz embereket rendszeresen alul-, a könnyűeket túlértékelné.
 * Az illesztés hibája az érmet eldöntő küszöbökön (középhaladó, haladó, elit)
 * gyakorlatonként legfeljebb ~8%.
 *
 * A generálás egyszeri, kézi lépés volt; ha frissíteni kell, a módszer fent
 * van, a gyakorlat → forrás-oldal párosítás pedig a nevekből egyértelmű.
 *
 * ÉLETKOR
 * -------
 * A forrás életkori táblái gyakorlattól és nemtől függetlenül UGYANAZT a
 * görbét mutatják (50 évesen ~0,89×, 60-nál ~0,75×, 70-nél ~0,61× a 25-40
 * éves sávhoz képest), ezért egyetlen közös szorzó elég: AGE_FACTORS. Ez a
 * KÜSZÖBÖT szorozza, nem a teljesítményt — egy 60 éves 90 kg-os fekvenyomása
 * a kártyán 90 kg marad, csak magasabb szintet ér. Születési év nélkül a
 * szorzó 1 (a 25-40 éves sáv): az életkor finomítás, nem feltétel.
 *
 * NEM
 * ---
 * Kötelező a szinthez: a férfi és a női küszöb között gyakorlattól függően
 * másfél-háromszoros a különbség. Egy közös skála a felhasználók egyik
 * felének mindig hibás visszajelzést adna.
 *
 * KÉZISÚLYZÓ — a beírt súly KEZENKÉNTI
 * -----------------------------------
 * A ház szabálya, hogy kézisúlyzós gyakorlatnál EGY kézisúlyzó súlyát írod be.
 * A forrás is így mér („Dumbbell weights are for one dumbbell"), tehát a
 * küszöb KÖZVETLENÜL összevethető a beírt számmal, szorzó nélkül. A `perHand`
 * csak a felületnek szól: ott kell kiírni a „/ kéz"-t.
 *
 * GÉPEK ÉS KÁBELEK — `approximate`
 * --------------------------------
 * Kapnak szintet, de tájékoztató jelleggel: a gépek áttétele és a csigák
 * elrendezése gyártónként más, ugyanaz a „100 kg" két teremben két különböző
 * terhelés. A felület ezt jelöli is (≈).
 *
 * SAJÁT TESTSÚLYOS GYAKORLATOK
 * ----------------------------
 * A forrás itt ismétlésszámot ad. Azt ugyanazzal az Epley-képlettel alakítottuk
 * terheléssé, amivel a rekordot is számoljuk (lásd data/bodyweight-load.js):
 *
 *     terhelés = testsúly · tényező · (1 + ismétlés / 30)
 *
 * így a küszöb ugyanabban a mértékegységben van, mint a tárolt 1RM (amely a
 * testsúly-hányadot már tartalmazza).
 *
 * AMI KIMARADT
 * ------------
 * Ahol a katalógus neve nem egyértelmű (a „Bicepsz hajlítás" rúddal és
 * kézisúlyzóval is lehet, a „Bolgár kitörés" szintén), ott nincs küszöb: egy
 * rossz párosítás KÉTSZERES hibát jelentene, a hiányzó bejegyzés viszont csak
 * annyit, hogy az érem a saját fejlődést méri. Ugyanez igaz arra, amire a
 * forrásnak nincs adata és közeli rokona sincs (kábeles egykezes evezés,
 * fordított fogású hajolt evezés …) — a rokonnal bírókat lásd PROXIES.
 *
 * A kulcsok a kurált katalógus (exercises.hu.js) PONTOS nevei.
 */

/** A szintek a leggyengébbtől a legerősebbig — a `kg`/`exp` tömbök ebben a
    sorrendben állnak. */
export const LEVELS = ['beginner', 'novice', 'intermediate', 'advanced', 'elite'];

/** Szint → érem. Öt szint, négy érem: a kezdő és az újonc is bronz — ez a
    belépő fokozat. A gyémánt az elit, a felhasználók felső öt százaléka. */
export const LEVEL_TIER = {
  beginner: 'bronze',
  novice: 'bronze',
  intermediate: 'silver',
  advanced: 'gold',
  elite: 'diamond',
};

/** Az érmek sorrendje. A felület jelmagyarázata is ezt követi. */
export const TIERS = ['bronze', 'silver', 'gold', 'diamond'];

/** A felvehető nemek. A mező elhagyható — a null a „nincs megadva". */
export const SEXES = ['male', 'female'];

/** Referencia-testsúly nemenként (kg): a `kg` értékek ezen érvényesek. */
export const REF_BODYWEIGHT = { male: 80, female: 60 };

/** Életkor → a küszöb szorzója, ötévenként; köztük lineárisan közelítünk.
    A 25-40 éves sáv az 1,0. */
export const AGE_FACTORS = {
  15: 0.85,
  20: 0.98,
  25: 1,
  30: 1,
  35: 1,
  40: 1,
  45: 0.95,
  50: 0.89,
  55: 0.82,
  60: 0.75,
  65: 0.68,
  70: 0.61,
  75: 0.55,
  80: 0.49,
  85: 0.44,
  90: 0.39,
};

/** Az a testsúly-tartomány, amin a görbe mérésen alapul. Ezen kívül nem
    húzzuk tovább: a hatványgörbe a széleken gyorsan elszáll, és egy 35 vagy
    180 kg-os bejegyzés amúgy is inkább elírás. */
const BODYWEIGHT_RANGE = [40, 150];

export const strengthStandards = {
  /* ---- Szabad súlyos: rúd, illetve EGY kézisúlyzó (goblet, egykezes) ---- */
  Fekvenyomás: {
    male: { kg: [53.5, 73, 95.5, 121.5, 149], exp: [1.27, 1.09, 0.96, 0.85, 0.77] },
    female: { kg: [18, 30, 46.5, 65.5, 87.5], exp: [1.21, 0.97, 0.77, 0.66, 0.57] },
  },
  'Ferde fekvenyomás': {
    male: { kg: [47.5, 64, 84.5, 107, 131.5], exp: [1.38, 1.19, 1.03, 0.93, 0.83] },
    female: { kg: [13.5, 24, 38.5, 55.5, 75], exp: [1.37, 1.07, 0.86, 0.72, 0.63] },
  },
  'Negatív fekvenyomás': {
    male: { kg: [55, 76, 101.5, 130, 161.5], exp: [1.41, 1.2, 1.04, 0.92, 0.83] },
    female: { kg: [18, 31, 48.5, 70.5, 94.5], exp: [1.25, 0.97, 0.79, 0.67, 0.58] },
  },
  Padlónyomás: {
    male: { kg: [39.5, 61.5, 89, 121.5, 157], exp: [1.6, 1.28, 1.08, 0.92, 0.82] },
    female: { kg: [15, 27, 43.5, 64, 87], exp: [1.07, 0.81, 0.65, 0.54, 0.47] },
  },
  'Szűk fekvenyomás': {
    male: { kg: [52.5, 69.5, 90, 113, 137.5], exp: [1.36, 1.19, 1.05, 0.94, 0.86] },
    female: { kg: [19.5, 31, 45, 62, 81], exp: [1.2, 0.95, 0.81, 0.69, 0.61] },
  },
  'Hajolt evezés': {
    male: { kg: [46, 64, 86, 111.5, 139], exp: [1.3, 1.11, 0.96, 0.85, 0.76] },
    female: { kg: [17.5, 28.5, 42, 59, 77.5], exp: [0.82, 0.66, 0.54, 0.46, 0.4] },
  },
  'Pendlay evezés': {
    male: { kg: [51, 68, 88.5, 112, 136.5], exp: [1.24, 1.08, 0.95, 0.85, 0.77] },
    female: { kg: [24.5, 35.5, 48.5, 64.5, 81.5], exp: [0.94, 0.79, 0.68, 0.59, 0.54] },
  },
  'Egykezes kézisúlyzós evezés': {
    male: { kg: [18, 29, 42.5, 58, 75.5], exp: [1.45, 1.14, 0.95, 0.81, 0.72] },
    female: { kg: [8.5, 14, 21, 29, 38.5], exp: [0.74, 0.59, 0.48, 0.42, 0.37] },
  },
  'T-rúd evezés': {
    male: { kg: [36, 55.5, 80.5, 109.5, 141.5], exp: [1.45, 1.17, 0.99, 0.85, 0.75] },
    female: { kg: [14.5, 26, 41.5, 61.5, 83], exp: [0.99, 0.73, 0.6, 0.49, 0.43] },
  },
  Felhúzás: {
    male: { kg: [86, 116, 152, 193, 236], exp: [1.17, 1.02, 0.89, 0.79, 0.72] },
    female: { kg: [39.5, 59.5, 85, 115.5, 148], exp: [0.88, 0.72, 0.61, 0.52, 0.47] },
  },
  'Sumo felhúzás': {
    male: { kg: [99, 132, 171, 215, 262], exp: [1.08, 0.94, 0.82, 0.74, 0.67] },
    female: { kg: [47, 67.5, 93, 122, 154], exp: [0.52, 0.44, 0.37, 0.33, 0.29] },
  },
  'Trap-rudas felhúzás': {
    male: { kg: [96.5, 127.5, 163.5, 205, 248.5], exp: [1.01, 0.88, 0.78, 0.7, 0.63] },
    female: { kg: [47.5, 67, 92, 120.5, 151.5], exp: [0.73, 0.62, 0.53, 0.46, 0.42] },
  },
  'Rack pull': {
    male: { kg: [96, 135, 182, 236, 294], exp: [1.12, 0.95, 0.82, 0.72, 0.65] },
    female: { kg: [51.5, 76.5, 107.5, 144, 183.5], exp: [0.77, 0.64, 0.55, 0.47, 0.42] },
  },
  'Román felhúzás': {
    male: { kg: [62.5, 89, 122, 160, 201], exp: [1.27, 1.07, 0.91, 0.8, 0.72] },
    female: { kg: [30.5, 46.5, 66, 90, 116], exp: [0.63, 0.51, 0.43, 0.37, 0.33] },
  },
  'Merev lábas felhúzás': {
    male: { kg: [63.5, 92, 127, 168, 212], exp: [1.21, 1.01, 0.86, 0.75, 0.67] },
    female: { kg: [28, 44.5, 66.5, 92, 120.5], exp: [0.92, 0.74, 0.61, 0.52, 0.46] },
  },
  'Jó reggelt': {
    male: { kg: [27, 50, 81.5, 119.5, 163], exp: [1.89, 1.41, 1.11, 0.92, 0.79] },
    female: { kg: [15.5, 28, 44.5, 65, 88.5], exp: [0.75, 0.55, 0.45, 0.38, 0.33] },
  },
  Vállvonogatás: {
    male: { kg: [49.5, 81, 122.5, 171.5, 226], exp: [1.7, 1.34, 1.1, 0.93, 0.81] },
    female: { kg: [15.5, 34, 60, 94, 133], exp: [1.63, 1.14, 0.88, 0.71, 0.6] },
  },
  'Vállból nyomás': {
    male: { kg: [31.5, 44.5, 60.5, 79.5, 99.5], exp: [1.36, 1.16, 1, 0.87, 0.78] },
    female: { kg: [12, 20, 30, 42.5, 56.5], exp: [1.09, 0.87, 0.7, 0.59, 0.52] },
  },
  'Katonai nyomás': {
    male: { kg: [33.5, 46, 61, 78.5, 96.5], exp: [1.33, 1.14, 0.99, 0.88, 0.79] },
    female: { kg: [14.5, 22, 31, 42, 54], exp: [1, 0.81, 0.7, 0.6, 0.53] },
  },
  'Push press': {
    male: { kg: [40.5, 57, 77, 100.5, 125], exp: [1.29, 1.09, 0.94, 0.82, 0.74] },
    female: { kg: [22, 31.5, 43, 56.5, 71.5], exp: [0.69, 0.58, 0.5, 0.43, 0.38] },
  },
  'Landmine nyomás': {
    male: { kg: [19, 34.5, 55.5, 81.5, 110.5], exp: [1.34, 1.01, 0.8, 0.66, 0.57] },
    female: { kg: [8, 16, 27.5, 41.5, 57.5], exp: [0.92, 0.67, 0.51, 0.42, 0.35] },
  },
  'Felhúzás állig': {
    male: { kg: [22, 37.5, 58, 82.5, 110], exp: [1.42, 1.09, 0.87, 0.75, 0.65] },
    female: { kg: [11, 18.5, 29, 42, 56], exp: [0.99, 0.77, 0.62, 0.51, 0.45] },
  },
  'Koncentrált hajlítás': {
    male: { kg: [8.5, 14, 21.5, 30, 39.5], exp: [1.16, 0.89, 0.74, 0.63, 0.55] },
    female: { kg: [4.5, 8, 12, 17, 22.5], exp: [0.83, 0.68, 0.52, 0.43, 0.39] },
  },
  'Scott-padon hajlítás': {
    male: { kg: [20, 30.5, 44, 60, 77.5], exp: [1.12, 0.92, 0.76, 0.65, 0.58] },
    female: { kg: [8.5, 14.5, 23, 34, 45.5], exp: [1.15, 0.94, 0.75, 0.62, 0.54] },
  },
  'Fordított fogású hajlítás': {
    male: { kg: [14.5, 25, 39, 56, 75.5], exp: [1.56, 1.2, 0.97, 0.81, 0.71] },
    female: { kg: [7, 12.5, 20.5, 31, 42], exp: [0.71, 0.52, 0.44, 0.33, 0.3] },
  },
  'Spider curl': {
    male: { kg: [12, 21.5, 34, 49, 66], exp: [1.64, 1.23, 0.99, 0.83, 0.72] },
    female: { kg: [7, 12.5, 19.5, 28.5, 38.5], exp: [1.3, 1.01, 0.85, 0.69, 0.59] },
  },
  'Homlok nyomás': {
    male: { kg: [19, 29, 42.5, 58, 75], exp: [1.53, 1.24, 1.03, 0.88, 0.78] },
    female: { kg: [6.5, 12.5, 20, 29, 40], exp: [1.01, 0.73, 0.61, 0.51, 0.44] },
  },
  Guggolás: {
    male: { kg: [72, 98, 129.5, 165.5, 203.5], exp: [1.28, 1.1, 0.96, 0.86, 0.77] },
    female: { kg: [31, 48.5, 71.5, 98, 128], exp: [1, 0.81, 0.68, 0.58, 0.51] },
  },
  'Első guggolás': {
    male: { kg: [57, 77.5, 102.5, 130.5, 160.5], exp: [1.19, 1.03, 0.9, 0.8, 0.72] },
    female: { kg: [30.5, 43.5, 59.5, 78.5, 98.5], exp: [0.74, 0.63, 0.54, 0.47, 0.43] },
  },
  'Box squat': {
    male: { kg: [79.5, 112, 152, 198, 247.5], exp: [1.15, 0.98, 0.84, 0.74, 0.66] },
    female: { kg: [37.5, 57.5, 83.5, 113.5, 147], exp: [0.6, 0.49, 0.41, 0.36, 0.31] },
  },
  'Pause squat': {
    male: { kg: [72.5, 97.5, 128, 162, 198.5], exp: [1.31, 1.14, 1, 0.89, 0.81] },
    female: { kg: [34, 50.5, 70, 93.5, 119], exp: [1.03, 0.86, 0.73, 0.64, 0.57] },
  },
  'Goblet guggolás': {
    male: { kg: [15, 26, 41, 59, 79.5], exp: [1.03, 0.77, 0.62, 0.52, 0.44] },
    female: { kg: [10, 17, 26, 37, 49.5], exp: [0.39, 0.3, 0.26, 0.21, 0.17] },
  },
  'Zercher guggolás': {
    male: { kg: [54, 79, 110.5, 146.5, 186], exp: [1.28, 1.06, 0.9, 0.78, 0.7] },
    female: { kg: [24.5, 39.5, 58.5, 80.5, 105], exp: [0.96, 0.77, 0.64, 0.55, 0.49] },
  },
  'Overhead squat': {
    male: { kg: [28, 47.5, 73.5, 105.5, 141], exp: [1.48, 1.14, 0.92, 0.77, 0.67] },
    female: { kg: [18, 29, 42.5, 58.5, 76], exp: [0.77, 0.6, 0.5, 0.44, 0.38] },
  },
  Csípőtolás: {
    male: { kg: [52.5, 92, 145, 209.5, 281.5], exp: [1.69, 1.28, 1.03, 0.86, 0.74] },
    female: { kg: [34.5, 62.5, 100, 146.5, 198.5], exp: [0.74, 0.56, 0.44, 0.37, 0.32] },
  },

  /* ---- Két kézisúlyzó: a beírt és a küszöb is EGY kézisúlyzóé ---- */
  'Kézisúlyzós fekvenyomás': {
    perHand: true,
    male: { kg: [18.5, 27.5, 39, 52.5, 67], exp: [1.29, 1.07, 0.91, 0.78, 0.69] },
    female: { kg: [6.5, 12, 18.5, 27.5, 37.5], exp: [1.18, 0.87, 0.7, 0.59, 0.51] },
  },
  'Ferde kézisúlyzós nyomás': {
    perHand: true,
    male: { kg: [20.5, 28.5, 38.5, 49.5, 61.5], exp: [1.3, 1.08, 0.94, 0.83, 0.74] },
    female: { kg: [7, 12, 18.5, 26, 34.5], exp: [1.15, 0.92, 0.74, 0.64, 0.56] },
  },
  'Kézisúlyzós tárogatás': {
    perHand: true,
    male: { kg: [7.5, 14.5, 23, 34.5, 46.5], exp: [1.54, 1.11, 0.88, 0.72, 0.63] },
    female: { kg: [4, 7, 11.5, 17, 23], exp: [0.78, 0.64, 0.52, 0.4, 0.34] },
  },
  'Ferde tárogatás': {
    perHand: true,
    male: { kg: [9.5, 16.5, 25.5, 36, 48], exp: [1.55, 1.16, 0.92, 0.78, 0.68] },
    female: { kg: [4, 7.5, 12.5, 18.5, 25.5], exp: [0.89, 0.64, 0.52, 0.45, 0.36] },
  },
  'Kézisúlyzós vállvonogatás': {
    perHand: true,
    male: { kg: [15.5, 27.5, 43, 62, 83.5], exp: [1.5, 1.14, 0.91, 0.76, 0.66] },
    female: { kg: [6.5, 13, 23.5, 36.5, 51.5], exp: [1.15, 0.86, 0.63, 0.51, 0.43] },
  },
  'Kézisúlyzós vállnyomás': {
    perHand: true,
    male: { kg: [14.5, 21.5, 30.5, 41, 53], exp: [1.37, 1.13, 0.97, 0.83, 0.74] },
    female: { kg: [5.5, 9.5, 14.5, 20, 27], exp: [0.97, 0.75, 0.61, 0.55, 0.46] },
  },
  'Arnold nyomás': {
    perHand: true,
    male: { kg: [10, 16, 24, 33.5, 44], exp: [1.22, 0.95, 0.8, 0.67, 0.58] },
    female: { kg: [5.5, 8.5, 12, 16, 21], exp: [0.73, 0.58, 0.48, 0.41, 0.36] },
  },
  Oldalemelés: {
    perHand: true,
    male: { kg: [5, 9.5, 16.5, 24.5, 34], exp: [1.41, 0.99, 0.77, 0.62, 0.53] },
    female: { kg: [3, 5.5, 8.5, 13, 17.5], exp: [0.82, 0.55, 0.43, 0.34, 0.31] },
  },
  'Első emelés': {
    perHand: true,
    male: { kg: [4, 9.5, 17, 26.5, 38], exp: [1.69, 1.14, 0.87, 0.69, 0.59] },
    female: { kg: [2.5, 5, 9, 14, 19.5], exp: [0.82, 0.64, 0.5, 0.38, 0.33] },
  },
  'Hátsó vállemelés': {
    perHand: true,
    male: { kg: [3, 8.5, 17, 28.5, 42], exp: [2.13, 1.3, 0.94, 0.73, 0.6] },
    female: { kg: [2.5, 5.5, 9.5, 15, 21], exp: [0.77, 0.6, 0.47, 0.37, 0.3] },
  },
  'Kalapács hajlítás': {
    perHand: true,
    male: { kg: [10.5, 16, 23.5, 32.5, 42], exp: [1.31, 1.1, 0.9, 0.76, 0.68] },
    female: { kg: [4.5, 8, 12, 16.5, 22], exp: [0.9, 0.7, 0.57, 0.51, 0.46] },
  },
  'Váltott karú hajlítás': {
    perHand: true,
    male: { kg: [8, 14, 22, 31.5, 42], exp: [1.19, 0.89, 0.73, 0.61, 0.54] },
    female: { kg: [3.5, 7, 12, 17.5, 24], exp: [1.08, 0.73, 0.6, 0.51, 0.44] },
  },
  'Rézsútos padon hajlítás': {
    perHand: true,
    male: { kg: [9.5, 13.5, 19.5, 25.5, 33], exp: [1.14, 1, 0.8, 0.7, 0.62] },
    female: { kg: [5, 7.5, 11, 15, 19], exp: [0.83, 0.62, 0.54, 0.47, 0.42] },
  },
  Kickback: {
    perHand: true,
    male: { kg: [4.5, 10, 18, 28, 39.5], exp: [1.68, 1.2, 0.89, 0.7, 0.61] },
    female: { kg: [4, 6.5, 10, 14.5, 19], exp: [0.72, 0.59, 0.48, 0.39, 0.35] },
  },

  /* ---- Gépek és kábelek: tájékoztató szint ---- */
  'Smith-gépes fekvenyomás': {
    approximate: true,
    male: { kg: [51.5, 70, 93, 118.5, 146], exp: [1.18, 1.02, 0.88, 0.79, 0.71] },
    female: { kg: [15.5, 27.5, 42.5, 62, 82.5], exp: [1.18, 0.9, 0.74, 0.62, 0.55] },
  },
  'Gépi mellnyomás': {
    approximate: true,
    male: { kg: [38, 59.5, 88, 121.5, 158.5], exp: [1.16, 0.93, 0.77, 0.66, 0.58] },
    female: { kg: [10.5, 21, 35.5, 54, 75], exp: [0.82, 0.58, 0.45, 0.37, 0.31] },
  },
  'Kábeles keresztezés': {
    approximate: true,
    male: { kg: [7.5, 18.5, 35.5, 57.5, 83.5], exp: [2.14, 1.36, 1.01, 0.8, 0.66] },
    female: { kg: [3, 9, 17.5, 29, 42.5], exp: [1.42, 0.9, 0.67, 0.52, 0.44] },
  },
  'Pec deck': {
    approximate: true,
    male: { kg: [41, 61.5, 87, 117.5, 150.5], exp: [1.22, 1.01, 0.85, 0.73, 0.65] },
    female: { kg: [12, 22.5, 36, 53.5, 73], exp: [1.21, 0.9, 0.73, 0.6, 0.53] },
  },
  'Széles lehúzás': {
    approximate: true,
    male: { kg: [46, 63, 84, 107, 132], exp: [0.9, 0.77, 0.67, 0.6, 0.54] },
    female: { kg: [22.5, 33, 45.5, 60, 76.5], exp: [0.62, 0.53, 0.44, 0.39, 0.35] },
  },
  'Szűk fogású lehúzás': {
    approximate: true,
    male: { kg: [53, 70.5, 91, 114, 138.5], exp: [0.85, 0.74, 0.66, 0.59, 0.53] },
    female: { kg: [26.5, 37, 50.5, 65.5, 81.5], exp: [0.56, 0.49, 0.41, 0.37, 0.33] },
  },
  'Fordított fogású lehúzás': {
    approximate: true,
    male: { kg: [51, 69, 91, 116.5, 144], exp: [0.84, 0.73, 0.64, 0.56, 0.51] },
    female: { kg: [25.5, 36.5, 50, 65.5, 82.5], exp: [0.81, 0.68, 0.6, 0.52, 0.47] },
  },
  'Straight-arm lehúzás': {
    approximate: true,
    male: { kg: [19, 33.5, 52.5, 76.5, 103], exp: [1.3, 0.98, 0.78, 0.65, 0.56] },
    female: { kg: [10.5, 18.5, 30, 43, 58.5], exp: [0.61, 0.48, 0.37, 0.31, 0.27] },
  },
  'Ülő evezés': {
    approximate: true,
    male: { kg: [45.5, 64, 86, 111, 138.5], exp: [1.08, 0.92, 0.8, 0.7, 0.63] },
    female: { kg: [20.5, 31.5, 45, 61.5, 79], exp: [0.81, 0.66, 0.56, 0.48, 0.43] },
  },
  'Gépi evezés': {
    approximate: true,
    male: { kg: [45, 70, 102.5, 140, 181.5], exp: [1.27, 1.02, 0.85, 0.73, 0.65] },
    female: { kg: [20.5, 34, 51, 72, 95.5], exp: [0.67, 0.52, 0.44, 0.37, 0.32] },
  },
  'Gépi vállnyomás': {
    approximate: true,
    male: { kg: [27.5, 48, 74.5, 107, 143.5], exp: [1.62, 1.22, 1, 0.83, 0.72] },
    female: { kg: [7.5, 16.5, 29.5, 46.5, 66.5], exp: [1.12, 0.75, 0.55, 0.45, 0.39] },
  },
  'Kábeles oldalemelés': {
    approximate: true,
    male: { kg: [2.5, 8, 16, 26.5, 39], exp: [1.85, 1.06, 0.75, 0.59, 0.49] },
    female: { kg: [2, 5.5, 10, 17, 24.5], exp: [1.25, 0.68, 0.51, 0.4, 0.35] },
  },
  'Gépi oldalemelés': {
    approximate: true,
    male: { kg: [24, 39, 59, 83, 109.5], exp: [1.55, 1.23, 1, 0.85, 0.74] },
    female: { kg: [8, 15.5, 26, 38.5, 54], exp: [1.06, 0.78, 0.61, 0.52, 0.43] },
  },
  'Face pull': {
    approximate: true,
    male: { kg: [14.5, 28, 46, 68.5, 94], exp: [1.38, 0.98, 0.77, 0.64, 0.55] },
    female: { kg: [10, 19, 31.5, 47, 64.5], exp: [1.05, 0.74, 0.61, 0.48, 0.42] },
  },
  'Kábeles bicepsz hajlítás': {
    approximate: true,
    male: { kg: [19, 32.5, 50.5, 72.5, 97], exp: [1.19, 0.92, 0.73, 0.62, 0.54] },
    female: { kg: [7.5, 14.5, 24.5, 36.5, 51], exp: [0.99, 0.71, 0.55, 0.46, 0.39] },
  },
  'Gépi bicepsz hajlítás': {
    approximate: true,
    male: { kg: [24.5, 38.5, 56.5, 78, 101.5], exp: [1.12, 0.9, 0.74, 0.64, 0.56] },
    female: { kg: [8.5, 15.5, 25.5, 38, 52], exp: [0.86, 0.61, 0.51, 0.41, 0.35] },
  },
  'Tricepsz nyújtás': {
    approximate: true,
    male: { kg: [20.5, 35.5, 55, 79, 105.5], exp: [1.33, 1.04, 0.83, 0.7, 0.61] },
    female: { kg: [8.5, 16.5, 27.5, 42, 58], exp: [1.17, 0.89, 0.7, 0.57, 0.49] },
  },
  'Köteles tricepsz nyújtás': {
    approximate: true,
    male: { kg: [16.5, 29, 45.5, 65.5, 88.5], exp: [1.4, 1.06, 0.87, 0.72, 0.62] },
    female: { kg: [8, 14.5, 24, 35, 48.5], exp: [1.02, 0.8, 0.62, 0.52, 0.44] },
  },
  'Fordított fogású tricepsz nyújtás': {
    approximate: true,
    male: { kg: [14, 28, 47.5, 72.5, 100.5], exp: [1.43, 1.01, 0.78, 0.64, 0.54] },
    female: { kg: [6.5, 15, 27, 43, 62], exp: [1.13, 0.76, 0.57, 0.46, 0.39] },
  },
  'Gépi tricepsz nyújtás': {
    approximate: true,
    male: { kg: [30.5, 49, 72.5, 101, 132], exp: [1.01, 0.78, 0.66, 0.56, 0.49] },
    female: { kg: [13.5, 24, 38.5, 56, 76], exp: [0.83, 0.64, 0.5, 0.42, 0.36] },
  },
  'Hack guggolás': {
    approximate: true,
    male: { kg: [60.5, 99.5, 149.5, 210.5, 277.5], exp: [1.31, 1.03, 0.85, 0.72, 0.62] },
    female: { kg: [23.5, 49.5, 86.5, 134.5, 189.5], exp: [1.03, 0.72, 0.56, 0.45, 0.38] },
  },
  'Smith-gépes guggolás': {
    approximate: true,
    male: { kg: [54.5, 82, 116, 156, 199.5], exp: [1.3, 1.06, 0.9, 0.78, 0.69] },
    female: { kg: [21.5, 38, 60.5, 87.5, 118.5], exp: [0.82, 0.63, 0.51, 0.43, 0.37] },
  },
  Lábtolás: {
    approximate: true,
    male: { kg: [104.5, 157.5, 225, 304, 390.5], exp: [1.31, 1.08, 0.91, 0.78, 0.69] },
    female: { kg: [47.5, 85.5, 138, 202.5, 275.5], exp: [1.11, 0.85, 0.68, 0.56, 0.49] },
  },
  Combnyújtás: {
    approximate: true,
    male: { kg: [47, 71.5, 102.5, 139, 179.5], exp: [0.92, 0.75, 0.63, 0.54, 0.48] },
    female: { kg: [22, 37.5, 59, 85.5, 115], exp: [0.69, 0.53, 0.43, 0.36, 0.31] },
  },
  Combhajlítás: {
    approximate: true,
    male: { kg: [29, 45, 65, 89, 115.5], exp: [1.2, 0.97, 0.81, 0.69, 0.61] },
    female: { kg: [14.5, 24, 36, 50.5, 66.5], exp: [0.85, 0.69, 0.58, 0.48, 0.42] },
  },
  'Ülő combhajlítás': {
    approximate: true,
    male: { kg: [38, 57.5, 82, 111, 142.5], exp: [0.97, 0.8, 0.67, 0.58, 0.51] },
    female: { kg: [19, 31, 47, 66.5, 88], exp: [0.67, 0.52, 0.44, 0.36, 0.32] },
  },
  Combközelítés: {
    approximate: true,
    male: { kg: [40, 67, 101.5, 144, 191], exp: [0.83, 0.65, 0.53, 0.45, 0.39] },
    female: { kg: [22, 39.5, 63.5, 93.5, 127], exp: [0.73, 0.54, 0.44, 0.36, 0.31] },
  },
  Combtávolítás: {
    approximate: true,
    male: { kg: [37.5, 62, 94.5, 134, 178], exp: [0.96, 0.75, 0.6, 0.51, 0.44] },
    female: { kg: [26, 44.5, 69, 98.5, 132], exp: [0.57, 0.42, 0.35, 0.29, 0.25] },
  },
  'Ülő vádliemelés': {
    approximate: true,
    male: { kg: [30, 56, 91.5, 136.5, 186.5], exp: [1.37, 1.02, 0.8, 0.66, 0.57] },
    female: { kg: [13.5, 33, 62.5, 101, 146.5], exp: [1.17, 0.78, 0.57, 0.46, 0.38] },
  },
  'Kábeles hasprés': {
    approximate: true,
    male: { kg: [25, 43, 67, 96.5, 129], exp: [0.98, 0.76, 0.61, 0.51, 0.44] },
    female: { kg: [15, 28.5, 46.5, 69.5, 95], exp: [0.83, 0.6, 0.47, 0.39, 0.34] },
  },

  /* ---- Saját testsúlyos: a küszöb a TELJES terhelés (test + pluszsúly) ---- */
  Húzódzkodás: {
    male: { kg: [82.5, 97, 113, 133.5, 155], exp: [1, 0.93, 0.86, 0.77, 0.72] },
    female: { kg: [62, 62, 71, 83, 98.5], exp: [1, 1, 0.87, 0.82, 0.72] },
  },
  'Alsó fogású húzódzkodás': {
    male: { kg: [82.5, 98, 113.5, 133.5, 154.5], exp: [1, 0.92, 0.86, 0.77, 0.72] },
    female: { kg: [62, 62, 72, 81.5, 93], exp: [1, 1, 0.89, 0.85, 0.78] },
  },
  'Semleges fogású húzódzkodás': {
    male: { kg: [83, 99, 115, 136, 157.5], exp: [1, 0.96, 0.88, 0.81, 0.74] },
    female: { kg: [62, 62.5, 72.5, 81.5, 92.5], exp: [1, 0.99, 0.89, 0.86, 0.78] },
  },
  Tolódzkodás: {
    male: { kg: [87.5, 105.5, 130.5, 159.5, 189.5], exp: [1.1, 1, 0.91, 0.82, 0.76] },
    female: { kg: [62, 62.5, 77.5, 96.5, 116.5], exp: [1, 1, 0.92, 0.81, 0.75] },
  },
  Fekvőtámasz: {
    male: { kg: [60, 84.5, 117, 154.5, 195.5], exp: [1.11, 0.93, 0.8, 0.7, 0.62] },
    female: { kg: [40.5, 47.5, 62, 80, 99], exp: [1, 0.96, 0.83, 0.75, 0.67] },
  },
  'Szűk fekvőtámasz': {
    male: { kg: [56, 70, 91, 115, 140.5], exp: [1.11, 1.03, 0.92, 0.82, 0.74] },
    female: { kg: [40.5, 45, 54.5, 67, 80.5], exp: [1, 1.12, 1.03, 0.93, 0.86] },
  },
};

/* ---- Helyettesítő mércék ----
   Ezekre a forrásnak nincs saját oldala, de van egy közeli rokonuk UGYANAZON
   a gépen / kábelen. A rokon küszöbét kapják, és mindegyik `approximate`
   (a forrásuk is az), tehát a felület úgyis tájékoztatóként jelöli őket.
   Az ismert irány: a ferde gépi nyomás jellemzően 10-15%-kal gyengébb a
   vízszintesnél, a szint itt tehát inkább szigorú, mint hízelgő. */
const PROXIES = {
  'Alsó kábeles keresztezés': 'Kábeles keresztezés',
  'Felső kábeles keresztezés': 'Kábeles keresztezés',
  'Gépi ferde nyomás': 'Gépi mellnyomás',
};
for (const [name, source] of Object.entries(PROXIES)) {
  strengthStandards[name] = { ...strengthStandards[source], proxyOf: source };
}

/** Kezenkénti-e a gyakorlat beírt súlya. A felület ebből teszi ki a „/ kéz"
    jelölést. */
export const isPerHand = (exercise) => Boolean(strengthStandards[exercise]?.perHand);

/** Az életkori szorzó. Ismeretlen életkorra 1 — a küszöb a 25-40 éves sávé. */
export function ageFactor(age) {
  if (!Number.isFinite(age)) return 1;
  const ages = Object.keys(AGE_FACTORS).map(Number);
  const clamped = Math.min(Math.max(age, ages[0]), ages[ages.length - 1]);
  const lower = ages.filter((a) => a <= clamped).pop();
  const upper = ages.find((a) => a >= clamped);
  if (lower === upper) return AGE_FACTORS[lower];
  const t = (clamped - lower) / (upper - lower);
  return AGE_FACTORS[lower] + (AGE_FACTORS[upper] - AGE_FACTORS[lower]) * t;
}

/** Az öt szint küszöbe kilogrammban az adott emberre, vagy null. */
export function levelThresholds(exercise, sex, bodyweight, age = null) {
  const table = strengthStandards[exercise]?.[sex];
  if (!table || !(bodyweight > 0)) return null;
  const bw = Math.min(Math.max(bodyweight, BODYWEIGHT_RANGE[0]), BODYWEIGHT_RANGE[1]);
  const scale = bw / REF_BODYWEIGHT[sex];
  const factor = ageFactor(age);
  return table.kg.map((kg, i) => kg * scale ** table.exp[i] * factor);
}

/**
 * Egy rekord erőszintje.
 *
 * @param {string} exercise   gyakorlat neve (a katalógus pontos neve)
 * @param {string|null} sex   'male' | 'female' | null
 * @param {number} max1rm     a becsült 1RM (kg) — saját testsúlyosnál a teljes terhelés
 * @param {number} bodyweight aktuális testsúly (kg)
 * @param {number|null} age   életkor években, vagy null
 * @returns {{ level: string, tier: string, ratio: number, approximate: boolean }|null}
 *          null, ha nincs mihez mérni
 */
export function strengthTier(exercise, sex, max1rm, bodyweight, age = null) {
  const thresholds = levelThresholds(exercise, sex, bodyweight, age);
  if (!thresholds || !(max1rm > 0)) return null;

  // A kezdő küszöb alatt is „kezdő": aki naplózott egy rekordot, az már úton van.
  let index = 0;
  thresholds.forEach((kg, i) => {
    if (max1rm >= kg) index = i;
  });
  const level = LEVELS[index];
  return {
    level,
    tier: LEVEL_TIER[level],
    ratio: Math.round((max1rm / bodyweight) * 100) / 100,
    approximate: Boolean(strengthStandards[exercise].approximate),
  };
}
