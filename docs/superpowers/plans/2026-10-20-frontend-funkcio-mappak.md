# Frontend funkció-mappákba rendezése — megvalósítási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Cél:** a `public/js` 86 fájlja technikai rétegek (`core/`, `render/`, `ui/`, `nav/`) helyett
funkció szerinti mappákba kerül, a csak egymással értelmes apró fájlok összeolvadnak — 86 → 68 fájl,
és egy funkció minden darabja egy mappában van.

**Architektúra:** tiszta áthelyezés és összefésülés, **viselkedés nem változik**. A mozgatást egy
ideiglenes segédszkript végzi (`git mv` + minden relatív import átírása), az összefésülés kézi. Minden
feladat egy funkció-mappa, saját committal; a meglévő őrök (`check-imports`, `check-exports`, lint,
tesztek) és egy böngészős füstteszt igazolja.

**Tech stack:** böngészős ES modulok build nélkül, Node 22 `node --test`, ESLint, Prettier.

**Spec:** nincs külön spec — a döntések a 2026-10-20-i beszélgetésből, lent a „Döntések” részben.

## Döntések (a spec helyett)

1. **Mappa = funkció (az app egy oldala vagy oldalcsoportja),** nem réteg. A `ui/` és `render/`
   megszűnik; a „vezérlő vs. kirajzolás” szétválasztás a mappán belül, fájlnévvel él:
   `x.js` (vezérlő) és `x-view.js` (adat → DOM).
2. **Vezérlő + nézet egy fájl, ha együtt ≤ ~400 sor;** különben `x.js` + `x-view.js`.
3. **50 sor alatti fájl beolvad egyetlen importálójába / legközelebbi rokonába,** kivéve a `shared/`
   általános eszközeit és ha a befogadó így 500 sor fölé nőne.
4. **`shared/` = legalább két funkció használja, és egyiket sem ismeri.** Ide megy a teljes `core/`
   és a `ui/`-ból a funkciófüggetlen `modals.js`, `custom-select.js`.
5. **`app/` = indulás, útválasztás, a mindig látszó keret** (fejléc, nav-gyűrű, harang, gyorsbillentyűk).
6. A `public/js/main.js` a helyén marad (az `index.html` belépési pontja).
7. **Nagy fájlok szétszedése NEM része ennek a tervnek** (`coach/coach.js` 661, `nutrition/nutrition.js`
   595, `recovery/recovery-view.js` ~570, `workout/sets-view.js` 562) — külön döntés később.
8. A szerver (`server/`) és a CSS **nem** része ennek a tervnek — kivéve a bennük lévő
   **útvonal-említéseket (kommenteket)**, lásd 10. döntés.
9. **Három általános darab kiemelése a `shared/`-ba (2026-10-21, „B” változat):** amit több funkció
   használ, de egy funkció fájljában él, az függvényenként átkerül (a törzs szó szerint):
   - `shared/stepper.js` ← `handleStepClick` a `ui/workout/set-controls.js`-ből (± gombok: edzésnapló,
     check-in, Regeneráció, tervszerkesztő);
   - `shared/chart.js` ← `renderChart` a `render/dashboard.js`-ből (Áttekintő, összegző, testsúly);
   - `shared/readiness.js` ← a `ui/scale.js` (`buildScale`, `git mv`) + a `render/recovery.js`-ből
     `MUSCLE_GROUPS`, `CHECKIN_SCALES`, `readinessTone`, `CONFIDENCE_LABELS`, `hasReadiness`,
     `renderScale`, `readScale`, `writeScale` (edző, Áttekintő, check-in, összegző, Regeneráció).
     A `MUSCLE_LABELS`, `MOOD_SCALE`, `NO_READINESS_TEXT` marad a `recovery-view.js`-ben (csak ott kell).

   **Elfogadott, megmaradó átjárások** a funkció-mappák közt (szándékosak, nem hibák):
   az Áttekintő frissítése (`renderDashboard`, `refreshDailyStats`, `renderVolumeTrend` a
   `dashboard/`-ból — ezek kiváltása `page-hooks`-szal viselkedésváltozás, külön feladat);
   `checkin/` ↔ `recovery/` (testtérkép, testsúly, `CI_*` konstansok); `coach/` → `plans/`
   (`renderPlans`) és `workout/exercise-notes.js`; `plans/plan-builder.js` → `workout/` (szett-sorok);
   `dashboard/` → `recovery/recovery-map.js` (idézet).
