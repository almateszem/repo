/** Nav ring — húzható navigációs gomb (pointer + billentyűzet). */

import { prefersReducedMotion } from '../shared/dom.js';

const RING_RADIUS = 44; // px, a gomb maximális kitérése

const DIR_THRESHOLD = 26; // px, ekkora elmozdulástól számít iránynak; ez alatt a húzás koppintás (home)

const AXIS_BIAS = 1.25; // az egyik tengelynek ennyiszer nagyobbnak kell lennie, hogy irányt válasszon

function setupNavRing(knob, onNavigate) {
  const labels = knob.closest('.nav-ring-wrap')?.querySelectorAll('.nl') ?? [];
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let direction = null;
  let maxDistance = 0;

  // A cél kiemelése húzás közben: a felirat és a gomb kerete is jelzi, hová visz.
  const highlight = (dir) => {
    labels.forEach((label) => label.classList.toggle('is-target', label.dataset.navDir === dir));
    knob.classList.toggle('is-armed', dir !== null);
  };

  const reset = () => {
    highlight(null);
    knob.style.cursor = 'grab';
    if (!prefersReducedMotion) {
      knob.style.transition = 'transform .4s cubic-bezier(.18,.9,.2,1.1)';
      setTimeout(() => (knob.style.transition = ''), 420);
    }
    knob.style.transform = 'translate(-50%,-50%)';
    pointerId = null;
  };

  const onDown = (event) => {
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    direction = null;
    maxDistance = 0;
    startX = event.clientX;
    startY = event.clientY;
    knob.style.cursor = 'grabbing';
    knob.style.transition = '';
    try {
      knob.setPointerCapture(pointerId);
    } catch (_) {
      /* nem kritikus */
    }
    event.preventDefault();
  };

  const onMove = (event) => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const distance = Math.hypot(dx, dy);
    maxDistance = Math.max(maxDistance, distance);

    const clamped = Math.min(distance, RING_RADIUS);
    const angle = Math.atan2(dy, dx);
    knob.style.transform = `translate(calc(-50% + ${Math.cos(angle) * clamped}px), calc(-50% + ${Math.sin(angle) * clamped}px))`;

    // Domináns tengely + hiszterézis: az átlós sávban (a két tengely közel
    // egyenlő) az előző irány marad — pontosan 45°-nál nem dől el véletlenül.
    const previous = direction;
    if (distance < DIR_THRESHOLD) direction = null;
    else if (Math.abs(dx) > Math.abs(dy) * AXIS_BIAS) direction = dx > 0 ? 'right' : 'left';
    else if (Math.abs(dy) > Math.abs(dx) * AXIS_BIAS) direction = dy > 0 ? 'down' : 'up';
    if (direction !== previous) highlight(direction);
    event.preventDefault();
  };

  const onUp = (event) => {
    if (event.pointerId !== pointerId) return;
    // A rövid húzás (nem érte el az irány-küszöböt) koppintás: az Áttekintésre visz.
    // Ha viszont a felhasználó kihúzta, majd visszahúzta a gombot, az mégse.
    const nav = direction ?? (maxDistance < DIR_THRESHOLD ? 'home' : null);
    reset();
    if (nav) onNavigate(nav);
  };

  const onCancel = (event) => {
    if (event.pointerId === pointerId) reset();
  };

  // Billentyűzetes navigáció ugyanazokkal az irányokkal
  const KEY_TO_DIR = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    Enter: 'home',
    ' ': 'home',
  };
  const onKeyDown = (event) => {
    const dir = KEY_TO_DIR[event.key];
    if (!dir) return;
    event.preventDefault();
    onNavigate(dir);
  };

  // Az iránycímkék is koppinthatók: a húzás mellett egy érintés is elég.
  // A címkék aria-hidden-ek — a billentyűzet és a képernyőolvasó a gombot használja.
  knob.closest('.nav-ring-wrap')?.addEventListener('click', (event) => {
    const dir = event.target.closest('.nl')?.dataset.navDir;
    if (dir) onNavigate(dir);
  });

  knob.addEventListener('pointerdown', onDown);
  knob.addEventListener('pointermove', onMove);
  knob.addEventListener('pointerup', onUp);
  knob.addEventListener('pointercancel', onCancel);
  knob.addEventListener('keydown', onKeyDown);
}

export { setupNavRing };
