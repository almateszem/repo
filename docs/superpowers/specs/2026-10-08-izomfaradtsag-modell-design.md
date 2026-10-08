# Izomfáradtság-modell pontosítása és az izomláz kivezetése

Dátum: 2026-10-08. Ág: `feature/izomfaradtsag-modell`.

## Cél

A célközönség fél-profi és profi sportoló, illetve edző. Náluk az izomláz gyenge
jel (a sorozatos terhelés hatása miatt), ezért a napi check-in izomláz-jelölése
kikerül. Előtte a terhelés-modellt pontosítani kell, mert eddig az izomláz
takarta el a vakfoltjait.

Két lépés, egy spec:

1. A modell pontosítása és a kalibrációs tesztek.
2. Az izomláz kivezetése, de csak ha az 1. lépés kalibrációs tesztjei izomláz
   nélkül is tartományon belül vannak. Ez a lépés a kapu után külön
   implementációs tervet kap.

Kimarad: a termen kívüli sport (foci, meccs) izomterhelése. Ez a `TEENDOK.txt`
kardió-pontjában szerepel.

Háttér: `reports/Izomfáradtság modell kalibráció.md` (kutatási riport, a végén
a kiinduló paraméterek táblázata).

## 1. A modell

### Két tároló izomcsoportonként

Minden teljesített szett két, egymástól független részt ad:

- **Gyors rész** = szett-típus × RPE-szorzó × izom-részesedés. Ez a mostani
  `setStimulus`, változatlanul (RPE-szorzó 0,6–1,7, bemelegítő 0, drop 0,5).
  Lecsengése τ = 0,4 nap.
- **Lassú rész** = szett-típus × bukás-súly × min(excentrikus szorzó ×
  újdonság, 2,5) × izom-részesedés. Lecsengése τ = `TAU_BY_GROUP[csoport]`.

A lassú rész nem a gyors rész maradéka: a „maradék” negatív lenne, ha a lassú
szorzók együtt 1 fölé mennek. Az RPE a lassú részben csak a bukás-súlyon át
hat, különben kétszer számítana.

A motor napra kerekít (`daysAgo`), ezért a gyors rész gyakorlatilag csak az
edzés napját érinti (másnapra kb. 8% marad).

### Bukás-súly

RIR = 10 − RPE, kerekítve.

| RIR | Súly |
|---|---|
| ≥ 4 | 0,2 |
| 3 | 0,4 |
| 2, és ha nincs RPE | 0,55 |
| 1 | 0,75 |
| 0 | 1,0 |
| 0, legalább 12 ismétléssel | 1,3 |

### Excentrikus szorzó

Új segéd: `eccentricClass(name)` a `server/muscles.js`-ben, az `isAxialLift`
mintájára, ékezet nélküli, kisbetűs kulcsszavakkal.

| Osztály | Szorzó | Példák |
|---|---|---|
| Megnyúlt helyzetű / excentrikus hangsúlyú | 1,2 | RDL, kitörés, bolgár guggolás, döntött padon curl, fej fölötti tricepsz, deficit |
| Nordic / excentrikus túlterhelés | 1,5 | Nordic curl |
| Csak koncentrikus | 0,6 | szán |
| Minden más | 1,0 | |

### Újdonság-szorzó

Edzésenként és izomcsoportonként, az adott edzés előtti előzményből. A két
jel közül a nagyobbik számít:

- **Kihagyás.** Hány hét telt el az izomcsoport utolsó érdemi terhelése óta.
  Érdemi az az edzés, amely legalább 1 teljes szettnyi stimulust adott a
  csoportnak (a mellékizmok kis részesedése nem nullázza az órát). A
  kihagyás-szorzó is csak akkor él, ha az adott gyakorlat érdemben terheli a
  csoportot.
  Görbe: 3 hétig 1,0, utána `1 + 0,8 × (1 − e^(−(hét − 3) / 10))`, 26 hétnél
  kb. 1,72. Ha a csoportnak még nem volt érdemi terhelése, nincs kihagyás-szorzó;
  az új gyakorlat szabálya érvényes.
