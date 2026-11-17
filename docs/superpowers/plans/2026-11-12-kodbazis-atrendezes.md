# Kódbázis-átrendezés — végrehajtási terv

> **Ügynököknek:** KÖTELEZŐ al-skill: superpowers:subagent-driven-development (ajánlott) vagy superpowers:executing-plans, feladatonként. A lépések jelölőnégyzetesek (`- [ ]`).

**Cél:** a Podium kódját funkciónként egy helyre rendezni úgy, hogy egy új funkcióhoz két mappához és egy CSS-fájlhoz kelljen nyúlni. Közben a felhasználó semmilyen különbséget nem láthat.

**Architektúra:** a backend `server/core/` (közös infrastruktúra) és `server/features/<téma>/` (funkciók) szerkezetbe kerül. A funkciók egy kézzel vezetett jegyzékben (`server/features/index.js`) állnak, statikus importtal, egységes `index.js`-szerződés alapján (2026-11-17, T2: a dinamikus felfedezés felső szintű `await`-je holtpontba vitt). Az `index.html` darabokra bomlik a funkciók JS-e mellé, a szerver induláskor és kérésre fűzi össze őket. A demó-generátor szereplőnként bomlik a `scripts/demo/` alá. A gyökérből a nem-kód fájlok a repón kívülre kerülnek.

**Technológia:** Node ≥ 22.5 (ESM, `node:sqlite`, `node --test`), Express 4, vanilla JS frontend, build-lépés nincs.

**Spec:** `docs/superpowers/specs/2026-11-12-kodbazis-atrendezes-design.md` — a végrehajtó a tervvel együtt olvassa, a T1…T12 hivatkozások oda mutatnak.

## Globális kényszerek

