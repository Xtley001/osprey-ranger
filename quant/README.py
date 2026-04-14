"""
quant/README — Setup and run order

1. Create venv and install deps:

    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt

2. Fetch real historical data (takes 2–5 minutes):

    python data/fetch_hl_funding.py
    python data/fetch_kamino_rates.py

3. Run analysis (optional but informative):

    python analysis/funding_persistence.py
    python analysis/regime_distribution.py

4. Run full backtest:

    python backtest/strategy.py

5. Generate tearsheet PDF:

    python reports/generate_tearsheet.py

Output:
    reports/equity_curve.parquet
    reports/persistence_analysis.png
    reports/regime_history.png
    reports/osprey_tearsheet.pdf  ← primary evidence document
"""
