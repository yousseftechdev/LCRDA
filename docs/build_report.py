#!/usr/bin/env python3
"""Generates docs/MCDM_Technical_Report.pdf (deliverable #3).

Run from mcdm-hub/:  python3 docs/build_report.py
Requires reportlab + DejaVu fonts (present on Raspberry Pi OS / Ubuntu).
"""

import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle,
                                PageBreak)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "MCDM_Technical_Report.pdf")

# ---------------- fonts (DejaVu: full math-symbol coverage) ---------------
FDIR = "/usr/share/fonts/truetype/dejavu"
pdfmetrics.registerFont(TTFont("DVS", f"{FDIR}/DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("DVS-B", f"{FDIR}/DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("DVS-I", f"{FDIR}/DejaVuSans-Oblique.ttf"))
pdfmetrics.registerFont(TTFont("DVS-M", f"{FDIR}/DejaVuSansMono.ttf"))
pdfmetrics.registerFontFamily("DVS", normal="DVS", bold="DVS-B",
                              italic="DVS-I", boldItalic="DVS-B")

styles = getSampleStyleSheet()
S = {
    "title": ParagraphStyle("t", fontName="DVS-B", fontSize=22, leading=28,
                            alignment=TA_CENTER, spaceAfter=6),
    "subtitle": ParagraphStyle("s", fontName="DVS", fontSize=13, leading=18,
                               alignment=TA_CENTER, textColor=colors.HexColor("#1e5b28")),
    "h1": ParagraphStyle("h1", fontName="DVS-B", fontSize=15, leading=20,
                         spaceBefore=14, spaceAfter=6,
                         textColor=colors.HexColor("#1e5b28")),
    "h2": ParagraphStyle("h2", fontName="DVS-B", fontSize=12, leading=16,
                         spaceBefore=10, spaceAfter=4),
    "body": ParagraphStyle("b", fontName="DVS", fontSize=9.5, leading=13.5,
                           spaceAfter=5, alignment=4),  # justify
    "eq": ParagraphStyle("eq", fontName="DVS", fontSize=10.5, leading=15,
                         alignment=TA_CENTER, spaceBefore=4, spaceAfter=6,
                         backColor=colors.HexColor("#f2f7ee"),
                         borderPadding=5),
    "code": ParagraphStyle("c", fontName="DVS-M", fontSize=8, leading=11,
                           backColor=colors.HexColor("#f4f4f0"),
                           borderPadding=4, spaceBefore=3, spaceAfter=6),
    "small": ParagraphStyle("sm", fontName="DVS", fontSize=8, leading=11,
                            textColor=colors.HexColor("#555555")),
}


def P(text, style="body"):
    return Paragraph(text, S[style])


def EQ(text):
    return Paragraph(text, S["eq"])


def table(data, widths=None, header=True):
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [("FONTNAME", (0, 0), (-1, -1), "DVS"),
          ("FONTSIZE", (0, 0), (-1, -1), 8.5),
          ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9dbb90")),
          ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 3),
          ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]
    if header:
        st += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e5b28")),
               ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
               ("FONTNAME", (0, 0), (-1, 0), "DVS-B")]
    t.setStyle(TableStyle(st))
    return t


story = []
A = story.append

# ===================== TITLE PAGE =====================
A(Spacer(1, 3.2 * cm))
A(P("The MCDM Algorithm", "title"))
A(P("A Scientifically-Grounded Multi-Criteria Decision Making Engine for a "
    "Crop Rotation Decision-Aid Hub", "subtitle"))
A(Spacer(1, 0.8 * cm))
A(P("NASA Space Apps Challenge 2026 — Crop Rotation Decision-Support Challenge",
    "body"))
A(P("Implementation: Raspberry Pi 4 hub · NASA POWER + ISRIC SoilGrids · "
    "FAO EcoCrop · FAO-56 · AquaCrop · AHP/SAW/TOPSIS · dynamic-programming "
    "rotation planner", "body"))
A(Spacer(1, 0.6 * cm))
A(P("Technical Report — what MCDM is, the exact mathematics, and how it is "
    "implemented in this project", "small"))
A(Spacer(1, 1.2 * cm))

# ===================== 1. EXECUTIVE SUMMARY =====================
A(P("1. Executive summary", "h1"))
A(P(
    "Choosing a crop when several conflicting criteria matter is a "
    "<b>Multi-Criteria Decision Making (MCDM)</b> problem, and this project "
    "implements it inside a <b>Decision Support System (DSS)</b> for crop "
    "selection, following the paper the team found (Gunawan, Sitopu &amp; "
    "Sechan, 2024). That paper's mathematics is "
    "the <b>weighted-sum (Simple Additive Weighting, SAW)</b> model: each crop "
    "is scored on several criteria; each criterion has an importance weight; "
    "the crop with the highest weighted total is recommended."))