10. **A régi útvonalak minden élő fájlban átíródnak (2026-10-21, „A” változat):** a kódon túl a
    `public/css/*.css` és a `public/index.html` kommentjeiben, valamint a `README.md`, `MVP.md`,
    `PR_TRACKING_GUIDE.md`, `doc.txt` szövegében — mindig abban a feladatban, amelyik az adott fájlt
    mozgatja. **Nem** íródik át: `TEENDOK.txt` és `docs/superpowers/` (múltbeli állapotot rögzítő
    napló/terv), `graphify-out/` (generált), `.claude/` (nem a projekt kódja).

## Célszerkezet (régi → új)

`+` = beleolvad. Sorszám = becsült méret.

**`app/`** (6)
- `app/init.js`, `app/startup.js` — maradnak
- `nav/router.js` → `app/router.js`; `nav/navring.js` → `app/navring.js`
- `ui/chrome.js` + `ui/connectivity.js` + `ui/shortcuts.js` → `app/shell.js` (~80)
- `ui/notifications.js` → `app/notifications.js`

**`shared/`** (19) — a `core/` minden fájlja **kivéve** `one-rm.js` és `meals.js`, név változatlan:
`api, constants, day, dom, format, latest-only, page-hooks, paged-list, plan-sources, plan-week,
popup-menu, prefs, toast, weight-conventions`; plusz `ui/modals.js` → `shared/modals.js`,
`ui/custom-select.js` → `shared/custom-select.js`; plusz a 9. döntés három fájlja: `stepper.js`
(~25), `chart.js` (~40), `readiness.js` (~110, a `ui/scale.js`-ből).

**`dashboard/`** (1)
- `ui/dashboard.js` + `ui/dashboard-data.js` + `render/dashboard.js` → `dashboard/dashboard.js` (~390)

**`recovery/`** (7)
- `ui/recovery.js` → `recovery/recovery.js`
- `render/recovery.js` → `recovery/recovery-view.js` (~480; a skála és a készenléti konstansok már a
  2. feladatban a `shared/readiness.js`-be kerültek)
- `render/recovery-map.js` → `recovery/recovery-map.js`
- `ui/bodymap/index.js` → `recovery/bodymap.js`; `ui/bodymap/paths.js` → `recovery/bodymap-paths.js`
- `ui/weight.js` → `recovery/weight.js`; `ui/measurements.js` → `recovery/measurements.js`
  (mindkettő a Regeneráció oldalon él: `index.html` `rc-weight-list`, `data-form="measurements"`)

**`checkin/`** (4)
- `ui/checkin/wizard.js` → `checkin/wizard.js`
- `ui/checkin/constants.js` + `helpers.js` + `session.js` → `checkin/session.js` (~200; a
  varázsló állapota, konstansai, segédei — a lépések ezt importálják, a varázsló a lépéseket: így
  nincs körkörös import)
- `steps/intro.js` + `gate.js` + `scale.js` + `map.js` + `summary.js` → `checkin/steps.js` (~320)
- `steps/sleep.js` + `steps/weight.js` → `checkin/steps-input.js` (~210; a ± gombos, gyorsgombos
  számbeviteli lépések)

