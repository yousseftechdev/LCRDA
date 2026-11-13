"""
gibs.py -- NASA GIBS (Global Imagery Browse Services) daily satellite map
tiles, the imagery shown in NASA Worldview / "Eyes on Earth".

The map in the UI shows today's (or the latest available) NASA satellite
imagery. Tiles are fetched from GIBS once and cached on disk under
data/cache/gibs/<layer>/<date>/, so:
  * the imagery updates itself every day (fresh date each fetch),
  * the map keeps working OFFLINE (serves the newest cached day),
  * GIBS is not hammered (each tile is downloaded at most once per day).

Layers (all verified live against the GIBS WMTS capabilities, EPSG:3857):
  truecolor    MODIS Terra corrected reflectance (daily true-colour photo), z<=9, jpeg
  soilmoisture SMAP L4 analysed root-zone soil moisture, z<=6, png
  temp         MODIS Terra land surface temperature (day), z<=7, png
  ndvi         VIIRS SNPP NDVI 8-day greenery index, z<=8, png
  rain         IMERG precipitation rate, z<=6, png

Soil pH is NOT observable by daily satellites -- it comes from the ISRIC
SoilGrids map used by the advice itself (see soilgrids.py).
"""

from __future__ import annotations

import datetime as dt
import os
import threading

import requests

BASE = ("https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/"
        "{ident}/default/{date}/{tms}/{z}/{y}/{x}.{ext}")

LAYERS = {
    "truecolor": {"ident": "MODIS_Terra_CorrectedReflectance_TrueColor",
                  "tms": "GoogleMapsCompatible_Level9", "ext": "jpg", "maxz": 9},
    "soilmoisture": {"ident": "SMAP_L4_Analyzed_Root_Zone_Soil_Moisture",
                     "tms": "GoogleMapsCompatible_Level6", "ext": "png", "maxz": 6},
    "temp": {"ident": "MODIS_Terra_Land_Surface_Temp_Day",
             "tms": "GoogleMapsCompatible_Level7", "ext": "png", "maxz": 7},
    "ndvi": {"ident": "VIIRS_SNPP_NDVI_8Day",
             "tms": "GoogleMapsCompatible_Level8", "ext": "png", "maxz": 8},
    "rain": {"ident": "IMERG_Precipitation_Rate",
             "tms": "GoogleMapsCompatible_Level6", "ext": "png", "maxz": 6},
    # static, date-less NASA Blue Marble base map: the 3D globe underlays
    # today's true-colour imagery with it, because the daily mosaic has
    # black polar-night / swath-gap holes that would look broken on a sphere
    "bluemarble": {"ident": "BlueMarble_NextGeneration",
                   "tms": "GoogleMapsCompatible_Level8", "ext": "jpg",
                   "maxz": 8, "static": True},
}

TILE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))), "data", "cache", "gibs")

# keep-alive: reusing one TCP/TLS session makes tile downloads several
# times faster than a fresh handshake per tile
_session = requests.Session()

# layer -> {"date": ISO date of latest known-good imagery, "checked": ts}
_hints: dict[str, dict] = {}
_hint_lock = threading.Lock()
_fetch_lock = threading.Lock()

# Day offsets to probe for the newest available imagery, per layer.
# Lagging products (SMAP ~1-2 d, 8-day NDVI ~6 d, IMERG ~1 d) are probed
# at their likely date first, then outward.
_CANDIDATE_BACKDAYS = {
    "truecolor": [0, 1, 2],
    "temp": [1, 2, 0],
    "rain": [1, 2, 3, 0],
    "soilmoisture": [2, 3, 1, 4, 0],
    "ndvi": [6, 7, 5, 8, 9, 4, 10, 3, 2, 1, 0],
}


def _tile_path(layer: str, date: str, z: int, x: int, y: int) -> str:
    ext = LAYERS[layer]["ext"]
    return os.path.join(TILE_DIR, layer, date, f"{z}_{x}_{y}.{ext}")


def _newest_cached_tile(layer: str, z: int, x: int, y: int) -> str | None:
    """Offline fallback: the same tile from the most recent cached day."""
    ldir = os.path.join(TILE_DIR, layer)
    if not os.path.isdir(ldir):
        return None
    ext = LAYERS[layer]["ext"]
    want = f"{z}_{x}_{y}.{ext}"
    for date in sorted(os.listdir(ldir), reverse=True):
        p = os.path.join(ldir, date, want)
        if os.path.isfile(p):
            return p
    return None


# For a date whose product has not been produced yet, GIBS answers with a
# uniform black JPEG (HTTP 200, ~1.6 KB) instead of a 404. Real land tiles
# are much larger, so a size floor is a cheap, dependency-free way to tell
# "not yet available" from "available". Only applied where it is reliable.
_MIN_REAL_BYTES = {"truecolor": 5000}


def _looks_blank(layer: str, content: bytes) -> bool:
    limit = _MIN_REAL_BYTES.get(layer)
    return bool(limit) and len(content) < limit


