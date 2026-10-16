# Változó hosszú edzésterv (1–14 napos ciklus) — kivitelezési terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A terv 1–14 napos lehet, „+”/„X” gombokkal szerkeszthető, és ciklusként ismétlődik az aktiválás hetének hétfőjétől.

**Architecture:** A `week` tömb hossza szabad (1–14), a napindex mostantól ciklus-index. Egyetlen tiszta függvény (`cycleDay`) mondja meg egy dátumra a ciklus napját — a szerveren `server/plan-week.js`-ben, tükörként a kliensen `public/js/core/plan-week.js`-ben. A horgonyt az új `plans.active_since` oszlop adja. Minden „melyik nap a tervben ma” számítás erre vált; a naptári hét-ablakok (heti statisztika) maradnak.

**Tech Stack:** Node ≥22.5 (`node:sqlite`, `node:test`), Express, vanilla ES-modul kliens.

**Spec:** `docs/superpowers/specs/2026-10-16-valtozo-hosszu-terv-design.md`

## Global Constraints

- Hossz: `MIN_DAYS = 1`, `MAX_DAYS = 14`. Hibaüzenet: `A tervnek 1–14 napból kell állnia.`
- Napnév az i. napra: `Hétfő…Vasárnap` (`i % 7`), `i >= 7` esetén `" (2.)"` utótaggal (`Hétfő (2.)`). Rövid címke: `H, K, Sze, Cs, P, Szo, V`, ugyanígy utótaggal (`K (2.)`).
- Horgony: `active_since` hetének hétfője → ha nincs, `date` hetének hétfője → ha az sincs, `1970.01.05` (hétfő).
- Ciklus-nap: `((napok(horgony → dátum)) mod hossz + hossz) mod hossz`, naptári napokban (`daysBetween`/`dayKey` a `server/recovery.js`-ből — óraátállítás-biztos).
- A dátum-formátum mindenhol `ÉÉÉÉ.HH.NN` (mint `plans.date`, `req.today`).
- 7 napos terv viselkedése bit-re azonos marad: a ciklus-nap = a hétnap.
- Felirat: 7 napnál `A hét — hetente ismétlődik`, különben `A ciklus — N nap, utána elölről kezdődik`.
- Új terv alapból 7 napos; az új nap pihenőként a sor végére kerül.
- Gyakorlatot tartalmazó nap törlése előtt megerősítés (`confirmAction`), pihenőnapé nélkül.
- Commit-üzenetek magyarul, a repo stílusában, a végén:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **Hét közepén aktivált 7 napos terv** — a mai nap a hétnap marad (szerdán aktiválva szerda töltődik). → Task 2 teszt.
2. **Dátum a horgony előtt** (az edzői nézet 28 napra néz vissza) — a modulo nem lehet negatív. → Task 1 teszt.
3. **Óraátállítás a ciklusban** — a március végi 23 órás nap nem csúsztatja el a ciklust. → Task 1 teszt.
4. **Az aktív terv megrövidítése** (9 → 3 nap) — a mai nap újraszámolódik, nincs „üres” index, a sablon betölt. → Task 2 teszt.
5. **A kijelölt / utolsó nap törlése a terv-építőben** — a kijelölés érvényes napra ugrik, a listák és a chipek nem csúsznak el egymáshoz képest. → Task 5 kézi ellenőrzés.

---

### Task 1: Szerver — a ciklus tiszta függvényei

**Files:**

- Modify: `server/plan-week.js` (fejkomment, `DAY_COUNT`, `DAY_NAMES/LABELS` köré, `normalizeWeek`, `dayWorkoutName`)
- Test: `tests/server/plan-week.test.js`

**Interfaces:**

- Produces:
  - `export const MIN_DAYS = 1`, `export const MAX_DAYS = 14`
  - `export function dayName(i: number): string` — `'Hétfő'`, `'Hétfő (2.)'`
  - `export function dayLabel(i: number): string` — `'H'`, `'K (2.)'`
  - `export function cycleAnchor(plan: {activeSince?, date?}): number` — dayKey (helyi éjfél timestamp) a horgony-hétfőre
  - `export function cycleDayAt(plan: {week, activeSince?, date?}, key: number): number` — `key` egy `dayKey`
  - `export function cycleDay(plan, dateStr: string): number` — `cycleDayAt(plan, dayKey(dateStr))`
  - `dayWorkoutName(plan, i)` a `dayName(i)`-t használja; `normalizeWeek` 1–14 hosszt fogad
  - A `DAY_COUNT` megszűnik; a `weekFromLegacy` egy helyi `7`-tel dolgozik (a régi terv mindig egy hét)

