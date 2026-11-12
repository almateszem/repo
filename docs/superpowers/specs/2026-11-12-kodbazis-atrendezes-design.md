# Kódbázis-átrendezés — tervdokumentum

_2026-11-12 · állapot: tervezet, végrehajtás az ITDK (2026-11-18) után olvad be_

## 1. Miért

A Podium kódja működik, és a tesztek is jók. A gond a kód elrendezésével van:

- **Zsúfolt a repó gyökere.** A kód mellett docx-, pdf-, pptx-fájlok, egy önéletrajz-sablon, két teendőlista és egy eldobott HTML-kísérlet is a gitben van, a generált `graphify-out/` mappával együtt.
- **Egy backend-funkció szétszóródik.** A blokkos programok a backendben **15 fájlt érintettek 6 mappában** (`program/`, `services/`, `db/`, `routes/`, `validation/`, `server.js`), a `scripts/seed-demo.js` pedig 1296 sorral nőtt. Egy témához tartozó dolgok 3–4 helyen ülnek (például `routes/coach.js` + `db/coaching.js` + `coaching.js`). A `server/` gyökerében 25 fájl hever ömlesztve.
- **Az `index.html` 4186 sor.** Benne van mind a 13 oldal és mind a 32 `<template>`.

A frontend JS már funkciómappákba van rendezve (`public/js/<téma>/`). A backend viszont rétegek szerint (db / routes / services), ezért a kettő között nehéz fejben ugrálni.

## 2. Sikerkritérium

> Egy új funkcióhoz **két mappához + egy CSS-fájlhoz** kell nyúlni: a funkció backend-mappájához (`server/features/<téma>/`), a frontend-mappájához (`public/js/<téma>/`) és a számozott CSS-fájljához.

Ehhez alkalmanként még hozzájöhet:

- a frontend-tesztje a `tests/public/js/<téma>/` alatt,
- új oldal esetén egy beillesztő sor a váz-HTML-ben és egy navigációs bejegyzés,
- egy sorszámozott adatmigráció, ha régi adatot kell átalakítani (ritka),
- ha a funkció a demóban is megjelenik, a szereplők fájljai a `scripts/demo/` alatt (a felhasználó döntése, lásd 6.3).

## 3. Célok, nem-célok, anti-célok

**Célok**

1. A repó gyökerében csak az app és a konfigurációja marad.
2. A backend funkciómappákba rendeződik; a közös infrastruktúra külön, egyértelmű helyre kerül.
3. Az `index.html` oldalanként és template-csoportonként szétbomlik, a darabok a funkció JS-e mellé kerülnek.
4. A `seed-demo.js` szereplőnként szétbomlik a `scripts/demo/` alá.
5. Az átmeneti újraexportáló „shim”-fájlok megszűnnek.
6. A README a projektstruktúrát már az új elrendezés szerint írja le.

**Nem-célok** (most kimaradnak)

- Bugvadászat, új funkció, viselkedésváltozás.
- A CSS átszervezése: a számozott `public/css/NN-*.css` fájlok maradnak, a tartalmukhoz sem nyúlunk.
- A JS-logika átírása. Fájlok mozgatása, importok javítása, egy nagy fájl témák mentén való kettévágása belefér; algoritmus vagy API-forma megváltoztatása nem.
- Build-eszköz, bundler vagy új npm-függőség bevezetése.

**Anti-célok** (ha ezek bármelyike bekövetkezik, a munka kudarc, még ha „működik” is)

- A felhasználó bármilyen különbséget lát: más kinézet, más viselkedés, más API-válasz, más adat a demó-adatbázisban.
- A `main` ág november 18. előtt megváltozik.
- Elveszik egy dokumentum (ITDK, OTIO, prezentáció stb.).
- A fájlok git-története elszakad: másolás+törlés történik `git mv` helyett, vagy egy commitban túl sok minden változik ahhoz, hogy a git átnevezésként ismerje fel.
- Egy lépés után piros teszttel vagy lint-hibával megy tovább a munka.

## 4. Kényszerek

