/**
 * Podium — kis DOM-építő a programozó moduljainak
 * ------------------------------------------------------------------------
 * h('div', { class, data, attrs, text, value }, ...gyerekek). A szöveg
 * mindig textContent: felhasználói név (gyakorlat, nap) nem kerülhet
 * HTML-be. A null/false gyerek kimarad.
 */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text != null) el.textContent = props.text;
  for (const [k, v] of Object.entries(props.data ?? {})) if (v != null) el.dataset[k] = v;
  for (const [k, v] of Object.entries(props.attrs ?? {})) if (v != null) el.setAttribute(k, v);
  if (props.value != null) el.value = props.value;
  el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

/** A konténer tartalmának cseréje: a tömbök kilapulnak, a null/false kimarad. */
export function fill(container, ...kids) {
  container.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}
