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
  return (0.5 - Math.log(Math.tan(Math.PI / 4 + r / 2)) / Math.PI) * worldPx(z);
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
  renderLayerChips();
  mapSize(); mapDraw();
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
  const c = MAP.canvas, wrap = c.parentElement, dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth || 320;
  c.style.width = w + "px";
  c.style.height = Math.round(w / 2) + "px";
  c.width = Math.round(w * dpr);
  c.height = Math.round(w / 2 * dpr);
  MAP.W = w; MAP.H = Math.round(w / 2);
}

function clampView() {
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
  /* pin */
  if (MAP.pin) {
    const px = lonToX(MAP.pin.lon, z) - cxPx + W / 2;
    const py = latToY(MAP.pin.lat, z) - cyPx + H / 2;
    ctx.strokeStyle = "#B5502F";
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.stroke();
    ctx.fillStyle = "#B5502F";
    ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill();
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

  c.addEventListener("pointerdown", (e) => {
    c.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinchD0 = Math.hypot(a[0] - b[0], a[1] - b[1]); z0 = MAP.zoom;
    }
    dragging = true; moved = 0; last = [e.offsetX, e.offsetY];
  });
  c.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    pts.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pts.size === 2 && pinchD0) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      MAP.zoom = Math.max(1, Math.min(LAYERS[MAP.layer].maxz,
        Math.round(z0 * d / pinchD0)));
      mapDraw();
      return;
    }
    const dx = e.offsetX - last[0], dy = e.offsetY - last[1];
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) {
      const z = MAP.zoom;
      MAP.cx = xToLon(lonToX(MAP.cx, z) - dx, z);
      MAP.cy = yToLat(latToY(MAP.cy, z) - dy, z);
      last = [e.offsetX, e.offsetY];
      mapDraw();
    }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchD0 = null;
    if (pts.size === 0) {
      dragging = false;
      if (moved <= 6) {
        const z = MAP.zoom;
        const lon = xToLon(lonToX(MAP.cx, z) - MAP.W / 2 + e.offsetX, z);
        const lat = yToLat(latToY(MAP.cy, z) - MAP.H / 2 + e.offsetY, z);
        mapSetPin(lat, lon);
      }
    }
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
  document.getElementById("zoomIn").addEventListener("click",
    () => { MAP.zoom = Math.min(LAYERS[MAP.layer].maxz, MAP.zoom + 1); mapDraw(); });
  document.getElementById("zoomOut").addEventListener("click",
    () => { MAP.zoom = Math.max(1, MAP.zoom - 1); mapDraw(); });
}
