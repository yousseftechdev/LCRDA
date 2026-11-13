/* Live Crop Rotation Decision Aid — farmer-facing logic.
   All math stays on the hub; this file speaks plain language only. */

const $ = (id) => document.getElementById(id);

/* The five farmer priorities map onto the six science criteria:
   "Fits my land and weather" drives BOTH climate and soil. */
const PRIORITIES = [
  { key: "land", label: "Fits my land and weather",
    what: "How much the crop must match your local weather and your soil. "
        + "Weather fit is measured from a full year of NASA satellite records "
        + "for your spot, using the FAO EcoCrop method for what each crop can "
        + "tolerate. Soil fit comes from the SoilGrids world soil map "
        + "(acidity and texture). Crops that don't fit are ranked low, but "
        + "nothing is hidden from you." },
  { key: "harvest", label: "Big harvest",
    what: "How much you value a heavy harvest this season. Expected harvest "
        + "is estimated with the FAO AquaCrop method: how much water the "
        + "plant can drink here, turned into crop weight. It's a comparison "
        + "between crops — treat it as relative, not a promise." },
  { key: "water", label: "Saving water",
    what: "How much you care about a crop that drinks less. Each crop's "
        + "thirst is measured with the FAO-56 handbook method from the "
        + "satellite weather data, shown later in litres per square metre." },
  { key: "soilnext", label: "Healthy soil next seasons",
    what: "How much you value crops that help what comes next — beans and "
        + "other pulses leave nitrogen in the soil, deep roots open it up, "
        + "and repeating the same crop family invites pests and disease." },
  { key: "market", label: "Sells for a good price",
    what: "How much a good price matters to you. Nobody can measure your "
        + "local market from a satellite — you set this yourself, and it only "
        + "reorders the list; it never removes a crop." },
];

const MARKET_LEVELS = [
  { label: "Hard to sell", v: 0.2 },
  { label: "Average", v: 0.5 },
  { label: "Good", v: 0.75 },
  { label: "Sells fast", v: 1.0 },
];

let selected = new Map();   // crop key -> crop object
let cropCatalog = [];
let waterMode = "rain";
let waterMM = null;

/* ---------- priorities ---------- */
const PRIORITY_WORDS = ["Not a priority", "A little", "Matters",
                        "Important", "Top priority"];

function initSliders() {
  const box = $("sliders");
  PRIORITIES.forEach((p) => {
    const row = document.createElement("div");
    row.className = "sliderrow";
    row.innerHTML =
      `<div class="head"><span class="name">${p.label}</span>`
      + `<span class="prio-value" aria-hidden="true">Matters</span>`
      + `<button type="button" class="whatbtn" aria-expanded="false" `
      + `aria-label="What does this mean?">?</button></div>`
      + `<input type="range" min="1" max="5" step="1" value="3" `
      + `aria-label="${p.label} — importance">`
      + `<div class="ends"><span>Not important</span><span>Very important</span></div>`
      + `<div class="whatdetail">${p.what}</div>`;
    box.appendChild(row);
    const inp = row.querySelector("input");
    const btn = row.querySelector(".whatbtn");
    const det = row.querySelector(".whatdetail");
    const badge = row.querySelector(".prio-value");
    const setFill = (el) => {
      el.style.setProperty("--p", (Number(el.value) - 1) / 4);
      badge.textContent = PRIORITY_WORDS[Number(el.value) - 1];
    };
    setFill(inp);
    inp.addEventListener("input", () => setFill(inp));
    btn.addEventListener("click", () => {
      const open = det.classList.toggle("open");
      btn.setAttribute("aria-expanded", open);
    });
  });
}

/* ---------- crop search / selection ---------- */
let searchTimer = null;
$("cropSearch").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) { $("cropResults").innerHTML = ""; return; }
  searchTimer = setTimeout(async () => {
    const r = await fetch(`/api/crops?q=${encodeURIComponent(q)}`);
    const js = await r.json();
    cropCatalog = js.crops || [];
    renderChips();
  }, 250);
});

