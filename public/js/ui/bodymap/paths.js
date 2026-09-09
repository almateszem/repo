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
const TORSO_LEFT = 'M 110 52 L 99 55 L 97 64 C 86 68 76 74 70 84 '
  + 'C 66 92 65 100 68 106 L 78 100 C 80 116 79 132 82 148 '
  + 'C 84 158 82 168 84 178 C 80 188 78 198 80 208 L 110 216';

const LEGS_LEFT = 'M 80 208 C 76 240 78 262 82 288 C 80 300 78 316 82 336 '
  + 'C 85 356 88 372 90 392 L 86 404 L 104 406 L 102 392 '
  + 'C 104 366 106 348 104 330 C 102 306 104 296 103 288 '
  + 'C 106 260 108 236 110 216';

const ARM_LEFT = 'M 70 84 C 60 92 55 106 53 122 C 51 140 50 156 49 172 '
  + 'C 47 190 45 202 44 214 C 42 224 44 232 50 232 '
  + 'C 56 230 58 222 57 212 C 59 196 61 182 63 170 '
  + 'C 65 152 67 134 69 116 C 71 104 72 94 70 84';

const HALF_BODY = [TORSO_LEFT, LEGS_LEFT, ARM_LEFT];

export const BODY_SILHOUETTE = { front: HALF_BODY, back: HALF_BODY };

/* A két nézetben azonos régiók. A váll, a kar és a vádli elölről és
   hátulról is ugyanott van — nincs okunk kétszer megrajzolni. */

const SHOULDER = {
  key: 'shoulders', mirrored: true, labelX: 66, labelY: 96,
  d: 'M 68 78 C 60 84 56 96 58 108 C 66 112 74 108 77 100 C 76 90 73 82 68 78 Z',
};

const ARM = {
  key: 'arms', mirrored: true, labelX: 55, labelY: 160,
  d: 'M 56 112 C 50 128 49 152 48 172 C 47 190 45 204 45 214 '
    + 'C 52 218 58 214 58 206 C 60 188 62 168 64 150 '
    + 'C 66 134 68 122 68 114 C 64 110 59 110 56 112 Z',
};

const CALF = {
  key: 'calves', mirrored: true, labelX: 92, labelY: 330,
  d: 'M 82 300 C 78 318 79 340 84 360 C 90 364 97 362 100 356 '
    + 'C 103 336 104 316 103 300 C 96 296 88 296 82 300 Z',
};

export const BODY_REGIONS = {
  front: [
    SHOULDER,
    {
      key: 'chest', mirrored: false, labelX: 110, labelY: 102,
      d: 'M 86 84 C 96 78 124 78 134 84 C 137 98 134 112 128 118 '
        + 'C 116 122 104 122 92 118 C 86 112 83 98 86 84 Z',
    },
    ARM,
    {
      key: 'core', mirrored: false, labelX: 110, labelY: 154,
      d: 'M 92 122 C 104 118 116 118 128 122 C 130 140 128 164 124 186 '
        + 'C 114 192 106 192 96 186 C 92 164 90 140 92 122 Z',
    },
    {
      key: 'quads', mirrored: true, labelX: 92, labelY: 250,
      d: 'M 82 214 C 76 240 77 264 82 288 C 90 292 98 290 101 284 '
        + 'C 103 258 105 234 106 216 C 98 212 89 212 82 214 Z',
    },
    CALF,
  ],
  back: [
    SHOULDER,
    {
      key: 'back', mirrored: false, labelX: 110, labelY: 114,
      d: 'M 84 82 C 96 76 124 76 136 82 C 139 104 136 130 130 148 '
        + 'C 116 154 104 154 90 148 C 84 130 81 104 84 82 Z',
    },
    ARM,
    {
      key: 'glutes', mirrored: false, labelX: 110, labelY: 178,
      d: 'M 88 158 C 100 152 120 152 132 158 C 136 172 134 190 128 200 '
        + 'C 116 206 104 206 92 200 C 86 190 84 172 88 158 Z',
    },
    {
      key: 'hamstrings', mirrored: true, labelX: 93, labelY: 245,
      d: 'M 84 206 C 78 232 79 258 84 284 C 92 288 99 286 102 280 '
        + 'C 104 256 106 232 107 208 C 99 204 90 204 84 206 Z',
    },
    CALF,
  ],
};
