# Blokkos programok — első szakasz — megvalósítási terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Új tervfajta, a blokkos program. Blokkokból összerakható, a súlyokat képletekből (TM, 1RM, %) számolja, a haladás az elvégzett edzésekhez igazodik, a ciklus végén pedig szabály alapján TM-et javasol jóváhagyásra. Az első szakasz Viktor 5/3/1-ére és saját használatra készül.

**Architecture:** A számítás három tiszta szerveroldali modul a `server/program/` alatt: képlet, programszerkezet, szabályok. A tárolás a meglévő `plans` táblára épül egy `kind` oszloppal. Mellé jön egy `program_state` és egy `training_maxes` tábla, valamint két új oszlop a `workouts` táblában. A futtatás a `server/services/program-run.js`-ben van, ez kapcsolódik a `workoutTemplate`-hez és az edzésmentéshez. A kliens egy új, vanilla JS programozó oldal: Notion-szerű sorszerkesztő és képletkészítő ablak. A kliens a képlet-kiértékelést tükrözi az élő előnézethez, a kettő egyezését teszt köti össze.

**Tech Stack:** Node ≥ 22.5, Express 4, `node:sqlite`, vanilla ES-modulok, `node --test`, ESLint + Prettier.

**Spec:** `docs/superpowers/specs/2026-11-11-blokkos-programok-design.md`

## Global Constraints

- Új függőség nincs (`package.json` `dependencies`/`devDependencies` változatlan).
- Az egyszerű terv viselkedése nem változik: a meglévő `plan-week` tesztek és az `api.test.js` változtatás nélkül zöldek.
- Súlykerekítés: **2,5 kg**, `roundToPlate(x) = Math.max(0, Math.round(x / 2.5 + 1e-9) * 2.5)`. Az eltolás a lebegőpontos hibát nyeli el (162,5 × 0,7 → 115, nem 112,5).
- TM-indulóérték: **1RM × 0,90**, 2,5 kg-ra kerekítve.
- Viktor szabálya: rekordnál **TM = új 1RM × 95%**, különben **TM + lépésköz**. A lépésköz alapból **alsótestnél 5 kg, egyébként 2,5 kg**, gyakorlatonként felülírható.
- „Új 1RM-rekord” = a ciklusban az adott gyakorlaton **pipált (done), pontosan 1 ismétléses** szettek legnagyobb súlya > a ciklus indulásakor mentett **valódi csúcs**: `max(declared_1rm, a valaha pipált 1 ismétléses szettek legnagyobb súlya)`. **Nem** az `exercise_maxes.max_1rm`, mert azt az AMRAP-ok Epley-becslése is emeli. Ha nincs ilyen szett, a feltétel hamis.
- Szabályok futási pontja: `on: 'workout' | 'week' | 'cycle'` (hiányzó → `'cycle'`). Egy határon a szakaszok láncban futnak (edzés → hét → ciklus), mindegyik az előző javaslatából indul. Ciklus közben csak a változó TM-ek kerülnek jóváhagyásra (`program_state.mid`), és a következő nap csak döntés után töltődik be. Az elfogadott érték marad, a szabályok onnan építkeznek tovább.
- A teljesítmény- és check-in értékek (`stat`) csak szabályfeltételben, az `új 1RM` csak a `set` akcióban érvényes: a szerver validálja, a kliens a blokktárban ugyanígy tilt.
- A haladás csak elvégzett (mentett) edzésre vagy kérésre (ugratás) lép. A naptár nem lépteti.
- A TM-et semmi nem írja át jóváhagyás nélkül.
- Felület: a Podium sötét témája (`public/css/01-alap.css` tokenek). Gépelős képletbevitel és „/” menü nincs. Minden húzható művelet „kijelöl → kattint” módon is elvégezhető, telefonon is.
- Felhasználói szöveg magyarul. Commit-üzenet magyarul, a repó stílusában (`Terület: mit és miért`). **Semmilyen Claude-jelölés nem kerülhet bele:** se `Co-Authored-By`, se említés.
- Minden commit előtt fusson: `npm test`, `npm run lint`, `npm run format:check`.

## Review Focus

1. **Dupla mentés** (dupla koppintás a Befejezésre, két fül): a program csak egyszer léphet tovább. → Task 6, `dupla mentés nem léptet kétszer`.
2. **Aktív program szerkesztése** úgy, hogy a jelenlegi pozíció megszűnik (törölt hét): a legközelebbi létező napra kell állnia, nem összeomlani. → Task 6, `szerkesztés után a pozíció a program végére szorul`.
3. **Utólag hozzáadott TM-es gyakorlat:** a nap akkor is betöltődik, a hiányzó súly üres, és a sablon `missing` listát ad. → Task 5, `hiányzó TM: üres súly és missing lista`.
4. **Nem pipált AMRAP- vagy 1RM-szett:** nem számít bele, ilyenkor „nincs adat” vagy „nem volt rekord” az eredmény. → Task 3, `a nem pipált szett nem számít`.
5. **Tizedesvessző** a TM/1RM mezőkben („112,5”): helyesen 112.5-nek értelmeződik. → Task 7, `parseKg vesszővel`.
6. **Epley-csúcs mint rekordalap:** egy jó AMRAP után a valódi próba-szingli is rekord marad. → Task 5, `AMRAP-becslés nem rontja el a rekordot`.
7. **Kiégésszabály kis edzésen:** a `összes − 10` 10-nél kevesebb szettes edzésen sosem igaz, ez nem hiba; az arányos küszöb (`80% × összes`) működik. → Task 3, `arányos kiégésküszöb`.

---

## Fájlszerkezet

| Fájl                                                                                                                                                                  | Felelősség                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `server/program/formula.js` (új)                                                                                                                                      | képletfa validálása, kiértékelése, kerekítés                                            |
| `server/program/program.js` (új)                                                                                                                                      | programfa validálása, napok kiterítése, napi edzés építése, szükséges értékek           |
| `server/program/rules.js` (új)                                                                                                                                        | ciklusadatok gyűjtése a naplóból, TM-javaslatok                                         |
| `server/db/programs.js` (új)                                                                                                                                          | programtervek, `program_state`, `training_maxes` SQL                                    |
| `server/db/schema.js`, `server/db/migrations.js`                                                                                                                      | új oszlopok és táblák                                                                   |
| `server/db/training.js`                                                                                                                                               | `toPlan` kiegészül a `kind`/`program` mezőkkel; a program nem ütemezés az edzői kártyán |
| `server/validation/workout-body.js`                                                                                                                                   | a szett `amrap` mezőjének átengedése                                                    |
| `server/services/program-run.js` (új)                                                                                                                                 | aktiválás, napi sablon, léptetés, ugratás, ciklusvégi áttekintés                        |
| `server/services/session-plan.js`                                                                                                                                     | `workoutTemplate` → program ág                                                          |
| `server/routes/programs.js` (új) + `server/server.js`                                                                                                                 | API                                                                                     |
| `server/routes/training.js`                                                                                                                                           | `POST /api/workouts` → léptetés; a program kézi aktiválásának tiltása                   |
| `public/js/program/program-model.js` (új)                                                                                                                             | kliensoldali tiszta függvények: képlet-tükör, fa-műveletek, címkék, `parseKg`           |
| `public/js/program/program-builder.js` (új)                                                                                                                           | a programozó oldal (sorszerkesztő)                                                      |
| `public/js/program/formula-window.js` (új)                                                                                                                            | a képletkészítő ablak                                                                   |
| `public/js/program/rule-editor.js` (új)                                                                                                                               | szabálysorok és lépésközök                                                              |
| `public/js/program/program-run.js` (új)                                                                                                                               | aktiválási párbeszéd, ugratás, ciklusvégi áttekintő kártya                              |
| `public/js/plans/plans.js`, `public/js/workout/sets-view.js`, `public/js/workout/loading.js`, `public/js/shared/api.js`, `public/js/app/init.js`, `public/index.html` | bekötés                                                                                 |
| `public/css/14-programozo.css` (új)                                                                                                                                   | a programozó stílusai                                                                   |

