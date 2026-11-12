/* map.js -- satellite map picker.
   Shows DAILY NASA satellite imagery (GIBS, the same pictures as NASA
   Worldview / Eyes on Earth) through the hub, which caches each day's
   tiles on disk -- so the map also works offline (last cached day, or
   the bundled Natural Earth world outlines if nothing is cached yet).
   Tap to drop a pin, drag to pan, pinch or +/- to zoom. */

const MAP = {
  canvas: null, ctx: null, land: null,
  cx: 20, cy: 20,            // view center (lon, lat)
  zoom: 3,                   // integer slippy zoom (1..maxZ of the layer)
  layer: "truecolor",
  pin: null,                 // {lat, lon}
  onPick: null,
  tiles: new Map(),          // "layer/z/x/y" -> Image|false(failed)
};

const LAYERS = {
  truecolor:   { ext: "jpg", maxz: 9, label: "Satellite photo",
                 note: "Today's true-colour NASA satellite picture of the land (MODIS Terra)." },
  soilmoisture:{ ext: "png", maxz: 6, label: "Soil moisture",
                 note: "How wet the top soil is, from the SMAP satellite. Blue = wet, brown = dry." },
  temp:        { ext: "png", maxz: 7, label: "Land temperature",
                 note: "How hot the ground surface is, from the MODIS satellite." },
  ndvi:        { ext: "png", maxz: 8, label: "Greenery",
                 note: "How green and leafy the plants are (NDVI, 8-day VIIRS). Dark green = lush." },
  rain:        { ext: "png", maxz: 6, label: "Rainfall",
                 note: "Rainfall rate, from the GPM rain satellite." },
};

/* ---------- slippy-map (Web Mercator) math ---------- */
const worldPx = (z) => 256 * Math.pow(2, z);
const lonToX = (lon, z) => (lon + 180) / 360 * worldPx(z);
function latToY(lat, z) {
  const r = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  /* standard slippy formula: ln(tan(pi/4 + lat/2)) == asinh(tan lat),
     and the normalisation is 2*pi (NOT pi) -- dividing by pi put taps
     at grossly wrong latitudes */
  return (0.5 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / (2 * Math.PI))
    * worldPx(z);
}
const xToLon = (x, z) => x / worldPx(z) * 360 - 180;
function yToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * Math.max(0, y) / worldPx(z);
  return Math.atan(Math.sinh(n)) * 180 / Math.PI;
}

function mapInit() {
  MAP.canvas = document.getElementById("mapCanvas");
  if (!MAP.canvas) return;
  MAP.ctx = MAP.canvas.getContext("2d");
  fetch("world.json").then((r) => r.json()).then((d) => {
    MAP.land = d.features;
    mapDraw();
  });
  bindMapEvents();
  window.addEventListener("resize", () => { mapSize(); mapDraw(); });
}

function mapOpen(onPick) {
  MAP.onPick = onPick;
  const lat = parseFloat(document.getElementById("lat").value);
  const lon = parseFloat(document.getElementById("lon").value);
  if (!isNaN(lat) && !isNaN(lon)) {
    MAP.pin = { lat, lon };
    MAP.cx = lon; MAP.cy = lat; MAP.zoom = 6;
  } else {
    MAP.pin = null; MAP.cx = 20; MAP.cy = 20; MAP.zoom = 2;
  }
  mapSize(); mapDraw();        // size FIRST: setLayer() draws immediately
  renderLayerChips();
}

