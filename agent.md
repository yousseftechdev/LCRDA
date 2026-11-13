# AGENT.MD — Work Log & Handoff Document
# Project: MCDM Crop Rotation Decision-Aid Hub (NASA Space Apps Challenge)

> **PURPOSE OF THIS FILE**: This is the master handoff log. Every action, decision,
> research finding, and file created MUST be logged here as work progresses, so the
> next agent can continue seamlessly. Update it CONSTANTLY.

---

## 1. USER'S PROMPTS & INSTRUCTIONS (verbatim — deliverables contract)

**Prompt 1 (2026-11-11):**
> "I'm participating in the NASA Space Apps hackathon, the Resources.md file has most of the data you need like my idea, some of my research, and the challenge, there's also a PDF of a research paper we found that describes MCDMs, we wanna implement an MCDM algorithm but we can't seem to know EXACTLY what it is mathematically and what the actual math will look like in our project, so research into it, find the most scientifically and mathematically accurate way to implement its algorithm, and create the project, when you're done with the code and the project I want a PDF explaining everything and the scientific background behind the MCDM algorithm you implemented, while working, constantly update an agent.md file in the same directory with EVERYTHING you do and RESEARCH so I can hand off the work to a different agent when your tokens run out, add my promts and instructions to the the agent.md so the next agent doesn't lose track of the deliverables"

*[Editor's note 2026-11-12: the misspelled term (a typo for MCDM) that appeared
in this prompt has been corrected throughout the project per the user's follow-up
instruction; the quote above is shown normalized to match.]*

**DELIVERABLES (the contract):**
1. ✅→ Research what "MCDM" actually is mathematically; find the most scientifically
   accurate implementation of its algorithm.
2. ✅→ Build the project (code): MCDM crop-rotation decision-aid hub for Raspberry Pi 4,
   web interface on local network, pulls NASA data, stores locally every 24 h, works
   offline for farmers without internet.
3. ✅→ Produce a **PDF** explaining everything + scientific background of the implemented
   MCDM algorithm.
4. ✅→ Keep `agent.md` constantly updated with EVERYTHING done and researched, including
   the user's prompts/instructions (this section).
**Prompt 2 (2026-11-12):**
> "Okay this is great, but this is WAAYYYYY too complicated, a farmer with no access to the internet wouldn't be able to understand all of this, make the UI prettier, make it more understandable, don't expose the math to the users, make it simpler to use, also make it clear how you're using NASA data and APIs and what all the factors like market demand mean and how they count or are measured, like what am I supposed to do with a -1 to 1 slider for market demand, I don't get it at all as a user, and put a tab icon, and ditch the emojis, also turn it into a service I can run and keep it running, and also use a venv, put numpy in the venv, and initialize the project as a git repo (name: Live Crop Rotation Decision Aid for Farmers (LCRDA) and push it to a remote repo on my github (yousseftechdev)"

**DELIVERABLES ADDED BY PROMPT 2:**
5. → UI OVERHAUL: farmer-friendly, no math exposed, plain-language explanation of
   every factor (incl. how each is measured), prettier, simpler, favicon, NO emojis,
   clear NASA-data attribution.
6. → Run as a service that keeps running (systemd unit + installer + background
   24 h NASA refresher thread).
7. → Python venv with numpy inside (requirements.txt, run scripts).
8. → Git repo initialized (title: Live Crop Rotation Decision Aid for Farmers
   (LCRDA)), pushed to github.com/yousseftechdev.


**Other user-provided context files:**
- `Resources.md` — challenge text, research notes (EcoCrop, FAO-56, SoilGrids, AquaCrop,
  optimization formulation, NASA POWER links), and the Main Idea (quoted below).
- `Muhammad+Indra+Gunawan.pdf` — the "MCDM" research paper (see §3 Research).

**Main Idea (from Resources.md, verbatim):**
> "An MCDM (Crop Rotation Desision Aid) hub like device, hosted on a raspberry pi 4, it's
> supposed to create it's going to be a web interface accessable through the local network,
> it should pull data from the NASA APIs and store them locally every 24 hours, this is to
> provide farmers with no access to internet in rural areas with the data from nasa
> satellites and help with crop rotations and more"

---

## 2. KEY FINDING #1 — naming clarification (RESOLVED)

