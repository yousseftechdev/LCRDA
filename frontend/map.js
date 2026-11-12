/* map.js -- offline location picker.
   Bundled Natural Earth 110m land shapes (public domain) rendered on a
   canvas with an equirectangular projection. No tile server, no internet:
   works on the farm LAN. Tap to place a pin, drag to pan, +/- to zoom. */

const MAP = {
  canvas: null, ctx: null, land: null,
  cx: 20, cy: 0,            // view center (lon, lat)
  zoom: 1,                  // 1 = whole world fits
  pin: null,                // {lat, lon} picked point
  onPick: null,             // callback(lat, lon)
};

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
    MAP.cx = lon; MAP.cy = lat; MAP.zoom = 5;
  } else {
    MAP.pin = null; MAP.cx = 20; MAP.cy = 20; MAP.zoom = 1;
  }
  mapSize(); mapDraw();
}

function mapSize() {
  const c = MAP.canvas, dpr = window.devicePixelRatio || 1;
  const w = c.parentElement.clientWidth || 320;
  c.style.width = w + "px";
  c.style.height = Math.round(w / 2) + "px";
  c.width = Math.round(w * dpr);
  c.height = Math.round(w / 2 * dpr);
}

/* projection: world lon -180..180 -> x px */
function mapScale() { return (MAP.canvas.width / 360) * MAP.zoom; }

function mapProject(lon, lat) {
  const s = mapScale();
  return [MAP.canvas.width / 2 + (lon - MAP.cx) * s,
          MAP.canvas.height / 2 - (lat - MAP.cy) * s];
}

function mapUnproject(px, py) {
  const s = mapScale();
  return { lat: MAP.cy + (MAP.canvas.height / 2 - py) / s,
           lon: MAP.cx + (px - MAP.canvas.width / 2) / s };
}

function mapDraw() {
  if (!MAP.land) return;
  const ctx = MAP.ctx, W = MAP.canvas.width, H = MAP.canvas.height;
  ctx.clearRect(0, 0, W, H);
  /* sea */
  ctx.fillStyle = "#E3EDF2";                      /* light sky tint */
  ctx.fillRect(0, 0, W, H);
  /* land */
  ctx.fillStyle = "#DCE7D0";                      /* pale leaf */
  ctx.strokeStyle = "#9DB48F";
  ctx.lineWidth = Math.max(1, MAP.canvas.width / 500);
  const s = mapScale();
  for (const f of MAP.land) {
    const polys = f.geometry.type === "Polygon"
      ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        let started = false, prevX = null;
        for (const [lon, lat] of ring) {
          const x = W / 2 + (lon - MAP.cx) * s;
          const y = H / 2 - (lat - MAP.cy) * s;
          if (x < -s * 20 || x > W + s * 20) {      /* far offscreen */
            if (started) { ctx.stroke(); started = false; prevX = null; }
            continue;
          }
          if (!started) { ctx.beginPath(); ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
          prevX = x;
        }
        if (started) {
          if (prevX !== null && ring.length > 2 &&
              ring[0][0] === ring[ring.length - 1][0]) ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
      }
    }
  }
  /* pin */
  if (MAP.pin) {
    const [x, y] = mapProject(MAP.pin.lon, MAP.pin.lat);
    ctx.strokeStyle = "#B5502F";                  /* clay */
    ctx.lineWidth = Math.max(2, W / 200);
    ctx.beginPath(); ctx.arc(x, y, Math.max(6, W / 90), 0, 7); ctx.stroke();
    ctx.fillStyle = "#B5502F";
    ctx.beginPath(); ctx.arc(x, y, Math.max(3, W / 200), 0, 7); ctx.fill();
  }
  /* graticule labels are unnecessary for farmers; keep it clean */
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
  let dragging = false, moved = 0, last = null, pts = new Map(), pinchD0 = null, z0 = 1;

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
      mapZoomTo(z0 * (d / pinchD0));
      return;
    }
    const dx = e.offsetX - last[0], dy = e.offsetY - last[1];
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) {
      const s = mapScale();
      MAP.cx -= dx / s; MAP.cy += dy / s;
      MAP.cy = Math.max(-85, Math.min(85, MAP.cy));
      last = [e.offsetX, e.offsetY];
      mapDraw();
    }
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchD0 = null;
    if (pts.size === 0) {
      dragging = false;
      if (moved <= 6) mapSetPin(...Object.values(mapUnproject(e.offsetX, e.offsetY)));
    }
  };
  c.addEventListener("pointerup", up);
  c.addEventListener("pointercancel", up);
  document.getElementById("zoomIn").addEventListener("click", () => mapZoomTo(MAP.zoom * 1.6));
  document.getElementById("zoomOut").addEventListener("click", () => mapZoomTo(MAP.zoom / 1.6));
}

function mapZoomTo(z) {
  MAP.zoom = Math.max(1, Math.min(64, z));
  MAP.cy = Math.max(-85, Math.min(85, MAP.cy));
  mapDraw();
}
