# Lapozott katalógus: gyakorlat-választó és étel-lista szerveroldali kereséssel

Dátum: 2026-10-10 · Állapot: jóváhagyásra vár

## Miért

A gyakorlat-választó és a Táplálkozás oldal ma az app INDULÁSAKOR letölti és
kirajzolja a teljes katalógust: 1441 gyakorlat-kártyát (ebből 1313 képes) és
437 + saját étel-sort — akkor is, ha a felhasználó egyik oldalt sem nyitja meg.
A keresés minden leütésre az összes elemen végigmegy, a választóban mind az
1441 kártya ✓/→ gombját is újraírja.

Mért méretek (helyi adatbázis): a gyakorlat-katalógus válasza 298 KB
(tömörítve 34 KB), az ételeké 62 KB (tömörítve 9 KB). A hálózat ma nem szűk
keresztmetszet; a DOM az, és a katalógus nőni fog. A cél, hogy a kliens mindig
csak egy szeletet kapjon és rajzoljon ki, és a megoldás skálázódjon.

## Döntések (a kérdések alapján)

| Kérdés                 | Döntés                                                                            |
| ---------------------- | --------------------------------------------------------------------------------- |
| Mi a fő szempont       | **A jövőbeli növekedés** — a szerver keres és lapoz                               |
| Mekkora növekedés      | **Még nem tudni** — memóriabeli szűrés, de egy modul mögött, FTS5-re cserélhetően |
| Mit lát gépelés előtt  | **Lapozott lista végtelen görgetéssel** — kívülről ugyanaz a felület              |
| Mikor töltődik a lista | **Az oldal első megnyitásakor**, nem az app indulásakor                           |