A(P(
    "This report documents (a) what MCDM/SAW is mathematically, (b) how the "
    "paper's formulation is generalised into a rigorous, fully-specified "
    "decision pipeline — AHP weights → SAW ranking → TOPSIS verification → "
    "dynamic-programming multi-season rotation planning, and (c) how every "
    "criterion score is computed from established agronomy: the FAO EcoCrop "
    "suitability model (exact OpenCLIM formulation), FAO-56 crop water "
    "requirements, ISRIC SoilGrids soil data, and the FAO AquaCrop yield "
    "response-to-water model. All of it is driven by NASA POWER satellite "
    "data cached on a Raspberry Pi 4 for offline rural use."))
A(P(
    "The implemented engine is validated by a test suite that <b>reproduces "
    "the source paper's numerical example exactly</b> (crops A, B, C → "
    "suitability 0.76, 0.69, 0.63; winner A), alongside unit tests of every "
    "physical equation and a brute-force optimality check of the rotation "
    "planner."))

# ===================== 2. WHAT IS MCDM =====================
A(P("2. MCDM inside a DSS — the method this hub implements", "h1"))
A(P(
    "MCDM (also MCDA — multi-criteria decision analysis) is the discipline of "
    "making choices when several conflicting criteria matter simultaneously. "
    "The Gunawan et al. (2024) paper formalises crop selection as an "
    "optimisation:"))
A(EQ("maximize&nbsp;&nbsp; Z = Σ<sub>i</sub> Σ<sub>j</sub> W<sub>j</sub> · "
     "C<sub>ij</sub> · X<sub>ij</sub>"))
A(P(
    "where <b>i</b> indexes crops, <b>j</b> indexes criteria, "
    "<b>W<sub>j</sub></b> is the importance weight of criterion j, "
    "<b>C<sub>ij</sub></b> is the suitability score of crop i on criterion j, "
    "and <b>X<sub>ij</sub></b> ∈ {0,1} selects which crop–criterion pairs "
    "count. Because exactly one crop is selected, every row uses a single "
    "X, and the model collapses to the classic <b>Simple Additive Weighting "
    "(SAW)</b> score per crop:"))
A(EQ("Z<sub>i</sub> = Σ<sub>j</sub> W<sub>j</sub> · C<sub>ij</sub>"
     "&nbsp;&nbsp;&nbsp;(choose argmax<sub>i</sub> Z<sub>i</sub>)"))
A(P(
    "The paper's worked example (weights: climate 0.3, soil fertility 0.2, "
    "market demand 0.4, water 0.1) gives Z<sub>A</sub> = 0.76, "
    "Z<sub>B</sub> = 0.69, Z<sub>C</sub> = 0.63 → Crop A wins. Our test suite "
    "reproduces these numbers to machine precision, proving the implemented "
    "core is faithful to the paper."))
A(P(
    "What the paper leaves unspecified — and what this project therefore "
    "specifies rigorously — is: <b>(1)</b> how the weights W<sub>j</sub> are "
    "derived from a farmer's priorities (answer: Analytic Hierarchy Process, "
    "Saaty 1980, with a consistency check), <b>(2)</b> how each C<sub>ij</sub> "
    "is computed from real geophysical data (answer: EcoCrop, FAO-56, "
    "SoilGrids, AquaCrop), <b>(3)</b> whether the ranking is robust (answer: "
    "cross-check with TOPSIS), and <b>(4)</b> how to plan not just the next "
    "crop but a whole multi-season rotation (answer: dynamic programming over "
    "a documented transition-score matrix)."))

# ===================== 3. PIPELINE =====================
A(P("3. The implemented decision pipeline", "h1"))
A(P(
    "Step 0 — <b>Data</b>: NASA POWER daily point series (T2M, T2M_MAX, "
    "T2M_MIN, PRECTOTCORR, WS2M, RH2M, ALLSKY_SFC_SW_DWN) and ISRIC SoilGrids "
    "soil properties (pH, sand, clay, soil organic carbon over 0–60 cm), "
    "cached locally in SQLite and refreshed every 24 hours; every feature "
    "keeps working from cache when the hub is offline."))
