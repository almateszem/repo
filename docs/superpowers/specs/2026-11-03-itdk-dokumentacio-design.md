# ITDK-dokumentáció: előlap, főfejezet-szerkezet, szakirodalom, rezümé — terv

Dátum: 2026-11-03

## Szándék

A Podium fejlesztői dokumentációját (`DOKUMENTACIO.docx.md`) be kell adni az
Intézményi Tudományos Diákköri Konferenciára (2026. november 18.). Az iskola
előírt hozzá egy előlapot (`ITDK előlap 20261118.docx`), egy rezümét
(`resume_sablon 2026 (1).doc`) és egy hat főfejezetes szerkezetet APA 7
szerinti hivatkozásokkal. A dokumentáció tartalma kész; most **csak a
pluszok** kerülnek hozzá. Első lépésben egy Markdown-fájl készül, Word-be
később tesszük át (az nem része ennek a munkának).

## Célok

1. Új fájl: `DOKUMENTACIO-ITDK.md` a repó gyökerében, ebben a sorrendben:
   előlap → rezümé → 1. Bevezetés → 2. Célkitűzés → 3. Szakirodalmi áttekintés
   → 4. Eredmények → 5. Következtetések, javaslatok, összegzés →
   6. Irodalomjegyzék.
2. A meglévő szöveg szó szerint átkerül, csak a címszintek, a fejezetszámok és
   a belső fejezet-hivatkozások változnak.
3. Minden új állítás, amely forrásra épül, APA 7 szövegközi hivatkozást kap,
   és minden hivatkozott forrás szerepel az irodalomjegyzékben (és fordítva).

## Nem cél

- A meglévő szöveg javítása, frissítése vagy bővítése. A 784-es tesztszám, az
  elavult adatok és a 12 `KITÖLTENDŐ` jelölés **változatlanul marad**.
- A Word (.docx) változat elkészítése.
- A régi `DOKUMENTACIO.docx.md` módosítása (érintetlen marad).
- A `DOKUMENTACIO-ITDK.md` commitolása: a régi dokumentációhoz hasonlóan
  nincs a gitben (saját döntés).

## Anti-célok (ettől lenne rossz, még ha „kész” is)

- Kitalált vagy ellenőrizetlen hivatkozás: szerző, év, cím, URL vagy DOI,
  amit a készítő nem látott a forrásnál.
- Olyan forrás a szakirodalomban, amit a projekt valójában nem használt.
- Átfogalmazott vagy „kicsit rendbe tett” régi bekezdés.
- Rossz helyre mutató belső fejezet-hivatkozás.

## Rögzített adatok

**Előlap** (az ITDK-sablon szövege, sorrendben, a helykitöltők helyén):

```
INTÉZMÉNYI TUDOMÁNYOS DIÁKKÖRI KONFERENCIA
2026. november 18.

PODIUM                      ← „A DOLGOZAT CÍME MAGYARUL”
Podium                      ← „A dolgozat címe angolul”

Készítette:
Kovács Valter
Dausek Csanád
Peresztegi Viktor Zsolt
Szoftverfejlesztő és -tesztelő technikus
Kaposvár

Témavezető: Fogarasi András, szakoktató, KIAKK, Kaposvár

Lehetséges OTDK szekció: Informatika

Kaposvár
2026.
```

A cím alcím nélkül, magyarul és angolul is „Podium” (a felhasználó döntése).
A szak mindhárom névnél Szoftverfejlesztő és -tesztelő technikus; az
üzemeltető szak törölve. A „szakoktató” a témavezetői nyilatkozatból
(`podium-temav.pdf`) jön.

**Rezümé fejléce** (a rezümé-sablon szerint):

```
PODIUM                                   (középen, félkövér, nagybetű)
Podium                                   (középen, mondatszerűen)

Készítette: Kovács Valter, Dausek Csanád, Peresztegi Viktor Zsolt,
Kaposvári Informatika Ágazati Képzőközpont, Szoftverfejlesztő és -tesztelő
technikus, Kaposvár
Témavezető: Fogarasi András, oktató, Kaposvári Informatika Ágazati
Képzőközpont
```

