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
GLOBE.init = function () {
  const canvas = document.getElementById("globeCanvas");
  if (!canvas || typeof THREE === "undefined") return false;

  /* three.js (vendored locally, no CDN) -- mature sphere/UV/texture code
     instead of hand-rolled WebGL, which is where the wobbles came from */
  const renderer = new THREE.WebGLRenderer({
    canvas, alpha: true, antialias: true, powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  if ("outputEncoding" in renderer) renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20);
  camera.position.set(0, 0, GLOBE.dist);

  /* Blue Marble is photographic, so keep the surface unlit and bright;
     the 3D read comes from the atmosphere shell and the space backdrop */
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 96, -Math.PI / 2), material);
  sphere.rotation.order = "XYZ";
  scene.add(sphere);

  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.045, 96, 64),
    new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x5aa0ee) } },
      vertexShader:
        "varying vec3 vN; varying vec3 vW;" +
        "void main(){ vN = normalize(normalMatrix * normal);" +
        " vec4 w = modelViewMatrix * vec4(position, 1.0); vW = w.xyz;" +
        " gl_Position = projectionMatrix * w; }",
      fragmentShader:
        "varying vec3 vN; varying vec3 vW; uniform vec3 uColor;" +
        "void main(){ float f = pow(1.0 - abs(dot(normalize(vN)," +
        " normalize(-vW))), 2.4); gl_FragColor = vec4(uColor, f * 0.9); }",
    }));
  scene.add(atmo);

  GLOBE._renderer = renderer; GLOBE._scene = scene; GLOBE._camera = camera;
  GLOBE._sphere = sphere; GLOBE._mat = material;

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
  /* the panel is display:none at boot, so its measured width can be a
     stale 320px -- re-measure whenever the wrapper actually changes size
     (a stretched canvas was itself a source of blur/wobble) */
  if (window.ResizeObserver) {
    GLOBE._ro = new ResizeObserver(() => globeSize());
    GLOBE._ro.observe(canvas.parentElement);
  }
  globeSize();
  GLOBE.supported = true;       // only claim support once everything above held
  /* imagery is NOT warmed here: 128 tile requests at page load would
     hammer the hub for visitors who never open the picker; GLOBE.open()
     starts the texture the moment the panel is used */
  return true;
};

/* ---------- texture: mercator z3 mosaic -> equirectangular ----------
   Two canvases per layer: a COMPLETE static NASA Blue Marble base map
   (64 tiles, cached by the hub forever) and an optional data overlay
   (today's soil moisture / temperature / greenery / rain, PNG with
   transparent no-data). The globe always has a full, hole-free surface;
   the data layer simply paints over it where the satellite has data.
   "Satellite photo" is the Blue Marble itself -- complete, cloud-free
   and identical every day, so it never shows the swath-gap wedges and
   polar-night black patches that made the daily truecolour mosaic look
   broken on a sphere. */

/* tile sources for textures (backend proxy layers; the static Blue
   Marble base is not a display layer) */
const TILE_SRC = {
  truecolor: { ext: "jpg" }, soilmoisture: { ext: "png" },
  temp: { ext: "png" }, ndvi: { ext: "png" }, rain: { ext: "png" },
  bluemarble: { ext: "jpg" },
};

function globeStartTexture(layer) {
  const Z = 3, N = 8, T = 256, MW = N * T;          // 2048
  let cache = GLOBE._texCache[layer];
  if (!cache) {
    const base = document.createElement("canvas");  // Blue Marble (complete)
    base.width = base.height = MW;
    const data = document.createElement("canvas");  // data overlay (transparent)
    data.width = data.height = MW;
    const eq = document.createElement("canvas");
    eq.width = MW; eq.height = MW / 2;              // 2048 x 1024
    cache = GLOBE._texCache[layer] = {
      base, data, eq,
      baseCtx: base.getContext("2d"), ctx: data.getContext("2d"),
      eqCtx: eq.getContext("2d"),
      pending: 0, done: false, uploaded: 0, failed: [],
    };
    cache.baseCtx.fillStyle = "#d7e3ea";            // offline: pale ocean-ish
    cache.baseCtx.fillRect(0, 0, MW, MW);

    const finish = () => { if (cache.pending === 0) globeFinishTexture(layer); };
    const addTile = (srcLayer, tx, ty) => {
      cache.pending++;
      const img = new Image();
      img.onload = () => {
        const ctx = srcLayer === "bluemarble" ? cache.baseCtx : cache.ctx;
        ctx.drawImage(img, tx * T, ty * T);
        if (--cache.pending === 0) finish();
        else globeScheduleReproject(layer);
      };
      img.onerror = () => {
        cache.failed.push([srcLayer, tx, ty]);
        if (--cache.pending === 0) finish();
      };
      img.src = `/api/maptile/${srcLayer}/${Z}/${tx}/${ty}.${TILE_SRC[srcLayer].ext}`;
    };
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++)
      addTile("bluemarble", tx, ty);
    /* "Satellite photo" shows the Blue Marble itself; the parameter
       layers paint their data on top of it */
    if (layer !== "truecolor")
      for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++)
        addTile(layer, tx, ty);
    setTimeout(() => { if (!cache.done) globeFinishTexture(layer); }, 30000);
  }
  if (cache.done) globeUploadTexture(layer);
}

