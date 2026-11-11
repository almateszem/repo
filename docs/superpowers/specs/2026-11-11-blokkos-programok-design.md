# Blokkos, automatikusan progresszáló edzésprogramok — terv

2026-11-11 · első szakasz: „az 5/3/1-em blokkokból, magamnak”

## 1. Miért

Viktor 5/3/1-alapú programmal edz (és edzőként tervez), amit a saját igényeire
módosított: a szokásos három hét mellé egy negyedik, saját százalékokkal
dolgozó hetet tett. Ehhez minden ciklusban kézzel kell kiszámolni a training
maxokat (TM), és minden héten minden fő gyakorlatra a százalékokból a
súlyokat. Ezt a számolgatást kell az appnak átvennie.

Nem egy beégetett 5/3/1-kalkulátor a cél, hanem egy **általános, blokkokból
összerakható programozó**, Scratch-szerű gondolkodással, laikusnak is
érthetően. Így más százalékalapú vagy szabályalapú programok is leírhatók
vele. A blokkokat egymásba lehet ágyazni, és egy szett súlya is blokkokból
számolódik.

**Siker:** Viktor a saját módosított 5/3/1-ét összerakja a programozó oldalon,
aktiválja, és onnantól a mai edzésben kész, kerekített kg-okat lát. A 4. heti
1RM-próbák után az app a saját szabálya szerint új TM-et javasol: rekordnál
az új 1RM 95%-át, egyébként +2,5 vagy +5 kg-ot. A következő ciklus már a
jóváhagyott TM-mel számol. Kézi számolás nincs.

## 2. Fogalmak

- **TM (training max):** gyakorlatonkénti munka-maximum, amiből a százalékok
  számolódnak. Nem azonos az 1RM-mel.
- **AMRAP-szett:** „ahány ismétlés csak megy”. A program minimumot ír elő
  (pl. `5+`), a sportoló a ténylegesen elvégzett számot rögzíti.
- **Ciklus:** a program ismétlődő egysége, például 4 hét. A ciklus végén
  futnak a szabályok, utána a ciklus elölről indul.
- **Képlet:** egy szett súlyát adó, blokkokból álló számítás, pl. `85% × TM`.
- **Blokkos program:** az új tervfajta. A mai **egyszerű terv** (1–14 napos,
  naptár szerint forgó ciklus) változatlanul megmarad mellette.

## 3. Hatókör

### Az első szakasz célja

1. Új tervfajta: **blokkos program**, külön **programozó oldalon** szerkesztve.
2. A program szerkezete blokkokból áll: ciklus → hét → nap → gyakorlat → szett,
   plusz a ciklus végén futó szabályok.
3. A szett súlya **képlet**: szám, százalék, TM, egy gyakorlat 1RM-je,
   testsúly, továbbá ×, +, − műveletek, egymásba ágyazva.
4. **AMRAP-szett** jelölése és az elvégzett ismétlés rögzítése a naplóban.
5. **TM-kezelés** gyakorlatonként, előzményekkel. Indulóérték-javaslat az
   1RM-ből.
6. **Szabály-blokkok** (HA / AKKOR / KÜLÖNBEN) a ciklus végére. Ezek
   TM-*javaslatot* adnak, amit a felhasználó jóváhagy vagy átír.
7. **Haladás az elvégzett edzések szerint**, nem a naptár szerint, kérésre
   ugratással.
8. A **mai edzés** (Edzés oldal) a program következő napját tölti be kész,
   kerekített kg-okkal.

Az első szakaszban a program csak **saját használatra** készül: az a
felhasználó futtatja, aki megírta.

### Nem része az első szakasznak (későbbi szakaszok, lásd 9. pont)

- kiosztás sportolóknak (sablon, sportolónkénti TM, edzői jóváhagyás);
- elnevezett, újrahasználható **saját képletek** (a demóban már működött, de
  később jön);
- élő előnézet több sportolóra;
- a programszerkezet szerkesztése a sportoló részéről.

### Anti-célok: ha ezek bármelyike igaz, a funkció kudarc, még ha működik is

