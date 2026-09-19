# FitTrack Pro — Kód értelmező dokumentum

Ez a dokumentum **fájlonként és sorszám-tartományonként** írja le, hogy a kód
melyik része mit csinál. Nem tervdokumentum és nem funkciólista — arra a
`README.md` (tervezési döntések), a `doc.txt` (mi mit tud) és a `TEENDOK.txt`
(mi hiányzik) való. Itt a **kódot** olvassuk.

Utolsó frissítés: 2026-09-19 · A sorszámok a repó akkori állapotára vonatkoznak.

## Hogyan olvasd

- A táblázatok `Sorok` oszlopa a fájlon belüli sorszám-tartomány (`tól–ig`, mindkét vége beleértve).
- Ahol egy blokk végét a következő blokk kezdete határozza meg, ott a tartomány a köztes
  kommenteket és segédfüggvényeket is magában foglalja.
- Az egysoros nyilas segédfüggvényeknél (`const x = () => …`) a tartomány gyakran 1–3 sor.

## Tartalom

1. [Nagy kép](#1-nagy-kép)
2. [Backend — `server/`](#2-backend--server)
3. [Backend adatfájlok — `server/data/`](#3-backend-adatfájlok--serverdata)
4. [Frontend — `public/index.html`](#4-frontend--publicindexhtml)
5. [Frontend — `public/style.css`](#5-frontend--publicstylecss)
6. [Frontend JS — `public/js/`](#6-frontend-js--publicjs)
7. [Segédszkriptek — `scripts/`](#7-segédszkriptek--scripts)
8. [Tesztek](#8-tesztek)
9. [Konfiguráció és egyéb fájlok](#9-konfiguráció-és-egyéb-fájlok)

---

## 1. Nagy kép

Edző–kliens edzésmenedzsment alkalmazás. **Egyetlen Express szerver** szolgálja ki
a statikus frontendet ÉS a REST API-t, az adat **SQLite**-ban perzisztál
(beépített `node:sqlite`). **Nincs build-lépés és nincs frontend keretrendszer** —
a böngésző natív ES modulokat tölt be.

```
kérés ──► server/server.js  (Express: /api/* végpontok, validáció, jogosultság)
              │
              ├──► server/db.js        (az EGYETLEN modul, ami a tárolást ismeri)
              ├──► server/recovery.js  (készenlét-motor, tiszta számítás)
              ├──► server/coaching.js  (sportoló-összegző, tiszta számítás)
              ├──► server/notifications.js / suggestions.js / muscles.js …
              └──► public/            (statikus frontend)
                       │
                       └──► js/main.js → js/app/init.js → nav/ + render/ + ui/
                                                             ▲
                                                   js/core/api.js (fetch a /api/*-ra)
```

Rétegszabályok, amiket a kód végig betart:

| Réteg                                                                                                                                                | Szabály                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `server/db.js`                                                                                                                                       | Az egyetlen hely, ami SQL-t ismer. Minden olvasó függvény ELSŐ paramétere a `userId`.                 |
| `server/recovery.js`, `coaching.js`, `notifications.js`, `suggestions.js`, `muscles.js`, `auth.js`, `ratelimit.js`, `logmode.js`, `openfoodfacts.js` | Tiszta függvények: nem ismerik sem az adatbázist, sem az Expresst → külön tesztelhetők.               |
| `public/js/core/api.js`                                                                                                                              | Az egyetlen hely a frontenden, ami hálózatot lát. A frontend nem tárol adatot.                        |
| `public/js/nav/`                                                                                                                                     | Nem függ a `ui/`-tól — a kötés a `core/page-hooks.js` horgain át történik (nincs kör a modulgráfban). |

---

## 2. Backend — `server/`

### 2.1 `server/server.js` — Express szerver (3067 sor)

A REST API és a statikus kiszolgálás. A fájl szakaszokra van osztva
`/* ===== … ===== */` bannerekkel.

#### Indítás és globális védőháló

| Sorok   | Mi történik                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1–10    | Fájl-fejléc: egy origin, egy `npm start`, nincs CORS.                                                                                                                                            |
| 11–109  | `express`, `path`, `url` importok + **a `db.js` teljes export-listájának importja** (~100 név).                                                                                                  |
| 110–122 | A naplózási mód (`logmode.js`) és a vonalkód-feloldás (`openfoodfacts.js`) importja.                                                                                                             |
| 123–139 | Az `auth.js` importjai: jelszó-hash, munkamenet-token, süti-kezelés, belépés-zárolás.                                                                                                            |
| 140–151 | A készenlét-motor (`recovery.js`) és a **közös dátum-segédek** importja — a dátumkezelés szándékosan egy helyen lakik.                                                                           |
| 152–165 | `coaching.js`, `notifications.js`, `suggestions.js`, `muscles.js` importok.                                                                                                                      |
| 166–167 | `ratelimit.js` és `errors.js` importok.                                                                                                                                                          |
| 168–172 | `__dirname`, `PUBLIC_DIR`, az `app` példány és a `PORT`.                                                                                                                                         |
| 174–179 | **trust proxy** beállítása a `FITTRACK_TRUST_PROXY`-ból. Enélkül reverse proxy mögött minden kérés a proxy címéről jönne, és a forrásonkénti korlátok az egész forgalomra közös keretet adnának. |
| 181–185 | `guardAsyncRoutes(app)` — a hibakezelés MINDEN útvonal-regisztráció ELŐTT áll be, így egy később felvett async végpont automatikusan védett.                                                     |
| 187–191 | `express.json({ limit: '256kb' })`. A 256 KB kimondott döntés: az alapértelmezett 100 KB a megengedett legnagyobb edzést (50 gyakorlat × 50 szett, ~175 KB) 413-mal dobta volna.                 |

#### Fiókok — belépés, munkamenet, hozzáférés-védelem (193–515)

| Sorok   | Mi történik                                                                                                                                                                                                                     |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 193–199 | Szakasz-banner: minden `/api/*` bejelentkezést követel, az `/api/auth/*` kivételével. A munkamenetet HttpOnly süti hordozza, a DB-ben csak a token SHA-256 lenyomata van.                                                       |
| 201–203 | `SESSION_COOKIE`, `SESSION_DAYS` (30), `SESSION_MAX_AGE`.                                                                                                                                                                       |
| 205–238 | **Kérés-korlátozók**: `registerLimiter` (30 / 60 perc / forrás), `loginLimiter` (60 / 15 perc / forrás), `writeLimiter` (240 / perc / fiók), `messageLimiter` (20 / perc / fiók). Mindegyik limit mellett ott az indoklás.      |
| 240–244 | `requestSource(req)` — a kérés forrása (`req.ip`, fallback a socket címére).                                                                                                                                                    |
| 246–261 | Egyszeri figyelmeztetés a naplóba, ha proxy-fejléc érkezik, de a trust proxy ki van kapcsolva.                                                                                                                                  |
| 263–269 | `tooManyRequests(res, retryAfter, message)` — 429 a szokásos `Retry-After` fejléccel.                                                                                                                                           |
| 271–272 | `isSecureRequest(req)` — HTTPS-e a kérés (a `Secure` süti-jelzőhöz).                                                                                                                                                            |
| 274–284 | `setSessionCookie(req, res, token)` — HttpOnly + SameSite + (HTTPS-en) Secure süti kiírása.                                                                                                                                     |
| 285–286 | `sessionToken(req)` — a süti kiolvasása a `Cookie` fejlécből.                                                                                                                                                                   |
| 288–305 | `startSession(req, res, userId)` — token generálás, a **lenyomat** mentése a DB-be, süti kiírása.                                                                                                                               |
| 306–307 | `withOnboarding(user)` — a felhasználó mellé teszi, hogy volt-e már check-inje (onboarding kapu).                                                                                                                               |
| 308–316 | `GET /api/auth/me` — ki van bejelentkezve; üres adatbázison `firstRun` jelzés.                                                                                                                                                  |
| 317–334 | `parseCredentials(body)` — felhasználónév/jelszó validálás (`USERNAME_RE`, `PASSWORD_MIN`).                                                                                                                                     |
| 335–360 | `POST /api/auth/register` — regisztráció, korlátozva, névütközésre 409.                                                                                                                                                         |
| 361–405 | `POST /api/auth/login` — belépés. **Nem árulja el**, a név vagy a jelszó volt-e rossz (`verifyAgainstDummy` az időzítés-támadás ellen), és zárolja a fiókot túl sok hiba után.                                                  |
| 406–415 | `POST /api/auth/logout` — a munkamenet törlése a DB-ből és a süti lejáratása.                                                                                                                                                   |
| 416–436 | **Hozzáférés-védelem**: minden `/api/*` kérés felhasználót igényel; a hiányzó/lejárt munkamenet 401. Innentől minden kezelő számíthat a `req.user`-re.                                                                          |
| 437–456 | Írás-korlátozó middleware a mutáló (`POST/PUT/DELETE`) kérésekre.                                                                                                                                                               |
| 457–463 | `formatDate(date)` és `serverToday()` — „ÉÉÉÉ.HH.NN" alak.                                                                                                                                                                      |
| 464–481 | **A kérés napja** — a hosszú indoklás: korábban a SZERVER helyi napja számított, ami UTC-s szerveren a magyar felhasználónak este 10 után már a következő napra könyvelt. Itt áll a `CLIENT_DATE_RE` és a `CLIENT_DATE_HEADER`. |
| 482–495 | `requestDate(req)` — az **`X-Client-Date` fejléc** feldolgozása: a naplózás a FELHASZNÁLÓ napjára megy, de a távoli dátumot nem fogadja el (nem visszadátumozásra való).                                                        |
| 496–514 | `shiftDate`, `weekdayOf` (0 = hétfő), `normalizeDays` — a terv-ütemezés napjaihoz.                                                                                                                                              |

#### Olvasó API-végpontok és felhasználói profil (516–738)

| Sorok   | Mi történik                                                                                                                                                                                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 516–524 | Banner: az adat-seam szerver-oldali vége; az útvonal → collections-kulcs megfeleltetés egy helyen. A `weight-log` és a `/api/foods` szándékosan kimarad (fiókfüggő).                                                                                              |
| 525–536 | `READ_ENDPOINTS` — útvonal → collections-kulcs. A `/api/notifications` és a sportoló-lista szándékosan NINCS köztük: azok nem referencia-adatok.                                                                                                                  |
| 538–546 | `RESPONSE_PROJECTIONS` — **mezőszűrés a válaszhoz**: a kollekció a DB-ben teljes marad (a motor a `load` súlyokból dolgozik), de a hálózatra nem megy ki, amire a felületnek nincs szüksége. Az 1401 soros gyakorlat-katalógusnál ez a válasz negyedét lefaragja. |
| 548–557 | A végpontok regisztrálása ciklusban.                                                                                                                                                                                                                              |
| 558–570 | `goalTag(key)`, `userPayload(user)` — a kifelé adott felhasználó-objektum (jelszó-hash nélkül).                                                                                                                                                                   |
| 571–584 | `GET /api/user`, `PUT /api/user` — profilnév és edzés-cél.                                                                                                                                                                                                        |
| 585–596 | Banner: a fiók-műveletek bejelentkezést ÉS a jelenlegi jelszót is kérik.                                                                                                                                                                                          |
| 600–640 | `PUT /api/auth/password` — jelszóváltás. Utána a **többi eszköz kiesik**, a változtató böngészője bent marad.                                                                                                                                                     |
| 641–673 | `POST /api/auth/delete-account` — fióktörlés jelszóval; mindent visz (naplók, kapcsolatok, üzenetek a másik félnél is).                                                                                                                                           |
| 674–680 | `isWorkSet(set)` — munkaszett-e (a bemelegítő nem számít bele a statisztikákba).                                                                                                                                                                                  |
| 681–737 | `GET /api/profile` — a profiloldal összesítői: összes edzés, volumen, sorozat, testsúly-változás.                                                                                                                                                                 |

#### Edző–sportoló kapcsolatok és üzenetek (739–1085)

| Sorok     | Mi történik                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 739–751   | Banner: a kapcsolat mindig **beleegyezéssel** jön létre; a `linkId` önmagában nem jogosít semmire.                                                   |
| 774–796   | `exerciseNotes(userId, workouts)` — a sportoló gyakorlat-megjegyzéseinek összegyűjtése.                                                              |
| 797–872   | `athleteCard(athlete, today, viewerId, unread)` — egy sportoló-kártya összeállítása: lefuttatja rá a készenléti riportot és a `buildAthleteCard`-ot. |
| 873–884   | `invitePayload(…)` — meghívó kifelé adott alakja.                                                                                                    |
| 885–896   | `GET /api/athletes` — az edző sportolói (kártyákkal).                                                                                                |
| 897–933   | `POST /api/athletes` — meghívó küldése **felhasználónévre**; az ismeretlen név és az önmeghívás elutasítva.                                          |
| 934–946   | `DELETE /api/athletes/:linkId` — kapcsolat bontása edzői oldalról.                                                                                   |
| 947–971   | `coachPayload(…)` és `GET /api/coach` — a sportoló saját edzője + a hozzá érkezett függő meghívók.                                                   |
| 972–998   | `POST /api/coach/invites/:linkId/accept`, `DELETE /api/coach/invites/:linkId` — meghívó elfogadása/elutasítása.                                      |
| 999–1009  | `DELETE /api/coach` — kapcsolat bontása sportolói oldalról.                                                                                          |
| 1010–1033 | `activeLinkFor(user, rawLinkId)`, `partnerOf(link, user)` — **jogosultság-ellenőrzés**: a hívó melyik oldala a kapcsolatnak.                         |
| 1034–1045 | `messagePayload(message, userId)` — az üzenet a NÉZŐ szemszögéből jelölve (`me`).                                                                    |
| 1046–1085 | `GET/POST /api/messages/:linkId` és `POST /api/messages/:linkId/read` — üzenet-szál, küldés (szigorúbb korláttal), olvasás-nyugtázás.                |

#### Terv-kiosztás (1086–1172)

| Sorok     | Mi történik                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1086–1098 | Banner: az edző **felajánl**, a sportoló elfogad/elutasít. Ami átmegy, az **pillanatkép** — az edző későbbi szerkesztése nem változtatja meg némán. |
| 1105–1116 | `offerPayload(offer, from)`.                                                                                                                        |
| 1117–1144 | `POST /api/athletes/:linkId/plan` — terv felajánlása a sportolónak.                                                                                 |
| 1145–1154 | `pendingOfferFor(userId, rawId)` — a függő ajánlat megkeresése + jogosultság.                                                                       |
| 1155–1172 | `POST /api/plan-offers/:id/accept`, `DELETE /api/plan-offers/:id`.                                                                                  |

#### Értesítések és áttekintő (1173–1344)

| Sorok     | Mi történik                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1173–1180 | Banner: a panel a HÍVÓ valódi eseményeiből áll össze, nem beégetett demo-listából.                                                     |
| 1185–1253 | `GET /api/notifications` — összegyűjti a hat eseménytípus adatát, és a `buildNotifications` tiszta függvénynek adja.                   |
| 1254–1285 | `workoutTemplate(userId, today)` — mit lásson a felhasználó az Edzés oldalon: aznapi piszkozat, vagy a mára ütemezett terv, vagy üres. |
| 1286–1291 | `parseRowId(raw)` — pozitív egész azonosító ellenőrzése.                                                                               |
| 1292–1344 | `GET /api/dashboard` — az áttekintő összes adata egy válaszban.                                                                        |

#### Recovery Engine — készenlét és check-in (1345–1371)

| Sorok     | Mi történik                                                                           |
| --------- | ------------------------------------------------------------------------------------- |
| 1345–1347 | Banner.                                                                               |
| 1351–1356 | `GET /api/readiness` — a készenléti riport.                                           |
| 1357–1371 | `GET /api/exercise-suggestions` — ajánlott gyakorlatok a címből + a regeneráltságból. |

#### Biztonsági átnézés — a készenlét megjelöli a tervet (1372–1441)

| Sorok     | Mi történik                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1372–1381 | Banner: a rendszer **nem írja át** a tervet (az elrejtené az edző elől, mi történt), hanem MEGJELÖLI, mi kockázatos ma, és miért. A jelzés a gyakorlat → izomcsoport leképezésből dolgozik, nem a naplóból. |
| 1406–1441 | `planSafetyChecker(userId, todayDate)` — visszaad egy függvényt, ami gyakorlatnévre megmondja, ma kockázatos-e.                                                                                             |

#### Készenlét-alapú javaslat a mai edzésre (1442–1601)

| Sorok     | Mi történik                                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1442–1457 | Banner: a javaslat a mai **naplót (piszkozatot)** módosítja, SOHA nem a tervet. Két dolgot sosem bánt: a már teljesített szetteket és a nem szám súlyokat. |
| 1468–1475 | `weightText(value)` — súly szöveges alakja.                                                                                                                |
| 1476–1541 | `sessionAdvice(userId, todayDate)` — konkrét, elfogadható javaslat összeállítása (mit vegyünk le, mennyivel, miért).                                       |
| 1542–1587 | `applySessionAdvice(userId, todayDate)` — a javaslat **alkalmazása** a piszkozatra.                                                                        |
| 1588–1596 | `GET /api/readiness/advice`, `POST /api/readiness/advice/apply`.                                                                                           |

#### Napi check-in, víz, tervek, PR-ek, diagramok (1597–2225)

| Sorok     | Mi történik                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1597–1601 | `GET /api/checkin` — a mai check-in.                                                                                                      |
| 1602–1623 | `readOptionalNumber(raw, { min, max, integer })` — hiányzó mezőből `null`, nem 0.                                                         |
| 1624–1641 | `normalizeMuscleMap(raw, max, allowGeneral)` — izomcsoportonkénti izomláz/fájdalom térkép validálása.                                     |
| 1642–1702 | `PUT /api/checkin` — a napi check-in mentése (teljes sort ír felül; ezért küldi vissza a varázsló a nem kérdezett mezőket változatlanul). |
| 1703–1716 | `syncHydration`, `waterDay` — a víznapló és a check-in folyadék-mezőjének összehangolása.                                                 |
| 1717–1747 | `GET/POST /api/water`, `DELETE /api/water/:id` — vízmérő. Minden korty a készenléti pontszámot is elmozdítja.                             |
| 1748–1813 | `GET /api/plans`, `DELETE /api/plans/:id` — a felhasználó tervei (a kiosztott terveken a **biztonsági jelzéssel**).                       |
| 1814–1821 | `GET /api/workout-template`.                                                                                                              |
| 1822–1852 | `prEntryFor(userId, workout, exercise)` — egy edzéshez tartozó PR-bejegyzés.                                                              |
| 1853–1894 | `GET /api/prs`, `GET /api/prs/history` — egyéni csúcsok és előzményük.                                                                    |
| 1895–1910 | `GET /api/exercise-maxes` — gyakorlatonkénti csúcsok (a napló PR-jelzőjéhez).                                                             |
| 1911–1920 | `trainingStreak(workouts, today)` — edzés-sorozat.                                                                                        |
| 1921–1940 | `readinessReport(userId, todayDate, workouts)` — a `computeReadiness` hívásához összegyűjti az adatot.                                    |
| 1941–2009 | `mondayOf(date)`, `volumeTrend(userId, today)` — heti bontású terhelés-trend.                                                             |
| 2010–2064 | `volumeCharts(userId, today)` + `GET /api/charts` — az oszlopdiagramok adatai.                                                            |
| 2065–2112 | `GET /api/weight-log`, `/api/foods`, `/api/nutrition`, `/api/measurements(/sites)`, `/api/cardio-intensities`.                            |
| 2113–2166 | `PUT /api/measurements`, `DELETE /api/measurements/:id` — testösszetétel-mérések.                                                         |
| 2167–2212 | `parseGoalBody`, a napi táplálkozási cél végpontjai — **két forrás**: amit az edző tűzött ki, és amit te.                                 |
| 2213–2225 | `GET /api/nutrition/log`, `/api/workouts`, `/api/workout-draft`, `/api/export` (teljes saját pillanatkép).                                |

#### Írás-végpontok (2226–2345)

| Sorok     | Mi történik                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------- |
| 2226–2228 | Banner: innentől a SQLite-ot módosító `POST/PUT/DELETE` végpontok.                                  |
| 2239–2255 | `POST /api/weight-log` — testsúly-bejegyzés.                                                        |
| 2256–2280 | `POST /api/nutrition/log` — étel naplózása adaggal.                                                 |
| 2281–2313 | `PUT/DELETE /api/weight-log/:id`.                                                                   |
| 2314–2345 | `PUT/DELETE /api/nutrition/log/:id` — az adag javítása a kerekítetlen 100 g-os alapértékből számol. |

#### Saját ételek és vonalkód (2346–2556)

| Sorok     | Mi történik                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 2346–2353 | Banner: a beépített katalógus általános referencia; egy konkrét bolti termék ettől jócskán eltérhet, ezért lehet sajátot felvinni. |
| 2365–2400 | `macroValue(raw)`, `normalizePortions(raw)` — makró- és adag-validálás.                                                            |
| 2401–2501 | `POST /api/foods/custom` — saját étel felvitele (Atwater-ellenőrzéssel, névütközés-kezeléssel).                                    |
| 2502–2520 | `DELETE /api/foods/custom/:id`.                                                                                                    |
| 2521–2556 | `GET /api/foods/barcode/:code` — vonalkód feloldása: előbb a saját ételek, aztán a gyorsítótár, végül az Open Food Facts.          |

#### Az edzés-törzs normalizálása (2557–2757)

| Sorok     | Mi történik                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2557–2575 | `normalizeRpe(raw)`.                                                                                                                               |
| 2576–2592 | `normalizeSetType(raw, index, prevType)` — bemelegítő / munka / drop szett.                                                                        |
| 2593–2609 | `nonNegativeField(value)`.                                                                                                                         |
| 2610–2620 | `exerciseLimitError(raw)` — 50 gyakorlat / 50 szett felett 400 (DoS-korlát).                                                                       |
| 2621–2691 | `normalizeExercises(raw)` — **a beérkező edzés-törzs teljes megtisztítása**: nevek, szettek, naplózási mód (reps/duration), időtartam, intenzitás. |
| 2692–2706 | `parsePlanBody(body)`.                                                                                                                             |
| 2707–2726 | `POST /api/plans`, `PUT /api/plans/:id`.                                                                                                           |
| 2727–2757 | `parseWorkoutBody(body)`, `POST /api/workouts` — edzés mentése.                                                                                    |

#### Megjegyzések egy gyakorlathoz (2758–3028)

| Sorok     | Mi történik                                                                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2758–2768 | Banner: nem üzenetek — egy konkrét gyakorlathoz tapadnak. A **címzés**: a sajátodat id nélkül éred el, a sportolódét a KAPCSOLAT azonosítójával; a sportoló belső user-id-je nem kerül ki az edzőhöz. |
| 2778–2798 | `parseCommentBody(body)`, `athleteOfLink(user, rawLinkId)`.                                                                                                                                           |
| 2799–2826 | `GET/POST/DELETE /api/comments…` — saját megjegyzések.                                                                                                                                                |
| 2827–2862 | `GET/POST /api/athletes/:linkId/comments` — az edző megjegyzései a sportolónál.                                                                                                                       |
| 2863–2918 | `POST/GET /api/strength-assessment` — **erőfelmérés**: bemondott csúcsok (legfeljebb 12 ismétlés), hogy a friss fiók ne várjon hetekig javaslatra.                                                    |
| 2919–2961 | `PUT /api/workouts/:id/feedback` — edzés utáni visszajelzés az edzőnek.                                                                                                                               |
| 2962–2991 | `PUT/DELETE /api/workouts/:id`.                                                                                                                                                                       |
| 2992–3024 | `PUT/DELETE /api/workout-draft` — a napló automatikus mentése.                                                                                                                                        |
| 3025–3028 | Ismeretlen `/api/*` útvonal → JSON 404 (nem a `index.html`).                                                                                                                                          |

#### Statikus kiszolgálás és indulás (3029–3067)

| Sorok     | Mi történik                                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3029–3033 | Banner: a statikus kiszolgálás az API-útvonalak UTÁN, kizárólag a `public/` mappából — a szerver-belső így eleve nem érhető el, nem kell tiltólista. |
| 3035–3046 | `/vendor/zxing` — a `node_modules`-ból **ez az egy** mappa kerül ki (336 KB-os vonalkód-dekóder, lustán töltve).                                     |
| 3048      | `express.static(PUBLIC_DIR)`.                                                                                                                        |
| 3050–3053 | `apiErrorHandler` — az ÖSSZES útvonal után; a veremkép a logba megy, a kliens JSON-t kap.                                                            |
| 3055–3062 | `app.listen` — a **ténylegesen kiosztott** portot írja ki (PORT=0 esetén az OS választ; a végponti teszt ebből a sorból olvassa ki).                 |
| 3064–3067 | `installProcessGuards(server)` — a kérés-kezelésen kívül eső hibák naplózása.                                                                        |

---

### 2.2 `server/db.js` — SQLite adatréteg (2718 sor)

**Az egyetlen modul, ami a tárolást ismeri.** Ha Postgresre váltanánk, elég ezt átírni.

| Sorok     | Mi történik                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–20      | Fájl-fejléc: a hibrid séma magyarázata — `collections` (közös referencia-adat, minden indításkor újraseedelve) vs. felhasználói táblák (`user_id`-vel, sosem felülírva).                                                                                                                                                                                                                                                                                               |
| 21–31     | Importok, `DB_PATH` (`FITTRACK_DB` env-változóval felülírható).                                                                                                                                                                                                                                                                                                                                                                                                        |
| 33–42     | `dbExisted` — volt-e már adatbázisfájl. Ez a legolcsóbb **ellenőrizhető jele** annak, hogy a tároló perzisztens-e: ephemeral fájlrendszeren minden deploy után „ÚJ adatbázis" jönne.                                                                                                                                                                                                                                                                                   |
| 44–54     | PRAGMA-k: `journal_mode = WAL` (az autosave nem akad össze az olvasásokkal), `synchronous = NORMAL`, `foreign_keys = ON`.                                                                                                                                                                                                                                                                                                                                              |
| 56–336    | **A séma.** `CREATE TABLE IF NOT EXISTS`: `collections` (59), `users` (65), `sessions` (74), `weight_log` (81), `nutrition_log` (88), `custom_foods` (105), `comments` (161) + index, `body_measurements` (181) + index, `water_log` (197) + index, `nutrition_goals` (207), `barcode_cache` (217), `workouts` (223), `plans` (235), `workout_draft` (246), `checkins` (262), `coach_links` (280), `messages` (296), `plan_assignments` (313), `exercise_maxes` (327). |
| 337–341   | Banner: a `CREATE TABLE IF NOT EXISTS` a meglévő táblákat nem bővíti — az utólag bevezetett oszlopokat itt pótoljuk.                                                                                                                                                                                                                                                                                                                                                   |
| 343–349   | `columnsOf(table)`, `hasColumn(table, column)`.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 350–411   | `ensureColumn(table, column, ddl)` — oszlop-pótlás a régebbi DB-fájlokon.                                                                                                                                                                                                                                                                                                                                                                                              |
| 412–424   | `USER_DATA_TABLES`, `LEGACY_USERNAME` (`__archiv__`).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 425–452   | `ensureLegacyUser()` — a fiókok bevezetése előtti, gazdátlan adat archív fiók alá kerül; belépni vele nem lehet.                                                                                                                                                                                                                                                                                                                                                       |
| 453–477   | `rebuildWorkoutDraft()` — tábla-átépítés (`workout_draft_new`, 460).                                                                                                                                                                                                                                                                                                                                                                                                   |
| 478–528   | `rebuildCheckins()` — tábla-átépítés (`checkins_new`, 488).                                                                                                                                                                                                                                                                                                                                                                                                            |
| 529–571   | `rebuildExerciseMaxes()` — tábla-átépítés (`exercise_maxes_new`, 534).                                                                                                                                                                                                                                                                                                                                                                                                 |
| 572–631   | `firstNumber(raw)`, `migrateSetValuesToNumbers(table, key)` — a szöveges szett-értékek számmá alakítása a régi sorokban.                                                                                                                                                                                                                                                                                                                                               |
| 632–651   | `backfillExerciseMaxes()` — a PR-követés előtti edzésekből visszatölti az egyéni csúcsokat.                                                                                                                                                                                                                                                                                                                                                                            |
| 652–661   | **Séma-verzió** (`PRAGMA user_version`): v1-re az 1RM-képlet váltása miatt újraszámolja a mért csúcsokat.                                                                                                                                                                                                                                                                                                                                                              |
| 662–694   | **Indexek** — a migrációk UTÁN, mert a tábla-átépítés eldobja őket. Köztük az `idx_messages_unread` **részleges index** (csak az olvasatlan sorokra), és az összetett `idx_nutrition_log_user_date`.                                                                                                                                                                                                                                                                   |
| 696–724   | **Seed**: a `data.js` + `catalog.js` tartalma `INSERT OR REPLACE`-szel; az időközben eltávolított kulcsok törlődnek.                                                                                                                                                                                                                                                                                                                                                   |
| 725–736   | Indulási kiírás: a feloldott DB-útvonal és a figyelmeztetés ephemeral tárolóra.                                                                                                                                                                                                                                                                                                                                                                                        |
| 738–740   | Banner: **Fiókok és munkamenetek**.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 743–753   | `toUser(row)`, `toPublicUser(row)` — a jelszó-hash sosem kerül kifelé.                                                                                                                                                                                                                                                                                                                                                                                                 |
| 754–809   | `getUserWithHash`, `getUser`, `getUserCreatedAt`, `getUserGoal`, `setUserGoal`, `findUserByUsername`, `hasAnyUser`.                                                                                                                                                                                                                                                                                                                                                    |
| 810–843   | `adoptLegacyData(newUserId)` — az ELSŐ regisztráció megörökli az archív adatot; a második már nem. `createUser`.                                                                                                                                                                                                                                                                                                                                                       |
| 844–894   | `updateUserPassword`, `deleteUserSessions`, `deleteUser` (kaszkádolva mindent visz).                                                                                                                                                                                                                                                                                                                                                                                   |
| 895–934   | `createSession`, `getSessionUser`, `deleteSession`, `purgeExpiredSessions`.                                                                                                                                                                                                                                                                                                                                                                                            |
| 936–945   | Banner: **Edző–sportoló kapcsolatok**. A kapcsolat IRÁNYÍTOTT (edző hív → sportoló fogad el); a sportolónak egyszerre egy aktív edzője lehet.                                                                                                                                                                                                                                                                                                                          |
| 949–1072  | `toIso`, `createCoachInvite`, `getCoachLink`, `getActiveCoach`, `getPendingCoachInvites`, `getCoachAthletes`, `acceptCoachInvite`, `deleteCoachLink`.                                                                                                                                                                                                                                                                                                                  |
| 1073–1170 | Üzenetek: `toMessage`, `MESSAGE_COLUMNS`, `getMessages`, `getLastMessage`, `addMessage`, `markMessagesRead` (csak a másik fél üzeneteit, idempotensen), `getUnreadCounts` (egyetlen lekérdezés az összes szálra).                                                                                                                                                                                                                                                      |
| 1171–1282 | Terv-kiosztás: `toAssignment`, `ASSIGNMENT_FIELDS/COLUMNS`, `assignPlan`, `getPlanAssignment`, `getPendingPlanOffers`, `getAnsweredPlanOffers`, `resolvePlanAssignment`.                                                                                                                                                                                                                                                                                               |
| 1283–1287 | Banner: **Olvasás** — MINDEN függvény első paramétere a `userId`. Szándékos: a hiánya azonnal hibás eredményt adna, így nem lehet „véletlenül" szűretlenül hívni.                                                                                                                                                                                                                                                                                                      |
| 1301–1316 | `CACHED_COLLECTIONS` (`exerciseCatalog`, `foods`), `collectionCache`, `getCollection(key)` — a két nagy referencia-lista cache-elve, a fiókfüggő kulcsok NEM.                                                                                                                                                                                                                                                                                                          |
| 1317–1361 | `getWeightLog`, `getWeightLogSince`, `getNutritionLog`, `getNutritionLogForDate`.                                                                                                                                                                                                                                                                                                                                                                                      |
| 1362–1431 | Megjegyzések: `toComment`, `COMMENT_SELECT`, `getComments`, `getCommentsByTarget`, `addComment`, `deleteComment`.                                                                                                                                                                                                                                                                                                                                                      |
| 1432–1473 | Víznapló: `getWaterDay`, `addWaterEntry`, `deleteWaterEntry`, `replaceWaterDay`.                                                                                                                                                                                                                                                                                                                                                                                       |
| 1474–1508 | Testösszetétel: `getMeasurements`, `saveMeasurements`, `deleteMeasurement`.                                                                                                                                                                                                                                                                                                                                                                                            |
| 1509–1585 | Táplálkozási cél: `toGoalRow`, `GOAL_SELECT`, `getNutritionGoalRow`, `getNutritionGoal` (az edzői cél elsőbbsége), `saveNutritionGoal`, `clearOwnNutritionGoal`.                                                                                                                                                                                                                                                                                                       |
| 1586–1601 | `getNutritionTotals(userId, date)` — a napi összesítő.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 1602–1607 | Banner: **Saját ételek** — a beépített katalógussal AZONOS alakot adnak vissza, csak a `custom: true` jelző különbözteti meg őket, így a naplózás változtatás nélkül működik.                                                                                                                                                                                                                                                                                          |
| 1612–1683 | `toCustomFood`, `CUSTOM_FOOD_COLS`, `listCustomFoods`, `getCustomFoodByName`, `getCustomFoodByBarcode`, `customNameTaken`.                                                                                                                                                                                                                                                                                                                                             |
| 1684–1752 | `addCustomFood`, `deleteCustomFood`, `getFoodsForUser` (saját ételek elöl), `findFoodForUser`.                                                                                                                                                                                                                                                                                                                                                                         |
| 1753–1779 | `readBarcodeCache`, `writeBarcodeCache` — az Open Food Facts válaszainak gyorsítótára.                                                                                                                                                                                                                                                                                                                                                                                 |
| 1780–1868 | Check-in: `toCheckin`, `CHECKIN_COLUMNS`, `getCheckin`, `getCheckins`, `hasAnyCheckin`, `saveCheckin` (`ON CONFLICT … SET` **minden** oszlopra → teljes sort ír felül).                                                                                                                                                                                                                                                                                                |
| 1870–1910 | `calculateEpley1RM(weight, reps)`, `bestCompletedSet(sets, …)` — a legjobb TELJESÍTETT szett (a bemelegítő nem számít).                                                                                                                                                                                                                                                                                                                                                |
| 1911–2005 | Csúcsok: `getExerciseMax`, `getAllExerciseMaxes`, `getRecentExerciseMaxes`, `setDeclaredMax` (bemondott), `getDeclaredMaxes`.                                                                                                                                                                                                                                                                                                                                          |
| 2006–2167 | `updateExerciseMax` (új rekord esetén), `recomputeExerciseMaxes` — a napló alapján teljes újraszámolás (edzés-törlés és migráció után).                                                                                                                                                                                                                                                                                                                                |
| 2168–2231 | Tervek és piszkozat: `getUserPlanSchedules`, `getPlan`, `getUserPlans`, `getPlanForDay`, `getWorkoutDraft`.                                                                                                                                                                                                                                                                                                                                                            |
| 2232–2345 | Edzések olvasása: `toWorkout`, `getWorkouts`, `getWorkoutsSince`, `getWorkoutDates`, `getSnapshot` (a teljes saját export).                                                                                                                                                                                                                                                                                                                                            |
| 2346–2434 | Írások: `updateWeightEntry`, `deleteWeightEntry`, `addWeightEntry`, `addNutritionEntry`.                                                                                                                                                                                                                                                                                                                                                                               |
| 2434–2517 | `updateNutritionEntry`, `deleteNutritionEntry`, `saveWorkoutDraft`, `clearWorkoutDraft`.                                                                                                                                                                                                                                                                                                                                                                               |
| 2518–2606 | `addWorkout` (mentéskor frissíti a csúcsokat), `deleteWorkout` (törléskor újraszámolja őket).                                                                                                                                                                                                                                                                                                                                                                          |
| 2607–2656 | `getAthleteFeedbackSince`, `getWorkout`, `saveWorkoutFeedback`.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2657–2715 | `updateWorkout`, `deletePlan`, `addPlan`, `updatePlan`.                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2716–2718 | `closeDatabase()` — a tesztek zárják vele a fájlt.                                                                                                                                                                                                                                                                                                                                                                                                                     |

---

### 2.3 `server/recovery.js` — Recovery Engine (1173 sor)

A készenlét-számítás. **Nem ismeri az adatbázist** — tiszta függvények, a
`recovery.test.js` közvetlenül teszteli őket.

| Sorok     | Mi történik                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–53      | Fájl-fejléc: a modell felépítése és a döntések indoklása.                                                                                                                                                                                                                                                                                                                                                               |
| 54–92     | **Dátum-segédek**: `DAY_MS`, `parseDate`, `dayKey`, `shiftDayKey`, `daysBetween`, `daysAgo`. A `server.js` is innen importálja őket, hogy egyetlen implementáció legyen (DST-biztos — `dst.test.js`).                                                                                                                                                                                                                   |
| 93–123    | Általános segédek: `formatDecimal`, `clamp01`, `clamp`, `num`, `mean`, `median`.                                                                                                                                                                                                                                                                                                                                        |
| 124–221   | **Hangolható paraméterek egy helyen**: `BASE_WEIGHTS` (komponens-súlyok, 138), `COMPONENT_LABELS` (148), `SUBJECTIVE_FLOOR` (161), időállandók `TAU_LOAD`/`TAU_CNS` (163–164), ablakok (166–168), személyes referencia (172–178), `PR_CNS_SURCHARGE` (181), `SLEEP_TARGET_HOURS` (186), `hydrationTarget` (191, ~33 ml/testsúly-kg), abszolút referenciák (194–213), `MAIN_LIFTS`, `MIN_SESSIONS`, `MAX_EXERCISE_RECS`. |
| 222–349   | **Terhelés-számítás a mentett edzésekből**: `SRPE_TONNES_PER_AU` (264), kardió-terhelés (`cardioSetLoad`, 270), `rpeFactor` (281), `SET_TYPE_STIMULUS` (299; bemelegítő = 0, munka = 1, drop = 0.5), `setLoad` (306), `setStimulus` (323).                                                                                                                                                                              |
| 351–369   | `estimate1RM(weight, reps, rir)` és `epley1RM(reps, weight, rpe)` — az 1RM-becslés. Ugyanez a képlet él a kliensen (`public/js/core/one-rm.js`), a `one-rm.test.js` köti össze a kettőt.                                                                                                                                                                                                                                |
| 370–477   | `summarizeWorkouts(...)` — naponkénti terhelés-, izom- és CNS-összegzés; `decayedSum` (458, exponenciális csillapítás), `dailyAverage` (469).                                                                                                                                                                                                                                                                           |
| 478–566   | **Komponens-pontszámok** (mind 0–1 vagy `null`): `sleepDurationScore` (488, trapéz alak), `sleepScore` (497, 60/40 időtartam–minőség, alvásadósság max. 0.15 levonás), `scaleUp`/`scaleDown` (528–535), `hasNutritionEntries` (536), `nutritionScore` (545).                                                                                                                                                            |
| 567–650   | `muscleReadiness(...)` — izomcsoportonkénti készenlét a naplóból + a check-in izomláz/fájdalom mezőiből.                                                                                                                                                                                                                                                                                                                |
| 651–674   | `cnsReadiness(...)` — az idegrendszer terheltsége (lassabb visszaállás).                                                                                                                                                                                                                                                                                                                                                |
| 675–765   | `recommend(readiness, { prWindow })` — a szöveges ajánlás. `PLATE_STEPS_KG` (731), `MAX_REDUCTION_OVERSHOOT` (733), `reduceWeight` (737) — a súlycsökkentés **valós tárcsalépésekre** kerekít, és kis súlyon sem visz nullára.                                                                                                                                                                                          |
| 766–881   | `exerciseReadiness(...)` — gyakorlat-specifikus készenlét és javaslat.                                                                                                                                                                                                                                                                                                                                                  |
| 882–909   | `normalizeCheckin(raw)` — a nyers check-in beolvasása; `QUICK_FIELDS` (903).                                                                                                                                                                                                                                                                                                                                            |
| 910–1166  | **`computeReadiness({...})` — a fő belépési pont**: komponensek kiszámítása, a hiányzó súlyok arányos újraosztása, a szubjektív padló alkalmazása, a végső 0–100 pontszám, a megbízhatósági szint és a komponens-bontás összeállítása.                                                                                                                                                                                  |
| 1167–1173 | `describe(score, labels)` — a pontszám szöveges címkéje.                                                                                                                                                                                                                                                                                                                                                                |

---

### 2.4 A többi backend modul

#### `server/auth.js` — jelszó, munkamenet, süti (186 sor)

Nulla új függőség: minden a `node:crypto`-ból. Két külön dolgot kezel, szándékosan nem keverve:
a **jelszót** (lassú scrypt, sónként külön sóval) és a **munkamenetet** (véletlen token, a DB-be
csak a SHA-256 lenyomat kerül).

| Sorok   | Mi történik                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1–18    | Fájl-fejléc, importok.                                                                                                                                                                                       |
| 19–27   | `scryptAsync`, `SCRYPT` paraméterek (`N: 16384, r: 8, p: 1, keylen: 64`).                                                                                                                                    |
| 28–43   | `hashPassword(password)`.                                                                                                                                                                                    |
| 44–54   | `DUMMY_HASH` + `verifyAgainstDummy` — **időzítés-kiegyenlítés**: a nem létező felhasználó ugyanannyi ideig tart, mint a létező.                                                                              |
| 55–78   | `verifyPassword(password, stored)` — `timingSafeEqual`; sérült/üres hash-re mindig hamis, sosem dob.                                                                                                         |
| 79–84   | `createSessionToken()` (256 bit véletlen), `hashToken(token)`.                                                                                                                                               |
| 86–122  | `parseCookies(header)`, `serializeCookie(name, value, …)` — a védő jelzők mindig rajta vannak.                                                                                                               |
| 124–178 | **Belépési kísérlet-korlát**: `FAILURE_LIMIT` (10), `FAILURE_WINDOW_MS` (15 perc), `failures` Map, `sweepFailures`, `loginFailureKey`, `accountFailureKey`, `isLockedOut`, `recordFailure`, `clearFailures`. |
| 179–186 | `USERNAME_RE` (`^[a-z0-9._-]{3,24}$`), `PASSWORD_MIN` (8), `normalizeUsername`.                                                                                                                              |

#### `server/errors.js` — hibakezelő védőháló (134 sor)

A védelem az összes útvonal ELŐTT áll be, tehát egy később felvett végpont automatikusan védett.

| Sorok   | Mi történik                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1–17    | Fájl-fejléc: miért kell (async kezelő elutasított ígérete Express 4 alatt **válasz nélkül** hagyná a kérést).                 |
| 18–27   | `ROUTE_METHODS` — a lefedett regisztráló metódusok.                                                                           |
| 28–53   | `guardHandler(handler)` — becsomagolás; **megtartja az aritást és a nevet**, a négyparaméteres hibakezelőt nem csomagolja be. |
| 54–71   | `guardAsyncRoutes(app)`.                                                                                                      |
| 72–86   | `clientMessage(err)` — a hiba RÉSZLETEI nem szivárognak ki; a `status`-t hordozó 4xx üzenete átmegy.                          |
| 87–116  | `apiErrorHandler(err, req, res, _next)` — JSON hibaválasz, a veremkép a szerver-logba.                                        |
| 117–134 | `installProcessGuards(server, { exit })` — elkapatlan kivétel és elárvult ígéret kezelése.                                    |

#### `server/ratelimit.js` — kérés-korlátozás (104 sor)

Rögzített ablakos számláló memóriában, nulla függőséggel. A cél nem egy elszánt támadó, hanem
hogy egy elszabadult kliens ne tudja megfektetni a szinkron SQLite-on futó szervert.

| Sorok  | Mi történik                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–35   | Fájl-fejléc; benne a **rögzített vs. csúszó ablak** döntés indoklása.                                                                                         |
| 36–49  | `parseTrustProxy(raw)` — a `true` **tiltott**, mert bármelyik kliens hamisíthatná a forrását.                                                                 |
| 50–57  | `SWEEP_THRESHOLD` — a memória takarítása.                                                                                                                     |
| 58–104 | `createRateLimiter({ limit, windowMs })` — a számláló; az idő átadható, hogy a teszteknek ne kelljen várniuk. A további kopogtatás NEM tolja ki a várakozást. |

#### `server/logmode.js` — naplózási mód (137 sor)

Két mód: `reps` (ismétlés + súly + RPE) és `duration` (idő + intenzitás). A mód a **gyakorlat**
tulajdonsága, nem a felhasználó útvonaláé — a katalógus-sorra van ráégetve.

| Sorok   | Mi történik                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------- |
| 1–39    | Fájl-fejléc: a két mód és a rétegzett feloldás.                                                   |
| 40–43   | `LOG_MODES`, `DEFAULT_LOG_MODE` (`'reps'` — a régi, mód nélküli sorok változatlanul viselkednek). |
| 65–87   | `INTENSITY_LEVELS`, `INTENSITY_KEYS`, `DEFAULT_INTENSITY`, `MAX_DURATION_SECONDS`.                |
| 89–99   | `DURATION_NAME_PATTERNS` — névből következtetés az időalapú gyakorlatokra.                        |
| 100–120 | `isLogMode`, `resolveLogMode(entry)` — rétegzett feloldás.                                        |
| 121–137 | `normalizeIntensity`, `normalizeDuration`.                                                        |

#### `server/muscles.js` — izom-taxonómia (223 sor)

A Recovery Engine ebből tudja, egy gyakorlat melyik izmot mennyire terhelte.

| Sorok   | Mi történik                                                                                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–22    | Fájl-fejléc: a **két réteg** — katalógus-súlyok (pontos) és kulcsszavas becslés (szabad szöveges névre). Ha egyik sem talál, a gyakorlat egyetlen izomcsoporthoz sem kerül: beleszámít az általános terhelésbe, de nem terhel hamisan. |
| 23–40   | `MUSCLE_GROUPS` (kilenc csoport), `MUSCLE_KEYS`.                                                                                                                                                                                       |
| 41–57   | `TAU_BY_GROUP` — csoportonkénti regenerációs időállandó.                                                                                                                                                                               |
| 58–125  | `KEYWORD_MAP` — a kulcsszavas becslés szabályai.                                                                                                                                                                                       |
| 126–164 | `normalizeName`, `normalizeLoad(raw)` — a súlyok összege 1.                                                                                                                                                                            |
| 165–191 | `loadIndexCache` (WeakMap) + `catalogLoadIndex(catalog)` — a katalógus név-indexe újrahasznosul, de a hívó tömbjéhez kötődik, nem globális állapot.                                                                                    |
| 192–223 | `resolveExerciseLoad(name, catalog)`, `isAxialLift(name)`, `emptyMuscleMap()`.                                                                                                                                                         |

#### `server/coaching.js` — sportoló-összegző (351 sor)

| Sorok   | Mi történik                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1–25    | Fájl-fejléc: a **terv-követés (adherence)** fogalma — terv nélkül `null`, nem 0% (az azt hazudná, hogy elmaradt valami).     |
| 26–37   | Küszöbök: `WINDOW_DAYS` (28), `ACTIVITY_LIMIT`, `LOW_READINESS` (65), `MISSED_LIMIT`, `STALE_CHECKIN_DAYS`, `INACTIVE_DAYS`. |
| 39–57   | `relativeDay(dateStr, todayKey)` — „ma", „tegnap", „3 napja" magyarul.                                                       |
| 58–71   | `streakFromDates(dates, today)` — edzés-sorozat.                                                                             |
| 72–100  | `weekdayOf`, `trainingDayKeys`, `scheduledWeekdays`, `workSetCount`, `cardioMinutes`.                                        |
| 101–129 | `weekProgress({ workouts, plans, today })` — a heti állás hétfőtől máig; a mai nap még nem elmaradás.                        |
| 130–159 | `adherence({ workouts, plans, today })` — az elmúlt 4 hét ütemezett napjaihoz mérve.                                         |
| 160–179 | `athleteRating(readiness, adherenceValue)` — az összpontszám; terv nélkül maga a készenlét.                                  |
| 180–212 | `athleteAlert({...})` — mikor riasszunk (alacsony készenlét, kihagyott edzések, régi check-in, inaktivitás).                 |
| 213–268 | `recentActivity({...})` — a friss események listája a részletmodálhoz.                                                       |
| 269–351 | `buildAthleteCard({...})` — a kártya végső összeállítása.                                                                    |

#### `server/notifications.js` — az értesítés-panel tartalma (148 sor)

| Sorok  | Mi történik                                                                                                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–27   | Fájl-fejléc: a panel **hat valódi eseménytípusból** épül. A szűrő: mindegyiknek van IGAZI időbélyege — ezért maradt ki a „töltsd ki a check-int" és a „sorozat mérföldkő" (azok állapotok, nem események). |
| 28–33  | `PREVIEW_MAX` (60), `LIMIT` (12).                                                                                                                                                                          |
| 34–54  | `preview(text)` — hosszú üzenet csonkolva, egy sorba fogva.                                                                                                                                                |
| 55–148 | `buildNotifications({...})` — a hat forrás sorokká alakítása, időrendben, legfrissebb elöl. Szálanként EGY sor születik, nem üzenetenként.                                                                 |

#### `server/suggestions.js` — ajánlott gyakorlatok (301 sor)

| Sorok   | Mi történik                                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–28    | Fájl-fejléc: **két egyenrangú jel** — az edzés címe és a regeneráltság. Minden javaslat kimondja, miért került oda.                                                                 |
| 29–38   | `READY_THRESHOLD` (80), `PER_GROUP` (2), `MAX_SUGGESTIONS` (8), `MAX_TITLE_LENGTH`.                                                                                                 |
| 39–52   | `LOWER_BODY` — az alsótest csoportjai.                                                                                                                                              |
| 53–118  | `TITLE_RULES` — a címfelismerés szabályai (magyar összetett szavak és angol rövidítések).                                                                                           |
| 119–139 | `groupsFromTitle(title)`.                                                                                                                                                           |
| 140–162 | `primaryGroup(load)`.                                                                                                                                                               |
| 163–277 | `suggestExercises({ title, report, catalog, workouts })` — a két jel összefésülése. **Fájdalommal letiltott csoport (7/10 felett) sosem kerül be**, és ezt a cím sem írhatja felül. |
| 278–301 | `reasonsFor(group, fromTitle)`, `uniqueLabels(fromTitle, painful)` — az indoklás-szövegek.                                                                                          |

#### `server/openfoodfacts.js` — OFF proxy (182 sor)

A böngésző nem hívja közvetlenül az OFF-ot: az azonosító User-Agent, az egy-origin felépítés
és a szerver-oldali gyorsítótár miatt.

| Sorok   | Mi történik                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------- |
| 1–18    | Fájl-fejléc: a három ok és a tiszta/IO szétválasztás.                                                                |
| 19–26   | `BASE_URL`, `USER_AGENT`, `TIMEOUT_MS` (env-ből felülírható, hogy a teszt helyi stubra irányíthassa), `KJ_PER_KCAL`. |
| 41–57   | `normalizeBarcode(raw)` — EAN-8/UPC-A → EAN-13 kiegészítés, ellenőrzőszám-vizsgálat.                                 |
| 58–79   | `num`, `clean` — értelmezés és tisztítás.                                                                            |
| 80–142  | `mapProduct(raw, barcode)` — a négy tápérték + márkás név; a **magyar név elsőbbséget élvez**.                       |
| 143–163 | `FIELDS` — a lekért mezők listája.                                                                                   |
| 164–182 | `fetchProduct(barcode)` — az egyetlen, ami kifelé beszél; hibára `{ ok: false }`, sosem dob.                         |

#### `server/data.js` — seed / referencia-adat (86 sor)

| Sorok | Mi történik                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------- |
| 1–15  | Fájl-fejléc: a két nagy lista NEM itt van (saját forrásfájlban él a `server/data/` alatt).           |
| 17–28 | `data.goals` — a választható edzés-célok (kulcs + kártya-címke + felirat).                           |
| 29–52 | `data.charts`, `data.dashboard` — a diagramok és az áttekintő alapváza.                              |
| 53–84 | `data.defaultSet` és `data.defaultCardioSet` — az új szett-sorok alapértékei a két naplózási módhoz. |
| 85–86 | `data.nutritionGoal` — az alapértelmezett napi kalória/fehérje cél.                                  |

---

## 3. Backend adatfájlok — `server/data/`

| Fájl                | Sorok  | Mi ez                                                                                                                                                                                                                                                      |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog.js`        | 1–146  | **A két katalógus összeállítása** a seedelés előtt. Gyakorlatok: kurált (`exercises.hu.js`, 200 db, kézzel megadott `load` súlyokkal) + generált (`exercises.exdb.js`, 1216 db, gif-fel) — **névütközéskor a kurált nyer**. Ételek: a `per` címke képzése. |
| `exercises.hu.js`   | 1–1384 | A kurált, magyar gyakorlat-katalógus — az EGYETLEN kézi szerkesztési hely. A `name` egyben stabil azonosító, tehát átnevezés új sort hoz létre.                                                                                                            |
| `exercises.exdb.js` | 1–3903 | **GENERÁLT** katalógus (`npm run exdb:build`), kézzel nem szerkesztendő. A `load` súlyok származtatottak (`loadSource: 'derived'`). Szöveges adat MIT licenc, a média © Gym visual (attribúcióval, 180×180-ban).                                           |
| `exdb.map.js`       | 1–360  | A külső dataset → saját katalógus **leképezése**. Csak adat, nincs I/O — így tesztelhető és átnézhető marad.                                                                                                                                               |
| `exdb.names.hu.js`  | 1–797  | Angol → magyar **kifejezés-szótár**. Nem gyakorlatonként fordítunk (1324 sor kézzel karbantarthatatlan), hanem kifejezésenként, leghosszabb-találat-előnnyel.                                                                                              |
| `foods.hu.js`       | 1–3864 | Az étel-adatbázis — az EGYETLEN kézi szerkesztési hely. A `name` stabil azonosító; a makrók 100 g-ra vonatkoznak. Exportálja a `FOOD_GROUPS`-ot is.                                                                                                        |

---

## 4. Frontend — `public/index.html` (3332 sor)

**Minden oldal egyetlen HTML-ben.** Az oldalváltás nem újratöltés: a `[hidden]` attribútumot
mozgatja a router. A listaelemek `<template>`-ekből klónozódnak.

| Sorok     | Mi ez                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–18      | `<head>`: meta-k, `theme-color`, inline SVG favicon, `style.css`, és a `js/main.js` **modul**-belépési pont.                                                                                                                                                                                                                                                                                                                                                                                            |
| 19–87     | **Közös SVG ikon-sprite** (`<symbol id="icon-…">`), rejtve. A `<use href="#…">` hivatkozások innen klónoznak. Az `icons.test.js` őrzi, hogy egy `<use>` se mutasson nem létező szimbólumra.                                                                                                                                                                                                                                                                                                             |
| 88–154    | **Belépő képernyő (`au-*`)** — a frontend nyitja, ha nincs érvényes munkamenet. Alapból rejtett, hogy bejelentkezve ne villanjon fel.                                                                                                                                                                                                                                                                                                                                                                   |
| 155–171   | **Desktop oldalsáv** (mobilon a nav gyűrű veszi át).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 172–239   | **Globális fejléc-sáv** (`app-chrome`): márkajel + mai dátum, avatar (profilra visz), harang és fogaskerék, valamint az **értesítés-panel** (225–239). Egyetlen példány, hogy az állapot ne kettőződjön.                                                                                                                                                                                                                                                                                                |
| 240–246   | `app-content` / `app-main` konténer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 247–412   | **Áttekintés (`dashboard`)**: bal hasáb — készenlét (254), táplálkozás (272), mérőszám-sor (312), terhelés-trend (347), check-in emlékeztető (364); jobb hasáb — a mai edzés és a fő műveletek (383).                                                                                                                                                                                                                                                                                                   |
| 413–556   | **Profiloldal (`pf-*`)**: fejléc, négy összesítő (434), tények (458), **erőfelmérés** (487).                                                                                                                                                                                                                                                                                                                                                                                                            |
| 557–685   | **Edzésnapló (`wk-*`)**: fejléc, visszanyitott edzés jelzése (578), autosave állapot élő régióval (587), üres állapot (600), gyakorlat-választó gomb (606), lezárás (611), haladás (620), heti összehasonlítás (628), PR-lista (669).                                                                                                                                                                                                                                                                   |
| 686–754   | **Terv-építő flow-oldal (`pb-*`)**: hétnap-ütemezés (715), gyakorlat-hozzáadás (734), mentés (739).                                                                                                                                                                                                                                                                                                                                                                                                     |
| 755–833   | **Gyakorlat-választó flow-oldal (`ep-*`)**: keresés, szűrő-chipek, ajánlott gyakorlatok (800), média-attribúció (819).                                                                                                                                                                                                                                                                                                                                                                                  |
| 834–1040  | **Táplálkozás (`nu-*`)**: napi kalória-összesítő (847), napi cél két forrással (888), **vízmérő** (947), mai napló (985), saját étel felvitele (996).                                                                                                                                                                                                                                                                                                                                                   |
| 1041–1060 | **Tervek (`pl-*`)**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1061–1218 | **Edző oldal (`co-*`)**: kliens nézet — a saját edződ, meghívók (1090), felajánlott tervek (1101), üzenetváltás (1109); edzői nézet — sportoló-menedzser (1153), meghívás (1162), állapot-sáv (1187).                                                                                                                                                                                                                                                                                                   |
| 1219–1322 | **Edzés-összegző (`su-*`)**: a teljesített szett a lap hőse (1236), edzés utáni visszajelzés az edzőnek (1256), gyakorlat-megjegyzés (1284).                                                                                                                                                                                                                                                                                                                                                            |
| 1323–1639 | **Regeneráció (`rc-*`)**: készenléti pontszám (1337), testsúly (1547), testtérkép (1573), komponensek (1589), CNS (1600), izomcsoportok (1611), fő gyakorlatok (1617).                                                                                                                                                                                                                                                                                                                                  |
| 1640–1698 | **Napi check-in varázsló (`ci-*`)** — a lépések DOM-ját a `steps/` modulok építik a lap alján lévő sablonokból.                                                                                                                                                                                                                                                                                                                                                                                         |
| 1699–1733 | Technika-videó modál.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1734–1756 | PR modál.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 1757–1904 | **Beállítások modál (`st-*`)**: profil (1777), értesítés-kapcsolók (1796), edzés-cél (1801), adat-export (1814), fiók-műveletek (1821).                                                                                                                                                                                                                                                                                                                                                                 |
| 1905–2110 | **Sportoló részletmodál** (`athlete-modal`, `co-modal-*`): statisztikák (1941, 1960), táplálkozási cél (1973), friss aktivitás (2007), műveletek (2038, 2077).                                                                                                                                                                                                                                                                                                                                          |
| 2111–2293 | Saját étel modál (`cf-*`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2294–2363 | Vonalkód-olvasó modál (`sc-*`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2364–2500 | Étel részlet-modál (`fd-*`) az **adagválasztó görgővel**; a mai tételek (2456).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2501–2538 | Javaslat-modál (`adviceModal`) — a check-in utáni „Elfogadom / Most nem".                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2539–2567 | Megerősítő ablak (`confirmModal`) az adatvesztéssel járó műveletekhez.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2568–2579 | Toast-régió (`role="status"`) és a hiba-bemondó (`role="alert"`).                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2580–3089 | **`<template>`-ek**: `tpl-exercise` (2580), `tpl-set-row` (2655), `tpl-cardio-row` (2739), `tpl-picker-item` (2817), `tpl-history-entry` (2848), `tpl-nutrition-entry` (2868), `tpl-food` (2889), `tpl-fd-today-item` (2904), `tpl-plan` (2911), `tpl-coach-note` (2943), `tpl-athlete-card` (2950), `tpl-setting-toggle` (2974), `tpl-pr` (2986), `tpl-pr-history-item` (2997), `tpl-advice-item` (3011), `tpl-scale` (3021), `tpl-rc-component` (3032), `tpl-rc-muscle` (3046), `tpl-rc-lift` (3060). |
| 3090–3332 | **A check-in varázsló sablonjai**: `tpl-ci-intro` (3090), `tpl-ci-sleep` (3112), `tpl-ci-weight` (3169), `tpl-ci-scale` (3230), `tpl-ci-gate` (3251), `tpl-ci-map` (3264), `tpl-ci-summary` (3281), `tpl-ci-summary-row` (3325).                                                                                                                                                                                                                                                                        |

---

## 5. Frontend — `public/style.css` (9362 sor)

Számozott szakaszokra osztva. A dizájn sötét alapú; a stílus-szabályokat a Prettier formázza.

| Sorok     | Szakasz                                                      | Mi ez                                                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–35      | Fejléc                                                       | A frontend alapjai, a dizájn nyelve.                                                                                                                                                                                                                                                                |
| 36–245    | **1. Design tokenek**                                        | Színek, tipográfia, térköz, sugár, árnyék — CSS custom property-kben. A világos téma helye a 226. sortól.                                                                                                                                                                                           |
| 246–344   | **2. Base és reset**                                         | A `[hidden]` MINDIG rejtsen (252) — egy egész hibaosztályt zár ki. Minden beviteli mező legalább 16px (300). Egységes fókusz-keret (315).                                                                                                                                                           |
| 345–419   | **2b. Műszerfal-tipográfia**                                 | Szekciócímek (375), táblázatos számok a mérőszámokhoz (406).                                                                                                                                                                                                                                        |
| 420–701   | **2c. Dizájn-primitívek (`ds-*`)**                           | `ds-grid` hajszálvonalas rács (435), `ds-section` (458), `ds-eyebrow` (473), `ds-display` (484), `ds-row` (497) + elválasztók (510), `ds-cta` (556), léptető (636), szegmens-választó (672).                                                                                                        |
| 702–814   | **3. Akadálymentességi segédosztályok**                      | Érintési célterület (737) — a 44px a `--tap-min`; finom mutatóeszközön nincs tágítás (761); komponensenkénti hangolás (769).                                                                                                                                                                        |
| 815–841   | **4. App layout és oldalváltás**                             | Kis telefonon 2×22px oldalmargó (825).                                                                                                                                                                                                                                                              |
| 842–937   | **5. Oszlopdiagram**                                         | Az áttekintő és az edzés oldal **közös** komponense. A mai oszlop kiemelése (868), nap-feliratok (874), mobil-viselkedés (912).                                                                                                                                                                     |
| 938–1552  | **6. Dashboard**                                             | Fejléc-sáv (950), márkajel + dátum (972), sorozat-jelvény (995), avatar-gomb (1006), harang + fogaskerék (1035) értesítés-pöttyel (1067), **készenléti gyűrű** (1114), táplálkozás-blokk (1219), mérőszám-sor (1291), terhelés-trend (1332), check-in emlékeztető (1339), jobb hasáb (1395).        |
| 1553–2649 | **7. Workout logger**                                        | Gyakorlat-kártya (1592), **szuperszett** kapocs és összekötő sáv (1605–1681), nyitott lenyíló (1682), valós idejű PR-detektálás (1725) és automatikus PR-jelvény (1743), gyakorlat-eltávolítás (1781), sorszám-választó (1816), szett-sorok grid-je (1894), **drop set gerinc és fog** (1918–1990). |
| 2650–3011 | **8. Nutrition tracker**                                     |                                                                                                                                                                                                                                                                                                     |
| 3012–3137 | **9. Tervek**                                                |                                                                                                                                                                                                                                                                                                     |
| 3138–3547 | **10. Edzői panel**                                          | Állapot-sáv, sportoló-kártyák, üzenet-buborékok.                                                                                                                                                                                                                                                    |
| 3548–3709 | **11. Nav ring**                                             | Mobil/tablet navigáció.                                                                                                                                                                                                                                                                             |
| 3710–3716 | **12. Side nav**                                             | Desktop navigáció (mobilon rejtve).                                                                                                                                                                                                                                                                 |
| 3717–3885 | **13. Modálok — közös alap**                                 |                                                                                                                                                                                                                                                                                                     |
| 3886–3948 | **13b. Megerősítő ablak**                                    |                                                                                                                                                                                                                                                                                                     |
| 3949–4001 | **14. Toast értesítések**                                    |                                                                                                                                                                                                                                                                                                     |
| 4002–4248 | **15. Breakpointok**                                         |                                                                                                                                                                                                                                                                                                     |
| 4249–4555 | **16. Demo polish**                                          | Mikro-animációk, értesítés-panel, állapotok.                                                                                                                                                                                                                                                        |
| 4556–4740 | **17. Beállítások modal (`st-*`)**                           |                                                                                                                                                                                                                                                                                                     |
| 4741–4924 | **18. Analitika**                                            | Testsúly-trend, heti összehasonlítás, PR-lista.                                                                                                                                                                                                                                                     |
| 4925–5000 | **19. Sportoló részletmodál**                                |                                                                                                                                                                                                                                                                                                     |
| 5001–5110 | **22. Terv-építő flow-oldal (`pb-*`)**                       |                                                                                                                                                                                                                                                                                                     |
| 5111–5491 | **23. Gyakorlat-választó flow-oldal (`ep-*`)**               |                                                                                                                                                                                                                                                                                                     |
| 5492–5837 | **20. Edző oldal**                                           | A két nézet (kliens / edző).                                                                                                                                                                                                                                                                        |
| 5838–5991 | **21. Edzés-összegző (`su-*`)**                              |                                                                                                                                                                                                                                                                                                     |
| 5992–6520 | **22. Regeneráció (`rc-*`)**                                 |                                                                                                                                                                                                                                                                                                     |
| 6521–6919 | **24. Étel részlet-modál (`fd-*`)**                          | Adagválasztás naplózás előtt.                                                                                                                                                                                                                                                                       |
| 6920–8436 | **25. Napi check-in varázsló (`ci-*`)**                      |                                                                                                                                                                                                                                                                                                     |
| 8437–8696 | **26. Belépő képernyő (`au-*`)**                             |                                                                                                                                                                                                                                                                                                     |
| 8697–8832 | **27. Profiloldal (`pf-*`)**                                 |                                                                                                                                                                                                                                                                                                     |
| 8833–9223 | **28. Saját étel modál (`cf-*`) + vonalkód-olvasó (`sc-*`)** | A szkenner külön alszakasz 9093-tól.                                                                                                                                                                                                                                                                |
| 9224–9362 | **29. Testtérkép (`bm-*`)**                                  |                                                                                                                                                                                                                                                                                                     |

> A szakaszok számozása helyenként nem monoton (22. és 23. kétszer szerepel) — ez a fájl
> történetének lenyomata, a sorrend a tényleges kódsorrend.

---

## 6. Frontend JS — `public/js/`

### 6.1 Belépés és indítás

#### `public/js/main.js` (50 sor)

| Sorok | Mi történik                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–12  | Fájl-fejléc + importok.                                                                                                                                     |
| 14–50 | `DOMContentLoaded` kezelő: lekéri a `/api/auth/me`-t; ha nincs munkamenet → belépő kapu (`setupAuthGate`), ha van → `init()`. Az onboarding-zár beállítása. |

#### `public/js/app/init.js` (304 sor)

| Sorok   | Mi történik                                                                                                                                                                                                                                                    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–52    | Importok — innen látszik, mi mindenből áll össze az app.                                                                                                                                                                                                       |
| 53–200  | **`init()`** — a vezérlők felépítése és összekötése: modálok, a lapok `setup*` függvényei, a router és a nav gyűrű indítása, a napváltás-figyelő, a kezdő renderelések. A hibázó vezérlők `null`-ra esnek (`safe`), és a rájuk mutató gombok inaktívvá válnak. |
| 201–304 | **`setupAuthGate()`** — a belépő/regisztrációs képernyő kezelése: űrlap-váltás, hibák megjelenítése, sikeres belépés után az `init()` meghívása.                                                                                                               |

### 6.2 `public/js/core/` — magrétegek

#### `core/api.js` (339 sor) — az egyetlen hely, ahol az app „adatot kér"

| Sorok   | Mi történik                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1–10    | Fájl-fejléc: a frontend nem tárol adatot, az egyetlen forrás a szerver.                                                 |
| 12–28   | `SESSION_LOST`, `handleUnauthorized()` — 401-re elindítja a visszaterelést a belépő kapuhoz és jelzett hibát dob.       |
| 29–40   | `CLIENT_DATE_HEADER` (`X-Client-Date`), `clientDate()`, `requestHeaders()` — a naplózás a **felhasználó** napjára megy. |
| 42–67   | `getJson(path)`, `getJsonDetailed(path)`.                                                                               |
| 68–100  | `sendJson(method, path, body)`, `postJson`, `putJson`, `del`.                                                           |
| 101–116 | `authRequest(path, body)` — a belépés/regisztráció külön útja (401-re nem terelünk vissza).                             |
| 117–137 | `referenceCache`, `getJsonCached(path)`, `invalidateCache(path)` — a csak-olvasható referencia-végpontok gyorsítótára.  |
| 138–339 | **`api` objektum** — minden getter és író metódus egy-egy `/api/*` végpontra. Ez az „adat-seam" kliens-oldali vége.     |

#### `core/constants.js` (80 sor)

| Sorok | Mi történik                                                                      |
| ----- | -------------------------------------------------------------------------------- |
| 1–9   | `DAY_LABELS` (H, K, Sze…), `DAY_NAMES` — 0 = hétfő, ahogy a szerver is indexeli. |
| 10–27 | `NOTIF_CATEGORIES` — pontosan az a három, amit a szerver valóban küldeni tud.    |
| 28–43 | `PAGES`, `FLOW_PAGES` (friss megnyitáskor nem állnak vissza).                    |
| 44–68 | `DIR_TO_PAGE` (nav gyűrű iránya → oldal), `KEY_TO_PAGE` (1–5 gyorsbillentyű).    |
| 69–80 | `OPEN_MODAL_SELECTOR` — a közös horgony a nyitott modál felismerésére.           |

#### `core/day.js` (29 sor)

| Sorok | Mi történik                                                                                                                                                                               |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–10  | `dayChangeListeners`, `onDayChange(listener)`.                                                                                                                                            |
| 11–29 | `startDayWatcher()` — percenként és a fül újra-láthatóvá válásakor ellenőrzi a dátumot; éjfél után lefuttatja a frissítőket, hogy a napi számlálók nulláról induljanak újratöltés nélkül. |

#### `core/dom.js` (42 sor)

| Sorok | Mi történik                                                                       |
| ----- | --------------------------------------------------------------------------------- |
| 6–11  | `$`, `$$`, `prefersReducedMotion`.                                                |
| 13–19 | `cloneTemplate(id)` — a `<template>`-ek klónozása.                                |
| 20–42 | `loadedScripts`, `loadScript(src)` — késleltetett szkript-betöltés (a ZXing-hez). |

#### `core/format.js` (38 sor)

| Sorok | Mi történik                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 8–13  | `formatNumber` (kiírásra, **magyar tizedesvesszővel**) és `formatInputNumber` (beviteli mezőbe, ponttal — a `type="number"` csak azt érti). |
| 15–38 | `runningNumberAnimations` (WeakMap), `animateNumber(el, to, …)` — elemenként legfeljebb egy futó animáció.                                  |

#### `core/one-rm.js` (18 sor)

| Sorok | Mi történik                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–14  | Fájl-fejléc: **szándékos másolat** a szerver képletéből (a kliens nem importálhat a `server/`-ből); a `one-rm.test.js` köti össze a kettőt, hogy ne sodródjanak szét. |
| 15–18 | `estimate1RM(weight, reps)` — Epley, egy ismétlésnél maga a súly.                                                                                                     |

#### `core/page-hooks.js` (79 sor)

| Sorok | Mi történik                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–12  | Fájl-fejléc: **késleltetett kötés** a router és a lapok vezérlői között — így a `nav/` nem függ a `ui/`-tól, és nem keletkezik kör a modulgráfban.                                 |
| 13–65 | `hooks` — a vezérlők által feltöltött visszahívás-slotok (munkamenet-vesztés, oldal-megjelenés, frissítés…). A slotok az első hívásig `null`-ok, a hívó oldalon mindig `?.()` áll. |
| 66–79 | `shared` — a lapok közt megosztott állapot.                                                                                                                                        |

#### `core/prefs.js` (29 sor)

| Sorok | Mi történik                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4–29  | `PREFS_KEY`, `prefs.read/get/set` — felhasználói preferenciák egyetlen JSON kulcs alatt a `localStorage`-ban, hibatűrően (sérült JSON esetén üres objektum). |

#### `core/toast.js` (58 sor)

| Sorok | Mi történik                                                                                                                                         |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8–13  | `TOAST_VISIBLE_MS` (2400) és `TOAST_ERROR_VISIBLE_MS` (5200) — a hiba tovább látszik, mert abból tudja meg a felhasználó, hogy tennie kell valamit. |
| 14–58 | `showToast(message, variant)`.                                                                                                                      |

### 6.3 `public/js/nav/` — navigáció

#### `nav/router.js` (259 sor)

| Sorok   | Mi történik                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1–20    | Fájl-fejléc: hash-alapú oldalváltás; a vissza gomb és a link-megosztás is működik.                                       |
| 21–73   | `pageEffects` — oldalanként lefutó megjelenés-effektek (a `hooks`-on át).                                                |
| 74–88   | `animateCoachRatings()`.                                                                                                 |
| 89–93   | `setOnboardingLock(on)` — onboarding alatt nincs szabad navigáció.                                                       |
| 94–99   | `pageFromHash()`.                                                                                                        |
| 100–133 | `PAGE_TITLES`, `PAGE_ICONS`.                                                                                             |
| 134–139 | `currentPage()`.                                                                                                         |
| 140–173 | `syncNavRingState(name)`.                                                                                                |
| 174–204 | `showPage(name)` — a `[hidden]` mozgatása + az effektek futtatása.                                                       |
| 205–212 | `navigate(name)`.                                                                                                        |
| 213–259 | `setupRouter()` — `hashchange` figyelés, az utolsó oldal visszaállítása `localStorage`-ból (a flow-oldalak kivételével). |

#### `nav/navring.js` (110 sor)

| Sorok  | Mi történik                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------ |
| 8–13   | `RING_RADIUS` (44px), `DIR_THRESHOLD` (26px), `TAP_THRESHOLD` (9px — ez alatt koppintás = home). |
| 14–110 | `setupNavRing(knob, onNavigate)` — húzható navigációs gomb pointer- és billentyűzet-kezeléssel.  |

### 6.4 `public/js/render/` — adat → DOM

#### `render/dashboard.js` (278 sor)

| Sorok   | Mi történik                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------- |
| 10–13   | `dashboardData` — az áttekintő adatai (a `pageEffects` innen veszi a készenlét-értéket az animációhoz). |
| 14–51   | `renderChart(container, data)` — egy oszlopdiagram feltöltése; a `--i` a lépcsőzetes animációhoz kell.  |
| 52–60   | `renderCharts()`.                                                                                       |
| 61–89   | `renderDailyStats(dailyStats)`.                                                                         |
| 90–100  | `syncCheckinCta(checkinPresent)`.                                                                       |
| 101–113 | `refreshDailyStats()`.                                                                                  |
| 114–253 | **`renderDashboard()`** — a teljes áttekintő kirajzolása.                                               |
| 254–278 | `renderUserName()`, `renderChromeDate()`.                                                               |

#### `render/sets.js` (816 sor) — az edzésnapló szerkesztő-primitívjei

Ezeket az edzésnapló, a tervkészítő és a gyakorlat-választó **is** használja, ezért állnak külön.

| Sorok   | Mi történik                                                                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–21    | Fájl-fejléc, importok.                                                                                                                              |
| 22–51   | `SET_FIELDS`, `SET_TYPES`, `defaultSetType` (az első szett bemelegítő), `setTypeOf`, `setTypeLabel`.                                                |
| 52–75   | `numericValue(raw)`.                                                                                                                                |
| 76–101  | `intensityLevels`, `loadIntensityLevels()`, `defaultIntensityKey`, `intensityKeyOf`, `intensityLabel` — a kardió-intenzitás fokozatai a szervertől. |
| 102–123 | `parseDurationInput(raw)`, `formatDuration(value)`.                                                                                                 |
| 124–150 | `applyIntensity(row, key)`, `buildIntensityMenu(row)`.                                                                                              |
| 151–178 | `syncExtraWeight(row)`, `renderCardioRow(set)`, `isCardioRow(row)`.                                                                                 |
| 179–221 | `numberSetRow(row, label, dropCount)`, `applySetType(row, type)`, `buildSetTypeMenu(row)`.                                                          |
| 222–302 | `DROP_LETTERS`, `renumberSets(setList)` (a drop setek betűzése), `readSetRow(row)`.                                                                 |
| 303–358 | `renderSetRow(set, index)`, `handleStepClick(event)` (−/+ léptetők), `clampRpeInput(target)`.                                                       |
| 359–412 | `nextSetValues`, `handleAddSetClick`, `handleRemoveSetClick`, `promoteFirstSetToWarmup`.                                                            |
| 413–498 | **`renderExercise(...)`** — egy teljes gyakorlat-kártya felépítése.                                                                                 |
| 499–569 | `SUPERSET_LETTERS`, `refreshSupersetGroups(list)` — a szuperszett-csoportok jelölése.                                                               |
| 570–608 | `renumberOrderSelects(list, labels)`, `refreshExerciseList(list)`.                                                                                  |
| 609–667 | `closeAllOrderMenus`, `enableOrderSelect(list, onReorder)` — saját (nem natív) sorrend-lenyíló.                                                     |
| 668–723 | `closeAllSetTypeMenus`, `enableSetTypeSelect(list, onChange)`.                                                                                      |
| 724–765 | `closeAllIntensityMenus`, `enableIntensitySelect(list, onChange)`.                                                                                  |
| 766–816 | `closeAllExtraMenus`, `enableExtraMenu(list)`.                                                                                                      |

#### `render/recovery.js` (264 sor)

| Sorok   | Mi történik                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| 8–24    | `MUSCLE_GROUPS` — a kilenc csoport kulcsa és magyar címkéje, a szerver `MUSCLE_GROUPS`-ával **azonos sorrendben**. |
| 25–34   | `CHECKIN_SCALES`, `MOOD_SCALE`.                                                                                    |
| 35–45   | `readinessTone(value)` (80/60 küszöbök), `CONFIDENCE_LABELS`.                                                      |
| 46–90   | `buildScale({...})`, `readScale`, `writeScale` — az 1–5 skálák.                                                    |
| 91–107  | `fillBar(barEl, value, label)`, `NO_READINESS_TEXT`, `hasReadiness(value)`.                                        |
| 108–264 | `renderRecovery(report)` — a teljes készenléti riport kirajzolása.                                                 |

#### `render/coach.js` (268 sor)

| Sorok   | Mi történik                                                                                         |
| ------- | --------------------------------------------------------------------------------------------------- |
| 9–23    | `createCoachNote({ meta, text, me })` — egy üzenet-buborék; a `me` a saját üzeneteket tolja jobbra. |
| 24–45   | `athleteTier(rating)`, `orDash(value)` (`null` → „—", nem 0), `ATHLETE_CARD_STATS`.                 |
| 46–113  | `renderAthleteCard(athlete, index)`.                                                                |
| 114–149 | `renderInviteRow({...}, actions)`.                                                                  |
| 150–200 | `renderPlanOffer(offer)`.                                                                           |
| 201–268 | `renderCoachPanel({ athletes, invites })`.                                                          |

#### A kisebb render-modulok

| Fájl                | Sorok | Mi történik                                                                                                                                                                      |
| ------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render/foods.js`   | 11–56 | `renderFoods(foodList)` — az étel-lista; a `list` opcionális, hogy a lista és a naplózás ugyanabból az egy válaszból épüljön. A saját ételek elöl, jelvénnyel és törlés-gombbal. |
| `render/plans.js`   | 8–54  | `planCardEl(plan)` — egy terv-kártya; a szerkesztés gomb csak a saját terveken látszik.                                                                                          |
|                     | 55–72 | `plansData`, `renderPlans()`.                                                                                                                                                    |
| `render/prs.js`     | 10–38 | `renderPrs()` — a személyes rekordok listája; edzés-mentés után újrahívható.                                                                                                     |
| `render/workout.js` | 9–25  | `historyEntryEl(entry)` — egy „Korábbi edzések" sor; az id a gombokra is rákerül.                                                                                                |
|                     | 26–55 | `workoutHistoryEntry(workout)`, `syncHistoryEmpty()`, `renderWorkout()`.                                                                                                         |
| `render/summary.js` | 10–19 | `WORKOUT_START_KEY`, `markWorkoutStarted()` — az edzés kezdetét az aznapi első szett-pipa rögzíti.                                                                               |
|                     | 20–32 | `MAX_WORKOUT_HOURS` (8), `workoutMinutes()`.                                                                                                                                     |
|                     | 33–48 | `SUMMARY_QUOTES`, `summaryQuoteIndex`, `lastSummary`.                                                                                                                            |
|                     | 49–95 | `summarizeWorkout()`, `setLastSummary`, `renderSummary()`.                                                                                                                       |

### 6.5 `public/js/ui/` — oldalankénti interakciók

| Fájl                              | Sorok   | Mi történik                                                                                                                                                                                                                       |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/workout.js` (590)             | 1–34    | Importok.                                                                                                                                                                                                                         |
|                                   | 35–546  | **`setupWorkout(videoModal, prModal, picker, confirmAction)`** — az edzésnapló teljes vezérlője: gyakorlatok és szettek szerkesztése, sorrend, szuperszett, automatikus mentés, edzés mentése, javítás és törlés, terv betöltése. |
|                                   | 547–590 | `setupThumb(img, entry)` — a gyakorlat-illusztráció betöltése (hiányzó médiára csendes visszaesés).                                                                                                                               |
| `ui/workout/autosave.js` (169)    | 1–16    | Fejléc: debounce-olt PUT felső határidővel, korlátozott újrapróbálkozással, és a lap elrejtésekor egy utolsó **keepalive** kéréssel.                                                                                              |
|                                   | 17–169  | `createDraftAutosave({ buildBody })` — a törzset nem maga állítja elő, hanem a vezérlőtől kapja.                                                                                                                                  |
| `ui/workout/loading.js` (139)     | 1–21    | Fejléc: három forrás (szerver-sablon, mentett edzés javítása, terv) ugyanoda érkezik.                                                                                                                                             |
|                                   | 22–139  | `createContentLoader({...})` — a közös betöltő mag; a modul nem birtokolja a szerkesztőt, a DOM-ot a vezérlőtől kapja.                                                                                                            |
| `ui/workout/pr-indicator.js` (54) | 1–14    | Fejléc: a „PR" gomb `aria-pressed` állapota az **egyetlen, kizárólag képlet által vezérelt** jelzés a naplóban.                                                                                                                   |
|                                   | 15–54   | `createPrIndicators({ page, getMaxes })`.                                                                                                                                                                                         |
| `ui/coach.js` (596)               | 27–36   | `ATHLETE_MODAL_STATS`.                                                                                                                                                                                                            |
|                                   | 37–360  | `setupAthleteModal({...})` — a sportoló részletmodálja: statisztikák, cél, aktivitás, üzenetek, terv-kiosztás, kapcsolat bontása.                                                                                                 |
|                                   | 361–596 | `setupCoachPage(athleteModal, confirmAction)` — az Edző oldal két nézete (kliens / edző), meghívók, terv-ajánlatok.                                                                                                               |
| `ui/chat.js` (195)                | 11–31   | `relativeTime(iso)` — a hét fölött dátumra vált.                                                                                                                                                                                  |
|                                   | 32–53   | `messageNote(message)`, `unreadDivider(count)`.                                                                                                                                                                                   |
|                                   | 54–81   | `COACH_POLL_MS` (20 s), `feedNotice(text)`.                                                                                                                                                                                       |
|                                   | 82–195  | `createChatController({...})` — **közös** chat-vezérlő mindkét oldalnak.                                                                                                                                                          |
| `ui/nutrition.js` (376)           | 11–376  | `setupNutrition(foodDetail)` — keresés, naplózás, napi célok, a mai napló kezelése, napváltás-figyelés.                                                                                                                           |
| `ui/food-detail.js` (287)         | 13–39   | Adag-konstansok: `PORTION_MIN/MAX/STEP/DEFAULT`, `PORTION_QUICK`, `PICKER_ITEM_H`, `PORTION_VALUES`, `portionIndex`, `snapPortion` — **5 g-os rács** (ennél finomabb bontás konyhamérleg nélkül nem valós).                       |
|                                   | 40–52   | `foodTag(food)`.                                                                                                                                                                                                                  |
|                                   | 53–287  | `setupFoodDetail({ onAdd })` — az adagválasztó görgő és a naplózás.                                                                                                                                                               |
| `ui/custom-food.js` (268)         | 16–28   | `ATWATER` együtthatók (fehérje 4, szénhidrát 4, zsír 9).                                                                                                                                                                          |
|                                   | 29–268  | `setupCustomFood({...})` — saját étel felvitele, makró-ellenőrzéssel.                                                                                                                                                             |
| `ui/scanner.js` (326)             | 19–50   | `ZXING_URL`, `SCAN_FORMATS`, `SCAN_INTERVAL_MS`, `SCAN_CANVAS_W`, `CAMERA_ERRORS`.                                                                                                                                                |
|                                   | 51–326  | `setupScanner()` — **három szint** ebben a sorrendben: natív `BarcodeDetector` → ZXing lusta betöltéssel → kézi beírás.                                                                                                           |
| `ui/water.js` (86)                | 1–22    | Fejléc + `SIP_ML` (250). A mérő nem helyi számláló: minden korty a check-in folyadék-mezőjét is frissíti.                                                                                                                         |
|                                   | 23–86   | `setupWaterMeter()`.                                                                                                                                                                                                              |
| `ui/weight.js` (208)              | 19–27   | `WEIGHT_CHART_BARS` (12), `WEIGHT_CHART_MIN_SPAN` (2 kg), `formatDelta`.                                                                                                                                                          |
|                                   | 29–47   | `weightChartData(log)`.                                                                                                                                                                                                           |
|                                   | 48–62   | `weightLog`, `latestWeightEntry()`, `todayWeightEntry()`.                                                                                                                                                                         |
|                                   | 63–109  | `syncWeightViews({ animateDelta })`.                                                                                                                                                                                              |
|                                   | 110–190 | `WEIGHT_LIST_LIMIT` (8), `renderWeightList()`.                                                                                                                                                                                    |
|                                   | 191–208 | `refreshWeightLog()`, `mergeWeightEntry(entry)`.                                                                                                                                                                                  |
| `ui/measurements.js` (129)        | 10–15   | `dayKeyOf(dateStr)` — „ÉÉÉÉ.HH.NN" → rendezhető szám.                                                                                                                                                                             |
|                                   | 16–32   | `measurementSites`, `measurements`, `setMeasurements`, `measurementHistory`.                                                                                                                                                      |
|                                   | 33–129  | `renderMeasurements()`, `refreshMeasurements()`.                                                                                                                                                                                  |
| `ui/recovery.js` (250)            | 27–250  | `setupRecovery()` — a Regeneráció oldal: a hosszú check-in űrlap és a készenléti riport.                                                                                                                                          |
| `ui/summary.js` (225)             | 16–20   | `FEEDBACK_SCALES`.                                                                                                                                                                                                                |
|                                   | 21–180  | `setupSummary()` — az összegző oldal és az edzés utáni visszajelzés.                                                                                                                                                              |
|                                   | 181–225 | `setupWeeklyCompare()` — heti összehasonlítás.                                                                                                                                                                                    |
| `ui/exercise-picker.js` (259)     | 16–259  | `setupExercisePicker(confirmAction)` — katalógus, keresés, szűrő-chipek, **ajánlott gyakorlatok** a szervertől.                                                                                                                   |
| `ui/plan-builder.js` (195)        | 27–195  | `setupPlanBuilder(picker)` — napok, gyakorlatok, mentés.                                                                                                                                                                          |
| `ui/plans.js` (77)                | 11–77   | `setupPlans(planBuilder, workout, confirmAction)` — a Tervek oldal interakciói; hibázó vezérlő esetén a gombok nem visznek át.                                                                                                    |
| `ui/profile.js` (158)             | 14–158  | `formatWhole`, `setupProfile()` — adatok, összesítők, fiókműveletek.                                                                                                                                                              |
| `ui/settings.js` (243)            | 19–243  | `setupSettingsModal({...})` — profilnév, értesítés-kapcsolók, edzés-cél, adat-export, fiók-műveletek.                                                                                                                             |
| `ui/notifications.js` (143)       | 9–19    | Fejléc: az „olvasott" állapot egy **látott-időpont** (`prefs → notifSeenAt`), nem mindent elrejtő kapcsoló — a sorok maradnak, csak az újdonság-pötty tűnik el.                                                                   |
|                                   | 20–143  | `setupNotifications()` — a panel; minden megnyitáskor friss adatot kér.                                                                                                                                                           |
| `ui/modals.js` (274)              | 11–93   | `createModalController(modal)` — **közös** modal-vezérlő: backdrop/gomb zárás, Escape, fókusz-csapda, fókusz-visszaállítás, reduced-motion.                                                                                       |
|                                   | 94–173  | `setupAdviceModal()` — a check-in utáni javaslat („Elfogadom / Most nem").                                                                                                                                                        |
|                                   | 174–217 | `setupConfirmDialog()` — megerősítés az adatvesztéssel járó műveletekhez.                                                                                                                                                         |
|                                   | 218–234 | `setupVideoModal()`.                                                                                                                                                                                                              |
|                                   | 235–274 | `setupPrModal()`.                                                                                                                                                                                                                 |
| `ui/dashboard.js` (25)            | 6–25    | `setupDashboard(settingsModal)` — **minden** beállítás-gomb bekötése (`$$`, nem `$`), a `null` modál kezelésével.                                                                                                                 |
| `ui/shortcuts.js` (32)            | 12–32   | `isModalOpen()`, `setupShortcuts()` — 1–5 oldalváltás; gépelés közben és **nyitott modál mellett inaktív**. A modált közös horgony ismeri fel, nem osztálylista.                                                                  |
| `ui/connectivity.js` (15)         | 6–15    | `setupConnectivity()` — offline/online toast.                                                                                                                                                                                     |

### 6.6 `public/js/ui/bodymap/` — testtérkép

| Fájl                     | Sorok  | Mi történik                                                                                                                                                                                      |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bodymap/paths.js` (141) | 1–17   | Fejléc: a rajzterület 220×460; **minden oldalfüggő alakzat csak a bal félre** van megrajzolva, a jobb felet a komponens tükrözi — kézzel rajzolt koordinátákkal a két fél előbb-utóbb elcsúszna. |
|                          | 18–21  | `BODY_VIEW_BOX`, `BODY_HEAD`.                                                                                                                                                                    |
|                          | 23–45  | `TORSO_LEFT`, `LEGS_LEFT`, `ARM_LEFT`, `HALF_BODY`, `BODY_SILHOUETTE`.                                                                                                                           |
|                          | 47–75  | `SHOULDER`, `ARM`, `CALF` — a tükrözött régiók geometriája.                                                                                                                                      |
|                          | 76–141 | `BODY_REGIONS` — izomcsoportonként rajz, felirat-hely és tükrözési mód.                                                                                                                          |
| `bodymap/index.js` (363) | 1–19   | Fejléc: a **három dolog, ami újraírásnál csendben eltűnik** — pl. hogy húzás közben csak az érintett régió festődik újra (a teljes újrarajzolás megölné a pointer capture-t).                    |
|                          | 20–32  | `SVG_NS`, `DRAG_PX_PER_STEP` (14), `svgEl`, `clamp`.                                                                                                                                             |
|                          | 33–363 | `createBodyMap({...})` — a közös komponens; két hívója a check-in varázsló térkép-lépése és a Regeneráció oldal.                                                                                 |

### 6.7 `public/js/ui/checkin/` — a napi check-in varázsló

| Fájl                         | Sorok  | Mi történik                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkin/wizard.js` (270)    | 1–29   | Fejléc: ez a **váz** — a lépések sorrendje, a fejléc, a mentés és a betöltés. A lépések a `steps/` alatt élnek.                                                                                                                                                                  |
|                              | 30–270 | `setupCheckinWizard()`.                                                                                                                                                                                                                                                          |
| `checkin/constants.js` (103) | 5–9    | `CI_BASE_STEPS` (a mindig jelen lévő lépések), `CI_SCALE_STEPS`.                                                                                                                                                                                                                 |
|                              | 10–31  | Alvás- és testsúly-határok, gyorsgomb-értékek (`CI_SLEEP_PRESETS`, `CI_WEIGHT_*`).                                                                                                                                                                                               |
|                              | 33–52  | `CI_GATES` — a kapu-kérdések (van-e izomláz / fájdalom); a válasz fűzi be a térkép-lépéseket.                                                                                                                                                                                    |
|                              | 53–77  | `CI_MAP_MODES`.                                                                                                                                                                                                                                                                  |
|                              | 78–103 | `CI_ADVANCE_MS`, `CI_PRESET_ADVANCE_MS`, `CI_PAIN_BLOCK` (7/10 felett letiltás), `CI_READINESS_VERDICTS`.                                                                                                                                                                        |
| `checkin/session.js` (51)    | 1–23   | Fejléc: a **`carried`** a legfontosabb mező. A `PUT /api/checkin` teljes sort ír felül, ezért a varázsló által nem kérdezett mezőket (közérzet, folyadék, általános fájdalom) betöltéskor eltesszük és mentéskor változatlanul visszaküldjük — enélkül némán `NULL`-ra állnának. |
|                              | 24–51  | `ci`, `resetSession`, `clearSession`, `ciStepOrder()` (a kapu-válaszok szerint), `ciCountedSteps`.                                                                                                                                                                               |
| `checkin/helpers.js` (43)    | 5–18   | `ciMuscleLabel`, `ciClamp`, `ciPickPositive` — a 0 a részletes űrlapon érvényes „semmi", a térképen viszont a NEM megjelölt állapot.                                                                                                                                             |
|                              | 19–43  | `ciEmptyState()`, `ciDateStr()`.                                                                                                                                                                                                                                                 |
| `steps/intro.js` (68)        | 10–21  | `renderIntro(nav)`.                                                                                                                                                                                                                                                              |
|                              | 22–62  | `applyOnboardingIntro(step)` — az első indítás külön szövege.                                                                                                                                                                                                                    |
|                              | 63–68  | `applyIntroActions(step, nav)`.                                                                                                                                                                                                                                                  |
| `steps/sleep.js` (80)        | 17–80  | `renderSleep(nav)` — óraszám léptetővel és gyorsgombokkal.                                                                                                                                                                                                                       |
| `steps/scale.js` (67)        | 10–67  | `renderScale(stepName, nav)` — **egy renderelő mindhárom 1–5 skálának** (alvásminőség, energia, stressz).                                                                                                                                                                        |
| `steps/weight.js` (126)      | 18–19  | `ciWeightReference()` — mai mérés, különben a legutóbbi.                                                                                                                                                                                                                         |
|                              | 20–126 | `renderWeight(nav)` — viszonyítási ponttal és „ma nem mértem" kiúttal.                                                                                                                                                                                                           |
| `steps/gate.js` (50)         | 9–50   | `renderGate(stepName, nav)` — a válasz dönti el a következő lépést.                                                                                                                                                                                                              |
| `steps/map.js` (35)          | 9–35   | `renderMap(stepName, nav)` — a közös `bodymap` komponens beillesztése.                                                                                                                                                                                                           |
| `steps/summary.js` (99)      | 12–74  | `renderSummary(nav)`.                                                                                                                                                                                                                                                            |
|                              | 75–99  | `renderReadiness(step, overall, { animate })` — a mentés utáni készenléti kártya.                                                                                                                                                                                                |

---

## 7. Segédszkriptek — `scripts/`

### `scripts/build-exdb.js` (515 sor) — katalógus-generátor

Forrás: `hasaneyldrm/exercises-dataset` (1324 gyakorlat). Kimenet: `server/data/exercises.exdb.js`
(**generált**, kézzel nem szerkesztendő). Futtatás: `npm run exdb:build`.

| Sorok   | Mi történik                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1–42    | Fejléc: a hat lépés leírása (letöltés a `.exdb/` munkakönyvtárba, szűrés, fordítás, variáns-összevonás, kurált fájlhoz illesztés, modul-kiírás).       |
| 43–58   | Útvonalak: `WORK_DIR`, `SOURCE_JSON`, `OUT_FILE`, `REPORT_FILE`, `SOURCE_URL`.                                                                         |
| 59–90   | `buildPhraseMap()`, `normalizeSourceName(raw)`, `PASSTHROUGH`.                                                                                         |
| 91–187  | `translateName(rawName, phrases)`, `translatePhrase(text, { map, maxWords })` — **leghosszabb-találat-előnnyel** fordít kifejezésenként.               |
| 188–207 | `loadSource()` — letöltés, ha még nincs meg (a `.exdb/` gitignore-olt: 17 MB).                                                                         |
| 208–332 | `main()` — a teljes folyamat.                                                                                                                          |
| 333–373 | `collapseVariants(entries, curatedNames)` — a lényegében azonos variánsok összevonása.                                                                 |
| 374–426 | `EQUIPMENT_RANK`, `equipmentRank`, `matchCuratedBySuffix(...)` — a generált média hozzárendelése a kurált gyakorlatokhoz.                              |
| 427–490 | `renderModule(entries, mediaForCurated)` — a kimeneti JS modul szövegének előállítása (`exdbExercises`, `exdbMediaForCurated`), `q()` idézőjelezéssel. |
| 491–515 | `renderReport(failures, unknownTally)` — a lefedettségi jelentés a `.exdb/report.txt`-be.                                                              |

### `scripts/fetch-exdb-media.js` (156 sor) — média-letöltő

| Sorok   | Mi történik                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------- |
| 1–34    | Fejléc: csak a **hivatkozott** fájlokat tölti le (a teljes forrás-repo 125 MB); a letöltés folytatható. |
| 35–57   | Útvonalak, `BASE_URL`, `CONCURRENCY` (8), `ATTRIBUTION` — a licenc megköveteli a forrás megjelölését.   |
| 58–67   | `mediaPaths(exercises)`.                                                                                |
| 68–88   | `fetchOne(relPath)` — a meglévő fájlokat átugorja.                                                      |
| 89–100  | `runPool(items, worker)` — egyszerű párhuzamosítás.                                                     |
| 101–156 | `main()` — `--limit N` kapcsolóval gyors próbához.                                                      |

---

## 8. Tesztek

`npm test` → `node --test` a `server/**/*.test.js` és a `public/**/*.test.js` fájlokon.
**Nulla tesztkeretrendszer-függőség.**

### Közös váz

| Fájl                     | Sorok   | Mi ez                                                                                                                                          |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/test-harness.js` | 1–20    | Fejléc: öt tesztfájl ugyanazt csinálja (ideiglenes DB, `PORT=0`-val indított külön folyamat, a port kiolvasása az indulási sorból, takarítás). |
|                          | 21–93   | `startServer({ label, extraEnv })`.                                                                                                            |
|                          | 94–126  | `makeRequest(baseUrl)` — a HTTP-segéd.                                                                                                         |
|                          | 127–140 | `cookieFrom`, `today()`, `gyakorlat(name, weight, reps)` — teszt-adat gyártó.                                                                  |

### Szerver-tesztek

| Fájl                      | Sorok | Mit őriz                                                                                                                                                                                                      |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.test.js`             | 2332  | A végpontok teljes viselkedése: bejelentkezés nélkül **minden** `/api` 401; regisztráció-validálás; a második fiók nem örököl; a belépés nem árulja el, a név vagy a jelszó volt-e rossz.                     |
| `coach.test.js`           | 1230  | Az edző–sportoló réteg: a meghívó elfogadásig NEM ad hozzáférést; idegen nem fogadhatja el a más nevére szóló meghívót; a kártya a sportoló SAJÁT naplójából számol; a kívülálló semmit nem lát.              |
| `recovery.test.js`        | 1116  | A készenlét-motor: alvás-pontszám alakja, a 60/40 arány, a vadonatúj fiók **nincs pontszám** (nem pedig tökéletes pontszám), a hiányzó komponensek súlyának arányos újraosztása.                              |
| `users.test.js`           | 298   | **Adatizoláció** — ez a fájl azt a hibát őrzi, ami miatt a fiókok bekerültek. Minden állítás ugyanazt kérdezi: lát-e „A" bármit „B" adatából (listával, id-re hivatkozva, exporttal)? A válasz mindenhol nem. |
| `prs.test.js`             | 297   | Az Epley-képlet; a PR a SAJÁT korábbi csúcshoz mérődik; a rekordot a legjobb **teljesített** szett hozza, nem a bemelegítő.                                                                                   |
| `migration.test.js`       | 255   | A migráció egyetlen sort sem veszít; az archív fiók létrejön, de belépni nem lehet vele; az ELSŐ regisztráció örököl, a második nem; idempotens.                                                              |
| `suggestions.test.js`     | 245   | A címfelismerés magyar összetett szavakra; a félrevivő szavakra („Hétfő", „A nap") NEM talál; a két jel egyenrangú; a küszöb alatti csoport nem kerül be.                                                     |
| `errors.test.js`          | 240   | Az async kezelő elutasított ígérete 500-as JSON-t ad, nem néma kérést; a hiba RÉSZLETEI nem szivárognak ki; a négyparaméteres hibakezelőt nem csomagoljuk be.                                                 |
| `openfoodfacts.test.js`   | 223   | `normalizeBarcode` (EAN-8/UPC-A kiegészítés, ellenőrzőszám) és `mapProduct` (magyar név elsőbbsége) — hálózat nélkül.                                                                                         |
| `account.test.js`         | 203   | Jelszóváltás és fióktörlés: kérik a jelenlegi jelszót; váltás után a többi eszköz kiesik; a törölt név újra kiadható, és az új fiók ÜRESEN indul.                                                             |
| `security.test.js`        | 183   | Méret-korlátok (50 gyakorlat × 50 szett), a megjegyzés-cél alakja, a belépés-korlát `Retry-After`-rel, és hogy proxy mögött a korlát a VALÓDI forrásra szól.                                                  |
| `auth.test.js`            | 177   | A hash ellenőrizhető, de nem visszafejthető; ugyanaz a jelszó kétszer más hasht ad; az ÜRES hash (archív fiók) sosem enged be; süti-jelzők.                                                                   |
| `szamitasok.test.js`      | 170   | Számítási csapdák: a folyadék nem nullázódik, az adag a kerekítetlen alapértékből számol, a súlycsökkentés kis súlyon sem visz nullára.                                                                       |
| `timezone.test.js`        | 163   | Az `X-Client-Date` fejléc: a naplózás a FELHASZNÁLÓ napjára megy, de a távoli dátumot nem fogadja el.                                                                                                         |
| `notifications.test.js`   | 133   | Üres bemenetre üres lista (nem találunk ki tartalmat); szálanként EGY sor; **időbélyeg nélküli esemény NEM kerül a listába**.                                                                                 |
| `messages.test.js`        | 144   | A migrált üzenetek OLVASATLANOK (nem hazudunk olvasást); a nyugtázás csak a másik fél üzeneteit érinti, idempotensen.                                                                                         |
| `coaching.test.js`        | 436   | A heti állás, a terv-követés (**terv nélkül `null`, nem 0%**), a mai nap nem elmaradás.                                                                                                                       |
| `cache.test.js`           | 109   | A két nagy referencia-lista cache-elt, a fiókfüggő kulcsok NEM; a katalógus-index a hívó tömbjéhez kötődik.                                                                                                   |
| `ratelimit.test.js`       | 100   | A `trust proxy: true` TILTOTT; a limit, az ablak-újraindulás, és hogy a további kopogtatás nem tolja ki a várakozást.                                                                                         |
| `onerm-migration.test.js` | 93    | Az 1RM-képlet váltása: a mért csúcs újraépül, a bemondott megmarad, a séma-verzió 1 lesz.                                                                                                                     |
| `dst.test.js`             | 79    | **Óraátállítás**: a sorozat nem szakad meg, a terv-követés átlát az átállításon.                                                                                                                              |

### Frontend-tesztek

| Fájl                                 | Sorok | Mit őriz                                                                                                                                  |
| ------------------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `public/js/ui/bodymap/paths.test.js` | 128   | A két nézet uniója pontosan a kilenc izomcsoport; minden régió a rajzterületen belül; a tükrözött régiók RAJZA is a bal félen van.        |
| `public/js/ui/shortcuts.test.js`     | 63    | DOM nélkül: a gyorsbillentyű-őr a **közös horgonyt** használja, nem modál-listát, és minden modál-gyökér közvetlen kártyája `aria-modal`. |
| `public/js/core/one-rm.test.js`      | 24    | A kliens PR-jelzője **ugyanazt** az 1RM-et számolja, mint a szerver.                                                                      |
| `public/js/ui/icons.test.js`         | 22    | Minden `<use href="#…">` létező szimbólumra mutat, és gombban nincs üres `<svg>` (az láthatatlan, de kattintható gombot adna).            |

---

## 9. Konfiguráció és egyéb fájlok

| Fájl                                               | Sorok | Mi ez                                                                                                                                                                                                                  |
| -------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                     | 1–33  | `type: module`, Node **≥ 22.5** (a `node:sqlite` miatt). Szkriptek: `start`, `dev` (`--watch`), `test`, `lint`, `format`, `graph`, `exdb:build`, `exdb:media`. Két futásidejű függőség: `express` és `@zxing/library`. |
| `eslint.config.js`                                 | 1–15  | Fejléc: a projektnek nincs build-lépése, ezért a **linter az egyetlen automatikus védőháló**.                                                                                                                          |
|                                                    | 16–97 | `GENERATED` (a gépből generált adatfájlok kihagyása), majd a két környezet (Node a `server/`-hez, böngésző a `public/js/`-hez). A stílus-szabályokat a Prettier-re hagyjuk.                                            |
| `.prettierrc.json`                                 | —     | Formázási beállítások.                                                                                                                                                                                                 |
| `.prettierignore`, `.gitignore`, `.graphifyignore` | —     | Kihagyott útvonalak (köztük a `.exdb/` munkakönyvtár és a letöltött `public/exercises/` média).                                                                                                                        |
| `README.md`                                        | —     | Tervezési döntések, indítás, **élesítés** (perzisztens tároló, trust proxy).                                                                                                                                           |
| `doc.txt`                                          | —     | „MI MIT CSINÁL" — funkcionális leírás.                                                                                                                                                                                 |
| `TEENDOK.txt`                                      | —     | Ami még hiányzik.                                                                                                                                                                                                      |
| `MVP.md`                                           | —     | Az MVP hatóköre.                                                                                                                                                                                                       |
| `PR_TRACKING_GUIDE.md`                             | —     | A PR-követés menete.                                                                                                                                                                                                   |
| `docs/superpowers/`                                | —     | Tervek és specifikációk (dizájn-átültetés, működési hibák javítása).                                                                                                                                                   |
| `.claude/`                                         | —     | Claude Code beállítások és a `graphify` skill.                                                                                                                                                                         |
