# Működési hibák javítása: implementációs terv

> **Végrehajtóknak:** kötelező al-skill a superpowers:subagent-driven-development (ajánlott) vagy a superpowers:executing-plans. A lépések `- [ ]` jelöléssel követhetők.

**Cél:** a böngészős bejárásban talált kilenc működési hiba javítása a FitTrack Pro appban.

**Megközelítés:**

- A szerveroldali szabályok (PR, izomláz-felirat) TDD-vel készülnek a meglévő `node --test` fájlokban.
- A felületi hibákat (CSS, sablon, JS) a végén Playwright-tal ellenőrizzük élesben. Ahol olcsó, statikus tesztet is kapnak a `shortcuts.test.js` mintájára, vagyis az `index.html` szövegének ellenőrzésével.
- Ez a munka nem tartalmaz design-átdolgozást, azok külön mennek.

**Tech stack:** Node ≥ 22.5 (`node:sqlite`), Express, vanilla ES modulok, `node --test`, ESLint, Prettier.

**Első lépés jóváhagyás után:** a terv átmásolása ide: `docs/superpowers/plans/2026-09-15-mukodesi-hibak-javitasa.md`. Git-ben ágon dolgozunk, nem a `main`-en, például `git switch -c fix/mukodesi-hibak`.

## Context

A 2026-09-15-i bejárás kilenc működési hibát talált. A felhasználó döntései:

- **PR szabály:** csak az ÚJ (vagy most újramentett) edzéseknél számít kizárólag a pipált szett. A régi, pipálatlan naplóra a visszatöltés továbbra is az első sort veszi.
- **Videó ablak:** marad, de kitalált tartalom helyett „Hamarosan" üzenetet mutat.
- **Check-in zár:** az onboarding introra „Most kihagyom" link kerül, ami csak az adott munkamenetre oldja fel a zárat.

## Global Constraints

- Minden szöveg és komment magyarul készül, a környező kód hangnemében.
- Nincs új függőség.
- Minden task végén zöldnek kell lennie az `npm test` és az `npm run lint` futásnak.
- A commit üzenetek magyarok, a végükön ez a sor áll: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- A kézi teszthez eldobható adatbázis kell: `PORT=3999 FITTRACK_DB=<scratch>/review.db npm start`. A valódi `server/fittrack.db`-hez nem nyúlunk.

---

### Task 1: PR csak pipált szettből, új edzéseknél (hiba #2)

**Háttér:**

- A `bestCompletedSet` (`server/db.js:1608`) pipált szett híján `sets[0]`-t ad. Ezért a 0/3-as edzés is „Új egyéni csúcs" értesítést kap.
- A kliens élő jelzője (`public/js/ui/workout/pr-indicator.js:33`) már most is csak a `done` szetteket nézi.
- A visszatöltés (`recomputeExerciseMaxes`, `db.js:1749`) szerkesztés és törlés után is lefut, ezért soronként tudnia kell, melyik szabály érvényes. Ezt egy új oszlop mondja meg.

**Files:**

- Modify: `server/db.js`: `ensureColumn` blokk (~348–365), `bestCompletedSet` (1593–1617), `recomputeExerciseMaxes` (1749–1790), `addWorkout` (2062–2092), `updateWorkout` (2178–2195)
- Modify: `server/server.js:1610` (`prEntryFor`)
- Test: `server/prs.test.js` (a 127–132. sori teszt átírása és új tesztek)

**Interfaces:**

- Produces: `bestCompletedSet(sets = [], { fallbackToFirst = false } = {}) → set | null`
- Produces: a `workouts.pr_rule INTEGER NOT NULL DEFAULT 0` oszlop. A 0 a régi szabályt jelöli (visszaesés az első sorra), az 1 a szigorút (csak pipált szett).