## Adatformák (minden task ezekre hivatkozik)

```text
Formula =
  | { t:'num', v:number, pct:boolean }        // 0 ≤ v ≤ 10000; pct → v/100
  | { t:'tm' }                                 // a sor gyakorlatának TM-je
  | { t:'orm', ex:string|null }                // null = a sor gyakorlata
  | { t:'bw' }                                 // testsúly
  | { t:'newOrm' }                             // csak a set akcióban (allowNewOrm)
  | { t:'stat', k:StatKey }                    // csak szabályfeltételben (allowStat)
  | { t:'op', op:'*'|'+'|'-', a:Formula, b:Formula }
  StatKey = 'doneEx'|'totalEx'|'doneAll'|'totalAll'|'amrapReps'|'amrapTarget'|'pain'|'readiness'|'sleep'
  korlát: mélység ≤ 8, csomópont ≤ 32

Program = {
  weeks: [{ label:string(≤40), days: [{ name:string(≤40),
    exercises: [{ name:string(1–80), role:'main'|'accessory',
      sets: [{ count:int 1–20, reps:int 0–100, amrap:boolean, weight:Formula|null }] }] }] }],
  rules: [{ on:'workout'|'week'|'cycle', when:Condition, then:Action, otherwise:Action|null }],   // ≤ 10
  steps: { [exercise:string]: number 0–50 }
}
  korlát: hét 1–12, nap/hét 1–7, gyakorlat/nap 1–20, szett-sor/gyakorlat 1–20
  weight:null = „a napon döntöd el”

Condition = { t:'record' } | { t:'cmp', op:'<'|'<='|'='|'>='|'>', a:Formula, b:Formula }   // a, b: allowStat
Action    = { t:'step' } | { t:'addKg', kg:number } | { t:'addPct', pct:number } | { t:'set', formula:Formula }

Naplózott szett (új, opcionális mező): amrap:int (1–100, az előírt minimum) — csak AMRAP-szetten van jelen.

Suggestion = { exercise:string, current:number, suggested:number, reason:string }

Stats (egy időszak egy gyakorlatra; a ctx.stats-ba kerül):
  { doneEx, totalEx, doneAll, totalAll, amrapReps|null, amrapTarget|null,
    pain|null (max), readiness|null (min), sleep|null (átlag, 1 tizedes) }
RuleWorkout = a mentett edzés + { checkin: { pain|null, readiness|null, sleep|null } }
```

---

### Task 1: Képlet-modul

**Files:**

- Create: `server/program/formula.js`
- Test: `tests/server/program-formula.test.js`

**Interfaces:**

- Produces:
  - `normalizeFormula(raw, { allowNewOrm = false, allowStat = false } = {}) → Formula | null` (érvénytelen → null)
  - `evalFormula(node, ctx) → number`. A `ctx` alakja: `{ exercise, trainingMaxes:{[ex]:kg}, oneRms:{[ex]:kg}, bodyweight:number|null, newOrm?:number|null, stats?:Stats }`. Hiányzó érték (vagy `null` stat) esetén `MissingValueError`-t dob.
  - `class MissingValueError extends Error { kind:'tm'|'orm'|'bw'|'newOrm'|'stat'|'slot'; exercise:string|null }`
  - `roundToPlate(x:number) → number` (a Global Constraints képlete)
  - `formulaRefs(node) → { tm:boolean, orm:Array<string|null>, bw:boolean, newOrm:boolean, stat:boolean }`
  - `formulaText(node) → string`, a szabály-indoklásokhoz: `95% × új 1RM`, `teljesített (mind)`, `összes (mind) − 10`. A stat-címkék: `doneEx` „teljesített (gyak.)”, `totalEx` „összes (gyak.)”, `doneAll` „teljesített (mind)”, `totalAll` „összes (mind)”, `amrapReps` „AMRAP-ismétlés”, `amrapTarget` „előírt ismétlés”, `pain` „fájdalom”, `readiness` „készenlét”, `sleep` „alvás”. Exportálva: `STAT_KEYS`, `STAT_LABELS`.
  - `hu(x) → string`: 2 tizedesre kerekít, tizedesvesszővel (`112.5 → '112,5'`).

- [ ] **Step 1: Írd meg a bukó teszteket**

```js
test('85% × TM a sor gyakorlatának TM-jéből', () => {
  const f = { t: 'op', op: '*', a: { t: 'num', v: 85, pct: true }, b: { t: 'tm' } };
  assert.equal(evalFormula(f, { exercise: 'Guggolás', trainingMaxes: { Guggolás: 100 }, oneRms: {} }), 85);
});
test('60% × 1RM(Guggolás) + 5 → 71, kerekítve 70', () => {
  const f = { t: 'op', op: '+', a: { t: 'op', op: '*', a: { t: 'num', v: 60, pct: true }, b: { t: 'orm', ex: 'Guggolás' } }, b: { t: 'num', v: 5, pct: false } };
  const x = evalFormula(f, { exercise: 'Elöl guggolás', trainingMaxes: {}, oneRms: { Guggolás: 110 } });
  assert.equal(x, 71);
  assert.equal(roundToPlate(x), 70);
});
test('roundToPlate: 119 → 120, 91 → 90, −3 → 0, 162,5 × 0,7 → 115', () => { /* négy assert.equal */ });
test('stat: ctx.stats.doneAll 12 → 12; null stat → MissingValueError kind=stat', …);
test('normalizeFormula: stat csak allowStat mellett, ismeretlen k → null', …);
test('formulaText: összes (mind) − 10, 95% × új 1RM', …);
test('hiányzó TM: MissingValueError kind=tm, exercise=Elöl guggolás', () => {
  assert.throws(() => evalFormula({ t: 'tm' }, { exercise: 'Elöl guggolás', trainingMaxes: {}, oneRms: {} }),
    (e) => e instanceof MissingValueError && e.kind === 'tm' && e.exercise === 'Elöl guggolás');
});
test('normalizeFormula: ismeretlen t, nem véges szám, 9 mély fa, newOrm engedély nélkül → null', () => { /* négy assert.equal(…, null) */ });
test('normalizeFormula: allowNewOrm mellett a newOrm érvényes', () => { /* assert.deepEqual */ });
test('formulaRefs: 60% × 1RM(Guggolás) + TM → tm:true, orm:["Guggolás"]', () => { /* assert.deepEqual */ });
```

- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elbukik**

Run: `node --test tests/server/program-formula.test.js`
Expected: FAIL (`Cannot find module …/server/program/formula.js`)

- [ ] **Step 3: Írd meg a modult** a fenti interfészekkel. A `normalizeFormula` új objektumot épít, és csak az ismert mezőket másolja át. A számot `Number()`-rel olvassa, és `Number.isFinite`-tel ellenőrzi.

- [ ] **Step 4: Futtasd, és ellenőrizd, hogy átmegy**