- **Láthatatlan logika.** Ha a programot ránézésre nem lehet megérteni (mi mibe
  tartozik, honnan jön egy súly, mikor fut egy szabály), akkor elbukott. Ez
  volt a fő kifogás az első, „chipek egymás alatt” mintánál.
- **Az app magától írja át a TM-et.** Az app csak javasol, a döntés mindig az
  emberé.
- **Elcsúszó program.** Ha valaki kihagy egy hetet, a program nem ugorhat át
  magától edzéseket.
- **Az egyszerű terv bonyolódik.** Akinek nem kell a blokkos programozás, annak
  semmi nem változik.
- **Utólag átírt napló.** A program módosítása nem írhat át már elvégzett
  edzést.

## 4. A programozó oldal (a felhasználó döntései)

### 4.1 Megjelenés: Notion-szerű sorszerkesztő

Ez a választott „8-as” stílus, a Podium sötét témájában (`public/css/01-alap.css`
tokenek, bordó kiemelés, monospace nagybetűs címkék).

- **Minden sor egy blokk.** Bal oldalt `⋮⋮` fogantyú az áthúzáshoz, mellette a
  blokk fajtája monospace címkével és a fajta színével, utána a tartalma.
- A beágyazást **vékony függőleges segédvonal** és beljebb kezdés mutatja.
- Új blokk a sor végi **„+”** gombbal vagy a palettából **húzással** adható
  hozzá. **Gépelős bevitel nincs.** A „/” blokkmenü és a képletek begépelése
  is kimarad, ezt Viktor kifejezetten kérte.
- A **becsukott hét** egy sorban összefoglalja a tartalmát (pl.
  `▸ 70 / 80 / 90%`), így egy hosszú program is elfér.
- Az **AMRAP-szett** bordó kiemelést kap.
- **Élő előnézet:** a szettek mellett a saját TM-ből számolt, kerekített kg
  látszik. Ha egy érték hiányzik, a hiány neve jelenik meg, pl. „nincs TM:
  Elöl guggolás”.

Vizuális referencia (a brainstorming látványtervei, nincsenek verziókövetve):
`.superpowers/brainstorm/1569-1794389556/content/stilus-valtozatok-2.html`
(8-as változat) és `kepletkeszito-demo.html`.

### 4.2 Blokkfajták

| Blokk | Tartalmaz | Beállítások |
|---|---|---|
| Ciklus | hetek | név |
| Hét | napok | címke (pl. „4. hét – saját”) |
| Nap | gyakorlatok | név (nem kötelező); sorszámot kap, nem hétnapot |
| Gyakorlat | szettek | a meglévő gyakorlat-katalógusból választva; fő vagy kiegészítő |
| Szett | – | darabszám (pl. 5 szett), ismétlés, AMRAP-e, **súlyképlet** vagy „a napon döntöd el” |

**Minden nap a saját fő és kiegészítő gyakorlatait kapja** (Viktor döntése).
Nincs hétszintű, közös séma. Hogy ne kelljen ugyanazt négyszer beírni, egy
nap és egy hét is **duplikálható** (saját döntés).

**A „napon döntöd el” súly** az 1RM-próbákhoz kell: ilyenkor a program nem
számol súlyt, a felhasználó edzés közben írja be, amit megpróbál (saját
döntés).
| Szabály | ágak | lásd 4.4 |

### 4.3 Súlyképlet: blokkok a súly helyén

A súly helyére Scratch-féle, kerekített „riporter” blokkok kerülnek, amelyek
egymásba ágyazhatók. Ugyanaz a képlet két nézetben látszik:

- **A sorban (alapnézet):** a riporter-blokkok jól láthatóan, pl.
  `[85%] × [TM]`, `[60%] × [1RM: Guggolás]`. A szín jelzi a fajtát: a szám
  szürke, a változó sárga, a művelet zöld.
