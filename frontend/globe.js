/* globe.js -- 3D globe location picker (zero dependencies, raw WebGL).
   A textured unit sphere: today's NASA GIBS imagery is reprojected
   client-side from Web-Mercator tiles (z3 mosaic, 8x8) into an
   equirectangular texture, so the imagery sits on the sphere without
   the flat map's projection wobbles. Drag to spin, pinch/wheel to zoom,
   tap to drop the pin (exact ray-sphere intersection). City names from
   GeoNames are drawn on a 2D overlay with the same perspective math.
   Dark mode gets a star field behind the globe. The flat map (map.js)
   stays as the automatic fallback when WebGL is unavailable. */

const GLOBE = {
  supported: false,
  layer: "truecolor",
  pin: null,
  // view state (dist = camera distance; 3.4 frames the whole globe with
  // a margin, 2.4 is a comfortable zoom-in, 6 a comfortable zoom-out)
  yaw: 0, pitch: 0, dist: 3.4,
  _raf: 0, _running: false,
  _lastInteract: 0,
  _cities: null, _citiesPromise: null,
  _texCache: {},            // layer -> {merc, eq, glTex, pending, done}
  _land: null, _landPromise: null,
};

const RAD = Math.PI / 180;
const FOV = 38 * RAD;

/* ---------- tiny mat3 helpers (row-major) ---------- */
function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
function mul3(A, B) {
  const R = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    R[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return R;
}
function apply3(M, v) {
  return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
          M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
          M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
}
/* model matrix M = Rx(pitch) * Ry(yaw) as a mat3 */
function modelMat() { return mul3(rotX(GLOBE.pitch), rotY(GLOBE.yaw)); }
/* lat/lon -> unit vector on the sphere (lon 0 faces +z) */
function llToVec(lat, lon) {
  const p = lat * RAD, l = lon * RAD;
  return [Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)];
}