- Ág: `kodbazis-atrendezes`, a `main`-ről — **azután**, hogy a `blokkos-programok` (a HIBALISTA.md javításaival együtt) 2026-11-18 után, a felhasználó jóváhagyásával beolvadt (0. feladat). Az átrendezés alatt a `blokkos-programok` nem kap commitot; ha mégis, az alapértékeket (0. feladat, 3. lépés) újra kell venni (T6).
- Viselkedésváltozás nincs: ugyanazok az API-válaszok, ugyanaz a HTML, ugyanaz a demó-adat. Algoritmus és API-forma nem változik.
- Új npm-függőség, bundler vagy build-lépés nincs. A `public/css/` tartalma nem változik.
- **Minden commit után** `npm test` → `fail 0`, és a `pass` értéke ≥ **az alapvonal**: a 0. feladat 3. lépésében rögzített szám (a 2026-11-12-i 895 azóta elavult, T6). Ahol a terv alább „≥ alapvonal”-t ír, ezt kell érteni. A tesztek száma csak nőhet.
- **Minden feladat végén** `npm run lint` és `npm run format:check` hibátlan.
- Commit-üzenet magyarul, a repó stílusában (`Terület: mit és miért`). **Semmilyen Claude-jelölés nem lehet benne:** se `Co-Authored-By` trailer, se Claude mint szerző.
- **Mozgató commit** = `git mv` + az ebből következő importútvonal-javítások, logikai változás nélkül. A tartalmi változás külön commit (T12).
- A `core/` a funkciókat csak a `server/features/index.js` jegyzéken át éri el (T2), és a befagyasztott migrációkban (T9). Felső szintű `await` a `core/`-ban és a funkciók moduljaiban nem lehet: a körkörös importtal együtt holtpontot okoz (próbán: a Node 13-as kóddal kilép, „unsettled top-level await”).
- A futtató gépen Windows van, ezért dinamikus importhoz mindig `pathToFileURL(abs).href` kell, nyers útvonal soha. Útvonalakat az `import.meta.dirname`-ből kell számolni, nem a `process.cwd()`-ből. Fájlrendszerbeli helyet (adatbázis, média, `public/`) **csak a `server/core/lib/paths.js`** számol (T1, T3; ld. 3. feladat) — így egy költöztetés nem mozdítja el őket.
- Az ESLint a `server/db.js` importját tiltja, amint a 17. feladat megszünteti (T8).
- Alapvonal-mappa (a repón kívül, nem verziózott): `C:\Users\user\Documents\podium-atrendezes-alapvonal\`.

## Review-fókusz

Olyan bemenetek és helyzetek, amelyekre a spec nem tér ki külön, mégis valószínűleg előjönnek:

1. **Elgépelt vagy hiányzó `@include` útvonal.** A szerver induláskor érthető hibával álljon le (a hiányzó fájl nevével). Ne szolgáljon ki egy oldalt, amelyben a jelölő szó szerint benne maradt. Teszt: 19. feladat, `assemblePage — hiányzó include-ra a fájlnevet tartalmazó hibát dob`.
2. **Egy funkció végpontja kicsúszik a belépés-őr alól** az új regisztrációs sorrend miatt. Funkciónként egy GET-végpontra bejelentkezés nélkül 401-et kell kapni. Teszt: 6. feladat, `tests/server/feature-guard.test.js`.
3. **Egy HTML-darab szerkesztése után nem jelenik meg a változás** szerver-újraindítás nélkül (`npm run dev` csak a JS-importokat figyeli). Teszt: 19. feladat, `createPageHandler — a darab módosítása után az új tartalmat adja`.
4. **Indítás más munkakönyvtárból**, illetve Windows-útvonal dinamikus importban: például `node C:\...\server\server.js` egy másik mappából, vagy a migrációs tesztek al-folyamata. A költöztetés nem nyithat új, üres adatbázist (T1). Teszt: 3. feladat, `paths — más cwd-ből is a server/podium.db-re és a public/exercises-re mutat`.
5. **Egy funkció kimarad a jegyzékből** (`server/features/index.js`), és a táblái vagy végpontjai csendben hiányoznak. Teszt: 4. feladat, `a jegyzék minden funkciómappát tartalmaz`.

---

## Fájlszerkezet (cél)

```
server/
  server.js                    middleware-ek, funkció-regisztráció, jobs, 404, statikus + oldal-kezelő
  core/
    features.js                checkFeatures(list) — szerződés-ellenőrzés, sorrend (T2)
    page.js                    assemblePage(publicDir), createPageHandler(publicDir)
    db/
      connection.js            (mozgatva) db, transaction, closeDatabase, configureConnection, DB_PATH
      schema.js                createBaseSchema(), createBaseIndexes()  — collections nélkül, csak users, sessions
      migrations.js            (mozgatva, befagyasztva) assertSupportedSchema, ensureColumns, runMigrations, ENSURED_COLUMNS
                               + ensureFeatureColumns(features), runFeatureMigrations(features)
      index.js                 bootstrap(list); export features, transaction, closeDatabase, ENSURED_COLUMNS (allData nincs, T7)
    http/
      errors.js, headers.js, ratelimit.js        (mozgatva)
    lib/
      dates.js, numbers.js                        (mozgatva)
      paths.js                                    PROJECT_ROOT, DEFAULT_DB_PATH, PUBLIC_DIR, MEDIA_DIR (T1, T3)
  features/
    index.js                   a jegyzék: export const FEATURES = [catalog, auth, …] (statikus importok, T2)
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
5. Ellenőrzés: `npm test` → `fail 0`, `pass` ≥ alapvonal.

**B) Szerződés commit.**
1. A `server/features/<téma>/index.js` létrehozása.
2. A téma `CREATE TABLE` / `CREATE INDEX` utasításai átkerülnek a `core/db/schema.js`-ből a funkció `tables` / `indexes` függvényébe, **szövegre változatlanul**. A `createSchema`-n belüli indexek a `tables`-be mennek, a `createIndexes`-beliek az `indexes`-be.
3. A funkció bekerül a jegyzékbe (`server/features/index.js`: egy statikus import és egy elem, névsorban), és a `server.js` explicit `register*` hívása helyére a jegyzék lép. A `features-registry` teszt („a jegyzék minden funkciómappát tartalmaz”) ezt ellenőrzi.
4. (A korábbi `data` lépés a T7 döntéssel megszűnt: nincs `allData()`.)
5. Ellenőrzés: `npm test` (benne a `schema-parity` és a migrációs tesztek) → zöld; `npm run lint`; demó-dump összevetése (1. feladat, 6. lépés) → nincs eltérés.

