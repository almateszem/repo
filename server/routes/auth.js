/**
 * Podium — belépés, fiók, profil
 * ------------------------------------------------------------------------
 * Az /api/auth/* végpontok (ezek NEM kérnek belépést), a fiók adatai, a
 * jelszóváltoztatás, a fióktörlés, a profil és az adat-export.
 */
import {
  PASSWORD_MIN,
  USERNAME_RE,
  accountFailureKey,
  clearFailures,
  hashPassword,
  hashToken,
  isLockedOut,
  loginFailureKey,
  normalizeUsername,
  recordFailure,
  verifyAgainstDummy,
  verifyPassword,
} from '../auth.js';
import { isWorkSet } from '../charts.js';
import { SEXES } from '../data/strength-standards.js';
import { formatDate } from '../dates.js';
import {
  createUser,
  deleteSession,
  deleteUser,
  deleteUserSessions,
  getCollection,
  getSessionUser,
  getSnapshot,
  getUserBirthYear,
  getUserCreatedAt,
  getUserGoal,
  getUserSex,
  getUserWithHash,
  getWeightLog,
  getWorkouts,
  hasAnyCheckin,
  hasAnyUser,
  purgeExpiredSessions,
  setUserBirthYear,
  setUserGoal,
  setUserSex,
  updateUserPassword,
} from '../db.js';
import {
  loginLimiter,
  registerLimiter,
  requestDate,
  requestSource,
  sessionToken,
  setSessionCookie,
  startSession,
  tooManyRequests,
} from '../http/session.js';
import { trainingStreak } from '../services/session-plan.js';

/* ---- Auth-végpontok (ezek NEM igényelnek bejelentkezést) ---- */

/** Beléptetve vagyok-e? A felület ezzel dönti el, mutassa-e a belépő
    képernyőt. A firstRun jelzi, hogy még egyetlen fiók sincs — ilyenkor a
    felület rögtön a regisztrációt kínálja. */
/** A fiók-objektum kiegészítése az `onboarding` jelzővel: igaz, amíg a fiók
    egyetlen check-int sem mentett. A felület ilyenkor a check-in varázslóra
    tereli — enélkül a friss fiók üres Áttekintésre érkezne, ahol a Recovery
    Engine (helyesen) `null` készenlétet mutat, mert nincs mire alapoznia.
    Azért „soha nem volt check-inje" és nem „most regisztrált": ez utóbbi
    csak a kliens pillanatnyi állapota lenne, ez viszont túléli a frissítést. */
const withOnboarding = (user) => ({ ...user, onboarding: !hasAnyCheckin(user.id) });

/** A regisztrációs/belépési törzs ellenőrzése. Hibánál { error }-t ad. */
function parseCredentials(body) {
  const username = normalizeUsername(body?.username);
  if (!USERNAME_RE.test(username)) {
    return {
      error:
        'A felhasználónév 3–24 karakter lehet, és csak angol kisbetűt, számot, ' +
        'pontot, kötőjelet vagy aláhúzást tartalmazhat.',
    };
  }
  const password = String(body?.password ?? '');
  if (password.length < PASSWORD_MIN) {
    return { error: `A jelszó legalább ${PASSWORD_MIN} karakter legyen.` };
  }
  return { username, password };
}

/** Egy edzés-cél kulcsa → a kártyán megjelenő rövid címke ("ERŐ"), vagy null.
    A lista a seedből jön (data.js → goals), tehát egy helyen bővíthető. */
export const goalTag = (key) =>
  (getCollection('goals') || []).find((goal) => goal.key === key)?.tag ?? null;

/** A bejelentkezett fiók felületi alakja. A korábbi szerepkör-jelzők
    (hasCoach / coachesAthletes) kikerültek belőle: a szerepkör nem a fiók
    tulajdonsága, hanem a kapcsolatokból következik — az Edző oldal a
    /api/coach és a /api/athletes válaszából tudja, melyik nézetben van dolga. */
const userPayload = (user) => ({
  name: user.displayName,
  username: user.username,
  goal: getUserGoal(user.id),
  sex: getUserSex(user.id),
  birthYear: getUserBirthYear(user.id),
});

/** A belépés NÉLKÜL elérhető /api/auth/* végpontok. A server.js a
    belépés-őr (http/session.js) ELŐTT köti be őket; a többi fiók-végpontot
    (register) utána. */
