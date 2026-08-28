# Gyűjtő

Terepi vonalkód-gyűjtő a FitTrack Pro-ból hiányzó élelmiszerekhez.

Körbejárjuk a boltokat, beszkenneljük a termékek vonalkódját, és az app
megmondja, ismerjük-e már. Amit nem, azt ott helyben felvisszük — név, márka,
makrók —, és egy **közös adatbázisba** gyűjtjük. Később egy export-szkript a
kész tételekből legenerálja a FitTrack vonalkód-termékfájlját.

Miért kell? A beépített étel-katalógus (437 tétel) általános
referenciaértékeket ad, az Open Food Facts pedig a magyar polcok jelentős
részét nem ismeri. A FitTrack-ben ilyenkor mindenki külön, a saját fiókjába
viszi fel ugyanazt a terméket — a munka ott ragad, más nem látja.

## Indítás

Node **22.5 vagy újabb** kell (a beépített `node:sqlite` miatt). Külön
`npm install` nincs: a Gyűjtő a gyökér `node_modules`-ból oldja fel az
`express`-t és a `@zxing/library`-t (a Node felfelé keres a mappákban). A
`gyujto/package.json` a függőségeket azért sorolja fel, hogy a mappa később
önállóan is kiemelhető legyen.

```bash
npm install                 # a REPÓ GYÖKERÉBEN, egyszer
npm run gyujto              # http://localhost:3100
npm run gyujto:test         # a Gyűjtő tesztjei
npm run gyujto:export       # a kész tételek kivitele a FitTrack-be
```

Környezeti változók:

| Változó | Alapérték | Mire jó |
| --- | --- | --- |
| `PORT` | `3100` | A szerver portja |
| `GYUJTO_DB` | `gyujto/gyujto.db` | Az adatbázisfájl útvonala |
| `FITTRACK_OFF_URL` | `https://world.openfoodfacts.org` | Az Open Food Facts címe (teszthez stubra állítható) |
| `FITTRACK_OFF_UA` | `FitTrackPro/0.1 (hobbi projekt)` | Az OFF által megkövetelt azonosító User-Agent |

## Telefonon

A kamera **csak https-en vagy localhoston** indul el — a böngésző sima http-n,
a gép LAN-IP-jéről nyitva oda sem adja. Ilyenkor a **kézi kódbeírás** az
egyetlen működő út, és a felület ezt ki is írja. Ez nem vészmegoldás: a
szkennelés fizikailag is bukhat (karcos csomagolás, rossz fény), ezért a kézi
mező mindig ott van.

Éles használathoz tehát https kell (fordított proxy Let's Encrypt-tel, vagy egy
alagút). Az oldal PWA: a telefon menüjéből kitehető a kezdőképernyőre, és
onnan net nélkül is elindul.

## Használat a boltban

1. **Szkennelés** — nagy kamerakép, és amint a keretbe kerül egy vonalkód,
   feloldja. A találat után a „Következő" gombbal folytatod; a kamera végig jár.
2. Az eredmény háromféle lehet:
   - **Megvan a gyűjtésben** — más már felvitte, nem kell újra;
   - **Az Open Food Facts ismeri** — a FitTrack ma is megtalálja; csak akkor
     viszed fel, ha a tápérték hibás vagy hiányos;
   - **Ez hiányzik** — az űrlap magától nyílik. Ezért jöttünk.
3. **Sietsz?** Elég a **név**, és „Mentés piszkozatként". A makrókat otthon
   pótolod — a lista szűrhető a piszkozatokra.
4. A **kalóriát az app számolja** a makrókból (Atwater 4/4/9) és élőben mutatja;
   ha a csomagoláson más áll (rost, poliolok), felülírható, és egy ↻ gomb
   visszakapcsol az automatikusra. A szerver mindkét ágat ellenőrzi.

## Offline

A boltban gyakran gyenge a net, ezért az app **nem áll meg** nélküle:

- minden szkennelés és minden mentés először a telefon **sorába** kerül
  (`localStorage`), és hálózat esetén egy kéréssel megy fel;
- a fejlécben állandó sáv mutatja, hány tétel vár — rákoppintva azonnal
  szinkronizál;
- a már gyűjtött **vonalkódok listája** is a telefonon van, így offline is
  látod, ha egy terméket már felvittünk (enélkül duplán dolgoznánk);
- minden sorba tett tétel kap egy `clientId`-t: ugyanaz a köteg kétszer
  beküldve **nem duplázódik** — pont akkor számít, amikor a hálózat rossz.

