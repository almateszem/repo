# A dizájn átültetése az appra — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `6351a1b3` artifact dizájn-prototípusának vizuális nyelve mind a 11 oldalra, a belépőre és a modálokra kiterjed, és a regenerációs kérdőív visszakapja a testtérképet — igazi SVG emberkeként.

**Architecture:** Előbb a tokenek és a primitívek (hajszálvonalas rács, szekció, felkiáltó, display-szám, sor-elem, CTA-sáv, léptető, szegmens) épülnek ki a `style.css` elején; utána minden oldal ezekre áll át. A testtérkép önálló, két call-site által használt komponens lesz (`public/js/ui/bodymap/`), az izomláz-skála pedig 1–10-re nő a szerverig.

**Tech Stack:** Vanilla ES modulok build-lépés nélkül (`public/js/`), Express + `node:sqlite` (`server/`), `node:test`, ESLint flat config, Prettier. Nincs frontend-keretrendszer és nincs CSS-preprocesszor.

**Spec:** [`docs/superpowers/specs/2026-09-08-dizajn-atultetes-design.md`](../specs/2026-09-08-dizajn-atultetes-design.md)

## Global Constraints

- **Ág:** `dizajn-atultetes`. Nem mergeljük, amíg a záró task le nem futott.
- **Nyelv:** minden kód-komment, commit-üzenet és felhasználói szöveg **magyar**, a repó meglévő stílusában. A kommentek a *miértet* magyarázzák, nem a mit.
- **Nincs build-lépés.** Semmilyen új futásidejű függőség nem kerül be; a `package.json` `dependencies` blokkja változatlan marad.
- **Tokenek, nem literálok.** Új CSS-szabály nem tartalmazhat nyers színértéket — kizárólag `var(--…)`. Az egyetlen hely, ahol szín-literál születik, a `:root` blokk.
- **Érintési minimum:** `--tap-min: 44px`. Minden új interaktív elem eléri, kivéve a testtérkép régióit — ott a térkép alatti érték-sorok az egyenértékű út (ez a kivétel már ma is dokumentálva van a `style.css`-ben, tartsuk meg a kommentet).
- **Halvány szövegek:** információt hordozó szöveg soha nem megy `--text-muted` (.50) alá. A prototípus `faint` szintje (rgba fehér .34) csak dekoratív elemre való (pl. a `%` jel egy nagy szám mellett).
- **Lekerekítés:** minden sugár-token `0px`, kivéve `--r-full: 50%` (avatar, nav-korong, készenlét-gyűrű).
- **Adatmigráció nincs.** A `server/fittrack.db` eldobható demóadat.
- **Zöld kapu minden task végén:** `npm test` és `npm run lint`. Kiinduló állapot: **317 teszt, mind zöld.**
- **Formázó NEM fut.** Se `npm run format`, se `npm run format:check`, se
  `npx prettier` — semmilyen fájlra. **Ez felülírja az egyes taskok lépéseiben
  szereplő összes formázó parancsot.**

  Miért: a repó soha nem volt Prettier-tiszta, és nem egy-két fájlon nem az. A
  `public/index.html` egyetlen formázása 4417 sornyi, a feladathoz nem tartozó
  változást hozna; ugyanez igaz a `server/` moduljaira. A „formázd, amit
  megérintettél" szabály tehát pont azt a szennyezést okozná, amit tiltani
  akart. A repó Prettier-tisztaságának helyreállítása önálló munka, nem
  ennek a dizájn-átültetésnek a mellékterméke.

  A `public/style.css` a kivétel, és már megtörtént: az 1. task saját,
  tartalmatlan commitban formázta (`01407c2`), mert tizenöt task írja, és
  CSS-ben a szóköznek nincs jelentése. HTML-ben van — az `index.html`
  formázása inline elemek között renderelést változtathat —, ezért az
  **szándékosan nem** kap ilyen commitot.

  Új kódot a **környező stílushoz** igazítva írj: ugyanaz a behúzás,
  ugyanaz az idézőjel-használat, ugyanaz a sorhossz, mint a szomszéd
  sorokban.
- **Nem érintett fájl nem változhat.** Ha egy task diffje olyan fájlt is
  módosít, amit a task „Files" blokkja nem sorol fel, az hiba — akkor is, ha
  csak formázás.
- **`git reset --hard` tilos.** Az ág a taskok közös munkaterülete; egy reset a
  controller commitjait is elviszi (egyszer már megtörtént). Rossz commitot
  `git revert`-tel vagy új commit-tal javíts.

---

## Fájlszerkezet

**Új fájlok**

| Fájl | Felelősség |
|---|---|
| `public/js/ui/bodymap/paths.js` | Tiszta adat: a sziluett és a 9 izomcsoport SVG-geometriája nézetenként. Nincs benne DOM. |
| `public/js/ui/bodymap/paths.test.js` | A geometria ellenőrzése: minden izomcsoport elérhető, a koordináták a viewBoxon belül vannak. |
| `public/js/ui/bodymap/index.js` | A komponens: SVG kirajzolás, húzás, billentyűzet, nézetváltó, érték-sorok. |

**Jelentősen módosuló fájlok**

| Fájl | Mi történik vele |
|---|---|
| `public/style.css` | Új 2c. szakasz (primitívek) és 29. szakasz (testtérkép); a tokenek hangolása; oldalanként a kártyás szabályok hajszálvonalasra cserélése. |
| `public/index.html` | A Regeneráció oldal izomláz/fájdalom-blokkja térképre cserélve; a `tpl-ci-map` sablon egyszerűsítve; oldalanként a kártya-burkolók elhagyása. |
| `public/js/ui/checkin/steps/map.js` | Vékony burkoló lesz a közös komponens fölött. |
| `public/js/ui/checkin/constants.js` | `CI_BODY_REGIONS` törlődik; `CI_MAP_MODES.soreness` a 10-es skálára áll. |
| `public/js/ui/recovery.js` | A 9+9 skála helyett két testtérkép. |
| `server/server.js`, `server/recovery.js`, `server/db.js` | Az izomláz-skála 5 → 10. |

---

## Fázis 1 — dizájnrendszer

### Task 1: Tokenek a prototípus palettájára

**Files:**
- Modify: `public/style.css:33-206` (az 1. szakasz `:root` blokkja)

**Interfaces:**
- Produces: `--surface-panel`, `--hair`, `--hair-soft` CSS-tokenek; minden sugár-token `0px` értéken (kivéve `--r-full`). Minden későbbi task ezekre hivatkozik.

- [ ] **Step 1: A paletta-tokenek átírása**

A `:root` blokkban cseréld le ezeket az értékeket. A prototípus papírja melegebb és világosabb a mostaninál, a panel pedig sötétebb a lapnál — ez a kettő adja a dizájn alap-rétegződését.

```css
  --c-bg: #17181b;
  --c-bg-deep: #0a0a0b;
  --c-bg-raised: #1e1f23;
```

- [ ] **Step 2: A hajszálvonal- és panel-tokenek felvétele**

A `--c-superset` sor után szúrd be. A `--hair` a prototípus `hair`-je (.18), a `--hair-soft` a `hairSoft`-ja (.11) — ezekből él a teljes rács:

```css
  /* A dizájn két elválasztó-szintje. A rácsokat NEM border adja, hanem a
     szülő háttere, amit 1px-es gap enged át (lásd 2c. szakasz): így a
     vonalak sosem duplázódnak két szomszédos elem között. */
  --hair: rgba(255, 255, 255, .18);
  --hair-soft: rgba(255, 255, 255, .11);

  /* A lapnál sötétebb felület: oldalsáv, CTA-sáv, modál-lap. */
  --surface-panel: #0a0a0b;
```

- [ ] **Step 3: A szemantikus aliasok a hajszálvonalakhoz igazítása**

Cseréld le a meglévő sorokat:

```css
  --surface-soft: var(--hair-soft);
  --border-card: var(--hair);
```

`--surface-card`, `--surface-input`, `--surface-hover`, `--surface-strong` és `--border-strong` **változatlan** marad: azok nem elválasztók, hanem beviteli és hover-felületek.

- [ ] **Step 4: A sugarak nullázása**

Cseréld le a teljes „Lekerekítés" blokkot. A tokenek megmaradnak, hogy ne kelljen 8484 sorban `border-radius`-t vadászni, és hogy a döntés egy helyen visszafordítható legyen:

```css
  /* A dizájn szögletes: a formát a hajszálvonalak adják, nem a sarkok. A
     tokenek szándékosan megmaradnak 0-n — így egy helyen visszafordítható a
     döntés, és az új szabályoknak sem kell tudniuk, hogy épp nulla. */
  --r-2xs: 0;
  --r-xs: 0;
  --r-sm: 0;
  --r-md: 0;
  --r-lg: 0;
  --r-xl: 0;
  --r-2xl: 0;
  --r-3xl: 0;
  --r-full: 50%;
```

- [ ] **Step 5: A `--text-faint` kommentjének pontosítása**

A `--text-faint` értéke **nem változik** (.55, WCAG-hangolt). Írd fölé, hogy miért nem vesszük át a prototípus .34-ét:

```css
  /* A prototípus harmadlagos szintje (fehér .34) információt hordozó
     szövegre nem elég — a 10–11px-es feliratokon 3:1 alá esne. Ezért a
     .34 csak dekoratív elemre megy (pl. a % jel egy nagy szám mellett),
     saját szabályban; címke ide sosem kerül. */
```

- [ ] **Step 6: Ellenőrzés**

```bash
npm run format -- public/style.css
npm run format:check
npm test
```

Várt: a formázás átmegy, 317 teszt zöld (a CSS-t nem érinti teszt).

Indítsd el (`npm start`), és nyisd meg a `http://localhost:3000` címet. Az app **még vegyes lesz** — a kártyák elvesztették a lekerekítést, de még kártyák. Ez ebben a lépésben helyes. Amit ellenőrizz: nincs olvashatatlanná vált szöveg, és a lap háttere a melegebb `#17181b`.

- [ ] **Step 7: Commit**

```bash
git add public/style.css
git commit -m "Dizájn-tokenek: a prototípus palettája és a szögletes forma

A lap papírja melegebb lett (#17181b), a panel sötétebb nála (#0a0a0b),
és megjött a dizájn két elválasztó-szintje (--hair, --hair-soft). A
sugár-tokenek 0-ra mentek: a formát innentől a hajszálvonalak adják.

A --text-faint SZÁNDÉKOSAN maradt .55-ön: a prototípus .34-e a
10-11px-es feliratokon 3:1 alá esne.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: A dizájn primitívei

**Files:**
- Modify: `public/style.css` (új 2c. szakasz a 2b. után, a `.rc-score-num { … }` szabályt lezáró blokk és a `3. Akadálymentességi segédosztályok` fejléc közé, a jelenlegi 372. sor környékén)
- Modify: `public/style.css:1-31` (tartalomjegyzék)

**Interfaces:**
- Produces: `.ds-grid`, `.ds-section`, `.ds-eyebrow`, `.ds-display`, `.ds-row`, `.ds-row-main`, `.ds-row-name`, `.ds-row-sub`, `.ds-row-value`, `.ds-cta`, `.ds-cta-text`, `.ds-cta-sub`, `.ds-step`, `.ds-step-btn`, `.ds-seg`, `.ds-seg-btn` osztályok. Minden oldal-task ezeket használja.

- [ ] **Step 1: A tartalomjegyzék kiegészítése**

A `2b. Műszerfal-tipográfia` sor alá:

```
    2c. Dizájn-primitívek — a prototípus újrahasznált építőelemei (ds-*)