- **Képletkészítő ablak:** a sorbeli képletre kattintva nyílik egy kis ablak. Ebben
  van a vászon a hely-foglalókkal, a paletta és az eredmény. A blokk húzással
  vagy „hely kijelölése → blokkra kattintás” módon kerül a helyére (ez utóbbi
  érintőképernyőn is működik). Ha egy műveletet egy meglévő értékre húzol, az
  körbeöleli az értéket (Scratch-viselkedés). A hely-foglaló mellett `×` vesz
  ki egy blokkot.

Értékek és műveletek az első szakaszban:

- **szám** (`20`) és **százalék** (`85%`);
- **TM:** mindig *annak a gyakorlatnak* a TM-je, amelyik sorában a képlet áll;
- **1RM: [gyakorlat ▾]:** egy választott gyakorlat 1RM-je. Az „ez a
  gyakorlat” is választható. Így számolhat az elöl guggolás a guggolás
  1RM-jéből;
- **testsúly;**
- **műveletek:** `×`, `+`, `−`.

A végeredmény **2,5 kg-ra kerekedik**.

### 4.4 Szabály-blokkok

A szabály a ciklus végén fut, és **gyakorlatonként** dönt: minden olyan
gyakorlatra, amelyiknek van TM-je a programban. Felépítése:

```
HA [érték] [összehasonlítás] [érték]
  AKKOR  javasolj TM-et: [változtatás]
  KÜLÖNBEN  javasolj TM-et: [változtatás]
```

A feltétel elemei legördülő menükből rakhatók össze, így nem lehet hibás
szabályt írni.

**Viktor tényleges szabálya.** Ezt az első szakasznak tudnia kell. A 4. hét
az 1RM-próbák hete, és a végén történik az újraszámolás:

```
HA volt új 1RM-rekord a próbán
  AKKOR  TM = új 1RM × 95%
  KÜLÖNBEN  TM + [2,5 vagy 5 kg, gyakorlattól függően]
```

Ehhez a szabályokban ezek az elemek kellenek:

- **Feltételek:** „volt új 1RM-rekord a próbán” (lásd 7/6), és általános
  összehasonlítás (`<`, `≤`, `=`, `≥`, `>`) két érték között. Értékként
  szóba jön az AMRAP-ismétlés, az előírt ismétlés vagy egy szám.
- **Változtatások:** `TM + x kg`, `TM − x kg`, `TM ± x%`, valamint
  `TM = képlet`, ahol a képlet ugyanazokból a blokkokból áll, mint a
  súlyképlet, kiegészítve az **„új 1RM”** értékkel.
- **Gyakorlatonkénti lépésköz:** a `+ x kg` gyakorlatonként megadható (lásd
  7/7).

A ciklus végi javaslat az AMRAP-alapú szabályokkal is működik. A korábban
emlegetett „AMRAP < 5 → −10%” csak példa volt, nem Viktor programja.

## 5. Futtatás: haladás, mai edzés, ciklus vége (a felhasználó döntései)

- **A haladás az elvégzett edzésekhez igazodik.** A program a napok sorozata
  (C1 · 1. hét · 1. nap, C1 · 1. hét · 2. nap …). A mai edzés mindig a
  **következő elvégzetlen nap**. Ha valaki egy hétre kiesik, ott folytatja,
  ahol abbahagyta.
- **Ugratás kérésre:** egy nap, egy hét, vagy ugrás a ciklus végére.
- **Mai edzés:** a mostani Edzés oldal a következő programnapot tölti be, kész
  kg-okkal. A felhasználó **átírhatja a ténylegesen elvégzett súlyt és
  ismétlést**, ahogy most is. A program ettől nem változik.
- **A ciklus végén** az app gyakorlatonként TM-javaslatot ad, a szabály
  alapján. A javaslat megmondja az okát is (pl. „AMRAP: 3 ism. < 5 → −10%”).
  A felhasználó **jóváhagyja vagy átírja**, utána indul a következő ciklus az
  új TM-mel.
- A szabály mindig a **ténylegesen rögzített** adatokból dolgozik (az
  AMRAP-ismétlésből és az 1RM-próba súlyából), nem az előírtakból.

## 6. Kötöttségek a mostani kódból