def _latest_available_date(layer: str, today: dt.date) -> str | None:
    """Probe GIBS for the newest date that has imagery for this layer.
    A single network failure does NOT abort the walk (transient errors
    just move on to the next candidate date). A blank tile does not count
    as available: GIBS serves black tiles for dates still being processed."""
    ident, tms, ext = (LAYERS[layer]["ident"], LAYERS[layer]["tms"],
                       LAYERS[layer]["ext"])
    for back in _CANDIDATE_BACKDAYS.get(layer, [0, 1, 2]):
        d = (today - dt.timedelta(days=back)).isoformat()
        url = BASE.format(ident=ident, date=d, tms=tms, z=2, y=2, x=2, ext=ext)
        try:
            r = _session.get(url, timeout=35)
            ok = r.status_code == 200 and not _looks_blank(layer, r.content)
            r.close()
        except Exception:
            continue
        if ok:
            return d
    return None


def warm_hints() -> None:
    """Pre-resolve the latest available date for every dated layer (called
    at server start and hourly, so the first map request never waits).
    Static layers (no date) are skipped."""
    for layer, cfg in LAYERS.items():
        if not cfg.get("static"):
            _hint(layer)


def warm_mosaic() -> None:
    """Pre-fetch the z3 world mosaic (8x8 tiles per layer) that the 3D
    globe needs for its texture, once per imagery day. Called by the
    background thread so the first visitor never waits for ~128 downloads."""
    for layer in ("truecolor", "bluemarble"):
        hint = "static" if LAYERS[layer].get("static") else _hint(layer)
        if not hint:
            continue
        for y in range(8):
            for x in range(8):
                try:
                    get_tile(layer, 3, x, y)
                except Exception:       # a single failed tile is fine
                    pass


def _hint(layer: str) -> str | None:
    """Latest known-good date for the layer, re-probed at most hourly."""
    now = dt.datetime.now()
    with _hint_lock:
        h = _hints.get(layer)
        if h and h["date"] and (now - h["checked"]).total_seconds() < 3600:
            return h["date"]
        # a failed probe (h["date"] is None) is retried after 5 minutes,
        # so a boot-time network blip doesn't stick for an hour
        if h and not h["date"] and (now - h["checked"]).total_seconds() < 300:
            return None
    today = dt.date.today()
    date = _latest_available_date(layer, today)
    with _hint_lock:
        _hints[layer] = {"date": date, "checked": now}
    return date


def get_tile(layer: str, z: int, x: int, y: int
             ) -> tuple[bytes, str] | None:
    """Return (image bytes, content type) for a map tile, from disk cache
    or GIBS; falls back to the newest cached day when offline."""
    cfg = LAYERS.get(layer)
    if cfg is None or not (0 <= z <= cfg["maxz"]):
        return None
    n = 2 ** z
    if not (0 <= x < n and 0 <= y < n):
        return None

    if cfg.get("static"):                      # date-less layer (Blue Marble)
        hint = "static"
    else:
        hint = _hint(layer)

    if hint:
        p = _tile_path(layer, hint, z, x, y)
        if os.path.isfile(p):
            with open(p, "rb") as f:
                return f.read(), f"image/{cfg['ext']}"
        with _fetch_lock:
            if not os.path.isfile(p):               # re-check under lock
                url = BASE.format(ident=cfg["ident"],
                                  date="" if cfg.get("static") else hint,
                                  tms=cfg["tms"], z=z, y=y, x=x,
                                  ext=cfg["ext"])
                try:
                    r = _session.get(url, timeout=35)
                except Exception:
                    r = None
                if (r is not None and r.status_code == 200
                        and not _looks_blank(layer, r.content)):
                    os.makedirs(os.path.dirname(p), exist_ok=True)
                    tmp = p + ".part"
                    with open(tmp, "wb") as f:
                        f.write(r.content)
                    os.replace(tmp, p)
                    with open(p, "rb") as f:
                        return f.read(), f"image/{cfg['ext']}"

    # offline or fetch failed -> newest cached day for this tile
    fallback = _newest_cached_tile(layer, z, x, y)
    if fallback:
        with open(fallback, "rb") as f:
            return f.read(), f"image/{cfg['ext']}"
    return None


def cleanup_old_tiles(keep_days: int = 8) -> int:
    """Delete cached imagery days older than keep_days (housekeeping)."""
    cutoff = dt.date.today() - dt.timedelta(days=keep_days)
    removed = 0
    if not os.path.isdir(TILE_DIR):
        return 0
    for layer in os.listdir(TILE_DIR):
        ldir = os.path.join(TILE_DIR, layer)
        for date in os.listdir(ldir):
            try:
                d = dt.date.fromisoformat(date)
            except ValueError:
                continue
            if d < cutoff:
                import shutil
                shutil.rmtree(os.path.join(ldir, date), ignore_errors=True)
                removed += 1
    return removed
