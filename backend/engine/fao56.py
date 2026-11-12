"""
fao56.py -- FAO-56 crop water requirement module.

Implements (Allen et al., 1998, FAO Irrigation & Drainage Paper 56,
https://www.fao.org/4/x0490e/x0490e00.htm):

  1. Reference evapotranspiration ET0  -- FAO-56 Penman-Monteith:
         ET0 = [0.408 * D * (Rn - G) + g * (900/(T+273)) * u2 * (es - ea)]
               / (D + g * (1 + 0.34 * u2))
     plus the Hargreaves-Samani temperature-only fallback:
         ET0 = 0.0023 * Ra * (Tmax - Tmin)^0.5 * (Tmean + 17.8)

  2. Crop evapotranspiration under standard conditions:
         ETc = Kc * ET0
     with the FAO-56 Kc trapezoid through initial / mid / late stage values.

  3. Net irrigation requirement (simplified seasonal form):
         NIR = max(0, sum(ETc) - sum(Pe))
     where Pe is effective rainfall (Dastane 1978 "80% rule", used in FAO
     irrigation planning where a daily soil-water balance is unavailable).

All inputs come from NASA POWER daily point data:
    T2M, T2M_MAX, T2M_MIN (deg C), RH2M (%), WS2M (m/s),
    ALLSKY_SFC_SW_DWN (MJ m-2 day-1), PRECTOTCORR (mm/day).
"""

from __future__ import annotations

import math

ALBEDO = 0.23           # reference grass albedo -> Rns = (1-0.23)*Rs
SIGMA = 4.903e-9        # Stefan-Boltzmann, MJ K-4 m-2 day-1
G_SOIL = 0.0            # daily soil heat flux approximation (FAO-56 Eq. 42)


# ---------------------------------------------------------------- extras ---

def saturation_vapour_pressure(t: float) -> float:
    """es(T) = 0.6108 * exp(17.27 T / (T + 237.3))  [kPa]  (FAO-56 Eq. 11)."""
    return 0.6108 * math.exp(17.27 * t / (t + 237.3))


def extraterrestrial_radiation(lat_deg: float, doy: int) -> float:
    """Daily extraterrestrial radiation Ra [MJ m-2 day-1] (FAO-56 Eq. 21)."""
    phi = math.radians(lat_deg)
    dr = 1 + 0.033 * math.cos(2 * math.pi * doy / 365)
    decl = 0.409 * math.sin(2 * math.pi * doy / 365 - 1.39)
    x = -math.tan(phi) * math.tan(decl)
    x = max(-1.0, min(1.0, x))
    ws = math.acos(x)
    ra = (24 * 60 / math.pi) * 0.0820 * dr * (
        ws * math.sin(phi) * math.sin(decl)
        + math.cos(phi) * math.cos(decl) * math.sin(ws)
    )
    return max(0.0, ra)


# --------------------------------------------------------- ET0 equations ---