function renderLayerChips() {
  const box = document.getElementById("layerChips");
  if (!box || box.dataset.built) return;
  box.dataset.built = "1";
  for (const [key, cfg] of Object.entries(LAYERS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = cfg.label;
    b.dataset.layer = key;
    b.addEventListener("click", () => setLayer(key));
    box.appendChild(b);
  }
  setLayer(MAP.layer);
}

function setLayer(key) {
  MAP.layer = key;
  MAP.zoom = Math.min(MAP.zoom, LAYERS[key].maxz);
  document.querySelectorAll("#layerChips .chip").forEach((c) =>
    c.setAttribute("aria-pressed", c.dataset.layer === key ? "true" : "false"));
  document.getElementById("layerNote").textContent = LAYERS[key].note;
  mapDraw();
}

function mapSize() {
  const c = MAP.canvas, wrap = c.parentElement;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(280, wrap.clientWidth || 320);
  c.style.width = width + "px";
  c.style.height = Math.round(width / 2) + "px";

  // Canvas drawing coordinates use the CSS content box, not the backing
  // bitmap or the bordered outer box. Keeping these spaces identical is
  // essential for accurate pointer -> geographic coordinate conversion.
  MAP.W = c.clientWidth;
  MAP.H = c.clientHeight;
  c.width = Math.round(MAP.W * dpr);
  c.height = Math.round(MAP.H * dpr);
}

function clampView() {
  if (!MAP.W || !MAP.H) return;      // not sized yet -- nothing to clamp
  const z = MAP.zoom, W = MAP.W, H = MAP.H;
  const spanLon = W / worldPx(z) * 360;
  if (spanLon < 360) {
    MAP.cx = Math.max(-180 + spanLon / 2, Math.min(180 - spanLon / 2, MAP.cx));
  } else MAP.cx = 0;
  const cyPx = latToY(MAP.cy, z);
  if (cyPx - H / 2 < 0) MAP.cy = yToLat(H / 2, z);
  else if (cyPx + H / 2 > worldPx(z)) MAP.cy = yToLat(worldPx(z) - H / 2, z);
}

function tileImg(z, x, y) {
  const key = `${MAP.layer}/${z}/${x}/${y}`;
  let img = MAP.tiles.get(key);
  if (img !== undefined) return img;
  img = new Image();
  img.onload = () => mapDraw();
  img.onerror = () => { MAP.tiles.set(key, false); };
  img.src = `/api/maptile/${MAP.layer}/${z}/${x}/${y}.${LAYERS[MAP.layer].ext}`;
  MAP.tiles.set(key, img);
  return img;
}

function mapDraw() {
  if (!MAP.ctx) return;
  clampView();
  const ctx = MAP.ctx, W = MAP.W, H = MAP.H, z = MAP.zoom;
  ctx.setTransform(window.devicePixelRatio || 1, 0, 0,
                   window.devicePixelRatio || 1, 0, 0);
  /* sea */
  ctx.fillStyle = "#E3EDF2";
  ctx.fillRect(0, 0, W, H);
  /* land shapes (offline fallback under the imagery) */
  if (MAP.land) drawLand(ctx, z);
  /* NASA satellite imagery tiles */
  const cxPx = lonToX(MAP.cx, z), cyPx = latToY(MAP.cy, z);
  const x0 = Math.floor((cxPx - W / 2) / 256), x1 = Math.floor((cxPx + W / 2) / 256);
  const y0 = Math.max(0, Math.floor((cyPx - H / 2) / 256));
  const y1 = Math.min(2 ** z - 1, Math.floor((cyPx + H / 2) / 256));
  for (let tx = Math.max(0, x0); tx <= Math.min(2 ** z - 1, x1); tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const img = tileImg(z, tx, ty);
      if (img && img.complete && img.naturalWidth)
        ctx.drawImage(img, tx * 256 - cxPx + W / 2, ty * 256 - cyPx + H / 2);
    }
  }
  /* A pin whose pointed tip, rather than its centre, marks the exact
     selected coordinate. The white keyline stays legible on imagery. */
  if (MAP.pin) {
    const px = lonToX(MAP.pin.lon, z) - cxPx + W / 2;
    const py = latToY(MAP.pin.lat, z) - cyPx + H / 2;
    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.bezierCurveTo(-2, -5, -13, -16, -13, -25);
    ctx.arc(0, -25, 13, Math.PI, 0, false);
    ctx.bezierCurveTo(13, -16, 2, -5, 0, 1);
    ctx.closePath();
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "#B5502F";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#FFFFFF";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -25, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.restore();
  }
}

