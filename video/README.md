# FitTrack Pro — bemutató videó

Remotion-projekt, ~33 mp, 1920×1080, 30 fps. Az app dizájn-tokenjeit
(`public/style.css`) követi, a testtérkép pedig közvetlenül az app
geometriáját importálja (`public/js/ui/bodymap/paths.js`) — ha a figura
változik, a videó is követi.

## Parancsok

```bash
cd video
corepack pnpm install     # az npm cache ezen a gépen elbukik, a pnpm megy
npx remotion studio       # előnézet és szerkesztés: http://localhost:3000
npx remotion render FitTrackShowcase out/fittrack-bemutato.mp4
```

Ha a render a végén `libavdevice.so: cannot open shared object file` hibával
áll meg (PRoot alatt a beépített ffmpeg nem találja a saját libjeit):

```bash
export LD_LIBRARY_PATH=$PWD/node_modules/@remotion/compositor-linux-arm64-gnu
```

## Felépítés

| Fájl                   | Tartalom                                                   |
| ---------------------- | ---------------------------------------------------------- |
| `src/Showcase.tsx`     | a jelenetek sorrendje, hossza és az átmenetek              |
| `src/theme.ts`         | színek, betűk (Inter, JetBrains Mono)                      |
| `src/ui/SceneFrame.tsx`| a funkció-jelenetek közös váza: balra szöveg, jobbra „képernyő” |
| `src/scenes/*.tsx`     | Intro, Készenlét, Check-in, Edzésnapló, Táplálkozás, Edző, Zárókép |

Minden jelenet külön kompozícióként is szerepel a Studio „Jelenetek”
mappájában. A jelenetek adatai (nevek, számok) illusztrációk, nem valódi
felhasználói adatok.