def et0_penman_monteith(tmean: float, tmax: float, tmin: float, rh: float,
                        u2: float, rs: float, ra: float, altitude: float = 0.0
                        ) -> float:
    """FAO-56 Penman-Monteith daily ET0 [mm/day] with full input set.

    tmean/tmax/tmin deg C; rh % ; u2 m/s at 2 m ; rs & ra MJ m-2 day-1 ;
    altitude m.
    """
    # Saturation & actual vapour pressure (FAO-56 Eq. 11, 12, 17)
    es = 0.5 * (saturation_vapour_pressure(tmax) + saturation_vapour_pressure(tmin))
    ea = (rh / 100.0) * saturation_vapour_pressure(tmean)

    # Atmospheric pressure & psychrometric constant (Eq. 7, 8)
    p = 101.3 * ((293 - 0.0065 * altitude) / 293) ** 5.26
    gamma = 0.000665 * p

    # Slope of saturation vapour pressure curve (Eq. 13)
    delta = 4098 * (0.6108 * math.exp(17.27 * tmean / (tmean + 237.3))) / \
        ((tmean + 237.3) ** 2)

    # Net radiation (Eq. 38-40)
    rns = (1 - ALBEDO) * rs
    rnl = SIGMA * (((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2) * \
        (0.34 - 0.14 * math.sqrt(max(ea, 0.0))) * \
        (1.35 * min(rs / max(ra, 1e-6), 1.0) - 0.35)
    rn = rns - rnl

    u2c = max(0.0, u2)
    num = 0.408 * delta * (rn - G_SOIL) + gamma * (900 / (tmean + 273)) * u2c * max(es - ea, 0.0)
    den = delta + gamma * (1 + 0.34 * u2c)
    et0 = num / den
    return max(0.0, et0)


def et0_hargreaves(tmean: float, tmax: float, tmin: float, ra: float) -> float:
    """Hargreaves-Samani ET0 [mm/day] (FAO-56 Eq. 52) - temp-only fallback."""
    if ra <= 0:
        return 0.0
    return max(0.0, 0.0023 * ra * math.sqrt(max(tmax - tmin, 0.0)) * (tmean + 17.8))


# ------------------------------------------------------------- Kc curve ---

def kc_by_stage(das: int, cycle: int, kc_ini: float, kc_mid: float,
                kc_end: float, ini_len: float = 0.15, dev_len: float = 0.20,
                mid_len: float = 0.40) -> float:
    """FAO-56 stage-trapezoid Kc at `das` days after sowing for a `cycle`-day
    crop. Stage fractions default to FAO-56 typical proportions of the cycle:
    initial 15%, development 20%, mid 40%, late 25%.
    Linear Kc interpolation during development & late stages (FAO-56 Fig. 34).
    """
    cycle = max(1, cycle)
    n_ini = max(1, round(cycle * ini_len))
    n_dev = max(1, round(cycle * dev_len))
    n_mid = max(1, round(cycle * mid_len))
    n_late = max(1, cycle - n_ini - n_dev - n_mid)

    if das <= 0:
        return kc_ini
    if das < n_ini:
        return kc_ini
    if das < n_ini + n_dev:
        f = (das - n_ini) / n_dev
        return kc_ini + f * (kc_mid - kc_ini)
    if das < n_ini + n_dev + n_mid:
        return kc_mid
    f = (das - (n_ini + n_dev + n_mid)) / n_late
    return kc_mid + f * (kc_end - kc_mid)


# -------------------------------------------------- water requirements ----

def effective_rainfall(p: float) -> float:
    """Effective rainfall Pe [mm] (Dastane, 1978 -- FAO '80% rule', documented
    approximation for seasonal water-balance screening):
        Pe = 0.8 P            for P <  75 mm
        Pe = 0.6 P + 15       for P >= 75 mm
    """
    if p < 75:
        return 0.8 * p
    return 0.6 * p + 15.0


def water_requirement_summary(
    et0_series: list[float],
    prec_series: list[float],
    cycle: int,
    kc_ini: float, kc_mid: float, kc_end: float,
    sowing_day: int = 0,
) -> dict:
    """Seasonal water balance for one crop cycle.

    Returns total ETc, total effective rainfall, net irrigation requirement
    NIR = max(0, sum(ETc) - sum(Pe)) [mm] and the mean Kc-weighted ET0.
    """
    n = len(et0_series)
    das_max = min(cycle, n - sowing_day)
    etc_total = 0.0
    kc_sum = 0.0
    for k in range(das_max):
        kc = kc_by_stage(k, cycle, kc_ini, kc_mid, kc_end)
        et0 = et0_series[sowing_day + k]
        etc_total += kc * et0
        kc_sum += kc
    et0_window = sum(et0_series[sowing_day: sowing_day + das_max])
    p_window = sum(prec_series[sowing_day: sowing_day + das_max])
    pe = effective_rainfall(p_window)
    nir = max(0.0, etc_total - pe)
    return {
        "etc_total_mm": round(etc_total, 1),
        "et0_window_mm": round(et0_window, 1),
        "effective_rain_mm": round(pe, 1),
        "nir_mm": round(nir, 1),
        "mean_kc": round(kc_sum / max(1, das_max), 3),
        "days": das_max,
    }