A(P("Step 1 — <b>Candidate crops</b>: the FAO EcoCrop database (2 568 crops "
    "with temperature, precipitation, soil and cycle parameters) is bundled "
    "on the hub; the farmer shortlists crops or uses the curated default set "
    "of major food crops."))
A(P("Step 2 — <b>Criterion scores</b> c<sub>ij</sub> ∈ [0,1] per crop "
    "(§4)."))
A(P("Step 3 — <b>Weights</b> w from AHP on the farmer's priority sliders "
    "(§5.1)."))
A(P("Step 4 — <b>Ranking</b>: SAW (the paper's objective), verified by "
    "TOPSIS (§5.2–5.3); both rankings are shown to the farmer."))
A(P("Step 5 — <b>Rotation plan</b>: exact dynamic programming over seasons "
    "with agronomic transition scores (§6)."))

# ===================== 4. CRITERIA =====================
A(P("4. The criterion scores c<sub>ij</sub>", "h1"))

A(P("4.1 Climate suitability — FAO EcoCrop (exact OpenCLIM formulation)",
    "h2"))
A(P(
    "EcoCrop scores how well a crop's thermal and rainfall requirements are "
    "met. Following the OpenCLIM/ecocrop implementation (Bib. [4]), for each "
    "candidate growing window of GTIME days (GTIME stepped in 10-day "
    "increments between the crop's cycle limits GMIN..GMAX), each day t "
    "contributes an intermediate temperature score:"))
A(EQ("D(T) = (T − TMIN)/(TOPMN − TMIN)&nbsp;&nbsp;when TMIN &lt; T &lt; TOPMN<br/>"
     "D(T) = 1&nbsp;&nbsp;when TOPMN ≤ T ≤ TOPMX<br/>"
     "D(T) = (TMAX − T)/(TMAX − TOPMX)&nbsp;&nbsp;when TOPMX &lt; T &lt; TMAX<br/>"
     "D(T) = 0&nbsp;&nbsp;otherwise"))
A(P("where T is the day's mean temperature and TMIN, TMAX, TOPMN, TOPMX are "
    "the crop's EcoCrop parameters. The window accumulates suitable days:"))
A(EQ("N_D = Σ<sub>window</sub> D(T)"))
A(P("and the temperature suitability of that window is:"))
A(EQ("S_T = 100 · [1 − (GTIME − GMIN)/(GMAX − GMIN)]&nbsp;&nbsp;if N_D ≥ GMIN, "
     "else 0"))
A(P(
    "— i.e. the faster the crop can accumulate its minimum number of suitable "
    "days, the higher the score. Two penalties are then applied: any night "
    "below the killing temperature KTMP zeroes S_T (frost kill), and each day "
    "with maximum temperature above TMAX subtracts one point (heat stress). "
    "For perennial crops the window-mean temperature is scored instead "
    "(documented in [4])."))
A(P("Precipitation suitability uses the window rainfall total PTOT:"))
A(EQ("S_P = 100 · (PTOT − RMIN)/(½(ROPMN+ROPMX) − RMIN)&nbsp;&nbsp;below optimum<br/>"
     "S_P = 100 · (RMAX − PTOT)/(RMAX − ½(ROPMN+ROPMX))&nbsp;&nbsp;above optimum<br/>"
     "S_P = 0&nbsp;&nbsp;outside [RMIN, RMAX]"))
A(P("The combined EcoCrop score is <b>S = min(S_T, S_P)</b> — “the lowest "
    "score is likely to be the limiting factor”. The hub scans all candidate "
    "sowing windows over the cached year of NASA POWER data and reports the "
    "best window as the recommended sowing date (the OpenCLIM aggregation "
    "takes the maximum over window lengths, and a 95th-percentile when "
    "aggregating climatologies; for a single field decision the maximum is "
    "the appropriate analogue)."))
A(P(
    "<b>Rainfed vs irrigated.</b> Under rainfed conditions the hub uses the "
    "exact OpenCLIM min(S_T, S_P): rainfall adequacy is part of climate fit. "
    "When the farmer declares an irrigation supply (mm available), the "
    "climate criterion becomes the best temperature score S_T alone — "
    "irrigation removes the rainfall limitation — and water adequacy is "
    "instead scored by the FAO-56 criterion below. This distinction is a "
    "design decision of the hub, documented because it changes "
    "interpretation in arid regions."))

