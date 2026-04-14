"""
backtest/metrics.py

Risk-adjusted performance metrics for the backtest engine.
Computes Sharpe, Sortino, max drawdown, Calmar ratio, and APY.
"""

import numpy as np
import pandas as pd
from typing import NamedTuple


class PerformanceMetrics(NamedTuple):
    total_return_pct:    float   # e.g. 35.2 = 35.2%
    annualised_apy:      float   # annualised from backtest period
    sharpe_ratio:        float
    sortino_ratio:       float
    max_drawdown_pct:    float   # e.g. 2.1 = 2.1%
    calmar_ratio:        float   # annualised_apy / max_drawdown
    win_rate_pct:        float   # % of hours with positive return
    avg_daily_yield_pct: float
    total_funding_usd:   float
    total_fees_usd:      float
    net_profit_usd:      float
    num_hours:           int
    num_regime_switches: int


def compute_metrics(
    equity_curve:  pd.Series,    # hourly equity in USDC
    hourly_pnl:    pd.Series,    # hourly net PnL
    total_fees:    float,
    total_funding: float,
    initial_capital: float,
    regime_series: pd.Series | None = None,
) -> PerformanceMetrics:
    """
    Compute full performance metrics from an equity curve.

    Args:
        equity_curve:    hourly USDC equity
        hourly_pnl:      hourly net PnL (funding earned - fees)
        total_fees:      total fees paid over period
        total_funding:   total gross funding earned
        initial_capital: starting USDC
        regime_series:   optional regime labels for regime switch count
    """
    n_hours = len(equity_curve)

    # ── Returns ───────────────────────────────────────────────────────────────
    hourly_returns  = equity_curve.pct_change().dropna()
    total_return    = (equity_curve.iloc[-1] - initial_capital) / initial_capital
    days_in_backtest = n_hours / 24
    annualised_apy  = (1 + total_return) ** (365 / max(days_in_backtest, 1)) - 1

    # ── Sharpe ratio (annualised, hourly risk-free ≈ 0) ──────────────────────
    mean_hr   = hourly_returns.mean()
    std_hr    = hourly_returns.std()
    sharpe    = (mean_hr / std_hr * np.sqrt(8760)) if std_hr > 0 else 0.0

    # ── Sortino ratio (downside deviation only) ───────────────────────────────
    downside  = hourly_returns[hourly_returns < 0]
    down_std  = downside.std()
    sortino   = (mean_hr / down_std * np.sqrt(8760)) if down_std > 0 else 0.0

    # ── Max drawdown ──────────────────────────────────────────────────────────
    rolling_max = equity_curve.cummax()
    drawdown    = (rolling_max - equity_curve) / rolling_max
    max_dd      = float(drawdown.max())

    # ── Calmar ratio ──────────────────────────────────────────────────────────
    calmar = annualised_apy / max_dd if max_dd > 0 else 0.0

    # ── Win rate ──────────────────────────────────────────────────────────────
    win_rate = float((hourly_pnl > 0).sum() / max(len(hourly_pnl), 1))

    # ── Regime switches ───────────────────────────────────────────────────────
    n_switches = 0
    if regime_series is not None and len(regime_series) > 1:
        n_switches = int((regime_series != regime_series.shift()).sum())

    return PerformanceMetrics(
        total_return_pct    = total_return * 100,
        annualised_apy      = annualised_apy * 100,
        sharpe_ratio        = sharpe,
        sortino_ratio       = sortino,
        max_drawdown_pct    = max_dd * 100,
        calmar_ratio        = calmar,
        win_rate_pct        = win_rate * 100,
        avg_daily_yield_pct = (mean_hr * 24) * 100,
        total_funding_usd   = total_funding,
        total_fees_usd      = total_fees,
        net_profit_usd      = total_return * initial_capital,
        num_hours           = n_hours,
        num_regime_switches = n_switches,
    )


def print_metrics(m: PerformanceMetrics, label: str = "Strategy") -> None:
    """Pretty-print a PerformanceMetrics namedtuple."""
    print(f"\n{'─' * 50}")
    print(f"  {label}")
    print(f"{'─' * 50}")
    print(f"  Total Return:       {m.total_return_pct:>8.2f}%")
    print(f"  Annualised APY:     {m.annualised_apy:>8.2f}%")
    print(f"  Sharpe Ratio:       {m.sharpe_ratio:>8.2f}")
    print(f"  Sortino Ratio:      {m.sortino_ratio:>8.2f}")
    print(f"  Max Drawdown:       {m.max_drawdown_pct:>8.2f}%")
    print(f"  Calmar Ratio:       {m.calmar_ratio:>8.2f}")
    print(f"  Win Rate:           {m.win_rate_pct:>8.1f}%")
    print(f"  Avg Daily Yield:    {m.avg_daily_yield_pct:>8.4f}%")
    print(f"  Total Funding:      ${m.total_funding_usd:>9.2f}")
    print(f"  Total Fees:        -${m.total_fees_usd:>9.2f}")
    print(f"  Net Profit:         ${m.net_profit_usd:>9.2f}")
    print(f"  Hours Backtested:   {m.num_hours:>8,d}")
    print(f"  Regime Switches:    {m.num_regime_switches:>8,d}")
    print(f"{'─' * 50}\n")
