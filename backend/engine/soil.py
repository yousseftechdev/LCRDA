"""
soil.py -- Soil suitability scoring from SoilGrids properties + EcoCrop
soil requirements.

EcoCrop database soil fields used:
    PHMIN / PHMAX       absolute pH tolerance
    PHOPMN / PHOPMX     optimal pH range
    DEP / DEPR          rooting-depth tolerance class
    TEXT / TEXTR        optimal / absolute soil texture classes
                        ("heavy", "medium", "light", "organic", ...)
    SAL / SALR          salinity tolerance class

Soil data come from the ISRIC SoilGrids 2.0 REST API:
    phh2o (pH*10), sand, clay, soc (g/kg -> %), bdod, ... at standard depths
    0-5, 5-15, 15-30, 30-60, 60-100 cm.

Aggregation is a weighted mean of per-property suitability scores (as
proposed in the team's Resources.md note):

    S_soil = sum_j w_j * S_j ,   sum_j w_j = 1

This aggregation is a DESIGN CHOICE of the system (documented, not a
universal law) -- the per-property membership functions below follow the
EcoCrop requirement ranges directly (trapezoid membership between absolute
and optimal ranges, exactly analogous to the EcoCrop climate trapezoids).
"""

from __future__ import annotations

import math

# SoilGrids texture -> EcoCrop texture-class name mapping by clay+ sand.
# USDA triangle simplification used here:
#   heavy  = clay > 35%
#   medium = sand 30-55% and clay 15-35% (loams)
#   light  = sand > 55% (sandy)
#   organic = soc > 12% approx
def texture_class(sand_pct: float, clay_pct: float, soc_pct: float) -> str:
    if soc_pct > 12:
        return "organic"
    if clay_pct > 35:
        return "heavy"
    if sand_pct > 55:
        return "light"
    return "medium"


def ph_score(ph: float, phmin: float, phmax: float, phopmn: float,
             phopmx: float) -> float:
    """Trapezoid membership: 1 inside optimal pH range, linear ramp to 0 at
    the absolute limits PHMIN/PHMAX (EcoCrop ranges)."""
    if phmin <= ph <= phmax:
        if phopmn <= ph <= phopmx:
            return 1.0
        if ph < phopmn:
            return max(0.0, (ph - phmin) / max(phopmn - phmin, 1e-9))
        return max(0.0, (phmax - ph) / max(phmax - phopmx, 1e-9))
    return 0.0


def texture_score(sand_pct: float, clay_pct: float, soc_pct: float,
                  text_opt: str, textr_abs: str) -> float:
    """1.0 if the soil texture class is in the crop's optimal list,
    0.5 if in the absolute tolerance list, else 0.
    `text_opt`/`textr_abs` are comma-separated EcoCrop class strings."""
    cls = texture_class(sand_pct, clay_pct, soc_pct)
    opt = {t.strip().lower() for t in (text_opt or "").split(",")}
    absr = {t.strip().lower() for t in (textr_abs or "").split(",")}
    if cls in opt:
        return 1.0
    if cls in absr:
        return 0.5
    return 0.0


def depth_score(depth_opt: str, soil_depth_cm: float) -> float:
    """Score rooting-depth fit. EcoCrop DEP values like 'shallow (20-50 cm)',
    'moderate (50-150 cm)', 'deep (150 cm)'."""
    lo, hi = parse_depth_range(depth_opt)
    need = 0.5 * (lo + hi)
    if soil_depth_cm >= need:
        return 1.0
    # linear ramp from 0 at half the requirement to 1 at full requirement
    return max(0.0, min(1.0, soil_depth_cm / max(need, 1e-9) / 1.0 - 0.0))


def parse_depth_range(dep: str) -> tuple[float, float]:
    s = (dep or "").lower()
    digits = "".join(ch if ch.isdigit() or ch in "()-" else " " for ch in s)
    nums = [int(x) for x in digits.replace("(", " ").replace(")", " ").split()
            if x.isdigit()]
    if len(nums) >= 2:
        return float(nums[0]), float(nums[1])
    if len(nums) == 1:
        if "deep" in s and "shallow" not in s:
            return 150.0, 150.0
        return nums[0], nums[0]
    return 50.0, 50.0


def salinity_score(sal: float, sal_class: str) -> float:
    """EcoCrop SAL classes: 'low (<4 dS/m)', 'moderate (4-10 dS/m)',
    'high (>10 dS/m)'. SoilGrids does not publish ECe; if the user provides
    measured soil salinity (dS/m) we trapezoid-score it against the class."""
    low = "low" in (sal_class or "").lower()
    mod = "moderate" in (sal_class or "").lower()
    high = "high" in (sal_class or "").lower()
    if low:
        return 1.0 if sal <= 4 else max(0.0, 1 - (sal - 4) / 6)
    if mod:
        return 1.0 if 4 <= sal <= 10 else max(0.0, 1 - abs(sal - 7) / 7)
    if high:
        return 1.0 if sal >= 10 else max(0.0, sal / 10)
    return 1.0  # unknown -> neutral


def soil_suitability(
    crop_soil: dict,
    soilgrids: dict,
    soil_depth_cm: float = 100.0,
    measured_ph: float | None = None,
    measured_salinity: float | None = None,
    weights: dict | None = None,
) -> dict:
    """Weighted aggregation of per-property soil suitability scores.

    Parameters
    ----------
    crop_soil  : {"phmin","phmax","phopmn","phopmx","dep","text","textr","sal"}
    soilgrids  : {"ph","sand","clay","soc"}  -- percent/pH units
                 (mean over the root-zone depths 0-60cm)
    weights    : optional overrides for the aggregation weights

    Returns {"score": [0,1], "parts": {property: score}, "texture_class": str}
    """
    ph = measured_ph if measured_ph is not None else soilgrids.get("ph")
    sand = soilgrids.get("sand")
    clay = soilgrids.get("clay")
    soc = soilgrids.get("soc", 0.0)

    parts = {}
    if ph is not None:
        parts["ph"] = ph_score(
            ph, crop_soil.get("phmin", 3.5), crop_soil.get("phmax", 9.5),
            crop_soil.get("phopmn", 5.5), crop_soil.get("phopmx", 7.5))
    if sand is not None and clay is not None:
        parts["texture"] = texture_score(
            sand, clay, soc, crop_soil.get("text", ""), crop_soil.get("textr", ""))
        parts["depth"] = depth_score(crop_soil.get("dep", ""), soil_depth_cm)
    if measured_salinity is not None:
        parts["salinity"] = salinity_score(measured_salinity, crop_soil.get("sal", ""))

    w = {"ph": 0.4, "texture": 0.3, "depth": 0.2, "salinity": 0.1}
    if weights:
        w.update(weights)

    used = {k: v for k, v in w.items() if k in parts}
    tot = sum(used.values())
    if tot <= 0:
        return {"score": None, "parts": parts, "texture_class": None}
    score = sum(parts[k] * used[k] for k in parts) / tot
    tcls = texture_class(sand or 40, clay or 25, soc or 0) if sand is not None else None
    return {"score": round(score, 4), "parts": parts, "texture_class": tcls,
            "weights_used": used}
