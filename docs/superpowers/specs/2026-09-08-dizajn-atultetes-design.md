# A dizájn átültetése az appba — terv

**Dátum:** 2026-09-08 · **Ág:** `dizajn-atultetes`

## 1. Cél

A `6351a1b3` artifacton lévő dizájn-prototípus vizuális nyelvét az egész app
megkapja — mind a 11 oldal, a belépő képernyő és minden modál. A prototípus
csak 6 oldalt tartalmaz; a többit a rendszerből vezetjük le, nem improvizáljuk.

Egyetlen ponton **eltérünk** a prototípustól: a regenerációs kérdőívről eltűnt
a testtérkép-emberke. Az nem szándékos tervezői döntés volt, hanem a prototípus
egyszerűsítése — visszakerül, méghozzá igazi SVG figuraként, és a Regeneráció
oldalra is.

## 2. Háttér: mi van most

A dizájn **rendszerét** (színek, tipográfia, térköz-skála) a `87a141e` már
átvette, az **Áttekintés felépítését** az `51df3c5`. A maradék tíz oldal még a
régi, kártyás nyelven áll. A `style.css` 8484 sor, 28 szakasz; a frontend 56 ES
modul a `public/js/` alatt.

A prototípus szerkezete: minden nem-dashboard oldal ugyanaz a sablon —
hero-szám + „szekció → sor" listák + alul egy uppercase CTA-sáv. Ez a
prototípus egyszerűsítése, **nem** utasítás a funkciók elhagyására: a szkenner,
a szuperszett-jelölés, a PR-jelvény, a gyakorlat-megjegyzések, az Edző oldal két
nézete és a meghívók mind maradnak, csak új ruhát kapnak.

## 3. Rögzített döntések

| # | Döntés |
|---|--------|
| 1 | Az átültetés az **igazi appba** megy (`public/`, ahol kell, `server/`), nem az artifactba. |
| 2 | Egy ágon, egy menetben — belül több commit, oldalanként. |
| 3 | Mind a **11 oldal** + belépő + modálok. |
| 4 | Az **adatok az appé** maradnak; a prototípus dummy tartalma (Kovács Bence, 4 sportoló) nem jön át. |
| 5 | Sötét téma most; a világos téma **tokenszinten előkészítve**, de a paletta kitöltése későbbre marad. |
| 6 | A nyelv **mindenre** kiterjed — modálok, toastok, űrlapok, belépő is. |
| 7 | Breakpointok: az **app** meglévő 1025 / 1280px határai maradnak (nem a prototípus 1120px-e). |
| 8 | A testtérkép **igazi SVG emberke** lesz, vonalrajz-sziluett. |
| 9 | Az „Elöl / Hátul" kapcsoló és a térkép alatti érték-sorok **maradnak**. |
| 10 | Az izomláz skálája **1–5 → 1–10** lesz, a fájdaloméval azonos. |
| 11 | A testtérkép a **Regeneráció oldalra is** bekerül — az ottani 9+9 skálás lista helyére. |
| 12 | Minden meglévő funkció megmarad, csak új ruhát kap. |
| 13 | A `server/fittrack.db` eldobható demóadat — **nincs adatmigráció**. |
| 14 | A Regeneráció oldal többi skálája (alvásminőség, energia, stressz, hangulat) **marad léptetős skála**, új ruhában. |

## 4. A dizájn nyelve

### 4.1 Tokenek

A prototípus palettája (sötét ág, `paper = #17181b`):

```
paper      #17181b     a lap alapja
ink        #f2f0ea     elsődleges szöveg
panel      #0a0a0b     oldalsáv és CTA-sáv háttere
panelInk   #f2f0ea     a panelen ülő szöveg
accent     #c8102e     kiemelés
hair       rgba(255,255,255,.18)   elválasztó vonal
hairSoft   rgba(255,255,255,.11)   halvány felület / sáv-alap
soft       rgba(255,255,255,.66)   másodlagos szöveg
dim        rgba(255,255,255,.52)   felkiáltók, címkék
faint      rgba(255,255,255,.34)   harmadlagos
```

Ezek **nem új tokenek**: a meglévő `--fg-*` alfa-skálára és a szemantikus
aliasokra képezzük le őket. Amit hangolni kell:

