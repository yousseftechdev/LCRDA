"""
app.py -- The MCDM recommendation pipeline (orchestrator).

End-to-end flow for one decision ("what should I plant next / this season"):

  0. Data (offline-first): NASA POWER daily year + SoilGrids soil, cached
     locally, refreshed every 24 h by the hub.
  1. ET0 series: FAO-56 Penman-Monteith per day (Hargreaves fallback).
  2. For every candidate crop (filtered by the farmer's shortlist):
       a. S_climate : EcoCrop combined suitability = min(S_T, S_P)
                      scanned over candidate sowing windows (exact OpenCLIM
                      math; best window reported as recommended sowing date)
       b. S_soil    : weighted mean of pH/texture/depth (± salinity)
                      suitability vs EcoCrop soil requirements
       c. S_water   : FAO-56 seasonal balance NIR vs water availability
                      (rainfed: how close effective rainfall is to demand;
                       irrigated: NIR is the advisory irrigation volume)
       d. S_yield   : simplified AquaCrop  B = WP* sum(Tr/ET0), Y = HI*B,
                      normalised against the best-yield crop in the set
       e. S_rotation: compatibility with the previous crop (family rule,
                      legume N credit, plant-soil feedback proxies)
       f. S_market  : farmer-entered market demand (0..1), default 0.5
  3. Weights: AHP from the farmer's priority sliders (CR reported).
  4. Ranking: SAW  Z_i = sum_j w_j c_ij  (the MCDM paper's objective),
     verified with TOPSIS closeness coefficients.
  5. Multi-season plan: exact DP rotation optimiser with family rule +
     N-credit transitions.
"""

from __future__ import annotations

import datetime as dt

from .engine import ecocrop as eco
from .engine import fao56
from .engine import aquacrop as aq
from .engine import soil as soil_mod
from .engine import rotation as rot
from .engine import mcdm
from .data import crops as cropdb
from .data import power as powerdb
from .data import soilgrids as sgrids
from . import storage


# ------------------------------------------------------------- data ------

def get_climate(lat: float, lon: float, force_refresh: bool = False) -> dict:
    cached = None if force_refresh else storage.get("power_daily", lat, lon)
    # Error payloads are retried after 1 h instead of living a full day.
    if cached and "error" in cached["payload"] and cached["age_hours"] < 1:
        return cached["payload"]
    if cached and "error" not in cached["payload"]:
        return cached["payload"]
    today = dt.date.today()
    start = today - dt.timedelta(days=365)
    payload = powerdb.fetch_daily(lat, lon, start, today)
    payload["fetched_at"] = dt.datetime.now().isoformat()
    storage.put("power_daily", lat, lon, payload)
    return payload


def get_soil(lat: float, lon: float, force_refresh: bool = False) -> dict:
    cached = None if force_refresh else storage.get("soilgrids", lat, lon,
                                                   max_age_h=24*30)
    # Error payloads are retried after 1 h instead of living a month.
    if cached and "error" not in cached["payload"]:
        return cached["payload"]
    if cached and "error" in cached["payload"] and cached["age_hours"] < 1:
        return cached["payload"]
    try:
        payload = sgrids.fetch_soil(lat, lon)
    except Exception as e:            # offline: keep going with unknown soil
        payload = {"error": f"offline/failed: {e}"}
    storage.put("soilgrids", lat, lon, payload)
    return payload


# -------------------------------------------------- ET0 series -----------