function niceName(c) {
  const common = (c.comname || "").split(",")[0].trim();
  return common ? `${cap(common)} (${c.scientific_name})` : c.scientific_name;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function renderChips() {
  const box = $("cropResults");
  box.innerHTML = "";
  cropCatalog.slice(0, 24).forEach((c) => {
    if (selected.has(c.key)) return;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = niceName(c);
    chip.addEventListener("click", () => {
      selected.set(c.key, c);
      renderChips(); updateCount(); renderMarketInputs();
    });
    box.appendChild(chip);
  });
  [...selected.values()].forEach((c) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-pressed", "true");
    chip.textContent = niceName(c) + " — chosen (tap to remove)";
    chip.addEventListener("click", () => {
      selected.delete(c.key);
      renderChips(); updateCount(); renderMarketInputs();
    });
    box.appendChild(chip);
  });
}

function updateCount() {
  $("selCount").textContent = selected.size
    ? `${selected.size} crop${selected.size > 1 ? "s" : ""} chosen — you can also keep searching`
    : "Nothing selected yet — using the common crops";
}

function renderMarketInputs() {
  const wrap = $("marketWrap");
  if (!selected.size) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");
  const box = $("marketInputs");
  box.innerHTML = "";
  [...selected.values()].forEach((c) => {
    const row = document.createElement("div");
    row.className = "marketrow";
    row.innerHTML = `<div class="name">${niceName(c)}</div><div class="segopts"></div>`;
    const opts = row.querySelector(".segopts");
    MARKET_LEVELS.forEach((lv, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = lv.label;
      b.setAttribute("aria-pressed", i === 1 ? "true" : "false");
      b.addEventListener("click", () => {
        [...opts.children].forEach((x) => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        c.marketValue = lv.v;
      });
      opts.appendChild(b);
    });
    box.appendChild(row);
  });
}

/* ---------- water ---------- */
document.querySelectorAll(".seg[data-water]").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".seg[data-water]").forEach(
      (x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
    document.querySelectorAll(".seg[data-water]").forEach(
      (x) => x.classList.toggle("on", x.getAttribute("aria-pressed") === "true"));
    waterMode = b.dataset.water;
    $("waterAmount").classList.toggle("hidden", waterMode !== "irrigate");
    if (waterMode === "rain") waterMM = null;
  });
});
document.querySelectorAll(".chip.amount").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".chip.amount").forEach(
      (x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
    waterMM = Number(b.dataset.mm);
    $("water").value = "";
  });
});
$("water").addEventListener("input", (e) => {
  waterMM = e.target.value === "" ? null : Number(e.target.value);
  if (waterMM !== null) {
    document.querySelectorAll(".chip.amount").forEach(
      (x) => x.setAttribute("aria-pressed", "false"));
  }
});