---

### 0. feladat: Beolvasztás, alapértékek, sorvégek és formázás (2026-11-17: T4, T6)

Az átrendezés csak ezután indulhat. Két okból áll elöl: (1) a terv rögzített alapértékei (`BASE`, `demo-base.json`, a tesztszám) a `blokkos-programok` minden új commitjával elavulnának; (2) a `npm run format:check` ma már piros (253 fájl a Windows-sorvégek miatt, azok nélkül is 54), pedig a terv minden feladat után tisztát követel.

- [ ] **1. lépés: beolvasztás.** A `blokkos-programok` (a HIBALISTA.md javításaival) **2026-11-18 után, a felhasználó kifejezett jóváhagyásával** beolvad a `main`-be. Előtte semmi.
- [ ] **2. lépés: sorvégek és formázás, külön commitban, a `main`-ről indított `kodbazis-atrendezes` ágon.**

```bash
git switch main && git switch -c kodbazis-atrendezes
printf '* text=auto eol=lf\n*.docx binary\n*.pptx binary\n*.pdf binary\n*.png binary\n*.jpg binary\n' > .gitattributes
git add --renormalize .
npx prettier --write .
npm test && npm run lint && npm run format:check   # mindhárom zöld
```

Commit: `Repó: egységes LF sorvégek (.gitattributes) és egyszeri Prettier-formázás — az átrendezés előtt, hogy a format:check valódi kapu legyen`. Ez a commit **csak** formázást tartalmaz; a diffben tartalmi változás nem lehet (`git diff --stat -w --ignore-blank-lines` a formázott fájlokon).
- [ ] **3. lépés: alapértékek.** `git rev-parse HEAD` → ez a **BASE** (a 20. feladathoz); `npm test` → a `pass` értéke az **alapvonal** (a globális kényszerek ehhez mérnek). Mindkettőt a `podium-atrendezes-alapvonal\ALAPVONAL.txt` rögzíti. A demó-alapvonal az 1. feladat 6. lépésében készül, ugyanerről a commitról.

---

### 1. feladat: Ág, alapvonal és db-dump eszköz

**Fájlok:**
- Létrehozás: `scripts/dump-db.js`, `tests/scripts/dump-db.test.js`

**Interfészek:**
- Létrehoz: `dumpDatabase(dbPath: string, { ignore?: string[] }): Record<string, object[]>`. A táblák névsorban, a sorok `JSON.stringify` szerint rendezve, `sqlite_%` táblák nélkül, az `ignore` elemei `tábla.oszlop` alakúak. CLI: `node scripts/dump-db.js <db> [--ignore t.c ...]` → formázott JSON a kimenetre.

- [ ] **1. lépés: ág és alapvonal**

