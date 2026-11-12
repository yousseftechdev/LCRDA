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
function initSliders() {
  const box = $("sliders");
  PRIORITIES.forEach((p) => {
    const row = document.createElement("div");
    row.className = "sliderrow";
    row.innerHTML =
      `<div class="head"><span class="name">${p.label}</span>`
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
    const setFill = (el) =>
      el.style.setProperty("--p", (Number(el.value) - 1) / 4);
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

/* ---------- map picker & GPS ---------- */
/* renderer selection: WebGL 3D globe when available, flat map otherwise */
let PICKER = null;
function initPicker() {
  try {
    if (typeof GLOBE !== "undefined" && GLOBE.init()) {
      PICKER = GLOBE;
      document.getElementById("mapCanvas").style.display = "none";
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
  document.getElementById("layerNote").textContent = LAYERS[key].note;
}
$("btnMap").addEventListener("click", () => {
  const p = $("mapPanel");
  const opening = p.classList.contains("hidden");
  p.classList.toggle("hidden", !opening);
  if (opening) {
    buildChips();
    PICKER.open();
    updateLayerUI(PICKER.layer || MAP.layer);
    p.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else PICKER.stop();
});
$("btnUseSpot").addEventListener("click", () => {
  if (!PICKER.pin) { $("mapCoord").textContent = "Tap the map first to drop the pin."; return; }
  $("lat").value = PICKER.pin.lat.toFixed(4);
  $("lon").value = PICKER.pin.lon.toFixed(4);
  $("mapPanel").classList.add("hidden");
  PICKER.stop();
  $("mapCoord").textContent = "No spot chosen yet";
});
$("btnGPS").addEventListener("click", () => {
  if (!navigator.geolocation) {
    $("dataStatus").textContent = "This phone cannot share its location — type the numbers or pick on the map instead.";
    return;
  }
  $("dataStatus").className = "statusline";
  $("dataStatus").textContent = "Asking the phone for your location…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $("lat").value = pos.coords.latitude.toFixed(4);
      $("lon").value = pos.coords.longitude.toFixed(4);
      $("dataStatus").className = "statusline ok";
      $("dataStatus").textContent = "Field location set from your phone's GPS.";
    },
    () => {
      $("dataStatus").className = "statusline warn";
      $("dataStatus").textContent = "Could not get your location — pick it on the map instead.";
    },
    { enableHighAccuracy: true, timeout: 10000 });
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
  btn.disabled = true;
  btn.textContent = "Checking the crops…";
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
  btn.textContent = "Get my planting advice";
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
        ? `Drinks about ${litPerM2(w.nir_mm)} over the season — your supply covers it.`
        : `Drinks about ${litPerM2(w.nir_mm)} over the season — that is more than you said you have, so some watering weeks will be tight.`)
    : `In this season it would drink about ${litPerM2(w.nir_mm)} if you had to water it yourself.`;

  const whyBits = [];
  if (w.n_fixing) whyBits.push("feeds the soil with nitrogen for the next crop");
  if (w.criteria[0] >= 0.66) whyBits.push("matches this season's weather very well");
  if (w.criteria[1] >= 0.66) whyBits.push("likes your soil");
  if (w.yield_t_ha >= 5) whyBits.push("heavy expected harvest");

  $("summary").innerHTML = `
    <div class="rec-card">
      <p class="rec-kicker">Plant this next</p>
      <p class="rec-name">${niceName(w)}</p>
      <p class="rec-sub">${sow ? `Best sowing window opens around <b>${fmtDate(sow)}</b>, `
        + `and it needs about <b>${w.days_to_harvest} days</b> in the field.<br>` : ""}
      ${waterNote}<br>
      Expected harvest: about <b>${w.yield_t_ha} tons per hectare</b>
      <span class="quiet small">(a comparison between crops, not a promise)</span></p>
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
    <div class="plan-card">
      <h3>Your next three seasons</h3>
      ${res.rotation_plan.map((s, i) => `
        <div class="planrow">
          <span class="plan-season">Season ${i + 1}</span>
          <span class="plan-crop">${planName(s)}</span>
          <span class="plan-why">${planWhy(s, i)}</span>
        </div>`).join("")}
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

