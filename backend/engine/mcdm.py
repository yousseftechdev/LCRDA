"""
mcdm.py -- Core MCDM decision engine.

This module implements the mathematical core of the Multi-Criteria Decision
Making (MCDM) pipeline used by the Crop Rotation Decision-Aid Hub,
following:

    Gunawan, M. I., Sitopu, J. W., & Sechan, G. (2024). Optimizing Crop
    Selection: A Multi-Criteria Decision Support System for Sustainable
    Agriculture. International Journal of Enterprise Modelling, 18(3), 113-123.

The pipeline (all scores c_ij normalised to [0, 1]):

  1. AHP  - Analytic Hierarchy Process (Saaty 1980): farmer priority
            judgements -> criterion weight vector w (sum w = 1),
            validated with the consistency ratio CR <= 0.10.
  2. SAW  - Simple Additive Weighting, EXACTLY the paper's objective
            Z = sum_i sum_j W_j * C_ij * X_ij, which for a single selected
            crop collapses to Z_i = sum_j w_j * c_ij; choose argmax_i.
  3. TOPSIS (Hwang & Yoon 1981) as an independent second ranking method to
            verify the SAW ordering (flagged to the user on disagreement).

No third-party imports are required here except numpy for the AHP
eigenvector, so the engine runs on a Raspberry Pi 4 with minimal deps.
"""

from __future__ import annotations

import numpy as np

# --------------------------------------------------------------------------
# 1. AHP -- Analytic Hierarchy Process (Saaty 1980; Vaidya & Kumar 2006)
# --------------------------------------------------------------------------

# Saaty Random Index table, n = number of criteria (n=1..12).
# Source: Saaty, "The Analytic Hierarchy Process" (1980); standard values.
RANDOM_INDEX = {
    1: 0.0, 2: 0.0, 3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24,
    7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49, 11: 1.51, 12: 1.48,
}

# Saaty's fundamental 1-9 pairwise comparison scale.
SAATY_SCALE = [
    (1, "equal importance"),
    (3, "moderate importance"),
    (5, "strong importance"),
    (7, "very strong importance"),
    (9, "extreme importance"),
    (2, "intermediate (2)"),
    (4, "intermediate (4)"),
    (6, "intermediate (6)"),
    (8, "intermediate (8)"),
]


def ahp_weights(pairwise: list[list[float]]) -> dict:
    """Derive criterion weights from a pairwise-comparison matrix using AHP.

    Parameters
    ----------
    pairwise : n x n matrix of Saaty-scale judgements a_ij
               (a_ij > 1 means criterion i is more important than j;
                reciprocals are taken automatically).

    Returns
    -------
    dict with keys:
        weights  : numpy array (principal eigenvector, normalised, sum = 1)
        lambda_max, CI, CR, consistent (bool, CR <= 0.10)

    Method (exact AHP):
        * A w = lambda_max w  ->  w = principal eigenvector of A,
          normalised so that sum(w) = 1.
        * CI = (lambda_max - n) / (n - 1)
        * CR = CI / RI(n);  CR <= 0.10 is accepted (Saaty's rule).
    """
    A = np.array(pairwise, dtype=float)
    n = A.shape[0]
    if n < 1:
        raise ValueError("empty pairwise matrix")
    if n == 1:
        return {
            "weights": np.array([1.0]),
            "lambda_max": 1.0,
            "CI": 0.0,
            "CR": 0.0,
            "consistent": True,
        }

    # Enforce reciprocal symmetry: a_ji = 1 / a_ij (user may only fill one side)
    for i in range(n):
        for j in range(i + 1, n):
            if A[i, j] == 0:
                A[i, j] = 1.0 / A[j, i] if A[j, i] != 0 else 1.0
            A[j, i] = 1.0 / A[i, j]

    # Principal eigenvector (numpy gives eigh/eig; use eig, take largest |lambda|)
    eigvals, eigvecs = np.linalg.eig(A)
    k = int(np.argmax(eigvals.real))
    lambda_max = float(eigvals.real[k])
    w = np.abs(eigvecs[:, k].real)
    w = w / w.sum()

    CI = (lambda_max - n) / (n - 1)
    RI = RANDOM_INDEX.get(n, 1.49)
    CR = 0.0 if RI == 0 else CI / RI
    return {
        "weights": w,
        "lambda_max": lambda_max,
        "CI": CI,
        "CR": CR,
        "consistent": CR <= 0.10,
    }


