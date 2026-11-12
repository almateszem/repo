# Kódbázis-átrendezés — végrehajtási terv

> **Ügynököknek:** KÖTELEZŐ al-skill: superpowers:subagent-driven-development (ajánlott) vagy superpowers:executing-plans, feladatonként. A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** a Podium kódját funkciónként egy helyre rendezni úgy, hogy egy új funkcióhoz két mappához és egy CSS-fájlhoz kelljen nyúlni. Közben a felhasználó semmilyen különbséget nem láthat.

**Architektúra:** a backend `server/core/` (közös infrastruktúra) és `server/features/<téma>/` (funkciók) szerkezetbe kerül. A funkciókat a `core/db` betöltése fedezi fel egy egységes `index.js`-szerződés alapján. Az `index.html` darabokra bomlik a funkciók JS-e mellé, a szerver induláskor és kérésre fűzi össze őket. A demó-generátor szereplőnként bomlik a `scripts/demo/` alá. A gyökérből a nem-kód fájlok a repón kívülre kerülnek.

**Technológia:** Node ≥ 22.5 (ESM, `node:sqlite`, `node --test`), Express 4, vanilla JS frontend, build-lépés nincs.

**Spec:** `docs/superpowers/specs/2026-11-12-kodbazis-atrendezes-design.md` — a végrehajtó a tervvel együtt olvassa, a T1…T12 hivatkozások oda mutatnak.

## Globális kényszerek

- Ág: `kodbazis-atrendezes`, a `blokkos-programok` csúcsáról. A `main` 2026-11-18-ig **nem változhat**. Ha a `blokkos-programok` közben kap commitot, minden feladat előtt be kell olvasztani (`git merge blokkos-programok`).
- Viselkedésváltozás nincs: ugyanazok az API-válaszok, ugyanaz a HTML, ugyanaz a demó-adat. Algoritmus és API-forma nem változik.
- Új npm-függőség, bundler vagy build-lépés nincs. A `public/css/` tartalma nem változik.
- **Minden commit után** `npm test` → `fail 0`, és a `pass` értéke ≥ **895** (a 2026-11-12-i alapvonal). A tesztek száma csak nőhet.
- **Minden feladat végén** `npm run lint` és `npm run format:check` hibátlan.
- Commit-üzenet magyarul, a repó stílusában (`Terület: mit és miért`). **Semmilyen Claude-jelölés nem lehet benne:** se `Co-Authored-By` trailer, se Claude mint szerző.
- **Mozgató commit** = `git mv` + az ebből következő importútvonal-javítások, logikai változás nélkül. A tartalmi változás külön commit (T12).
- A `core/` csak a befagyasztott migrációkban importálhat statikusan a `features/`-ből (T9). Egyébként a funkciókat csak dinamikusan, a felfedezéssel éri el.
- A futtató gépen Windows van, ezért dinamikus importhoz mindig `pathToFileURL(abs).href` kell, nyers útvonal soha. Útvonalakat az `import.meta.dirname`-ből kell számolni, nem a `process.cwd()`-ből.
- Alapvonal-mappa (a repón kívül, nem verziózott): `C:\Users\user\Documents\podium-atrendezes-alapvonal\`.

## Review-fókusz

Olyan bemenetek és helyzetek, amelyekre a spec nem tér ki külön, mégis valószínűleg előjönnek:

1. **Elgépelt vagy hiányzó `@include` útvonal.** A szerver induláskor érthető hibával álljon le (a hiányzó fájl nevével). Ne szolgáljon ki egy oldalt, amelyben a jelölő szó szerint benne maradt. Teszt: 19. feladat, `assemblePage — hiányzó include-ra a fájlnevet tartalmazó hibát dob`.
2. **Egy funkció végpontja kicsúszik a belépés-őr alól** az új regisztrációs sorrend miatt. Funkciónként egy GET-végpontra bejelentkezés nélkül 401-et kell kapni. Teszt: 6. feladat, `tests/server/feature-guard.test.js`.
3. **Egy HTML-darab szerkesztése után nem jelenik meg a változás** szerver-újraindítás nélkül (`npm run dev` csak a JS-importokat figyeli). Teszt: 19. feladat, `createPageHandler — a darab módosítása után az új tartalmat adja`.
4. **Indítás más munkakönyvtárból**, illetve Windows-útvonal dinamikus importban: például `node C:\...\server\server.js` egy másik mappából, vagy a migrációs tesztek al-folyamata. Teszt: 4. feladat, `loadFeatures — más cwd-ből és szóközös útvonalon is betölt`.
5. **Két funkció ugyanazt az adatfüggvény-nevet exportálja**, és az `allData()` csendben felülírja az egyiket. Teszt: 5. feladat, `allData — névütközésre mindkét funkciót megnevező hibát dob`.

---

## Fájlszerkezet (cél)

```
server/
  server.js                    middleware-ek, funkció-regisztráció, jobs, 404, statikus + oldal-kezelő
  core/
    features.js                loadFeatures(dir)  — felfedezés, validálás, sorrend
    page.js                    assemblePage(publicDir), createPageHandler(publicDir)
    db/
      connection.js            (mozgatva) db, transaction, closeDatabase, configureConnection, DB_PATH
      schema.js                createBaseSchema(), createBaseIndexes()  — collections nélkül, csak users, sessions
      migrations.js            (mozgatva, befagyasztva) assertSupportedSchema, ensureColumns, runMigrations, ENSURED_COLUMNS
                               + ensureFeatureColumns(features), runFeatureMigrations(features)
      index.js                 bootstrap fázisok; export features, allData(), transaction, closeDatabase, ENSURED_COLUMNS
    http/
      errors.js, headers.js, ratelimit.js        (mozgatva)
    lib/
      dates.js, numbers.js                        (mozgatva)
  features/
    auth/  catalog/  coach/  dashboard/  nutrition/  plans/  program/  recovery/  workout/
      index.js                 a szerződés (lásd 4. feladat)
      routes.js                register / registerPublic / guard
      db.js                    a téma táblái fölötti lekérdezések
      *.js                     a téma logikája
      *.test.js                a téma backend-tesztjei
  data/                        nagy, generált/statikus adattáblák — marad