```bash
git switch kodbazis-atrendezes   # a 0. feladatban jött létre, a main-ről
npm test                         # elvárt: pass = alapvonal (0. feladat, 3. lépés), fail 0
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
- [ ] **1b. lépés: a dokumentumok mai állapota a történetbe (T5).** A `git rm` csak akkor biztonságos, ha a törölt tartalom visszahozható. 2026-11-17-én a `Prezentacio/Podium-bemutato.pptx`-ben nem commitolt változás volt, és a `Prezentacio/eloadas-szoveg.md` nem is volt verziózva — a `git rm -r` ezen elakadt volna (`-f` nélkül), `-f`-fel pedig a változás elveszett volna a történetből.

```bash
git status --short -- DOKUMENTACIO.docx DOKUMENTACIO-ITDK.md "ITDK előlap 20261118.docx" "Podium_dokumentáció végleges.pdf" "resume_sablon 2026 (1).doc" TEENDOK.txt teendők.txt "bg-waves (2).html" ITDK OTIO Prezentacio
```

Ha a lista nem üres (a `.~lock` fájl kivételével): **kérdezd meg a felhasználót**, mely fájlok mai állapota kerüljön a történetbe, és azokat egy külön commitban vedd fel — `Dokumentumok: a bemutató és a kísérőszöveg utolsó állapota (a repóból való kivétel előtt)`. Utána a lista üres.
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

- [ ] **0. lépés: közös útvonal-modul — tartalmi commit, a mozgatás ELŐTT (2026-11-17: T1, T3).** Ma három fájl a saját helyéhez képest számolja a fájlrendszerbeli útvonalát, és mindhárom költözik:
  - `server/db/connection.js`: `DEFAULT_DB = path.join(__dirname, '..', 'podium.db')` és `LEGACY_DB` (…`fittrack.db`). Az 5. feladat költöztetése után ez a `server/core/podium.db`-re mutatna: az `npm start` **új, üres adatbázist** nyitna, és ezt semmi nem fogná meg (a tesztek és a demó mind `PODIUM_DB`-t állítanak, a `.gitignore` csak a `server/*.db`-t fedi).
  - `server/data/catalog.js`: `MEDIA_ROOT = fileURLToPath(new URL('../../public/exercises/', import.meta.url))` — a 9. feladatban eltörik.
  - `server/server.js`: `PUBLIC_DIR` és a `node_modules/@zxing` útvonal.

  Új modul: `server/core/lib/paths.js` — `PROJECT_ROOT` (`path.resolve(import.meta.dirname, '..', '..', '..')`), `SERVER_DIR`, `DEFAULT_DB_PATH` (`server/podium.db`), `LEGACY_DB_PATH` (`server/fittrack.db`), `PUBLIC_DIR`, `MEDIA_DIR` (`public/exercises`), `ZXING_DIR`. A három fájl innen veszi az útvonalat; a viselkedés nem változik.

  Bukó teszt előbb (`tests/server/paths.test.js`, az adatbázist **nem** nyitja meg):
  - `paths — a gyökér a package.json mappája`: `existsSync(path.join(PROJECT_ROOT, 'package.json'))`.
  - `paths — más cwd-ből is a server/podium.db-re és a public/exercises-re mutat`: al-folyamat `cwd: os.tmpdir()`-rel, amely kiírja a `DEFAULT_DB_PATH`-t és a `MEDIA_DIR`-t → egyezik a `server/podium.db`-vel és a `public/exercises`-szel.
  - `paths — a connection.js PODIUM_DB nélkül a DEFAULT_DB_PATH-t választja`: al-folyamat `PODIUM_DB` nélkül, egy ideiglenes másolat-gyökéren — **nem** a valódi `server/podium.db`-n.

  Ez a teszt minden későbbi költöztetésnél (5., 9. feladat) is zöld kell maradjon. Commit: `Szerver: a fájlrendszerbeli útvonalak egy helyen (core/lib/paths.js) — a költöztetés nem nyithat új, üres adatbázist`.
- [ ] **1. lépés:** `git mv` a fentiekre; importok javítása az egész repóban (`grep -rn "dates.js'\|numbers.js'\|errors.js'\|headers.js'\|ratelimit.js'" server scripts tests`).
- [ ] **2. lépés:** `npm test` → zöld; `npm run lint`.
- [ ] **3. lépés: commit** — `Szerver: a közös segédmodulok a core/lib és core/http alá (csak mozgatás)`.

---

### 4. feladat: A funkció-jegyzék és -ellenőrző (`server/features/index.js`, `server/core/features.js`)

> **2026-11-17, T2:** az eredeti terv dinamikus felfedezést írt elő (`readdirSync` + felső szintű `await import()` a `core/db/index.js`-ben). Ez a 7B feladattól holtpontba vitt volna: a route- és szolgáltatás-modulok a 17. feladatig a `server/db.js` shimet importálják, az pedig a `core/db/index.js`-t — a kör a felső szintű `await`-tel feloldhatatlan (próbán: Node 13-as kilépési kód, „unsettled top-level await”). Helyette **statikus jegyzék**: kör így is lehet, de ESM-ben felső szintű `await` nélkül feloldódik, és a jegyzékből látszik, mi van bekötve.

**Fájlok:**
- Létrehozás: `server/features/index.js` (a jegyzék), `server/core/features.js` (ellenőrző), `tests/server/features-registry.test.js`

**Interfészek:**
- `server/features/index.js`: `export const FEATURES = [ … ]` — a funkciók `index.js`-ének alapértelmezett exportjai, **statikus** importtal, a mappák névsorában. Új funkció = egy import és egy elem itt. Felső szintű `await` nincs.
- `server/core/features.js`: `checkFeatures(list: Feature[]): Feature[]` — ellenőriz és sorba rendez, fájlrendszert nem olvas, importot nem végez.
- A `Feature` megengedett kulcsai, mind opcionális, kivéve a `name`-et:
  - `name: string` (= a mappa neve)
  - `after: string[]`
  - `tables(db)`, `indexes(db)`, `seed(db)`
  - `columns: {table, column, ddl}[]`
  - `migrations: {version: number, run(db)}[]`
  - `registerPublic(app, deps)`, `guard(app)`, `register(app, deps)`
  - `jobs: {every: 'daily', run(): void, atStartup?: boolean}[]`

  A spec 6.1-éhez képest a `seed`, a `guard` és az `atStartup` a terv kiegészítése. A spec 5. indítási fázisa (referencia-adat) a `seed`-del valósul meg. A belépés-őr az `auth` funkcióé, és a `core/http`-ből nem érhető el adatbázis-függés nélkül. Az `atStartup` a mai indításkori munkamenet-takarításhoz. (A korábbi `data` kulcs a T7 döntéssel megszűnt: `allData()` nincs, ld. 5. és 17. feladat.)

- [ ] **1. lépés: a bukó tesztek** (`tests/server/features-registry.test.js`, a `checkFeatures`-t memóriabeli objektumokkal hívják):
  - `checkFeatures — névsorban, az after felülírja`: `b`, `a` (`after: ['c']`), `c` → nevek: `['b','c','a']`.
  - `checkFeatures — ismeretlen kulcs → hiba a kulcs nevével` (`registr` → `/registr/`).
  - `checkFeatures — ismeretlen after-cél → hiba`; `körkörös after → hiba` (`/kör/`).
  - `checkFeatures — két guard → hiba`.
  - `checkFeatures — migráció version < 7 vagy duplikált version → hiba`.
  - `checkFeatures — duplikált name → hiba`.
  - `a jegyzék minden funkciómappát tartalmaz`: a `server/features/` alatti, `index.js`-t tartalmazó mappák neve = a `FEATURES` nevei (halmazként), és minden elem `name`-je egyezik a mappájáéval. Ez fogja meg, ha egy új funkció kimarad a jegyzékből (review-fókusz 5). A 4. feladatban a jegyzék még üres; a teszt ekkor két üres halmazt vet össze.
  - `modulszinten nincs await`: a `server/features/**/*.js` és a `server/core/**/*.js` forrásában nincs sor eleji, modulszintű `await` (szöveges keresés: `^await ` és `^(export )?const .* = await `).
- [ ] **2. lépés:** `node --test tests/server/features-registry.test.js` → FAIL.
- [ ] **3. lépés:** `server/core/features.js` és az üres `server/features/index.js` (`export const FEATURES = [];`) megírása. Rendezés: Kahn-algoritmus névsoros döntetlen-feloldással; hibaüzenetek magyarul, `features/<név>:` előtaggal.
- [ ] **4. lépés:** teszt → PASS; `npm test` → zöld.
- [ ] **5. lépés: commit** — `Szerver: funkció-jegyzék (features/index.js) és -ellenőrző (core/features.js) — statikus importok, determinisztikus sorrend`.

---

### 5. feladat: `server/core/db` — indítási fázisok

**Fájlok:**
- Mozgatás: `server/db/connection.js`, `schema.js`, `migrations.js`, `index.js` → `server/core/db/`. A témamodulok (`accounts`, `coaching`, `nutrition`, `body`, `training`, `programs`) egyelőre a `server/db/`-ben maradnak. A `connection.js` az adatbázis útvonalát a `core/lib/paths.js`-ből veszi (3. feladat, 0. lépés), így a mozgatás után a `paths` teszt zöld marad.
- Módosítás: `server/db.js` (shim) → `export * from './core/db/index.js'` és a témamodulok `export *` sorai (a mai `db/index.js` star-exportjai ide költöznek).
- Teszt: `tests/server/core-db.test.js`

**Interfészek:**
- Felhasznál: `FEATURES` (`server/features/index.js`) és `checkFeatures` (4. feladat).
- Létrehoz a `server/core/db/index.js`-ben:
  - `export const features = checkFeatures(FEATURES)` — statikus importból, felső szintű `await` nélkül.
  - `export function bootstrap(list: Feature[])` — az indítási fázisok egy adott listára; a modul betöltéskor a `features`-szel hívja. A tesztek ezen át adnak saját funkciólistát (a korábbi `PODIUM_FEATURES_DIR` felülírás a T2 miatt megszűnt).
  - `export { transaction, closeDatabase } from './connection.js'`, `export { ENSURED_COLUMNS } from './migrations.js'`.
  - **`allData()` nincs** (2026-11-17, T7: a spec T10 az irányadó — nincs központi újraexportálás; a tesztek és a seed a funkció moduljából importálnak, ld. 17. feladat).
- Létrehoz a `migrations.js`-ben:
  - `ensureFeatureColumns(features)`: hiányzó oszlop → `ALTER TABLE`, és bejegyzés az `ENSURED_COLUMNS`-ba (`added` jelzővel, ugyanúgy, mint a befagyasztottaké).
  - `runFeatureMigrations(features)`: a 7+ verziók növekvő sorrendben, mindegyik `transaction`-ben, utána `PRAGMA user_version = v`; ami ≤ a mai verzió, kimarad.

- [ ] **1. lépés: mozgató commit.** `git mv` a négy fájlra; a `db/index.js` star-exportjai a shimbe; importok javítása. `npm test` → zöld (a `paths` teszt is). Commit: `Szerver: az adatbázis-mag a core/db alá (csak mozgatás)`.
- [ ] **2. lépés: a bukó tesztek** (`tests/server/core-db.test.js`; a fázisok tesztje al-folyamatban fut, saját `PODIUM_DB`-vel, és a `bootstrap`-et egy a tesztben definiált funkciólistával hívja):
  - `fázisok — tables → columns → migrations → indexes → seed → atStartup sorrendben`: a funkció hookjai egy közös tömbbe írnak; elvárt sorrend: `['tables','columns','migrations','indexes','seed','job']`.
  - `funkció-migráció — egyszer fut, user_version 7 lesz`: két egymás utáni `bootstrap` → a `run` egyszer hívódik, `PRAGMA user_version` = 7.
  - `funkció-oszlop — régi táblán pótolja és bekerül az ENSURED_COLUMNS-ba`.
- [ ] **3. lépés:** teszt → FAIL.
- [ ] **4. lépés:** a `bootstrap`:
  - `assertSupportedSchema` → `configureConnection` → `createSchema()` + `f.tables(db)` → `v = readSchemaVersion()`; `legacy = ensureColumns(v)`; `ensureFeatureColumns(list)` → `runMigrations(v, legacy)`; `runFeatureMigrations(list)` → `createIndexes()` + `f.indexes(db)` → `seedCollections()` + `f.seed(db)` → `purgeExpiredSessions()` + az `atStartup` jobok.
  - A `migrations.js`-ben a belső `ensureColumn` closure csak annyit változik, hogy a közös `hasColumn` + push logikát a funkció-oszlopok is használják. A befagyasztott hívások szövege és sorrendje nem változik.
- [ ] **5. lépés:** teszt → PASS; `npm test` → zöld (a `schema-parity`, az `old-db-guard` és minden `*-migration` teszt is); demó-dump összevetése → üres diff.
- [ ] **6. lépés: commit** — `Szerver: core/db indítási fázisok a funkciók hookjaival (bootstrap)`.

---

### 6. feladat: A `server.js` a jegyzékben szereplő funkciókra áll át, plusz az őr-teszt

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
- [ ] **5. lépés: commit** — `Szerver: a jegyzékben szereplő funkciók regisztrációja (publikus → őr → védett); őr-teszt funkciónként`.

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

**Mellékfeladatok:**
- A `package.json` `test` szkriptje innentől `node --test "tests/**/*.test.js" "server/**/*.test.js"`. Ellenőrzés: a `pass` értéke nem csökken.
- **(T9)** Az `eslint.config.js` teszt-lazítása ma csak a `tests/**`-ra szól; ugyanebben a commitban a mintája `['tests/**', 'server/**/*.test.js']` lesz. Ellenőrzés: `npm run lint` zöld a `server/features/program/` alá költözött teszteken is.

