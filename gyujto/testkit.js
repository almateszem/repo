/**
 * Gyűjtő — közös teszt-segéd (nem tesztfájl)
 * ==========================================
 * A végponti tesztek a VALÓDI szervert indítják el külön folyamatban, saját
 * eldobható adatbázissal, és HTTP-n beszélnek vele — ugyanúgy, ahogy a
 * böngésző. Amit így mérünk, az a felhasználó által ténylegesen látott
 * viselkedés, nem a modulok külön-külön vett helyessége.
 *
 * Az Open Food Facts helyére egy HELYI STUB kerül (`FITTRACK_OFF_URL`): a
 * tesztcsomag nem függhet az internettől és egy külső szolgáltatás
 * rendelkezésre állásától — egy elszálló futás semmit nem mondana a mi
 * kódunkról. A stub `/__hits` számlálója teszi BIZONYÍTHATÓVÁ a gyorsítótárat:
 * a „cache-ből jött" állítás csak akkor ér valamit, ha közben tényleg nem ment
 * ki hálózati kérés.
 *
 * A szerver PORT=0-val indul: a portot az operációs rendszer választja, a teszt
 * pedig a szerver indulási sorából olvassa ki. Így a párhuzamosan futó
 * tesztfájlok sem ütköznek.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Az OFF-stub által ismert termék (érvényes EAN-13). */
export const OFF_KNOWN = '5998200310010';
/** Létező, érvényes kód, amire az OFF „nem ismerem"-et ad. */
export const OFF_UNKNOWN = '5901234123457';
/** Erre a stub 500-zal esik el — a „most nem elérhető" ág. */
export const OFF_BROKEN = '4006381333931';

/**
 * Elindítja az OFF-stubot és a Gyűjtő szervert.
 * @returns {Promise<object>} kérés-segédek és a leállító függvény
 */
export async function startServer() {
  const workDir = mkdtempSync(path.join(tmpdir(), 'gyujto-test-'));

  let offHits = 0;
  const offStub = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/__hits') {
      res.end(JSON.stringify({ hits: offHits }));
      return;
    }
    offHits += 1;
    const code = req.url.match(/\/api\/v2\/product\/(\d+)\.json/)?.[1];
    if (code === OFF_KNOWN) {
      res.end(JSON.stringify({
        status: 1,
        product: {
          product_name: 'Teszt joghurt',
          brands: 'Tesztmárka',
          quantity: '150 g',
          serving_quantity: 30,
          serving_size: '30 g',
          nutriments: {
            'energy-kcal_100g': 61, proteins_100g: 10, carbohydrates_100g: 4, fat_100g: 0.5,
          },
        },
      }));
      return;
    }
    if (code === OFF_UNKNOWN) {
      res.end(JSON.stringify({ status: 0 }));
      return;
    }
    res.statusCode = 500;
    res.end('{}');
  });
  await new Promise((resolve) => offStub.listen(0, '127.0.0.1', resolve));
  const offUrl = `http://127.0.0.1:${offStub.address().port}`;

  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'server.js')],
    {
      env: {
        ...process.env,
        GYUJTO_DB: path.join(workDir, 'gyujto.db'),
        PORT: '0',
        FITTRACK_OFF_URL: offUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  /* Ha 20 mp alatt nem indul el, inkább elbukunk egy beszédes üzenettel, mint
     hogy a futtató ölje meg egy néma időtúllépéssel. */
  const baseUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`A szerver nem indult el időben:\n${output}`)),
      20_000,
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://localhost:${match[1]}`);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`A szerver kilépett (kód: ${code}):\n${output}`));
    });
  });

  /** Egy HTTP-kérés. A munkamenetet süti hordozza, ezért átadható és
      visszakapható — a belépés utáni sütit a hívó továbbadja. */
  async function request(method, urlPath, { body, cookie } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;

    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });

    const setCookie = res.headers.getSetCookie();
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* nem JSON — marad null */ }
    return { status: res.status, json, text, setCookie };
  }

  /** Belépteti (regisztrálja) a felhasználót, és visszaadja a sütijét. */
  async function login(username, password = 'probajelszo') {
    const res = await request('POST', '/api/auth/register', {
      body: { username, password, displayName: username },
    });
    if (res.status !== 201) throw new Error(`A regisztráció nem sikerült: ${res.text}`);
    return (res.setCookie[0] ?? '').split(';')[0];
  }

  return {
    baseUrl,
    request,
    login,
    offHitCount: async () => (await (await fetch(`${offUrl}/__hits`)).json()).hits,

    /* A leállítás nem elhagyható: amíg a gyerekfolyamat, a csővezetékei és a
       stub élnek, a teszt-futtató eseményhurka sem ürül ki — a `node --test`
       az utolsó pipa után is ott állna örökre. */
    async stop() {
      await new Promise((resolve) => {
        child.once('exit', resolve);
        child.kill();
      });
      await new Promise((resolve) => offStub.close(resolve));
      // A DB-fájlt a gyerek tartotta nyitva — a törlés csak a kilépése után megy.
      rmSync(workDir, { recursive: true, force: true });
    },
  };
}