public/
  index.html                   váz + <!-- @include js/<téma>/<darab>.html --> jelölők
  js/<téma>/*.html             oldal-, modál- és template-darabok
scripts/
  dump-db.js                   SQLite → rendezett JSON (fejlesztői eszköz, 1. feladat)
  seed-demo.js                 futtató
  demo/ common.js bence.js reka.js david.js coach.js
tests/
  server/                      átfogó tesztek (api, security, hardening, schema-parity, migrációk, features-loader, feature-guard, page)
  public/js/<téma>/            frontend-tesztek
  scripts/dump-db.test.js
```

### Közös recept: „funkció átköltöztetése” (a 7–16. feladat ezt használja)

Minden funkció-feladat két commit:

**A) Mozgató commit.**
1. `mkdir server/features/<téma>`.
2. A feladatban felsorolt fájlok `git mv`-vel átkerülnek, a feladatban megadott új nevekre.
3. Az importútvonalak javítása mindenhol: `server/`, `scripts/`, `tests/`, és a `server/db.js` shim `export *` sorai is.
4. A téma backend-tesztjei `git mv`-vel a funkciómappába kerülnek, a relatív importjaik javítva.
5. Ellenőrzés: `npm test` → `fail 0`, `pass` ≥ 895.

**B) Szerződés commit.**
1. A `server/features/<téma>/index.js` létrehozása.
2. A téma `CREATE TABLE` / `CREATE INDEX` utasításai átkerülnek a `core/db/schema.js`-ből a funkció `tables` / `indexes` függvényébe, **szövegre változatlanul**. A `createSchema`-n belüli indexek a `tables`-be mennek, a `createIndexes`-beliek az `indexes`-be.
3. A `server.js` explicit `register*` hívása helyére a felfedezés lép.
4. `data`: a téma `db.js`-ének névtere (`import * as data from './db.js'`), szükség esetén kiegészítve.
5. Ellenőrzés: `npm test` (benne a `schema-parity` és a migrációs tesztek) → zöld; `npm run lint`; demó-dump összevetése (1. feladat, 6. lépés) → nincs eltérés.

---

### 1. feladat: Ág, alapvonal és db-dump eszköz

**Fájlok:**
- Létrehozás: `scripts/dump-db.js`, `tests/scripts/dump-db.test.js`

**Interfészek:**
- Létrehoz: `dumpDatabase(dbPath: string, { ignore?: string[] }): Record<string, object[]>`. A táblák névsorban, a sorok `JSON.stringify` szerint rendezve, `sqlite_%` táblák nélkül, az `ignore` elemei `tábla.oszlop` alakúak. CLI: `node scripts/dump-db.js <db> [--ignore t.c ...]` → formázott JSON a kimenetre.

- [ ] **1. lépés: ág és alapvonal**

```bash
git switch blokkos-programok && git switch -c kodbazis-atrendezes
git rev-parse HEAD   # ezt a hash-t BASE-ként jegyezd fel a 20. feladathoz
npm test             # elvárt: pass 895, fail 0
npm run lint && npm run format:check
```

- [ ] **2. lépés: a bukó teszt** (`tests/scripts/dump-db.test.js`)
  - `dumpDatabase — táblák névsorban, sorok rendezve`: ideiglenes DB két táblával (`b(x)`, `a(y)`), fordított sorrendben beszúrt sorokkal. Elvárt: `Object.keys(out)` = `['a','b']`, a sorok rendezve.
  - `dumpDatabase — az ignore oszlop kimarad`: `ignore: ['a.y']` → az `a` sorai `{}`.

- [ ] **3. lépés:** `node --test tests/scripts/dump-db.test.js` → FAIL (nincs modul).
- [ ] **4. lépés:** `scripts/dump-db.js` megírása (`node:sqlite`, csak olvasásra nyitva).
- [ ] **5. lépés:** teszt → PASS.
- [ ] **6. lépés: a demó alapvonala.** Kétszer kell generálni, hogy kiderüljön, mely oszlopok nem determinisztikusak:

```bash
mkdir -p /c/Users/user/Documents/podium-atrendezes-alapvonal
npm run seed:demo -- --today 2026.11.13 && node scripts/dump-db.js server/demo.db > /c/Users/user/Documents/podium-atrendezes-alapvonal/demo-1.json
npm run seed:demo -- --today 2026.11.13 && node scripts/dump-db.js server/demo.db > /c/Users/user/Documents/podium-atrendezes-alapvonal/demo-2.json
diff /c/Users/user/Documents/podium-atrendezes-alapvonal/demo-1.json /c/Users/user/Documents/podium-atrendezes-alapvonal/demo-2.json
```

A `diff`-ben megjelenő oszlopok (várhatóan időbélyegek vagy tokenek) kerülnek az `IGNORE` listába. Ezt a listát a `podium-atrendezes-alapvonal\IGNORE.txt` rögzíti, egy sor egy `tábla.oszlop`. Utána a referencia:

```bash
node scripts/dump-db.js server/demo.db $(sed 's/^/--ignore /' IGNORE.txt) > .../demo-base.json
```

**A „demó-dump összevetése”** a további feladatokban ugyanez a parancs `demo-now.json`-ba, majd `diff demo-base.json demo-now.json` → üres.
- [ ] **7. lépés: commit** — `Eszköz: scripts/dump-db.js — SQLite-tartalom rendezett JSON-ként (az átrendezés demó-összevetéséhez)`.

---

### 2. feladat: A gyökér rendbetétele

**Fájlok:**
- Törlés a gitből (előtte másolás a `C:\Users\user\Documents\Podium-iratok\` mappába): `DOKUMENTACIO.docx`, `DOKUMENTACIO-ITDK.md`, `ITDK előlap 20261118.docx`, `Podium_dokumentáció végleges.pdf`, `resume_sablon 2026 (1).doc`, `TEENDOK.txt`, `teendők.txt`, `bg-waves (2).html`, `ITDK/`, `OTIO/`, `Prezentacio/`
- Módosítás: `.gitignore` (+ `graphify-out/`); `git rm -r --cached graphify-out`

- [ ] **1. lépés:** ha létezik a `Prezentacio/.~lock.*#` fájl, **állj meg, és kérd meg a felhasználót, hogy zárja be a prezentációt.** Csak ezután folytasd.
- [ ] **2. lépés:** a fenti fájlok és mappák másolása (`cp -r`) a `Podium-iratok\` mappába.
- [ ] **3. lépés: ellenőrzés.** A forrás és a cél fájlszáma és összmérete egyezik:

```bash
find <forráslista> -type f | wc -l ; du -cb <forráslista> | tail -1
# ugyanez a Podium-iratok alatt → a két szám egyezik
```

- [ ] **4. lépés:** `git rm -r` a felsoroltakra; `graphify-out/` a `.gitignore`-ba; `git rm -r --cached graphify-out`.
- [ ] **5. lépés:** `git status --short` → csak törlések és a `.gitignore`; `npm test` → zöld.
- [ ] **6. lépés: commit** — `Repó: a dokumentumok (ITDK, OTIO, prezentáció, teendők) a repón kívülre kerültek; a graphify-out generált, nem verziózzuk`.

---

### 3. feladat: `server/core/lib` és `server/core/http` (tiszta segédmodulok)

**Fájlok (mozgatás):**
- `server/dates.js` → `server/core/lib/dates.js`
- `server/numbers.js` → `server/core/lib/numbers.js`
- `server/errors.js` → `server/core/http/errors.js`
- `server/headers.js` → `server/core/http/headers.js`
- `server/ratelimit.js` → `server/core/http/ratelimit.js`
- A tesztjeik maradnak a `tests/server/`-ben (`errors.test.js`, `ratelimit.test.js` …), csak az importjuk változik.

- [ ] **1. lépés:** `git mv` a fentiekre; importok javítása az egész repóban (`grep -rn "dates.js'\|numbers.js'\|errors.js'\|headers.js'\|ratelimit.js'" server scripts tests`).
- [ ] **2. lépés:** `npm test` → zöld; `npm run lint`.
- [ ] **3. lépés: commit** — `Szerver: a közös segédmodulok a core/lib és core/http alá (csak mozgatás)`.

---

### 4. feladat: A funkció-betöltő (`server/core/features.js`)

**Fájlok:**
- Létrehozás: `server/core/features.js`, `tests/server/features-loader.test.js`

**Interfészek:**
- Létrehoz: `loadFeatures(dir: string): Promise<Feature[]>`.
- A `Feature` megengedett kulcsai, mind opcionális, kivéve a `name`-et:
  - `name: string` (= a mappa neve)
  - `after: string[]`
  - `tables(db)`, `indexes(db)`, `seed(db)`
  - `columns: {table, column, ddl}[]`
  - `migrations: {version: number, run(db)}[]`
  - `registerPublic(app, deps)`, `guard(app)`, `register(app, deps)`
  - `jobs: {every: 'daily', run(): void, atStartup?: boolean}[]`
  - `data: object`

  A spec 6.1-éhez képest a `seed`, a `guard`, a `data` és az `atStartup` a terv kiegészítése. A spec 5. indítási fázisa (referencia-adat) a `seed`-del valósul meg. A belépés-őr az `auth` funkcióé, és a `core/http`-ből nem érhető el adatbázis-függés nélkül. A `data` az `allData()`-hoz kell. Az `atStartup` a mai indításkori munkamenet-takarításhoz.

- [ ] **1. lépés: a bukó tesztek.** Mindegyik egy `mkdtemp`-ben felépített `features/` könyvtárral, amelyben kis `index.js` fájlok vannak:
  - `loadFeatures — névsorban tölt, az after felülírja`: `b`, `a` (`after: ['c']`), `c` → nevek: `['b','c','a']`.
  - `loadFeatures — a name eltér a mappanévtől → hiba` (`/name.*mappa/`).
  - `loadFeatures — ismeretlen kulcs → hiba a kulcs nevével` (`registr` → `/registr/`).
  - `loadFeatures — ismeretlen after-cél → hiba`; `körkörös after → hiba` (`/kör/`).
  - `loadFeatures — két guard → hiba`.
  - `loadFeatures — migráció version < 7 vagy duplikált version → hiba`.
  - `loadFeatures — más cwd-ből és szóközös útvonalon is betölt`: a temp könyvtár neve tartalmaz szóközt (`'podium features '`), a teszt `process.chdir(os.tmpdir())` után hív, majd visszaállít.
  - `loadFeatures — a mappa index.js nélkül kimarad`.
- [ ] **2. lépés:** `node --test tests/server/features-loader.test.js` → FAIL.
- [ ] **3. lépés:** `server/core/features.js` megírása.
  - `readdirSync(dir, { withFileTypes: true })`, csak azok a könyvtárak, amelyekben van `index.js`; `await import(pathToFileURL(...).href)`.
  - Rendezés: Kahn-algoritmus névsoros döntetlen-feloldással.
  - Hibaüzenetek magyarul, `features/<mappa>:` előtaggal.
- [ ] **4. lépés:** teszt → PASS; `npm test` → zöld.
- [ ] **5. lépés: commit** — `Szerver: funkció-betöltő (core/features.js) — felfedezés, szerződés-ellenőrzés, determinisztikus sorrend`.

---

### 5. feladat: `server/core/db` — indítási fázisok és `allData()`

**Fájlok:**
- Mozgatás: `server/db/connection.js`, `schema.js`, `migrations.js`, `index.js` → `server/core/db/`. A témamodulok (`accounts`, `coaching`, `nutrition`, `body`, `training`, `programs`) egyelőre a `server/db/`-ben maradnak.
- Módosítás: `server/db.js` (shim) → `export * from './core/db/index.js'` és a témamodulok `export *` sorai (a mai `db/index.js` star-exportjai ide költöznek).
- Teszt: `tests/server/core-db.test.js`

**Interfészek:**
- Felhasznál: `loadFeatures` (4. feladat).
- Létrehoz a `server/core/db/index.js`-ben:
  - `export const features: Feature[]` — egyszer betöltve, `FEATURES_DIR = path.join(import.meta.dirname, '..', '..', 'features')`. Ha a mappa nem létezik → `[]`.
  - `export function allData(): Record<string, unknown>` — a core exportjai (`transaction`, `closeDatabase`, `getCollection`, `ENSURED_COLUMNS`) és minden funkció `data`-ja, laposan összefésülve. Névütközésre `Error('allData: „<név>" két helyről jön: <a>, <b>')`.
  - `export { transaction, closeDatabase } from './connection.js'`, `export { ENSURED_COLUMNS } from './migrations.js'`.
- Létrehoz a `migrations.js`-ben:
  - `ensureFeatureColumns(features)`: hiányzó oszlop → `ALTER TABLE`, és bejegyzés az `ENSURED_COLUMNS`-ba (`added` jelzővel, ugyanúgy, mint a befagyasztottaké).
  - `runFeatureMigrations(features)`: a 7+ verziók növekvő sorrendben, mindegyik `transaction`-ben, utána `PRAGMA user_version = v`; ami ≤ a mai verzió, kimarad.

- [ ] **1. lépés: mozgató commit.** `git mv` a négy fájlra; a `db/index.js` star-exportjai a shimbe; importok javítása. `npm test` → zöld. Commit: `Szerver: az adatbázis-mag a core/db alá (csak mozgatás)`.
- [ ] **2. lépés: a bukó tesztek** (`tests/server/core-db.test.js`; az `allData` és a fázisok tesztje egy al-folyamatban fut, saját `PODIUM_DB`-vel és egy ideiglenes `features/` mappával — ehhez a `FEATURES_DIR` a `PODIUM_FEATURES_DIR` környezeti változóval felülírható, **csak teszthez**, a README-ben nem dokumentáljuk):
  - `allData — névütközésre mindkét funkciót megnevező hibát dob`: két funkció `data: { foo }` → a hibaüzenet tartalmazza mindkét nevet.
  - `fázisok — tables → columns → migrations → indexes → seed → atStartup sorrendben`: a funkció hookjai egy közös tömbbe írnak; elvárt sorrend: `['tables','columns','migrations','indexes','seed','job']`.
  - `funkció-migráció — egyszer fut, user_version 7 lesz`: két egymás utáni betöltés → a `run` egyszer hívódik, `PRAGMA user_version` = 7.
  - `funkció-oszlop — régi táblán pótolja és bekerül az ENSURED_COLUMNS-ba`.
- [ ] **3. lépés:** teszt → FAIL.
- [ ] **4. lépés:** a `core/db/index.js` bootstrapja:
  - `assertSupportedSchema` → `configureConnection` → `createSchema()` + `f.tables(db)` → `v = readSchemaVersion()`; `legacy = ensureColumns(v)`; `ensureFeatureColumns(features)` → `runMigrations(v, legacy)`; `runFeatureMigrations(features)` → `createIndexes()` + `f.indexes(db)` → `seedCollections()` + `f.seed(db)` → `purgeExpiredSessions()` + az `atStartup` jobok.
  - A `migrations.js`-ben a belső `ensureColumn` closure csak annyit változik, hogy a közös `hasColumn` + push logikát a funkció-oszlopok is használják. A befagyasztott hívások szövege és sorrendje nem változik.
- [ ] **5. lépés:** teszt → PASS; `npm test` → zöld (a `schema-parity`, az `old-db-guard` és minden `*-migration` teszt is); demó-dump összevetése → üres diff.
- [ ] **6. lépés: commit** — `Szerver: core/db indítási fázisok a funkciók hookjaival; allData() a teszteknek és a seednek`.

---

### 6. feladat: A `server.js` a felfedezett funkciókra áll át, plusz az őr-teszt

**Fájlok:**
- Módosítás: `server/server.js`
- Létrehozás: `tests/server/feature-guard.test.js`

**Interfészek:**
- Felhasznál: `features` a `core/db/index.js`-ből.
- A regisztrációs sorrend (szó szerint ez):
  1. middleware-ek (változatlanok);
  2. a mai `registerAuthPublic(app)` + minden `f.registerPublic?.(app, deps)`;
  3. őr: ha van funkció `guard`-dal, az; különben a mai `registerSessionGuard(app)`;
  4. a mai explicit `register*` hívások + minden `f.register?.(app, deps)`;
  5. `/api` 404;
  6. `/vendor/zxing`; `express.static`; `apiErrorHandler`.

  A napi `setInterval` a mai két takarítás után minden `every: 'daily'` jobot is futtat.

- [ ] **1. lépés: a teszt, amely a mai viselkedést rögzíti** (`tests/server/feature-guard.test.js`, a `startServer({ label: 'guard' })` harness-szel):
  - `bejelentkezés nélkül minden funkció védett végpontja 401`: GET a következőkre: `/api/training-maxes`, `/api/exercises`, `/api/user`, `/api/nutrition`, `/api/checkin`, `/api/plans`, `/api/workouts`, `/api/dashboard`, `/api/coach`, `/api/goals` → mind `401`, a törzs `{ error: 'Nincs bejelentkezve.' }`.
  - `a publikus auth-végpont bejelentkezés nélkül is elérhető`: `POST /api/auth/login` hibás adattal → nem 401-es őr-válasz (a mai kódot és szöveget a teszt írásakor kell kiolvasni és rögzíteni).
- [ ] **2. lépés:** teszt → PASS már most (viselkedést rögzít).
- [ ] **3. lépés:** a `server.js` átírása a fenti sorrendre.
- [ ] **4. lépés:** `npm test` → zöld; `npm start` → a banner megjelenik, a `/` 200-at ad.
- [ ] **5. lépés: commit** — `Szerver: a felfedezett funkciók regisztrációja (publikus → őr → védett); őr-teszt funkciónként`.

---

### 7. feladat: `program` funkció — a szerződés próbája

A közös recept szerint.

**Mozgatás:**
- `server/routes/programs.js` → `server/features/program/routes.js`
- `server/db/programs.js` → `db.js`
- `server/program/program.js` → `program.js`
- `server/program/formula.js` → `formula.js`
- `server/program/rules.js` → `rules.js`
- `server/services/program-run.js` → `run.js`
- Tesztek: `tests/server/program-db`, `program-formula`, `program-rules`, `program-run`, `program-structure`, `programs-api` `.test.js` → `server/features/program/`

**Szerződés:**
- `tables`: `program_state`, `training_maxes`.
- `indexes`: `idx_training_maxes_user`.
- `register`: a `routes.js` `register`-e.
- `data`: a `db.js` névtere.

**Mellékfeladat:** a `package.json` `test` szkriptje innentől `node --test "tests/**/*.test.js" "server/**/*.test.js"`. Ellenőrzés: a `pass` értéke nem csökken.

