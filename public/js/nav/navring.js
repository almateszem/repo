/** Nav ring — húzható navigációs gomb (pointer + billentyűzet). */

import { prefersReducedMotion } from '../core/dom.js';

/* ======================================================================
   5. Nav ring — húzható navigációs gomb (pointer + billentyűzet)
   ====================================================================== */
const RING_RADIUS = 44;      // px, a gomb maximális kitérése

const DIR_THRESHOLD = 26;    // px, ekkora elmozdulástól számít iránynak

const TAP_THRESHOLD = 9;     // px, ez alatt koppintásnak (home) számít

function setupNavRing(knob, onNavigate) {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let direction = null;
  let maxDistance = 0;

  const reset = () => {
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
    try { knob.setPointerCapture(pointerId); } catch (_) { /* nem kritikus */ }
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
    knob.style.transform =
      `translate(calc(-50% + ${Math.cos(angle) * clamped}px), calc(-50% + ${Math.sin(angle) * clamped}px))`;

    direction = distance < DIR_THRESHOLD ? null
      : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    event.preventDefault();
  };

  const onUp = (event) => {
    if (event.pointerId !== pointerId) return;
    const nav = direction ?? (maxDistance < TAP_THRESHOLD ? 'home' : null);
    reset();
    if (nav) onNavigate(nav);
  };

  const onCancel = (event) => {
    if (event.pointerId === pointerId) reset();
  };

  // Billentyűzetes navigáció ugyanazokkal az irányokkal
  const KEY_TO_DIR = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'home', ' ': 'home',
  };
  const onKeyDown = (event) => {
    const dir = KEY_TO_DIR[event.key];
    if (!dir) return;
    event.preventDefault();
    onNavigate(dir);
  };

  knob.addEventListener('pointerdown', onDown);
  knob.addEventListener('pointermove', onMove);
  knob.addEventListener('pointerup', onUp);
  knob.addEventListener('pointercancel', onCancel);
  knob.addEventListener('keydown', onKeyDown);
}

/* ======================================================================
   6. Renderelők — az api-tól lekért adatok DOM-ba töltése
   ====================================================================== */

export { setupNavRing };
