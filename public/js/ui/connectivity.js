/** Offline/online jelzés. */

import { showToast } from '../core/toast.js';

/** Offline/online állapot jelzése. */
function setupConnectivity() {
  window.addEventListener('offline', () => {
    showToast('Nincs internetkapcsolat', 'error');
  });
  window.addEventListener('online', () => {
    showToast('Újra online');
  });
}

export { setupConnectivity };