- [ ] A) mozgató commit — `Program: a blokkos programok egy mappában (server/features/program, csak mozgatás)`
- [ ] B) szerződés commit — `Program: funkció-szerződés (táblák, végpontok); a server.js felfedezéssel regisztrál`
- [ ] Ellenőrzés: `npm test`, lint, demó-dump összevetése.

---

### 8. feladat: A `routes/training.js` kettévágása témák szerint (tartalmi commit, helyben)

**Fájlok:**
- A `server/routes/training.js` (962 sor) helyben szétválik:
  - `routes/workout.js`: `/api/workouts*`, `/api/workout-draft`, `/api/workout-template`, `/api/prs*`, `/api/exercise-records`, `/api/exercise-maxes`, `/api/exercise-suggestions`, `/api/strength-assessment`, `/api/readiness/advice*`.
  - `routes/plans.js`: `/api/plans*`.
  - `routes/recovery.js`: `/api/checkin`, `/api/readiness`, `/api/measurements*`, `/api/weight-log*`.
  - `routes/dashboard.js`: `/api/dashboard`, `/api/charts`.
  - `routes/catalog.js`: `/api/exercises`, `/api/exercise-groups`, `/api/cardio-intensities`, `/api/weight-conventions`, és a `server.js`-ből a `READ_ENDPOINTS` ciklusa.
