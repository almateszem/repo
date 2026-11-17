# Podium — az ITDK-előadás szövege

16 dia · kb. 12 perc nyugodt tempóban (1185 szó) · a keret 15 perc, így marad tartalék a kérdésekre vagy egy elcsúszásra.

Ugyanez a szöveg a diák előadói jegyzeteiben is benne van (PowerPointban: Diavetítés → Előadói nézet).

> **Lapozás:** a diák kézzel lapoznak (kattintás, nyíl vagy szóköz), automatikus továbblépés nincs beállítva.

| Dia | Cím | Idő | Eddig |
|---|---|---|---|
| 1 | Címdia | 0:30 | 0:30 |
| 2 | 01 · A probléma | 0:50 | 1:20 |
| 3 | 02 · A projekt kérdése | 0:30 | 1:50 |
| 4 | 03 · A megoldás | 0:45 | 2:35 |
| 5 | 04 · Funkciók | 0:45 | 3:20 |
| 6 | 05 · Recovery Engine | 1:15 | 4:35 |
| 7 | 06 · Regeneráció | 0:45 | 5:20 |
| 8 | 07 · Megbízhatóság | 0:50 | 6:10 |
| 9 | 08 · Blokkos programok | 0:55 | 7:05 |
| 10 | 09 · A mai edzés | 0:45 | 7:50 |
| 11 | 10 · Szabályok | 0:50 | 8:40 |
| 12 | 11 · Edzői panel | 0:45 | 9:25 |
| 13 | 12 · Technika | 0:45 | 10:10 |
| 14 | 13 · Ütemezés | 0:40 | 10:50 |
| 15 | 14 · Következő lépés | 0:45 | 11:35 |
| 16 | Zárás | 0:15 | 11:50 |

## 1. Címdia · kb. 0:30 (eddig 0:30)

Jó napot kívánunk! Kovács Valter, Dausek Csanád és Peresztegi Viktor vagyunk a Kaposvári Informatika Ágazati Képzőközpontból, a témavezetőnk Fogarasi András. A projektünk a Podium: egy böngészőből használható webalkalmazás, amely egy helyen kezeli az edzést, az étkezést és a pihenést, és minden reggel megbecsüli, mennyire áll készen a sportoló egy újabb edzésre – okosóra nélkül.

## 2. 01 · A probléma · kb. 0:50 (eddig 1:20)

Kezdjük a problémával. Aki rendszeresen edz, általában több külön eszközt használ. Az edzésnapló rögzíti, mit emelt – de nem tudja, hogyan aludt. Az étrendnapló számolja a kalóriát – de nem köti az edzéshez. Az okosóra becsli a felkészültséget, de külön eszköz, és gyakran havidíj kell hozzá. A személyi edző pedig táblázatban, papíron vagy chatben követi a klienseit, máshol, mint ahol azok naplóznak. Ezek az eszközök nem tudnak egymásról. A sportoló végül az érzéseire hagyatkozik: vagy túlterheli magát, vagy feleslegesen visszavesz.

## 3. 02 · A projekt kérdése · kb. 0:30 (eddig 1:50)

Ebből fogalmaztuk meg a projekt kérdését: megbecsülhető-e okosóra nélkül, mennyire áll készen a sportoló? Úgy, hogy csak abból dolgozunk, amit amúgy is beír: az edzésnaplóból, az étkezéseiből és egy rövid reggeli kérdőívből. Nem akartunk új mérőeszközt – a meglévő adatokból kellett kihozni a választ.

## 4. 03 · A megoldás · kb. 0:45 (eddig 2:35)

A válaszunk a Podium. Böngészőből fut, telepítés nélkül, telefonon és gépen is. Összeköti az edzés, az étkezés és a pihenés adatait, és minden reggel ad egy 0 és 100 közötti készenléti pontszámot. Ezt 12 izomcsoportra külön is lebontja, és ehhez semmilyen külön eszköz nem kell. A telefonon egy példa látszik: 64 százalék, vagyis a sportoló fáradt, érdemes visszavennie a terhelésből. És nem áll meg egy számnál: azt is megmondja, mit és mekkora súllyal érdemes ma edzeni.

