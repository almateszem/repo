/**
 * QR Food Scanner — a makró-űrlap validálása
 * ------------------------------------------
 * Külön modul, mert ez a rendszer EGYETLEN pontja, ahol felhasználói adat lép
 * be — és mert hálózat és adatbázis nélkül tesztelhető.
 *
 * A kliens is számol és jelez, de a szerver nem bízhat benne: a végpont
 * közvetlenül is hívható.
 */

/** A makrók 100 g / 100 ml-re. Ennél nagyobb érték fizikailag lehetetlen. */
const MAX_MACRO = 100;
/** Tiszta zsír ~900 kcal/100 g; a felső korlát ennél nem lehet lényegesen nagyobb. */
const MAX_KCAL = 1000;
const UNITS = ['g', 'ml'];

const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Egy szám mező beolvasása. A kliens sztringet is küldhet (űrlapmező), és a
 * magyar billentyűzeten a tizedesvessző a természetes — a pont-csere nélkül
 * a „12,5" némán NaN lenne.
 */
const parseNumber = (value) => {
  if (isNum(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
};

// Két tizedes: a csomagolás sem közöl ennél pontosabbat, és a lebegőpontos
// maradék (0.30000000000000004) így nem kerül be az adatbázisba.
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * A POST /api/products törzsének ellenőrzése.
 *
 * @param {unknown} body
 * @param {string}  barcode  a már normalizált vonalkód
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function validateProduct(body, barcode) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Hiányzó adat.' };

  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: 'A terméknek adj nevet.' };
  if (name.length > 80) return { ok: false, error: 'A név legfeljebb 80 karakter lehet.' };

  const unit = String(body.unit ?? 'g');
  if (!UNITS.includes(unit)) return { ok: false, error: 'Az egység csak g vagy ml lehet.' };

  const macros = {};
  for (const [field, label] of [['protein', 'fehérje'], ['carbs', 'szénhidrát'], ['fat', 'zsír']]) {
    const value = parseNumber(body[field]);
    if (value === null) return { ok: false, error: `Add meg a ${label} értékét.` };
    if (value < 0 || value > MAX_MACRO) {
      return { ok: false, error: `A ${label} 0 és ${MAX_MACRO} ${unit} között lehet (100 ${unit}-ra).` };
    }
    macros[field] = round2(value);
  }

  /* A három makró együtt sem lehet több 100 g-nál 100 g termékben. Ez fogja meg
     a legvalószínűbb elgépelést: az adag-értékek (egy 30 g-os szelet adatai)
     100 g-os mezőbe írását. */
  if (macros.protein + macros.carbs + macros.fat > MAX_MACRO) {
    return {
      ok: false,
      error: `A három makró együtt sem lehet több ${MAX_MACRO} ${unit}-nál 100 ${unit} termékben.`,
    };
  }

  const kcal = parseNumber(body.kcal);
  if (kcal === null) return { ok: false, error: 'Add meg a kalóriát.' };
  if (kcal < 0 || kcal > MAX_KCAL) {
    return { ok: false, error: `A kalória 0 és ${MAX_KCAL} kcal között lehet (100 ${unit}-ra).` };
  }

  return { ok: true, value: { barcode, name, unit, kcal: round2(kcal), ...macros } };
}

/** Atwater-együtthatók: a kliens ebből ajánl kalóriát, a teszt is ezt hívja. */
export const ATWATER = { protein: 4, carbs: 4, fat: 9 };

/**
 * Kalória a makrókból (4/4/9). A mező ettől függetlenül szerkeszthető: a
 * csomagoláson lévő érték a rost, a poliolok és az alkohol miatt jogosan
 * eltérhet a képlettől.
 */
export function kcalFromMacros({ protein = 0, carbs = 0, fat = 0 } = {}) {
  return Math.round(protein * ATWATER.protein + carbs * ATWATER.carbs + fat * ATWATER.fat);
}