```

- [ ] **Step 2: A primitívek megírása**

Szúrd be a 2b. szakasz után:

```css
/* ==========================================================================
   2c. Dizájn-primitívek (ds-*)
   ==========================================================================
   A prototípus nem kártyákból áll, hanem vonalakból: a blokkokat felső
   hajszálvonal választja el, a rácsok réseit pedig a SZÜLŐ HÁTTERE tölti ki.
   Ez a trükk a lényeg — border helyett 1px-es gap egy vonalszínű szülőn:
   két szomszédos elem között így sosem lesz 2px-es dupla vonal, és a rács
   akkor is együtt marad, ha egy elem hiányzik.

   Ezek az osztályok SZÁNDÉKOSAN prefixeltek (ds-), nem oldal-specifikusak:
   ugyanaz a sor-elem áll a Regeneráció számítás-listájában és a Profil
   adatsoraiban. Ha egy oldalnak egyedi viselkedés kell, a saját előtagú
   osztálya MELLÉ kerül, nem helyette.
   ========================================================================== */

/* Hajszálvonalas rács. A gyerekeknek nincs saját keretük — a rés a vonal. */
.ds-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  background: var(--hair);
}

.ds-grid--column {
  flex-direction: column;
  flex-wrap: nowrap;
}

/* Szekció: nincs háttér, nincs keret, csak felső elválasztó.

   A vonalat SZÁNDÉKOSAN a szomszéd-szelektor adja, nem egy
   `:first-child` kivétel: az csak akkor működne, ha a szekciók a szülő
   EGYETLEN gyerekei — egy cím vagy egy üres-állapot a lista elején már
   megtörné, és az első szekció fölött ott maradna a felesleges vonal. */
.ds-section {
  padding-top: var(--sp-11);
}

.ds-section + .ds-section {
  border-top: 1px solid var(--hair);
  margin-top: var(--sp-11);
}

/* Felkiáltó: a szekciók és a lapok fölötti mono címke. */
.ds-eyebrow {
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  font-weight: 700;
  line-height: 1;
  letter-spacing: var(--ls-label);
  text-transform: uppercase;
  color: var(--text-muted);
}

/* Display-szám. A méretet a hívó oldal adja (--ds-display-size), mert a
   lépcső oldalanként más: 96px az áttekintés hőse, 32px egy oldalcím. */
.ds-display {
  font-size: var(--ds-display-size, var(--fs-5xl));
  font-weight: 800;
  line-height: 1;
  letter-spacing: -.045em;
  font-variant-numeric: tabular-nums;
}

/* Sor-elem: balra név + halvány alcím, jobbra érték vagy vezérlő. Ez váltja
   ki a korábbi kártyákat a listás oldalakon. */
.ds-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-7);
  min-height: var(--tap-min);
  padding: var(--sp-7) 0;
}

/* Az elválasztó a sorok KÖZÉ kerül, szomszéd-szelektorral. A `:first-of-type`
   kivétel itt csapda volna: az a saját TAG-jéből elsőt találja meg, nem a
   `.ds-row`-k közül az elsőt — egy szűrősáv vagy üres-állapot ugyanabból a
   tagből a lista elején néma módon visszahozná a felső vonalat. */
.ds-row + .ds-row {
  border-top: 1px solid var(--hair-soft);
}

.ds-row-main {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-width: 0;
}

.ds-row-name {
  font-size: var(--fs-xl);
  font-weight: 700;
  letter-spacing: -.01em;
}

.ds-row-sub {
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: var(--ls-label-tight);
  text-transform: uppercase;
  color: var(--text-muted);
}

.ds-row-value {
  flex-shrink: 0;
  font-size: var(--fs-4xl);
  font-weight: 800;
  letter-spacing: -.02em;
  font-variant-numeric: tabular-nums;
}

.ds-row-value--accent {
  color: var(--c-accent);
}

/* CTA-sáv: a lap fő művelete. Teljes szélességű, nagybetűs, jobbra nyíllal.
   Keskeny nézetben accent hátterű (a hüvelykujj alatt ez az egyetlen
   művelet), széles nézetben panel hátterű, és hoveren vált accentre. */
.ds-cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-7);
  width: 100%;
  min-height: 64px;
  padding: var(--sp-9) var(--sp-11);
  border: 0;
  background: var(--c-accent);
  color: var(--on-accent);
  font-family: var(--font-base);
  font-size: var(--fs-base);
  font-weight: 800;
  letter-spacing: .02em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
  transition: background var(--t-fast), opacity var(--t-fast);
}

.ds-cta:hover {
  opacity: .9;
}

/* Széles nézetben a CTA nem a hüvelykujj alatti egyetlen művelet, hanem egy
   a lap elemei közül — ezért ott a panel-felületet viseli, és csak hoverre
   vált accentre. A töréspont az app meglévő 1025px-e, nem a prototípus
   1120px-e. A variáns SZÁNDÉKOSAN itt van, nem az oldalakon: különben
   tizenegy helyen ismétlődne ugyanaz a media query. */
@media (min-width: 1025px) {
  .ds-cta {
    background: var(--surface-panel);
    border: 1px solid var(--hair);
    color: var(--text-primary);
  }

  .ds-cta:hover {
    background: var(--c-accent);
    border-color: var(--c-accent);
    color: var(--on-accent);
    opacity: 1;
  }
}

.ds-cta-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-2);
  min-width: 0;
}