/* ---------- WebGL setup ---------- */
const VSH = `
attribute vec3 aPos; attribute vec2 aUV;
uniform mat4 uMVP; uniform mat4 uModel;
varying vec2 vUV; varying vec3 vN; varying vec3 vW;
void main() {
  vUV = aUV;
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = normalize((uModel * vec4(aPos, 0.0)).xyz);
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;
const FSH = `
precision mediump float;
varying vec2 vUV; varying vec3 vN; varying vec3 vW;
uniform sampler2D uTex;
uniform vec3 uLightDir; uniform vec3 uEye; uniform vec3 uRim;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  vec3 base = texture2D(uTex, vUV).rgb;
  float diff = max(dot(n, uLightDir), 0.0);
  vec3 col = base * (0.34 + 0.82 * diff);
  col = max(col, base * 0.16);            /* never fully black at night */
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.6);
  col += uRim * fres * 0.85;              /* atmosphere rim */
  gl_FragColor = vec4(col, 1.0);
}`;

function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1;
  out[14] = 2 * far * near * nf; out[1] = out[2] = out[3] = out[4] =
  out[6] = out[7] = out[8] = out[9] = out[12] = out[13] = out[15] = 0;
  return out;
}

GLOBE.init = function () {
  const canvas = document.getElementById("globeCanvas");
  if (!canvas) return false;
  const gl = canvas.getContext("webgl", { alpha: true, antialias: true,
                                          premultipliedAlpha: true })
          || canvas.getContext("experimental-webgl");
  if (!gl) return false;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VSH));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FSH));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  /* sphere geometry */
  const BANDS = 48, SEGS = 72, pos = [], uv = [], idx = [];
  for (let i = 0; i <= BANDS; i++) {
    const v = i / BANDS, lat = 90 - v * 180;
    for (let j = 0; j <= SEGS; j++) {
      const u = j / SEGS, lon = -180 + u * 360;
      const p = llToVec(lat, lon);
      pos.push(p[0], p[1], p[2]); uv.push(u, v);
    }
  }
  for (let i = 0; i < BANDS; i++) for (let j = 0; j < SEGS; j++) {
    const a = i * (SEGS + 1) + j, b = a + SEGS + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  GLOBE._count = idx.length;
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 12, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
  const aUV = gl.getAttribLocation(prog, "aUV");
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 8, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);

  GLOBE._gl = gl; GLOBE._prog = prog;
  GLOBE._u = {};
  for (const n of ["uMVP", "uModel", "uTex", "uLightDir", "uEye", "uRim"])
    GLOBE._u[n] = gl.getUniformLocation(prog, n);

  /* 1x1 stand-in texture until imagery arrives */
  GLOBE._tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, GLOBE._tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA,
                gl.UNSIGNED_BYTE, new Uint8Array([214, 227, 234, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  GLOBE._space = document.getElementById("spaceCanvas");
  GLOBE._overlay = document.getElementById("globeOverlay");
  GLOBE._overlayCtx = GLOBE._overlay ? GLOBE._overlay.getContext("2d") : null;

  globeBindEvents(canvas);
  window.addEventListener("resize", globeSize);
  window.addEventListener("themechange", drawSpace);
  if (window.matchMedia)
    window.matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (!localStorage.getItem("lcrda-theme")) drawSpace();
      });
  globeSize();
  GLOBE.supported = true;       // only claim support once everything above held
  /* imagery is NOT warmed here: 128 tile requests at page load would
     hammer the hub for visitors who never open the picker; GLOBE.open()
     starts the texture the moment the panel is used */
  return true;
};

/* ---------- texture: mercator z3 mosaic -> equirectangular ---------- */
/* A 16x16 thumbnail of a tile; truecolour tiles where the satellite saw
   nothing (polar night, swath gaps) are pure black -> skip them so the
   Blue Marble base map underneath shows through (no black holes). */
function tileHasContent(img) {
  const t = document.createElement("canvas");
  t.width = t.height = 16;
  const x = t.getContext("2d");
  x.drawImage(img, 0, 0, 16, 16);
  const d = x.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4)
    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / 256 > 13;
}

/* tile sources for textures (backend proxy layers; includes the
   static Blue Marble base, which is NOT a display layer) */
const TILE_SRC = {
  truecolor: { ext: "jpg" }, soilmoisture: { ext: "png" },
  temp: { ext: "png" }, ndvi: { ext: "png" }, rain: { ext: "png" },
  bluemarble: { ext: "jpg" },
};

function globeStartTexture(layer) {
  const Z = 3, N = 8, T = 256, MW = N * T;          // 2048
  let cache = GLOBE._texCache[layer];
  if (!cache) {
    const merc = document.createElement("canvas");
    merc.width = merc.height = MW;
    const eq = document.createElement("canvas");
    eq.width = MW; eq.height = MW / 2;              // 2048 x 1024
    cache = GLOBE._texCache[layer] = {
      merc, eq, ctx: merc.getContext("2d"), eqCtx: eq.getContext("2d"),
      pending: 0, done: false, uploaded: 0, failed: [],
      bases: {},            // truecolour only: Blue Marble tiles by "tx_ty"
      waiting: [],          // truecolour tiles whose base tile is not here yet
      raw: null, rawCtx: null,          // truecolour only: unhealed mosaic
      mask: null,                       // truecolour only: 1 = gap pixel
      bmMos: null, bmMosCtx: null,      // truecolour only: base-map mosaic
    };
    cache.ctx.fillStyle = "#d7e3ea";
    cache.ctx.fillRect(0, 0, MW, MW);

    /* today's true-colour imagery has black polar-night / swath holes
       INSIDE tiles, so tiles are healed per-pixel from the static Blue
       Marble base (data layers just skip empty tiles and get the
       Natural Earth outlines where tiles never arrive) */
    const withBase = layer === "truecolor";
    let rawCtx = null, bmMosCtx = null;
    if (withBase) {
      const raw = document.createElement("canvas");
      raw.width = raw.height = MW;
      cache.raw = raw;
      cache.rawCtx = rawCtx = raw.getContext("2d", { willReadFrequently: true });
      cache.mask = new Uint8Array(MW * MW);
      const bmMos = document.createElement("canvas");
      bmMos.width = bmMos.height = MW;
      cache.bmMos = bmMos;
      cache.bmMosCtx = bmMosCtx = bmMos.getContext("2d");
    }
    const baseReady = (tx, ty) => {
      const b = cache.bases[tx + "_" + ty];
      return b && b.naturalWidth;
    };
    const drawHealed = (tx, ty, img) => {
      const m = gapMaskOf(img);
      rawCtx.drawImage(img, tx * T, ty * T);
      blitMask(cache.mask, m, tx * T, ty * T, MW);
      cache.ctx.drawImage(healTile(img, cache.bases[tx + "_" + ty], m),
                          tx * T, ty * T);
      globeScheduleReproject(layer);
    };
    const flushWaiting = (tx, ty) => {
      cache.waiting = cache.waiting.filter(([wx, wy, img]) => {
        if (wx === tx && wy === ty && baseReady(tx, ty)) {
          drawHealed(wx, wy, img);
          return false;
        }
        return true;
      });
    };
    const addBase = (tx, ty) => {
      const img = new Image();
      img.onload = () => {
        cache.bases[tx + "_" + ty] = img;
        if (bmMosCtx) bmMosCtx.drawImage(img, tx * T, ty * T);
        /* a layer tile that never arrived -> show the base map there */
        if (cache.failed.some(([fx, fy]) => fx === tx && fy === ty)) {
          cache.ctx.drawImage(img, tx * T, ty * T);
          if (rawCtx) rawCtx.drawImage(img, tx * T, ty * T);
          globeScheduleReproject(layer);
        }
        flushWaiting(tx, ty);
        if (--cache.pending === 0) globeFinishTexture(layer);
      };
      img.onerror = () => {
        if (--cache.pending === 0) globeFinishTexture(layer);
      };
      img.src = `/api/maptile/bluemarble/${Z}/${tx}/${ty}.jpg`;
    };
    const addTile = (tx, ty) => {
      const img = new Image();
      img.onload = () => {
        if (withBase) {
          if (baseReady(tx, ty)) drawHealed(tx, ty, img);
          else cache.waiting.push([tx, ty, img]);
        } else if (tileHasContent(img)) {
          cache.ctx.drawImage(img, tx * T, ty * T);
          globeScheduleReproject(layer);
        } else {
          cache.failed.push([tx, ty]);
        }
        if (--cache.pending === 0) globeFinishTexture(layer);
      };
      img.onerror = () => {
        cache.failed.push([tx, ty]);
        const b = withBase && cache.bases[tx + "_" + ty];
        if (b) {
          cache.ctx.drawImage(b, tx * T, ty * T);
          if (rawCtx) {
            rawCtx.drawImage(b, tx * T, ty * T);
            bmMosCtx.drawImage(b, tx * T, ty * T);
          }
          globeScheduleReproject(layer);
        }
        if (--cache.pending === 0) globeFinishTexture(layer);
      };
      img.src = `/api/maptile/${layer}/${Z}/${tx}/${ty}.${TILE_SRC[layer].ext}`;
    };
    if (withBase)
      for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
        cache.pending++; addBase(tx, ty);
      }
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) {
      cache.pending++; addTile(tx, ty);
    }
    setTimeout(() => { if (!cache.done) globeFinishTexture(layer); }, 30000);
  }
  if (cache.done) globeUploadTexture(layer);
}

/* the gap rule, shared by the per-tile and whole-mosaic healing passes:
   gap pixels are DARK and GREY (R=G=B, no chroma; dark ocean is
   blue-tinted, so a darkness+greyness test leaves water alone) */
function gapMaskOf(img) {
  const S = 256;
  const cc = document.createElement("canvas");
  cc.width = cc.height = S;
  const x = cc.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S).data;
  const m = new Uint8Array(S * S);
  for (let q = 0; q < m.length; q++) {
    const i = q * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const sum = r + g + b;
    m[q] = (sum < 36 || (sum < 90 && (Math.max(r, g, b) - Math.min(r, g, b)) < 12)) ? 1 : 0;
  }
  return m;
}

/* copy a 256x256 tile mask into the 2048x2048 mosaic mask */
function blitMask(dst, tile, ox, oy, mw) {
  for (let y = 0; y < 256; y++)
    dst.set(tile.subarray(y << 8, (y << 8) + 256), ox + (oy + y) * mw);
}

/* heal one true-colour tile for the progressive display: each gap run is
   filled by interpolating between the nearest real satellite pixels on
   its left and right in the same row -- the gaps are diagonal swath
   edges, so a horizontal blend disappears into the surrounding imagery.
   Runs wider than MAXRUN are true polar night, not a swath slash: they
   get the Blue Marble base instead of a smeared lerp. (MAXRUN itself is
   declared just above healMosaic, which uses the same constant.) */
function healTile(img, base, preMask) {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, S, S);
  const b = document.createElement("canvas");
  b.width = b.height = S;
  const bx = b.getContext("2d", { willReadFrequently: true });
  bx.drawImage(base, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S);
  const p = d.data;
  const bd = bx.getImageData(0, 0, S, S).data;
  const gap = preMask || gapMaskOf(img);
  for (let y = 0; y < S; y++) {
    const row = y * S;
    for (let t = row; t < row + S; t++) {
      if (!gap[t]) continue;
      let e = t;
      while (e < row + S && gap[e]) e++;
      const wide = e - t > MAXRUN;                   // polar night, not a slash
      const hasL = t > row, hasR = e < row + S;
      for (let u = t; u < e; u++) {
        const i = u * 4;
        if (!wide && hasL && hasR) {
          const a = (u - t + 1) / (e - t + 1);      // 0 at left edge
          const iL = (t - 1) * 4, iR = e * 4;
          for (let k = 0; k < 3; k++)
            p[i + k] = Math.round(p[iL + k] * (1 - a) + p[iR + k] * a);
        } else if (!wide) {
          const src = hasL ? (t - 1) * 4 : (hasR ? e * 4 : -1);
          if (src >= 0) {
            p[i] = p[src]; p[i + 1] = p[src + 1]; p[i + 2] = p[src + 2];
          } else {                                   // whole row is gap
            p[i] = bd[i]; p[i + 1] = bd[i + 1]; p[i + 2] = bd[i + 2];
          }
        } else {                                     // wide run -> base map
          p[i] = bd[i]; p[i + 1] = bd[i + 1]; p[i + 2] = bd[i + 2];
        }
        p[i + 3] = 255;
      }
      t = e - 1;                                     // skip the filled run
    }
  }
  x.putImageData(d, 0, 0);
  return c;
}

/* final seam-free healing pass over the whole mosaic: the per-tile pass
   cannot connect gap runs that continue into the neighbouring tile,
   which leaves streaks at tile seams; once every tile is in, this pass
   re-heals from the raw mosaic with a whole-world view.
   Narrow runs (up to MAXRUN): horizontal lerp between the nearest real
   pixels -- across a diagonal swath band that crossing is short.
   Wide runs (polar night, broad swath wedges): the Blue Marble base
   rescaled per row so its terrain texture keeps detail but its
   brightness matches the imagery flanking the gap.
   The mask is first dilated so JPEG halo greys around every gap are
   refilled too, and the filled region is then softened with a local
   average, which removes the comb banding that straight ramps produce
   against grainy satellite imagery. */
const MAXRUN = 32;

/* grow a 1-bit mask by r pixels horizontally then vertically */
function dilateMask(src, W, r) {
  const tmp = new Uint8Array(W * W), out = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (!src[row + x]) continue;
      const a = Math.max(0, x - r), b = Math.min(W - 1, x + r);
      for (let u = a; u <= b; u++) tmp[row + u] = 1;
    }
  }
  for (let y = 0; y < W; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      if (!tmp[row + x]) continue;
      const a = Math.max(0, y - r), b = Math.min(W - 1, y + r);
      for (let v = a; v <= b; v++) out[v * W + x] = 1;
    }
  }
  return out;
}

function healMosaic(c) {
  const MW = c.merc.width;
  const mask = dilateMask(c.mask, MW, 2);
  const raw = c.rawCtx.getImageData(0, 0, MW, MW);
  const p = raw.data;
  const bm = c.bmMosCtx.getImageData(0, 0, MW, MW).data;
  for (let y = 0; y < MW; y++) {
    const row = y * MW;
    for (let t = row; t < row + MW; t++) {
      if (!mask[t]) continue;
      let e = t;
      while (e < row + MW && mask[e]) e++;
      const w = e - t;
      const iL = (t - 1) * 4, iR = e * 4;
      const hasL = t > row, hasR = e < row + MW;
      if (w > MAXRUN) {
        /* wide run: Blue Marble, gain-matched to the flanking imagery.
           The target is the mean of several pixels on each side -- a
           single flanking pixel carries JPEG halo noise, which striped
           the fill. */
        let gain = null;
        if (hasL || hasR) {
          const tgt = [0, 0, 0], ref = [0, 0, 0];
          let nt = 0;
          if (hasL && hasR) {
            for (let s = 1; s <= 8; s++) {
              const a = (t - 1 - s) * 4, b = (e + s) * 4;
              if (t - 1 - s < row || e + s >= row + MW) break;
              for (let k = 0; k < 3; k++) tgt[k] += p[a + k] + p[b + k];
              nt += 2;
            }
          } else {
            const side = hasL ? -1 : 1;
            for (let s = 1; s <= 8; s++) {
              const q = hasL ? t - 1 - s : e + s;
              if (q < row || q >= row + MW) break;
              for (let k = 0; k < 3; k++) tgt[k] += p[q * 4 + k];
              nt++;
            }
          }
          if (nt) {
            for (let k = 0; k < 3; k++) tgt[k] /= nt;
            for (let u = t; u < e; u++)
              for (let k = 0; k < 3; k++) ref[k] += bm[u * 4 + k];
            gain = [0, 0, 0];
            for (let k = 0; k < 3; k++)
              gain[k] = Math.max(0.4, Math.min(2.5,
                tgt[k] / Math.max(8, ref[k] / w)));
          }
        }
        for (let u = t; u < e; u++) {
          const i = u * 4;
          for (let k = 0; k < 3; k++)
            p[i + k] = gain ? Math.min(255, Math.round(bm[i + k] * gain[k]))
                            : bm[i + k];
          p[i + 3] = 255;
        }
      } else if (hasL && hasR) {
        /* narrow run: horizontal lerp across the gap */
        for (let u = t; u < e; u++) {
          const i = u * 4;
          const a = (u - t + 1) / w;           // 0 at left edge
          for (let k = 0; k < 3; k++)
            p[i + k] = Math.round(p[iL + k] * (1 - a) + p[iR + k] * a);
          p[i + 3] = 255;
        }
      } else {
        /* narrow run touching the row edge: copy the one valid side */
        const src = hasL ? iL : (hasR ? iR : -1);
        for (let u = t; u < e; u++) {
          const i = u * 4;
          if (src >= 0) {
            p[i] = p[src]; p[i + 1] = p[src + 1]; p[i + 2] = p[src + 2];
          } else {
            p[i] = bm[i]; p[i + 1] = bm[i + 1]; p[i + 2] = bm[i + 2];
          }
          p[i + 3] = 255;
        }
      }
      t = e - 1;
    }
  }
  /* soften the filled region: a local average blends each synthetic
     pixel with its neighbourhood, which removes the comb banding that
     straight ramps produce against grainy satellite imagery */
  const hp = new Uint8ClampedArray(p);
  for (let y = 0; y < MW; y++) {
    const row = y * MW;
    for (let x = 0; x < MW; x++) {
      const q = row + x;
      if (!mask[q]) continue;
      let s0 = 0, s1 = 0, s2 = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= MW) continue;
        const yrow = yy * MW + x;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= MW) continue;
          const i = (yrow + dx) * 4;
          s0 += hp[i]; s1 += hp[i + 1]; s2 += hp[i + 2]; n++;
        }
      }
      const i = q * 4;
      p[i] = Math.round(hp[i] * 0.5 + s0 / n * 0.5);
      p[i + 1] = Math.round(hp[i + 1] * 0.5 + s1 / n * 0.5);
      p[i + 2] = Math.round(hp[i + 2] * 0.5 + s2 / n * 0.5);
    }
  }
  c.rawCtx.putImageData(raw, 0, 0);
  c.ctx.drawImage(c.raw, 0, 0);
}

function globeScheduleReproject(layer) {
  const c = GLOBE._texCache[layer];
  if (c._t) return;
  c._t = setTimeout(() => { c._t = null; globeReproject(layer); }, 350);
}

function globeFinishTexture(layer) {
  const c = GLOBE._texCache[layer];
  if (c.done) return;
  c.done = true;
  if (layer === "truecolor" && c.raw) healMosaic(c);   // seam-free final heal
  globeDrawLandFallback(layer);
  globeReproject(layer);
}

/* reproject the mercator mosaic into the equirect texture, one output
   row at a time (each row has a constant latitude -> a straight
   horizontal slice of the mercator map) */
function globeReproject(layer) {
  const c = GLOBE._texCache[layer];
  if (!c) return;
  const eq = c.eqCtx, H = c.eq.height, W = c.eq.width;
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180;
    const my = Math.min(c.merc.width - 1, Math.max(0,
      Math.floor(latToY(Math.max(-85.05, Math.min(85.05, lat)), 3))));
    eq.drawImage(c.merc, 0, my, W, 1, 0, y, W, 1);
  }
  globeUploadTexture(layer);
}

/* natural-earth outlines wherever tiles failed (offline story).
   Not used for truecolour: its holes are filled by the Blue Marble base. */
function globeDrawLandFallback(layer) {
  const c = GLOBE._texCache[layer];
  const failed = c.failed || [];
  if (!failed.length || layer === "truecolor") return;
  if (!GLOBE._land) return;          // world.json not loaded (yet)
  const paint = (ctx) => {
    ctx.fillStyle = "#dbe7cf";
    ctx.strokeStyle = "#9db48f";
    ctx.lineWidth = 1.5;
    for (const f of GLOBE._land) {
      const polys = f.geometry.type === "Polygon"
        ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) {
        ctx.beginPath();
        let started = false;
        for (const [lon, lat] of ring) {
          const x = lonToX(lon, 3), y = latToY(lat, 3);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        if (started) { ctx.closePath(); ctx.fill(); ctx.stroke(); }
      }
    }
  };
  for (const [tx, ty] of failed) {
    c.ctx.save();
    c.ctx.beginPath();
    c.ctx.rect(tx * 256, ty * 256, 256, 256);
    c.ctx.clip();
    paint(c.ctx);
    c.ctx.restore();
  }
  globeReproject(layer);
}

function globeUploadTexture(layer) {
  const gl = GLOBE._gl, c = GLOBE._texCache[layer];
  if (!gl || !c) return;
  const now = performance.now();
  if (c.uploaded && now - c.uploaded < 700 && !c.done) return; // throttle
  c.uploaded = now;
  gl.bindTexture(gl.TEXTURE_2D, GLOBE._tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c.eq);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
}

/* land outlines for the offline fallback (shared with map.js) */
function globeLand() {
  if (!GLOBE._landPromise)
    GLOBE._landPromise = fetch("world.json").then((r) => r.json())
      .then((d) => { GLOBE._land = d.features; return d; })
      .catch(() => null);
  return GLOBE._landPromise;
}

/* ---------- sizing ---------- */
function globeSize() {
  const c = document.getElementById("globeCanvas");
  if (!c) return;
  const wrap = c.parentElement, dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth || 320, h = w;          // square
  for (const cv of [c, GLOBE._space, GLOBE._overlay]) {
    if (!cv) continue;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  /* the sphere is drawn onto transparency, so no CSS clipping is needed
     (border-radius would cut the rim when the globe is framed large) */
  if (GLOBE._gl) GLOBE._gl.viewport(0, 0, c.width, c.height);
  GLOBE._dpr = dpr; GLOBE._W = w; GLOBE._H = h;
  drawSpace();
}

/* ---------- events ---------- */
function globeBindEvents(canvas) {
  const pts = new Map();
  let last = null, moved = 0, pinchD0 = 0, dist0 = 0, vyaw = 0, vpitch = 0;

  const touch = () => {
    GLOBE._lastInteract = performance.now();
    vyaw = vpitch = 0;
  };

  canvas.addEventListener("pointerdown", (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinchD0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = GLOBE.dist;
    }
    touch();
    last = [e.clientX, e.clientY]; moved = 0;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2 && pinchD0) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      GLOBE.dist = Math.max(2.4, Math.min(6, dist0 * pinchD0 / d));
      drawSpace(); return;
    }
    if (!last) return;
    const dx = e.clientX - last[0], dy = e.clientY - last[1];
    moved += Math.abs(dx) + Math.abs(dy);
    const k = 0.0055 * (GLOBE.dist / 3);
    GLOBE.yaw += dx * k;
    GLOBE.pitch = Math.max(-85 * RAD, Math.min(85 * RAD, GLOBE.pitch + dy * k));
    vyaw = dx * k; vpitch = dy * k;
    last = [e.clientX, e.clientY];
    touch();
  });
  const up = (e) => {
    const wasTap = pts.size === 1 && moved <= 6;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchD0 = 0;
    if (pts.size === 0) {
      last = null;
      if (wasTap) globePick(e);
      else if (!prefersReducedMotion()) { /* keep spin momentum */
        GLOBE._inertia = { vyaw, vpitch, t: performance.now() };
      }
    }
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    GLOBE.dist = Math.max(2.4, Math.min(6,
      GLOBE.dist * Math.exp(e.deltaY * 0.0011)));
    touch(); drawSpace();
  }, { passive: false });

  const zi = document.getElementById("zoomIn"),
        zo = document.getElementById("zoomOut");
  if (zi) zi.addEventListener("click", () =>
    { GLOBE.dist = Math.max(2.4, GLOBE.dist * 0.78); drawSpace(); });
  if (zo) zo.addEventListener("click", () =>
    { GLOBE.dist = Math.min(6, GLOBE.dist / 0.78); drawSpace(); });
}

function prefersReducedMotion() {
  return window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* tap -> ray-sphere intersection -> lat/lon */
function globePick(e) {
  const c = document.getElementById("globeCanvas");
  const r = c.getBoundingClientRect();
  if (!r.width) return;                    // canvas hidden (flat fallback)
  /* map CSS px -> bitmap px by the actual ratio (robust even if the
     bitmap and the CSS box were sized at different moments) */
  const scale = c.width / Math.max(1, r.width);
  const px = (e.clientX - r.left) * scale, py = (e.clientY - r.top) * scale;
  const W = c.width, H = c.height, D = GLOBE.dist;
  const nx = (px / W) * 2 - 1, ny = 1 - (py / H) * 2;
  const t = Math.tan(FOV / 2);
  let d = [nx * t, ny * t, -1];
  const L = Math.hypot(d[0], d[1], d[2]); d = d.map((v) => v / L);
  const O = [0, 0, D];
  const a = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];   /* |dir|^2 (=1) */
  const b = 2 * (O[0] * d[0] + O[1] * d[1] + O[2] * d[2]),
        cc = D * D - 1;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return;                       // tapped space, not the globe
  const hit = (-b - Math.sqrt(disc)) / (2 * a);
  if (hit <= 0) return;
  const w = [O[0] + hit * d[0], O[1] + hit * d[1], O[2] + hit * d[2]];
  /* w is on the unit sphere by construction (round-trip check) */
  const wLen = Math.hypot(w[0], w[1], w[2]);
  w[0] /= wLen; w[1] /= wLen; w[2] /= wLen;
  const Minv = mul3(rotY(-GLOBE.yaw), rotX(-GLOBE.pitch));
  const p = apply3(Minv, w);
  const lat = Math.asin(Math.max(-1, Math.min(1, p[1]))) / RAD;
  const lon = Math.atan2(p[0], p[2]) / RAD;
  globeSetPin(lat, lon);
}

/* ---------- public API (used by app.js) ---------- */
GLOBE.open = function () {
  const lat = parseFloat(document.getElementById("lat").value);
  const lon = parseFloat(document.getElementById("lon").value);
  if (!isNaN(lat) && !isNaN(lon)) {
    GLOBE.pin = { lat, lon };
    GLOBE.yaw = -lon * RAD; GLOBE.pitch = lat * RAD; GLOBE.dist = 3.4;
  } else {
    GLOBE.pin = null;
    if (!GLOBE._openedOnce) { GLOBE.yaw = 20 * RAD; GLOBE.pitch = 22 * RAD; GLOBE.dist = 3.6; }
  }
  GLOBE._openedOnce = true;
  globeSize();
  requestAnimationFrame(globeSize);   // catch late layout of the panel
  globeStartTexture(GLOBE.layer);
  globeLand();
  globeLoadCities();
  drawSpace();
  globeRun();
};

GLOBE.stop = function () {
  GLOBE._running = false;
  if (GLOBE._raf) cancelAnimationFrame(GLOBE._raf);
  GLOBE._raf = 0;
};

GLOBE.setLayer = function (key) {
  GLOBE.layer = key;
  globeStartTexture(key);
};

GLOBE.setPin = globeSetPin;

function globeSetPin(lat, lon) {
  GLOBE.pin = { lat: Math.max(-85, Math.min(85, lat)),
                lon: Math.max(-180, Math.min(180, lon)) };
  const el = document.getElementById("mapCoord");
  if (el) el.textContent = `${GLOBE.pin.lat.toFixed(3)}, ${GLOBE.pin.lon.toFixed(3)}`;
}

/* ---------- cities ---------- */
function globeLoadCities() {
  if (GLOBE._cities) return;
  if (!GLOBE._citiesPromise)
    GLOBE._citiesPromise = fetch("cities.json").then((r) => r.json())
      .then((list) => {
        const v = new Float32Array(list.length * 3);
        list.forEach((c, i) => {
          const p = llToVec(c.la, c.lo);
          v[i * 3] = p[0]; v[i * 3 + 1] = p[1]; v[i * 3 + 2] = p[2];
        });
        GLOBE._cities = list; GLOBE._cityVec = v;
      }).catch(() => {});
  return GLOBE._citiesPromise;
}

/* ---------- render loop ---------- */
function globeRun() {
  if (GLOBE._running) return;
  GLOBE._running = true;
  let prev = performance.now();
  const frame = (now) => {
    if (!GLOBE._running) return;
    const dt = Math.min(50, now - prev); prev = now;
    const idle = now - GLOBE._lastInteract > 4000;
    if (idle && !prefersReducedMotion()) GLOBE.yaw += 0.00006 * dt;
    if (GLOBE._inertia && now - GLOBE._inertia.t < 1200) {
      GLOBE.yaw += GLOBE._inertia.vyaw * 0.22;
      GLOBE.pitch = Math.max(-85 * RAD, Math.min(85 * RAD,
        GLOBE.pitch + GLOBE._inertia.vpitch * 0.22));
      GLOBE._inertia.vyaw *= 0.965; GLOBE._inertia.vpitch *= 0.965;
    } else GLOBE._inertia = null;
    globeDraw(now);
    GLOBE._raf = requestAnimationFrame(frame);
  };
  GLOBE._raf = requestAnimationFrame(frame);
}

function globeDraw(now) {
  const gl = GLOBE._gl;
  if (!gl) return;
  const D = GLOBE.dist, M = modelMat();
  const P = perspective([], FOV, 1, 0.1, 20);
  /* view = translate(0,0,-D) */
  const MVP = new Float32Array(16);
  /* P * V then * M, all combined numerically: */
  const PM = mat4Mul(P, mat4Translate(-D));
  const M4 = mat4From3(M);
  mat4MulInto(MVP, PM, M4);

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniformMatrix4fv(GLOBE._u.uMVP, false, MVP);
  gl.uniformMatrix4fv(GLOBE._u.uModel, false, M4);
  gl.uniform3fv(GLOBE._u.uLightDir, norm3([-0.35, 0.32, 0.85]));
  gl.uniform3f(GLOBE._u.uEye, 0, 0, D);
  const dark = isDarkTheme();
  gl.uniform3fv(GLOBE._u.uRim, dark ? [0.25, 0.5, 0.9] : [0.35, 0.55, 0.85]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, GLOBE._tex);
  gl.uniform1i(GLOBE._u.uTex, 0);
  gl.drawElements(gl.TRIANGLES, GLOBE._count, gl.UNSIGNED_SHORT, 0);

  globeDrawOverlay(now, M, D);
}

/* ---------- overlay: city names + pin + satellite ---------- */
function globeProject(p, M, D) {
  const w = apply3(M, p);
  const zc = D - w[2];
  if (zc <= 0) return null;
  const f = 1 / Math.tan(FOV / 2);
  const nx = w[0] * f / zc, ny = w[1] * f / zc;
  const W = GLOBE._W, H = GLOBE._H;
  return { x: (nx + 1) / 2 * W, y: (1 - ny) / 2 * H,
           z: w[2], facing: w[2] > 1 / D };
}

/* same projection for objects already in world space (the satellite) */
function globeProjectWorld(p, D) {
  const zc = D - p[2];
  if (zc <= 0) return null;
  const f = 1 / Math.tan(FOV / 2);
  const nx = p[0] * f / zc, ny = p[1] * f / zc;
  return { x: (nx + 1) / 2 * GLOBE._W, y: (1 - ny) / 2 * GLOBE._H, z: p[2] };
}

function globeDrawOverlay(now, M, D) {
  const ctx = GLOBE._overlayCtx;
  if (!ctx) return;
  const dpr = GLOBE._dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, GLOBE._W, GLOBE._H);
  const dark = isDarkTheme();

  /* satellite in orbit (a small NASA touch) -- projected in WORLD space
     so it circles the planet independently of the globe's spin, and the
     occlusion test below uses the same world coordinates */
  if (!prefersReducedMotion()) {
    const a = now * 0.00045;
    const r = 1.42, inc = 0.45;
    const sat = [r * Math.cos(a), r * Math.sin(a) * Math.sin(inc),
                 r * Math.sin(a) * Math.cos(inc)];
    const pr = globeProjectWorld(sat, D);
    if (pr && pr.z > -D) {
      /* occlusion: does the camera ray to the satellite pass the globe? */
      const O = [0, 0, D];
      const seg = [sat[0] - O[0], sat[1] - O[1], sat[2] - O[2]];
      const L = Math.hypot(...seg);
      const u = seg.map((v) => v / L);
      const tca = -(O[0] * u[0] + O[1] * u[1] + O[2] * u[2]);
      const cp = [O[0] + tca * u[0], O[1] + tca * u[1], O[2] + tca * u[2]];
      const occluded = tca > 0 && tca < L && Math.hypot(...cp) < 0.995;
      if (!occluded) {
        ctx.fillStyle = dark ? "#9fd0ff" : "#5b87b5";
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, 3.2, 0, 7);
        ctx.fill();
      }
    }
  }

  /* city labels */
  if (GLOBE._cities && GLOBE._cityVec) {
    const minPop = D > 3.4 ? 3e6 : D > 2.8 ? 1e6 : D > 2.2 ? 400e3 : 150e3;
    const labels = [];
    const v = GLOBE._cityVec;
    for (let i = 0; i < GLOBE._cities.length; i++) {
      const c = GLOBE._cities[i];
      if (c.p < minPop) break;                  // sorted by population desc
      const pr = globeProject([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], M, D);
      if (pr && pr.facing) labels.push({ c, pr });
    }
    labels.sort((a, b) => b.c.p - a.c.p);
    ctx.textBaseline = "middle";
    const placed = [];
    let shown = 0;
    for (const { c, pr } of labels) {
      if (shown >= 42) break;
      const fs = Math.max(9.5, Math.min(14, 8 + 2.1 * Math.log10(c.p / 15e4)));
      const wEst = c.n.length * fs * 0.56 + 6;
      const box = [pr.x - 2, pr.y - fs / 2 - 1, pr.x + wEst, pr.y + fs / 2 + 1];
      if (placed.some((b) => !(box[2] < b[0] || box[0] > b[2] ||
                               box[3] < b[1] || box[1] > b[3]))) continue;
      placed.push(box); shown++;
      ctx.font = `${fs}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = dark ? "rgba(8,14,10,0.85)" : "rgba(255,255,255,0.9)";
      ctx.fillStyle = dark ? "#e9f2ea" : "#26332a";
      ctx.strokeText(c.n, pr.x, pr.y);
      ctx.fillText(c.n, pr.x, pr.y);
    }
  }

  /* the pin */
  if (GLOBE.pin) {
    const pr = globeProject(llToVec(GLOBE.pin.lat, GLOBE.pin.lon), M, D);
    if (pr && pr.facing) {
      const tipY = pr.y, R = 7.5, stem = 15;
      ctx.fillStyle = "#b5502f";
      ctx.strokeStyle = "#b5502f";
      ctx.lineWidth = 1.6;
      /* stem */
      ctx.beginPath(); ctx.moveTo(pr.x, tipY); ctx.lineTo(pr.x, tipY - stem);
      ctx.stroke();
      /* head */
      ctx.beginPath();
      ctx.arc(pr.x, tipY - stem - R * 0.6, R, Math.PI * 0.85, Math.PI * 0.15, false);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(pr.x, tipY - stem - R * 0.6, 2.6, 0, 7);
      ctx.fill();
    }
  }
}

