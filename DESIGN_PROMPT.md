# Prompt a Claude Design-hoz — FitTrack Pro layout

> Másold be az alábbi blokkot a `/design` parancs után (vagy a Claude Design
> beviteli mezőjébe). A tartalma a `GOMBOK.md` leltárából készült.

---

Tervezd meg a **FitTrack Pro** nevű edző–kliens edzésmenedzsment webalkalmazás
teljes képernyő-layoutját. Mobile-first, de desktop nézet is kell. Az app már
létezik és működik — a funkciók adottak, a feladat a **vizuális elrendezés
újratervezése**, nem új funkciók kitalálása.

## Kontextus

- **Felhasználók:** két szerepben ugyanaz a fiók — sportoló (saját edzés,
  táplálkozás, regeneráció) és edző (sportolói, tervkiosztás, üzenetek).
- **Használati helyzet:** edzés közben, konditeremben, egy kézzel, izzadt
  ujjal. A szett-rögzítésnek gyorsnak és hibatűrőnek kell lennie.
- **Nyelv:** magyar felület.
- **Hangulat:** letisztult, vonalas-tipografikus (nem kártya-halmozó),
  nagy számok, sötét alapon is olvasható. Sport-app, nem játék: ne legyen
  gamifikált, ne legyen díszítő illusztráció.

## Képernyők, amiket meg kell tervezni

Összesen **12 oldal + 9 modal**. Külön artboard kell mindegyiknek mobil (390px)
és desktop (1280px) szélességben, ahol a kettő érdemben eltér.

### 1. Áttekintés (kezdőoldal)
Elhelyezendő:
- Készenléti pontszám nagy számként (0–100%), rövid megjegyzéssel — **az egész
  blokk kattintható**, a Regenerációra visz
- Mai kalória a célhoz mérve (sáv) + három makró: fehérje, szénhidrát, zsír
- Öt mérőszám egy sorban: Alvás, Sorozat (nap), Fáradtság, Izomláz, Testsúly Δ
- 14 napos terhelés-trend oszlopdiagram (mobilon 7 nap is elég)
- Napi check-in emlékeztető sáv (csak amíg nincs kitöltve) → check-in
- Mai edzés előnézete: terv neve + gyakorlatlista
- **Elsődleges CTA: „Edzés indítása"**
- Két másodlagos link: „Étkezés", „Regeneráció"
- Motivációs idézet (opcionális, elhagyható)

### 2. Edzésnapló (a legfontosabb képernyő)
Oldalszint:
- Edzés neve — szerkeszthető cím-mező
- Automatikus mentés státuszjelző (mentve / mentés folyamatban / hiba)
- „Szerkesztés megszakítása" sáv (csak visszanyitott edzésnél)
- Gyakorlat-kártyák listája
- „+ Gyakorlat hozzáadása"
- **„Edzés befejezése"** — a lap elsődleges lezáró művelete
- Korábbi edzések listája, soronként „Javítás" és törlés
- Heti volumen diagram + „Ez a hét" / „Múlt hét" váltó
- Rekordok (PR) listája, sorok megnyithatók

Gyakorlat-kártya, felülről lefelé:
- „Szuperszett az előzővel" kapcsoló (csak a 2. kártyától)
- Sorrend-választó (a kártya pozíciója a listában)
- Gyakorlat neve
- PR-jelvény (**automatikus jelzés, NEM gomb** — vizuálisan is különbözzön)
- Videó-gomb (technika-videó)
- Gyakorlat eltávolítása (✕)
- Szett-sorok
- „+ Szett hozzáadása"

**Szett-sor — ez a legnehezebb elrendezési feladat.** Kilenc vezérlő:
szettszám (egyben típusválasztó: bemelegítő / munka / drop),
ismétlés (−, mező, +), súly (−, mező, +), RPE-mező, „teljesítve" pipa,
törlés (✕). Mobilon 390px-en is működnie kell, egy hüvelykujjal, futás
közben. Oldd meg: két sorba tördeléssel, elrejtett másodlagos vezérlőkkel,
swipe-pal — de a pipa és a két számmező mindig egy koppintásra legyen.

### 3. Táplálkozás
- Napi összesítő: bevitel / cél kcal, alatta három makró
- Napi cél blokk: aktuális cél, forrása (saját vagy edzői), „Módosítom",
  és „Visszaállok rá" ha eltérsz az edzői céltól; kinyíló űrlap (kalória, fehérje)
- **Vízmérő:** liter-érték, cél, töltési sáv, „+250 ml" és „Visszavonás"
- Mai napló: tételek listája, soronként szerkesztés és törlés
- Két művelet: „+ Étel hozzáadása", „Vonalkód" (ikonos)
- Étel-kereső mező
- Étel-kártyák listája, kártyánként „→" (részletek) és saját ételnél törlés