- [ ] **Step 1: Írd meg a bukó teszteket** a `tests/server/plan-week.test.js` végére (importáld az új neveket):

```js
const plan = (length, extra = {}) => ({
  week: Array.from({ length }, () => ({ type: 'rest' })),
  ...extra,
});

test('a napnév a hét napját követi, a második körben (2.) utótaggal', () => {
  assert.equal(dayName(0), 'Hétfő');
  assert.equal(dayName(6), 'Vasárnap');
  assert.equal(dayName(7), 'Hétfő (2.)');
  assert.equal(dayName(13), 'Vasárnap (2.)');
  assert.equal(dayLabel(2), 'Sze');
  assert.equal(dayLabel(8), 'K (2.)');
});

test('ciklus-nap: 7 napos terv = a hétnap, bármikor aktiválták', () => {
  assert.equal(cycleDay(plan(7, { activeSince: '2026.10.14' }), '2026.10.14'), 2); // szerda
  assert.equal(cycleDay(plan(7), '2026.10.16'), 4); // horgony nélkül is péntek
});

test('ciklus-nap: 9 napos terv az aktiválás hetének hétfőjétől számol', () => {
  const p = plan(9, { activeSince: '2026.10.14' }); // horgony: 2026.10.12 (hétfő)
  assert.equal(cycleDay(p, '2026.10.14'), 2);
  assert.equal(cycleDay(p, '2026.10.19'), 7); // a következő hétfő = „Hétfő (2.)"
  assert.equal(cycleDay(p, '2026.10.21'), 0); // újrakezdődik
});

test('ciklus-nap: rövid terv, horgony előtti nap, dátumra eső horgony', () => {
  assert.equal(cycleDay(plan(3, { activeSince: '2026.10.14' }), '2026.10.15'), 0);
  assert.equal(cycleDay(plan(9, { activeSince: '2026.10.14' }), '2026.10.11'), 8);
  assert.equal(cycleDay(plan(9, { date: '2026.10.07' }), '2026.10.14'), 0);
});

test('ciklus-nap: az óraátállítás nem csúsztatja el a ciklust', () => {
  // 2026.03.29 a 23 órás nap
  assert.equal(cycleDay(plan(9, { activeSince: '2026.03.23' }), '2026.03.30'), 7);
});

test('normalizeWeek: 1 és 14 nap között fogad el', () => {
  const day = { type: 'workout', name: '', exercises: PUSH };
  assert.ok(normalizeWeek([day], exercisesOk).week);
  assert.equal(normalizeWeek(Array(14).fill(day), exercisesOk).week.length, 14);
  for (const raw of [[], Array(15).fill(day)]) {
    assert.equal(normalizeWeek(raw, exercisesOk).error, 'A tervnek 1–14 napból kell állnia.');
  }
  const nine = [...Array(8).fill(REST), { type: 'same', of: 9 }];
  nine[0] = day;
  // a 9 napos terv utolsó (8.) napja a tartományon kívüli 9. napra mutat
  assert.equal(
    normalizeWeek(nine, exercisesOk).error,
    'Kedd (2.): csak egy edzésnappal lehet azonos.',
  );
});
```

Ha egy meglévő teszt a „pontosan hét nap” hibát várja, írd át az új szövegre.

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `node --test tests/server/plan-week.test.js`
Expected: FAIL — `dayName`/`cycleDay` nincs exportálva.

- [ ] **Step 3: Valósítsd meg** a fenti Interfaces szerint a `server/plan-week.js`-ben. A dátumokhoz importáld a `parseDate, dayKey, daysBetween`-t a `./recovery.js`-ből. A horgony-hétfő: `shiftDayKey(dayKey(s), -((parseDate(s).getDay() + 6) % 7))`. A `normalizeWeek` hibaüzeneteiben a `DAY_NAMES[day]` helyére `dayName(day)`. Frissítsd a fejkommentet („Egy terv EGY HÉT” → 1–14 napos ciklus, horgony).

- [ ] **Step 4: Futtasd újra**