A(P("4.2 Soil suitability — SoilGrids vs EcoCrop soil ranges", "h2"))
A(P(
    "SoilGrids 2.0 (ISRIC) provides soil pH (phh2o), sand, clay and organic "
    "carbon at standard depths; the hub averages 0–60 cm (root zone). Each "
    "property is scored with a trapezoid membership function against the "
    "crop's EcoCrop soil requirement ranges — 1 inside the optimal range "
    "(PHOPMN..PHOPMX for pH), linearly decreasing to 0 at the absolute "
    "limits (PHMIN..PHMAX); texture classes (heavy/medium/light/organic, "
    "derived from the USDA sand–clay triangle) are scored 1 if in the "
    "crop's optimal texture list, 0.5 if in its tolerated list, else 0; "
    "rooting depth is scored against the crop's DEP class. Scores are "
    "aggregated by a weighted mean (weights: pH 0.4, texture 0.3, depth 0.2, "
    "salinity 0.1 when measured EC is available):"))
A(EQ("S<sub>soil</sub> = Σ<sub>j</sub> w<sub>j</sub> S<sub>j</sub>,&nbsp;&nbsp;"
     "Σ w<sub>j</sub> = 1"))
A(P("This aggregation is a design choice of the system (as the team's "
    "research notes correctly state, it is not a universal law); the "
    "per-property functions themselves follow the EcoCrop requirement ranges, "
    "and the weights are exposed and documented for calibration."))

A(P("4.3 Water adequacy — FAO-56", "h2"))
A(P("Reference evapotranspiration is computed daily with the FAO-56 "
    "Penman–Monteith equation from NASA POWER inputs (Allen et al. 1998, "
    "Bib. [5]):"))
A(EQ("ET₀ = [0.408·Δ·(R<sub>n</sub> − G) + γ·(900/(T+273))·u₂·(e<sub>s</sub> − e<sub>a</sub>)] "
     "/ [Δ + γ·(1 + 0.34·u₂)]"))
A(P("with the net radiation R<sub>n</sub> built from the measured solar "
    "radiation R<sub>s</sub> (R<sub>ns</sub> = 0.77·R<sub>s</sub>; "
    "R<sub>nl</sub> via the Stefan–Boltzmann cloudiness correction), "
    "e<sub>s</sub> from daily Tmax/Tmin, e<sub>a</sub> from RH, and u₂ the "
    "2 m wind speed. A Hargreaves–Samani fallback "
    "(ET₀ = 0.0023·R<sub>a</sub>·(T<sub>max</sub>−T<sub>min</sub>)<sup>0.5</sup>"
    "·(T<sub>mean</sub>+17.8)) covers incomplete records (documented "
    "overestimation bias in arid, high-radiation conditions)."))
A(P("Crop evapotranspiration follows the FAO-56 stage curve "
    "(K<sub>c</sub> initial/mid/late trapezoid, FAO-56 Table 12 values "
    "bundled for ~30 major crops):"))
A(EQ("ET<sub>c</sub> = K<sub>c</sub>(stage) · ET₀"))
A(P("Effective rainfall uses the FAO “80% rule” (Dastane 1978): "
    "P<sub>e</sub> = 0.8·P for P &lt; 75 mm, else 0.6·P + 15. The seasonal "
    "net irrigation requirement is:"))
A(EQ("NIR = max(0, Σ ET<sub>c</sub> − Σ P<sub>e</sub>)"))
A(P("In irrigated mode the water criterion is the supply fraction "
    "min(1, available/NIR); in rainfed mode it equals the EcoCrop "
    "precipitation suitability S_P (§4.1), the honest measure of rainfed "
    "adequacy. In all cases NIR is displayed as the advisory irrigation "
    "volume."))

A(P("4.4 Yield response to water — simplified AquaCrop", "h2"))
A(P("AquaCrop's growth engine is water-driven (Steduto et al. 2009, "
    "Bib. [6]): daily transpiration translates into biomass through the "
    "normalised biomass water productivity WP*, and yield is the harvestable "
    "fraction:"))
A(EQ("B = WP* · Σ (Tr<sub>i</sub> / ET₀<sub>i</sub>)&nbsp;&nbsp;&nbsp;&nbsp;"
     "Y = HI · B"))
A(P(
    "WP* is conservative per functional group (C4 cereals ≈ 33.7 g m⁻² — the "
    "AquaCrop default for maize; C3 cereals ≈ 15–20; legumes ≈ 15; the hub's "
    "bundled table gives values per group). In the simplified screening "
    "implementation, without a daily canopy–water-stress simulation, "
    "transpiration is estimated from the Kc curve as "
    "Tr<sub>i</sub> ≈ ET<sub>c,i</sub>·(1 − f<sub>e</sub>) with "
    "f<sub>e</sub> = 0.30 (soil-evaporation share of Kc, documented). The "
    "resulting yield (t/ha) is used as a relative criterion — normalised "
    "against the best-yielding crop in the candidate set — and is explicitly "
    "labelled a screening estimate, not a calibrated AquaCrop simulation."))

