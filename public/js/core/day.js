/** Napváltás-figyelő: éjfélkor értesíti a feliratkozott oldalakat. */

/** Napváltás-figyelő: percenként (és amikor a fül újra láthatóvá válik)
    ellenőrzi a helyi dátumot; éjfél után lefuttatja a feliratkozott
    frissítőket. Így a napi kalória/fehérje számlálók nulláról indulnak
    akkor is, ha az app napokon át nyitva marad, újratöltés nélkül. */
const dayChangeListeners = [];

const onDayChange = (listener) => dayChangeListeners.push(listener);

function startDayWatcher() {
  let currentDay = new Date().toDateString();
  const check = () => {
    const day = new Date().toDateString();
    if (day === currentDay) return;
    currentDay = day;
    dayChangeListeners.forEach((listener) => {
      Promise.resolve().then(listener)
        .catch((err) => console.error('Napváltás-frissítési hiba:', err));
    });
  };
  setInterval(check, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

export { onDayChange, startDayWatcher };
