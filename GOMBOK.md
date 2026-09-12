# FitTrack Pro — gomb- és interakció-leltár

Layout-munkához készült teljes lista: MI VAN MA az alkalmazásban, és MI HIÁNYZIK
még. Képernyőnként csoportosítva, a tényleges DOM-forrás megjelölésével
(`public/index.html` sor, sablon-azonosító vagy a JS-modul, ami építi).

Jelölések:
- **[S]** statikus markup az `index.html`-ben
- **[T]** `<template>`-ből klónozva (listaelemenként ismétlődik)
- **[JS]** futásidőben, JS-ből generált (chip, kapcsoló, opció)
- **[G]** gesztus / billentyű, nem látható gomb

---

## 0. Globális — minden oldalon látszik

| Elem | Típus | Forrás | Megjegyzés |
|---|---|---|---|
| „Ugrás a tartalomhoz" skip-link | [S] | `index.html:35` | Csak fókuszra látszik |
| Oldalsó navigáció: Áttekintés / Regeneráció / Edző / Tervek / Edzés / Táplálkozás | [S] | `index.html:87–92` | **Csak desktopon** (`.side-nav`) — 6 link |
| Profil-avatar gomb (`data-action="profile"`) | [S] | `index.html:112` | Fejléc bal |
| Értesítés-harang (`data-action="notifications"`) | [S] | `index.html:122` | Számláló-badge-dzsel |
| Beállítások fogaskerék (`data-action="settings"`) | [S] | `index.html:128` | Modalt nyit |
| „Összes olvasott" (`clear-notifications`) | [S] | `index.html:137` | Az értesítés-panel fejlécében |
| Értesítés-panel elemei | [JS] | `js/ui/notifications.js` | Kattintható sorok |
| **Nav gyűrű** (`#navKnob`) | [S]+[G] | `index.html:1095`, `js/nav/navring.js` | **Csak mobil/tablet.** Húzás: ↑ Edző, ↓ Tervek, ← Edzés, → Táplálkozás; koppintás = Áttekintés; nyílbillentyűk + Enter/Space ugyanez |
| Gyorsbillentyűk 1–6 | [G] | `js/ui/shortcuts.js`, `core/constants.js` | 1 Áttekintés, 2 Regeneráció, 3 Edző, 4 Tervek, 5 Edzés, 6 Táplálkozás. Modal nyitva és a check-inben inaktív |
| Toast-üzenetek | [JS] | `js/core/toast.js` | Nem kattintható |

> **Layout-jegyzet:** a Regeneráció **nincs** a nav gyűrű négy iránya között —
> mobilon csak az Áttekintés készenlét-blokkja visz oda. A flow-oldalak
> (összegző, terv-építő, gyakorlat-választó, check-in) egyik navigációban
> sincsenek benne, csak saját belépő gombbal érhetők el.

---

## 1. Bejelentkezés / regisztráció (`.au-*`)

| Elem | Típus | Forrás |
|---|---|---|
| Felhasználónév / Név / Jelszó mezők | [S] | `index.html:52–66` |
| „Belépés" (submit) | [S] | `index.html:73` |
| „Regisztráció" ↔ „Belépés" váltó (`data-au-switch`) | [S] | `index.html:78` |

---

## 2. Áttekintés — `#dashboard` (`.db-*`)

| Elem | Típus | Forrás | Megjegyzés |
|---|---|---|---|
| Készenlét-blokk → `#recovery` | [S] link | `index.html:166` | **Az egész blokk kattintható** — mobilon ez az egyetlen út a Regenerációhoz |
| Táplálkozás-blokk (kalória + makrók) | [S] | `index.html:178` | **Nem kattintható ma** |
| Mérőszám-sor (Alvás, Sorozat, Fáradtság, Izomláz, Testsúly Δ) | [S] | `index.html:208` | **Nem kattintható ma** |
| 14 napos terhelés-trend diagram | [S] | `index.html:234` | Statikus kép (`role="img"`) |
| Check-in emlékeztető CTA → `#checkin` | [S] link | `index.html:249` | Rejtett, ha a mai check-in kész |
| „Edzés indítása" (`open-workout`) | [S] | `index.html:274` | Elsődleges CTA, jobb hasáb |
| „Étkezés" → `#nutrition` | [S] link | `index.html:278` | |
| „Regeneráció" → `#recovery` | [S] link | `index.html:279` | |
| Mai gyakorlatok listája | [JS] | `js/render/dashboard.js` | **Nem kattintható ma** |

