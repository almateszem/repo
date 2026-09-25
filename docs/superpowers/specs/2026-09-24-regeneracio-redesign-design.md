# Regeneráció oldal — új dizájn + 12 izomcsoport

**Állapot:** VÉGLEGES (2026-09-25). Az 1. rész (taxonómia) és a 2. rész (oldal)
jóváhagyva. Következő lépés: writing-plans.

**Forrás:** `Fit Track Pro - Regeneráció (responsive) (1).html` a repo gyökerében
(Claude Design export, bundler-csomag). Kibontás: a `__bundler/template` script
JSON-string → HTML; a `__bundler/manifest` base64+gzip assetek (2 test-SVG,
fontok, runtime). A két test-SVG (elöl 975×1625, hátul 989×1625) tiszta
vonalrajz (`stroke="#F5F0EB"`, kitöltés és régió-id nélkül) — nem kattintható,
nem színezhető.

## Meghozott döntések

| # | Kérdés | Döntés |
|---|---|---|
| 1 | Izomcsoportok | **12 csoportra bővítés** (a design szerint), külön részprojektként, a dizájn ELŐTT |
| 2 | Régi `arms`/`back` izomláz- és fájdalomértékek | **Szétosztás**: az érték minden utódra átmásolódik (óvatos, a tiltás nem vész el) |
| 3 | Emberalak a regenerációs oldalon | **A design vonalrajza, csak megjelenítésre**, gyűrűk + összekötő vonalak. A check-in megtartja a `createBodyMap()`-et (12 régióra bővítve) |
| 4 | A designban nem szereplő blokkok | **Maradnak a design alatt, a design nyelvén újrarajzolva**; a korlátozások és a „mi húz vissza” a pontszám-szöveg alá kerül |
| 5 | Színek/fontok | A meglévő tokenek (`public/style.css`). Új token csak a fájdalom borostyán: `#E8A33D`. Nincs Inter, nincs tiszta #000 háttér |
| 6 | Adatok | Minden szám a valódi `computeReadiness` riportból; a design számai (50/20/30/20% súlyok stb.) mintaadatok |

## 1. rész — 12 izomcsoportos taxonómia (JÓVÁHAGYVA 2026-09-25)

**Kulcsok (sorrend = felület sorrendje):**

| Kulcs | Címke | Megjegyzés |
|---|---|---|
| `chest` | Mell | |
| `shoulders` | Váll | |
| `biceps` | Bicepsz | ÚJ (az `arms` utódja; az alkar is ide) |
| `triceps` | Tricepsz | ÚJ (az `arms` utódja) |
| `traps` | Trapéz | ÚJ (a `back` utódja) |
| `back` | Hát | marad: széles hátizom + felső hát |
| `lowerBack` | Alsó hát | ÚJ (a `back` utódja) |
| `core` | Has / core | címke volt: Törzs |
| `quads` | Quad | címke volt: Quadriceps |
| `hamstrings` | Hamstring | |
| `glutes` | Farizom | |
| `calves` | Vádli | |

Az `arms` kulcs megszűnik.

**Leképezések:**
- `server/data/exdb.map.js` `MUSCLE_TO_GROUP`: `traps`/`trapezius`/`levator scapulae` → `traps`;
  `lower back`/`spine` → `lowerBack`; `biceps`/`brachialis`/forearm-nevek → `biceps`;
  `triceps` → `triceps`. Utána `npm run exdb:build` → `server/data/exercises.exdb.js` újragenerálva.
- `server/data/exercises.hu.js` (~200 kézi `load` sor) és a `server/muscles.js` kulcsszavas
  becslése: az `arms` rész gyakorlattípus szerint oszlik — nyomás → `triceps`, húzás → `biceps`,
  vállvonogatás → `traps`, hiperextenzió/felhúzás → részben `lowerBack`. A súlyok összege 1
  marad (a `catalog.js` validálás és a meglévő tesztek őrzik).

**Motor (`server/muscles.js` + `server/recovery.js`):** az új csoportok `TAU_BY_GROUP` és
`ABS_GROUP_REF` értéket kapnak — `biceps`/`triceps` az `arms` értékét örökli (τ 1.5),
`traps`/`lowerBack` a `back`-ét (τ 2.2), a `lowerBack` kissé lassabb τ-val. A `PAIN_BLOCK`
és minden más logika változatlan.

**Migráció (`server/db.js`, a `rebuildCheckins` mintájára, egyszer fut):** a
`checkins.soreness` és `checkins.pain` JSON-ban
`arms: x` → `biceps: x, triceps: x` (az `arms` törlődik);
`back: x` → `back: x, traps: x, lowerBack: x`.
Az edzésnaplót nem kell migrálni: az izomterhelést a motor a gyakorlatnévből mindig újraszámolja.

**Kliens:**
- `public/js/ui/bodymap/paths.js`: 12 régió (új: tricepsz, trapéz, hátul alsó hát);
  a `paths.test.js` a `MUSCLE_KEYS`-hez méri.