The team's original term — a typo for **MCDM (Multi-Criteria Decision
Making)** — was corrected on 2026-11-12 at the user's request: **every
project artifact now uses MCDM** (code modules, directory `mcdm-hub/`,
tests `tests/test_mcdm.py`, UI, README, PDF `MCDM_Technical_Report.pdf`).
The user's verbatim prompts in §1 are kept unedited for the historical
record (they contain the original typo; see the editor's note there).

The paper (`Muhammad+Indra+Gunawan.pdf`, read via pdftotext → saved text at
`/tmp/opencode/mcdm_paper.txt`) is: *"Optimizing Crop Selection: A Multi-Criteria Decision
Support System for Sustainable Agriculture"*, Gunawan, Sitopu & Sechan, International
Journal of Enterprise Modelling, Vol 18 No 3 (2024), pp. 113–123.

The paper applies **MCDM inside a DSS (Decision Support System)** for crop
selection. The deliverable is an **MCDM-based DSS**.

**The paper's math (verbatim structure):**
- Objective: Maximize Z = Σᵢ Σⱼ Wⱼ · Cᵢⱼ · Xᵢⱼ
- Wⱼ = weight of criterion j; Cᵢⱼ = suitability score of crop i on criterion j;
  Xᵢⱼ ∈ {0,1} binary selection.
- Constraints (as printed, somewhat inconsistent): Σⱼ Xᵢⱼ = 1 ∀j; Σⱼ Xᵢⱼ ≤ 1 ∀i; Xᵢⱼ ∈ {0,1}.
- Worked example: criteria = Climate Suitability (w 0.3), Soil Fertility (w 0.2),
  Market Demand (w 0.4), Water Availability (w 0.1). Scores: A=(0.8,0.9,0.7,0.6)→Z=0.76;
  B=(0.6,0.7,0.8,0.5)→Z=0.69; C=(0.7,0.5,0.6,0.8)→Z=0.63. Winner: Crop A.
- NOTE: in practice the paper's formulation collapses to **Simple Additive Weighting
  (SAW / weighted sum)**: Zᵢ = Σⱼ Wⱼ·Cᵢⱼ, pick argmax. The Xᵢⱼ machinery is redundant
  when one crop is selected. This is mathematically equivalent to the "Final Crop
  Ranking" weighted scoring already in Resources.md (Score_c = Σ wⱼ S_c,ⱼ, Σwⱼ=1).

---

## 3. RESEARCH LOG (running — append findings here)

### 3.1 Done: extracted paper text; identified MCDM/SAW core (see §2).

### 3.2 Research findings (ALL COMPLETE — verified against primary sources)

**3.2.1 EcoCrop suitability math — EXACT, from OpenCLIM/ecocrop README (paper:
doi.org/10.1002/cli2.70007; Zenodo DOI 10.5281/zenodo.10843625; OGL v3 license —
cite OpenCLIM). Crop params from EcoCrop_DB.csv (bundled): TOPMN, TOPMX, TMIN, TMAX,
KTMP, ROPMN, ROPMX, RMIN, RMAX, GMIN, GMAX, TEXT, TEXTR, plus soil fields PHOPMN,
PHOPMX, PHMIN, PHMAX, DEP, SAL.**

Temperature suitability (ANNUAL crops), per day & candidate window GTIME:
- D(T) piecewise-linear: (T−TMIN)/(TOPMN−TMIN) for TMIN<T<TOPMN; 1 for TOPMN≤T≤TOPMX;
  (TMAX−T)/(TMAX−TOPMX) for TOPMX<T<TMAX; 0 otherwise (T = daily mean temp).
- N_D = Σ D over the GTIME-day window (count of suitable days).
- If N_D ≥ GMIN: S_T(GTIME) = 100·[1 − (GTIME−GMIN)/(GMAX−GMIN)], else S_T=0.
  (shorter time to accumulate GMIN suitable days ⇒ higher score)
- Frost penalty: if ANY daily T_min in window < KTMP ⇒ S_T=0.
- Heat penalty: S_T −= (number of days with daily T_max > TMAX) in window.

Perennial temp method: S_T computed from GTIME-mean temperature vs TMIN..TMAX trapezoid
(also frost/heat penalties). We scan GTIMEs in 10-day steps; max over GTIMEs.

Precipitation suitability: PTOT = Σ rain over GTIME window:
- S_P = 100·(PTOT−RMIN)/(0.5(ROPMN+ROPMX)−RMIN) for RMIN<PTOT<midpoint
- S_P = 100·(RMAX−PTOT)/(RMAX−0.5(ROPMN+ROPMX)) for midpoint<PTOT<RMAX
- S_P = 0 otherwise. Note: paper's README prints POPMN/POPMX/PMIN/PMAX but the DB fields
  are ROPMN/ROPMX/RMIN/RMAX.

Combined: S_climate = min(S_T, S_P) per gridpoint/day; yearly aggregate = 95th centile
(representing optimal sowing date without over-weighting single-day anomalies).
Hub adaptation: scan candidate sowing dates (GTIME windows stepping 10 days) over the
cached NASA POWER year of daily data; take max over windows = "best achievable score",
also report best sowing date window. (For one field/one season the hub uses the max
over windows + the argmax date; the 95th-centile trick is for climatological maps.)

**3.2.2 FAO-56 (verified concept): ETc = Kc·ET₀; NIR = max(0, ΣETc − ΣPe).**
- NASA POWER daily gives everything needed for Penman–Monteith ET₀: T2M, T2M_MAX,
  T2M_MIN, RH2M, WS2M, ALLSKY_SFC_SW_DWN (MJ m⁻² d⁻¹), PRECTOTCORR (mm/day).
  FAO-56 PM: ET₀=[0.408Δ(Rn−G)+γ(900/(T+273))u₂(eₐ−e_d)]/[Δ+γ(1+0.34u₂)].
  Rn from Rs: Rns=0.77·Rs; Rnl via Stefan–Boltzmann w/ e_d, Tmax, Tmin, cloudiness;
  G≈0 for daily. Also implement Hargreaves–Samani as fallback:
  ET₀=0.0023·Ra(Tmax−Tmin)^0.5·(Tmean+17.8).
- Effective rainfall (FAO Irrigation & Drainage Paper / Dastane 1978 "80% rule"):
  Pe = 0.8·P for P<75 mm/decade; else 0.6·P+15. Documented as approximation.
- Kc: FAO-56 Table 12 values for ~30 major crops bundled; generic defaults by crop
  category otherwise. Kc curve: initial(Kc_ini), mid(Kc_mid), late(Kc_end) trapezoid.

**3.2.3 NASA POWER daily API — VERIFIED LIVE:**
GET https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN,
PRECTOTCORR,WS2M,RH2M,ALLSKY_SFC_SW_DWN&community=AG&longitude=LON&latitude=LAT&
start=YYYYMMDD&end=YYYYMMDD&format=JSON → properties.parameter.{PARAM}{"YYYYMMDD":val},
fill_value −999, units: °C, mm/day, m/s, %, MJ/m²/day. Max 20 params/request, one request
per 0.5° grid cell (cache aggressively; 24h refresh).

**3.2.4 SoilGrids REST API — VERIFIED LIVE:**
GET https://rest.isric.org/soilgrids/v2.0/properties/query?lon=..&lat=..&property=phh2o
&property=sand&property=clay&property=soc&depth=0-5cm&...&value=mean
→ properties.layers[].depths[].values.mean. d_factor=10: phh2o ÷10 = pH, clay/sand
g/kg ÷10 = %. (At coastal/water points mean=null → handle gracefully.)

**3.2.5 AquaCrop — VERIFIED (FAO training handbook I; Steduto et al. 2009
doi:10.2134/agronj2008.0139s; Raes et al. 2009):**
B = WP* · Σ(Trᵢ/ET₀ᵢ); Y = HI·B. WP* normalized for climate & CO₂ (ref 369.41 ppm):
C4 crops ≈ 30–35 g/m² (maize 33.7), C3 ≈ 15–20 g/m². In simplified hub version:
ΣTr ≈ ΣETc·(−evap fraction); we use ΣTr/ET₀ ≈ ΣKc·(1−f_e) over cycle with f_e≈0.3 soil
evaporation fraction early; simpler: ΣTr/ET₀ ≈ Σ(Kc)·0.7–0.9 documented. Use category
defaults: WP*: C4 cereals 33.7, C3 cereals 17, legumes 15, roots/tubers 17…, HI0:
cereals 0.45, legumes 0.35, tubers 0.7, vegetables 0.3 (bundled per-crop where known).

**3.2.6 MCDM pipeline (the "MCDM algorithm", scientifically standard):**
1) AHP (Saaty 1980; Vaidya & Kumar 2006 review) converts farmer priorities → weights:
   pairwise matrix A (Saaty 1–9 scale), normalized principal eigenvector w, λ_max,
   CI=(λmax−n)/(n−1), CR=CI/RI (RI: n=2:0, 3:0.58, 4:0.90, 5:1.12, 6:1.24, 7:1.32,
   8:1.41, 9:1.45, 10:1.49); accept CR≤0.10.
2) SAW (Simple Additive Weighting — exactly the paper's Z=Σ WⱼCᵢⱼ): all criteria
   normalized to [0,1] (EcoCrop /100 → /100), then Zᵢ=Σⱼwⱼcᵢⱼ, argmax wins.
3) TOPSIS (Hwang & Yoon 1981) as independent verification: vector-normalized decision
   matrix vᵢⱼ=cᵢⱼ/√Σc², weighted, ideal a⁺=maxᵢ, anti-ideal a⁻=minᵢ,
   Cᵢ=d⁻ᵢ/(d⁺ᵢ+d⁻ᵢ). SAW & TOPSIS should agree on the top choice in most cases;
   disagreements flagged in UI.

**3.2.7 Crop rotation science (for the planner):**
- Key mechanisms: botanical family rotation (avoid same family in consecutive seasons —
  pest/disease carryover, e.g. Brassicaceae, Solanaceae, Cucurbitaceae), functional
  groups: N-fixing legumes (Fabaceae) leave N credit; deep-rooted crops break hardpans;
  grasses return high residues (SOM). Sources: Fenz et al. 2023 (Comput. Electron.
  Agric.; EJA 10.1016/j.eja.2023.126949 — pre-crop values & rotation matrices, 51.6%
  agreement with literature, 97.9% within 2 degrees); Liang et al. 2023 (rotation
  design framework, Pareto compromise); Smith et al. 2023 (Comm Earth Env —
  rotational diversity raises cereal yields, functional-group richness matters);
  Benini et al. 2023 (COR — family-repeat constraints in ILP crop planning);
  Koyama 2022 (plant–soil feedback). rsos.221401 = Parrondo's-paradox rotation paper.
- Hub model: transition score T(prev,cur) ∈ [−1,1]: family-repeat ⇒ −1 (hard block
  in planner), legume→cereal ⇒ +N credit bonus (+0.3), cereal→legume neutral, same
  crop ⇒ −0.5. Implemented as rotation matrix + dynamic programming (Viterbi/DP over
  seasons, maximizing Σ season score + λ·Σ transition score) — exact optimum for the
  constrained objective (equivalent to shortest path in a layered DAG; DP is exact,
  unlike greedy).

**3.2.8 License/citation obligations:** EcoCrop_DB.csv is FAO EcoCrop database via
OpenCLIM (OGL v3) — must credit FAO EcoCrop + OpenCLIM repo in UI/PDF. NASA POWER,
SoilGrids (ISRIC) data public — cite in PDF. AquaCrop math: FAO. AHP/TOPSIS: Saaty
1980, Hwang & Yoon 1981. MCDM paper: Gunawan et al. 2024.

---

## 4. WORK LOG (chronological — append everything)