**`workout/`** (13)
- `ui/workout.js` → `workout/workout.js`
- `render/sets.js` → `workout/sets-view.js`
- `ui/workout/set-controls.js` + `ui/workout/exercise-card.js` → `workout/set-controls.js` (~270)
- `ui/workout/autosave.js` → `workout/autosave.js`
- `ui/workout/loading.js` + `ui/workout/plan-undo.js` → `workout/loading.js` (~235)
- `ui/workout/finish.js` → `workout/finish.js`
- `ui/workout/history.js` + `render/workout.js` + `render/prs.js` → `workout/history.js` (~170)
- `ui/workout/summary-data.js` → `workout/summary-data.js`
- `ui/workout/pr-indicator.js` + `core/one-rm.js` → `workout/pr-indicator.js` (~75)
- `ui/summary.js` + `render/summary.js` → `workout/summary.js` (~270)
- `ui/exercise-picker.js`, `ui/workout-picker.js`, `ui/exercise-notes.js` → `workout/` (név marad)

**`nutrition/`** (6)
- `ui/nutrition.js` → `nutrition/nutrition.js`
- `render/foods.js` → `nutrition/nutrition-view.js` (3. döntés kivétele: a nutrition.js 640 fölé nőne)
- `ui/food-detail.js`, `ui/custom-food.js`, `ui/scanner.js`, `ui/water.js` → `nutrition/`

**`plans/`** (2)
- `ui/plans.js` + `ui/plans-data.js` + `render/plans.js` → `plans/plans.js` (~280)
- `ui/plan-builder.js` → `plans/plan-builder.js`

**`coach/`** (7)
- `ui/coach.js` → `coach/coach.js`; `render/coach.js` → `coach/coach-view.js`
- `render/coach-shared.js` → `coach/coach-shared.js`
- `ui/coach-client.js` → `coach/client.js`; `render/coach-client.js` → `coach/client-view.js`
- `ui/chat.js` → `coach/chat.js`
- `ui/coach-meals.js` + `core/meals.js` → `coach/meals.js` (~410)

**`profile/`** (2)
- `ui/profile.js`, `ui/settings.js` → `profile/`

Összesen: 1 (`main.js`) + 6 + 19 + 1 + 7 + 4 + 13 + 6 + 2 + 7 + 2 = **68**.

**Tesztek** (`tests/public/js/`) a forrás mappáját követik, ugyanabban a mélységben
(`tests/public/js/<mappa>/x.test.js`), így a `../fake-dom.js` és a `../../../../…` relatív utak mélysége
nem változik — kivéve a `ui/bodymap/paths.test.js`-t, amelynek az importjait a segédszkript igazítja.

## Global Constraints

- Viselkedés nem változik: csak `import`/`export` sorok, fájlfejléc-kommentek és útvonal-említések
  változnak; a függvénytörzsek szó szerint átkerülnek.
- Fájlmozgatás csak `git mv`-vel (a `git log --follow` megmaradjon).
- Összefésüléskor a befogadó fájl fejléc-kommentje (`/** Podium — … */` stílus) leírja az összes
  részt; a beolvasztott rész elé egy `/* — <rész neve> — */` elválasztó kerül, a többi
  szakaszhatároló stílusával egyezően.
- Ami összefésülés után már csak a saját fájlján belül használt, arról lekerül az `export`
  (a `tests/unused-exports.test.js` különben elbukik).
- Minden feladat végén zöld: `npm test`, `npm run lint`, `npm run format:check`.
- Egy feladat = egy commit, magyar üzenettel a repo stílusában, a végén:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **Körkörös import összefésülés után** — ES modulban a `const` export TDZ-hibát dob, ha a kör
   rossz sorrendben értékelődik ki; a tesztek ezt nem mindig fogják meg, a böngésző igen. A
   füstteszt minden érintett oldalt megnyit, és a konzolnak tisztának kell lennie.
2. **Névütközés két összefésült fájl belső (nem exportált) nevei között** — az ESLint
   `no-redeclare` / parse error megfogja; átnevezni a beolvasztott fájl nevét kell, nem a befogadóét.
3. **Kommentben maradt régi útvonal** (pl. „a render/plans.js-é”) — félrevezet; minden feladat
   végén a régi útvonalakra rákeresünk.
