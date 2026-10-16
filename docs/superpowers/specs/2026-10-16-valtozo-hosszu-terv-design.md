# Változó hosszú edzésterv (1–14 napos ciklus) — terv

## Szándék

Ma egy terv pontosan egy hét (hétfő–vasárnap), és az Edzés oldal a mai
**hétnap** alapján tölti be a mai edzést. Vannak, akik 7 napnál hosszabb
(pl. 9 napos) vagy rövidebb (pl. 3 napos) ismétlődő tervvel dolgoznak — nekik
ez ma nem megoldható. A cél: a terv hossza 1 és 14 nap között szabadon
állítható legyen, és a terv **ciklusként** ismétlődjön.

## Döntések (a felhasználóé)

- **Hozzáadás:** a terv-építő napok-sávjának végén egy „+” gomb, egyesével
  ad hozzá napot.
- **Törlés:** minden nap sarkában egy „X”. Törléskor a nap **tartalma**
  tűnik el, a nevek nem: a sor feljebb csúszik, a nevek mindig sorban
  következnek (H, K, SZE, CS, P, SZO, V, H, K, …). Ha a keddet törlöd, a
  szerdai tartalom lesz a kedd.
- **Hossz:** legalább 1, legfeljebb 14 nap.
- **Ciklus:** a terv a végére érve elölről kezdődik. A ciklus az
  **aktiválás hetének hétfőjétől** számít: aki szerdán aktivál, az rögtön
  a „SZE” napon áll. A 7 napos terv így pontosan úgy viselkedik, mint ma.
- **Ismétlődő nevek:** a 8.–14. nap neve újra H…V, „2.” jelöléssel: a sávban
  a betű alatt kis „2.”, minden más helyen „Hétfő (2.)”.
- A látványterv (`.superpowers/brainstorm/…/napok-sav.html`) jóváhagyva:
  9 napos sáv X-ekkel és „+”-szal, törlés-csúszás, hozzáadás, mobilnézet.

## Döntések (az enyémek — a felhasználó jóváhagyta az összefoglalót)

- Az új nap mindig **pihenőként** kerül a **sor végére**.
- 1 napos tervnél nincs X; 14 napnál a „+” tiltott (elszürkül).
- Ha a törölt napon **gyakorlatok vannak**, megerősítést kérünk
  („Biztosan törlöd a szerdát és 4 gyakorlatát?”). Pihenőnap törlése
  kérdés nélkül megy. A megerősítés az app saját párbeszédablaka, nem
  böngésző-`confirm()`.
- A sáv felirata 7 napnál marad „A hét — hetente ismétlődik”; más hossznál
  „A ciklus — N nap, utána elölről kezdődik”.
- Az aktív terv hosszának módosítása **nem** indítja újra a ciklust: a
  kezdő hétfő marad, a mai nap újraszámolódik (tehát a „ma” másik napra
  ugorhat). Újraaktiválás (ki-, majd bekapcsolás, vagy másik terv után
  vissza) új kezdő hétfőt ad.
- A meglévő 7 napos tervek semmiben nem változnak — sem adatban, sem
  viselkedésben.
- Ha a törlés miatt a kiválasztott nap megszűnik, az előző nap (vagy az
  utolsó) lesz kiválasztva.

## Adatmodell

- A `plans.week` tömb hossza 1–14 lehet (ma kötelezően 7). A napok indexe
  a ciklusban elfoglalt hely (0 = első nap); a nap neve
  `DAY_NAMES[i % 7]`, és ha `i >= 7`, „(2.)” utótagot kap.
- Új oszlop: `plans.active_since` — az aktiválás **napja** (napkulcs,
  ugyanabban a formátumban, mint a `date`). Beállítandó minden ponton, ahol
  egy terv `active = 1`-re vált: `setActivePlan`, `addPlan` (ha az első
  tervként automatikusan aktív lesz), `deletePlan` (az átvevő terv), az
  edzői kiosztás elfogadása, és az indulási migráció (`db.js` ~820. sor).
  A migráció a már aktív tervekre a migráció napját írja — 7 napos tervnél
  bármely hétfő ugyanazt adja, tehát ez semmit nem változtat.
- A ciklus horgonya: `anchor = az active_since hetének hétfője`; ha nincs
  `active_since` (régi vagy nem aktív terv), akkor a `date` hetének
  hétfője; ha az sincs, egy tetszőleges hétfő (pl. 1970-01-05).
- **Egyetlen közös függvény** adja meg a mai napot:
  `cycleDay(plan, todayKey) = (napok(anchor → todayKey)) mod week.length`,
  naptári napokban (`shiftDayKey`-jel azonos logika, nem 24 órás
  lépésekkel — óraátállítás!). Ez kerül a `server/plan-week.js`-be és
  tükörként a `public/js/core/plan-week.js`-be, és minden mai
  `(getDay() + 6) % 7`-es „melyik nap a tervben” számítás erre cserélendő.
  A naptári hétnapot számoló kódrészek (pl. a heti statisztikák
  „hétfőtől máig” ablaka) maradnak.
