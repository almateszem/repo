# FitTrack Pro

Edző–kliens edzésmenedzsment demo: edzésnapló, tervkészítő, táplálkozás-követés
és edzői panel. Egyetlen Express szerver szolgálja ki a statikus frontendet és a
REST API-t, az adat SQLite-ban perzisztál.

## Indítás

Node **22.5 vagy újabb** kell hozzá — a beépített `node:sqlite` modult használjuk,
ami ettől a verziótól érhető el.

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # ugyanaz, fájlfigyeléssel (node --watch)
npm test           # a Recovery Engine unit-tesztjei (node --test, nulla függőség)
```

Környezeti változók:

| Változó | Alapérték | Mire jó |
| --- | --- | --- |
| `PORT` | `3000` | A szerver portja |
| `FITTRACK_DB` | `server/fittrack.db` | Az adatbázisfájl útvonala — **teszthez érdemes eldobható fájlra állítani**, hogy a valódi adat ne sérüljön |

```bash
# Kísérletezés külön adatbázison, az éles adat érintése nélkül
PORT=3999 FITTRACK_DB=/tmp/proba.db npm start
```

## Felépítés

```
public/          statikus frontend (a szerver innen szolgálja ki)
  index.html     az összes oldal + a listaelemek <template> sablonjai
  script.js      teljes frontend logika (api réteg → renderelők → interakciók)
  style.css      dizájn-tokenek és komponensstílusok