.ds-cta-sub {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: var(--ls-label-tight);
  opacity: .72;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Léptető: −/+ egy soron belül. A 44px a --tap-min, nem véletlen szám. */
.ds-step {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 1px;
  background: var(--hair);
}

.ds-step-btn {
  width: var(--tap-min);
  height: var(--tap-min);
  border: 0;
  background: var(--c-bg);
  color: var(--text-primary);
  font-size: var(--fs-3xl);
  font-weight: 800;
  cursor: pointer;
  transition: background var(--t-fast);
}

.ds-step-btn:hover {
  background: var(--surface-hover);
}

.ds-step-value {
  min-width: 88px;
  padding: 0 var(--sp-5);
  background: var(--c-bg);
  font-size: var(--fs-2xl);
  font-weight: 800;
  line-height: var(--tap-min);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* Szegmens-választó: összeérő gombok, az aktív accent hátterű. */
.ds-seg {
  display: flex;
  gap: 1px;
  background: var(--hair);
}

.ds-seg-btn {
  flex: 1;
  min-height: var(--tap-min);
  padding: 0 var(--sp-5);
  border: 0;
  background: var(--c-bg);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  font-weight: 700;
  letter-spacing: var(--ls-label-tight);
  text-transform: uppercase;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.ds-seg-btn[aria-pressed="true"] {
  background: var(--c-accent);
  color: var(--on-accent);
}
```

- [ ] **Step 3: Ellenőrzés**

```bash
npm run format -- public/style.css
npm run format:check
```

A primitíveket még semmi nem használja — ez a lépés csak azt bizonyítja, hogy a CSS érvényes és formázott. Nyisd meg az appot (`npm start`): **semminek nem szabad megváltoznia** az 1. taskhoz képest.

- [ ] **Step 4: Commit**

```bash
git add public/style.css
git commit -m "Dizájn-primitívek: hajszálvonalas rács, sor-elem, CTA-sáv

A prototípus nem kártyákból áll, hanem vonalakból. A rácsok réseit a
szülő háttere tölti ki (1px gap vonalszínű szülőn) border helyett —
így két szomszédos elem között sosem lesz dupla vonal.

Nyolc primitív: rács, szekció, felkiáltó, display-szám, sor-elem,
CTA-sáv, léptető, szegmens-választó. Használó még nincs; a következő
taskok ezekre állnak át.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Fázis 2 — a testtérkép és az izomláz-skála

### Task 3: Az izomláz skálája 1–10

**Files:**
- Modify: `server/server.js:1389`
- Modify: `server/recovery.js:452`
- Modify: `server/db.js:270` (csak komment)
- Modify: `public/js/ui/checkin/constants.js` (`CI_MAP_MODES.soreness`)
- Modify: `public/js/ui/recovery.js:62`
- Modify: `public/js/render/recovery.js:185`
- Test: `server/recovery.test.js`

**Interfaces:**
- Produces: az izomláz mindenhol 0–10 tartományú. A `CI_MAP_MODES.soreness.max === 10` és `.defaultValue === 5` — a testtérkép-komponens (Task 5) ezeket olvassa.

- [ ] **Step 1: Írd meg a bukó tesztet**

A `server/recovery.test.js` végére. Ez a teszt azt rögzíti, hogy a maximális bejelentett izomláz nullára viszi a szubjektív komponenst — a régi skálán az 5 volt a maximum, az újon a 10:

```js
test('a 10-es izomláz nullázza a szubjektív komponenst (1–10-es skála)', () => {
  const report = buildReport(restedLogger({
    checkins: [fullCheckin({ soreness: { chest: 10 } })],
  }));
  const chest = report.muscles.find((m) => m.key === 'chest');
  assert.equal(chest.readiness, 0);
});

test('a régi skála maximuma (5) már csak félúton van', () => {
  const report = buildReport(restedLogger({
    checkins: [fullCheckin({ soreness: { chest: 5 } })],
  }));
  const chest = report.muscles.find((m) => m.key === 'chest');
  assert.equal(chest.readiness, 50);
});
```

> A `restedLogger`, `fullCheckin` és `buildReport` segédek már léteznek a fájlban — nézd meg a 330–365. sorok környékén, hogyan hívja őket a meglévő `soreness: { chest: 5 }` teszt, és kövesd azt a mintát. Ha a `buildReport` neve a fájlban más, használd az ottanit.

- [ ] **Step 2: Futtasd, hogy lásd a bukást**

```bash
npm test 2>&1 | grep -A5 "izomláz nullázza"
```

Várt: FAIL. A 10-es érték a `clamp01(10 / 5)` miatt ugyanúgy 0-t ad, mint az 5 — tehát az **első** teszt véletlenül átmegy, a **második** (az 5 → 50) bukik, mert ma 0-t ad. Ez a bukás a bizonyíték, hogy a skála tényleg 5-ös.

- [ ] **Step 3: A szerver átállítása**

`server/recovery.js:452` — az osztó és a fölötte lévő komment:

```js
    /* Szubjektív izomláz (0–10) bekeverése, ha a check-inben megadta.
```

```js
    const subjective = reportedSoreness === null
      ? null
      : (1 - clamp01(reportedSoreness / 10)) * 100;
```

`server/server.js:1389`:

```js
  fields.soreness = normalizeMuscleMap(body.soreness, 10);
```

`server/db.js:270` — csak a séma-komment:

```js
    soreness      TEXT NOT NULL DEFAULT '{}',  -- JSON: { chest: 0..10, … } izomcsoportonként
```

- [ ] **Step 4: Futtasd a teszteket**

```bash
npm test 2>&1 | tail -8
```

Várt: az új tesztek zöldek. Ha egy régi teszt bukik, mert `soreness: { quads: 5 }`-tel „erős izomlázat" akart kifejezni, írd át **10**-re — a szándéka a maximum volt, nem az 5-ös szám.

- [ ] **Step 5: A kliens átállítása**

`public/js/ui/checkin/constants.js`, a `CI_MAP_MODES.soreness` blokk:

```js
  soreness: {
    field: 'soreness', max: 10, defaultValue: 5, noun: 'izomláz',
    eyebrow: 'Részletes kitöltés', title: 'Hol van izomlázad?',
    sub: 'Koppints egy izomra, majd csúsztasd fel/le az erősséghez. Amit kihagysz, az 0 marad.',
    legend: '1 = alig érezhető · 10 = nagyon erős izomláz.',
  },
```

`public/js/ui/recovery.js:62`:

```js
    sorenessWrap.appendChild(buildScale({ name: `soreness.${key}`, label, min: 0, max: 10 }));
```

`public/js/render/recovery.js:185`:

```js
    if (muscle.soreness !== null) meta.push(`izomláz ${muscle.soreness}/10`);
```

- [ ] **Step 6: Az `index.html` súgószövege**

A Regeneráció oldalon, a 936. sor környékén:

```html
              <p class="rc-hint">Az izomcsoportonkénti izomláz (0 = semmi, 10 = nagyon erős) pontosítja
                a csoportonkénti becslést. Amit kihagysz, annak a súlya újraoszlik.</p>
```

- [ ] **Step 7: Teljes ellenőrzés**

```bash
npm test && npm run lint && npm run format:check
```

Indítsd el (`npm start`), töltsd ki a check-int, és a térkép alatti chip-sorban ellenőrizd, hogy **10 chip** jelenik meg izomláznál (nem 5).

- [ ] **Step 8: Commit**

```bash
git add server public/js public/index.html
git commit -m "Az izomláz skálája 1–10, a fájdaloméval azonos

Két különböző felbontású skála volt egy űrlapon (izomláz 1–5, fájdalom
1–10) — a felhasználónak fejben kellett váltania köztük. Mostantól
mindkettő 1–10.

A motorban ez az osztó cseréje (reportedSoreness / 5 → / 10); a régi,
0–5-ös értékek enyhébbnek olvasódnak az új skálán. Ezt tudatosan
vállaljuk: a fittrack.db eldobható demóadat.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: A testtérkép geometriája

**Files:**
- Create: `public/js/ui/bodymap/paths.js`
- Create: `public/js/ui/bodymap/paths.test.js`
- Modify: `package.json` (a `test` script glob-ja)

**Interfaces:**
- Produces:
  - `BODY_VIEW_BOX` — `{ width: 220, height: 460 }`
  - `BODY_HEAD` — `{ cx: 110, cy: 32, r: 21 }`
  - `BODY_SILHOUETTE` — `{ front: string[], back: string[] }`, nyitott path-ok `d` értékei, **csak a bal félre** megrajzolva
  - `BODY_REGIONS` — `{ front: Region[], back: Region[] }`, ahol
    `Region = { key: string, d: string, labelX: number, labelY: number, mirrored: boolean }`
  - A `mirrored: true` régiók a bal félen vannak megrajzolva, és a komponens tükrözi őket; a `mirrored: false` régiók középen ülnek, azokat nem szabad tükrözni.

- [ ] **Step 1: A tesztfuttatás kiterjesztése a frontendre**

A `package.json`-ban a `test` script ma csak a szervert nézi. A testtérkép geometriája tiszta adat, DOM nélkül importálható — érdemes tesztelni:

```json
    "test": "node --test \"server/**/*.test.js\" \"public/**/*.test.js\"",
```

- [ ] **Step 2: Írd meg a bukó tesztet**

`public/js/ui/bodymap/paths.test.js`:

```js
/** A testtérkép geometriájának ellenőrzése. A rajz kézzel készült — ezek a
    tesztek nem a szépségét őrzik, hanem azt, hogy minden izomcsoport
    elérhető marad, és egyetlen régió se csússzon ki a rajzterületről. */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MUSCLE_KEYS } from '../../../../server/muscles.js';
import { BODY_HEAD, BODY_REGIONS, BODY_SILHOUETTE, BODY_VIEW_BOX } from './paths.js';

const VIEWS = ['front', 'back'];

test('a két nézet uniója pontosan a kilenc izomcsoport', () => {
  const seen = new Set(VIEWS.flatMap((v) => BODY_REGIONS[v].map((r) => r.key)));
  assert.deepEqual([...seen].sort(), [...MUSCLE_KEYS].sort());
});

test('egy izomcsoport nézetenként legfeljebb egyszer szerepel', () => {
  for (const view of VIEWS) {
    const keys = BODY_REGIONS[view].map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length, `${view}: ismétlődő kulcs`);
  }
});

test('minden régiónak van rajza és felirat-helye a rajzterületen belül', () => {
  for (const view of VIEWS) {
    for (const region of BODY_REGIONS[view]) {
      assert.match(region.d, /^M[\s\d]/, `${view}/${region.key}: üres vagy hibás path`);
      assert.ok(region.labelX > 0 && region.labelX < BODY_VIEW_BOX.width,
        `${view}/${region.key}: a felirat x-e kilóg`);
      assert.ok(region.labelY > 0 && region.labelY < BODY_VIEW_BOX.height,
        `${view}/${region.key}: a felirat y-a kilóg`);
    }
  }
});

test('a tükrözött régiók a bal félen vannak megrajzolva', () => {
  // Ha egy tükrözendő régió átlógna a középvonalon, a tükörképe rálapolna
  // az eredetire — két találati felület egy helyen, ami némán elnyelné a
  // koppintást.
  const half = BODY_VIEW_BOX.width / 2;
  for (const view of VIEWS) {
    for (const region of BODY_REGIONS[view].filter((r) => r.mirrored)) {
      assert.ok(region.labelX < half, `${view}/${region.key}: nem a bal félen van`);
    }
  }
});

/** Egy `d` attribútum összes x-koordinátája. A path-ok csak M/L/C/Z
    parancsokat használnak, és azok mind koordináta-PÁROKAT várnak — így a
    számsor páros indexei pontosan az x értékek. */
const xsOf = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0);

test('a tükrözött régiók RAJZA is a bal félen van, nem csak a feliratuk', () => {
  // A felirat helyét külön teszt őrzi. Ez a rajzot nézi: ha egy oldalsó
  // régió path-ja átlógna a középvonalon, a tükörképe rálapolna az
  // eredetire — két találati felület egy helyen, ami némán elnyeli a
  // koppintást. A feliratra szűkített ellenőrzés ezt nem venné észre.
  const half = BODY_VIEW_BOX.width / 2;
  for (const view of VIEWS) {
    for (const region of BODY_REGIONS[view].filter((r) => r.mirrored)) {
      const maxX = Math.max(...xsOf(region.d));
      assert.ok(maxX <= half,
        `${view}/${region.key}: a rajz átlóg a középvonalon (max x = ${maxX})`);
    }
  }
});

/** Melyik izomcsoportot kell tükrözni, és melyiket tilos. Egyik irányban sem
    bukik ki magától a hiba: a középen ülőt tükrözve két találati felület
    kerül egymásra, az oldalsót NEM tükrözve pedig a figurának hiányzik a fél
    végtagja. Ezért itt ki van írva, nem a `paths.js`-ből olvassuk vissza. */
const MIRRORING = {
  shoulders: true, arms: true, quads: true, hamstrings: true, calves: true,
  chest: false, core: false, back: false, glutes: false,
};

test('minden izomcsoport a hozzá tartozó tükrözési móddal szerepel', () => {
  for (const view of VIEWS) {
    for (const region of BODY_REGIONS[view]) {
      assert.equal(region.mirrored, MIRRORING[region.key],
        `${view}/${region.key}: rossz tükrözési mód`);
    }
  }
});

test('a nem tükrözött régiók átérnek a középvonalon', () => {
  // A középen ülő csoportok teljes alakzatok, nem félpárok — ha valamelyik
  // véletlenül csak a bal felére készülne, tükrözés híján fél mellizom
  // maradna a lapon.
  const half = BODY_VIEW_BOX.width / 2;
  for (const view of VIEWS) {
    for (const region of BODY_REGIONS[view].filter((r) => !r.mirrored)) {
      const xs = xsOf(region.d);
      assert.ok(Math.min(...xs) < half && Math.max(...xs) > half,
        `${view}/${region.key}: a középen ülő régió nem éri át a középvonalat`);
    }
  }
});

test('a sziluett mindkét nézethez ad rajzot', () => {
  for (const view of VIEWS) {
    assert.ok(BODY_SILHOUETTE[view].length > 0, `${view}: nincs sziluett`);
  }
  assert.ok(BODY_HEAD.r > 0);
});
```

- [ ] **Step 3: Futtasd, hogy lásd a bukást**

```bash
npm test 2>&1 | grep -i "bodymap\|Cannot find"
```

Várt: FAIL — `Cannot find module … paths.js`.

- [ ] **Step 4: Írd meg a geometriát**

`public/js/ui/bodymap/paths.js`. A szimmetria **transzformációval** készül, nem duplikált koordinátákkal: csak a bal fél van megrajzolva, a komponens tükrözi. Így a figura garantáltan szimmetrikus, és feleannyi koordinátát kell karbantartani.

```js
/**
 * A testtérkép geometriája — tiszta adat, DOM nélkül.
 *
 * A rajzterület 220×460. MINDEN oldalfüggő alakzat CSAK a bal félre van
 * megrajzolva (x < 110), a jobb felet a komponens tükrözi
 * (`translate(220,0) scale(-1,1)`). Ez nem takarékosság: kézzel rajzolt
 * koordinátákkal a két fél előbb-utóbb elcsúszna egymástól, a tükrözés
 * viszont nem tud aszimmetrikus lenni.
 *
 * A középen ülő izomcsoportok (mell, törzs, hát, farizom) `mirrored: false`
 * jelöléssel jönnek — azokat tükrözni pont a hibát okozná, amit el akarunk
 * kerülni: két találati felület egymáson.
 *
 * A sziluett path-jai NYITOTTAK, és a középvonalon érnek véget. A tükörkép
 * zárja őket teljes alakká — így nincs látható varrat a figura közepén.
 */