/* ---------- map picker ---------- */
/* renderer selection: WebGL 3D globe when available, flat map otherwise */
let PICKER = null;
function initPicker() {
  const hint = document.querySelector(".mapbar.hint");
  try {
    if (typeof GLOBE !== "undefined" && GLOBE.init()) {
      PICKER = GLOBE;
      document.getElementById("mapCanvas").style.display = "none";
      if (hint) hint.textContent = "Tap the globe to drop the pin, drag to spin it, pinch or use + to zoom.";
      return;
    }
  } catch (e) {
    console.warn("3D globe unavailable, using the flat map:", e);
  }
  PICKER = {
    get pin() { return MAP.pin; },
    open: mapOpen,
    stop: () => {},
    setLayer: (k) => setLayer(k),
    layer: MAP.layer,
  };
  document.getElementById("spaceCanvas").style.display = "none";
  document.getElementById("globeCanvas").style.display = "none";
  document.getElementById("globeOverlay").style.display = "none";
  if (hint) hint.textContent = "Tap the map to drop the pin, drag to move it, pinch or use + to zoom.";
  mapInit();
}
function buildChips() {
  const box = document.getElementById("layerChips");
  if (!box || box.dataset.built) return;
  box.dataset.built = "1";
  for (const [key, cfg] of Object.entries(LAYERS)) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = cfg.label;
    b.dataset.layer = key;
    b.addEventListener("click", () => {
      PICKER.setLayer(key);
      if (PICKER === GLOBE) PICKER.layer = key;
      updateLayerUI(key);
    });
    box.appendChild(b);
  }
}
function updateLayerUI(key) {
  document.querySelectorAll("#layerChips .chip").forEach((c) =>
    c.setAttribute("aria-pressed", c.dataset.layer === key ? "true" : "false"));
  const cfg = LAYERS[key];
  const note = PICKER === GLOBE && cfg.globeNote ? cfg.globeNote : cfg.note;
  document.getElementById("layerNote").textContent = note;
}
$("btnUseSpot").addEventListener("click", () => {
  if (!PICKER.pin) { $("mapCoord").textContent = "Tap the globe first to drop the pin."; return; }
  $("lat").value = PICKER.pin.lat.toFixed(4);
  $("lon").value = PICKER.pin.lon.toFixed(4);
  $("mapCoord").textContent = "Spot applied — the pin stays on the globe.";
  $("dataStatus").className = "statusline ok";
  $("dataStatus").textContent = "Field location set. Check the satellite data when you are ready.";
});

/* ---------- satellite data status ---------- */
$("btnFetch").addEventListener("click", async () => {
  const lat = $("lat").value, lon = $("lon").value;
  const st = $("dataStatus");
  st.className = "statusline";
  st.textContent = "Asking NASA for the latest weather records…";
  try {
    const r = await fetch("/api/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: +lat, lon: +lon }),
    });
    const js = await r.json();
    if (js.error) throw new Error(js.error);
    st.className = "statusline ok";
    st.textContent = `Up to date — ${js.climate_days} days of satellite weather `
      + `stored on this device. Advice works from here with no internet.`;
  } catch (e) {
    st.className = "statusline warn";
    st.textContent = "Could not reach NASA right now — the advice will use "
      + "the weather records already stored on this device.";
  }
});

/* ---------- satellite greenness (NDVI / EVI) ---------- */
let vegUid = 0;

function fmtIsoDate(iso) {
  return iso ? fmtDate(iso.replace(/-/g, "")) : "";
}