Run: `node --test tests/server/program-formula.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/program/formula.js tests/server/program-formula.test.js
git commit -m "Programok: a súlyképlet tiszta modulja (validálás, kiértékelés, 2,5 kg-os kerekítés)"
```

### Task 2: Programszerkezet-modul

**Files:**

- Create: `server/program/program.js`
- Test: `tests/server/program-structure.test.js`

**Interfaces:**

- Consumes: Task 1 `normalizeFormula`, `evalFormula`, `roundToPlate`, `formulaRefs`, `MissingValueError`
- Produces:
  - `normalizeProgram(raw) → { program } | { error:string }` (magyar hibaüzenet, pl. `'A programnak legalább egy hete kell legyen.'`)
  - `flattenDays(program) → Array<{ pos, week, day, weekLabel, dayName }>`
  - `nextWeekStart(program, pos) → number` (a következő hét első napjának `pos`-a, vagy a napok száma)
  - `dayTitle(program, pos) → string`, pl. `'1. hét · Guggolásnap'`, név nélkül `'1. hét · 2. nap'`. Üres hétcímkénél `` `${week+1}. hét` ``.
  - `tmExercises(program) → string[]` (azok a gyakorlatok, amelyek bármely szett-képlete `tm`-et használ; egyedi, első előfordulás szerinti sorrendben)
  - `oneRmRefs(program) → string[]` (a képletekben hivatkozott 1RM-gyakorlatok; `ex:null` → a sor gyakorlata; a szabályok `set` képletei is)
  - `buildDayWorkout(program, pos, ctx) → { name, exercises, missing }`
    - `exercises`: a naplóval azonos alak, minden sor `count` darab szettre bomlik: `{ reps:String(reps), weight, rpe:'', type:'work', done:false }`, AMRAP-nál plusz `amrap: reps`.
    - `weight`: `''`, ha a képlet `null` vagy hiányzó érték miatt nem számolható. Egyébként `String(roundToPlate(érték))`.
    - `missing`: `Array<{ kind, exercise }>`, egyedi elemekkel.
    - A `ctx` alakja megegyezik a Task 1-ével, `exercise` nélkül, mert azt soronként tölti ki.

- [ ] **Step 1: Írd meg a bukó teszteket.** A fixture Viktor programjának egy kicsinyített változata: 2 hét × 2 nap. Az 1. hét 1. napja „Guggolás”: `65%×5`, `75%×5`, `85%×5 amrap`, utána `5×10` `50%×TM`. A 2. hét 1. napja „Guggolás”: egy `1×1` szett `weight:null`.

```js
test('flattenDays: 4 nap, pos 0..3, a hét és a nap indexével', …);
test('buildDayWorkout: TM 100 → 65/75/85 kg, az AMRAP-szetten amrap:5, a 5×10 öt külön szett 50 kg-mal', …);
test('buildDayWorkout: weight:null → üres súly, missing üres', …);
test('hiányzó TM: üres súly és missing lista [{kind:"tm", exercise:"Guggolás"}]', …);
test('tmExercises és oneRmRefs: egyedi nevek, a szabály set-képletének 1RM-je is', …);
test('normalizeProgram: 0 hét, 13 hét, 21 szett-sor, üres gyakorlatnév → error', …);
test('normalizeProgram: ismeretlen mezőt eldob, a reps-et egészre kerekíti', …);
test('normalizeProgram: stat a szett súlyában → error; on hiányában cycle', …);
test('nextWeekStart: a 0. pozícióból 2, az utolsó hétből a napok száma', …);
```

- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elbukik** — `node --test tests/server/program-structure.test.js` → FAIL
- [ ] **Step 3: Írd meg a modult.** A szabályok `on`/`when`/`then`/`otherwise` validálása is itt van: az `on` hiányzó vagy ismeretlen értéke `'cycle'`, a `cmp` két oldalán `normalizeFormula(…, { allowStat:true })`, a `set` akció képletén `normalizeFormula(…, { allowNewOrm:true })` fut. Szett-súlyban sem `stat`, sem `newOrm` nem lehet. A `steps` csak véges, 0–50 közötti számokat tart meg.
- [ ] **Step 4: Futtasd, és ellenőrizd, hogy átmegy** — PASS
- [ ] **Step 5: Commit** — `Programok: a programfa validálása és a napi edzés felépítése képletekből`

### Task 3: Szabály-modul

**Files:**

- Create: `server/program/rules.js`
- Test: `tests/server/program-rules.test.js`

**Interfaces:**

- Consumes: Task 1 (`evalFormula`, `roundToPlate`, `formulaText`, `hu`), Task 2 `tmExercises`; `resolveExerciseLoad` a `server/muscles.js`-ből
- Produces:
  - `isLowerBody(name, catalog) → boolean`: (quads + hamstrings + glutes + calves) terhelés > a többi csoporté együtt
  - `defaultStep(name, program, catalog) → number`: `program.steps[name] ?? (isLowerBody ? 5 : 2.5)`
  - `collectCycleData(workouts, exercise) → { amrapReps:number|null, amrapTarget:number|null, bestSingle:number|null }`. Csak a `done:true` szettek számítanak. Az AMRAP-adat az utolsó, `amrap` mezős szettből jön, a `bestSingle` a pontosan 1 ismétléses, pozitív súlyú szettek legnagyobb súlya. A szám-mezők tizedesvesszővel is olvasandók.
  - `periodStats(workouts, exercise) → Stats` (lásd Adatformák). A `totalAll`/`doneAll` az időszak minden szettjét számolja; a check-in a `workout.checkin`-ből: fájdalom max, készenlét min, alvás átlag 1 tizedesre; ha nincs adat, `null`.
  - `suggestTrainingMaxes({ program, rules, trainingMaxes, workouts, baselineMaxes, catalog, ctx }) → Suggestion[]` — minden `tmExercises` gyakorlatra, amelynek van TM-je.
  - `runStages({ program, stages, trainingMaxes, baselineMaxes, catalog, ctx, isCycleEnd }) → Suggestion[]`. A `stages`: `Array<{ on, workouts }>` sorrendben. Minden szakasz a `program.rules` közül az `on`-jának megfelelőket futtatja, a TM-eket az előző szakasz javaslatából. Visszaad: ciklus végén minden TM-es gyakorlatot, ciklus közben csak a változókat; a `current` a lánc előtti TM, a `reason` a szakaszok indoklása `` `${WHEN[on]}: ${reason}` `` alakban `·`-tal fűzve (`WHEN`: „minden edzés után”, „minden hét után”, „a ciklus végén”); változás nélkül `'nincs változás'`. A ciklusszabály indoklása változás nélkül is bekerül.

  Kiértékelési sorrend gyakorlatonként (a demó `suggestTrainingMaxes`-e szerint):
  1. A szabályokat sorban nézi. A `record` feltétel: `bestSingle != null && bestSingle > (baselineMaxes[ex] ?? 0)`.
  2. A `cmp` a két oldalt `evalFormula`-val számolja `{ ...ctx, exercise, trainingMaxes, stats: periodStats(…) }` mellett. Ha `MissingValueError`: `suggested = current`, `reason = 'Nincs adat a szabályhoz'`, és vége.
  3. Igaz feltételnél a `then` fut. Hamis feltételnél az `otherwise`, ha van, különben a következő szabály jön.
  4. Ha egyik szabály sem futott: `suggested = current`, `reason = 'Nincs érvényes szabály'`.

  Az akciók: a `step` hozzáadja a `defaultStep`-et, az `addKg`/`addPct` értelemszerűen működik, a `set` kiértékeli a képletet `newOrm = bestSingle`-lel (csak igaz `record` feltételnél, különben `null`). Ha a `set` akció `MissingValueError`-t dob, `suggested = current` és `reason = 'Nincs adat a szabályhoz'`. A `suggested` mindig `roundToPlate` értéke.

  Indoklás-szövegek, pontosan így:
  - rekord: `` `Új 1RM-rekord: ${hu(bestSingle)} kg` ``
  - nincs rekord: `'Nem volt új 1RM-rekord'`
  - összehasonlítás: `` `${formulaText(a)} = ${hu(a)} ${opJel} ${formulaText(b)} = ${hu(b)}` ``, hamis feltételnél `'Nem teljesült: '` előtaggal; az `opJel` `<`, `≤`, `=`, `≥` vagy `>`.

