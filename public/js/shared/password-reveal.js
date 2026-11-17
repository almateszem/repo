/**
 * Podium — a jelszómező „Mutasd" gombja
 * ------------------------------------------------------------------------
 * A regisztrációnál egyetlen jelszómező van, megerősítés és jelszó-
 * visszaállítás nélkül: egy elgépelés végleg kizárt a fiókból. A „Mutasd"
 * ugyanazt védi, mint egy második mező, kevesebb gépeléssel, és a
 * jelszókezelőkkel sem akad össze. A belépésnél is ott van.
 */

/** A gomb és a mező összekötése. A visszaadott `hide` a mezőt visszarejti
    (pl. sikeres beküldés után, hogy a következő megnyitáskor ne látsszon). */
export function bindPasswordReveal(input, button) {
  const set = (shown) => {
    input.type = shown ? 'text' : 'password';
    button.textContent = shown ? 'Elrejt' : 'Mutasd';
    button.setAttribute('aria-pressed', String(shown));
    button.setAttribute('aria-label', shown ? 'Jelszó elrejtése' : 'Jelszó megjelenítése');
  };
  button.addEventListener('click', () => {
    set(input.type === 'password');
    input.focus();
  });
  set(false);
  return { hide: () => set(false) };
}
