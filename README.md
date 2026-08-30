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
npm test           # unit- és végponti tesztek (node --test, nulla függőség):
                   #   a Recovery Engine, a jelszó-/munkamenet-kezelés,
                   #   a felhasználók közti adatizoláció, a migráció, és
                   #   az edző–kliens kereszt-fiók hozzáférés
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
  auth.js        jelszó-hash (scrypt), munkamenet-tokenek, sütik — tiszta függvények
  auth.test.js   a jelszó- és munkamenet-kezelés tesztjei (npm test)
  users.test.js  a felhasználók közti adatizoláció tesztjei (npm test)
  coach.test.js  az edző–kliens kapcsolat és a KERESZT-FIÓK hozzáférés tesztjei
  migration.test.js  a fiókok előtti adatbázis migrációjának tesztje (npm test)
  db.js          SQLite adatréteg — az egyetlen modul, ami a tárolást ismeri
  data.js        seed / referencia-adat (ételek, gyakorlat-katalógus)
  recovery.js    Recovery Engine — a készenlét-számítás (tiszta függvények, DB nélkül)
  recovery.test.js  a motor unit-tesztjei (npm test)
  muscles.js     izomcsoport-taxonómia + gyakorlat → izom leképezés
  fittrack.db    az adatbázisfájl (nem verziókövetett, a szerver hozza létre)