/* ---------- space backdrop (stars in dark mode + atmosphere halo) --- */
function isDarkTheme() {
  return document.documentElement.dataset.theme === "dark";
}
function drawSpace() {
  const cv = GLOBE._space;
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const dpr = GLOBE._dpr || 1, W = GLOBE._W, H = GLOBE._H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const dark = isDarkTheme();
  const cx = W / 2, cy = H / 2;
  const f = (H / 2) / Math.tan(FOV / 2);
  const R = f / Math.sqrt(GLOBE.dist * GLOBE.dist - 1);
  /* atmosphere halo */
  const g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.5);
  g.addColorStop(0, dark ? "rgba(90,150,235,0.35)" : "rgba(130,175,225,0.30)");
  g.addColorStop(1, "rgba(90,150,235,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, 7); ctx.fill();
  /* stars (dark mode only) */
  if (dark) {
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                        return seed / 0x7fffffff; };
    for (let i = 0; i < 170; i++) {
      const x = rnd() * W, y = rnd() * H, s = rnd();
      if (Math.hypot(x - cx, y - cy) < R * 1.05) continue;
      ctx.fillStyle = `rgba(235,242,250,${0.25 + s * 0.65})`;
      ctx.beginPath(); ctx.arc(x, y, 0.5 + s * 1.1, 0, 7); ctx.fill();
    }
  }
}

/* ---------- mat4 helpers (column-major for WebGL) ---------- */
function mat4Translate(dz) {
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,dz,1];
}
function mat4From3(M) {
  return [M[0],M[1],M[2],0, M[3],M[4],M[5],0, M[6],M[7],M[8],0, 0,0,0,1];
}
function mat4Mul(A, B) {
  const O = new Float32Array(16);
  mat4MulInto(O, A, B);
  return O;
}
function mat4MulInto(O, A, B) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    O[c * 4 + r] = A[r] * B[c * 4] + A[4 + r] * B[c * 4 + 1] +
                   A[8 + r] * B[c * 4 + 2] + A[12 + r] * B[c * 4 + 3];
  }
}
function norm3(v) {
  const L = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / L, v[1] / L, v[2] / L];
}
