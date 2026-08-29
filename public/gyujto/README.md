# Gyűjtő

Terepi vonalkód-gyűjtő a FitTrack Pro-ból hiányzó élelmiszerekhez.

Körbejárjuk a boltokat, beszkenneljük a termékek vonalkódját, és az app
megmondja, ismeri-e valaki. Amit nem, azt ott helyben felvisszük — név, márka,
makrók —, és a gyűjtés a **telefonon** gyűlik. A végén egy gombbal feltöltjük
a FitTrack-be, ahol onnantól minden fióknak megvan.

Miért kell? A beépített étel-katalógus (437 tétel) általános
referenciaértékeket ad, az Open Food Facts pedig a magyar polcok jelentős
részét nem ismeri. A FitTrack-ben ilyenkor mindenki külön, a saját fiókjába
viszi fel ugyanazt a terméket — a munka ott ragad, más nem látja.

## Nincs mögötte szerver

Ez a legfontosabb tudnivaló róla. **Nincs saját szervere, nincs fiókja, nincs
szinkronizálása.** Statikus oldal, amit a FitTrack szervere szolgál ki, és
minden mást a telefon csinál:

| Amit csinál | Hogyan |
| --- | --- |
| Tárolás | **IndexedDB** a telefonon (`db.js`) — nem a szerveren |
| Open Food Facts | a **böngésző** hívja közvetlenül (`off.js`), gyorsítótárral |
| Feltöltés | egy gomb: `POST /api/foods/collected` a FitTrack-munkamenettel |
| Biztonsági másolat | JSON-fájl mentése és visszatöltése |

Ebből következik minden más: **offline nincs mit „sorba tenni"**, mert a mentés
már kész — a telefonon van. Hálózat csak két dologhoz kell: az Open Food Facts
lekérdezéshez (enélkül is fel lehet vinni terméket), és a feltöltéshez.

## Indítás

Nincs külön indítás: a FitTrack szervere szolgálja ki.

```bash
npm start        # majd: http://localhost:3000/gyujto/
```

**Telefonon https kell** — a böngésző a kamerát csak https-en vagy localhoston
adja oda. Sima http-n, a gép LAN-IP-jéről nyitva az app működik, de csak a
kézi kódbeírás; a felület ezt ki is írja. Élesben tehát fordított proxy
tanúsítvánnyal, vagy egy alagút.

**Tedd ki a kezdőképernyőre.** Nem kényelmi kérés: a böngésző a saját adatait
kitörölheti, és iOS-en a Safari 7 nap tétlenség után takarít — a kitett appot
viszont békén hagyja. Az app egyszer szól is emiatt. Emellett a *Feltöltés*
fülön bármikor menthetsz fájlba.

## Használat a boltban

1. **Szkennelés indítása** — nagy kamerakép, benne kerettel. Amint egy vonalkód
   a keretbe kerül, feloldja; a kamera végig jár, a „Következő" gombbal
   folytatod. Jobb alul a 💡 bekapcsolja a vakut, ha az eszköz tudja.
2. Az eredmény négyféle lehet:
   - 🟢 **Megvan a gyűjtésben** — már felvittük, nincs teendő;
   - 🔵 **Az Open Food Facts ismeri** — a FitTrack ma is megtalálja; csak akkor
     viszed fel, ha a tápérték hibás vagy hiányos;
   - 🔴 **Ez hiányzik** — az űrlap magától nyílik. Ezért jöttünk;
   - 🟡 **Nincs hálózat / az OFF nem válaszol** — ezt KIMONDJUK, nem
     hallgatjuk el „hiányzik"-ként. Ha kezedben a csomagolás, vidd fel; a
     duplikátumot a feltöltés kiszűri.
3. **Sietsz?** Elég a **név**, és „Mentés piszkozatként". A makrókat otthon
   pótolod — a Gyűjtés fülön szűrhetsz a piszkozatokra.
4. A **kalóriát az app számolja** a makrókból (Atwater 4/4/9) és élőben mutatja;
   ha a csomagoláson más áll (rost, poliolok), felülírható, és egy ↻ gomb
   visszakapcsol az automatikusra.

## Feltöltés a FitTrack-be

A *Feltöltés* fülön, egy gombbal. Mivel a Gyűjtőt **ugyanaz a szerver**
szolgálja ki, a meglévő FitTrack-munkamenet sütije magától megy vele: nincs
külön fiók és nincs külön jelszó. Ha nem vagy belépve, az app megmondja, és
ad egy linket.

Csak a **kész** tételek mennek fel; a piszkozatok maradnak, amíg ki nem
egészíted őket. A szerver mindent újraellenőriz (`parseCollected`,
`server/server.js`) — a Gyűjtő is „csak egy kliens" —, és **tételenként**
válaszol: egy hibás sor nem viheti magával a másik százat.

Ütközéskor a **frissebb felmérés** nyer, nem a későbbi feltöltés: a
`collectedAt` a telefonon rögzített idő. Aki csak hetekkel később jut
hálózathoz, annak a régi adata nem írja felül a tegnapi, pontosabb mérést.

Feltöltés után a FitTrack `/api/foods/barcode/:code` végpontja ebben a
sorrendben keres:

**saját étel → a begyűjtött termékek → `barcode_cache` → Open Food Facts**

A begyűjtött termék tehát hálózat nélkül is felismerhető, és nem hígítja az
általános étel-katalógust: névre keresve nem jön elő, csak vonalkódra.

## Két telefon összefésülése

A *Feltöltés* fülön a **Mentés fájlba** kiírja a teljes gyűjtést egy
JSON-fájlba, a **Visszatöltés fájlból** pedig beolvassa. Ezzel fésülhető össze
két ember gyűjtése is: küldd át a fájlt, töltsd be — ütközéskor itt is a
frissebb felmérés nyer. (Ha mindkét telefon feltölt a FitTrack-be, az is
összefésül; a fájl a net nélküli út.)

## Fájlok

```
public/gyujto/
  index.html   három nézet: szkennelés · gyűjtés · feltöltés
  app.js       felület, nézetváltás, a három kimeneti út
  db.js        IndexedDB: termékek, szkennelés-napló, OFF-gyorsítótár
  off.js       Open Food Facts a böngészőből
  products.js  a termék-űrlap validálása (tiszta függvények)
  scanner.js   a három szintű vonalkód-olvasó
  style.css  sw.js  manifest.webmanifest  icon.svg
public/shared/
  barcode.js     vonalkód-normalizálás + OFF-leképezés — a SZERVER IS ezt használja
  foodgroups.js  az étel-kategóriák — a szerver is innen validál
```

A `public/shared/` a lényeg: a mod-10 ellenőrzőszám, az OFF-leképezés és a
kategórialista **egy példányban** él, és a szerver (`server/openfoodfacts.js`,
`server/data/foods.hu.js`) újra-exportálja. Ha a két oldal másképp
normalizálna, ugyanaz a termék két külön kódon ülne, és a boltban begyűjtött
tétel nem találná meg a párját a FitTrack-ben.

## Tesztek

```bash
npm test
```

- `server/gyujto.test.js` — a validálás és az Atwater-számítás. A modul a
  böngészőben fut, de tiszta ES-modul, tehát Node-ból tesztelhető;
- `server/collected.test.js` — a feltöltés végpontja: jogosultság, a hibás
  tétel kiesése, a vonalkód-alapú frissítés, és hogy a régebbi mérés nem írja
  felül a frissebbet;
- `server/openfoodfacts.test.js` — a közös leképezés és normalizálás.
