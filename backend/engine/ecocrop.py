"""
ecocrop.py -- FAO EcoCrop climatic suitability, exact OpenCLIM formulation.

Reference implementation (transcribed from the OpenCLIM/ecocrop repository,
https://github.com/OpenCLIM/ecocrop, MJB 19/3/24, OGL v3; scientific paper:
"Ecocrop suitability scoring", doi:10.1002/cli2.70007; database: FAO EcoCrop,
https://gaez.fao.org/pages/ecocrop).

The model scores temperature suitability S_T and precipitation suitability
S_P (each 0..100) for a crop over candidate growing windows of GTIME days,
and the combined daily suitability is S = min(S_T, S_P) -- "the lowest score
is likely to be the limiting factor in the crop's growth".

Crop parameters used (columns of EcoCrop_DB.csv):
    TMIN  TMAX   absolute minimum / maximum mean temperature (deg C)
    TOPMN TOPMX  optimal minimum / maximum temperature (deg C)
    KTMP         killing temperature (deg C, daily min below -> death)
    RMIN  RMAX   absolute minimum / maximum total precip (mm) over window
    ROPMN ROPMX  optimal min / max precip (mm) over window
    GMIN  GMAX   minimum / maximum crop cycle length (days)
    TEXT/TEXTR   soil texture tolerance (handled in soil.py)
"""

from __future__ import annotations

from dataclasses import dataclass, field


def _linear(x: float, x0: float, x1: float) -> float:
    """Linear ramp from 0 at x0 to 1 at x1 (clipped to [0,1])."""
    if x1 == x0:
        return 1.0 if x > x0 else 0.0
    return max(0.0, min(1.0, (x - x0) / (x1 - x0)))


def daily_temp_score(tmean: float, tmin_abs: float, topmin: float,
                     topmax: float, tmax_abs: float) -> float:
    """OpenCLIM annual-method daily intermediate score D in [0,1]:

        D = (T - TMIN)/(TOPMN - TMIN)   when  TMIN < T < TOPMN
        D = 1                            when  TOPMN <= T <= TOPMX
        D = (TMAX - T)/(TMAX - TOPMX)   when  TOPMX < T < TMAX
        D = 0                            otherwise
    """
    if tmin_abs < tmean < topmin:
        return _linear(tmean, tmin_abs, topmin)
    if topmin <= tmean <= topmax:
        return 1.0
    if topmax < tmean < tmax_abs:
        return _linear(-tmean, -tmax_abs, -topmax)  # = (TMAX-T)/(TMAX-TOPMX)
    return 0.0


def precip_score(ptot: float, rmin: float, ropmn: float, ropmx: float,
                 rmax: float) -> float:
    """OpenCLIM precipitation suitability S_P in [0,100] for a window total:

        S_P = 100 * (PTOT - RMIN) / (0.5(ROPMN+ROPMX) - RMIN)   below optimum
        S_P = 100 * (RMAX - PTOT) / (RMAX - 0.5(ROPMN+ROPMX))   above optimum
        S_P = 0                                                  otherwise
    """
    mid = 0.5 * (ropmn + ropmx)
    if rmin < ptot < mid:
        return 100.0 * _linear(ptot, rmin, mid)
    if mid <= ptot < rmax:
        return 100.0 * (rmax - ptot) / (rmax - mid) if rmax > mid else 0.0
    if ropmn <= ptot <= ropmx:
        return 100.0
    return 0.0


@dataclass
class EcoCropParams:
    name: str = ""
    tmin: float = 0.0
    tmax: float = 40.0
    topmn: float = 15.0
    topmx: float = 30.0
    ktmp: float | None = None
    rmin: float = 0.0
    rmax: float = 3000.0
    ropmn: float = 300.0
    ropmx: float = 1200.0
    gmin: int = 60
    gmax: int = 180
    perennial: bool = False
    raw: dict = field(default_factory=dict)


def temperature_suitability_window(
    tmeans: list[float], tmins: list[float], tmaxs: list[float],
    p: EcoCropParams,
) -> tuple[float, int]:
    """OpenCLIM annual-method S_T for ONE window of GTIME = len(tmeans) days.

    Returns (S_T in [0,100], frost_flag) where frost_flag = 1 if any daily
    minimum was below KTMP (S_T returned is already 0 in that case).

    Steps (verbatim method):
      N_D = sum over window of D(tmean_day)            (suitable-day count)
      if N_D >= GMIN:
          S_T = 100 * [1 - (GTIME - GMIN) / (GMAX - GMIN)]
      else:
          S_T = 0
      frost penalty:  any daily tmin < KTMP  ->  S_T = 0
      heat penalty :  S_T -= #{ days with daily tmax > TMAX }
    """
    gtime = len(tmeans)
    n_d = 0.0
    frost = False
    heat_days = 0
    for tm, tn, tx in zip(tmeans, tmins, tmaxs):
        n_d += daily_temp_score(tm, p.tmin, p.topmn, p.topmx, p.tmax)
        if p.ktmp is not None and tn < p.ktmp:
            frost = True
        if tx > p.tmax:
            heat_days += 1

    if n_d < p.gmin:
        s_t = 0.0
    else:
        denom = max(1, p.gmax - p.gmin)
        s_t = 100.0 * (1.0 - (gtime - p.gmin) / denom)
        s_t = max(0.0, s_t)

    if frost and s_t > 0:
        s_t = 0.0
    s_t = max(0.0, s_t - heat_days)

    return s_t, 1 if frost else 0