function smoothPath(pts) {
  if (!pts.length) return "";
  if (pts.length < 3) return "M" + pts.map((p) => p.join(",")).join("L");
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1],
          p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(2)},${c1[1].toFixed(2)} `
       + `${c2[0].toFixed(2)},${c2[1].toFixed(2)} `
       + `${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

function vegChart(series) {
  const W = 560, H = 176, padL = 12, padR = 12, padT = 18, padB = 26;
  const all = series.flatMap((p) => [p.ndvi, p.evi]);
  const lo = Math.min(...all), hi = Math.max(...all);
  const min = Math.max(-0.1, Math.floor((lo - 0.03) * 100) / 100);
  const max = Math.ceil((hi + 0.03) * 100) / 100;
  const span = Math.max(0.08, max - min);
  const x = (i) => padL + i * (W - padL - padR) / Math.max(1, series.length - 1);
  const y = (v) => padT + (1 - (v - min) / span) * (H - padT - padB);
  const ndviPts = series.map((p, i) => [x(i), y(p.ndvi)]);
  const eviPts = series.map((p, i) => [x(i), y(p.evi)]);
  const area = `${smoothPath(ndviPts)} L${x(series.length - 1).toFixed(2)},${H - padB} L${x(0).toFixed(2)},${H - padB} Z`;
  const id = `veg${++vegUid}`;
  const last = series[series.length - 1];
  const peakIdx = series.reduce((best, p, i) =>
    p.ndvi > series[best].ndvi ? i : best, 0);
  /* month + year labels, not truncated day numbers, so the axis reads at a
     glance; the peak label is dropped when it would sit on top of an end */
  const monthYear = (iso) => {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-GB",
      { month: "short", year: "2-digit", timeZone: "UTC" });
  };
  const dayMonth = (iso) => {
    const d = new Date(iso + "T00:00:00Z");
    return d.toLocaleDateString("en-GB",
      { day: "numeric", month: "short", timeZone: "UTC" });
  };
  const labels = [
    { i: 0, text: monthYear(series[0].date), anchor: "start" },
    { i: series.length - 1, text: monthYear(last.date), anchor: "end" },
  ];
  const peakX = x(peakIdx);
  if (peakX - x(0) > 150 && x(series.length - 1) - peakX > 90) {
    labels.push({ i: peakIdx, text: "peak " + dayMonth(series[peakIdx].date),
                  anchor: "middle" });
  }
  labels.sort((a, b) => a.i - b.i);
  const aria = `Greenness over the past year: NDVI ${last.ndvi} and EVI `
    + `${last.evi} on ${fmtIsoDate(last.date)}. Peak NDVI `
    + `${series[peakIdx].ndvi} in ${fmtIsoDate(series[peakIdx].date)}.`;

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}">
    <defs>
      <linearGradient id="${id}a" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#B7E278" stop-opacity="0.28"/>
        <stop offset="1" stop-color="#B7E278" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="${id}c">
        <rect class="veg-clip" x="0" y="0" width="${W}" height="${H}"/>
      </clipPath>
    </defs>
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"
      stroke="rgba(255,255,255,0.14)" stroke-width="1"/>
    <g clip-path="url(#${id}c)">
      <path d="${area}" fill="url(#${id}a)"/>
      <path class="veg-line ndvi" d="${smoothPath(ndviPts)}" fill="none"
        stroke="#B7E278" stroke-width="2.4" stroke-linecap="round"
        stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <path class="veg-line evi" d="${smoothPath(eviPts)}" fill="none"
        stroke="#DE9F24" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" stroke-dasharray="5 4"
        vector-effect="non-scaling-stroke"/>
      <circle cx="${x(series.length - 1)}" cy="${y(last.ndvi)}" r="4"
        fill="#B7E278" stroke="#0B1712" stroke-width="2"/>
      <circle cx="${x(series.length - 1)}" cy="${y(last.evi)}" r="3.4"
        fill="#DE9F24" stroke="#0B1712" stroke-width="2"/>
    </g>
    ${labels.map((l) => `<text x="${Math.min(W - 46, Math.max(12, x(l.i)))}"
      y="${H - 8}" text-anchor="${l.anchor}"
      fill="#91A692" font-size="10.5" font-family="Public Sans, sans-serif">${l.text}</text>`).join("")}
  </svg>`;
}

function renderVegetation(v) {
  const box = $("vegetation");
  const latest = v.latest;
  const ndviPct = latest.ndvi_percentile;
  const note = ndviPct >= 99
    ? "the greenest reading in the past year"
    : `greener than ${Math.round(ndviPct)}% of the past year`;
  const trend = v.trend.direction === "greener"
    ? "The field is greening since the previous 16-day reading."
    : v.trend.direction === "drier"
      ? "The field is browning since the previous 16-day reading — worth a look on the ground."
      : "Greenness is steady compared with the previous reading.";
  box.innerHTML = `
    <div class="veg-card tilt">
      <div class="veg-head">
        <div>
          <p class="card-kicker">From orbit</p>
          <h3>How green is your field?</h3>
        </div>
        <span class="veg-stamp"><span class="pulse-dot" aria-hidden="true"></span>
          ${fmtIsoDate(latest.date)}</span>
      </div>
      <div class="veg-metrics">
        <div class="veg-metric ndvi">
          <span class="k">NDVI</span>
          <span class="v">${latest.ndvi.toFixed(2)}</span>
          <span class="n">${note}</span>
        </div>
        <div class="veg-metric evi">
          <span class="k">EVI</span>
          <span class="v">${latest.evi.toFixed(2)}</span>
          <span class="n">corrected for bare soil and haze</span>
        </div>
      </div>
      <div class="veg-chart">${vegChart(v.series)}</div>
      <p class="veg-note">${trend} Peak greenness was
      ${v.stats.ndvi.max.toFixed(2)} around ${fmtIsoDate(v.stats.ndvi.peak_date)}.</p>
      <details class="veg-about">
        <summary>What do these two numbers mean?</summary>
        <p>NDVI compares the red light plants absorb with the near-infrared
        light they reflect. EVI is a refined index that also corrects for bare
        soil and haze. Both run roughly from -1 to 1, and higher means more
        living green leaf area. NASA's MODIS satellite measures this spot at
        250 m, one reading every 16 days.</p>
        <p>They show how your field is doing right now. They do not decide the
        crop recommendation — your weather, soil, water and rotation do. Use
        them to notice drought stress or a late green-up.</p>
      </details>
      <p class="hint quiet small" style="color:#7F937F;margin-top:8px">
        NASA MODIS MOD13Q1 · 250 m · 16-day composites · ORNL DAAC</p>
    </div>`;
  if (window.LCRDA_EFFECTS) window.LCRDA_EFFECTS.animateVegetation();
}

function loadVegetation(lat, lon) {
  const box = $("vegetation");
  box.innerHTML = `
    <div class="veg-card">
      <div class="veg-head"><div>
        <p class="card-kicker">From orbit</p>
        <h3>How green is your field?</h3>
      </div></div>
      <div class="veg-skeleton"></div>
      <p class="veg-note">Reading 12 months of NASA NDVI and EVI for this
      spot. The first reading is stored on this hub for a week.</p>
    </div>`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  fetch(`/api/vegetation?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
        { signal: ctrl.signal })
    .then((r) => r.json())
    .then((js) => {
      clearTimeout(timer);
      if (!js || js.error || !js.series || !js.series.length) {
        box.innerHTML = `
          <div class="veg-card">
            <p class="card-kicker">From orbit</p>
            <h3>How green is your field?</h3>
            <p class="veg-error">Satellite greenness is not available right
            now — the planting advice above still works from the data stored
            on this hub.</p>
          </div>`;
        return;
      }
      renderVegetation(js);
    })
    .catch(() => {
      clearTimeout(timer);
      box.innerHTML = `
        <div class="veg-card">
          <p class="card-kicker">From orbit</p>
          <h3>How green is your field?</h3>
          <p class="veg-error">Satellite greenness is offline right now. The
          advice above is unaffected and keeps working without internet.</p>
        </div>`;
    });
}

