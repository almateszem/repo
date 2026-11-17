# Podium — hibalista (teljes kódbázisos bugkeresés)

- **Készült:** 2026-11-15/16, a `blokkos-programok` ágon (`de86810`)
- **Kiinduló állapot:** 895/895 teszt zöld, a lint tiszta
- **Módszer:** (1) `npm test` + lint, (2) az app élő bejárása böngészőben a bemutató-adatbázis *másolatán*, (3) kódátvizsgálás
- **Állás:** 29 nyitott tétel + 11 megjegyzés az átrendezési tervhez
- **Döntések:** mind a 40 tételnél eldőlt (2026-11-17) — az ajánlott **A** megoldás, két helyen pontosítva (P1: a programterv miatt; M1: a címkék valódi tartalma miatt), és a P10 a P8 végpontjából kapja a testsúlyt.
- **Javítás (2026-11-17):** mind a 40 tétel kész. A tesztcsomag 978/978 zöld, a lint tiszta. Élő bejárás (13 oldal, telefonos és asztali szélesség) hibátlan.

| Szakasz | Azonosító | Darab | Miről szól |
|---|---|---|---|
| 1. Blokkos program | P1–P10 | 10 | kódhibák az új programkódban és a naplóval való találkozásánál |
| 2. Adat és szerver | A1–A5 | 5 | korlátok, edzőváltás, megjelenített név |
| 3. Felület és használat | F1–F9 | 9 | amibe a felhasználó a képernyőn fut bele |
| 4. Apróságok | M1–M5 | 5 | megfigyelések, nem biztos, hogy hibák |
| 5. Átrendezési terv | T1–T11 | 11 | amibe a terv végrehajtása belefutna |

**Jelölések**

- `[ ]` nyitott · `[x]` kész
- **FUTTATVA** — élesben vagy kódfuttatással reprodukálva
- **OLVASVA** — csak a kód olvasásából következik; javítás előtt érdemes kipróbálni
- Súlyosság: **SÚLYOS** (rossz adat vagy rossz döntés keletkezik) · **KÖZEPES** (zavaró, de megkerülhető) · **KICSI** (szépséghiba)
- **Megoldások:** minden tételnél három lehetőség áll. Az **A ★** az, amit ajánlok; a B és a C a két alternatíva. A választás tételenként a tiéd — a `Döntés:` sorba kerül, amikor odaérünk.

---

## 1. Blokkos program

### - [x] P1 — A szabályok olyan gyakorlatra is lefutnak, amiből nem volt szett

**SÚLYOS · FUTTATVA** · `server/program/rules.js:116-122` (+ `periodStats`, 69-85)

A szabályok minden TM-gyakorlatra lefutnak, arra is, amelyikből az időszakban egy szett sem volt. A 0 teljesített / 0 összes adatnak számít.

- **Példa:** guggolás- és fekvenyomásnapos program, szabály: „minden edzés után: teljesített (gyak.) ≥ összes (gyak.) → TM + lépésköz". Egy csak-guggolás edzés után a kártya a Fekvenyomásra is javasol 80 → 82,5-öt, „0 ≥ 0" indokkal.
- **Ellenőrzés:** a `runStages` futtatva, majd végig egy memóriabeli adatbázison.

**Megoldások**

- **A ★ — Szett nélküli gyakorlat kimarad a szakaszból.** A `suggestTrainingMaxes` a szabályok előtt megnézi a `totalEx`-et; ha 0, a gyakorlat marad a jelenlegi TM-en „Nem volt szett az időszakban" indokkal (ciklus közben így meg sem jelenik a kártyán). Egy helyen javít, minden szabálytípusra hat.
- **B — A 0/0 „hiányzó adat" legyen.** A gyakorlat-szintű blokkok (teljesített, összes) `MissingValueError`-t dobnak, ha nincs szett → „Nincs adat a szabályhoz". Finomabb, de a fájdalomra vagy készenlétre épülő szabály továbbra is hatna a nem edzett gyakorlatra.
- **C — Csak jelzés a kártyán.** A javaslat megmarad, de „0 szett ebben az edzésben" figyelmeztetést kap, és alapból nincs bepipálva. A hibás javaslat nem tűnik el, csak nehezebb elfogadni.

**Döntés: B-hez közeli, módosítva** (2026-11-17) — az A ütközött a programtervvel (a kiégés-szabály szándékosan minden TM-et csökkent, a ciklus végi lépésköz edzés nélkül is jár; 7 teszt védi). Helyette: szett nélkül csak a gyakorlat-szintű érték (teljesített/összes gyak.) „nincs adat”. · **Kész:** 542d37d

### - [x] P2 — A „+ Szett hozzáadása" az AMRAP-jelzőt is másolja

**SÚLYOS · FUTTATVA** · `public/js/workout/set-controls.js:74` (+ `sets-view.js:316`, `server/program/rules.js:55-58`)

Az új szett az utolsó sor másolata (`readSetRow`), az `amrap` mezővel együtt. A szabály az utolsó kipipált AMRAP-szettet veszi figyelembe.

- **Példa:** az „5+" szett 9 ismétléssel megvan, utána egy 5-ös levezető szettet adsz hozzá. A szabály 9 helyett 5 ismétléssel számol, tehát rossz számra dönt a TM-ről.
- **Ellenőrzés:** a `collectCycleData` erre a bemenetre `amrapReps: 5`-öt adott.

**Megoldások**

- **A ★ — Az AMRAP-jelző ne öröklődjön.** A `nextSetValues` a típus mellett az `amrap`-ot is törli az új sorból. Egy sor, a meglévő „a típus nem öröklődik" szabály mintájára.
- **B — A szerver az első AMRAP-szettet vegye.** A `collectCycleData` gyakorlatonként és edzésenként csak az első jelzett szettet számolja. A már elmentett, hibásan jelzett edzéseket is helyrehozza; az A mellé védőhálónak is jó.
- **C — Látható, kapcsolható AMRAP-jelölés a sorban.** A hozzáadott sor mutatja a jelzőt, és ki lehet kapcsolni. A legnagyobb munka, és a figyelmetlen felhasználót nem védi.

**Döntés: A** (2026-11-17) · **Kész:** 685af09

### - [x] P3 — Nyitott javaslat mellett mentett edzés után a határ-szabályok végleg kimaradnak

**SÚLYOS · FUTTATVA** · `server/services/program-run.js:205`

Ha ciklus közbeni javaslat van nyitva, és közben edzés mentődik, a pozíció lép, de a határ-szabályok nem futnak le. A megjegyzés szerint „a döntés után futnak tovább", a `decideMid` azonban nem futtatja őket.