- `--c-bg`: `#0d0d0f` → `#17181b` (a prototípus papírja melegebb és világosabb)
- `--border-card` (.08) → a `hair` .18-hoz igazítva; `--border-strong` marad
- `--surface-soft` → a `hairSoft` .11-hez igazítva
- `--text-muted` / `--text-faint`: a mostani WCAG-hangolás (.50/.55) **nem
  romolhat** — a prototípus `dim` .52-je belefér, a `faint` .34-e nem. A .34-et
  csak dekoratív, nem információhordozó elemre használjuk (pl. a `%` jel a nagy
  szám mellett), szöveges címkére soha.
- Új token kell a `panel` felületre (`--surface-panel: #0a0a0b`), mert a
  prototípusban az oldalsáv és a CTA-sáv sötétebb a lapnál.

### 4.2 Lekerekítés

A `87a141e` szándékos középutat választott: „a dizájn szögletes, itt megtartjuk
a kerekítést, csak a nagy sugarakat visszavesszük". A 6. döntés (legyen
koherens) ezt felülírja: **a sugarak 0-ra mennek**, kivéve ami körnek készült
(`--r-full`: avatar, nav-korong, készenlét-gyűrű). A tokenek megmaradnak
`0px` értékkel, hogy ne kelljen 8484 sorban `border-radius`-t vadászni, és hogy
a döntés egy helyen visszafordítható legyen.

### 4.3 Primitívek

Ezek kerülnek a `style.css` új, 2c. szakaszába, és minden oldal ezekből épül:

1. **Hajszálvonalas rács** — a lista- és rácselemek között nincs `border`,
   hanem `gap: 1px` + a szülő `background: var(--hair)`. Így a vonalak
   sosem duplázódnak, és a rács a háttérből jön elő.
2. **Szekció** — nincs kártya: nincs háttér, nincs keret, csak egy felső
   `1px` vonal és egy mono felkiáltó-cím.
3. **Felkiáltó (eyebrow)** — `700 11px/1 ui-monospace`, `letter-spacing: .16em`,
   uppercase, `dim`.
4. **Display-szám** — a méret-lépcső: 96 (dashboard hero) / 72 (varázsló
   számlépő) / 56 (varázsló cím) / 32 (oldalcím). `font-weight: 800`,
   negatív `letter-spacing`, `line-height: .72–1.15`.
5. **Sor-elem (list row)** — bal oldalt név + halvány alcím, jobb oldalt érték
   vagy vezérlő (léptető / szegmens / gomb). Ez váltja ki a mai kártyákat.
6. **CTA-sáv** — teljes szélességű, `min-height: 64px`, uppercase 14px/800,
   jobbra `→`; keskeny nézetben accent hátterű és a lap aljára tapad, széles
   nézetben `panel` hátterű, hover-en accent.
7. **Léptető** — 44×44 `−` / `+` egy hajszálvonalas soron belül.
8. **Szegmens-választó** — 1px-es réssel összeérő gombok, az aktív accent
   hátterű.

## 5. Oldalanként

Mind a 11 oldal + a belépő + a modálok. A „forrás" oszlop azt mondja, honnan
származik a felépítés.

| Oldal (CSS-előtag) | Forrás | Amire figyelni kell |
|---|---|---|
| Áttekintés (`db-`) | prototípus, kész | Az `51df3c5` már megcsinálta — csak a primitívekre húzzuk rá, hogy ne két úton szülessen ugyanaz. |
| Regeneráció (`rc-`) | prototípus | A 9+9 skálás űrlap **helyére testtérkép**. A készenlét-gyűrű marad. A számítás- és javaslat-szekció a prototípus sor-elemeire. |
| Check-in varázsló (`ci-`) | prototípus | Lépésenként megvan a terv; a térkép-lépés az új komponenst kapja. |
| Edzés (`wk-`) | prototípus | A szettnapló a prototípus jobb hasábjában van megtervezve. **Marad:** szuperszett-jelölés, PR-jelvény, gyakorlat-megjegyzés, autosave-jelző. |
| Táplálkozás (`nu-`) | prototípus | **Marad:** vonalkód-olvasó, étel-részlet modál, saját étel, vízmérő. |
| Tervek (`pl-`) | prototípus | **Marad:** a terv-szerkesztőbe és gyakorlat-választóba vivő belépők. |
| Edző (`co-`) | prototípus | **Marad:** a két nézet (edző / kliens), meghívók, sportoló-modál, üres állapotok. A prototípus csak az edzői listát mutatja. |
| Edzés-összegző (`su-`) | levezetve | Hero-szám (volumen) + szekciók. |
| Profil (`pf-`) | levezetve | Sor-elemek + szekciók; a testmérés és a PR-lista is ide tartozik. |
| Terv-szerkesztő (`pb-`) | levezetve | Flow-oldal: felkiáltó + cím + sor-elemek + CTA-sáv. |
| Gyakorlat-választó (`ep-`) | levezetve | Kereső + hajszálvonalas találati lista. |
| Belépő (`au-`) | levezetve | A varázsló intro-lépésének nyelvén: felkiáltó, nagy display-cím, hajszálvonalas mezők, accent CTA. |
| Modálok | levezetve | Közös alap: `panel` hátterű lap, 0 sugár, hajszálvonalas fejléc, uppercase mono cím. Érinti: technika-videó, PR-előzmény, beállítások, megerősítő, sportoló, étel-részlet, saját étel, szkenner. |
| Nav gyűrű (`nav-`) | prototípus | A prototípus megtartotta: húzható korong + 4 irány + alul Regeneráció. Csak a tipográfia és a színek igazodnak. |
| Oldalsáv (`side-nav-`) | prototípus | `panel` háttér, aktív elem `rgba(255,255,255,.10)` + accent `■` jelölő. |
| Toast | prototípus | Szögletes, `panel` hátterű, mono felirat. |