- A közös segédek (`readOptionalNumber` és a fájl elején álló helperek) a legtöbbet használó témához kerülnek; a többiek onnan importálják.
- Mindegyik fájl `register(app, deps)`-et exportál; a `server.js` mind az ötöt hívja a mai `registerTraining` helyén.

- [ ] **1. lépés:** a szétvágás. A végpontkezelők törzse **szó szerint** átkerül. Ha egy végpont az importgráf alapján máshová tartozik, oda megy, és ez a commit-üzenetbe kerül.
- [ ] **2. lépés:** `npm test` → zöld (`api.test.js` minden végpontot lefed); a `feature-guard` teszt zöld.
- [ ] **3. lépés: commit** — `Szerver: a routes/training.js témák szerint öt fájlra bomlik (workout, plans, recovery, dashboard, catalog) — a kezelők változatlanok`.

---

### 9–16. feladat: A többi funkció átköltöztetése

Mindegyik a közös recept szerint, ebben a sorrendben (az importgráf a korábbiakra épül). A felsorolás kiinduló javaslat; ha egy fájl az importgráf szerint máshová tartozik, oda kerül, és ez a commit-üzenetbe megy. A már meglévő körkörös importok (például `program/run.js` ↔ `session-plan`) maradhatnak, új kör nem keletkezhet.

