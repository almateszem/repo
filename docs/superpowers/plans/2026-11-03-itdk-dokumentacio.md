# ITDK-dokumentáció Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Új `DOKUMENTACIO-ITDK.md` a repó gyökerében: előlap, rezümé, hat főfejezet (a régi szöveg szó szerint az Eredmények alatt), szakirodalmi áttekintés és APA 7 irodalomjegyzék.

**Architecture:** Egy egyszeri Node-szkript a régi `DOKUMENTACIO.docx.md`-ből gépileg állítja elő a vázat: átszámozott címek, átírt belső hivatkozások, kész előlap, és `<!-- PENDING: id -->` helyek az új szövegeknek. Az új szövegek kézzel kerülnek a helyükre. Egy újrafuttatható ellenőrző szkript minden lépés után igazolja, hogy a régi szöveg érintetlen, a hivatkozások párosak és a rezümé hossza a kereten belül van.

**Tech Stack:** Node.js 24 (ESM `.mjs`, csak beépített modulok), Markdown. Webes ellenőrzés a forrásokhoz (WebSearch/WebFetch).

**Spec:** `docs/superpowers/specs/2026-11-03-itdk-dokumentacio-design.md`

## Global Constraints

- A régi `DOKUMENTACIO.docx.md` nem változik. Az új fájl `DOKUMENTACIO-ITDK.md`, UTF-8, és **nem kerül gitbe**.
- A régi szövegből csak a címszint, a fejezetszám és az alábbi 13 belső hivatkozás változik. Az első sor (`**Podium – fejlesztői dokumentáció**`) elmarad. A 12 `KITÖLTENDŐ` jelölés és a 784-es szám marad.
- Címforma a régi fájl szerint: `# **4\. Eredmények**`, `## **4.1 Követelmények**`, `### **4.5.3 Hitelesítés / jogosultságkezelés**`.
- Hivatkozási minta (a felhasználóé, kötelező): szoftver `Szerző. (Év). Név (Version x.y.z) [Computer software]. URL`; MI-eszköz `Anthropic. (Év). Claude Code (Version x) [Large language model]. URL`; szövegközi `(OpenJS Foundation, 2026)` és `Az OpenJS Foundation (2026) …`.
- Több szerzőnél szövegközben `és mtsai`, a jegyzékben az összes szerző (APA 7, legfeljebb 20). Azonos szerző és év esetén `2026a`, `2026b` …, a betűt a cím ábécérendje adja (saját döntés).
- Kitalált adat nem kerülhet be. Minden tudományos forrás szerzőjét, évét, címét, folyóiratát, kötetét, oldalát és DOI-ját a forrásnál kell látni. Ami nem igazolható, az kimarad, és a felhasználónak jelezni kell.
- **Laikus olvasó:** az olvasók nem informatikusok. Minden új szöveg rövid mondatokban, köznapi nyelven szól. Ha egy szakszó vagy terméknév nem kerülhető el, az első előfordulásnál egy köznapi tagmondat magyarázza (pl. „az SQLite, egy kis adatbázis-program, amely a felhasználók adatait egyetlen fájlban tárolja”). Az új szövegben nincs fájlnév, kód, függvénynév és verziószám, kivéve az irodalomjegyzéket. A régi szöveg ettől függetlenül szó szerint marad.
- A git-commitokban nincs Claude-jelölés: se trailer, se Claude-szerző.
- Munkafájlok (szkriptek): `C:\Users\user\AppData\Local\Temp\claude\807b2261c03f597d\eec918cc-8aa1-4563-893c-e5acf648cf14\scratchpad\itdk\` (a továbbiakban `$W`).

## Review Focus

1. **Azonos szerző, azonos év** (OpenJS Foundation 2026: Node.js, Express, ESLint). Három különálló, betűvel jelölt bejegyzést várunk, és mindegyik szövegközi hivatkozás a saját betűjére mutat. → 2. feladat, `citations` ellenőrzés.
2. **Escape-elt Markdown a régi szövegben** (`\.`, `\>`, `\-`, `\[`). A címfelismerés ezekkel is működjön, és a szó szerinti másolat bájtra azonos maradjon. → 1. feladat, `headings` és `verbatim`.
3. **Táblázatsorban lévő hivatkozás** (régi 279. sor). A csere után a sor `|` elválasztói ugyanannyian maradnak. → 1. feladat, `crossrefs`.
4. **Verziószámok, amelyek hivatkozásnak látszanak** („5.0 (engines)”, „^10.0.1”). Csak a 10 felsorolt sor változhat. → 1. feladat, `verbatim`.
5. **Szakzsargon az új szövegben.** Egy laikus olvasónak minden szakszó első előfordulásánál ott kell lennie a köznapi magyarázatnak, és nem maradhat benne fájlnév vagy kód. → 5. feladat, 1. lépés (gépi keresés és átolvasás).
6. **Rezümé-hossz Markdown-jelölésekkel.** A `**` és a sortörés nem számít leütésnek, a szóköz igen. → 4. feladat, `rezume`.

---

### Task 1: Váz és ellenőrző

**Files:**
- Create: `$W/itdk-check.mjs`, `$W/itdk-build.mjs`
- Create (generált): `DOKUMENTACIO-ITDK.md`

**Interfaces:**
- Produces: `node $W/itdk-check.mjs <régi.md> <új.md> [--final]` → soronként `OK  <ellenőrzés>` vagy `HIBA <ellenőrzés>: <részlet>`; kilépési kód 0, ha minden OK, különben 1. Ellenőrzések: `verbatim`, `headings`, `crossrefs`, `citations`, `rezume`, `pending`. A `--final` nélkül a `pending` helyek megengedettek; a `rezume` `KIHAGYVA` sort ír, ha a rezümé még `PENDING`.
- Produces: `node $W/itdk-build.mjs <régi.md> <új.md>` egyszer fut. Ha az új fájl már létezik, nem írja felül, hanem 1-es kóddal kilép.
- Produces: helyjelölők `<!-- PENDING: rezume -->`, `celkituzes`, `szakirodalom`, `eredmenyek-bevezeto`, `kovetkeztetesek`, `javaslatok`, `irodalomjegyzek`.

**Címleképezés** (a régi címsor `#`-ainak száma és a `**N\. Cím**` / `**N.M Cím**` számozás alapján):
- régi `# N.`, N = 2…11 → `## **4.(N−1) Cím**`
- régi `## N.M` → `### **4.(N−1).M Cím**`
- régi `###` → `####`, a szöveg változatlan
- régi `# 12.` → `## **5.3 Összegzés**`; a régi 1. fejezet címei nem változnak

**A 13 belső hivatkozás** (régi sorszám: régi → új; csak ezek a részszövegek cserélődnek):

| sor | csere |
|---|---|
| 39 | `listája: 6.2.` → `listája: 4.5.2.` |
| 53 | `a 6.3,` → `a 4.5.3,` · `az 5.3 írja` → `a 4.4.3 írja` |
| 57 | `az 5.4 írja` → `a 4.4.4 írja` |
| 134 | `lásd 6.3.` → `lásd 4.5.3.` |
| 150 | `a 6.2 fejezetben` → `a 4.5.2 fejezetben` |
| 279 | `lásd 5.4.` → `lásd 4.4.4.` |
| 467 | `lásd 6.3)` → `lásd 4.5.3)` |
| 511 | `lásd 3.4)` → `lásd 4.2.4)` |
| 604 | `(4.5)` → `(4.3.5)` |
| 686 | `Modulok: 3.2 (szerver), 7.1-7.2` → `Modulok: 4.2.2 (szerver), 4.6.1-4.6.2` |

(Az „az 5.x” → „a 4.x” névelőcsere is része a cserének, mert a „4” mássalhangzóval kezdődik.) A build a sort a tartalma alapján keresi meg, nem csak a sorszám alapján. Ha egy minta nem pontosan egyszer szerepel, hibával leáll.

**Az új fájl váza**, sorrendben. Minden sor külön bekezdés, köztük üres sor:

```
**INTÉZMÉNYI TUDOMÁNYOS DIÁKKÖRI KONFERENCIA**
2026. november 18.
**PODIUM**
Podium
Készítette:
Kovács Valter
Dausek Csanád
Peresztegi Viktor Zsolt
Szoftverfejlesztő és -tesztelő technikus
Kaposvár
Témavezető: Fogarasi András, szakoktató, KIAKK, Kaposvár
Lehetséges OTDK szekció: Informatika
Kaposvár
2026.
---
**PODIUM**
Podium
Készítette: Kovács Valter, Dausek Csanád, Peresztegi Viktor Zsolt, Kaposvári Informatika Ágazati Képzőközpont, Szoftverfejlesztő és -tesztelő technikus, Kaposvár
Témavezető: Fogarasi András, oktató, Kaposvári Informatika Ágazati Képzőközpont
<!-- PENDING: rezume -->
---
[régi 1. fejezet, szó szerint]
# **2\. Célkitűzés**
<!-- PENDING: celkituzes -->
# **3\. Szakirodalmi áttekintés**
<!-- PENDING: szakirodalom -->
# **4\. Eredmények**
<!-- PENDING: eredmenyek-bevezeto -->
[régi 2–11. fejezet, átszámozva]
# **5\. Következtetések, javaslatok, összegzés**
## **5.1 Következtetések**
<!-- PENDING: kovetkeztetesek -->
## **5.2 Javaslatok**
<!-- PENDING: javaslatok -->
[régi 12. fejezet, címe ## **5.3 Összegzés**]
# **6\. Irodalomjegyzék**
<!-- PENDING: irodalomjegyzek -->
```

- [ ] **Step 1: Írd meg az `itdk-check.mjs`-t.** Ezt kell ellenőriznie:
  - `verbatim`: a régi fájl 1. sor nélküli, nem üres, nem címsor sorai, a 10 hivatkozásos sor helyén a cserélt alakkal, ebben a sorrendben részsorozatként szerepelnek az új fájlban, bájtra azonosan.
  - `headings`: a régi címek a leképezés szerinti alakban, sorrendben megvannak, és az új fájlnak pontosan hat `# ` szintű címe van: 1–6.
  - `crossrefs`: a táblázat 13 új alakja megvan, egyik régi alak sincs meg, és a 279. sornak megfelelő sor `|`-száma megegyezik a régiével.
  - `citations`: lásd a 2. feladatot. Ha nincs irodalomjegyzék-bejegyzés és nincs szövegközi hivatkozás, OK.
  - `rezume`: lásd a 4. feladatot.
  - `pending`: kiírja a megmaradt helyek azonosítóit (`OK  pending: rezume, celkituzes …`); `--final` mellett egyetlen `<!-- PENDING` sem maradhat.
- [ ] **Step 2: Futtasd még az új fájl létrehozása előtt.**
  Run: `node $W/itdk-check.mjs DOKUMENTACIO.docx.md DOKUMENTACIO-ITDK.md`. Expected: kilépési kód 1, hiba arról, hogy az új fájl hiányzik.
- [ ] **Step 3: Írd meg az `itdk-build.mjs`-t a fenti váz, leképezés és csere-táblázat szerint, és futtasd.**
- [ ] **Step 4: Futtasd az ellenőrzőt.**
  Run: ugyanaz, mint a 2. lépésben. Expected: öt `OK` sor (`verbatim`, `headings`, `crossrefs`, `citations`, `pending` mind a hét azonosítóval) és `KIHAGYVA rezume`, kilépési kód 0.
- [ ] **Step 5: Negatív próba.** Másold az új fájlt `$W/rossz.md` néven, írj át benne egy vesszőt a régi szövegben, és egy hivatkozást vissza `lásd 6.3`-ra, majd futtasd az ellenőrzőt erre a másolatra. Expected: `HIBA verbatim` és `HIBA crossrefs`, kilépési kód 1. Utána töröld a `rossz.md`-t.
- [ ] **Step 6: Nincs commit.** A kimenet és a szkriptek nincsenek a gitben. Ellenőrizd a `git status`-szal, hogy csak a `?? DOKUMENTACIO-ITDK.md` új.

### Task 2: Szakirodalmi áttekintés (3.) és irodalomjegyzék (6.)

**Files:**
- Modify: `DOKUMENTACIO-ITDK.md` (a `szakirodalom` és az `irodalomjegyzek` hely)
- Modify: `$W/itdk-check.mjs` (`citations`)

**Interfaces:**
- Consumes: az 1. feladat ellenőrzője és helyjelölői.
- Produces: az irodalomjegyzék kulcsai (`első szerző + év`). A 3. feladat ezek közül hivatkozhat.

**Források**: kiindulópont; a használatot és minden adatot ellenőrizni kell.

| Forrás | Használat a projektben | Verzió / adat |
|---|---|---|
| Node.js (OpenJS Foundation) | futtatókörnyezet, `node:sqlite`, `node:test` | a futtatott `node -v`: 24.16.0; `engines` ≥ 22.5.0 |
| Express (OpenJS Foundation) | HTTP-szerver, REST API | 4.22.3 (`package-lock.json`) |
| SQLite | adatbázis (a `node:sqlite` beépítve) | 3.53.0 (`select sqlite_version()`) |
| ZXing (`@zxing/library`) | vonalkód-olvasás a böngészőben | 0.21.3 |
| ESLint (OpenJS Foundation) | kódellenőrzés | 10.10.0 |
| Prettier | kódformázás | 3.9.6 |
| Claude Code (Anthropic) | kódírás, kódkritika, tervezés, tesztelés | 2.1.317 (`claude --version`), `[Large language model]` |
| Open Food Facts | vonalkódos élelmiszer-adatok (`server/openfoodfacts.js` proxy) | `[Data set]`, world.openfoodfacts.org |
| hasaneyldrm/exercises-dataset | gyakorlat-katalógus, 1324 gyakorlatból (`scripts/build-exdb.js`) | `[Data set]`, GitHub; év a repóból |
| Gym visual | a gyakorlatok képei és GIF-jei (`public/exercises/ATTRIBUTION.txt`) | gymvisual.com |
| Epley (1985) | 1RM-becslés | ellenőrizendő: Boyd Epley, *Poundage chart*, Body Enterprises |
| Foster és mtsai (2001) | kardió terhelés, szesszió-RPE | ellenőrizendő: *A new approach to monitoring exercise training*, J. Strength Cond. Res. 15(1) |
| Borg CR-10 | a szesszió-RPE skálája (README 459. sor) | csak ha a kód a CR-10-et használja; az eredeti publikációt meg kell keresni |
| Zourdos és mtsai (2016) | RIR-alapú RPE skála (a `failureWeight` RIR-t használ) | ellenőrizendő: J. Strength Cond. Res. 30(1) |
| az izomfáradtság-modell specjének és a README-nek a kutatási forrásai | Recovery Engine | olvasd el a `docs/superpowers/specs/2026-10-08-izomfaradtsag-modell-design.md`-t és a README Recovery-részét; csak a megnevezett és a kódban valóban használt forrás kerül be |

- [ ] **Step 1: Bővítsd a `citations` ellenőrzést, és írd meg hozzá a próbáját.** A jegyzék bejegyzései a `# **6\. Irodalomjegyzék**` alatti nem üres bekezdések. Kulcs: az év az első `\((\d{4}[a-z]?|n\.d\.)\)`, a szerző az előtte lévő rész első vessző előtti szakasza, a záró pont nélkül. Ezt kell ellenőriznie:
  - a bejegyzések ábécérendben vannak (`localeCompare(…, 'hu')`);
  - minden kulcs előfordul a 6. fejezeten kívül, és a szerző után legfeljebb 15 karakteren belül jön az év;
  - minden zárójeles szövegközi hivatkozásnak van párja. Ez a `\(([^()]*\d{4}[a-z]?[^()]*)\)` alakú csoport, `; `-vel elválasztott tételekkel, a tétel minta `^(.+?)(?: és mtsai)?, (\d{4}[a-z]?)`. A verziószámos zárójeleket (pl. `(Version 8.2)`) a minta nem fogja meg.
  - Próba: a `$W/proba.md`-ben egy hivatkozás jegyzék-bejegyzés nélkül, egy jegyzék-bejegyzés hivatkozás nélkül, és két `OpenJS Foundation (2026)` bejegyzés betű nélkül. Expected: mind a három `HIBA citations`.
- [ ] **Step 2: Ellenőrizd a forrásokat a weben.** Minden táblázatsorhoz nézd meg a hivatalos oldalt vagy a kiadót, DOI-t, PubMedet. A végén írd le a felhasználónak, mit nem sikerült igazolni.
- [ ] **Step 3: Írd meg a 3. fejezetet** (1,5–3 oldal, folyó szöveg) négy témakörben: fejlesztői környezet és szoftverek; adatforrások; szakmai módszerek; MI-eszköz. Minden forrásnál szerepeljen, mire használtuk, a felhasználó mintája szerinti zárójeles vagy narratív hivatkozással. Legalább egy narratív hivatkozás legyen.
- [ ] **Step 4: Írd meg a 6. fejezetet** a minták szerint, ábécérendben, a `2026a/b/c` betűkkel.
- [ ] **Step 5: Futtasd az ellenőrzőt.**
  Run: `node $W/itdk-check.mjs DOKUMENTACIO.docx.md DOKUMENTACIO-ITDK.md`. Expected: kilépési kód 0, és csak a `celkituzes`, `eredmenyek-bevezeto`, `kovetkeztetesek`, `javaslatok`, `rezume` helyek maradtak.

### Task 3: Célkitűzés (2.), az Eredmények bevezetője (4.), Következtetések és Javaslatok (5.1–5.2)

**Files:**
- Modify: `DOKUMENTACIO-ITDK.md` (a `celkituzes`, `eredmenyek-bevezeto`, `kovetkeztetesek`, `javaslatok` hely)

**Interfaces:**
- Consumes: a 2. feladat jegyzékkulcsai, ha valamelyik új szöveg forrást idéz.

- [ ] **Step 1: 2. Célkitűzés** (fél–egy oldal). Az 1.1 gondolatai ellenőrizhető célokra bontva: egy alkalmazás a három helyett; felkészültség-becslés (Recovery Engine); beleegyezésen alapuló edző–sportoló kapcsolat; biztonságos, mobilon is használható webalkalmazás. Az 1.1 mondatait nem ismétli. A források: a régi dokumentáció és az `MVP.md`.
- [ ] **Step 2: A 4. fejezet bevezetője.** Egy-két mondat arról, hogy a 4.1–4.10 az elkészült rendszert írja le.
- [ ] **Step 3: 5.1 Következtetések.** A 2. fejezet céljaira egyenként: mennyiben teljesültek. Az ismert hiányok az 5.3 (régi 12.) szövegéből jönnek, a 788/788-as tesztfutás (2026-11-03) igazolja a működést. Személyes tanulságot nem tartalmaz.
- [ ] **Step 4: 5.2 Javaslatok.** 4–6 továbbfejlesztési irány a `TEENDOK.txt` nyitott tételeiből és az 5.3 ismert hiányaiból: világos téma, technika-videó, offline működés, jelszó-visszaállítás. Mindegyikhez egy mondat arról, miért érdemes.
- [ ] **Step 5: Futtasd az ellenőrzőt.**
  Expected: kilépési kód 0, és csak a `rezume` hely maradt.

### Task 4: Rezümé

**Files:**
- Modify: `DOKUMENTACIO-ITDK.md` (a `rezume` hely)
- Modify: `$W/itdk-check.mjs` (`rezume`)

**Interfaces:**
- Consumes: a 2–3. feladat kész szövegei (a rezümé ezeket foglalja össze).

- [ ] **Step 1: Írd meg a `rezume` ellenőrzést, és írd meg hozzá a próbáját.** A törzs a `Témavezető: Fogarasi András, oktató` kezdetű sor után következő bekezdésektől a következő `---` sorig tart. Hossz: a bekezdések karakterszáma a `**`, `*` és `` ` `` nélkül, sortörések nélkül, a szóközökkel együtt. Ezt kell ellenőriznie:
  - a hossz 2400 és 2800 közé esik;
  - nincs benne szövegközi hivatkozás;
  - egyik bekezdés sem kezdődik szóközzel.
  - Próba: egy 2399 és egy 2801 leütéses törzzsel. Expected: `HIBA rezume` mindkettőnél, a hiba szövegében a mért hosszal.
- [ ] **Step 2: Írd meg a rezümé törzsét** magyarul, 4–5 behúzás nélküli bekezdésben: probléma, cél, megoldás (technológia, fő funkciók, Recovery Engine), eredmény (tesztek, állapot), kitekintés.
- [ ] **Step 3: Futtasd a végső ellenőrzést.**
  Run: `node $W/itdk-check.mjs DOKUMENTACIO.docx.md DOKUMENTACIO-ITDK.md --final`. Expected: hat `OK` sor, kilépési kód 0; a `rezume` sor mutatja a mért hosszat.

### Task 5: Átadás

- [ ] **Step 1: Ellenőrizd a nyelvezetet.** Az új szövegrészekben (rezümé, 2., 3., a 4. bevezetője, 5.1, 5.2) keresd meg a `` ` `` jelet, a `.js`, `.md`, `/`, `()` mintákat és a verziószámokat (`\d+\.\d+\.\d+`). Expected: egy találat sem. Utána olvasd végig a szöveget laikus szemmel, és nézd meg, hogy minden szakszónak (pl. Node.js, Express, SQLite, API, adatbázis, 1RM, RPE, RIR, vonalkód-olvasó könyvtár, nagy nyelvi modell) van-e köznapi magyarázata az első előfordulásnál. Javítás után futtasd újra a `--final` ellenőrzést.
- [ ] **Step 2: Ellenőrizd, hogy semmi más nem változott.**
  Run: `git status --short` és `git diff --stat DOKUMENTACIO.docx.md`. Expected: a régi fájl változatlan, az új fájl `??`.
- [ ] **Step 3: Számolj be a felhasználónak.**
  - A beszámolóban szerepeljen a fájl útvonala, a rezümé mért hossza, és az, hogy hány forrás került a jegyzékbe.
  - Sorold fel a nem igazolt és ezért kihagyott forrásokat.
  - Jelezd, hogy a 12 `KITÖLTENDŐ` jelölés megmaradt.
  - A következő lépés a Word-változat, ez külön kérés.