4. **A `<script type="module" src="js/main.js">` és a mélyebb hivatkozások** — a `main.js` nem
   mozdul; más fájlra az `index.html` nem hivatkozik (ellenőrizve).
5. **Dinamikus `import()`** — jelenleg nincs a `public/js`-ben (ellenőrizve); a szkript ettől
   függetlenül kezeli.

---

### Task 1: Az áthelyező segédszkript

**Files:**
- Create: `scripts/move-module.js` (ideiglenes — a 11. feladat törli)

**Interfaces:**
- Produces:
  - `node scripts/move-module.js <régi> <új>` — `git mv` (szülőmappát létrehozza), majd a
    `public/js`, `tests`, `scripts`, `server` minden `.js` fájljában minden `from '<rel>'`,
    `import '<rel>'` és `import('<rel>')` specifikátort, amely a `<régi>`-re oldódik fel, a `<új>`-ra
    mutató relatív útra ír át; az áthelyezett fájl **saját** relatív importjait az új helyéhez igazítja.
  - `node scripts/move-module.js --redirect <régi> <új>` — csak az importálókat írja át (nincs
    `git mv`); összefésüléskor a beolvasztott fájl importálóit így irányítjuk a befogadóra.
  - Utak a repo gyökeréhez képest, `/`-rel; a kiírt specifikátor mindig `./` vagy `../` kezdetű.

- [ ] **Step 1: Megírni a szkriptet** a fenti felülettel; a fájlbejárás a `scripts/check-imports.js`
  `walk`-jának mintáját követi (`node_modules` kihagyva).

- [ ] **Step 2: Próba visszafordítható mozgatással**

```bash
node scripts/move-module.js public/js/core/latest-only.js public/js/core/tmp-latest-only.js
git diff --stat   # várt: a fájl, ui/recovery.js és tests/public/js/core/latest-only.test.js változik
npm test
node scripts/move-module.js public/js/core/tmp-latest-only.js public/js/core/latest-only.js
git status --short public tests   # várt: üres
```

- [ ] **Step 3: Commit** — `Eszköz: ideiglenes modul-áthelyező szkript a funkció-mappákhoz`

### Közös lépések minden további feladathoz

Minden 2–10. feladat ugyanezzel a ciklussal megy; a feladatok csak a mozgatás-listát és a
füstteszt oldalait adják meg.

- **A) Mozgatás:** a lista minden `régi → új` sorára `node scripts/move-module.js régi új`
  (a hozzá tartozó tesztfájlra is, ha van).
- **B) Összefésülés:** minden `A + B → C` sorra: az első fájlt mozgatni `C`-re (A lépés), a
  többi tartalmát (fejléc-komment és importsorok nélkül) elválasztóval a végére fűzni, az
  importokat összevonni (forrásonként egy `import` sor), `--redirect <beolvasztott> C`, majd
  `git rm <beolvasztott>`. A fejlécet átírni a Global Constraints szerint.
- **C) Exportok:** `node scripts/check-exports.js` — a listán szereplő, mostanra belsővé vált
  nevekről leszedni az `export`-ot.
- **D) Ellenőrzés:** `node scripts/check-imports.js` → `(minden import rendben)`;
  `npm test` → 0 fail; `npm run lint` → 0 error; `npx prettier --write` a változott fájlokra,
  majd `npm run format:check` zöld.
- **E) Régi utak:** `git grep -nE "<a feladat régi útjai>" -- ':!TEENDOK.txt' ':!docs/superpowers' ':!graphify-out' ':!.claude'`
  (az egész repóban, tehát a CSS, az `index.html` és a leíró dokumentumok is) → nincs találat;
  minden találatot az új útra írni (10. döntés).
- **F) Füstteszt:** `npm start`, böngészőben belépni, a feladatnál felsorolt oldalakat megnyitni
  és a megadott műveletet elvégezni; a konzolban nincs hiba (`Uncaught`, `SyntaxError`,
  `ReferenceError`, 404 egy `.js`-re).