- **ITDK, 2026-11-18.** A bírálók a GitHubon a `main`-t látják, és az ITDK-dokumentáció 4.9-es fejezete a mostani szerkezetet írja le (59 kódútvonalat említ). A `main` a konferenciáig érintetlen marad; az átrendezés külön ágon készül, és csak utána olvad be.
- **Ág:** `kodbazis-atrendezes`, a `blokkos-programok` ág csúcsáról indítva. A `blokkos-programok` még nincs a `main`-ben, és a demó (5/3/1 program) már rá épül. Ha a `blokkos-programok`-ra a munka közben új commit kerül, minden fázis előtt be kell olvasztani.
- Node ≥ 22.5, ESM, `node:sqlite`, build-lépés nincs. Ez így marad.
- A commitokban nem lehet Claude-jelölés: se `Co-Authored-By` trailer, se Claude mint szerző.
- A CSS marad a számozott fájlokban (ez a felhasználó döntése).
- A projekten jelenleg egy ember dolgozik. A távoli ágak (`origin/CsanadBranch/...`, `origin/Viktor/...` stb.) régiek, ezekkel nem kell összeegyeztetni a munkát.

## 5. Döntések

### A felhasználó döntései

1. **Ütemezés:** külön ágon, most; a `main` november 18-ig érintetlen.
2. **Dokumentumok a repón kívülre**, a gépre. Nem kell, hogy a GitHubon legyenek.
3. **Az `index.html` szétbomlik.**
4. **A frontend-oldal HTML-je a JS-e mellé kerül.**
5. **A CSS marad a számozott fájlokban.**
6. **Egy funkció egy helyen** a backendben is.
7. **A siker „két mappa + CSS”**, nem szó szerinti egy mappa.
8. **A demó-adat szereplőnként bomlik** (`scripts/demo/`), nem témánként a funkciómappákba. A demó így garantáltan azonos marad, cserébe kívül esik a „két mappa” szabályon.

### A tervező döntései (felülbírálhatók)