Run: `node --test tests/server/plan-week.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/plan-week.js tests/server/plan-week.test.js
git commit -m "Terv: 1–14 napos ciklus tiszta függvényei (cycleDay, dayName)"
```

---

### Task 2: Szerver — `active_since`, a mai nap a ciklusból

**Files:**

- Modify: `server/db.js` (oszlop ~420. sor; aktiválási migráció ~810–828; `PLAN_COLUMNS`/`toPlan` ~2772; `getUserPlanSchedules`, `getAssignedPlanTargets`; `deletePlan`, `addPlan`, `setActivePlan` ~3440–3510)
- Modify: `server/server.js` (1306–1307 elfogadás; 1415 sablon; 1475 `restDay`; 1955–1975 `GET /api/plans`; 1997–2003 aktiválás; 1984 törlés; 3283–3295 mentés)
- Test: `tests/server/api.test.js`

**Interfaces:**

- Consumes: `cycleDay`, `dayLabel` (Task 1)
- Produces:
  - `toPlan(row)` kiegészül: `activeSince: string | null`
  - `setActivePlan(userId, id, active, today: string)` — bekapcsoláskor `active_since = today`
  - `addPlan(userId, name, date, week, assignmentId)` — ha automatikusan aktív lesz, `active_since = date`
  - `deletePlan(userId, id, today: string)` — az átvevő terv `active_since = today`
  - `getUserPlanSchedules(userId)` → `[{ id, name, date, activeSince, week, days }]`
  - `getAssignedPlanTargets(...)` elemei kiegészülnek: `activeSince` (a sportoló tervéé, `p.active_since`)
  - `GET /api/plans` elemei kiegészülnek: `date`, `activeSince`; a `meta` címkéi `dayLabel(d)`
  - A `getPlanForDay(userId, dayIndex)` aláírása NEM változik (a migrációs tesztek használják); a hívó adja a ciklus-napot

- [ ] **Step 1: Írd meg a bukó API-teszteket** a meglévő terv-tesztek mellé (`api.test.js` ~1300. sor után), a `belaCookie`-val és a `gyakorlat` segéddel:

```js
test('ciklusos terv: a mai nap az aktiválás hetének hétfőjétől számít', async () => {
  const cookie = belaCookie;
  await request('DELETE', '/api/workout-draft', { cookie });
  const maiNap = (new Date().getDay() + 6) % 7; // az aktiválás hetében = napok a hétfő óta
  const week = Array.from({ length: 3 }, (_, i) => ({
    type: 'workout',
    name: `Nap ${i}`,
    exercises: [gyakorlat('Guggolás', 100)],
  }));
  const terv = await request('POST', '/api/plans', { cookie, body: { name: 'Hármas', week } });
  assert.equal(terv.status, 201);
  const aktiv = await request('POST', `/api/plans/${terv.json.id}/active`, {
    cookie,
    body: { active: true },
  });
  assert.equal(aktiv.json.activeSince, today());
  const sablon = (await request('GET', '/api/workout-template', { cookie })).json;
  assert.equal(sablon.name, `Nap ${maiNap % 3}`);
});

test('7 napos terv hét közbeni aktiválása: a mai hétnap töltődik (változatlan viselkedés)', async () => {
  // week: minden nap saját névvel („N7-<i>"), aktiválás ma → sablon neve `N7-${maiNap}`
});

test('az aktív terv megrövidítése után is a ciklus mai napja töltődik', async () => {
  // 9 napos terv (név „N9-<i>"), aktiválás; PUT 2 napos hétre („R-<i>");
  // a sablon neve `R-${maiNap % 2}`
});

test('15 napos és üres terv mentése 400', async () => {
  // POST /api/plans 15 nappal és [] héttel → 400, error: 'A tervnek 1–14 napból kell állnia.'
});

test('a terv-lista visszaadja a horgonyt és a (2.) címkéket', async () => {
  // 9 napos terv, edzés a 0. és a 8. napon → meta végén '· H, K (2.)'; elemen `activeSince`, `date`
});
```

A kommentben leírt teszteket ugyanebben a stílusban írd ki teljesen.

- [ ] **Step 2: Futtasd, és nézd meg, hogy bukik**

Run: `node --test tests/server/api.test.js`
Expected: FAIL — 400 a 3 napos hétre, `activeSince` undefined.

