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
    field: 'soreness', max: 10, defaultValue: 5, noun: 'izomláz',
    eyebrow: 'Részletes kitöltés', title: 'Hol van izomlázad?',
    sub: 'Koppints egy izomra, majd csúsztasd fel/le az erősséghez. Amit kihagysz, az 0 marad.',
    legend: '1 = alig érezhető · 10 = nagyon erős izomláz.',
  },
  painMap: {
    field: 'pain', max: 10, defaultValue: 5, noun: 'fájdalom',
    eyebrow: 'Fájdalom · sérülés', title: 'Hol fáj pontosan?',
    sub: 'Koppints a fájó területre, majd csúsztasd fel/le az erősséghez (1–10).',
    legend: '1 = enyhe · 10 = nagyon erős. A 7-es vagy nagyobb érték letiltja az izmot terhelő gyakorlatokat.',
  },
};

/** Automatikus továbblépés késleltetése koppintás után. */
const CI_ADVANCE_MS = 260;

const CI_PRESET_ADVANCE_MS = 140;

/** A motor 7-TŐL tiltja a gyakorlatokat (server/recovery.js:486), nem 7 fölött. */
const CI_PAIN_BLOCK = 7;

const CI_READINESS_VERDICTS = { ok: 'Jó készenlét', warn: 'Közepes', bad: 'Óvatosan ma' };

export { CI_ADVANCE_MS, CI_BASE_STEPS, CI_GATES, CI_MAP_MODES, CI_PAIN_BLOCK, CI_PRESET_ADVANCE_MS, CI_READINESS_VERDICTS, CI_SCALE_STEPS, CI_SLEEP_MAX, CI_SLEEP_MIN, CI_SLEEP_PRESETS, CI_WEIGHT_FALLBACK, CI_WEIGHT_MAX, CI_WEIGHT_MIN, CI_WEIGHT_PRESET_OFFSETS };