- **Stack:** Express + `node:sqlite`, vanilla ES-modulos kliens, keretrendszer
  nélkül, `node --test`. Az új kód ugyanígy épüljön: a számítás tiszta
  függvényekben, külön tesztelve. A szerver számol, a kliens legfeljebb
  tükrözi a számítást, mint a `server/plan-week.js` ↔
  `public/js/shared/plan-week.js` párnál.
- **Az egyszerű terv** (`plans` tábla, `week` JSON, `cycleDay` a naptárból,
  1–14 nap) **nem változhat**. Ennek a naptár szerinti forgása épp ellentétes
  az új „várja meg” logikával, ezért a blokkos program saját haladás-állapotot
  kap.
- **Egyszerre egy aktív terv** van felhasználónként (`plans.active`). Ez
  bármelyik fajtára vonatkozik: aktív blokkos programnál a
  `workoutTemplate` (`server/services/session-plan.js`) a program következő
  napját adja. A mai piszkozat elsőbbsége megmarad.
- **Szett-alak:** `{ reps, weight, rpe, type, done }`, típusai: `warmup`,
  `work`, `drop` (`server/validation/workout-body.js`). A betöltött programnap
  ugyanilyen alakú szettekké fordul, fix kg-okkal. A mai napló tehát
  változatlanul működik, a PR-követéssel és a készenléti átnézéssel együtt.
- **1RM:** az `exercise_maxes` táblából jön.
- **Készenléti átnézés** (`server/session-advice.js`): a programnapra is fusson
  úgy, mint most, vagyis jelöljön, de ne írja át a tervet.
- **Migrációk:** a `PRAGMA user_version` jelenleg 5, az új táblák/oszlopok a
  következő lépésbe kerülnek (`server/db/migrations.js`, `schema.js`, és a
  `schema-parity` teszt).
- **Méretkorlátok:** a mostani szellemben a programfára és a képletfára is
  legyen felső korlát (mélység, elemszám). A szerver validálja a képletfát:
  csak ismert csomópontfajták, véges számok.
- **Felület:** új oldal (`data-page`) a programozónak, a Tervek oldalról
  elérhetően. A Tervek listán a blokkos program kártyája mutassa a helyzetet
  (pl. „2. ciklus · 3. hét · 1. nap”).
- **Telefonon is használható legyen:** a húzás mellett a „kijelöl → kattint”
  bevitel mindenhol működjön.

## 7. Saját döntéseim (ellenőrizd!)

Ezeket én döntöttem el, nem beszéltük meg. Mind észszerű alapértelmezés, de
bármelyik átírható:

1. **A kerekítés 2,5 kg**, egyelőre nem állítható.
2. **„1RM: gyakorlat”** az `exercise_maxes.max_1rm` értéke, vagyis a gyakorlat
   aktuális csúcsa, akár mért, akár bemondott.
3. **A TM indulóértéke** az 1RM 90%-a, 2,5 kg-ra kerekítve. Az app ezt a
   program aktiválásakor felajánlja minden TM-et használó gyakorlatra. Ha
   nincs 1RM, a TM-et kézzel kell megadni. TM nélkül a program nem aktiválható.
4. **A TM-nek előzménye van:** dátum, érték és forrás (kézi, 1RM-ből,
   elfogadott javaslat).
5. **Az AMRAP jelölő a szetten**, a típus marad `work`. Így a PR-követés és a
   meglévő típuslogika érintetlen.
6. **„Volt új 1RM-rekord a próbán”:** a ciklusban, az adott gyakorlaton
   rögzített **legnehezebb, ténylegesen 1 ismétléses** szett súlya nagyobb, mint
   az `exercise_maxes` csúcs a ciklus indulásakor. Ez az **„új 1RM”** értéke.
   Szándékosan nem az Epley-becslés: egy jól sikerült AMRAP-szett becsült
   1RM-je nem számít rekordnak, csak a valódi próba. Az **„AMRAP-ismétlés”**
   a ciklus utolsó elvégzett AMRAP-szettjének ismétlése az adott gyakorlaton.