Kívül marad: ékezet nélküli keresés („kezallas"), rangsorolás, offline mód.
Az ékezet-független keresés később a keresőmodulban egy helyen pótolható.

## Szerver

### Keresőmodul — `server/catalog-search.js`

Minden katalógus-keresés ezen megy át; a végpontok csak ezt hívják. Belül a
meglévő, memóriában tartott kollekciókból (`getCollection('exerciseCatalog')`,
`getFoodsForUser`) szűr. Ha egyszer FTS5 kell, csak ennek a modulnak a belseje
cserélődik — a végpontok és a kliens nem.

| Függvény                                       | Mit ad                                                          |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `searchExercises({ q, group, offset, limit })` | `{ items, total, nextOffset }`                                  |
| `searchFoods(userId, { q, offset, limit })`    | ugyanaz; a felhasználó SAJÁT ételei elöl, ahogy ma              |
| `exerciseGroups()`                             | a csoportok a katalógus sorrendjében (`Mell`, `Hát`, …)         |
| `foodGroups()`                                 | a beépített ételek kategóriái ábécérendben, „Saját étel" nélkül |
| `findExercisesByName(names)`                   | a megtalált gyakorlatok kártya-alakban                          |
| `findFoodsByName(userId, names)`               | a megtalált ételek, a felhasználó sajátjaival együtt            |

Keresési szabály — azonos a mai kliensoldalival:

- kisbetűsített részszöveg-egyezés;
- gyakorlat: a névben és a felszerelésben keres; étel: a névben, a
  kategóriában és a márkában;
- üres `q` = minden elem;
- a sorrend a katalógus sorrendje (ételeknél a sajátok elöl).

A gyakorlatok kártya-alakja a mai `RESPONSE_PROJECTIONS` vetülete: a `load`,
`loadSource` és `extId` mező nem megy ki a hálózatra.

`nextOffset` = `offset + items.length`, ha van még elem, különben `null`.

### Végpontok

| Végpont                                          | Válasz                                                      |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `GET /api/exercises?q=&group=&offset=0&limit=40` | `{ items, total, nextOffset }`                              |
| `GET /api/exercise-groups`                       | `string[]`                                                  |
| `GET /api/foods?q=&offset=0&limit=40`            | `{ items, total, nextOffset }` — a mai teljes listát váltja |
| `GET /api/food-groups`                           | `string[]`                                                  |
| `GET /api/foods/by-name?name=A&name=B`           | a megtalált ételek tömbje                                   |

- `limit` alapértéke 40, legfeljebb 100. Nem egész, negatív vagy 100 feletti
  `offset`/`limit` → **400**.
- Ismeretlen `group` → **200**, üres lista (érvényes, csak üres keresés).
- `by-name`: legalább 1, legfeljebb 50 név; ezen kívül → 400. Az ismeretlen
  nevek egyszerűen kimaradnak a válaszból.
- Mind bejelentkezést kér (401 nélküle), ahogy a többi `/api` útvonal.
- A `/api/exercise-catalog` **megszűnik**, amikor minden fogyasztója átállt.
  A szerveren belüli `getCollection('exerciseCatalog')` (Recovery Engine,
  ajánlások, terv-ellenőrzés) változatlan.
- Az `/api/exercise-suggestions` válaszában minden javaslat a nevén és az
  indoklásain túl a kártya mezőit is hozza (`tag`, `muscles`, `group`,
  `equipment`, `image`, `gif`, `logMode`) — a kliensnek nem kell a teljes
  katalógusban név szerint keresnie.

## Kliens

### Közös lapozó — `public/js/core/paged-list.js`

```js
const paged = createPagedList({ fetchPage, renderItem, list, onState });
paged.setQuery({ q, group }); // elölről indítja a listát
paged.loadMore(); // a következő oldal, ha van
```

- `fetchPage({ q, group, offset, signal })` → `{ items, total, nextOffset }`.
- **A legutolsó kérés nyer.** Új `setQuery` megszakítja a futó kérést
  (`AbortController`); egy későn érkező régi válasz nem kerül a listára.
- **Görgetés:** a lista végén egy figyelt őrelem (IntersectionObserver);
  amikor látótérbe kerül és `nextOffset !== null`, betölti a következő oldalt.
  Egyszerre legfeljebb egy kérés fut.
- **Állapot:** `onState({ status: 'loading' | 'ready' | 'error', total })` —
  ebből frissül a számláló és az üres-állapot.
- **Hiba:** a lista végén „Nem sikerült betölteni — Újra" sor; a már betöltött
  elemek maradnak. Ha az első oldal sem jön le, ez a sor áll a lista helyén.
- **Megszakított kérés** (AbortError) csendben elmarad — sem toast, sem
  konzol-hiba.
- A gépelés késleltetését (~250 ms) a hívó oldal intézi; a csoport-chip
  azonnal vált.

### Gyakorlat-választó — `public/js/ui/exercise-picker.js`

- **Induláskor nincs letöltés.** A `setupExercisePicker` csak a kezelőket köti
  be. Az első `use()` (az első megnyitás) tölti le a csoport-chipeket és az
  első oldalt; a későbbi `use()`-k csak a „Javasolt" blokkot frissítik.
- A `refresh()` **nem szűr**: csak a fejlécet és a már kirajzolt kártyák ✓/→
  állapotát igazítja. Az újonnan hozzáfűzött oldal kártyái a beszúráskor
  kapják meg a helyes állapotot.
- A hozzáadás/eltávolítás változatlan: a kártya `data-*` mezőiből dolgozik
  (név, `logMode`), teljes katalógus nem kell hozzá.
- A „Javasolt" blokk a szerver kártya-alakú válaszából rajzol; a mai szabály
  marad: csak szűretlen listánál látszik.
- A számláló a `total`-t mutatja, nem a kirajzolt kártyák számát.
- A `content-visibility: auto` CSS és a képek `loading="lazy"`-je marad.

### Táplálkozás oldal — `public/js/ui/nutrition.js`, `public/js/render/foods.js`

- Az étel-lista az oldal **első megnyitásakor** töltődik, a router meglévő
  `nutrition()` hatásából. A napi összesítő, a mai napló, a cél és az edzői
  étrend induláskor marad (kicsik, és az áttekintő is használja őket).
- A `renderFoods` kikerül az `app/init.js` induló listájából; a `render/foods.js`
  egy elemet rajzoló függvényt ad a `paged-list`-nek.
- A nyíl kattintásakor az étel egy név → étel táblából jön, amely a betöltött
  oldalakból épül és új keresésnél kiürül. Az étel-modál ugyanazt az
  objektumot kapja, mint ma.
- Saját étel felvitele/törlése után a `refreshFoods` a mostani kereséssel
  elölről tölti a listát. Az `/api/foods` kliensoldali gyorsítótára megszűnik.

### A többi fogyasztó

- **Saját étel modál** (`ui/custom-food.js`): a kategóriák a
  `/api/food-groups`-ból (kliensoldalon gyorsítótárazva).
- **Profil rekord-felmérő** (`ui/profile.js`): a név-kiegészítő gépelés
  közben (késleltetve) a `/api/exercises?q=…&limit=10` találataival töltődik.
  A szerver továbbra is ellenőrzi a nevet.
- **Edzői étrend-szerkesztő** (`ui/coach-meals.js`):
  - gépeléskor `/api/foods?q=…&limit=10` adja a javaslatokat, a találatok a
    név → étel táblába kerülnek (ebből számol az élő makró-összeg);
  - meglévő étkezés szerkesztésekor a bent lévő tételek egy
    `/api/foods/by-name` kéréssel töltődnek be;
  - mentés előtt a táblában nem talált neveket egy `by-name` kéréssel még
    egyszer megnézi, és csak utána szól, hogy „Ismeretlen étel" — így a
    pontosan begépelt, de nem kiválasztott név is elfogadott.

## Átállás sorrendje

Minden lépés után zöld az `npm test`.

1. Keresőmodul + új végpontok (a régi `/api/exercise-catalog` még él).
2. `paged-list` a tesztjeivel.
3. Gyakorlat-választó és profil átállítása; utána a `/api/exercise-catalog`
   törlése.
4. A `/api/foods` új alakra váltása a Táplálkozás oldallal, a saját étel
   modállal és az edzői szerkesztővel **egy lépésben** — ugyanaz az útvonal
   kap új választ, ezért ezek nem válhatnak szét.
5. Kézi ellenőrzés böngészőben.

## Tesztek

- **Keresőmodul** (`server/catalog-search.test.js`): szűrés névre és
  felszerelésre/kategóriára/márkára, csoport-szűrés, üres `q`, lapozás széle
  (`nextOffset` utolsó oldalon `null`), saját ételek elöl és felhasználónként
  elkülönítve, `findFoodsByName` saját és közös étellel.
- **Végpontok** (az `server/api.test.js` mintájára): válasz-alak, 400-ak a
  hibás paraméterekre, ismeretlen csoport → üres lista, 401 belépés nélkül,
  a `by-name` felső korlátja, a javaslatok kártya-mezői.
- **`paged-list`** (`public/js/core/paged-list.test.js`, kamu `fetchPage`-dzsel):
  elölről indítás, hozzáfűzés, megállás `nextOffset: null`-nál, késve érkező
  régi válasz eldobása, hiba utáni újrapróbálás.
- **Kézi, böngészőben:** a DOM-ot és a görgetést érintő részek (lásd lent).

## Kész, ha

- Az app indulásakor nem megy ki kérés a gyakorlat- és az étel-listáért
  (böngésző hálózati naplója).
- A választóban és az étel-listán megnyitás után legfeljebb 40 elem van a
  DOM-ban, és görgetéssel 40-esével nő.
- A keresés, a csoport-chipek, a ✓/→, a „Javasolt" blokk, a saját étel
  felvitele/törlése/naplózása, az edzői étrend szerkesztése és a profil
  név-kiegészítője ugyanúgy működik, mint ma.
- Az app indulási ideje előtte/utána lemérve (`performance.now()` az `init`
  elején és végén), a számok a jelentésben.
