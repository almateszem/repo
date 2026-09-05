# FitTrack Pro — mi hiányzik az MVP-hez, és mit érdemes átszabni UI/UX-ben

Készült: 2026-08-20 · a `main` állapota alapján (128/128 teszt zöld)
**Felülvizsgálva: 2026-08-27** · a `Viktor/hianyzotemak` + `valter/verzio2`
összeolvasztott ág alapján (260/260 teszt zöld)

> **Állapotjelölés.** Az eredeti elemzés szövege érdemben változatlan: a
> 2026-08-27-i felülvizsgálat a `>` idézetben álló bekezdésekben áll, plusz egy
> állapot-jel a szakaszcímekben és egy állapot-oszlop az 1.1 táblázatában.
> ✅ kész · 🟡 részben kész · ⬜ nyitott
>
> A lista P0-szakaszának nagyjából a fele azóta megvalósult; a legnagyobb
> tétel (1.1, demo-tartalom) háromnegyedéig eljutott. Ami érintetlen maradt:
> a profil/személyre szabás (1.2), a navigáció átszabása (3.1) és szinte az
> egész P1-lista.

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

### 1.1 A demo-tartalom kivezetése vagy megjelölése 🟡

**Ez a legnagyobb tétel, és ma nincs a TEENDOK-ban.** Az app több helyen mutat
kitalált adatot úgy, mintha a felhasználóé lenne. Egy új fiók ma ezt látja:

| Hol | Mi a demo | Forrás | Állapot (08-27) |
| --- | --- | --- | --- |
| Edzői panel | 5 kitalált sportoló, fix `readiness` értékkel | `server/data.js:57` | ✅ kikerült — valódi `coach_links`, a statokat a `coaching.js` számolja |
| Edző-chat (kliens nézet) | „Kovács Bence", körbeforgó előre írt válaszok | `data.js:120,143` · `index.html:440` | ✅ kikerült — `messages` tábla, `GET/POST /api/messages/:linkId` |
| Értesítések | 6 db seed-értesítés, a badge `6`-ra **beégetve** a HTML-ben | `data.js:148` · `index.html:108` | 🟡 a lista valós eseményekből épül (`notifications.js`), de a badge `6`-os kezdőértéke **még beégetve** (`index.html:121`) |
| Technika-videó modál | minden gyakorlatnál ugyanaz: „Fekvenyomás" + kitalált edzői megjegyzés | `index.html:747-767` | 🟡 a gyakorlat neve már dinamikus; a videó-előnézet és az „Edző megjegyzése" **még mindig fix demo-szöveg** (`index.html:895-901`) |
| Testsúly-kártya | saját mérés nélkül seed-görbét rajzol | `js/ui/weight.js` | ⬜ változatlan — `data.js` → `charts.bodyWeight` még mindig seed-görbe |
| Szerepkörök | `hasCoach` / `coachesAthletes` a seedből jön, nem a fiókból | `server/server.js:242` | ✅ kikerült — a szerepkör valódi edző–sportoló kapcsolatból következik |
| Táplálkozási cél | **mindenkinek** 2900 kcal / 170 g | `data.js:157` | ⬜ változatlan — `data.js:79`, a `getNutritionTotals` a globális `nutritionGoal`-t adja vissza |

Döntés kell mindegyikről: **vagy valós lesz, vagy kikerül, vagy láthatóan
„Demo" címkét kap.** MVP-re a legolcsóbb és legőszintébb út: az edzői panelt,
az edző-chatet és a technika-videót egy funkciókapcsoló mögé tenni (alapból ki),
az értesítéseket valósra cserélni (van miből: PR, elmaradt check-in, mai
tervezett edzés), a testsúly seed-görbét pedig üres állapotra váltani.

> **🟡 Ebből mi történt.** Az edzői panel, az edző-chat és a szerepkörök nem
> funkciókapcsoló mögé kerültek, hanem **valódivá váltak** — ez több, mint amit
> a doksi javasolt. Az értesítések is valósak (`server/notifications.js`, saját
> tesztekkel), csak a badge kezdőértéke maradt beégetve. Nyitott maradt a
> testsúly seed-görbe, a technika-videó demo-tartalma és a globális kalória-cél.

