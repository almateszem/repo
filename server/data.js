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
    /* A heti volumen-összehasonlítást (volumeThisWeek/volumeLastWeek) a szerver
       számolja a mentett edzésekből (GET /api/charts) — itt nincs seed-adata. */
  },
  /* Az áttekintő (dashboard) adatai. Itt már NINCS semmi: a készenlét, a
     regenerációs sorok (alvás/fáradtság/izomláz), a sorozat, a dailyStats
     (kalória/fehérje) és az aktuális edzés neve mind számolt érték — a
     Recovery Engine (server/recovery.js), a napi check-in, a mentett edzések,
     a táplálkozási napló, ill. az aznapi piszkozat/terv adja őket
     (GET /api/dashboard). A kulcs azért marad, hogy a végpont mindig
     objektumot kapjon, amire ráolvaszthatja a számolt mezőket. */
  dashboard: {},
  /* Az új szettek alapértékei. Tiszta számok: az ismétlés és az RPE darab,
     a súly kilogramm — a felület szám-mezőkkel szerkeszti őket. */
  defaultSet: { reps: '10', weight: '60', rpe: '8', done: false },
  /* A gyakorlat-választó (edzésépítő) katalógusa. A group a szűrő-chipek
     alapja — a chipek listája ebből áll össze (a katalógus sorrendjében),
     ezért szándékosan DURVA: hat csoport, hogy a chip-sor rövid maradjon.
     A finom felbontás a `load` mezőben van: melyik izomcsoportot mennyire
     terheli a gyakorlat (a súlyok összege 1). Ezt a Recovery Engine használja
     az izomcsoportonkénti regeneráció becsléséhez — a kulcsok a
     server/muscles.js MUSCLE_GROUPS kulcsai. Kézzel beírt (katalóguson kívüli)
     gyakorlatnevekre a muscles.js kulcsszavas becslése ugrik be. */
  exerciseCatalog: [
    // — Mell —
    { name: 'Fekvenyomás', tag: 'Összetett', muscles: 'Mell · Tricepsz', group: 'Mell',
      load: { chest: 0.6, shoulders: 0.15, arms: 0.25 } },
    { name: 'Ferde fekvenyomás', tag: 'Összetett', muscles: 'Felső mell', group: 'Mell',
      load: { chest: 0.65, shoulders: 0.2, arms: 0.15 } },
    { name: 'Tolódzkodás', tag: 'Összetett', muscles: 'Mell · Tricepsz', group: 'Mell',
      load: { chest: 0.5, arms: 0.35, shoulders: 0.15 } },
    { name: 'Kábeles keresztezés', tag: 'Izolációs', muscles: 'Mell', group: 'Mell',
      load: { chest: 0.9, shoulders: 0.1 } },
    { name: 'Gépi mellnyomás', tag: 'Izolációs', muscles: 'Mell', group: 'Mell',
      load: { chest: 0.75, arms: 0.15, shoulders: 0.1 } },
    { name: 'Fekvőtámasz', tag: 'Összetett', muscles: 'Mell · Tricepsz', group: 'Mell',
      load: { chest: 0.55, arms: 0.25, shoulders: 0.15, core: 0.05 } },

    // — Hát —
    { name: 'Húzódzkodás', tag: 'Összetett', muscles: 'Hát · Bicepsz', group: 'Hát',
      load: { back: 0.7, arms: 0.25, core: 0.05 } },
    { name: 'Ülő evezés', tag: 'Összetett', muscles: 'Hát', group: 'Hát',
      load: { back: 0.7, arms: 0.2, shoulders: 0.1 } },
    { name: 'Hajolt evezés', tag: 'Összetett', muscles: 'Hát · Törzs', group: 'Hát',
      load: { back: 0.6, arms: 0.15, shoulders: 0.1, core: 0.15 } },
    { name: 'Széles lehúzás', tag: 'Izolációs', muscles: 'Széles hát', group: 'Hát',
      load: { back: 0.75, arms: 0.25 } },
    { name: 'Felhúzás', tag: 'Összetett', muscles: 'Hát · Hamstring · Far', group: 'Hát',
      load: { back: 0.35, hamstrings: 0.3, glutes: 0.25, core: 0.1 } },
    { name: 'Román felhúzás', tag: 'Összetett', muscles: 'Hamstring · Far', group: 'Hát',
      load: { hamstrings: 0.5, glutes: 0.3, back: 0.15, core: 0.05 } },
    { name: 'Hiperextenzió', tag: 'Izolációs', muscles: 'Deréktáj · Far', group: 'Hát',
      load: { back: 0.4, hamstrings: 0.3, glutes: 0.3 } },
    { name: 'Vállvonogatás', tag: 'Izolációs', muscles: 'Csuklyás', group: 'Hát',
      load: { back: 0.6, shoulders: 0.4 } },

    // — Váll —
    { name: 'Vállból nyomás', tag: 'Összetett', muscles: 'Váll · Tricepsz', group: 'Váll',
      load: { shoulders: 0.65, arms: 0.25, core: 0.1 } },
    { name: 'Arnold nyomás', tag: 'Összetett', muscles: 'Váll', group: 'Váll',
      load: { shoulders: 0.7, arms: 0.2, core: 0.1 } },
    { name: 'Oldalemelés', tag: 'Izolációs', muscles: 'Váll', group: 'Váll',
      load: { shoulders: 1 } },
    { name: 'Hátsó vállemelés', tag: 'Izolációs', muscles: 'Hátsó váll', group: 'Váll',
      load: { shoulders: 0.7, back: 0.3 } },
    { name: 'Face pull', tag: 'Izolációs', muscles: 'Hátsó váll · Hát', group: 'Váll',
      load: { shoulders: 0.6, back: 0.4 } },

    // — Kar —
    { name: 'Bicepsz hajlítás', tag: 'Izolációs', muscles: 'Bicepsz', group: 'Kar',
      load: { arms: 1 } },
    { name: 'Kalapács hajlítás', tag: 'Izolációs', muscles: 'Bicepsz · Alkar', group: 'Kar',
      load: { arms: 1 } },
    { name: 'Tricepsz nyújtás', tag: 'Izolációs', muscles: 'Tricepsz', group: 'Kar',
      load: { arms: 1 } },
    { name: 'Homlok nyomás', tag: 'Izolációs', muscles: 'Tricepsz', group: 'Kar',
      load: { arms: 1 } },
    { name: 'Szűk fekvenyomás', tag: 'Összetett', muscles: 'Tricepsz · Mell', group: 'Kar',
      load: { arms: 0.5, chest: 0.4, shoulders: 0.1 } },
    { name: 'Alkar hajlítás', tag: 'Izolációs', muscles: 'Alkar', group: 'Kar',
      load: { arms: 1 } },

    // — Láb —
    { name: 'Guggolás', tag: 'Összetett', muscles: 'Comb · Far', group: 'Láb',
      load: { quads: 0.55, glutes: 0.25, core: 0.2 } },
    { name: 'Első guggolás', tag: 'Összetett', muscles: 'Comb · Törzs', group: 'Láb',
      load: { quads: 0.6, glutes: 0.2, core: 0.2 } },
    { name: 'Kitörés', tag: 'Összetett', muscles: 'Comb · Far', group: 'Láb',
      load: { quads: 0.45, glutes: 0.35, hamstrings: 0.1, core: 0.1 } },
    { name: 'Bolgár kitörés', tag: 'Összetett', muscles: 'Comb · Far', group: 'Láb',
      load: { quads: 0.4, glutes: 0.4, hamstrings: 0.1, core: 0.1 } },
    { name: 'Lábtolás', tag: 'Izolációs', muscles: 'Comb', group: 'Láb',
      load: { quads: 0.7, glutes: 0.3 } },
    { name: 'Combnyújtás', tag: 'Izolációs', muscles: 'Quadriceps', group: 'Láb',
      load: { quads: 1 } },
    { name: 'Combhajlítás', tag: 'Izolációs', muscles: 'Hamstring', group: 'Láb',
      load: { hamstrings: 1 } },
    { name: 'Csípőtolás', tag: 'Összetett', muscles: 'Farizom', group: 'Láb',
      load: { glutes: 0.7, hamstrings: 0.25, core: 0.05 } },
    { name: 'Vádliemelés', tag: 'Izolációs', muscles: 'Vádli', group: 'Láb',
      load: { calves: 1 } },
    { name: 'Ülő vádliemelés', tag: 'Izolációs', muscles: 'Vádli', group: 'Láb',
      load: { calves: 1 } },

    // — Törzs —
    { name: 'Plank', tag: 'Izolációs', muscles: 'Törzs', group: 'Törzs',
      load: { core: 1 } },
    { name: 'Hasprés', tag: 'Izolációs', muscles: 'Hasizom', group: 'Törzs',
      load: { core: 1 } },
    { name: 'Fekvő lábemelés', tag: 'Izolációs', muscles: 'Alsó hasizom', group: 'Törzs',
      load: { core: 1 } },
    { name: 'Orosz csavarás', tag: 'Izolációs', muscles: 'Ferde hasizom', group: 'Törzs',
      load: { core: 0.85, arms: 0.15 } },
    { name: 'Farmer séta', tag: 'Összetett', muscles: 'Törzs · Alkar', group: 'Törzs',
      load: { core: 0.6, arms: 0.25, back: 0.15 } },
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