def et0_series(lat: float, lon: float, climate: dict, altitude: float = 0.0
               ) -> dict:
    """Daily ET0 by FAO-56 Penman-Monteith; Hargreaves fallback when any of
    RH2M/WS2M/ALLSKY is missing (documented rule)."""
    pm, hg = [], []
    n = len(climate["dates"])
    import math
    for i in range(n):
        doy = (dt.datetime.strptime(climate["dates"][i], "%Y%m%d")).timetuple().tm_yday
        ra = fao56.extraterrestrial_radiation(lat, doy)
        tmean, tmax, tmin = (climate["tmean"][i], climate["tmax"][i],
                             climate["tmin"][i])
        rs, rh, u2 = (climate["rs"][i], climate["rh"][i], climate["u2"][i])
        complete = rs > -900 and rh > -900 and u2 > -900 and rs >= 0
        pm_v = fao56.et0_penman_monteith(
            tmean, tmax, tmin, rh, u2, rs, ra, altitude) if complete else None
        pm.append(pm_v)
        hg.append(fao56.et0_hargreaves(tmean, tmax, tmin, ra))
    final = [p if p is not None else h for p, h in zip(pm, hg)]
    return {"pm": pm, "hargreaves": hg, "et0": final}


# ------------------------------------------------------- recommendation --

CRITERIA = ["climate", "soil", "water", "yield", "rotation", "market"]

# Farmer-facing slider keys (frontend sends these, 1..5 each) mapped onto the
# six science criteria. "Fits my land and weather" deliberately drives BOTH the
# climate and the soil criterion with the same weight (the farmer thinks of it
# as one thing: "does this crop suit my place?").
FARMER_KEYS = {"land", "harvest", "water", "soilnext", "market"}


def farmer_to_criteria_priorities(priorities: dict | None) -> list[float]:
    """Accept either the farmer's five 1..5 sliders (land/harvest/water/
    soilnext/market) or raw 1..9 criterion keys (climate/soil/...), and
    return the 6-vector the AHP engine expects (1..9 scale).

    The 1..5 farmer scale is stretched to the 1..9 AHP scale (v -> 2v-1:
    1,3,5,7,9) so 'very important vs not important' keeps the same strength
    in the pairwise matrix as in the original method."""
    priorities = priorities or {}
    if any(k in priorities for k in FARMER_KEYS):
        v = float(priorities.get("land", 3))          # climate AND soil
        pr = [
            2 * v - 1,                                # climate
            2 * v - 1,                                # soil
            2 * float(priorities.get("water", 3)) - 1,    # water
            2 * float(priorities.get("harvest", 3)) - 1,  # yield
            2 * float(priorities.get("soilnext", 3)) - 1, # rotation
            2 * float(priorities.get("market", 3)) - 1,   # market
        ]
    else:   # backward-compatible raw criterion keys (1..9)
        pr = [float(priorities.get(k, 3)) for k in CRITERIA]
    return [min(9.0, max(1.0, x)) for x in pr]


