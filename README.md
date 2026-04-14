# Osprey × Ranger — Delta-Neutral Funding Vault Extension

Extends the [Osprey](https://osprey-three.vercel.app) funding-rate signal tool with:

- **Two signal API endpoints** deployed on Vercel (`/api/regime`, `/api/sizing`)
- **A keeper bot** deployed on Render that manages a Ranger/Voltr vault on Solana
- **Strategy**: short perp on Hyperliquid (funding income) + USDC lending on Kamino (yield), switched by regime signal

---

## Architecture

```
Vercel (osprey-three.vercel.app)
  ├── /api/regime  — classifies market as HOT / NEUTRAL / COLD from HL funding data
  └── /api/sizing  — computes recommended HL allocation % from regime + confidence

Render (keeper bot — Node.js worker)
  ├── rebalancer   — every 15 min: reads regime, moves USDC between Kamino ↔ HL
  ├── risk-monitor — every 5 min: checks drawdown, funding flip, liquidation proximity
  └── mark-to-market — every 1 hr: writes HL equity to vault via Trustful adaptor

Solana (Ranger/Voltr vault)
  ├── Kamino strategy  — USDC lending yield (~8–12% APR)
  └── Trustful strategy — marks HL account value on-chain for accurate LP NAV

Hyperliquid (EVM, L1)
  └── Short perp positions — funding income (regime-gated, 1× leverage only)
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | v20+ | [nodejs.org](https://nodejs.org) |
| npm | v10+ | included with Node |
| Python | 3.11+ | [python.org](https://python.org/downloads) |
| Solana CLI | latest | `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"` |
| Git | any | [git-scm.com](https://git-scm.com) |

**Accounts required:**

| Service | URL | Purpose |
|---------|-----|---------|
| Vercel | vercel.com | Hosts signal API endpoints |
| Render | render.com | Runs the keeper bot ($7/mo Starter — required; free tier sleeps) |
| Supabase | supabase.com | Postgres database for logs and NAV history |
| Helius | helius.dev | Solana RPC (free tier sufficient) |
| Hyperliquid | app.hyperliquid.xyz | Where perp trades execute |

---

## Setup

### Step 1 — Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/osprey-ranger.git
cd osprey-ranger
cd keeper && npm install
cd ../vault-setup && npm install
cd ../quant && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

### Step 2 — Generate keypairs

```bash
solana-keygen new --outfile admin.json
solana-keygen new --outfile manager.json
solana-keygen new --outfile vault.json
```

> ⚠️ These files are in `.gitignore`. Never commit them. Back them up offline.

### Step 3 — Configure environment

```bash
# Keeper
cp keeper/.env.example keeper/.env
# Fill in: RPC_URL, ADMIN_KEYPAIR, MANAGER_KEYPAIR, HL_PRIVATE_KEY,
#          HL_WALLET_ADDRESS, DATABASE_URL
# (Leave VAULT_ADDRESS, KAMINO_STRATEGY_ADDRESS, TRUSTFUL_STRATEGY_ADDRESS blank for now)

# Vault setup scripts
cp vault-setup/.env.example vault-setup/.env
# Copy the same keypairs into vault-setup/.env
```

### Step 4 — Deploy signal API to Vercel

```bash
# Add to your existing Osprey Vercel project:
cp -r api/     /path/to/osprey/api/
cp -r shared/  /path/to/osprey/shared/
cp vercel.json /path/to/osprey/vercel.json

cd /path/to/osprey
npm install --save-dev @vercel/node
git add api/ shared/ vercel.json && git commit -m "feat: add signal API" && git push
```

Verify after deploy:
```bash
curl https://osprey-three.vercel.app/api/regime
curl https://osprey-three.vercel.app/api/sizing
```

### Step 5 — Create the vault (devnet first)

```bash
# Set RPC_URL=https://api.devnet.solana.com in vault-setup/.env first

cd vault-setup
npx ts-node 01-create-vault.ts        # → sets VAULT_ADDRESS
npx ts-node 02-lp-metadata.ts
npx ts-node 03-add-kamino-adaptor.ts
npx ts-node 04-add-trustful-adaptor.ts
npx ts-node 05-init-kamino-strategy.ts  # → sets KAMINO_STRATEGY_ADDRESS
npx ts-node 06-init-trustful-strategy.ts # → sets TRUSTFUL_STRATEGY_ADDRESS
npx ts-node 07-verify-setup.ts
```

Each script prints the address to add to `.env`. Fill them in before running the next script.

### Step 6 — Verify Kamino addresses

Before running the keeper, **verify** the following addresses from primary sources.  
Do not accept values from AI suggestions or unverified third parties.

| Variable | Source |
|----------|--------|
| `KAMINO_ADAPTOR_PROGRAM_ID` | [docs.ranger.finance/security/deployed-programs](https://docs.ranger.finance/security/deployed-programs) |
| `TRUSTFUL_ADAPTOR_PROGRAM_ID` | Same as above |
| `KAMINO_COUNTER_PARTY_TA` | [github.com/voltrxyz/kamino-scripts](https://github.com/voltrxyz/kamino-scripts) README |
| `KAMINO_COUNTER_PARTY_TA_AUTH` | Same as above |
| `KAMINO_PROTOCOL_PROGRAM` | Kamino documentation or on-chain inspection |

### Step 7 — Deploy keeper to Render

1. Push this repo to GitHub
2. Create a new **Background Worker** on Render
3. Set **Root Directory** to `keeper`
4. Set **Build Command**: `npm install && npm run build`
5. Set **Start Command**: `npm start`
6. Add all env vars from `keeper/.env` in Render's **Environment** tab (not from a file)
7. Set plan to **Starter** ($7/mo) — the free tier sleeps

### Step 8 — Test on HL testnet

Before going live on mainnet, test order placement:

```bash
# In keeper/.env temporarily set:
HL_API_URL=https://api.hyperliquid-testnet.xyz

cd keeper && npm run dev
# Watch logs — confirm:
# ✅ vault verified
# ✅ regime fetched
# ✅ order response status === "ok" (not "err")
```

---

## v1 Limitations

**Cross-chain USDC bridging is manual in v1.** When the rebalancer computes that more USDC should move to Hyperliquid, it:
1. Withdraws from Kamino on Solana ✅ (automated)
2. Logs a bridge instruction with the USDC amount ⚠️ (manual step — use app.hyperliquid.xyz/deposit)
3. Opens the short perp on HL ✅ (automated, retries on next tick if bridge is still pending)

Bridge in the opposite direction (HL → Solana) is also manual via app.hyperliquid.xyz/withdraw.

v2 will integrate Circle CCTP for fully automated bridging.

---

## Risk Parameters

All risk limits are in `keeper/src/risk/limits.ts`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MAX_DRAWDOWN_PCT` | 5% | Emergency exit if NAV drops this much from HWM |
| `MIN_FUNDING_ANNUALISED` | 8% | Reduce HL allocation if funding drops below this |
| `NEGATIVE_FUNDING_EXIT` | true | Immediate emergency exit if funding goes negative |
| `REBALANCE_THRESHOLD_PCT` | 5% | Minimum drift to trigger a rebalance |
| `MAX_HL_ALLOCATION_PCT` | 80% | Hard cap on HL allocation |
| `MAX_POSITION_LEVERAGE` | 1.0× | Always fully collateralised — no amplification |
| `LIQ_PROXIMITY_THRESHOLD` | 10% | Emergency exit if within 10% of liquidation |

> **Funding rate note:** Hyperliquid pays funding every 8 hours (3× per day). All annualised figures use `rate × 3 × 365`.

---

## Quant Layer

The `quant/` directory contains backtesting and analysis tools:

```bash
cd quant
source venv/bin/activate

# Fetch historical funding data
python data/fetch_hl_funding.py

# Run regime backtest
python backtest/strategy.py

# Generate tearsheet
python reports/generate_tearsheet.py
```

---

## Security Notes

- Keypair files (`admin.json`, `manager.json`, `vault.json`) are in `.gitignore` — never commit them
- All secrets are loaded from environment variables — never hardcoded
- The keeper uses 1× leverage only — positions are fully collateralised
- Emergency exit closes all positions and marks final value to vault
- High-water mark is persisted in the database across restarts

---

## File Structure

```
osprey-ranger/
├── api/                  — Vercel serverless functions
│   ├── regime.ts         — HOT/NEUTRAL/COLD classification
│   └── sizing.ts         — recommended HL allocation %
├── keeper/               — Render background worker (Node.js)
│   ├── src/
│   │   ├── config.ts     — env var loading and validation
│   │   ├── exchange/     — Hyperliquid REST client + EIP-712 signing
│   │   ├── vault/        — Kamino and Trustful adaptor wrappers
│   │   ├── strategy/     — allocation logic and position sizing
│   │   ├── risk/         — limits, monitoring, emergency exit
│   │   ├── signal/       — fetches regime signal from Osprey API
│   │   └── reporting/    — logger, mark-to-market, NAV snapshots
│   ├── .env.example      — environment variable template
│   └── render.yaml       — Render deployment config
├── vault-setup/          — one-time Solana vault initialisation scripts
├── shared/               — types shared between keeper and API
├── quant/                — Python backtesting and analysis
├── scripts/              — install and deployment helpers
├── vercel.json           — Vercel routing and security headers
└── .gitignore            — excludes .env, node_modules, keypairs, venv
```