A rezümé-sablon „Tóth Imre” nevét és az üzemeltető szakot el kell hagyni.
A témavezető itt „oktató”, mert a rezümé-sablon így írja.

**Rezümé törzse:** magyarul, behúzás nélküli bekezdésekben, 2400–2800
leütés. Ez a Word-változatban (12-es Times New Roman, szimpla sorköz,
2,5 cm-es margó) kb. 28–32 sor, és a sablon legalább 25 sort és legfeljebb
egy A4-es oldalt kér. Tartalma: probléma, cél, megoldás (technológia,
fő funkciók, Recovery Engine), eredmény (tesztek, állapot), kitekintés.
A rezümé nem tartalmaz hivatkozást.

## Szerkezet és átszámozás

| Új hely | Forrás |
|---|---|
| `# 1. Bevezetés` + 1.1–1.4 | régi 1. fejezet, változatlan számozással |
| `# 2. Célkitűzés` | új szöveg |
| `# 3. Szakirodalmi áttekintés` | új szöveg |
| `# 4. Eredmények` | rövid bevezető mondat (új), alatta a régi 2–11. fejezet |
| `## 4.(N−1)` | régi `# N.` (N = 2…11), pl. `# 2. Követelmények` → `## 4.1 Követelmények` |
| `### 4.(N−1).M` | régi `## N.M`, pl. `## 6.3` → `### 4.5.3` |
| `####` | régi `###` (pl. a 6.2 `a)`–`g)` alcímei), betűjelük marad |
| `# 5. Következtetések, javaslatok, összegzés` | 5.1 Következtetések (új), 5.2 Javaslatok (új), 5.3 Összegzés (a régi 12. fejezet szövege, a jelöléseivel együtt) |
| `# 6. Irodalomjegyzék` | új |

A címek formája marad a régi fájlé (`# **4\. Eredmények**`). A régi fájl első
sora (`**Podium – fejlesztői dokumentáció**`) elmarad, mert az előlap adja a
címet (saját döntés).

**Belső hivatkozások:** a régi szövegben minden fejezetszámra mutató
hivatkozást (pl. „lásd 6.3”, „az 5.4 írja le”, „a 6.2 fejezetben”) a
fenti táblázat szerint kell átírni: régi `N.M` → `4.(N−1).M`, régi `N` →
`4.(N−1)`. Az 1.x hivatkozások maradnak. A verziószámok (pl. Node 22.5.0) nem
hivatkozások. A felhasználó külön jóváhagyta, hogy a régi szövegben ez az
egyetlen tartalmi változás.

## Az új fejezetek tartalma

**2. Célkitűzés** (fél–egy oldal): mit akart elérni a csapat. Egy alkalmazás
a három külön eszköz helyett, a Recovery Engine mint felkészültség-becslés,
és a beleegyezésen alapuló edző–sportoló kapcsolat. Mihez mérjük a sikert
(mérhető vagy ellenőrizhető célok). Nem ismétli szó szerint az 1.1-et;
annak a gondolatait célokká bontja. A forrás a meglévő dokumentáció és az
`MVP.md`.

**3. Szakirodalmi áttekintés** (1,5–3 oldal). Témakörönként folyó szöveg,
nem felsorolás: minden forrásnál, hogy mire használtuk. A témakörök:

- *Fejlesztői környezet és szoftverek:* Node.js (≥ 22.5, beépített
  `node:sqlite`), SQLite, Express, ZXing (vonalkód-olvasás a böngészőben),
  ESLint, Prettier.
- *Adatforrások:* Open Food Facts (vonalkódos élelmiszer-adatok, proxyn
  keresztül), a `hasaneyldrm/exercises-dataset` GitHub-repó
  (gyakorlat-katalógus, 1324 gyakorlatból, `scripts/build-exdb.js`), és a
  Gym visual (gymvisual.com) a gyakorlatok képeinek és GIF-jeinek
  szerzője. A felhasználási feltételeit a `public/exercises/ATTRIBUTION.txt`
  idézi.