## 5. 04 · Funkciók · kb. 0:45 (eddig 3:20)

Röviden a funkciók. Az edzésnaplóban 1441 gyakorlat közül lehet választani, szettenként súllyal, ismétléssel és érzett nehézséggel, és az app követi az egyéni csúcsokat. Edzéstervből kétféle van: egyszerű, ismétlődő ciklus, vagy az új blokkos program – erről később bővebben. A táplálkozásnaplóban 437 magyar étel van, saját étel is felvehető, és vonalkód-olvasó is van. Reggel egy rövid check-in kérdez az alvásról, az energiáról, a stresszről, az izomlázról és a fájdalomról. Ezekből számol a Recovery Engine, és van egy külön edzői panel is.

## 6. 05 · Recovery Engine · kb. 1:15 (eddig 4:35)

Ez a projekt legfontosabb része, a Recovery Engine. Három forrásból dolgozik. Az edzésnaplóból a terhelést számolja, ehhez Epley egyismétléses maximum-képletét és Foster terhelésmérési módszerét használjuk. A reggeli check-in Hooper és Mackinnon kérdőívére épül. A táplálkozásnál pedig azt nézi, mennyire teljesült a kalória-, a fehérje- és a vízcél. Ezekből hét összetevő lesz, mindegyik saját súllyal. A legnagyobb az alvásé, 25 százalék; az izmok állapota, az energiaszint és az edzésterhelés 15–15, a stressz és a közérzet 10–10, a táplálkozás 5 százalék. Fontos döntés volt, hogy a hiányzó adat nem nulla: ha valaki nem töltött ki valamit, annak a súlya arányosan szétoszlik a többi összetevő között. Az eredmény egy 0–100-as pontszám, és ugyanez izomcsoportonként. A példában a mell és a hát kipihent, a comb és a farizom viszont még fáradt.

## 7. 06 · Regeneráció · kb. 0:45 (eddig 5:20)

Így néz ki ez az appban, a Regeneráció oldalon. Bal oldalt a napi pontszám és a magyarázata, jobb oldalt egy testtérkép, ahol minden izomcsoportnál látszik, mennyire pihent ki. A fáradtság fokozatosan cseng le: a kis izmok gyorsabban regenerálódnak, a farizom és a törzs lassabban. Nem a megmozgatott tonnát számoljuk, hanem a nehéz, bukáshoz közeli szetteket, mert azok fárasztanak igazán; a bemelegítés nem számít bele. Ebből ad konkrét javaslatot: gyakorlatokat és súlyokat a mai állapothoz.

## 8. 07 · Megbízhatóság · kb. 0:50 (eddig 6:10)

Alapelvünk volt, hogy a pontszám ne találjon ki semmit. Ezt három szabály biztosítja. Egy: a hiányzó adat nem nulla – a pontszám nem torzul, csak a megbízhatósága csökken, és ezt ki is írjuk. Kettő: 14 nap edzés és 7 check-in után a sportolót a saját átlagához mérjük, nem egy általános normához; addig a pontszám mellett ott áll, hogy tájékoztató, közepes vagy megbízható. Három: biztonsági határ. Ha valaki egy tízes skálán 7-nél nagyobb fájdalmat jelez, az érintett izom gyakorlatai kimaradnak, és a napi pontszám legfeljebb 45 lehet, akármilyen jók a többi adatok.

## 9. 08 · Blokkos programok · kb. 0:55 (eddig 7:05)

Most jöjjön a legújabb funkció, a blokkos programozó. Sok erősportoló százalékalapú programmal edz, például az 5/3/1-gyel. Ilyenkor minden héten minden fő gyakorlatra kézzel kell kiszámolni a súlyokat a training maxból, vagyis a munka-maximumból. A Podiumban a program blokkokból áll össze: hét, nap, gyakorlat, szett, egymásba ágyazva, a blokktárból a helyükre húzva. Egy szett súlya pedig egy képlet, például a training max 85 százaléka. Ezt az app kiszámolja és 2,5 kilóra kerekíti – itt 125 kiló. Nem egy beégetett 5/3/1-kalkulátort írtunk, hanem általános eszközt: más százalék- vagy szabályalapú programok is leírhatók vele.

