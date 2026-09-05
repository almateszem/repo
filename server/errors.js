/**
 * Hibakezelő védőháló.
 *
 * A szerveren eddig egyetlen try/catch, hibakezelő middleware és folyamat-szintű
 * őr sem volt. Ez nem okozott bajt, mert a végpontok által hívott modulok
 * szándékosan NEM dobnak (az openfoodfacts.js `{ ok: false }`-t ad vissza, az
 * auth.js maga kapja el a hibáit) — de a helyesség így konvención múlt, nem
 * védőhálón. Egy később felvett async végpont, ami dob, Express 4 alatt
 * VÁLASZ NÉLKÜL hagyta volna a kérést (a böngésző örökre pörög), a folyamatot
 * pedig Node 22 alapértelmezése leállította volna.
 *
 * A megoldás ugyanazt a mintát követi, mint a hozzáférés-védelem: a védelem az
 * összes útvonal ELŐTT áll be, tehát egy később felvett végpont automatikusan
 * védett — nem kell rá emlékezni.
 */

/** A kérés-kezelőket regisztráló metódusok, amiket lefedünk. */
const ROUTE_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

/**
 * Egyetlen kezelő becsomagolása: a szinkron dobás és az elutasított ígéret is
 * a hibakezelő middleware-hez kerül a `next(err)`-en át.
 *
 * A négyparaméteres kezelő maga a hibakezelő — azt érintetlenül hagyjuk,
 * különben az Express nem ismerné fel (a felismerés a paraméterszámon alapul,
 * ezért adjuk vissza a becsomagolt függvénynek is az eredeti aritását).
 */
function guardHandler(handler) {
  if (typeof handler !== 'function' || handler.length === 4) return handler;

  const guarded = function (req, res, next) {
    let result;
    try {
      result = handler.call(this, req, res, next);
    } catch (err) {
      next(err);
      return undefined;
    }
    // Csak ígéret esetén kötünk rá: a legtöbb kezelő szinkron, azoknak nincs
    // mit elkapni, és fölösleges mikrotaszkot sem akarunk gyártani.
    if (result && typeof result.then === 'function') result.catch(next);
    return result;
  };

  Object.defineProperty(guarded, 'length', { value: handler.length });
  Object.defineProperty(guarded, 'name', { value: handler.name || 'guarded' });
  return guarded;
}

/**
 * A kezelő-becsomagolás bekötése az alkalmazásba. KÖZVETLENÜL az express()
 * után hívandó, minden útvonal-regisztráció előtt.
 */
export function guardAsyncRoutes(app) {
  for (const method of ROUTE_METHODS) {
    const original = app[method].bind(app);
    app[method] = (...args) => original(...args.map(guardHandler));
  }
  return app;
}

/**
 * A kliensnek szánt üzenet. A hiba RÉSZLETEI (üzenet, veremkép) sosem mennek
 * ki: elárulhatják a fájlrendszer szerkezetét, a modulneveket vagy az SQL
 * alakját. A szerver-logban minden benne van, a válaszban csak annyi, amiből
 * a felhasználó tud dönteni.
 *
 * A `status`-t hordozó hibák kivételek: ezeket maga az Express állítja elő
 * (jellemzően az express.json() hibás JSON-törzsre, 400-zal), és a hozzájuk
 * tartozó üzenet nem belső információ.
 */
function clientMessage(err) {
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status === 400 && err?.type === 'entity.parse.failed') {
    return [400, 'Hibás JSON a kérés törzsében.'];
  }
  if (status >= 400 && status < 500) return [status, err.message || 'Hibás kérés.'];
  return [500, 'Váratlan szerverhiba — próbáld újra később.'];
}

/**
 * Express hibakezelő middleware. AZ ÖSSZES útvonal UTÁN regisztrálandó.
 *
 * A négy paraméter kötelező: az Express ebből ismeri fel a hibakezelőt, ezért
 * a `_next` akkor is a helyén marad, ha nem hívjuk.
 */
export function apiErrorHandler(err, req, res, _next) {
  const [status, message] = clientMessage(err);

  // A veremkép a szerver-logba megy — ez az EGYETLEN hely, ahol megjelenik.
  console.error(`[hiba] ${req.method} ${req.originalUrl} → ${status}`, err);

  // Ha a válasz már elindult, az Express alapértelmezett kezelőjére bízzuk:
  // fejlécet küldeni utólag nem lehet, a kapcsolatot le kell zárni.
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.status(status).json({ error: message });
}

/**
 * Folyamat-szintű őrök.
 *
 * A becsomagolt útvonalak után kérés KÖZBEN már nem keletkezhet elkapatlan
 * elutasítás; ami mégis ide jut, az kérésen kívüli (időzítő, háttér-feladat).
 *
 * SZÁNDÉKOS KÜLÖNBSÉG a két eset között:
 *   · unhandledRejection — hangosan naplózunk, de FUTVA MARADUNK. Egy elárvult
 *     háttér-ígéret miatt kidobni az összes bejelentkezett felhasználót
 *     rosszabb, mint tovább szolgálni; a napló megmutatja, mit kell javítani.
 *   · uncaughtException — itt a folyamat állapota már meghatározatlan (fél
 *     úton félbehagyott művelet, nyitott tranzakció). Ilyenkor a tisztességes
 *     lépés a rendezett leállás: nem fogadunk új kérést, a futókat hagyjuk
 *     befejeződni, majd 1-es kóddal kilépünk, hogy a felügyelő újraindítson.
 */
export function installProcessGuards(server, { exit = (code) => process.exit(code) } = {}) {
  process.on('unhandledRejection', (reason) => {
    console.error('[elkapatlan ígéret-elutasítás] a szerver fut tovább:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('[elkapatlan kivétel] rendezett leállás következik:', err);
    // A leállásnak van felső határa: ha egy kérés beragad, nem várunk rá
    // örökké. Az unref() miatt ez az időzítő maga nem tartja életben a
    // folyamatot, ha a szerver hamarabb bezárult.
    const hardStop = setTimeout(() => exit(1), 5000);
    hardStop.unref?.();
    server?.close(() => {
      clearTimeout(hardStop);
      exit(1);
    });
  });
}