def recommend(
    lat: float, lon: float,
    shortlist: list[str] | None = None,     # EcoCrop keys; None = default set
    priorities: dict | None = None,         # slider values 1..9 per criterion
    prev_crop_key: str | None = None,
    water_available_mm: float | None = None,  # None = rainfed
    market_scores: dict | None = None,        # crop key -> 0..1
    soil_depth_cm: float = 100.0,
    altitude: float = 0.0,
    measured_ph: float | None = None,
    max_candidates: int = 60,
) -> dict:
    """water_available_mm semantics (documented):
    * None  -> RAINFED mode: the climate criterion uses the exact OpenCLIM
               combined score min(S_T, S_P) -- precipitation suitability is
               the honest rainfed water adequacy -- and the water criterion
               duplicates S_P (0..1). NIR is still reported as the advisory
               deficit (what irrigation WOULD be needed).
    * value -> IRRIGATED mode: the climate criterion uses the temperature
               score S_T only (irrigation removes the rain limitation) and
               the water criterion scores the fraction of the FAO-56 net
               irrigation requirement the water supply can meet.
    """
    priorities = priorities or {}
    market_scores = market_scores or {}

    climate = get_climate(lat, lon)
    soilg = get_soil(lat, lon)
    et0 = et0_series(lat, lon, climate, altitude)

    # candidate crops
    all_crops = cropdb.load_ecocrop()
    if shortlist:
        keyset = set(shortlist)
        cands = [c for c in all_crops if c["key"] in keyset]
    else:
        # default curated shortlist = common food crops
        default_keys = [
            "triticum-aestivum", "zea-mays", "oryza-sativa", "hordeum-vulgare",
            "sorghum-bicolor", "solanum-tuberosum", "solanum-lycopersicum",
            "allium-cepum", "phaseolus-vulgaris", "glycine-max",
            "arachis-hypogaea", "cicer-arietinum", "helianthus-annuus",
            "gossypium-hirsutum", "brassica-oleracea", "daucus-carota",
            "cucumis-sativus", "citrullus-lanatus", "pisum-sativum",
            "vicia-faba", "beta-vulgaris",
        ]
        keyset = set(default_keys)
        cands = [c for c in all_crops if c["key"] in keyset]
        if not cands:      # key naming differs -> fuzzy fallback by genus
            def genus(k):
                return k.split("-")[0]
            wanted = {genus(k) for k in default_keys}
            cands = [c for c in all_crops
                     if c["scientific_name"].split(" ")[0].lower() in wanted]
        if len(cands) > max_candidates:
            cands = cands[:max_candidates]
    if not cands:
        return {"error": "no candidate crops matched the shortlist"}

    prev = next((c for c in all_crops if c["key"] == prev_crop_key), None)

    # ---- per-crop criteria scores -----------------------------------
    rows, details = [], []
    for c in cands:
        params = eco.EcoCropParams(
            name=c["scientific_name"], tmin=c["tmin"], tmax=c["tmax"],
            topmn=c["topmn"], topmx=c["topmx"], ktmp=c["ktmp"],
            rmin=c["rmin"], rmax=c["rmax"], ropmn=c["ropmn"], ropmx=c["ropmx"],
            gmin=c["gmin"], gmax=c["gmax"],
            perennial=("perennial" in c["lifecycle"]),
        )
        clim = eco.combined_suitability(climate, params)
        s_climate = clim["score"] / 100.0

        so = soil_mod.soil_suitability(c, soilg, soil_depth_cm, measured_ph)
        s_soil = so["score"] if so["score"] is not None else 0.5  # unknown -> neutral

        wp = cropdb.crop_water_params(c)
        sowing_for_water = (clim["sowing_day"] if water_available_mm is None
                            else (clim["sowing_day_temp"]
                                  if clim["sowing_day_temp"] is not None else 0))
        wr = fao56.water_requirement_summary(
            et0["et0"], climate["prec"], wp["cycle"], wp["kc_ini"],
            wp["kc_mid"], wp["kc_end"], sowing_for_water)
        if water_available_mm is not None:
            # IRRIGATED: climate = best temperature score over windows;
            # sowing date = the window achieving it
            s_climate = clim["s_t_best"] / 100.0
            s_water = 1.0 if wr["nir_mm"] <= 0 else min(
                1.0, water_available_mm / wr["nir_mm"])
        else:
            # RAINFED: exact OpenCLIM combined min(S_T, S_P)
            s_water = clim["s_p"] / 100.0

        fg = rot.functional_group(c)
        tr_et0 = aq.sum_tr_over_et0(
            et0["et0"], wp["cycle"], wp["kc_ini"], wp["kc_mid"], wp["kc_end"],
            clim["sowing_day"] if clim["sowing_day"] is not None else 0)
        yld = aq.estimate_yield(tr_et0, fg)
        s_yield_raw = yld["yield_t_ha"]

        s_rot = (rot.rotation_compatibility_score(prev, c)
                 if prev is not None else 0.5)
        s_market = float(market_scores.get(c["key"], 0.5))

        rows.append({
            "crop": c, "wp": wp, "water": wr, "climate": clim, "soil": so,
            "yield_est": yld, "tr_et0": tr_et0,
            "criteria": [s_climate, s_soil, s_water, s_yield_raw, s_rot, s_market],
        })

    # normalise yield criterion vs best in set (relative scoring documented)
    ymax = max((r["criteria"][3] for r in rows), default=1.0) or 1.0
    for r in rows:
        r["criteria"][3] = round(min(1.0, r["criteria"][3] / ymax), 4)
        r["criteria"] = [round(x, 4) for x in r["criteria"]]

    # ---- MCDM ranking -------------------------------------------------
    pr = farmer_to_criteria_priorities(priorities)
    matrix = [r["criteria"] for r in rows]
    names = [r["crop"]["scientific_name"] for r in rows]
    decision = mcdm.rank_alternatives(matrix, priorities=pr, names=names)

    # enrich results (keep index alignment for the DP rotation planner)
    for alt, r in zip(decision["alternatives"], rows):
        c = r["crop"]
        alt.update({
            "key": c["key"], "comname": c["comname"],
            "scientific_name": c["scientific_name"],
            "family": c["botanical_family"], "category": c["category"],
            "n_fixing": rot.is_n_fixing(c),
            "functional_group": rot.functional_group(c),
            "sowing_day": r["climate"]["sowing_day"],
            "sowing_date": climate["dates"][r["climate"]["sowing_day"]]
            if r["climate"]["sowing_day"] is not None else None,
            "sowing_day_temp": r["climate"]["sowing_day_temp"],
            "sowing_date_temp": climate["dates"][r["climate"]["sowing_day_temp"]]
            if r["climate"]["sowing_day_temp"] is not None else None,
            "s_temp_best": r["climate"]["s_t_best"],
            "s_temp": r["climate"]["s_t"], "s_prec": r["climate"]["s_p"],
            "window_len": r["climate"]["window_len"],
            "window_len_temp": r["climate"]["window_len_temp"],
            "days_to_harvest": r["wp"]["cycle"],
            "nir_mm": r["water"]["nir_mm"],
            "etc_mm": r["water"]["etc_total_mm"],
            "eff_rain_mm": r["water"]["effective_rain_mm"],
            "yield_t_ha": r["yield_est"]["yield_t_ha"],
            "biomass_g_m2": r["yield_est"]["biomass_g_m2"],
            "kc": r["wp"],
        })

    # ---- multi-season rotation plan (DP) ------------------------------
    base = [alt["score_saw"] for alt in decision["alternatives"]]
    plan = rot.plan_rotation(base, [r["crop"] for r in rows],
                             seasons=3, lambda_trans=0.5)
    alt_by_index = {a["index"]: a for a in decision["alternatives"]}
    rot_seq = []
    for i in plan["sequence"]:
        alt = alt_by_index[i]
        rot_seq.append({"key": alt["key"], "name": alt["name"],
                        "comname": alt.get("comname"),
                        "scientific_name": alt.get("scientific_name"),
                        "n_fixing": alt.get("n_fixing", False),
                        "score": alt["score_saw"]})
    nbal = rot.nitrogen_balance([rows[i]["crop"] for i in plan["sequence"]])

    # sort the presented ranking by SAW rank (rank 1 first)
    ranked = sorted(decision["alternatives"], key=lambda a: a["rank_saw"])

    # "close call" note for the farmer UI: when the two independent methods
    # (SAW and TOPSIS) disagree on the winner, the runner-up is a real rival.
    close_call = None
    if not decision["methods_agree"] and len(ranked) >= 2:
        close_call = ranked[1]

    return {
        "location": {"lat": lat, "lon": lon},
        "waterMode": "irrigate" if water_available_mm is not None else "rain",
        "waterAvailableMM": water_available_mm,
        "data": {
            "climate_days": len(climate["dates"]),
            "climate_from": climate["dates"][0] if climate["dates"] else None,
            "climate_to": climate["dates"][-1] if climate["dates"] else None,
            "climate_fetched_at": climate.get("fetched_at"),
            "soil": soilg,
            "et0_mean_mm_day": round(sum(et0["et0"]) / max(1, len(et0["et0"])), 2),
        },
        "criteria": CRITERIA,
        "weights": dict(zip(CRITERIA, decision["weights"])),
        "ahp": decision["ahp"],
        "methods_agree": decision["methods_agree"],
        "closeCall": close_call,
        "ranking": ranked,
        "winner": ranked[0] if ranked else None,
        "rotation_plan": rot_seq,
        "rotation_objective": plan["objective"],
        "nitrogen_balance": nbal,
    }
