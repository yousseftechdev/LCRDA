/* globe.js -- interactive 3D globe location picker.
   Built on three.js r149 (vendored at vendor/three.min.js, MIT -- no CDN,
   still fully offline): a textured unit sphere with an atmosphere shell,
   a small 3D satellite on a tilted orbit, and a star backdrop that drifts
   with the pointer. NASA GIBS imagery is reprojected client-side from
   Web-Mercator tiles (z3 mosaic, 8x8) into an equirectangular texture, so
   the imagery sits on the sphere without the flat map's projection
   wobbles. Drag to spin, pinch/wheel to zoom (deep enough for 15k-person
   towns), tap to drop the pin (exact ray-sphere intersection). City names
   from GeoNames are drawn on a 2D overlay with the same perspective math.
   The flat map (map.js) stays as the automatic fallback when WebGL is
   unavailable. */

const GLOBE = {
  supported: false,
  layer: "truecolor",
  pin: null,
  // view state (dist = camera distance; 3.4 frames the whole globe with
  // a margin, 1.35 is the deepest zoom, 6 the widest)
  yaw: 0, pitch: 0, dist: 3.4,
  _raf: 0, _running: false,
  _lastInteract: 0,
  _cities: null, _citiesPromise: null,
  _texCache: {},            // layer -> {base, data, eq, tex, pending, done}
  _land: null, _landPromise: null,
  _px: 0, _py: 0, _hover: false,   // pointer position for parallax/glow
  /* the globe lives on the deep-space hero in both themes, so its
     backdrop and labels always use the dark-space treatment */
  _spaceDark: true,
};

const RAD = Math.PI / 180;
const FOV = 38 * RAD;
/* camera distance clamps: 1.35 = deep enough to read towns of 15k people,
   6 = the whole planet with space around it */
const ZOOM_MIN = 1.35, ZOOM_MAX = 6;

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

  /* A small 3D satellite on a tilted orbit: real geometry (body, solar
     panels, dish) instead of a 2D dot, and the orbit ring is depth-tested
     by the globe so it disappears behind the planet. Both are hidden at
     deep zoom, where the camera is inside the orbit. */
  const sat = new THREE.Group();
  const shipMat = new THREE.MeshBasicMaterial({ color: 0xc3d0dc });
  const panelMat = new THREE.MeshBasicMaterial({ color: 0x1f5f9e });
  const goldMat = new THREE.MeshBasicMaterial({ color: 0xd9c68f });
  const satBody = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.045, 0.09), shipMat);
  sat.add(satBody);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.006, 0.055), panelMat);
    panel.position.set(side * 0.11, 0, 0);
    sat.add(panel);
  }
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.04, 12), goldMat);
  dish.rotation.x = Math.PI / 2;
  dish.position.z = 0.07;
  sat.add(dish);
  scene.add(sat);

  const ORBIT_R = 1.42, ORBIT_INC = 0.45;
  const orbitPts = [];
  for (let i = 0; i < 128; i++) {
    const a = i / 128 * Math.PI * 2;
    orbitPts.push(new THREE.Vector3(
      ORBIT_R * Math.cos(a),
      ORBIT_R * Math.sin(a) * Math.sin(ORBIT_INC),
      ORBIT_R * Math.sin(a) * Math.cos(ORBIT_INC)));
  }
  const orbit = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(orbitPts),
    new THREE.LineBasicMaterial({ color: 0x7fb2e8, transparent: true,
                                  opacity: 0.3, depthWrite: false }));
  scene.add(orbit);

  GLOBE._renderer = renderer; GLOBE._scene = scene; GLOBE._camera = camera;
  GLOBE._sphere = sphere; GLOBE._mat = material;
  GLOBE._sat = sat; GLOBE._orbit = orbit;

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
  /* re-measure whenever the wrapper changes size: a CSS-stretched canvas
     was itself a source of blur/wobble */
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
      GLOBE.dist = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, dist0 * pinchD0 / d));
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

  /* pointer-reactive backdrop: stars drift against the cursor and a soft
     glow follows it under the globe (desktop hover; ignored for touch) */
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    GLOBE._px = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width * 2 - 1));
    GLOBE._py = Math.max(-1, Math.min(1, (e.clientY - r.top) / r.height * 2 - 1));
    GLOBE._hover = true;
    scheduleSpace();
  });
  canvas.addEventListener("pointerleave", () => {
    GLOBE._hover = false; GLOBE._px = GLOBE._py = 0;
    scheduleSpace();
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    GLOBE.dist = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
      GLOBE.dist * Math.exp(e.deltaY * 0.0011)));
    touch(); drawSpace();
  }, { passive: false });

  const zi = document.getElementById("zoomIn"),
        zo = document.getElementById("zoomOut");
  if (zi) zi.addEventListener("click", () =>
    { GLOBE.dist = Math.max(ZOOM_MIN, GLOBE.dist * 0.78); drawSpace(); });
  if (zo) zo.addEventListener("click", () =>
    { GLOBE.dist = Math.min(ZOOM_MAX, GLOBE.dist / 0.78); drawSpace(); });
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
    globeSetPin(lat, lon);
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

