/** DOM-segédek: lekérdezés, sablon-klónozás, késleltetett szkript-betöltés. */

/* ======================================================================
   2. Segédfüggvények
   ====================================================================== */
const $ = (selector, root = document) => root.querySelector(selector);

const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Egy számmező értéke, vagy null, ha üres (vagy nem szám). A `Number('')`
    0-t ad, ezért egy kiürített mező korábban csendben 0-ként ment tovább — az
    „üres" viszont „nincs megadva", a ténylegesen beírt 0 pedig érvényes 0. A
    vessző is tizedesjel. */
const readNumberInput = (input) => {
  const text = String(input?.value ?? '')
    .trim()
    .replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/** Template klónozása — a template-eknek egyetlen gyökérelemük van. */
const cloneTemplate = (id) => $('#' + id).content.firstElementChild.cloneNode(true);

/** Külső szkript LUSTA betöltése, URL-enként egyszer (az ígéret cache-elt).
    Bundler nincs a projektben, a ZXing vonalkód-dekóder viszont 336 KB —
    ezt nem tesszük minden oldalbetöltés útjába. Csak akkor tölt le, ha a
    felhasználó ténylegesen szkennel, ÉS a natív BarcodeDetector nem elérhető.
    Hibánál a bejegyzést töröljük, hogy egy későbbi próbálkozás újrakezdhesse. */
const loadedScripts = new Map();

function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(
      src,
      new Promise((resolve, reject) => {
        const element = document.createElement('script');
        element.src = src;
        element.async = true;
        element.onload = resolve;
        element.onerror = () => {
          loadedScripts.delete(src);
          reject(new Error(`Nem sikerült betölteni: ${src}`));
        };
        document.head.appendChild(element);
      }),
    );
  }
  return loadedScripts.get(src);
}

export { $, $$, cloneTemplate, loadScript, prefersReducedMotion, readNumberInput };
