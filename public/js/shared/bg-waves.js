/**
 * Hullámos piros háttér — WebGL2 shader egy fix canvason, minden tartalom mögött.
 *
 * A main.js a legelején hívja a `mountBackgroundWaves()`-t, hogy a belépő
 * képernyőn is ott legyen. A canvas a body első gyereke lesz, a helyét és a
 * rétegét a css/01-alap.css 4. szakasza adja (.bg-waves). Ha nincs WebGL2,
 * vagy a shader nem fordul le, a canvas el sem marad: a body radial-gradient
 * háttere látszik, mint korábban.
 *
 * Két menetben rajzol, hogy éles legyen, de ne legyen drágább:
 *  1. A drága, de lágyan változó zaj-mezőt (domain warp, 9 zajhívás pixelenként)
 *     kisebb felbontású lebegőpontos textúrába számolja (CONFIG.fieldScale).
 *  2. Natív felbontáson ezt csak kiolvassa (a lineáris interpoláció egy sima
 *     mezőn gyakorlatilag pontos), és itt számolja a vonalakat és az élsimítást
 *     — ezért a vonalak élei a kijelző pixelein élesek.
 * Ha a gép nem tud lebegőpontos textúrába rajzolni, egy menetben számol mindent
 * (a régi módon, kisebb felbontás-plafonnal).
 */

/* ============ BEÁLLÍTÁSOK ============ */
const CONFIG = {
  // Blobok: x,y = pozíció (0..1), r = sugár (a magasság arányában), s = erősség (0..1)
  // Blob közelében vékony sötét vonalak, távolodva fokozatosan vastagodnak, a végén teljesen fekete.
  blobs: [
    { x: 0.5, y: 0.85, r: 0.56, s: 0.4 },
    { x: 0.08, y: 0.1, r: 0.45, s: 0.6 },
    { x: 0.92, y: 0.35, r: 0.4, s: 0.42 },
  ],
  speed: 0.1, // mozgás sebessége (0 = áll, 0.5 = lassú, folyékony)
  seed: 3.7, // másik szám = másik minta
  lines: 23, // hány sáv: kevesebb = nagyobb, lágyabb formák
  scale: 1.4, // a minta nagysága (kisebb = nagyobb formák)
  tilt: 1.0, // kiegyenlíti a sávokat: nagyobb = nincsenek vastag "tengerek", egyenletesebb csíkok
  warp: 1.6, // mennyire csavarodjon / folyjon a minta (0 = nyugodt foltok)
  falloff: 1.15, // a blob lecsengése (kisebb = lassabb, lágyabb átmenet)
  thinGap: 0.88, // legvékonyabb vonal a blobnál (nagyobb = vékonyabb)
  blackAt: -0.15, // mennyire záródik be a vonal a sötét részeken
  peak: 0.7, // max fényesség (0..1): kisebb = homályosabb, visszafogottabb piros
  colorDark: [0.4, 0.03, 0.05],
  colorBright: [1.0, 0.2, 0.17],
  bg: [0.043, 0.047, 0.055], // = #0b0c0e, a .bg-waves CSS-háttere is ez
  // Keskeny ablakon / telefonon a blobok összetolódnak és telítik a képet, ezért gyengítjük őket.
  narrowFrom: 1.5, // képarány (szélesség / magasság), ami alatt elkezd gyengülni (1.5 ≈ normál asztali ablak)
  narrowTo: 0.5, // ennél a képaránynál (álló telefon) éri el a minimumot
  narrowMin: 0.5, // blob-erősség szorzója a legkeskenyebb esetben (1 = nincs gyengítés)
  maxDpr: 2, // max pixelsűrűség a kimenetnél (a vonalak élessége; a natív menet olcsó)
  fieldScale: 0.5, // a zaj-mező felbontása a kimenethez képest (kisebb = gyorsabb, de lágyabb kanyarok)
  singlePassMaxDpr: 1.5, // max pixelsűrűség, ha nincs kétmenetes rajzolás (ott minden pixel drága)
  fps: 30, // képkocka-limit: ilyen lassú mozgáshoz bőven elég (60/120 Hz helyett)
  adaptive: true, // ha a gép nem bírja, automatikusan csökkenti a zaj-mező felbontását
  minScale: 0.5, // ennél kisebb szorzóra nem megy le az adaptív mód
};

/* ============ SHADEREK ============ */
const VERT = `#version 300 es
layout(location = 0) in vec2 aPos; void main(){ gl_Position = vec4(aPos,0.,1.); }`;