- **Új gyakorlat.** A gyakorlat az előző 8 hétben legfeljebb egyszer
  szerepelt: 1,3, excentrikus osztályú gyakorlatnál (szorzó > 1) 1,5.

Kivétel: ha az edzés napján a fióknak 4 hétnél rövidebb az előzménye, a
szorzó 1,0. A hiányzó előzmény nem lehet büntetés.

Az újdonság a lassú rész nagyságát növeli, az excentrikus szorzóval együtt
legfeljebb 2,5-szeresre (a kettő részben ugyanaz a jelenség). A lecsengés
lassítása is szóba került, de a profil-tesztekben a hatása 1 pont alatt
maradt, ezért elvetettük.

### Pontszám

```
damage   = Σ gyors × e^(−d / 0,4) + Σ lassú × e^(−d / τ_csoport)
base     = személyes referencia, legalább ABS_GROUP_REF (előzmény nélkül ABS_GROUP_REF)
modelled = 100 × (1 − damage / (base × MUSCLE_REF_MULT))
```

A `MUSCLE_REF_MULT` 1,5 helyett 2,5. Az ablak marad 7 nap.

A személyes referencia alsó határa eddig az `ABS_GROUP_REF` fele volt. Ez
megfordította a szünet utáni esetet: a hosszú szünet után nincs személyes
referencia, így a nagyobb abszolút számít, és ugyanaz az edzés enyhébb
pontot kapott (92), mint folyamatos edzésnél (83). Az alsó határ ezért a
teljes `ABS_GROUP_REF`.

Az 1. lépésben az izomláz-keverés még marad.

### Ellenőrző szimuláció

Négyfejű, abszolút referencia (5 × 2,5), pontszám a d1 / d2 / d3 napon:

| Edzés | Most | Új modell |
|---|---|---|
| 6×5, RPE 5 | 70 / 81 / 88 | 92 / 96 / 98 |
| 6×5, RPE 8 | 49 / 68 / 80 | 79 / 89 / 93 |
| 6×10 bukásig | 19 / 48 / 67 | 63 / 80 / 88 |
| 6×12 bukásig | 19 / 48 / 67 | 54 / 74 / 84 |
| 8×10, RPE 8,5 | 22 / 51 / 69 | 72 / 85 / 91 |
| 6×12 bukásig, új excentrikus gyakorlat | 19 / 48 / 67 | 42 / 63 / 75 |
| 4×8 RPE 8, 26 hét szünet után | 66 / 79 / 86 | 85 / 91 / 93 |

A céltartományok a riport adataiból becsültek, a pontszámot
teljesítmény-százalékként kezelve. Ez közelítés. A fenti táblázat még a
lecsengést nyújtó újdonsággal készült; a végleges számokat a profil-tesztek
adják.

### Profil-próba a valódi motorral

A motor módosított másolatán, 6 hetes előzménnyel (személyes referencia),
a végleges paraméterekkel:

| Profil | d1 / d2 / d3 |
|---|---|
| Erőemelő (négyfejű) | 89 / 94 / 96 |
| Testépítő, megszokott lábnap | 78 / 88 / 92 |
| Csapatsportoló | 95 / 97 / 98 |
| 4×8 RPE 8, folyamatos edzés | 91 / 95 / 97 |
| Ugyanez 26 hét szünet után | 88 / 93 / 96 |
| Új fiók, lábnap (abszolút referencia) | 54 / 75 / 84 |

A meglévő 83 motor-teszt (`recovery.test.js`, `muscles.test.js`) a
módosított motorral is zöld volt.

## 2. Adatfolyam és interfész

Minden változás a szerveren van (`server/recovery.js`, `server/muscles.js`).
A `readinessReport` már most minden edzést átad, az API-hívás nem változik.

