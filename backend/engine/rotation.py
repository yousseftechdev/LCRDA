"""
rotation.py -- Crop rotation engine.

Agronomic basis (documented, with sources):
  * Botanical family constraint: do not grow the same botanical family
    (e.g. Solanaceae, Brassicaceae, Cucurbitaceae, Fabaceae...) in
    consecutive seasons -- reduces pest/disease carry-over and imbalanced
    nutrient mining (Benini et al. 2023, Comput & Oper Res 159:106316;
    Fenz et al. 2023, Comput Electron Agric / EJA 126949).
  * Functional-group effects: N-fixing legumes (Fabaceae) leave a nitrogen
    credit that benefits the following cereal; deep-rooted crops improve
    structure; grasses add residues (Smith et al. 2023, Commun Earth
    Environ 4:96 -- functional-group richness increases cereal yields;
    Koyama et al. 2022, Ecol Appl -- plant-soil feedbacks).
  * Pre-crop values / rotation matrices: quantitative "effect of previous
    crop on next crop" (Fenz et al. 2023 found data-driven matrices agree
    with literature recommendations).

Mathematical formulation (exact optimum by dynamic programming):

    Given per-crop base scores Z_i (from the MCDM engine) and a
    transition score T(a -> b) in [-1, 1], choose the crop sequence
    s_1..s_K over K seasons maximising

        J = sum_k Z_{s_k} + L * sum_{k>=2} T(s_{k-1} -> s_k)

    subject to: T = -1 transitions (same family) are FORBIDDEN.

    DP over layered DAG:  dp[1][i] = Z_i
        dp[k][b] = max_a allowed { dp[k-1][a] + L*T(a,b) } + Z_b
    Complexity O(K n^2) -- exact, unlike greedy first-pick.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------- crops ---

def family_of(ecocrop_famname: str) -> str:
    """FAMNAME field looks like 'Magnoliopsida:Dilleniidae:Malvales:Malvaceae'
    -> the LAST element is the botanical family (Fabaceae, Poaceae...)."""
    if not ecocrop_famname:
        return "unknown"
    return ecocrop_famname.strip().split(":")[-1].lower()


def functional_group(crop: dict) -> str:
    """Classify crop into AquaCrop WP*/HI functional group.
    Uses EcoCrop CAT (category) and COMNAME/ScientificName keywords."""
    cat = (crop.get("cat") or "").lower()
    name = f"{crop.get('scientific_name','')} {crop.get('comname','')}".lower()
    fam = (crop.get("family") or "").lower()

    if "cereals" in cat or any(k in name for k in
                               ("wheat", "maize", "corn", "rice", "barley",
                                "sorghum", "millet", "oat", "rye")):
        if any(k in name for k in ("maize", "corn", "sorghum", "sugar")) or \
                "poaceae" in fam and "c4" in crop.get("flags", ""):
            return "c4_cereal"
        return "c3_cereal"
    if "legumes" in cat or "fabaceae" in fam or "faboideae" in fam:
        return "legume"
    if "roots" in cat or "tubers" in cat or any(
            k in name for k in ("potato", "sweet potato", "cassava", "yam")):
        return "tuber"
    if "vegetables" in cat:
        return "vegetable"
    if "oil" in cat:
        return "oil"
    if "fibre" in cat or "fiber" in cat or "cotton" in name:
        return "fiber"
    if "forage" in cat or "grass" in cat:
        return "forage"
    if any(k in name for k in ("sugarcane", "sorghum", "maize", "corn")):
        return "c4_cereal"
    return "other"


def is_n_fixing(crop: dict) -> bool:
    """Legumes (Fabaceae) fix nitrogen (with rhizobia)."""
    return "fabaceae" in (crop.get("family") or "").lower()


def rooting_depth_class(crop: dict) -> str:
    dep = (crop.get("dep") or "").lower()
    if "deep" in dep and "shallow" not in dep:
        return "deep"
    if "shallow" in dep:
        return "shallow"
    if "moderate" in dep:
        return "moderate"
    return "unknown"


# --------------------------------------------------- transition matrix ---

def transition_score(prev: dict, cur: dict, n_bonus: float = 0.30,
                     same_crop_penalty: float = 0.50,
                     residue_bonus: float = 0.10) -> float:
    """T(prev -> cur) in [-1, 1] (larger = agronomically better succession).

    Rules (all documented in the PDF report):
      - same botanical family  ->  -1.0   (hard penalty; planner forbids it)
      - same crop              ->  -same_crop_penalty (monoculture)
      - legume followed by a NON-legume ->  +N credit (n_bonus)
      - deep-rooted previous crop improves structure -> +residue_bonus
      - otherwise 0
    The score is added to the MCDM score of the next season weighted by L.
    """
    pf, cf = family_of(prev.get("family")), family_of(cur.get("family"))
    if pf != "unknown" and pf == cf:
        return -1.0
    if prev.get("key") == cur.get("key"):
        return -same_crop_penalty
    t = 0.0
    if is_n_fixing(prev) and not is_n_fixing(cur):
        t += n_bonus
    if rooting_depth_class(prev) == "deep" and rooting_depth_class(cur) != "deep":
        t += residue_bonus
    return t


def rotation_compatibility_score(prev: dict, cur: dict,
                                 base_scale: float = 1.0) -> float:
    """Criterion score c_rotation in [0,1] for planting `cur` right after
    `prev` (used inside the MCDM decision matrix for the immediate decision):

        c = clip(0.5 + 0.5 * T(prev->cur), 0, 1)   (T=-1 -> 0, T>=0 -> >=0.5)
    """
    t = transition_score(prev, cur)
    return max(0.0, min(1.0, 0.5 + 0.5 * t)) * base_scale


# ------------------------------------------------------ DP optimiser ----

def plan_rotation(
    base_scores: list[float],          # Z_i per candidate crop (MCDM SAW)
    crops: list[dict],                 # crop dicts with 'key','family'
    seasons: int = 3,
    lambda_trans: float = 0.5,
) -> dict:
    """Exact dynamic-programming optimum over multi-season rotations.

    Returns {"sequence": [crop indices per season], "objective": J}
    The same-family transition is forbidden (score -1 -> excluded).
    """
    n = len(crops)
    if n == 0 or seasons <= 0:
        return {"sequence": [], "objective": 0.0}

    # pre-compute transition matrix
    T = [[transition_score(crops[a], crops[b]) for b in range(n)]
         for a in range(n)]

    NEG = -1e9
    dp = [[NEG] * n for _ in range(seasons)]
    parent = [[None] * n for _ in range(seasons)]

    for i in range(n):
        dp[0][i] = base_scores[i]

    for k in range(1, seasons):
        for b in range(n):
            best, best_a = NEG, None
            for a in range(n):
                if T[a][b] <= -0.999:      # forbidden (same family)
                    continue
                val = dp[k - 1][a] + lambda_trans * T[a][b]
                if val > best:
                    best, best_a = val, a
            if best > NEG:
                dp[k][b] = best + base_scores[b]
                parent[k][b] = best_a

    end = max(range(n), key=lambda i: dp[seasons - 1][i])
    if dp[seasons - 1][end] <= NEG:
        return {"sequence": [], "objective": 0.0}

    seq = [end]
    for k in range(seasons - 1, 0, -1):
        seq.append(parent[k][seq[-1]])
    seq.reverse()
    return {"sequence": seq, "objective": round(dp[seasons - 1][end], 4)}


def nitrogen_balance(sequence: list[dict], n_fix_credit_kg_ha: float = 60.0,
                     cereal_demand_kg_ha: float = 90.0) -> dict:
    """Simple N bookkeeping over the planned rotation:
    legumes leave ~60 kg N/ha residual credit (documented typical range
    30-80 kg/ha), cereals demand ~90 kg/ha. Returns surplus/deficit per ha.
    """
    net = 0.0
    for c in sequence:
        if is_n_fixing(c):
            net += n_fix_credit_kg_ha
        else:
            net -= cereal_demand_kg_ha * 0.5   # non-cereal lower demand proxy
    return {"net_kg_ha": round(net, 1),
            "note": "screening-level N bookkeeping: legume credit 60, "
                    "non-legume demand 45 kg N/ha per season"}