def priorities_to_pairwise(priorities: list[float]) -> list[list[float]]:
    """Convert a simple priority score vector (1..9 per criterion) into a
    Saaty pairwise matrix  a_ij = clamp(p_i / p_j, 1/9, 9).

    This lets the UI use one slider per criterion (much easier for farmers)
    while still producing a valid AHP pairwise-comparison matrix.
    """
    n = len(priorities)
    A = [[1.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            r = (priorities[i] or 1e-9) / (priorities[j] or 1e-9)
            r = min(9.0, max(1.0 / 9.0, r))
            # Snap to Saaty scale values {1/9..1, 1..9}
            A[i][j] = _snap_saaty(r)
    return A


_SaatyVals = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0]


def _snap_saaty(r: float) -> float:
    if r >= 1:
        vals = _SaatyVals
    else:
        r = 1.0 / r
        vals = _SaatyVals
    best = min(vals, key=lambda v: abs(v - r))
    return best if r >= 1 else 1.0 / best


# --------------------------------------------------------------------------
# 2. SAW -- Simple Additive Weighting (the paper's exact objective function)
# --------------------------------------------------------------------------

def saw(decision_matrix: list[list[float]], weights: list[float]) -> list[float]:
    """Simple Additive Weighting.

    Z_i = sum_j w_j * c_ij    (all c_ij in [0,1], sum w_j = 1)

    This is mathematically identical to the MCDM paper's objective
    Z = sum_i sum_j W_j * C_ij * X_ij with the single-crop constraint
    (one crop selected -> exactly one X set to 1, so argmax over i).
    Returns the vector of overall scores Z, one per alternative.
    """
    C = np.array(decision_matrix, dtype=float)
    w = np.array(weights, dtype=float)
    if C.ndim != 2 or C.shape[1] != len(w):
        raise ValueError("decision_matrix must be n_alternatives x n_criteria")
    if abs(w.sum() - 1.0) > 1e-6:
        raise ValueError("weights must sum to 1 (they are 'importance' shares)")
    return (C @ w).tolist()


# --------------------------------------------------------------------------
# 3. TOPSIS -- verification ranking (Hwang & Yoon 1981)
# --------------------------------------------------------------------------

def topsis(decision_matrix: list[list[float]], weights: list[float]) -> list[float]:
    """TOPSIS closeness coefficients C_i in [0,1]; higher = closer to ideal.

    Steps:
      1. Vector normalisation:  v_ij = c_ij / sqrt(sum_i c_ij^2)
      2. Weight:                v_ij *= w_j
      3. Ideal        a+_j = max_i v_ij   (benefit criteria)
         Anti-ideal   a-_j = min_i v_ij
      4. d+_i = ||v_i - a+||,  d-_i = ||v_i - a-||
      5. C_i = d-_i / (d+_i + d-_i)
    All hub criteria are benefit-type (higher = better); cost-type criteria
    are pre-inverted by the caller.
    """
    C = np.array(decision_matrix, dtype=float)
    w = np.array(weights, dtype=float)
    # 1. vector normalisation (avoid div-by-zero for all-zero columns)
    norms = np.sqrt((C ** 2).sum(axis=0))
    norms[norms == 0] = 1.0
    V = C / norms
    # 2. weights
    V = V * w
    # 3. ideals
    a_plus = V.max(axis=0)
    a_minus = V.min(axis=0)
    # 4-5. distances & closeness
    d_plus = np.sqrt(((V - a_plus) ** 2).sum(axis=1))
    d_minus = np.sqrt(((V - a_minus) ** 2).sum(axis=1))
    denom = d_plus + d_minus
    denom[denom == 0] = 1.0
    return (d_minus / denom).tolist()


# --------------------------------------------------------------------------
# Full pipeline: build weights, rank alternatives, verify with TOPSIS
# --------------------------------------------------------------------------

def rank_alternatives(
    decision_matrix: list[list[float]],
    priorities: list[float] | None = None,
    pairwise: list[list[float]] | None = None,
    names: list[str] | None = None,
) -> dict:
    """Complete MCDM pipeline for one decision (e.g. 'next crop to plant').

    Parameters
    ----------
    decision_matrix : n_alternatives x n_criteria, all entries in [0,1]
    priorities      : optional priority score (1..9) per criterion -> AHP
    pairwise        : optional explicit Saaty pairwise matrix (overrides
                      `priorities`)
    names           : optional alternative labels

    Returns
    -------
    dict with weights, ahp diagnostics, SAW ranking, TOPSIS ranking and
    full per-alternative detail.
    """
    n_crit = len(decision_matrix[0])
    if pairwise is not None:
        pw = pairwise
    elif priorities is not None:
        pw = priorities_to_pairwise(priorities)
    else:
        pw = [[1.0] * n_crit for _ in range(n_crit)]

    ahp = ahp_weights(pw)
    w = ahp["weights"]

    z_saw = saw(decision_matrix, w.tolist())
    z_topsis = topsis(decision_matrix, w.tolist())

    order_saw = sorted(range(len(z_saw)), key=lambda i: z_saw[i], reverse=True)
    order_topsis = sorted(range(len(z_topsis)), key=lambda i: z_topsis[i], reverse=True)

    agree = (
        len(order_saw) == 0
        or len(order_topsis) == 0
        or order_saw[0] == order_topsis[0]
    )

    alts = []
    for i, (z, t) in enumerate(zip(z_saw, z_topsis)):
        alts.append(
            {
                "index": i,
                "name": names[i] if names else str(i),
                "criteria": decision_matrix[i],
                "score_saw": round(float(z), 4),
                "score_topsis": round(float(t), 4),
                "rank_saw": order_saw.index(i) + 1,
                "rank_topsis": order_topsis.index(i) + 1,
            }
        )

    return {
        "weights": [round(float(x), 4) for x in w],
        "ahp": {
            "lambda_max": round(ahp["lambda_max"], 4),
            "CI": round(ahp["CI"], 4),
            "CR": round(ahp["CR"], 4),
            "consistent": ahp["consistent"],
        },
        "alternatives": alts,
        "ranking_saw": order_saw,
        "ranking_topsis": order_topsis,
        "winner": order_saw[0] if order_saw else None,
        "methods_agree": agree,
    }