A(P("4.5 Rotation compatibility — pre-crop effects", "h2"))
A(P(
    "Agronomic literature demonstrates that the previous crop changes the "
    "performance of the next one (pre-crop values; rotation matrices — "
    "Fenz et al. 2023 found data-driven matrices agree with literature "
    "recommendations in ~52% of pairs and within one degree in 97%; "
    "functional-group diversity raises cereal yields — Smith et al. 2023). "
    "The hub encodes a transition score T(prev → cur) ∈ [−1, 1]:"))
A(table([
    ["Transition", "Score", "Rationale"],
    ["same botanical family", "−1 (forbidden)", "pest/disease carry-over; nutrient imbalance (family-repeat constraints are standard in crop-planning optimisation)"],
    ["same crop", "−0.5", "monoculture penalty"],
    ["legume (Fabaceae) → non-legume", "+0.3", "residual N credit of legumes (~30–80 kg N/ha)"],
    ["deep-rooted → other", "+0.1", "subsoil structure / nutrient capture"],
], [5.6*cm, 2.6*cm, 9.0*cm]))
A(P("The rotation criterion score used inside the MCDM matrix is "
    "c<sub>rot</sub> = ½(1 + T) ∈ [0,1]."))

A(P("4.6 Market demand", "h2"))
A(P("The farmer rates expected market demand per crop on a 0–1 slider "
    "(default 0.5, neutral). This keeps the economic criterion of the source "
    "paper (market demand, weight 0.4 in its example) in the farmer's hands, "
    "since reliable price data are not yet integrated."))

# ===================== 5. WEIGHTS & RANKING =====================
A(P("5. Weights (AHP), ranking (SAW) and verification (TOPSIS)", "h1"))

A(P("5.1 Analytic Hierarchy Process — deriving the weights", "h2"))
A(P(
    "Farmers should not have to type decimal weights — or understand "
    "criteria at all. The farmer answers five plain-language priority "
    "questions on a 1–5 scale (\"not important\" to \"very important\"): "
    "<i>Fits my land and weather</i>, <i>Big harvest</i>, <i>Saving water</i>, "
    "<i>Healthy soil next seasons</i>, and <i>Sells for a good price</i>. "
    "These map onto the six science criteria (\"fits my land and weather\" "
    "deliberately drives BOTH the climate and the soil criterion with the "
    "same weight — the farmer thinks of it as one question), and the 1–5 "
    "scale is stretched to the 1–9 AHP scale (p → 2p − 1, i.e. 1, 3, 5, 7, "
    "9) so \"very important vs not important\" keeps its intended strength "
    "in the pairwise matrix. The hub builds the pairwise comparison matrix "
    "A with entries a<sub>ij</sub> = snap(p<sub>i</sub>/p<sub>j</sub>) to "
    "the Saaty scale {1/9, …, 1, …, 9}, and computes the <b>principal "
    "eigenvector</b>:"))
A(EQ("A·w = λ<sub>max</sub>·w ,&nbsp;&nbsp; Σ w<sub>j</sub> = 1"))
A(P("Consistency is measured with Saaty's index and random index RI:"))
A(EQ("CI = (λ<sub>max</sub> − n)/(n − 1) ,&nbsp;&nbsp; CR = CI/RI(n)"))
A(P("with RI: n=3 → 0.58, 4 → 0.90, 5 → 1.12, 6 → 1.24, 7 → 1.32, 8 → 1.41, "
    "9 → 1.45, 10 → 1.49. A CR ≤ 0.10 is accepted (Saaty's rule); the UI "
    "warns otherwise. The hub's typical CR ≈ 0.01 — well within tolerance."))

A(P("5.2 Simple Additive Weighting — the MCDM objective", "h2"))
A(EQ("Z<sub>i</sub> = Σ<sub>j</sub> w<sub>j</sub>·c<sub>ij</sub>"
     "&nbsp;&nbsp;→&nbsp;&nbsp; i* = argmax<sub>i</sub> Z<sub>i</sub>"))
A(P("This is exactly the paper's objective Z = ΣΣ W<sub>j</sub>·C<sub>ij</sub>·"
    "X<sub>ij</sub> under its single-crop constraint (the binary selection "
    "variables add nothing when one alternative is chosen; the argmax form is "
    "the mathematically equivalent, standard SAW statement). Because all "
    "criteria are normalised to [0,1] and Σw = 1, Z ∈ [0,1] is interpretable "
    "as an overall suitability."))