- [ ] **Step 1: Írd át és bővítsd a teszteket** (`server/prs.test.js`, a „teljesített szett híján…" teszt helyére)

```js
test('teljesített szett híján nincs rekordot hozó szett — kivéve, ha kérjük a régi visszaesést', () => {
  const sets = [{ reps: '5', weight: '60', rpe: '8', type: 'work', done: false }];
  assert.equal(db.bestCompletedSet(sets), null);
  assert.equal(db.bestCompletedSet(sets, { fallbackToFirst: true }), sets[0]);
  assert.equal(db.bestCompletedSet([]), null);
  assert.equal(db.bestCompletedSet(), null);
});

test('az új edzés pipálatlan szettje nem hoz PR-t és csúcsot sem rögzít', () => {
  const user = db.createUser('pipalatlan', 'Pipálatlan Pál', 'scrypt$16384$8$1$gg$hh').user;
  const saved = db.addWorkout(user.id, 'Előre kitöltve', TODAY, nyomas(60, 10, false));
  assert.equal(saved.exercises[0].pr, false, 'pipa nélkül nincs rekord');
  assert.equal(db.getExerciseMax(user.id, 'Fekvenyomás'), null);
});

test('törlés utáni újraszámolás sem csinál PR-t az új, pipálatlan edzésből', () => {
  const user = db.createUser('ujraszamolt', 'Újra Számolt', 'scrypt$16384$8$1$ii$jj').user;
  const valodi = db.addWorkout(user.id, 'Valódi', TODAY, nyomas(50, 5, true));
  db.addWorkout(user.id, 'Kitöltött', HOLNAP, nyomas(90, 5, false));
  const torlendo = db.addWorkout(user.id, 'Törlendő', HOLNAP, nyomas(40, 5, true));
  db.deleteWorkout(user.id, torlendo.id);
  assert.equal(
    db.getExerciseMax(user.id, 'Fekvenyomás').max1rm,
    db.calculateEpley1RM(50, 5),
    'a pipálatlan 90 kg nem lehet csúcs',
  );
  assert.ok(valodi.exercises[0].pr);
});
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbuknak**

Run: `node --test server/prs.test.js`
Expected: FAIL. Az első teszt `sets[0]`-t kap null helyett, a második `pr: true`-t.

- [ ] **Step 3: Implementáció** (`server/db.js`)

Az oszlop az `ensureColumn` sorok közé kerül:

```js
/* Melyik PR-szabállyal mentették az edzést: 0 = a pipák előtti napló (pipa
   híján az első sor a rekord), 1 = csak a pipált szett számít. A visszatöltés
   soronként ebből dönt, hogy a régi napló csúcsai megmaradjanak, de egy mai,
   előre kitöltött edzés ne üssön hamis rekordot. */
ensureColumn('workouts', 'pr_rule', 'pr_rule INTEGER NOT NULL DEFAULT 0');
```

A `bestCompletedSet` új szignatúrát kap (a JSDoc „vagy — ha egy sor sincs bepipálva — az első" részét is javítsd):

```js
export function bestCompletedSet(sets = [], { fallbackToFirst = false } = {}) {
  let best = null;
  let best1rm = 0;
  for (const set of sets) {
    if (!set?.done) continue;
    const oneRM = calculateEpley1RM(set.weight, set.reps);
    if (best === null || oneRM > best1rm) {
      best = set;
      best1rm = oneRM;
    }
  }
  return best ?? (fallbackToFirst ? (sets[0] ?? null) : null);
}
```

A `recomputeExerciseMaxes` lekérdezése a `pr_rule` oszlopot is visszaadja, és soronként ebből dönt:

```js
const rows = db
  .prepare('SELECT id, date, exercises, pr_rule FROM workouts WHERE user_id = ? ORDER BY date, id')
  .all(userId);
// …a ciklusban:
const record = bestCompletedSet(exercise?.sets ?? [], { fallbackToFirst: row.pr_rule === 0 });
```

A régi kommentet („PONTOSAN ugyanaz a szabály, mint az addWorkout-ban…") írd át: a szabály az edzés `pr_rule` jelzőjét követi.

Az `addWorkout` mindig a szigorú szabályt használja, és ezt el is tárolja:

```js
const record = bestCompletedSet(sets); // új edzés: csak a pipált szett számít
// …
.prepare('INSERT INTO workouts (user_id, name, date, exercises, plan_id, pr_rule) VALUES (?, ?, ?, ?, ?, 1)')
```

Az `updateWorkout` ugyanígy tesz: a most újramentett edzés is az új szabály alá kerül.

```js
db.prepare('UPDATE workouts SET name = ?, exercises = ?, pr_rule = 1 WHERE id = ? AND user_id = ?');
```

A `server/server.js:1610` `prEntryFor` csak kijelzésre használja a függvényt, és csak PR-jelölt gyakorlatnál. A régi sorok részletszövege így megmarad:

```js
const set = bestCompletedSet(exercise.sets, { fallbackToFirst: true });
```

- [ ] **Step 4: Futtasd a teljes tesztcsomagot**

Run: `npm test`
Expected: PASS. A `server/migration.test.js` „a visszatöltés a bepipálatlan edzést is figyelembe veszi" tesztje változatlanul zöld marad, mert a régi sorok `pr_rule`-ja 0. A commentjében az „mint az addWorkout" hivatkozást javítsd „a pipák előtti sorokon"-ra.

- [ ] **Step 5: Commit**

```bash
git add server/db.js server/server.js server/prs.test.js server/migration.test.js
git commit -m "PR csak pipált szettből: az új edzés nem üt hamis rekordot, a régi napló csúcsai maradnak"
```

---

### Task 2: „Izomláz: Nincs" check-in után, edzés-előzmény nélkül (hiba #7)

**Háttér:** a `recovery.soreness` a `describe(muscleComponent, …)`-ból jön (`server/recovery.js:905`). Edzés-előzmény és jelzett izomláz nélkül az izom-komponens `null`, ezért „—" jelenik meg. Van viszont mai check-in, és a felhasználó abban nem jelzett izomlázat.

**Files:**

- Modify: `server/recovery.js:900–906`
- Test: `server/recovery.test.js` (a „check-in nélkül a regenerációs sorok…" teszt után)

- [ ] **Step 1: Teszt**

```js
test('check-in van, edzés és jelzett izomláz nincs: az izomláz sora „Nincs", nem „—"', () => {
  assert.equal(run({ checkins: [fullCheckin()] }).recovery.soreness, 'Nincs');
  assert.equal(run().recovery.soreness, '—', 'check-in nélkül továbbra sem találunk ki semmit');
});
```

- [ ] **Step 2: Futtasd, és nézd meg, hogy elbukik**

Run: `node --test server/recovery.test.js`
Expected: FAIL, mert az eredmény `'—'`, nem `'Nincs'`.

- [ ] **Step 3: Implementáció**

```js
      /* Az izom-komponens null, ha se edzés-előzmény, se jelzett izomláz nincs.
         Ha viszont van mai check-in, a felhasználó ott nyilatkozott: nem jelzett
         izomlázat — ez „Nincs", nem ismeretlen. */
      soreness: muscleComponent === null && checkin
        ? 'Nincs'
        : describe(muscleComponent, ['Erős', 'Közepes', 'Enyhe', 'Nincs']),
```

- [ ] **Step 4:** Run: `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -am "Áttekintés: check-in után az izomláz „Nincs”, nem „—”"`

---

### Task 3: Az értesítés-panel desktopon felfelé nyíljon (hiba #1)

**Háttér:**

- A desktop felülírás (`public/style.css:4121`, `@media`-blokkban) előbb áll a fájlban, mint az alapszabály (`.notif-panel`, 4339).
- A két szelektor specificitása azonos, ezért az alap `top: calc(100% + …)` nyer. A panel így y=908-on, a képernyő alatt jelenik meg (900 px magas ablakban).

**Files:**

- Modify: `public/style.css:4119–4126`

- [ ] **Step 1: Specificitás emelése** (a forrássorrendtől független javítás)

```css
/* Az értesítés-panel itt FELFELÉ nyílik: a sáv a képernyő alján ül, lefelé
     nem férne el. Balra igazítva, mert a jobb széle a tartalom fölé lógna.
     A szelektor szándékosan `.app-chrome .notif-panel`: a lenti alapszabály
     később áll a fájlban, azonos specificitással felülírná ezt a blokkot. */
.app-chrome .notif-panel {
  top: auto;
  bottom: calc(100% + var(--sp-3));
  right: auto;
  left: var(--sp-5);
}
```

- [ ] **Step 2: Élő ellenőrzés** (1440×900-as ablak, bejelentkezve, legyen legalább egy értesítés): a harangra kattintás után `document.querySelector('[data-notif-panel]').getBoundingClientRect()` értékére `bottom <= innerHeight` és `top >= 0` teljesül. Mobilon (390×844) a panel továbbra is a fejléc alatt nyílik.
- [ ] **Step 3: Commit:** `git commit -am "Értesítés-panel: desktopon felfelé nyílik (CSS-sorrend miatt a képernyő alá került)"`

---

### Task 4: Beállítás-ikon a fejlécben és statikus őr az üres ikonokra (hiba #3)

**Files:**

- Modify: `public/index.html`: a sprite-ba `#icon-settings` kerül (~20. sor); az `.db-settings` gomb üres `<svg>`-je (~141. sor)
- Create: `public/js/ui/icons.test.js`

- [ ] **Step 1: Teszt** (`public/js/ui/icons.test.js`)

```js
/** Az ikon-sprite őre: egy <use> nem hivatkozhat nem létező szimbólumra, és
    gombban nem állhat üres <svg> — mindkettő láthatatlan, de kattintható gombot ad. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const html = readFileSync(path.join(import.meta.dirname, '..', '..', 'index.html'), 'utf8');

test('minden <use href="#…"> létező szimbólumra mutat', () => {
  const symbols = new Set([...html.matchAll(/<symbol id="([\w-]+)"/g)].map(([, id]) => id));
  for (const [, id] of html.matchAll(/<use href="#([\w-]+)"/g)) {
    assert.ok(symbols.has(id), `hiányzó szimbólum: #${id}`);
  }
});