- [ ] **Step 1: Írd meg a bukó teszteket** (`buildExerciseCatalog()` a `server/data/catalog.js`-ből):

```js
const VIKTOR_RULE = { on: 'cycle', when: { t: 'record' },
  then: { t: 'set', formula: { t: 'op', op: '*', a: { t: 'num', v: 95, pct: true }, b: { t: 'newOrm' } } },
  otherwise: { t: 'step' } };
const BURNOUT = { on: 'workout', when: { t: 'cmp', op: '<', a: { t: 'stat', k: 'doneAll' },
  b: { t: 'op', op: '-', a: { t: 'stat', k: 'totalAll' }, b: { t: 'num', v: 10, pct: false } } },
  then: { t: 'addPct', pct: -30 }, otherwise: null };
test('rekord: 1RM-próba 120 kg (előtte 110) → TM 115 (114 kerekítve), indoklás „Új 1RM-rekord: 120 kg”', …);
test('nincs rekord: Guggolás TM 100 → 105, Fekvenyomás TM 60 → 62,5', …);
test('próba nélkül: a feltétel hamis → lépésköz', …);
test('a nem pipált szett nem számít: done:false 1×125 → nincs rekord', …);
test('steps felülírja: steps.Guggolás = 2,5 → 102,5', …);
test('cmp: AMRAP 3 < előírt 5 → addPct −10 → TM 100 → 90, indoklás „AMRAP-ismétlés = 3 < előírt ismétlés = 5”', …);
test('cmp hiányzó AMRAP-pal → current, „Nincs adat a szabályhoz”', …);
test('periodStats: 2 edzés, 20 szettből 8 pipált; fájdalom max 7, alvás átlag 6,5, készenlét min 55', …);
test('kiégés: 20-ból 8 pipált → minden TM −30% (100 → 70, 60 → 42,5)', …);
test('arányos kiégésküszöb: 6 szettből 3 pipált, doneAll < 80% × totalAll → −30%', …);
test('runStages: edzés −30% után a ciklusszabály a csökkentett TM-ből lép (100 → 70 → 75), az indoklás mindkét szakaszt említi', …);
test('runStages ciklus közben: változás nélkül üres lista', …);
test('isLowerBody: Guggolás és Felhúzás igen, Fekvenyomás és Vállból nyomás nem', …);
```

- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elbukik** — FAIL
- [ ] **Step 3: Írd meg a modult.**
- [ ] **Step 4: Futtasd, és ellenőrizd, hogy átmegy** — PASS. Ha az `isLowerBody` valamelyik katalógusnévre más eredményt ad, a katalógusbeli pontos nevet kell használni (`server/data/exercises.hu.js`), nem a küszöböt hangolni.
- [ ] **Step 5: Commit** — `Programok: a szabályok tiszta modulja (rekord → 95%, különben lépésköz; edzés-, hét- és ciklusszakaszok teljesítmény- és check-in értékekkel)`

### Task 4: Adatbázis — séma, tárolás, AMRAP a naplóban

**Files:**

- Modify: `server/db/schema.js` (`plans`, `workouts` CREATE TABLE + két új tábla), `server/db/migrations.js` (`ENSURED_COLUMNS`), `server/db/training.js` (`PLAN_COLUMNS`, `toPlan`, `getUserPlanSchedules`, `deletePlan`), `server/db/index.js` (`export * from './programs.js'`), `server/validation/workout-body.js`
- Create: `server/db/programs.js`
- Test: `tests/server/program-db.test.js`; a meglévő `tests/server/schema-parity.test.js` és `api.test.js` zöld marad

**Séma:**

```sql
-- plans: új oszlopok
kind    TEXT NOT NULL DEFAULT 'simple',   -- 'simple' | 'program'
program TEXT,                             -- JSON Program (csak kind='program')
-- workouts: új oszlopok
program_cycle INTEGER,
program_pos   INTEGER,
program_readiness INTEGER,                -- a készenlét a mentéskor (0–100) vagy NULL
CREATE TABLE IF NOT EXISTS program_state (
  plan_id INTEGER PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cycle   INTEGER NOT NULL DEFAULT 1,
  pos     INTEGER NOT NULL DEFAULT 0,
  cycle_started TEXT NOT NULL,
  baseline TEXT NOT NULL DEFAULT '{}',  -- JSON {gyakorlat: valódi csúcs} a ciklus indulásakor
  pending  TEXT,                         -- JSON Suggestion[] (ciklus vége) vagy NULL
  mid      TEXT                          -- JSON Suggestion[] (ciklus közbeni szabály) vagy NULL
);
CREATE TABLE IF NOT EXISTS training_maxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  tm REAL NOT NULL,
  date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual','from1rm','review','rule'))
);
CREATE INDEX IF NOT EXISTS idx_training_maxes_user ON training_maxes (user_id, exercise_name, id);
```

**Interfaces:**

- Produces (`server/db/programs.js`, minden függvény a `userId`-re szűr):
  - `addProgramPlan(userId, name, date, program) → Plan`: `kind='program'`, `week='[]'`, `days='[]'`, `active=0`
  - `updateProgramPlan(userId, id, name, program) → Plan | null` (más fajtájú vagy idegen terv esetén null)
  - `getProgramState(userId, planId) → { cycle, pos, cycleStarted, baseline, pending } | null`
  - `initProgramState(userId, planId, today, baseline)` (csak ha még nincs sora)
  - `getProgramState` visszaadja a `mid`-et is (parse-olva vagy `null`)
  - `setProgramPos(userId, planId, pos)`, `setProgramPending(userId, planId, suggestions|null)`, `setProgramMid(userId, planId, suggestions|null)`
  - `getTrueMaxes(userId) → {[ex]:kg}`: gyakorlatonként `max(declared_1rm, a valaha pipált, pontosan 1 ismétléses szettek legnagyobb súlya)`; ami egyikből sincs, az kimarad
  - `startNextCycle(userId, planId, today, baseline)` (`cycle+1`, `pos=0`, `pending=NULL`)
  - `getTrainingMaxes(userId) → {[ex]:kg}` (gyakorlatonként a legutolsó sor)
  - `addTrainingMax(userId, exercise, tm, date, source)`
  - `tagProgramWorkout(userId, workoutId, cycle, pos, readiness) → boolean`: `UPDATE … WHERE id=? AND user_id=? AND program_pos IS NULL`. Akkor igaz, ha történt változás.
  - `getCycleWorkouts(userId, planId, cycle) → Workout[]` (id szerint)
- A `toPlan` kiegészül: `kind`, valamint `program` (parse-olva, egyszerű tervnél `null`).
- A `getUserPlanSchedules` program fajtájú aktív tervnél `[]`-t ad.
- `workout-body.js`: a nem időalapú szett kap egy `...(validAmrap ? { amrap } : {})` mezőt, ahol `validAmrap` egész, 1–100. Más szettalakon nem változtat.

