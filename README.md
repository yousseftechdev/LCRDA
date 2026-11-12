# MCDM Crop Rotation Decision-Aid Hub

A **decision-support hub for smallholder farmers** (NASA Space Apps Challenge
2026 — crop rotation challenge). Runs on a **Raspberry Pi 4**, serves a web
interface over the **local network**, pulls **NASA POWER satellite data** and
**ISRIC SoilGrids** soil data, stores them **locally (24-hour cache)**, and
keeps working **offline** — built for farmers with no internet access.

## The algorithm (MCDM)

The hub implements **Multi-Criteria Decision Making (MCDM)** inside a
a Decision Support System, following Gunawan, Sitopu & Sechan (2024),
*International Journal of Enterprise Modelling* 18(3):113–123. The core
objective is the Simple Additive Weighting model:

    Z_i = Σ_j  w_j · c_ij      →  choose crop i with the maximum Z

where `c_ij` is crop *i*'s score on criterion *j* (all in [0,1]) and the
weights `w_j` come from **AHP** (Saaty) applied to the farmer's priorities,
validated with the consistency ratio CR ≤ 0.10. **TOPSIS** is computed as an
independent verification ranking.

## Criteria (all scientifically sourced)

| Criterion      | Model                                            | Source |
|----------------|--------------------------------------------------|--------|
| Climate fit    | FAO EcoCrop suitability, exact OpenCLIM formulation: piecewise temperature scoring with GMIN/GMAX growing-day accumulation, frost (KTMP) & heat penalties, precipitation trapezoid, **S = min(S_T, S_P)** | FAO EcoCrop DB + OpenCLIM/ecocrop (doi:10.1002/cli2.70007) |
| Soil fit       | pH/texture/depth trapezoids vs EcoCrop soil ranges, weighted mean | ISRIC SoilGrids 2.0 + EcoCrop |
| Water adequacy | FAO-56: ET₀ (Penman–Monteith, Hargreaves fallback), ETc = Kc·ET₀, NIR = max(0, ΣETc − ΣPe) | Allen et al. 1998 (FAO-56) |
| Yield          | Simplified AquaCrop: B = WP*·Σ(Tr/ET₀), Y = HI·B | Steduto et al. 2009 |
| Rotation fit   | Botanical-family rule, legume N-credit, pre-crop effects | Fenz et al. 2023; Smith et al. 2023 |
| Market demand  | Farmer-entered, four plain choices (Hard to sell / Average / Good / Sells fast → 0.2–1.0) | — |

Multi-season rotation planning uses **exact dynamic programming** over the
transition-score matrix (same-family transitions forbidden), not greedy
search.

## Run it

```bash
bash scripts/install.sh      # one-time: creates venv (numpy), installs the
                             # systemd service that keeps the hub running
                             # and auto-refreshes NASA data every 24 h
# no sudo? use: bash scripts/install.sh --user
# run in the foreground instead:  bash scripts/run.sh
```

Open `http://<pi-ip>:8000` from any phone or laptop on the farm network.
First use fetches one NASA POWER request + one SoilGrids request for the farm
location, then caches them (NASA refreshed every 24 h by a background
refresher; everything else works offline). Respect NASA's fair-use rule:
**one request per 0.5° cell** — the hub caches hard.

## Layout

```
run.py                  entry point
backend/
  engine/               mcdm.py (AHP+SAW+TOPSIS), ecocrop.py, fao56.py,
                        soil.py, aquacrop.py, rotation.py
  data/                 power.py (NASA POWER client), soilgrids.py (ISRIC),
                        crops.py (FAO EcoCrop DB loader, 2568 crops, + FAO-56 Kc)
  storage.py            SQLite cache (24 h TTL, offline-first)
  app.py                recommendation pipeline orchestrator
  server.py             stdlib HTTP server + JSON API + 24 h refresher thread
frontend/               farmer-friendly web UI (plain language, no math,
                        no emojis, SVG favicon, NASA/FAO/ISRIC attribution)
tests/test_mcdm.py      35 tests; reproduces the paper's numerical example
docs/                   technical report (PDF) + generator
scripts/                install.sh (venv + systemd), run.sh
systemd/                lcrda.service (auto-restart service)
```

## Validation

`python3 tests/test_mcdm.py` — the MCDM core **exactly reproduces** the
source paper's worked example (crops A/B/C → Z = 0.76 / 0.69 / 0.63, winner
A), plus unit tests for every engine equation and a brute-force optimality
check of the rotation planner.

## Credits & licenses

- FAO EcoCrop database (via OpenCLIM/ecocrop, Open Government Licence v3)
- NASA POWER (public domain), ISRIC SoilGrids (CC-BY-4.0)
- FAO-56 & AquaCrop methodology (FAO)
- MCDM formulation: Gunawan et al. 2024; AHP: Saaty 1980; TOPSIS: Hwang & Yoon 1981