| # | Döntés | Indok |
|---|--------|-------|
| T1 | A dokumentumok helye: `C:\Users\user\Documents\Podium-iratok\` (a repó testvérmappája) | Közel van, könnyű megtalálni, és nincs a gitben. |
| T2 | A `graphify-out/` kikerül a gitből, és bekerül a `.gitignore`-ba | Generált kimenet, `npm run graph` újraépíti. |
| T3 | Az oldalakat a **szerver fűzi össze** egyetlen HTML-lé; a böngésző ugyanazt kapja, mint most | Nem kell build-lépés, a frontend JS-hez, a CSP-hez és a routerhez sem kell nyúlni. A böngészős fetch villanást és init-átírást hozna, a JS-stringbe tett template olvashatatlan. |
| T4 | Backend: `server/features/<téma>/` + `server/core/` | A frontend `public/js/<téma>/` mintáját tükrözi. |
| T5 | A funkciómappákat a **`server/core/db/` betöltése fedezi fel** (top-level `await import`, központi lista nélkül), nem csak a szerverindítás. Így a tesztek, a migrációs al-folyamatok és a `seed-demo` ugyanúgy egy importtal kapnak kész adatbázist, mint ma a `server/db.js`-szel. A `server.js` ugyanazt a felfedezett listát használja a végpontokhoz. | Új funkciónál így a `server.js`-hez nem kell nyúlni (sikerkritérium), és a szerveren kívüli hívók sem maradnak adatbázis nélkül. |
| T6 | A backend-tesztek a funkciómappába kerülnek (`server/features/<téma>/*.test.js`); a több funkciót átfogó tesztek a `tests/server/` alatt maradnak | A `server/` mappát a böngésző nem éri el, ezért ez biztonságos. |
| T7 | A frontend-tesztek maradnak a `tests/public/js/<téma>/` alatt | A `public/` alá kerülve a szerver nyilvánosan kiszolgálná őket. |
| T9 | **Ami ma van, befagy a `core/db/`-ben:** a meglévő `ensureColumns` hívások (verziókapuval, a `plansHad*` visszatérési értékekkel és az `ENSURED_COLUMNS` listával), a sorszámozott migrációk (`user_version` 2…6), a sorrendjük és a funkció-modulokra mutató importjaik. Ez az egyetlen hely, ahol a `core/` statikusan importálhat a `features/`-ből. **Ami ezután jön, a funkcióhoz kerül:** új oszlop a funkció `columns` listájába, új sorszámozott migráció (7-től) a funkció `migrations` listájába. Ezeket a core összegyűjti és globálisan verziószám szerint futtatja. | A történeti lépések sorrendfüggők és összefonódnak, átírásuk kockázat, haszon nélkül. Az új munka viszont már a funkció mappájában marad. |
| T10 | Az átmeneti shimek (`server/db.js`, ami csak a `db/index.js`-t exportálja újra) megszűnnek. **Nincs központi újraexportálás sem:** a hívók (szerver, tesztek, seed) közvetlenül a funkció moduljából importálják az adatfüggvényeket. A tesztek importútvonalai ezért változnak. | Egyszerűsítés: egy dolognak egy neve legyen, és ne kelljen egy központi listát karbantartani. |
| T11 | **Témanevek:** ahol van frontend-párja, a backend-funkció a frontend-mappa nevét kapja (`workout`, `plans`, `program`, `nutrition`, `coach`, `recovery`, `dashboard`). Frontend-mappa nem nevezünk át. Ahol nincs pár: `auth`, `catalog`. A `recovery` a check-int, a testsúlyt, a testméreteket és a regenerációt is lefedi; a frontend `checkin/` mappájának backend-párja tehát a `recovery`. | Így a „két mappa” ugyanazzal a névvel kereshető, és a frontendben nem kell átnevezni semmit. |
| T12 | **Mozgató commit** = `git mv` + az ebből következő importútvonal-javítások, ugyanabban a commitban, logikai változás nélkül. A tartalmi változás (kettévágás, szerződésre átírás) külön commit. | ES-modulban a puszta `git mv` eltöri az importokat, a „minden commit után zöld” szabály pedig így is betartható. |

## 6. A célszerkezet

```
repo/
├─ server/
│  ├─ server.js              ← Express-alkalmazás: middleware-ek, funkció-felfedezés, statikus kiszolgálás
│  ├─ core/                  ← közös infrastruktúra, egyik funkcióé sem
│  │  ├─ db/                 ← connection, alap-séma (users, sessions), migráció-futtató,
│  │  │                         a befagyasztott sorszámozott migrációk, baseline-őr
│  │  ├─ http/               ← session, access, headers (CSP), ratelimit, errors
│  │  ├─ page.js             ← az index.html összefűzése (T3)
│  │  └─ lib/                ← dates, numbers és más tiszta segédfüggvények
│  ├─ features/              ← nevek a frontend-mappákhoz igazodnak (T11)
│  │  ├─ auth/               ← fiókok, belépés, regisztráció, munkamenetek
│  │  ├─ workout/            ← edzésnapló, szettek, PR-ek, rekordok, javaslatok, terhelés
│  │  ├─ catalog/            ← gyakorlat-katalógus, keresés, izomcsoportok, erőstandardok, referencia-végpontok
│  │  ├─ plans/              ← edzéstervek, heti terv
│  │  ├─ program/            ← blokkos programok (formula, szabályok, futtatás)
│  │  ├─ nutrition/          ← táplálkozás, ételek, OpenFoodFacts, víz
│  │  ├─ recovery/           ← check-in, testsúly, testméretek, regeneráció
│  │  ├─ dashboard/          ← az /api/dashboard összesítő végpont
│  │  └─ coach/              ← edző–sportoló kapcsolat, üzenetek, megjegyzések, értesítések
│  └─ data/                  ← nagy, generált vagy statikus adattáblák (exdb, foods.hu …) — maradnak
├─ public/
│  ├─ index.html             ← csak a váz: <head>, fejléc, navigáció, közös modálok + beillesztő jelölők
│  ├─ css/                   ← VÁLTOZATLAN
│  └─ js/<téma>/             ← <téma>.js … + <oldal>.html + a téma template-jei (*.tpl.html vagy hasonló)
├─ scripts/                  ← build-exdb, fetch-exdb-media, check-*, seed-demo (futtató), start-demo
│  └─ demo/                  ← bence.js, reka.js, david.js, coach.js + közös segédfájl (6.3)
├─ tests/
│  ├─ server/                ← átfogó tesztek: api, security, hardening, schema-parity, migrációk, test-harness
│  └─ public/js/<téma>/      ← frontend-tesztek
└─ docs/, README.md, package.json, konfigurációs fájlok
```

A témák felsorolása **javaslat**. A végleges besorolást a tényleges importok döntik el (lásd 7.2). Ha két javasolt téma ennyire összefonódik (például `workout` és `plans`), összevonhatók. Ha egy téma túl nagy, kettéválhat.

### 6.1 Egy funkciómappa szerződése

Minden `server/features/<téma>/` mappában van egy `index.js`, amely egy objektumot exportál. Minden mező opcionális:

```js
export default {
  name: 'program',
  after: [],         // a funkciók, amelyek után ennek kell jönnie (idegen kulcs, middleware-sorrend)
  tables,            // (db) => void — CREATE TABLE IF NOT EXISTS a saját tábláira
  columns,           // [{ table, column, ddl }] — ÚJ utólagos oszlopok (a régiek a core-ban, T9)
  migrations,        // [{ version: 7, run(db) }] — ÚJ sorszámozott migrációk (T9)
  indexes,           // (db) => void — CREATE INDEX IF NOT EXISTS
  registerPublic,    // (app, deps) => void — a belépés-őr ELŐTT (ma csak az auth)
  register,          // (app, deps) => void — a belépés-őr UTÁN
  jobs,              // [{ every: 'daily', run }] — időzített takarítás (lejárt munkamenet, vonalkód-cache)
};
```

- **A core adatbázis-indítása fázisokban halad, a mai sorrendet megtartva:**
  1. alap-táblák, majd minden funkció `tables`-e;
  2. a befagyasztott `ensureColumns` és a funkciók `columns`-a;
  3. a sorszámozott migrációk: a befagyasztott 2…6 és a funkciók 7+ lépései, verziószám szerint;
  4. minden `indexes`;
  5. a referencia-adatok seedelése.

  Az `ENSURED_COLUMNS` a befagyasztott és a funkció-oszlopokat is tartalmazza, így a `schema-parity` teszt mindkettőt ellenőrzi.
- **Felfedezés és sorrend:** a `server/features/*/index.js` fájlok névsorban töltődnek be, az `after` ezt felülírja. A mai sorrendnek kell kijönnie. A pontos megoldás a végrehajtóra van bízva.
- **A belépés-őr és a publikus auth-végpontok közti sorrend nem sérülhet:** minden `registerPublic`, majd az őr, majd minden `register`, majd az `/api` 404-kezelő, végül a statikus kiszolgálás.
- A közös függőségek (`deps`, például `catalogSearch`) ugyanúgy átadódnak, mint ma. Egy funkció importálhat egy másik funkció moduljából (például a `catalog` a `nutrition`-ből a `getFoodsForUser`-t), körkörös import nélkül.
- A `server.js`-ben marad: a middleware-ek, a felfedezett funkciók regisztrálása a fenti sorrendben, a `jobs` időzítése, az `/api` 404-kezelő és a statikus kiszolgálás. A `READ_ENDPOINTS` (ma a `server.js`-ben) a `catalog` funkcióhoz kerül.

### 6.2 Az `index.html` összefűzése

- A `public/index.html` a váz marad, benne beillesztő jelölők, például `<!-- @include js/coach/coach.html -->`. A jelölők sorrendje adja a DOM sorrendjét, így az pontosan a mai marad.
- A `server/core/page.js` fűzi össze a darabokat. Ugyanez a függvény kiszolgálja a `GET /` és a `GET /index.html` kérést, és a teszteknek is exportálva van.
- **Fejlesztés közben** egy HTML-darab módosítása után elég frissíteni a böngészőt, szerver-újraindítás nélkül. A gyorsítótárazás módja (például mtime-figyelés) a végrehajtóra van bízva.
- A template-ek (`tpl-*`) a funkciójuk mappájába kerülnek. A több funkció által használtak a `public/js/shared/` alá.
- **Átvételi próba:** az összefűzött kimenet tartalmilag azonos a mai `index.html`-lel. Az első lépésben ezt egy teszt rögzíti (normalizált whitespace-szel összevetve a szétbontás előtti példánnyal), és csak utána mozognak a darabok a funkciómappákba.
- A 3 teszt, amely ma közvetlenül az `index.html`-t olvassa (`icons`, `number-step`, `shortcuts`), az összefűzött kimenetet olvassa.
- A darabok a `public/js/…` alatt statikusan is elérhetők (`/js/coach/coach.html`). Ez ártalmatlan, nem kell tiltani.

### 6.3 A demó-adat

A `seed-demo.js` ma 8 hetet „lejátszik” a valódi adatréteg- és szolgáltatásfüggvényekkel, rögzített véletlenmaggal. Szereplőnként épül fel: `seedBence()`, `seedReka()`, `seedDavid()`, végül `seedCoach()`. Mindegyikben egy 56 napos ciklus fut, amely egy napon belül vegyesen naplóz testsúlyt, check-int, vizet, étkezést, edzést és program-lépést, egy közös véletlenszám-generátorból. **Ez a működés és a sorrend megmarad.** A szétbontás (a felhasználó döntése, A-változat):

- `scripts/seed-demo.js`: a futtató. Kezeli a régi `demo.db` törlését, a `--today` paramétert és a véletlenmagot, majd a mai sorrendben hívja a szereplőket. A `seedBence()` visszatérési értéke (`bencePlan`) ugyanúgy továbbadódik.
- `scripts/demo/bence.js`, `reka.js`, `david.js`, `coach.js`: egy-egy szereplő, a mai függvény változatlan tartalommal.
- `scripts/demo/common.js` (vagy hasonló): a közös segédfüggvények (`logMeal`, `logWater`, `logWeight`, `logCheckin`, `logWorkout`, `feedback`, `account`, `link`, `message`, `comment`, `coachPlan`, `accessorySets`…), a véletlenszám-generátor és a dátumkezelés. A generátor egyetlen közös példány marad.
- **Átvételi próba:** ugyanazzal a `--today` értékkel a szétbontás előtt és után generált `demo.db` adattartalma azonos. Táblánként, rendezett sorokkal kell összevetni egy kis összehasonlító szkripttel; a végrehajtó dönti el, hol éljen.

## 7. Végrehajtás

### 7.1 Fázisok

Minden fázis végén: `npm test`, `npm run lint` és `npm run format:check` zöld, a szerver elindul, és egy rövid kézi füstpróba is lefut (lásd 8.). Egy fázis több commit is lehet; a commitok a T12 szerint bomlanak.

0. **Alapvonal.** Ág létrehozása. Rögzíteni kell: a tesztek számát, a lint-állapotot, a mai `index.html` példányát és egy `--today`-jel generált referencia-`demo.db` dumpját.
1. **A gyökér rendbetétele.**
   - Előbb **másolás** a `Podium-iratok\` mappába, majd ellenőrzés (fájlszám, méret), és csak utána `git rm`. Érintett fájlok: `DOKUMENTACIO.docx`, `DOKUMENTACIO-ITDK.md`, `ITDK előlap 20261118.docx`, `Podium_dokumentáció végleges.pdf`, `resume_sablon 2026 (1).doc`, `TEENDOK.txt`, `teendők.txt`, `bg-waves (2).html`, `ITDK/`, `OTIO/`, `Prezentacio/`.
   - A `Prezentacio/` mappában egy LibreOffice-zár (`.~lock…#`) jelzi, hogy a pptx nyitva van. Kezdés előtt szólni kell, hogy a felhasználó zárja be.
   - A `graphify-out/` kikerül a gitből (`git rm --cached`), és bekerül a `.gitignore`-ba.
   - A `docs/superpowers/` marad.