A(P("5.3 TOPSIS — independent verification", "h2"))
A(P("To guard against weighting artefacts, the hub also ranks crops with "
    "TOPSIS (Hwang &amp; Yoon 1981): vector-normalise the decision matrix "
    "(v<sub>ij</sub> = c<sub>ij</sub>/√Σ<sub>i</sub>c<sub>ij</sub>²), weight "
    "by w<sub>j</sub>, take the ideal a⁺ and anti-ideal a⁻ columns, compute "
    "Euclidean distances d⁺, d⁻ per crop and the closeness coefficient:"))
A(EQ("C<sub>i</sub> = d⁻<sub>i</sub> / (d⁺<sub>i</sub> + d⁻<sub>i</sub>)"))
A(P("SAW and TOPSIS agree on the winner in practice; when they disagree the "
    "UI flags it (a genuinely borderline decision, worth the farmer's "
    "attention). All hub criteria are benefit-type (higher is better); any "
    "future cost criterion is pre-inverted."))

# ===================== 6. ROTATION PLANNER =====================
A(P("6. Multi-season rotation planning — exact dynamic programming", "h1"))
A(P(
    "Choosing the next crop is a myopic decision; a rotation must also be "
    "good over several seasons. Let Z<sub>i</sub> be the SAW score of crop i "
    "and T(a→b) the transition score (§4.5). The hub chooses the sequence "
    "s₁…s_K over K seasons (default K = 3) maximising:"))
A(EQ("J = Σ<sub>k</sub> Z<sub>s<sub>k</sub></sub> + λ·Σ<sub>k≥2</sub> "
     "T(s<sub>k−1</sub> → s<sub>k</sub>) ,&nbsp;&nbsp; λ = 0.5"))
A(P("subject to T = −1 transitions (same botanical family) being forbidden. "
    "This is solved <b>exactly</b> by dynamic programming over a layered "
    "graph:"))
A(EQ("dp[1][i] = Z<sub>i</sub><br/>"
     "dp[k][b] = max<sub>a: T(a,b) &gt; −1</sub> { dp[k−1][a] + λ·T(a,b) } "
     "+ Z<sub>b</sub>"))
A(P("with back-pointers recovering the optimal sequence; complexity "
    "O(K·n²). A brute-force enumeration test confirms the DP reaches the "
    "true optimum (equivalent to a longest-path formulation; unlike greedy "
    "first-pick it never falls into locally-good, globally-poor sequences). "
    "The hub also reports a screening-level nitrogen balance over the plan: "
    "legumes credit ≈ +60 kg N/ha, non-legumes debit ≈ −45 kg N/ha per "
    "season."))