/* ---------- run ---------- */
$("btnRun").addEventListener("click", async () => {
  $("err").textContent = "";
  const priorities = {};
  document.querySelectorAll("#sliders .sliderrow").forEach((row, i) => {
    priorities[PRIORITIES[i].key] = Number(row.querySelector("input").value);
  });
  const market = {};
  for (const [k, c] of selected) market[k] = c.marketValue ?? 0.5;

  const body = {
    lat: +$("lat").value, lon: +$("lon").value, altitude: 0,
    shortlist: selected.size ? [...selected.keys()] : null,
    priorities,                       // farmer keys; server maps them
    prev_crop: $("prevCrop").value || null,
    water_available_mm: waterMM,      // null = rainfed
    measured_ph: null,
    market,
  };
  const btn = $("btnRun");
  const btnLabel = btn.querySelector("span");
  btn.disabled = true;
  if (btnLabel) btnLabel.textContent = "Checking the crops…";
  $("vegetation").innerHTML = "";
  try {
    const r = await fetch("/api/recommend", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const js = await r.json();
    if (js.error) throw new Error(js.error);
    render(js);
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    $("err").textContent = "Something went wrong: " + e.message
      + " — check the numbers and try again.";
  }
  btn.disabled = false;
  if (btnLabel) btnLabel.textContent = "Get my planting advice";
});

/* ---------- rendering ---------- */
const FIVE_LABELS = ["", "poor", "not great", "fair", "good", "excellent"];

function barClass(v) {
  if (v >= 0.66) return "f";
  if (v >= 0.33) return "warn";
  return "bad";
}

function scoreBars(crit, prefix) {
  // crit = [climate, soil, water, yield, rotation] (0..1) -> five bars
  const names = ["Weather fit", "Your soil", "Water", "Harvest", "Soil for later"];
  let html = "";
  for (let i = 0; i < 5; i++) {
    const v = Math.max(0, Math.min(1, crit[i]));
    let bars = "";
    for (let b = 0; b < 5; b++) {
      const filled = v >= (b + 0.5) / 5;
      bars += `<span class="bar ${filled ? barClass(v) : ""}"></span>`;
    }
    const grade = FIVE_LABELS[Math.max(1, Math.round(v * 5))];
    html += `<div class="score" ${prefix ? `data-for="${prefix}${i}"` : ""}>`
      + `<span class="lbl">${names[i]}</span>`
      + `<span class="bars" role="img" aria-label="${names[i]}: ${grade} (${Math.round(v*100)} out of 100)">${bars}</span>`
      + `<span class="grade" aria-hidden="true">${grade}</span>`
      + `</div>`;
  }
  return html;
}

function litPerM2(mm) { return `${Math.round(mm)} litres per square metre`; }

function fmtDate(ymd) {
  if (!ymd) return "";
  const y = ymd.slice(0, 4), m = Number(ymd.slice(4, 6)), d = ymd.slice(6, 8);
  const months = ["January","February","March","April","May","June","July",
                  "August","September","October","November","December"];
  return `${d} ${months[m - 1]} ${y}`;
}

function render(res) {
  $("results").classList.remove("hidden");
  $("results").classList.remove("reveal");     // restart the one reveal
  void $("results").offsetWidth;
  $("results").classList.add("reveal");
  const w = res.winner;
  if (!w) { $("err").textContent = "No suitable crop was found for these "
    + "conditions — try adding more crops in step 2 or adjusting the water."; return; }

  /* recommendation card */
  const sow = w.sowing_date_temp || w.sowing_date;
  const irr = res.waterMode === "irrigate";
  const waterNote = irr
    ? (w.nir_mm <= res.waterAvailableMM
        ? "Your water supply covers this crop's season."
        : "That is more water than you said you have, so some watering weeks will be tight.")
    : "That is what it would drink in this season if you had to water it yourself.";
  const fact = (k, v) =>
    `<div><span class="k">${k}</span><span class="v">${v}</span></div>`;

  const whyBits = [];
  if (w.n_fixing) whyBits.push("feeds the soil with nitrogen for the next crop");
  if (w.criteria[0] >= 0.66) whyBits.push("matches this season's weather very well");
  if (w.criteria[1] >= 0.66) whyBits.push("likes your soil");
  if (w.yield_t_ha >= 5) whyBits.push("heavy expected harvest");

  $("summary").innerHTML = `
    <div class="rec-card tilt spotlight">
      <p class="rec-kicker">Plant this next</p>
      <p class="rec-name">${niceName(w)}</p>
      <div class="rec-facts">
        ${sow ? fact("Sowing window opens", "around " + fmtDate(sow)) : ""}
        ${fact("Days in the field", w.days_to_harvest + " days")}
        ${fact("Water over the season", litPerM2(w.nir_mm))}
        ${fact("Expected harvest", `${w.yield_t_ha} t/ha `
          + `<span class="note">(comparison only)</span>`)}
      </div>
      <p class="rec-sub">${waterNote}</p>
      <div class="scorecard">${scoreBars(w.criteria)}</div>
      ${whyBits.length ? `<p class="rec-sub">Why this one: ${whyBits.join("; ")}.</p>` : ""}
      ${res.closeCall ? `<div class="closecall">This is a close call with `
        + `<b>${niceName(res.closeCall)}</b> — both are good options. The differences `
        + `between them are small, so your market and seed availability can decide.</div>` : ""}
    </div>`;

  /* 3-season plan */
  const planName = (s) => s.comname
    ? cap(s.comname.split(",")[0].trim())
    : (s.scientific_name || s.name);
  const planWhy = (a, i) => {
    const bits = [];
    if (a.n_fixing) bits.push("leaves nitrogen for the next crop");
    if (i === 0) bits.push("your best match");
    else bits.push("keeps the rotation healthy");
    return bits.join(", ");
  };
  $("plan").innerHTML = `
    <div class="plan-card spotlight">
      <h3>Your next three seasons</h3>
      <div class="plan-list">
      ${res.rotation_plan.map((s, i) => `
        <div class="planrow">
          <span class="plan-season" aria-label="Season ${i + 1}">${i + 1}</span>
          <span class="plan-crop">${planName(s)}</span>
          <span class="plan-why">${planWhy(s, i)}</span>
        </div>`).join("")}
      </div>
      <p class="hint quiet">Never plant the same crop family twice in a row —
      that is the main rule this plan follows.</p>
    </div>`;

  /* other good options */
  const others = res.ranking.filter((a) => a.key !== w.key).slice(0, 4);
  const OTHER_WHY = (a) => {
    const bits = [];
    const c = a.criteria;
    if (c[0] >= 0.66) bits.push("good weather fit");
    if (c[1] >= 0.66) bits.push("likes your soil");
    if (a.nir_mm > 0) {
      if (res.waterMode === "irrigate" && res.waterAvailableMM !== null) {
        bits.push(a.nir_mm <= res.waterAvailableMM
          ? `your water covers its ${litPerM2(a.nir_mm)}`
          : `needs ${litPerM2(a.nir_mm)} — more than you have`);
      } else {
        bits.push(`drinks about ${litPerM2(a.nir_mm)}`);
      }
    }
    if (a.n_fixing) bits.push("feeds the soil");
    return bits.join("; ");
  };
  $("others").innerHTML = `
    <div class="others-card">
      <h3>Other good options</h3>
      ${others.map((a) => `
        <div class="otherrow">
          <div class="top"><span class="name">${niceName(a)}</span>
            <span class="minibars" role="img" aria-label="overall: ${Math.round(a.score_saw*100)} out of 100">
              ${[0,1,2,3,4].map((b) => `<span class="bar ${a.score_saw >= (b+0.5)/5 ? barClass(a.score_saw) : ""}"></span>`).join("")}
            </span></div>
          <div class="why">${OTHER_WHY(a)}</div>
        </div>`).join("")}
      <p class="hint quiet">Bars compare overall fit, blending everything you
      told us in step 3.</p>
    </div>`;

  /* data provenance line */
  const from = res.data.climate_from, to = res.data.climate_to;
  const dataLine = `Based on ${res.data.climate_days} days of NASA satellite `
    + `weather (${fmtDate(from)} to ${fmtDate(to)}) and the SoilGrids soil map `
    + `(${res.data.soil && res.data.soil.ph ? `soil pH ${res.data.soil.ph}` : "soil map unavailable here"}).`;

  /* populate last-season select for next time */
  const sel = $("prevCrop");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Nothing / new field</option>'
    + res.ranking.map((a) => `<option value="${a.key}" ${a.key === cur ? "selected" : ""}>${niceName(a)}</option>`).join("");

  /* remember the data line inside summary */
  const dl = document.createElement("p");
  dl.className = "rec-sub quiet small";
  dl.style.marginTop = "10px";
  dl.textContent = dataLine;
  $("summary").querySelector(".rec-card").appendChild(dl);

  /* satellite greenness is loaded separately: the recommendation never
     waits for it, and it still works when the hub is offline */
  loadVegetation(res.location.lat, res.location.lon);
  if (window.LCRDA_EFFECTS) window.LCRDA_EFFECTS.afterRender();
}

/* ---------- theme (dark mode) ---------- */
$("themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("lcrda-theme", next); } catch (e) {}
  window.dispatchEvent(new Event("themechange"));
});

/* ---------- boot ---------- */
initSliders();
initPicker();
buildChips();
if (PICKER) {
  PICKER.open();
  updateLayerUI(PICKER.layer || "truecolor");
}