1. **`eccentricClass(name)`** (`muscles.js`): kulcsszavas osztályozás, a
   szorzót adja vissza.
2. **`buildNoveltyIndex(workouts, todayKey, catalog)`** (`recovery.js`): egy
   időrendi menet az összes edzésen, a 28 napon túliakon is. Kimenet: a 7
   napos ablakba eső edzésekhez gyakorlatonként és izomcsoportonként az
   újdonság-szorzó és az oka (`'novelty'` vagy `'gap'`).
3. **`summarizeWorkouts`**: a napi bucket két új mezőt kap.
   - `muscles[group]`: a gyors rész, változatlan. Erre épül továbbra is a
     személyes referencia és a `lastLoadedDaysAgo`.
   - `slow[group]`: a lassú rész, szett-egységben.
   - `unusual[group]`: `'novelty' | 'gap' | null`, volt-e aznap
     újdonság-szorzós terhelés a csoporton.
4. **`muscleReadiness`**: a fenti `damage` képlet (új segéd:
   `muscleDamage(byDay, group)`), és a referencia új alsó határa. Új kimeneti mező
   csoportonként: `unusual: 'novelty' | 'gap' | null`, ha a csoport az
   ablakon belül újdonság-szorzós terhelést kapott.
5. **Felület**: a regenerációs oldalon az érintett izomcsoport rövid jelzést
   kap: „Szokatlan terhelés: új gyakorlat” vagy „Szokatlan terhelés: hosszú
   kihagyás után”, egy mondatnyi magyarázattal.

Hibakezelés:

- Érvénytelen vagy jövőbeli dátumú edzés: kimarad, ahogy most.
- Ismeretlen gyakorlatnév: excentrikus szorzó 1,0, az újdonság a név alapján
  számolódik.
- Üres napló: minden szorzó 1,0.

## 3. Kalibrációs tesztek

Új fájl: `server/recovery-calibration.test.js`, `node:test`, a nyilvános
`computeReadiness` függvényen át. Kitalált naplók, a „ma” léptetésével mért
d1 / d2 / d3 értékek. A tesztek tartományt ellenőriznek, nem pontos számot.

### Profilok

Mindegyik 6 hetes előzménnyel, hogy a személyes referencia és az
újdonság-szabály is éljen. Az érintett fő izmot mérjük az utolsó edzés után.

| Profil | Utolsó edzés | Elvárás |
|---|---|---|
| Erőemelő | guggolás 5×3 RPE 8,5, fekvenyomás 5×3 RPE 8,5 | d1 ≥ 75, d2 ≥ 85 |
| Testépítő | lábnap, 12 munkaszett a négyfejűre, a fele bukásig | d1 65–85, d2 ≥ 85, d3 ≥ 90 |
| Csapatsportoló | teljes test hetente 2×, RPE 7, 3 szett/gyakorlat | d1 ≥ 85 |
| Testépítő, új gyakorlattal | előzmény kitöréssel, az utolsó lábnapon először bolgár guggolás | d1 alacsonyabb, mint megszokott bolgárral, d3 ≥ 70 |
| 6 hónap szünet után | 4×8 RPE 8 guggolás | d1 alacsonyabb, mint ugyanez folyamatos edzésnél |

A testépítő tartománya a személyes referencia miatt magasabb, mint az
abszolút referenciás szimulációban: a megszokott edzés a saját mércéhez
mérve közepes. Ez megfelel a kutatásnak (edzetteknél 12(12) után 24 órával
kb. 93% teljesítmény).

Az új gyakorlatos összevetésben a kitörés és a bolgár guggolás izom-megoszlása
és excentrikus osztálya azonos, így a személyes referencia is: csak az
újdonság különbözik.

### Különleges esetek

- Hiányzó RPE: ugyanaz, mint az RPE 8.
- Új fiók (4 hétnél rövidebb előzmény): az újdonság-szorzó 1,0; az abszolút
  referenciával a lábnap után d1 40–70, d3 ≥ 80.