- [ ] **Step 3: Adatbázis.** `const plansHadActiveSince = hasColumn('plans', 'active_since'); ensureColumn('plans', 'active_since', 'active_since TEXT');` a többi terv-oszlop mellé. A migrációk végén: ha az oszlop új volt, `UPDATE plans SET active_since = ? WHERE active = 1` a szerver mai napjával (`ÉÉÉÉ.HH.NN`) — 7 napos tervnél bármely hétfő ugyanazt adja. Bővítsd a `PLAN_COLUMNS`-t, a `toPlan`-t és a fenti Interfaces szerinti függvényeket. A `setActivePlan` bekapcsoló UPDATE-je: `active_since = CASE WHEN id = ? THEN ? ELSE active_since END`.

- [ ] **Step 4: Szerver.** A `weekdayOf(today)` két terv-használata (1415, 1475) → `cycleDay(activePlan, today)` (a 1415. sorban előbb `getActivePlan(userId)`, null esetén nincs terv-sablon). Az aktiválás, törlés és az ajánlat-elfogadás adja tovább a `req.today`-t. A `GET /api/plans` a `DAY_LABELS[d]` helyett `dayLabel(d)`-t használ, és visszaadja a `date`-et és az `activeSince`-t. Ha a `server.js` 574. sori `DAY_LABELS` máshol nem kell, töröld.

- [ ] **Step 5: Futtasd az egész szerver-tesztkészletet**

Run: `npm test`
Expected: PASS (a meglévő migrációs és felhasználói tesztek is).

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/server.js tests/server/api.test.js
git commit -m "Terv: active_since horgony, a mai terv-nap a ciklusból"
```

---

### Task 3: Szerver — az edzői nézet a ciklus szerint

**Files:**

- Modify: `server/coaching.js` (80–100 segédek; `weekProgress` 125–144; `evaluatePlans` ~240–250; terv-név ~524–527)
- Test: `tests/server/coaching.test.js`

**Interfaces:**

- Consumes: `cycleDayAt`, `dayEntry` (Task 1); a `plans`/`assignedPlans` elemei `{ id, date, activeSince, week }` (Task 2)
- Produces: `weekProgress` és `adherenceBreakdown` publikus aláírása változatlan

- [ ] **Step 1: Írd meg a bukó teszteket:**

```js
test('heti állás 9 napos tervvel: a cél a ciklus szerint erre a hétre eső edzésnapok', () => {
  const week = Array.from({ length: 9 }, () => ({ type: 'rest' }));
  for (const i of [0, 2, 4, 7]) week[i] = { type: 'workout', name: '', exercises: [] };
  const plans = [
    { id: 1, date: '2026.10.05', activeSince: '2026.10.05', week, days: [0, 2, 4, 7] },
  ];
  // 2026.10.14 szerda; e heti ciklus-napok H..V: 7,8,0,1,2,3,4 → edzés: H, Sze, P, V
  assert.deepEqual(weekProgress({ workouts: [], plans, today: '2026.10.14' }), {
    done: 0,
    target: 4,
    missed: 1, // a hétfő kimaradt, a kedd pihenő volt
  });
});

test('terv-követés 9 napos kiosztott tervvel: a naptári napra a ciklus napja a mérce', () => {
  // ugyanez a terv `assignedPlans`-ként; egy edzés 2026.10.12-én (ciklus 7) planId: 1-gyel →
  // adherenceBreakdown(...).onDay számlálója 1; ha ugyanez az edzés 2026.10.13-án van (pihenő), 0
});
```

- [ ] **Step 2: Futtasd, nézd meg, hogy bukik**

Run: `node --test tests/server/coaching.test.js`
Expected: FAIL — a cél a hétnapokból 4 helyett más számot ad.

- [ ] **Step 3: Valósítsd meg.** A `scheduledWeekdays`/`scheduledOn` hétnap-halmazait cseréld egy `scheduledOnDay(plans, key): boolean`-ra (van olyan terv, amelyiknek `planStart(plan) <= key` és `dayEntry(plan.week, cycleDayAt(plan, key))` nem null). A `weekProgress` célja: a hétfő–vasárnap 7 napjából azok száma, amelyekre a `scheduledOnDay` igaz **a `planStart` szűrés nélkül** (a cél a teljes hét, mint eddig); a `missed` a szűréssel. Az `evaluatePlans` a `weekday` helyett `cycleDayAt(plan, key)`-t használ. A terv-név (526.) → `plans[0]?.name ?? null` (a `getUserPlanSchedules` legfeljebb egy, az aktív tervet adja). Ha a `weekdayOf` már nem kell, töröld.

- [ ] **Step 4: Futtasd**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/coaching.js tests/server/coaching.test.js
git commit -m "Edzői nézet: heti cél és terv-követés a terv ciklusa szerint"
```