- **G) Commit:** csak a feladat fájljai.

### Task 2: `shared/` és `app/`

Először, mert minden más feladat ezekre importál — utána a többi feladat már a végleges
`shared/`-utakat látja.

**Mozgatás:** a `core/` 14 fájlja → `shared/` (név marad; `one-rm.js` és `meals.js` marad a helyén
a 7. és 9. feladatig); `ui/modals.js`, `ui/custom-select.js` → `shared/`;
`nav/router.js`, `nav/navring.js` → `app/`; `ui/notifications.js` → `app/notifications.js`.
**Összefésülés:** `ui/chrome.js` + `ui/connectivity.js` + `ui/shortcuts.js` → `app/shell.js`.
**Kiemelés (9. döntés):** `git mv public/js/ui/scale.js public/js/shared/readiness.js` (a szkripttel),
majd a felsorolt függvények/konstansok törzse szó szerint átkerül a `render/recovery.js`-ből a
`readiness.js`-be, a `renderChart` a `render/dashboard.js`-ből az új `shared/chart.js`-be, a
`handleStepClick` a `ui/workout/set-controls.js`-ből az új `shared/stepper.js`-be. A régi fájl
`export { … }` listájáról lekerülnek, a régi fájl (ha még használja) importálja őket az új helyről, és
minden importálót kézzel az új helyre irányítunk (a szkript fájlt mozgat, nevet nem). Utána
`node scripts/check-imports.js` megmutatja, ha egy importáló kimaradt.
**Tesztek:** `tests/public/js/core/*` → `tests/public/js/shared/` (kivéve `one-rm.test.js`,
`meals.test.js`); `ui/modal-stack.test.js` → `shared/`; `ui/shortcuts*.test.js`, `ui/icons.test.js`
→ `app/`. **Kézzel:** a `shortcuts.test.js` a forrást fájlnévvel olvassa (nem importtal, ezért a
szkript nem látja): `path.join(PUBLIC_DIR, 'js', 'ui', 'shortcuts.js')` →
`path.join(PUBLIC_DIR, 'js', 'app', 'shell.js')`. (Ellenőrizve: más teszt nem olvas így `.js`-t.)
**E) régi utak:** `core/(api|constants|day|dom|format|latest-only|page-hooks|paged-list|plan-sources|plan-week|popup-menu|prefs|toast|weight-conventions)\.js|nav/|ui/(modals|custom-select|chrome|connectivity|shortcuts|notifications)\.js`
**F) Füstteszt:** betöltés, offline/online váltás (DevTools) → toast; `?` és szám-gyorsbillentyűk
oldalt váltanak; harang-panel nyílik; egy megerősítő ablak (pl. terv törlése, Mégse) nyílik és zárul;
a kiemelések miatt: Áttekintő grafikonjai és készenléti értéke, Regeneráció skála-chip be/ki,
± gomb az edzésnaplóban és a check-in alvás-lépésében.
**G) Commit:** `Szerkezet: a core/ shared/ lett, a keret (router, nav, fejléc, gyorsbillentyűk, harang) app/-ba költözött`

### Task 3: `plans/`

**Összefésülés:** `ui/plans.js` + `ui/plans-data.js` + `render/plans.js` → `plans/plans.js`.
**Mozgatás:** `ui/plan-builder.js` → `plans/plan-builder.js`.
**Tesztek:** `ui/plans-delete.test.js` → `plans/`.
**F) Füstteszt:** Tervek oldal lista; terv szerkesztése (tervszerkesztő nyílik); terv törlése.
**G) Commit:** `Szerkezet: plans/ — a tervlista egy fájl, mellette a tervszerkesztő`

### Task 4: `dashboard/`