## 6. Testtérkép — az új komponens

### 6.1 Miért közös komponens

Ma a térkép a varázsló egyik lépésébe van beépítve
([`public/js/ui/checkin/steps/map.js`](../../../public/js/ui/checkin/steps/map.js)),
a Regeneráció oldal pedig 19 külön skálát rak ki
([`public/js/ui/recovery.js:62`](../../../public/js/ui/recovery.js#L62)). A 11.
döntés után mindkettőnek ugyanaz a térkép kell — tehát kiemeljük.

### 6.2 Fájlok

```
public/js/ui/bodymap/paths.js    a sziluett és a 9 izomcsoport SVG path-jai, nézetenként
public/js/ui/bodymap/index.js    a komponens: createBodyMap({ mode, values, onChange })
```

A varázsló `steps/map.js`-e és a Regeneráció oldal is ezt hívja. A
`CI_BODY_REGIONS` téglalap-táblázat a `checkin/constants.js`-ből **törlődik** —
helyére a path-ok lépnek.

### 6.3 A rajz

- `viewBox="0 0 220 460"`, két nézet: `front`, `back`.
- Egy nem-interaktív **sziluett-path** adja a kontúrt (fej, nyak, törzs,
  végtagok), `fill: none`, `stroke: var(--hair)`, `stroke-width: 1.25`.
- Fölötte a **9 izomcsoport** külön `<path>`-ként, gombként viselkedve.
  Alap: `fill: transparent`, `stroke: var(--border-strong)`. Kijelölve:
  `fill: var(--c-accent-dim)`, `stroke: var(--c-accent-line)`, és a régió
  súlypontjában egy `<text>` mutatja az értéket.
- A bal/jobb páros (váll, kar, quadriceps, hamstring, vádli) **két path,
  egy logikai vezérlő** — pontosan úgy, ahogy ma is: a második
  `aria-hidden`, `tabindex="-1"`.
- A két nézet uniója a kilenc `MUSCLE_GROUPS` kulcs. Elöl: váll, mell, kar,
  törzs, quadriceps, vádli. Hátul: váll, hát, kar, farizom, hamstring, vádli.
  (A mai felosztás — nincs okunk megváltoztatni.)
- Nem árnyékolt, nem „izomkidolgozott" ábra: vonalrajz, a lap többi
  hajszálvonalával azonos súlyú.

### 6.4 Viselkedés — ami nem változhat

A mai `map.js` három dolgot old meg, amit hiba lenne elveszíteni, és mindegyik
átjön:

1. **Húzás** — lenyomásra kijelöl az alapértékkel, függőleges mozgásra léptet
   (`CI_DRAG_PX_PER_STEP`), elmozdulás nélküli felengedés egy már kijelölt
   régión töröl. A `pointer capture` miatt húzás közben **csak a régió
   festődik újra**, a lépés nem renderelődik újra.
2. **Billentyűzet** — nyilak léptetnek, `Delete` / `Backspace` töröl. A
   térképen húzni kell, ezért a térkép alatti **érték-sorok a kanonikus
   vezérlők**: ott minden érték 44px-es célterület.
3. **Akadálymentesség** — a tükör-párból csak az egyik van a fókusz-sorrendben,
   és minden régió `aria-label`-je kimondja az izmot és az értéket.

### 6.5 Az „Általános fájdalom"

A `pain.general` mező nem köthető testrégióhoz. A fájdalom-térkép alatt kap egy
saját sort, ugyanazokkal a chipekkel, mint a régiós sorok — csak névvel, régió
nélkül.

### 6.6 A Regeneráció oldal űrlapja

A `[data-list="checkin-soreness"]` és `[data-list="checkin-pain"]` konténerek
helyére egy-egy térkép kerül, „Elöl / Hátul" kapcsolóval. A `readForm` /
`fillForm` szerződése nem változik: ugyanaz a `{ soreness: {...}, pain: {...} }`
törzs megy a `PUT /api/checkin`-re.

## 7. Izomláz 1–5 → 1–10

Érintett helyek:

| Fájl | Mi |
|---|---|
| [`server/server.js:1389`](../../../server/server.js#L1389) | `normalizeMuscleMap(body.soreness, 5)` → `10` |
| [`server/recovery.js:452`](../../../server/recovery.js#L452) | `clamp01(reportedSoreness / 5)` → `/ 10` |
| [`server/db.js:270`](../../../server/db.js#L270) | séma-komment: `0..5` → `0..10` |
| `public/js/ui/checkin/constants.js` | `CI_MAP_MODES.soreness`: `max: 5 → 10`, `defaultValue: 3 → 5`, legenda-szöveg |
| [`public/js/ui/recovery.js:62`](../../../public/js/ui/recovery.js#L62) | `max: 5` → `10` |
| [`public/js/render/recovery.js:185`](../../../public/js/render/recovery.js#L185) | `izomláz ${x}/5` → `/10` |
| `server/recovery.test.js` | a `soreness: { chest: 5 }` fajta fixture-ök a 10-es skálára |

A `describe(muscleComponent, ['Erős','Közepes','Enyhe','Nincs'])` a
[`recovery.js:863`](../../../server/recovery.js#L863)-ban a **számított**
komponensen dolgozik (0–100), nem a nyers izomlázon — nem érinti a változás.

Adatmigráció nincs (13. döntés): a `fittrack.db` eldobható. A régi, 0–5-ös
értékek enyhébbnek olvasódnának a 10-es skálán — ezt tudatosan vállaljuk.

## 8. Nem célok

- **Nincs világos téma.** Csak a tokenek szétválasztása készül el
  (`:root` vs `[data-theme="light"]`), a paletta kitöltése nem.
- **Nincs új funkció.** Se új oldal, se új végpont — ez ruha, nem képesség.
- **Nincs átszervezés.** A modulhatárok maradnak; csak ott emelünk ki kódot,
  ahol a közös testtérkép megköveteli.
- **Nem nyúlunk a Recovery Engine matematikájához**, az izomláz-skála
  osztójának kivételével.

## 9. Kockázatok

1. **A `style.css` mérete.** 8484 sor, 28 szakasz; a lekerekítés nullázása és a
   kártya→hajszálvonal váltás széles felületet érint. Enyhítés: a változás a
   tokeneken és a primitíveken keresztül megy, nem szabályonként.
2. **A kártya-eltávolítás elrejthet tartalmat.** Ahol ma a háttér különíti el a
   blokkokat, ott a vonal veszi át — de a `51df3c5` már talált kivételt (a
   check-in emlékeztető keretet kapott, mert teendő, nem adat). Számítani kell
   még ilyenre; ezek egyedi döntések lesznek, nem szabályok.
3. **A testtérkép a legnagyobb egyedi darab.** Kilenc izomcsoport két nézetben,
   kézzel rajzolt path-okkal, megtartott húzás- és billentyű-viselkedéssel.
   Ez önálló lépés lesz, saját teszttel, mielőtt bárhová beköttetik.

## 10. Ellenőrzés

- `npm test` — 317 teszt, zöldnek kell maradnia (a soreness-skála fixture-jei
  frissülnek)
- `npm run lint` és `npm run format:check`
- `npm start`, és végigkattintva mind a 11 oldal + a belépő + minden modál,
  keskeny (≤1024px) és széles (≥1280px) nézetben egyaránt
- A testtérképnél külön: húzás egérrel és érintéssel, billentyűzetes bevitel,
  nézetváltás, az érték-sorok és a térkép szinkronja
