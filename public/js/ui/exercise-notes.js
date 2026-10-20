/** Gyakorlat-megjegyzés sor válasz-mezővel — az edzői részletnézet és a
    sportolói „Edződ" nézet közös rajzolója. A válasz UGYANABBA a szálba megy
    (azonos cél), csak más szerzővel: ettől lesz egy beszélgetés a gyakorlatról,
    nem két külön lista. */

import { api } from '../core/api.js';
import { showToast } from '../core/toast.js';
import { relativeTime } from '../core/format.js';

/** Törlőgomb a NÉZŐ saját megjegyzésére: törlés után a `row` kikerül.
    A szerver is csak a szerzőnek enged (DELETE /api/comments/:id). */
export function noteDeleteButton(comment, row) {
  const del = document.createElement('button');
  del.className = 'co-note-del ds-icon-del ds-icon-del--inline';
  del.type = 'button';
  del.textContent = '✕';
  del.title = 'Megjegyzés törlése';
  del.setAttribute('aria-label', 'Saját megjegyzés törlése');
  del.addEventListener('click', async () => {
    del.disabled = true;
    try {
      await api.deleteMyComment(comment.id);
      row.remove();
      showToast('Megjegyzés törölve');
    } catch (err) {
      console.error(err);
      del.disabled = false;
      showToast(err.message || 'Nem sikerült törölni a megjegyzést', 'error');
    }
  });
  return del;
}

/**
 * @param {object} note  a szerver megjegyzés-sora (exercise, workout, date, mine, …)
 * @param {(target: string, text: string) => Promise} send  a nézet saját
 *        küldője (edzőként a kapcsolatra, sportolóként a saját fiókra)
 */
export function exerciseNoteRow(note, send) {
  const item = document.createElement('li');
  item.className = 'co-note-item';

  const head = document.createElement('p');
  head.className = 'co-note-head';
  // „Te", ha a NÉZŐ írta — ugyanaz a szemszög-jelölés, mint a chatben
  const who = note.mine ? 'Te' : note.authorName;
  head.textContent = `${note.exercise} · „${note.workout}" ${note.date} · ${who} · ${relativeTime(note.at)}`;

  const body = document.createElement('p');
  body.className = 'co-note-body';
  body.textContent = note.text;

  const form = document.createElement('form');
  form.className = 'co-note-reply';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 1000;
  input.placeholder = 'Válasz erre a gyakorlatra…';
  input.setAttribute('aria-label', `Válasz — ${note.exercise}`);
  const button = document.createElement('button');
  button.type = 'submit';
  button.textContent = 'Küldés';
  form.append(input, button);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    button.disabled = true;
    try {
      await send(note.target, text);
      input.value = '';
      showToast('Megjegyzés elküldve');
      // A friss sor a következő frissítéskor jön le a szerverről; itt
      // azonnal kiírjuk, hogy a küldés látható eredményt adjon.
      const mine = document.createElement('p');
      mine.className = 'co-note-body';
      mine.textContent = `Te: ${text}`;
      item.insertBefore(mine, form);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'A megjegyzést nem sikerült elküldeni', 'error');
    } finally {
      button.disabled = false;
    }
  });

  if (note.mine) head.append(noteDeleteButton(note, item));

  item.append(head, body, form);
  return item;
}
