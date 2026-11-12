"""
soilgrids.py -- ISRIC SoilGrids 2.0 REST client (verified live API).

Endpoint:
  GET https://rest.isric.org/soilgrids/v2.0/properties/query
      ?lon=..&lat=..&property=phh2o&property=sand&property=clay&property=soc
      &depth=0-5cm&depth=5-15cm&depth=15-30cm&depth=30-60cm&depth=60-100cm
      &value=mean

Response (verified 2026-11): properties.layers[] each with
  name, unit_measure.d_factor (=10), depths[].label ("0-5cm"...),
  depths[].values.mean.
Units: d_factor 10 -> divide mean by 10 to get real units
       (phh2o pH*10, sand/clay/soc g/kg).

Returns engine-ready dict {"ph": pH, "sand": %, "clay": %, "soc": %}
averaged over the root zone (0-60 cm), or {"error": ...}.
"""

from __future__ import annotations

import requests

BASE = "https://rest.isric.org/soilgrids/v2.0/properties/query"
PROPERTIES = ["phh2o", "sand", "clay", "soc"]
DEPTHS = ["0-5cm", "5-15cm", "15-30cm", "30-60cm", "60-100cm"]
ROOT_ZONE = ["0-5cm", "5-15cm", "15-30cm", "30-60cm"]   # 0-60 cm


def _query(lat: float, lon: float, timeout: int) -> dict:
    params: list[str] = [("lon", f"{lon:.5f}"), ("lat", f"{lat:.5f}")]
    for p in PROPERTIES:
        params += [("property", p)]
    for d in DEPTHS:
        params += [("depth", d)]
    params += [("value", "mean")]

    r = requests.get(BASE, params=params, timeout=timeout)
    r.raise_for_status()
    js = r.json()
    layers = js.get("properties", {}).get("layers", [])

    out: dict = {}
    for layer in layers:
        name = layer.get("name")
        if name not in PROPERTIES:
            continue
        d_factor = layer.get("unit_measure", {}).get("d_factor", 10) or 10
        vals = []
        for dep in layer.get("depths", []):
            if dep.get("label") in ROOT_ZONE:
                m = (dep.get("values") or {}).get("mean")
                if m is not None:
                    vals.append(m / d_factor)
        if vals:
            out[{"phh2o": "ph", "sand": "sand", "clay": "clay",
                 "soc": "soc"}[name]] = round(sum(vals) / len(vals), 2)
    return out


def fetch_soil(lat: float, lon: float, timeout: int = 60) -> dict:
    """Soil for a field. Some SoilGrids cells are NULL (rivers, dense cities,
    water edges -- e.g. central Cairo), so if the exact point has no values
    we walk outwards in rings up to ~30 km. Soil varies far less than weather
    over that distance, and the result is cached for a month."""
    out = _query(lat, lon, timeout)
    if out:
        return out
    rings = [(0.02, "card"), (0.05, "card"), (0.1, "card"),
             (0.2, "card"), (0.3, "card"),
             (0.07, "diag"), (0.15, "diag")]
    for r, kind in rings:
        dirs = ([(r, 0), (-r, 0), (0, r), (0, -r)] if kind == "card"
                else [(r, r), (-r, -r), (r, -r), (-r, r)])
        for dlat, dlon in dirs:
            try:
                out = _query(lat + dlat, lon + dlon, timeout)
            except Exception:
                continue
            if out:
                out["sampled_nearby_km"] = round(
                    r * 111.0, 0) if kind == "card" else round(
                    r * 111.0 * 1.414, 0)
                return out
    return {"error": "no SoilGrids values at this location (water/NULL cell)"}