### 1.2 Személyre szabott célok és profil ⬜

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

> **⬜ Nyitott, egy részlettel.** `user_profile` tábla nincs, és a
> `getNutritionTotals` továbbra is a globális `getCollection('nutritionGoal')`-t
> adja vissza (`server/db.js:1082`). Ami azóta bekerült: a `users` táblán van egy
> `goal` oszlop — de az az **edzés-cél** (fogyás/tömeg/erő), amit az edző is lát
> a kártyádon, nem a táplálkozási cél. A Profil oldal is elkészült
> (`GET /api/profile`), viszont test- és céladatokat nem kér be, tehát a
> javasolt kalória/fehérje szám továbbra sincs miből kiszámolni.

### 1.3 Fiók-életciklus: jelszó-visszaállítás és fióktörlés 🟡

A TEENDOK is blokkolóként jelöli. E-mail-cím nélkül nincs önkiszolgáló
visszaállítás — tehát a profil kap egy opcionális e-mail mezőt, vagy MVP-re
elég egy **helyreállító kód** a regisztrációkor (egyszer megjelenik, a hash-e
tárolódik, ezzel új jelszó kérhető). A **fióktörlés** viszont nem opcionális:
ha másnak az adatát tároljuk, kell hozzá törlés és adatkiadás. Az export
(`/api/export`) már megvan, a `DELETE /api/account` hiányzik.

> **🟡 A fele kész.** A **fióktörlés megvan**:
> `POST /api/auth/delete-account` (jelenlegi jelszóval), a `users` sor törlése
> `ON DELETE CASCADE`-del viszi az összes felhasználói táblát, és a munkamenetek
> is törlődnek. Jelszó**változtatás** is van bejelentkezve
> (`PUT /api/auth/password`). Ami hiányzik: az **elfelejtett** jelszó útja —
> se e-mail mező, se helyreállító kód. Aki kizárja magát, ma nem tud visszajutni.

### 1.4 Időzóna ✅

`server/server.js:179` — a `today()` a **szerver** helyi ideje. UTC-s hostingon
a magyar felhasználónak hajnali 2-kor vált a nap: a késő esti edzés, check-in és
vacsora rossz naphoz kerül, és ettől a készenlét-számítás is csúszik. A dátumot
a kliens időzónájából kell venni (fejléc vagy a profilban tárolt IANA zóna),
és a `today()` minden hívási helyén egységesen alkalmazni.

