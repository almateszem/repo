/**
 * FitTrack Pro — seed / referencia-adat
 * -------------------------------------
 * A SQLite adatbázis (server/db.js) kiinduló tartalma: minden indításkor
 * innen szinkronizálódnak a csak-olvasható kollekciók (INSERT OR REPLACE),
 * így ez a fájl a referencia-adat egyetlen szerkesztési helye. A felhasználói
 * adatot tartó táblákat (weight_log, nutrition_log, workouts) nem érinti.
 */

export const data = {
  /* A bejelentkezett felhasználó. A szerepkör-jelzők: van-e edzője, edz-e másokat. */
  user: { name: 'Németh Dávid', hasCoach: true, coachesAthletes: true },
  charts: {
    weeklyCalories: {
      heights: [22, 26, 24, 30, 34, 33, 40, 46, 50, 55, 60, 66, 72, 78, 84, 90, 96, 100],
      axis: ['2200', '1650', '1100', '550'],
    },
    benchProgress: {
      heights: [30, 34, 38, 40, 46, 52, 58, 64, 70, 78, 86, 100],
      axis: ['110 kg', '90 kg', '70 kg', '50 kg'],
    },
    bodyWeight: {
      heights: [34, 33, 38, 42, 40, 47, 52, 50, 58, 64, 70, 76],
      axis: ['86 kg', '84 kg', '82 kg', '80 kg'],
    },
    /* Heti volumen-összehasonlítás — a workout oldal váltógombja e kettő
       között váltogat (total: tonna, note: a felirat a diagram alatt). */
    volumeThisWeek: {
      heights: [74, 8, 90, 8, 82, 58, 8],
      axis: ['8 t', '6 t', '4 t', '2 t'],
      total: 24.8,
      note: '+8% a múlt héthez képest',
      ariaLabel: 'Heti edzésvolumen naponta — ez a hét',
    },
    volumeLastWeek: {
      heights: [66, 8, 78, 8, 74, 52, 8],
      axis: ['8 t', '6 t', '4 t', '2 t'],
      total: 22.9,
      note: 'a múlt hét összvolumene',
      ariaLabel: 'Heti edzésvolumen naponta — múlt hét',
    },
  },
  /* Az áttekintő (dashboard) adatai. A dailyStats (kalória/fehérje) NINCS itt:
     azt a szerver számolja a táplálkozási naplóból (GET /api/dashboard),
     hogy a dashboard és a Táplálkozás oldal ugyanazt mutassa. */
  dashboard: {
    readiness: 52,
    streak: 25,
    recovery: { sleep: '7.5 óra', fatigue: 'Közepes', soreness: 'Enyhe' },
    workoutName: 'Mell hétfő',
  },
  exercises: [
    {
      name: 'Fekvenyomás',
      pr: true,
      sets: [
        { reps: '20 rep', weight: '65% TM', rpe: '8', done: true },
        { reps: '20 rep', weight: '65% TM', rpe: '8.5', done: true },
        { reps: '18 rep', weight: '70% TM', rpe: '9', done: false },
      ],
    },
    {
      name: 'Guggolás',
      pr: false,
      sets: [
        { reps: '15 rep', weight: '60% TM', rpe: '7', done: true },
        { reps: '15 rep', weight: '60% TM', rpe: '7.5', done: false },
      ],
    },
    {
      name: 'Vállból nyomás',
      pr: false,
      sets: [
        { reps: '12 rep', weight: '55% TM', rpe: '7', done: false },
      ],
    },
  ],
  defaultSet: { reps: '12 rep', weight: '60% TM', rpe: '–', done: false },
  /* A gyakorlat-választó (edzésépítő) katalógusa. A group a szűrő-chipek
     alapja — a chipek listája ebből áll össze, új csoport felvételéhez elég
     ide új gyakorlatot írni. */
  exerciseCatalog: [
    { name: 'Fekvenyomás', tag: 'Összetett', muscles: 'Mell · Tricepsz', group: 'Mell' },
    { name: 'Ferde fekvenyomás', tag: 'Összetett', muscles: 'Felső mell', group: 'Mell' },
    { name: 'Tolódzkodás', tag: 'Összetett', muscles: 'Mell · Tricepsz', group: 'Mell' },
    { name: 'Kábeles keresztezés', tag: 'Izolációs', muscles: 'Mell', group: 'Mell' },
    { name: 'Gépi mellnyomás', tag: 'Izolációs', muscles: 'Mell', group: 'Mell' },
    { name: 'Húzódzkodás', tag: 'Összetett', muscles: 'Hát · Bicepsz', group: 'Hát' },
    { name: 'Ülő evezés', tag: 'Összetett', muscles: 'Hát', group: 'Hát' },
    { name: 'Széles lehúzás', tag: 'Izolációs', muscles: 'Széles hát', group: 'Hát' },
    { name: 'Vállból nyomás', tag: 'Összetett', muscles: 'Váll', group: 'Váll' },
    { name: 'Oldalemelés', tag: 'Izolációs', muscles: 'Váll', group: 'Váll' },
    { name: 'Guggolás', tag: 'Összetett', muscles: 'Comb · Far', group: 'Láb' },
    { name: 'Kitörés', tag: 'Összetett', muscles: 'Comb · Far', group: 'Láb' },
    { name: 'Lábtolás', tag: 'Izolációs', muscles: 'Comb', group: 'Láb' },
  ],
  history: [
    { date: '2026.06.29', detail: '3×20 @ 65% TM', rpe: 'RPE 8' },
    { date: '2026.06.22', detail: '3×18 @ 62% TM', rpe: 'RPE 7' },
    { date: '2026.06.15', detail: '3×18 @ 60% TM', rpe: 'RPE 7' },
  ],
  prs: [
    { exercise: 'Fekvenyomás', result: '110 kg × 1', delta: '+2.5 kg', date: '2026.06.29' },
    { exercise: 'Guggolás', result: '150 kg × 1', delta: '+5 kg', date: '2026.06.12' },
    { exercise: 'Felhúzás', result: '185 kg × 1', delta: '+5 kg', date: '2026.05.28' },
    { exercise: 'Vállból nyomás', result: '62.5 kg × 1', delta: '+2.5 kg', date: '2026.05.09' },
    { exercise: 'Fekvenyomás', result: '107.5 kg × 1', delta: '+2.5 kg', date: '2026.04.20' },
    { exercise: 'Guggolás', result: '145 kg × 1', delta: '+5 kg', date: '2026.04.03' },
  ],
  foods: [
    { name: 'Csirkemell', kcal: 200, protein: 20, carbs: 0, fat: 4, per: '100 g' },
    { name: 'Rizs (főtt)', kcal: 130, protein: 3, carbs: 28, fat: 0, per: '100 g' },
    { name: 'Tojás', kcal: 155, protein: 13, carbs: 1, fat: 11, per: '100 g' },
    { name: 'Zabpehely', kcal: 375, protein: 13, carbs: 66, fat: 7, per: '100 g' },
    { name: 'Túró (sovány)', kcal: 98, protein: 18, carbs: 4, fat: 0.5, per: '100 g' },
    { name: 'Lazac', kcal: 208, protein: 20, carbs: 0, fat: 13, per: '100 g' },
    { name: 'Banán', kcal: 89, protein: 1, carbs: 23, fat: 0.3, per: '100 g' },
  ],
  /* A kiosztott tervek gyakorlatai a workouts.exercises-szel azonos alakúak —
     a Tervek nyíl-gombja így bármelyik tervet be tudja tölteni az edzésnaplóba. */
  plans: [
    {
      name: 'Tömegnövelő 4 napos', meta: 'Kiosztva: Kovács Bence · 4 hét', progress: 62,
      exercises: [
        { name: 'Fekvenyomás', pr: false, sets: [
          { reps: '12 rep', weight: '70% TM', rpe: '7', done: false },
          { reps: '12 rep', weight: '70% TM', rpe: '8', done: false },
          { reps: '10 rep', weight: '75% TM', rpe: '8.5', done: false },
        ] },
        { name: 'Ferde fekvenyomás', pr: false, sets: [
          { reps: '12 rep', weight: '65% TM', rpe: '7', done: false },
          { reps: '10 rep', weight: '70% TM', rpe: '8', done: false },
        ] },
        { name: 'Ülő evezés', pr: false, sets: [
          { reps: '12 rep', weight: '70% TM', rpe: '7', done: false },
          { reps: '12 rep', weight: '70% TM', rpe: '8', done: false },
        ] },
        { name: 'Guggolás', pr: false, sets: [
          { reps: '10 rep', weight: '70% TM', rpe: '8', done: false },
          { reps: '10 rep', weight: '70% TM', rpe: '8', done: false },
          { reps: '8 rep', weight: '75% TM', rpe: '9', done: false },
        ] },
      ],
    },
    {
      name: 'Erőnléti alapok', meta: 'Kiosztva: Kovács Bence · 6 hét', progress: 100,
      exercises: [
        { name: 'Guggolás', pr: false, sets: [
          { reps: '5 rep', weight: '80% TM', rpe: '8', done: false },
          { reps: '5 rep', weight: '80% TM', rpe: '8', done: false },
          { reps: '5 rep', weight: '80% TM', rpe: '8.5', done: false },
        ] },
        { name: 'Fekvenyomás', pr: false, sets: [
          { reps: '5 rep', weight: '80% TM', rpe: '8', done: false },
          { reps: '5 rep', weight: '80% TM', rpe: '8.5', done: false },
        ] },
        { name: 'Húzódzkodás', pr: false, sets: [
          { reps: '8 rep', weight: 'saját súly', rpe: '8', done: false },
          { reps: '8 rep', weight: 'saját súly', rpe: '9', done: false },
        ] },
      ],
    },
    {
      name: 'Deload hét', meta: 'Kiosztva: Kovács Bence · 1 hét', progress: 15,
      exercises: [
        { name: 'Guggolás', pr: false, sets: [
          { reps: '10 rep', weight: '50% TM', rpe: '5', done: false },
          { reps: '10 rep', weight: '50% TM', rpe: '5', done: false },
        ] },
        { name: 'Fekvenyomás', pr: false, sets: [
          { reps: '10 rep', weight: '50% TM', rpe: '5', done: false },
          { reps: '10 rep', weight: '50% TM', rpe: '5', done: false },
        ] },
        { name: 'Oldalemelés', pr: false, sets: [
          { reps: '15 rep', weight: 'könnyű', rpe: '5', done: false },
        ] },
      ],
    },
  ],
  /* Az edzői panel sportolói. Az összpontszám a readiness és az adherence
     átlaga; az alert mező (ha van) az állapot-sáv riasztásait hajtja. */
  athletes: [
    {
      id: 'petra', name: 'Nagy Petra', goal: 'ERŐ',
      readiness: 91, adherence: 94, streak: 18,
      lastWorkout: 'ma', weekly: '4/4', plan: 'Erőnléti alapok',
      alert: null,
      recent: [
        'Guggolás 5×5 @ 120 kg — ma',
        'Új PR: felhúzás 140 kg — 2 napja',
        'Heti check-in kitöltve — hétfő',
      ],
      lastMessage: '„Megvolt a mai edzés, a guggolás nagyon jól ment! 💪”',
    },
    {
      id: 'mark', name: 'Szabó Márk', goal: 'TÖM',
      readiness: 84, adherence: 81, streak: 6,
      lastWorkout: 'tegnap', weekly: '3/4', plan: 'Tömegnövelő 4 napos',
      alert: null,
      recent: [
        'Fekvenyomás 3×8 @ 82.5 kg — tegnap',
        'Testsúly rögzítve: 86.4 kg — tegnap',
        'Technika videó feltöltve: vállból nyomás — 3 napja',
      ],
      lastMessage: '„A vállból nyomásnál küldtem egy új videót, ránéznél?”',
    },
    {
      id: 'lili', name: 'Horváth Lili', goal: 'FIT',
      readiness: 78, adherence: 85, streak: 9,
      lastWorkout: 'tegnap', weekly: '3/4', plan: 'Erőnléti alapok',
      alert: null,
      recent: [
        'Köredzés teljesítve — tegnap',
        'Táplálkozási napló vezetve 7 napja folyamatosan',
        'Heti check-in kitöltve — kedd',
      ],
      lastMessage: '„A hétvégi futást beszámoljam az edzések közé?”',
    },
    {
      id: 'dora', name: 'Kiss Dóra', goal: 'FGY',
      readiness: 58, adherence: 76, streak: 0,
      lastWorkout: '4 napja', weekly: '1/4', plan: 'Deload hét',
      alert: '2 kihagyott edzés · készenlét 58%',
      recent: [
        'Kihagyott edzés: alsótest — szerda',
        'Alvás 5.1 óra átlag az elmúlt 3 napban',
        'Utolsó edzés: teljes test — 4 napja',
      ],
      lastMessage: '„Bocsi, ez a hét kicsit sűrű lett a munka miatt…”',
    },
    {
      id: 'adam', name: 'Tóth Ádám', goal: 'ÁLL',
      readiness: 72, adherence: 64, streak: 2,
      lastWorkout: '3 napja', weekly: '2/4', plan: 'Erőnléti alapok',
      alert: 'Heti check-in 5 napja késik',
      recent: [
        'Intervall futás 6×400 m — 3 napja',
        'Heti check-in: még nincs kitöltve',
        'Pulzuszóna-riport elérhető — hétfő',
      ],
      lastMessage: '„A futóedzés megvolt, a check-int este pótolom!”',
    },
  ],
  /* Szimulált sportoló-válaszok az üzenetküldéshez (körbeforgó sorrendben). */
  athleteReplies: [
    '„Rendben, köszi a visszajelzést!”',
    '„Vettem, holnap eszerint csinálom. 💪”',
    '„Köszönöm! Este küldök róla videót.”',
  ],
  /* A saját edző (Kovács Bence) hírfolyamának kezdő üzenetei — a kliens
     nézet chatje ezekből indul (variant: 'plan' = terv-módosítás értesítő). */
  coachNotes: [
    {
      meta: 'Kovács Bence · 3 napja',
      text: '„A guggolás mélysége sokat javult a videód alapján — így tovább! 💪”',
    },
    {
      meta: 'Kovács Bence · 2 napja',
      text: 'Frissítettem a szombati edzésed: a felhúzás 5×3-ra módosult 82%-on. Nézd meg a Tervek oldalon.',
      variant: 'plan',
    },
    {
      meta: 'Kovács Bence · tegnap',
      text: '„Szép munka a fekvenyomásnál! A 3. szettben már fáradt a technika — legközelebb állj meg RPE 8-nál.”',
    },
  ],
  /* Szimulált edző-válaszok a kliens chathez (körbeforgó sorrendben). */
  coachReplies: [
    '„Rendben, ránézek ma este a naplódra!”',
    '„Jó kérdés — a következő heti tervben módosítom.”',
    '„Vettem! A csütörtöki check-innél átbeszéljük. 💪”',
  ],
  notifications: [
    { text: 'Kovács Bence kiosztotta a „Tömegnövelő 4 napos” tervet', time: '2 órája', cat: 'plan' },
    { text: 'Új edzői megjegyzés érkezett a fekvenyomás videódra', time: '5 órája', cat: 'comment' },
    { text: '🔥 Elérted a 25 napos edzés-sorozatot', time: 'tegnap', cat: 'streak' },
    { text: 'Heti fejlődési riportod elkészült', time: 'tegnap', cat: 'report' },
    { text: 'Kovács Bence módosította a szombati edzésed', time: '2 napja', cat: 'planChange' },
    { text: 'Emlékeztető: töltsd ki a regenerációs naplót', time: '3 napja', cat: 'reminder' },
  ],
  /* Az edző által kitűzött napi táplálkozási cél. */
  nutritionGoal: { calories: 2900, protein: 170 },
};