---

## 3. Profil — `#profile` (`.pf-*`)

| Elem | Típus | Forrás |
|---|---|---|
| Erőfelmérés: gyakorlat (datalist), súly, ismétlés mezők | [S] | `index.html:366–377` |
| „Hozzáadom" (submit) | [S] | `index.html:380` |
| Felmérés-lista sorai | [JS] | `js/ui/profile.js:65` |
| „Beállítások" (`settings`) | [S] | `index.html:388` |
| „Kijelentkezés" (`logout`) | [S] | `index.html:389` |

---

## 4. Edzésnapló — `#workout` (`.wk-*`)

### Oldalszintű

| Elem | Típus | Forrás |
|---|---|---|
| Edzés neve — szövegmező | [S] | `index.html:402` |
| „Szerkesztés megszakítása" (`cancel-workout-edit`) | [S] | `index.html:411` |
| „+ Gyakorlat hozzáadása" (`workout-add-exercise`) | [S] | `index.html:428` |
| **„Edzés befejezése"** (`finish-workout`) | [S] | `index.html:431` |
| Heti volumen: „Ez a hét" / „Múlt hét" váltó | [S] | `index.html:450–451` |
| Korábbi edzés sor: „Javítás" (`reopen-workout`) | [T] `tpl-history-entry` | `index.html:1753` |
| Korábbi edzés sor: „✕" törlés (`delete-workout`) | [T] | `index.html:1754` |
| Rekord-sor (`.wk-pr-item`) — modalt nyit | [T] `tpl-pr` | `index.html:1851`, `js/ui/workout.js:250` |
| Autosave-státusz | [S] | `index.html:416` — jelző, nem gomb |

### Gyakorlat-kártya (`tpl-exercise`, `index.html:1642`)

| Elem | Megjegyzés |
|---|---|
| „Szuperszett az előzővel" kapcsoló | Csak a 2. kártyától, csak edzésnaplóban |
| Sorrend-választó (`.wk-order-trigger` + saját lenyíló) | Átrendezés; csak edzésnaplóban |
| „PR" jelző | Automatikus, `tabindex="-1"` — **nem kattintható**, csak jelzés |
| Videó gomb (`.wk-video-btn`) | Technika-videó modal |
| „✕" gyakorlat eltávolítása | Csak edzésnaplóban |
| „+ Szett hozzáadása" | [JS] `js/render/sets.js:308` |

### Szett-sor (`tpl-set-row`, `index.html:1697`)

| Elem | Megjegyzés |
|---|---|
| Szettszám-gomb = típusválasztó (bemelegítő / munka / drop) | Saját lenyíló listbox |
| Ismétlés: − / mező / + | Léptetők `tabindex="-1"` |
| Súly: − / mező / + | Lépésköz 2.5 kg |
| RPE-mező | 1–10, fél fokozat, üresen hagyható |
| „✓" szett teljesítve | `aria-pressed` |
| „✕" szett törlése | |

---

## 5. Terv-építő — `#plan-builder` (`.pb-*`) — flow-oldal

| Elem | Típus | Forrás |
|---|---|---|
| „←" Vissza a tervekhez (`builder-back`) | [S] | `index.html:483` |
| Terv neve — szövegmező | [S] | `index.html:485` |
| „Mentés" (`save-plan`) | [S] | `index.html:487` |
| Hétnap-chipek (H–V, 7 db) | [JS] | `js/ui/plan-builder.js:31` |
| „+ Gyakorlat hozzáadása" (`builder-add-exercise`) | [S] | `index.html:503` |
| Gyakorlat-kártyák + szett-sorok | [T] | ugyanaz, mint fent (PR/videó/sorrend/szuperszett rejtve) |

---

## 6. Gyakorlat-választó — `#exercise-picker` (`.ep-*`) — flow-oldal

| Elem | Típus | Forrás |
|---|---|---|
| „←" Vissza (`picker-back`) | [S] | `index.html:515` |
| Keresőmező | [S] | `index.html:525` |
| Szűrő-chipek (Mind + izomcsoportok) | [JS] | `js/ui/exercise-picker.js:60` |
| Kártyánkénti hozzáadás-kapcsoló (`.ep-item-toggle`) | [T] `tpl-picker-item` | `index.html:1740` |
| Kártya-illusztráció hover/fókusz → gif csere | [G] | `js/ui/exercise-picker.js:513` |
| „Gym visual" licenc-link | [S] | `index.html:537` |

---

