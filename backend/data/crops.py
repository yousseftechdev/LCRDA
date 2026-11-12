"""
crops.py -- Crop parameter database.

Primary source: the full FAO EcoCrop database (EcoCrop_DB.csv, FAO EcoCrop,
https://gaez.fao.org/pages/ecocrop, redistributed with the OpenCLIM/ecocrop
repository under the Open Government Licence v3; credit "FAO EcoCrop &
OpenCLIM"). It provides, per crop: temperature/precipitation ranges
(TMIN..TOPMN..TOPMX..TMAX; RMIN..ROPMN..ROPMX..RMAX), soil requirements
(PHMIN/PHMAX/PHOPMN/PHOPMX, DEP, TEXT/TEXTR, SAL), killing temperature
(KTMP), cycle length (GMIN/GMAX), botanical family (FAMNAME) and category
(CAT).

Secondary: FAO-56 Kc values (Allen et al. 1998, Table 12) and AquaCrop
WP*/HI0 for a curated set of major crops (matched by scientific name);
generic category defaults otherwise (see engine/aquacrop.py).
"""

from __future__ import annotations

import csv
import os
import re

_DB_PATH = os.path.join(os.path.dirname(__file__), "db", "EcoCrop_DB.csv")

_cache: list[dict] | None = None

# --------------------------- FAO-56 Table 12 single-crop Kc values --------
# matched by lowercase substring of the scientific name
_KC_TABLE = [
    # (match substring, Kc_ini, Kc_mid, Kc_end, cycle_override_days)
    ("triticum", 0.70, 1.15, 0.35, 130),      # wheat
    ("zea mays", 0.40, 1.20, 0.60, 130),      # maize (grain)
    ("oryza", 1.05, 1.20, 0.90, 120),         # rice
    ("hordeum", 0.70, 1.15, 0.35, 130),       # barley
    ("avena", 0.70, 1.15, 0.35, 130),         # oats
    ("sorghum", 0.70, 1.10, 0.55, 130),       # sorghum (grain)
    ("panicum", 0.70, 1.10, 0.55, 130),       # pearl/broom millet proxies
    ("glycine max", 0.70, 1.15, 0.50, 140),   # soybean
    ("phaseolus", 0.70, 1.05, 0.90, 100),     # dry bean
    ("pisum", 0.70, 1.15, 1.10, 100),         # pea
    ("arachis", 0.70, 1.15, 0.60, 140),       # groundnut
    ("vicia", 0.70, 1.15, 0.35, 120),         # faba bean
    ("cicer", 0.70, 1.05, 0.35, 120),         # chickpea
    ("lens", 0.70, 1.05, 0.35, 110),          # lentil
    ("medicago sativa", 0.70, 1.20, 1.15, 0), # alfalfa (perennial, cut)
    ("solanum tuberosum", 0.70, 1.15, 0.75, 135),  # potato
    ("solanum lycopersicum", 0.60, 1.15, 0.80, 135),  # tomato
    ("capsicum", 0.60, 1.05, 0.90, 125),      # pepper
    ("allium cepa", 0.70, 1.05, 0.75, 110),   # onion
    ("brassica oleracea", 0.70, 1.05, 0.95, 135),  # cabbage/broccoli
    ("lactuca", 0.70, 1.00, 0.95, 80),        # lettuce
    ("daucus", 0.70, 1.05, 0.95, 110),        # carrot
    ("cucumis", 0.60, 1.00, 0.75, 110),       # cucumber
    ("cucurbita", 0.60, 1.00, 0.80, 120),     # squash/pumpkin
    ("citrullus", 0.60, 1.05, 0.75, 110),     # watermelon
    ("helianthus", 0.70, 1.20, 0.35, 135),    # sunflower
    ("gossypium", 0.70, 1.20, 0.70, 180),     # cotton
    ("beta vulgaris", 0.80, 1.20, 0.70, 180), # sugar beet
    ("manihot", 0.70, 1.10, 0.50, 0),         # cassava
    ("nicotiana", 0.70, 1.00, 0.90, 130),     # tobacco
]

