"""
power.py -- NASA POWER daily point-data client (verified live API).

Endpoint:
  GET https://power.larc.nasa.gov/api/temporal/daily/point
      ?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,WS2M,RH2M,ALLSKY_SFC_SW_DWN
      &community=AG&longitude=..&latitude=..&start=YYYYMMDD&end=YYYYMMDD
      &format=JSON

Response shape (verified 2026-11):
  properties.parameter.{T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,WS2M,RH2M,
      ALLSKY_SFC_SW_DWN} -> {"YYYYMMDD": value, ...}
  fill_value = -999.0 (missing data), units in header.parameters.
Rate-limit rule: ONE request per 0.5-degree grid cell (we cache hard).
"""

from __future__ import annotations

import datetime as _dt

import requests

BASE = "https://power.larc.nasa.gov/api/temporal/daily/point"
PARAMS = ("T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,WS2M,RH2M,ALLSKY_SFC_SW_DWN")


def fetch_daily(lat: float, lon: float, start: _dt.date, end: _dt.date,
                timeout: int = 60) -> dict:
    """Fetch a year (or range) of daily data; returns engine-ready dict:
    {"dates": [...], "tmean","tmin","tmax","prec","u2","rh","rs"}  lists
    aligned to dates; missing values (=-999) are linearly interpolated.
    """
    r = requests.get(BASE, params={
        "parameters": PARAMS, "community": "AG",
        "longitude": f"{lon:.4f}", "latitude": f"{lat:.4f}",
        "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"),
        "format": "JSON",
    }, timeout=timeout)
    r.raise_for_status()
    js = r.json()
    pars = js.get("properties", {}).get("parameter", {})

    dates = sorted(pars.get("T2M", {}).keys())
    out = {"dates": dates, "tmean": [], "tmin": [], "tmax": [], "prec": [],
           "u2": [], "rh": [], "rs": []}
    FILL = -999.0

    def series(key, missing_fill=None):
        vals = [pars[key].get(d, FILL) for d in dates]
        vals = [FILL if v is None else float(v) for v in vals]
        return _interpolate_fills(vals)

    out["tmean"] = series("T2M")
    out["tmin"] = series("T2M_MIN")
    out["tmax"] = series("T2M_MAX")
    out["prec"] = series("PRECTOTCORR")
    out["u2"] = series("WS2M")
    out["rh"] = series("RH2M")
    out["rs"] = series("ALLSKY_SFC_SW_DWN")
    out["header"] = js.get("header", {})
    return out


def _interpolate_fills(vals: list[float]) -> list[float]:
    """Replace -999 sentinels by linear interpolation between neighbours
    (documented data-cleaning step; endpoints keep nearest value)."""
    n = len(vals)
    out = list(vals)
    bad = [i for i, v in enumerate(vals) if v <= -998]
    good = [i for i, v in enumerate(vals) if v > -998]
    if not good:
        return [0.0] * n
    if not bad:
        return out
    for i in bad:
        prev_g = max((g for g in good if g < i), default=None)
        next_g = min((g for g in good if g > i), default=None)
        if prev_g is None and next_g is None:
            out[i] = vals[good[0]]
        elif prev_g is None:
            out[i] = vals[next_g]
        elif next_g is None:
            out[i] = vals[prev_g]
        else:
            f = (i - prev_g) / (next_g - prev_g)
            out[i] = vals[prev_g] * (1 - f) + vals[next_g] * f
    return out