## 7. Táplálkozás — `#nutrition` (`.nu-*`)

| Elem | Típus | Forrás | Megjegyzés |
|---|---|---|---|
| „Módosítom" napi cél (`edit-goal`) | [S] | `index.html:572` | Kinyitja az űrlapot |
| „Visszaállok rá" (`revert-goal`) | [S] | `index.html:581` | Csak ha eltérsz az edzői céltól |
| Cél-űrlap: kalória, fehérje + „Mentés" | [S] | `index.html:587–595` | |
| **Víz:** „Visszavonás" (`undo-water`) | [S] | `index.html:615` | Rejtett, amíg nincs mit visszavonni |
| **Víz:** „+250 ml" (`add-water`) | [S] | `index.html:617` | |
| Napló-sor: szerkesztés (`.nu-log-edit`) | [T] `tpl-nutrition-entry` | `index.html:1768` | |
| Napló-sor: „✕" törlés (`.nu-log-remove`) | [T] | `index.html:1770` | |
| „+ Étel hozzáadása" (`add-custom-food`) | [S] | `index.html:645` | Modal |
| „Vonalkód" (`scan-barcode`) | [S] | `index.html:647` | Modal |
| Étel-kereső mező | [S] | `index.html:659` | |
| Étel-kártya: „→" részletek (`.nu-food-add`) | [T] `tpl-food` | `index.html:1784` | Étel-modalt nyit |
| Étel-kártya: „✕" saját étel törlése (`.nu-food-remove`) | [T] | `index.html:1783` | Csak saját ételnél |

---

## 8. Tervek — `#plans` (`.pl-*`)

| Elem | Típus | Forrás |
|---|---|---|
| „+ Új terv" (`new-plan`) | [S] | `index.html:674` |
| Terv-kártya: szerkesztés (`.pl-card-edit`) | [T] `tpl-plan` | `index.html:1808` |
| Terv-kártya: törlés (`.pl-card-delete`) | [T] | `index.html:1812` |
| Terv-kártya: „→" betöltés az edzésnaplóba (`.pl-card-open`) | [T] | `index.html:1814` |

---

## 9. Edző — `#coach` (`.co-*`)

### Nézetváltó
| Elem | Típus | Forrás |
|---|---|---|
| „Edződ" / „Edzetteim" váltó (badge-ekkel) | [S] | `index.html:693–695` |

### Kliens nézet
| Elem | Típus | Forrás |
|---|---|---|
| Meghívó: „Elfogadás" / „Elutasítás" | [JS] | `js/render/coach.js:118` |
| Felajánlott terv: „Elfogadás" / „Elutasítás" | [JS] | `js/render/coach.js:171` |
| „Leválás" az edzőről (`leave-coach`) | [S] | `index.html:723` |
| Üzenet-mező + „→" küldés | [S] | `index.html:729–730` |

### Edzői nézet
| Elem | Típus | Forrás |
|---|---|---|
| Meghívás: felhasználónév-mező + „Meghívás" | [S] | `index.html:750–752` |
| Kiküldött meghívó: „Visszavonás" | [JS] | `js/render/coach.js:118` |
| Állapot-sáv riasztás-sorai (modalt nyitnak) | [JS] | `js/render/coach.js:211` |
| Sportoló-kártya (egész kártya gomb) | [T] `tpl-athlete-card` | `index.html:1826` |

### Sportoló-modal (`#athleteModal`)
| Elem | Típus | Forrás |
|---|---|---|
| „✕" bezárás | [S] | `index.html:1253` |
| Megjegyzés-szálak: válasz-mező + „Küldés" | [JS] | `js/ui/coach.js:182` |
| Napi cél: kalória, fehérje + „Kitűzöm" | [S] | `index.html:1287–1295` |
| „Kapcsolat bontása" (`remove-athlete`) | [S] | `index.html:1305` |
| „Terv kiosztása" (`assign-plan`) | [S] | `index.html:1306` |
| „Üzenet" (`message`) | [S] | `index.html:1308` |
| Terv-kiosztás: terv-választó + megjegyzés + „Kiosztás" | [S] | `index.html:1317–1325` |
| Üzenet-szál: mező + „→" küldés | [S] | `index.html:1336–1337` |

---

## 10. Edzés-összegző — `#summary` (`.su-*`) — flow-oldal

