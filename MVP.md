# FitTrack Pro — mi hiányzik az MVP-hez, és mit érdemes átszabni UI/UX-ben

Készült: 2026-08-20 · a `main` állapota alapján (128/128 teszt zöld)

Ez a dokumentum két kérdésre válaszol:

1. **Mi hiányzik ahhoz, hogy az app MVP legyen** — azaz idegen ember kezébe
   adható, aki nem tőlünk kap magyarázatot hozzá.
2. **Mit érdemes átszabni a tervezeten** UI/UX szempontból.

A hangsúly a *hiányon* van, nem a meglévő értékelésén. Röviden azért a
kiindulás: a mag kész és jó. A Recovery Engine tiszta függvényekkel,
unit-tesztelve; a fiókkezelés (scrypt, HttpOnly munkamenet, fiókonkénti
adatizoláció) rendben; az edzésnapló autosave-je hibatűrő; a design-tokenek
kontraszt- és érintési-célterület-szinten végig vannak gondolva. Ami hiányzik,
az nem a mag, hanem a **termék körítése**: fiók-életciklus, személyre szabás,
és az a réteg, ami ma még demo-adat.

---

## 1. MVP-blokkolók (P0)

Ezek nélkül nem adnám ki senkinek. Sorrendben, ahogy nekiállnék.

### 1.1 A demo-tartalom kivezetése vagy megjelölése

**Ez a legnagyobb tétel, és ma nincs a TEENDOK-ban.** Az app több helyen mutat
kitalált adatot úgy, mintha a felhasználóé lenne. Egy új fiók ma ezt látja:

| Hol | Mi a demo | Forrás |
| --- | --- | --- |
| Edzői panel | 5 kitalált sportoló, fix `readiness` értékkel | `server/data.js:57` |
| Edző-chat (kliens nézet) | „Kovács Bence", körbeforgó előre írt válaszok | `data.js:120,143` · `index.html:440` |
| Értesítések | 6 db seed-értesítés, a badge `6`-ra **beégetve** a HTML-ben | `data.js:148` · `index.html:108` |
| Technika-videó modál | minden gyakorlatnál ugyanaz: „Fekvenyomás" + kitalált edzői megjegyzés | `index.html:747-767` |
| Testsúly-kártya | saját mérés nélkül seed-görbét rajzol | `script.js:2521` |
| Szerepkörök | `hasCoach` / `coachesAthletes` a seedből jön, nem a fiókból | `server/server.js:242` |
| Táplálkozási cél | **mindenkinek** 2900 kcal / 170 g | `data.js:157` |

Döntés kell mindegyikről: **vagy valós lesz, vagy kikerül, vagy láthatóan
„Demo" címkét kap.** MVP-re a legolcsóbb és legőszintébb út: az edzői panelt,
az edző-chatet és a technika-videót egy funkciókapcsoló mögé tenni (alapból ki),
az értesítéseket valósra cserélni (van miből: PR, elmaradt check-in, mai
tervezett edzés), a testsúly seed-görbét pedig üres állapotra váltani.

### 1.2 Személyre szabott célok és profil

Ma nincs felhasználói profil. Ebből következik, hogy:

- a kalória/fehérje cél mindenkinek ugyanaz (2900/170) — ez az egész
  Táplálkozás oldalt és a készenlét táplálkozás-komponensét is hamissá teszi
  annak, aki nem 90 kg-os férfi;
- a Recovery Engine testsúlyra skálázott általános referenciáját csak a
  `weight_log`-ból tudja megbecsülni, tehát az első mérésig vakon fut.

**Kell:** `user_profile` tábla (nem, születési év, magasság, cél: fogyás /
tömeg / erő / fenntartás, aktivitási szint), ebből számolt **javasolt**
kalória/fehérje cél, amit a felhasználó felülírhat, és fiókonként tárolt
`nutrition_goal`. A `getCollection('nutritionGoal')` helyére
felhasználó-szintű lekérdezés kerül.

### 1.3 Fiók-életciklus: jelszó-visszaállítás és fióktörlés

A TEENDOK is blokkolóként jelöli. E-mail-cím nélkül nincs önkiszolgáló
visszaállítás — tehát a profil kap egy opcionális e-mail mezőt, vagy MVP-re
elég egy **helyreállító kód** a regisztrációkor (egyszer megjelenik, a hash-e
tárolódik, ezzel új jelszó kérhető). A **fióktörlés** viszont nem opcionális:
ha másnak az adatát tároljuk, kell hozzá törlés és adatkiadás. Az export
(`/api/export`) már megvan, a `DELETE /api/account` hiányzik.

### 1.4 Időzóna