server/
  server.js      Express: /api/* végpontok + a public/ kiszolgálása
  db.js          SQLite adatréteg — az egyetlen modul, ami a tárolást ismeri
  data.js        seed / referencia-adat (ételek, gyakorlat-katalógus, sportolók)
  recovery.js    Recovery Engine — a készenlét-számítás (tiszta függvények, DB nélkül)
  recovery.test.js  a motor unit-tesztjei (npm test)
  muscles.js     izomcsoport-taxonómia + gyakorlat → izom leképezés
  fittrack.db    az adatbázisfájl (nem verziókövetett, a szerver hozza létre)
```

Az adat kétféle: a `collections` táblában a **csak olvasható** referencia-adat,
amit a szerver minden induláskor a `data.js`-ből szinkronizál (tehát a `data.js`
az egyetlen szerkesztési hely), illetve a **felhasználói adat** saját táblákban
(`weight_log`, `nutrition_log`, `workouts`, `plans`, `workout_draft`) — ezeket a
seed nem írja felül.

## Amit tudni érdemes

- **Automatikus mentés.** Az edzésnapló minden változtatása fél másodperc múlva
  piszkozatként a szerverre mentődik, így újratöltés után is megmarad. Az
  edzésnév alatti sor mutatja az állapotot (*Mentés… / Mentve · 18:42 / nem
  sikerült*); hiba esetén 3, 8 és 20 másodperc múlva automatikusan újrapróbálja,
  és csak utána adja fel — a felhasználó soha nem hiszi tévesen mentettnek a
  naplót.
- **Táplálkozás — mai napló.** A bevitt tételek listája a napi összesítő alatt
  látszik, bármelyik egy koppintással törölhető. Csak az aznapi bejegyzés
  módosítható: a korábbi napok összesítői már beépültek a készenlét-számításba.
- **Megerősítés adatvesztés előtt.** Ha egy terv betöltése megkezdett edzést
  írna felül, vagy egy teljesített szetteket tartalmazó gyakorlatot vennél ki,
  az app rákérdez (saját modállal, nem natív `confirm`-mal).
- **Az „Edzés befejezése" lezárja az edzést**: a napló bekerül a Korábbi
  edzésekhez, a piszkozat törlődik, az Edzés oldal pedig üresen áll készen a
  következőre. Ugyanaznap így nyugodtan kezdhető második edzés is.
- **Napra ütemezett tervek.** A tervkészítőben kijelölt hétnapokon az adott terv
  automatikusan betöltődik az Edzés oldalra — de egy már megkezdett edzést soha
  nem ír felül.
- **Szett-értékek.** Az ismétlés, a súly (kg) és az RPE szám; a mértékegység a
  táblázat fejlécében van. A régebbi, mértékegységgel együtt tárolt értékeket
  (`"12 rep"`, `"60% TM"`) a szerver induláskor egyszer átalakítja számokká.
- **Migrációk.** A séma bővítései a `db.js` `ensureColumn` hívásaival futnak le a
  meglévő adatbázisfájlokon is, tehát nem kell törölni a `fittrack.db`-t.

## Recovery Engine — a készenléti állapot

A Regeneráció oldal (`#recovery`) a napi check-inből és az edzésnaplóból számol
egy 0–100-as készenléti pontszámot, és ebből konkrét edzésdöntéseket vezet le.
A számítás teljes egészében a `server/recovery.js`-ben van, amely **nem ismeri az
adatbázist** — mindent paraméterként kap, ezért unit-tesztelhető (`npm test`).

**A képlet** súlyozott átlag, de csak a *jelen lévő* komponensekre:

| Komponens | Súly | Miből |
| --- | --- | --- |
| Alvás | 0.25 | időtartam (trapéz-görbe) + minőség, 3 napos alvásadósság-levonással |
| Izom-regeneráció | 0.15 | a kilenc izomcsoport „soft-min" átlaga |
| Energiaszint | 0.15 | check-in, 1–5 |
| Stressz-regeneráció | 0.10 | check-in, 1–5 (fordítva) |
| Edzésterhelés | 0.15 | exponenciálisan csillapított tonnatömeg (τ = 3 nap) |
| Táplálkozás | 0.05 | a **tegnapi** kalória/fehérje a célhoz mérve + hidratáció |

Ami nincs kitöltve, az nem nullaként számít bele: a súlya arányosan újraoszlik a
többi komponens között. Ezért **hiányzó adattól a pontszám nem torzul**, csak a
megbízhatósága csökken — amit a felület külön kiír.

**HRV/pulzus szándékosan nincs a képletben.** Az eredeti terv 0.15-öt szánt rá,
de az alkalmazásnak nincs pulzusadat-forrása (nincs okosóra-integráció), kitalált
értéket pedig nem teszünk a képletbe. A súlya ugyanazzal a mechanizmussal oszlik
szét, mint bármelyik ki nem töltött mezőé.

**Amit még számol:**

- **Izomcsoportonkénti regeneráció** kilenc csoportra. A károsodás mérőszáma nem
  a tonnatömeg, hanem a bukáshoz közeli szettek száma — a tonnatömeg lokálisan
  félrevezet (egy nehéz 5×5 guggolás kevesebb tonnát ad, mint egy könnyű,
  sok ismétléses lábtolás, miközben sokkal jobban lever). A csillapítás
  csoportonként eltér: kis izmok τ = 1.5 nap, nagy tolók/húzók 2.2, a
  hamstring/farizom/törzs 3.0 nap.
- **CNS-becslés**: az axiális összetett emelések, a magas RPE-s szettek és a
  PR-próbálkozások költsége, lassabb csillapítással (τ = 3.5 nap), az alvással
  szorozva.
- **Gyakorlat-specifikus ajánlás**: izom-readiness + CNS + frissesség alapján
  konkrét súly- és volumen-javaslat (a fő emelésekhez egyetlen naplózott alkalom
  is elég, a többihez három kell).
- **Sapkák**: 7/10 feletti fájdalom letiltja az érintett izmot terhelő
  gyakorlatokat, és a teljes pontszámot is korlátozza — ezt egy súlyozott átlag
  elmosná.

**Adatigény.** Ami nem számolható, az nem jelenik meg kitalált számként. A
személyre szabott (saját előzményhez mért) referenciához 14 nap edzés-előzmény és
7 check-in kell; addig testsúlyra skálázott általános referenciával fut, és a
felület `Tájékoztató` / `Közepes` / `Megbízható` jelzéssel kiírja, mire épül a szám.

## Felület — akadálymentesség és érintés

A frontend néhány szabályt szándékosan tokenszinten tart be, hogy ne
komponensenként kelljen újratárgyalni:

- **Kontraszt.** A halvány szövegrétegek (`--text-muted`, `--text-faint`) a
  `--c-bg` háttéren 5,3:1 és 6,3:1 — mindkettő WCAG AA fölött. Az ennél
  halványabb fehér-alfák (`--fg-40` és lejjebb) **csak keretre és díszítésre**
  használhatók, szövegre nem.
- **Beviteli mezők betűmérete.** Minden `input` legalább `--fs-input` (16px):
  ez alatt az iOS Safari fókuszkor ráközelít a lapra, és nem nagyít vissza.
- **Érintési célterület.** A kis ikongombok a `.tap-target` osztályt kapják: egy
  láthatatlan pszeudoelem 44×44px-re tágítja a találati felületet a vizuális
  méret változtatása nélkül. Ahol két gomb közel ül, a `--tap` egyedileg
  szűkíthető, hogy a felületek ne fedjenek át (lásd a szett-sor pipa/✕ párosát).
- **Fókusz.** A `:focus-visible` keret minden interaktív elemen látszik; a
  szövegmezők csak egérrel/érintéssel veszítik el (`:not(:focus-visible)`).
- **Oldalváltás.** A router görgetést és fókuszt is átvisz az új oldal
  címsorára. Ismeretlen hash (skip link, horgony) **nem** okoz oldalváltást.

## Korlátok (demo)

Ezek szándékos egyszerűsítések, nem hibák:

- **Nincs hitelesítés, és egyetlen felhasználó van.** Aki eléri a szervert, az
  ugyanazt az adatot látja és írja — lokális futtatásra készült.
- **A dátumot a szerver helyi ideje adja.** Ha a szerver és a böngésző más
  időzónában van, a „mai nap" elcsúszhat.
- **Nincs pulzus/HRV adatforrás.** Nincs okosóra-integráció, ezért a Recovery
  Engine hat komponensből számol, nem hétből (lásd fentebb).
- **Az edzői panel sportolói demo-adatok** — az ő `readiness` értékük fix szám a
  `data.js`-ben, nem a Recovery Engine számolja (nincs mögöttük edzésnapló). A
  saját készenlét, a regenerációs sorok, a sorozat, a napi kalória/fehérje és a
  heti volumen viszont mind a tényleges adatból számolódik.
- **Az edző-chat válaszai szimuláltak**, előre megírt sorokból forognak körbe.