7. **A „2,5 vagy 5 kg, gyakorlattól függően” lépésköz** a szabályban
   gyakorlatonként megadható. Az előre kitöltött érték az alsótestes
   gyakorlatoknál 5 kg, a többinél 2,5 kg; a besorolás a katalógus
   izomcsoportjaiból jön (`server/muscles.js`).
8. **Hiányzó adat:** ha egy gyakorlathoz a szabálynak szükséges adat (az
   AMRAP-szett vagy az 1RM-próba) a ciklusban nem lett rögzítve, vagy
   ugratással kimaradt, akkor nincs automatikus javaslat. A TM marad, „nincs
   adat” jelzéssel, és a felhasználó dönt. Kivétel Viktor szabálya: a
   „nem volt rekord” ág próba nélkül is fut, mert a feltétel ott egyszerűen
   hamis.
9. **A jóváhagyás kapu:** a következő ciklus első napja csak a TM-ek
   áttekintése után töltődik be. Egy „Mind elfogad” gomb is van.
10. **Elvégzettnek számít egy nap,** ha a hozzá kötött edzést befejezték,
    részlegesen is.
11. **Az aktív program szerkesztése** a következő, még be nem töltött naptól
    hat. Ha a módosítás érvényteleníti a helyzetet (pl. törölt hét), a
    legközelebbi létező napra áll.
12. **A „/” blokkmenü kimarad,** mert a gépelős bevitelt kivettük.
13. **Ajánlott edzésnapok** (pl. H–Sze–P) csak emlékeztetőként jönnek, ha
    egyáltalán. Az első szakaszba nem kellenek.
14. **Egy program pontosan egy ciklus-blokkot tartalmaz,** és az ismétlődik.
    Több, egymást követő ciklusfajta (pl. külön deload-ciklus) későbbi
    bővítés.
15. **A hét csak csoportosít.** Mivel a haladás nem a naptárhoz kötött, a
    hét nem jelent 7 napot, csak a napok egy csoportja.
16. **Aktiváláskor az app minden hiányzó értéket bekér:** a TM-et minden
    TM-et használó gyakorlatra, és az 1RM-et minden képletben hivatkozott
    gyakorlatra, ha nincs `exercise_maxes` sora. Így a betöltéskor nem
    maradhat számolhatatlan súly.
17. **A „N szett × ism.” sor** betöltéskor N darab azonos szettre bomlik a
    naplóban.

## 8. Az építőre bízva

- az adatmodell pontos alakja (külön tábla vagy a `plans` bővítése egy
  „fajta” oszloppal), a képletfa JSON-alakja, a haladás-állapot tárolása;
- a TM-javaslatok tárolása és a jóváhagyó felület pontos kinézete, a Podium
  meglévő mintái szerint;
- az ugratás gombjainak helye (Tervek-kártya és/vagy Edzés oldal);
- az API-végpontok kialakítása;
- a palettán belüli sorrend és a csoportcímkék.

## 9. Későbbi szakaszok (rögzített döntések, nem az első szakasz része)

- **Kiosztás:** az edző sablonként osztja ki a programot a meglévő
  felajánl–elfogad folyamattal (`plan_assignments`). Minden sportoló a saját
  TM-jével dolgozik, a ciklus végi TM-javaslatot **az edző** hagyja jóvá
  sportolónként. Ha valaki edző nélkül, magának használja, ő hagyja jóvá.
- **A sportoló edzés közben** kg-ban kapja a súlyokat, és a naplóban átírhatja
  a ténylegesen elvégzett súlyt és ismétlést. A program szerkezetét nem
  módosíthatja.
- **Saját képletek:** a képletet egyszer elnevezed (pl. „BBB-súly = 50% ×
  TM”), és onnantól bárhová behúzható blokk lesz belőle. Ha módosítod, minden
  használat vele változik. Önmagára (közvetve sem) hivatkozhat.
- Élő előnézet több sportolóra, a sportolók közt váltva.
- Állítható kerekítés (pl. 1,25 kg-os tárcsák).