> **✅ Kész.** A napot a kliens mondja meg az `X-Client-Date` fejlécben, és a
> szerver validálja is: alakilag pontosan `ÉÉÉÉ.HH.NN`, visszaalakítva ugyanaz
> (nem csúszik át egy „2026.13.45"), és a szerver napjától legfeljebb **egy**
> napra tér el — így minden létező időzóna belefér, de a fejléc nem használható
> visszadátumozásra. Gyanús vagy hiányzó fejléc esetén marad a szerver napja.
> A napot a `req.today` viszi végig minden végponton; külön tesztfájl őrzi
> (`server/timezone.test.js`).

### 1.5 Adatmegőrzés: perzisztens volume + mentés 🟡

A `server/fittrack.db` egy fájl. Ephemeral fájlrendszeren (Heroku, Render, Fly
volume nélkül) minden deploynál elvész — a seed újraépül, a naplók nem. Kell
perzisztens volume, és mellé egy egyszerű, ütemezett mentés (SQLite
`VACUUM INTO` egy timestampelt fájlba). Ez üzemeltetés, nem kód, de MVP-blokkoló.

> **🟡 Láthatóvá téve, de nincs mentés.** A szerver induláskor kiírja a feloldott
> adatbázis-útvonalat, és azt is, hogy **meglévő fájlt nyitott-e meg vagy újat
> hozott létre** — a néma újralétrehozás eddig pont az a hiba volt, ami akkor
> derült ki, amikor a naplók már eltűntek. Az útvonal a `FITTRACK_DB`
> env-változóval állítható, és a README kapott egy *Élesítés* szakaszt.
> **Ütemezett mentés (`VACUUM INTO`) továbbra sincs**, és a volume maga
> ugyanúgy telepítési kérdés maradt.

### 1.6 Gym visual licenc ⬜

Jogi blokkoló, kódból nem megoldható: a gyakorlat-illusztrációk © Gym visual,
kizárólag 180×180-ban, attribúcióval használhatók. Saját/tanulós használatra
rendben (az attribúció ki van téve a választó alján), **bármi másra engedély
kell**. Amíg nincs, az app nem mehet nyilvánosra a médiával — vagy a média
marad ki.

> **⬜ Változatlan.** Nem kódmunka; a nyilvános kiadás előtt továbbra is le kell
> zárulnia.

### 1.7 Mentett edzés megnyitása, javítása, törlése 🟡

Ma a „Korábbi edzések" egy nem kattintható lista (`js/render/workout.js`,
`historyEntryEl`): dátum, név, `3/12 szett`. Nincs részletnézet, nincs
szerkesztés, nincs törlés. Ez MVP-szinten hiányzik, mert **az elrontott adat
javíthatatlan** — és a rossz adat továbbgyűrűzik a készenlét-számításba és a
PR-okba. Ugyanez a Terveknél: `POST` és `PUT` van, `DELETE` nincs, tehát egy
elrontott terv örökre ott marad.

**Kell:** `GET /api/workouts/:id` + részletmodál, `DELETE /api/workouts/:id`,
`DELETE /api/plans/:id`. A szerkesztés MVP-re elhagyható, ha van törlés.

> **🟡 Az edzés kész, a terv nem.** A mentett edzés **visszanyitható és
> javítható** (`PUT /api/workouts/:id`) és **törölhető**
> (`DELETE /api/workouts/:id`) — tehát többet kaptunk, mint a doksi minimuma. A
> javítás a saját napján tartja az edzést, és a piszkozat `workout_id`-ja köti
> vissza a meglévő sorhoz; ha közben törlik az edzést, a piszkozat elengedi a
> hivatkozást, de a tartalmát megtartja. **`DELETE /api/plans/:id` továbbra sem
> létezik** — egy elrontott terv ma is örökre ott marad.

### 1.8 Üzemeltethetőség 🟡

- Nincs `/health` végpont — így semmilyen platform nem tudja, él-e a folyamat.
- Nincs kérésnapló és nincs hibanapló (a szerver csak `console.log`-ol induláskor).
- Nincsenek biztonsági fejlécek (CSP, `X-Content-Type-Options`, HSTS).
  Egy `helmet` vagy 15 sornyi saját middleware elég.
- Rate limit **csak a belépésen** van, memóriában. A többi végpont
  bejelentkezést követel, tehát nem nyilvánosan támadható, de egy globális,
  fiókonkénti írás-korlát olcsó biztosíték.

> **🟡 A rate limit kész, a többi nyitott.**
> ✅ A kérés-korlátozás kikerült saját modulba (`server/ratelimit.js`, tesztekkel)
> és **három korlátra bővült**: belépés, regisztráció (forrás szerint kulcsolva,
> mert ez az egyetlen fiók nélküli írás) és minden írás fiókonként.
> ⬜ `/health` végpont továbbra sincs.
> ⬜ Kérés- és hibanapló továbbra sincs (a szerver csak induláskor logol).
> ⬜ Biztonsági fejléc (CSP, `X-Content-Type-Options`, HSTS) továbbra sincs.

---

## 2. MVP-hez erősen ajánlott (P1) ⬜

> **⬜ Ez a szakasz szinte érintetlen.** Az öt tételből négy nyitott, egy
> részben mozdult. Az egyes tételek alatt a részletek.