`server/server.js:179` — a `today()` a **szerver** helyi ideje. UTC-s hostingon
a magyar felhasználónak hajnali 2-kor vált a nap: a késő esti edzés, check-in és
vacsora rossz naphoz kerül, és ettől a készenlét-számítás is csúszik. A dátumot
a kliens időzónájából kell venni (fejléc vagy a profilban tárolt IANA zóna),
és a `today()` minden hívási helyén egységesen alkalmazni.

### 1.5 Adatmegőrzés: perzisztens volume + mentés

A `server/fittrack.db` egy fájl. Ephemeral fájlrendszeren (Heroku, Render, Fly
volume nélkül) minden deploynál elvész — a seed újraépül, a naplók nem. Kell
perzisztens volume, és mellé egy egyszerű, ütemezett mentés (SQLite
`VACUUM INTO` egy timestampelt fájlba). Ez üzemeltetés, nem kód, de MVP-blokkoló.

### 1.6 Gym visual licenc

Jogi blokkoló, kódból nem megoldható: a gyakorlat-illusztrációk © Gym visual,
kizárólag 180×180-ban, attribúcióval használhatók. Saját/tanulós használatra
rendben (az attribúció ki van téve a választó alján), **bármi másra engedély
kell**. Amíg nincs, az app nem mehet nyilvánosra a médiával — vagy a média
marad ki.

### 1.7 Mentett edzés megnyitása, javítása, törlése

Ma a „Korábbi edzések" egy nem kattintható lista (`script.js:1290`,
`historyEntryEl`): dátum, név, `3/12 szett`. Nincs részletnézet, nincs
szerkesztés, nincs törlés. Ez MVP-szinten hiányzik, mert **az elrontott adat
javíthatatlan** — és a rossz adat továbbgyűrűzik a készenlét-számításba és a
PR-okba. Ugyanez a Terveknél: `POST` és `PUT` van, `DELETE` nincs, tehát egy
elrontott terv örökre ott marad.

**Kell:** `GET /api/workouts/:id` + részletmodál, `DELETE /api/workouts/:id`,
`DELETE /api/plans/:id`. A szerkesztés MVP-re elhagyható, ha van törlés.

### 1.8 Üzemeltethetőség

- Nincs `/health` végpont — így semmilyen platform nem tudja, él-e a folyamat.
- Nincs kérésnapló és nincs hibanapló (a szerver csak `console.log`-ol induláskor).
- Nincsenek biztonsági fejlécek (CSP, `X-Content-Type-Options`, HSTS).
  Egy `helmet` vagy 15 sornyi saját middleware elég.
- Rate limit **csak a belépésen** van, memóriában. A többi végpont
  bejelentkezést követel, tehát nem nyilvánosan támadható, de egy globális,
  fiókonkénti írás-korlát olcsó biztosíték.

---

## 2. MVP-hez erősen ajánlott (P1)

- **Pihenő-idő mérő (rest timer).** Ez a legfeltűnőbb hiány edzés közben: ma a
  szett bepipálása után semmi nem történik. Egy szett kipipálásakor induló,
  gyakorlatonként állítható visszaszámláló (60/90/120/180 s) az edzésnapló
  legnagyobb használati értékű kiegészítése.
- **„Legutóbb ennyit nyomtál" a szett-sorban.** A `tpl-set-row`
  (`index.html:1072`) ma üres mezőkkel indul. Egy halvány referencia
  (`8 × 60 kg` az előző alkalomról) a legolcsóbb módja annak, hogy a napló
  edzésvezetéssé váljon. Az adat megvan (`getWorkouts`), csak a szett-sorig
  nem jut el.
- **Az edzés hossza mentődjön.** A `workoutMinutes()` (`script.js:1560`)
  `localStorage`-ból számol, és **nem kerül bele a mentett edzésbe** — tehát a
  Korábbi edzésekben nincs időtartam, másik eszközön pedig 0 percet mutat.
  A kezdés időbélyege a piszkozat része kellene legyen.
- **Onboarding.** Az első belépés ma egy üres app 0%-os készenléttel. Három
  képernyő elég: cél + testadatok (→ ebből a kalória-cél), első testsúly, első
  terv választása sablonból (a 200 kurált gyakorlatból összeállítható 3-4
  kezdő split).
- **Kezdő terv-sablonok.** Új fiók ma nulla tervvel indul, és a terv-építő
  üres lappal fogadja. 3-4 beépített sablon (Full body 3×, Push/Pull/Legs,
  Felső/alsó) egy koppintással másolható legyen.

---

## 3. UI/UX — mit szabnék át a tervezeten

### 3.1 Navigáció — ez a legnagyobb tervezési adósság