- [ ] A) mozgató commit — `Program: a blokkos programok egy mappában (server/features/program, csak mozgatás)`
- [ ] B) szerződés commit — `Program: funkció-szerződés (táblák, végpontok); a server.js a jegyzékből regisztrál`
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
- **Előlépés, külön tartalmi commit (T10):** a `scripts/check-exports.js` ma kihagyja a `server/data/`-t, a kiköltöző három fájlra (`catalog.js`, `strength-standards.js`, `bodyweight-load.js`) viszont a költözés után ráhúzódik. Előbb ideiglenesen rájuk is futtatni, és a nem használt exportokat kivenni — `Katalógus: a nem használt exportok kivétele (az átköltöztetés előtt)`. Így a mozgató commit valóban csak mozgatás marad.
- A `catalog.js` média-útvonala már a `core/lib/paths.js`-ből jön (3. feladat, 0. lépés, T3), a költözés nem töri el; a `paths` teszt zöld marad.
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
- A `getCollection` hívói innentől a `catalog` funkció `db.js`-éből importálnak.
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
  - `indexes`: `idx_nutrition_log_user_date`, és **(T11)** a `createIndexes` mai `DROP INDEX IF EXISTS idx_nutrition_log_date` sora, szövegre változatlanul, a mai sorrendjében (előtte).
  - `jobs`: `[{ every: 'daily', run: purgeBarcodeCache }]`.
  - `register`.
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
  - `register`.