# ===================== 7. SYSTEM =====================
A(P("7. The hub system", "h1"))
A(table([
    ["Component", "Implementation", "Notes"],
    ["Hardware target", "Raspberry Pi 4", "backend: Python stdlib + numpy (+ requests for data fetches)"],
    ["Web interface", "Farmer-friendly single-page app, port 8000", "plain language throughout; no math exposed; four numbered steps; 0–5 scorecard bars instead of raw scores; expandable \"What's this?\" explanations state how every factor is measured (NASA POWER weather, SoilGrids soil map, FAO EcoCrop requirements, FAO-56 water use, AquaCrop harvest); market demand is four labelled choices (Hard to sell / Average / Good / Sells fast), not a numeric slider; water supply is \"Rain only\" or a volume choice with the helper \"1 mm = 1 litre per square metre\"; offline MAP PICKER (tap/pinch) shows DAILY NASA satellite imagery via GIBS/Worldview with a parameter filter (true colour, SMAP soil moisture, MODIS land temperature, VIIRS NDVI greenery, IMERG rainfall — soil pH comes from SoilGrids, not daily satellites); NASA/FAO/ISRIC attribution and provenance (date range, soil pH) shown with every result; no emojis; SVG leaf favicon"],
    ["Deployment", "systemd service + venv (INSTALLED and verified)", "scripts/install.sh creates the venv (numpy), installs systemd/lcrda.service (auto-restart, verified by SIGKILL test), and a daemon thread re-pulls NASA POWER for every cached location every 24 h"],
    ["Climate data", "NASA POWER daily point API (7 variables)", "cached in SQLite; 24-hour refresh (background thread); one request per 0.5° cell (NASA fair-use)"],
    ["Map imagery", "NASA GIBS WMTS (MODIS true colour, SMAP soil moisture, MODIS LST, VIIRS NDVI, IMERG rain)", "daily imagery through the hub proxy /api/maptile, disk-cached per day (offline = newest cached day, Natural Earth outlines as base layer); tiles older than 8 days auto-purged; layer dates auto-resolved (lagging products probed at their likely date)"],
    ["Soil data", "ISRIC SoilGrids 2.0 REST (pH, sand, clay, SOC, 0–60 cm)", "cached 30 days; handles NULL cells (rivers, dense cities) by sampling the nearest valid cells within ~30 km; error payloads retry after 1 h, never live a full TTL"],
    ["Crop parameters", "FAO EcoCrop database, 2 568 crops", "bundled CSV (FAO EcoCrop / OpenCLIM, OGL v3)"],
    ["Decision engine", "AHP → SAW → TOPSIS + DP rotation", "fully deterministic, reproducible; when SAW and TOPSIS disagree the UI says the choice is a close call and names the runner-up"],
    ["Offline behaviour", "all features run from cache", "designed for farmers without internet"],
], [3.6*cm, 5.8*cm, 7.8*cm]))
A(P("API surface: GET /api/health, GET /api/crops?q=…, POST /api/recommend "
    "(lat, lon, shortlist, farmer priorities {land, harvest, water, "
    "soilnext, market} on 1–5 — raw 1–9 criterion keys also accepted, "
    "previous crop, water available in mm (null = rainfed), market scores "
    "0.2–1.0; the response echoes waterMode/waterAvailableMM and includes "
    "closeCall when the two methods disagree), POST /api/refresh "
    "(fair-use guarded: refetches only when the cache is stale)."))

A(P("7.1 Validation", "h2"))
A(table([
    ["Test", "Expected", "Result"],
    ["Paper numerical example (SAW)", "Z_A=0.76, Z_B=0.69, Z_C=0.63, winner A", "PASS (machine precision)"],
    ["EcoCrop daily/window equations", "piecewise scores, frost zeroing", "PASS"],
    ["FAO-56 ET₀ / Kc / NIR", "plausible ET₀, Kc trapezoid, Pe rule", "PASS"],
    ["AquaCrop B = WP*·Σ(Tr/ET₀), Y = HI·B", "exact algebra", "PASS"],
    ["AHP consistency diagnostics", "CR ≤ 0.1 detection", "PASS"],
    ["Rotation DP vs brute force", "identical optimum", "PASS"],
    ["End-to-end live run (Egypt, 29.2 N 31.0 E)", "winter crops for Nov sowing; AHP CR 0.0092; SAW=TOPSIS winner", "PASS"],
], [5.2*cm, 6.6*cm, 5.4*cm]))
A(P("35/35 tests pass (mcdm-hub/tests/test_mcdm.py). The end-to-end run used "
    "live NASA POWER data (366 days cached, ET₀ mean 6.79 mm/day) and live "
    "SoilGrids data (pH 8.0, clay 24.8 %, sand 47.5 %, SOC 4.8 %)."))

# ===================== 8. LIMITATIONS =====================
A(P("8. Known limitations (documented, not hidden)", "h1"))
A(P("1. <b>Screening-level yield</b>: the AquaCrop implementation is the "
    "conceptual equation without the full daily soil-water–canopy simulation; "
    "treat yields as relative indicators. Calibrate with local data before "
    "claiming quantitative accuracy (the team's own Resources.md demands "
    "this)."))
A(P("2. <b>Simplified seasonal water balance</b>: NIR uses effective "
    "rainfall, not a daily soil-water-bucket model; adequate for ranking, "
    "not for irrigation scheduling."))
A(P("3. <b>SoilGrids is modelled data</b> (~1 km): the hub accepts measured "
    "pH (and could accept EC) to override."))
A(P("4. <b>Weights and transition scores</b> are design choices documented "
    "for calibration, not universal laws — consistent with the MCDM "
    "literature's advice to elicit weights from stakeholders."))
A(P("5. <b>EcoCrop rainfall suitability is rainfed-oriented</b>: hence the "
    "explicit rainfed/irrigated mode (§4.1)."))
A(P("6. <b>Market criterion</b> is farmer-entered until a price data source "
    "is integrated."))
A(P("7. <b>24-hour cache</b> is a fairness/simplicity trade-off; POWER "
    "updates daily, so no information is lost."))