## 10. 09 · A mai edzés · kb. 0:45 (eddig 7:50)

A sportoló oldaláról ez így néz ki. Megnyitja az Edzés oldalt, és a program következő napja már be van töltve, kiszámolt kilókkal: itt a felhúzás 122,5, 140 és 157,5 kiló. A program az elvégzett edzések szerint halad, nem a naptár szerint, így egy kimaradt nap után sem csúszik el. A pirossal jelölt szett AMRAP-szett, vagyis ahány ismétlés csak megy; a ténylegesen elvégzett szám kerül a naplóba. Kézi számolás nincs: a sportoló csak azt írja be, amit elvégzett.

## 11. 10 · Szabályok · kb. 0:50 (eddig 8:40)

A programhoz szabályok is tartoznak, HA–AKKOR–KÜLÖNBEN formában. A képen látható szabály a ciklus végén fut: ha a próbán új egyismétléses rekord született, az új training max a rekord 95 százaléka; különben 2,5 vagy 5 kilóval nő. Szabály futhat minden edzés, minden hét vagy a ciklus végén, és nemcsak a teljesítményt nézheti, hanem a reggeli check-int is – így egy sérülésszabály is leírható. A legfontosabb elv: az app csak javasol. A javaslatot a sportoló jóváhagyja vagy átírja; a training maxot az app magától soha nem írja át.

## 12. 11 · Edzői panel · kb. 0:45 (eddig 9:25)

A második felhasználói kör a személyi edzőké. Az edző meghívja a sportolót, és amíg az el nem fogadja, semmit nem lát az adataiból. Utána egy panelen látja az összes kliensét: a készenlétüket, azt, hogy a kijelölt napon edzettek-e, és azt is, ki igényel figyelmet. Tervet ajánlhat és étrend-célt tűzhet ki; a terv másolatként kerül át, így a sportoló saját példányt kap. És van közös chat is. Táblázatok és papír helyett egyetlen hely.

## 13. 12 · Technika · kb. 0:45 (eddig 10:10)

Technikailag szándékosan egyszerű rendszert építettünk. A böngészőben HTML, CSS és JavaScript-modulok futnak, a szerver Node.js és Express, 101 végponttal, az adat pedig egyetlen SQLite-fájlban van. Így akár egy edzőterem is futtathatja a saját gépén. A biztonságra külön figyeltünk: a jelszavakat scrypttel, fiókonként külön sóval tároljuk, a munkamenet HttpOnly sütiben van, minden lekérdezés csak a saját fiók adatát adhatja vissza, és kéréskorlát védi a belépést, az írást és az üzeneteket. Mindezt 895 automatikus teszt ellenőrzi, és mind sikeres.

## 14. 13 · Ütemezés · kb. 0:40 (eddig 10:50)

Az ütemezés: 2026 júliusában kezdtünk, hárman. Augusztusban elkészült a Recovery Engine, a check-in és a fiókok, szeptemberben a 12 izomcsoportos követés. Októberben egy teljes kódátvizsgálás során 78 problémát javítottunk, novemberben pedig elkészült a blokkos programozó. Az öt célunkból négy teljesült; a könnyű használatot nagyrészt értük el – ezt igazán a valódi felhasználók mutatják majd meg.

## 15. 14 · Következő lépés · kb. 0:45 (eddig 11:35)

És ez a következő lépés. A rendszer működik és tesztelt, de hogy mennyit segít, azt csak valódi sportolókkal lehet megmérni. Három feltevést szeretnénk ellenőrizni: hogy okosóra nélkül is számolható olyan pontszám, amely követi, hogyan érzi magát a sportoló; hogy az izomcsoportonkénti követés csökkenti a túlterhelést; és hogy az edző kevesebbet adminisztrál, ha egy helyen látja az adatokat. A fejlesztésben pedig a blokkos programok kiosztása jön az edzők számára. Fontos kimondani a korlátot is: az összetevők súlyai saját becslések, a pontszám tájékoztató, nem orvosi vélemény.

## 16. Zárás · kb. 0:15 (eddig 11:50)

Köszönjük a figyelmet! Szívesen válaszolunk a kérdésekre, és ha van rá idő, élőben is megmutatjuk az appot.