**9. `catalog`**
- Mozgatás:
  - `routes/catalog.js` → `routes.js`
  - `catalog-search.js` → `search.js`
  - `muscles.js` → `muscles.js`
  - `data/catalog.js` → `catalog.js`
  - `data/strength-standards.js` → `strength-standards.js`
  - `data/bodyweight-load.js` → `bodyweight-load.js`
  - `data.js` → `reference.js`
  - a `core/db/schema.js`-ből a `seedCollections`, a `getCollection` és a `collections` tábla → `db.js`
- Tesztek: `catalog-search`, `catalog-taxonomy`, `muscles`, `cache`.
- Szerződés:
  - `tables`: `collections`.
  - `seed`: a `seedCollections`.
  - `register`.
  - `data`: `getCollection` stb.
- A `core/db/index.js` `allData`-jának core-része innentől a `getCollection` nélkül van (az a `catalog` `data`-jából jön).
- A befagyasztott migrációk `muscles.js`-importja az új útra mutat (T9-kivétel).

**10. `auth`**
- Mozgatás:
  - `routes/auth.js` → `routes.js`
  - `auth.js` → `password.js`
  - `db/accounts.js` → `db.js`
  - `http/session.js` → `session.js`
- Tesztek: `auth`, `account`, `users`.
- Szerződés:
  - `registerPublic`.
  - `guard`: a `session.js` `register`-e.
  - `register`.
  - `jobs`: `[{ every: 'daily', run: purgeExpiredSessions, atStartup: true }]`.
  - `data`.