- A `normalizeWeek` 1–14 hosszt fogad el („A tervnek 1–14 napból kell
  állnia.”); a „same” `of` indexe a tényleges hosszon belül kell legyen. A
  hibaüzenetekben a napnév az új névadással megy („Hétfő (2.): …”).
- A `days` oszlop (`workoutDays`) továbbra is az edzésnapok indexei, de
  ezek mostantól ciklus-indexek (0–13), nem hétnapok. Minden olvasóját
  ennek megfelelően kell átírni (lásd lent).

## Érintett helyek

**Szerver**
- `server/plan-week.js`: `DAY_COUNT` helyett min/max hossz; névadó
  függvény (`dayName(i)`, `dayLabel(i)`); `cycleDay`; `dayWorkoutName` az
  új névvel; `weekFromLegacy` változatlanul 7 napot ad.
- `server/db.js`: `active_since` oszlop és beállítása; `getPlanForDay` a
  ciklus-napot kapja.
- `server/server.js`: a mai terv-nap (1415. sor) és a dashboard
  `restDay` (1475.) a `cycleDay`-t használja; a 1961. sori `DAY_LABELS`
  felsorolás az új címkékkel.
- `server/coaching.js` (edzői nézet):
  - `adherenceBreakdown`: az adott naptári napra a terv **ciklus-napja**
    számít (`cycleDay(plan, key)`), nem a hétnap.
  - `weekProgress`: a heti cél = hány edzésnap esik a terv(ek) ciklusa
    szerint az **aktuális naptári hétre** (hétfő–vasárnap); a kimaradt
    napok szintén a ciklus szerint. Több terv esetén naponként uniózva,
    ahogy most.
  - Az „aktív terv” sor (526.) a mai ciklus-nap szerint választ.

**Kliens**
- `public/js/core/plan-week.js`: `todayWeekday` helyett a terv mai
  ciklus-napja (`cycleDay`); `dayTitle(i)` a „(2.)” utótaggal.
- `public/js/ui/plan-builder.js` + `public/index.html` + `public/style.css`:
  a sáv a terv hosszából épül, X a napokon, „+” a végén, felirat, „2.”
  jelölés, megerősítés, vízszintes görgetés, ha nem fér ki. Az új terv
  alapból 7 napos (mint ma).
- `public/js/render/plans.js`: a kártya sávja a terv hosszát követi, a
  „ma” jelölés a ciklus-nap; 14 napnál is használható maradjon
  (görgethető vagy két sorba törő — a kivitelezőre bízva).
- `public/js/render/coach.js`, `coach-client.js`: a felsorolás címkéi.
- `public/js/ui/workout-picker.js`: a „Meglévő edzés betöltése” listában
  a napok „Hétfő (2.)” névvel.
- A toast-szöveg („a hétfői edzéshez”) a „(2.)” napokra is értelmes
  maradjon — a pontos szöveg a kivitelezőé.

**Dokumentáció:** a README „Heti bontású tervek” pontja.

## Nem célok

- Tetszőleges kezdőnap választása (a horgony mindig az aktiválás hetének
  hétfője).
- A ciklus kézi „léptetése” vagy újraindítása aktiválás nélkül.
- Napok átrendezése húzással; beszúrás a sor közepére.
- 14 napnál hosszabb terv.

## Anti-célok (attól kudarc, hogy „működik”)

- Ha bármelyik meglévő 7 napos terv mai napja megváltozik a frissítés után.
- Ha a szerver és a kliens másik napot tart „mának” (a két `cycleDay`
  eltér, vagy az egyik időzónát/órát számol napok helyett).
- Ha egy gyakorlatokkal teli nap egy félrekattintással, kérdés nélkül
  eltűnik.

## Tesztek

- `plan-week` tiszta függvényei: `cycleDay` (7 napos = hétnap; 9 napos a
  2. héten; óraátállításon át; aktiválás a hét közepén), névadás,
  `normalizeWeek` 1/14/0/15 hosszal.
- API: hosszabb/rövidebb terv mentése, aktiválás → `active_since`; a mai
  edzés betöltése 9 napos tervvel.
- Coaching: heti cél és kimaradás 9 napos tervvel.
- A meglévő 7 napos tesztek változatlanul zöldek.

## A kivitelezőre bízva

- A címke-tömbök és névfüggvények pontos szerkezete, a migráció módja.
- A kártya-sáv 14 napos elrendezése, a megerősítő ablak szövege.
- Hogy a „2.” jelölést a kártya-sáv is mutatja-e (javaslat: igen, a
  terv-építővel egyezően).
