"""
data/fetch_kamino_rates.py

Fetch historical Kamino USDC lending APY data.
This is the "floor yield" the vault earns in COLD regime or on the
portion not deployed to HL.

When HL funding is low, 90–95% of vault capital sits in Kamino earning
the USDC supply APY. This is typically 5–12% annualised on mainnet.

Falls back to a historically calibrated synthetic series if the API
is unavailable (Kamino API can be rate-limited).
"""

import requests
import pandas as pd
import numpy as np
import os
from datetime import datetime, timezone

KAMINO_API = "https://api.kamino.finance"
CACHE_DIR  = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Kamino Main Market USDC reserve — verify from app.kamino.finance
# These addresses are left as placeholders; populate from live Kamino docs.
KAMINO_USDC_RESERVE = os.getenv(
    "KAMINO_USDC_RESERVE",
    "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q",  # verify before use
)


def fetch_kamino_usdc_apy() -> pd.DataFrame:
    """
    Attempt to fetch historical USDC supply APY from Kamino.
    Returns DataFrame with columns: supplyApy, borrowApy, timestamp index.
    Falls back to synthetic series if API unavailable.
    """
    cache_path = os.path.join(CACHE_DIR, "kamino_usdc_apy.parquet")

    try:
        url = f"{KAMINO_API}/v2/reserves/{KAMINO_USDC_RESERVE}/metrics/history"
        res = requests.get(url, timeout=20, params={"limit": 10_000})
        res.raise_for_status()
        data = res.json()

        if not data or not isinstance(data, list):
            raise ValueError("Unexpected response shape")

        df = pd.DataFrame(data)

        # Normalise column names — Kamino API may vary
        col_map = {}
        for c in df.columns:
            lc = c.lower()
            if "supply" in lc and "apy" in lc:
                col_map[c] = "supplyApy"
            elif "borrow" in lc and "apy" in lc:
                col_map[c] = "borrowApy"
            elif "time" in lc or "timestamp" in lc or "date" in lc:
                col_map[c] = "timestamp"
        df = df.rename(columns=col_map)

        if "timestamp" in df.columns:
            df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
            df = df.dropna(subset=["timestamp"]).set_index("timestamp").sort_index()

        df.to_parquet(cache_path)
        print(f"  Kamino data fetched: {len(df)} records")
        return df

    except Exception as e:
        print(f"  ⚠  Kamino API unavailable ({e})")
        print("     Using synthetic fallback (7% flat — conservative)")
        return _synthetic_kamino_apy()


def _synthetic_kamino_apy() -> pd.DataFrame:
    """
    Synthetic USDC supply APY series for backtesting when Kamino API is unavailable.

    Calibrated to historical observations:
    - Base rate ~5–8% when USDC demand is low
    - Spikes to 10–15% during high DeFi activity periods
    - Modelled as mean-reverting with realistic volatility
    """
    cache_path = os.path.join(CACHE_DIR, "kamino_usdc_apy.parquet")
    if os.path.exists(cache_path):
        return pd.read_parquet(cache_path)

    # Generate from Jan 2023 to now at hourly frequency
    start = datetime(2023, 1, 1, tzinfo=timezone.utc)
    end   = datetime.now(timezone.utc)
    idx   = pd.date_range(start, end, freq="h", tz="UTC")

    # Mean-reverting model: Ornstein-Uhlenbeck around 7% mean
    np.random.seed(42)
    n       = len(idx)
    apy     = np.zeros(n)
    mean    = 0.07
    theta   = 0.001  # mean reversion speed
    sigma   = 0.002  # volatility
    apy[0]  = mean

    for i in range(1, n):
        apy[i] = (apy[i-1]
                  + theta * (mean - apy[i-1])
                  + sigma * np.random.randn())
    apy = np.clip(apy, 0.02, 0.20)  # floor 2%, cap 20%

    df = pd.DataFrame({"supplyApy": apy, "borrowApy": apy * 1.3}, index=idx)
    df.to_parquet(cache_path)
    return df


def get_kamino_apy_series() -> pd.Series:
    """
    Returns hourly USDC supply APY as a Series.
    Resamples to hourly if Kamino returns daily data.
    """
    df = fetch_kamino_usdc_apy()
    if "supplyApy" not in df.columns:
        print("  ⚠  supplyApy column missing — using 7% flat")
        idx = pd.date_range("2023-01-01", periods=8760 * 2, freq="h", tz="UTC")
        return pd.Series(0.07, index=idx, name="supplyApy")

    apy = df["supplyApy"]
    # Resample to hourly if needed
    if apy.index.freq != "h":
        apy = apy.resample("h").interpolate()

    return apy


if __name__ == "__main__":
    print("Fetching Kamino USDC lending APY history...\n")
    apy = get_kamino_apy_series()
    print(f"Records:    {len(apy)}")
    print(f"Date range: {apy.index[0]} → {apy.index[-1]}")
    print(f"Mean APY:   {apy.mean():.2%}")
    print(f"Min APY:    {apy.min():.2%}")
    print(f"Max APY:    {apy.max():.2%}")
