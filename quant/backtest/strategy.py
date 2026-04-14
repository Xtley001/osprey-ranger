"""
backtest/strategy.py

Full combined strategy backtest:
  - HL funding harvesting (short perp, regime-gated)
  - Kamino USDC lending floor
  - Regime-weighted allocation (HOT/NEUTRAL/COLD)
  - Alo entry / Ioc exit fee model (matches v18 keeper)
  - 5% drawdown emergency exit

This is the evidence document for the APY claim.
Run with real data (fetch_hl_funding.py first).

Usage:
    python backtest/strategy.py

    # Force data refresh:
    python backtest/strategy.py --refresh
"""

import sys
import os
import argparse
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from data.fetch_hl_funding  import fetch_all_coins, get_combined_df
from data.fetch_kamino_rates import get_kamino_apy_series
from backtest.regime_filter import apply_regime_filter, regime_distribution, regime_persistence
from backtest.metrics       import compute_metrics, print_metrics

# ── Strategy parameters ────────────────────────────────────────────────────────
# Must match keeper/src/risk/limits.ts and DEFAULT_STRATEGY in Osprey

INITIAL_CAPITAL   = 100_000      # USDC
MAKER_FEE         = 0.00010      # 0.010% — Alo post-only entry
TAKER_FEE         = 0.00035      # 0.035% — Ioc exit
REBALANCE_FEE     = 0.00035      # same as taker — drift rebalances always taker
REBALANCE_THRESH  = 0.05         # rebalance when allocation drifts >5%
MAX_DRAWDOWN_EXIT = 0.05         # 5% drawdown triggers emergency exit
MIN_FUNDING_ANN   = 0.08         # 8% annualised minimum to hold HL position


def run_strategy(
    funding_df:  pd.DataFrame,
    kamino_apy:  pd.Series,
    initial_capital: float = INITIAL_CAPITAL,
    verbose: bool = True,
) -> tuple[pd.DataFrame, pd.Series, float, float]:
    """
    Run the full combined strategy simulation hour by hour.

    Returns:
        equity_curve    — pd.Series of hourly USDC equity
        hourly_pnl      — pd.Series of hourly net PnL
        total_fees      — total fees paid
        total_funding   — total gross funding earned
    """
    # Align timestamps
    regime_df = apply_regime_filter(funding_df)
    common_idx = funding_df.index.intersection(kamino_apy.index).intersection(regime_df.index)

    if len(common_idx) == 0:
        raise ValueError("No overlapping timestamps between funding and Kamino data")

    funding_df = funding_df.loc[common_idx]
    kamino_apy = kamino_apy.loc[common_idx]
    regime_df  = regime_df.loc[common_idx]

    if verbose:
        print(f"\nBacktest period: {common_idx[0]} → {common_idx[-1]}")
        print(f"Hours:           {len(common_idx):,}")
        dist = regime_distribution(regime_df["regime"])
        print(f"Regime dist:     HOT={dist['HOT']:.1%}  NEUTRAL={dist['NEUTRAL']:.1%}  COLD={dist['COLD']:.1%}")

    # ── Simulation ─────────────────────────────────────────────────────────────
    equity        = initial_capital
    high_watermark = initial_capital

    equity_curve: list[float] = []
    hourly_pnl:   list[float] = []
    total_fees    = 0.0
    total_funding = 0.0

    # Track current allocation (updated each rebalance)
    hl_usdc     = 0.0
    kamino_usdc = initial_capital
    in_position = False

    prev_regime: str | None = None

    for ts in common_idx:
        regime     = regime_df.loc[ts, "regime"]
        target_hl  = regime_df.loc[ts, "hlAllocation"]
        target_k   = regime_df.loc[ts, "kaminoAlloc"]

        # Get best pair funding rate for this hour
        row          = funding_df.loc[ts]
        best_ann     = float(row.dropna().max()) if not row.dropna().empty else 0.0
        best_hourly  = best_ann / (24 * 365)

        # Kamino APY → hourly rate
        kamino_ann    = float(kamino_apy.loc[ts])
        kamino_hourly = kamino_ann / (24 * 365)

        # ── Emergency exit on drawdown ────────────────────────────────────────
        if equity < high_watermark * (1 - MAX_DRAWDOWN_EXIT) and in_position:
            # Close HL position: pay taker exit fee
            exit_fee    = hl_usdc * TAKER_FEE
            total_fees += exit_fee
            hl_usdc    -= exit_fee
            kamino_usdc += hl_usdc
            hl_usdc     = 0.0
            in_position = False

        # ── Regime change: check if rebalance needed ──────────────────────────
        current_hl_pct = hl_usdc / equity if equity > 0 else 0.0
        needs_rebal    = abs(current_hl_pct - target_hl) > REBALANCE_THRESH

        if needs_rebal or (regime != prev_regime and prev_regime is not None):
            target_hl_usdc = equity * target_hl

            if target_hl_usdc > hl_usdc:
                # Increase HL: withdraw from Kamino → pay maker entry fee on new HL
                delta        = target_hl_usdc - hl_usdc
                entry_fee    = delta * MAKER_FEE
                total_fees  += entry_fee
                hl_usdc      = target_hl_usdc - entry_fee
                kamino_usdc  = equity - hl_usdc
                in_position  = hl_usdc > 0

            elif target_hl_usdc < hl_usdc - 100:
                # Decrease HL: close partial position → pay taker + drift rebalance
                delta        = hl_usdc - target_hl_usdc
                rebal_fee    = delta * REBALANCE_FEE
                total_fees  += rebal_fee
                hl_usdc      = target_hl_usdc
                kamino_usdc  = equity - hl_usdc - rebal_fee
                if hl_usdc <= 0:
                    in_position = False

        prev_regime = regime

        # ── Skip HL if funding below minimum ─────────────────────────────────
        effective_hl = hl_usdc if best_ann >= MIN_FUNDING_ANN else 0.0

        # ── Accrue funding ────────────────────────────────────────────────────
        hl_earn    = effective_hl * best_hourly
        kamino_earn = (kamino_usdc + (hl_usdc - effective_hl)) * kamino_hourly

        gross_earn    = hl_earn + kamino_earn
        total_funding += gross_earn

        # Net PnL this hour (no per-hour fee — fees charged at open/close/rebalance)
        hour_pnl  = gross_earn
        equity   += hour_pnl

        if equity > high_watermark:
            high_watermark = equity

        equity_curve.append(equity)
        hourly_pnl.append(hour_pnl)

    eq_series  = pd.Series(equity_curve, index=common_idx)
    pnl_series = pd.Series(hourly_pnl,   index=common_idx)

    return eq_series, pnl_series, total_fees, total_funding