- [ ] **Step 1: Írd meg a bukó teszteket** (`program-db.test.js`). Ideiglenes adatbázison fut, a `PODIUM_DB` env-et a modul importja **előtt** kell beállítani, ahogy a `users.test.js` teszi:

```js
test('addProgramPlan: kind=program, inaktív, a program visszaolvasva azonos', …);
test('updateProgramPlan egyszerű tervre null, idegen userre null', …);
test('training_maxes: a legutolsó érték az érvényes, az előzmény megmarad', …);
test('tagProgramWorkout: első hívás true, második false', …);
test('getTrueMaxes: a bemondott 100 és a pipált 1×105 közül 105; az 5×110 AMRAP nem számít', …);
test('getUserPlanSchedules: aktív programra üres lista', …);
```

Az `api.test.js`-be: `test('a szett amrap mezője megmarad, érvénytelen értéknél eltűnik', …)` (POST /api/workouts → GET /api/workouts).

- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elbukik** — `node --test tests/server/program-db.test.js` → FAIL
- [ ] **Step 3: Írd meg** a sémát, a migrációs oszlopokat, a `programs.js`-t, a `toPlan`/`getUserPlanSchedules` módosítást és az `amrap` átengedését.
- [ ] **Step 4: Futtasd** — `npm test` → minden PASS, a `schema-parity` is.
- [ ] **Step 5: Commit** — `Programok: adatbázis — programtervek, TM-előzmény, program-állapot, AMRAP-jelölés a naplóban`

### Task 5: Futtatás — `program-run` szolgáltatás és a mai edzés

**Files:**

- Create: `server/services/program-run.js`
- Modify: `server/services/session-plan.js` (`workoutTemplate`)
- Test: `tests/server/program-run.test.js` (ideiglenes adatbázis, mint a Task 4-ben)

**Interfaces:**

- Consumes: Task 2, 3, 4; `getAllExerciseMaxes`, `setDeclaredMax`, `getWeightLog`, `getActivePlan`, `setActivePlan`, `getCollection('exerciseCatalog')`
- Produces:
  - `activationNeeds(userId, plan) → { trainingMaxes: Array<{exercise, suggested:number|null}>, oneRms: string[] }`. A `suggested` értéke `roundToPlate(max_1rm × 0.9)`, vagy `null`, ha nincs 1RM.
  - `activateProgram(userId, plan, { trainingMaxes, oneRms }, today) → { plan } | { error, needs }`. Ha valami hiányzik a kérésből: `error = 'Hiányzó értékek'`, és a `needs` visszajön. A `source` `'from1rm'`, ha az érték egyenlő a javasolttal, különben `'manual'`. Az 1RM-et `setDeclaredMax` menti. Az állapot csak akkor indul, ha még nincs (újraaktiválás → folytatás). A függvény már aktív programon is fut: ilyenkor csak pótolja az értékeket.
  - `programTemplate(userId, plan) → { source:'program', name, exercises, planId, workoutId:null, program:{ cycle, pos, total, title }, missing } | { source:'program-review', planId, program:{ cycle }, suggestions } | { source:'program-mid', planId, program:{ cycle, pos, total, title }, suggestions }`. A `pending` elsőbbséget kap a `mid`-del szemben.
  - `onWorkoutSaved(userId, workout, today)`. Ha `workout.planId` az aktív program, és `tagProgramWorkout(…, readiness)` igazat ad (a `readiness` a `readinessReport(userId, today, workouts az épp mentett nélkül).overall`), akkor `pos+1`, és lefut a határ (`afterBoundary`).
  - `afterBoundary(userId, plan, state, { workout|null, leftWeek|null })` (belső): a szakaszok `[edzés: [workout]]`, `[hét: a ciklus leftWeek-hez tartozó edzései]`, és ha `pos === total`, `[ciklus: a ciklus összes edzése]`. A szabályedzések check-inje a `checkins` táblából jön az edzés napjára (`pain`: a JSON legnagyobb értéke, `sleep`: `sleep_hours`), a `readiness` a `program_readiness` oszlopból. `runStages` → ciklus végén `setProgramPending`, ciklus közben nem üres eredménynél `setProgramMid`.
  - `skipProgram(userId, plan, to) → state | { error }`. A `to` értéke `'day'`, `'week'` vagy `'cycle-end'`. Utána `afterBoundary` fut `workout:null`-lal. Áttekintés alatt: `error = 'A ciklus lezárult — előbb hagyd jóvá a TM-eket.'`, nyitott ciklus közbeni javaslatnál: `error = 'Előbb dönts a szabály javaslatáról.'`
  - `approveReview(userId, plan, decisions, today) → state | { error }`. Gyakorlatonként a döntés, vagy a javasolt érték. A `training_maxes` `'review'` sort kap. A `startNextCycle` a friss `getTrueMaxes` baseline-nal indul.
  - `decideMid(userId, plan, decisions|null, today) → state | { error }`. `decisions` objektum → elfogadás (döntés vagy javasolt érték, `'rule'` forrás); `null` → elvetés. Mindkét esetben `mid = NULL`. Nyitott `mid` nélkül `error = 'Nincs függő javaslat.'`
  - `clampAfterEdit(userId, plan)`: ha nincs áttekintés, `pos = min(pos, total−1)`.
- `workoutTemplate`: a mai piszkozat elsőbbsége marad. Utána, ha az aktív terv `kind === 'program'`, a `programTemplate` dönt, és az egyszerű terv ága nem fut.

- [ ] **Step 1: Írd meg a bukó teszteket**

```js
test('activationNeeds: 1RM 110 → javasolt TM 100 (99 kerekítve); 1RM nélkül null', …);
test('activateProgram hiányzó TM-mel → error + needs, a terv nem aktív', …);
test('programTemplate: 1. hét 1. nap, 85 kg-os AMRAP amrap:5-tel, program.title „1. hét · Guggolásnap”', …);
test('hiányzó TM: üres súly és missing lista', …);              // Review Focus 3
test('onWorkoutSaved: a pos 1-re lép; az utolsó nap után program-review jön a javaslatokkal', …);
test('skipProgram week → a következő hét eleje; cycle-end → review', …);
test('approveReview: az új TM-mel számol a 2. ciklus, és a baseline az új csúcs', …);
test('AMRAP-becslés nem rontja el a rekordot: 5×110 AMRAP (Epley 128) után a 1×120 próba rekord, 1RM előtte 110', …);   // Review Focus 6
test('kiégés edzésszabály: 20-ból 8 pipált → program-mid −30%-kal; elfogadás után a következő nap a 70%-os TM-mel számol, rule forrással', …);
test('fájdalomszabály a check-inből: a napi pain.general 8 → program-mid', …);
test('decideMid null → a TM marad, jön a következő nap', …);
test('workoutTemplate: a mai piszkozat elsőbbséget kap a programnappal szemben', …);
```

- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elbukik** — FAIL
- [ ] **Step 3: Írd meg a szolgáltatást és a `workoutTemplate` ágat.** A testsúly a `getWeightLog` legutolsó bejegyzése, ha nincs, `null`. Az aktiváláskor induló állapot baseline-ja `getTrueMaxes`.
- [ ] **Step 4: Futtasd** — `npm test` → PASS
- [ ] **Step 5: Commit** — `Programok: futtatás — aktiválás, a mai programnap kiszámolt súlyokkal, léptetés, ugratás, ciklusvégi jóváhagyás`