test('gombban nincs üres <svg>', () => {
  const empty = html.match(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<svg[^>]*>\s*<\/svg>/g) ?? [];
  assert.deepEqual(empty, [], 'üres ikon egy gombban');
});
```

- [ ] **Step 2:** Run: `node --test public/js/ui/icons.test.js`. Expected: FAIL a „gombban nincs üres <svg>" teszten.
- [ ] **Step 3: Implementáció**

A sprite-ba az `#icon-bell` után:

```html
<symbol id="icon-settings" viewBox="0 0 24 24"
  ><path
    d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
/></symbol>
```

A gombban az üres `<svg>` helyére:

```html
<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-settings" /></svg>
```

- [ ] **Step 4:** Run: `npm test`. Expected: PASS. Élesben a harang mellett látszik a fogaskerék desktopon és mobilon is.
- [ ] **Step 5: Commit:** `git add public/index.html public/js/ui/icons.test.js && git commit -m "Fejléc: látható beállítás-ikon, statikus őr az üres ikon-gombokra"`

---

### Task 5: A technika-videó ablak „Hamarosan" üzenetet mutasson (hiba #4)

**Files:**

- Modify: `public/index.html`, `#videoModal` (~1129–1149): a `.video-modal-player`, `.video-modal-comment` és `.video-modal-history` blokk cseréje
- Modify: `public/style.css`: a `.video-modal-player`, `.video-modal-comment`, `.video-modal-history-label`, `.video-modal-thumbs` és `.video-thumb` szabályok törlése (~3863–3905, valamint a 371. sori csoportos szelektorból a `.video-modal-history-label`). Helyükre egy `.video-modal-soon` szabály kerül.