def main() -> None:
    parser = argparse.ArgumentParser(description="Osprey strategy backtest")
    parser.add_argument("--refresh", action="store_true", help="Force re-fetch data from APIs")
    parser.add_argument("--capital", type=float, default=INITIAL_CAPITAL, help="Starting USDC")
    parser.add_argument("--start",   type=str,   default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--end",     type=str,   default=None, help="End date YYYY-MM-DD")
    args = parser.parse_args()

    print("=" * 60)
    print("  Osprey × Ranger — Strategy Backtest")
    print("=" * 60)

    # Load data
    print("\nLoading funding rate data...")
    if args.refresh:
        funding_raw = fetch_all_coins(force_refresh=True)
        funding_df  = pd.concat(
            [df[["annualisedRate"]].rename(columns={"annualisedRate": c})
             for c, df in funding_raw.items()],
            axis=1,
        ).sort_index()
    else:
        funding_df = get_combined_df()

    print("Loading Kamino USDC APY data...")
    kamino_apy = get_kamino_apy_series()

    # Optional date filter
    if args.start:
        funding_df = funding_df.loc[args.start:]
        kamino_apy = kamino_apy.loc[args.start:]
    if args.end:
        funding_df = funding_df.loc[:args.end]
        kamino_apy = kamino_apy.loc[:args.end]

    print(f"\nRunning strategy with ${args.capital:,.0f} initial capital...")

    # ── Full strategy backtest ─────────────────────────────────────────────────
    eq, pnl, fees, funding = run_strategy(
        funding_df, kamino_apy,
        initial_capital=args.capital,
        verbose=True,
    )

    regime_df = apply_regime_filter(funding_df)
    regime_common = regime_df.loc[eq.index, "regime"]

    metrics = compute_metrics(
        equity_curve    = eq,
        hourly_pnl      = pnl,
        total_fees      = fees,
        total_funding   = funding,
        initial_capital = args.capital,
        regime_series   = regime_common,
    )
    print_metrics(metrics, label="Osprey Delta-Neutral (Regime-Gated HL + Kamino)")

    # ── Benchmark: Kamino-only (no HL) ────────────────────────────────────────
    kamino_common  = kamino_apy.loc[eq.index]
    k_hourly       = kamino_common / (24 * 365)
    k_eq           = (1 + k_hourly).cumprod() * args.capital
    k_pnl          = k_eq.diff().fillna(0)

    k_metrics = compute_metrics(
        equity_curve    = k_eq,
        hourly_pnl      = k_pnl,
        total_fees      = 0.0,
        total_funding   = float((k_hourly * args.capital).sum()),
        initial_capital = args.capital,
    )
    print_metrics(k_metrics, label="Benchmark: Kamino-Only (no HL exposure)")

    # ── Alpha ─────────────────────────────────────────────────────────────────
    alpha = metrics.annualised_apy - k_metrics.annualised_apy
    print(f"  Alpha over Kamino-only: +{alpha:.2f}%/yr\n")

    # Persistence stats
    persist = regime_persistence(regime_common)
    print("  Mean regime persistence (hours):")
    for r, h in persist.items():
        print(f"    {r:7s}: {h:.1f}h")

    # Save equity curve
    out_path = os.path.join(os.path.dirname(__file__), "..", "reports", "equity_curve.parquet")
    eq.to_frame("equity").assign(
        pnl    = pnl,
        regime = regime_common,
    ).to_parquet(out_path)
    print(f"\n  Equity curve saved to {out_path}")
    print("  Run reports/generate_tearsheet.py to produce PDF\n")


if __name__ == "__main__":
    main()
