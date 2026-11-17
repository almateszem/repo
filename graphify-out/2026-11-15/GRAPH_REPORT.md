# Graph Report - repo  (2026-10-13)

## Corpus Check
- 166 files · ~338,703 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 3, .css 1)

## Summary
- 1302 nodes · 3574 edges · 54 communities (47 shown, 7 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 76 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- core/constants.js / DAY_LABELS
- data.js / data
- acceptCoachInvite() / createCoachInvite()
- shared / setOnboardingLock()
- build-exdb.js / buildPhraseMap()
- Meglévő edzés betöltése terv / Workout-picker page
- Dizajn átültetése terv / Testtérkép-komponens (bodymap)
- coaching.js / adherence()
- eslint.config.js / GENERATED
- init.js / init()
- formatInputNumber() / formatNumber()
- Load existing workout demo (HTML) / Lapozott katalógus terv
- figures.test.js / read()
- setupAuthGate() / api.js
- DIR_TO_PAGE / format.js
- server/recovery.js / ABS_GROUP_REF
- account.test.js / gyakorlat()
- addPlan() / assignPlan()
- auth.js / accountFailureKey()
- muscles.js / catalogLoadIndex()
- index.js / clamp()
- bodyweight-load.js / bodyweightFactors
- isPerHand() / addCustomFood()
- BASE_WEIGHTS / epley1RM()
- shortcuts.test.js / countControllerCalls()
- day.js / dayChangeListeners
- meals.js / scaleFood()
- prs.js / renderPrs()
- openfoodfacts.js / clean()
- addComment() / addMessage()
- recovery-calibration.test.js / curve()
- Design transplant spec / Shared body map component
- strength-standards.js / AGE_FACTORS
- eccentricClass() / emptyMuscleMap()
- findUserByUsername() / getActiveCoach()
- addWaterEntry() / getCheckin()
- getAllExerciseMaxes() / getNutritionLog()
- logmode.js / DEFAULT_INTENSITY
- timezone.test.js / format()
- users.test.js / annaFood
- bodyweight-records.test.js / asYesterday
- recovery-novelty.test.js / dayOf()
- .prettierrc.json / arrowParens
- custom-select.js / enhanceSelect()
- headers.js / CSP
- server/notifications.js / buildNotifications()
- ratelimit.js / createRateLimiter()
- MVP gap analysis (FitTrack Pro) / Demo content removal
- PR Tracking Implementation Guide / Epley 1RM formula
- Check-in page
- Coach page
- Plans / plan-builder pages
- Workout page

## God Nodes (most connected - your core abstractions)
1. `showToast()` - 64 edges
2. `cloneTemplate()` - 52 edges
3. `formatNumber()` - 49 edges
4. `init()` - 46 edges
5. `setupCheckinWizard()` - 33 edges
6. `api` - 32 edges
7. `navigate()` - 30 edges
8. `computeReadiness()` - 29 edges
9. `setupWorkout()` - 27 edges
10. `setupClientView()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Regeneráció oldal terv` --references--> `body-back.svg (back figure line drawing)`  [EXTRACTED]
  docs/superpowers/plans/2026-09-25-regeneracio-oldal.md → public/img/body-back.svg
- `Regeneráció oldal terv` --references--> `body-front.svg (front figure line drawing)`  [EXTRACTED]
  docs/superpowers/plans/2026-09-25-regeneracio-oldal.md → public/img/body-front.svg
- `startApp()` --indirect_call--> `apiErrorHandler()`  [INFERRED]
  tests/server/errors.test.js → server/errors.js
- `noveltyOf()` --calls--> `dayKey()`  [EXTRACTED]
  tests/server/recovery-novelty.test.js → server/recovery.js
- `noveltyOf()` --calls--> `buildNoveltyIndex()`  [EXTRACTED]
  tests/server/recovery-novelty.test.js → server/recovery.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Superpowers design specs** — docs_superpowers_specs_2026_09_08_dizajn_atultetes_design, docs_superpowers_specs_2026_09_24_regeneracio_redesign_design, docs_superpowers_specs_2026_10_06_meglevo_edzes_betoltese_design, docs_superpowers_specs_2026_10_08_izomfaradtsag_modell_design, docs_superpowers_specs_2026_10_10_lapozott_katalogus_design [INFERRED 0.85]
- **SPA pages in index.html** — public_index_page_recovery, public_index_page_workout, public_index_page_nutrition, public_index_page_plans, public_index_page_checkin, public_index_page_coach [EXTRACTED 1.00]

## Communities (54 total, 7 thin omitted)

### Community 0 - "core/constants.js / DAY_LABELS"
Cohesion: 0.06
Nodes (79): DAY_LABELS, DAY_NAMES, FLOW_PAGES, KEY_TO_PAGE, NOTIF_CATEGORIES, PAGES, dayEntry(), dayStatus() (+71 more)

### Community 1 - "data.js / data"
Cohesion: 0.04
Nodes (71): data, addNutritionEntry(), adoptLegacyData(), ASSIGNMENT_COLUMNS, ASSIGNMENT_COLUMNS_A, ASSIGNMENT_FIELDS, CACHED_COLLECTIONS, clearOwnNutritionGoal() (+63 more)

### Community 2 - "acceptCoachInvite() / createCoachInvite()"
Cohesion: 0.04
Nodes (57): acceptCoachInvite(), createCoachInvite(), getCoachLink(), getMeasurements(), getPlanAssignment(), getUserBirthYear(), getUserGoal(), getUserSex() (+49 more)

### Community 3 - "shared / setOnboardingLock()"
Cohesion: 0.08
Nodes (45): shared, setOnboardingLock(), CHECKIN_SCALES, MUSCLE_GROUPS, CI_BASE_STEPS, CI_GATES, CI_MAP_MODES, CI_READINESS_VERDICTS (+37 more)

### Community 4 - "build-exdb.js / buildPhraseMap()"
Cohesion: 0.05
Nodes (54): buildPhraseMap(), collapseVariants(), __dirname, EQUIPMENT_RANK, equipmentRank(), loadSource(), main(), matchCuratedBySuffix() (+46 more)

### Community 5 - "Meglévő edzés betöltése terv / Workout-picker page"
Cohesion: 0.07
Nodes (53): Meglévő edzés betöltése terv, Workout-picker page, estimate1RM(), copyExercises(), inlineSameDays(), matchesQuery(), addedWeightExercises, applyIntensity() (+45 more)

### Community 6 - "Dizajn átültetése terv / Testtérkép-komponens (bodymap)"
Cohesion: 0.08
Nodes (45): Dizajn átültetése terv, Testtérkép-komponens (bodymap), Design primitívek és tokenek, Izomláz-skála 1-10, Működési hibák javítása terv, 12 izomcsoport terv, MUSCLE_GROUPS taxonómia, splitLegacyMuscleMap (+37 more)

### Community 7 - "coaching.js / adherence()"
Cohesion: 0.10
Nodes (45): adherence(), adherenceBreakdown(), adherenceTrend(), athleteAlert(), athleteRating(), buildAthleteCard(), cardioMinutes(), dayScore() (+37 more)

### Community 8 - "eslint.config.js / GENERATED"
Cohesion: 0.05
Nodes (43): GENERATED, dependencies, express, @zxing/library, description, devDependencies, eslint, eslint-config-prettier (+35 more)

### Community 9 - "init.js / init()"
Cohesion: 0.12
Nodes (31): init(), startDayWatcher(), loadScript(), showToast(), setupNavRing(), renderCharts(), renderChromeDate(), renderUserName() (+23 more)

### Community 10 - "formatInputNumber() / formatNumber()"
Cohesion: 0.13
Nodes (31): formatInputNumber(), formatNumber(), refreshDailyStats(), renderChart(), renderDailyStats(), renderDashboard(), syncCheckinCta(), buildScale() (+23 more)

### Community 11 - "Load existing workout demo (HTML) / Lapozott katalógus terv"
Cohesion: 0.07
Nodes (26): Load existing workout demo (HTML), Lapozott katalógus terv, Load existing workout spec, Paged catalog spec, Exercise-picker page, Nutrition page, createPagedList(), createPagedQuery() (+18 more)

### Community 12 - "figures.test.js / read()"
Cohesion: 0.08
Nodes (18): html, workDir, DB_PATH, workDir, DB_PATH, legacyExercises, legacyPipalatlan, workDir (+10 more)

### Community 13 - "setupAuthGate() / api.js"
Cohesion: 0.14
Nodes (20): setupAuthGate(), api, clientDate(), del(), getJson(), getJsonCached(), getJsonDetailed(), handleUnauthorized() (+12 more)

### Community 14 - "DIR_TO_PAGE / format.js"
Cohesion: 0.12
Nodes (27): DIR_TO_PAGE, animateNumber(), formatWhole(), runningNumberAnimations, animateCoachRatings(), currentPage(), navigate(), PAGE_ICONS (+19 more)

### Community 15 - "server/recovery.js / ABS_GROUP_REF"
Cohesion: 0.13
Nodes (33): ABS_GROUP_REF, CARDIO_CNS_INTENSITIES, cardioSetLoad(), clamp(), clamp01(), cnsReadiness(), COMPONENT_LABELS, computeReadiness() (+25 more)

### Community 16 - "account.test.js / gyakorlat()"
Cohesion: 0.11
Nodes (20): gyakorlat(), login(), register(), NAPNEVEK, offStub, athlete, coach, outsider (+12 more)

### Community 17 - "addPlan() / assignPlan()"
Cohesion: 0.09
Nodes (28): addPlan(), assignPlan(), deletePlan(), getActivePlan(), getAssignedPlanTargets(), getPlan(), getPlanForDay(), getUserPlans() (+20 more)

### Community 18 - "auth.js / accountFailureKey()"
Cohesion: 0.11
Nodes (26): accountFailureKey(), clearFailures(), createSessionToken(), failures, hashPassword(), hashToken(), isLockedOut(), loginFailureKey() (+18 more)

### Community 19 - "muscles.js / catalogLoadIndex()"
Cohesion: 0.13
Nodes (21): catalogLoadIndex(), ECCENTRIC_CLASSES, KEYWORD_MAP, LEGACY_SPLIT, loadIndexCache, MUSCLE_GROUPS, MUSCLE_KEYS, normalizeLoad() (+13 more)

### Community 20 - "index.js / clamp()"
Cohesion: 0.14
Nodes (22): clamp(), createBodyMap(), bindRegion(), clearValue(), paintRegion(), renderRows(), renderStage(), restoreFocus() (+14 more)

### Community 21 - "bodyweight-load.js / bodyweightFactors"
Cohesion: 0.12
Nodes (25): bodyweightFactors, effectiveLoad(), factorOf(), isBodyweightExercise(), addWeightEntry(), addWorkout(), backfillExerciseMaxes(), bestCompletedSet() (+17 more)

### Community 22 - "isPerHand() / addCustomFood()"
Cohesion: 0.12
Nodes (24): isPerHand(), addCustomFood(), customNameTaken(), findFoodForUser(), getCollection(), getCustomFoodByBarcode(), getCustomFoodByName(), getDeclaredMaxes() (+16 more)

### Community 23 - "BASE_WEIGHTS / epley1RM()"
Cohesion: 0.13
Nodes (15): BASE_WEIGHTS, epley1RM(), estimate1RM(), sleepDurationScore(), sleepScore(), dateAgo(), exercise(), fullCheckin() (+7 more)

### Community 24 - "shortcuts.test.js / countControllerCalls()"
Cohesion: 0.14
Nodes (8): html, PUBLIC_DIR, roots, daysUntil(), pad(), DB_PATH, MEAL, workDir

### Community 25 - "day.js / dayChangeListeners"
Cohesion: 0.25
Nodes (10): dayChangeListeners, onDayChange(), cloneTemplate(), debounce(), renderFoodItem(), GOAL_RANGE, signed(), setupExercisePicker() (+2 more)

### Community 26 - "meals.js / scaleFood()"
Cohesion: 0.23
Nodes (13): scaleFood(), sumMacros(), macroText(), setupCoachMeals(), addItemRow(), mealRow(), openForm(), renderList() (+5 more)

### Community 27 - "prs.js / renderPrs()"
Cohesion: 0.27
Nodes (11): renderPrs(), handleStepClick(), markWorkoutStarted(), setLastSummary(), historyEntryEl(), renderWorkout(), syncHistoryEmpty(), workoutHistoryEntry() (+3 more)

### Community 28 - "openfoodfacts.js / clean()"
Cohesion: 0.21
Nodes (10): clean(), fetchFollowingSafeRedirects(), fetchProduct(), FIELDS, isAllowedRedirect(), mapProduct(), normalizeBarcode(), num() (+2 more)

### Community 29 - "addComment() / addMessage()"
Cohesion: 0.13
Nodes (15): addComment(), addMessage(), getComments(), getCommentsByTarget(), getLastMessage(), getMessages(), getUnreadCounts(), getWeightLogSince() (+7 more)

### Community 30 - "recovery-calibration.test.js / curve()"
Cohesion: 0.26
Nodes (12): curve(), dayOf(), ex(), legDay(), pad(), powerSession(), readinessOn(), sets() (+4 more)

### Community 31 - "Design transplant spec / Shared body map component"
Cohesion: 0.19
Nodes (12): Design transplant spec, Shared body map component, Recovery page redesign spec, 12 muscle group taxonomy, recovery-map.js logic module, Muscle fatigue model spec, Soreness (izomlaz) removal, FitTrack Pro README (+4 more)

### Community 32 - "strength-standards.js / AGE_FACTORS"
Cohesion: 0.18
Nodes (12): AGE_FACTORS, ageFactor(), BODYWEIGHT_RANGE, LEVEL_TIER, LEVELS, levelThresholds(), PROXIES, REF_BODYWEIGHT (+4 more)

### Community 33 - "eccentricClass() / emptyMuscleMap()"
Cohesion: 0.21
Nodes (12): eccentricClass(), emptyMuscleMap(), isAxialLift(), buildNoveltyIndex(), daysAgo(), failureWeight(), gapNovelty(), setStimulus() (+4 more)

### Community 34 - "findUserByUsername() / getActiveCoach()"
Cohesion: 0.22
Nodes (11): findUserByUsername(), getActiveCoach(), getAnsweredPlanOffers(), getAthletePlanHistory(), getCoachAthletes(), getPendingCoachInvites(), getPendingPlanOffers(), getRecentExerciseMaxes() (+3 more)

### Community 35 - "addWaterEntry() / getCheckin()"
Cohesion: 0.25
Nodes (9): addWaterEntry(), getCheckin(), getCheckins(), getWaterDay(), replaceWaterDay(), saveCheckin(), toCheckin(), syncHydration() (+1 more)

### Community 36 - "getAllExerciseMaxes() / getNutritionLog()"
Cohesion: 0.22
Nodes (9): getAllExerciseMaxes(), getNutritionLog(), getSnapshot(), getWorkout(), getWorkouts(), getWorkoutsSince(), saveWorkoutFeedback(), toWorkout() (+1 more)

### Community 37 - "logmode.js / DEFAULT_INTENSITY"
Cohesion: 0.25
Nodes (7): DEFAULT_INTENSITY, DEFAULT_LOG_MODE, DURATION_NAME_PATTERNS, INTENSITY_KEYS, INTENSITY_LEVELS, LOG_MODES, MAX_DURATION_SECONDS

### Community 38 - "timezone.test.js / format()"
Cohesion: 0.36
Nodes (6): format(), lastWorkoutDate(), pad(), request(), SERVER_TODAY, shift()

### Community 39 - "users.test.js / annaFood"
Cohesion: 0.25
Nodes (7): annaFood, annaPlan, annaWorkout, belaPlan, exercises, food, workDir

### Community 40 - "bodyweight-records.test.js / asYesterday"
Cohesion: 0.33
Nodes (5): asYesterday, recordOf(), records(), register(), today()

### Community 41 - "recovery-novelty.test.js / dayOf()"
Cohesion: 0.48
Nodes (6): dayOf(), noveltyOf(), pad(), sets(), START, wo()

### Community 42 - ".prettierrc.json / arrowParens"
Cohesion: 0.40
Nodes (4): arrowParens, printWidth, singleQuote, trailingComma

### Community 43 - "custom-select.js / enhanceSelect()"
Cohesion: 0.50
Nodes (4): enhanceSelect(), enhanceSelects(), indexDesc, valueDesc

### Community 44 - "headers.js / CSP"
Cohesion: 0.40
Nodes (4): CSP, CSP_VALUE, HSTS_VALUE, securityHeaders()

### Community 47 - "MVP gap analysis (FitTrack Pro) / Demo content removal"
Cohesion: 0.50
Nodes (4): MVP gap analysis (FitTrack Pro), Demo content removal, Navigation design debt, TEENDOK.txt (to-do list)

### Community 48 - "PR Tracking Implementation Guide / Epley 1RM formula"
Cohesion: 1.00
Nodes (3): PR Tracking Implementation Guide, Epley 1RM formula, exercise_maxes table

## Knowledge Gaps
- **24 isolated node(s):** `@zxing/library`, `eslint`, `prettier`, `Demo content removal`, `Navigation design debt` (+19 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 333 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `express` connect `eslint.config.js / GENERATED` to `acceptCoachInvite() / createCoachInvite()`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Are the 17 inferred relationships involving `init()` (e.g. with `refreshDailyStats()` and `renderCharts()`) actually correct?**
  _`init()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@zxing/library`, `eslint`, `prettier` to the rest of the system?**
  _24 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `core/constants.js / DAY_LABELS` be split into smaller, more focused modules?**
  _Cohesion score 0.05643513789581205 - nodes in this community are weakly interconnected._
- **Why does `showToast()` connect `init.js / init()` to `core/constants.js / DAY_LABELS`, `shared / setOnboardingLock()`, `Meglévő edzés betöltése terv / Workout-picker page`, `formatInputNumber() / formatNumber()`, `setupAuthGate() / api.js`, `DIR_TO_PAGE / format.js`, `day.js / dayChangeListeners`, `meals.js / scaleFood()`, `prs.js / renderPrs()`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Should `data.js / data` be split into smaller, more focused modules?**
  _Cohesion score 0.04035542391706775 - nodes in this community are weakly interconnected._
- **Why does `cloneTemplate()` connect `day.js / dayChangeListeners` to `core/constants.js / DAY_LABELS`, `shared / setOnboardingLock()`, `Meglévő edzés betöltése terv / Workout-picker page`, `Dizajn átültetése terv / Testtérkép-komponens (bodymap)`, `init.js / init()`, `formatInputNumber() / formatNumber()`, `setupAuthGate() / api.js`, `DIR_TO_PAGE / format.js`, `meals.js / scaleFood()`, `prs.js / renderPrs()`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._