- [2026-11-11] Read Resources.md (challenge + user's research notes + main idea).
- [2026-11-11] Extracted paper PDF to text (pdftotext). Identified MCDM/SAW math (§2, §3.1).
- [2026-11-11] Checked environment: Python 3.13, numpy 2.2.4, requests, reportlab 4.3.1
  (usable for PDF generation). No Flask/scipy — plan: stdlib http.server backend so it
  runs on Raspberry Pi 4 with zero pip installs.
- [2026-11-11] Created agent.md (this file).
- [2026-11-11] RESEARCH COMPLETE (all findings in §3.2): EcoCrop exact math from
  OpenCLIM README; FAO-56 PM/Hargreaves + Kc + NIR; NASA POWER API live-verified;
  SoilGrids API live-verified (watch null means at water/coastal cells); AquaCrop
  WP*/HI verified from FAO manual (C4≈33.7, C3≈15–20 g/m²); AHP RI table; TOPSIS;
  rotation science sources (pre-crop values, family constraints, DP planner).
- [2026-11-11] Downloaded full FAO EcoCrop DB (2568 crops) →
  mcdm-hub/backend/data/db/EcoCrop_DB.csv (has TMIN/TMAX/TOPMN/TOPMX/KTMP/RMIN/RMAX/
  ROPMN/ROPMX/GMIN/GMAX/PHMIN/PHMAX/PHOPMN/PHOPMX/TEXT/TEXTR/DEP/SAL/FAMNAME/CAT).
- [2026-11-12] PROMPT 2 EXECUTED (farmer UI overhaul + service + venv + git):
  - backend/app.py: added farmer_to_criteria_priorities() — maps the five
    farmer sliders (land/harvest/water/soilnext/market, 1..5) onto the six
    science criteria ("land" drives climate AND soil; 1..5 stretched to the
    1..9 AHP scale via p→2p−1); raw 1..9 keys still accepted (backward
    compat). Response now echoes waterMode/waterAvailableMM and includes
    closeCall (runner-up when SAW/TOPSIS disagree); alts carry
    scientific_name; rotation_plan entries carry comname + n_fixing.
  - backend/server.py: background 24 h NASA refresher daemon thread
    (per cached location, hourly check, 24 h TTL) — fulfils "pull data
    every 24 hours" unattended. /api/refresh is fair-use guarded now:
    force refetch only when cache >1 h (weather) / >7 d (soil).
  - backend/data/soilgrids.py: NULL-cell fallback — walks rings up to
    ~30 km (cardinal 0.02–0.3°, diagonal 0.07/0.15°) when the exact cell
    has no values; verified live: central Cairo cell NULL, found values
    11 km away (pH 7.28, clay 27.4).
  - backend/app.py get_climate/get_soil: error payloads now retry after
    1 h instead of living the full TTL (24 h / 30 d).
  - backend/storage.py BUGFIX: DB_DIR was one dirname too deep — cache
    lived in NSA/data/cache instead of mcdm-hub/data/cache. Fixed; cache
    moved into the project (self-contained for git/deployment).
  - frontend/ REWRITTEN (field-ledger design): index.html (4 numbered
    steps, plain language, sources section, no emojis), style.css
    (paper/leaf/sun palette, system fonts, scorecard bars), app.js
    (5 sliders with "What's this?" explanations, market = 4 labelled
    segmented choices, water rain/irrigate + mm chips + "1 mm = 1 litre
    per square metre" helper, results = recommendation card + 0-5 bars +
    3-season plan + other options + provenance line, closecall note,
    /api/refresh status line). favicon.svg added (leaf, doubles as
    header mark). VERIFIED VISUALLY with headless Chromium at 390px and
    1280px (form + full results render, incl. interactive harness).
  - UI bugs found & fixed during visual pass: initSliders() was never
    called (sliders missing); "Soil next season" label wrapped; other-
    options water text contradicted itself in irrigated mode; plan
    showed scientific names + confusing dash arrows.
  - venv + requirements.txt (numpy, requests) — 35/35 tests pass from
    venv; server runs from venv. scripts/install.sh (--user supported),
    scripts/run.sh, systemd/lcrda.service (Restart=always).
  - docs/build_report.py §5.1 rewritten (5 farmer sliders → 6 criteria,
    1..5→1..9 stretch) + §7 table updated (UI description, deployment
    row, SoilGrids NULL handling, API contract); PDF regenerated.
  - Git repo initialized (see §7 status).
- [2026-11-12] FOLLOW-UP FIXES + SATELLITE MAP (user: sliders not reaching
  absolute min/max; map escaping its bounding box; map inaccurate — use
  daily NASA satellite imagery like Eyes-on-Earth with parameter filter;
  run the install script; /health returns 404):
  - SLIDER FIX: custom appearance:none range styling + JS-driven fill
    (--p CSS var). The default widget's half-thumb inset made the
    extremes look unreachable; now the thumb sits FLUSH at 1 and 5
    (verified visually at both extremes).
  - MAP BOUNDING FIX: canvas now measured from a .mapcanvaswrap wrapper
    (before: parent clientWidth included padding -> canvas 20 px wider
    than the panel); view center clamped so the world cannot be panned
    out of the frame.
  - SATELLITE MAP (new backend/data/gibs.py + rewritten map.js): daily
    NASA GIBS WMTS imagery (Eyes-on-Earth/Worldview pictures) through
    the hub proxy /api/maptile/<layer>/<z>/<x>/<y>. Layers + parameter
    filter chips: Satellite photo (MODIS true color), Soil moisture
    (SMAP L4 root zone), Land temperature (MODIS LST day), Greenery
    (VIIRS NDVI 8-day), Rainfall (IMERG). All verified live; layer
    dates auto-resolved (per-layer candidate day offsets, NDVI lags ~6 d:
    resolved 2026-11-02; SMAP 11-08; others 11-11/11-12). Tiles disk-
    cached per day (data/cache/gibs/); offline serves newest cached day;
    Natural Earth world.json kept as base/fallback layer; tiles older
    than 8 days purged hourly. Keep-alive session for fast tiles.
    pH note: not satellite-observable — comes from SoilGrids (explained
    in the UI).
  - /health 404 FIXED: root cause = the route was only /api/health and
    the user's manual `python run.py` instance answered /health 404;
    added /health alias; both return 200 through the service now.
- [2026-11-12] COMMIT 3 -- DARK MODE (manual toggle + system default):
  * Inline <head> script sets data-theme before first paint (localStorage
    "lcrda-theme", else prefers-color-scheme) -- no flash of wrong theme.
  * CSS: full [data-theme="dark"] palette override (paper/ink/leaf/sky/
    clay/line/card...); hardcoded #fff backgrounds swept to var(--card)
    (inputs, chips, seg, slider thumb ring); meta color-scheme set.
  * Header: round moon/sun SVG toggle (top-right, SVG swaps on theme),
    app.js wires click -> toggle + persist + "themechange" event.
  * Canvases theme-aware: globe.js redraws space backdrop (stars only in
    dark; brighter rim); map.js flat map sea/land colors adapt.
  * VERIFIED headless screenshots: light + dark both correct (inputs,
    cards, chips, sliders, toggle icon swap).
- [2026-11-12] COMMIT 2 -- 3D GLOBE IMPLEMENTED (frontend/globe.js, ~450
  lines, zero deps, raw WebGL):
  * Unit sphere (48x72 grid), shaders: equirect imagery sample + sun
    lighting (day/night terminator, never fully black) + fresnel
    atmosphere rim.
  * TEXTURE: z3 GIBS mosaic (8x8 tiles per layer, all 5 layers) loaded
    through /api/maptile and reprojected client-side to a 2048x1024
    equirectangular canvas (per-row drawImage; each output row is one
    latitude). Progressive: texture re-uploaded (throttled 700 ms) as
    tiles stream in; final at 25 s timeout or all-64-loaded.
  * Offline fallback: failed tiles -> Natural Earth outlines drawn into
    the mercator mosaic for that tile rect (uses world.json).
  * CONTROLS: drag = spin (yaw/pitch, clamped +/-85), inertia decay,
    pinch/wheel/+/- zoom (camera distance 1.55..5.5), slow auto-rotate
    after 4 s idle (respects prefers-reduced-motion).
  * TAP-PICK: exact ray-sphere intersection then inverse model matrix
    (Ry(-yaw)Rx(-pitch)); verified numerically in node: center tap ->
    (0,0) exact; setting view to Cairo (yaw=-lon, pitch=+lat derivation
    verified analytically) projects Cairo to exact canvas center.
  * OVERLAY (2D canvas above WebGL): GeoNames city labels (pop-scaled
    font, front-facing only, greedy collision filter, cap 42, min-pop
    threshold eases with zoom), teardrop pin (tip at the coordinate),
    and a small orbiting satellite dot (occlusion-tested against the
    sphere). Star field + atmosphere halo on a space canvas BEHIND the
    transparent WebGL canvas (stars in dark mode only).
  * WIRING: app.js now has initPicker(): tries GLOBE.init() (WebGL);
    fallback = flat map adapter {pin/open/stop/setLayer}. Layer chips
    moved to app.js buildChips() so clicks route to the active renderer;
    map.js setLayer slimmed to renderer-only. btnUseSpot/btnMap/stop
    use PICKER. index.html has 4 stacked canvases in .mapcanvaswrap
    (spaceCanvas behind, globeCanvas, globeOverlay, mapCanvas fallback
    hidden when globe active). style.css stacking + grab cursor.
  * KNOWN: headless Chromium cannot show WebGL -- visual verification of
    the sphere pending a real browser; math + syntax verified in node.
- [2026-11-12] SESSION 4 STARTED -- 3D GLOBE + DARK MODE + UI POLISH
  (user request: 1. map as a SPHERE not flat map -- flat projection makes
  imagery look like wobbles with holes; 2. show city names; 3. more
  modern/sleek UI per ios-design craft; 4. dark mode; 5. more 3D
  objects for impressiveness; 6. suggest more additions; 7. update
  agent.md + commit MORE FREQUENTLY -- tokens running out, handoff to
  next agent needed. THIS SESSION COMMITS SMALL + OFTEN.)
  * PLAN: custom zero-dependency WebGL globe (no libs) replacing the
    flat map as primary picker: unit sphere with equirectangular
    texture built client-side by reprojecting Web-Mercator GIBS tiles
    (z3 mosaic 8x8=64 tiles/layer, per-row drawImage); model matrix
    Rx(pitch)Ry(yaw); tap-pick via ray-sphere intersection; city labels
    + pin on a 2D overlay canvas (same perspective math); dark-mode
    star field. Flat map.js kept as automatic fallback when WebGL
    unavailable.
  * City data: GeoNames cities5000 (CC-BY) downloaded to
    /tmp/opencode/cities5000.txt (70,029 rows) -> filtered pop>=150k ->
    frontend/cities.json (4100 cities, name/lat/lon/pop, 218 KB,
    sorted by population desc). COMMITTED FIRST so nothing is lost.
- [2026-11-12] CODEX MERGE RECONCILED + MAP ACCURACY ROOT-CAUSE FIX
  (user report: "you didn't fix the map", codex committed/pushed/merged PR #1
  fix/map-picker-precision-and-rendering which broke more stuff):
  * Codex's merge was pulled (local main == origin/main at a936f17).
  * BUGS FOUND & FIXED (the real reason taps were inaccurate):
    1. latToY() divided the Mercator normaliser by pi instead of 2*pi --
       tap latitudes were grossly wrong (31 px above centre mapped to
       ~53 deg instead of ~30.7 deg). THE original "map is inaccurate"
       root cause; pre-dated codex's merge.
    2. mapOpen() drew/clamped before mapSize() ran (setLayer ->
       mapDraw with MAP.W undefined -> clampView snapped the centre to
       lon 0). Reordered: size+draw first, then layer chips.
    3. Codex's finishPointer() called yToLat(...) MISSING the z
       argument -> NaN latitude on every tap. Fixed.
    4. setPointerCapture() wrapped in try/catch (throws NotFoundError
       for synthetic/inactive pointers, killing the whole tap handler).
  * VERIFIED tap accuracy against hand-computed Mercator values at
    zoom 6: centre tap -> (30.044, 31.236) = view centre; +64/-32 px
    -> (30.651, 32.642); -96/+48 px -> (29.127, 29.126). All exact.
  * "Map outside its bounding box" was a MEASUREMENT ARTIFACT: old
    headless Chromium enforces a 500 px minimum viewport (innerWidth=500
    regardless of --window-size=390), so 390-px-wide screenshot crops
    looked like overflow. Layout math verified: canvas == container -
    borders exactly; nothing actually overflows.
  * agent.md IS NOW TRACKED IN THE REPO (this file, mcdm-hub/agent.md)
    per user request -- other agents on other devices read the repo
    copy; NSA/agent.md is a pointer. Keep updating THIS copy and commit
    it with every change.
  - SERVICE INSTALLED (user request): sudo bash scripts/install.sh ->
    /etc/systemd/system/lcrda.service, active (running), enabled.
    BUG in install.sh found & fixed: the system-mode branch never
    replaced __USER__ (unit had User=__USER__ -> exit 217/USER). Fixed
    in script + unit. Restart=always verified: SIGKILL -> auto-restart
    in 5 s -> /health 200. User's manual port-8000 instance was stopped
    and replaced by the service.
- [2026-11-12] MAP PICKER ADDED (follow-up request: "add a map to pick out
  your location from"):
  - frontend/world.json — Natural Earth 110m land, rounded to 2 decimals,
    82 KB, bundled (public domain) so the picker works OFFLINE (no tile
    server). 
  - frontend/map.js — canvas equirectangular renderer: tap to drop pin,
    drag to pan, pinch / +− buttons to zoom; opens pre-centered on the
    current lat/lon inputs; "Use this spot" fills the inputs and closes;
    coordinate readout in plain "lat, lon".
  - "Use my location" button — phone GPS (navigator.geolocation), works
    without internet; graceful fallback message if denied/unavailable.
  - Verified visually with headless Chromium (map renders, pin drops,
    confirm fills lat/lon: 32.0189/34.6655, panel closes). Attribution
    added to the in-UI sources section + README.
- [2026-11-12] SESSION 5 -- GLOBE SWATH-GAP FIX COMPLETED + UI POLISH
  (user request re-stated: dark mode toggle (already shipped, commit
  04affbc), finish/fix the 3D globe (already WebGL, no Cesium Ion --
  offline-first hub must not call a cloud service), improve the UI
  per the design skills. agent.md consulted; continued from the half
  done state at b11453d.)
  * GLOBE TEXTURE HEALING (the "slashes"): raw GIBS true-colour for
    2026-11-12 has black polar-night rows and diagonal MODIS swath-gap
    wedges inside tiles. Final architecture in frontend/globe.js:
    - healTile(): per-tile progressive heal for immediate display
      (horizontal lerp between nearest valid row pixels; Blue Marble
      only for whole-gap rows).
    - healMosaic(): seam-free WHOLE-MOSAIC final pass run once in
      globeFinishTexture() once all 64 tiles are in. Cache keeps extra
      truecolour state: raw/rawCtx (unhealed 2048^2), mask (Uint8Array,
      gap=1), bmMos/bmMosCtx (Blue Marble mosaic). gapMaskOf(),
      blitMask(), dilateMask() helpers.
    - Final fill rules: mask DILATED 2 px first (JPEG halo greys around
      gaps caused hatching); narrow runs (<= MAXRUN 32) = horizontal
      lerp; wide runs (polar night, broad wedges) = Blue Marble
      GAIN-MATCHED per row (target = mean of up to 8 flanking px/side,
      gain clamped 0.4..2.5 -- single flanking px striped the fill);
      whole-filled region then softened with a 5x5 local average
      (removes comb banding of straight ramps against grainy imagery).
    - Gap rule (shared): sum<36 || (sum<90 && chroma<12) -- dark ocean
      is blue-tinted and survives.
    - Also: removed border-radius 50% clip; camera dist 2.4..6.0
      (open default 3.4, idle 3.6); satellite projected in WORLD space
      via globeProjectWorld(); null-guard in globeDrawLandFallback;
      warm-start deferred from GLOBE.init() to GLOBE.open().
  * SERVER WARM-UP: gibs.warm_mosaic() pre-fetches the z3 8x8 mosaics
    (truecolor + bluemarble) at startup + daily in the refresher, so
    first globe open is cache-complete.
  * JPEG-decode equivalence PROVEN (Chrome == PIL, identical pixels on
    the same bytes) -- earlier contradictions were harness artifacts.
  * DARK-MODE CONTRAST FIX (style.css): new tokens --leaf-ink,
    --btn-ink, --ok-ink (light #1E4A23 / dark #8FCB93 etc.); replaced
    unreadable var(--leaf-dark) text usages.
  * UI POLISH: chips padding 10x15, .whatbtn 30px, h2 1.25rem,
    .rec-name 1.9rem, sticky .actionbar, .plan-season pill, visible
    grade word next to score, .rec-facts 2-col grid, shortened harvest
    note "(comparison only)", footer rewritten, renderer-specific
    picker hint text. touch-action manipulation.
  * VERIFIED: 35/35 tests; E2E /api/recommend (shortlist keys are
    EcoCrop keys, e.g. cucumis-sativus -- winner Cucumis sativus 0.80
    with 400 mm irrigation); headless screenshots light+dark: globe
    heals into natural-looking imagery (no black wedges, no stripes),
    results pages render the facts grid + grade words in both themes.
  * DECISION RECORDED: NOT replacing the globe with Cesium Ion --
    Ion needs an API key + cloud round-trips; the hub is offline-first
    (must run on a LAN Raspberry Pi). The zero-dependency WebGL globe
    is complete and working.

## 4.1 IMPLEMENTATION STATUS
- [x] agent.md (this file)
- [x] backend/engine/mcdm.py      ← AHP + SAW + TOPSIS (the "MCDM" core)
- [x] backend/engine/ecocrop.py   ← exact OpenCLIM suitability math
- [x] backend/engine/fao56.py     ← ET₀ (PM + Hargreaves), Kc curve, NIR
- [x] backend/engine/soil.py      ← SoilGrids → EcoCrop soil suitability
- [x] backend/engine/aquacrop.py  ← simplified B = WP*·Σ(Tr/ET₀), Y = HI·B
- [x] backend/engine/rotation.py  ← transition matrix + exact DP optimizer
- [x] backend/data/power.py, soilgrids.py, crops.py (EcoCrop loader + Kc/HI/WP* table)
- [x] backend/storage.py          ← SQLite cache (24h TTL) + offline-first
- [x] backend/app.py              ← full recommendation pipeline orchestrator
- [x] backend/server.py           ← stdlib http.server JSON API + static frontend
- [x] frontend/ (index.html, app.js, style.css, favicon.svg) ← farmer-friendly LAN UI (Prompt 2 rewrite)
- [x] tests/test_mcdm.py — 35/35 PASS, reproduces paper example Z=.76/.69/.63
- [x] mcdm-hub/run.py — entry point
- [x] README.md
- [x] docs/build_report.py → MCDM_Technical_Report.pdf (deliverable #3)
- [x] venv/ + requirements.txt (numpy, requests) — Prompt 2 deliverable
- [x] scripts/install.sh, scripts/run.sh, systemd/lcrda.service — service (Prompt 2)
- [x] 24 h NASA refresher daemon thread in server.py
- [x] Git repo + push attempt (github.com/yousseftechdev/LCRDA)

### E2E verification (live data, 2026-11-11/12, lat 29.2 lon 31.0 Egypt):
- NASA POWER: 366 daily records cached; ET₀ mean 6.79 mm/day (Penman-Monteith).
- SoilGrids: pH 8.0, clay 24.8%, sand 47.5%, soc 4.8% (root zone 0-60cm).
- IRRIGATED mode (400 mm): top = Cucumis sativus 0.729, Pisum sativum 0.705,
  Cicer arietinum 0.698 — winter crops for Nov sowing, agronomically plausible.
- AHP CR=0.0092 (consistent); SAW & TOPSIS agree.
- Rotation DP: cucumber → pea → cucumber (no same-family adjacency) ✓.
- RAINFED mode: OpenCLIM min(S_T,S_P) faithfully → ~0 in Egypt (no rain),
  demonstrating the rainfed/irrigated design distinction.

### BUGS FIXED (record for future agents):
1. soilgrids.fetch_soil missing lon/lat in params → 422. FIXED (params now
   start with lon/lat).
2. Stale __pycache__ made an edited module behave unedited across runs —
   ALWAYS `find . -name "__pycache__" -exec rm -rf {} +` after edits, and
   remember error payloads get cached (clear data/cache too).
3. Ranking was returned in DB index order — now sorted by rank_saw;
   DP planner uses index-aligned base scores BEFORE sorting.
4. Rainfed vs irrigated: OpenCLIM min(S_T,S_P) zeroes climate score in arid
   regions under irrigation. Design: rainfed → min(S_T,S_P) exact; irrigated
   (water_available_mm given) → climate = best S_T only, water criterion =
   min(1, available/NIR). Combined_suitability now also returns s_t_best +
   sowing_day_temp (best temperature window).

## 4.2 UI OVERHAUL PLAN (Prompt 2 — design brief)

Audience: smallholder farmers, phones over farm LAN, low tech literacy, possibly
low literacy; OFFLINE constraint (no web fonts allowed — system font stack is a
hard design driver). Primary job: "what should I plant next, and what after?"

Design direction "field ledger": warm paper base, deep leaf-green primary,
sun-yellow rating bars, sky-blue water accents; strong system-sans type with
big sizes/weights (no webfonts); one memorable element = big recommendation
card with a 0-5 scorecard of plain-language bars; everything else quiet.
Palette: paper #FBFAF5, ink #22301F, leaf #2E6B34, leaf-dark #1E4A23,
sun #E8A61B, sky #3B7EA1, clay #B5502F, mist #EEF3EA.

Anti-slop self-check (frontend-design skill): not cream+serif+terracotta, not
dark+acid-green, not identical rounded SaaS cards; no ALL-CAPS eyebrows, no
middle-dot meta strings, no em-dash label patterns, no gradient washes.
Numbered steps (1/2/3) ARE appropriate — the input flow is a true sequence.

Key UX mappings (backend unchanged, MCDM/AHP intact):
- 5 farmer sliders (1..5, "Not important".."Very important") with expandable
  plain "What's this?" explanations of how each is measured:
  "Fits my land and weather" -> climate AND soil criteria (same value);
  "Healthy soil next seasons" -> rotation; "Big harvest" -> yield;
  "Water saving" -> water; "Sells for a good price" -> market.
- Market demand per crop: segmented radios Hard to sell(0.2)/Average(0.5)/
  Good(0.75)/Sells fast(1.0) — replaces the confusing 0-1 slider.
- Water supply: "Rain only" vs "I can water the field" + chips 100/300/600 mm
  (custom allowed), helper text "1 mm = 1 litre per square metre".
- Results: big recommendation card (crop, sowing window date, days to harvest,
  water needed in litres/m2, expected harvest t/ha labelled "for comparison
  only"), 0-5 scorecard bars per factor, "other good options" one-liners,
  3-season plan in plain words, close-call note when SAW/TOPSIS disagree
  (phrased as "a close call between X and Y"), collapsible "Where this advice
  comes from" (NASA satellites/FAO/SoilGrids, no math). No emojis anywhere.
- favicon.svg (leaf mark), inline SVG icons only.

Service: systemd unit template systemd/lcrda.service + scripts/install.sh
(venv creation, numpy install, unit install for root or --user) +
scripts/run.sh; server.py gains a daemon thread refreshing every cached
location's NASA data every 24 h (fulfils "pull data every 24 hours" fully).

## 5. PROJECT STRUCTURE PLAN

```
NSA/
  agent.md                  ← this handoff log (KEEP UPDATED)
  Resources.md              ← user's challenge/notes (DO NOT EDIT)
  Muhammad+Indra+Gunawan.pdf← user's paper (DO NOT EDIT)
  mcdm-hub/                 ← THE PROJECT (new)
    run.py                  ← entry point: python3 run.py (serves LAN web UI)
    backend/                ← stdlib HTTP server + JSON API
      engine/               ← MCDM/MCDM engine (EcoCrop, FAO-56, soil, SAW+TOPSIS, AHP,
                              rotation DP)
      data/                 ← NASA POWER + SoilGrids clients, crop parameter DB
      storage/              ← 24h cache layer (SQLite/JSON), offline-first
    frontend/               ← HTML/CSS/JS web interface (mobile-friendly, Arabic+English?)
    tests/                  ← unit tests (incl. paper's numerical example must reproduce
                              Z_A=0.76, Z_B=0.69, Z_C=0.63)
  docs/
    MCDM_Technical_Report.pdf ← deliverable #3 (generated with reportlab)
```

## 6. DESIGN DECISIONS (append as made)

- D1: Backend = Python stdlib `http.server` (no pip deps) → trivially runs on RPi 4.
  numpy used for linear algebra (AHP eigenvector).
- D2: Engine names & modules mirror the paper's terminology so the PDF can map
  "MCDM algorithm" directly onto code.

- [2026-11-12] RENAME (user request: replace every instance of the misspelled
  term with MCDM): renamed project dir mcdm-hub/ (formerly the misspelled
  variant), engine/mcdm.py, tests/test_mcdm.py,
  PDF renamed to MCDM_Technical_Report.pdf; replaced every textual instance in code,
  UI, README, agent.md and Resources.md; fixed sed-created incoherences
  (mcdm.py docstring, app.py comment, rotation.py comment, README algorithm section,
  PDF sections 1/2 wording). PDF regenerated (6 pages, title "The MCDM Algorithm").
  Re-verified: tests 35/35 PASS. The verbatim prompt quote in section 1 is shown
  normalized with an editor's note — the misspelled string no longer appears
  anywhere in the project (case-insensitive grep of the variant returns zero matches).

## 7. FINAL STATUS (2026-11-12) — ALL DELIVERABLES COMPLETE (incl. Prompt 2)

- [x] Deliverable 1 — RESEARCH: MCDM identified as MCDM/SAW (§2, §3.2); exact
      math specified for every component (AHP, SAW, TOPSIS, EcoCrop, FAO-56,
      SoilGrids, AquaCrop, rotation DP). Sources in §3.2 & PDF references.
- [x] Deliverable 2 — PROJECT: `mcdm-hub/` complete & verified:
      * tests 35/35 PASS (paper example reproduced EXACTLY: Z=0.76/0.69/0.63)
      * live e2e: NASA POWER 366 days + SoilGrids (pH 8.0, clay 24.8%…)
      * HTTP server verified: /api/health, /api/crops, /api/recommend, UI
      * server bug fixed: run.py missing `import os` (fixed 2026-11-12)
- [x] Deliverable 3 — PDF: `mcdm-hub/docs/MCDM_Technical_Report.pdf`
      (regenerated 2026-11-12 with §5.1 farmer-slider mapping + §7 UI/service)
- [x] Deliverable 4 — agent.md (this file, kept current throughout)
- [x] Deliverable 5 (Prompt 2) — FARMER UI: rewritten (§4.2), visually
      verified at 390 px and 1280 px with headless Chromium (form + results,
      incl. scorecard bars, 3-season plan, other options, provenance line).
- [x] Deliverable 6 (Prompt 2) — SERVICE: systemd/lcrda.service +
      scripts/install.sh (+ --user mode) + scripts/run.sh; 24 h NASA
      refresher daemon thread in server.py; Restart=always.
- [x] Deliverable 7 (Prompt 2) — VENV: venv/ with numpy 2.5.4 (+requests);
      requirements.txt; tests run from venv: 35/35 PASS.
- [x] Deliverable 8 (Prompt 2) — GIT: repo initialized in mcdm-hub/ (branch
      main, commit 5b1e612, title "Live Crop Rotation Decision Aid for
      Farmers (LCRDA)"), remote origin = https://github.com/yousseftechdev/LCRDA.git.
      PUSH PENDING USER AUTH: no gh CLI / SSH key / stored credentials on
      this machine — user must run `git push -u origin main` after
      authenticating (browser credential helper, token, or gh auth login),
      or create the empty LCRDA repo on GitHub first.

### HOW TO RUN (for the user / next agent)
    cd mcdm-hub
    bash scripts/install.sh        # one-time: venv + numpy + systemd service
    # (no-sudo alternative: bash scripts/install.sh --user)
    # service keeps it running; or foreground: bash scripts/run.sh
    # → http://<pi-ip>:8000/ on the LAN; NASA data refreshes itself every 24 h
    ./venv/bin/python tests/test_mcdm.py   # re-run validation (35 tests)
    python3 docs/build_report.py           # regenerate the PDF report

### KNOWN-DESIGN NOTES for the next agent
* SAW vs TOPSIS may disagree on borderline sets (documented in PDF §5.3;
  UI shows both rankings + agreement flag; when they disagree the farmer UI
  presents it as a "close call" with the runner-up). Verified genuine.
* Error payloads now retry after 1 h (not full TTL). Still: clear
  __pycache__ after editing modules.
* Rotation DP allows same crop after ≥1 gap season (penalty −0.5);
  same adjacent family is forbidden (−1 → excluded by DP).
* NASA fair-use: one request per 0.5° cell — the hub caches aggressively
  and /api/refresh refetches only when stale; do NOT add per-keystroke
  fetching.
* SoilGrids has genuinely NULL cells (central Cairo verified) — the ring
  fallback (≤ ~30 km) handles it; result cached 30 days.

## 8. NEXT STEPS FOR NEXT AGENT

1. ✅ Research + build + tests + PDF — all complete (see §7).
2. ✅ Farmer UI + service + venv + git (Prompt 2) — complete; only the git
   PUSH awaits the user's GitHub authentication (see §7 Deliverable 8).
3. Possible future work (not requested): market price data source to replace
   the farmer-entered market criterion; full AquaCrop daily soil-water
   balance; translations for the UI.

---

## 9. SESSION LOG — "globe is glitching, switch providers" (Prompt 3–4, 2026-11-13)

**Prompt 4 (verbatim):**
> "i need you to fix the map as it is glitching a lot to the point that it is not
> usable so i need you to change providers it doesn't have to be real time
> truecolor anymore it just needs to be functional and also add tweaks to the ui
> and 3d visuals if you can and make it more appealing for the user"

### 9.1 Root cause (finally identified)
The globe was built from the **daily MODIS true-colour z3 mosaic**. That product
is a *swath* composite: at global zoom it legitimately contains black wedges
(polar night, orbital gaps, cloud gaps). Projected onto a sphere those wedges
read as "holes and wobbles" — the globe looked broken even though every tile
returned 200. The previous session tried to repair them (gap mask → heal tile →
gain-matched Blue Marble fill → mosaic heal, `MAXRUN`/`dilateMask`), which was
both heavy (per-pixel getImageData on 2048² canvases) and fragile. **The repair
pipeline was the second bug**: it ran on every texture finish and could striping
/ mis-gain the ocean.

### 9.2 Fix — provider/layer switch (decision)
* Globe base texture is now **NASA Blue Marble Next Generation** (`bluemarble`,
  GIBS `BlueMarble_NextGeneration`, `GoogleMapsCompatible_Level8`, jpg,
  **static** — no date path). It is complete, cloud-free and identical every
  day, so a sphere can never show daily gaps.
* Parameter layers (soil moisture / land temperature / greenery / rain) are
  fetched as their normal **transparent PNG overlays** and composited at 80 %
  over the Blue Marble base. "Satellite photo" on the globe is the Blue Marble
  itself; the flat fallback map keeps using the live daily MODIS tiles (works
  fine at regional zoom).
* `frontend/globe.js` texture pipeline simplified to two canvases per layer
  (`c.base`, `c.data`) → one equirectangular `c.eq`; `globeReproject()` paints
  the base row then the data row. The entire healing pipeline
  (`tileHasContent`, `gapMaskOf`, `blitMask`, `healTile`, `dilateMask`,
  `healMosaic`, `MAXRUN`, `c.raw`, `c.mask`, `c.bases`, `c.waiting`) was
  **deleted** (~370 lines), which also removed the per-frame jank.
* Offline story: if base tiles fail, `globeDrawLandFallback()` paints Natural
  Earth outlines into the base canvas (`world.json`); data tiles that fail just
  stay transparent.
* Image URLs: `/api/maptile/bluemarble/3/{x}/{y}.jpg` — 64 small jpgs, already
  in the hub disk cache (pre-warmed 64/64, 0 s, from cache).
* Layer note: `LAYERS.truecolor.globeNote` describes Blue Marble; `updateLayerUI`
  picks it only when `PICKER === GLOBE`, so the flat map keeps the MODIS text.

### 9.3 UI / 3D polish in this session
* Pin-drop **pulse ring** on the ground point (expanding 2.2 s ring, skipped
  under `prefers-reduced-motion`), plus a solid ground dot under the teardrop.
* City labels retained (4 100 GeoNames cities, pop-scaled, collision-filtered),
  dark/light stroke halo so names stay readable over imagery and data layers.
* Dark mode already shipped: pre-paint theme script, header moon/sun toggle,
  `localStorage lcrda-theme`, star field + atmosphere halo in the globe, all
  canvases theme-aware. Verified again after the provider switch.
* Design tokens: radius 14, layered `--shadow`/`--shadow-soft`, press scale,
  focus rings, single `fadeUp` results reveal honouring reduced motion.

### 9.4 Verification actually run
* `node --check` on `globe.js`, `app.js`, `map.js` — OK.
* `python -m tests.test_mcdm` → **35 passed, 0 failed**.
* `/health` → 200; `/api/maptile/bluemarble/3/4/3.jpg` → 200 (5 736 B).
* Headless Chromium 156 + SwiftShader at 500×900:
  * light + Satellite photo: complete Blue Marble sphere, no wedges, labels,
    pin pulse visible;
  * dark + Soil moisture: stars/halo, transparent data overlay over base.
* Debug harnesses (`frontend/_t*.html`, `_tg*.html`) **deleted** and committed.

### 9.5 Known limits / next steps
* Headless WebGL init is flaky; the flat map fallback remains the safety net.
* Git **push still needs the user's GitHub credentials** (`could not read
  Username`); commits are local and complete.
* Suggested additions (not implemented): NVDI/soil-moisture legends on the
  globe, tap-to-search city (geocode offline), day/night terminator toggle,
  crop-calendar overlay, WebGL globe idle "tour" of the user's saved fields.

---

## 10. SESSION LOG — globe still glitching: renderer replaced (2026-11-13, cont.)

**Prompt 5 (verbatim):**
> "you still didn't fix it so i need you to use another provider such as cesium
> ion and also i need you to utilize these resources provided by nasa for our
> challenge https://www.spaceappschallenge.org/2026/challenges/adapting-farms-with-nasa-data/?tab=resources"

### 10.1 What the Blue Marble switch did NOT fix — root cause #2 (the renderer)
The imagery was correct (dumping the assembled equirectangular canvas showed a
perfect Blue Marble: tan Sahara, correct continents). The **hand-rolled WebGL
sphere** was the remaining bug: the uploaded canvas texture was sampled
vertically mirrored/offset (the Sahara sampled ocean; Antarctica's smear rows
appeared near the equator), so the globe looked "wobbling with holes" even
with perfect tiles. Additional weaknesses found:
* `#globeCanvas` was measured while the panel was `display:none`, so the
  backing store could stay 320 px and be CSS-stretched to ~560 px (blurry,
  wobbling, tap mapping off).
* `precision mediump float` UVs + `CLAMP_TO_EDGE` at the antimeridian gave a
  seam/smear on the rotating sphere.

**Fix: stop hand-rolling WebGL.**
* Vendored **three.js r149** at `frontend/vendor/three.min.js` (608 KB, MIT,
  local file — still no CDN, still works offline on the Pi).
* `globe.js` now builds a `THREE.SphereGeometry(1, 128, 96, -π/2)` +
  `MeshBasicMaterial` (photographic texture is not darkened by lighting),
  an additive Fresnel **atmosphere shell**, and uses `CanvasTexture` with
  `RepeatWrapping` (seam-free) + mipmaps + anisotropy.
* `ResizeObserver` on the map wrapper fixes the stale 320 px canvas.
* Same public API kept: `GLOBE.init/open/stop/setLayer/setPin`, yaw/pitch/dist
  controls, label/pin/satellite 2D overlay, ray-sphere tap pick
  (`sphere.rotation.set(pitch, yaw, 0)` ≡ `Rx(pitch)·Ry(yaw)`, verified).
* Deleted the dead custom shaders/mat4 helpers (~120 lines). `globe.js` is now
  ~679 lines; `node --check` clean.

### 10.2 Why NOT Cesium Ion (decision recorded)
Cesium Ion was the user's suggestion, but it needs an **access token** and
streams imagery from `api.cesium.com`; CesiumJS itself is a multi-MB library
with web workers/assets. That breaks the two hard project constraints:
**offline-first on a Raspberry Pi** and **no external CDNs at runtime**.
NASA GIBS Blue Marble is already the best complete, token-free imagery for
this use case, so the globe keeps GIBS. If the team later wants Ion:
add `CESIUM_ION_TOKEN` server-side and proxy `api.cesium.com` tiles through
`/api/maptile/...` — the frontend only consumes the local proxy, so no other
change is needed. Recorded as a future option, not implemented.

### 10.3 NASA challenge resources now surfaced in the product
The challenge page's resource stack matches what the hub already uses; the
"Where this advice comes from" panel now names and links the **missions**:
SMAP (root-zone soil moisture), MODIS Terra (LST + true colour), VIIRS (NDVI),
GPM IMERG (rainfall), NASA POWER (weather/climate), NASA GIBS/Worldview
(tiles), Blue Marble Next Generation (globe base), plus the 2026
"Field Shift: Adapting Farms with NASA Data" challenge link. SoilGrids
(ISRIC) and FAO EcoCrop/FAO-56/AquaCrop remain the non-NASA inputs.

### 10.4 Verification actually run
* `node --check globe.js` OK; 35/35 tests pass; `/health` 200.
* three.js globe in headless Chromium + SwiftShader at 800×900:
  * light: Africa centred, Sahara tan, labels aligned, atmosphere rim;
  * dark + Soil moisture: data overlay composites correctly, stars/satellite;
  * `--disable-3d-apis`: `GLOBE.init` throws, app falls back to the flat map
    (hint text + visible `mapCanvas` confirmed).
* Debug harnesses (`_*.html`, `_patch.js`) deleted.

### 10.5 Notes for next agent
* three.js is loaded **before** `globe.js` in `index.html`; keep that order.
* `globeSize()` is idempotent and now ResizeObserver-driven — do not set
  `canvas.width` manually anywhere.
* `globeUploadTexture()` only marks `texture.needsUpdate`; the material map is
  swapped when the visible layer matches.
* If a future browser lacks WebGL, the flat map path is untouched.

---

## 11. SESSION LOG — permanent globe picker, deeper zoom, 3D motion (2026-11-13, cont.)

**Prompt 6 (verbatim):**
> "Remove the Pick On Map button and keep the globe showing at all times, also
> remove the Use my location button completely, increase the max zoom for the
> globe, to show smallers cities not only capitals, @ios-design @ui-taste
> @frontend-design @web-design-guidelines use these skills to make it more
> interactive and visually appealing to the user like 3D models or moving
> patterns that react to mouse movements etc.. research and find libraries to
> do so if you can't do it yourself or can't do it well enough, also in the very
> end suggest a way we can implement AI into our project, DO NOT IMPLEMENT IT
> YOURSELF YET"

### 11.1 UI: the globe is now the picker, always on screen
* Deleted the `#btnMap` / `#btnGPS` `.datarow` from `index.html`.
* Removed `hidden` from `#mapPanel`; deleted both button handlers and the
  entire `navigator.geolocation` flow from `app.js` (no GPS permission prompt
  is possible any more).
* Boot now calls `initPicker()` → `buildChips()` → `PICKER.open()` →
  `updateLayerUI()`, so the globe, layer chips and coordinate readout are live
  on first paint.
* `#btnUseSpot` no longer hides the panel or stops the renderer; it copies the
  pin into the lat/lon inputs and leaves the globe running. `GLOBE.open()` now
  calls `globeSetPin()` so `#mapCoord` shows the initial coordinates instead of
  "No spot chosen yet".
* Hint copy updated in `index.html` and in `initPicker()` (globe vs flat map).

### 11.2 Deeper zoom, more cities
* `ZOOM_MIN = 1.35`, `ZOOM_MAX = 6` constants; all four clamps (wheel, pinch,
  `#zoomIn`, `#zoomOut`) use them. Previously the floor was `2.4`.
* `frontend/cities.json` replaced with GeoNames `cities15000` (34,212 places,
  pop ≥ 15k) in compact array form `[lat, lon, name, pop]`, sorted by
  population desc, 1.12 MB. `globeLoadCities()` normalises it to
  `{la, lo, n, p}` and a parallel `Float32Array` of unit vectors.
* Labels are zoom-aware: population floors step 6M → 2.5M → 1M → 400k → 150k →
  60k → 15k as `GLOBE.dist` falls; cap 60 labels at deep zoom (44 otherwise,
  ×0.72 under 460 px). Font 8.5–12.5 px. Labels that would run off-canvas or
  collide are skipped. The per-frame loop uses an inline back-face test and
  allocates only for visible cities (34k candidates at deepest zoom must stay
  smooth on a Pi 4).

### 11.3 Interaction / visual upgrades (no new libraries beyond three.js)
* **3D satellite model** built from three.js primitives (body, two solar
  panels, gold dish) orbiting on a tilted 1.42-radius path, with a depth-tested
  `LineLoop` orbit ring. Both hide when `dist <= 2.5` (camera would be inside
  the orbit) and under `prefers-reduced-motion`.
* **Pointer-reactive backdrop**: `pointermove` on the globe stores normalised
  `_px/_py`; `drawSpace()` drifts the star field opposite the cursor and draws
  a soft radial glow that follows it under the globe. Redraws are rAF-coalesced
  via `scheduleSpace()`. Ignored for touch pointers and reduced motion.
* Removed the old 2D satellite dot/occlusion math from `globeDrawOverlay` and
  the now-unused `globeProjectWorld()`.
* Kept: drag-to-spin + inertia, idle auto-rotation, Fresnel atmosphere shell,
  pin pulse, exact ray-sphere tap picking.

### 11.4 Verification actually run
* `node --check globe.js` / `app.js` OK; **35/35** backend tests pass;
  `/health` 200.
* Headless Chromium + SwiftShader:
  * 900 px light: globe on first paint, Cairo pin + coords, layer chips,
    smaller-city labels, "Use this spot" keeps the panel;
  * 900 px dark + Soil moisture: SMAP overlay composites over Blue Marble,
    stars, 3D satellite + orbit visible;
  * 420 px mobile: globe and chips fit, edge labels clipped cleanly;
  * `dist = 1.4` over Punjab: Lahore, Peshawar, Rawalpindi, Kabul, Ahmedabad,
    Surat all labelled (15k-city threshold works);
  * `--disable-3d-apis`: init throws, flat-map fallback still shows with the
    correct "Tap the map…" hint and visible `mapCanvas`.
* Functional probe: layer switch, pointermove, `Use this spot`, city load
  (34,212), 0 window errors.
* Debug harnesses (`_*.html`) deleted before commit.

### 11.5 Notes for next agent
* City format is now positional: `c[0]=lat, c[1]=lon, c[2]=name, c[3]=pop`
  (normalised to `.la/.lo/.n/.p` in `GLOBE._cities`). Do not reintroduce the
  old `{la,lo,n,p}` JSON without updating `globeLoadCities()`.
* Zoom clamps live in `ZOOM_MIN` / `ZOOM_MAX`; change them once, not per event.
* Layer/theme changes call `drawSpace()`; pointer movement uses
  `scheduleSpace()` to avoid a redraw per mouse event.
* AI integration was **requested as a suggestion only** and deliberately not
  implemented (see the handoff message that accompanies this commit).

---

## 12. SESSION 2026-11-13 — “Orbital agronomy” UI overhaul + NDVI/EVI report

### 12.0 User prompts (verbatim)

**Prompt 7a:**
> "Improve the UI, I want more 3D elements, I want more mouse interations,
> hovers, actives, maybe particles that interact with the cursor, animations,
> USE LIBRARIES, USE THE WEB, DON'T IMPROVISE, YOU'RE NOT GOOD WITH UI."

**Prompt 7b:**
> "Update the explanation PDF, explain NVDI, and EVI, their formulas, and how
> they're used in our project."

### 12.1 Research before building

* Read the full handoff (`agent.md` §1–11), `Resources.md`, README, and the
  frontend/backend sources before changing anything.
* Checked current versions and licences of the libraries actually used, then
  **vendored every one locally** (`frontend/vendor/`, inventory in
  `vendor/README.md`): three.js r149 (already present), GSAP 3.12.5 +
  ScrollTrigger 3.12.5, tsParticles slim 3.7.1, VanillaTilt 1.8.1, Archivo and
  Public Sans woff2 (latin subsets). **No runtime CDN** — the Pi stays offline.
* Verified the NDVI/EVI formulas against primary sources (MODIS VI User Guide
  v6.1, Huete et al. 2002; MOD13Q1 v061 product page and file spec):
  NDVI = (NIR−red)/(NIR+red); EVI = G·(NIR−red)/(NIR+C1·red−C2·blue+L) with
  G=2.5, C1=6, C2=7.5, L=1; 250 m, 16-day MVC, int16 ×0.0001, fill −3000,
  valid −2000…10000.

### 12.2 Design direction — “orbital agronomy”

* A field ledger crossed with a mission console: a permanent deep night-green
  hero (dark in **both** themes) around the globe, warm paper working cards for
  long reading outdoors, lime/sun/sky accents, Archivo display + Public Sans
  body. No emojis, no exposed math.
* Step 1 is now a permanent hero: headline + lat/lon + NASA context stats on
  the left, the 3D globe in an “instrument” panel on the right. Steps 2–4 are
  spotlight cards; results keep the farmer language and 0–5 bars.

### 12.3 Backend — real NDVI/EVI, not just documentation

* New `backend/data/vegetation.py`: NASA MODIS **MOD13Q1 v061** (Terra, 250 m,
  16-day) via the **ORNL DAAC** subsetting REST API (no token). One year is
  split into three ~150-day windows × two bands = six parallel requests; the
  API caps a request at 10 composites. Decodes int16 ×0.0001, drops fill/out of
  range, keeps only dates where **both** NDVI and EVI are valid.
* `app.get_vegetation()`: SQLite dataset `mod13q1_veg`, 7-day TTL, an error
  payload retried after 1 h, never raises (advice must work offline).
* `GET /api/vegetation?lat=…&lon=…` added to `server.py`; static MIME table
  extended for the vendored fonts/libs.
* `tests/test_mcdm.py`: new `test_vegetation()`; suite is now **43/43**.
* Live Cairo check: 22 composites, latest 16 Oct 2026 NDVI 0.1707 / EVI 0.088,
  NDVI 100th percentile, EVI peak 9 May, trend +0.038 “greener”.

### 12.4 Frontend rewrite

* `index.html`: hero + globe picker, steps 2–4, action bar, results
  (`#summary`, `#vegetation`, `#plan`, `#others`, sources), footer, library
  script order. Theme boot script now also accepts `?theme=light|dark` (useful
  for sharing and for visual QA).
* `style.css` (~935 lines): font faces, tokens, hero/globe instrument panel,
  spotlight cards, 3D step discs, sliders, results/score bars, dark “From
  orbit” vegetation card, seed/ripple keyframes, dark theme, responsive,
  reduced-motion rules.
* `app.js`: priority value badges, tilt/spotlight classes, the NDVI/EVI fetch +
  card + seasonal SVG chart, plan timeline (no download-looking arrows),
  vegetation failure/skeleton states.
* `effects.js` (new, progressive): GSAP intro, ScrollTrigger reveals, stat
  counters, pointer spotlight, hero glow, button ripples, VanillaTilt on result
  cards, seed burst, chart clip animation, **tsParticles** cursor field
  (`repulse` + `bubble` on hover, `push` on click, parallax), nav active
  tracking. Everything is skipped under `prefers-reduced-motion` or when a
  library is missing.
* `globe.js`: `GLOBE._spaceDark = true` so the hero globe keeps its space
  backdrop/labels in light mode; phone-sized globes now show ~13 larger cities
  (min population ×4, font capped at 10.5 px) instead of 31 colliding labels.
* Vegetation chart labels fixed: month-year endpoints (`Nov 25` … `Oct 26`)
  instead of truncated day numbers; the “peak” label is dropped when it would
  collide with an endpoint. Plan rows now use a connected vertical timeline
  with a lime first-season disc; the odd down-arrow was removed.
* Flat-map fallback fixed (found while testing without WebGL):
  * `.mapbar .hint` never matched (the element itself is `.mapbar.hint`) so the
    “Tap the map…” copy was never applied;
  * “Satellite photo” now uses the complete **Blue Marble** base on the flat
    map too (the daily mosaic’s swath gaps showed as black wedges);
  * `map.js` tile helper accepts a layer argument; true-colour max zoom 8.

### 12.5 Map-tile backend fixes (surfaced by the fallback test)

* GIBS serves a **uniform black JPEG (~1.6 KB, HTTP 200)** for a date whose
  product is not produced yet. The old probe accepted any 200, so at 05:54 the
  hub cached a full day of black true-colour tiles. `gibs.py` now rejects
  sub-5 KB true-colour probe/download tiles, falls back to the newest cached
  day, and the stale 2026-11-13 cache was deleted + service restarted.
* `server.py` called `gibs.warm_mosaic()`, which did not exist (the local
  `warm_mosaic()` used unimported names and was dead code). Moved a working
  `warm_mosaic()` into `gibs.py` and removed the dead copy.

### 12.6 PDF — new section 7 on NDVI/EVI

`docs/build_report.py`:

* New **§7 “Vegetation indices from orbit: NDVI and EVI”** (the old §7–9 are
  now §8–10): NDVI derivation + interpretation table; EVI formula with the
  meaning of G/C1/C2/L and the MODIS two-band backup over bright targets;
  MOD13Q1 product table; the seven-step hub pipeline; analysis definitions
  (percentile/trend/peak); the live Cairo worked example; **why the indices are
  context and not MCDM criteria** (double counting, target/temporal/spatial
  mismatch); seven limitations specific to the panel.
* Exec summary, pipeline Step 0, system table, API surface, validation
  (43/43), limitations, references [16]–[21] (Huete 2002, Didan 2021, MODIS VI
  User Guide, ORNL DAAC, Tucker 1979, Rouse 1974) and Appendix A updated.
* Fixed the `table()` helper to wrap every cell in a `Paragraph`; the old
  plain-string cells overflowed across columns (visible in the previous PDF).
* Regenerated `docs/MCDM_Technical_Report.pdf` → **11 pages**, checked page by
  page with `pdftoppm`.

### 12.7 Verification actually run

* `node --check app.js / globe.js / effects.js / map.js` — OK.
* `./venv/bin/python -m tests.test_mcdm` — **43 passed, 0 failed**.
* Headless Chromium via a small CDP driver (SwiftShader for WebGL):
  * 1280 px light + dark, full page, with a real recommendation run:
    hero/globe, steps, Potato result, NDVI/EVI card + chart, plan, others,
    sources, footer; **0 console errors / 0 uncaught exceptions**.
  * 390×844 mobile light full page: clean globe labels, stacked cards, chart.
  * `prefers-reduced-motion: reduce` emulated: steps/cards visible, no
    particles (canvas stays 300×150), no tilt/GSAP.
  * `--disable-webgl`: flat-map fallback renders real Blue Marble imagery, the
    hint says “Tap the map…”, no black panel.
  * Live `/health`, `/api/vegetation`, GIBS tiles re-checked after the fix.
* Note: full-page screenshots show the sticky header at the scroll position and
  can hide the action button — a capture artefact, not a layout bug (computed
  styles and element captures were used to confirm).

### 12.8 Notes for the next agent

* `tsParticles`/GSAP/VanillaTilt are loaded before `map.js`; `effects.js` is
  last and exposes `window.LCRDA_EFFECTS.afterRender/animateVegetation/initTilt`.
  `app.js` calls those after rendering results.
* Vegetation is intentionally outside `c_ij`; do not add it to the MCDM matrix
  without removing the double counting and documenting the change.
* The ORNL DAAC call is slow on a cold cache (~10–11 s); the browser aborts at
  30 s and shows the offline fallback. The 7-day cache hides this after the
  first run.
* Chart helpers: `fmtIsoDate`, `monthYear`, `dayMonth`, `smoothPath`; labels
  are placed with an explicit anchor and the peak label is conditional.
* The `?theme=` parameter is a deep-link only; the toggle still persists to
  `localStorage["lcrda-theme"]`.
* Service: `sudo -n systemctl restart lcrda`; headless Chromium at
  `/usr/bin/chromium`; screenshots need SwiftShader (`--use-gl=swiftshader
  --enable-unsafe-swiftshader`) or WebGL hangs.