function drawLand(ctx, z) {
  const cxPx = lonToX(MAP.cx, z), cyPx = latToY(MAP.cy, z);
  ctx.fillStyle = "#DCE7D0";
  ctx.strokeStyle = "#9DB48F";
  ctx.lineWidth = 1;
  for (const f of MAP.land) {
    const polys = f.geometry.type === "Polygon"
      ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys)
      for (const ring of poly) {
        ctx.beginPath();
        let started = false;
        for (const [lon, lat] of ring) {
          const x = lonToX(lon, z) - cxPx + MAP.W / 2;
          const y = latToY(lat, z) - cyPx + MAP.H / 2;
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        if (started) { ctx.closePath(); ctx.fill(); ctx.stroke(); }
      }
  }
}

function mapSetPin(lat, lon) {
  MAP.pin = { lat: Math.max(-85, Math.min(85, lat)),
              lon: Math.max(-180, Math.min(180, lon)) };
  document.getElementById("mapCoord").textContent =
    `${MAP.pin.lat.toFixed(3)}, ${MAP.pin.lon.toFixed(3)}`;
  mapDraw();
}

function bindMapEvents() {
  const c = MAP.canvas;
  let dragging = false, moved = 0, last = null, pts = new Map(),
      pinchD0 = null, z0 = 1;

  // PointerEvent.offsetX/Y can jump when pointer capture is active and do
  // not account consistently for canvas borders or high-DPI sizing.
  // Convert viewport coordinates into the exact CSS-pixel drawing space.
  function pointOnCanvas(e) {
    const rect = c.getBoundingClientRect();
    const scaleX = MAP.W / Math.max(1, c.clientWidth);
    const scaleY = MAP.H / Math.max(1, c.clientHeight);
    return [
      Math.max(0, Math.min(MAP.W,
        (e.clientX - rect.left - c.clientLeft) * scaleX)),
      Math.max(0, Math.min(MAP.H,
        (e.clientY - rect.top - c.clientTop) * scaleY))
    ];
  }

  c.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const point = pointOnCanvas(e);
    try { c.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointers */ }
    pts.set(e.pointerId, point);
    if (pts.size === 1) {
      dragging = true;
      moved = 0;
      last = point;
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinchD0 = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]));
      z0 = MAP.zoom;
      moved = 7; // A pinch must never be interpreted as a tap.
    }
  });

  c.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const point = pointOnCanvas(e);
    pts.set(e.pointerId, point);
    if (pts.size === 2 && pinchD0) {
      const [a, b] = [...pts.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      MAP.zoom = Math.max(1, Math.min(LAYERS[MAP.layer].maxz,
        Math.round(z0 * distance / pinchD0)));
      mapDraw();
      return;
    }
    if (pts.size !== 1 || !last) return;
    const dx = point[0] - last[0], dy = point[1] - last[1];
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) {
      const z = MAP.zoom;
      MAP.cx = xToLon(lonToX(MAP.cx, z) - dx, z);
      MAP.cy = yToLat(latToY(MAP.cy, z) - dy, z);
      mapDraw();
    }
    last = point;
  });

  function finishPointer(e, cancelled) {
    const point = pointOnCanvas(e);
    const wasTap = !cancelled && pts.size === 1 && moved <= 6;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchD0 = null;
    if (pts.size === 1) {
      last = [...pts.values()][0];
      moved = 7;
    }
    if (pts.size === 0) {
      dragging = false;
      last = null;
      if (wasTap) {
        const z = MAP.zoom;
        const lon = xToLon(lonToX(MAP.cx, z) - MAP.W / 2 + point[0], z);
        const lat = yToLat(latToY(MAP.cy, z) - MAP.H / 2 + point[1], z);
        mapSetPin(lat, lon);
      }
    }
  }

  c.addEventListener("pointerup", (e) => finishPointer(e, false));
  c.addEventListener("pointercancel", (e) => finishPointer(e, true));
  document.getElementById("zoomIn").addEventListener("click",
    () => { MAP.zoom = Math.min(LAYERS[MAP.layer].maxz, MAP.zoom + 1); mapDraw(); });
  document.getElementById("zoomOut").addEventListener("click",
    () => { MAP.zoom = Math.max(1, MAP.zoom - 1); mapDraw(); });
}