- **Pihenő-idő mérő (rest timer).** Ez a legfeltűnőbb hiány edzés közben: ma a
  szett bepipálása után semmi nem történik. Egy szett kipipálásakor induló,
  gyakorlatonként állítható visszaszámláló (60/90/120/180 s) az edzésnapló
  legnagyobb használati értékű kiegészítése.

  > **⬜ Nincs meg.** A kódban semmilyen pihenő-mérő nincs; a szett bepipálása
  > ma is csak az autosave-et indítja.
- **„Legutóbb ennyit nyomtál" a szett-sorban.** A `tpl-set-row`
  (`index.html:1072`) ma üres mezőkkel indul. Egy halvány referencia
  (`8 × 60 kg` az előző alkalomról) a legolcsóbb módja annak, hogy a napló
  edzésvezetéssé váljon. Az adat megvan (`getWorkouts`), csak a szett-sorig
  nem jut el.

  > **⬜ Nincs meg.** A `tpl-set-row` ma is üres mezőkkel indul. (Közben viszont
  > bekerült az `exercise_maxes` tábla és a `GET /api/exercise-maxes` — a
  > gyakorlatonkénti csúcsok tehát már számolva vannak, csak nem a szett-sorban
  > jelennek meg.)
- **Az edzés hossza mentődjön.** A `workoutMinutes()` (`js/render/summary.js`)
  `localStorage`-ból számol, és **nem kerül bele a mentett edzésbe** — tehát a
  Korábbi edzésekben nincs időtartam, másik eszközön pedig 0 percet mutat.
  A kezdés időbélyege a piszkozat része kellene legyen.

  > **🟡 Javítva, de nem megoldva.** A `workoutMinutes()` már a kezdés
  > időbélyegéből számol, nem a naptári napból, tehát az **éjfélen átnyúló edzés
  > is a valós hosszát mutatja** (korábban 0 percet írt). A tárolás viszont
  > változatlanul `localStorage`: a `workout_draft` táblában nincs kezdés-oszlop
  > és a `workouts` táblában nincs `minutes` — másik eszközön tehát ma is 0 perc,
  > és a Korábbi edzésekben továbbra sincs időtartam.
- **Onboarding.** Az első belépés ma egy üres app 0%-os készenléttel. Három
  képernyő elég: cél + testadatok (→ ebből a kalória-cél), első testsúly, első
  terv választása sablonból (a 200 kurált gyakorlatból összeállítható 3-4
  kezdő split).

  > **⬜ Nincs meg.** Onboarding-folyam nincs. Egy darab lépés azért bekerült
  > felé: az áttekintőn ott a „Töltsd ki a napi check-int" CTA, ami pont az a
  > *egyetlen első dolog*, amit a 3.3 is javasol.
- **Kezdő terv-sablonok.** Új fiók ma nulla tervvel indul, és a terv-építő
  üres lappal fogadja. 3-4 beépített sablon (Full body 3×, Push/Pull/Legs,
  Felső/alsó) egy koppintással másolható legyen.

  > **⬜ Nincs meg.** Beépített terv-sablon nincs. Ami azóta van: az **edző ki
  > tud osztani tervet** a sportolónak (`plan_assignments`, felajánl → elfogad),
  > ami az edzővel rendelkező felhasználóknál részben kiváltja a sablonokat —
  > az edző nélküli új fiókot viszont ma is üres lap fogadja.

---

## 3. UI/UX — mit szabnék át a tervezeten

### 3.1 Navigáció — ez a legnagyobb tervezési adósság ⬜

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

> **⬜ Változatlan — és időközben nőtt.** A gyűrű ma is négy irányú (Edző,
> Tervek, Edzés, Táplálkozás), a side-nav hat pontos, a breakpoint továbbra is
> 1025px. Alsó tab-sáv nincs. A Regeneráció **szándékosan** maradt le a gyűrűről
> (a kód kommentje ki is mondja), a check-in ugyanígy. Az app viszont azóta
> **tizenegy** oldalra nőtt (bejött a Profil), tehát a tíz-oldal/négy-irány
> aránytalanság csak romlott. Ez maradt a lista legnagyobb érintetlen tétele.