- [ ] **Step 1: Markup.** A kártyában a fejléc után csak ez maradjon:

```html
<!-- A videós technika-napló még nem készült el. Korábban itt egy nem
           működő lejátszó, egy kitalált edzői megjegyzés és üres „Korábbi
           videók" kockák álltak — a felhasználó valós adatnak hihette. -->
<p class="video-modal-soon">
  Hamarosan: itt tudsz majd videót feltölteni a technikádról, és az edződ megjegyzést fűzhet hozzá.
</p>
```

- [ ] **Step 2: CSS**

```css
.video-modal-soon {
  font-size: var(--fs-sm);
  line-height: 1.5;
  color: var(--text-secondary);
  margin: 0;
}
```

- [ ] **Step 3: Ellenőrzés.**
  - `npm test`: a `shortcuts.test.js` modál-szerkezet őre zöld marad, mert a gyökér, a fátyol és a kártya változatlan.
  - `grep -rn "video-modal-comment\|video-thumb" public/` üres eredményt ad.
  - Élesben: gyakorlat hozzáadása → kamera-gomb → az ablakban csak a cím és a „Hamarosan" szöveg látszik.
- [ ] **Step 4: Commit:** `git commit -am "Technika-videó ablak: kitalált demó-tartalom helyett „Hamarosan” üzenet"`