### 4. Tervek
- „+ Új terv"
- Terv-kártyák: név, ütemezett napok, gyakorlatszám; kártyánként szerkesztés,
  törlés és „→" (betöltés az edzésnaplóba)
- Üres állapot

### 5. Terv-építő (flow-oldal)
- Fejléc: „←" vissza, terv neve (szerkeszthető), „Mentés"
- Hétnap-chipek (H K Sze Cs P Szo V) — többet is ki lehet jelölni
- Gyakorlat-kártyák (mint az edzésnaplóban, de PR/videó/szuperszett nélkül)
- „+ Gyakorlat hozzáadása"

### 6. Gyakorlat-választó (flow-oldal)
- Fejléc: „←" vissza + cím + „melyik edzéshez"
- Keresőmező
- Szűrő-chipek: „Mind" + izomcsoportok (vízszintesen görgethető)
- Találatszám
- Gyakorlat-kártyák: illusztráció (hoverre animált), név, izomcsoport-címkék,
  hozzáadás-kapcsoló
- Licenc-sor a lap alján

### 7. Regeneráció
- Készenléti pontszám körkijelzővel (itt megmarad a gyűrű)
- Check-in CTA
- Gyors check-in űrlap: alvás (−/+), négy 1–5 skála (energia, izomláz, stressz,
  hangulat), folyadék (−/+), testsúly (−/+), „Check-in mentése"
- Testsúly-grafikon + bejegyzés-lista (soronként szerkeszthető érték és törlés)
- Testösszetétel: 7 mérési hely + testzsír%, „Mérés mentése", mérés-lista törléssel
- Három elemző lista: pontszám-komponensek, izomcsoportonkénti regeneráció,
  gyakorlat-ajánlások (mindegyik sávos, nem kattintható)

### 8. Napi check-in varázsló (teljes képernyős flow)
Egy kérdés egy képernyőn, felül „←" + folyamatsáv + „3/6". Lépéstípusok:
- **Intro:** cím + „Kezdjük" + „Mégse"
- **Alvás:** nagy szám −/+ léptetővel, alatta gyors-preset gombok (6, 6.5, 7…)
- **Testsúly:** ugyanaz + „Ma nem mértem" kihagyás
- **Skála:** 1–5 chip-sor, nagy koppintható felület
- **Kapu (igen/nem):** két nagy gomb címkével és alcímmel
- **Testtérkép:** „Elöl"/„Hátul" váltó + emberalak kattintható izomcsoport-
  régiókkal, kiválasztás után régiónként 1–5 érték-chipek
- **Összegző:** a megadott értékek listája + „Mentés"

### 9. Edző
Nézetváltó két füllel (értesítés-badge-ekkel): „Edződ" / „Edzetteim".
- **Kliens nézet:** beérkezett edző-meghívók (Elfogadás/Elutasítás),
  felajánlott tervek (Elfogadás/Elutasítás), az edződ fejléce + „Leválás",
  üzenet-szál + beviteli sor küldés-gombbal