2. **A `server/core/` kialakítása.** Ide kerül a connection, az alap-séma, a migráció-futtató és a befagyasztott migrációk, a `http/`, a headers, a ratelimit, az errors, a dates és a numbers. A shimek megszűnnek (T10).
3. **Funkció-felfedezés.** A `features/` betöltő megírása és a `server.js` átállítása. Először csak egy funkció költözik át (javaslat: `program`, mert az a legújabb és legjobban körülhatárolt), és az ellenőrzi a szerződést.
4. **A többi funkció átköltöztetése**, egyesével, mindegyik külön commit-sorozatban. A `schema.js` és a `migrations.js` témánkénti részei a funkció `schema`-jába kerülnek; a `schema-parity` tesztnek végig zöldnek kell maradnia. A backend-unit-tesztek a funkcióval együtt költöznek (T6).
5. **A `seed-demo.js` szétbontása szereplőnként** (6.3). A 2–4. fázis importútvonal-változásait a seed már menet közben követi (T12); itt csak a fájl darabolása történik.
6. **Az `index.html` szétbontása** (6.2): előbb az összefűzés az átvételi teszttel, utána a darabok átköltöztetése a funkciómappákba.
7. **Takarítás és dokumentáció.**
   - `package.json`: a `test` szkript a `server/**/*.test.js` mintát is lefedi.
   - Az `eslint.config.js` és a `.prettierignore` útvonalai frissülnek, beleértve a lehetséges elavult bejegyzéseket (például `public/gyujto/**`).
   - A README projektstruktúra-része az új elrendezést írja le.
   - A `graphify` újragenerálható.