# category keyword -> Kc defaults (FAO-56 representative values)
_CAT_KC = {
    "cereals": (0.70, 1.15, 0.40),
    "legumes": (0.70, 1.10, 0.45),
    "vegetables": (0.65, 1.05, 0.85),
    "roots": (0.70, 1.10, 0.70),
    "oil": (0.70, 1.15, 0.40),
    "fibre": (0.70, 1.15, 0.70),
    "forage": (0.70, 1.15, 1.05),
    "stims": (0.70, 1.10, 0.60),   # sugar/stimulant crops
}


import math


def _num(x: str) -> float | None:
    """Parse a numeric CSV field; NA/-999 sentinel -> None."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return None if (math.isnan(v) or v < -900) else v


def load_ecocrop() -> list[dict]:
    """Load and normalise the EcoCrop DB (cached in memory)."""
    global _cache
    if _cache is not None:
        return _cache
    crops = []
    with open(_DB_PATH, newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            def g(k, d=None):
                v = _num(row.get(k, ""))
                return d if v is None else v
            fam_raw = row.get("FAMNAME", "") or ""
            crops.append({
                "key": re.sub(r"\s+", "-", row.get("ScientificName", "crop").lower()),
                "scientific_name": row.get("ScientificName", ""),
                "comname": (row.get("COMNAME", "") or "")[:120],
                "category": row.get("CAT", "") or "",
                "lifecycle": (row.get("LISPA", "") or "").lower(),  # annual/perennial
                "family": fam_raw,
                "botanical_family": fam_raw.strip().split(":")[-1] if fam_raw else "unknown",
                "tmin": g("TMIN", 0.0), "tmax": g("TMAX", 40.0),
                "topmn": g("TOPMN", 15.0), "topmx": g("TOPMX", 30.0),
                "ktmp": g("KTMP", None),
                "rmin": g("RMIN", 0.0), "rmax": g("RMAX", 3000.0),
                "ropmn": g("ROPMN", 300.0), "ropmx": g("ROPMX", 1200.0),
                "phmin": g("PHMIN", 3.5), "phmax": g("PHMAX", 9.5),
                "phopmn": g("PHOPMN", 5.5), "phopmx": g("PHOPMX", 7.5),
                "dep": row.get("DEP", "") or "",
                "text": row.get("TEXT", "") or "",
                "textr": row.get("TEXTR", "") or "",
                "sal": row.get("SAL", "") or "",
                "gmin": int(g("GMIN", 60) or 60),
                "gmax": int(g("GMAX", 180) or 180),
            })
    _cache = crops
    return crops


def crop_water_params(crop: dict) -> dict:
    """Return (kc_ini, kc_mid, kc_end, cycle) for a crop:
    FAO-56 Table 12 for curated crops, category defaults otherwise.
    Cycle length comes from EcoCrop GMIN/GMAX midpoint."""
    sn = crop.get("scientific_name", "").lower()
    kc = None
    for sub, ini, mid, end, cyc in _KC_TABLE:
        if sub in sn:
            cycle = cyc or max(60, round(0.5 * (crop["gmin"] + crop["gmax"])))
            kc = {"kc_ini": ini, "kc_mid": mid, "kc_end": end, "cycle": cycle}
            break
    if kc is None:
        cat = (crop.get("category") or "").lower()
        ini, mid, end = (0.70, 1.10, 0.50)
        for k, v in _CAT_KC.items():
            if k in cat:
                ini, mid, end = v
                break
        cycle = max(60, round(0.5 * (crop["gmin"] + crop["gmax"])))
        kc = {"kc_ini": ini, "kc_mid": mid, "kc_end": end, "cycle": cycle}
    return kc


def functional_group_of(crop: dict) -> str:
    from ..engine.rotation import functional_group
    return functional_group(crop)


def search(query: str, limit: int = 400) -> list[dict]:
    q = (query or "").lower().strip()
    crops = load_ecocrop()
    if not q:
        return crops[:limit]
    out = [c for c in crops if q in c["scientific_name"].lower()
           or q in (c["comname"] or "").lower()]
    return out[:limit]