### Task 6: API

**Files:**

- Create: `server/routes/programs.js`
- Modify: `server/server.js` (`registerPrograms(app, deps)`), `server/routes/training.js` (`POST /api/workouts` → `onWorkoutSaved`; `POST /api/plans/:id/active` program fajtánál `active:true` → 409; `GET /api/plans` a programhoz `state` összegzést ad: `{ cycle, pos, total, title, review:boolean, mid:boolean }`)
- Test: `tests/server/programs-api.test.js` (`startServer({ label: 'programs' })`)

**Végpontok** (mind bejelentkezést kér, és idegen vagy ismeretlen id-re 404-et ad):

| Módszer, út                        | Törzs                                          | Válasz                                                                                                  |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `POST /api/programs`               | `{ name, program }`                            | 201 `Plan`; 400 `{error}`                                                                               |
| `PUT /api/programs/:id`            | `{ name, program }`                            | 200 `Plan` (+`clampAfterEdit`)                                                                          |
| `GET /api/programs/:id`            | –                                              | `{ plan, state, trainingMaxes, defaultSteps:{ex:kg} }` (`defaultStep` minden `tmExercises` gyakorlatra) |
| `GET /api/programs/:id/activation` | –                                              | `activationNeeds`                                                                                       |
| `POST /api/programs/:id/activate`  | `{ trainingMaxes:{ex:kg}, oneRms:{ex:kg} }`    | 200 `{plan}`; 400 `{error, needs}`                                                                      |
| `POST /api/programs/:id/skip`      | `{ to }`                                       | 200 `state`; 409 `{error}`                                                                              |
| `GET /api/programs/:id/review`     | –                                              | `{ suggestions }`, vagy 404, ha nincs áttekintés                                                        |
| `POST /api/programs/:id/review`    | `{ decisions:{ex:kg} }`                        | 200 `state`                                                                                             |
| `POST /api/programs/:id/mid`       | `{ decisions:{ex:kg} }` vagy `{ reject:true }` | 200 `state`; 409 `{error}`                                                                              |
| `GET /api/training-maxes`          | –                                              | `{[ex]:kg}`                                                                                             |

A számmezők (kg) `Number()`-rel olvasandók: véges, 0 < x ≤ 1000, egyébként 400.

- [ ] **Step 1: Írd meg a bukó teszteket.** Egy teljes, rövid ciklust visznek végig: 1 hét × 2 nap, a 2. napon 1RM-próba.

```js
test('POST /api/programs érvénytelen programmal 400, magyar hibaüzenettel', …);
test('aktiválás TM nélkül 400 + needs; TM-mel 200, a workout-template program-forrású 85 kg-mal', …);
test('a program kézi aktiválása a /api/plans/:id/active úton 409', …);
test('dupla mentés nem léptet kétszer', …);                       // Review Focus 1: ugyanaz a törzs kétszer → pos 1
test('a 2. nap után review: rekordnál 95%, a jóváhagyás után az 1. nap új súllyal jön', …);
test('edzésszabály → program-mid; POST mid elfogadással a TM-előzményben rule forrás', …);
test('szerkesztés után a pozíció a program végére szorul', …);   // Review Focus 2
test('MÁS fiók programja: GET/PUT/skip/review 404', …);
test('GET /api/programs/:id defaultSteps: Guggolás 5, Fekvenyomás 2,5', …);
test('a meglévő egyszerű terv viselkedése változatlan (GET /api/plans kind:"simple")', …);
```

- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elbukik** — `node --test tests/server/programs-api.test.js` → FAIL
- [ ] **Step 3: Írd meg a végpontokat** a meglévő `register(app, deps)` mintával, `parseRowId`-vel és `req.today`-jel.
- [ ] **Step 4: Futtasd** — `npm test` → PASS
- [ ] **Step 5: Commit** — `Programok: API — létrehozás, szerkesztés, aktiválás, ugratás, ciklusvégi áttekintés`

### Task 7: Kliens-modell (tiszta függvények)

**Files:**

- Create: `public/js/program/program-model.js`
- Test: `tests/public/js/program/program-model.test.js`

**Interfaces:**

- Produces:
  - `evalFormula`, `roundToPlate`, `MissingValueError`: **viselkedésben azonos** a Task 1 szervermoduljával
  - `formulaLabel(node) → string` a sorbeli kijelzéshez: `85% × TM`, `60% × 1RM: Guggolás + 5`, a `-` → `−`, a `*` → `×`, és csak akkor zárójelez, ha a precedencia megkívánja
  - `getAt(root, path)`, `setAt(root, path, value) → root`. A `path` `''` vagy pontokkal elválasztott `'a.b'`, és a függvény nem mutál, másolatot ad.
  - `insertBlock(root, path, template) → { root, nextSel }`. Ha a sablon `op` és a helyen érték áll, a műveletet köré pattintja (`a = régi`), és a `nextSel` a `b` lesz.
  - `removeAt(root, path) → root` (a hely `null` lesz)
  - `duplicateDay(program, w, d) → program`, `duplicateWeek(program, w) → program`, mély másolattal, közvetlenül az eredeti után
  - `weekSummary(week) → string`, pl. `'65 / 75 / 85%'`. Ez az első nap első fő gyakorlatának százalékai, `pct` számokból, ha a képlet `num% × tm`.
  - `parseKg(text) → number | null` (`'112,5' → 112.5`, `'abc' → null`, `'0' → null`)
  - `canUseNode(node, where) → string | null`: `where` ∈ `'set'|'cond'|'act'`. `stat` csak `cond`-ban, `newOrm` csak `act`-ban; különben a magyar hibaüzenet: `'A teljesítmény- és check-in értékek csak szabályfeltételben használhatók.'`, illetve `'Az „új 1RM” csak a szabály „TM = képlet” akciójában használható.'`
  - `insertIntoRoot(root, template) → root`: üres gyökérbe a sablon; `op` sablon a meglévő gyökeret öleli körbe (`a = régi`); egyébként az első üres helyre kerül (mélységi bejárás, `a` előbb), ha nincs üres hely, a gyökeret cseréli
  - a `formulaLabel` a `stat` csomópontot a szerver `STAT_LABELS` címkéjével írja

- [ ] **Step 1: Írd meg a bukó teszteket**, köztük egy paritás-tesztet. Ez ugyanazokon a fixture-öken futtatja a `server/program/formula.js` és a kliens `evalFormula`-ját, és az eredményeknek egyezniük kell.

```js
test('parseKg vesszővel: „112,5” → 112.5, „abc” → null', …);          // Review Focus 5
test('formulaLabel: (TM + 5) × 90% zárójelez, 60% × 1RM: Guggolás + 5 nem', …);
test('insertBlock: × a TM-re → TM × □, a nextSel a „b”', …);
test('insertIntoRoot: TM × □ + 85% → TM × 85%; üresbe a sablon', …);
test('canUseNode: stat a szett súlyában hibaüzenet, feltételben null', …);
test('duplicateWeek: a másolat az eredeti után, a módosítás nem hat vissza', …);
test('szerver–kliens paritás: 12 fixture azonos eredménnyel vagy azonos hibafajtával', …);
```

- [ ] **Step 2–4:** bukás → megírás → `npm test` PASS
- [ ] **Step 5: Commit** — `Programok: kliensoldali programmodell (képlet-tükör paritás-teszttel, fa-műveletek)`

### Task 8: A programozó oldal — sorszerkesztő

**Files:**

