/**
 * Podium — a fejléc-sáv neve, monogramja és napja
 * ------------------------------------------------------------------------
 * A telefonos fejléc köszön („Szia, Bence"), monogramot mutat (NB) és kiírja
 * a nap nevét. Asztalon a régi alak marad: teljes név és dátum. A név több
 * helyről íródik (induláskor, és a beállításokban gépelés közben), ezért egy
 * függvény festi mindegyik helyet — különben a köszönés és a név elcsúszna.
 *
 * A tiszta segédek (greetingName, initials, weekdayLabel) DOM nélkül is
 * futnak; a teszt ezeket hívja.
 */

const words = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** A megszólítás: a magyar névsorrendben a második szó a keresztnév
    („Nagy Bence" → „Bence"); egyszavas névnél maga a név. */
export const greetingName = (name) => {
  const parts = words(name);
  return parts.length >= 2 ? parts[1] : (parts[0] ?? '');
};

/** Monogram: az első két szó kezdőbetűje nagybetűvel („NB"), egyszavas
    névnél egy betű. Array.from: az ékezetes kezdőbetű is egy karakter. */
export const initials = (name) =>
  words(name)
    .slice(0, 2)
    .map((word) => Array.from(word)[0].toLocaleUpperCase('hu-HU'))
    .join('');

/** A nap neve kisbetűvel („csütörtök") — a nagybetűsítést a CSS végzi. */
export const weekdayLabel = (date) => date.toLocaleDateString('hu-HU', { weekday: 'long' });

const each = (selector, fn) => document.querySelectorAll(selector).forEach(fn);

/** A megjelenített név minden helyre: teljes név, köszönés, monogram. */
export function paintChromeName(name) {
  each('.db-username', (el) => {
    el.textContent = name;
  });
  each('[data-chrome-hello]', (el) => {
    const first = greetingName(name);
    el.textContent = first ? `Szia, ${first}` : 'Szia!';
  });
  each('[data-chrome-initials]', (el) => {
    el.textContent = initials(name);
  });
}

/** A dátum („11.12.") és a telefonos sor napja („csütörtök · 11.12.").
    A `today` a kérésekkel azonos clientDate() ("ÉÉÉÉ.HH.NN"). */
export function paintChromeDate(today) {
  const [year, month, day] = today.split('.');
  const short = `${month}.${day}.`;
  each('[data-chrome-date]', (el) => {
    el.textContent = short;
  });
  const weekday = weekdayLabel(new Date(Number(year), Number(month) - 1, Number(day)));
  each('[data-chrome-day]', (el) => {
    el.textContent = `${weekday} · ${short}`;
  });
}
