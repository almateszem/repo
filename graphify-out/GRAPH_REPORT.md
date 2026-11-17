# Graph Report - repo  (2026-11-15)

## Corpus Check
- 254 files · ~835,461 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 20 file(s) not represented in the graph (top: .css 14, (none) 3, .pptx# 1)

## Summary
- 2307 nodes · 6472 edges · 102 communities (86 shown, 16 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 198 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `de86810d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- setupProgramBuilder
- routes/nutrition.js
- routes/auth.js
- sets-view.js
- build-exdb.js
- Workout-picker page
- body-back.svg (back figure line drawing)
- server/coaching.js
- package.json
- init.js
- seed-demo.js
- catalog-search.js
- ref_node_path
- workout.js
- program.js
- server/recovery.js
- test-harness.js
- services/program-run.js
- http/session.js
- muscles.js
- client.js
- routes/training.js
- findFoodForUser
- recovery.test.js
- ref_node_test
- cloneTemplate
- formatNumber
- recovery/recovery.js
- openfoodfacts.js
- routes/coach.js
- recovery-calibration.test.js
- FitTrack Pro README
- records.js
- training-load.js
- recovery-view.js
- db/nutrition.js
- index.js
- logmode.js
- timezone.test.js
- users.test.js
- router.js
- recovery-novelty.test.js
- .prettierrc.json
- createBodyMap
- dom.js
- notif-categories.test.js
- server.js
- TEENDOK.txt (to-do list)
- nutrition/nutrition.js
- dashboard.js
- Check-in page
- Coach page
- Plans / plan-builder pages
- Workout page
- db/training.js
- FakeElement
- Kódbázis-átrendezés — tervdokumentum
- api.js
- shortcuts-guard.test.js
- Fájlszerkezet (cél)
- run
- workout-body.js
- server/program-run.test.js
- ITDK-dokumentáció: előlap, főfejezet-szerkezet, szakirodalom, rezümé — terv
- scripts
- errors.test.js
- DOKUMENTACIO-ITDK.md
- **4.5.2 API végpontok**
- paged-list.test.js
- exercise-advice.js
- fetch-exdb-media.js
- catalog.js
- exdb.map.js
- foods-validate.js
- check-imports.js
- body.js
- Review Focus
- session-advice.js
- check-exports.js
- **4\. Eredmények**
- nutrition-goal-revert.test.js
- **3\. Szakirodalmi áttekintés**
- **4.2 Rendszerterv**
- **4.3 Adatbázis**
- **4.7 Telepítés és üzemeltetés**
- devDependencies
- startup.test.js
- Blokkos programok — első szakasz — megvalósítási terv
- **4.10 Csapatmunka**
- **4.4 Felhasználói felület**
- shortcuts.test.js
- dashboard.test.js
- api-request.test.js
- **4.6 Frontend**
- **4.9 Forráskód és projektstruktúra**
- autosave.test.js
- dependencies
- pressKey
- index.html (SPA shell)
- Exercise-picker page
- Nutrition page
- Recovery page

## God Nodes (most connected - your core abstractions)
1. `showToast()` - 84 edges
2. `register()` - 74 edges
3. `init()` - 50 edges
4. `formatNumber()` - 48 edges
5. `cloneTemplate()` - 47 edges
6. `setupProgramBuilder()` - 46 edges
7. `register()` - 44 edges
8. `register()` - 41 edges
9. `navigate()` - 35 edges
10. `api` - 35 edges

## Surprising Connections (you probably didn't know these)
- `Task 7: Kliens-modell (tiszta függvények)` --references--> `formulaLabel()`  [INFERRED]
  docs/superpowers/plans/2026-11-11-blokkos-programok.md → public/js/program/program-model.js
- `6. feladat: A `server.js` a felfedezett funkciókra áll át, plusz az őr-teszt` --references--> `apiErrorHandler()`  [INFERRED]
  docs/superpowers/plans/2026-11-12-kodbazis-atrendezes.md → server/errors.js
- `Task 2: Szakirodalmi áttekintés (3.) és irodalomjegyzék (6.)` --references--> `failureWeight()`  [INFERRED]
  docs/superpowers/plans/2026-11-03-itdk-dokumentacio.md → server/training-load.js
- `Task 6: API` --references--> `state()`  [INFERRED]
  docs/superpowers/plans/2026-11-11-blokkos-programok.md → tests/server/program-run.test.js
- `Task 10: Szabályszerkesztő` --references--> `openFormulaWindow()`  [INFERRED]
  docs/superpowers/plans/2026-11-11-blokkos-programok.md → public/js/program/formula-window.js

## Import Cycles
- 3-file cycle: `server/db/accounts.js -> server/db/training.js -> server/db/coaching.js -> server/db/accounts.js`
- 4-file cycle: `server/db/accounts.js -> server/db/body.js -> server/db/training.js -> server/db/coaching.js -> server/db/accounts.js`

## Hyperedges (group relationships)
- **SPA pages in index.html** — public_index_page_recovery, public_index_page_workout, public_index_page_nutrition, public_index_page_plans, public_index_page_checkin, public_index_page_coach [EXTRACTED 1.00]

## Communities (102 total, 16 thin omitted)

### Community 0 - "setupProgramBuilder"
Cohesion: 0.05
Nodes (111): Task 8: A programozó oldal — sorszerkesztő, Task 9: Képletkészítő ablak, addDay(), addExercise(), addRule(), addSet(), addWeek(), applyDrop() (+103 more)

### Community 1 - "routes/nutrition.js"
Cohesion: 0.06
Nodes (6): 8. feladat: A `routes/training.js` kettévágása témák szerint (tartalmi commit, helyben), GOAL_RANGES, MEAL_LIMITS, WATER_GOAL_LITERS, WATER_SIP, readOptionalNumber()

### Community 2 - "routes/auth.js"
Cohesion: 0.08
Nodes (28): PASSWORD_MIN, createUser(), deleteSession(), deleteUser(), deleteUserSessions(), getSessionUser(), getSnapshot(), getUser() (+20 more)

### Community 3 - "sets-view.js"
Cohesion: 0.06
Nodes (81): Task 11: Futtatás a felületen — aktiválás, mai edzés, ugratás, áttekintés, weekText(), freshDays(), setupPlanBuilder(), weekStrip(), copyExercises(), inlineSameDays(), matchesQuery() (+73 more)

### Community 4 - "build-exdb.js"
Cohesion: 0.13
Nodes (24): buildPhraseMap(), collapseVariants(), __dirname, EQUIPMENT_RANK, equipmentRank(), loadSource(), main(), matchCuratedBySuffix() (+16 more)

### Community 7 - "server/coaching.js"
Cohesion: 0.06
Nodes (70): isWorkSet(), mondayOf(), volumeCharts(), volumeTrend(), adherence(), adherenceBreakdown(), adherenceTrend(), athleteAlert() (+62 more)

### Community 8 - "package.json"
Cohesion: 0.14
Nodes (14): GENERATED, description, engines, node, name, private, type, version (+6 more)

### Community 9 - "init.js"
Cohesion: 0.10
Nodes (44): init(), setupNavRing(), setupNotifications(), dirToPage(), setupChromeHeight(), setupConnectivity(), renderCharts(), renderUserName() (+36 more)

### Community 10 - "seed-demo.js"
Cohesion: 0.06
Nodes (90): 18. feladat: A `seed-demo.js` szétbontása szereplőnként, 1. Miért, 2. Fogalmak, 3. Hatókör, 4.1 Megjelenés: Notion-szerű sorszerkesztő, 4.2 Blokkfajták, 4.3 Súlyképlet: blokkok a súly helyén, 4.4 Szabály-blokkok (+82 more)

### Community 11 - "catalog-search.js"
Cohesion: 0.15
Nodes (14): createCatalogSearch(), DEFAULT_LIMIT, matches(), nameRank(), parseNames(), parsePageParams(), queryWords(), searchIn() (+6 more)

### Community 12 - "ref_node_path"
Cohesion: 0.04
Nodes (49): DEMO_DB, __dirname, html, workDir, workDir, DB_PATH, __dirname, workDir (+41 more)

### Community 13 - "workout.js"
Cohesion: 0.13
Nodes (23): setupAuthGate(), prefs, unboundPrefs, addedWeight, baseLoadFor(), bodyweightFactors, perHand, bindFinish() (+15 more)

### Community 14 - "program.js"
Cohesion: 0.06
Nodes (65): Adatformák (minden task ezekre hivatkozik), Task 10: Szabályszerkesztő, Task 12: Végső ellenőrzés, Task 1: Képlet-modul, Task 2: Programszerkezet-modul, Task 3: Szabály-modul, Task 7: Kliens-modell (tiszta függvények), count() (+57 more)

### Community 15 - "server/recovery.js"
Cohesion: 0.19
Nodes (25): daysAgo(), clamp01(), num(), ABS_GROUP_REF, blendRef(), cnsReadiness(), COMPONENT_LABELS, computeReadiness() (+17 more)

### Community 16 - "test-harness.js"
Cohesion: 0.06
Nodes (36): gyakorlat(), login(), register(), ciklusHet(), NAPNEVEK, offStub, asYesterday, recordOf() (+28 more)

### Community 17 - "services/program-run.js"
Cohesion: 0.08
Nodes (44): Task 5: Futtatás — `program-run` szolgáltatás és a mai edzés, Task 6: API, getLatestWeight(), addProgramPlan(), addTrainingMax(), getCycleWorkouts(), getProgramState(), getTrainingMaxes() (+36 more)

### Community 18 - "http/session.js"
Cohesion: 0.11
Nodes (34): accountFailureKey(), clearFailures(), createSessionToken(), failures, hashPassword(), hashToken(), isLockedOut(), loginFailureKey() (+26 more)

### Community 19 - "muscles.js"
Cohesion: 0.13
Nodes (20): catalogLoadIndex(), ECCENTRIC_CLASSES, KEYWORD_MAP, LEGACY_SPLIT, loadIndexCache, MUSCLE_GROUPS, MUSCLE_KEYS, normalizeLoad() (+12 more)

### Community 20 - "client.js"
Cohesion: 0.07
Nodes (59): createChatController(), acknowledge(), load(), feedNotice(), unreadDivider(), CLIENT_TABS, setupClientView(), render() (+51 more)

### Community 21 - "routes/training.js"
Cohesion: 0.07
Nodes (27): Task 4: Adatbázis — séma, tárolás, AMRAP a naplóban, getMeasurements(), getWeightLog(), saveMeasurements(), getCollection(), addPlan(), deletePlan(), getActivePlan() (+19 more)

### Community 22 - "findFoodForUser"
Cohesion: 0.24
Nodes (10): addCustomFood(), customNameTaken(), findFoodForUser(), getCustomFoodByBarcode(), getCustomFoodByName(), getFoodsForUser(), listCustomFoods(), toCustomFood() (+2 more)

### Community 23 - "recovery.test.js"
Cohesion: 0.14
Nodes (20): BASE_WEIGHTS, benchDays(), checkinDays(), dateAgo(), exercise(), fiveByFive(), fullCheckin(), HARD_LEG_DAY (+12 more)

### Community 24 - "ref_node_test"
Cohesion: 0.04
Nodes (41): createLatestOnly(), html, CSS_DIR, JS_DIR, nav, calls, COACH_DATA, detail (+33 more)

### Community 25 - "cloneTemplate"
Cohesion: 0.12
Nodes (38): setOnboardingLock(), ci, CI_BASE_STEPS, CI_GATES, CI_MAP_MODES, CI_READINESS_VERDICTS, CI_SCALE_STEPS, ciCountedSteps() (+30 more)

### Community 26 - "formatNumber"
Cohesion: 0.10
Nodes (31): CI_SLEEP_PRESETS, CI_WEIGHT_PRESET_OFFSETS, ciClamp(), ciWeightReference(), renderSleep(), commitSleep(), renderWeight(), commitWeight() (+23 more)

### Community 27 - "recovery/recovery.js"
Cohesion: 0.12
Nodes (28): paintCharts(), renderVolumeTrend(), measurementHistory(), measurements, measurementSites, refreshMeasurements(), renderMeasurements(), setMeasurements() (+20 more)

### Community 28 - "openfoodfacts.js"
Cohesion: 0.20
Nodes (9): clean(), fetchFollowingSafeRedirects(), fetchProduct(), FIELDS, isAllowedRedirect(), mapProduct(), num(), readJsonCapped() (+1 more)

### Community 29 - "routes/coach.js"
Cohesion: 0.05
Nodes (50): findUserByUsername(), toPublicUser(), getWeightLogSince(), acceptCoachInvite(), addComment(), addMessage(), ASSIGNMENT_COLUMNS, ASSIGNMENT_COLUMNS_A (+42 more)

### Community 30 - "recovery-calibration.test.js"
Cohesion: 0.26
Nodes (12): curve(), dayOf(), ex(), legDay(), pad(), powerSession(), readinessOn(), sets() (+4 more)

### Community 31 - "FitTrack Pro README"
Cohesion: 0.50
Nodes (5): FitTrack Pro README, Check-in (two fill paths), Coach-athlete relationship (consent-based), Deployment (persistent volume, trust proxy), Recovery Engine (readiness)

### Community 32 - "records.js"
Cohesion: 0.13
Nodes (25): bodyweightFactors, effectiveLoad(), factorOf(), isBodyweightExercise(), AGE_FACTORS, ageFactor(), BODYWEIGHT_RANGE, isPerHand() (+17 more)

### Community 33 - "training-load.js"
Cohesion: 0.16
Nodes (20): eccentricClass(), emptyMuscleMap(), isAxialLift(), buildNoveltyIndex(), CARDIO_CNS_INTENSITIES, cardioSetLoad(), CHRONIC_WINDOW_DAYS, failureWeight() (+12 more)

### Community 34 - "recovery-view.js"
Cohesion: 0.14
Nodes (31): componentSummary(), dashboardQuote(), DETAILS_ON_RECOVERY, HELD_BACK_VERDICTS, MAP_CANVAS, MAP_FIGURES, MAP_RINGS, MOBILE_COLUMNS (+23 more)

### Community 35 - "db/nutrition.js"
Cohesion: 0.14
Nodes (35): addNutritionEntry(), addWaterEntry(), clearOwnNutritionGoal(), clearWaterGoal(), countCoachMeals(), createCoachMeal(), deleteCoachMeal(), deleteCustomFood() (+27 more)

### Community 36 - "index.js"
Cohesion: 0.11
Nodes (30): 5. feladat: `server/core/db` — indítási fázisok és `allData()`, 9–16. feladat: A többi funkció átköltöztetése, Közös recept: „funkció átköltöztetése” (a 7–16. feladat ezt használja), buildFoodCatalog(), data, purgeExpiredSessions(), closeDatabase(), configureConnection() (+22 more)

### Community 37 - "logmode.js"
Cohesion: 0.29
Nodes (6): DEFAULT_INTENSITY, DEFAULT_LOG_MODE, DURATION_NAME_PATTERNS, INTENSITY_KEYS, INTENSITY_LEVELS, LOG_MODES

### Community 38 - "timezone.test.js"
Cohesion: 0.36
Nodes (6): format(), lastWorkoutDate(), pad(), request(), SERVER_TODAY, shift()

### Community 39 - "users.test.js"
Cohesion: 0.25
Nodes (7): annaFood, annaPlan, annaWorkout, belaPlan, exercises, food, workDir

### Community 40 - "router.js"
Cohesion: 0.13
Nodes (22): currentPage(), navigate(), PAGE_ICONS, PAGE_TITLES, pageFromHash(), pageSection(), pageShowHandlers, setupRouter() (+14 more)

### Community 41 - "recovery-novelty.test.js"
Cohesion: 0.48
Nodes (6): dayOf(), noveltyOf(), pad(), sets(), START, wo()

### Community 42 - ".prettierrc.json"
Cohesion: 0.40
Nodes (4): arrowParens, printWidth, singleQuote, trailingComma

### Community 43 - "createBodyMap"
Cohesion: 0.14
Nodes (22): clamp(), createBodyMap(), bindRegion(), clearValue(), paintRegion(), renderRows(), renderStage(), restoreFocus() (+14 more)

### Community 44 - "dom.js"
Cohesion: 0.19
Nodes (14): animateCoachRatings(), refreshNavRing(), messageNote(), DETAIL_TABS, setupCoachPage(), createCoachNote(), api, busyOperations (+6 more)

### Community 45 - "notif-categories.test.js"
Cohesion: 0.48
Nodes (3): buildNotifications(), NOTIF_CATEGORY, preview()

### Community 46 - "server.js"
Cohesion: 0.11
Nodes (13): purgeBarcodeCache(), CSP, securityHeaders(), isSecureRequest(), createRateLimiter(), parseTrustProxy(), app, deps (+5 more)

### Community 48 - "nutrition/nutrition.js"
Cohesion: 0.19
Nodes (17): onPageShow(), setupNutrition(), renderFoodItem(), LEVEL_LABEL, medalFor(), MISSING_TEXT, progressText(), setupProfile() (+9 more)

### Community 49 - "dashboard.js"
Cohesion: 0.19
Nodes (20): linkDetails(), lockReadinessWidth(), paintDashboard(), paintUserName(), refreshDailyStats(), refreshDashboardIfStale(), renderChromeDate(), renderDailyStats() (+12 more)

### Community 54 - "db/training.js"
Cohesion: 0.18
Nodes (21): weightForDate(), transaction(), addWorkout(), clearWorkoutDraft(), deleteWorkout(), getExerciseMax(), getUserPlans(), getWorkout() (+13 more)

### Community 56 - "Kódbázis-átrendezés — tervdokumentum"
Cohesion: 0.11
Nodes (17): 10. Kockázatok, 1. Miért, 2. Sikerkritérium, 3. Célok, nem-célok, anti-célok, 4. Kényszerek, 5. Döntések, 6.1 Egy funkciómappa szerződése, 6.2 Az `index.html` összefűzése (+9 more)

### Community 57 - "api.js"
Cohesion: 0.21
Nodes (14): authRequest(), del(), getJson(), getJsonCached(), getJsonDetailed(), handleUnauthorized(), postJson(), putJson() (+6 more)

### Community 58 - "shortcuts-guard.test.js"
Cohesion: 0.12
Nodes (9): enhanceSelect(), enhanceSelects(), indexDesc, valueDesc, created, event, keyListeners, press() (+1 more)

### Community 59 - "Fájlszerkezet (cél)"
Cohesion: 0.13
Nodes (14): 17. feladat: A `server/db.js` shim megszüntetése, 19. feladat: Oldal-összefűzés (`server/core/page.js`), 1. feladat: Ág, alapvonal és db-dump eszköz, 20. feladat: Az `index.html` szétbontása a funkciómappákba, 21. feladat: Takarítás, dokumentáció, végső ellenőrzés, 2. feladat: A gyökér rendbetétele, 3. feladat: `server/core/lib` és `server/core/http` (tiszta segédmodulok), 4. feladat: A funkció-betöltő (`server/core/features.js`) (+6 more)

### Community 60 - "run"
Cohesion: 0.22
Nodes (13): compositeFrag(), CONFIG, mountBackgroundWaves(), run(), adapt(), frame(), initGL(), pickFieldFormat() (+5 more)

### Community 61 - "workout-body.js"
Cohesion: 0.26
Nodes (14): normalizeDuration(), normalizeIntensity(), normalizeWeek(), weekFromLegacy(), exerciseLimitError(), nonNegativeField(), normalizeDays(), normalizeExercises() (+6 more)

### Community 62 - "server/program-run.test.js"
Cohesion: 0.21
Nodes (11): activate(), BURNOUT, D(), num(), PAIN, pctTm(), program(), setup() (+3 more)

### Community 63 - "ITDK-dokumentáció: előlap, főfejezet-szerkezet, szakirodalom, rezümé — terv"
Cohesion: 0.15
Nodes (12): A készítőre bízott döntések, Anti-célok (ettől lenne rossz, még ha „kész” is), Az új fejezetek tartalma, Célok, Ellenőrzés, Hivatkozási formátum, ITDK-dokumentáció: előlap, főfejezet-szerkezet, szakirodalom, rezümé — terv, Nem cél (+4 more)

### Community 64 - "scripts"
Cohesion: 0.15
Nodes (13): scripts, dev, exdb:build, exdb:media, format, format:check, graph, lint (+5 more)

### Community 65 - "errors.test.js"
Cohesion: 0.26
Nodes (9): express, apiErrorHandler(), clientMessage(), guardAsyncRoutes(), guardHandler(), installProcessGuards(), ROUTE_METHODS, close() (+1 more)

### Community 66 - "DOKUMENTACIO-ITDK.md"
Cohesion: 0.17
Nodes (11): **1.1 A projekt célja**, **1.2 Megoldandó problémák**, **1.3 Célfelhasználó csoport**, **1.4 Fő funkciók listája**, **1\. Bevezetés**, **2\. Célkitűzés**, **5.1 Következtetések**, **5.2 Javaslatok** (+3 more)

### Community 67 - "**4.5.2 API végpontok**"
Cohesion: 0.17
Nodes (12): **4.5.1 Szerver felépítése**, **4.5.2 API végpontok**, **4.5.3 Hitelesítés / jogosultságkezelés**, **4.5.4 Hibakezelés**, **4.5 Backend**, **a) Hitelesítés**, **b) Fiók és profil**, **c) Katalógus és ételek** (+4 more)

### Community 68 - "paged-list.test.js"
Cohesion: 0.24
Nodes (8): createPagedQuery(), load(), deferred(), fakeElement(), fakeFetch(), fakeObserverEnv(), env, setup()

### Community 69 - "exercise-advice.js"
Cohesion: 0.32
Nodes (9): exerciseReadiness(), MAIN_LIFTS, PLATE_STEPS_KG, recommend(), clamp(), mean(), median(), epley1RM() (+1 more)

### Community 70 - "fetch-exdb-media.js"
Cohesion: 0.27
Nodes (9): __dirname, fetchOne(), main(), mediaPaths(), ROOT, runPool(), TARGET_DIR, exdbExercises (+1 more)

### Community 71 - "catalog.js"
Cohesion: 0.31
Nodes (9): buildExerciseCatalog(), MEDIA_ROOT, validateExercises(), withAvailableMedia(), exercises, GROUPS, RENAMED_FROM, isLogMode() (+1 more)

### Community 72 - "exdb.map.js"
Cohesion: 0.18
Nodes (10): BODY_PART_TO_GROUP, CARDIO_FALLBACK_LOAD, COMPOUND_PATTERNS, deriveLoad(), EQUIPMENT_LABEL_HU, ISOLATION_FIRST_PATTERNS, ISOLATION_PATTERNS, MOBILITY_PATTERNS (+2 more)

### Community 73 - "foods-validate.js"
Cohesion: 0.25
Nodes (9): FOOD_GROUPS, foods, RENAMED_FROM, ATWATER, macroValue(), MAX_PORTION_GRAMS, normalizePortions(), parseCustomFood() (+1 more)

### Community 74 - "check-imports.js"
Cohesion: 0.33
Nodes (8): cache, DIRS, exportsOf(), missingImports(), relative(), ROOT, stripComments(), walk()

### Community 75 - "body.js"
Cohesion: 0.31
Nodes (9): addWeightEntry(), deleteMeasurement(), deleteWeightEntry(), getCheckin(), recomputeAfterWeightChange(), saveCheckin(), toCheckin(), updateWeightEntry() (+1 more)

### Community 76 - "Review Focus"
Cohesion: 0.22
Nodes (8): Global Constraints, ITDK-dokumentáció Implementation Plan, Review Focus, Task 1: Váz és ellenőrző, Task 2: Szakirodalmi áttekintés (3.) és irodalomjegyzék (6.), Task 3: Célkitűzés (2.), az Eredmények bevezetője (4.), Következtetések és Javaslatok (5.1–5.2), Task 4: Rezümé, Task 5: Átadás

### Community 77 - "session-advice.js"
Cohesion: 0.33
Nodes (7): reduceWeight(), PAIN_BLOCK, adviceToken(), applyAdvice(), planSafetyChecker(), sessionAdvice(), weightText()

### Community 78 - "check-exports.js"
Cohesion: 0.33
Nodes (7): exportedNames(), REFERENCE_DIRS, ROOT, SOURCE_DIRS, stripComments(), unusedExports(), walk()

### Community 79 - "**4\. Eredmények**"
Cohesion: 0.25
Nodes (8): **4.1.1 Funkcionális követelmények**, **4.1.2 Felhasználói szerepkörök**, **4.1 Követelmények**, **4.8.1 Tesztelési stratégia**, **4.8.2 Tesztesetek**, **4.8.3 Automatizált tesztek**, **4.8 Tesztelés**, **4\. Eredmények**

### Community 80 - "nutrition-goal-revert.test.js"
Cohesion: 0.25
Nodes (4): calls, DEFAULT, OWN, revertBtn

### Community 81 - "**3\. Szakirodalmi áttekintés**"
Cohesion: 0.33
Nodes (6): **3.1 Meglévő megoldások**, **3.2 Fejlesztői környezet és szoftverek**, **3.3 Adatforrások**, **3.4 Szakmai módszerek**, **3.5 Mesterséges intelligencián alapuló segédeszköz**, **3\. Szakirodalmi áttekintés**

### Community 82 - "**4.2 Rendszerterv**"
Cohesion: 0.33
Nodes (6): **4.2.1 Architektúra**, **4.2.2 A rendszer komponensei**, **4.2.3 Kommunikáció a komponensek között**, **4.2.4 REST API**, **4.2.5 Alkalmazott technológiák**, **4.2 Rendszerterv**

### Community 83 - "**4.3 Adatbázis**"
Cohesion: 0.33
Nodes (6): **4.3.1 Adatmodell**, **4.3.2 ER-diagram**, **4.3.3 Táblák részletes leírása**, **4.3.4 Kapcsolatok**, **4.3.5 Adatbázis létrehozása / dump**, **4.3 Adatbázis**

### Community 84 - "**4.7 Telepítés és üzemeltetés**"
Cohesion: 0.33
Nodes (6): **4.7.1 Szükséges környezet**, **4.7.2 Telepítés**, **4.7.3 Konfiguráció**, **4.7.4 Adatbázis létrehozása**, **4.7.5 Indítás**, **4.7 Telepítés és üzemeltetés**

### Community 85 - "devDependencies"
Cohesion: 0.33
Nodes (6): devDependencies, eslint, eslint-config-prettier, @eslint/js, globals, prettier

### Community 87 - "Blokkos programok — első szakasz — megvalósítási terv"
Cohesion: 0.40
Nodes (4): Blokkos programok — első szakasz — megvalósítási terv, Fájlszerkezet, Global Constraints, Review Focus

### Community 88 - "**4.10 Csapatmunka**"
Cohesion: 0.40
Nodes (5): **4.10.1 Csapattagok**, **4.10.2 Feladatmegosztás**, **4.10.3 Használt projektmenedzsment eszközök**, **4.10.4 Saját feladat / hozzájárulás**, **4.10 Csapatmunka**

### Community 89 - "**4.4 Felhasználói felület**"
Cohesion: 0.40
Nodes (5): **4.4.1 Képernyők**, **4.4.2 Navigáció**, **4.4.3 Reszponzív működés**, **4.4.4 Felhasználói szerepkörök**, **4.4 Felhasználói felület**

### Community 90 - "shortcuts.test.js"
Cohesion: 0.40
Nodes (3): html, PUBLIC_DIR, roots

### Community 91 - "dashboard.test.js"
Cohesion: 0.50
Nodes (3): elementFor(), elements, fakeElement()

### Community 93 - "**4.6 Frontend**"
Cohesion: 0.50
Nodes (4): **4.6.1 Felépítés**, **4.6.2 Fontosabb funkciók**, **4.6.3 API használata**, **4.6 Frontend**

### Community 94 - "**4.9 Forráskód és projektstruktúra**"
Cohesion: 0.50
Nodes (4): **4.9.1 Repository**, **4.9.2 Könyvtárstruktúra**, **4.9.3 Fontosabb modulok**, **4.9 Forráskód és projektstruktúra**

### Community 96 - "dependencies"
Cohesion: 0.67
Nodes (3): dependencies, express, @zxing/library

## Knowledge Gaps
- **17 isolated node(s):** `@zxing/library`, `eslint`, `prettier`, `Exercise-picker page`, `Nutrition page` (+12 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 764 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `setupProgramBuilder()` connect `setupProgramBuilder` to `router.js`, `init.js`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `init()` (e.g. with `setupNotifications()` and `setupCheckinWizard()`) actually correct?**
  _`init()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@zxing/library`, `eslint`, `prettier` to the rest of the system?**
  _17 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `setupProgramBuilder` be split into smaller, more focused modules?**
  _Cohesion score 0.05092063492063492 - nodes in this community are weakly interconnected._
- **Why does `showToast()` connect `init.js` to `setupProgramBuilder`, `sets-view.js`, `router.js`, `dom.js`, `workout.js`, `nutrition/nutrition.js`, `dashboard.js`, `client.js`, `cloneTemplate`, `formatNumber`, `recovery/recovery.js`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `routes/nutrition.js` be split into smaller, more focused modules?**
  _Cohesion score 0.06451612903225806 - nodes in this community are weakly interconnected._
- **Why does `express` connect `errors.test.js` to `package.json`, `server.js`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._