---

### Task 4: Kliens — a ciklus tükre, terv-kártyák, edzői felsorolás

**Files:**

- Modify: `public/js/core/plan-week.js`, `public/js/core/constants.js` (komment)
- Modify: `public/js/render/plans.js` (`weekStrip`), `public/js/ui/plans.js` (~76. sor), `public/js/render/coach.js` (~248), `public/js/render/coach-client.js` (~206)
- Modify: `public/style.css` (`.pl-week` — görgethető 14 napnál, „2.” jelölés)
- Create: `tests/public/js/core/plan-week.test.js`

**Interfaces:**

- Produces (kliens, `public/js/core/plan-week.js`):
  - `dayTitle(i)` → `'Hétfő'` / `'Hétfő (2.)'`
  - `dayLabel(i)` → `'H'` / `'K (2.)'` (felsorolásokhoz)
  - `dayLetter(i)` → `'H'` (utótag nélkül, a chipek betűje) és `dayRound(i)` → `''` / `'2.'`
  - `dayAdjective(i)` → `'hétfői'` / `'hétfői (2.)'` (toast: „a hétfői (2.) edzéshez”)
  - `cycleDay(plan, dateStr = localToday())` — a szerveré tükre; `localToday()` a böngésző napja `ÉÉÉÉ.HH.NN` alakban
  - A `todayWeekday` megszűnik

- [ ] **Step 1: Írd meg a bukó tesztet** — a Task 1 `dayName`/`cycleDay` esetei a kliens-függvényekre (`dayTitle` a `dayName` helyén), plusz:

```js
assert.equal(dayLetter(8), 'K');
assert.equal(dayRound(8), '2.');
assert.equal(dayRound(3), '');
assert.equal(dayAdjective(7), 'hétfői (2.)');
```

- [ ] **Step 2: Futtasd, nézd meg, hogy bukik**

Run: `node --test tests/public/js/core/plan-week.test.js`
Expected: FAIL — nincs `cycleDay` export.

- [ ] **Step 3: Valósítsd meg** a tükröt (a dátum-matek önálló: `Date.UTC`-különbség / 86 400 000, `Math.round`). Frissítsd a fejkommentet.

- [ ] **Step 4: Bekötés.**
  - `render/plans.js` `weekStrip`: a `plan.week`-en iterál, a címke `dayLetter(i)` + `dayRound(i)` külön span (`.pl-week-round`), az `aria-label` `dayTitle(i)`. A „ma” kiemelés csak akkor, ha `plan.active || plan.week.length === 7`, és a nap `cycleDay(plan)`.
  - `ui/plans.js`: a mai nap betöltése `cycleDay(plan)`.
  - `coach.js`, `coach-client.js`: `DAY_LABELS[day]` → `dayLabel(day)`.
  - CSS: a `.pl-week` sor ne törjön szét 14 napnál (vízszintes görgetés), a `.pl-week-round` kicsi accent szám.

- [ ] **Step 5: Futtasd**

Run: `npm test` és `npm run lint`
Expected: PASS, lint-hiba nélkül.

- [ ] **Step 6: Commit**

```bash
git add public/js tests/public/js/core/plan-week.test.js public/style.css
git commit -m "Kliens: a terv ciklus-napja, (2.) jelölés a kártyán és az edzői nézetben"
```

---

### Task 5: Terv-építő — „+” és „X”

**Files:**

- Modify: `public/js/ui/plan-builder.js`, `public/js/app/init.js:190`
- Modify: `public/index.html:833–846` (felirat, tipp)
- Modify: `public/style.css` (`.pb-days-chips`, `.pb-day` ~6093–6180)

**Interfaces:**

- Consumes: `dayTitle`, `dayLetter`, `dayRound`, `dayAdjective` (Task 4); `confirmAction(message, { title, confirmLabel }) → Promise<boolean>` (init.js)
- Produces: `setupPlanBuilder(picker, workoutPicker, confirmAction)`