A jelenlegi felállás:

- **Mobil/tablet:** húzható nav-gyűrű, **négy iránnyal** (Edző, Tervek, Edzés,
  Táplálkozás), koppintás = Áttekintés.
- **Desktop (≥1025px):** oldalsó nav **hat** ponttal.
- Az app viszont **tíz** oldalból áll.

Ebből három konkrét baj következik:

1. **A Regeneráció oldal a gyűrűről nem érhető el.** Csak a dashboard
   készenlét-kártyáján keresztül, ami egy megtanulandó, nem látható útvonal —
   miközben ez az app legértékesebb, legegyedibb oldala.
2. **A napi check-in sem érhető el navigációból**, csak a dashboard CTA-jából,
   ami *eltűnik*, amint kitöltötted. Utólag szerkeszteni akaró felhasználónak
   nincs útja vissza (a részletes űrlap a Regeneráció oldalon van — ott
   viszont van).
3. **Tablet-lyuk:** 768–1024px között nincs oldalsó nav, de már egérrel
   használják — a húzós gyűrű ott a legrosszabb megoldás.

**Javaslat:** a gyűrű maradjon meg *gyorsítóként* (jó ötlet, egykezes
használatra kifejezetten kellemes), de **ne az legyen az egyetlen navigáció
mobilon**. Alá kerüljön egy klasszikus alsó tab-sáv 5 ponttal: Áttekintés ·
Regeneráció · Edzés · Táplálkozás · Tervek (az Edző a beállítások/profil alá
kerülhet, ha egyáltalán marad). A side-nav breakpointja essen **768px**-re, és
kerüljön be a Regeneráció mellé a Check-in is. Ez egyben megoldja azt is, hogy
ma a felhasználó nem látja, hol van — a gyűrű ikonja jelzi ugyan, de az egy
külön megtanulandó jelrendszer.

### 3.2 Betöltési állapot

Az `init()` nyolc végpontot kér le párhuzamosan, és amíg nincs válasz, az app
**a nulla értékeivel áll ott**: 0% készenlét, üres statok, majd minden beugrik
és animálódik. Rossz kapcsolaton ez törött appnak látszik. Kell egy
skeleton-réteg (a kártyák már úgyis dobozosak, olcsó), vagy legalább `—`
placeholder a `0` helyett, és a szám-animáció csak akkor induljon, ha megjött
az adat.

Ugyanez a beégetett `6`-os értesítés-badge (`index.html:108`): minden
oldalbetöltéskor felvillan, mielőtt a valódi szám kiszámolódik.

### 3.3 Üres állapotok új fióknál