- A `server.js`-ből kikerül a `registerAuthPublic`, a `registerSessionGuard` és a munkamenet-takarítás. A `core/db/index.js` bootstrapjából kikerül a közvetlen `purgeExpiredSessions()` hívás (helyette az `atStartup`). A `users`/`sessions` tábla a `core/db/schema.js` alap-sémájában marad.

**11. `nutrition`**
- Mozgatás:
  - `routes/nutrition.js` → `routes.js`
  - `db/nutrition.js` → `db.js`
  - `openfoodfacts.js`
  - `foods-validate.js`
- Tesztek: `nutrition-goal`, `nutrition-recent`, `openfoodfacts`, `scale-macros`.
- Szerződés:
  - `tables`: `nutrition_log`, `custom_foods`, `water_log` (+`idx_water_user_date`), `nutrition_goals`, `coach_meals` (+`idx_coach_meals_user`), `coach_meal_logs`, `water_goals`, `barcode_cache`.
  - `indexes`: `idx_nutrition_log_user_date`.
  - `jobs`: `[{ every: 'daily', run: purgeBarcodeCache }]`.
  - `register`, `data`.
- A `server.js`-ből kikerül a napi `setInterval` utolsó explicit hívása; innentől csak a jobok futnak.

**12. `recovery`**
- Mozgatás:
  - `routes/recovery.js` → `routes.js`
  - `recovery.js` → `recovery.js`
  - `db/body.js` → `db.js`
- Tesztek: `recovery`, `recovery-calibration`, `recovery-novelty`, `bodyweight-records`, `dst`.
- Szerződés:
  - `tables`: `weight_log`, `body_measurements` (+`idx_measurements_user`), `checkins`.
  - `indexes`: `idx_weight_log_user`.
  - `register`, `data`.

**13. `plans`**
- Mozgatás:
  - `routes/plans.js` → `routes.js`
  - `plan-week.js` → `plan-week.js`
  - a `db/training.js` tervekre vonatkozó függvényei → `db.js` (tartalmi commit: kettévágás)
- Tesztek: `plan-week`, `plan-assignment-migration` (marad `tests/server/`, mert migrációs).
- Szerződés:
  - `tables`: `plans`.
  - `indexes`: `idx_plans_user`.
  - `register`, `data`.

**14. `workout`**
- Mozgatás:
  - `routes/workout.js` → `routes.js`
  - `db/training.js` (maradék) → `db.js`
  - `records.js`, `one-rm.js`, `suggestions.js`, `exercise-advice.js`, `session-advice.js`, `training-load.js`, `logmode.js`, `charts.js`
  - `services/session-plan.js` → `session-plan.js`
  - `validation/workout-body.js` → `workout-body.js`
- Tesztek: `prs`, `suggestions`, `eccentric`, `declared-max`, `recompute-atomic`, `recompute-once`, `set-values-restart`, `szamitasok`, `workout-body-amrap`.
- Szerződés:
  - `tables`: `workouts`, `workout_draft`, `exercise_maxes`.
  - `indexes`: `idx_workouts_user`.
  - `data`: a `db.js` névtere + `bestCompletedSet`, `calculateEpley1RM` (a shim mai records-újraexportja).
  - `register`.
- A frontend `tests/public/js/workout/one-rm.test.js` importja az új `one-rm.js` útra mutat.

**15. `dashboard`**
- Mozgatás: `routes/dashboard.js` → `routes.js`.
- Szerződés: `register`. Táblája nincs.

**16. `coach`**
- Mozgatás:
  - `routes/coach.js` → `routes.js`
  - `db/coaching.js` → `db.js`
  - `coaching.js` → `coaching.js`
  - `notifications.js`
  - `http/access.js` → `access.js`
- Tesztek: `coach`, `coaching`, `coach-readiness`, `comment-targets`, `messages`, `notifications`.
- Szerződés:
  - `tables`: `comments` (+`idx_comments_target`), `coach_links`, `messages`, `plan_assignments`.
  - `indexes`: `idx_coach_links_coach`, `idx_coach_links_athlete`, `idx_messages_link`, `idx_messages_unread`, `idx_plan_assignments_link`.
  - `register`, `data`.

Minden funkciónál:
- [ ] A) mozgató commit — `<Téma>: … egy mappában (server/features/<téma>, csak mozgatás)`
- [ ] B) szerződés commit — `<Téma>: funkció-szerződés`
- [ ] Ellenőrzés: `npm test` (`pass` ≥ 895), lint, `feature-guard` zöld, demó-dump összevetése üres.

**A 16. után** a `server/routes/`, `services/`, `program/`, `validation/`, `http/`, `db/` mappák üresek. Ezek törlése a 16. feladat B-commitjába kerül. A `core/db/schema.js`-ben csak a `users`, a `sessions` és az indexeik maradnak; a `server.js`-ben nincs explicit `register*` import.

---

### 17. feladat: A `server/db.js` shim megszüntetése

**Fájlok:**
- Törlés: `server/db.js`
- Módosítás: minden `server/db.js`-t importáló fájl:
  - a `tests/server/` alatt (kb. 20 fájl, köztük a `*-migration`, `migration`, `old-db-guard`, `schema-parity` al-folyamat-sztringjei);
  - a funkciómappákba költözött tesztek;
  - `scripts/seed-demo.js`;
  - `tests/server/api.test.js` (a „nem érhető el HTTP-n” lista: `/server/db.js` → `/server/core/db/index.js`, `/../server/db.js` → `/../server/core/db/index.js`).