| Elem | Típus | Forrás |
|---|---|---|
| Visszajelzés: 1–5 skála-chipek (nehézség, közérzet) | [JS] | `js/ui/summary.js` |
| Megjegyzés-mező (500 karakter) | [S] | `index.html:818` |
| „Visszajelzés küldése" | [S] | `index.html:821` |
| Gyakorlat-megjegyzés: gyakorlat-választó + szöveg + „Hozzáfűzöm" | [S] | `index.html:835–839` |
| „Vissza az áttekintéshez" (`summary-dashboard`) | [S] | `index.html:845` |
| „Vissza az edzéshez" → `#workout` | [S] link | `index.html:849` |

---

## 11. Regeneráció — `#recovery` (`.rc-*`)

| Elem | Típus | Forrás | Megjegyzés |
|---|---|---|---|
| Check-in CTA → `#checkin` | [S] link | `index.html:897` | |
| **Gyors check-in űrlap** (a lapon): alvás −/+, energia/izomláz/stressz/hangulat skála-chipek, folyadék −/+, testsúly −/+ | [S]+[JS] | `index.html:920–964`, `js/render/recovery.js:49` | A chipek 1–5; **újrakoppintásra törlődik** a választás |
| „Check-in mentése" (submit) | [S] | `index.html:973` | |
| Testsúly-bejegyzés: szerkeszthető érték-mező | [JS] | `js/ui/weight.js` | |
| Testsúly-bejegyzés: „✕" törlés | [JS] | `js/ui/weight.js:156` | |
| Testösszetétel: mezőnkénti bevitel (7 hely + testzsír%) | [JS] | `js/ui/measurements.js` | |
| „Mérés mentése" (submit) | [S] | `index.html:1009` | |
| Mérés-sor: „✕" legutóbbi törlése | [JS] | `js/ui/measurements.js:92` | |
| Komponens-, izomcsoport- és gyakorlat-ajánlás listák | [T] | `index.html:1894–1918` | **Nem kattintható ma** |

---

## 12. Napi check-in varázsló — `#checkin` (`.ci-*`) — flow-oldal

| Elem | Típus | Forrás |
|---|---|---|
| „←" Vissza az előző kérdéshez (`checkin-back`) | [S] | `index.html:1068` |
| Folyamatsáv + lépésszám | [S] | `index.html:1070` — jelző |
| **Intro:** „Kezdjük" (`checkin-next`) | [T] `tpl-ci-intro` | `index.html:1950` |
| **Intro:** „Mégse" → `#dashboard` | [T] link | `index.html:1956` |
| **Alvás:** −/+ léptetők + mező | [T] `tpl-ci-sleep` | `index.html:1974–1979` |
| **Alvás:** gyors-preset gombok (óra-értékek) | [JS] | `js/ui/checkin/steps/sleep.js:36` — koppintásra automatikusan tovább |
| **Testsúly:** −/+ léptetők + mező, presetek | [T]+[JS] | `index.html:2006–2012`, `steps/weight.js:86` |
| **Testsúly:** „Ma nem mértem" kihagyás | [T] | `index.html:2024` |
| **Skála-lépések:** 1–5 chipek | [JS] | `steps/scale.js:38` |
| **Kapu-lépések:** „Nem" / „Igen" (2 nagy gomb) | [JS] | `steps/gate.js:19` |
| **Testtérkép:** „Elöl" / „Hátul" váltó | [T] `tpl-ci-map` | `index.html:2070–2071` |
| **Testtérkép:** izomcsoport-régiók (kattintható területek) | [JS] | `steps/map.js:61` |
| **Testtérkép:** régiónkénti 1–5 érték-chipek | [JS] | `steps/map.js:153` |
| Lépésenkénti „Tovább" (`checkin-next`) | [T] | `index.html:1986, 2021, 2042, 2078` |
| **Összegző:** „Mentés" (`checkin-save`) | [T] `tpl-ci-summary` | `index.html:2118` |
| **Összegző:** „Vissza a regenerációhoz" | [T] link | `index.html:2120` |
| Számbillentyűk 1–5 = válasz | [G] | `js/ui/shortcuts.js` (a varázslóban felülírva) |

---

## 13. Modalok

