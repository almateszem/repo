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
  /* A név is csak tartalék: a /api/user a BEJELENTKEZETT fiók nevét adja
     vissza. A szerepkörök (van edződ / edzel másokat) korábban itt álltak fix
     értékkel — átkerültek a fiókhoz, ezért innen kikerültek. */
  user: { name: 'Németh Dávid' },
  charts: {
    /* A `weeklyCalories` görbe megszűnt: a dashboardon a helyén a napi
       check-in emlékeztető áll. Sosem a valódi táplálkozási naplóból jött,
       csak egy beégetett, monoton emelkedő demo-görbe volt. */
    /* A `benchProgress` görbe is megszűnt a `weeklyCalories` után: egy
       beégetett, mindig ugyanúgy emelkedő fekvenyomás-görbe volt, ráadásul fix
       gyakorlatra. Az edzés oldalon a helyén a naplózott edzések listája áll. */
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

  /* Az edzői panel sportolói és a szimulált üzenetváltás szövegkészlete is
     KIKERÜLT innen: a panel valódi kliensekből épül (users + coach_clients),
     az üzenetváltás pedig valódi (comments tábla, 'chat' céltípus). Beégetett
     válasz egy valódi edző nevében hazugság volna. */
  /* A napi táplálkozási cél ALAPÉRTÉKE. Ez már nem „az edző célja": a cél
     fiókonként él (nutrition_goals tábla), és két forrása lehet — amit az
     edző tűzött ki, és amit a felhasználó maga állított be. Ez a szám csak
     akkor szól, ha egyik sincs. */
  nutritionGoal: { calories: 2900, protein: 170 },
};