Az üres állapotok szövegei külön-külön jók („Még nincs mentett edzésed…"), de
**az első benyomás egésze nincs megtervezve**. Egy friss fiók a dashboardon
0%-ot lát magyarázat nélkül, a Regeneráción demo-testsúlygörbét, az Edzőn öt
kitalált sportolót. Ezt egyben kell megtervezni: mit lát az ember a 0.
percben, és mi az egyetlen dolog, amit ilyenkor csinálnia kell. (Javaslat:
„Töltsd ki az első check-int" — ez egy lépésben feloldja a készenlétet is.)

### 3.4 Desktop-elrendezés

A tartalom desktopon is egyoszlopos, 640–760px-re korlátozva. 1440px-es
képernyőn ez sok üres hely, miközben az Áttekintés és a Regeneráció oldal
tele van egymás alá pakolt kártyával, amiből 3-4 elférne egymás mellett. A
tokenek (`--page-max-wide`, `--dashboard-max-wide`) megvannak hozzá, csak a
rács hiányzik: ≥1280px-en a dashboard-statok és a Regeneráció kártyái
kerüljenek 2-3 oszlopos gridbe.

### 3.5 Világos téma

Nulla `prefers-color-scheme` szabály van a CSS-ben — az app csak sötét. Ez
önmagában védhető terméki döntés, de a token-rendszer (`--surface-*`,
`--text-*`, `--border-*` szemantikus aliasok) **már fel van rá készítve**:
egy világos paletta lényegében a `:root` felülírása. Kültéri/edzőtermi
használatnál ez valódi különbség. Nem MVP-blokkoló, de a ráfordítás/haszon
arány itt a legjobb az egész listán.

### 3.6 Edzés közbeni ergonómia

- A **fejléc-sor** (`Szett · Ism. · Súly·kg · RPE`) `aria-hidden`, tehát a
  mértékegység csak vizuálisan van jelen — képernyőolvasóval a három szám
  megkülönböztethetetlen. A mezők kapjanak saját `aria-label`-t.
- **Tárcsa-számoló** (plate calculator): a súlymező `step="2.5"`, ami jó
  irány, de a „mit tegyek a rúdra" kérdést nem válaszolja meg.
- **Jegyzet gyakorlatonként** nincs (technika-emlékeztető, fájdalom).
- A **szuperszett** és a **szett-típus** két különböző saját lenyíló mintát
  használ ugyanabban a kártyában — érdemes egyetlen mintára hozni.

### 3.7 Táplálkozás

- **Csak a mai nap létezik.** Nincs visszalapozás korábbi napokra, pedig az
  adat megvan (`nutrition_log` dátummal). Egy dátumléptető a fejlécben olcsó.
- **Nincs étkezés-bontás** (reggeli/ebéd/vacsora/snack) — a napi lista egy
  kupac.
- **Nincs saját étel és nincs recept.** 437 étel sok, de a saját reggelijét
  senki nem fogja 437-ből kikeresni minden reggel. Kell: „Gyakori" /
  „Legutóbbi" gyorslista a kereső fölé, és saját étel felvétele.
- A **makró-cél** csak kalória + fehérje; a szénhidrát/zsír meg van jelenítve,
  de cél nélkül. Vagy legyen mind a négyhez cél, vagy tűnjön el a látszat.

### 3.8 Check-in

- A varázsló alvás-tartománya 0–12, a részletes űrlapé 0–24 (a szerver
  0–24-et fogad). Ezt egységesíteni kell — ma a varázslóban nem lehet 13 órát
  rögzíteni, a részletesben igen.
- A két felület közti szerződés (a varázsló „átviszi" a nem kérdezett mezőket,
  mert a `PUT /api/checkin` **teljes sort cserél**) működik, de törékeny: egy
  új mező felvételekor némán felülíródik, ha valaki elfelejti a `carried`
  listát bővíteni. **Tervezési javaslat:** a `PUT` legyen merge-elő
  (`PATCH`-szerű), és a törlést külön, explicit `null` jelezze. Ezzel a
  szabály a szerverben él, nem a kliens jó emlékezetében.
- A varázsló összegző lépéséről legyen közvetlen átjárás a részletes űrlapra
  („Több adatot adnék meg") — ma a két út között nincs kapcsolat.

### 3.9 Apróságok, amik olcsók és látszanak

- A **flow-oldalakról** (terv-építő, gyakorlat-választó, összegző) csak a
  saját vissza-gombjuk visz ki; a nav-gyűrű onnan is működik, de vizuálisan
  nincs jelezve, hogy ezek „modális" oldalak.
- Az **összegző** két statot mutat (szett, perc). Idekívánkozik az
  össztonnatömeg és a PR-ok neve — az adat mind megvan.
- A **`--fs-2xs: 11px`** mobilon még mindig kicsi a feliratokhoz; desktopon
  13px-re nő, tehát a skála ismert — mobilon is elbírna 12px-et.

---

## 4. Amit MVP-re NEM kell megcsinálni

Hogy a lista ne hízzon: ezek most **helyesen** vannak nyitva hagyva.

- HRV/pulzus-integráció — nincs adatforrás, kitalált szám nem kerül a képletbe.
- Aszinkron SQLite / worker thread — a mérés szerint 8 ms/kérés, nem szűk
  keresztmetszet.
- A maradék 53 lefordítatlan gyakorlat és a származtatott `load` súlyok
  finomhangolása — a 200 kurált gyakorlat felülírja őket ott, ahol számít.
- Címke-heurisztika (Összetett/Izolációs) — csak a kártyán látszó felirat.
- Volumen-diagram bemelegítő-szűrése — terméki döntés, a felirat ma is igaz.

---

## 5. Javasolt sorrend

**1. szakasz — „nem hazudik" (MVP-küszöb)**
demo-tartalom kivezetése/megjelölése · fiókonkénti táplálkozási cél + profil ·
időzóna · perzisztens volume + mentés

**2. szakasz — „nem lehet elrontani"**
mentett edzés részletnézet + törlés · terv törlése · jelszó-visszaállítás +
fióktörlés · `/health`, hibanapló, biztonsági fejlécek

**3. szakasz — „jó használni"**
navigáció átszabása (alsó tab-sáv + 768px-es side-nav) · pihenő-idő mérő ·
„legutóbb ennyit nyomtál" · betöltési állapotok · onboarding + terv-sablonok

**4. szakasz — csiszolás**
világos téma · desktop rács · táplálkozás (napváltás, étkezések, saját étel) ·
check-in egységesítés

A licenc-tisztázás (1.6) ezekkel párhuzamosan fut, mert nem kódmunka — de a
nyilvános kiadás előtt le kell zárulnia.