// Közös fej: a p koordináta mindkét menetben ugyanaz (magasság = 1, felül y = 0),
// így a kis felbontású mező és a natív menet pixelei pontosan egymásra esnek.
const HEAD = `#version 300 es
precision highp float;
uniform vec2  uInvSize;    // 1 / (szélesség, magasság) az aktuális célban, pixelben
uniform float uAspect;     // a KIMENET képaránya (mindkét menetben ugyanaz)
out vec4 o;
vec2 coords(out vec2 uv){
  uv = gl_FragCoord.xy * uInvSize;
  return vec2(uv.x * uAspect, 1.0 - uv.y);
}
`;

// Ami minden pixelre ugyanaz (blob-középpontok, időfüggő eltolások), azt a CPU számolja
// képkockánként egyszer, nem a GPU pixelenként.
const NOISE = `
uniform vec2  uOff0, uOff1, uOff2;   // seed + időfüggő eltolások a három fbm-hez
uniform float uScale, uWarp;
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++){ v += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return v;
}
// folyós, csavarodó mező (domain warp) — a drága rész
float warpField(vec2 p){
  vec2 q = p * uScale;
  vec2 w = vec2(fbm(q + uOff0), fbm(q + uOff1));
  return fbm(q + uWarp * w + uOff2);
}
`;

// 1. menet: csak a zaj-mező, kis felbontáson. (A dőlés nincs benne: azt a natív
// menet adja hozzá pontosan, így a textúra kisebb értéktartományt tárol.)
const FIELD_FRAG =
  HEAD +
  NOISE +
  `
void main(){
  vec2 uv; vec2 p = coords(uv);
  o = vec4(warpField(p), 0.0, 0.0, 1.0);
}`;

// 2. menet: natív felbontás. `inline` = egymenetes tartalék, a mezőt itt számolja.
const compositeFrag = (inline) =>
  HEAD +
  (inline ? NOISE : 'uniform sampler2D uField;\n') +
  `
uniform vec4  uBlobs[8];   // cx, cy (már animálva), falloff/r² * log2(e), s
uniform int   uCount;
uniform vec2  uTilt;       // tilt * normalize(0.55, 1.0)
uniform float uLines, uThin, uBlack, uPeak;
uniform vec3  uDark, uBright, uBg;

void main(){
  vec2 uv; vec2 p = coords(uv);

  // 1) fényerő-mező a blobokból  (exp(-d²·fall) == exp2(-|Δ|²·fall/r²·log2e), gyök és osztás nélkül)
  float I = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= uCount) break;
    vec4 b = uBlobs[i];
    vec2 d = p - b.xy;
    I += b.w * exp2(-dot(d, d) * b.z);
  }
  float k = smoothstep(0.0, 1.0, clamp(I, 0.0, 1.0));

  // 2) szintvonalak a mezőből
  float f = ${inline ? 'warpField(p)' : 'texture(uField, uv).r'} + dot(p, uTilt);
  float c = abs(fract(f * uLines) - 0.5) * 2.0;   // 0 = piros sáv közepe, 1 = sötét vonal közepe

  // 3) piros sáv szélessége: blobnál vékony vonal, távol teljesen bezáródik
  float g = mix(uBlack, uThin, k);
  float aa = fwidth(c) * 1.2 + 0.0005;
  float redMask = 1.0 - smoothstep(g - aa, g + aa, c);

  vec3 red = mix(uDark, uBright, pow(k, 1.6) * uPeak);
  vec3 col = mix(uBg, red, redMask);
  o = vec4(col, 1.0);
}`;

/**
 * Beszúrja és elindítja a hátteret. Hibát nem dob: ha a WebGL2 hiányzik vagy
 * a shader nem fordul, a canvas kikerül, és false a visszatérés — a lap
 * ilyenkor a CSS-hátterével megy tovább.
 */
export function mountBackgroundWaves() {
  const canvas = document.createElement('canvas');
  canvas.className = 'bg-waves';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
  });
  if (!gl) {
    canvas.remove();
    return false;
  }

  try {
    run(canvas, gl);
    return true;
  } catch (err) {
    console.warn('Háttér-shader kikapcsolva:', err);
    canvas.remove();
    return false;
  }
}