- Create: `public/js/program/program-builder.js`, `public/css/14-programozo.css`
- Create még: `public/js/program/block-library.js`
- Modify: `public/index.html` (új `<section class="app-page" data-page="program-builder">` és `<link>` a 14-es css-re a 13-as után), `public/js/app/init.js` (`setupProgramBuilder`), `public/js/shared/api.js` (`createProgram`, `updateProgram`, `getProgram`, `getTrainingMaxes`), `public/js/plans/plans.js` (az „+ Új blokkos program” gomb a meglévő „+ Új terv” mellett; a program-kártya „Szerkesztés” gombja ide navigál)

**Interfaces:**

- Consumes: Task 6 API, Task 7 modell
- Produces: `setupProgramBuilder(confirmAction) → { open(planId|null) }`

**Viselkedés** (a spec 4.1 és 4.2 pontja; vizuális minta a spec szerinti 8-as stílus):

- Sorok fogantyúval (`⋮⋮`). A blokk fajtája monospace címkével és színnel: hét `--c-superset`, nap és gyakorlat lila, a szabály `--c-accent`. A beágyazást vékony segédvonal mutatja.
- Hozzáadás a sor végi „+” gombbal, mozgatás húzással és „kijelöl → fel/le” gombokkal. Törlés megerősítéssel (`confirmAction`). Nap és hét duplikálása.
- A hét becsukható. Becsukva a sor a `weekSummary`-t mutatja.
- Szett-sor: darabszám, ismétlés, AMRAP-kapcsoló (bordó `5+ AMRAP` jelvény), súly-riporterek (`formulaLabel` alapján, színezett „pill”-ek), vagy „a napon döntöd el” felirat. A sor végén élő előnézet a saját TM/1RM-ből, például „85 kg”, vagy a hiány, például „nincs TM: Elöl guggolás”.
- Gyakorlat választása a meglévő `exercise-picker`-rel, vagy a blokktárból húzva.
- **Blokktár** (`public/js/program/block-library.js`, új fájl; a demó `CATS`/`sideItems`/`applyDrop` mintája): bal oldali sáv függőleges kategóriafülekkel — _Szerkezet_ (hét, nap, szett, szabály), _Gyakorlat_ (a katalógus, keresőmezővel), _Értékek_ (`50%`, `20`, `TM`, `1RM: gyakorlat ▾`, `testsúly`, `új 1RM`), _Teljesítmény_ (a hat teljesítmény-stat), _Check-in_ (fájdalom, készenlét, alvás), _Műveletek_ (`□ × □`, `□ + □`, `□ − □`). Kategóriánként egy rövid tipp, hová húzható. A ledobási célok `data-dz` attribútumot kapnak: `week`, `day`, `ex`, `setw`, `cond`, `act`, `rules`. A szabályok a demóéval egyeznek: gyakorlat a napra = új gyakorlat (első a fő, a többi kiegészítő), meglévő gyakorlatra = csere; szett csak gyakorlatra; nap hétre vagy napra (utána); hét bárhová (a cél hete után, cél nélkül a végére); szabály a Szabályok kártyára; érték/művelet a szett súlyára (`insertIntoRoot`) vagy a feltétel egyik oldalára, előtte `canUseNode`. Rossz célnál toast a demó hibaszövegeivel. **Kijelölés + kattintás:** a sor `⋮⋮` fogantyúja kijelöli a sort (kiemelés), utána a blokktárban kattintás ugyanazt az `applyDrop`-ot futtatja; nyitott képletkészítőnél a kattintás a kijelölt helyre tesz. 720 px alatt a sáv egy „▦ Blokktár” gombbal nyíló fiók.
- Produces még: `applyDrop(program, item, target) → { program } | { error }` tiszta függvényként a `block-library.js`-ben, hogy tesztelhető legyen.
- Mentés: `POST`, illetve `PUT /api/programs`. A szerver hibaüzenete toastban jelenik meg.

- [ ] **Step 1: Írj tesztet** a `tests/public/js/program/program-builder.test.js`-be a `tests/public/js/fake-dom.js` mintájára: `'a + Szett a gyakorlat végére új 1×5-ös sort tesz, üres súllyal'` és `'a becsukott hét a weekSummary szövegét mutatja'`; és a `tests/public/js/program/block-library.test.js`-be: `'gyakorlat napra: új kiegészítő; gyakorlatra: csere'`, `'szett napra ejtve hibaüzenet'`, `'fájdalom a szett súlyára: hibaüzenet, a feltételbe: bekerül'`, `'× a szett súlyára: körbeöleli a meglévő képletet'`.
- [ ] **Step 2: Futtasd, és ellenőrizd, hogy elbukik** — FAIL
- [ ] **Step 3: Írd meg** az oldalt, a CSS-t és a bekötést.
- [ ] **Step 4: Ellenőrizd.** `npm test` → PASS. Utána indítsd el az appot (`npm run dev`), és rakd össze kézzel Viktor 1. hetét (4 nap, főgyakorlat + kiegészítők). Mentsd el, töltsd újra, és nézd meg, hogy minden megmaradt. 375 px szélességen se legyen vízszintes görgetés.
- [ ] **Step 5: Commit** — `Programok: a programozó oldal — Notion-szerű sorszerkesztő a Podium témájában`

### Task 9: Képletkészítő ablak

**Files:**

- Create: `public/js/program/formula-window.js`
- Modify: `public/js/program/program-builder.js` (a súly-riporterre kattintva nyílik), `public/css/14-programozo.css`

**Interfaces:**

- Consumes: Task 7 `insertBlock`, `removeAt`, `setAt`, `evalFormula`, `formulaLabel`
- Produces: `openFormulaWindow({ title, formula, exercise, allowNewOrm, preview(formula) → string, onChange(formula) })`

**Viselkedés** (a demó, `.superpowers/brainstorm/…/kepletkeszito-demo.html`, gépelős rész nélkül):

- **Vászon:** helyek (szaggatott keret) és egymásba ágyazott riporterek. A szám mezőben szerkeszthető, és elfogadja a `%` végződést. Az `1RM` mellett legördülő választja a gyakorlatot (`ez a gyakorlat` + a katalógus). A műveletjel legördülővel váltható. Ráhúzáskor `×` gomb jelenik meg a kivételhez.
- **Paletta:** „Értékek” (`50%`, `20`, `TM`, `1RM: gyakorlat ▾`, `testsúly`, valamint `új 1RM`, ha `allowNewOrm`, és a teljesítmény-/check-in értékek, ha `allowStat`) és „Műveletek” (`□ × □`, `□ + □`, `□ − □`). Húzással (HTML5 DnD), vagy kijelölt hely és kattintás révén kerülnek a vászonra. A blokktárból is ide húzható, illetve nyitott ablaknál a blokktár kattintása a kijelölt helyre tesz (`canUseNode` szűrővel).
- Az `openFormulaWindow` paraméterei kiegészülnek: `allowStat:boolean`, `noFree:boolean` (a „Napon döntöd el” gomb elrejtése a szabályokban).
- **Eredmény:** a `preview(formula)` szövege. Mobilon az ablak alul, teljes szélességben jelenik meg.
- A „Napon döntöd el” gomb a súlyt `null`-ra állítja.

- [ ] **Step 1: Írj tesztet:** `'kijelölt hely + kattintás a TM-re a helyre teszi'` és `'a × a meglévő értékre húzva körbeöleli'` (fake-dom; a DnD-t a `drop` esemény kézi kiváltásával).
- [ ] **Step 2–4:** bukás → megírás → `npm test` PASS. Utána kézzel: `60% × 1RM: Guggolás + 5` összerakása egérrel, aztán érintés-emulációval (375 px), a sorban `70 kg`.
- [ ] **Step 5: Commit** — `Programok: képletkészítő ablak — Scratch-féle riporterek húzással és kijelöléssel`

