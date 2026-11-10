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

Témavezető: Fogarasi András, szakoktató, Kaposvári Informatika Ágazati Képzőközpont, Kaposvár

Lehetséges OTDK szekció: Informatika

Kaposvár

2026.

---

**PODIUM**

Podium

Készítette: Kovács Valter, Dausek Csanád, Peresztegi Viktor Zsolt, Kaposvári Informatika Ágazati Képzőközpont, Szoftverfejlesztő és -tesztelő technikus, Kaposvár

Témavezető: Fogarasi András, szakoktató, Kaposvári Informatika Ágazati Képzőközpont

Aki rendszeresen edz, ma gyakran két-három külön alkalmazást használ: egyet az edzései naplózására, egyet az étkezése követésére, és nem ritkán egy harmadikat is a pihenés figyelésére. Ezek nem tudnak egymásról, ezért az adataikat semmi nem kapcsolja össze, és nem derül ki például, hogy egy rosszul átaludt éjszaka után érdemes-e keményen edzeni. A személyi edzők pedig sokszor táblázatokban, papíron vagy üzenetváltásokban követik a klienseiket, ami nehezen átlátható és pontatlan.

Célunk egy olyan alkalmazás elkészítése volt, amely mindezt egy helyen kezeli, és az adatokat össze is kapcsolja. A Podium böngészőből, telepítés nélkül használható telefonon és számítógépen is. A felhasználó naplózhatja az edzéseit, előre megtervezheti őket, követheti, mit evett és ivott, és minden reggel röviden megadhatja, hogyan aludt, mennyire fáradt és hol érez fájdalmat. Egy felhasználó ugyanazzal a fiókkal egyszerre lehet sportoló és edző is.

Az alkalmazás legfontosabb része a regenerációs modul. Ez az edzésekből, az étkezésből és a reggeli állapotfelmérésből naponta kiszámolja, mennyire áll készen a sportoló egy újabb edzésre, összességében és tizenkét izomcsoportra külön is. Okosóra vagy más mérőeszköz nem kell hozzá. A számítás a sporttudományban elfogadott mérőszámokra épül, például a maximális erő becsült értékére és arra, hogy a sportoló mennyire érezte nehéznek az edzést; ezeket saját modellben kapcsoltuk össze. Az eredményt egy 0 és 100 közötti napi pontszám mutatja (minél magasabb, annál kipihentebb a sportoló), és az alkalmazás azt is megmutatja, mi befolyásolta. Erre építve konkrét gyakorlatokat és súlyokat is javasol. Ha a sportoló valamelyik izmában erős fájdalmat jelez, az azt terhelő gyakorlatokat aznap nem ajánlja.

A személyi edző meghívhatja a klienseit. Egy kliens adatait csak akkor látja, ha az illető elfogadta a meghívást. Ezután edzéstervet és étrendet oszthat ki neki, üzenetet válthat vele, és nyomon követheti a fejlődését. A felhasználók adatait jelszóvédelem és hozzáférés-korlátozás védi: egy felhasználó adatait csak ő maga és az általa elfogadott edző láthatja.

Az alkalmazást hárman fejlesztettük, egy mesterséges intelligencián alapuló programozási segéd támogatásával. A működést 788 automatikus teszt, vagyis gép által elvégzett ellenőrzés vizsgálja, és mindegyik sikeres. A Podium működő rendszer. Nyilvános internetcímen még nem érhető el, de egy számítógépen elindítva böngészőből kipróbálható. A következő lépés a pontszám kipróbálása valódi sportolókkal, ezenkívül egy edzés közbeni sérülésjelző gombot és az okosóra-adatok felhasználását tervezzük.

---

# **1\. Bevezetés**

## **1.1 A projekt célja**

Projektünk célja egy olyan fitnesz alkalmazás fejlesztése, amely egy helyen kezeli az edzésnaplózást, a táplálkozás, valamint a regeneráció követését, ezzel segítve az emberek fejlődését. Külön alkalmazások helyett minden egy helyen megtalálható és összeegyeztethető. Lehetősége van továbbá a személyi edzőknek, hogy kapcsolatot létesítsenek klienseikkel, és könnyebben továbbítsák az edzésterveket, étrendeket. Alkalmazásunk fő különlegessége a Recovery Engine, mely segíti nyomon követni a felkészültséget, és elkerülni az esetleges sérüléseket.

## **1.2 Megoldandó problémák**

A legtöbb személyi edző Excel táblázatokban, papíron vagy chatekben követi klienseit. Ezek a módszerek nem pontosak, és sokkal nehezebb átlátni őket. A sportolók sokszor csak az érzéseikre tudnak hagyatkozni, így nem feltétlenül tudják megítélni, mennyire állnak készen egy keményebb edzésre, vagy túlzottan visszavesznek az intenzitásból. Ezek jobb esetben csak visszavetik a fejlődést, rosszabb esetben akár sérüléshez is vezethetnek.

A fejlődés pontosabb követéséhez legalább 3 külön alkalmazást kell használni, melyek nem kapcsolódnak egymáshoz, így azok az aspektusok, amelyek ezeknek az alkalmazásoknak az adataiból következtethetők ki, gyakran figyelmen kívül maradnak. Alkalmazásunk ezeknek a problémáknak a kiküszöbölését nyújtja.

## **1.3 Célfelhasználó csoport**

Alkalmazásunk elsősorban a rendszeresen edzeni járó embereket célozza meg. Lehet akár csak hobbista, profi vagy félprofi, testépítő vagy erőemelő, mindenkinek képes kielégíteni az igényeit. Továbbá azoknak a személyi edzőknek is hasznára válhat, akik sok különböző adottságú klienssel foglalkoznak. Egy fiók lehet egyszerre személyi edző és kliens is.

## **1.4 Fő funkciók listája**

* Regisztráció/Belépés: minden felhasználónak csinálnia kell egy személyre szabott fiókot, hogy legyenek kezdő adatok a számításokhoz, valamint hogy az adataik biztonságban legyenek.

* Edzésnapló: a felhasználók itt tudják naplózni az edzés során végzett gyakorlatokat, az ismétlésszámot, valamint a használt súlyt, és ezek az adatok automatikusan mentésre kerülnek.

* Edzéstervek: a felhasználó itt előre elkészítheti, hogyan fognak kinézni az edzései. Ezeket napokra is ütemezheti, így választáskor az adott napra ütemezett terveket fogja elsősorban ajánlani. Ezeket a személyi edző is kioszthatja.