---

### Task 6: Teljes név az edzői kártya üzenet-előnézetében (hiba #5)

**Files:**

- Modify: `public/js/render/coach.js:76`

- [ ] **Step 1: Implementáció**

```js
/* A teljes megjelenített név: az első szó magyar névsorrendnél a
       VEZETÉKNÉV („Kiss: …"), és a név amúgy is szabad szöveg, nem bontható. */
const who = athlete.lastMessage.mine ? 'Te' : athlete.name;
```

- [ ] **Step 2: Ellenőrzés.** Edzőként (bence) az Edző oldalon a kártyán „Kiss Anna: Jól ment…" áll. Futtasd: `npm run lint`.
- [ ] **Step 3: Commit:** `git commit -am "Edzői kártya: teljes név az üzenet-előnézetben"`

---

### Task 7: „Most kihagyom" az első check-in introján (hiba #6)

**Háttér:** a zár `shared.onboardingLock`-ban él. Oldásra a `setOnboardingLock(false)` szolgál (`public/js/nav/router.js:89`, exportált), a navigálásra a `navigate`. A zár nem tartós: újratöltéskor a szerver `onboarding` jelzője (`server.js`, `withOnboarding`) újra bekapcsolja, amíg nincs check-in. Pontosan ez a kért viselkedés. Van már kész másodlagos gombstílus is: `.ci-skip` (`style.css:8002`).

**Files:**

- Modify: `public/js/ui/checkin/steps/intro.js` (`applyOnboardingIntro`)

- [ ] **Step 1: Implementáció.** Új import kell: `import { navigate, setOnboardingLock } from '../../../nav/router.js';`. Az `applyOnboardingIntro` végére, a kijelentkezés-link beállítása után:

```js
/* Aki most nem akar check-int (pl. edző, aki csak a sportolóit kezelné),
     az erre a munkamenetre továbbléphet. Nem tartós: újratöltéskor a szerver
     `onboarding` jelzője visszahozza a varázslót, amíg nincs első check-in. */
const skip = document.createElement('button');
skip.type = 'button';
skip.className = 'ci-skip';
skip.textContent = 'Most kihagyom';
skip.addEventListener('click', () => {
  setOnboardingLock(false);
  navigate('dashboard');
});
exit.before(skip);
```