export const BODY_VIEW_BOX = { width: 220, height: 460 };

export const BODY_HEAD = { cx: 110, cy: 32, r: 21 };

/** Törzs + láb külső kontúrja, majd a kar kontúrja. Bal fél, nyitott. */
const TORSO_LEFT = 'M 110 52 L 99 55 L 97 64 C 86 68 76 74 70 84 '
  + 'C 66 92 65 100 68 106 L 78 100 C 80 116 79 132 82 148 '
  + 'C 84 158 82 168 84 178 C 80 188 78 198 80 208 L 110 216';

const LEGS_LEFT = 'M 80 208 C 76 240 78 262 82 288 C 80 300 78 316 82 336 '
  + 'C 85 356 88 372 90 392 L 86 404 L 104 406 L 102 392 '
  + 'C 104 366 106 348 104 330 C 102 306 104 296 103 288 '
  + 'C 106 260 108 236 110 216';

const ARM_LEFT = 'M 70 84 C 60 92 55 106 53 122 C 51 140 50 156 49 172 '
  + 'C 47 190 45 202 44 214 C 42 224 44 232 50 232 '
  + 'C 56 230 58 222 57 212 C 59 196 61 182 63 170 '
  + 'C 65 152 67 134 69 116 C 71 104 72 94 70 84';

const HALF_BODY = [TORSO_LEFT, LEGS_LEFT, ARM_LEFT];

export const BODY_SILHOUETTE = { front: HALF_BODY, back: HALF_BODY };

/* A két nézetben azonos régiók. A váll, a kar és a vádli elölről és
   hátulról is ugyanott van — nincs okunk kétszer megrajzolni. */

const SHOULDER = {
  key: 'shoulders', mirrored: true, labelX: 66, labelY: 96,
  d: 'M 68 78 C 60 84 56 96 58 108 C 66 112 74 108 77 100 C 76 90 73 82 68 78 Z',
};

const ARM = {
  key: 'arms', mirrored: true, labelX: 55, labelY: 160,
  d: 'M 56 112 C 50 128 49 152 48 172 C 47 190 45 204 45 214 '
    + 'C 52 218 58 214 58 206 C 60 188 62 168 64 150 '
    + 'C 66 134 68 122 68 114 C 64 110 59 110 56 112 Z',
};

const CALF = {
  key: 'calves', mirrored: true, labelX: 92, labelY: 330,
  d: 'M 82 300 C 78 318 79 340 84 360 C 90 364 97 362 100 356 '
    + 'C 103 336 104 316 103 300 C 96 296 88 296 82 300 Z',
};

export const BODY_REGIONS = {
  front: [
    SHOULDER,
    {
      key: 'chest', mirrored: false, labelX: 110, labelY: 102,
      d: 'M 86 84 C 96 78 124 78 134 84 C 137 98 134 112 128 118 '
        + 'C 116 122 104 122 92 118 C 86 112 83 98 86 84 Z',
    },
    ARM,
    {
      key: 'core', mirrored: false, labelX: 110, labelY: 154,
      d: 'M 92 122 C 104 118 116 118 128 122 C 130 140 128 164 124 186 '
        + 'C 114 192 106 192 96 186 C 92 164 90 140 92 122 Z',
    },
    {
      key: 'quads', mirrored: true, labelX: 92, labelY: 250,
      d: 'M 82 214 C 76 240 77 264 82 288 C 90 292 98 290 101 284 '
        + 'C 103 258 105 234 106 216 C 98 212 89 212 82 214 Z',
    },
    CALF,
  ],
  back: [
    SHOULDER,
    {
      key: 'back', mirrored: false, labelX: 110, labelY: 114,
      d: 'M 84 82 C 96 76 124 76 136 82 C 139 104 136 130 130 148 '
        + 'C 116 154 104 154 90 148 C 84 130 81 104 84 82 Z',
    },
    ARM,
    {
      key: 'glutes', mirrored: false, labelX: 110, labelY: 178,
      d: 'M 88 158 C 100 152 120 152 132 158 C 136 172 134 190 128 200 '
        + 'C 116 206 104 206 92 200 C 86 190 84 172 88 158 Z',
    },
    {
      key: 'hamstrings', mirrored: true, labelX: 93, labelY: 245,
      d: 'M 84 206 C 78 232 79 258 84 284 C 92 288 99 286 102 280 '
        + 'C 104 256 106 232 107 208 C 99 204 90 204 84 206 Z',
    },
    CALF,
  ],
};
```

- [ ] **Step 5: Futtasd a teszteket**

```bash
npm test 2>&1 | tail -8
```

Várt: mind zöld. Az összes szerver-teszt is fut még (a glob most két mintát kap).

- [ ] **Step 6: Nézd meg a rajzot**

Ez a lépés **nem elhagyható**: a koordináták kézzel készültek, és papíron nem derül ki, hogy a figura felismerhető-e. Mentsd ki egy ideiglenes fájlba és nyisd meg böngészőben:

```bash
node --input-type=module -e "
import { BODY_HEAD as h, BODY_REGIONS as r, BODY_SILHOUETTE as s } from './public/js/ui/bodymap/paths.js';
const g = (v) => \`<svg viewBox='0 0 220 460' width='260' style='background:#17181b'>
<g fill='none' stroke='rgba(255,255,255,.5)' stroke-width='1.25'>
<circle cx='\${h.cx}' cy='\${h.cy}' r='\${h.r}'/>
\${s[v].map(d=>\`<path d='\${d}'/>\`).join('')}
<g transform='translate(220,0) scale(-1,1)'>\${s[v].map(d=>\`<path d='\${d}'/>\`).join('')}</g>
</g>
<g fill='rgba(200,16,46,.25)' stroke='#c8102e'>
\${r[v].map(x=>\`<path d='\${x.d}'/>\`).join('')}
<g transform='translate(220,0) scale(-1,1)'>\${r[v].filter(x=>x.mirrored).map(x=>\`<path d='\${x.d}'/>\`).join('')}</g>
</g></svg>\`;
console.log('<body style=\"background:#17181b\">' + g('front') + g('back'));
" > "${TMPDIR:-/tmp}/bodymap-preview.html" && echo "kész: ${TMPDIR:-/tmp}/bodymap-preview.html"
```

(A fájl szándékosan a repón kívülre megy — előnézet, nem szállítandó.)

**Elfogadási feltétel:** a két ábra felismerhető emberi alak (fej, váll, két kar, törzs, két láb), a régiók nem lógnak ki a sziluettből, és nem fedik egymást. Ha nem az — igazítsd a koordinátákat, és futtasd újra. A tesztek végig zöldek maradnak, azok nem az arányokat őrzik.

- [ ] **Step 7: Commit**

```bash
git add public/js/ui/bodymap/paths.js public/js/ui/bodymap/paths.test.js package.json
git commit -m "A testtérkép geometriája: sziluett és kilenc izomcsoport

A régi térkép pozicionált téglalapokból állt. Ez SVG-rajz: nyitott
sziluett-path-ok és izomcsoport-alakzatok, 220x460-as rajzterületen.

A szimmetria TRANSZFORMÁCIÓVAL készül, nem duplikált koordinátákkal:
csak a bal fél van megrajzolva. Kézzel rajzolt koordinátákkal a két fél
előbb-utóbb elcsúszna, tükrözés viszont nem tud aszimmetrikus lenni. A
középen ülő csoportokat (mell, törzs, hát, farizom) mirrored:false
jelöli — azokat tükrözni két találati felületet tenne egymásra.

A tesztfuttatás kiterjed a public/-ra is: a geometria tiszta adat, DOM
nélkül importálható, és megéri őrizni, hogy mind a kilenc izomcsoport
elérhető marad.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: A testtérkép-komponens

**Files:**
- Create: `public/js/ui/bodymap/index.js`
- Modify: `public/style.css` (új 29. szakasz a fájl végén + tartalomjegyzék)

**Interfaces:**
- Consumes: `BODY_HEAD`, `BODY_REGIONS`, `BODY_SILHOUETTE`, `BODY_VIEW_BOX` a `./paths.js`-ből. **Semmi mást** — a komponens nem importál sem a `checkin/`, sem a `render/` alól.
- Produces:
  ```js
  createBodyMap({ max, defaultValue, noun, values, muscleLabel,
                  blockFrom = null, extraRows = [], onChange })
  // → { el: HTMLElement, refresh(): void }
  ```

  > A Task 5 reviewe után az alábbi kódblokk három ponton módosult (fókusz
  > visszaállítása a chip-sorok újraépítése után, az extra sorok értékének
  > visszavonhatósága, és az Enter/Space kezelése a térkép-régiókon). A
  > végleges változat a `public/js/ui/bodymap/index.js`-ben van; az itteni
  > blokk a kiinduló állapotot rögzíti.
  - `values`: **élő objektum**, amit a komponens helyben módosít (`values[key] = 3`, `delete values[key]`). Ugyanaz a minta, mint a mai `ci.answers[field]`.
  - `muscleLabel(key) → string`: az izomcsoport magyar címkéje. **Paraméter, nem import** — így a komponens nem függ sem a varázslótól, sem a render-rétegtől; a hívók a meglévő `ciMuscleLabel`-t adják át.
  - `blockFrom`: ettől az értéktől jelenik meg a „letiltva" jelzés a soron. A fájdalom-térképnél `CI_PAIN_BLOCK`, izomláznál `null`. **Így a 7-es határ egyetlen helyen él** — a komponensben nincs saját másolata.
  - `extraRows`: `[{ key: 'general', label: 'Általános fájdalom' }]` — régióhoz nem köthető sorok a térkép alatt.
  - `onChange()`: minden érték-változás után lefut, ha megadták (a hívó ezzel jelöli pl. a `ci.dirty`-t).
  - `refresh()`: kívülről betöltött értékek után újrarajzolja a régiókat és a sorokat.

- [ ] **Step 1: A komponens megírása**

`public/js/ui/bodymap/index.js`:

```js
/**
 * Testtérkép — izomláz és fájdalom megjelölése egy emberalakon.
 *
 * Két hívója van: a napi check-in varázsló térkép-lépése és a Regeneráció
 * oldal részletes űrlapja. Azért közös komponens, mert a kettőnek ugyanaz a
 * viselkedése kell — és ebből a viselkedésből három dolog az, ami újraírásnál
 * csendben el szokott tűnni:
 *
 *   1. Húzás közben CSAK az érintett régió festődik újra. A teljes újrarajzolás
 *      megölné a pointer capture-t, és a húzás némán megszakadna.
 *   2. A térképen húzni kell — ezért a térkép alatti chip-sorok NEM kijelzők,
 *      hanem egyenértékű, billentyűzetről is járható út. Minden chip 44px.
 *   3. A tükör-párból csak az egyik van a fókusz-sorrendben: egy izomcsoport
 *      egy vezérlő, akkor is, ha két alakzat rajzolja.
 */

