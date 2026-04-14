"""
data/fetch_hl_funding.py

Fetch complete historical funding rate data from Hyperliquid.
HL provides hourly funding data via /info fundingHistory endpoint.
Fetches all available history (from Jan 2023) for top coins by OI.

Funding on HL is paid every hour — 8× more frequent than Binance/Bybit.
This is the core structural advantage of the strategy.

Output: per-coin parquet files in data/cache/, combined parquet.
"""

import requests
import pandas as pd
import os
from datetime import datetime, timezone

HL_API    = "https://api.hyperliquid.xyz/info"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Top coins by open interest — covers bulk of HL volume
TOP_COINS = [
    "BTC", "ETH", "SOL", "ARB", "AVAX", "DOGE", "LINK", "BNB",
    "OP",  "SUI", "APT", "INJ", "TIA",  "SEI",  "NEAR", "FTM",
    "WLD", "ATOM", "MATIC", "LTC",
    # TradFi pairs — key thesis pairs
    "NVDA", "AAPL", "GOLD", "WTIOIL", "TSLA",
]


def fetch_funding_history(coin: str, start_ms: int | None = None) -> pd.DataFrame:
    """
    Fetch hourly funding rate history for a single coin.

    Args:
        coin:     e.g. "BTC"
        start_ms: epoch ms. None = earliest available (Jan 2023).

    Returns:
        DataFrame indexed by UTC timestamp with columns:
          fundingRate   — raw hourly rate (e.g. 0.0001 = 0.01%/hr)
          annualisedRate — fundingRate * 24 * 365
          coin
    """
    if start_ms is None:
        start_ms = int(datetime(2023, 1, 1, tzinfo=timezone.utc).timestamp() * 1000)

    payload = {
        "type":      "fundingHistory",
        "coin":      coin,
        "startTime": start_ms,
    }

    try:
        res = requests.post(HL_API, json=payload, timeout=30)
        res.raise_for_status()
        data = res.json()
    except Exception as e:
        print(f"  ⚠  {coin}: API error — {e}")
        return pd.DataFrame()

    if not data:
        print(f"  ⚠  {coin}: no data returned")
        return pd.DataFrame()

    df = pd.DataFrame(data)
    df["time"]           = pd.to_datetime(df["time"], unit="ms", utc=True)
    df["fundingRate"]    = df["fundingRate"].astype(float)
    df["annualisedRate"] = df["fundingRate"] * 24 * 365
    df["coin"]           = coin
    return df.set_index("time").sort_index()


def fetch_all_coins(force_refresh: bool = False) -> dict[str, pd.DataFrame]:
    """
    Fetch and cache funding history for all coins.
    Returns {coin: DataFrame}.
    """
    all_data: dict[str, pd.DataFrame] = {}

    for coin in TOP_COINS:
        cache_path = os.path.join(CACHE_DIR, f"funding_{coin}.parquet")

        if os.path.exists(cache_path) and not force_refresh:
            print(f"  Loaded cached {coin}")
            df = pd.read_parquet(cache_path)
        else:
            print(f"  Fetching {coin}...")
            df = fetch_funding_history(coin)
            if not df.empty:
                df.to_parquet(cache_path)
                print(f"    → {len(df)} hourly records")

        if not df.empty:
            all_data[coin] = df

    return all_data


def get_combined_df() -> pd.DataFrame:
    """
    Returns a single DataFrame with hourly annualised rates for all coins,
    each coin as a column. Indexed by UTC timestamp.
    """
    all_data = fetch_all_coins()
    frames = []
    for coin, df in all_data.items():
        col = df[["annualisedRate"]].rename(columns={"annualisedRate": coin})
        frames.append(col)

    combined = pd.concat(frames, axis=1).sort_index()
    return combined


def get_top_pair_by_hour(combined_df: pd.DataFrame) -> pd.Series:
    """
    For each hour, return the coin with the highest annualised funding rate.
    This is the pair the strategy would have selected.
    """
    return combined_df.idxmax(axis=1)


def get_market_median_top20(combined_df: pd.DataFrame) -> pd.Series:
    """
    For each hour, compute the median annualised rate of the top 20 coins.
    Mirrors Osprey's regime detection logic.
    """
    return combined_df.apply(
        lambda row: row.dropna().nlargest(20).median(), axis=1
    )


if __name__ == "__main__":
    print("Fetching HL funding rate history for all coins...\n")
    df = get_combined_df()
    print(f"\nData shape: {df.shape}")
    print(f"Date range: {df.index[0]} to {df.index[-1]}")
    print(f"\nMean annualised rates (top 10):")
    print(df.mean().sort_values(ascending=False).head(10).to_string())
    print(f"\nMax annualised rate ever seen:")
    print(df.max().sort_values(ascending=False).head(5).to_string())

    combined_path = os.path.join(CACHE_DIR, "funding_combined.parquet")
    df.to_parquet(combined_path)
    print(f"\n✅ Combined data saved to {combined_path}")
