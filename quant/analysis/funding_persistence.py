"""
analysis/funding_persistence.py

How long does elevated funding persist on Hyperliquid?

This analysis answers the key question behind Osprey's signal engine:
if a pair has been above the entry threshold for 2+ hours, how likely
is it to stay elevated for 4, 8, 24 more hours?

Persistence is the statistical basis for the entry confirmation logic.
"""

import sys
import os
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from data.fetch_hl_funding import get_combined_df

# Must match Osprey's DEFAULT_STRATEGY.entryRateThreshold
ENTRY_THRESHOLD_ANN = 0.35   # 35% annualised ≈ 0.04%/hr


def persistence_analysis(
    funding_df: pd.DataFrame,
    threshold:  float = ENTRY_THRESHOLD_ANN,
    top_n:      int = 10,
) -> dict[str, object]:
    """
    For each coin, compute:
      - Fraction of time above threshold
      - Mean consecutive hours above threshold (a "run")
      - Distribution of run lengths
      - Probability of still being elevated after N hours given currently elevated

    Returns a dict with analysis results.
    """
    results: dict[str, dict] = {}

    coins = funding_df.mean().nlargest(top_n).index.tolist()

    for coin in coins:
        if coin not in funding_df.columns:
            continue

        series = funding_df[coin].dropna()
        above  = series >= threshold

        # Compute run lengths
        runs: list[int] = []
        run = 0
        for val in above:
            if val:
                run += 1
            else:
                if run > 0:
                    runs.append(run)
                run = 0
        if run > 0:
            runs.append(run)

        if not runs:
            continue

        runs_arr = np.array(runs)

        # Conditional persistence: P(still elevated at t+N | elevated now)
        cond_persist: dict[int, float] = {}
        for n in [2, 4, 8, 12, 24]:
            # Fraction of runs that lasted at least N+1 hours
            p = float((runs_arr > n).mean())
            cond_persist[n] = p

        results[coin] = {
            "pct_above_threshold":  float(above.mean()),
            "mean_run_length_hrs":  float(runs_arr.mean()),
            "median_run_length_hrs": float(np.median(runs_arr)),
            "p90_run_length_hrs":   float(np.percentile(runs_arr, 90)),
            "total_runs":           len(runs),
            "cond_persistence":     cond_persist,
        }

    return results


def plot_persistence(results: dict, out_path: str) -> None:
    """Plot conditional persistence curves for top coins."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))
    fig.suptitle(
        "Hyperliquid Funding Rate Persistence Analysis\n"
        f"Threshold: ≥{ENTRY_THRESHOLD_ANN:.0%} annualised",
        fontsize=13, fontweight="bold",
    )

    # Left: mean run length bar chart
    ax = axes[0]
    coins       = list(results.keys())
    mean_runs   = [results[c]["mean_run_length_hrs"] for c in coins]
    pct_above   = [results[c]["pct_above_threshold"] * 100 for c in coins]

    x = np.arange(len(coins))
    bars = ax.bar(x, mean_runs, color="#43e8d8", alpha=0.8, edgecolor="#0a0b0f")
    ax.set_xticks(x)
    ax.set_xticklabels(coins, rotation=45, ha="right", fontsize=9)
    ax.set_ylabel("Mean Run Length (hours)", fontsize=10)
    ax.set_title("Mean Consecutive Hours Above Threshold", fontsize=11)
    ax.set_facecolor("#0f1117")
    fig.patch.set_facecolor("#0a0b0f")
    ax.tick_params(colors="white")
    ax.yaxis.label.set_color("white")
    ax.title.set_color("white")

    # Add % time above as text on bars
    for bar, pct in zip(bars, pct_above):
        ax.text(
            bar.get_x() + bar.get_width() / 2,
            bar.get_height() + 0.2,
            f"{pct:.1f}%",
            ha="center", va="bottom", fontsize=7, color="#f5c542",
        )

    # Right: conditional persistence curves
    ax2 = axes[1]
    hours = [2, 4, 8, 12, 24]
    colors = plt.cm.tab10.colors

    for i, (coin, data) in enumerate(list(results.items())[:8]):
        cond = data["cond_persistence"]
        probs = [cond.get(h, 0) for h in hours]
        ax2.plot(hours, probs, marker="o", label=coin,
                 color=colors[i % len(colors)], linewidth=1.8)

    ax2.set_xlabel("Hours after entering elevated state", fontsize=10)
    ax2.set_ylabel("P(still elevated)", fontsize=10)
    ax2.set_title("Conditional Persistence Probability", fontsize=11)
    ax2.legend(fontsize=8, facecolor="#161820", labelcolor="white")
    ax2.set_facecolor("#0f1117")
    ax2.set_ylim(0, 1)
    ax2.tick_params(colors="white")
    ax2.yaxis.label.set_color("white")
    ax2.xaxis.label.set_color("white")
    ax2.title.set_color("white")

    plt.tight_layout()
    plt.savefig(out_path, dpi=150, bbox_inches="tight", facecolor="#0a0b0f")
    print(f"  Plot saved: {out_path}")
    plt.close()


def main() -> None:
    print("=" * 55)
    print("  Funding Rate Persistence Analysis")
    print("=" * 55)

    funding_df = get_combined_df()
    results    = persistence_analysis(funding_df)

    print(f"\n{'Coin':<8} {'%>Threshold':>12} {'MeanRun(h)':>11} {'P(>8h|el)':>10}")
    print("─" * 45)
    for coin, data in sorted(results.items(),
                              key=lambda x: x[1]["mean_run_length_hrs"], reverse=True):
        print(
            f"  {coin:<6} "
            f"{data['pct_above_threshold']:>11.1%} "
            f"{data['mean_run_length_hrs']:>10.1f}h "
            f"{data['cond_persistence'].get(8, 0):>9.1%}"
        )

    # Plot
    out_dir = os.path.join(os.path.dirname(__file__), "..", "reports")
    os.makedirs(out_dir, exist_ok=True)
    plot_persistence(results, os.path.join(out_dir, "persistence_analysis.png"))

    print("\n  Key insight: If a pair has been above threshold for 2h,")
    print(f"  P(still elevated at 8h) is shown above.")
    print("  This is the statistical basis for Osprey's 2-hour confirmation logic.\n")


if __name__ == "__main__":
    main()