**13. `plans`**
- Mozgatás:
  - `routes/plans.js` → `routes.js`
  - `plan-week.js` → `plan-week.js`
  - a `db/training.js` tervekre vonatkozó függvényei → `db.js` (tartalmi commit: kettévágás)
- Tesztek: `plan-week`, `plan-assignment-migration` (marad `tests/server/`, mert migrációs).
- Szerződés:
  - `tables`: `plans`.
  - `indexes`: `idx_plans_user`.
  - `register`.

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
  - A shim mai records-újraexportját (`bestCompletedSet`, `calculateEpley1RM`) használó hívók a 17. feladatban a `records.js`-ből importálnak.
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
  - `register`.

Minden funkciónál:
- [ ] A) mozgató commit — `<Téma>: … egy mappában (server/features/<téma>, csak mozgatás)`
- [ ] B) szerződés commit — `<Téma>: funkció-szerződés`
- [ ] Ellenőrzés: `npm test` (`pass` ≥ alapvonal), lint, `feature-guard` zöld, demó-dump összevetése üres.

**A 16. után** a `server/routes/`, `services/`, `program/`, `validation/`, `http/`, `db/` mappák üresek. Ezek törlése a 16. feladat B-commitjába kerül. A `core/db/schema.js`-ben csak a `users`, a `sessions` és az indexeik maradnak — **ellenőrzés (T11):** `grep -nE "CREATE|DROP" server/core/db/schema.js` csak ezekre ad találatot; a `server.js`-ben nincs explicit `register*` import.