def perennial_temperature_suitability_window(
    tmeans: list[float], tmins: list[float], tmaxs: list[float],
    p: EcoCropParams,
) -> tuple[float, int]:
    """OpenCLIM perennial-method S_T: scored on the window MEAN temperature."""
    import statistics as st
    tavg = st.fmean(tmeans)
    mid = 0.5 * (p.topmx + p.topmn)
    if p.tmin < tavg < mid:
        s_t = (100.0 / (mid - p.tmin)) * (tavg - p.tmin)
    elif mid <= tavg < p.tmax:
        s_t = (100.0 / (p.tmax - mid)) * (p.tmax - tavg)
    else:
        s_t = 0.0
    s_t = max(0.0, min(100.0, s_t))

    frost = any(tn < (p.ktmp if p.ktmp is not None else -999) for tn in tmins)
    heat_days = sum(1 for tx in tmaxs if tx > p.tmax)
    if frost:
        s_t = 0.0
    s_t = max(0.0, s_t - heat_days)
    return s_t, 1 if frost else 0


def combined_suitability(
    daily_data: dict,
    p: EcoCropParams,
    start_day: int = 0,
    end_day: int | None = None,
    step: int = 10,
) -> dict:
    """Scan candidate sowing dates (windows of GTIME days) over the cached
    daily NASA POWER record and return the BEST achievable suitability
    (max over windows), mirroring the OpenCLIM "max over GTIMEs" aggregation
    plus their 10-day stepping strategy.

    Parameters
    ----------
    daily_data : {"tmean": [...], "tmin": [...], "tmax": [...], "prec": [...]}
                 lists of daily values (deg C, mm) over a full year.
    p          : EcoCropParams for the crop.
    start/end  : index bounds in the daily arrays (e.g. one season).

    Returns
    -------
    {"score": best min(S_T,S_P) in [0,100],
     "sowing_day": index of best window start,
     "window_len": GTIME of best window,
     "s_t": best temperature score, "s_p": precipitation score at that window}
    """
    n = len(daily_data["tmean"])
    end = end_day if end_day is not None else n
    gtimes = list(range(max(int(p.gmin), 20), min(int(p.gmax), 365) + 1, step))
    if not gtimes or gtimes[-1] != min(p.gmax, 365):
        gtimes.append(min(int(p.gmax), 365))

    best = {"score": -1.0, "sowing_day": None, "window_len": None,
            "s_t": 0.0, "s_p": 0.0}
    best_temp = {"s_t": -1.0, "sowing_day": None, "window_len": None,
                 "s_p_at_temp_best": 0.0}

    score_fn = (perennial_temperature_suitability_window
                if p.perennial else temperature_suitability_window)

    for i in range(start_day, end - int(p.gmin) + 1):
        for gtime in gtimes:
            j = i + gtime
            if j > n:
                break
            win = slice(i, j)
            s_t, _ = score_fn(
                daily_data["tmean"][win], daily_data["tmin"][win],
                daily_data["tmax"][win], p,
            )
            ptot = sum(daily_data["prec"][win])
            s_p = precip_score(ptot, p.rmin, p.ropmn, p.ropmx, p.rmax)
            s = min(s_t, s_p)
            if s > best["score"]:
                best = {"score": s, "sowing_day": i, "window_len": gtime,
                        "s_t": s_t, "s_p": s_p}
            if s_t > best_temp["s_t"]:
                best_temp = {"s_t": s_t, "sowing_day": i, "window_len": gtime,
                             "s_p_at_temp_best": s_p}
    if best["score"] < 0:
        best["score"] = 0.0
        best["sowing_day"] = None
    if best_temp["s_t"] < 0:
        best_temp["s_t"] = 0.0
    best["s_t_best"] = best_temp["s_t"]
    best["sowing_day_temp"] = best_temp["sowing_day"]
    best["window_len_temp"] = best_temp["window_len"]
    return best
