"""
vegetation.py -- NDVI / EVI vegetation-index client.

Product: NASA MODIS MOD13Q1 (Terra), 250 m, 16-day vegetation-index
composites, served by the ORNL DAAC MODIS/VIIRS Subsetting Tool REST API
(no token required):

  GET https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset
      ?latitude=..&longitude=..&startDate=AYYYYDDD&endDate=AYYYYDDD
      &band=250m_16_days_NDVI&kmAboveBelow=0&kmLeftRight=0

The tool returns at most 10 composites per request, so a one-year window is
split into three ~150-day requests per band. Values are scaled integers
(scale factor 0.0001, fill -3000); only valid -2000..10000 are kept.

Why MOD13Q1: it is the standard, peer-reviewed NDVI/EVI product (Didan 2015,
Huete et al. 2002) at a resolution that is still meaningful around a field,
and it provides NDVI and EVI from the SAME observations -- so the two indices
can be compared without mixing sensors. One year of 16-day composites is
enough to characterise the local green-up / peak / senescence cycle.

The hub uses these values as CONTEXT, not as an MCDM ranking criterion:
NDVI/EVI measure the vegetation that is currently on the ground, not the
suitability of a candidate crop. See docs/build_report.py section 7.
"""

from __future__ import annotations

import datetime as _dt
import threading
from concurrent.futures import ThreadPoolExecutor

import requests

BASE = "https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset"
BANDS = {
    "ndvi": "250m_16_days_NDVI",
    "evi": "250m_16_days_EVI",
}
SCALE = 0.0001
FILL = -3000
VALID_MIN, VALID_MAX = -2000, 10000
# ORNL returns at most 10 composites (160 days) per request
WINDOW_DAYS = 150

_tls = threading.local()


def _get(url: str, **kwargs):
    """Thread-local keep-alive session: the six subsetting calls run in
    parallel, and requests.Session is not documented as thread-safe."""
    sess = getattr(_tls, "session", None)
    if sess is None:
        sess = _tls.session = requests.Session()
    return sess.get(url, **kwargs)


def _a_date(d: _dt.date) -> str:
    """MODIS 'A' date: A + year + day-of-year (e.g. A2026305)."""
    return f"A{d.year}{d.timetuple().tm_yday:03d}"


def _decode(raw, scale: float = SCALE) -> float | None:
    """MOD13Q1 scaled integer -> NDVI/EVI ratio; fill/no-data -> None."""
    if raw is None:
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    if not (VALID_MIN <= value <= VALID_MAX):
        return None
    return round(value * scale, 4)


def _fetch_band(band: str, lat: float, lon: float,
                start: _dt.date, end: _dt.date, timeout: int = 30
                ) -> dict[str, float]:
    """One band over one <=150-day window -> {calendar_date: value}."""
    r = _get(BASE, params={
        "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
        "startDate": _a_date(start), "endDate": _a_date(end),
        "band": band, "kmAboveBelow": 0, "kmLeftRight": 0,
    }, timeout=timeout)
    r.raise_for_status()
    js = r.json()
    if isinstance(js, str):                 # API reports limits as a string
        raise ValueError(js)
    scale = float(js.get("scale", SCALE))   # documented as 0.0001
    out: dict[str, float] = {}
    for row in js.get("subset", []):
        vals = row.get("data") or []
        if not vals:
            continue
        v = _decode(vals[0], scale)
        if v is None:
            continue
        out[row["calendar_date"]] = v
    return out


def fetch_series(lat: float, lon: float,
                 days: int = 365) -> list[dict]:
    """NDVI + EVI composites for the last `days` days, oldest first."""
    today = _dt.date.today()
    start = today - _dt.timedelta(days=days)
    # 3 windows covering the year (the API caps a request at 10 composites)
    windows = []
    s = start
    while s < today:
        e = min(today, s + _dt.timedelta(days=WINDOW_DAYS))
        windows.append((s, e))
        s = e + _dt.timedelta(days=1)

    merged: dict[str, dict] = {}
    jobs = [(key, band, s, e) for s, e in windows
            for key, band in BANDS.items()]
    # six independent API calls: run them together (the subsetting service
    # is the slow part -- sequential requests took ~45 s, parallel ~10 s)
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(
            lambda job: _fetch_band(job[1], lat, lon, job[2], job[3]), jobs))
    for (key, _band, _s, _e), vals in zip(jobs, results):
        for date, v in vals.items():
            merged.setdefault(date, {})[key] = v

    series = []
    for date in sorted(merged):
        rec = merged[date]
        # keep only complete pairs: comparing NDVI and EVI from the same
        # composite is the whole point of using one product for both
        if "ndvi" in rec and "evi" in rec:
            series.append({"date": date, "ndvi": rec["ndvi"],
                           "evi": rec["evi"]})
    if not series:
        raise ValueError("no valid NDVI/EVI composites returned")
    return series


def _stats(series: list[dict], key: str) -> dict:
    vals = [p[key] for p in series]
    peak = max(series, key=lambda p: p[key])
    low = min(series, key=lambda p: p[key])
    mean = sum(vals) / len(vals)
    return {
        "mean": round(mean, 3),
        "min": round(min(vals), 3),
        "max": round(max(vals), 3),
        "peak_date": peak["date"],
        "low_date": low["date"],
    }


def _percentile_rank(vals: list[float], value: float) -> float:
    if not vals:
        return 50.0
    below = sum(1 for v in vals if v <= value)
    return round(100.0 * below / len(vals), 1)


def analyse(series: list[dict]) -> dict:
    """Summarise a series for the farmer-facing satellite panel.

    All numbers are relative to THIS field's own last 12 months -- global
    NDVI thresholds are climate/land-cover dependent and would be misleading.
    """
    latest = series[-1]
    prev = series[-2] if len(series) > 1 else latest
    stats = {key: _stats(series, key) for key in BANDS}
    out = {
        "series": series,
        "latest": {
            "date": latest["date"],
            "ndvi": latest["ndvi"],
            "evi": latest["evi"],
            "ndvi_percentile": _percentile_rank(
                [p["ndvi"] for p in series], latest["ndvi"]),
            "evi_percentile": _percentile_rank(
                [p["evi"] for p in series], latest["evi"]),
        },
        "stats": stats,
        "trend": {
            "ndvi_delta": round(latest["ndvi"] - prev["ndvi"], 3),
            # a composite is 16 days; +/-0.02 is a deliberately conservative
            # "meaningful" change for a 250 m mixed pixel (documented)
            "direction": ("greener" if latest["ndvi"] - prev["ndvi"] > 0.02
                          else "drier" if latest["ndvi"] - prev["ndvi"] < -0.02
                          else "steady"),
        },
    }
    return out


def fetch(lat: float, lon: float) -> dict:
    """Fetch + analyse; raises on failure so the caller can cache the error."""
    series = fetch_series(lat, lon)
    payload = analyse(series)
    payload.update({
        "source": "NASA MODIS MOD13Q1 v061 (Terra, 250 m, 16-day) "
                  "via ORNL DAAC",
        "product": "MOD13Q1",
        "scale_factor": SCALE,
        "units": "ratio",
        "fetched_at": _dt.datetime.now().isoformat(),
        "count": len(series),
    })
    return payload