export function registerPublic(app) {
  app.get('/api/auth/me', (req, res) => {
    const token = sessionToken(req);
    const user = token ? getSessionUser(hashToken(token)) : null;
    if (!user)
      return res.status(401).json({ error: 'Nincs bejelentkezve.', firstRun: !hasAnyUser() });
    res.json(withOnboarding(user));
  });

  /** Regisztráció. Az ELSŐ fiók megörökli a fiókok bevezetése előtti adatokat
      (ld. db.js → adoptLegacyData), a válasz ezt jelzi is. */
  app.post('/api/auth/register', async (req, res) => {
    /* A korlát a HIBÁS próbálkozásokra is áll: enélkül a foglalt nevek
       végigpróbálása (409) ingyen lenne, és a fiók-gyártó szkriptnek elég
       lenne érvénytelen törzzsel melegen tartania a szervert. */
    const quota = registerLimiter.hit(requestSource(req));
    if (!quota.allowed) {
      return tooManyRequests(res, quota.retryAfter, 'Túl sok regisztráció innen. Próbáld később.');
    }

    const parsed = parseCredentials(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const displayName =
      String(req.body?.displayName ?? '')
        .trim()
        .slice(0, 40) || parsed.username;

    const created = createUser(parsed.username, displayName, await hashPassword(parsed.password));
    if (!created) return res.status(409).json({ error: 'Ez a felhasználónév már foglalt.' });

    startSession(req, res, created.user.id);
    res.status(201).json(withOnboarding(created.user));
  });

  /** Belépés. A hibaüzenet szándékosan nem árulja el, a név vagy a jelszó
      volt-e rossz — így nem lehet vele létező fiókokat feltérképezni. */
  app.post('/api/auth/login', async (req, res) => {
    const source = requestSource(req);
    const quota = loginLimiter.hit(source);
    if (!quota.allowed) {
      return tooManyRequests(
        res,
        quota.retryAfter,
        'Túl sok belépési kísérlet innen. Próbáld később.',
      );
    }

    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password ?? '');
    const wrong = { error: 'Hibás felhasználónév vagy jelszó.' };

    /* Érvénytelen formátumú név nem létezhet fiókként — nem könyveljük
       zárolásnak, különben tetszőleges (akár 100 KB-os) nevekkel hízlalható
       volna a számláló. Az üzenet ugyanaz, mint a nem létező érvényes névnél. */
    if (!USERNAME_RE.test(username)) return res.status(401).json(wrong);

    const lockKey = loginFailureKey(username, source);
    if (isLockedOut(lockKey)) {
      return res.status(429).json({
        error: 'Túl sok sikertelen próbálkozás. Próbáld újra néhány perc múlva.',
      });
    }

    const row = getUserWithHash(username);
    // Az archív („korábbi adatok") fiók jelszó-hashe üres — a verifyPassword
    // erre mindig hamisat ad, tehát vele nem lehet belépni. Nem létező névnél
    // ál-ellenőrzés fut, hogy a válaszidő ne árulja el, foglalt-e a név.
    const ok = row
      ? await verifyPassword(password, row.password_hash)
      : await verifyAgainstDummy(password);
    if (!ok) {
      recordFailure(lockKey);
      return res.status(401).json(wrong);
    }

    clearFailures(lockKey);
    purgeExpiredSessions(); // olcsó: a lejárt sorok ne várják meg a napi takarítást
    startSession(req, res, row.id);
    res.json(withOnboarding({ id: row.id, username: row.username, displayName: row.display_name }));
  });

  /** Kijelentkezés — a munkamenet törlődik az adatbázisból és a sütiből is. */
  app.post('/api/auth/logout', (req, res) => {
    const token = sessionToken(req);
    if (token) deleteSession(hashToken(token));
    setSessionCookie(req, res, null);
    res.status(204).end();
  });
}

/** Az útvonalak bekötése. Ugyanarra az app-ra, amit a server.js épít — NEM
    express.Router és NEM al-alkalmazás: a guardAsyncRoutes csak az app
    metódusait foltozza (errors.js), egy Router async kezelőjének hibájára
    nem jönne válasz, egy al-alkalmazás pedig elveszítené a trust proxy
    beállítást. */
