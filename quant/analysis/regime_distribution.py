"""
analysis/regime_distribution.py

Historical regime distribution analysis.
Answers: what fraction of time has the HL market been HOT/NEUTRAL/COLD?
How long do regimes persist? How quickly do they transition?

This backs the strategy thesis that the market spends meaningful time
in HOT/NEUTRAL regimes where HL funding is worth harvesting.
"""

import sys
import os
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from data.fetch_hl_funding  import get_combined_df
from backtest.regime_filter import (
    apply_regime_filter, regime_distribution, regime_persistence,
    REGIME_HL_ALLOCATION,
)


def regime_transition_matrix(regime_series: pd.Series) -> pd.DataFrame:
    """
    Compute the transition probability matrix between regimes.
    Entry [i, j] = P(next hour = j | current = i).
    """
    labels = ["HOT", "NEUTRAL", "COLD"]
    matrix = pd.DataFrame(0.0, index=labels, columns=labels)

    for cur, nxt in zip(regime_series.iloc[:-1], regime_series.iloc[1:]):
        matrix.loc[cur, nxt] += 1

    # Normalise rows to probabilities
    row_sums = matrix.sum(axis=1)
    for label in labels:
        if row_sums[label] > 0:
            matrix.loc[label] = matrix.loc[label] / row_sums[label]

    return matrix


def annualised_yield_by_regime(
    funding_df: pd.DataFrame,
    regime_df:  pd.DataFrame,
) -> dict[str, float]:
    """
    For each regime, compute the mean annualised yield of the best
    available pair. This is the gross HL yield before fees.
    """
    results: dict[str, float] = {}
    for label in ["HOT", "NEUTRAL", "COLD"]:
        mask = regime_df["regime"] == label
        if not mask.any():
            results[label] = 0.0
            continue

        subset    = funding_df.loc[mask]
        best_each = subset.max(axis=1)
        results[label] = float(best_each.mean())

    return results


def plot_regime_history(regime_series: pd.Series, out_path: str) -> None:
    """Plot regime over time as a colour band."""
    fig, ax = plt.subplots(figsize=(16, 3))

    colour_map = {"HOT": "#ff4f6e", "NEUTRAL": "#43e8d8", "COLD": "#5b8dee"}
    label_map  = {"HOT": 2, "NEUTRAL": 1, "COLD": 0}

    numeric = regime_series.map(label_map)

    for label, color in colour_map.items():
        mask = regime_series == label
        ax.fill_between(
            regime_series.index,
            0, 1,
            where=mask.values,
            color=color, alpha=0.5, label=label,
            transform=ax.get_xaxis_transform(),
        )

    ax.set_yticks([])
    ax.set_title("HL Market Regime — Historical (HOT / NEUTRAL / COLD)", color="white", fontsize=12)
    ax.legend(loc="upper right", fontsize=9, facecolor="#161820", labelcolor="white")
    ax.set_facecolor("#0f1117")
    fig.patch.set_facecolor("#0a0b0f")
    ax.tick_params(colors="white")
    ax.spines[:].set_color("#2a3240")

    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor="#0a0b0f")
    plt.close()
    print(f"  Regime history plot saved: {out_path}")


def main() -> None:
    print("=" * 55)
    print("  Regime Distribution Analysis")
    print("=" * 55)

    funding_df = get_combined_df()
    regime_df  = apply_regime_filter(funding_df)
    regime_s   = regime_df["regime"]

    # Distribution
    dist = regime_distribution(regime_s)
    print(f"\n  Time in regime:")
    for label, frac in dist.items():
        hrs = frac * len(regime_s)
        print(f"    {label:7s}: {frac:6.1%}  ({hrs:,.0f}h)")

    # Persistence
    persist = regime_persistence(regime_s)
    print(f"\n  Mean regime run length (before transition):")
    for label, hrs in persist.items():
        print(f"    {label:7s}: {hrs:.1f}h avg")

    # Transition matrix
    trans = regime_transition_matrix(regime_s)
    print(f"\n  Transition probability matrix (row=current, col=next):")
    print(trans.to_string(float_format=lambda x: f"{x:.1%}"))

    # Yield by regime
    yields = annualised_yield_by_regime(funding_df, regime_df)
    print(f"\n  Mean best-pair annualised yield by regime:")
    for label, yld in yields.items():
        alloc  = REGIME_HL_ALLOCATION[label]
        blended = yld * alloc
        print(f"    {label:7s}: {yld:6.1%}/yr  (HL alloc {alloc:.0%} → blended {blended:.1%}/yr)")

    # Weighted blended HL yield
    blended_total = sum(
        dist[label] * yields[label] * REGIME_HL_ALLOCATION[label]
        for label in ["HOT", "NEUTRAL", "COLD"]
    )
    print(f"\n  Time-weighted blended HL contribution: {blended_total:.1%}/yr")

    # Plots
    out_dir = os.path.join(os.path.dirname(__file__), "..", "reports")
    os.makedirs(out_dir, exist_ok=True)
    plot_regime_history(regime_s, os.path.join(out_dir, "regime_history.png"))


if __name__ == "__main__":
    main()