---

### 17. feladat: A `server/db.js` shim megszüntetése

**Fájlok:**
- Törlés: `server/db.js`
- Módosítás: minden `server/db.js`-t importáló fájl:
  - a `tests/server/` alatt (kb. 20 fájl, köztük a `*-migration`, `migration`, `old-db-guard`, `schema-parity` al-folyamat-sztringjei);
  - a funkciómappákba költözött tesztek;
  - `scripts/seed-demo.js`;
  - `tests/server/api.test.js` (a „nem érhető el HTTP-n” lista: `/server/db.js` → `/server/core/db/index.js`, `/../server/db.js` → `/../server/core/db/index.js`).
- Módosítás: `eslint.config.js` — `no-restricted-imports` a `server/db.js`-re (T8).

**Szabály (2026-11-17, T7 — a spec T10 az irányadó):**
- **Mindenki** — éles kód, tesztek és a seed — a funkció moduljából importál közvetlenül (pl. `server/features/workout/db.js`). Központi újraexport (`allData()` vagy más) nincs.
- Az adatbázis felépítéséhez a hívó a `server/core/db/index.js`-t importálja (mellékhatásként fut a `bootstrap`); a migrációs al-folyamatok és az `old-db-guard` erre várják a hibát.
- A tesztekben a `db.X(...)` hívások helyére a funkció nevesített importja kerül; ahol egy teszt sok funkcióból hív, több import sor jön — ez a T10 szándékolt ára („egy dolognak egy neve legyen”).

