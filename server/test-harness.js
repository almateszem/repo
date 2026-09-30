/**
 * FitTrack Pro — közös test-harness a spawn-alapú (HTTP) végponti tesztekhez
 * -------------------------------------------------------------------------
 * Öt tesztfájl (api, coach, account, security, timezone) ugyanazt csinálja:
 *   1. létrehoz egy ideiglenes munkakönyvtárat + SQLite-fájlt,
 *   2. külön folyamatban elindítja a server.js-t PORT=0-val,
 *   3. a szerver indulási sorából kiolvassa a portot,
 *   4. az after() hookkal leállítja a folyamatot és törli a munkakönyvtárat,
 *   5. egy request() segéddel HTTP-n beszél vele.
 *
 * Ez a modul ezt a közös vázat adja meg egyszer. A tesztek csak a labelt és
 * (ha kell) extra env-t vagy fejléceket adnak át — minden más innentől közös.
 */
import { after } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Elindít egy izolált FitTrack szervert saját ideiglenes adatbázissal.
 * A folyamatot és a munkakönyvtárat az after() hookba kötjük, így a hívó
 * fájlnak nincs teendője a takarítással.
 *
 * @param {object} opts
 * @param {string} opts.label — a munkakönyvtár és a .db előtagja (pl. 'api')
 * @param {Record<string,string>} [opts.extraEnv] — további env változók
 * @returns {Promise<{baseUrl:string, request:Function, cookieFrom:Function, workDir:string}>}
 */
export async function startServer({ label, extraEnv = {} }) {
  const workDir = mkdtempSync(path.join(tmpdir(), `fittrack-${label}-`));

  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'server.js')],
    {
      env: {
        ...process.env,
        FITTRACK_DB: path.join(workDir, `${label}.db`),
        PORT: '0',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

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
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`A szerver kilépett (kód: ${code}):\n${output}`));
    });
  });

  after(async () => {
    await new Promise((resolve) => {
      child.once('exit', resolve);
      child.kill();
    });
    rmSync(workDir, { recursive: true, force: true });
  });

  const request = makeRequest(baseUrl);
  return { baseUrl, request, cookieFrom, workDir };
}

/**
 * Kérés-segéd a szerverhez.
 * A munkamenetet süti hordozza, ezért a hívó átadhatja a sajátját; a válaszból
 * kiolvasott új sütit `setCookie`-ban visszaadjuk. A `headers` mezővel bármely
 * extra fejléc feladható (pl. X-Client-Date, X-Forwarded-For), így az egyes
 * tesztfájlok saját segédei ezzel a törzsön keresztül tudnak testre szabni.
 */
function makeRequest(baseUrl) {
  return async function request(method, urlPath, { body, cookie, headers: extra } = {}) {
    const headers = { ...(extra ?? {}) };
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
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* nem JSON — a json null marad */
    }

    return {
      status: res.status,
      json,
      text,
      setCookie,
      retryAfter: res.headers.get('retry-after'),
    };
  };
}

/** A Set-Cookie fejlécből a `név=érték` rész (ezt küldjük vissza Cookie-ként). */
export const cookieFrom = (res) => (res.setCookie[0] ?? '').split(';')[0];

/** A szerver által használt mai dátum — a végpontok ezt írják a sorokba. */
export const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
};

/** Egy gyakorlat, egyetlen teljesített munkasorozattal. */
export const gyakorlat = (name, weight, reps = 5) => ({
  name,
  sets: [{ reps: String(reps), weight: String(weight), rpe: '8', type: 'work', done: true }],
});
