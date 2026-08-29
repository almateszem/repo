# QR Food Scanner

Önálló, a FitTrack Pro-tól **teljesen független** kis app. Egyetlen dolgot csinál:

```
  ┌──────────────┐   kód   ┌────────────────────┐
  │  QR-olvasó   │ ──────► │ Open Food Facts?   │
  └──────────────┘         └─────────┬──────────┘
        ▲                            │
        │  „benne van"  ◄────────────┤ igen
        │                            │
        │                            ▼ nem
        │                  ┌────────────────────┐
        └──── mentés ◄──── │  makró-táblázat    │ ──► helyi adatbázis
                           └────────────────────┘
```

1. Beolvasod a termék kódját (QR és EAN/UPC vonalkód is megy).
2. Az app megnézi, benne van-e az [Open Food Facts](https://world.openfoodfacts.org) adatbázisában.
3. **Ha benne van:** kiírja, hogy benne van, és visszadob a beolvasóra.
4. **Ha nincs benne:** kitöltöd a makró-táblázatot (fehérje / szénhidrát / zsír / kalória, 100 g vagy 100 ml-re).
5. A kitöltött termék a **helyi adatbázisba** (SQLite, `server/qr-food-scanner.db`) kerül, aztán vissza a beolvasóra.

## Indítás

```bash
cd qr-food-scanner
npm install     # express + @zxing/library
npm start       # http://localhost:4173
```

Fejlesztéshez: `npm run dev` (újraindul mentésre). Tesztek: `npm test`.

Környezeti változók (mind opcionális): `QRFS_PORT`, `QRFS_DB`,
`QRFS_OFF_URL`, `QRFS_OFF_UA`, `QRFS_OFF_TIMEOUT_MS`.

## Kamera

A böngésző a kamerát **csak biztonságos kontextusban** adja oda: `https`-en
vagy `localhost`-on. Ha a telefonodról a géped LAN-IP-jén nyitod meg
(`http://192.168.x.x:4173`), a kamera nem indul el — az app ezt ki is írja, és
ott a kézi kódbeírás. Telefonos használathoz vagy https kell (pl. reverse proxy,
`ngrok`), vagy magán a telefonon fut a szerver.

A dekódolás három szinten próbálkozik:

1. **natív `BarcodeDetector`** — nulla letöltés (Android/Chrome, ChromeOS);
2. **ZXing** (lustán betöltve a `node_modules`-ból) — asztali Chrome, Firefox, Safari;
3. **kézi beírás** — nem vészmegoldás, hanem egyenrangú út.

## Felépítés

| Fájl | Mit csinál |
| --- | --- |
| `server/server.js` | Express: statikus fájlok + három API-végpont |
| `server/openfoodfacts.js` | vonalkód-normalizálás (GS1 mod-10) és OFF-lekérdezés |
| `server/validate.js` | a makró-űrlap ellenőrzése (a szerver nem bízik a kliensben) |
| `server/db.js` | helyi SQLite adatbázis (`node:sqlite`) |
| `public/` | a felület: szkenner-nézet és makró-táblázat |

### API

| Végpont | Válasz |
| --- | --- |
| `GET /api/lookup/:barcode` | `{ barcode, inOpenFoodFacts, product, saved }` — a `saved` a helyi adatbázis sora, ha korábban már kitöltötted |
| `POST /api/products` | a makró-űrlap mentése (ugyanarra a kódra **javít**, nem duplikál) |
| `GET /api/products` | a helyi adatbázis tartalma |

Az OFF-hívás azért megy a szerveren keresztül, mert az Open Food Facts azonosító
`User-Agent`-et vár (névtelen kérésre 403 jár), amit böngészőből nem lehet
beállítani — így ráadásul az app egy-origin marad, CORS nélkül.

> **Hálózat:** ha az OFF nem érhető el, az app **hibát** mond, és NEM kér kézi
> kitöltést — egy pillanatnyi hálózati hiba miatt nem gépelnél be olyan
> terméket, ami valójában benne van az adatbázisban.