Amire az offline mód **nem** jó: belépni net kell (a már belépett munkamenet
viszont offline is él), és a lista/keresés is a szerverről jön.

## Fájlok

```
gyujto/
  server.js       Express: /api/* + a public/ kiszolgálása
  db.js           SQLite adatréteg (az egyetlen modul, ami a tárolást ismeri)
  products.js     a termék-űrlap validálása (tiszta függvények)
  shared.js       az EGYETLEN híd a fő apphoz — ld. lentebb
  testkit.js      közös teszt-segéd (valódi szerver + helyi OFF-stub)
  scripts/export-products.js   a kész tételek → server/data/products.barcode.js
  public/
    index.html  app.js  scanner.js  style.css  sw.js  manifest.webmanifest  icon.svg
```

### A kapcsolat a FitTrack-kel

A Gyűjtő külön app: saját szerver, saját adatbázis, **saját fiókok** (a
FitTrack-jelszavad ide nem jó). Két dolgot viszont nem írunk meg újra, mert a
másolat garantáltan elcsúszna:

- `server/openfoodfacts.js` — a vonalkód mod-10 ellenőrzőszáma és az Open Food
  Facts leképezése. Ha a két hely másképp normalizálna, ugyanaz a termék két
  külön kódon ülne, és az export nem találna rá;
- `server/auth.js` — jelszó-hash (scrypt) és munkamenet-token. Kriptográfiai
  kódot duplikálni önmagában is hiba.

Mindkettő nulla függőségű, tiszta modul, és mindkettő a `shared.js`-en át jön
be. **Ha a mappát ki kell emelni a repóból:** másold a két fájlt (és a
`ratelimit.js`-t, `data/foods.hu.js`-t) a `gyujto/` mellé, és írd át a
`shared.js` útvonalait. Máshol nincs hivatkozás a fő appra.

## Adatbázis

| Tábla | Mi van benne |
| --- | --- |
| `users`, `sessions` | a Gyűjtő saját fiókjai és munkamenetei |
| `products` | **a gyűjtés** — vonalkódra egyedi, `user_id`-szűrés nélkül: közös adat |
| `scans` | minden szkennelés (a megtaláltaké is); a `client_id` teszi idempotenssé a szinkront |
| `barcode_cache` | vonalkód → Open Food Facts termék, hogy ne kérdezzünk kétszer |

A `products` sorai három állapoton mennek át:

- **piszkozat** — hiányzik valamelyik makró; így is hasznos, csak nem
  exportálható;
- **kesz** — teljes, és átmenne a FitTrack „saját étel" validálásán is;
- **exportalva** — már bekerült a `server/data/products.barcode.js`-be.

Az állapotot mindig a **szerver** dönti el az adat teljessége alapján: a „kész"
azt ígéri, hogy a tétel exportálható, ezt egy kliens nem állíthatja magáról.

## Export — a visszaút

```bash
npm run gyujto:export -- --dry-run   # mi menne ki?
npm run gyujto:export                # a fájl megírása
```

A szkript a `kesz` és a korábban már `exportalva` tételekből **teljes
pillanatképet** ír a `server/data/products.barcode.js`-be (a részleges kiírás
törölné az előző exportot), majd a friss sorokat `exportalva` állapotba viszi.

A FitTrack ezután a `/api/foods/barcode/:code` végponton ebben a sorrendben
keres: **saját étel → a begyűjtött termékek → `barcode_cache` → Open Food
Facts**. A begyűjtött termék tehát hálózat nélkül is felismerhető, és nem
hígítja az általános étel-katalógust: névre keresve nem jön elő, csak
vonalkódra.

## Tesztek

```bash
npm run gyujto:test
```

- `products.test.js` — a validálás és az Atwater-számítás (tiszta függvények);
- `api.test.js` — valódi szerver, eldobható adatbázis, **helyi OFF-stub**: a
  tesztcsomag nem függ az internettől. A stub találat-számlálója teszi
  bizonyíthatóvá, hogy a gyorsítótár tényleg megspórol egy hálózati kört;
- `sync.test.js` — az offline sor: idempotencia, tételenkénti hibakezelés, és
  hogy egy késve érkező régi tétel nem írja felül az újabb szerver-sort;
- `export.test.js` — az export tényleg lefut, érvényes ES-modult ír, és a
  második futás nem törli az elsőt.