export function register(app) {
  app.get('/api/user', (req, res) => res.json(userPayload(req.user)));

  /** Az edzés-cél, a nem és a születési év beállítása. Mind elhagyható, és
      a törzs RÉSZLEGES: csak azt írjuk át, ami ténylegesen jött. Enélkül egy
      „csak a nemet mentem" kérés némán kitörölné az edzés-célt — a két mező
      két külön legördülő, sosem mennek együtt. Az üres sztring a „nincs
      megadva", tehát szándékos törlés; a hiányzó kulcs az „ne nyúlj hozzá". */
  app.put('/api/user', (req, res) => {
    const normalize = (raw) =>
      raw === null || raw === '' ? null : raw === undefined ? undefined : String(raw);

    const goal = normalize(req.body?.goal);
    if (goal !== undefined) {
      if (goal !== null && !(getCollection('goals') || []).some((item) => item.key === goal)) {
        return res.status(400).json({ error: 'Ismeretlen edzés-cél.' });
      }
    }

    const sex = normalize(req.body?.sex);
    if (sex !== undefined && sex !== null && !SEXES.includes(sex)) {
      return res.status(400).json({ error: 'Ismeretlen nem.' });
    }

    /* Születési év: egész, és életszerű tartományban. A felső határ a
       tizenhárom éves kor — fiatalabbra a forrás életkori görbéje sem ad adatot,
       és egy elírt „2025" különben csendben „egyéves" lenne. */
    const rawYear = normalize(req.body?.birthYear);
    const birthYear = rawYear === undefined || rawYear === null ? rawYear : Number(rawYear);
    if (birthYear !== undefined && birthYear !== null) {
      const thisYear = Number(requestDate(req).slice(0, 4));
      if (!Number.isInteger(birthYear) || birthYear < thisYear - 100 || birthYear > thisYear - 13) {
        return res.status(400).json({ error: 'Érvénytelen születési év.' });
      }
    }

    if (goal !== undefined) setUserGoal(req.user.id, goal);
    if (sex !== undefined) setUserSex(req.user.id, sex);
    if (birthYear !== undefined) setUserBirthYear(req.user.id, birthYear);
    res.json(userPayload(req.user));
  });

  /* ======================================================================
     Fiók-műveletek — jelszóváltoztatás és fióktörlés
     ----------------------------------------------------------------------
     Mindkettő BEJELENTKEZÉST és a JELENLEGI JELSZÓT is kéri. A munkamenet-süti
     önmagában nem elég: egy őrizetlenül hagyott gépnél épp ez a két művelet az,
     amivel a kárt okozni lehet (kizárás a fiókból, illetve az adat végleges
     elvesztése).


     Ezek a végpontok a hozzáférés-védelem UTÁN állnak, tehát az /api/auth/*
     előtaggal együtt is bejelentkezést követelnek — ellentétben a belépéssel és
     a regisztrációval, amik értelemszerűen nem.
     ====================================================================== */

  /** Jelszóváltoztatás. A válasz új munkamenetet is ad: a régi sütik (más
      eszközök, esetleg egy megszerzett token) érvényüket vesztik. */
  app.put('/api/auth/password', async (req, res) => {
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');

    if (newPassword.length < PASSWORD_MIN) {
      return res
        .status(400)
        .json({ error: `Az új jelszó legalább ${PASSWORD_MIN} karakter legyen.` });
    }

    /* A jelenlegi jelszó próbálgatását (lopott süti) saját, FIÓKRA szóló
       számláló fékezi — nem a belépésé: az idegen gépről próbálgatott belépés
       különben a tulajdonost is megakadályozná a jelszó lecserélésében. */
    const lockKey = accountFailureKey(req.user.id);
    if (isLockedOut(lockKey)) {
      return res.status(429).json({
        error: 'Túl sok sikertelen próbálkozás. Próbáld újra néhány perc múlva.',
      });
    }

    const row = getUserWithHash(req.user.username);
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      recordFailure(lockKey);
      /* 403, nem 401: a munkamenet érvényes, csak a megerősítés rossz. A kliens
         minden 401-et munkamenet-vesztésnek vesz (belépő kapu, újratöltés) —
         401-gyel ez az üzenet sosem látszott. */
      return res.status(403).json({ error: 'A jelenlegi jelszó nem stimmel.' });
    }
    clearFailures(lockKey);

    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'Az új jelszó nem lehet ugyanaz, mint a régi.' });
    }

    updateUserPassword(req.user.id, await hashPassword(newPassword));
    // Minden korábbi munkamenet megszűnik, és rögtön nyitunk egy újat ENNEK a
    // böngészőnek — így a jelszót változtató fél nem esik ki a saját fiókjából.
    deleteUserSessions(req.user.id);
    startSession(req, res, req.user.id);
    res.json({ ok: true });
  });

  /** Fióktörlés. Végleges: a naplók, a tervek, a kapcsolatok és az üzenetek is
      eltűnnek — az utóbbiak a MÁSIK félnél is. A jelszó megerősítésként kell. */
  app.post('/api/auth/delete-account', async (req, res) => {
    const password = String(req.body?.password ?? '');

    // Ugyanaz a fiókra szóló számláló, mint a jelszócserénél (ld. ott).
    const lockKey = accountFailureKey(req.user.id);
    if (isLockedOut(lockKey)) {
      return res.status(429).json({
        error: 'Túl sok sikertelen próbálkozás. Próbáld újra néhány perc múlva.',
      });
    }

    const row = getUserWithHash(req.user.username);
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      recordFailure(lockKey);
      // 403, nem 401 — ugyanazért, mint a jelszócserénél (ld. ott).
      return res.status(403).json({ error: 'A jelszó nem stimmel — a fiók nem törlődött.' });
    }
    clearFailures(lockKey);

    deleteUser(req.user.id);
    setSessionCookie(req, res, null); // a süti is menjen, ne maradjon halott munkamenet
    res.json({ ok: true });
  });

  /** A profiloldal adatai: a fiók alapadatai és az eddigi teljesítmény
      összesítése. Szándékosan NEM a /api/user bővítése: az a seed-fájl demo-
      mezőit is visszaadja (és cache-elt a kliensen), itt viszont kizárólag a
      saját, naplózott adat számít, és minden edzés-mentés után frissülnie kell. */
  app.get('/api/profile', (req, res) => {
    const userId = req.user.id;
    const workouts = getWorkouts(userId);

    // Egy bejáráson: a PR-t elért gyakorlatok és a teljesített munkasorozatok.
    // A bemelegítő szettek szándékosan kimaradnak — a „volumen" edzéselméletben
    // munkasorozatot jelent, és a Recovery Engine is így számol.
    const prExercises = new Set();
    let workSets = 0;
    for (const workout of workouts) {
      for (const exercise of workout.exercises) {
        if (exercise.pr) prExercises.add(exercise.name);
        for (const set of exercise.sets) {
          if (isWorkSet(set)) workSets += 1;
        }
      }
    }

    // A testsúly-változás a napló ELSŐ és UTOLSÓ bejegyzése között. Egyetlen
    // bejegyzésnél a delta 0 — az nem „nem változott", hanem „még nincs mihez
    // mérni", ezért ilyenkor null megy ki, és a felület el is hagyja a sort.
    const weightLog = getWeightLog(userId);
    const firstWeight = weightLog[0];
    const lastWeight = weightLog[weightLog.length - 1];

    /* A users.created_at UTC ("2026-03-12 08:41:07"); a felület a többi dátumhoz
       hasonló alakot vár, ezért itt fordítjuk át. Az érvényesség-ellenőrzés nem
       elhagyható: egy kézzel szerkesztett vagy régi formátumú sorból a
       formatDate némán "NaN.NaN.NaN"-t írna ki — a hiányzó dátum ennél jobb,
       azt a felület el is rejti. */
    const createdAt = getUserCreatedAt(userId);
    const joined = createdAt ? new Date(`${createdAt.replace(' ', 'T')}Z`) : null;

    res.json({
      name: req.user.displayName,
      username: req.user.username,
      joinedAt: joined && !Number.isNaN(joined.getTime()) ? formatDate(joined) : null,
      stats: {
        workouts: workouts.length,
        streak: trainingStreak(workouts, req.today),
        prs: prExercises.size,
        workSets,
        // A getWorkouts() legújabb elöl ad vissza, tehát a lista két vége
        // az utolsó és az első edzés.
        lastWorkoutDate: workouts[0]?.date ?? null,
        firstWorkoutDate: workouts[workouts.length - 1]?.date ?? null,
        weight: lastWeight
          ? {
              current: lastWeight.kg,
              delta:
                weightLog.length > 1
                  ? Math.round((lastWeight.kg - firstWeight.kg) * 10) / 10
                  : null,
              entries: weightLog.length,
            }
          : null,
      },
    });
  });

  // Teljes adat-pillanatkép — a beállítások „Adatok exportálása" gombjához
  app.get('/api/export', (req, res) => res.json(getSnapshot(req.user.id)));
}