**Összefésülés:** `ui/dashboard.js` + `ui/dashboard-data.js` + `render/dashboard.js` →
`dashboard/dashboard.js` (befogadó: `render/dashboard.js`, mert az a legnagyobb).
**Tesztek:** `render/dashboard*.test.js`, `render/volume-trend.test.js` → `dashboard/`.
**F) Füstteszt:** Áttekintő betöltése, grafikonok, „Mai edzés kész ✓” állapot; testsúly mentése
után az Áttekintő frissül.
**G) Commit:** `Szerkezet: dashboard/ — az Áttekintő adat, vezérlő és kirajzolás egy fájlban`

### Task 5: `recovery/`

**Mozgatás:** `ui/recovery.js`, `render/recovery-map.js`, `ui/weight.js`, `ui/measurements.js` →
`recovery/`; `render/recovery.js` → `recovery/recovery-view.js`; `ui/bodymap/index.js` →
`recovery/bodymap.js`; `ui/bodymap/paths.js` → `recovery/bodymap-paths.js`.
**Tesztek:** `render/recovery-map.test.js`, `render/figures.test.js` → `recovery/`;
`ui/bodymap/paths.test.js` → `recovery/bodymap-paths.test.js`.
**F) Füstteszt:** Regeneráció oldal: izomtérkép elöl/hátul, skála-chip kattintás, testsúly és
körméret mentése; az Edző oldalon egy kliens készenléti értéke látszik.
**G) Commit:** `Szerkezet: recovery/ — regeneráció, izomtérkép, testsúly és körméretek`

### Task 6: `checkin/`

**Mozgatás:** `ui/checkin/wizard.js` → `checkin/wizard.js`.
**Összefésülés:** `constants.js` + `helpers.js` + `session.js` → `checkin/session.js`;
`steps/intro|gate|scale|map|summary.js` → `checkin/steps.js`; `steps/sleep.js` + `steps/weight.js`
→ `checkin/steps-input.js`. A `ui/checkin/` mappa kiürül és megszűnik.
**Tesztek:** `ui/checkin-sleep.test.js` → `checkin/`.
**F) Füstteszt:** a check-in végigjárása az elejétől az összegzőig, egyszer „fáj valami” kapuval
(testtérkép lépés megjelenik), alvás- és testsúly-gyorsgombokkal.
**G) Commit:** `Szerkezet: checkin/ — 12 fájlból 4: állapot, lépések, számbeviteli lépések, varázsló`

### Task 7: `workout/`

**Mozgatás:** `ui/workout.js`, `ui/workout/autosave.js`, `ui/workout/finish.js`,
`ui/workout/summary-data.js`, `ui/exercise-picker.js`, `ui/workout-picker.js`,
`ui/exercise-notes.js` → `workout/`; `render/sets.js` → `workout/sets-view.js`.
**Összefésülés:** `set-controls.js` + `exercise-card.js` → `workout/set-controls.js`;
`loading.js` + `plan-undo.js` → `workout/loading.js`; `history.js` + `render/workout.js` +
`render/prs.js` → `workout/history.js`; `pr-indicator.js` + `core/one-rm.js` →
`workout/pr-indicator.js`; `ui/summary.js` + `render/summary.js` → `workout/summary.js`.
**Tesztek:** `ui/autosave*.test.js`, `ui/exercise-notes-delete.test.js` → `workout/`;
`core/one-rm.test.js` → `workout/one-rm.test.js` (a szerver-paritás teszt marad, csak az import útja változik).
**F) Füstteszt:** edzés indítása tervből, majd visszavonás; szett hozzáadása/törlése, RPE, PR-jelző
megjelenik; gyakorlat hozzáadása a választóból, eltávolítása kipipált szettel (megerősítés);
befejezés → összegző; „Korábbi edzések” és rekordlista frissül; gyakorlat-megjegyzés írása.
**G) Commit:** `Szerkezet: workout/ — az edzésnapló, választók és összegző egy mappában`

### Task 8: `nutrition/`