8. **Beolvasztás** 2026-11-18 után, a felhasználó jóváhagyásával.

### 7.2 Mi hova kerül

Ez a kiinduló javaslat. Ahol az importgráf mást mutat, az importgráf dönt, és a döntés a commit-üzenetbe kerül.

| Mai hely | Cél |
|---|---|
| `server/db/connection.js`, `db/index.js` (bootstrap-rész), `db/migrations.js` (baseline-őr + sorszámozott lépések) | `core/db/` |
| `server/db/schema.js` | az alap-táblák a `core/db/`-be, a többi tábla a funkciójához |
| `server/http/*`, `headers.js`, `ratelimit.js`, `errors.js` | `core/http/` |
| `dates.js`, `numbers.js` | `core/lib/` |
| `server/db.js` | megszűnik (shim) |
| `routes/auth.js`, `auth.js`, `db/accounts.js` | `features/auth/` (a munkamenet-takarítás `jobs`-ként) |
| `routes/programs.js`, `program/*`, `db/programs.js`, `services/program-run.js` | `features/program/` |
| `routes/training.js`, `db/training.js`, `records.js`, `one-rm.js`, `suggestions.js`, `exercise-advice.js`, `session-advice.js`, `training-load.js`, `logmode.js`, `services/session-plan.js`, `validation/workout-body.js`, `charts.js` | `features/workout/` (a tervekre vonatkozó részek a `plans/`-ba, a dashboard-végpont a `dashboard/`-ba) |
| `plan-week.js` | `features/plans/` |
| `catalog-search.js`, `muscles.js`, `data/catalog.js`, `data/strength-standards.js`, `data/bodyweight-load.js`, `data.js` (referencia-kollekciók), a `READ_ENDPOINTS` a `server.js`-ből | `features/catalog/` (a nagy, generált adatfájlok a `server/data/`-ban maradnak) |
| `routes/nutrition.js`, `db/nutrition.js`, `openfoodfacts.js`, `foods-validate.js` | `features/nutrition/` (a vonalkód-cache takarítása `jobs`-ként) |
| `recovery.js`, `db/body.js` | `features/recovery/` |
| `routes/coach.js`, `db/coaching.js`, `coaching.js`, `notifications.js` | `features/coach/` |