- Az újdonság elkopik: ugyanaz a gyakorlat a 3. alkalomtól 1,0.

### Invariánsok

- Közelebb a bukáshoz: alacsonyabb pontszám, minden más azonos.
- Több eltelt nap: magasabb pontszám.
- A gyors és a lassú rész független, egyik sem negatív; az excentrikus
  szorzó × újdonság legfeljebb 2,5.
- A bemelegítő szett 0, a drop set fél szett (a meglévő tesztek maradnak).

### Kapu a 2. lépéshez

Ha a profilok izomláz nélkül tartományon belül vannak, indulhat a 2. lépés.
Ha nem, előbb a paraméterek hangolása (referencia, bukás-súlyok), az izomláz
addig marad.

### Meglévő tesztek

A `server/recovery.test.js` néhány izom-tesztje konkrét számot vár, ezek a
referencia-szorzó miatt mozdulnak. Egyenként átnézendők: csak akkor írjuk át
őket, ha a régi szám a régi paraméterből adódott, nem egy szabályból.

## 4. Az izomláz kivezetése (2. lépés)

### Szerver

- `muscleReadiness`: nincs keverés, a pontszám a `modelled`, amit csak a
  fájdalom-sapka (7/10-től 30) korlátoz. A `known` az edzés-előzményből vagy
  a fájdalomból jön. A `soreness` és a `source` mező kikerül a kimenetből.
- `normalizeCheckin` (`recovery.js`) és `normalizeMuscleMap` (`server.js`):
  a `soreness` mezőt nem olvassák és nem mentik. Régi kliens küldheti, ilyenkor
  hiba nélkül eldobják.
- `server/db.js`: a `soreness` oszlop marad, a régi adat megmarad, de nem
  használjuk.
- `LOW_MUSCLE_READINESS = 70` és `VERY_LOW_MUSCLE = 55` marad, új indoklással:
  a bukásig vitt 6×10 utáni nap (63) 70 alatt van, a 6×12 bukásig utáni nap
  (54) 55 alatt. A kalibrációs tesztek ezt a két esetet is ellenőrzik.
- A dashboard szövege: `recovery.soreness` helyett `recovery.muscleFatigue`,
  ugyanazzal a skálával (Erős / Közepes / Enyhe / Nincs). A „van check-in, de
  nem jelzett izomlázat” különeset kikerül.

### Kliens

- `public/js/ui/checkin/` (`constants.js`, `helpers.js`, `session.js`,
  `wizard.js`, `steps/gate.js`, `steps/summary.js`): az izomláz-kapu és
  -térkép kikerül, a fájdalom-ág marad. A lépésszámláló egy lépéssel rövidebb.
  Itt kell megnézni a UX-tesztben talált 7→8 ugrást is.
- `public/js/ui/recovery.js`: a duplikált izomláz-térkép kikerül.
- `public/js/render/recovery.js`, `recovery-map.js`: a sárga izomláz-pöttyök
  kikerülnek, a térkép színe csak a modellből jön.
- `public/js/render/dashboard.js`, `public/index.html`: az „Izomláz” sor
  felirata „Izomfáradtság”, a `data-map="checkin-soreness"` elem törlődik.
- `public/style.css`: a hozzájuk tartozó szabályok törlődnek.

### Tesztek

- Az izomlázat ellenőrző tesztek (keverés, kapu, pöttyök) törlődnek vagy
  átíródnak: `server/recovery.test.js`, `server/api.test.js`,
  `public/js/render/recovery-map.test.js`.
- A migrációs tesztek (`server/migration.test.js`,
  `server/muscle-split-migration.test.js`) maradnak, a régi adat olvasását
  nézik.
- Új teszt: a `soreness`-t küldő kérés nem okoz hibát és nincs hatása.

A fájdalom-térkép változatlan marad: sérülést jelez, és 7/10-től letiltja a
gyakorlatot.
