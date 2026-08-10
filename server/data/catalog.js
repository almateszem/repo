/**
 * FitTrack Pro — referencia-katalógusok összeállítása
 * ==================================================
 * Két nagy csak-olvasható lista áll össze itt, mielőtt a db.js beseedelné
 * őket a `collections` táblába: a gyakorlat-katalógus és az étel-katalógus.
 * Mindkettő a saját, kézzel szerkesztett forrásfájljából jön — a data.js
 * szándékosan NEM tartalmazza őket, mert több száz soros adatlistát nem
 * kényelmes egy vegyes seed-fájlban tartani.
 *
 * GYAKORLATOK — két forrás, világos elsőbbséggel
 * ---------------------------------------------
 *   1. KURÁLT (exercises.hu.js, 200 db) — kézzel írt magyar nevek, kézzel
 *      megadott `load` súlyokkal. A súlyok itt szándékos döntések, nem
 *      becslések, ezért NÉVÜTKÖZÉSKOR EZ NYER.
 *   2. GENERÁLT (exercises.exdb.js, 1216 db) — a külső datasetből, gif-fel és
 *      thumbnaillel, származtatott súlyokkal. Ez adja a katalógus tömegét és
 *      a képi anyagot.
 *
 * A `loadSource` mező mindkét ágon ki van töltve (`curated` / `derived`), így
 * a becsült terhelés-eloszlás sosem álcázza magát mért adatnak.
 *
 * Miért itt fésülünk, és nem az exercises.hu.js-ben: a generátor
 * (scripts/build-exdb.js) az exercises.hu.js-ből olvassa ki, mely nevek
 * kuráltak. Ha az a fájl maga is beolvasztaná a generált listát, a saját
 * kimenetét látná kuráltnak, és az ütközés-feloldás értelmét vesztené.
 */
import { exercises as curatedExercises, GROUPS } from './exercises.hu.js';
import { exdbExercises, exdbMediaForCurated } from './exercises.exdb.js';
import { foods as curatedFoods } from './foods.hu.js';
import { instructionsHu } from './instructions.hu.js';
import { MUSCLE_KEYS } from '../muscles.js';

/**
 * A gyakorlat-lista ellenőrzése. A Recovery Engine a `load` súlyokra épít, és
 * egy elgépelt izomkulcs vagy egy 1-re nem összegző eloszlás CSENDBEN
 * torzítaná a készenlét-számítást — ezért itt inkább hangosan elszállunk
 * induláskor, mint hogy rossz adattal fussunk.
 *
 * @param {Array<object>} list ellenőrizendő gyakorlatok
 * @param {string} source a forrásfájl neve a hibaüzenethez
 */
export function validateExercises(list, source) {
  const seen = new Set();
  for (const entry of list) {
    const where = `${source} → „${entry.name}”`;
    if (!entry.name) throw new Error(`${source}: névtelen gyakorlat`);
    if (seen.has(entry.name)) throw new Error(`${where}: duplikált név`);
    seen.add(entry.name);

    if (!GROUPS.includes(entry.group)) {
      throw new Error(`${where}: ismeretlen csoport („${entry.group}”). Engedett: ${GROUPS.join(', ')}`);
    }
    if (!entry.load || !Object.keys(entry.load).length) {
      throw new Error(`${where}: hiányzó load — a Recovery Engine nem tud vele mit kezdeni`);
    }
    for (const key of Object.keys(entry.load)) {
      if (!MUSCLE_KEYS.includes(key)) {
        throw new Error(`${where}: ismeretlen izomkulcs („${key}”). Engedett: ${MUSCLE_KEYS.join(', ')}`);
      }
    }
    const sum = Object.values(entry.load).reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > 1e-6) {
      throw new Error(`${where}: a load súlyok összege ${sum.toFixed(3)}, nem 1`);
    }
  }
  return list;
}

/**
 * A teljes gyakorlat-katalógus: kurált gyakorlatok elöl, utánuk a generáltak
 * közül azok, amiknek a neve még nem foglalt.
 * @returns {Array<object>} a /api/exercise-catalog tartalma
 */
export function buildExerciseCatalog() {
  const generated = validateExercises(exdbExercises, 'exercises.exdb.js');

  /* A generátor kihagyja azt, aminek a magyar neve ütközik egy kurált
     gyakorlatéval — a `load` súlyok miatt helyesen, mert ott a kézi adat a
     jobb. A MÉDIÁT viszont kár lenne elveszíteni: pont a legfontosabb
     alapgyakorlatok (fekvenyomás, guggolás, felhúzás) vannak kurálva, és
     furcsa volna, ha épp azokhoz nem tartozna illusztráció, miközben egy
     ritka variánshoz igen. Ezért az ütköző párokat a generátor külön
     kigyűjti: a kurált sor megtartja a saját adatait, és csak a képet, a
     gifet és a felszerelés-címkét veszi át. */
  const mediaByName = new Map(
    exdbMediaForCurated.map((entry) => [entry.name.toLowerCase(), entry]),
  );

  const curated = validateExercises(curatedExercises, 'exercises.hu.js').map((entry) => {
    const media = mediaByName.get(entry.name.toLowerCase());
    return {
      ...entry,
      loadSource: 'curated',
      ...(media && {
        equipment: media.equipment, extId: media.extId, image: media.image, gif: media.gif,
      }),
    };
  });

  const taken = new Set(curated.map((entry) => entry.name.toLowerCase()));
  const catalog = [...curated, ...generated.filter((entry) => !taken.has(entry.name.toLowerCase()))];
  return attachInstructions(catalog);
}

/**
 * A magyar lépésenkénti leírások rákötése a katalógusra `steps` néven.
 *
 * A leírások kulcsa a gyakorlat neve, ezért egy elgépelt kulcs csendben
 * hatástalan maradna — a felületen egyszerűen nem jelenne meg a leírás, és
 * semmi nem szólna. Ezért itt ELLENŐRIZZÜK, hogy minden kulcshoz tartozik
 * katalógus-sor, és ha nem, induláskor elszállunk a konkrét névvel.
 */
function attachInstructions(catalog) {
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));

  for (const [name, steps] of Object.entries(instructionsHu)) {
    const entry = byName.get(name);
    if (!entry) {
      throw new Error(
        `instructions.hu.js → „${name}”: nincs ilyen nevű gyakorlat a katalógusban. `
        + 'A kulcsnak pontosan egyeznie kell az exercises.hu.js névvel.',
      );
    }
    if (!Array.isArray(steps) || !steps.length) {
      throw new Error(`instructions.hu.js → „${name}”: üres lépéslista`);
    }
    entry.steps = steps;
  }
  return catalog;
}

/**
 * Az étel-katalógus. A forrásfájl 100 g / 100 ml alapmennyiségre adja a
 * makrókat; a felület viszont egy kiírható `per` címkét vár — azt itt
 * képezzük az `unit` mezőből, hogy az italoknál „100 ml” szerepeljen, ne a
 * félrevezető „100 g”.
 * @returns {Array<object>} a /api/foods tartalma
 */
export function buildFoodCatalog() {
  const seen = new Set();
  return curatedFoods.map((food) => {
    if (seen.has(food.name)) throw new Error(`foods.hu.js → „${food.name}”: duplikált név`);
    seen.add(food.name);
    const unit = food.unit || 'g';
    return { ...food, unit, per: `100 ${unit}` };
  });
}