import { $$ } from '../../core/dom.js';
import { BODY_HEAD, BODY_REGIONS, BODY_SILHOUETTE, BODY_VIEW_BOX } from './paths.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Hány képernyő-pixel egy értéklépés húzáskor. */
const DRAG_PX_PER_STEP = 14;

const svgEl = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function createBodyMap({
  max, defaultValue, noun, values, muscleLabel,
  blockFrom = null, extraRows = [], onChange,
}) {
  let view = 'front';

  const el = document.createElement('div');
  el.className = 'bm';

  // — Nézetváltó —
  const toggle = document.createElement('div');
  toggle.className = 'ds-seg bm-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Testnézet');
  for (const [key, label] of [['front', 'Elöl'], ['back', 'Hátul']]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ds-seg-btn';
    btn.dataset.view = key;
    btn.textContent = label;
    btn.addEventListener('click', () => setView(key));
    toggle.appendChild(btn);
  }
  el.appendChild(toggle);

  const stage = document.createElement('div');
  stage.className = 'bm-stage';
  el.appendChild(stage);

  const rows = document.createElement('div');
  rows.className = 'bm-rows';
  el.appendChild(rows);

  /** Egy izomcsoport minden látható alakzatának frissítése. Húzás közben
      CSAK ez fut (lásd a fájl fejlécének 1. pontját). */
  function paintRegion(key) {
    const value = values[key];
    const on = value > 0;
    $$(`[data-region="${key}"]`, stage).forEach((node) => {
      node.setAttribute('aria-pressed', String(on));
      node.setAttribute('aria-label', on
        ? `${muscleLabel(key)} — ${noun} ${value} / ${max}`
        : `${muscleLabel(key)} — nincs megjelölve`);
    });
    $$(`[data-region-label="${key}"]`, stage).forEach((node) => {
      node.textContent = on ? String(value) : '';
    });
  }

  function setValue(key, value) {
    values[key] = clamp(value, 1, max);
    paintRegion(key);
    renderRows();
    onChange?.();
  }

  function clearValue(key) {
    delete values[key];
    paintRegion(key);
    renderRows();
    onChange?.();
  }

  /** Pointer-húzás: lenyomásra kijelöl az alapértékkel, függőleges mozgásra
      léptet, elmozdulás nélküli felengedés egy MÁR kijelölt régión töröl. */
  function bindRegion(node, key) {
    let pointerId = null;
    let startY = 0;
    let startValue = 0;
    let wasSelected = false;
    let moved = false;

    node.addEventListener('pointerdown', (event) => {
      if (pointerId !== null) return;
      pointerId = event.pointerId;
      wasSelected = values[key] > 0;
      startValue = wasSelected ? values[key] : defaultValue;
      startY = event.clientY;
      moved = false;
      try { node.setPointerCapture(pointerId); } catch { /* nem kritikus */ }
      setValue(key, startValue);
      event.preventDefault();
    });

    node.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      const delta = Math.round((startY - event.clientY) / DRAG_PX_PER_STEP);
      if (delta !== 0) moved = true;
      setValue(key, startValue + delta);
    });

    const end = (event) => {
      if (event.pointerId !== pointerId) return;
      try { node.releasePointerCapture(pointerId); } catch { /* már elengedve */ }
      pointerId = null;
      if (!moved && wasSelected) clearValue(key);
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);

    // A húzás billentyűzetes tükre. Enélkül a lépés pointer nélkül
    // teljesíthetetlen lenne.
    node.addEventListener('keydown', (event) => {
      const current = values[key] ?? 0;
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        event.preventDefault();
        setValue(key, current ? current + 1 : defaultValue);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        event.preventDefault();
        if (current <= 1) clearValue(key); else setValue(key, current - 1);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        clearValue(key);
      }
    });
    node.addEventListener('click', (event) => {
      // Billentyűs aktiválás: a pointerdown-ág nem futott le.
      if (event.detail !== 0) return;
      if (values[key] > 0) clearValue(key); else setValue(key, defaultValue);
    });
  }

  const MIRROR = `translate(${BODY_VIEW_BOX.width},0) scale(-1,1)`;

  function renderStage() {
    const svg = svgEl('svg', {
      viewBox: `0 0 ${BODY_VIEW_BOX.width} ${BODY_VIEW_BOX.height}`,
      class: 'bm-svg',
    });

    // — Sziluett: bal fél + tükörképe, plusz a fej —
    for (const transform of ['', MIRROR]) {
      const group = svgEl('g', { class: 'bm-silhouette' });
      if (transform) group.setAttribute('transform', transform);
      for (const d of BODY_SILHOUETTE[view]) group.appendChild(svgEl('path', { d }));
      svg.appendChild(group);
    }
    svg.appendChild(svgEl('circle', {
      class: 'bm-silhouette-head', cx: BODY_HEAD.cx, cy: BODY_HEAD.cy, r: BODY_HEAD.r,
    }));

    // — Régiók. A tükörképek aria-hidden-ek: egy izomcsoport egy vezérlő. —
    const regions = BODY_REGIONS[view];
    const addRegion = (region, mirrored) => {
      const node = svgEl('path', { class: 'bm-region', d: region.d, role: 'button' });
      node.dataset.region = region.key;
      if (mirrored) {
        node.setAttribute('aria-hidden', 'true');
      } else {
        node.setAttribute('tabindex', '0');
      }
      bindRegion(node, region.key);
      return node;
    };

    const plain = svgEl('g', { class: 'bm-regions' });
    for (const region of regions) plain.appendChild(addRegion(region, false));
    svg.appendChild(plain);

    const mirror = svgEl('g', { class: 'bm-regions', transform: MIRROR });
    for (const region of regions.filter((r) => r.mirrored)) {
      mirror.appendChild(addRegion(region, true));
    }
    svg.appendChild(mirror);

    // — Feliratok. Külön, NEM tükrözött rétegben: a tükrözött csoportban a
    //   szám tükörírással jelenne meg. —
    const labels = svgEl('g', { class: 'bm-labels', 'aria-hidden': 'true' });
    for (const region of regions) {
      const positions = region.mirrored
        ? [region.labelX, BODY_VIEW_BOX.width - region.labelX]
        : [region.labelX];
      for (const x of positions) {
        const text = svgEl('text', { x, y: region.labelY, 'text-anchor': 'middle' });
        text.dataset.regionLabel = region.key;
        labels.appendChild(text);
      }
    }
    svg.appendChild(labels);

    stage.replaceChildren(svg);
    for (const region of regions) paintRegion(region.key);
  }

  /** A térkép alatti pontos-érték sorok. Ezek a KANONIKUS vezérlők. */
  function renderRows() {
    const marked = Object.keys(values).filter((key) => values[key] > 0
      && !extraRows.some((row) => row.key === key));
    const entries = [
      ...marked.map((key) => ({ key, label: muscleLabel(key), removable: true })),
      ...extraRows.map((row) => ({ ...row, removable: false })),
    ];

    rows.replaceChildren(...entries.map(({ key, label, removable }) => {
      const row = document.createElement('div');
      row.className = 'bm-row';

      const name = document.createElement('span');
      name.className = 'bm-row-name';
      name.textContent = label;
      row.appendChild(name);

      const chips = document.createElement('div');
      chips.className = 'bm-chips';
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', `${label} — ${noun} értéke`);
      for (let value = 1; value <= max; value += 1) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'bm-chip';
        chip.textContent = String(value);
        chip.setAttribute('aria-pressed', String(values[key] === value));
        chip.setAttribute('aria-label', `${label} — ${noun} ${value}`);
        chip.addEventListener('click', () => {
          if (values[key] === value && removable) clearValue(key); else setValue(key, value);
        });
        chips.appendChild(chip);
      }
      row.appendChild(chips);

      if (blockFrom !== null && values[key] >= blockFrom) {
        const warn = document.createElement('span');
        warn.className = 'bm-row-warn';
        warn.textContent = 'letiltva';
        row.appendChild(warn);
      }
      return row;
    }));
  }

  function setView(next) {
    view = next;
    $$('.ds-seg-btn', toggle).forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.view === view));
    });
    renderStage();
  }

  setView('front');
  renderRows();

  return {
    el,
    refresh() { renderStage(); renderRows(); },
  };
}

export { createBodyMap };
```

> Ha a `$$` segéd szignatúrája a `core/dom.js`-ben más, mint `(selector, root)`, igazodj az ottanihoz.

- [ ] **Step 2: A stílus megírása**

A `style.css` végére, és a tartalomjegyzékbe is vedd fel (`29. Testtérkép (bm-*) — a check-in és a Regeneráció közös emberkéje`):

```css
/* ==========================================================================
   29. Testtérkép (bm-*)
   ==========================================================================
   Vonalrajz-sziluett, a lap többi hajszálvonalával azonos súlyú. Az
   izomcsoportok kitöltetlenek, kijelölve accent-kitöltést és a régió
   súlypontjában egy számot kapnak.

   A régiók KISEBBEK a 44px-es érintési minimumnál — ez elfogadott kivétel:
   anatómiai arányok miatt nem nőhetnek, tágító pszeudoelemmel pedig
   átfednék a szomszédaikat. A térkép alatti .bm-chip EGYENÉRTÉKŰ út, nem
   kijelző: ott minden érték 44px-es célterületen, billentyűzetről is.
   ========================================================================== */

.bm {
  display: flex;
  flex-direction: column;
  gap: var(--sp-11);
}

.bm-stage {
  display: flex;
  justify-content: center;
}

.bm-svg {
  width: 100%;
  max-width: 260px;
  height: auto;
}