- `public/js/render/recovery.js`: az `arms` hivatkozás cseréje.

**Tesztek:** migrációs teszt (egy régi `arms`/`back` sor pontos átalakulása);
`recovery.test.js` / `suggestions.test.js` mintaadatai új kulcsokkal; minden meglévő teszt zöld.

## 2. rész — az oldal (JÓVÁHAGYVA 2026-09-25)

Töréspontok a design szerint: **asztali ≥1312px**, **tablet 760–1311px**, **mobil <760px**.

**Felső rész (a design szerint):**
- *Mai készenlét* `NN/100` + a verdikt szövege; alatta a „mi húz vissza” (`limiting`) és a
  korlátozások indoklása (`caps`), a megbízhatósági jelzés.
- *Mai check-in módosítása →* CTA (`#checkin`); ha ma még nincs check-in: „Napi check-in kitöltése”.
- *Ma kíméld*: az ismert csoportok, amelyek készenléte 40% alatt van, növekvő sorrendben, sávval;
  pöttyök: fehér = izomláz jelezve, borostyán = fájdalom jelezve. Üres lista esetén a blokk rejtve.
  Jelmagyarázat: Izomláz / Fájdalom / 80%+ kész.
- *Izomtérkép*: a design vonalrajza elöl + hátul; a gyűrűk:
  elöl — Váll, Mell, Bicepsz, Has / core, Quad;
  hátul — Trapéz, Hát, Tricepsz, Alsó hát, Farizom, Hamstring, Vádli.
  Gyűrű: ≥80% zöld (`--c-ok`), különben fehér; `known: false` → szaggatott kör „—” + „Nincs adat”.
  Asztalin a figura, a gyűrűk és az összekötő vonalak EGY SVG-ben, `viewBox="0 0 848 700"`
  (a design koordinátái), `width: 100%; max-width: 848px` — arányosan skálázódik, a vonalak
  nem csúsznak el. Tableten két oszlop a figurák mellett; mobilon Elöl/Hátul fül, a gyűrűk
  két oszlopban.
- *Miből jön a pontszám*: a jelen lévő komponensek (pontszám, sáv, súly a riportból); a hiányzók
  egy „Nincs adat: …” sorban + *Kitöltöm →*. A HRV-megjegyzés alul. Mobilon összecsukható,
  csukva egysoros összefoglaló.

**A design alatt, a design nyelvén, ebben a sorrendben:** Részletes szerkesztés (a teljes
check-in űrlap, összecsukva, mint most), Testsúly alakulása, Testösszetétel, Idegrendszer (CNS),
Mai ajánlások.

**Megszűnik / beolvad:** a mostani „Izomcsoportok” kártya megszűnik (az izomtérkép váltja).
A régi „Mai készenlét”, a megbízhatósági/sapka-blokk és a „Miből jön a pontszám” a felső
részbe olvad.

**„Ma kíméld” küszöb:** `RC_SPARE_BELOW = 40` kliensoldali konstans, a `CI_PAIN_BLOCK`
mintájára (megjegyzés a szerveroldali párra). Csak megjelenítési szűrő; a riport formátuma
nem változik.

**Tiszta logika külön modulban** (`public/js/render/recovery-map.js`, tesztelhető):
a „Ma kíméld” lista összeállítása (küszöb, növekvő sorrend, izomláz/fájdalom pöttyök) és a
12 kulcs gyűrű-pozíciója elöl/hátul.

**Érintett fájlok (várhatóan):** `public/index.html` (recovery szekció), `public/style.css`
(`rc-*` szabályok, új borostyán token), `public/js/render/recovery.js`, `public/js/ui/recovery.js`,
új `public/js/render/recovery-map.js` (+ `recovery-map.test.js`), új statikus asset a két
vonalrajzhoz (`public/img/body-front.svg`, `body-back.svg`, a c2pa metaadat nélkül).

**Tesztek (2. rész):** egységtesztek a `recovery-map.js`-re — 40%-os küszöb, sorrend,
izomláz/fájdalom pöttyök, üres lista, `known: false`, mind a 12 kulcsnak van pozíciója;
minden meglévő teszt zöld. Kézi ellenőrzés böngészőben a három törésponton, sötét témában.

## Megvalósítási sorrend

1. 1. rész (12 izomcsoport) — külön commitokban, zöld tesztekkel.
2. 2. rész (oldal) — csak ezután.

## Kapcsolódó, már kész (nem commitolt) munka ezen az ágon

`fix/biztonsagi-kor-2026-09-18`: a `PAIN_BLOCK = 7` közös konstansba került (`server/muscles.js`),
a `recovery.js` / `suggestions.js` / `server.js` ezt importálja; a `checkin/helpers.js` kommentje
1..10-re javítva. 427/427 teszt zöld. A kliens párja: `CI_PAIN_BLOCK`
(`public/js/ui/checkin/constants.js`).