**Interfészek:**
- Felhasznál: `allData()` (5. feladat).
- Szabály:
  - **Éles kód** (`server/`) a funkció moduljából importál közvetlenül, `allData`-t nem használ.
  - **Tesztek és a seed:** `const db = (await import('<…>/server/core/db/index.js')).allData();` — a `db.X(...)` hívások így változatlanok maradnak.
  - Az `old-db-guard` a `core/db/index.js` importjára várja a hibát.

- [ ] **1. lépés:** `grep -rln "db\.js" server tests scripts` → a lista minden elemének átírása.
- [ ] **2. lépés:** `server/db.js` törlése; `npm test` → zöld; `node scripts/check-imports.js` és `node scripts/check-exports.js` → hibátlan.
- [ ] **3. lépés:** demó-dump összevetése → üres.
- [ ] **4. lépés: commit** — `Szerver: megszűnik a server/db.js újraexport — az éles kód a funkciókból importál, a tesztek és a seed az allData()-ból`.

---

### 18. feladat: A `seed-demo.js` szétbontása szereplőnként

**Fájlok:**
- Létrehozás: `scripts/demo/common.js`, `bence.js`, `reka.js`, `david.js`, `coach.js`
- Módosítás: `scripts/seed-demo.js` (futtató marad)

**Interfészek:**
- `scripts/demo/common.js` exportálja:
  - a ma fájlszintű segédeket változatlan aláírással: `logMeal`, `logWater`, `logWeight`, `logCheckin`, `logWorkout`, `feedback`, `account`, `link`, `message`, `comment`, `coachPlan`, `accessorySets`, `k0warm`, és a többi a fájl 1–476. soráig;
  - **az egyetlen közös véletlenszám-generátort**;
  - a `TODAY` / dátum-segédeket;
  - a `dbApi`-t és a `db`-t.
- `bence.js` → `export function seedBence(): BencePlan` (a mai visszatérési értékkel); `reka.js` → `seedReka()`; `david.js` → `seedDavid()`; `coach.js` → `seedCoach(bencePlan)` (vagy amit a mai kód ténylegesen használ).
- A `seed-demo.js` a mai sorrendben hív. A régi `demo.db` törlése, az env beállítása az importok előtt, és a `--today` feldolgozása is itt marad.

- [ ] **1. lépés:** a darabolás. A függvénytörzsek **szó szerint** költöznek; a modulszintű állapot (generátor, dátum, azonosítók) a `common.js`-be kerül, egyetlen példányban.
- [ ] **2. lépés:** demó-dump összevetése → **üres diff** (ez a feladat átvételi próbája).
- [ ] **3. lépés:** `npm run start:demo` → belépés `podium2026` jelszóval, az edző és Bence nézete betölt.
- [ ] **4. lépés: commit** — `Demó: a seed-demo szereplőnként (scripts/demo/) — a generált adat bájtra azonos`.

---

### 19. feladat: Oldal-összefűzés (`server/core/page.js`)

**Fájlok:**
- Létrehozás: `server/core/page.js`, `tests/server/page.test.js`
- Módosítás: `server/server.js`

**Interfészek:**
- Létrehoz:
  - `assemblePage(publicDir: string): string` — beolvassa az `index.html`-t, és minden `<!-- @include <rel> -->` jelölőt (regex: `/<!--\s*@include\s+(\S+)\s*-->/g`) a `publicDir`-hez viszonyított fájl tartalmával helyettesít. Egy szint, nem rekurzív. Hiányzó fájlra `Error('index.html: a beillesztett fájl nem található: <rel>')`. Ha a `rel` kivezetne a `publicDir`-ből (`..`), hiba.
  - `createPageHandler(publicDir: string): express.RequestHandler` — az összefűzött HTML-t gyorsítótárazza, és minden kérésnél az `index.html` és a beillesztett fájlok `mtimeMs`-e alapján érvényteleníti. Válasz: `res.type('html').set('Cache-Control', 'no-cache').send(html)`.
- `server.js`:
  - induláskor egyszer `assemblePage(PUBLIC_DIR)` (hiba → leáll);
  - `app.get(['/', '/index.html'], createPageHandler(PUBLIC_DIR))` az `express.static` **előtt**;
  - az `express.static(PUBLIC_DIR, { index: false })`.

- [ ] **1. lépés: a bukó tesztek** (`tests/server/page.test.js`, temp `publicDir`-rel):
  - `assemblePage — a jelölőt a darab tartalmára cseréli` (két jelölő, sorrend megmarad).
  - `assemblePage — hiányzó include-ra a fájlnevet tartalmazó hibát dob`.
  - `assemblePage — ..-os útvonalat elutasít`.
  - `assemblePage — jelölő nélküli index.html változatlan`.
  - `createPageHandler — a darab módosítása után az új tartalmat adja` (a darab felülírása után az `mtime` `utimesSync`-kel előrébb kerül).
- [ ] **2. lépés:** FAIL → **3. lépés:** megírás → **4. lépés:** PASS.
- [ ] **5. lépés:** `npm test` → zöld (az `api.test` `/index.html`-tesztje és a CSP-fejléc teszt is: a fejléc-middleware az új kezelőre is fut).
- [ ] **6. lépés: commit** — `Szerver: az index.html-t a szerver fűzi össze (@include jelölők), módosításra frissül`.

---

### 20. feladat: Az `index.html` szétbontása a funkciómappákba