### Task 10: Szabályszerkesztő

**Files:**

- Create: `public/js/program/rule-editor.js`
- Modify: `public/js/program/program-builder.js` (a „Ciklus vége” szakasz a hetek után), `public/css/14-programozo.css`

**Interfaces:**

- Consumes: Task 9 `openFormulaWindow` (`allowNewOrm:true`), Task 7
- Produces: `renderRules(container, program, onChange)`

**Viselkedés:**

- A szabály fejsora: `[minden edzés után | minden hét után | a ciklus végén ▾]` (az `on`). Alatta: `HA [feltétel ▾]`. A feltétel lehet „volt új 1RM-rekord a próbán”, vagy összehasonlítás `[képlet] [< ≤ = ≥ >] [képlet]`, ahol mindkét oldal `data-dz="cond"` ledobási cél (blokktárból húzható érték, stat vagy művelet), és kattintásra a képletkészítő nyílik `allowStat:true, noFree:true` mellett. Alatta két ágsor: `AKKOR [akció ▾]` és `KÜLÖNBEN [akció ▾ | nincs]`. A `TM = képlet` akció képlete `data-dz="act"` cél.
- Akciók: `TM + lépésköz`, `TM + x kg`, `TM ± x%`, `TM = képlet`. Ez utóbbi a képletkészítő ablakot nyitja.
- **Lépésközök** blokk: a program `tmExercises` listája. Gyakorlatonként egy kg-mező, előtöltve 5-tel vagy 2,5-del. Az alapérték a `GET /api/programs/:id` `defaultSteps` mezőjéből jön (Task 6). Mentetlen, új programnál, amíg nincs id, 2,5 az alapérték. Az átírt érték a `program.steps`-be kerül.
- Az új program alapból Viktor szabályával indul (rekord → `95% × új 1RM`, különben lépésköz).

- [ ] **Step 1: Írj teszteket:** `'az alapszabály: a ciklus végén HA rekord AKKOR 95% × új 1RM KÜLÖNBEN lépésköz'`, `'a futási pont átváltása az on mezőt írja'` és `'a lépésköz átírása a program.steps-be ír'` (fake-dom).
- [ ] **Step 2–4:** bukás → megírás → `npm test` PASS
- [ ] **Step 5: Commit** — `Programok: szabályszerkesztő — HA/AKKOR/KÜLÖNBEN sorok és gyakorlatonkénti lépésköz`

### Task 11: Futtatás a felületen — aktiválás, mai edzés, ugratás, áttekintés

**Files:**

- Create: `public/js/program/program-run.js`
- Modify: `public/js/plans/plans.js` (a program-kártya), `public/js/workout/loading.js` (a `program` és a `program-review` forrás), `public/js/workout/sets-view.js` (`amrap`), `public/js/shared/api.js`, `public/css/14-programozo.css`

**Interfaces:**

- Consumes: Task 6 API, Task 7 `parseKg`
- Produces: `openActivation(planId)`, `renderReviewCard(container, review)`, `renderMidCard(container, mid)`, `programCardActions(plan)`

**Viselkedés:**

- **Program-kártya a Tervek oldalon.** Mutatja a „blokkos program” címkét, a helyzetet (`2. ciklus · 1. hét · Guggolásnap`, ebből a `state.title` és a ciklus jön), valamint a gombokat: Szerkesztés, Aktiválás vagy Kikapcsolás, és egy Ugratás menü (következő nap, következő hét, ciklus vége). Az ugratás `confirmAction`-nel indul.
- **Aktiválási párbeszéd.** Gyakorlatonként egy TM-mező a javaslattal előtöltve, és a hiányzó 1RM-ek mezői. A beolvasás `parseKg`-gel történik, érvénytelen értéknél mezőszintű hibaüzenet jelenik meg. A párbeszéd a Tervek kártyáról akkor is megnyitható, ha a `workout-template` `missing` listát ad. Ilyenkor az Edzés oldalon egy figyelmeztetés jelenik meg „Hiányzó érték: …” szöveggel és egy gombbal, ami ide vezet.
- **Edzés oldal, program forrás.** A cím `program.title`. Az AMRAP-szett sorában a `5+` jelvény áll, és az ismétlésmező felirata „legalább 5”. A `renderSetRow` a `set.amrap`-ot a `row.dataset.amrap`-ba írja, a `readSetRow` pedig visszaadja (`amrap: Number(row.dataset.amrap)`, ha van).
- **Edzés oldal, `program-mid` forrás.** Edzés helyett a „Szabály szerinti javaslat” kártya (bordó keret): a szöveg „Az utolsó edzés vagy hét alapján egy szabály beütött. Ha elfogadod, ez lesz az új TM, és a szabályok innen építkeznek tovább.”, soronként gyakorlat, `jelenlegi → javasolt` (átírható), ↑/↓, indoklás; gombok: „Elfogadom” (`POST mid` a döntésekkel) és „Elvetem” (`{ reject:true }`), utána a mai edzés újratöltődik.
- **Edzés oldal, `program-review` forrás.** Edzés helyett az áttekintő kártya jelenik meg. Soronként: gyakorlat, `jelenlegi → javasolt` (átírható mező), indoklás. Alul a „Mind elfogad” és az „Elfogadom” gomb, ezek a `POST review`-t hívják, utána a mai edzés újratöltődik.

- [ ] **Step 1: Írj teszteket:** `'readSetRow visszaadja az amrap-ot, renderSetRow beírja'` (`tests/public/js/workout/…`, fake-dom), `'az áttekintő kártya az átírt értéket küldi, a többinél a javasoltat'` és `'a ciklus közbeni kártya Elvetem gombja reject:true-t küld'`.
- [ ] **Step 2–4:** bukás → megírás → `npm test` PASS
- [ ] **Step 5: Commit** — `Programok: aktiválás, a mai programnap, AMRAP a naplóban, ugratás és ciklusvégi jóváhagyás a felületen`

### Task 12: Végső ellenőrzés

- [ ] **Step 1:** `npm test`, `npm run lint`, `npm run format:check`. Mindhárom hiba nélkül fusson.
- [ ] **Step 2: Kézi végigjátszás** (`npm run dev`, friss felhasználóval). Rakd össze Viktor programját: 4 hét, a 4. hét 1RM-próbával, plusz a szabály. Aktiváld, előtte add meg az 1RM-et, és a TM-javaslat legyen a 90%. Végezz el egy napot úgy, hogy az AMRAP-ban a ténylegesnél több ismétlést írsz. Ugrass a ciklus végére, rögzíts egy rekord-szinglit, és hagyd jóvá. A 2. ciklus 1. napja az új TM-mel számol. Húzz be a blokktárból egy edzés utáni kiégésszabályt (`teljesített (mind) < 80% × összes (mind)` → −30%), fejezz be egy napot félig, fogadd el a javaslatot, és nézd meg, hogy a következő nap a csökkentett TM-mel számol. Ugyanezt telefonméretben (375 px) kijelöléssel + kattintással is.
- [ ] **Step 3:** Ellenőrizd, hogy egy meglévő egyszerű terv aktiválása és betöltése pontosan úgy működik, mint a `main` ágon.
- [ ] **Step 4: Commit** (csak ha volt javítás) — `Programok: a végső végigjátszás javításai`