### 3.2 Betöltési állapot ⬜

Az `init()` nyolc végpontot kér le párhuzamosan, és amíg nincs válasz, az app
**a nulla értékeivel áll ott**: 0% készenlét, üres statok, majd minden beugrik
és animálódik. Rossz kapcsolaton ez törött appnak látszik. Kell egy
skeleton-réteg (a kártyák már úgyis dobozosak, olcsó), vagy legalább `—`
placeholder a `0` helyett, és a szám-animáció csak akkor induljon, ha megjött
az adat.

Ugyanez a beégetett `6`-os értesítés-badge (`index.html:108`): minden
oldalbetöltéskor felvillan, mielőtt a valódi szám kiszámolódik.

> **⬜ Változatlan.** Skeleton-réteg nincs (a szó elő sem fordul a kódban), a
> `0` placeholderek maradtak, és a `6`-os badge is beégetve áll
> (`index.html:121`) — csak a sor száma csúszott el. Ez utóbbi ma **kifejezetten
> zavaróbb**, mint augusztusban: az értesítések azóta valósak, tehát egy friss
> fiók hat nem létező értesítést villant fel, mielőtt kiderül, hogy nulla van.

### 3.3 Üres állapotok új fióknál 🟡

Az üres állapotok szövegei külön-külön jók („Még nincs mentett edzésed…"), de
**az első benyomás egésze nincs megtervezve**. Egy friss fiók a dashboardon
0%-ot lát magyarázat nélkül, a Regeneráción demo-testsúlygörbét, az Edzőn öt
kitalált sportolót. Ezt egyben kell megtervezni: mit lát az ember a 0.
percben, és mi az egyetlen dolog, amit ilyenkor csinálnia kell. (Javaslat:
„Töltsd ki az első check-int" — ez egy lépésben feloldja a készenlétet is.)

> **🟡 A javaslat megvalósult, az összkép nem.** Az áttekintőn ott a „Töltsd ki
> a napi check-int" CTA (`data-checkin-cta`), ami kitöltés után eltűnik, és a
> ≥1280px-es rács külön elrendezést vált rá — tehát pontosan az az *egyetlen
> első dolog* megvan, amit a szakasz javasol. Az Edzőn már nem öt kitalált
> sportoló fogad. Nyitott maradt: a Regeneráción **még mindig demo-testsúlygörbe
> van**, és a 0. perc egésze továbbra sincs egyben megtervezve.

### 3.4 Desktop-elrendezés 🟡

A tartalom desktopon is egyoszlopos, 640–760px-re korlátozva. 1440px-es
képernyőn ez sok üres hely, miközben az Áttekintés és a Regeneráció oldal
tele van egymás alá pakolt kártyával, amiből 3-4 elférne egymás mellett. A
tokenek (`--page-max-wide`, `--dashboard-max-wide`) megvannak hozzá, csak a
rács hiányzik: ≥1280px-en a dashboard-statok és a Regeneráció kártyái
kerüljenek 2-3 oszlopos gridbe.

> **🟡 A dashboard megkapta, a Regeneráció nem.** ≥1280px-en a dashboard valódi
> `grid-template-areas`-os, kétoszlopos elrendezés lett, és a rács **állapotot is
> vált**: amíg a mai check-in hiányzik, az emlékeztető tölti ki a jobb oszlopot.
> A többi oldal a `--page-max-wide`-ra szélesedik, de a **Regeneráció kártyái ma
> is egy oszlopban állnak**.

### 3.5 Világos téma ⬜

Nulla `prefers-color-scheme` szabály van a CSS-ben — az app csak sötét. Ez
önmagában védhető terméki döntés, de a token-rendszer (`--surface-*`,
`--text-*`, `--border-*` szemantikus aliasok) **már fel van rá készítve**:
egy világos paletta lényegében a `:root` felülírása. Kültéri/edzőtermi
használatnál ez valódi különbség. Nem MVP-blokkoló, de a ráfordítás/haszon
arány itt a legjobb az egész listán.

> **⬜ Változatlan.** Ma is **nulla** `prefers-color-scheme` szabály van a
> CSS-ben. A token-rendszer viszont azóta is bővült és konzisztens maradt, tehát
> a megállapítás — hogy ez a lista legjobb ráfordítás/haszon aránya — továbbra
> is áll.

### 3.6 Edzés közbeni ergonómia 🟡

- A **fejléc-sor** (`Szett · Ism. · Súly·kg · RPE`) `aria-hidden`, tehát a
  mértékegység csak vizuálisan van jelen — képernyőolvasóval a három szám
  megkülönböztethetetlen. A mezők kapjanak saját `aria-label`-t.
- **Tárcsa-számoló** (plate calculator): a súlymező `step="2.5"`, ami jó
  irány, de a „mit tegyek a rúdra" kérdést nem válaszolja meg.
- **Jegyzet gyakorlatonként** nincs (technika-emlékeztető, fájdalom).
- A **szuperszett** és a **szett-típus** két különböző saját lenyíló mintát
  használ ugyanabban a kártyában — érdemes egyetlen mintára hozni.

> **🟡 A két olcsó tétel kész, a két drágább nyitott.**
> ✅ A szett-mezők kaptak `aria-label`-t, méghozzá pozíció szerintit
> („3. szett — súly kilogrammban"), és a mezők törlés/hozzáadás után
> újraszámozódnak — a képernyőolvasós megkülönböztethetetlenség megszűnt.
> ✅ A szuperszett és a szett-típus **egyetlen lenyíló mintára** került; közben
> a szett-típus drop settel is bővült (bemelegítő / munkasorozat / drop set).
> ⬜ Tárcsa-számoló (plate calculator) nincs.
> ⬜ Gyakorlatonkénti jegyzet nincs.

### 3.7 Táplálkozás 🟡

- **Csak a mai nap létezik.** Nincs visszalapozás korábbi napokra, pedig az
  adat megvan (`nutrition_log` dátummal). Egy dátumléptető a fejlécben olcsó.
- **Nincs étkezés-bontás** (reggeli/ebéd/vacsora/snack) — a napi lista egy
  kupac.
- **Nincs saját étel és nincs recept.** 437 étel sok, de a saját reggelijét
  senki nem fogja 437-ből kikeresni minden reggel. Kell: „Gyakori" /
  „Legutóbbi" gyorslista a kereső fölé, és saját étel felvétele.
- A **makró-cél** csak kalória + fehérje; a szénhidrát/zsír meg van jelenítve,
  de cél nélkül. Vagy legyen mind a négyhez cél, vagy tűnjön el a látszat.

> **🟡 A legnagyobb tétel kész, a többi nyitott.**
> ✅ **Saját étel felvétele megvan** — sőt, többel, mint amit a szakasz kért:
> a makrókat külön adod meg és a kalóriát az app számolja (Atwater 4/4/9,
> felülírható), a szerver mindkét ágat validálja, és a lenaplózott tételeket a
> saját étel törlése nem írja át (a `nutrition_log` másolatban tárolja a nevet
> és a makrókat). Mellé jött egy **vonalkód-olvasó** (natív `BarcodeDetector` →
> lusta ZXing → kézi beírás) és egy szerver-oldali Open Food Facts proxy
> gyorsítótárral — ez a listán nem is szerepelt.
> ✅ A **mai napló** listája megvan, tételenként törölhető.
> ⬜ Dátumléptető (visszalapozás korábbi napokra) nincs.
> ⬜ Étkezés-bontás (reggeli/ebéd/vacsora/snack) nincs.
> ⬜ „Gyakori" / „Legutóbbi" gyorslista nincs — a saját étel ezt csak részben
> váltja ki: a felvitt terméket ugyanúgy ki kell keresni.
> ⬜ A makró-cél továbbra is csak kalória + fehérje.

### 3.8 Check-in 🟡

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

> **🟡 Az adathiba javítva, a szerződés törékeny maradt.**
> ✅ Az **alvás-tartomány egységes**: a varázsló és a részletes űrlap is 0–24,
> ahogy a szerver. A 13 órát tehát már a varázslóban is lehet rögzíteni.
> 🟡 Az átjárás félig megvan: a varázsló összegzőjéről mentés után egy
> „Vissza a regenerációhoz" link visz a részletes űrlap oldalára — de ez
> mentés **utáni kilépő** link, nem a „Több adatot adnék meg" átjárás.
> ⬜ A `PUT /api/checkin` **továbbra is teljes sort cserél** (`saveCheckin`
> minden oszlopot felülír az `excluded` értékkel), tehát a törékeny „carried"
> szerződés a kliensben él. A javasolt merge-elő (`PATCH`-szerű) végpont nem
> készült el — és ez a kockázat azóta nőtt, mert a check-in mezői bővültek.

### 3.9 Apróságok, amik olcsók és látszanak ⬜

- A **flow-oldalakról** (terv-építő, gyakorlat-választó, összegző) csak a
  saját vissza-gombjuk visz ki; a nav-gyűrű onnan is működik, de vizuálisan
  nincs jelezve, hogy ezek „modális" oldalak.
- Az **összegző** két statot mutat (szett, perc). Idekívánkozik az
  össztonnatömeg és a PR-ok neve — az adat mind megvan.
- A **`--fs-2xs: 11px`** mobilon még mindig kicsi a feliratokhoz; desktopon
  13px-re nő, tehát a skála ismert — mobilon is elbírna 12px-et.

> **⬜ Mind a három nyitott.** A flow-oldalak vizuális „modális" jelölése nincs;
> az összegző ma is pontosan két statot mutat (szett, perc) — pedig az
> össztonnatömeghez és a PR-nevekhez azóta még több adat van (`exercise_maxes`);
> a `--fs-2xs` mobilon változatlanul 11px, desktopon 13px.

---

## 4. Amit MVP-re NEM kell megcsinálni ✅

Hogy a lista ne hízzon: ezek most **helyesen** vannak nyitva hagyva.

- HRV/pulzus-integráció — nincs adatforrás, kitalált szám nem kerül a képletbe.
- Aszinkron SQLite / worker thread — a mérés szerint 8 ms/kérés, nem szűk
  keresztmetszet.
- A maradék 53 lefordítatlan gyakorlat és a származtatott `load` súlyok
  finomhangolása — a 200 kurált gyakorlat felülírja őket ott, ahol számít.
- Címke-heurisztika (Összetett/Izolációs) — csak a kártyán látszó felirat.
- Volumen-diagram bemelegítő-szűrése — terméki döntés, a felirat ma is igaz.

> **✅ A halasztás tartotta magát — egy tétel kivételével.** A HRV, az aszinkron
> SQLite, a címke-heurisztika és a volumen-szűrés továbbra is helyesen van nyitva
> hagyva. A **gyakorlat-adatok** viszont azóta mégis kaptak egy kört: 40 új
> gyakorlat került be és a félrecímkézések ki lettek javítva — tehát az „53
> lefordítatlan gyakorlat" tétel nem ott áll, ahol a doksi hagyta.
>
> Az aszinkron SQLite halasztása külön is megerősítést kapott: a
> `/api/dashboard` közben 265 ms-ról 23 ms-ra gyorsult **anélkül**, hogy a
> tárolási réteghez hozzá kellett volna nyúlni.

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

> **Hol tart a sorrend (08-27).**
> **1. szakasz** — az időzóna kész, a demo-tartalom háromnegyede kivezetve, a
> perzisztencia láthatóvá téve; **a fiókonkénti táplálkozási cél és a profil
> viszont teljesen érintetlen**, és a szakasz emiatt nem zárható le.
> **2. szakasz** — a mentett edzés javítása/törlése és a fióktörlés kész; a
> terv törlése, az elfelejtett jelszó, a `/health`, a hibanapló és a biztonsági
> fejlécek nyitottak.
> **3. szakasz** — érintetlen (a navigáció, a pihenő-idő mérő, a „legutóbb ennyit
> nyomtál", a betöltési állapotok és az onboarding mind nyitott).
> **4. szakasz** — a táplálkozásból a saját étel a sorrendet megelőzve elkészült
> (a vonalkód-olvasóval együtt), a check-in alvás-tartománya egységesítve; a
> világos téma és a desktop rács maradt.
>
> A sorrend logikája tehát áll, de a végrehajtás nem a szakaszok sorrendjét
> követte: a 4. szakaszból van kész tétel, miközben az 1. szakasz legnagyobb
> eleme (profil + célok) még el sem kezdődött.

---

## 6. Felülvizsgálat, 2026-08-27 — hol tart a lista

Ez a szakasz a felülvizsgálatkor készült; az 1–5. szakasz eredeti szövege
változatlan.

### Ami elkészült (✅)

| Tétel | Hol |
| --- | --- |
| 1.4 Időzóna | `X-Client-Date` + validáció, `server/timezone.test.js` |
| 1.1 Edzői panel, edző-chat, szerepkörök, értesítések | valódi `coach_links` / `messages` / `notifications.js` |
| 1.3 Fióktörlés | `POST /api/auth/delete-account` |
| 1.7 Mentett edzés javítása és törlése | `PUT` + `DELETE /api/workouts/:id` |
| 1.8 Rate limit kiterjesztése | `server/ratelimit.js` — belépés, regisztráció, írások |
| 3.6 Szett-mezők `aria-label`-je | pozíció szerinti címkék |
| 3.6 Egységes lenyíló minta | szuperszett + szett-típus |
| 3.7 Saját étel (+ vonalkód-olvasó) | `custom_foods`, `barcode_cache`, `openfoodfacts.js` |
| 3.8 Alvás-tartomány egységesítése | 0–24 mindkét felületen |
| 3.4 Dashboard-rács ≥1280px | állapotfüggő `grid-template-areas` |
| 3.3 „Első dolog" CTA | `data-checkin-cta` az áttekintőn |

### A hat legfontosabb, ami maradt

1. **A globális 2900 kcal / 170 g táplálkozási cél (1.2).** Ez az egyetlen
   megmaradt P0-blokkoló, ami **aktívan hamis adatot** mutat mindenkinek, aki
   nem 90 kg-os férfi — és a készenlét-számításba is beszivárog.
2. **A testsúly seed-görbe és a technika-videó demo-tartalma (1.1).** A demo
   kivezetése háromnegyedéig eljutott; ez a két maradék tétel viszont pont az
   első benyomásban van benne.
3. **`DELETE /api/plans/:id` (1.7).** Az edzésnél megvan a törlés, a tervnél
   nincs — egy elrontott terv ma is örökre ott marad.
4. **Elfelejtett jelszó (1.3).** Aki kizárja magát, nem tud visszajutni.
5. **`/health`, hibanapló, biztonsági fejlécek (1.8).** Együtt egy fél napos
   munka, és nélkülük egyik platform sem tudja, él-e a folyamat.
6. **A navigáció (3.1).** A lista legnagyobb érintetlen tétele, és azóta
   **romlott**: az app tizenegy oldalra nőtt, a gyűrű maradt négy irányú.

### Amit érdemes újragondolni a listán

- **A `PUT /api/checkin` teljes-sor-csere (3.8)** ma nagyobb kockázat, mint
  augusztusban: a check-in mezői bővültek, tehát több múlik a kliens „carried"
  listáján. Ezt felvenném a P0 mögé.
- **A beégetett `6`-os értesítés-badge (3.2)** apróságnak indult, de mióta az
  értesítések valódiak, egy friss fiók hat nem létező értesítést villant fel.
  Egysoros javítás.
- **A P1-lista (2.)** gyakorlatilag érintetlen. Ha az MVP-küszöb a cél, a
  pihenő-idő mérő és a „legutóbb ennyit nyomtál" továbbra is a két legjobb
  ráfordítás/haszon arányú tétel az edzésnaplóban.
