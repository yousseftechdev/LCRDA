"""
aquacrop.py -- Simplified FAO AquaCrop yield response to water.

Core equation (Steduto et al. 2009, doi:10.2134/agronj2008.0139s;
Raes et al. 2009; FAO AquaCrop Reference Manual ch. 1):

    B = WP* * sum_i (Tr_i / ET0_i)          (above-ground biomass, g/m2)
    Y = HI * B                              (harvestable yield)

WP* is the NORMALIZED biomass water productivity (normalized for
atmospheric evaporative demand and CO2, reference 369.41 ppm), a
CONSERVATIVE crop parameter:
    C4 crops: WP* ~ 30-35 g/m2  (maize default 33.7)
    C3 crops: WP* ~ 15-20 g/m2
HI is the reference harvest index (fraction of B that is harvestable).

In this simplified hub implementation, with no daily canopy/water-stress
simulation, transpiration is estimated from the FAO-56 Kc curve:
    Tr_i ~ ETc_i * (1 - f_e)     with f_e ~ 0.30 soil-evaporation share
    (Kc includes both transpiration and evaporation; AquaCrop's growth
    engine uses transpiration only -- the 0.3 deduction is the documented
    simplification, appropriate for screening/ranking purposes.)

The result is a screening-level yield estimate used as one MCDM criterion,
NOT a calibrated simulation (documented limitation; full AquaCrop should be
used if a reliable yield forecast is required).
"""

from __future__ import annotations

# WP* by functional group (g biomass per m2 per mm-normalized transpiration)
WP_STAR = {
    "c4_cereal": 33.7,   # maize, sorghum, sugarcane (AquaCrop default 33.7)
    "c3_cereal": 17.0,   # wheat, rice, barley, oats (FAO range 15-20)
    "legume": 15.0,      # soybean, bean, pea, lentil, groundnut
    "tuber": 18.0,       # potato, sweet potato, cassava
    "vegetable": 15.0,   # tomato, onion, cabbage...
    "oil": 16.0,         # sunflower, canola, sesame
    "fiber": 18.0,       # cotton
    "forage": 17.0,      # alfalfa, clover (multi-cut)
    "other": 16.0,
}

# Reference harvest indices (fraction; FAO-56 Table 17 / AquaCrop HIo)
HI0 = {
    "c4_cereal": 0.45,
    "c3_cereal": 0.45,
    "legume": 0.35,
    "tuber": 0.70,       # potato HIo ~ 0.7-0.9 in AquaCrop
    "vegetable": 0.30,
    "oil": 0.30,
    "fiber": 0.25,
    "forage": 0.90,      # biomass harvest
    "other": 0.40,
}


def estimate_yield(
    sum_tr_over_et0: float,
    functional_group: str,
    co2_ppm: float = 369.41,
) -> dict:
    """B = WP* * sum(Tr/ET0) [g/m2];  Y = HI * B [t/ha].

    co2_ppm: WP* is defined at 369.41 ppm; AquaCrop applies a CO2 correction
    factor fCO2 for other concentrations. We implement the documented
    linear-ish default: fCO2 = 1 + (co2 - 369.41)/1000 * 0.000138*1000
    -- i.e. the AquaCrop default correlation fCO2 = (Ca/Ca0)^(1.1) is
    approximated by a linear relative increase for screening purposes.
    """
    fco2 = 1.0 + 0.000138 * (co2_ppm - 369.41)
    wp = WP_STAR.get(functional_group, WP_STAR["other"]) * max(fco2, 0.5)
    hi = HI0.get(functional_group, HI0["other"])
    b = wp * max(0.0, sum_tr_over_et0)          # g/m2
    y_t_ha = b * hi * 0.01                       # g/m2 -> t/ha (x10^-2)
    return {
        "biomass_g_m2": round(b, 1),
        "yield_t_ha": round(y_t_ha, 2),
        "wp_star": round(wp, 2),
        "hi": hi,
        "fco2": round(fco2, 4),
    }


def sum_tr_over_et0(
    et0_series: list[float], cycle: int, kc_ini: float, kc_mid: float,
    kc_end: float, sowing_day: int = 0, evap_share: float = 0.30,
) -> float:
    """sum over the cycle of Tr/ET0 = sum of Kc(day) * (1 - evap_share)."""
    from .fao56 import kc_by_stage
    n = len(et0_series)
    das_max = min(cycle, n - sowing_day)
    s = 0.0
    for k in range(das_max):
        kc = kc_by_stage(k, cycle, kc_ini, kc_mid, kc_end)
        s += kc * (1.0 - evap_share)
    return s
