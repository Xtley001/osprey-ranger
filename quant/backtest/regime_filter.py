"""
backtest/regime_filter.py

Applies HOT/NEUTRAL/COLD regime classification to historical funding data.
Must match Osprey's live regime engine (src/engine/regime.ts) exactly.

Thresholds:
  HOT:     median top-20 annualised rate > 20%
  NEUTRAL: median top-20 annualised rate  8%–20%
  COLD:    median top-20 annualised rate < 8%
"""

import pandas as pd
import numpy as np
from typing import Literal

RegimeLabel = Literal["HOT", "NEUTRAL", "COLD"]

# Must match api/regime.ts and shared/types.ts
HOT_FLOOR     = 0.20   # 20% annualised
NEUTRAL_FLOOR = 0.08   # 8% annualised

# Target HL allocation by regime — must match risk/limits.ts
REGIME_HL_ALLOCATION: dict[RegimeLabel, float] = {
    "HOT":     0.70,
    "NEUTRAL": 0.40,
    "COLD":    0.05,
}

REGIME_KAMINO_ALLOCATION: dict[RegimeLabel, float] = {
    "HOT":     0.30,
    "NEUTRAL": 0.60,
    "COLD":    0.95,
}


def classify_regime(median_top20_ann: float) -> RegimeLabel:
    """Classify a single hourly median rate into HOT/NEUTRAL/COLD."""
    if median_top20_ann > HOT_FLOOR:
        return "HOT"
    elif median_top20_ann > NEUTRAL_FLOOR:
        return "NEUTRAL"
    else:
        return "COLD"


def compute_market_median(funding_df: pd.DataFrame, top_n: int = 20) -> pd.Series:
    """
    For each hour, compute the median annualised funding rate
    across the top N coins by that hour's rates.

    This mirrors Osprey's regime detection (top-20 by OI proxy).
    Since we don't have OI history, we use top-N by current rate,
    which is correlated with OI in practice.
    """
    def hour_median(row: pd.Series) -> float:
        vals = row.dropna()
        if vals.empty:
            return 0.0
        return float(vals.nlargest(min(top_n, len(vals))).median())

    return funding_df.apply(hour_median, axis=1)


def apply_regime_filter(funding_df: pd.DataFrame) -> pd.DataFrame:
    """
    Compute regime label for every hour in the funding history.

    Returns a DataFrame with columns:
      medianTop20Ann — median annualised rate of top-20 coins
      regime         — HOT | NEUTRAL | COLD
      hlAllocation   — target HL % under this regime
      kaminoAlloc    — target Kamino % under this regime
    """
    median = compute_market_median(funding_df)

    regime_labels = median.apply(classify_regime)

    df = pd.DataFrame({
        "medianTop20Ann": median,
        "regime":         regime_labels,
        "hlAllocation":   regime_labels.map(REGIME_HL_ALLOCATION),
        "kaminoAlloc":    regime_labels.map(REGIME_KAMINO_ALLOCATION),
    })

    return df


def regime_distribution(regime_series: pd.Series) -> dict[str, float]:
    """Return the fraction of hours in each regime."""
    counts = regime_series.value_counts(normalize=True)
    return {
        "HOT":     float(counts.get("HOT", 0)),
        "NEUTRAL": float(counts.get("NEUTRAL", 0)),
        "COLD":    float(counts.get("COLD", 0)),
    }


def regime_persistence(regime_series: pd.Series) -> dict[str, float]:
    """
    For each regime, compute the mean number of consecutive hours
    the market stays in that regime before transitioning.
    """
    results: dict[str, list[int]] = {"HOT": [], "NEUTRAL": [], "COLD": []}
    current  = regime_series.iloc[0]
    run      = 1

    for label in regime_series.iloc[1:]:
        if label == current:
            run += 1
        else:
            results[str(current)].append(run)
            current = label
            run     = 1
    results[str(current)].append(run)

    return {
        r: float(np.mean(runs)) if runs else 0.0
        for r, runs in results.items()
    }
