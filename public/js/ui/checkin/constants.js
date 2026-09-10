/** A napi check-in varázsló konstansai: lépések, skálák, testrégiók, kapuk. */

/** A mindig jelen lévő lépések. A testtérképeket a kapu-válaszok fűzik be
    (lásd ciStepOrder) — ezért nincs külön „ugorj ide" logika sehol. */
const CI_BASE_STEPS = ['intro', 'sleep', 'sleepq', 'energy', 'stress', 'weight', 'soreGate'];

/** A skála-lépések kulcsa → a CHECKIN_SCALES mezőneve. */
const CI_SCALE_STEPS = { sleepq: 'sleepQuality', energy: 'energy', stress: 'stress' };

const CI_SLEEP_PRESETS = [6, 7, 7.5, 8, 8.5];

const CI_SLEEP_MIN = 0;

/* A varázsló korábban 12 óránál elvágta az alvást, a részletes űrlap és a
   szerver viszont 24-ig fogad el. Az eltérés némán csonkította a bevitelt
   (betegség, bepótolt alvás után 13 órából 12 lett), ezért a varázsló is
   0–24-gyel fut. */
const CI_SLEEP_MAX = 24;

/* A testsúly-lépés. A tartomány a szerverével egyezik (server.js) — a
   kliens csak beszédesebb hibát ad, nem enged át mást. */
const CI_WEIGHT_MIN = 30;

const CI_WEIGHT_MAX = 300;

/** Gyorsgombok a viszonyítási mérés köré, kilóban. */
const CI_WEIGHT_PRESET_OFFSETS = [-0.5, 0, 0.5];

/** A ± gombok kiindulópontja, ha még soha nem mértél. */
const CI_WEIGHT_FALLBACK = 80;

/**
 * Testtérkép-régiók a 220×420-as rajzterületen: [izomkulcs, x, y, szélesség, magasság].
 * A bal/jobb páros téglalapok SZÁNDÉKOSAN ugyanarra az izomkulcsra mutatnak:
 * az adatmodell nem oldalfüggő (server/muscles.js), tehát a két téglalap egyetlen
 * logikai vezérlő két fele. A két nézet uniója pontosan a kilenc MUSCLE_GROUPS
 * kulcs — egyik csoport sem érhetetlen el.
 */
const CI_BODY_REGIONS = {
  front: [
    ['shoulders', 24, 52, 42, 24], ['shoulders', 154, 52, 42, 24],
    ['chest', 72, 56, 76, 42],
    ['arms', 8, 82, 34, 100], ['arms', 178, 82, 34, 100],
    ['core', 74, 102, 72, 72],
    ['quads', 58, 182, 44, 98], ['quads', 118, 182, 44, 98],
    ['calves', 60, 288, 40, 84], ['calves', 120, 288, 40, 84],
  ],
  back: [
    ['shoulders', 24, 52, 42, 24], ['shoulders', 154, 52, 42, 24],
    ['back', 72, 56, 76, 60],
    ['arms', 8, 82, 34, 100], ['arms', 178, 82, 34, 100],
    ['glutes', 66, 160, 88, 46],
    ['hamstrings', 58, 212, 44, 70], ['hamstrings', 118, 212, 44, 70],
    ['calves', 60, 288, 40, 84], ['calves', 120, 288, 40, 84],
  ],
};

/** A két kapu-lépés szövegei és a hozzájuk tartozó állapot-kulcs. */
const CI_GATES = {
  soreGate: {
    key: 'sore', eyebrow: 'Részletes kitöltés', title: 'Van izomlázad valahol?',
    sub: 'Az edzés utáni szokásos izommerevség. Ha nincs, kihagyjuk ezt a lépést.',
    no: ['Nincs izomlázam', 'Ugorhatunk tovább'],
    yes: ['Van, megjelölöm', 'Koppints az érintett izmokra'],
  },
  painGate: {
    key: 'pain', eyebrow: 'Fájdalom · sérülés', title: 'Van éles fájdalmad vagy sérülésed?',
    sub: 'Ez más, mint az izomláz. A 7-es vagy nagyobb érték letiltja az érintett izmot terhelő gyakorlatokat.',
    no: ['Nincs, csak izomláz', 'Ugorhatunk az összegzésre'],
    yes: ['Van fájdalom vagy sérülés', 'Jelöld be, hol érzed'],
  },
};

/** A két testtérkép-mód. A `field` az answers-beli kulcs is egyben. */
const CI_MAP_MODES = {
  soreness: {
    field: 'soreness', max: 5, defaultValue: 3, noun: 'izomláz',
    eyebrow: 'Részletes kitöltés', title: 'Hol van izomlázad?',
    sub: 'Koppints egy izomra, majd csúsztasd fel/le az erősséghez. Amit kihagysz, az 0 marad.',
    legend: '1 = alig érezhető · 5 = nagyon erős izomláz.',
  },
  painMap: {
    field: 'pain', max: 10, defaultValue: 5, noun: 'fájdalom',
    eyebrow: 'Fájdalom · sérülés', title: 'Hol fáj pontosan?',
    sub: 'Koppints a fájó területre, majd csúsztasd fel/le az erősséghez (1–10).',
    legend: '1 = enyhe · 10 = nagyon erős. A 7-es vagy nagyobb érték letiltja az izmot terhelő gyakorlatokat.',
  },
};

/** Hány képernyő-pixel egy értéklépés húzáskor. */
const CI_DRAG_PX_PER_STEP = 14;

/** Automatikus továbblépés késleltetése koppintás után. */
const CI_ADVANCE_MS = 260;

const CI_PRESET_ADVANCE_MS = 140;

/** A motor 7-TŐL tiltja a gyakorlatokat (server/recovery.js:486), nem 7 fölött. */
const CI_PAIN_BLOCK = 7;

const CI_READINESS_VERDICTS = { ok: 'Jó készenlét', warn: 'Közepes', bad: 'Óvatosan ma' };

export { CI_ADVANCE_MS, CI_BASE_STEPS, CI_BODY_REGIONS, CI_DRAG_PX_PER_STEP, CI_GATES, CI_MAP_MODES, CI_PAIN_BLOCK, CI_PRESET_ADVANCE_MS, CI_READINESS_VERDICTS, CI_SCALE_STEPS, CI_SLEEP_MAX, CI_SLEEP_MIN, CI_SLEEP_PRESETS, CI_WEIGHT_FALLBACK, CI_WEIGHT_MAX, CI_WEIGHT_MIN, CI_WEIGHT_PRESET_OFFSETS };