**Fájlok (létrehozás, a mai `index.html` szeleteiből, szó szerint):**
- Oldalak (`<section data-page>`):
  - `dashboard` → `js/dashboard/dashboard.html`
  - `profile` → `js/profile/profile.html`
  - `workout`, `exercise-picker`, `workout-picker`, `summary` → `js/workout/{workout,exercise-picker,workout-picker,summary}.html`
  - `plan-builder`, `plans` → `js/plans/{plan-builder,plans}.html`
  - `program-builder` → `js/program/program-builder.html`
  - `nutrition` → `js/nutrition/nutrition.html`
  - `coach` → `js/coach/coach.html`
  - `recovery` → `js/recovery/recovery.html`
  - `checkin` → `js/checkin/checkin.html`
- Modálok: `scannerModal` → `js/nutrition/scanner-modal.html`; `foodModal` → `js/nutrition/food-modal.html`. A tanács- és a megerősítő modál a vázban marad (közös).
- Template-ek, a használó JS mappájába, mappánként egy `templates.html` fájlba, a mai sorrendjükben:
  - `workout/`: `tpl-exercise`, `tpl-set-row`, `tpl-cardio-row`, `tpl-picker-item`, `tpl-workout-source`, `tpl-history-entry`
  - `nutrition/`: `tpl-nutrition-meal`, `tpl-nutrition-entry`, `tpl-food`, `tpl-fd-today-item`
  - `coach/`: `tpl-coach-meal`, `tpl-meal-item-row`, `tpl-coach-note`, `tpl-athlete-card`
  - `profile/`: `tpl-setting-toggle`, `tpl-pf-record`, `tpl-pf-record-slot`
  - `recovery/`: `tpl-rc-component`, `tpl-rc-lift`
  - `checkin/`: `tpl-ci-*`
  - `shared/`: `tpl-plan`, `tpl-pr`, `tpl-pr-history-item`, `tpl-advice-item`, `tpl-scale`

  A `tpl-exercise`-t a `program/` is használja, de a `workout/`-é. Ha egy darab mai helye a DOM-ban a sorrend miatt nem engedi egy fájlba vonni (két darab közé más ékelődik), akkor több `templates-*.html` fájl lesz. A DOM-sorrend nem változhat.
- Módosítás: `public/index.html` (váz + jelölők); a 3 teszt (`tests/public/js/app/icons`, `number-step`, `shortcuts`): `readFileSync(index.html)` → `assemblePage(PUBLIC_DIR)`.

- [ ] **1. lépés:** a szeletelés. Minden szelet helyén egy `<!-- @include js/... -->` sor, a szelet eredeti behúzásával.
- [ ] **2. lépés: átvételi próba** (BASE = az 1. feladatban feljegyzett hash):

```bash
node -e "
const { execSync } = require('node:child_process');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const base = execSync('git show BASE:public/index.html', { encoding: 'utf8' });
import('./server/core/page.js').then(({ assemblePage }) => {
  const now = assemblePage('public');
  console.log(norm(base) === norm(now) ? 'AZONOS' : 'ELTÉR');
});"
```

Elvárt kimenet: `AZONOS`.
- [ ] **3. lépés:** `npm test` → zöld; `npm start` → kézi füstpróba (lásd 21. feladat, 3. lépés).
- [ ] **4. lépés: commit** — `Frontend: az index.html oldalai, modáljai és template-jei a funkció JS-e mellé kerültek — az összefűzött oldal azonos a korábbival`.

---

### 21. feladat: Takarítás, dokumentáció, végső ellenőrzés

**Fájlok:**
- Módosítás:
  - `eslint.config.js`: az elavult `public/gyujto/**` ignore törlése, a `GENERATED` útvonalak ellenőrzése.
  - `.prettierignore`: ellenőrzés.
  - `README.md`: a 160–200. sor körüli projektstruktúra-rész, és minden régi útvonal a szövegben. Ellenőrzés: `grep -nE "server/(db\.js|db/|routes/|services/|http/|auth\.js|recovery\.js|records\.js|coaching\.js|plan-week\.js|headers\.js)" README.md` → üres. A szerződésről egy rövid bekezdés kerül be: „Új funkció: `server/features/<téma>/index.js` + `public/js/<téma>/` + egy CSS-fájl”.

- [ ] **1. lépés:** a fenti módosítások; `npm run lint`, `npm run format:check` → hibátlan.
- [ ] **2. lépés:** `npm test` → `fail 0`, `pass` ≥ 895 (a jegyzőkönyvben a végső szám).
- [ ] **3. lépés: kézi füstpróba** a `npm run start:demo` szerverrel, böngészőben:
  - belépés edzőként és Bence-ként;
  - mind a 13 oldal megnyitása (`#dashboard`, `#profile`, `#workout`, `#plan-builder`, `#program-builder`, `#exercise-picker`, `#workout-picker`, `#nutrition`, `#plans`, `#coach`, `#summary`, `#recovery`, `#checkin`) → a konzolban nincs hiba;
  - egy edzés mentése; egy check-in kitöltése; a vonalkód-modál és az étel-modál megnyitása.
- [ ] **4. lépés: a sikerkritérium próbája.**
  - `git ls-files server | grep -i program` → minden találat a `server/features/program/` alatt van.
  - A frontend-oldal a `public/js/program/` alatt, a CSS a `public/css/14-programozo.css`-ben, a tesztek a `tests/public/js/program/` alatt.
  - A `server.js`-ben nincs `program` szó.
- [ ] **5. lépés:** `git status` tiszta; `git log --format='%an %ae%n%b' main..HEAD | grep -i claude` → üres.
- [ ] **6. lépés: commit** — `Dokumentáció: a README az új szerkezetet írja le; elavult lint-kivételek törölve`.
- [ ] **7. lépés: átadás.** **Beolvasztás a `main`-be csak 2026-11-18 után, a felhasználó kifejezett jóváhagyásával** (superpowers:finishing-a-development-branch).
