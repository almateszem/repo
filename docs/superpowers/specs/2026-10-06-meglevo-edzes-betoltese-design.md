# Terv-építő: „Ugyanaz, mint…" helyett „Meglévő edzés betöltése"

Dátum: 2026-10-06 · Állapot: kész

## Miért

A hét napjaihoz a mostani „Ugyanaz, mint…" mód nehezen érthető. Helyette az
Edzés módban lehessen egy már meglévő edzést kiválasztani és bemásolni.

## Döntések (a kérdések alapján)

| Kérdés                         | Döntés                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| Honnan lehet edzést választani | Mindkettő: a terv másik napjai **és** a napló korábbi edzései |
| Kapcsolat vagy másolat         | **Mindig másolat** — utána szabadon szerkeszthető             |
| Ha a napon már van gyakorlat   | **Csere**, nem üres napnál megerősítés után                   |
| A választó formája             | **Külön, kereshető oldal** a gyakorlat-választó mintájára     |
| Napló-tételek                  | **Minden alkalom** külön sorban, legújabb elöl, kereshető     |

## UI — terv-építő

- A nap típusválasztója két gombos: **Edzés / Pihenő**. Az „Ugyanaz, mint…"
  gomb és a legördülő megszűnik.
- Az Edzés panelen a „+ Gyakorlat hozzáadása" mellett új gomb:
  **„Meglévő edzés betöltése"**.

## UI — új választó-oldal (`#workout-picker`)

- Fejléc: „← Vissza a terv-építőhöz", cím: „Edzés betöltése · <Nap>".
- Keresőmező (név szerinti szűrés).
- **A terv napjai**: a terv többi, gyakorlatot tartalmazó edzésnapja
  („Hétfő – Láb nap · 6 gyakorlat").
- **Korábbi edzések**: minden naplózott edzés, legújabb elöl
  („Láb nap · szept. 30. · 6 gyakorlat").
- Koppintásra a nap gyakorlatai lecserélődnek; ha a nap nem üres, előbb a
  meglévő megerősítő ablak kérdez („Lecseréled a 4 gyakorlatot?"). Utána
  vissza a terv-építőbe.
- Másolat: a forrás későbbi változása nem hat a napra.
- Naplóból: a szettek értékei (súly, ismétlés, típus, időalapú mezők)
  átjönnek, egyik sem „kész".
- Ha a napnak nincs saját neve, a forrás edzés nevét kapja (átírható).

## Régi tervek

- A szerver (`server/plan-week.js`) továbbra is elfogadja a `same` napot —
  a régi tervek változatlanul működnek, nincs migráció.
- A terv-építőben megnyitott régi terv `same` napjai a hivatkozott nap
  másolatává alakulnak; mentéskor már csak `workout` / `rest` nap megy fel.

## Érintett fájlok

- `public/index.html` — gomb, új oldal, a `same` blokk törlése
- `public/js/ui/plan-builder.js` — `sameTargets`, `releaseReferences`,
  `same` mód kivétele; betöltés-kezelés
- új `public/js/ui/workout-picker.js`
- `public/style.css` — az új oldal pár szabálya
- `README.md` — az érintett bekezdés

## Tesztelés

Meglévő tesztek és lint, majd böngészőben: betöltés a terv másik napjáról,
naplóból, csere megerősítése, régi `same`-es terv szerkesztése és mentése.
