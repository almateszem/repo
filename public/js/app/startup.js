/** Indulás kapcsolat-hibánál: újrapróbálás növekvő várakozással.
    Ha induláskor a szerver nem érhető el (pl. épp újraindul), az app nem áll
    csendben üres vázként: a hívó hibát mutat, és a próba magától megismétlődik
    — 2, 5, 10 mp múlva, utána már csak a kézi „Újra" gombra. DOM nélküli,
    hogy a menete tesztelhető legyen (tests/public/js/app/startup.test.js). */

const RETRY_DELAYS_MS = [2000, 5000, 10000];

/**
 * @param {() => Promise<any>} attempt a próba (pl. api.me)
 * @param {object} handlers
 * @param {(result: any) => void} handlers.onSuccess a megszokott út a próba eredményével
 * @param {(err: Error, info: { retrying: boolean }) => void} handlers.onError
 *        hiba-állapot; `retrying`: lesz-e még önálló újrapróba
 * @returns {{ retry: () => void }} a kézi újrapróba (az „Újra" gomb)
 */
function startWithRetry(attempt, { onSuccess, onError, delays = RETRY_DELAYS_MS }) {
  let failures = 0;
  let timer = null;
  let running = false;

  const run = async () => {
    clearTimeout(timer);
    timer = null;
    if (running) return; // egy próba egyszerre
    running = true;
    let result;
    try {
      result = await attempt();
    } catch (err) {
      running = false;
      const delay = delays[failures];
      failures += 1;
      onError(err, { retrying: delay !== undefined });
      if (delay !== undefined) timer = setTimeout(run, delay);
      return;
    }
    running = false;
    onSuccess(result);
  };

  run();
  return { retry: run };
}

export { startWithRetry };