# ===================== 9. REFERENCES =====================
A(P("9. References", "h1"))
for r in [
    "[1] Gunawan, M. I., Sitopu, J. W., & Sechan, G. (2024). Optimizing Crop "
    "Selection: A Multi-Criteria Decision Support System for Sustainable "
    "Agriculture. International Journal of Enterprise Modelling, 18(3), "
    "113–123.",
    "[2] Saaty, T. L. (1980). The Analytic Hierarchy Process. McGraw-Hill. "
    "RI table as in Vaidya & Kumar (2006), EJOR 169(1):1–29.",
    "[3] Hwang, C. L., & Yoon, K. (1981). Multiple Attribute Decision "
    "Making: Methods and Applications. Springer.",
    "[4] OpenCLIM (2024). ecocrop — Crop suitability model using the FAO "
    "EcoCrop crop characteristic database. github.com/OpenCLIM/ecocrop "
    "(OGL v3); paper: doi:10.1002/cli2.70007.",
    "[5] Allen, R. G., Pereira, L. S., Raes, D., & Smith, M. (1998). Crop "
    "evapotranspiration — Guidelines for computing crop water requirements. "
    "FAO Irrigation & Drainage Paper 56.",
    "[6] Steduto, P., Hsiao, T. C., Raes, D., & Fereres, E. (2009). "
    "AquaCrop—The FAO Crop Model to Simulate Yield Response to Water: I. "
    "Concepts and Underlying Principles. Agronomy Journal, 101(3), 426–437. "
    "doi:10.2134/agronj2008.0139s; Raes et al. (2009) Agron J 101(3):438–447.",
    "[7] FAO (2023). AquaCrop Reference Manual v7.x (WP* values, HI₀, "
    "calculation scheme). fao.org/aquacrop.",
    "[8] ISRIC World Soil Information. SoilGrids 2.0 REST API "
    "(rest.isric.org/soilgrids/v2.0); Poggio et al. (2021), SOIL 7:217–240.",
    "[9] NASA POWER Data Services — daily point API "
    "(power.larc.nasa.gov).",
    "[10] FAO EcoCrop database (gaez.fao.org/pages/ecocrop).",
    "[11] Fenz, S., et al. (2023). AI- and data-driven crop rotation "
    "planning. Computers and Electronics in Agriculture; and AI- and "
    "data-driven pre-crop values and crop rotation matrices. European "
    "Journal of Agronomy 150:126949.",
    "[12] Smith, A., et al. (2023). Increasing crop rotational diversity can "
    "enhance cereal yields. Communications Earth & Environment 4:96.",
    "[13] Benini, M., et al. (2023). Solving crop planning and rotation "
    "problems in a sustainable agriculture perspective. Computers & "
    "Operations Research 159:106316.",
    "[14] Dastane, N. G. (1978). Effective rainfall in irrigated agriculture. "
    "FAO Irrigation & Drainage Paper 25 (80% rule).",
    "[15] NASA Space Apps Challenge 2026 challenge statement: crop rotation "
    "decision-support tool using NASA Earth observations (team Resources.md).",
]:
    A(P(r, "small"))

A(Spacer(1, 0.5 * cm))
A(P("Appendix A — repository map: mcdm-hub/run.py (entry) · backend/engine/ "
    "(mcdm, ecocrop, fao56, soil, aquacrop, rotation) · backend/data/ (power, "
    "soilgrids, crops + EcoCrop_DB.csv) · backend/storage.py (SQLite cache) · "
    "backend/app.py (pipeline) · backend/server.py (HTTP) · frontend/ (UI) · "
    "tests/test_mcdm.py (35 tests) · agent.md (full research & work log).",
    "small"))

# ---------------- build ----------------
doc = BaseDocTemplate(OUT, pagesize=A4,
                      leftMargin=1.6 * cm, rightMargin=1.6 * cm,
                      topMargin=1.6 * cm, bottomMargin=1.7 * cm,
                      title="The MCDM Algorithm — Technical Report",
                      author="NASA Space Apps team")

def _decorate(canv, _doc):
    canv.saveState()
    canv.setFont("DVS", 7.5)
    canv.setFillColor(colors.HexColor("#666666"))
    canv.drawString(1.6 * cm, 1.05 * cm,
                    "MCDM Technical Report — NASA Space Apps Challenge 2026")
    canv.drawRightString(A4[0] - 1.6 * cm, 1.05 * cm,
                         f"page {canv.getPageNumber()}")
    canv.restoreState()

frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="pt", frames=[frame],
                                   onPage=_decorate)])
doc.build(story)
print("wrote", OUT, os.path.getsize(OUT), "bytes")
