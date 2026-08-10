/**
 * FitTrack Pro — seed / referencia-adat
 * -------------------------------------
 * A SQLite adatbázis (server/db.js) kiinduló tartalma: minden indításkor
 * innen szinkronizálódnak a csak-olvasható kollekciók (INSERT OR REPLACE).
 * A felhasználói adatot tartó táblákat (weight_log, nutrition_log, workouts)
 * nem érinti.
 *
 * A KÉT NAGY LISTA NEM ITT VAN. A gyakorlat- és az étel-katalógus saját
 * forrásfájlban él a server/data/ alatt, és a server/data/catalog.js fésüli
 * őket össze — a db.js azokat seedeli az `exerciseCatalog` és a `foods`
 * kulcs alá. Néhány száz soros adatlistát nem kényelmes ebben a vegyes
 * seed-fájlban tartani, és a generált gyakorlat-katalógust amúgy sem kézzel
 * szerkesztjük.
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
  /* A gyakorlat-katalógus NEM itt él, hanem két külön forrásfájlban:
     kézzel kurált gyakorlatok  → server/data/exercises.hu.js  (200 db)
     a külső datasetből generált → server/data/exercises.exdb.js (1216 db)
     A kettőt a server/data/catalog.js fésüli össze (kurált nyer névütközéskor),
     és a db.js onnan seedeli az `exerciseCatalog` kollekciót. Több száz soros
     adatlistának nincs helye ebben a vegyes seed-fájlban. */

  /* Az étel-katalógus sem itt él: server/data/foods.hu.js (437 étel,
     kategóriákkal és reális adagokkal). Összeállítás: server/data/catalog.js. */

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