* Táplálkozás követés: a felhasználók az széles étel-katalógusából választják ki, mit ettek, valamint vonalkód-olvasóval is naplózhatják az étkezésüket,amely az [openfoodfacts.org](http://openfoodfacts.org) adatbázisát használja fel amennyiben a mi adatbázisunkba nem található, illetve új ételeket is hozzáadhatnak az adatbázishoz. Ezeknek az ételeknek a makróadatai alapján számolja alkalmazásunk a bevitt kalóriát, amely segít a kalóriacél megtartásában. Ezt a felhasználók beállíthatják.

* Napi check-in: ezen funkción belül a felhasználó megadhatja az alvás mennyiségét és minőségét, a stressz szintjét, az izomláz és a fájdalom mértékét és helyét, valamint a testsúlyváltozását. Ebből az alkalmazás ki tudja számolni a nap eleji felkészültséget.

* Recovery Engine: a felhasználó által végzett edzésekből, táplálkozásból, valamint a napi check-in adataiból készenléti pontszámítás és izomregeneráció-követés. Ezek alapján az aznapi edzéshez gyakorlatokat vagy megedzendő izomcsoportokat ajánl.

* Edzői panel: itt a személyi edzők a meghívott klienseiket követhetik nyomon. Kliensei fejlettségéről, tudásáról játékokhoz hasonló sportolói kártyát láthat, kioszthat és nyomon követhet edzésterveket, étrendeket rakhat össze, valamint kommunikálhat klienseivel egy chat funkción belül.

# **2\. Célkitűzés**

Az 1.2 alfejezetben leírt probléma lényege, hogy az edzés, az étkezés és a pihenés adatai külön alkalmazásokban maradnak, így nem derül ki például, hogy egy rossz éjszaka után érdemes-e keményen edzeni. Fő célunk ezért egy olyan alkalmazás volt, amely mindezt egy helyen kezeli, és az adatokat össze is kapcsolja. Ezt öt részcélra bontottuk, és mindegyiknél azt is meghatároztuk, miből látszik, hogy sikerült.

**1. Minden egy helyen.** Az edzés, a táplálkozás és a pihenés követése egyetlen fiókban történjen, és az alkalmazás ezeket az adatokat együtt értékelje. *Akkor sikerült,* ha mindhármat ugyanabban az alkalmazásban lehet rögzíteni, és a napi pontszám (lásd a 2. célt) kiszámításakor az alkalmazás mindhármat figyelembe veszi.

**2. A felkészültség becslése.** Az alkalmazás naponta mondja meg egy 0 és 100 közötti pontszámmal, mennyire áll készen a sportoló egy újabb edzésre, összességében és izomcsoportonként is. Ez segíthet a túledzés és a sérülések megelőzésében. *Akkor sikerült,* ha minden olyan napon, amelyről van adat, elérhető a napi pontszám, az alkalmazás azt is megmutatja, hogyan számolta ki, és a számítás a szándékunk szerint viselkedik (ezt előre megírt próbahelyzetek ellenőrzik).

**3. Kapcsolat az edzővel.** A személyi edző egy helyen követhesse a klienseit, és edzéstervet, étrendet adhasson nekik. A sportoló adatait azonban csak akkor lássa, ha a sportoló ehhez hozzájárult. *Akkor sikerült,* ha az edző a meghívás elfogadása előtt a sportoló nevén kívül semmit nem lát róla, utána ki tudja osztani a terveit, és miután a sportoló megszüntette a kapcsolatot, az edző ismét semmit nem lát.

**4. Biztonság.** A felhasználók adatai legyenek védve: más fiókjának adataihoz senki ne férjen hozzá, kivéve a sportoló által elfogadott edzőt. *Akkor sikerült,* ha automatikus tesztek igazolják, hogy más fiók adatát nem lehet lekérni, és a jelszavak nem olvasható formában tárolódnak.

**5. Könnyű használat.** Az alkalmazás telepítés nélkül, a böngészőből működjön telefonon és számítógépen is, magyar nyelven. *Akkor sikerült,* ha a felület keskeny telefonképernyőn és széles asztali képernyőn is külön, a mérethez igazított elrendezést kap, és a fő funkciók mindkettőn elérhetők.

# **3\. Szakirodalmi áttekintés**

Ebben a fejezetben először azt mutatjuk be, milyen megoldások léteznek már, utána azt, milyen szoftvereket, adatforrásokat, szakmai módszereket és segédeszközöket használtunk, és melyiket mire.

## **3.1 Meglévő megoldások**

Edzéshez és egészséges életmódhoz sok, széles körben használt alkalmazás érhető el. A legtöbb egy-egy területre összpontosít:

- **edzésnaplók** (például Strong, Hevy): a gyakorlatok, a sorozatok (egy gyakorlat egymás utáni ismétlései) és a súlyok rögzítésére; egyesek (például a Fitbod) az edzésnaplóból izomcsoportonként is becslik a regenerációt;
- **kalória- és étrendnaplók** (például MyFitnessPal): az étkezés követésére;
- **regenerációt mérő eszközök** (például a Whoop karpánt, az Oura gyűrű vagy a Garmin okosórái): a viselt eszköz méri az alvást és a pulzust, és ebből napi felkészültségi értéket ad – ehhez azonban külön eszközt kell vásárolni, egyes esetekben havi előfizetéssel;
- **edzői alkalmazások** (például Trainerize): a személyi edző és a kliensei közötti kapcsolattartásra és a tervek kiosztására; ezekben edzés- és ételnapló is van.

Vannak tehát olyan alkalmazások, amelyek két-három területet már összekötnek. A Podium abban tér el tőlük, hogy egyszerre:

- okoseszköz nélkül, a sportoló naplózott edzéseiből és reggeli válaszaiból számol napi felkészültséget;
- ezt izomcsoportonként is megteszi, és erős fájdalomnál kihagyja az érintett izmot terhelő gyakorlatokat;
- megmutatja, mi alakította a pontszámot;
- az edző a sportoló beleegyezésével ugyanitt látja mindezt;
- magyar nyelvű, és böngészőből, telepítés nélkül használható.

## **3.2 Fejlesztői környezet és szoftverek**

A Podium webes alkalmazás: a felhasználó a böngészőjében nyitja meg, telepíteni nem kell. Két része van. Az egyik a böngészőben fut, ezt látja a felhasználó: a képernyőket, a gombokat, az űrlapokat. A másik a szerver, vagyis egy háttérben futó program, amely tárolja az adatokat és elvégzi a számításokat.

A szervert a Node.js futtatja. Ez egy ingyenes program, amellyel a szervert ugyanazon a programozási nyelven, JavaScriptben írhattuk meg, mint a böngészőben futó részt (OpenJS Foundation, 2026c). Így az egész alkalmazás egyetlen nyelven készült, ami megkönnyítette a közös munkát. A Node.js-ben beépített tesztelő eszköz is van. Ezzel ellenőriztük automatikusan, hogy a program a változtatások után is helyesen működik-e.

A böngésző és a szerver közötti „levelezést” az Express nevű program intézi (OpenJS Foundation, 2026b). Ha a felhasználó például elmenti az edzését, a böngésző kérést küld a szervernek. Az Express fogadja a kérést, továbbadja a megfelelő programrésznek, és visszaküldi a választ.

Az adatokat, vagyis a fiókokat, az edzéseket, az étkezéseket és a reggeli állapotfelméréseket, az SQLite tárolja (Hipp, 2026). Az SQLite egy kis adatbázis-program, amely minden adatot egyetlen fájlban tart, így nem kell hozzá külön adatbázis-szervert telepíteni és üzemeltetni. Szóba jöhetett volna egy nagyobb, külön futó adatbázis-szerver is (például PostgreSQL), de egy iskolai projektnél, ahol kevés a felhasználó, az egyetlen fájl egyszerűbb. Hátránya, hogy nagyon sok egyidejű felhasználót nem tudna kiszolgálni.

A böngészőben futó részt nem egy kész keretrendszerrel, vagyis előre megírt, általános programvázzal (például React) írtuk, hanem a böngésző saját eszközeivel. Ennek előnye, hogy a program előkészítő, úgynevezett fordítási lépés nélkül azonnal futtatható. Hátránya, hogy több mindent magunknak kellett megírnunk.

Az ételek vonalkódját a telefon vagy a számítógép kamerájával lehet beolvasni. Ehhez elsősorban a böngésző beépített vonalkód-felismerőjét használjuk. Ahol ez nem érhető el, ott a ZXing nevű, szabadon használható programkönyvtár ismeri fel a vonalkódot a kameraképen (zxing-js, 2024). A programkönyvtár mások által megírt, kész programrész, amelyet beépíthetünk a saját alkalmazásunkba. Ha a kamera nem használható, a vonalkód számát kézzel is be lehet írni.

A program szövegét forráskódnak nevezik. Ennek rendben tartásához két segédeszközt használtunk. Az ESLint átnézi a forráskódot, és figyelmeztet a gyakori hibákra (OpenJS Foundation, 2026a). A Prettier egységes formára hozza a forráskódot, így mindhármunk kódja ugyanúgy néz ki (Prettier, 2026). Ezek a felhasználó számára nem láthatók, de kevesebb hibát és könnyebben olvasható programot eredményeznek.

## **3.3 Adatforrások**

Azért, hogy a felhasználónak ne kelljen minden ételt és gyakorlatot kézzel beírnia, az alkalmazás saját és nyilvános adatgyűjteményekre épít.

Az alkalmazás egy saját, 437 ételből álló magyar katalógussal indul. Az ételek tápértékei (kalória, fehérje, szénhidrát, zsír) általános tápanyagtáblázatok jellemző, kerekített értékei. Egy bolti termék valódi értéke ettől eltérhet, ezért a pontos címkeadatot a felhasználó saját ételként is felviheti. Ha a felhasználó beolvas egy vonalkódot, és a termék a katalógusban nincs meg, az alkalmazás az Open Food Facts adatbázisából kérdezi le (Open Food Facts, 2026). Ez önkéntesek által épített, bárki számára szabadon használható, nemzetközi élelmiszer-adatbázis.

A gyakorlatkatalógus 1441 gyakorlatból áll. Ebből 200-at mi állítottunk össze kézzel, a többi 1241-et Yıldırım (2026) 1324 gyakorlatot tartalmazó nyilvános gyűjteményéből vettük át, magyarra fordított névvel; a gyűjtemény többi gyakorlatát (például a nyakgyakorlatokat és a saját listánkkal egyezőket) kihagytuk. A gyűjtemény minden gyakorlatnál megadja a megdolgoztatott izmokat és a szükséges eszközt. A gyakorlatok többségét bemutató képek és rövid animációk a Gym visual nevű oldal alkotásai (Gym visual, n.d.). A gyűjtemény ezeket a jogtulajdonos engedélyével adja közre, és mi is a szerző feltüntetésével használjuk őket. A nyilvános indulás előtt a felhasználási feltételeket a jogtulajdonossal még külön tisztázni kell.

Az alkalmazás azt is megmutatja, hol tart a felhasználó egy gyakorlatban az azonos nemű, hasonló testsúlyú és korú emberekhez képest. Ezt nevezzük erőszintnek. Ehhez a Strength Level weboldal erő-összehasonlító táblázatait vettük alapul (Strength Level, 2026). Ezek a weboldal felhasználói által feltöltött eredményekből készülnek. A mérce így rendszeresen edző emberekhez viszonyít, nem a teljes népesség átlagához. A táblázatok felhasználási feltételeit a nyilvános indulás előtt szintén tisztázni kell.

## **3.4 Szakmai módszerek**

Az alkalmazás néhány, a sporttudományban elfogadott és széles körben használt módszerrel számol. Ezek összekapcsolását, vagyis a napi pontszám kiszámítását, mi határoztuk meg a programozási segéd közreműködésével; ezt az alfejezet végén írjuk le.

**A maximális erő becslése.** Fontos mérőszám, hogy valaki egy gyakorlatban mekkora súlyt tudna egyetlenegyszer felemelni. Ennek a neve egyismétléses maximum, angol rövidítéssel 1RM. Ezt ténylegesen lemérni megterhelő és balesetveszélyes, ezért az alkalmazás becsli abból, hogy a felhasználó egy adott súllyal hány ismétlést tudott elvégezni. Ehhez Epley (1985) képletét használjuk, amely az egyik legrégebbi és legelterjedtebb ilyen becslés. Ebből számoljuk a személyes rekordokat és az erőszintet is (lásd 3.3). A képlet kevés ismétlésnél megbízható, sok (nagyjából tíznél több) ismétlésnél viszont egyre pontatlanabb. Egyetlen ismétlésnél a becslés az alkalmazásban maga a felemelt súly, mert az eredeti képlet ilyenkor is hozzáadna néhány százalékot.

**Az érzett megterhelés.** A felhasználó minden sorozatnál megadhatja egy 1-től 10-ig terjedő skálán, mennyire érezte nehéznek. Ennek angol rövidítése RPE, magyarul az érzett megterhelés értéke. A súlyzós edzésnél Zourdos és mtsai (2016) skáláját követjük. Ezen a skálán a szám azt fejezi ki, milyen közel jutott a sportoló a teljes kifáradáshoz: a 10-es azt jelenti, hogy egyetlen további ismétlést sem tudott volna elvégezni, a 8-as azt, hogy még kettőt. Ebből az alkalmazás látja, mennyire közelítette meg a sportoló a teherbírása határát, és ez alapján becsli az izmok fáradását.

**A kardióedzés terhelése.** Futásnál, kerékpározásnál és hasonló edzéseknél Foster és mtsai (2001) módszerét használjuk: az edzés hosszát percben megszorozzuk az edzés nehézségét jelző számmal. A nehézséget a sportoló öt fokozat közül választja ki (az alkalmazás feliratai: „Nagyon könnyű”, „Könnyű”, „Közepes”, „Magas”, „Maximális”). Ezeket Borg (1982) 0–10-es skálájának arra a változatára fordítjuk le, amelyet Foster és mtsai (2001) használtak: 1, 2, 3, 5 és 8 pont. A legfelső fokozat azért 8 és nem 10, mert egy teljes edzés a bemelegítéssel és a pihenőkkel együtt nem lehet végig maximális. Így egy hosszú, könnyű futás és egy rövid, kemény edzés terhelése ugyanazon a mércén összevethető, és a regeneráció számításánál a súlyzós edzésekkel együtt vehető figyelembe. Az izomcsoportonkénti számítás a kardióedzést még nem veszi figyelembe, mert ahhoz mozgásformánként külön meg kellene adni, melyik izmot mennyire terheli.

**Miért kérdőív, és miért nem okosóra?** A sportolók fáradtságának követésére a szakirodalom kétféle jelet használ: viselhető eszközzel mért élettani adatot (például a pulzus változékonyságát) és rövid kérdőívet. Mivel a Podium okoseszköz nélkül működik, nálunk a reggeli kérdőív kapja a nagyobb szerepet. A modell tervezésekor megvizsgáltuk a terhelésfigyelésben elterjedt „akut–krónikus terhelési arányt” is, vagyis az elmúlt hét és az elmúlt négy hét terhelésének hányadosát. Ezt nem vezettük be, mert Impellizzeri és mtsai (2020) szerint ennek a mutatónak elvi és számítási problémái vannak. Helyette a terhelés fokozatos lecsengését számoljuk.

**Hogyan áll össze a napi pontszám?** A regenerációs modul a fenti mérőszámokból és a reggeli állapotfelmérésből naponta egy 0 és 100 közötti pontszámot számol: minél magasabb, annál kipihentebb a sportoló. A pontszám több összetevő súlyozott átlaga. Az összetevők alapsúlya: alvás 25, izmok állapota 15, energiaszint 15, az elmúlt napok edzésterhelése 15, stressz 10, közérzet 10, táplálkozás 5; a pontszám ezek arányában számol. Ha a sportoló valamelyik kérdést kihagyja, annak súlya arányosan szétoszlik a többi között, és az alkalmazás kiírja, melyik adat hiányzott a számításból. Amíg kevés az előzmény, az alkalmazás azt is jelzi, hogy a becslés kevésbé megbízható.

Az edzés okozta fáradtság nem egyik napról a másikra tűnik el, hanem fokozatosan cseng le. Ezt Calvert és mtsai (1976) edzésmodelljének fáradtsági része alapján számoljuk. A kis izmok (például a bicepsz) gyorsabban állnak helyre, a nagy, nyújtott helyzetben is erősen terhelt izmok (például a combhajlító izmok és a farizom) lassabban, az idegrendszer pedig a modellünkben még lassabban. Minden terhelést a sportoló saját, az elmúlt 28 napban mért átlagához is viszonyítunk, így annak, aki rendszeresen nagyobb terhelést visel, ugyanaz az edzés kevesebbet számít. Amíg kevés az előzmény (hat edzésnapnál kevesebb), az alkalmazás egy általános, testsúlyhoz igazított mércét is bekever. A reggeli kérdések közül négy (energiaszint, stressz, izomláz, alvásminőség) Hooper és Mackinnon (1995) túledzés-figyelő kérdőívére épül, nálunk egyszerűbb, 1–5-ös skálán. Ha a sportoló valamelyik izmában legalább 7-es erősségű fájdalmat jelez a 10-es skálán, az alkalmazás az azt terhelő gyakorlatokat nem ajánlja.

Fontos kimondanunk, hogy az összetevők súlyát és a regeneráció ütemét mi választottuk meg a szakirodalom alapján. Ezek saját becslések: valódi sportolókon végzett vizsgálattal nem igazoltuk.

## **3.5 Mesterséges intelligencián alapuló segédeszköz**

A fejlesztés során a Claude Code nevű, mesterséges intelligencián alapuló programozási segédet használtuk (Anthropic, 2026). Az eszköz egy nagy nyelvi modellre épül, vagyis olyan mesterséges intelligenciára, amelyet nagy mennyiségű szövegen és forráskódon tanítottak be. Magyarul is el lehet mondani neki, mit szeretnénk, az eszköz pedig javaslatot tesz, programrészt ír, vagy átnézi a meglévőt.

Hat feladatra használtuk:

- programrészek megírására;
- a kész program átnézésére, hibák után kutatva;
- az új funkciók megtervezésére;
- automatikus tesztek írására és futtatására;
- szakirodalom és online források keresésére a regenerációs modell beállításához;
- a fejlesztői dokumentáció és e dolgozat szövegének megfogalmazására (a tartalmat mi adtuk meg és mi ellenőriztük).

A javaslatait minden esetben mi néztük át, mi döntöttünk az elfogadásukról, és a végeredményt mi teszteltük. A program átnézését több körben végeztettük el vele: minden talált hibánál több megoldási lehetőséget kértünk, és ezek közül egyenként mi választottunk, a döntéseinket írásban rögzítve. Az egyik ilyen körben 78 talált problémáról döntöttünk: 59 esetben a javasolt megoldást fogadtuk el, 19 esetben több felkínált lehetőség közül választottunk. A funkciókat egymás között osztottuk fel, és mindenki a saját részén dolgozott a segéddel. Hogy ki melyik részt készítette, azt a 4.10.2 alfejezet írja le; a 4.10.4 Dausek Csanád saját beszámolója. Más mesterséges intelligencián alapuló eszközt nem használtunk.

# **4\. Eredmények**

Ebben a fejezetben az elkészült rendszert mutatjuk be: a követelményeket, a felépítést, az adatbázist, a felhasználói felületet, a szerver és a böngészős rész működését, a telepítést, a tesztelést, a forráskódot és a csapatmunkát. Ez a rész a fejlesztőknek szóló, részletes műszaki leírás. A fő eredményeket a 2. fejezet céljai szerint az 5. fejezet foglalja össze, a napi pontszám kiszámításának közérthető leírása pedig a 3.4 alfejezet végén található.

Nem informatikus olvasóknak a 4. fejezetből a 4.1.1 és a 4.4.1 táblázatának szöveges oszlopait, valamint a 4.8.1 és a 4.10 alfejezetet ajánljuk; az adatvédelemről közérthetően az 5.1 alfejezet „Adatvédelem és etika” része szól. A többi alfejezet a program belső felépítését írja le a továbbfejlesztők számára. A műszaki leírásban a regenerációs modul neve Recovery Engine, a reggeli állapotfelmérésé check-in. Ahol a műszaki leírás azt írja, hogy az edző a meghívás elfogadása előtt „semmit nem lát”, ott ez a sportoló nevének kivételével értendő.

## **4.1 Követelmények**

### **4.1.1 Funkcionális követelmények**

Minden pont megvalósított funkció; a végpontok teljes listája: 4.5.2.

| Funkció | Mit tud | Végpontok / fájlok |
| :---- | :---- | :---- |
| Regisztráció, belépés | Regisztráció (jelszó min. 8 karakter), belépés, kilépés, jelszóváltás, fióktörlés. Jelszó-visszaállítás nincs: nincs e-mail-kezelés (README: tudatos). | \`/api/auth/\*\` |
| Edzésnapló | Szettek (bemelegítő, munka, drop), súly, ismétlés, kardió-sor; automatikus piszkozat; rekordok (PR) és becsült 1RM (Epley); edzői visszajelzés. | \`/api/workouts\`, \`/api/workout-draft\`, \`/api/prs\`; \`workout/workout.js\` |
| Edzéstervek | 1–14 napos ciklus, amely a végén elölről kezdődik (naponta edzés, pihenő vagy „ugyanaz, mint" egy edzésnap); egy aktív. Az edző kioszthatja, a sportoló elfogadja vagy elutasítja. | \`/api/plans\`, \`/api/athletes/:linkId/plan\`, \`/api/plan-offers/:id/accept\` |
| Táplálkozás-követés | Étel-, víz-, testsúly- és testméret-napló; kalória- és fehérjecél; saját étel; vonalkód. A kalóriát a szerver számolja (Atwater: 4/4/9 kcal/g). | \`/api/nutrition\*\`, \`/api/foods/\*\` |
| Napi check-in | Varázsló: alvás, energia, stressz, testsúly, izomláz és fájdalom (testtérkép). | \`/api/checkin\` |
| Recovery Engine | 0-100 készenlét, izomcsoportonkénti regeneráció, napi ajánlás, gyakorlatjavaslat. | \`/api/readiness\`, \`/api/exercise-suggestions\` |
| Edzői panel | Meghívás, sportolói kártya, étrend- és vízcél, megjegyzések, chat, terv-kiosztás. | \`/api/athletes\`, \`/api/messages/:linkId\` |

&nbsp;

### **4.1.2 Felhasználói szerepkörök**

Szerepkör-mező nincs. A users oszlopai: id, username, display\_name, password\_hash, goal, created\_at, sex, birth\_year. Hogy valaki edző vagy sportoló, a coach\_links kapcsolatból következik (server/routes/auth.js kommentje), ezért egy fiók egyszerre mindkettő lehet. Admin szerepkör és vendég mód nincs; a felületi nézeteket a 4.4.4 írja le.

| Szabály | Megvalósítás | Forrás |
| :---- | :---- | :---- |
| Kapcsolat önmagával tilos | CHECK(coach\_id \!= athlete\_id) | server/db/schema.js (coach\_links) |
| Egy pár egyszer | UNIQUE(coach\_id, athlete\_id) | server/db/schema.js (coach\_links) |
| Sportolónak legfeljebb 1 aktív edzője lehet | Csak a szerver ellenőrzi, DB-megszorítás nincs | server/routes/coach.js |
| Az edződet nem hívhatod meg sportolónak | A szerver elutasítja | server/routes/coach.js |
| Elfogadásig az edző semmit nem lát | A kapcsolat pending-ből active lesz, ha a sportoló elfogadja | server/routes/coach.js, server/http/access.js; index.html |

&nbsp;

## **4.2 Rendszerterv**

### **4.2.1 Architektúra**

A Podium egyetlen Node.js folyamat: egy Express 4 alkalmazás szolgálja ki a statikus frontendet és a /api/\* REST API-t ugyanazon az origin-en, ezért CORS-beállítás nem kell (server.js, headers.js). Rétegek:

| Réteg | Tartalom | Hely |
| :---- | :---- | :---- |
| 1\. Kliens | Egyoldalas webalkalmazás, vanília JS, build-lépés nélkül | public/ |
| 2\. HTTP / Express | Middleware-lánc, végpontok, bemeneti ellenőrzés | server/server.js (összekötés), server/http/ (munkamenet, korlátok, kapuk), server/routes/ (végpontok), server/validation/, server/services/ |
| 3\. Számító modulok | Tiszta függvények, DB és Express nélkül: recovery, training-load, exercise-advice, session-advice, one-rm, records, charts, coaching, notifications, suggestions, plan-week, muscles, logmode, catalog-search, foods-validate, dates, numbers, auth, ratelimit, errors, headers | server/\*.js |
| 4\. Adatréteg | Az egyetlen réteg, amely a tárolást ismeri (123 export) | server/db/ (belépési pont: index.js; a server/db.js csak továbbexportál) |
| 5\. Adatbázis | SQLite, beépített node:sqlite (DatabaseSync) | server/db/connection.js |
| 6\. Külső szolgáltatás | Open Food Facts, csak a szerveren át (connect-src 'self') | server/openfoodfacts.js, server/headers.js |

&nbsp;

A referencia-adatok (server/data/, data.js) induláskor a collections táblába töltődnek (server/db/schema.js → seedCollections). A public/ statikus (server.js); a /vendor/zxing a @zxing/library/umd-t adja (server.js).

### **4.2.2 A rendszer komponensei**

| Komponens | Felelősség |
| :---- | :---- |
| server/server.js | Express app: middleware-lánc, a route-modulok bekötése, READ\_ENDPOINTS, statikus kiszolgálás |
| server/http/session.js | Munkamenet-süti, belépés-őr (req.user, req.today), írás-korlát és a többi kérésszám-korlátozó, X-Client-Date |
| server/http/access.js | Edző–sportoló kapuk: a linkId és a terv-ajánlat ellenőrzése |
| server/routes/auth.js | Belépés, regisztráció, kilépés, fiók, jelszóváltás, fióktörlés, profil, export |
| server/routes/coach.js | Kapcsolatok és meghívók, üzenetek, terv-kiosztás, értesítések, gyakorlat-megjegyzések |
| server/routes/training.js | Gyakorlat-katalógus, áttekintő, készenlét és check-in, tervek, edzésnapló és piszkozat, PR-ek, diagramok, testsúly, testméret, erőfelmérés, visszajelzés |
| server/routes/nutrition.js | Étel-katalógus, táplálkozási és víznapló, napi cél, edzői étrend és vízcél, saját étel, vonalkód |
| server/services/session-plan.js | A mai edzés sablonja, a készenléti riport, a készenlét-alapú javaslat alkalmazása (több route-fájl közös szolgáltatása) |
| server/validation/workout-body.js | Az edzés- és a terv-törzs ellenőrzése és normalizálása (gyakorlatok, szettek, napok) |
| server/db/ | Adatréteg. index.js: belépési pont, az indulási lépések sorrendje; connection.js: fájl, WAL, tranzakció; schema.js: táblák, indexek, seed; migrations.js: régi fájlok kiegészítése, adatmigrációk; accounts.js, coaching.js, nutrition.js, body.js, training.js: a lekérdezések tartományonként. A server/db.js csak továbbexportál |
| server/data.js | Seed: célok, diagramok, alapszettek, táplálkozási alapcél (2900 kcal, 170 g fehérje) |
| server/data/catalog.js | Gyakorlat- és ételkatalógus összeállítása |
| server/auth.js | scrypt jelszó-hash, munkamenet-token, süti, belépés-zárolás |
| server/ratelimit.js | Memóriabeli, rögzített ablakos kérésszámláló; PODIUM\_TRUST\_PROXY |
| server/errors.js | Aszinkron védőháló, JSON hibakezelő, folyamat-őrök |
| server/headers.js | Biztonsági fejlécek: CSP, X-Frame-Options, nosniff, Referrer-Policy, HSTS (csak HTTPS) |
| server/recovery.js | Recovery Engine: készenlét 0-100, izomcsoport-készenlét, ajánlások |
| server/training-load.js | Terhelés-könyvelés a mentett edzésekből: szettenkénti terhelés, újdonság-szorzó, napi bontás (a Recovery Engine bemenete) |
| server/exercise-advice.js | Gyakorlatonkénti készenlét és edzésdöntés (verdict, súly-javaslat) |
| server/session-advice.js | A mai edzés biztonsági átnézése és a készenlét-alapú javaslat |
| server/one-rm.js | Az 1RM-képlet (Epley, estimate1RM) |
| server/records.js | Rekord-szabály: melyik szett a rekord, becsült 1RM |
| server/charts.js | Diagram-adatok: heti volumen, 14 napos tonnázs-trend |
| server/coaching.js | Sportolói kártya (buildAthleteCard) |
| server/notifications.js | Értesítés-panel sorai (6 eseménytípus) |
| server/suggestions.js | Gyakorlatajánlás cím és regeneráltság alapján |
| server/plan-week.js | Az 1–14 napos ciklusos terv és normalizálása |
| server/muscles.js | Izomcsoport-taxonómia, gyakorlat–izom összerendelés |
| server/logmode.js | Naplózási mód (ismétlés / időtartam), kardió-intenzitás |
| server/catalog-search.js | Keresés és lapozás memóriában |
| server/foods-validate.js | Saját étel ellenőrzése: név, makrók, kalória-tűrés, adagok, vonalkód |
| server/openfoodfacts.js | Vonalkód-normalizálás, Open Food Facts lekérés (időkorlát, User-Agent) |
| server/dates.js, server/numbers.js | Dátum- és szám-segédek |

&nbsp;

### **4.2.3 Kommunikáció a komponensek között**

* Kliens–szerver: HTTP/JSON. Websocket/SSE nincs: a chat 20 másodpercenként, csak látható fülön kérdez le (coach/chat.js).

* X-Client-Date: ÉÉÉÉ.HH.NN: a szerver csak a saját napjától legfeljebb 1 napra eltérőt fogadja el, különben a sajátját használja (server/http/session.js, req.today; shared/api.js).

* Szerver–adatbázis: szinkron node:sqlite; tranzakció pl. a deleteUser (server/db/accounts.js).

* Open Food Facts: fetch GET, User-Agent, időkorlát (6000 ms); hibára a végpont 502-t ad (server/routes/nutrition.js).

* Munkamenet: süti, lásd 4.5.3. Háttérfeladat: 24 óránként lejárt munkamenetek és vonalkód-gyorsítótár törlése (server.js). Proxy: PODIUM\_TRUST\_PROXY (server.js).

### **4.2.4 REST API**

* Metódusok: GET, POST, PUT, DELETE; PATCH nincs használatban (server/routes/). API-verziózás nincs.

* JSON, a kérés legfeljebb 256 kb (server.js). Dátum: ÉÉÉÉ.HH.NN.

* Hibatörzs: {"error": "\<magyar üzenet\>"}; sikeres törlés jellemzően 204\.

* Státuszkódok: 200, 201, 204, 400, 401, 403 (zárolt edzői cél, server/routes/nutrition.js), 404, 409, 429 Retry-After-rel (server/http/session.js), 502, 500\. Ismeretlen /api/\* útvonalra 404 (server.js).

* Lapozás a katalógus-végpontoknál: ?q=\&group=\&offset=\&limit=, alapból 40, legfeljebb 100 elem; válasz {items, total, nextOffset} (catalog-search.js).

* Idegen azonosítóra 404 jár (nem 403), hogy ne áruljon el semmit (server/http/access.js).

A teljes végpontlista a 4.5.2 fejezetben van.

### **4.2.5 Alkalmazott technológiák**

| Technológia | Verzió | Szerep | Forrás |
| :---- | :---- | :---- | :---- |
| Node.js | \>=22.5.0 (engines) | Futtatókörnyezet, ES modulok | package.json |
| node:sqlite | a Node-hoz kötött | Adatbázis, WAL mód | server/db/connection.js |
| Express | ^4.21.2 (lock: 4.22.3) | HTTP szerver, REST API, statikus fájlok | package.json |
| @zxing/library | ^0.21.3 | Vonalkód-dekódolás (tartalék a böngésző olvasója mellett) | package.json |
| eslint | ^10.10.0 | Kódellenőrzés (devDependency) | package.json |
| @eslint/js | ^10.0.1 | ESLint alapszabályok (devDependency) | package.json |
| eslint-config-prettier | ^10.1.8 | ESLint–Prettier összehangolás (devDependency) | package.json |
| globals | ^17.12.0 | Globális változók ESLinthez (devDependency) | package.json |
| prettier | ^3.9.6 | Formázás (devDependency) | package.json |
| node:test | a Node-hoz kötött | Tesztfuttató | package.json |
| Frontend | vanília JS (ES modulok), HTML, CSS, SVG | Nincs keretrendszer, nincs bundler | public/index.html, js/main.js |
| Open Food Facts API | külső szolgáltatás | Vonalkódból termékadat | openfoodfacts.js |
| exercises-dataset (hasaneyldrm) | külső adat | Gyakorlatkatalógus (a forrás-adathalmaz 1324 gyakorlatából); média © Gym visual | scripts/build-exdb.js |

&nbsp;

A graphify nem függőség: csak az npm run graph szkript hívja, opcionális külső kódtérkép-eszköz, futásidőben nem kell.

## **4.3 Adatbázis**

### **4.3.1 Adatmodell**

SQLite, egyetlen fájl: server/podium.db (a PODIUM\_DB felülírja, server/db/connection.js). A fájl .gitignore-olt, jelenleg nincs a projektben, az első indításkor jön létre. Beállítások: journal\_mode=WAL (írás közben is lehet olvasni), synchronous=NORMAL, foreign\_keys=ON (server/db/connection.js). Induláskor a szerver kiírja: SQLite kész → \<útvonal\> (meglévő | ÚJ adatbázis jött létre) (server/db/schema.js).

Alapelv: a referencia-adat (katalógusok, alapértékek) a közös, csak olvasható collections táblában van; a felhasználói adat saját táblákban, user\_id oszloppal, és minden lekérdezés erre szűr (server/db/index.js). Összesen 22 tábla van (server/db/schema.js).

### **4.3.2 ER-diagram**

Szöveges ábra; a users a középpont, a legtöbb tábla a user\_id-n át kapcsolódik.

users (id)  
|-- 1:N \--\> sessions, weight\_log, nutrition\_log, custom\_foods, body\_measurements,  
|           water\_log, workouts, plans, checkins, exercise\_maxes, coach\_meals,  
|           nutrition\_goals, water\_goals                       (user\_id)  
|-- 1:1 \--\> workout\_draft                                      (user\_id \= PK)  
|-- 1:N \--\> comments                                           (author\_id, subject\_id)  
|  
\+-- coach\_links (coach\_id \--\> users, athlete\_id \--\> users, egyedi pár)  
|-- 1:N \--\> messages          (link\_id)  
\+-- 1:N \--\> plan\_assignments  (link\_id)  
coach\_meals (id) \--1:N--\> coach\_meal\_logs (meal\_id)

Logikai hivatkozás FK nélkül:  
plans.assignment\_id \--\> plan\_assignments.id  
workouts.plan\_id, workout\_draft.plan\_id \--\> plans.id  
Önálló táblák (nincs user\_id): collections, barcode\_cache

### **4.3.3 Táblák részletes leírása**

| \# | Tábla | Fő oszlopok | Kulcsok / kapcsolatok |
| :---- | :---- | :---- | :---- |
| 1 | collections | key PK, value (JSON). Seed kulcsok: goals, charts, dashboard, defaultSet, defaultCardioSet, nutritionGoal, exerciseCatalog, foods |  |
| 2 | users | id, username, display\_name, password\_hash, goal, created\_at, sex, birth\_year | username UNIQUE |
| 3 | sessions | token\_hash PK, user\_id, created\_at, expires\_at | FK users, CASCADE |
| 4 | weight\_log | id, user\_id, kg, date | FK, CASCADE |
| 5 | nutrition\_log | id, user\_id, name, grams, kcal, protein, carbs, fat, date, base\_\* | FK CASCADE; index (user\_id, date) |
| 6 | custom\_foods | id, user\_id, name, brand, food\_group, unit (g/ml), kcal, protein, carbs, fat, kcal\_auto, barcode, portions (JSON), source | UNIQUE(user\_id, name), UNIQUE(user\_id, barcode) |
| 7 | comments | id, author\_id, subject\_id, target\_type, target\_id („edzésId:index"), text | author, subject FK users, CASCADE |
| 8 | body\_measurements | id, user\_id, date, site, value | UNIQUE(user\_id, date, site) |
| 9 | water\_log | id, user\_id, date, ml, logged\_at | FK, CASCADE |
| 10 | nutrition\_goals | user\_id, source (own/coach), calories, protein, set\_by | PK(user\_id, source); set\_by: SET NULL |
| 11 | coach\_meals | id, user\_id, set\_by, name, position, items (JSON) | FK, CASCADE |
| 12 | coach\_meal\_logs | meal\_id, date, logged\_at | PK(meal\_id, date) |
| 13 | water\_goals | user\_id PK, ml, set\_by | FK, CASCADE |
| 14 | barcode\_cache | barcode PK, found, payload (JSON), fetched\_at | nincs user\_id, szándékosan közös |
| 15 | workouts | id, user\_id, name, date, exercises (JSON), plan\_id, feedback\_difficulty/mood/note/at, pr\_rule | FK user\_id CASCADE; plan\_id nem FK |
| 16 | plans | id, user\_id, name, date, exercises (JSON), days, assignment\_id, week (JSON), active, active\_since | FK user\_id CASCADE |
| 17 | workout\_draft | user\_id PK, name, exercises (JSON), date, plan\_id, workout\_id | felhasználónként 1 sor |
| 18 | checkins | user\_id, date, sleep\_hours, sleep\_quality, energy, stress, mood, hydration (régi, nem használt: olvasáskor a water\_log napi összege adja), soreness (JSON), pain (JSON) | PK(user\_id, date); mérőszámok NULL-ozhatók |
| 19 | coach\_links | id, coach\_id, athlete\_id, status (pending/active), created\_at, responded\_at | UNIQUE(coach\_id, athlete\_id); CHECK(coach\_id \!= athlete\_id) |
| 20 | messages | id, link\_id, sender\_id, body, created\_at, read\_at | FK link\_id, CASCADE |
| 21 | plan\_assignments | id, link\_id, name, exercises (JSON), days, note, status (pending/accepted/declined), week | FK link\_id, CASCADE |
| 22 | exercise\_maxes | user\_id, exercise\_name, max\_1rm, date, declared\_1rm, declared\_date, source (measured/declared) | PK(user\_id, exercise\_name) |

&nbsp;

* Új adatbázison minden oszlop a CREATE TABLE-ben jön létre (server/db/schema.js). A később bevezetett oszlopokat (pl. users.sex/birth\_year, plans.assignment\_id/week/active, workouts.feedback\_\*/pr\_rule, messages.read\_at) csak a régebbi, 5-ös séma-verzió előtti fájlokon pótolja utólag az ensureColumn, ALTER TABLE-lel (server/db/migrations.js).

* A nutrition\_log és a coach\_meals.items a makrókat másolatban tárolja.

* Napi cél sorrendje: saját, edzői (csak ha az aktív edző állította: set\_by), seed (server/db/nutrition.js).

* Az időalapú edzéssor alakja {duration, intensity, weight, done}, az ismétlés-alapúé {reps, weight, rpe, type, done} (server/validation/workout-body.js).

* Gyakorlatkatalógus: 200 kurált \+ 1241 generált \= 1441 gyakorlat.

### **4.3.4 Kapcsolatok**

* users és a legtöbb tábla között 1:N kapcsolat van a user\_id-n át.

* Az edző–sportoló viszonyt a coach\_links írja le: irányított pár, egyszer szerepelhet. coach\_links 1:N messages és plan\_assignments; CASCADE miatt a kapcsolat megszűnésével ezek is törlődnek. coach\_meals 1:N coach\_meal\_logs.

* plans.assignment\_id, workouts.plan\_id, workout\_draft.plan\_id logikai hivatkozás, DB-szintű idegen kulcs nélkül. Az egy aktív edző szabályt a szerver ellenőrzi.

* Fióktörlés: a deleteUser (server/db/accounts.js) tranzakcióban törli a kapcsolatokat, üzeneteket, az edzőként kitűzött célokat, étrendeket (coach\_meals) és vízcélokat (water\_goals), valamint a USER\_DATA\_TABLES sorait. A többit (custom\_foods, body\_measurements, water\_log, comments, saját célok) az FK ON DELETE CASCADE viszi (foreign\_keys=ON, server/db/connection.js). Ezt futtatással nem ellenőriztük.

### **4.3.5 Adatbázis létrehozása / dump**

SQL fájl, migrációs mappa és dump nincs. A séma és a migrációk a server/db/index.js betöltésekor futnak, idempotensen:

* CREATE TABLE IF NOT EXISTS (server/db/schema.js); ensureColumn: PRAGMA table\_info alapján ALTER TABLE ... ADD COLUMN, csak az 5-ös séma-verzió előtti fájlokon (server/db/migrations.js).

* Adatmigrációk PRAGMA user\_version 1-5 szerint: 1 az 1RM-képlet egységesítése; 2 a 9 izomcsoport 12-re bontása a check-in JSON-ban; 3 a csúcsok egyszeri újraszámolása a naplóból; 4 a víznapló lesz a folyadék egyetlen forrása; 5 a bemondott csúcsok átmásolása a declared\_1rm / declared\_date oszlopba (server/db/migrations.js).

* Túl régi, a fiókok előtti (egyfelhasználós) adatbázishoz a szerver nem nyúl: az assertSupportedSchema hibával leállítja, és azt kéri, hogy előbb egy régebbi verzióval (c429b9f) indítsák el egyszer. Táblaújraépítés és átmeneti tábla nincs (server/db/migrations.js).

* Seed minden induláskor: INSERT OR REPLACE INTO collections (server/db/schema.js). Felhasználók nincsenek előre betöltve.

## **4.4 Felhasználói felület**

### **4.4.1 Képernyők**

Minden képernyő egy \<section class="app-page" data-page="…"\>, az útvonal az URL hash-e (shared/constants.js, app/router.js).

| Képernyő | Útvonal | Tartalom |
| :---- | :---- | :---- |
| Belépő / regisztráció | teljes képernyős kapu | Felhasználónév, jelszó, regisztrációnál megjelenített név. Nem bezárható (index.html). |
| Áttekintés | \#dashboard | Készenlét %, kalória és makrók, statok, 14 napos terhelés-diagram, check-in emlékeztető, „Mai edzés" (index.html). |
| Regeneráció | \#recovery | Készenlét, „Ma kíméld" lista, izomtérkép, pontszám-bontás, testsúly, testösszetétel, CNS-terhelés, ajánlások (index.html). |
| Napi check-in | \#checkin | Varázsló, izomláz és fájdalom testtérképen (1-10); 7+ fájdalom letiltja az érintett izmot terhelő gyakorlatokat. Ítélet: „Jó készenlét" / „Közepes" / „Óvatosan ma". |
| Edzésnapló | \#workout | Gyakorlat-kártyák szettekkel, automatikus piszkozat, korábbi edzések, heti volumen, rekordok (index.html). A „Technika-videó" modál csak „Hamarosan" (index.html). |
| Gyakorlat hozzáadása | \#exercise-picker | Szerveroldali keresés, lapozás (40), izomcsoport-chipek, „Javasolt". |
| Edzés betöltése | \#workout-picker | Meglévő edzés másolata a terv-építő egy napjába. |
| Edzés-összegző | \#summary | Szettek, időtartam, PR; edzői visszajelzés csak edző esetén. |
| Tervek | \#plans | Tervek listája, aktívvá tétel (egyszerre egy), betöltés a naplóba, törlés. |
| Terv-építő | \#plan-builder | A ciklus napjai (1–14), naponta edzés vagy pihenő, gyakorlatok, mentés. |
| Táplálkozás | \#nutrition | Kalória-összesítő, cél (edzői cél zárolja), edzői étrend, víz (+250 ml), napló, saját étel, vonalkód, kereső. |
| Edző | \#coach | Két nézet: „Edződ" (sportolói) és „Edzetteim" / „Edzői panel" (edzői); lásd 4.4.4. |
| Profil | \#profile | Összesítés, rekordok (érmek), erőfelmérés. |
| Vonalkód-olvasó | modál | Kamera, EAN-13/EAN-8/UPC-A/UPC-E/Code-128, zseblámpa, kézi kódbeírás. |
| Saját étel | modál | Étel felvitele makrókkal (a kalóriát a szerver számolja). |
| Beállítások | modál | Megjelenített név, értesítés-kapcsolók (4 kategória: message, coach, plan, pr; shared/constants.js), edzéscél, nem, születési év, JSON-export (GET /api/export), jelszóváltás, kijelentkezés, fióktörlés. |
| Értesítés-panel | data-action="notifications" gomb | Valódi eseményekből (olvasatlan üzenet, meghívó, friss PR), „Összes olvasott". |
| Készenlét-javaslat | \#adviceModal | Napi tanács megerősítése. |
| Megerősítés | \#confirmModal | Általános megerősítő párbeszéd. |
| Étel-részlet | \#foodModal | Étel részletei, naplózás. |
| Rekord | \#prModal | Új rekord. |

&nbsp;

### **4.4.2 Navigáció**

* Hash-router (app/router.js): hash nélkül az utoljára látott oldal áll vissza (prefs.lastPage); a „flow" oldalak (summary, plan-builder, exercise-picker, workout-picker, checkin) nem mentődnek (app/router.js).

* Oldalváltáskor frissül az aria-current, a fókusz az új h2-re kerül, friss adat töltődik (app/router.js).

* Asztali menü: Áttekintés, Edzés, Táplálkozás, Regeneráció, Tervek, Edző, Profil (index.html); a Profilra az avatar és a név is visz, a Check-in az Áttekintésen/Regeneráción át érhető el.

* Mobil nav-gyűrű (app/navring.js): húzható gomb; felfelé Edző, ha a fióknak van edzői kapcsolata vagy meghívója, különben Regeneráció; lefelé Tervek, balra Edzés, jobbra Táplálkozás, koppintásra Áttekintés (shared/constants.js).

* Gyorsbillentyűk: 1-7 az oldalakra, az asztali menü sorrendjében (shared/constants.js); nem működnek aktív modálnál, gépelés közben és a check-in oldalon (app/shell.js).

* Onboarding-zár: új fióknál kezdetben csak a \#checkin érhető el (app/router.js).

### **4.4.3 Reszponzív működés**

Egy DOM, két kezelőfelület: asztali oldalsó menü és mobil nav-gyűrű, a CSS választ. Az alap CSS mobile-first; fő töréspont 1025 px (max-width:1024px mobil/tablet, min-width:1025px asztali; public/css/ fájljai). További töréspontok: 380, 400, 520, 760, 1280 px, hover és prefers-reduced-motion. Az Edző oldalon container query-k is vannak (css/05-edzoi-panel.css, css/09-edzo-nezetek-osszegzo.css). Mobilon 164 px jut a gyűrűnek, és a 14 napos diagramból az utolsó hét látszik. Viewport-meta: index.html.

A világos téma szabálya megvan (\[data-theme='light'\], css/01-alap.css), de a data-theme beállítása és témaváltó nincs, így nem használható funkció.

### **4.4.4 Felhasználói szerepkörök**

Egyféle fiók van, a szerep a kapcsolatból jön (shared/page-hooks.js). Az Edző oldalon mindkét nézet mindig elérhető (coach/coach.js); alapértelmezett: client, ha van edződ vagy meghívód, manager, ha vannak sportolóid vagy kiküldött meghívód (coach/coach.js); prefs.coachView őrzi.

* „Edződ" (sportolói): meghívók és felajánlott tervek elfogadása/elutasítása; fülek: Áttekintés, Étrend, Terv, Üzenetek; leválás. Az edzői célt nem módosíthatja.

* „Edzetteim" (edzői): meghívó űrlap, KPI-sor, sportoló-táblázat (készenlét, terv-követés, sorozat, utolsó edzés, pont; szűrő), részlet fülekkel. Itt állítható a kalória/fehérje- és vízcél, kezelhetők az étkezések, kioszthatók tervek, írhatók megjegyzések, megszüntethető a kapcsolat (index.html).

* A sportolói kártya pontszáma a készenlét és a terv-követés átlaga; Arany ≥ 85, Ezüst ≥ 70, alatta Bronz (index.html).

* Az edző a meghívás elfogadásáig semmit nem lát (index.html kommentje).

## **4.5 Backend**

### **4.5.1 Szerver felépítése**

Belépési pont: server/server.js (npm start); port: PORT vagy 3000 (server.js), PORT=0-nál az OS választ (tesztek). Indulás után kiírja a címet (server.js).

Az útvonalak tartományonként a server/routes/ alatt vannak (auth, coach, training, nutrition), register(app, deps) alakban; a server.js köti be őket, és közvetlenül csak a READ\_ENDPOINTS ciklus végpontjait regisztrálja (91 route a server/routes/ fájljaiban, plusz 3 a READ\_ENDPOINTS ciklusból). A middleware-lánc sorrendje:

* trust proxy, x-powered-by kikapcsolása (server.js)

* securityHeaders, guardAsyncRoutes, express.json 256 kb, proxy-figyelmeztető (server.js)

* /api/auth/me|register|login|logout, bejelentkezés nélkül (server/routes/auth.js → registerPublic)

* hitelesítő middleware az /api alatt: req.user, req.today; írás-korlát (server/http/session.js → register)

* az útvonalak (server/routes/\*.js → register); API 404 (server.js)

* /vendor/zxing és express.static(public)

* apiErrorHandler, installProcessGuards

Kérésszám-korlátozók (rate limit); memóriában élnek, újraindításkor nullázódnak (server/http/session.js):

| Korlát | Érték |
| :---- | :---- |
| Regisztráció | 30 / 60 perc, forrás-IP szerint |
| Belépés | 60 / 15 perc |
| Írás (POST/PUT/PATCH/DELETE) | 240 / perc fiókonként |
| Üzenetküldés | 20 / perc fiókonként |
| Vonalkód-keresés (csak gyorsítótár-találat nélkül) | 20 / perc fiókonként |

&nbsp;

Folyamat-őrök (errors.js): unhandledRejection-nél naplóz és fut tovább; uncaughtException-nél rendezett leállás (max. 5 mp), majd exit(1).

### **4.5.2 API végpontok**

Összesen 94 végpont: 91 route a server/routes/ fájljaiban (auth 10, coach 18, training 38, nutrition 25), plusz 3 a READ\_ENDPOINTS ciklusból (/api/default-set, /api/default-cardio-set, /api/goals; server.js). Jelölések: Auth: – nyilvános, S bejelentkezett munkamenet kell, L ezen felül kapcsolati kapu. Az írásokra az írás-korlát (240/perc) vonatkozik.

#### **a) Hitelesítés**

Bejelentkezés nélkül elérhető.

| Metódus | Útvonal | Cél, be/ki |
| :---- | :---- | :---- |
| GET | /api/auth/me | Aktuális felhasználó; 401-nél firstRun jelzi, hogy még nincs fiók |
| POST | /api/auth/register | Be: {username, password, displayName?}; név ^\[a-z0-9.\_-\]{3,24}\$, jelszó min. 8, megjelenített név max. 40\. Ki: 201/400/409/429 |
| POST | /api/auth/login | Belépés; hibás adatra 401 |
| POST | /api/auth/logout | Kilépés, 204 |

&nbsp;

#### **b) Fiók és profil**

| Metódus | Útvonal | Cél, be/ki |
| :---- | :---- | :---- |
| PUT | /api/auth/password | Be: {currentPassword, newPassword}; a régi munkamenetek törlődnek |
| POST | /api/auth/delete-account | Be: {password}; fióktörlés |
| GET | /api/user | Felhasználói adatok (cél, nem, születési év) |
| PUT | /api/user | Cél, nem, születési év módosítása; születési év: \[év-100, év-13\] |
| GET | /api/profile | Profil-statisztikák |
| GET | /api/goals | Edzéscélok (seed; READ\_ENDPOINTS-ciklus) |
| GET | /api/default-set | Alap szett (seed; ciklus) |
| GET | /api/default-cardio-set | Alap kardió-szett (seed; ciklus) |
| GET | /api/export | A teljes saját adat JSON-ban |

&nbsp;

#### **c) Katalógus és ételek**

| Metódus | Útvonal | Cél, be/ki |
| :---- | :---- | :---- |
| GET | /api/exercises | Gyakorlatkatalógus; q, group, offset, limit |
| GET | /api/exercise-groups | Izomcsoportok |
| GET | /api/food-groups | Ételcsoportok |
| GET | /api/foods | Ételek, a saját ételek elöl |
| GET | /api/foods/by-name | Étel név szerint, legfeljebb 50 névvel |
| POST | /api/foods/custom | Saját étel: név 2-60, egység g/ml, fehérje/szénhidrát/zsír 0-100 (összeg ≤ 100,5), legfeljebb 4 adag. A kalóriát a szerver számolja (Atwater 4/4/9); kézi megadásnál tűrés max(50, 30%). Ki: 201/400/409 |
| DELETE | /api/foods/custom/:id | Saját étel törlése |
| GET | /api/foods/barcode/:code | Vonalkód (8/12/13/14 számjegy, ellenőrzőszámmal). Sorrend: saját étel, barcode\_cache, Open Food Facts; {source: saved |

&nbsp;

#### **d) Táplálkozás, víz, testsúly, testméret**

| Metódus | Útvonal | Cél, be/ki |
| :---- | :---- | :---- |
| GET | /api/nutrition | Napi táplálkozás-összesítő |
| GET | /api/nutrition/log | Étel-napló |
| GET | /api/nutrition/recent | A legutóbb naplózott ételek a legutóbbi adaggal (legfeljebb 8\) |
| POST | /api/nutrition/log | Be: {name, grams?}, 1-2000 g; a makrókat a szerver számolja |
| PUT | /api/nutrition/log/:id | Napló-bejegyzés módosítása |
| DELETE | /api/nutrition/log/:id | Törlés (csak a mai bejegyzés) |
| PUT | /api/nutrition/goal | Saját cél: kalória 500-10000, fehérje 0-500; 403, ha edzői cél zárol |
| DELETE | /api/nutrition/goal | Saját cél törlése; a válasz az ezután érvényes napi cél (JSON) |
| GET | /api/nutrition/meals | Az edző által összeállított étkezések |
| POST | /api/nutrition/meals/:id/log | Étkezés naplózása; naponta egyszer, különben 409 |
| GET | /api/water | Napi víz |
| POST | /api/water | 1-3000 ml, napi max. 15000\. A víznapló a folyadék egyetlen forrása: a check-in a napi folyadékot innen olvassa |
| DELETE | /api/water/:id | Víz-bejegyzés törlése |
| GET | /api/weight-log | Testsúly-napló |
| PUT | /api/weight-log/:id | Testsúly módosítása |
| DELETE | /api/weight-log/:id | Testsúly törlése |
| GET | /api/measurements/sites | Mérhető testtájak |
| GET | /api/measurements | Testméretek |
| GET | /api/cardio-intensities | Kardió intenzitás-fokozatok |
| PUT | /api/measurements | Mérés mentése (chest, arm, waist, hip, thigh, calf, bodyfat) |
| DELETE | /api/measurements/:id | Mérés törlése |

&nbsp;

#### **e) Edzés, tervek, rekordok, áttekintés**

| Metódus | Útvonal | Cél, be/ki |
| :---- | :---- | :---- |
| GET | /api/workouts | Edzések listája |
| POST | /api/workouts | Edzés mentése; max. 50 gyakorlat, egyenként 50 szett |
| PUT | /api/workouts/:id | Edzés módosítása |
| DELETE | /api/workouts/:id | Edzés törlése |
| PUT | /api/workouts/:id/feedback | Visszajelzés: difficulty/mood 1-5, note ≤ 500 karakter |
| PUT | /api/workout-draft | Piszkozat mentése |
| DELETE | /api/workout-draft | Piszkozat törlése |
| GET | /api/workout-template | Sablon: mai piszkozat, napi terv, régi piszkozat, végül null |
| GET | /api/plans | Edzéstervek |
| POST | /api/plans | Új terv |
| PUT | /api/plans/:id | Terv módosítása |
| DELETE | /api/plans/:id | Terv törlése |
| POST | /api/plans/:id/active | Terv aktívvá tétele |
| GET | /api/prs | Személyes rekordok |
| GET | /api/prs/history | Rekordok története |
| GET | /api/exercise-maxes | Gyakorlatonkénti becsült maximumok |
| GET | /api/exercise-records | Gyakorlat-rekordok |
| GET | /api/weight-conventions | Súly-konvenciók (pl. kézenkénti súly) |
| GET | /api/strength-assessment | Erőfelmérés lekérdezése |
| POST | /api/strength-assessment | Erőfelmérés mentése; max. 12 bejegyzés, source='declared' |
| GET | /api/charts | Diagram-adatok |
| GET | /api/dashboard | Áttekintő képernyő adatai |
| GET | /api/exercise-suggestions | Gyakorlatjavaslatok |
| GET | /api/comments/by-target | Megjegyzések célpont szerint |
| POST | /api/comments | Megjegyzés írása |
| DELETE | /api/comments/:commentId | Megjegyzés törlése |

&nbsp;

#### **f) Regeneráció**

| Metódus | Útvonal | Cél, be/ki |
| :---- | :---- | :---- |
| GET | /api/readiness | Készenléti jelentés |
| GET | /api/readiness/advice | Napi edzés-tanács |
| POST | /api/readiness/advice/apply | Tanács alkalmazása; a szerver újraszámol, a kliens listáját nem fogadja el |
| GET | /api/checkin | A mai check-in |
| PUT | /api/checkin | Mentés, minden mező opcionális: sleepHours 0-24, sleepQuality/energy/stress/mood 1-5, hydration 0-15 l, soreness/pain 0-10, weightKg 30-300. A kitöltött hydration lecseréli az aznapi víznaplót a megadott összegre; üresen vagy változatlan összeggel a napló érintetlen marad. A weightKg a testsúlynaplóba ír (naponta 1 bejegyzés, ugyanarra a napra felülír); testsúlyt csak ezen a végponton át lehet felvenni |

&nbsp;

#### **g) Edző–sportoló**

Az L jelű végpontok :linkId-t kapnak, és a kapcsolati kapuk (linkFor, pendingOfferFor) ellenőrzik őket (lásd 4.5.3).

| Metódus | Útvonal | Cél, be/ki |
| :---- | :---- | :---- |
| GET | /api/athletes | Az edző sportolói (sportolói kártyák) |
| POST | /api/athletes | Sportoló meghívása felhasználónévvel |
| DELETE | /api/athletes/:linkId | Kapcsolat megszüntetése (edzői oldal) |
| POST | /api/athletes/:linkId/plan | Terv kiosztása |
| PUT | /api/athletes/:linkId/nutrition-goal | Edzői kalória/fehérje cél |
| PUT | /api/athletes/:linkId/water-goal | Edzői vízcél (0,5-10 l) |
| DELETE | /api/athletes/:linkId/water-goal | Vízcél törlése |
| POST | /api/athletes/:linkId/meals | Étkezés felvétele; max. 10 étkezés, egyenként 30 tétel |
| PUT | /api/athletes/:linkId/meals/:mealId | Étkezés módosítása |
| DELETE | /api/athletes/:linkId/meals/:mealId | Étkezés törlése |
| POST | /api/athletes/:linkId/comments | Megjegyzés a sportolóhoz |
| GET | /api/coach | Sportolói oldal: edző, meghívók, ajánlatok |
| POST | /api/coach/invites/:linkId/accept | Meghívás elfogadása |
| DELETE | /api/coach/invites/:linkId | Meghívás elutasítása |
| DELETE | /api/coach | Leválás az edzőről |
| GET | /api/messages/:linkId | Üzenetek |
| POST | /api/messages/:linkId | Üzenet küldése (max. 280 karakter) |
| POST | /api/messages/:linkId/read | Olvasottnak jelölés |
| POST | /api/plan-offers/:id/accept | Kiosztott terv elfogadása: másolatként bekerül a tervek közé és aktív lesz |
| DELETE | /api/plan-offers/:id | Kiosztott terv elutasítása |
| GET | /api/notifications | Értesítések |

&nbsp;

### **4.5.3 Hitelesítés / jogosultságkezelés**

* Munkamenet: podium\_session süti, 30 nap, HttpOnly, SameSite=Lax, Secure csak HTTPS-en. A token randomBytes(32) base64url; az adatbázisban csak SHA-256 lenyomata van (auth.js, server/http/session.js, server/db/accounts.js).

* Hitelesítő middleware: munkamenet nélkül 401, különben req.user \= {id, username, displayName} (server/http/session.js); az útvonalak előtt áll, az új végpontok automatikusan védettek.

* Jelszó: scrypt (N=16384, r=8, p=1, keylen=64), 16 bájtos só, timingSafeEqual; nem létező felhasználónál ál-scrypt fut (auth.js, server/routes/auth.js).

* Brute-force: 10 sikertelen belépés / 15 perc kizárja a login:\<név\>|\<forrás\> kulcsot (auth.js); jelszócsere/fióktörlés külön account:\<userId\> kulcstér (auth.js).

* Kapuk (server/http/access.js): linkFor, pendingOfferFor. Idegen user\_id nem kerül ki az API-ban, a linkId azonosít.

* Biztonsági fejlécek (headers.js): CSP script-src 'self', frame-ancestors 'none', X-Frame-Options DENY, nosniff, Referrer-Policy strict-origin-when-cross-origin, HSTS csak HTTPS-en.

* CSRF-token és külön CORS-beállítás nincs; a védelem a SameSite=Lax süti és az azonos origin.

### **4.5.4 Hibakezelés**

* 400 validáció; 404 nem létező vagy nem a tiéd; 409 ütközés; 429 Retry-After-rel; 502 Open Food Facts hiba; 500 váratlan hiba (törzs: lásd 4.2.4).

* Az Open Food Facts hibáját nem gyorsítótárazza, a „nem található" terméket igen (found=0). A guardAsyncRoutes az aszinkron hibát a next(err)-re irányítja (errors.js).

* Az apiErrorHandler (server.js, errors.js) a 4xx hibák err.message-ét változtatás nélkül kiküldi, így pl. túl nagy törzsnél (413) az Express angol üzenete jut ki (errors.js); minden mást 500-zal és „Váratlan szerverhiba — próbáld újra később." szöveggel zár. A veremkép a naplóba kerül.

* A deleteUser hibánál ROLLBACK-et hajt végre (server/db/accounts.js).

* Kliens: 401-nél a belépő kapu nyílik, belépés után újratöltés (shared/api.js, main.js); más hibánál a szerver szövege toastban jelenik meg. Az init() safe() burkolója miatt egy hiba nem viszi el az indítást (app/init.js). Újrapróbálás és időkorlát a shared/api.js-ben nincs. Offline működés (service worker) nincs, csak toast (app/shell.js).

## **4.6 Frontend**

### **4.6.1 Felépítés**

Vanília JavaScript, build-lépés nélkül. Az index.html a public/css/ 13 stíluslapját és a js/main.js modult tölti be; a router a hidden attribútummal vált az oldalak között (app/router.js). A modálok az index.html-ben vannak, a \<template\>-eket a cloneTemplate klónozza.

| Mappa / fájl | Szerep |
| :---- | :---- |
| main.js | Belépési pont |
| app/ | Az alkalmazás kerete: indítás (init.js), indulás kapcsolat-hibánál (startup.js), hash-router (router.js), nav-gyűrű (navring.js), fejléc, gyorsbillentyűk és online/offline jelzés (shell.js), értesítés-panel (notifications.js) |
| shared/ | Amit legalább két funkció használ: api, constants, dom, format, toast, prefs, day, page-hooks, paged-list, plan-sources, plan-week, modals, custom-select, popup-menu, stepper, chart, readiness, latest-only, weight-conventions |
| dashboard/ | Áttekintés |
| recovery/ | Regeneráció: készenléti riport, izomtérkép, testtérkép, testsúly, körméretek |
| checkin/ | Napi check-in varázsló |
| workout/ | Edzésnapló, gyakorlat- és edzés-választó, PR-jelző, összegző, előzmények, automatikus mentés |
| nutrition/ | Táplálkozás: ételek, étel-részletek, saját étel, vonalkód, víz |
| plans/ | Tervek és terv-építő |
| coach/ | Edző oldal: edzői panel, sportolói nézet, chat, étrend |
| profile/ | Profil és beállítások |

&nbsp;

Egy funkció-mappában az x.js a vezérlő (a setupX() függvény köt), az x-view.js a kirajzolás, ha külön fájlt ér meg; az init() hívja a vezérlőket, a független renderelők Promise.all-lal futnak (app/init.js).

Globális store nincs: a szerver az igazságforrás. A shared/page-hooks.js objektumai (hooks, shared: onboardingLock, hasCoachLink, coachActive) miatt az app/ nem függ a funkció-mappáktól. Beállítások: shared/prefs.js (localStorage podium:prefs:\<felhasználónév\>, fiókonként külön: lastPage, coachView, displayName, notifSeenAt, notifCats). Napváltás-figyelés: shared/day.js.

### **4.6.2 Fontosabb funkciók**

| Funkció | Fájlok |
| :---- | :---- |
| Belépés / munkamenet | setupAuthGate, api.me/login/register/logout, hooks.onSessionLost (app/init.js, main.js) |
| Edzésnapló | workout/workout.js, workout/sets-view.js, workout/set-controls.js, workout/pr-indicator.js (becsült 1RM), workout/finish.js; automatikus mentés: workout/autosave.js (500 ms debounce, max. 5 s, újrapróbálás 3/8/20 s, keepalive PUT) |
| Gyakorlat-választó, tervek | workout/exercise-picker.js, shared/paged-list.js (40 elemes lapozás, IntersectionObserver), plans/plans.js, plans/plan-builder.js, workout/workout-picker.js, shared/plan-week.js, workout/summary.js, workout/history.js |
| Táplálkozás | nutrition/nutrition.js, nutrition/nutrition-view.js, nutrition/food-detail.js, nutrition/water.js, nutrition/custom-food.js |
| Vonalkód | nutrition/scanner.js: natív BarcodeDetector, hiányában ZXing (lustán betöltve), végül kézi kódbeírás |
| Check-in | checkin/wizard.js, checkin/steps.js, checkin/steps-input.js, checkin/session.js, recovery/bodymap.js |
| Regeneráció | recovery/recovery.js, recovery/recovery-view.js, recovery/recovery-map.js, recovery/weight.js, recovery/measurements.js |
| Edzői panel, sportolói nézet | coach/coach.js, coach/coach-view.js, coach/client.js, coach/client-view.js, coach/coach-shared.js, coach/meals.js |
| Chat, értesítések | coach/chat.js (buborékok, „olvasva" jelzés, 20 s-os lekérdezés), app/notifications.js |
| Profil, beállítások | profile/profile.js, profile/settings.js (beállítások, export, fiókkezelés) |
| Közös elemek | shared/modals.js (createModalController: Escape, fókusz-csapda, aria-modal), shared/custom-select.js, shared/toast.js, app/shell.js (online/offline jelzés) |

&nbsp;

### **4.6.3 API használata**

* Egyetlen modul, shared/api.js (fetch); minden hívás az api objektumon át megy, kivéve az autosave keepalive-ot (workout/autosave.js). Relatív URL-ek.

* Authorization fejléc nincs, a süti automatikusan megy. Az X-Client-Date (api.js) nem megy az authRequest, me(), getJsonDetailed, autosave-keepalive és vonalkód-hívásokkal.

* Burkolók: getJson (AbortSignal), getJsonDetailed, sendJson/postJson/putJson, del, authRequest, queryString.

* A referencia-végpontok gyorsítótárazottak (getJsonCached, api.js): /api/user, /api/charts, /api/default-set, /api/default-cardio-set, /api/cardio-intensities, /api/exercise-groups, /api/food-groups, /api/goals, /api/measurements/sites. Az /api/athletes nincs gyorsítótárazva (api.js; az api.js kommentje ezt elavultan másképp írja). A keresésekben az elavult kéréseket signal szakítja meg (api.js).

* Edzés mentése után a rekordlista, a diagramok és a Regeneráció újratöltődik (workout/workout.js → refreshAfterWorkoutChange).

## **4.7 Telepítés és üzemeltetés**

### **4.7.1 Szükséges környezet**

Node.js \>=22.5.0 (README.md, package.json). Python csak az opcionális graphify-hoz kell; internet a vonalkódos kereséshez és az exdb:\* szkriptekhez.

### **4.7.2 Telepítés**

* Függőségek: npm install (README.md).

* Indítás: npm start (node \--disable-warning=ExperimentalWarning server/server.js); cím: http\://localhost:3000.

* Fejlesztéshez: npm run dev (node \--watch).

Az illusztrációk helye public/exercises/ (.gitignore-olt, hiányzik); pótlás: npm run exdb:media (próbához \-- \--limit 50). Hiánya az indulást nem akadályozza, a képek hiányoznak (futtatással nem ellenőriztük). Licenc: © Gym visual, kereskedelmi használathoz engedély kell. npm run exdb:build újragenerálja a server/data/exercises.exdb.js-t.

### **4.7.3 Konfiguráció**

Csak környezeti változókkal; .env vagy konfigurációs fájl nincs. A README ebből csak hármat említ.

| Változó | Alapérték | Hatás | Forrás |
| :---- | :---- | :---- | :---- |
| PORT | 3000 | A szerver portja (teszteknél 0\) | server.js |
| PODIUM\_DB | server/podium.db | Az SQLite fájl útvonala | server/db/connection.js |
| PODIUM\_TRUST\_PROXY | kikapcsolva | Megbízható proxy-lépések száma (pl. 1); true tiltott. Hat a belépés/regisztráció korlátjára, a Secure sütire, a HSTS-re | server.js, ratelimit.js |
| PODIUM\_OFF\_URL | https\://world.openfoodfacts.org | Open Food Facts alap URL | openfoodfacts.js |
| PODIUM\_OFF\_UA | Podium/0.1 (hobbi projekt) | Open Food Facts User-Agent | openfoodfacts.js |
| PODIUM\_OFF\_TIMEOUT\_MS | 6000 | Open Food Facts időkorlát (ms) | openfoodfacts.js |

&nbsp;

### **4.7.4 Adatbázis létrehozása**

Külön parancs nincs: a server/db/ induláskor létrehozza (4.3.5). A WAL miatt \-wal és \-shm fájl is keletkezik; mentéskor a hármat együtt kell másolni. Az első regisztráló hozza létre az első fiókot.

### **4.7.5 Indítás**

* Éles üzem (README): perzisztens tároló (PODIUM\_DB), illusztrációk licence, reverse proxy mögött PODIUM\_TRUST\_PROXY. Docker, CI, Procfile nincs.

## **4.8 Tesztelés**

### **4.8.1 Tesztelési stratégia**

Stratégia-dokumentum nincs. A tesztek node:test-re épülnek, terület szerint külön fájlokban (tests/server/, tests/public/js/); említések: README.md, doc.txt, MVP.md, TEENDOK.txt.

A tesztelést a csapat összes tagja végezte: mindannyian folyamatosan teszteltük a legújabb verziókat a mindennapi életünkben.

### **4.8.2 Tesztesetek**

85 tesztfájl van: 45 szerveroldali (tests/server/), 38 frontend (tests/public/js/, a funkció-mappák szerint) és 2 a tests/ gyökerében (import-names, unused-exports: minden importált név létezik, és nincs fölöslegesen exportált név). Segédfájl kettő: tests/server/test-harness.js és tests/public/js/fake-dom.js. describe nincs, minden teszt lapos test( hívás; összesen 784 (639 szerver \+ 143 frontend \+ 2 gyökér). A számok megszámolt test( hívások, nem lefuttatott eredmények.

A frontend-tesztek egy része tiszta logikát vizsgál, más részük a fake-dom.js segítségével DOM-viselkedést (pl. áttekintő, beállítások, edzői nézet, automatikus mentés); az api.js kérés-rétegére is van teszt (shared/api-request.test.js). A routert közvetlenül nem teszteli semmi; böngészős vagy E2E teszt nincs.

### **4.8.3 Automatizált tesztek**

* Futtatás: npm test (node \--test "tests/\*\*/\*.test.js", package.json).

* A végponti tesztek saját ideiglenes adatbázissal és PORT=0-val, külön folyamatban indítják a szervert (tests/server/test-harness.js).

* Kódminőség: npm run lint (eslint), npm run format:check (prettier). CI-konfiguráció nincs.

&nbsp;

## **4.9 Forráskód és projektstruktúra**

### **4.9.1 Repository**

Git repository, az alapág a main; a távoli tároló az origin ([https\://github.com/almateszem/repo](https://github.com/almateszem/repo)). A PR\_TRACKING\_GUIDE.md és az MVP.md ágnevekre utal (Viktor/hianyzotemak, valter/verzio2). .gitignore: node\_modules/, .env, server/\*.db (és a \-journal, \-wal, \-shm párjai), server/data/.exdb/, public/exercises/, \*.log, .superpowers/. A graphify-out/ nincs benne, a repóban van.

A forráskódot mindenki a saját gépének meghajtóján tárolja.

### **4.9.2 Könyvtárstruktúra**

repo/  
package.json, package-lock.json     \# "podium" 0.1.0  
README.md MVP.md doc.txt TEENDOK.txt PR\_TRACKING\_GUIDE.md   \# dokumentumok (részben elavultak)  
DOKUMENTACIO.docx.md                \# ez a dokumentáció  
eslint.config.js .prettierrc.json .prettierignore .gitignore .graphifyignore  
.claude/                            \# Claude Code beállítások (nem futásidejű)  
docs/superpowers/                   \# fejlesztési tervek (plans/ 9, specs/ 6, demos/ 1\)  
graphify-out/                       \# a graphify kódtérképe (opcionális eszköz kimenete)  
scripts/ build-exdb.js, fetch-exdb-media.js   \# gyakorlatkatalógus-generálás, képletöltés  
check-imports.js, check-exports.js  \# import- és export-ellenőrzés (a tests/ gyökér-tesztjei hívják)  
server/  
server.js    \# Express app: middleware-lánc, a route-modulok bekötése, statikus kiszolgálás  
routes/      \# auth.js, coach.js, training.js, nutrition.js: a végpontok  
http/        \# session.js (munkamenet, korlátok, X-Client-Date), access.js (kapuk)  
services/    \# session-plan.js  
validation/  \# workout-body.js  
db/          \# index.js, connection.js, schema.js, migrations.js, accounts.js, coaching.js,  
\# nutrition.js, body.js, training.js: az adatréteg  
db.js        \# a db/index.js továbbexportálása  
data.js      \# seed / referencia-adat  
auth.js ratelimit.js errors.js headers.js openfoodfacts.js catalog-search.js foods-validate.js  
recovery.js training-load.js exercise-advice.js session-advice.js one-rm.js records.js charts.js  
coaching.js notifications.js suggestions.js plan-week.js muscles.js logmode.js dates.js numbers.js  
data/        \# catalog.js, exercises.hu.js, exercises.exdb.js (GENERÁLT), exdb.map.js,  
\# exdb.names.hu.js, foods.hu.js, strength-standards.js, bodyweight-load.js  
public/  
index.html img/ (body-front.svg, body-back.svg)  
css/         \# 13 stíluslap (01-alap.css … 13-testterkep.css)  
js/          \# main.js, app/, shared/, dashboard/, recovery/, checkin/, workout/, nutrition/,  
\# plans/, coach/, profile/  
tests/ server/ (45 fájl), public/js/ (38 fájl), import-names.test.js, unused-exports.test.js

Nincsenek a repóban (a .gitignore kizárja, helyben jönnek létre): node\_modules, .env, server/podium.db (az első indításkor jön létre), public/exercises/ (és az ATTRIBUTION.txt).

### **4.9.3 Fontosabb modulok**

Modulok: 4.2.2 (szerver), 4.6.1-4.6.2 (frontend); belépési pontok: server/server.js, public/js/main.js. A projekt dokumentumai részben elavultak, a kód az igazság. Eltérések:

* README „Felépítés": a tesztfájlokat a server/ alatt listázza (valójában tests/server/), a catalog-search.js hiányzik belőle.

* A tesztek száma három helyen háromféle (357 / 260 / 427), mind elavult.

* A README környezeti változó táblázatából hiányzik a PODIUM\_OFF\_URL, \_UA, \_TIMEOUT\_MS; adat-felsorolása nem említi a coach\_meals, coach\_meal\_logs, water\_goals táblákat, végpont-táblázata csak az edzői réteget sorolja, és még listázza a megszűnt GET /api/athletes/:linkId/comments végpontot.

* Az MVP.md elavult (az edzői panel ott demó-adat volt, a kódban valódi coach\_links van); a doc.txt maga jelzi, hogy a 2026-09-03-i állapotot írja le.

* Kód-kommentek: a shared/api.js kommentje az /api/athletes gyorsítótárazásáról elavult.

## **4.10 Csapatmunka**

### **4.10.1 Csapattagok**

Dausek Csanád, Kovács Valter, Peresztegi Viktor Zsolt

### **4.10.2 Feladatmegosztás**

A feladatokat nem szokványos módon osztottuk fel, hanem a funkciók elkészítését osztottuk ki egymás között. Peresztegi Viktor Zsolt főként a design, a backend, valamint az adatbázis részeket kapta, Kovács Valter főként a frontenden és az edző–kliens közötti kapcsolatokon dolgozott. Dausek Csanád a hibajavításokat, egyes frontend részeket és a dokumentáció írását végezte.

### **4.10.3 Használt projektmenedzsment eszközök**

Verziókezelésre a GitHubot használtuk, hozzá a Sourcetree nevű szoftvert. A feladatkövetést a TEENDOK.txt fájlban és szóban végeztük. A megbeszélések munkaidőben napi szintűek voltak, ezen kívül a Messenger felületén folyt a kommunikáció.

### **4.10.4 Saját feladat / hozzájárulás**

Én elsősorban a hibák kijavításán dolgoztam a projekt során, valamint egyes frontend részeken, mint például a profil részleg. Ezen kívül nagyban részt vettem a program tervezési fázisában, valamint a dokumentáció írásában.

# **5\. Következtetések, javaslatok, összegzés**

## **5.1 Következtetések**

A 2. fejezetben kitűzött öt célt egyenként vetjük össze azzal, ami elkészült.

**1. Minden egy helyen – teljesült.** Az edzésnapló, az edzéstervek, a táplálkozás- és vízfogyasztás-követés, valamint a reggeli állapotfelmérés egyetlen fiókban működik. A napi pontszám kiszámításakor az alkalmazás az edzéseket, az alvást és az étkezést is figyelembe veszi. Az étkezésből a kalória- és a fehérjebevitelt csak akkor veszi figyelembe, ha a felhasználó vagy az edzője célt állított be rá; egyébként csak azt nézi, hogy a felhasználó elegendő folyadékot ivott-e. A táplálkozás a pontszámban szándékosan kis súllyal szerepel.

**2. A felkészültség becslése – teljesült.** Az alkalmazás minden olyan napra, amelyről van adat, 0 és 100 közötti pontszámot ad, és tizenkét izomcsoportra külön is megmutatja, mennyire álltak helyre. A pontszám részletezve is megnézhető, így a felhasználó látja, mi rontott vagy javított rajta. Erre építve az alkalmazás konkrét gyakorlatokat és súlyokat is javasol. Az izomcsoportonkénti számítást tíz előre megírt próbahelyzet ellenőrzi (a napi pontszám többi részét további tesztek), például hogy egy erőemelő egy nehéz, de nem a teljes kifáradásig vitt edzés után másnapra újra edzhet, vagy hogy hat hónap kihagyás után ugyanaz az edzés jobban fáraszt. Ezek azt igazolják, hogy a számítás a szándékunk szerint működik, azt viszont nem, hogy valódi sportolóknál megjósolja-e a teljesítményt vagy a sérülést (lásd a Korlátokat).

**3. Kapcsolat az edzővel – teljesült.** Az edző meghívót küld, és amíg a sportoló el nem fogadja, a sportoló nevén kívül semmit nem lát róla. Ezután edzéstervet és étrendet oszthat ki, üzenetet válthat a sportolóval, és egy áttekintő lapon követheti a fejlődését. Külön automatikus tesztek ellenőrzik, hogy a még el nem fogadott meghívó nem ad hozzáférést, hogy kívülálló semmit nem lát, és hogy miután a sportoló megszüntette a kapcsolatot, az edző sem lát semmit.

**4. Biztonság – teljesült.** A jelszavakat az alkalmazás nem olvasható formában, hanem visszafejthetetlenül átalakítva tárolja. Bejelentkezéskor az alkalmazás korlátozza a próbálkozások számát, így a jelszót sorozatos találgatással gyakorlatilag nem lehet kitalálni. A 2026. november 3-i futtatáskor mind a 788 automatikus teszt sikeresen lefutott, köztük azok is, amelyek azt ellenőrzik, hogy illetéktelen ne lássa más adatait. (A 4.8.2 és az 5.3 alfejezetben szereplő 784 más módszerrel, a forráskódban korábban megszámolt érték.) Egy kis nyitott hiba maradt: meghíváskor az edző megtudja, létezik-e a beírt felhasználónév.

**5. Könnyű használat – nagyrészt teljesült.** Az alkalmazás telepítés nélkül, böngészőből működik, magyar nyelvű, és a felület telefonon és számítógépen egyaránt a képernyő méretéhez igazodik. A fejlesztés alatt mindhárman a mindennapokban használtuk és teszteltük (lásd a 4.8.1 alfejezetet); böngészőben futó automatikus teszt erre nincs. A mércét tehát teljesíti a felület, a könnyű használatot azonban néhány még el nem készült rész korlátozza: a sötét színű képernyők mellett a világos színű változat még nem kapcsolható be, a sportoló saját technikavideójának feltöltésére szolgáló rész helyén még „Hamarosan” felirat áll, és ha valaki elfelejti a jelszavát, nem tudja magának visszaállítani. Az internetkapcsolat nélküli működést tudatosan hagytuk ki, mert ahhoz meg kellene oldani, mi történjen, ha két eszközön egyszerre módosítják ugyanazt az adatot.

**Korlátok.** Az eredmények értékeléséhez a korlátokat is fontos látni:

- a napi pontszámot a fejlesztés alatt csak magunkon használtuk, más sportolókon még nem próbáltuk ki, és az összetevők súlya saját becslés;
- okosóra nélkül a pontszám jelentős része a sportoló saját válaszain alapul, ezek pedig személyes megítélést tükröznek;
- a maximális erő becslése sok ismétlésnél pontatlanabb;
- az izomcsoportonkénti számítás a kardióedzést még nem veszi figyelembe;
- a rendszer egyetlen szerveren fut, és minden adatot egyetlen fájlban tárol; nyilvános interneten még nem érhető el;
- böngészőben futó, a felhasználó lépéseit végigjátszó automatikus teszt nincs.

**Adatvédelem és etika: amit megoldottunk.** A Podium egészséggel összefüggő adatokat is tárol (alvás, fájdalom, testsúly). Az EU általános adatvédelmi rendelete (GDPR) az egészségi állapotra vonatkozó adatot különleges adatnak tekinti, amelynek kezeléséhez kifejezett hozzájárulás kell (European Parliament & Council of the European Union, 2016). A hozzáférés és a jelszavak védelmét a 3. és a 4. cél fent leírja. A felhasználó a fő adatait (edzések, étkezések, reggeli állapotfelmérések, testsúly, tervek) letöltheti, és a fiókját véglegesen törölheti; ekkor minden adata törlődik, és ezt automatikus teszt is ellenőrzi. Külső szolgáltatásnak (Open Food Facts) csak a beolvasott vonalkódot küldjük el.

**Adatvédelem és etika: nyitott kérdések.** Az adatbázisfájl nincs titkosítva, vagyis aki a szerverhez hozzáfér, olvashatja. Nyilvános indulásnál a titkosított kapcsolatot (amelyet a böngésző címsorában a lakat jelez) egy külön, a szerver elé tett programnak kell biztosítania, és adatkezelési tájékoztató is szükséges. A regisztráció most nem kérdez rá az életkorra; a profilban megadható, nem kötelező születési év legfeljebb 13 évvel korábbi lehet. Magyarországon viszont 16 év alatt az ilyen, hozzájáruláson alapuló adatkezeléshez szülői hozzájárulás kell, ezért ezt a nyilvános indulás előtt rendezni kell. A pontszám tájékoztató jellegű, nem orvosi vélemény; sérülés esetén orvoshoz kell fordulni.

Összességében az alkalmazás a kitűzött célokat lényegében teljesíti, és működő, tesztelt rendszerként mutatható be. Lehetővé teszi, hogy az edzés, az étkezés és az alvás adatai együtt hassanak a napi pontszámra; hogy ez a gyakorlatban mennyit segít, azt az 5.2 első javaslata szerinti kipróbálás mutathatja meg.

## **5.2 Javaslatok**

Az alkalmazást az alábbi irányokban érdemes továbbfejleszteni:

- **Kipróbálás valódi sportolókkal.** Néhány sportoló és egy edző pár hétig használná az alkalmazást, mi pedig összevetnénk a napi pontszámot azzal, ahogyan ők maguk érezték magukat. Ez mutatná meg, mennyire pontos a becslés, és min kell változtatni.
- **Okosóra-adatok felhasználása.** Az okosórák által mért pulzusadatok pontosabbá tehetnék a napi pontszámot. A képlet egy új összetevőt átalakítás nélkül befogad, mert a hiányzó adatok súlyát már most is szétosztja.
- **Figyelmeztetés az alkalmazásban.** Az alkalmazásban is jelenjen meg, hogy a pontszám tájékoztató jellegű, és nem helyettesíti az orvosi véleményt.
- **Sérülésjelző gomb edzés közben.** Ha a sportoló edzés közben megsérül, egy gombnyomással rögzíthetné a sérülést és lezárhatná az edzést. Az érintett izom aznapra kimaradna az ajánlásokból, és ha a sportolónak van edzője, az azonnal értesülne. Az alkalmazás ilyenkor sem adna orvosi vagy kezelési tanácsot, csak figyelmeztetne, mikor kell orvoshoz fordulni.
- **Versenyszezonhoz igazított célsúly.** A versenyzők a szezonban és azon kívül más testsúlyra törekszenek. Ha a felhasználó megadná a célsúlyát és a határidőt, az alkalmazás ebből kiszámolhatná a napi kalória- és fehérjecélt, és figyelmeztetne, ha a kitűzött ütem hetente a testsúly nagyjából 1%-ánál gyorsabb fogyást vagy hízást jelentene.
- **Az adatok visszatöltése.** A felhasználó az adatait már most is letöltheti, de visszatölteni még nem tudja. A visszatöltéssel az adatait új fiókba vagy másik szerverre is átvihetné.
- **Önálló jelszó-visszaállítás.** Ehhez a fiókokhoz e-mail-címet kellene rendelni, hogy az elfelejtett jelszót a felhasználó maga állíthassa vissza.
- **A félkész részek befejezése.** Bekapcsolhatóvá kell tenni a világos színű megjelenést, el kell készíteni a saját technikavideó feltöltését (a videót az edző visszanézhetné), és képet kell készíteni a 128, még kép nélküli gyakorlathoz.
- **A felhasznált képek és táblázatok jogi rendezése.** A nyilvános indulás előtt a gyakorlatképek és az erő-összehasonlító táblázatok jogtulajdonosával írásban rendezni kell a feltételeket.

## **5.3 Összegzés**

A Podium edző–kliens edzésmenedzsment alkalmazás: egy helyen kezeli az edzésnaplót, az edzésterveket, a táplálkozás-követést, a napi check-int és a regenerációt. Egyetlen Node.js (Express) szerver szolgálja ki a build-lépés nélküli, vanília JS frontendet és a REST API-t; az adatokat SQLite tárolja (22 tábla). A különlegessége a Recovery Engine: az edzésekből, a táplálkozásból és a check-inből 0-100 készenléti pontszámot és izomcsoportonkénti regenerációt számol, és ez alapján javasol gyakorlatokat.

A beleegyezésen alapuló edző–sportoló kapcsolat lehetővé teszi, hogy az edző tervet és étrendet osszon ki, chateljen, és sportolói kártyán kövesse a fejlődést. A biztonságot a scrypt jelszó-hash, a HttpOnly süti, a kérésszám-korlátok és a biztonsági fejlécek adják. A tesztek (784 test( hívás) a node:test-re épülnek.

Ismert hiányok: a világos téma nincs bekötve, a „Technika-videó" modál csak „Hamarosan", nincs offline működés és önkiszolgáló jelszó-visszaállítás. A nyitott teendők a TEENDOK.txt-ben vannak.

Tanulságok: a csapattagok közti kommunikáció gördülékeny volt, viszont úgy érezzük, hogy túlvállaltuk magunkat a rendelkezésre álló időhöz képest. A jövőben mindenképpen ügyelünk arra, hogy reálisabb célokat állítsunk fel magunknak, jobban kihasználjuk az időt, és korábban álljunk neki a dokumentáció elkészítésének.

Jövőbeli tervek: a jövőben szeretnénk az alkalmazásunkat publikálni. Előtte szeretnénk fejleszteni az alkalmazás kezelésén, az adatbázison és a felhasználói felületen. Továbbá szeretnénk telefonos alkalmazást készíteni a programunkból.

# **6\. Irodalmak jegyzéke**

Anthropic. (2026). *Claude Code* (Version 2.1.317) [Large language model]. https://claude.com/product/claude-code

Borg, G. A. V. (1982). Psychophysical bases of perceived exertion. *Medicine and Science in Sports and Exercise, 14*(5), 377–381. https://doi.org/10.1249/00005768-198205000-00012

Calvert, T. W., Banister, E. W., Savage, M. V., & Bach, T. (1976). A systems model of the effects of training on physical performance. *IEEE Transactions on Systems, Man, and Cybernetics, SMC-6*(2), 94–102. https://doi.org/10.1109/TSMC.1976.5409179

Epley, B. (1985). Poundage chart. In *Boyd Epley workout*. Body Enterprises.

European Parliament & Council of the European Union. (2016). Regulation (EU) 2016/679 of the European Parliament and of the Council of 27 April 2016 on the protection of natural persons with regard to the processing of personal data and on the free movement of such data, and repealing Directive 95/46/EC (General Data Protection Regulation). *Official Journal of the European Union, L 119*, 1–88. https://eur-lex.europa.eu/eli/reg/2016/679/oj

Foster, C., Florhaug, J. A., Franklin, J., Gottschall, L., Hrovatin, L. A., Parker, S., Doleshal, P., & Dodge, C. (2001). A new approach to monitoring exercise training. *Journal of Strength and Conditioning Research, 15*(1), 109–115. https://doi.org/10.1519/00124278-200102000-00019

Gym visual. (n.d.). *Gym visual* [Exercise images and animations]. Retrieved November 4, 2026, from https://gymvisual.com/

Hipp, D. R. (2026). *SQLite* (Version 3.53.0) [Computer software]. https://sqlite.org/

Hooper, S. L., & Mackinnon, L. T. (1995). Monitoring overtraining in athletes: Recommendations. *Sports Medicine, 20*(5), 321–327. https://doi.org/10.2165/00007256-199520050-00003

Impellizzeri, F. M., Tenan, M. S., Kempton, T., Novak, A., & Coutts, A. J. (2020). Acute:chronic workload ratio: Conceptual issues and fundamental pitfalls. *International Journal of Sports Physiology and Performance, 15*(6), 907–913. https://doi.org/10.1123/ijspp.2019-0864

Open Food Facts. (2026). *Open Food Facts* [Data set]. Retrieved November 4, 2026, from https://world.openfoodfacts.org/

OpenJS Foundation. (2026a). *ESLint* (Version 10.10.0) [Computer software]. https://eslint.org/

OpenJS Foundation. (2026b). *Express* (Version 4.22.3) [Computer software]. https://expressjs.com/

OpenJS Foundation. (2026c). *Node.js* (Version 24.16.0) [Computer software]. https://nodejs.org/

Prettier. (2026). *Prettier* (Version 3.9.6) [Computer software]. https://prettier.io/

Strength Level. (2026). *Strength standards* [Data set]. Retrieved November 4, 2026, from https://strengthlevel.com/strength-standards

Yıldırım, H. E. (2026). *exercises-dataset* [Data set]. GitHub. https://github.com/hasaneyldrm/exercises-dataset

Zourdos, M. C., Klemp, A., Dolan, C., Quiles, J. M., Schau, K. A., Jo, E., Helms, E., Esgro, B., Duncan, S., Garcia Merino, S., & Blanco, R. (2016). Novel resistance training–specific rating of perceived exertion scale measuring repetitions in reserve. *Journal of Strength and Conditioning Research, 30*(1), 267–275. https://doi.org/10.1519/JSC.0000000000001049

zxing-js. (2024). *ZXing library* (Version 0.21.3) [Computer software]. https://github.com/zxing-js/library