```

Az adat kétféle: a `collections` táblában a **csak olvasható** referencia-adat,
amit a szerver minden induláskor a `data.js`-ből szinkronizál (tehát a `data.js`
az egyetlen szerkesztési hely) — ez minden fióknak közös —, illetve a
**felhasználói adat** saját táblákban (`weight_log`, `nutrition_log`, `workouts`,
`plans`, `workout_draft`, `checkins`). Ezeket a seed nem írja felül, és minden
soruk egy fiókhoz tartozik (`user_id`).

## Fiókok

Minden `/api/*` végpont bejelentkezést követel (az `/api/auth/*` kivételével),
és **minden lekérdezés a bejelentkezett fiókra szűr** — a felhasználók nem
látják és nem írhatják egymás adatát, id-re hivatkozva sem.

- **Jelszó:** scrypt, fiókonként külön sóval (`server/auth.js`). A paraméterek
  bele vannak írva a hashbe, így később emelhetők a régi jelszavak
  érvénytelenítése nélkül.
- **Munkamenet:** `HttpOnly`, `SameSite=Lax` süti, 30 napos élettartammal. Az
  adatbázisba **csak a token SHA-256 lenyomata** kerül, maga a token nem.
  HTTPS-en (vagy `x-forwarded-proto: https` mögött) a süti `Secure` jelzőt is kap.
- **Belépési kísérlet-korlát:** 15 percen belül 10 sikertelen próbálkozás után a
  felhasználónév átmenetileg zárolódik.

### Ha korábbi, fiók nélküli adatbázisod van

Nem vész el semmi. A szerver első indulásakor a meglévő sorok egy **archív
fiókhoz** kerülnek, amivel belépni nem lehet (üres jelszó-hash), és az **első
regisztráció megörökli az egészet** — utána ugyanazt az előzményt látod, mint
korábban. A második regisztráló már nem kap belőle semmit. A `workout_draft` és
a `checkins` táblát ilyenkor a szerver újraépíti, mert az elsődleges kulcsuk is
megváltozott; a művelet idempotens, újraindításkor nem fut le mégegyszer.

## Edző–kliens kapcsolat

Az Edző oldal korábban végig **demo** volt: hat kitalált sportoló fix
készenléti számmal, és egy beégetett „edződ" fejléc. Mostantól valódi fiókok
állnak mögötte.

### A kapcsolat útja

1. Aki edzőként akar dolgozni, bekapcsolja a **Beállítások → Szerepkör** alatt
   az „Edzek másokat" kapcsolót (`users.is_coach`).
2. Az edző **meghívja a klienst a felhasználónevével** (`POST /api/coach/invites`).
   A kapcsolat ekkor `pending` — az edző ettől **még semmit nem lát**.
3. A kliens a saját Edző oldalán **elfogadja** a meghívást. Ekkor lesz
   `active`, és innentől látja az edző a kliens adatait.
4. Bontani **mindkét fél** tudja, bármikor; a hozzáférés azonnal megszűnik.
   Bontás után új meghívás küldhető — a kapcsolat nem éled fel magától.

A „van edződ" jelző ezért **nem beállítás**: az elfogadott `coach_clients`
sorból következik. Így nem lehet olyan szerepkört mutatni a felületen, ami
mögött nem áll tényleges kapcsolat.

### A kereszt-fiók hozzáférés — a legkockázatosabb pont

Idáig a szabály egyszerű volt: **minden lekérdezés a bejelentkezett fiókra
szűr**. Az edzőnek viszont látnia kell a kliense adatát, tehát mostantól
létezik egy legális út idegen fiók adatához — és pontosan ez az a felület, ahol
egy hiba adatot szivárogtat.

Ezért a szabály **egy helyen** él, és minden ilyen végpontnak ezen kell
átmennie:

- `isCoachOf(coachId, clientId)` (`server/db.js`) — csak **elfogadott**
  kapcsolatra igaz;
- `resolveClientId(req, res)` (`server/server.js`) — a végpontok egyetlen
  kapuja: saját fiók, vagy elfogadott kapcsolat, különben **404**.

A jogosulatlan kérés szándékosan **404**-et kap, nem 403-at: a 403 elárulná,
hogy az adott azonosítón létezik fiók, és az azonosítók végigpróbálhatók
lennének. A `server/coach.test.js` ezt tételesen méri — a létező és a nem
létező fiókra adott válasznak **bájtra azonosnak** kell lennie.

### Amit az edző lát

Az edzői panel minden száma **számolt érték**, a kliens tényleges naplóiból:
készenlét (Recovery Engine), sorozat, heti edzésnapok, aktív terv, legutóbbi
aktivitás. Amit nem lehet kiszámolni, az nem jelenik meg kitalált számként:

- **Terv-követés** csak akkor van, ha a kliensnek van napra ütemezett terve, és
  a mérés **csak a terv létrejötte utáni napokra** vonatkozik. Egy ma
  regisztrált kliens nem kaphat 0%-ot azért, mert nem edzett olyan napokon,
  amikor még nem is volt terve. Ilyenkor a kártyán „—" áll.
- A **készenlét megbízhatósága** (Tájékoztató / Közepes / Megbízható) ott van a
  kliens részletmodáljában: az edző lássa, mennyi adat van a szám mögött.
- A kártya jelvényén **nincs cél-címke** (ERŐ / TÖM / FIT): a profilban nem
  kérünk edzéscélt, kitalálni pedig nem fogunk.

### Kiosztott edzéstervek

A kiosztott tervnek a **kliens a tulajdonosa**, de az **edző a szerzője**
(`plans.user_id` / `plans.author_id`). Ebből következik minden szabály, és
nincs külön „locked" jelző, ami elcsúszhatna ettől:

- a **kliens edzeni tud belőle, de nem szerkesztheti**. A `PUT /api/plans/:id`
  ilyenkor **403**-at ad (nem 404-et: a saját tervét látja, csak nem az övé a
  szerkesztés joga), és a hibaüzenet megnevezi, kihez forduljon;
- az **edző módosíthatja**, amíg **él a kapcsolat**. A szerzőség önmagában nem
  jogosultság: kapcsolatbontás után a volt edző már nem írhatja át a tervet —
  a terv viszont a kliensnél marad, és tovább használható;
- a terven ott a nyom, hogy **mikor és ki módosította** utoljára. A
  *létrehozás* szándékosan **nem** számít módosításnak: a friss terven nincs
  nyom, így az utólagos átírás tényleg feltűnik.

Az edző a kliens **saját** terveit látja, de nem szerkesztheti — a modál
terv-listáján csak az általa kiosztottakon van „Szerkesztés" gomb.

### A készenlét felülírja a tervet — de kérdez, és nem írja át a tervet

A kiosztott tervhez a kliens nem nyúlhat. Egyetlen dolog szólhat bele: a **mai
készenléte**. Ez két rétegben jelenik meg.

**1. Passzív jelzés a terv-kártyán.** Kiírja, mi kockázatos ma, és miért.

- **Tiltás:** a gyakorlat olyan izomcsoportot terhel, amire a kliens **7/10
  vagy afölötti fájdalmat** jelzett. Ugyanaz a küszöb, amivel a Recovery
  Engine a gyakorlat-ajánlásokat is letiltja.
- **Óvatosság:** a terhelt izomcsoport készenléte **70% alatt** van.

A jelzés **minden** gyakorlatra működik, nem csak arra, amire van előzmény: a
gyakorlat → izomcsoport leképezésből dolgozik (`server/muscles.js`), nem a
naplóból.

**2. Javaslat-ablak a check-in után.** Ha a mai naplóban van mit visszavenni,
a check-in mentése után felugrik egy ablak tételes listával — mit venne
lejjebb és mennyivel, mit hagyna ki, és miért —, az alján **Elfogadom** és
**Most nem** gombbal. Elutasításkor nem történik semmi; a következő check-in
újra felveti, ha még indokolt.

Három művelet létezik, és mindegyik alkalmazható:

| Művelet | Mikor | Mit csinál |
| --- | --- | --- |
| **Levesz** | a terhelt izom készenléte 70% alatt | a **még nem teljesített** szettek súlya −10% (55% alatt −15%), 2,5 kg-ra lefelé kerekítve |
| **Kihagy** | 7/10 fájdalom, és még nincs teljesített szett | a gyakorlat kimarad a mai naplóból |
| **Leáll** | 7/10 fájdalom, de már van teljesített szett | csak a **hátralévő** szettek maradnak el |

Amit az elfogadás módosít, az a **mai edzésnapló** (a piszkozat) — a **terv
soha**. Ha a rendszer a tervbe nyúlna, az edző azt hinné, a kliens az ő tervét
csinálta végig, miközben más súlyokkal edzett. A **már teljesített szetteket**
és a **nem szám súlyokat** (saját testsúlyos gyakorlat) semmi nem bántja.

A javaslatot az elfogadás pillanatában a **szerver számolja újra** — a kliens
listáját nem fogadja el bemenetként, különben egy hamisított kérés tetszőleges
gyakorlatot törölhetne a naplóból.

**A küszöbök a motor skálájához igazodnak, nem érzésre.** Ahol a terhelés-
modellnek van adata a csoportról, ott a bejelentett izomláz 0,4 súllyal
keveredik be: ha a modell frissnek látja az izmot, de a felhasználó 5/5-ös
izomlázat jelez, az eredmény **60%**. Egy 45%-os küszöb tehát pont ezt az
esetet hagyná szó nélkül.

### Értesítések

Egy sor = egy **megtörtént esemény**, mindig annak a fióknak, **akit érint**:
meghívás, meghívás elfogadása, terv kiosztása, terv módosítása. Ami nem
történt meg, arról nincs értesítés — ezért nincs köztük „heti riportod
elkészült" típusú szöveg.

Az „olvasott" állapot a **szerveren** él, egyetlen időbélyegként
(`users.notifications_read_at`), nem a böngésző localStorage-ában. Az
„olvasottnak jelölés" ezért **nem üríti ki** a listát — csak az „új" jelzés
tűnik el róla. (Korábban a teljes lista eltűnt, ami beégetett demo-adaton
elment, valódi eseményeknél viszont előzmény-vesztés lenne.)

## Kódtérkép — graphify (opcionális fejlesztői eszköz)

A repo tartalmazza a [graphify](https://github.com/Graphify-Labs/graphify) skillt
(`.claude/skills/graphify/`, Apache-2.0), amivel az AI kódasszisztens tudásgráfot
épít a projektről: ki hívja kit, mik a központi függvények, mi függ mitől.

Maga a skill csak leírás — a munkát a `graphifyy` CLI végzi, azt gépenként
egyszer telepíteni kell. Bemásolandó parancs:

```bash
pip install graphifyy && npm run graph
```

Windows PowerShell 5.1-en a `&&` helyett `;` kell:
`pip install graphifyy; npm run graph`

Ezután a gráf frissítése már csak ennyi:

```bash
npm run graph
```

A `graphifyy` (két y-nal) a hivatalos csomagnév; a kód-elemzés tree-sitterrel,
helyben fut, semmit nem küld ki a gépről. Az eredmény a `graphify-out/`
könyvtárba kerül (`graph.html`, `graph.json`, `GRAPH_REPORT.md`) — ez
generált, ezért nincs verziókövetve. Kódváltozás után futtasd újra.

A projekt gráfja jelenleg nagyjából 280 csomópont / 600 él; a legtöbb kapcsolattal bíró
függvények: `init()`, `computeReadiness()`, `showToast()`. A `.graphifyignore`
tartja ki a gráfból magát a vendorolt skillt (különben a saját dokumentációja
61 csomóponttal hígítaná a képet).

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
- **Szett-típusok.** Minden szett *bemelegítő*, *munkasorozat* vagy *drop set* —
  az első sor alapból bemelegítő. A típus nem csak színezés: a Recovery Engine
  izomkárosodás-becslése a bemelegítőt nullának, a drop setet fél
  munkasorozatnak veszi (a tonnatömeg viszont mindegyikből számít). A típus
  nélküli, régebbi bejegyzések teljes munkasorozatnak számítanak — akkor még
  minden sor az volt.
- **Egyéni csúcsok (PR).** A rekordot a gyakorlat **legjobb teljesített**
  szettje hozza, Epley-becsléssel — nem az első teljesített, ami a
  szett-típusok óta jellemzően a bemelegítés. A szabály egy helyen él
  (`bestCompletedSet`, `server/db.js`), és ugyanaz jelöli meg a PR-t mentéskor,
  mint ami a Korábbi rekordok listáját kiírja. A csúcsok fiókonként külön
  táblasorban állnak, tehát mindenki a saját korábbi teljesítményéhez mérődik.
- **Migrációk.** A séma bővítései a `db.js` `ensureColumn` hívásaival futnak le a
  meglévő adatbázisfájlokon is, tehát nem kell törölni a `fittrack.db`-t. Aki a
  PR-követés bevezetése előtt naplózott, annak a csúcsait a szerver egyszer
  visszatölti a meglévő edzésekből — enélkül a következő edzés minden
  gyakorlata hamis rekordot ütne.

## Recovery Engine — a készenléti állapot

A Regeneráció oldal (`#recovery`) a napi check-inből és az edzésnaplóból számol
egy 0–100-as készenléti pontszámot, és ebből konkrét edzésdöntéseket vezet le.
A számítás teljes egészében a `server/recovery.js`-ben van, amely **nem ismeri az
adatbázist** — mindent paraméterként kap, ezért unit-tesztelhető (`npm test`).

### A check-in két kitöltési útja

A napi check-int két felület írja, **ugyanabba a sorba**:

- **`#checkin` — a lépésenkénti varázsló, az elsődleges út.** Egy kérdés / egy
  képernyő: alvás, alvásminőség, energia, stressz, **testsúly**, majd két kapu
  (van-e izomláz, ill. fájdalom) és a hozzájuk tartozó testtérkép. Szándékosan
  **nem** kérdez közérzetet és folyadékot.
- **A Regeneráció oldal „Részletes szerkesztés" blokkja — a teljes űrlap.** Itt
  minden mező elérhető egy képernyőn, a varázslóból kihagyottakkal együtt.

**A két út közti szerződés — ez a legfontosabb tudnivaló a check-in körül.**
A `PUT /api/checkin` **teljes sort cserél**, nem merge-öl (`saveCheckin`,
`server/db.js`): a törzsből hiányzó mezőt a szerver `null`-ként írja be. A
varázsló ezért megnyitáskor betölti a mai check-int, a nem kérdezett mezőket
(`mood`, `hydration`, `pain.general`) eltárolja, és mentéskor **változatlanul
visszaküldi** — enélkül némán felülírná, amit a részletes űrlapon adtál meg.
A `weightKg` kivétel a szabály alól: azt mindkét felület küldi, de nem a
check-in sorba megy, hanem a `weight_log`-ba — **naponta egy bejegyzésbe**
(`addWeightEntry`: ha az adott napra már van sor, azt írja felül). Ezért írhatja
ugyanazt a napot a varázsló és a részletes űrlap is akárhányszor, duplikátum
nélkül. Üres/hiányzó `weightKg` = „ma nem mértem": ilyenkor a napló érintetlen
marad.

### A testsúly útja

A napi testsúly a **check-in része** (korábban a dashboardon volt külön rögzítő
űrlap és trend-diagram). A varázsló testsúly-lépése kihagyható — a mezőt
szándékosan nem tölti ki előre a legutóbbi méréssel, mert egy előre beírt szám a
„Tovább"-bal olyan méréssé válna, ami meg sem történt. Ami ma már be van írva,
azt viszont visszaadja: azt szerkeszted tovább. A trend a **Regeneráció oldal**
„Testsúly alakulása" kártyáján látszik (a `GET /api/weight-log` utolsó 12
bejegyzése, a tényleges értékekhez igazított skálával); az áttekintőn csak a
„Testsúly Δ" stat maradt. Amíg nincs egyetlen saját bejegyzés sem, a kártya a
seed-görbét mutatja, és ki is írja, hogy az demo-adat.

**„Nincs adat" ≠ „tökéletes állapot".** Ez a motor legfontosabb szabálya, és
sokáig meg volt szegve: az izom- és a terhelés-komponens sosem lehetett
hiányzó, adat híján „nincs károsodás" → 100 ment a képletbe. Egy **vadonatúj
fiók így 100%-os készenlétet kapott** — a lehető legrosszabb irányba tévedve,
mert pont az ismeretlen állapotú embernek mondta, hogy nyomhatja. Ma:

- **nincs semmilyen adat** (se check-in, se naplózott edzés) → az `overall`
  **`null`**, és a felület „—"-t mutat, nem 0-t és nem 100-at;
- **aki naplóz, de rég edzett** → a 100 továbbra is helyes, mert az már
  érvényes következtetés, nem az adat hiánya. A kettőt a „naplózott-e valaha
  edzést" kérdés választja el;
- **izomcsoportonként** ugyanez: a riport minden csoportnál jelzi (`known`),
  hogy tudunk-e róla bármit.

**A bejelentett izomlázat nem nyomhatja el a modell.** A keverés súlya attól
függ, van-e a modellnek egyáltalán mondanivalója az adott izomcsoportról:

- **van naplózott terhelés a csoporton** → a modell dominál (0,6 / 0,4), mert
  az objektív terhelést ismeri;
- **nincs** → a „100% friss" nem tudás, hanem az információ hiánya, ezért a
  felhasználó saját jelzése önmagában adja a pontszámot. Korábban a fix 0,6-os
  modell-súly miatt az 5/5-ös izomláz is csak 60%-ig vitt le.

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
  sok ismétléses lábtolás, miközben sokkal jobban lever). A szett-egység a
  szett TÍPUSÁVAL is súlyozódik: bemelegítő 0, munkasorozat 1, drop set 0.5.
  A csillapítás csoportonként eltér: kis izmok τ = 1.5 nap, nagy tolók/húzók
  2.2, a hamstring/farizom/törzs 3.0 nap.
- **CNS-becslés**: az axiális összetett emelések, a magas RPE-s szettek és a
  PR-próbálkozások költsége, lassabb csillapítással (τ = 3.5 nap), az alvással
  szorozva.
- **Gyakorlat-specifikus ajánlás**: izom-readiness + CNS + frissesség alapján
  konkrét súly- és volumen-javaslat (a fő emelésekhez egyetlen naplózott alkalom
  is elég, a többihez három kell).
- **Sapkák**: 7/10 feletti fájdalom letiltja az érintett izmot terhelő
  gyakorlatokat, és a teljes pontszámot is korlátozza — ezt egy súlyozott átlag
  elmosná.

**Adatigény.** Ami nem számolható, az nem jelenik meg kitalált számként — sem
0-ként, sem 100-ként (ld. fentebb). A
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

- **Nincs jelszó-visszaállítás és nincs fióktörlés.** Elfelejtett jelszónál az
  adatbázisban kell a `users` sort javítani.
- **A belépési kísérlet-korlát memóriában él**, tehát a szerver újraindításakor
  nullázódik, és több példány futtatásakor példányonként külön számol.
- **A dátumot a szerver helyi ideje adja.** Ha a szerver és a böngésző más
  időzónában van, a „mai nap" elcsúszhat.
- **Nincs pulzus/HRV adatforrás.** Nincs okosóra-integráció, ezért a Recovery
  Engine hat komponensből számol, nem hétből (lásd fentebb).
- **Az üzenetváltás szimulált.** Az edzőnek (és a kliensnek) küldött üzenet
  nem jut el a másik félhez: a válaszok előre megírt sorokból forognak körbe, és
  az egész szál a lap újratöltésével elvész. A felület ezt ki is írja. A
  perzisztens üzenetküldés a következő lépés — ld. `TEENDOK.txt`, 2. blokk.
- **A készenlét-javaslat kérdez, nem cselekszik magától.** Elfogadás nélkül
  semmi nem változik, és a terv akkor sem — csak a mai napló. Az edző egyelőre
  **nem látja**, hogy a kliens elfogadott-e javaslatot; ez az edzés utáni
  visszajelzéssel együtt jön (`TEENDOK.txt`, 2. blokk).
- **Az edzői panelen nincs kliensenkénti regeneráció-nézet.** A végpont megvan
  (`GET /api/coach/clients/:id/readiness`), a felület még nem — ld.
  `TEENDOK.txt`, 5. blokk.
