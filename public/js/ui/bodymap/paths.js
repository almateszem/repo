/**
 * A testtérkép geometriája — tiszta adat, DOM nélkül.
 *
 * A rajzterület 220×460. MINDEN oldalfüggő alakzat CSAK a bal félre van
 * megrajzolva (x < 110), a jobb felet a komponens tükrözi
 * (`translate(220,0) scale(-1,1)`). Ez nem takarékosság: kézzel rajzolt
 * koordinátákkal a két fél előbb-utóbb elcsúszna egymástól, a tükrözés
 * viszont nem tud aszimmetrikus lenni.
 *
 * A középen ülő izomcsoportok (mell, törzs, hát, farizom) `mirrored: false`
 * jelöléssel jönnek — azokat tükrözni pont a hibát okozná, amit el akarunk
 * kerülni: két találati felület egymáson.
 *
 * A sziluett path-jai NYITOTTAK, és a középvonalon érnek véget. A tükörkép
 * zárja őket teljes alakká — így nincs látható varrat a figura közepén.
 */

export const BODY_VIEW_BOX = { width: 220, height: 460 };

export const BODY_HEAD = { cx: 110, cy: 32, r: 21 };

/** Törzs + láb külső kontúrja, majd a kar kontúrja. Bal fél, nyitott. */
const TORSO_LEFT =
  'M 110 52 L 100 54 L 98 62 C 86 66 72 70 64 78 ' +
  'C 54 84 50 96 54 108 L 68 108 C 72 124 76 138 80 150 ' +
  'C 82 162 82 172 82 182 C 78 192 76 200 78 208 L 110 216';

const LEGS_LEFT =
  'M 78 208 C 70 232 70 260 76 288 C 74 300 72 316 76 336 ' +
  'C 80 356 84 372 88 392 L 84 404 L 104 406 L 102 392 ' +
  'C 104 372 106 352 104 334 C 102 318 102 302 102 292 ' +
  'C 106 262 108 236 110 216';

const ARM_LEFT =
  'M 64 80 C 52 84 44 94 42 110 C 38 124 38 138 43 150 ' +
  'C 37 162 35 176 39 190 C 41 202 43 208 44 214 ' +
  'C 40 224 42 234 49 234 C 56 233 58 224 55 214 ' +
  'C 58 200 63 184 62 168 C 62 162 60 156 60 150 ' +
  'C 65 140 69 126 68 112 C 70 98 70 88 64 80';

const HALF_BODY = [TORSO_LEFT, LEGS_LEFT, ARM_LEFT];

export const BODY_SILHOUETTE = { front: HALF_BODY, back: HALF_BODY };

/* A két nézetben azonos régiók. A váll, a kar és a vádli elölről és
   hátulról is ugyanott van — nincs okunk kétszer megrajzolni. */

const SHOULDER = {
  key: 'shoulders',
  mirrored: true,
  labelX: 57,
  labelY: 98,
  d: 'M 64 80 C 54 84 46 96 46 110 C 54 114 64 112 68 104 C 69 94 68 86 64 80 Z',
};

const ARM = {
  key: 'arms',
  mirrored: true,
  labelX: 52,
  labelY: 160,
  d:
    'M 43 114 C 39 126 39 138 43 150 C 37 162 35 176 39 190 ' +
    'C 41 202 43 208 44 212 C 48 216 53 215 55 212 ' +
    'C 58 200 63 184 62 168 C 62 162 60 156 60 150 ' +
    'C 65 140 69 126 67 110 C 60 116 50 118 43 114 Z',
};

const CALF = {
  key: 'calves',
  mirrored: true,
  labelX: 89,
  labelY: 330,
  d:
    'M 76 300 C 72 318 74 340 80 360 C 88 364 96 362 100 356 ' +
    'C 103 336 104 316 102 300 C 94 296 84 296 76 300 Z',
};

export const BODY_REGIONS = {
  front: [
    SHOULDER,
    {
      key: 'chest',
      mirrored: false,
      labelX: 110,
      labelY: 102,
      d:
        'M 74 84 C 90 76 130 76 146 84 C 150 100 144 114 136 120 ' +
        'C 120 126 100 126 84 120 C 76 114 70 100 74 84 Z',
    },
    ARM,
    {
      key: 'core',
      mirrored: false,
      labelX: 110,
      labelY: 154,
      d:
        'M 86 124 C 102 120 118 120 134 124 C 136 144 134 166 130 186 ' +
        'C 116 192 104 192 90 186 C 86 166 84 144 86 124 Z',
    },
    {
      key: 'quads',
      mirrored: true,
      labelX: 91,
      labelY: 250,
      d:
        'M 78 214 C 72 238 72 264 78 288 C 88 292 98 290 102 284 ' +
        'C 104 258 106 234 106 216 C 96 212 86 212 78 214 Z',
    },
    CALF,
  ],
  back: [
    SHOULDER,
    {
      key: 'back',
      mirrored: false,
      labelX: 110,
      labelY: 114,
      d:
        'M 76 82 C 92 76 128 76 144 82 C 150 104 144 130 134 150 ' +
        'C 118 156 102 156 86 150 C 76 130 70 104 76 82 Z',
    },
    ARM,
    {
      key: 'glutes',
      mirrored: false,
      labelX: 110,
      labelY: 180,
      d:
        'M 86 160 C 100 154 120 154 134 160 C 138 174 136 192 130 202 ' +
        'C 116 208 104 208 90 202 C 84 192 82 174 86 160 Z',
    },
    {
      key: 'hamstrings',
      mirrored: true,
      labelX: 91,
      labelY: 245,
      d:
        'M 78 208 C 72 234 72 260 78 284 C 88 288 98 286 102 280 ' +
        'C 104 256 106 232 107 208 C 98 204 86 204 78 208 Z',
    },
    CALF,
  ],
};