- **Példa:** 2 napos program, az A nap javaslatot nyit, a B nap a döntés előtt mentődik. Az állapot `pos = 2 = összes`, `pending = null`. A döntés után újra a B nap jön („2/2. nap"), a ciklus-értékelés nem jelenik meg, amíg a napot újra el nem végzed vagy át nem ugrod.
- **Hogyan érhető el:** másik fülről vagy eszközről, illetve a P4-en keresztül.

**Megoldások**

- **A ★ — Nyitott javaslat mellett a programnap mentése várjon a döntésre.** A szerver 409-cel válaszol („Előbb dönts a szabály javaslatáról"), ahogy az ugratás már most is teszi; a kliens megmutatja a kártyát, a piszkozat megmarad, döntés után a befejezés újra megy. A rendes felület ilyenkor amúgy sem kínál programnapot, tehát ez mindig elavult kliens.
- **B — A kimaradt határ pótlása a döntés után.** Mentéskor eltárolódik a függő határ (edzés, elhagyott hét), és a `decideMid` a döntés után lefuttatja az `afterBoundary`-t. Ez felel meg a megjegyzés eredeti szándékának, de új állapotmezőt és több tesztet kér.
- **C — Az edzés mentődik, de programon kívüliként.** Nem címkéz és nem léptet; a nap a döntés után újra előjön. Adat nem vész el, viszont a felhasználó kétszer találkozik ugyanazzal a nappal.

**Döntés: A** (2026-11-17) · **Kész:** 6b935ee

### - [x] P4 — Ugratás vagy kikapcsolás után a régi nap a szerkesztőben marad

**KÖZEPES · OLVASVA** · `public/js/workout/loading.js:77` (+ `workout.js:423-428`)

Az `applyTemplate` a `program-review`, a `program-mid` és az üres sablonnál úgy tér vissza, hogy a szerkesztőt nem üríti.

- **Példa:** az Edzés oldalon be van töltve az N. nap. A Terveken megnyomod a „Ciklus vége" ugratást vagy a „Kikapcsolás"-t. Megjelenik az értékelő kártya (vagy eltűnik a sáv), de az N. nap gyakorlatai a program azonosítójával a szerkesztőben maradnak, és befejezhetők.
- **Következmény:** javaslatot nyitó ugratásnál a beragadt nap befejezése kiváltja a P3-at, és rossz pozícióra címkéz.

**Megoldások**

- **A ★ — A nem-edzés sablon ürítse a programnapot.** Ha a szerkesztőben programnap állt (`editing.source === 'program'`), a `program-review`, a `program-mid` és az üres sablon kiüríti, és nullázza a `planId`-t. Szabad edzéshez nem nyúl.
- **B — A megkezdett nap leválik a programról.** Ha már van kipipált szett, a tartalom megmarad, de `planId` nélkül, szabad edzésként fejezhető be; kipipált szett nélkül ürül. Semmi nem vész el, de két ág van.
- **C — Megerősítő kérdés az ugratás és a kikapcsolás előtt.** „A megkezdett mai napod elvész" — csak akkor, ha van megkezdett programnap. A beragadást nem szünteti meg, ha a kérdésre igen a válasz, ezért az A-val együtt ér valamit.

**Döntés: A** (2026-11-17) · **Kész:** 6b935ee

### - [x] P5 — Újratöltés után a programnap piszkozata már nem „programnap"

**KÖZEPES · OLVASVA** · `public/js/workout/finish.js:99` (+ `server/services/session-plan.js:45-54`)

A programnap aznapi piszkozata `source: 'draft'`-ként jön vissza, így a kliens nem tudja, hogy programnapról van szó.

- **Példa:** betöltöd a napot, kipipálsz egy szettet (az automatikus mentés piszkozatot készít), majd újratöltöd az oldalt, vagy a telefon eldobja a fület. Eltűnik a PROGRAM sáv és a hiányzó TM figyelmeztetése. Befejezés után nem töltődik be a következő nap vagy az értékelő kártya; az oldal üres marad teljes újratöltésig.
- **Megjegyzés:** a szerver állapota helyes, csak a kliens marad le.

**Megoldások**

- **A ★ — A szerver a piszkozat mellé adja a program-adatot.** Ha a piszkozat `planId`-ja az aktív programé, a válasz viszi a `program` (ciklus, pozíció, cím) és a `missing` mezőt is; a kliens ebből rajzolja a sávot, és ebből tudja a befejezés utáni teendőt.
- **B — Befejezés után a kliens mindig újrakéri a sablont.** Nem csak akkor, ha programnapnak hitte. Kis változtatás, megszünteti az üres oldalt, de a sáv és a TM-figyelmeztetés újratöltés után továbbra is hiányzik.
- **C — A piszkozat tárolja a forrását.** Új oszlop a piszkozat táblában (`source`), a sablon abból áll vissza. Tiszta, de séma-változás és migráció kell hozzá.

**Döntés: A** (2026-11-17) · **Kész:** 6b935ee

### - [x] P6 — A 60 karakteres névkorlát 9 katalógus-gyakorlatot megcsonkít

**KÖZEPES · FUTTATVA (a szám)** · `server/validation/workout-body.js:94-96`

A gyakorlat neve minden edzés-, piszkozat- és tervmentésnél 60 karakterre vágódik, de a katalógus 1441 gyakorlatából 9 ennél hosszabb.

- **Példa:** „Kábeles álló fordított fogású egykezes fej fölötti tricepsz nyújtás" (67 karakter) csonkolva mentődik, és többé nem egyezik a katalógus-névvel.
- **Következmény (OLVASVA):** a program-szabályok a teljes névre keresnek (a programoknál 80 a korlát, `program.js:20`), így ehhez a gyakorlathoz nem találnak szettet.

**Megoldások**

- **A ★ — Egy közös korlát, 80 karakter.** Egyetlen konstans a naplónak, a tervnek és a programnak, plusz egy teszt, amely ellenőrzi, hogy a katalógus minden neve belefér. A meglévő adat nem változik.
- **B — A kilenc név rövidítése 60 alá.** A névtáblában, ugyanazzal a teszttel. A korlát marad, de a már naplózott (csonka) nevek és a régi tervek nevei eltérnek az újtól.
- **C — Csonkítás helyett hibaüzenet.** A túl hosszú név 400-at kap, így rossz adat nem keletkezik — de a kilenc gyakorlat naplózhatatlan marad, amíg az A vagy a B nincs meg.

**Döntés: A** (2026-11-17) · **Kész:** 565184e

### - [x] P7 — A 0 ismétléses AMRAP-szett elveszti a jelzőjét

**KÖZEPES · OLVASVA** · `server/program/program.js:255` (+ `workout-body.js:138`, `sets-view.js:329`)

Az építő és a `normalizeSet` elfogadja a `reps: 0, amrap: true` párost (a gomb felirata „0+ AMRAP"). A `buildDayWorkout` ebből `amrap: 0`-t generál, amit a kliens (`> 0`) és a szerver (`>= 1`) is eldob.

- **Következmény:** a szett sima szettként naplózódik, az AMRAP-szabály válasza mindig „Nincs adat a szabályhoz".

**Megoldások**

- **A ★ — AMRAP-nál a minimum 1 ismétlés.** Az építő mezője 1-re igazodik, a `normalizeSet` pedig hibát ad a 0-ra. A „0+" amúgy sem értelmes előírás.
- **B — Generáláskor csendben 1 lesz belőle.** A `buildDayWorkout` `Math.max(1, reps)`-et ír az `amrap`-ba. A már elmentett programokat is megjavítja, de az építő továbbra is „0+"-t mutat.
- **C — A jelző legyen külön igaz/hamis mező.** `amrap: true` és külön minimum, így a 0 is érvényes. A szabályok, a napló és a kliens formátuma is változik — nagy munka kis haszonért.

**Döntés: A** (2026-11-17) · **Kész:** 565184e

### - [x] P8 — Új programnál a kiírt lépésköz nem az, amit a szerver alkalmaz

**KÖZEPES · OLVASVA** · `public/js/program/rule-editor.js:242`

A kiírt lépésköz 2,5 kg-ra esik vissza, ha a `defaultSteps`-ben nincs bejegyzés. Új programnál mindig ez a helyzet (a `startNew` `{}`-t ad át), és a megnyitás után hozzáadott gyakorlatoknál is.

- **Példa:** az új program „Guggolás 2,5 kg"-ot mutat, a `program.steps`-be semmi nem kerül, a szerver `defaultStep`-je viszont alsótestre 5 kg-ot ad.

**Megoldások**

- **A ★ — A szerver adja az alapértéket, a kliens azt mutatja.** A gyakorlat-keresés (vagy a program-kontextus) válasza viszi a gyakorlat alap lépésközét; a szerkesztő ebből tölt, új gyakorlat hozzáadásakor is. A szabály egy helyen él.
- **B — Amit látsz, az mentődik.** Mentéskor a kiírt érték minden TM-gyakorlatra bekerül a `program.steps`-be. Egyszerű, de az alsótest így 2,5 kg-ot kap, hacsak a visszaesési érték nem lesz okosabb.
- **C — A szabály megismétlése a kliensben.** A szerkesztő a katalógus izomcsoportjából maga számol 5 kg-ot alsótestre. Gyors, de ugyanaz a szabály két helyen él, és szét fog csúszni.

**Döntés: A** (2026-11-17) · **Kész:** 57f5ec3

### - [x] P9 — Érvényes program generálhat olyan napot, amit a mentés elutasít

**KÖZEPES · OLVASVA** · `server/program/program.js:187-191` és `:48` ↔ `workout-body.js:202` és `:75`

- **Cím:** a `dayTitle` a hét címkéjéből (≤40) + „ · " + a nap nevéből (≤40) áll, tehát akár 83 karakter. Az edzésnév korlátja 60, a címet pedig a program tölti ki, így a „Befejezés" elakad: „Az edzés neve kötelező (legfeljebb 60 karakter)".
- **Szettek:** gyakorlatonként 20 sor × 20 ismétlődés kibontva átlépi az 50 szettes korlátot (például 3 sor × 20). Ezt a piszkozat- és a mentés-végpont is elutasítja.

**Megoldások**

- **A ★ — A program mentésekor ellenőrzés a napló korlátaihoz.** A normalizálás hibát ad, ha egy nap címe 60 fölé nő, vagy egy gyakorlat kibontott szettszáma 50 fölé — a gyakorlat és a nap megnevezésével. A hiba ott derül ki, ahol javítani lehet, nem az edzés végén.
- **B — Szigorúbb mezőkorlátok.** A hét-címke és a napnév együtt férjen 60-ba (például 25 + 30), a sor × ismétlődés szorzat legfeljebb 50. Egyszerű szabály, de a meglévő hosszabb címkéjű programokat érinti.
- **C — Generáláskor vágás.** A cím 60-nál „…"-ra végződik, a szettek 50-nél megállnak. Nem akad el semmi, viszont a felhasználó nem azt kapja, amit beállított, és nem tud róla.

**Döntés: A** (2026-11-17) · **Kész:** 565184e

### - [x] P10 — A képlet-előnézet nem ismeri a testsúlyt

**KICSI · OLVASVA** · `public/js/program/program-builder.js:81`

A `loadContext` beégetve `bodyweight: null`-t ad, ezért a „testsúly" blokkot használó képlet előnézete „nincs testsúly", akkor is, ha van mérés. A szerver jól számol (`getLatestWeight`).

**Megoldások**

- **A ★ — A `loadContext` kérje le a legutóbbi testsúlyt.** A meglévő testsúly-napló végpontból, a két másik kéréssel párhuzamosan. Kis változtatás.
- **B — Egy kész „képlet-kontextus" végpont.** A szerver egyben adja a TM-eket, az 1RM-eket és a testsúlyt, ugyanabból a függvényből, amivel maga is számol. Az előnézet és a szerver nem tud szétcsúszni; a P8 alapértéke is ide férne.
- **C — Az előnézet mondja ki, hogy nem számol.** „A testsúly az edzés napján számolódik." Nem állít valótlant, de előnézetet sem ad.

**Döntés: A** (2026-11-17) · **Kész:** 57f5ec3

---

## 2. Adat és szerver

### - [x] A1 — Nincs felső korlát a súlyra és az ismétlésre

**SÚLYOS · FUTTATVA** · `server/validation/workout-body.js` (`nonNegativeField`) + `public/js/workout/set-controls.js`

A mezők `max=999`-e gépelésnél nem érvényesül: a kód csak az RPE-t igazítja vissza, a léptetőgombok betartják a határt, a billentyűzet nem. A szerver csak a negatív értéket szűri.

- **Példa a felületről:** 99999 kg beírva elmentődött.
- **Hatás:** egy 1 × 10^20 kg-os szett után a Guggolás PR-ja és az `exercise-maxes` értéke 10^20 kg lett, a készenlét 89-ről 44-re, a CNS 77-ről 0-ra esett, a fáradtság „Nagyon magas".
- **Valós eset:** 110 helyett 1100.
- **Mellékleletek:** a tört ismétlés (2,5) is mentődik; a −5 ismétlés a felületen −5 marad, a szerver 0-t ment.

**Megoldások**

- **A ★ — Kemény korlát a szerveren és a mezőn is.** A szerver 400-at ad érthető üzenettel, ha a súly 999 kg vagy az ismétlés 999 fölött van, és az ismétlést egészre kerekíti. A mező gépeléskor ugyanúgy visszaigazít, mint az RPE. A számítások védve vannak akkor is, ha a kliens hibázik.
- **B — „Biztosan ennyi?" kérdés a valószínűtlen értékre.** Ha a súly például a gyakorlat eddigi legjobbjának kétszerese fölött van, a befejezés megerősítést kér. A 110 → 190-féle elgépelést is megfogja, amit a kemény korlát nem; az A mellé később érdemes.
- **C — Csak a mező igazít vissza.** Gyors, de a szerver védtelen marad: egy régi kliens vagy közvetlen kérés ugyanúgy elrontja a PR-t és a készenlétet.

**Döntés: A** (2026-11-17) · **Kész:** 44ff025

### - [x] A2 — Ellentmondó táplálkozási cél menthető

**KICSI · FUTTATVA** · `PUT /api/nutrition/goal`

500 kcal mellé 400 g fehérjét elfogad, pedig az önmagában 1600 kcal.

**Megoldások**

- **A ★ — Összefüggés-ellenőrzés a szerveren.** Ha a fehérje kalóriája (4 kcal/g) meghaladja a kalóriacélt, 400 jön érthető üzenettel; az űrlap ugyanezt jelzi gépelés közben. Az edző által kitűzött célra is áll.
- **B — Csak figyelmeztetés az űrlapon.** A mentés megy, de egy sor jelzi az ellentmondást. Nem akadályoz, viszont a rossz cél bekerül a készenlét-számításba.
- **C — Alacsonyabb fehérje-plafon.** A felső határ 400 g helyett például 300 g. Egyszerű, de az ellentmondást (500 kcal + 300 g) nem szünteti meg.

**Döntés: A** (2026-11-17) · **Kész:** fc86f72

### - [x] A3 — A meghívó elárulja, létezik-e egy felhasználónév

**KICSI · FUTTATVA** · `POST /api/athletes` (`server/routes/coach.js:363`)

Ismeretlen névre 404 („Nincs ilyen felhasználó"), létezőre 201. Bármely belépett fiók kipróbálhatja, milyen nevek léteznek.

- **Megjegyzés:** a kód megjegyzése szerint ez szándékos (a gépelési hiba azonnal kiderüljön). Döntés kérdése, nem elírás.

**Megoldások**

- **A ★ — Marad a kétféle válasz, saját szűk korláttal.** A meghívás fiókonként például óránként 10 próbát kap. Az elgépelés továbbra is azonnal kiderül, tömegesen próbálgatni viszont nem lehet.
- **B — Marad, ahogy van, és lezárjuk.** A döntés szándékos és dokumentált; az általános írás-korlát már most is fékez. Nulla munka.
- **C — Egyforma válasz mindkét esetre.** „Ha létezik ilyen felhasználó, megkapta a meghívót." Semmi nem szivárog, de az edző nem tudja meg, hogy elgépelte a nevet.

**Döntés: A** (2026-11-17) · **Kész:** 05ebbc5

### - [x] A4 — Edzőváltás után a régi edző megjegyzései megmaradnak

**KÖZEPES · OLVASVA** · `server/db/coaching.js:163-191` (`deleteCoachLink`)

A kapcsolat bontásakor törlődnek az üzenetek, az edző táplálkozási célja, étrendje és víz-célja. A gyakorlat-megjegyzései nem.

- **Következmény:** az új edző a sportoló kártyáján látja a régi edző megjegyzéseit (névvel) és a sportoló neki írt válaszait. A sportoló nem tudja törölni őket, mert megjegyzést csak a szerzője törölhet (`:486`).
- **Nem néztem végig:** a fióktörlés (`deleteUser`) hagy-e hátra ugyanilyet a sportolóknál, ha az edző törli magát.

**Megoldások**

- **A ★ — A bontás az edző megjegyzéseit is viszi.** A `deleteCoachLink` (és a `deleteUser`) törli az edző által erről a sportolóról írt megjegyzéseket, ahogy az üzeneteket és az étrendet is. A sportoló saját megjegyzései maradnak. Egyezik a ház szabályával: bontás után a másik fél nyoma nem marad.
- **B — A megjegyzés marad, de a sportolóé a döntés.** A sportoló a nála lévő bármelyik megjegyzést törölheti, az új edző pedig csak a sajátját és a sportolóét látja. A hasznos technikai tanács nem vész el, de két szabályt kell karbantartani.
- **C — A megjegyzés kapcsolathoz kötése.** Új `link_id` oszlop `CASCADE`-del. Hosszú távon a legtisztább, de séma-változás és a meglévő sorok visszatöltése kell hozzá.

**Döntés: A** (2026-11-17) · **Kész:** 0ea5a9e

### - [x] A5 — A Beállításokban átírt név csak ebben a böngészőben él

**KÖZEPES · OLVASVA** · `public/js/profile/settings.js:152-157`

Az átírt megjelenített név csak a böngésző helyi tárolójába kerül (`prefs` → `displayName`), a szerverre nem. A `PUT /api/user` csak célt, nemet és születési évet fogad.

- **Következmény:** az edző, a sportolók, az üzenetek és egy másik eszköz továbbra is a regisztrációkori nevet mutatja.

**Megoldások**

- **A ★ — A név a szerverre mentődjön.** A `PUT /api/user` fogadja a megjelenített nevet (1–40 karakter), a helyi kulcs megszűnik; ha valakinél van helyben átírt név, az első betöltéskor egyszer felmegy. Mindenhol ugyanaz a név látszik.
- **B — Marad helyi, de kimondjuk.** A mező címkéje „Megszólítás ezen az eszközön", alatta egy sor: az edződ a regisztrációs nevedet látja. Nulla szervermunka, de a név továbbra sem változtatható.
- **C — A mező kikerül a Beállításokból.** A név a regisztrációkor dől el. A félrevezetés megszűnik, a funkció is.

**Döntés: A** (2026-11-17) · **Kész:** 0075a07

---

## 3. Felület és használat

### - [x] F1 — A blokkos programban nincs visszaút

**KÖZEPES · FUTTATVA**

Programnap befejezése után az edzés törlése nem állítja vissza a program mutatóját, és „előző nap" ugrás sincs (csak következő nap / hét / ciklus vége). Véletlen befejezés után a nap elveszett.

**Megoldások**

- **A ★ — „Előző nap" gomb az ugratások mellé.** Kézi visszalépés egy nappal, ugyanazzal a megerősítéssel, mint a többi ugratás; a kártya kiírja, hogy a közben elfogadott TM-változás nem vonódik vissza. A meglévő eszköz tükörképe, kevés új szabály.
- **B — A törlés léptessen vissza.** Ha a törölt edzés a legutóbb befejezett programnap volt, a mutató visszalép, megerősítő kérdéssel. Kényelmes, de a korábbi napok törlésénél és nyitott javaslatnál sok a határeset.
- **C — „Visszavonás" a befejezés után.** Az összegzőn néhány percig egy gomb törli az edzést, visszalép, és a szabály-javaslatot is visszavonja. A véletlen befejezésre a legjobb, de a későbbi meggondolásra nem ad eszközt.

**Döntés: A** (2026-11-17) · **Kész:** e4cdceb

### - [x] F2 — Befejezés után „Mai programnap: <a következő nap>"

**KICSI · FUTTATVA** · `public/js/workout/loading.js:82`

Befejezés után az összegző oldalon megjelenik a „Mai programnap: …" értesítés a *következő* nappal, mert az azonnal betöltődik. A ma elvégzett nap után félrevezető.

**Megoldások**

- **A ★ — Befejezés után más szöveg.** A befejezésből induló betöltés „Következő programnap: …"-ot ír; a „Mai programnap" marad az oldal megnyitására és a napváltásra.
- **B — Befejezés után ne töltődjön be rögtön a következő nap.** Az Edzés oldal „Mára kész ✓ — következő: X · Betöltöm" állapotot mutat. Ez a legőszintébb, de az Áttekintő „Mai edzés" dobozát és a napváltást is érinti.
- **C — Programnál nincs értesítés.** A PROGRAM sáv úgyis kiírja a napot. Legkisebb munka, de az oldal megnyitásakor is elvész a visszajelzés.

**Döntés: A** (2026-11-17) · **Kész:** 6b935ee

### - [x] F3 — Formázatlan link az Áttekintőn

**KICSI · FUTTATVA** · `.db-quote` (a szöveg: `public/js/recovery/recovery-map.js:87`)

A „részletek a Regeneráción" link a böngésző alapszínét kapja: kék, látogatás után lila.

**Megoldások**

- **A ★ — Közös alap a szövegközi linkekre.** A `01-alap.css`-ben a `main a` (és `:visited`) örökli a szöveg színét, aláhúzással és fókusz-jelzéssel. Ma ez az egyetlen formázatlan link, tehát más nem változik — a következő ilyen viszont már nem tud lila lenni.
- **B — Csak ez az egy link.** `.db-quote a` szabály a `02-attekinto.css`-ben. Célzott, de a hiba fajtája megmarad.
- **C — A link kikerül a mondatból.** A készenléti szám már maga is link a Regenerációra; a mondat „részletek a Regeneráción" része sima szöveg lesz. Egy kattintható elemmel kevesebb.

**Döntés: A** (2026-11-17) · **Kész:** 01629b6

### - [x] F4 — Hibás képernyőolvasó-címke a check-in skálán

**KICSI · FUTTATVA** · `public/js/checkin/steps.js:181`

Az 1–5 skálán a 2-es és a 4-es gomb címkéje is „közepes" — az alvás, az energia és a stressz kérdésnél egyaránt.

**Megoldások**

- **A ★ — A köztes gombok csak a számot mondják.** „2 az 5-ből", „3 az 5-ből", „4 az 5-ből"; a két végpont megtartja a szavát. Nem kell új szöveg, és a fordított skálán (stressz) sem állít valótlant.
- **B — Öt saját címke kérdésenként.** Például alvás: nagyon rossz / rossz / közepes / jó / kiváló. A legszebb, de kérdésenként három új szót kell jól megírni.
- **C — „inkább …" a 2-esre és a 4-esre.** „2 — inkább nagyon rossz", „4 — inkább kiváló". Egy sor változás, de a megfogalmazás döcög.

**Döntés: A** (2026-11-17) · **Kész:** bb7ec8d

### - [x] F5 — Apró érintőfelületek telefonon

**KICSI · FUTTATVA** · 390 px széles nézet

| Elem | Méret |
|---|---|
| súly- és mérésnapló törlőgombja | 21×27 px |
| szett-pipa, szett-törlés | 24×24 px |
| szett-típus gomb | 26×26 px |
| „Módosítom" link (napi cél) | 58×15 px |

**Megoldások**

- **A ★ — A meglévő `tap-target` osztály ezekre is.** Az ikon látható mérete marad, a találati terület 44×44 px-re nő. Az elrendezés nem változik, és a megerősítő ablak bezárógombja már így működik.
- **B — Telefonon nagyobb gombok.** Csak keskeny nézetben nő a gomb és a sorköz. Jobban látszik, de a szett-sorok elrendezését újra kell hangolni.
- **C — Törlés a sor menüjéből.** A kis ✕ helyett hosszú nyomás vagy „…" menü. A véletlen törlés ellen a legjobb, de a legnagyobb átalakítás.

**Élő mérés (2026-11-17, 390 px):** a szett-sor pipája és ✕-e **már most** `tap-target` (érintőképernyőn 44, ill. 36 px-es találati terület, középpontjaik 41 px-re — nem érnek össze), az eredeti lelet itt a látható gombot mérte, nem a találati területet. **Valóban apró maradt:** a testsúly- és mérésnapló törlőgombja és a saját megjegyzés törlése (21×27, `tap-target` nélkül), a „Módosítom” és a „Vissza az alapértelmezett célra” link (15 px magas).

**Döntés: A** (2026-11-17) · **Kész:** dee2963

### - [x] F6 — Check-in: „Van, megjelölöm" jelölés nélkül

**KICSI · FUTTATVA**

Izom megjelölése nélkül is tovább lehet lépni; az összegző szó nélkül „Izomláz: Nincs"-et ír.

**Megoldások**

- **A ★ — A gomb felirata mondja ki, mi történik.** Amíg nincs megjelölt izom, a „Tovább" helyén „Mégsincs izomlázam" áll; az első jelölés után vált „Tovább"-ra. Nem akaszt meg, de nem is ír be csendben mást.
- **B — Jelölés nélkül nem lehet továbblépni.** A gomb le van tiltva, alatta: „Jelölj meg legalább egy izmot". Egyértelmű, de aki meggondolta magát, annak vissza kell lépnie.
- **C — Marad.** A mentett adat helyes (nincs jelölt izomláz), csak a visszajelzés hiányzik.

**Döntés: A** (2026-11-17) · **Kész:** 9874d9c

### - [x] F7 — Beégetett „6" az értesítés-jelvényben

**KICSI · FUTTATVA** · `public/index.html` (~260. sor, `data-notif-badge`)

Belépés előtt is látszik a belépőablak mögött, az app vázával együtt.

**Megoldások**

- **A ★ — A jelvény üresen és rejtve induljon.** A HTML-ben nincs szám és `hidden` áll rajta; az értesítések betöltése tölti és mutatja. Két perc munka.
- **B — Belépés előtt az egész váz rejtve.** Az app-váz `inert` és nem látszik, amíg nincs munkamenet. A beégetett „0%" és „Kezdj új edzést" is eltűnik a belépő mögül, és a képernyőolvasó sem jár be a kapu mögé — de az indulási sorrendhez hozzá kell nyúlni.
- **C — Átlátszatlan belépő-háttér.** A váz megmarad, csak nem látszik. A képernyőolvasónak továbbra is ott van.

**Döntés: A** (2026-11-17) · **Kész:** 421dcac

### - [x] F8 — Regisztráció: nincs jelszó-megerősítés és nincs visszaállítás

**TERVEZÉSI HIÁNY · FUTTATVA**

Egyetlen jelszómező van, és jelszó-visszaállítás sincs: egy elgépelés végleg kizár a fiókból.

**Megoldások**

- **A ★ — „Mutasd" gomb a jelszómezőn.** A regisztrációnál és a belépésnél is. Ugyanazt védi, mint a második mező, kevesebb gépeléssel, és a jelszókezelőkkel sem akad össze.
- **B — „Jelszó újra" mező.** A megszokott megoldás; telefonon dupla gépelés.
- **C — Üzemeltetői visszaállítás.** Egy `npm run reset-password <felhasználó>` szkript egyszeri jelszót ad. E-mail nélkül ez az egyetlen kiút annak, aki már kizárta magát; az A mellé érdemes, nem helyette.

**Döntés: A** (2026-11-17) · **Kész:** 54514cd

### - [x] F9 — Az összes testsúly-bejegyzés törlése után a grafikon nem ürül ki

**KICSI · OLVASVA** · `public/js/recovery/weight.js:69`

A kód azt feltételezi, hogy üres naplónál még a kezdő demo-görbe áll a grafikonon. Ha a bejegyzések menet közben fogynak el, a régi oszlopok maradnak újratöltésig.

**Megoldások**

- **A ★ — Üres naplónál üres grafikon.** Az oszlopok törlődnek, és csak az üres-állapot szövege látszik — új fióknál is, a demo-görbe helyett. Sosem mutat olyan adatot, ami nem a felhasználóé.
- **B — A demo-görbe visszarajzolása.** Az utolsó bejegyzés törlése után újra a kezdő görbe áll ott, a „nem a te adatod" sorral. A mostani szándékot állítja helyre.
- **C — Újrakérés a szervertől.** Az utolsó törlés után a grafikonok frissülnek az API-ból. Működik, de plusz kérés egy helyben megoldható dologra.

**Döntés: A** (2026-11-17) · **Kész:** 459324e

---

## 4. Apróságok és megfigyelések

Nem biztos, hogy hibák — itt a „marad" is rendes válasz.

### - [x] M1 — Edző oldal: „Aktív terv —" aktív saját program mellett

„Aktív terv —" és „Terv-követés —" áll, miközben a sportolónak van aktív saját blokkos programja, és ugyanott „Terv szerinti edzés 13/13" látszik. A címke csak az edző által kiosztott tervre érti, de ez nem derül ki.

- **A ★ — Pontosabb címkék.** „Edzői terv" és „Edzői terv követése"; a 13/13 sor „Saját program szerinti edzés" lesz.
- **B — A saját program neve is jelenjen meg.** „Aktív terv: Erő 5/3/1 (saját)". Az edző többet lát, ezért a „Mit lát rólad az edződ?" listát is bővíteni kell.
- **C — Marad.**

**Döntés: A, pontosítva** (2026-11-17) — a kódból kiderült, hogy az „Aktív terv” bármely aktív HETI tervet mutat (a blokkos programot nem), a „Terv szerinti edzés” pedig minden tervből/programból indult edzést számol; csak a terv-követés edzői. A címkék ezért: „Edzői terv-követés”, „Aktív heti terv”, „Tervből indult edzés”. · **Kész:** acfcb6e

### - [x] M2 — „Még kevés az adat" 28 edzés mellett

A kártya („több naplóval pontosabb lesz") akkor is megjelenik, ha csak a mai check-in hiányzik.

- **A ★ — Két külön szöveg.** Hiányzó mai check-innél: „Ma még nincs check-in — a pontszám tájékoztató"; a „kevés adat" csak valóban kevés naplónál.
- **B — Ha csak a mai check-in hiányzik, nincs kártya.** A készenlét melletti „tájékoztató" felirat már jelzi.
- **C — Marad.**

**Döntés: A** (2026-11-17) · **Kész:** 4e6a4c8

### - [x] M3 — Áttekintő check-in nélkül: „Izomláz: Nincs"

Az „Izomláz: Nincs" és a „Fáradtság: Közepes" a modellből jön, az „Alvás" viszont „—". Az izomláznál a „Nincs" bemondott adatnak hat.

- **A ★ — Check-in nélkül az izomláz „—".** A fáradtság marad, mert az tényleg számolt érték.
- **B — Mindkettő marad, „becsült" jelöléssel.**
- **C — Marad.**

**Döntés: A** (2026-11-17) · **Kész:** 3bc1f70

### - [x] M4 — Görgetősáv a megnyitott ablak mögött

Az étel-részletek ablaka mögött látszik az oldal görgetősávja; a háttér görgetése valószínűleg nincs zárolva. Nem próbáltam ki, hogy tényleg görgethető-e.

- **A ★ — Előbb kipróbálni; ha görgethető, közös zár.** A közös ablak-nyitó zárolja a hátteret (`overflow: hidden` + `scrollbar-gutter: stable`, hogy az oldal ne ugorjon).
- **B — `overscroll-behavior: contain` az ablakokon.** A görgetés nem „szökik át" a háttérre; a sáv látszik, de a háttér nem mozdul el véletlenül.
- **C — Marad.**

**Élő próba (2026-11-17, 390 px):** megerősítve — az étel-részletek ablaka mellett a háttér görgethető (görgetés a háttérre: 877 → 1146 px), a `body`/`html` overflow `visible`.

**Döntés: A** (2026-11-17) · **Kész:** dee2963

### - [x] M5 — Az `edzo` bemutató-fiók jelszava

A `server/demo.db`-ben már nem `podium2026` (a másik három fióké igen). Nem app-hiba, de a README szerinti belépés az edzővel nem megy.

- **A ★ — Csak az `edzo` jelszavának visszaállítása.** Egyszeri szkripttel; a bemutató-adat érintetlen marad.
- **B — `npm run seed:demo` újra.** Tiszta bemutató-adatbázis; ami kézzel került bele, elvész.
- **C — Marad**, ha a jelszócsere szándékos volt.

**Döntés: A** (2026-11-17) · **Kész:** a server/demo.db-ben (nincs verziózva, nincs commit; mentés előtte a scratchpadba)

---

## 5. Megjegyzések a kódbázis-átrendezési tervhez

`docs/superpowers/plans/2026-11-12-kodbazis-atrendezes.md` — nem a mai kód hibái, hanem amibe a terv végrehajtása belefutna. Mind a kód alapján ellenőrizve. A megoldások itt a *terv* módosításai.

### - [x] T1 — Néma adatbázis-áthelyezés

**SÚLYOS** · Az 5. feladat a `server/db/connection.js`-t tisztán átköltözteti a `server/core/db/` alá, de a `DEFAULT_DB = path.join(__dirname, '..', 'podium.db')` onnan a `server/core/podium.db`-re mutat. Az `npm start` új, üres adatbázist nyitna. A tesztek és a demó mind `PODIUM_DB`-t állítanak, így semmi nem fogja meg; a `.gitignore` is csak a `server/*.db`-t fedi.

- **A ★ — Közös gyökér-konstans.** Egy modul adja a projekt gyökerét, az adatbázis és a média útvonala abból számol, nem a fájl helyéből. Költöztetés-álló, és a T3-at is megoldja; egy teszt `PODIUM_DB` nélkül ellenőrzi a feloldott útvonalat.
- **B — Az útvonal igazítása a költöztetéssel.** `'..', '..', 'podium.db'`, ugyanazzal a teszttel. Kisebb változás, de a következő költöztetésnél újra eltörik.
- **C — Megállás, ha váratlanul új adatbázis jönne létre.** Indításkor hiba, ha a régi helyen van adatbázis, az újon nincs. Védőháló, nem javítás.

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T2 — Holtpont a 7B feladatnál

**SÚLYOS · FUTTATVA** · A `core/db/index.js` felső szintű `await import()`-tal keresi a funkciókat, miközben a route- és szolgáltatás-modulok a 17. feladatig a `server/db.js` köztes réteget importálják, az pedig a `core/db/index.js`-t exportálja újra. Próbamappában reprodukálva: a Node 13-as kóddal kilép („unsettled top-level await").

- **A ★ — Statikus import-lista.** A funkciók egy kézzel vezetett jegyzékfájlban állnak, felső szintű `await` nélkül. Nincs kör, és a jegyzékből látszik, mi van bekötve.
- **B — Lusta felfedezés.** A keresés egy `init()` függvényben fut, amit a `server.js` hív, nem modul-betöltéskor. A dinamikus felfedezés megmarad, de minden belépési pontnak (tesztek, szkriptek) hívnia kell.
- **C — A feladatok átsorolása.** A köztes réteg megszüntetése (17.) a 7B elé kerül. A kör megszűnik, de a „funkciónként, zölden" haladás elve sérül.

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T3 — Eltörő média-útvonal

A `server/data/catalog.js:133` `MEDIA_ROOT`-ja (`'../../public/exercises/'`) eltörik a 9. feladat költöztetésénél. Ez a demo-dump összehasonlításban kiderülne.

- **A ★ — Ugyanaz a gyökér-konstans, mint a T1-nél.**
- **B — Az útvonal igazítása a költöztetésben,** plusz egy teszt, hogy a `MEDIA_ROOT` létező mappára mutat.
- **C — A média helye beállításból jöjjön** (`PODIUM_MEDIA`). Rugalmas, de új konfiguráció.

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T4 — A `format:check` már most piros

253 fájl bukik (CRLF munkafa, `core.autocrlf=true`); a sorvégeket nem számítva is 54, köztük a két tervdokumentum és a README. A terv minden feladat után tisztát követel.

- **A ★ — 0. feladat: sorvégek és formázás külön commitban.** `.gitattributes` (`* text=auto eol=lf`) és egyszeri `prettier --write`, az átrendezés *előtt*. Utána a `format:check` valódi kapu.
- **B — `endOfLine: "auto"` a Prettier-beállításban,** és a maradék 54 fájl formázása. Kisebb beavatkozás, de a sorvég géptől függő marad.
- **C — A terv csak a változott fájlokat ellenőrizze.** Nem kell nagy formázó commit, de a kapu gyengébb.

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T5 — A `git rm -r Prezentacio/` elakad

A `Podium-bemutato.pptx`-ben nem commitolt változás van, ami — a tervdokumentum „megmarad a történetben" állításával szemben — nincs meg a történetben.

- **A ★ — Előbb commit, utána törlés.** A bemutató mostani állapota bekerül a történetbe, így tényleg visszahozható.
- **B — `git rm --cached`.** A fájl a lemezen marad, a repóból kikerül; a mappa `.gitignore`-ba megy.
- **C — A `Prezentacio/` kimarad a takarításból.**

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T6 — Elavuló alapértékek

A `BASE:public/index.html`, a `demo-base.json` és a 895-ös tesztszám elavul, amint a `blokkos-programok` ág beolvad (amit a terv minden feladat előtt megkövetel).

- **A ★ — Előbb a beolvasztás, utána az alapértékek egyszeri frissítése.** A terv elejére kerül egy lépés: az alapértékek újrafelvétele a beolvasztott `main`-ről.
- **B — A terv ne rögzítsen számot.** Minden feladat elején „alapérték felvétele" lépés fut. Sosem avul el, de feladatonként plusz munka.
- **C — Kézi igazítás feladatonként.**

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T7 — A tervdokumentum és a végrehajtási terv ellentmond

A tervdokumentum (T10) szerint „nincs központi újraexportálás", a tesztek közvetlenül a funkció-modulokat importálják; a végrehajtási terv 17. feladata a teszteket és a seedet az `allData()`-n át vezeti.

- **A ★ — A tervdokumentum az irányadó.** Közvetlen import mindenhol; az `allData()` kikerül a 17. feladatból.
- **B — `allData()` csak a seednek.** A tesztek közvetlenül importálnak, a seed kap egy kényelmi belépőt. Kompromisszum, de mégis egy központi pont.
- **C — A végrehajtási terv az irányadó,** a tervdokumentum pontja átíródik.

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T8 — Kétértelmű ellenőrzés a 17. feladatban

A `grep "db\.js"` minden funkció saját `db.js`-ére is illik, nem csak a köztes rétegre.

- **A ★ — Lint-szabály a köztes rétegre.** `no-restricted-imports` tiltja a `server/db.js` importját; a 17. feladat kapuja a zöld lint. Később sem tud visszaszivárogni.
- **B — Pontosabb minta.** A köztes réteg teljes útvonalára keres. Egyszeri ellenőrzésnek elég.
- **C — A köztes réteg átnevezése** egyedi névre (`db-shim.js`) már a 7. feladatban.

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T9 — Az ESLint-lazítás nem követi a teszteket

Az `eslint.config.js` csak a `tests/**`-ra lazít; a `server/features/**` alá költöző tesztek elveszítik.

- **A ★ — A minta bővítése az első költöző teszttel együtt.** `['tests/**', 'server/**/*.test.js']`.
- **B — A tesztek maradnak a `tests/` alatt,** tükrözött mappaszerkezettel.
- **C — A lazítás megszüntetése:** a tesztek feleljenek meg a fő szabályoknak.

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T10 — Kiszélesedő export-ellenőrzés

A `check-exports.js` kihagyja a `server/data/`-t; a 9. feladatban onnan kiköltöző három fájlra ráhúzódik az ellenőrzés.

- **A ★ — A három fájl exportjainak rendbetétele a költöztetés előtt.** A 9. feladat elé kerül egy lépés: az ellenőrzés lefut rájuk, a nem használt exportok kikerülnek.
- **B — A kihagyási lista bővítése** az új helyekre.
- **C — Az ellenőrzés szüneteltetése** az átrendezés idejére.

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

### - [x] T11 — Gazdátlan elemek

A 20. feladat négy ablakot nem oszt ki (`videoModal`, `prModal`, `settingsModal`, `customFoodModal`), és a `createIndexes` `DROP INDEX IF EXISTS idx_nutrition_log_date` sora sincs funkcióhoz rendelve.

- **A ★ — Kiosztás a tervben, ellenőrző lépéssel.** A videó- és a PR-ablak az edzéshez, a beállítások a profilhoz, a saját étel a táplálkozáshoz, a `DROP INDEX` a táplálkozás migrációjához; a feladat végén egy keresés igazolja, hogy az `index.html` minden ablaka gazdára talált.
- **B — Közös „megosztott ablakok" hely** a több funkcióból nyitott ablakoknak.
- **C — Marad az `index.html`-ben,** ami nem egyértelmű.

**Döntés: A** (2026-11-17) · **Kész:** de8d7b1

---

## 6. Ütközés-vizsgálat és javítási sorrend (2026-11-17)

A 40 döntés (mind **A**) egymás mellé téve. Valódi ütközés **egy helyen** van (P3–P4–P5), két döntés pedig csak egy kiegészítéssel működik helyesen (P4, F1). A többi vagy független, vagy csak ugyanazt a fájlt érinti.

### Ütközés: P3 + P4 + P5 — ugyanaz a folyamat, csak együtt jó

A szerver az Edzés oldal sablonjánál az **aznapi piszkozatot előbb adja**, mint a program állapotát (`session-plan.js` → `workoutTemplate`). Ebből három dolog következik:

1. **P4 csak kliensoldalon nem elég.** Ha a felhasználó már kipipált egy szettet (van mai piszkozat), az ugratás vagy a kikapcsolás után a szerver *a piszkozatot* adja vissza, nem az értékelő kártyát — a kliens ürítése így el sem indul, a régi nap ott marad.
2. **P5 rossz napot írna ki.** Ugratás után a piszkozat még a régi N. nap, a program mutatója viszont már előrébb jár: ha a P5 a *mostani* pozíciót teszi a piszkozat mellé, a sáv rossz napot mutat.
3. **P3 a piszkozatra épít.** A 409 után a kliensnek a piszkozatot *meg kell tartania*, és a javaslat-kártyát meg kell mutatnia; ha a P4 ürítése erre az útra is lefutna, a kipipált szettek elvesznének.

**Feloldás (a választott A-k szerint, kiegészítéssel):**

- **P4 kiegészítés:** az ugratás és a program kikapcsolása a **szerveren is** törli a programhoz tartozó mai piszkozatot (`planId` = a program), nem csak a kliens üríti a szerkesztőt. Így a 2. pont sem fordulhat elő: ha van piszkozat, az mindig a mostani pozíció napja.
- **P5 kiegészítés:** a piszkozat mellé a program-adat *és* a nyitott javaslat (`mid`) is jön, a forrás pedig megmarad „piszkozatnak". A P4 ürítése csak a gyakorlat nélküli sablonokra (értékelő kártya, javaslat-kártya, üres) fut — a P3 útja (piszkozat + kártya) így érintetlen.
- **Sorrend:** P5 → P3 → P4 → F2, egy menetben, mert mind a `loading.js` / `applyTemplate` körül mozog.

### Kiegészítés kell: F1 „Előző nap"

A programnap mentéskor megjelölődik (`tagProgramWorkout`: ciklus + pozíció), és a ciklus-szabályok a megjelölt edzésekből számolnak (`getCycleWorkouts`). Ha a visszalépés után a napot újra elvégzed, **ugyanarra a pozícióra két edzés kerül**, és a ciklus statisztikái (teljesített/összes szett) duplán számolnak.

- **Feloldás:** a visszalépés levéli a jelölést (pozíció → üres) a régi edzésről, maga az edzés a naplóban marad. Nyitott javaslatnál és jóváhagyásra váró ciklusnál a visszalépés tiltott (mint az ugratás), és ciklushatáron át nem lehet visszalépni.

### Kockázat, ha nem figyelünk — nem ütközés, de felboríthat dolgokat

| Tétel | Mire kell figyelni |
|---|---|
| **F3** közös link-stílus | A fő tartalomban 10 link van, ebből 9 gombnak van formázva (`co-ghost-btn` stb.). Egy sima `main a` szabály mind a 9-et aláhúzná és átszínezné. → A szabály csak az **osztály nélküli** linkekre szóljon (`:where(main a:not([class]))`); ez ma a Regeneráció-link és a gyakorlat-média forrásmegjelölése. |
| **F5** nagyobb találati terület | A CSS maga figyelmeztet: a szett-sorban a pipa és a ✕ egymás mellett ül, egymásba érő találati terület esetén **a törlés elnyeli a pipát** (visszavonhatatlan). → Soronként hangolni kell a méretet, hogy a felületek ne érjenek össze. |
| **F9** üres grafikon | Az Áttekintő induláskor a szerver demo-testsúlygörbéjét is kirajzolja (`server/data.js` → `bodyWeight`). Ha csak a Regeneráció oldalt javítjuk, újratöltés után visszajön. → A demo-görbét a szerverről is ki kell venni. Új fióknál üres lesz a grafikon — ez a szándék. |
| **A1** felső korlát | (1) Az automatikus mentés is ugyanazt az ellenőrzést használja: ha a mező nem igazít vissza, gépelés közben minden billentyűre hibaüzenet jönne → a mező-igazítás **ugyanabban a commitban** menjen. (2) A régi szöveges értékek („12 rep") továbbra is érvényesek maradjanak. (3) Ha egy meglévő edzésben már 999 fölötti érték van, annak javítása elakad — az éles adatbázison előtte egy lekérdezés megmondja, van-e ilyen. |
| **P6** + **P9** névkorlátok | Két külön korlát marad: a **gyakorlatnév 80**, az **edzésnév 60**. Ha a P6 egyetlen közös „NAME_MAX"-ot csinál, a P9 ellenőrzése rossz számhoz mér. A már csonkolva mentett nevek csonkák maradnak; a P1 miatt ezekre a szabály ezentúl nem javasol semmit (helyes, de érdemes tudni). |
| **A5** név a szerveren | A Beállításokban a név **gépelés közben** érvényesül; szerverre mentve ez billentyűnként egy kérés lenne → mentés a mező elhagyásakor (vagy késleltetve). |
| **A2** tápcél-ellenőrzés | A meglévő, ellentmondó célok az adatbázisban maradnak, amíg valaki nem szerkeszti őket; az edző által kitűzött célra is áll. Az űrlapnak meg kell mondania, *miért* nem menthető (különben csak a kalóriát átíró felhasználó nem érti). |
| **P1** kihagyás | A fájdalom- vagy készenlét-alapú szabály sem hat a nem edzett gyakorlatra — ez a döntés velejárója, nem hiba. |

### Ugyanazt a fájlt érintik — egymás után, nem párhuzamosan

| Fájl | Tételek |
|---|---|
| `public/js/workout/loading.js` | P4, P5, F2 |
| `public/js/workout/set-controls.js` | P2, A1 |
| `server/validation/workout-body.js` | A1, P6, P9 |
| `server/services/program-run.js` | P3, P4, F1 |
| `public/js/program/program-builder.js`, `rule-editor.js` | P8, P10 (a program-kontextus betöltése közös) |
| `public/js/checkin/steps.js` | F4, F6 |
| `server/db/coaching.js`, `server/db/accounts.js` | A4 |

### Javasolt sorrend

1. **A1** — felső korlát (szerver + mező együtt)
2. **P6, P7, P9** — a mentési korlátok egy helyre
3. **P1, P2** — a szabályok bemenete
4. **P5 → P3 → P4 → F2** — a programnap betöltése és mentése, egy menetben
5. **F1** — „Előző nap", a jelölés levételével
6. **P8 + P10** — a programozó kontextusa
7. **A4, A5, A2, A3** — edző, név, tápcél, meghívó
8. **F3–F9, M1–M5** — felület és apróságok
9. **Az átrendezési terv (T1–T11) csak ezek után:** a javítások a `blokkos-programok` ágon készülnek el, utána jön a beolvasztás (T6), a tervbe a T-döntések beírása, és a terv **0. feladata** a formázó commit (T4). Fordított sorrendben a formázó commit és a költöztetés minden javítást ütközésbe vinne.

## 7. Ami kimaradt

**Élő bejárás nélkül maradt**

- edzői nézetek (az M5 miatt nem tudtam belépni)
- terv-építő és a programozó felülete
- vonalkód-olvasó
- beállítások, értesítések, üzenetek

**A kódátvizsgálás nem olvasta**

- `server/recovery.js`, `training-load.js`, `coaching.js`, `suggestions.js`
- `server/db/{nutrition,accounts,body}.js`
- `scripts/seed-demo.js`
- a nem programhoz tartozó frontend nagy része, és a `public/js/program/formula-window.js`

**Végig átolvasva, új hiba nélkül vagy a fenti tételekkel**

- `server/routes/coach.js`, `routes/auth.js`, `http/access.js` (ebből jött az A4 és az A5)
- részben: `server/db/coaching.js`, `public/js/shared/api.js`

**Bejárva, hibát nem találtam**

- belépés és regisztráció (névszabályok, foglalt név, kis- és nagybetű)
- az új fiók üres állapotai mind a hét oldalon; a HTML-t tartalmazó megjelenített név szövegként jelenik meg
- ételnaplózás és vízbevitel határértékei (a szerver elutasítja a 0, a negatív és a túl nagy adagot)
- a check-in varázsló végig, mentéssel
- üres edzés befejezése (figyelmeztet), kipipált szett nélküli befejezés (megerősítést kér)
- vízszintes túlcsordulás asztali és telefonos szélességen egyik oldalon sincs