A kijelentkezés-link fölötti komment („A »Mégse« itt sehová nem vezetne…") is frissüljön: a kiút mostantól a kihagyás, a kijelentkezés pedig a másodlagos kijárat.

- [ ] **Step 2: Élő ellenőrzés** egy friss fiókkal:
  1. Az intron megjelenik a „Most kihagyom" gomb.
  2. Kattintásra az Áttekintés nyílik, a navigáció (side-nav, illetve a mobil gyűrű) látszik, és az Edző oldal elérhető.
  3. Újratöltés után újra a varázsló jön.
  4. Check-in mentése után a zár végleg megszűnik.
- [ ] **Step 3:** Run: `npm test && npm run lint`.
- [ ] **Step 4: Commit:** `git commit -am "Első check-in: „Most kihagyom” — a munkamenetre feloldja a kötelező varázslót"`

---

### Task 8: Edzés befejezése: előbb gyakorlatot kérjen, és ne maradjon elavult névhiba (hiba #8)

**Files:**

- Modify: `public/js/ui/workout.js`: a `finish-workout` kezelő (~372–377), a `workout-add-exercise` kezelő (~281), a `validateWorkoutName` (~309)
- Modify: `public/index.html:402`: az `#workout-name` input placeholdert kap

- [ ] **Step 1: Sorrend a befejezésnél**

```js
if (finishBtn.disabled) return;
// Előbb a tartalom: üres edzésnél a „nevezd el" kérés félrevezető lenne.
if (list.children.length === 0) {
  showToast('Adj legalább egy gyakorlatot az edzéshez', 'error');
  return;
}
if (!validateWorkoutName()) return;
```

- [ ] **Step 2: Az elavult hiba eltüntetése.** A `workout-add-exercise` kattintáskezelő elejére:

```js
// A felhasználó továbblépett — a korábbi névhiba a következő befejezésnél
// úgyis újra megjelenik, ha még mindig nincs név.
titleInput.classList.remove('has-error');
titleError.hidden = true;
```

- [ ] **Step 3: Nincs dupla üzenet.** A `validateWorkoutName`-ből törlődik a `showToast('Adj nevet az edzésnek', 'error')` sor. A mező alatti hiba és a fókusz ugyanazt mondja, a képernyőolvasónak pedig az `aria-describedby` jelzi. Ha a `showToast` import ettől még használt (a gyakorlat-hiánynál igen), marad.

- [ ] **Step 4: Placeholder.** `<input class="wk-title" id="workout-name" maxlength="60" placeholder="Edzés neve" aria-describedby="workout-name-error">`

- [ ] **Step 5: Élő ellenőrzés.**
  1. Üres napló → „Edzés befejezése" → „Adj legalább egy gyakorlatot" toast jelenik meg, névhiba nincs.
  2. Gyakorlat hozzáadása név nélkül → befejezés → csak a mező alatti hiba látszik.
  3. „+ Gyakorlat hozzáadása", majd vissza → a hiba eltűnt.
- [ ] **Step 6: Commit:** `git commit -am "Edzés befejezése: előbb gyakorlatot kér, a névhiba nem ragad be és nem duplázódik"`

---

### Task 9: Egyszerre egy toast (hiba #9)

**Háttér:** a `showToast` (`public/js/core/toast.js:14`) mindig hozzáfűz a régióhoz. Az egymás utáni üzenetek így egymásra rakódnak, és az elavult hiba (pl. „Adj nevet…") a sikeres mentés után is kint marad.

**Files:**

- Modify: `public/js/core/toast.js`

- [ ] **Step 1: Implementáció.** A `region` lekérése után:

```js
/* Egyszerre egy toast: az új üzenet a régit elavulttá teszi („Adj nevet…"
     után a „Befejezve"). Korábban egymásra rakódtak, és a régi hiba a sikeres
     mentés után is kint maradt. A régi toast időzítője ettől még lefut — egy
     már leválasztott elemen a remove() ártalmatlan. */
region.replaceChildren();
```

- [ ] **Step 2: Élő ellenőrzés.** A Task 8 első két lépése egymás után → mindig pontosan egy `.toast` elem van a `.toast-region`-ben. Sikeres befejezés után az összegzőn csak az „Edzés befejezve és naplózva" látszik.
- [ ] **Step 3:** Run: `npm test && npm run lint`.
- [ ] **Step 4: Commit:** `git commit -am "Toast: egyszerre egy üzenet, az új lecseréli az elavultat"`

---

## Záró ellenőrzés (end-to-end)

1. Futtasd: `npm test`, `npm run lint`, `npm run format:check`. Mindhárom zöld.
2. Indítsd az appot eldobható adatbázissal: `PORT=3999 FITTRACK_DB=<scratch>/verify.db npm start`. Hozz létre API-n két fiókot (sportoló és edző), kösd össze őket, és küldj egy üzenetet. A seed-minta a korábbi bejárás `seed.mjs` szkriptje.
3. Playwright (headless Chrome, `C:/Program Files/Google/Chrome/Application/chrome.exe`), desktop 1440×900 és mobil 390×844 nézetben. Minden pont után képernyőkép:
   - #1: a desktop értesítés-panel teljesen a képernyőn belül van.
   - #2: gyakorlat hozzáadása, pipa nélkül befejezés → nincs „Új egyéni csúcs" értesítés, a Rekordok lista nem bővül. Pipával befejezve van PR.
   - #3: látszik a fogaskerék, és kattintásra megnyílik a Beállítások.
   - #4: a videó ablakban csak a „Hamarosan" szöveg látszik.
   - #5: az edzői kártyán „Kiss Anna: …" áll.
   - #6: friss fiókkal a „Most kihagyom" gomb az Áttekintésre visz, újratöltéskor újra a varázsló jön.
   - #7: friss fiók check-in („Nincs izomlázam") után az Áttekintésen az Izomláz sora „Nincs".
   - #8 és #9: a Task 8–9 élő lépései, közben egyszerre legfeljebb egy toast látszik.
4. A konzolban nincs új hiba. A gyakorlat-képek 404-e várható, mert a média helyben hiányzik.
5. Állítsd le a 3999-es szervert.