- [ ] **1. lépés: lint-szabály (T8).** Az `eslint.config.js`-be: `no-restricted-imports` — tiltott útvonalak: `**/server/db.js` és `../db.js` / `../../db.js` a `server/` gyökerére, a hibaüzenet: „A server/db.js megszűnt — a funkció moduljából importálj (spec T10).” A `npm run lint` ekkor **sok hibát** jelez: ez a munkalista. (A korábbi `grep "db\.js"` minden funkció saját `db.js`-ére is illett volna.)
- [ ] **2. lépés:** a lint-hibák mind javítva, a fenti szabály szerint.
- [ ] **3. lépés:** `server/db.js` törlése; `npm test` → zöld; `npm run lint` → hibátlan (ez a feladat kapuja); `node scripts/check-imports.js` és `node scripts/check-exports.js` → hibátlan.
- [ ] **4. lépés:** demó-dump összevetése → üres.
- [ ] **5. lépés: commit** — `Szerver: megszűnik a server/db.js újraexport — mindenki a funkció moduljából importál; az ESLint tiltja a régi utat`.

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
  - a `db`-t (a kapcsolatot); az adatfüggvényeket a szereplő-fájlok a funkciók moduljaiból importálják (T7).
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
- Modálok:
  - `scannerModal` → `js/nutrition/scanner-modal.html`; `foodModal` → `js/nutrition/food-modal.html`; **(T11)** `customFoodModal` → `js/nutrition/custom-food-modal.html`.
  - **(T11)** `videoModal` → `js/workout/video-modal.html`; `prModal` → `js/workout/pr-modal.html`.
  - **(T11)** `settingsModal` → `js/profile/settings-modal.html`.
  - A tanács- és a megerősítő modál a vázban marad (közös).
  - **Ellenőrzés (T11):** a szétbontás után `grep -o 'id="[a-zA-Z]*Modal"' public/index.html` csak a vázban hagyott két közös modált adja; minden más `…Modal` egy `@include`-olt darabban van.
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
- [ ] **2. lépés: átvételi próba** (BASE = a 0. feladat 3. lépésében feljegyzett hash):

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
- [ ] **2. lépés:** `npm test` → `fail 0`, `pass` ≥ alapvonal (a jegyzőkönyvben a végső szám).
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