function globeScheduleReproject(layer) {
  const c = GLOBE._texCache[layer];
  if (c._t) return;
  c._t = setTimeout(() => { c._t = null; globeReproject(layer); }, 350);
}

function globeFinishTexture(layer) {
  const c = GLOBE._texCache[layer];
  if (!c || c.done) return;
  c.done = true;
  globeDrawLandFallback(layer);   // offline: outline land where base tiles failed
  globeReproject(layer);
}

/* reproject the mercator mosaics into the equirect texture, one output
   row at a time (each row has a constant latitude -> a straight
   horizontal slice of the mercator map). The Blue Marble base is
   always drawn first, so the sphere is complete even before (or
   without) any data layer; the data overlay is painted on top at 80%
   so terrain still reads through the colour ramp. */
function globeReproject(layer) {
  const c = GLOBE._texCache[layer];
  if (!c) return;
  const eq = c.eqCtx, W = c.eq.width, H = c.eq.height;
  const withData = layer !== "truecolor" && !!TILE_SRC[layer];
  eq.clearRect(0, 0, W, H);
  for (let y = 0; y < H; y++) {
    const lat = 90 - (y + 0.5) / H * 180;
    const my = Math.min(c.base.height - 1, Math.max(0,
      Math.floor(latToY(Math.max(-85.05, Math.min(85.05, lat)), 3))));
    eq.drawImage(c.base, 0, my, W, 1, 0, y, W, 1);
    if (withData) {
      eq.globalAlpha = 0.8;
      eq.drawImage(c.data, 0, my, W, 1, 0, y, W, 1);
      eq.globalAlpha = 1;
    }
  }
  globeUploadTexture(layer);
}

/* offline story: where a Blue Marble base tile never arrived, paint the
   Natural Earth outlines into the base canvas so the sphere still has
   continents instead of pale ocean. Data tiles that fail simply stay
   transparent (they are overlays). */
function globeDrawLandFallback(layer) {
  const c = GLOBE._texCache[layer];
  const missing = (c.failed || []).filter(([src]) => src === "bluemarble");
  if (!missing.length) return;
  const paint = () => {
    if (!GLOBE._land) return;
    const ctx = c.baseCtx;
    for (const [, tx, ty] of missing) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx * 256, ty * 256, 256, 256);
      ctx.clip();
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
      ctx.restore();
    }
    globeReproject(layer);
  };
  if (GLOBE._land) paint();
  else globeLand().then(() => { if (GLOBE._land) paint(); }).catch(() => {});
}

function globeUploadTexture(layer) {
  const c = GLOBE._texCache[layer];
  if (!c || !GLOBE._renderer) return;
  const now = performance.now();
  if (c.uploaded && now - c.uploaded < 700 && !c.done) return; // throttle
  c.uploaded = now;
  if (!c.tex) {
    const t = new THREE.CanvasTexture(c.eq);
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.RepeatWrapping;      // no seam at the antimeridian
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = GLOBE._renderer.capabilities.getMaxAnisotropy();
    if ("encoding" in t) t.encoding = THREE.sRGBEncoding;   // r149 API
    if ("colorSpace" in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    c.tex = t;
  }
  c.tex.needsUpdate = true;
  if (GLOBE.layer === layer) {
    GLOBE._mat.map = c.tex;
    GLOBE._mat.needsUpdate = true;
  }
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
  const wrap = c.parentElement;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(220, wrap.clientWidth || 320), h = w;
  GLOBE._W = w; GLOBE._H = h; GLOBE._dpr = dpr;
  c.style.width = w + "px"; c.style.height = h + "px";
  for (const cv of [GLOBE._space, GLOBE._overlay]) {
    if (!cv) continue;
    cv.style.width = w + "px"; cv.style.height = h + "px";
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  if (GLOBE._renderer) {
    GLOBE._renderer.setPixelRatio(dpr);
    GLOBE._renderer.setSize(w, h, false);
    GLOBE._camera.aspect = 1;
    GLOBE._camera.updateProjectionMatrix();
  }
}

/* the sphere is drawn onto transparency, so no CSS clipping is needed
   (border-radius would cut the rim when the globe is framed large) */

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
  if (!GLOBE._renderer) return;
  GLOBE._sphere.rotation.set(GLOBE.pitch, GLOBE.yaw, 0);
  GLOBE._camera.position.z = GLOBE.dist;
  GLOBE._renderer.render(GLOBE._scene, GLOBE._camera);
  globeDrawOverlay(now, modelMat(), GLOBE.dist);
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
      /* soft pulse on the ground point (skipped for reduced motion) */
      if (!prefersReducedMotion()) {
        const t = (now % 2200) / 2200;
        ctx.beginPath();
        ctx.arc(pr.x, tipY, 3 + t * 17, 0, 7);
        ctx.strokeStyle = `rgba(181,80,47,${0.5 * (1 - t)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pr.x, tipY, 2, 0, 7);
        ctx.fillStyle = "rgba(181,80,47,0.9)";
        ctx.fill();
      }
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