- [ ] **Step 1: Dinamikus napok.** A `lists` és a chipek a `days` hosszából épüljenek (`renderChips()` újraépíti a sávot; a listák DOM-elemei a `days`-szel együtt `splice`-olódnak, így a gyakorlatok a napjukkal mozognak). Minden chip egy `.pb-day-cell` csomagolóban: benne a meglévő `.pb-day` tab-gomb (betű + `.pb-day-round` + állapot) és egy testvér `.pb-day-remove` gomb („✕”, `aria-label`: `` `${dayTitle(i)} törlése` ``) — gomb a gombban nem lehet. A sáv végén `.pb-day-add` gomb („+”, `aria-label`: `Nap hozzáadása`).

- [ ] **Step 2: Hozzáadás / törlés.**
  - `addDay()`: `days.length < 14` esetén `{ type: 'rest', name: '' }` + új üres lista a végére; az új nap lesz kijelölve. 14 napnál a „+” `disabled`.
  - `removeDay(i)`: 1 napnál az X nem látszik. Ha a napon `exerciseCount(i) > 0`: `confirmAction(`${dayTitle(i)} és ${n} gyakorlata törlődik; a többi nap feljebb csúszik.`, { title: 'Törlöd a napot?', confirmLabel: 'Törlés' })`. Törlés után a kijelölés: ha `i < activeDay` → `activeDay - 1`; ha `i === activeDay` → `Math.max(0, i - 1)`; különben marad.
  - A `toastTarget`: `` `a ${dayAdjective(activeDay)} edzéshez` ``.

- [ ] **Step 3: Szövegek.** Az összegző `days.length - training` pihenőt számol. A `#pb-days-label` 7 napnál `A hét — hetente ismétlődik`, különben `A ciklus — ${days.length} nap, utána elölről kezdődik`. A tipp 7 napon túl/alatt kiegészül: `A ciklus az aktiválás hetének hétfőjétől számít.` Frissítsd a modul- és az index.html-kommenteket („A hét” → ciklus).

- [ ] **Step 4: CSS.** `.pb-days-chips`: `flex-wrap: nowrap; overflow-x: auto` (a meglévő „két sorba törik” komment ennek megfelelően); `.pb-day-cell { position: relative; flex: 1 0 44px }`; `.pb-day-remove` a cella jobb felső sarkában, kicsi, a kijelölt (accent) cellán `--on-accent` színű, és ≥24×24 px kattintható; `.pb-day-add` szaggatott accent keret, `disabled` állapotban halvány; `.pb-day-round` kicsi accent szám (kijelölten `--on-accent`). A látványterv: `.superpowers/brainstorm/562-1792140111/content/napok-sav.html`.

- [ ] **Step 5: Kézi ellenőrzés** a `run` skill-lel vagy böngészőben (`npm run dev`), asztali és 375 px-es szélességben:
  - 7 → „+” ×2 → a sáv `… V, H/2., K/2.`, felirat „A ciklus — 9 nap…”
  - a kedd (gyakorlattal) X → megerősítő ablak; „Mégse” után minden marad; „Törlés” után a szerda tartalma a kedd helyén
  - a kijelölt utolsó nap törlése → az előző nap lesz kijelölve; a listák a jó napnál vannak
  - 14 napnál a „+” tiltott; 1 napnál nincs X
  - mentés, majd szerkesztésre újranyitás → ugyanaz a 9 nap
  - mentés + aktiválás után a Tervek kártyán a „ma” a ciklus szerinti nap
  - konzol hibamentes

- [ ] **Step 6: `npm test` és `npm run lint`**, Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/js/ui/plan-builder.js public/js/app/init.js public/index.html public/style.css
git commit -m "Terv-építő: napok hozzáadása (+) és törlése (X), 1–14 napos ciklus"
```

---

### Task 6: Dokumentáció és zárás

**Files:**

- Modify: `README.md:344–352` („Heti bontású tervek” pont)

- [ ] **Step 1:** Írd át a pontot: a terv 1–14 napos ciklus, a horgony az aktiválás hetének hétfője, 7 napnál ez a megszokott heti terv; a 8.–14. nap „(2.)” jelölésű; a „+”/„X” a terv-építőben.
- [ ] **Step 2:** `npm test`, `npm run lint`, `npm run format:check` — mind zöld.
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: változó hosszú, ciklusos edzéstervek"
```