- **Edzői nézet:** meghívás felhasználónévvel (mező + „Meghívás"), kiküldött
  meghívók visszavonással, **állapot-sáv** (hány sportoló igényel figyelmet,
  kattintható sorokkal), sportoló-kártyák rácsa

### 10. Edzés-összegző (edzés után)
- Fejléc: „Edzés befejezve" + edzés neve + biztató mondat
- PR-értesítés sáv (ha született rekord)
- Két statisztika: teljesített szett / összes, időtartam
- Visszajelzés az edzőnek: két 1–5 skála (nehézség, közérzet) + megjegyzés-mező
  + „Visszajelzés küldése"
- Megjegyzés egy gyakorlathoz: gyakorlat-választó + szöveg + „Hozzáfűzöm"
- „Vissza az áttekintéshez" + „Vissza az edzéshez"

### 11. Profil
- Avatar + név + felhasználónév + csatlakozás dátuma
- Négy összesítő: naplózott edzés, napos sorozat, gyakorlat rekorddal,
  teljesített munkasorozat
- Részletek lista (első/legutóbbi edzés, testsúly, változás)
- Erőfelmérés: lista + űrlap (gyakorlat, súly, ismétlés) + „Hozzáadom"
- „Beállítások" és „Kijelentkezés"

### 12. Bejelentkezés / regisztráció
Felhasználónév, név, jelszó, „Belépés", és váltó a regisztrációra.

### Modalok (mind a 9)
1. **Beállítások** — a legsűrűbb: megjelenítendő név, 4 értesítés-kapcsoló,
   cél-választó, „Adatok exportálása (JSON)", jelszóváltás (kinyíló),
   „Kijelentkezés", fiók törlése (kinyíló, veszélyes), „Kész"
2. **Sportoló részletei** (edzőnek) — állapot, statisztikák, megjegyzés-szálak
   válasz-mezővel, napi cél kitűzése, edzés utáni visszajelzés, három művelet:
   „Kapcsolat bontása" (veszélyes), „Terv kiosztása", „Üzenet" — plusz a
   kinyíló terv-kiosztó és üzenet-szál
3. **Étel részletei** — makrók a választott adagra, két cél-sáv, gyors adag-chipek,
   „ma ebből" lista, alsó akció-sáv: „Hozzáadás" + görgethető gramm-választó + „→"
4. **Saját étel felvitele** — név, csoport, egység, 3 makró, kcal (auto, javítható),
   vonalkód + szkennelés-gomb, „Mégse" / „Mentés" / „Mentés és naplózás"
5. **Vonalkód-olvasó** — kamerakép kerettel, vaku-kapcsoló, státusz,
   kézi kód-mező + „Keresés"
6. **Technika-videó** — videólejátszó + bezárás
7. **Rekord részletei** — a PR előzményei
8. **Készenlét-javaslat** (check-in után) — tételes lista + „Elfogadom" / „Most nem"
9. **Megerősítés** — szöveg + „Mégse" / „Folytatás"

### Globális keret
- **Fejléc:** profil-avatar (bal), értesítés-harang számláló-badge-dzsel,
  beállítások-fogaskerék (jobb). A harang lenyíló panelt nyit, „Összes olvasott"
  gombbal.
- **Desktop navigáció:** oldalsáv 6 ponttal — Áttekintés, Regeneráció, Edző,
  Tervek, Edzés, Táplálkozás
- **Mobil navigáció:** húzható kerek gomb a képernyő alján — négy irányba
  húzva vált oldalt (↑ Edző, ↓ Tervek, ← Edzés, → Táplálkozás), koppintásra
  Áttekintés. Ez a jelenlegi megoldás — **tervezz rá alternatívát is** (lásd lent).
- Toast-értesítések

## Konkrét problémák, amiket a designnak meg kell oldania

1. **A két navigáció nem fedi le ugyanazt.** A desktop oldalsáv 6 oldalt ad, a
   mobil nav gyűrű csak 4-et. A Regenerációra mobilon egyetlen út van (az
   Áttekintés készenlét-blokkja), és a Profil sincs benne egyikben sem.
   Adj olyan mobil navigációt, ami mind a 6 fő oldalt eléri.
2. **Négy oldal egyetlen gombtól függ** (összegző, terv-építő,
   gyakorlat-választó, check-in) — ezek a belépő gombok ne tudjanak elveszni
   a görgetésben.
3. **Kétszeres check-in.** A teljes varázsló és a Regeneráció oldal rövid
   űrlapja ugyanazt az adatot gyűjti. Döntsd el, melyik a fő út, és a másik
   kapjon jóval kevesebb helyet (vagy tűnjön el).
4. **Az Áttekintésen csak a készenlét kattintható.** A táplálkozás-blokk, a
   mérőszám-sor és a mai gyakorlatok listája is kínálja magát belépőnek —
   vagy tedd azzá, vagy vizuálisan mondd ki, hogy nem az.
5. **A szett-sor mobilon.** Kilenc vezérlő egy sorban — lásd fent.
6. **Duplázott műveletek.** A „Kijelentkezés" a Profilon és a Beállításokban is
   ott van, a „Beállítások" a fejlécben és a Profilon is. Döntsd el, hol a helyük.
7. **Nem kattintható, de annak néző elemek:** a PR-jelvény, a diagramok, és a
   Regeneráció három elemző listája. Ezek kapjanak más vizuális kezelést,
   mint az interaktív elemek.

## Amit még hagyj helyet neki (még nincs megépítve)

- **„SOS sérülés" gomb** az edzésnaplóban — edzés közben elérhető, rögzíti hol
  és mennyire fáj, lezárja az edzést, szól az edzőnek. Kiemelt, de nem
  véletlenül megnyomható helyre kell.
- Szezon-fázis és célsúly beállítás (Beállítások vagy Profil)
- Ajánlott gyakorlatok blokk a gyakorlat-választó tetején
- Kardió-naplózás (idő, táv, pulzus) az edzésnaplóban
- Adat-import a Beállításokban, az export mellé

## Kimenet

Egy canvas, artboardonként egy képernyő, ebben a sorrendben:
Áttekintés (mobil + desktop) → Edzésnapló (mobil + desktop) → szett-sor
variációk külön artboardon → Táplálkozás → Tervek → Terv-építő →
Gyakorlat-választó → Regeneráció → Check-in varázsló (3–4 lépéstípus) →
Edző (mindkét nézet) → Edzés-összegző → Profil → Bejelentkezés →
a 9 modal → navigációs komponens-variációk.

Minden artboardon jelöld a **elsődleges műveletet**. Ahol vezérlőt
elrejtettél vagy összevontál, tedd mellé egy rövid jegyzetben, hogy mi lett vele.