/* ---------- cities (GeoNames cities15000: [lat, lon, name, pop]) ---------- */
function globeLoadCities() {
  if (GLOBE._cities) return;
  if (!GLOBE._citiesPromise)
    GLOBE._citiesPromise = fetch("cities.json").then((r) => r.json())
      .then((list) => {
        const v = new Float32Array(list.length * 3);
        list.forEach((c, i) => {
          const p = llToVec(c[0], c[1]);
          v[i * 3] = p[0]; v[i * 3 + 1] = p[1]; v[i * 3 + 2] = p[2];
        });
        GLOBE._cities = list.map((c) => ({ la: c[0], lo: c[1],
                                           n: c[2], p: c[3] }));
        GLOBE._cityVec = v;
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

  /* animate the 3D satellite along its tilted orbit */
  const showOrbit = GLOBE.dist > 2.5 && !prefersReducedMotion();
  if (GLOBE._sat) {
    GLOBE._sat.visible = showOrbit;
    if (showOrbit) {
      const a = now * 0.00045;
      const r = 1.42, inc = 0.45;
      GLOBE._sat.position.set(
        r * Math.cos(a), r * Math.sin(a) * Math.sin(inc),
        r * Math.sin(a) * Math.cos(inc));
      GLOBE._sat.rotation.set(0, -a + Math.PI / 2, inc * 0.6);
    }
  }
  if (GLOBE._orbit) GLOBE._orbit.visible = showOrbit;

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

function globeDrawOverlay(now, M, D) {
  const ctx = GLOBE._overlayCtx;
  if (!ctx) return;
  const dpr = GLOBE._dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, GLOBE._W, GLOBE._H);
  const dark = GLOBE._spaceDark !== false;

  /* city labels -- the deeper you zoom, the smaller the towns we show.
     GeoNames cities15000 is sorted by population desc, so `break` is safe. */
  if (GLOBE._cities && GLOBE._cityVec) {
    const small = GLOBE._W < 460;
    const minPop = (D > 3.6 ? 6e6
                 : D > 3.0 ? 2.5e6
                 : D > 2.5 ? 1e6
                 : D > 2.1 ? 400e3
                 : D > 1.8 ? 150e3
                 : D > 1.55 ? 60e3
                 : 15e3) * (small ? 4 : 1);
    /* a phone-sized globe cannot hold 30 names without them colliding */
    const cap = small ? 13 : (D < 1.9 ? 60 : 44);
    const labels = [];
    const v = GLOBE._cityVec;
    const f = 1 / Math.tan(FOV / 2);
    const invD = 1 / D;
    for (let i = 0; i < GLOBE._cities.length; i++) {
      const c = GLOBE._cities[i];
      if (c.p < minPop) break;                  // sorted by population desc
      const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
      /* cheap back-face test before allocating a projection */
      const wx = M[0] * x + M[1] * y + M[2] * z;
      const wy = M[3] * x + M[4] * y + M[5] * z;
      const wz = M[6] * x + M[7] * y + M[8] * z;
      if (wz <= invD) continue;
      const zc = D - wz;
      labels.push({ c, pr: {
        x: ((wx * f / zc) + 1) / 2 * GLOBE._W,
        y: (1 - (wy * f / zc)) / 2 * GLOBE._H,
      } });
    }
    labels.sort((a, b) => b.c.p - a.c.p);
    ctx.textBaseline = "middle";
    const placed = [];
    let shown = 0;
    for (const { c, pr } of labels) {
      if (shown >= cap) break;
      const fs = Math.max(8.5, Math.min(small ? 10.5 : 12.5,
        7.4 + 1.8 * Math.log10(c.p / 1e4)));
      const wEst = c.n.length * fs * 0.6 + 8;
      const box = [pr.x - 2, pr.y - fs / 2 - 1, pr.x + wEst, pr.y + fs / 2 + 1];
      /* do not let names run off the canvas or collide with another name */
      if (box[0] < 2 || box[2] > GLOBE._W - 2 ||
          box[1] < 2 || box[3] > GLOBE._H - 2) continue;
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
let _spaceQueued = false;
function scheduleSpace() {
  if (_spaceQueued) return;
  _spaceQueued = true;
  requestAnimationFrame(() => { _spaceQueued = false; drawSpace(); });
}
function drawSpace() {
  const cv = GLOBE._space;
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const dpr = GLOBE._dpr || 1, W = GLOBE._W, H = GLOBE._H;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const dark = GLOBE._spaceDark !== false;
  const cx = W / 2, cy = H / 2;
  const f = (H / 2) / Math.tan(FOV / 2);
  const R = f / Math.sqrt(GLOBE.dist * GLOBE.dist - 1);

  /* cursor glow: a soft light under the globe that tracks the pointer */
  if (GLOBE._hover && !prefersReducedMotion()) {
    const hx = (GLOBE._px * 0.5 + 0.5) * W;
    const hy = (GLOBE._py * 0.5 + 0.5) * H;
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, Math.max(W, H) * 0.5);
    hg.addColorStop(0, dark ? "rgba(96,156,240,0.22)" : "rgba(120,170,225,0.18)");
    hg.addColorStop(1, "rgba(96,156,240,0)");
    ctx.fillStyle = hg; ctx.fillRect(0, 0, W, H);
  }

  /* atmosphere halo */
  const g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.5);
  g.addColorStop(0, dark ? "rgba(90,150,235,0.35)" : "rgba(130,175,225,0.30)");
  g.addColorStop(1, "rgba(90,150,235,0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, 7); ctx.fill();
  /* stars (dark mode only) -- drift opposite the cursor for depth */
  if (dark) {
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                        return seed / 0x7fffffff; };
    const ox = prefersReducedMotion() ? 0 : GLOBE._px * 10;
    const oy = prefersReducedMotion() ? 0 : GLOBE._py * 7;
    for (let i = 0; i < 170; i++) {
      const x = rnd() * W - ox, y = rnd() * H - oy, s = rnd();
      if (Math.hypot(x - cx, y - cy) < R * 1.05) continue;
      ctx.fillStyle = `rgba(235,242,250,${0.25 + s * 0.65})`;
      ctx.beginPath(); ctx.arc(x, y, 0.5 + s * 1.1, 0, 7); ctx.fill();
    }
  }
}