function run(canvas, gl) {
  // Blob-adatok: a sugár része állandó, az erősséget resize(), a középpontot render() tölti ki.
  const blobs = CONFIG.blobs.slice(0, 8);
  const blobData = new Float32Array(32);
  blobs.forEach((b, i) => {
    blobData[i * 4 + 2] = (CONFIG.falloff / (b.r * b.r)) * Math.LOG2E;
  });
  const tiltLen = Math.hypot(0.55, 1.0);

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function program(fragSrc, names) {
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const u = {};
    for (const n of names) u[n] = gl.getUniformLocation(prog, n);
    return { prog, u };
  }

  // A zaj-mező textúrájának formátuma: R32F, ha szűrhető (asztali gépeken jellemző),
  // különben R16F. Mindkettőbe rajzolni csak kiterjesztéssel lehet; ha egyik sem
  // megy, null — ilyenkor egymenetes a rajzolás. A textúra és az FBO már kötve van.
  function pickFieldFormat() {
    const full = gl.getExtension('EXT_color_buffer_float');
    const half = full || gl.getExtension('EXT_color_buffer_half_float');
    if (!half) return null;
    const candidates = [];
    if (full && gl.getExtension('OES_texture_float_linear'))
      candidates.push({ internal: gl.R32F, type: gl.FLOAT });
    candidates.push({ internal: gl.R16F, type: gl.HALF_FLOAT });
    for (const fmt of candidates) {
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, 1, 1, 0, gl.RED, fmt.type, null);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) return fmt;
    }
    return null;
  }

  // Minden GPU-oldali erőforrás itt jön létre, mert context lost után újra kell építeni.
  let twoPass = false;
  let fieldFmt = null;
  let fbo = null;
  let field = null; // 1. menet programja (csak kétmenetes módban)
  let comp = null; // natív menet programja
  let noise = null; // amelyik program a zajt számolja (field vagy comp)

  function initGL() {
    // teljes képernyős háromszög a 0. attribútumon (mindkét program ezt használja)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // A mező textúrája végig a 0. egységen marad; az 1. menet programja nem olvassa,
    // így nem számít visszacsatolásnak, hogy közben az FBO-ba is rajzolunk.
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    fieldFmt = pickFieldFormat();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    twoPass = fieldFmt !== null;
    if (!twoPass) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      fbo = null;
    }

    const base = ['uInvSize', 'uAspect'];
    const noiseNames = ['uOff0', 'uOff1', 'uOff2', 'uScale', 'uWarp'];
    const compNames = [
      ...base,
      'uBlobs[0]',
      'uCount',
      'uTilt',
      'uLines',
      'uThin',
      'uBlack',
      'uPeak',
      'uDark',
      'uBright',
      'uBg',
    ];
    if (twoPass) {
      field = program(FIELD_FRAG, [...base, ...noiseNames]);
      comp = program(compositeFrag(false), [...compNames, 'uField']);
      noise = field;
    } else {
      field = null;
      comp = program(compositeFrag(true), [...compNames, ...noiseNames]);
      noise = comp;
    }

    // statikus uniformok: egyszer
    gl.useProgram(noise.prog);
    gl.uniform1f(noise.u.uScale, CONFIG.scale);
    gl.uniform1f(noise.u.uWarp, CONFIG.warp);

    const u = comp.u;
    gl.useProgram(comp.prog);
    if (twoPass) gl.uniform1i(u.uField, 0);
    gl.uniform1i(u.uCount, blobs.length);
    gl.uniform2f(u.uTilt, (CONFIG.tilt * 0.55) / tiltLen, CONFIG.tilt / tiltLen);
    gl.uniform1f(u.uLines, CONFIG.lines);
    gl.uniform1f(u.uPeak, CONFIG.peak);
    gl.uniform1f(u.uThin, CONFIG.thinGap);
    gl.uniform1f(u.uBlack, CONFIG.blackAt);
    gl.uniform3fv(u.uDark, CONFIG.colorDark);
    gl.uniform3fv(u.uBright, CONFIG.colorBright);
    gl.uniform3fv(u.uBg, CONFIG.bg);
  }
  initGL();

  /* ============ MÉRET ============ */
  // Adaptív szorzó (1 = teljes). Kétmenetes módban csak a zaj-mezőt kicsinyíti,
  // így a vonalak élei lassú gépen is élesek maradnak.
  let quality = 1;
  let aspect = 1;
  let outW = 1;
  let outH = 1;
  let fieldW = 1;
  let fieldH = 1;
  let sizeDirty = true; // csak akkor méretezünk, ha tényleg változott valami

  function resize() {
    sizeDirty = false;
    const dprCap = twoPass ? CONFIG.maxDpr : CONFIG.singlePassMaxDpr;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * (twoPass ? 1 : quality);
    outW = Math.max(1, Math.round(canvas.clientWidth * dpr));
    outH = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== outW || canvas.height !== outH) {
      canvas.width = outW;
      canvas.height = outH;
    }
    aspect = outW / outH;

    if (twoPass) {
      const fs = CONFIG.fieldScale * quality;
      fieldW = Math.max(1, Math.round(outW * fs));
      fieldH = Math.max(1, Math.round(outH * fs));
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        fieldFmt.internal,
        fieldW,
        fieldH,
        0,
        gl.RED,
        fieldFmt.type,
        null,
      );
      gl.useProgram(field.prog);
      gl.uniform2f(field.u.uInvSize, 1 / fieldW, 1 / fieldH);
      gl.uniform1f(field.u.uAspect, aspect);
    }
    gl.useProgram(comp.prog);
    gl.uniform2f(comp.u.uInvSize, 1 / outW, 1 / outH);
    gl.uniform1f(comp.u.uAspect, aspect);

    // keskeny képarány -> gyengébb blobok (lineárisan narrowFrom és narrowTo között)
    const n = Math.min(
      1,
      Math.max(0, (aspect - CONFIG.narrowTo) / (CONFIG.narrowFrom - CONFIG.narrowTo)),
    );
    const sMul = CONFIG.narrowMin + (1 - CONFIG.narrowMin) * n;
    blobs.forEach((b, i) => {
      blobData[i * 4 + 3] = b.s * sMul;
    });
  }

  /* ============ RAJZOLÁS ============ */
  let lost = false; // context lost alatt semmilyen GL-hívás nem megy ki

  function render(t) {
    if (lost) return;
    if (sizeDirty) resize();

    const s = CONFIG.seed;
    const nu = noise.u;
    if (twoPass) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, fieldW, fieldH);
    } else {
      gl.viewport(0, 0, outW, outH);
    }
    gl.useProgram(noise.prog);
    gl.uniform2f(nu.uOff0, s + 0.35 * Math.sin(t * 0.31), s + 3.1 + 0.35 * Math.cos(t * 0.27));
    gl.uniform2f(
      nu.uOff1,
      s + 5.2 + 0.35 * Math.cos(t * 0.23),
      s + 1.3 + 0.35 * Math.sin(t * 0.29),
    );
    gl.uniform2f(nu.uOff2, s + 0.15 * Math.sin(t * 0.17), s + 0.15 * Math.cos(t * 0.13));
    if (twoPass) {
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, outW, outH);
      gl.useProgram(comp.prog);
    }

    for (let i = 0; i < blobs.length; i++) {
      blobData[i * 4] = blobs[i].x * aspect + 0.04 * Math.sin(t * 0.23 + i * 2.1);
      blobData[i * 4 + 1] = blobs[i].y + 0.04 * Math.cos(t * 0.19 + i * 1.7);
    }
    gl.uniform4fv(comp.u['uBlobs[0]'], blobData);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  const animate = CONFIG.speed > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const interval = 1000 / CONFIG.fps;
  const t0 = performance.now();
  const timeAt = (now) => (animate ? ((now - t0) / 1000) * CONFIG.speed : 0);
  let raf = 0;
  let last = 0;
  let slow = 0;

  // Ha tartósan lassabbak a képkockák a célnál, csökkentjük a zaj-mező felbontását.
  function adapt(dt) {
    slow = dt > interval * 1.4 ? slow + 1 : Math.max(0, slow - 1);
    if (slow >= 15 && quality > CONFIG.minScale) {
      quality = Math.max(CONFIG.minScale, quality * 0.8);
      slow = 0;
      sizeDirty = true;
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = now - last;
    if (dt < interval - 2) return; // fps-limit (2 ms tűrés a vsync-ingadozásra)
    if (CONFIG.adaptive && last && now - t0 > 2000) adapt(dt); // betöltés alatti akadozást nem számoljuk
    last = now;
    render(timeAt(now));
  }

  function start() {
    if (animate && !raf && !lost) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // Átméretezés: csak jelölünk; animáció közben a következő képkocka kezeli,
  // álló módban egyetlen újrarajzolást kérünk. (Soha nem indul második ciklus.)
  let pending = 0;
  addEventListener('resize', () => {
    sizeDirty = true;
    if (!animate && !pending)
      pending = requestAnimationFrame(() => {
        pending = 0;
        render(0);
      });
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

  // Context lost (GPU-reset, driverfrissítés, túl sok WebGL-oldal, alvó mód stb.):
  // a preventDefault() jelzi a böngészőnek, hogy vissza akarjuk kapni a kontextust.
  // Amíg nincs meg, a canvas átlátszó — a .bg-waves CSS-háttere (ugyanaz a szín) látszik.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    stop();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false;
    initGL(); // programok, buffer, textúra, FBO, uniformok újraépítése (a régiek érvénytelenek)
    sizeDirty = true; // méretek, textúra és uInvSize újra
    render(timeAt(performance.now()));
    if (!document.hidden) start();
  });

  render(timeAt(performance.now()));
  start();
}