| Modal | Gombjai | Forrás |
|---|---|---|
| **Technika-videó** (`#videoModal`) | „✕", háttérre kattintás | `index.html:1114` |
| **Rekord-részletek** (`#prModal`) | „✕", háttér; előzmény-sorok | `index.html:1140`, `tpl-pr-history-item` |
| **Beállítások** (`#settingsModal`) | „✕"; megjelenítendő név mező; értesítés-kapcsolók (4 db: Új üzenet, Edző-kapcsolat, Terv kiosztva, Egyéni csúcs); cél-választó; „Adatok exportálása (JSON)"; „Jelszó módosítása" nyitó + jelenlegi/új jelszó + „Jelszó mentése"; „Kijelentkezés"; „Fiók törlése" nyitó + jelszó + „Fiók végleges törlése"; „Kész" | `index.html:1154–1230` |
| **Sportoló** (`#athleteModal`) | lásd 9. pont | `index.html:1253` |
| **Saját étel** (`#customFoodModal`) | „✕"; név, csoport-választó, egység-választó, fehérje/szénh./zsír, kcal + „visszaállítás" nyíl, vonalkód-mező + szkennelés-gomb; „Mégse", „Mentés", „Mentés és naplózás" | `index.html:1359–1443` |
| **Vonalkód-olvasó** (`#scannerModal`) | „✕"; vaku-kapcsoló (🔦); kézi kód-mező + „Keresés" | `index.html:1462–1483` |
| **Étel részletek** (`#foodModal`) | „✕"; gyors adag-chipek; görgethető gramm-választó (`role="spinbutton"`, húzható/nyílbillentyűs); „Hozzáadás"; „→" | `index.html:1503–1577` |
| **Készenlét-javaslat** (`#adviceModal`) | „✕"; „Most nem"; „Elfogadom" | `index.html:1595–1602` |
| **Megerősítés** (`#confirmModal`) | „✕"; „Mégse"; „Folytatás" | `index.html:1619–1624` |

Minden modal háttere (`data-close-modal`) kattintásra zár; Esc szintén.

---

## 14. Ami HIÁNYZIK — tervezett, de még nincs felület (TEENDOK.txt)

| Hiányzó vezérlő | Hova kell | Forrás |
|---|---|---|
| **„SOS sérülés" gomb** | Edzésnapló, edzés közben elérhető helyre. Rögzíti hol/mennyire fáj, lezárja az edzést, letiltja az izmot mára, szól az edzőnek. Vészjelzés-lista is tartozik hozzá | `TEENDOK.txt:184` |
| **Szezon-fázis + célsúly beállítás** | Beállítások vagy Profil; a napi kalória/fehérje célt hajtja. Ütem-figyelmeztetés kell hozzá (>1%/hét) | `TEENDOK.txt:207` |
| **Ajánlott gyakorlatok blokk** | Gyakorlat-választó teteje — a cím + izomcsoportos készenlét alapján | `TEENDOK.txt:222` |
| **Kardió/állóképesség naplózás** | Edzésnapló — idő/táv/pulzus mezők; sémabővítést igényel | `TEENDOK.txt:325` |
| **Adat-import** | Beállítások, az „Adatok exportálása" mellé | `TEENDOK.txt:347` |

## 15. Layout-szempontból figyelendő pontok

1. **Két külön navigáció.** Desktopon `.side-nav` (6 link), mobilon a nav gyűrű
   (4 irány + koppintás). Ami az egyikből kimarad, arra máshonnan kell belépő —
   ma a Regeneráció ilyen (csak az Áttekintés készenlét-blokkjából).
2. **Négy flow-oldalnak egyetlen belépője van** (`#summary`, `#plan-builder`,
   `#exercise-picker`, `#checkin`) — mindegyik egy-egy konkrét gombtól függ.
3. **Kétszeres check-in felület.** A teljes varázsló (`#checkin`) és a
   Regeneráció oldal rövid űrlapja ugyanazt az adatot gyűjti — érdemes eldönteni,
   melyik a fő út, a másik helyigénye csökkenthető.
4. **Az Áttekintés jobb hasábja 3 műveletet visz** (Edzés indítása + 2 link);
   a bal hasáb blokkjai közül csak a készenlét kattintható — a táplálkozás-blokk
   és a mérőszám-sor kínálja magát belépőnek.
5. **Sűrű sorok:** a szett-sor 9 vezérlőt tesz egy sorba (típus, −/mező/+ ×2,
   RPE, ✓, ✕) — ez a legszűkebb hely mobilon.
6. **Duplázott műveletek:** „Kijelentkezés" a Profilon és a Beállításokban is;
   „Beállítások" a fejléc fogaskerekében és a Profilon is.
7. **Nem kattintható, de annak néző elemek:** a PR-jelvény a gyakorlat-kártyán
   (`tabindex="-1"`), a diagramok (`role="img"`), a Regeneráció komponens-,
   izomcsoport- és ajánlás-listái.