- *Szakmai módszerek a Recovery Engine és a statisztikák mögött:* az
  Epley-képlet (1RM-becslés), Foster szesszió-RPE módszere (kardió terhelés),
  az RPE/RIR skála (szett-intenzitás), és az, amit az izomfáradtság-modell
  specje (`docs/superpowers/specs/2026-10-08-izomfaradtsag-modell-design.md`)
  és a README kutatási alapként megnevez. Csak az a módszer kerül be, amit a
  kód valóban használ.
- *MI-eszköz:* Claude Code (Anthropic), a fejlesztés támogatására
  (kódírás, kódkritika, tervezés, tesztelés). A csapat más MI-eszközt nem
  használt (a felhasználó megerősítette).

**4. Eredmények** bevezető mondata: egy-két mondat arról, hogy az alábbi
alfejezetek az elkészült rendszert írják le.

**5.1 Következtetések** és **5.2 Javaslatok** (együtt fél–egy oldal):
mennyiben teljesültek a 2. fejezet céljai, és mi a továbbfejlesztés iránya.
Az ismert hiányok a régi 12. fejezetből, a nyitott tételek a `TEENDOK.txt`-ből
jönnek. Nem írja le a csapat személyes tanulságait (az a régi 12. fejezet
`KITÖLTENDŐ` helye, a csapatra marad).

## Hivatkozási formátum

A felhasználó mintái kötelezők, a szögletes zárójeles leírás angolul:

- Szövegközi, zárójeles: `... (OpenJS Foundation, 2026).` Narratív:
  `Az OpenJS Foundation (2026) által gondozott Node.js ...` Verzió
  kiemelése: `(Cisco, 2026, Version 8.2)`.
- Szoftver: `Szerző/Közösség. (Év). Szoftver neve (Version x.y.z) [Computer
  software]. URL` — pl. `OpenJS Foundation. (2026). Node.js (Version 22.0.0)
  [Computer software]. nodejs.org`
- Nagy nyelvi modell / MI-eszköz: `Szerző. (Év). Név (Version x) [Large
  language model]. URL` — a Claude Code-ra ugyanez a forma, a szerző
  `Anthropic`.
- Tudományos cikk, könyv, online adatbázis: APA 7 szokásos formája, DOI-val,
  ha van.

A szoftververziók a projekt valós állapotát mutatják (`package.json`,
`package-lock.json`, a futtatott `node -v`). Az évszám a használt verzió
kiadási éve; ha az nem állapítható meg, a hozzáférés éve (2026). Az
irodalomjegyzék betűrendes. A tudományos forrás minden adatát (szerző, év,
cím, folyóirat, kötet, oldal, DOI) a készítő interneten ellenőrzi; amit nem
talál meg megbízhatóan, az nem kerül be, és a felhasználónak jelzi.

## A készítőre bízott döntések

- Az új szövegek pontos megfogalmazása és hossza a fenti kereteken belül.
- A szakirodalmi áttekintés belső tagolása (alcímek vagy csak bekezdések).
- A rezümé előlap utáni helye (saját döntés, a sablon nem rendelkezik róla);
  oldaltörést Markdownban nem kell jelölni.
- Hogy egy forrás belefér-e, ha a használata a kódban csekély (pl. Prettier):
  a valódi használat dönt.

## Ellenőrzés

- A régi fájl minden nem-cím sora változatlanul megtalálható az új fájlban,
  kivéve a dokumentumcím-sort és a belső hivatkozások számait (géppel
  összevetve).
- Minden szövegközi hivatkozás párja megvan az irodalomjegyzékben, és fordítva.
- A rezümé törzse 2400–2800 leütés.
- Egyik belső hivatkozás sem mutat nem létező vagy rossz fejezetre.