.bm-silhouette,
.bm-silhouette-head {
  fill: none;
  stroke: var(--hair);
  stroke-width: 1.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.bm-region {
  fill: transparent;
  stroke: var(--border-strong);
  stroke-width: 1;
  cursor: ns-resize;
  /* Enélkül a függőleges húzás görgetne, nem értéket állítana. */
  touch-action: none;
  transition: fill var(--t-fast), stroke var(--t-fast);
}

.bm-region:hover {
  fill: var(--surface-hover);
}

.bm-region[aria-pressed="true"] {
  fill: var(--c-accent-dim);
  stroke: var(--c-accent-line);
}

.bm-labels {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 800;
  fill: var(--text-primary);
  pointer-events: none;
}

.bm-row {
  display: flex;
  align-items: center;
  gap: var(--sp-5);
  flex-wrap: wrap;
  padding: var(--sp-5) 0;
  border-top: 1px solid var(--hair-soft);
}

.bm-row-name {
  flex: 1;
  min-width: 96px;
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  font-weight: 700;
  letter-spacing: var(--ls-label-tight);
  text-transform: uppercase;
  color: var(--text-secondary);
}

.bm-chips {
  display: flex;
  gap: 1px;
  background: var(--hair);
}

.bm-chip {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  border: 0;
  background: var(--c-bg);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background var(--t-fast), color var(--t-fast);
}

.bm-chip:hover {
  background: var(--surface-hover);
}

.bm-chip[aria-pressed="true"] {
  background: var(--c-accent);
  color: var(--on-accent);
}

.bm-row-warn {
  font-family: var(--font-mono);
  font-size: var(--fs-2xs);
  font-weight: 700;
  letter-spacing: var(--ls-label-tight);
  text-transform: uppercase;
  color: var(--c-alert);
}
```

- [ ] **Step 3: Ellenőrzés**

```bash
npm run lint && npm run format -- public && npm run format:check && npm test
```

A komponensnek még nincs hívója — ez a lépés azt bizonyítja, hogy a modul betölthető és lintel. Ellenőrizd a betölthetőséget is:

```bash
node --input-type=module -e "import('./public/js/ui/bodymap/paths.js').then(() => console.log('paths OK'))"
```

(Az `index.js` DOM-ot használ, azt Node-ból nem lehet betölteni — az a következő task böngészős ellenőrzésén derül ki.)

- [ ] **Step 4: Commit**

```bash
git add public/js/ui/bodymap/index.js public/style.css
git commit -m "Testtérkép-komponens: a varázsló és a Regeneráció közös emberkéje

A térkép eddig a varázsló egyik lépésébe volt beépítve, a Regeneráció
oldal meg 19 külön skálát rakott ki ugyanarra az adatra. Egy komponens
lesz belőle, mert a kettőnek ugyanaz a viselkedése kell.

Három dolog van benne, ami újraírásnál csendben el szokott tűnni, ezért
kommentben is ki van mondva: húzás közben csak az érintett régió
festődik újra (különben elszáll a pointer capture), a chip-sorok
egyenértékű út és nem kijelző, és a tükör-párból csak az egyik van a
fókusz-sorrendben.

A feliratok külön, nem tükrözött rétegben ülnek — a tükrözött
csoportban a szám tükörírással jelenne meg.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: A varázsló térkép-lépése átáll a komponensre

**Files:**
- Modify: `public/js/ui/checkin/steps/map.js` (a fájl nagy része törlődik)
- Modify: `public/js/ui/checkin/constants.js` (`CI_BODY_REGIONS` és `CI_DRAG_PX_PER_STEP` törlése)
- Modify: `public/index.html` (`tpl-ci-map` és `tpl-ci-value-row` sablonok)
- Modify: `public/style.css` (a 25. szakasz `.ci-map`, `.ci-map-head`, `.ci-region`, `.ci-values`, `.ci-value-row` szabályai törlődnek)

**Interfaces:**
- Consumes: `createBodyMap` a `../../bodymap/index.js`-ből.
- Produces: a `renderMap(stepName, nav)` szignatúra **változatlan** — a `wizard.js` nem tud a cseréről.

- [ ] **Step 1: A sablon egyszerűsítése**

`public/index.html`, a `tpl-ci-map` sablon. A nézetváltót, a térképet és az érték-sorokat mostantól a komponens építi, tehát csak a horgot hagyjuk:

```html
  <!-- Testtérkép. A nézetváltót, az emberkét és az érték-sorokat a
       bodymap komponens építi be a [data-ci-map] konténerbe. -->
  <template id="tpl-ci-map">
    <div class="ci-step">
      <div class="ci-head-block">
        <p class="ci-eyebrow" data-ci-eyebrow></p>
        <h2 class="ci-question" data-ci-title></h2>
        <p class="ci-sub" data-ci-sub></p>
      </div>
      <div data-ci-map></div>
      <p class="ci-legend" data-ci-legend></p>
      <button class="ci-primary" type="button" data-action="checkin-next">
        Tovább <span aria-hidden="true">→</span>
      </button>
    </div>
  </template>
```

A `tpl-ci-value-row` sablont **töröld** — a komponens saját sorokat épít.

- [ ] **Step 2: A lépés-modul újraírása**

`public/js/ui/checkin/steps/map.js` teljes tartalma:

```js
/** Test-térkép lépés: a közös bodymap komponens beillesztése a varázslóba. */

import { $, cloneTemplate } from '../../../core/dom.js';
import { createBodyMap } from '../../bodymap/index.js';
import { CI_MAP_MODES, CI_PAIN_BLOCK } from '../constants.js';
import { ciMuscleLabel } from '../helpers.js';
import { ci } from '../session.js';

function renderMap(stepName, nav) {
  const mode = CI_MAP_MODES[stepName];

  const step = cloneTemplate('tpl-ci-map');
  $('[data-ci-eyebrow]', step).textContent = mode.eyebrow;
  $('[data-ci-title]', step).textContent = mode.title;
  $('[data-ci-sub]', step).textContent = mode.sub;
  $('[data-ci-legend]', step).textContent = mode.legend;

  const map = createBodyMap({
    max: mode.max,
    defaultValue: mode.defaultValue,
    noun: mode.noun,
    values: ci.answers[mode.field],
    muscleLabel: ciMuscleLabel,
    blockFrom: mode.field === 'pain' ? CI_PAIN_BLOCK : null,
    onChange: () => { ci.dirty = true; },
  });
  $('[data-ci-map]', step).replaceWith(map.el);

  $('[data-action="checkin-next"]', step).addEventListener('click', () => nav.goNext());
  return step;
}

export { renderMap };
```

> A `ci.mapView` állapot megszűnik: a nézetet mostantól a komponens tartja. Keresd meg a `session.js`-ben, és töröld — `grep -rn "mapView" public/js`.

- [ ] **Step 3: A holt konstansok törlése**

`public/js/ui/checkin/constants.js`: töröld a `CI_BODY_REGIONS` és a `CI_DRAG_PX_PER_STEP` deklarációt és az export-listából is. A `CI_PAIN_BLOCK` **maradjon** — a `wizard.js` és az összegzés is használja.

- [ ] **Step 4: A holt CSS törlése**

`public/style.css` 25. szakasz: töröld a `.ci-map`, `.ci-map-head`, `.ci-region` (és `:hover`, `[aria-pressed]` változatai), `.ci-values`, `.ci-value-row`, `.ci-value-name`, `.ci-value-chips`, `.ci-value-warn`, `.ci-chip`, `.ci-chip--pain`, `.ci-map-toggle` szabályokat. Ellenőrizd, hogy egyik osztály sem maradt használatban:

```bash
grep -rn "ci-map\|ci-region\|ci-value\|ci-chip" public/js public/index.html
```

Várt: csak a `data-ci-map` horog találata marad.

- [ ] **Step 5: Ellenőrzés böngészőben**

```bash
npm run lint && npm test && npm start
```

Nyisd meg a check-int, és a **térkép-lépésen** ellenőrizd mind az ötöt:

1. Az emberke megjelenik, felismerhető, a régiók a helyükön.
2. Koppintás kijelöl az alapértékkel; a szám megjelenik a régión.
3. Lenyomva tartva **fel-le húzva** az érték változik, és a húzás nem szakad meg.
4. `Tab`-bal végigjárva minden izomcsoport **egyszer** kerül sorra (nem kétszer), a nyilak léptetnek.
5. Az „Elöl / Hátul" váltás átrajzol, és a már megjelölt izmok megtartják az értéküket.

Majd ugyanez a **fájdalom-térképen**, ahol a 7-es vagy nagyobb értéknél megjelenik a „letiltva" jelzés.

- [ ] **Step 6: Commit**

```bash
git add public/js public/index.html public/style.css
git commit -m "A varázsló térkép-lépése a közös komponensre áll

A 175 soros lépés-modul 30 sor lett: a viselkedés a bodymap
komponensbe költözött, a lépés csak a szövegeket adja és beilleszti.

Elhalt vele a CI_BODY_REGIONS téglalap-táblázat, a ci.mapView állapot
(a nézetet a komponens tartja) és a tpl-ci-value-row sablon.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: A Regeneráció oldal űrlapja is testtérképet kap

**Files:**
- Modify: `public/index.html:930-945` (a `checkin-soreness` és `checkin-pain` konténerek)
- Modify: `public/js/ui/recovery.js:51-120` (a skála-építés és a `fillForm`/`readForm`)

**Interfaces:**
- Consumes: `createBodyMap` a `../bodymap/index.js`-ből.
- Produces: a `PUT /api/checkin` törzse **változatlan** — `{ soreness: {…}, pain: {…} }`, benne a `pain.general` kulccsal.

- [ ] **Step 1: A markup cseréje**

`public/index.html`, az `.rc-checkin-body` blokkban:

```html
            <div class="rc-checkin-body">
              <p class="rc-hint">Jelöld be az emberkén, hol van izomlázad (1 = alig érezhető,
                10 = nagyon erős). Amit kihagysz, annak a súlya újraoszlik.</p>
              <div data-map="checkin-soreness"></div>

              <p class="rc-hint">Fájdalom vagy sérülés (1–10). A 7-es vagy nagyobb érték letiltja az
                érintett izomcsoportot terhelő gyakorlatokat.</p>
              <div data-map="checkin-pain"></div>
```

- [ ] **Step 2: A modul átírása**

`public/js/ui/recovery.js`. A `sorenessWrap` / `painWrap` skála-építés helyére két térkép. A `values` objektumokat a modul tartja, és a `fillForm`/`readForm` ezeket írja-olvassa:

```js
  // A két testtérkép élő értéktárai. A komponens ezeket módosítja helyben,
  // a fillForm kicseréli a tartalmukat, a readForm pedig beolvassa —
  // ugyanaz az objektum végig, hogy a komponensnek ne kelljen újraépülnie.
  const sorenessValues = {};
  const painValues = {};

  const sorenessMap = createBodyMap({
    max: 10, defaultValue: 5, noun: 'izomláz',
    values: sorenessValues,
    muscleLabel: ciMuscleLabel,
  });
  $('[data-map="checkin-soreness"]', page).replaceWith(sorenessMap.el);

  const painMap = createBodyMap({
    max: 10, defaultValue: 5, noun: 'fájdalom',
    values: painValues,
    muscleLabel: ciMuscleLabel,
    blockFrom: CI_PAIN_BLOCK,
    extraRows: [{ key: 'general', label: 'Általános fájdalom' }],
  });
  $('[data-map="checkin-pain"]', page).replaceWith(painMap.el);
```

Az importok a fájl tetején: `createBodyMap` a `./bodymap/index.js`-ből,
`ciMuscleLabel` a `./checkin/helpers.js`-ből, `CI_PAIN_BLOCK` a
`./checkin/constants.js`-ből.

A `fillForm`-ban a `MUSCLE_GROUPS.forEach(…)` soreness/pain ága és a `pain.general` sora helyére:

```js
    // A térképek értéktárait helyben cseréljük, nem újat adunk: a komponens
    // az eredeti objektumra tart hivatkozást.
    for (const store of [sorenessValues, painValues]) {
      for (const key of Object.keys(store)) delete store[key];
    }
    Object.assign(sorenessValues, checkin?.soreness ?? {});
    Object.assign(painValues, checkin?.pain ?? {});
    sorenessMap.refresh();
    painMap.refresh();
```

A `readForm`-ban a megfelelő ág:

```js
    body.soreness = { ...sorenessValues };
    body.pain = { ...painValues };
```

A `MUSCLE_GROUPS` import és a `scaleFor('pain.general')` hívás elhal — töröld őket, ha semmi más nem használja (`grep -n "MUSCLE_GROUPS" public/js/ui/recovery.js`).

- [ ] **Step 3: Ellenőrzés böngészőben**

```bash
npm run lint && npm run format -- public && npm test && npm start
```

A Regeneráció oldalon nyisd le a „Részletes szerkesztés"-t:

1. Két emberke jelenik meg, mindkettő saját „Elöl / Hátul" kapcsolóval.
2. Jelölj meg izmokat mindkettőn, mentsd el, **frissítsd a lapot** — a jelölések visszajönnek.
3. Az „Általános fájdalom" sor a fájdalom-térkép alatt van, chipekkel.
4. Töltsd ki a **varázslót** is, majd térj vissza ide: ugyanazok az értékek látszanak. (Ez a fontos: a két felület ugyanazt a sort írja.)

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/js/ui/recovery.js
git commit -m "A Regeneráció oldal részletes űrlapja is emberkét kap

Eddig 19 külön 0–10-es skála állt egymás alatt ugyanarra az adatra,
amit a varázsló testtérképen kérdez. Ugyanaz a kérdés két, egymástól
teljesen eltérő felületen — most már ugyanaz a komponens.

A PUT /api/checkin törzse nem változott; a pain.general a térkép alatti
extra sorban él tovább, mert nem köthető testrégióhoz.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Fázis 3 — az oldalak

Minden oldal-task azonos szerkezetű, ezért a receptet itt írom le egyszer. **Task 8–18 mindegyike ezt követi**, csak a fájlok és az ellenőrzési pontok mások.

**A recept**

1. Nyisd meg az oldalt (`npm start`), és nézd meg, mi van most.
2. A `style.css` érintett szakaszában cseréld a **kártya-szabályokat** vonalasra:
   - `background: var(--surface-card)` + `border: 1px solid …` + `border-radius` → **törlendő**; helyette `border-top: 1px solid var(--hair)` és függőleges `padding`.
   - Ahol több elem rácsban ül: a szülő `.ds-grid`, a gyerekek keret nélkül.
   - Ahol egy elem címke + érték: `.ds-row` a saját osztálya mellé.
3. A `public/index.html`-ben a szükséges osztályokat vedd fel a meglévők **mellé** (`class="rc-item ds-row"`), ne helyettük — így a JS-horgok és a meglévő szabályok érintetlenek maradnak.
4. Az oldal fő műveletét tedd `.ds-cta`-vá.
5. `npm run lint && npm run format -- public && npm run format:check && npm test`
6. Nézd meg **keskeny (≤1024px) és széles (≥1280px)** nézetben is.
7. Commit — a commit-üzenet mondja el, mit veszít és mit nyer az oldal.

**Az egyetlen szabály, ami alól van kivétel:** a kártya nem mindig dísz. Ahol egy blokk *teendő*, nem adat (mint az Áttekintés check-in emlékeztetője, amit az `51df3c5` szándékosan kerettel hagyott), ott a keret marad. Ez egyedi döntés minden előfordulásnál, nem szabály — és a commit-üzenetben mondd ki, ha éltél vele.

---

### Task 8: Áttekintés

**Files:**
- Modify: `public/style.css` (6. szakasz, `db-*`)
- Modify: `public/index.html:153-289`

Az `51df3c5` már kártya nélkülire építette. Itt csak annyi a dolog, hogy ne két úton szülessen ugyanaz: ahol a `db-*` szabályok kézzel csinálják a hajszálvonalat vagy a mono felkiáltót, ott a `.ds-section` / `.ds-eyebrow` / `.ds-row` primitívekre álljon át.

- [ ] **Step 1:** Fuss végig a 6. szakaszon, és listázd, mely `db-*` szabály duplikálja valamelyik primitívet.
- [ ] **Step 2:** Cseréld le őket — az `index.html`-ben a primitív-osztály a `db-*` mellé kerül, a `style.css`-ből a duplikált deklaráció törlődik.
- [ ] **Step 3:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 4:** Nézd meg mindkét szélességben. Az Áttekintésnek **pixelre ugyanúgy kell kinéznie**, mint előtte — ez a task tisztogatás, nem átszabás. Ha változik a kép, a primitív rossz.
- [ ] **Step 5:** Commit: `"Áttekintés: a kézzel írt vonalak és címkék a primitívekre állnak"`

---

### Task 9: Regeneráció oldal

**Files:**
- Modify: `public/style.css` (22. szakasz, `rc-*`)
- Modify: `public/index.html:860-1060`

- [ ] **Step 1:** A készenlét-blokk (`.rc-score`) a prototípus hero-ját kapja: `.ds-display` `--ds-display-size: clamp(72px, 20vw, 96px)`-szal, mellette a `%`-jel dekoratív halvány színnel. **A gyűrű marad** — a Regeneráció oldal az egyetlen hely, ahol a spec megtartja.
- [ ] **Step 2:** A „Számítás" és „Javaslat" listák `.ds-section` + `.ds-row` szerkezetre állnak.
- [ ] **Step 3:** A `.rc-checkin-cta` `.ds-cta` lesz.
- [ ] **Step 4:** A `.rc-muscle-*` lista (a csoportonkénti készenlét) `.ds-row`-ra áll; a `izomláz x/10` meta a `.ds-row-sub`-ba.
- [ ] **Step 5:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 6:** Ellenőrizd, hogy a Task 7-ben beépített két emberke sértetlen maradt, és a készenlét-szám frissül check-in mentése után.
- [ ] **Step 7:** Commit: `"Regeneráció: hero-készenlét, hajszálvonalas számítás- és javaslat-lista"`

---

### Task 10: A check-in varázsló többi lépése

**Files:**
- Modify: `public/style.css` (25. szakasz, `ci-*`)
- Modify: `public/index.html:1940-2135` (a `tpl-ci-*` sablonok)

- [ ] **Step 1:** Intro-lépés: `.ci-display` a prototípus 56px-es display-e; a „Kezdés" gomb `.ds-cta` accent háttérrel.
- [ ] **Step 2:** Szám-lépés (alvás, testsúly): a 72px-es érték `.ds-display`-jel, a ± gombok `.ds-step`-pel, a gyorsgombok `.ds-grid`-ben.
- [ ] **Step 3:** Skála-lépés: `.ds-seg`-re áll, 80px magas gombokkal (a prototípus mérete).
- [ ] **Step 4:** Kapu-lépés: két nagy választókártya → keret nélküli, hajszálvonallal elválasztott sorok.
- [ ] **Step 5:** Összegzés: a készenlét-szám `.ds-display`, a lista `.ds-row`.
- [ ] **Step 6:** A fejléc-sáv (vissza / haladás / lépésszám / kilépés) a prototípus arányaira: 44px-es gombok, 4px-es haladássáv `--hair-soft` alapon, accent kitöltéssel.
- [ ] **Step 7:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 8:** Kattintsd végig a **teljes** varázslót mindkét kapun „igen"-nel, hogy minden lépéstípust láss.
- [ ] **Step 9:** Commit: `"Check-in varázsló: display-számok, szegmensek, hajszálvonalas kapuk"`

---

### Task 11: Edzés

**Files:**
- Modify: `public/style.css` (7. szakasz, `wk-*`)
- Modify: `public/index.html:397-480`

- [ ] **Step 1:** A gyakorlat-kártyák keret nélküliek lesznek, hajszálvonallal elválasztva; a szett-sorok `.ds-grid`-ben.
- [ ] **Step 2:** A súly- és ismétlés-léptetők `.ds-step`-re állnak.
- [ ] **Step 3:** Az „Edzés indítása" / „Edzés befejezése" `.ds-cta`.
- [ ] **Step 4:** **Marad és látható kell hogy maradjon:** szuperszett-jelölés (`--c-superset`), PR-jelvény pulzálása, gyakorlat-megjegyzés, autosave-jelző. Ezek nem díszek, hanem állapotjelzések — ha a kártya eltűnésével elvesznek, adj nekik saját helyet a soron.
- [ ] **Step 5:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 6:** Indíts egy edzést, naplózz szettet, jelölj szuperszettet, és nézd meg, hogy mind a négy jelzés látszik.
- [ ] **Step 7:** Commit: `"Edzés: hajszálvonalas szettnapló, a négy állapotjelzés megtartva"`

---

### Task 12: Táplálkozás

**Files:**
- Modify: `public/style.css` (8. szakasz `nu-*`, 24. szakasz `fd-*`, 28. szakasz `cf-*` / `sc-*`)
- Modify: `public/index.html:544-669`

- [ ] **Step 1:** A makró-összegzés a prototípus hero-jára: nagy kcal-szám + haladássáv + `.ds-row` makrósorok.
- [ ] **Step 2:** Az étkezés-lista és a gyors hozzáadás `.ds-row`-ra áll, jobb oldalt a művelet-gombbal.
- [ ] **Step 3:** A vízmérő megtartja a mostani (frissen tervezett) formáját, csak a sugarak és a keretek igazodnak.
- [ ] **Step 4:** **Marad:** vonalkód-olvasó, étel-részlet modál, saját étel. Ezek a 17. taskban kapnak modál-ruhát; itt csak a belépőik.
- [ ] **Step 5:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 6:** Naplózz ételt, nyisd meg a részlet-modált, indítsd el a szkennert (a kamera-hiba is elfogadható válasz, a lényeg, hogy a felület megjelenik).
- [ ] **Step 7:** Commit: `"Táplálkozás: kcal-hero, hajszálvonalas étkezés-lista"`

---

### Task 13: Tervek + terv-szerkesztő + gyakorlat-választó

**Files:**
- Modify: `public/style.css` (9. szakasz `pl-*`, 22. szakasz `pb-*`, 23. szakasz `ep-*`)
- Modify: `public/index.html:481-543`, `public/index.html:670-688`

Ez a három együtt egy folyamat (terv → szerkesztés → gyakorlat-választás), ezért egy taskban.

- [ ] **Step 1:** Tervek: a terv-kártyák `.ds-row`-ra állnak, jobb oldalt az „Aktivál" / „■ Aktív" gombbal (az aktív accent hátterű).
- [ ] **Step 2:** A heti nézet `.ds-grid`-be kerül.
- [ ] **Step 3:** Terv-szerkesztő: flow-oldal felépítés — `.ds-eyebrow` + nagy cím + `.ds-row` lista + alul `.ds-cta`.
- [ ] **Step 4:** Gyakorlat-választó: kereső mező hajszálvonalas kerettel, a találati lista `.ds-row`-kkal.
- [ ] **Step 5:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 6:** Készíts egy új tervet elejétől végéig, gyakorlat-választással együtt.
- [ ] **Step 7:** Commit: `"Tervek, terv-szerkesztő, gyakorlat-választó: egy folyamat, egy nyelv"`

---

### Task 14: Edző

**Files:**
- Modify: `public/style.css` (10. szakasz és 20. szakasz, `co-*`)
- Modify: `public/index.html:689-782`

- [ ] **Step 1:** A nézetváltó (edző / kliens) `.ds-seg`-re áll.
- [ ] **Step 2:** A sportoló-kártyák `.ds-row`-ra; a tier-színek (`--c-tier-*`) megmaradnak, de nem kártya-háttérként, hanem a soron egy bal oldali 2px-es jelölő-sávként.
- [ ] **Step 3:** Az üzenet-buborékok szögletesek lesznek; a sajátok accent-keretet kapnak, nem accent-hátteret (különben a hosszú üzenet egy nagy vörös folt).
- [ ] **Step 4:** Az üzenet-író `.ds-grid`-be kerül: mező + „Küldés" gomb 1px-es réssel.
- [ ] **Step 5:** **Marad:** meghívók, üres állapotok, sportoló-modál belépő.
- [ ] **Step 6:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 7:** Váltogass a két nézet között; nyiss meg egy sportolót; nézd meg az üres állapotot is (olyan fiókkal, amelyhez nincs sportoló).
- [ ] **Step 8:** Commit: `"Edző: szegmens-nézetváltó, sor-alapú sportolólista, szögletes buborékok"`

---

### Task 15: Edzés-összegző és Profil

**Files:**
- Modify: `public/style.css` (21. szakasz `su-*`, 27. szakasz `pf-*`, 18. szakasz analitika)
- Modify: `public/index.html:290-396`, `public/index.html:783-859`

- [ ] **Step 1:** Összegző: a volumen a hero-szám, alatta `.ds-row` statisztikák.
- [ ] **Step 2:** Profil: az adatsorok `.ds-row`-ra; a testmérés és a PR-lista `.ds-section`-be.
- [ ] **Step 3:** A testsúly-trend diagram vonalai a `--hair` szintre állnak (ma erősebbek).
- [ ] **Step 4:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 5:** Fejezz be egy edzést (hogy az összegző megjelenjen), majd nézd meg a profilt méréssel és PR-rel.
- [ ] **Step 6:** Commit: `"Összegző és Profil: hero-szám és sor-alapú adatlisták"`

---

### Task 16: Belépő képernyő

**Files:**
- Modify: `public/style.css` (26. szakasz, `au-*`)
- Modify: `public/index.html:40-90`

- [ ] **Step 1:** Az `.au-card` elveszti a kártya-formáját: háttér és keret nélkül, középre igazítva, a varázsló intro-lépésének nyelvén.
- [ ] **Step 2:** `.ds-eyebrow` a márkajel fölé, nagy display-cím, a mezők hajszálvonalas kerettel.
- [ ] **Step 3:** A belépés-gomb `.ds-cta`.
- [ ] **Step 4:** A `.au-error` **marad `--c-alert` színű**, nem accent — a két token szándékosan külön (lásd a `style.css` 1. szakaszának kommentjét).
- [ ] **Step 5:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 6:** Jelentkezz ki, és nézd meg a belépőt hibás jelszóval is (hogy a hibaüzenet látszódjon).
- [ ] **Step 7:** Commit: `"Belépő: kártya nélküli, a varázsló intro-lépésének nyelvén"`

---

### Task 17: Modálok és toast

**Files:**
- Modify: `public/style.css` (13., 13b., 14., 17., 19., 24., 28. szakasz)

- [ ] **Step 1:** Közös modál-alap: `background: var(--surface-panel)`, 0 sugár, `--shadow-modal` marad, a fejléc alatt `1px solid var(--hair)`.
- [ ] **Step 2:** A modál-címek `.ds-eyebrow` nyelvén (mono, nagybetűs) — kivéve, ahol a cím mondat (pl. a megerősítő ablak kérdése), ott marad mondat-szedés.
- [ ] **Step 3:** A modál-műveletek `.ds-cta` vagy `.ds-seg` szerint.
- [ ] **Step 4:** Toast: szögletes, `--surface-panel` hátterű, mono felirat.
- [ ] **Step 5:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 6:** Nyisd meg **mind a nyolcat**: technika-videó, PR-előzmény, beállítások, megerősítő, sportoló, étel-részlet, saját étel, szkenner. Plusz válts ki egy toastot (bármelyik mentés).
- [ ] **Step 7:** Commit: `"Modálok és toast: panel-felület, szögletes forma, mono címek"`

---

### Task 18: Nav gyűrű és oldalsáv

**Files:**
- Modify: `public/style.css` (11. szakasz `nav-*`, 12. szakasz `side-nav-*`)

- [ ] **Step 1:** Nav gyűrű: a `panel` háttér a `--surface-panel`-re áll, az irány-címkék mono nagybetűsek `.16em` ritkítással, az aktív irány accent színű. A korong marad kör (`--r-full`).
- [ ] **Step 2:** Oldalsáv: `--surface-panel` háttér, az aktív elem `--fg-10` háttérrel és accent `■` jelölővel, a márkajel mono nagybetűs `.22em` ritkítással.
- [ ] **Step 3:** `npm run lint && npm run format -- public && npm test`
- [ ] **Step 4:** Húzd meg a nav korongot mind a négy irányba, és nyomd meg a „Regeneráció" sávot. Széles nézetben járd végig az oldalsáv mind a hat elemét.
- [ ] **Step 5:** Commit: `"Nav gyűrű és oldalsáv: panel-felület, mono iránycímkék"`

---

### Task 19: A világos téma tokenszintű előkészítése

**Files:**
- Modify: `public/style.css:33-206`

Ez **nem** a világos téma megvalósítása — csak az, hogy a szerkezet készen álljon rá.

**Interfaces:**
- Produces: `[data-theme="light"]` szelektor a `:root` mellett, üres törzzsel és a kitöltendő tokenek listájával kommentben.

- [ ] **Step 1:** A `:root` blokk után:

```css
/* A világos téma helye. A prototípusban opció (paper: #f4f2ed), de a
   palettája még nincs kitöltve — ez a blokk szándékosan üres, hogy a
   szerkezet készen álljon, és később EGY helyen legyen mit írni.

   Kitöltendő: --c-bg, --c-bg-deep, --c-bg-raised, --surface-panel,
   --hair, --hair-soft, és a --fg-* alfa-skála fekete alfára fordítva.
   Minden más token (accent, alert, tier-ek, tipográfia, térköz) témától
   független — azokat ide NEM kell átmásolni. */
[data-theme='light'] {
  color-scheme: light;
}
```

- [ ] **Step 2:** Ellenőrizd, hogy a sötét téma semmit nem változott (`npm start`, egy oldal megnézése), és `npm run format:check` átmegy.
- [ ] **Step 3:** Commit: `"A világos téma helye előkészítve, kitöltés nélkül"`

---

### Task 20: Záró átvizsgálás

**Files:** (nincs előre meghatározva — ami a végigjáráson kiderül)

- [ ] **Step 1: Holt CSS keresése**

```bash
for c in $(grep -oE '^\.[a-z][a-z0-9-]+' public/style.css | sort -u | tr -d '.'); do
  grep -rqF "$c" public/index.html public/js || echo "használatlan: $c";
done
```

Nézd át a listát. Ami a régi kártyás nyelvhez tartozott, töröld; ami állapot-osztály (a JS `classList`-tel adja hozzá), maradjon — azt a grep nem mindig találja meg. Kétes esetben hagyd bent, és írd a commit-üzenetbe.

- [ ] **Step 2: Nyers színértékek keresése**

```bash
grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' public/style.css | grep -v '^\s*[0-9]*:\s*--' | sed -n '1,60p'
```

**Csak azokat a szabályokat nézd, amiket ez a terv írt vagy módosított.** A
fájlban rengeteg *korábbi* nyers `rgba()` van a `:root`-on kívül (például a
`.sc-frame` kerete és az `.au-error` háttere) — azok nem ennek a munkának a
hatóköre, és nem szabad hozzájuk nyúlni. Ha egy általunk írt szabályban van
szín-literál, azt cseréld tokenre.

- [ ] **Step 3: Teljes kapu**

```bash
npm test && npm run lint && npm run format:check
```

Várt: 317+ teszt zöld (317 szerver + 5 testtérkép-geometria), nincs lint-hiba, a formázás rendben.

- [ ] **Step 4: Végigjárás**

`npm start`, és **keskeny (≤1024px) és széles (≥1280px)** nézetben egyaránt:

Áttekintés → Regeneráció → check-in varázsló (végig, mindkét kapun igennel) → Edzés (indítás, szett, befejezés) → Összegző → Táplálkozás (ételnaplózás, részlet-modál) → Tervek → terv-szerkesztő → gyakorlat-választó → Edző (mindkét nézet) → Profil → Beállítások → kijelentkezés → Belépő.

Amit keresel: hol maradt lekerekített sarok, hol duplázódik hajszálvonal, hol tűnt el egy állapotjelzés, hol lett olvashatatlanul halvány egy címke.

- [ ] **Step 5: A talált hibák javítása**

Egy commit hibánként vagy hibacsoportonként, beszédes üzenettel.

- [ ] **Step 6: Záró commit**

```bash
git add -A
git commit -m "Záró átvizsgálás: holt CSS, nyers színek, végigjárás

A dizájn átültetése kész: mind a 11 oldal, a belépő és a modálok egy
nyelvet beszélnek.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Önellenőrzés — a spec lefedettsége

| Spec-pont | Task |
|---|---|
| 4.1 Tokenek | 1 |
| 4.2 Lekerekítés | 1 (Step 4) |
| 4.3 Primitívek (8 db) | 2 |
| 5. Áttekintés / Regeneráció / varázsló | 8, 9, 10 |
| 5. Edzés / Táplálkozás / Tervek / Edző | 11, 12, 13, 14 |
| 5. Összegző / Profil / szerkesztő / választó | 13, 15 |
| 5. Belépő | 16 |
| 5. Modálok | 17 |
| 5. Nav gyűrű / oldalsáv / toast | 17, 18 |
| 6. Testtérkép | 4, 5, 6, 7 |
| 6.5 `pain.general` | 7 |
| 6.6 A Regeneráció oldal űrlapja | 7 |
| 7. Izomláz 1–10 | 3 |
| 8. Világos téma előkészítése | 19 |
| 10. Ellenőrzés | 20 |
