/**
 * ESLint — flat config.
 *
 * A projektnek nincs build-lépése, ezért a linter az egyetlen automatikus
 * védőháló a kód fölött. Két környezet van, más globálisokkal:
 * a szerver Node-ban fut (server/), a frontend a böngészőben (public/js/).
 *
 * A stílus-szabályokat szándékosan a Prettier-re hagyjuk (eslint-config-
 * prettier kikapcsolja őket) — a linter hibákat keres, nem formáz.
 */
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/** A gépből generált gyakorlat-adatbázis: több ezer soros adat, nem kód. */
const GENERATED = [
  'server/data/exercises.exdb.js',
  'server/data/exdb.names.hu.js',
  'server/data/exdb.map.js',
];

export default [
  { ignores: ['node_modules/**', 'public/gyujto/**', ...GENERATED] },

  js.configs.recommended,

  {
    // Közös szabályok mindkét környezetre.
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      // A nem használt kód elhal és félrevezet — de a szándékosan kihagyott
      // paramétert és a catch-kötést engedjük aláhúzás-előtaggal jelölni.
      // Az ignoreRestSiblings az "elhagyás" mintát engedi: a
      // `({ load, extId, ...visible }) => visible` nem hanyagság, hanem az a
      // szándék, hogy a két mező NE kerüljön a válaszba.
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      // Az elnyelt hiba a legdrágább hiba: a felhasználó azt hiszi, minden
      // rendben. Üres blokk csak kifejezett szándékkal, kommenttel maradhat.
      'no-empty': ['error', { allowEmptyCatch: false }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-implicit-coercion': ['error', { boolean: false }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-return-await': 'error',
      'require-await': 'warn',
    },
  },

  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },

  {
    // A scripts/ CLI-eszközök: a konzol itt a felhasználói felület.
    files: ['scripts/**/*.js'],
    rules: { 'no-console': 'off' },
  },

  {
    files: ['public/js/**/*.js'],
    languageOptions: { globals: globals.browser },
    rules: {
      /* A lapok vezérlői (setup*) EGYSÉGESEN awaitolhatók: az app/init.js
         mindet ugyanazon a `safe(...)` úton indítja. Az, hogy egyikük törzse
         épp nem await-el, nem hanyagság, hanem a közös szerződés ára — a
         require-await itt hamis riasztást adna. */
      'require-await': 'off',
    },
  },

  {
    // A tesztek node:test globálisait a Node környezet fedi; a console itt
    // munkaeszköz, nem elfelejtett debug-nyom.
    //
    // A require-await is kikapcsol: a hibakezelés tesztjeihez KELLENEK olyan
    // async kezelők, amelyek await nélkül dobnak — pontosan az az eset, amit
    // a védőhálónak el kell kapnia.
    files: ['server/**/*.test.js'],
    rules: { 'no-console': 'off', 'require-await': 'off' },
  },

  prettier,
];