## 8. Ellenőrzés

- **Minden commit után:** `npm test`. A teszt-szám nem csökkenhet; a mozgatott tesztek ugyanúgy lefutnak, csak máshol vannak.
- **Minden fázis után:** `npm run lint`, `npm run format:check`, szerverindítás, és kézi füstpróba a böngészőben: belépés, mind a 13 oldal megnyitása edzőként és sportolóként, a konzolban nincs hiba, egy edzés mentése, egy check-in.
- **Célzott átvételi próbák:** az összefűzött HTML azonos a mostanival (6.2); a demó-adatbázis azonos (6.3); a `schema-parity` és a migrációs tesztek zöldek.
- **A sikerkritérium próbája a végén:** a végrehajtó végigveszi a blokkos-programok funkciót, és ellenőrzi, hogy az új szerkezetben a backend-része egyetlen `features/program/` mappában él. A frontend-része a `public/js/program/` + `14-programozo.css` + `tests/public/js/program/`.

## 9. Ami a végrehajtóra van bízva

- A funkciók végleges határai az importgráf alapján (7.2 csak kiindulás).
- A felfedezés és a sorrendezés technikai megoldása (6.1), ha a mai sorrendet visszaadja.
- A beillesztő jelölő pontos szintaxisa, a template-darabok fájlnevei és az összefűzés gyorsítótárazása.
- A demó-összehasonlító szkript helye és formája.
- A commitok pontos bontása, a 7.1 szabályán belül.

## 10. Kockázatok

| Kockázat | Védekezés |
|---|---|
| A `blokkos-programok` tovább változik, és ütközik az átrendezéssel | Minden fázis előtt be kell olvasztani; a mozgató commitok kicsik maradnak. |
| A middleware- vagy route-sorrend elcsúszik a felfedezéssel (például egy végpont kikerül a belépés-őr alól) | A `security`, `hardening` és `api` tesztek; a 6.1 kifejezett szabálya az auth-ra. |
| Rejtett DOM-sorrend-függés (CSS-szelektorok, `:first-child`, fókuszsorrend) | Az összefűzött HTML azonossági tesztje; a darabok csak utána mozognak. |
| Egy dokumentum elveszik a gyökér takarításakor | Előbb másolás és ellenőrzés, csak utána `git rm`; a git-történetben amúgy is megmarad. |
| A demó-adat a szétbontás után eltér (más véletlenszám-sorrend) | A demó-dump összevetése (6.3). |