**Mozgatás:** `ui/nutrition.js`, `ui/food-detail.js`, `ui/custom-food.js`, `ui/scanner.js`,
`ui/water.js` → `nutrition/`; `render/foods.js` → `nutrition/nutrition-view.js`.
**Tesztek:** `ui/custom-food.test.js`, `ui/scanner.test.js`, `ui/nutrition-goal-revert.test.js` → `nutrition/`.
**F) Füstteszt:** ételkeresés, étel részletei és hozzáadás; saját étel létrehozása; víz +/−;
vonalkód-olvasó ablak megnyílik és bezárul.
**G) Commit:** `Szerkezet: nutrition/ — táplálkozás, étel-részletek, saját étel, vonalkód, víz`

### Task 9: `coach/`

**Mozgatás:** `ui/coach.js` → `coach/coach.js`; `render/coach.js` → `coach/coach-view.js`;
`render/coach-shared.js` → `coach/`; `ui/coach-client.js` → `coach/client.js`;
`render/coach-client.js` → `coach/client-view.js`; `ui/chat.js` → `coach/`.
**Összefésülés:** `ui/coach-meals.js` + `core/meals.js` → `coach/meals.js`.
**Tesztek:** `ui/coach-*.test.js`, `ui/double-submit.test.js` → `coach/`;
`core/meals.test.js` → `coach/meals.test.js`.
**F) Füstteszt:** Edző oldal: kliens megnyitása és bezárása, üzenet küldése, étrend-szerkesztő
élő előnézete; sportolói nézet frissül.
**G) Commit:** `Szerkezet: coach/ — edzői panel, kliens nézet, chat, étrend`

### Task 10: `profile/` és az üres mappák

**Mozgatás:** `ui/profile.js`, `ui/settings.js` → `profile/`.
**Tesztek:** `ui/settings-*.test.js` → `profile/`.
- [ ] Ellenőrizni: `public/js/{core,render,ui,nav}` és `tests/public/js/{core,render,ui}` üres —
  `git ls-files public/js/core public/js/render public/js/ui public/js/nav tests/public/js/core tests/public/js/render tests/public/js/ui`
  → nincs kimenet; `git ls-files public/js | wc -l` → `68`.
**F) Füstteszt:** Profil oldal, beállítások ablak: születési év, fiók-beállítás mentése.
**G) Commit:** `Szerkezet: profile/ — a ui/, render/, core/, nav/ mappák megszűntek`

### Task 11: Dokumentáció és a segédszkript eltávolítása

**Files:**
- Modify: `README.md` — a „Felépítés” `js/` blokkja az új mappákra, egy sor mappánként
  (mit tartalmaz), plusz egy sor a 2–3. döntésről (`x.js` / `x-view.js`, mikor van összevonva);
  valamint a 9. döntés `shared/` kiemeléseiről. (Az egyes útvonal-említéseket — README 350./417.
  sor, `server/*.js` kommentek, CSS, `index.html`, MVP, PR_TRACKING_GUIDE, doc.txt — már a 2–10.
  feladat E) lépése átírta.)
- Delete: `scripts/move-module.js`

- [ ] **Step 1:** fenti módosítások.
- [ ] **Step 2:** `git grep -nE "public/js/(core|render|ui|nav)/|\b(core|render|ui|nav)/[a-z/-]+\.js" -- ':!TEENDOK.txt' ':!docs/superpowers' ':!graphify-out' ':!.claude'` → nincs találat
  (a `[a-z/-]` a mélyebb utakat is fogja, pl. `ui/checkin/steps/weight.js`). Ma ez 17 fájlt talál:
  7 CSS, `index.html`, `README.md`, `MVP.md`, `PR_TRACKING_GUIDE.md`, `doc.txt`, 5 `server/*.js` —
  a 2–10. feladat E) lépése után mind üres kell legyen, itt csak a végső ellenőrzés.
- [ ] **Step 3:** a teljes D) ellenőrzés + egy teljes kör a füstteszten (minden oldal egyszer).
- [ ] **Step 4: Commit** — `Dokumentáció: a README felépítése a funkció-mappákat írja le; a segédszkript törölve`
