# OSPREY — Complete Setup & User Guide

> **👉 New in v2:** See **[SETUP.md](./SETUP.md)** for the updated guide.  
> SETUP.md includes the nuclear-reset / fresh-start workflow, the wallet connector integration,
> and the corrected Hyperliquid signing documentation.  
> This file is kept for reference but SETUP.md is the authoritative source.

---

## What You're Building

Osprey scans every Hyperliquid perpetual every minute and tells you when to enter a delta-neutral funding rate position. You short the perp, go long spot, and collect funding every hour with zero directional exposure.

This extension adds:
- Two live API endpoints on your Vercel deployment (`/api/regime`, `/api/sizing`)
- A keeper bot on Render that manages a Ranger vault automatically
- A Python backtest engine to verify the strategy with real data

The Osprey frontend at `osprey-three.vercel.app` is untouched. Everything is additive.

---

## Part 1 — Prerequisites

You need these installed before anything else.

**Check what you have:**
```bash
node -v          # need v20+
npm -v           # need v10+
python3 --version # need 3.11+
git --version
```

Install anything missing:
- Node.js: https://nodejs.org (download LTS)
- Python: https://python.org/downloads
- Git: https://git-scm.com

**Accounts you need (all free to start):**

| Service | URL | What it's for |
|---|---|---|
| Vercel | vercel.com | Hosts Osprey + the two new API endpoints |
| GitHub | github.com | Your code repo |
| Render | render.com | Runs the keeper bot ($7/mo Starter plan — free won't work, it sleeps) |
| Supabase | supabase.com | Postgres database for keeper logs |
| Helius | helius.dev | Solana RPC endpoint |
| Upstash | upstash.com | Redis (free tier is enough) |
| Hyperliquid | app.hyperliquid.xyz | Where trades happen |

---

## Part 2 — Extract and Install

```bash
# Unzip the package
unzip osprey-ranger-extension.zip
cd build

# Run the installer — checks prereqs, installs all npm deps, sets up Python venv
bash scripts/install.sh
```

The installer creates `.env` files from the examples in `keeper/` and `vault-setup/`. You'll fill those in as you work through the sections below.

---

## Part 3 — Deploy the Signal API

This is the first thing to ship. Two serverless functions get added to your existing Osprey Vercel deployment.

### 3.1 Copy files into your Osprey repo

```bash
# Point this at wherever your osprey repo lives
bash scripts/push-to-git.sh --osprey /path/to/your/osprey

# Or if osprey is a sibling folder:
bash scripts/push-to-git.sh
```

This copies `api/`, `shared/`, and updates `vercel.json`, then commits and pushes to GitHub. Vercel auto-deploys on push.

**If you prefer to do it manually:**
```bash
cp -r api/        /path/to/osprey/api/
cp -r shared/     /path/to/osprey/shared/
cp    vercel.json /path/to/osprey/vercel.json   # replaces existing

cd /path/to/osprey
npm install --save-dev @vercel/node

git add api/ shared/ vercel.json package.json package-lock.json
git commit -m "feat: add signal API endpoints"
git push origin main
```

### 3.2 Verify it deployed

Wait about 2 minutes for Vercel to build, then:

```bash
curl https://osprey-three.vercel.app/api/regime
```

You should see something like:
```json
{
  "regime": "NEUTRAL",
  "topPair": "NVDA",
  "annualizedFunding": 0.3812,
  "medianTopOIFunding": 0.1423,
  "confidence": 0.68,
  "timestamp": 1712345678000
}
```

**Do not go to Part 4 until this works.** If you see an error, open your Vercel dashboard → Functions → check the logs.

---

## Part 4 — Infrastructure Setup

Get your credentials from each service before touching any config files.

### 4.1 Helius (Solana RPC)

1. Go to https://helius.dev
2. Sign up → Create a new project
3. Copy your **mainnet RPC URL** — looks like:
   `https://mainnet.helius-rpc.com/?api-key=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
4. You'll put this in `RPC_URL`

### 4.2 Supabase (Postgres)

1. Go to https://supabase.com → New project
2. Choose a name, set a database password, pick a region close to you
3. Once created: Settings → Database → **Connection string** section
4. Copy the **URI** format (starts with `postgresql://postgres:...`)
5. You'll put this in `DATABASE_URL`

> The keeper creates all tables automatically on first start. You don't need to run any SQL.

### 4.3 Upstash (Redis)

1. Go to https://upstash.com → Create database
2. Select **Redis** → choose a region → create
3. On the database page, copy the **Redis URL** (starts with `redis://default:...`)
4. You'll put this in `REDIS_URL`

### 4.4 Render (Keeper hosting)

1. Go to https://render.com → Sign up
2. Connect your GitHub account (you'll need this for auto-deploy in Part 6)
3. Don't create anything yet — you'll do that in Part 6

### 4.5 Ranger Adaptor Program IDs

> ⚠️ These addresses change with protocol upgrades. Do NOT copy from anywhere except the live Ranger docs.

1. Go to https://docs.ranger.finance/security/deployed-programs
2. Find and copy these two values exactly:
   - `KAMINO_ADAPTOR_PROGRAM_ID`
   - `TRUSTFUL_ADAPTOR_PROGRAM_ID`
3. Keep them somewhere — you'll need them in Part 5

### 4.6 Kamino Pool Addresses

1. Go to https://github.com/voltrxyz/kamino-scripts
2. Open the README — it lists the exact account addresses for the USDC Main Market
3. Copy these values:
   - `KAMINO_COUNTER_PARTY_TA`
   - `KAMINO_COUNTER_PARTY_TA_AUTH`
   - `KAMINO_PROTOCOL_PROGRAM`
   - `KAMINO_LENDING_MARKET`
   - `KAMINO_RESERVE`

### 4.7 Your Hyperliquid Wallet

The keeper signs orders using an EVM private key — the same wallet you use with MetaMask on Hyperliquid.

**To export your private key from MetaMask:**
1. MetaMask → click the three dots next to your account → Account Details
2. Show Private Key → enter your MetaMask password
3. Copy the key (starts with `0x`)

**Your wallet address:**
1. Copy the `0x...` address shown in MetaMask

> 🔐 Never commit this key. It goes in `keeper/.env` only, which is gitignored.

---

## Part 5 — Vault Setup (One-Time Solana Initialization)

This creates the Ranger vault on Solana. Run these scripts once. Never again.

### 5.1 Generate Solana keypairs

You need three separate keypairs. If you have the Solana CLI:
```bash
solana-keygen new --outfile admin.json --no-bip39-passphrase
solana-keygen new --outfile manager.json --no-bip39-passphrase
solana-keygen new --outfile vault.json --no-bip39-passphrase
```

Each file contains a JSON array like `[12,45,178,...]`. That whole array is your keypair.

If you don't have Solana CLI, install it:
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

> 🔐 **Security**: Admin controls vault structure. Manager controls fund movement. Keep them separate. Never reuse your personal wallet for either. Fund the admin wallet with ~0.1 SOL for transaction fees.

### 5.2 Fill in vault-setup/.env

Open `vault-setup/.env` (created by the installer) and fill in every field:

```env
# From Helius dashboard (Part 4.1)
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE

# From the JSON files you just generated — paste the FULL array including brackets
ADMIN_KEYPAIR=[12,45,178,...]
MANAGER_KEYPAIR=[89,12,34,...]
VAULT_KEYPAIR=[56,78,90,...]

# Leave as-is — this is the official Solana mainnet USDC mint address
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# From Ranger docs (Part 4.5)
KAMINO_ADAPTOR_PROGRAM_ID=PASTE_FROM_DOCS
TRUSTFUL_ADAPTOR_PROGRAM_ID=PASTE_FROM_DOCS

# From kamino-scripts README (Part 4.6)
KAMINO_LENDING_MARKET=PASTE_FROM_DOCS
KAMINO_RESERVE=PASTE_FROM_DOCS
KAMINO_COUNTER_PARTY_TA=PASTE_FROM_DOCS
KAMINO_COUNTER_PARTY_TA_AUTH=PASTE_FROM_DOCS
KAMINO_PROTOCOL_PROGRAM=PASTE_FROM_DOCS

# Host your lp-metadata.json on IPFS or any CDN, put the URL here
# Minimum content: {"name":"Osprey Delta-Neutral Yield","symbol":"OSPREY","image":"https://osprey-three.vercel.app/osprey-icon.svg"}
METADATA_URI=https://your-cdn.com/lp-metadata.json

# Leave blank for now — scripts 01, 05, 06 will print these values
VAULT_ADDRESS=
KAMINO_STRATEGY_ADDRESS=
TRUSTFUL_STRATEGY_ADDRESS=
HL_DEPOSIT_WALLET=
```

### 5.3 Run the scripts in order

```bash
cd vault-setup
npm install   # if not done already

# Script 01 — Creates the vault on Solana
# Output: prints VAULT_ADDRESS — copy it into .env immediately
npx ts-node 01-create-vault.ts

# Add VAULT_ADDRESS to vault-setup/.env before continuing
# VAULT_ADDRESS=...the address printed above...

# Script 02 — Sets LP token metadata (name, symbol, logo)
npx ts-node 02-lp-metadata.ts

# Script 03 — Registers Kamino adaptor with the vault
npx ts-node 03-add-kamino-adaptor.ts

# Script 04 — Registers Trustful adaptor with the vault
npx ts-node 04-add-trustful-adaptor.ts

# Script 05 — Initializes Kamino lending strategy
# Output: prints KAMINO_STRATEGY_ADDRESS — copy it into .env
npx ts-node 05-init-kamino-strategy.ts

# Add KAMINO_STRATEGY_ADDRESS to .env before continuing

# Script 06 — Initializes Trustful HL bridge strategy
# Output: prints TRUSTFUL_STRATEGY_ADDRESS — copy it into .env
npx ts-node 06-init-trustful-strategy.ts

# Add TRUSTFUL_STRATEGY_ADDRESS to .env before continuing

# Script 07 — Verifies the entire setup
# Must print "✅ All checks passed" before you continue
npx ts-node 07-verify-setup.ts
```

If script 07 fails, read the error message — it will tell you which step went wrong.

---

## Part 6 — Keeper Bot Deployment

### 6.1 Fill in keeper/.env

Open `keeper/.env` and fill in every field:

```env
# From Helius (Part 4.1)
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY_HERE

# Keypairs — same arrays you used in vault-setup
# MANAGER_KEYPAIR is the manager, not admin
ADMIN_KEYPAIR=[12,45,178,...]
MANAGER_KEYPAIR=[89,12,34,...]

# From vault-setup script outputs (Part 5.3)
VAULT_ADDRESS=THE_ADDRESS_FROM_SCRIPT_01
KAMINO_STRATEGY_ADDRESS=THE_ADDRESS_FROM_SCRIPT_05
TRUSTFUL_STRATEGY_ADDRESS=THE_ADDRESS_FROM_SCRIPT_06

# Leave as-is
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
HL_API_URL=https://api.hyperliquid.xyz
OSPREY_API_URL=https://osprey-three.vercel.app

# Your Hyperliquid EVM wallet (Part 4.7)
HL_PRIVATE_KEY=0xYOUR_METAMASK_PRIVATE_KEY
HL_WALLET_ADDRESS=0xYOUR_WALLET_ADDRESS

# From Supabase (Part 4.2)
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres

# From Upstash (Part 4.3)
REDIS_URL=redis://default:YOUR_PASSWORD@YOUR_ENDPOINT:PORT

# From Ranger docs (Part 4.5)
KAMINO_ADAPTOR_PROGRAM_ID=PASTE_FROM_DOCS
TRUSTFUL_ADAPTOR_PROGRAM_ID=PASTE_FROM_DOCS

# From kamino-scripts README (Part 4.6)
KAMINO_COUNTER_PARTY_TA=PASTE_FROM_DOCS
KAMINO_COUNTER_PARTY_TA_AUTH=PASTE_FROM_DOCS
KAMINO_PROTOCOL_PROGRAM=PASTE_FROM_DOCS
```

### 6.2 Test locally first

```bash
cd keeper
npm install
npm run dev
```

Let it run for 2 minutes. You should see logs like:
```
[INFO]  [keeper.start] Keeper bot starting
[INFO]  [keeper.vault] Vault verified. Manager: ...
[INFO]  [keeper.start] All loops running
[INFO]  [rebalancer.tick] Rebalance loop tick
[INFO]  [rebalancer.state] {"regime":"NEUTRAL","totalNav":"0.00",...}
```

If you see errors, they will name the exact missing or wrong config value.

Press Ctrl+C when satisfied. Fix any errors before deploying.

### 6.3 Deploy to Render

1. Go to https://render.com → **New** → **Web Service**
2. Connect to your GitHub account if not already connected
3. Select your Osprey repo
4. Configure the service:

| Setting | Value |
|---|---|
| **Name** | osprey-keeper |
| **Root Directory** | keeper |
| **Runtime** | Node |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Plan** | **Starter ($7/mo)** — NOT the free tier, it spins down |

5. Scroll down to **Environment Variables** and add every variable from `keeper/.env` one by one (do not upload the .env file — paste each key-value pair)

6. Click **Create Web Service**

Render builds and starts the service. Initial deploy takes 2–3 minutes.

### 6.4 Verify the keeper is running

```bash
# Replace with your actual Render service URL
curl https://osprey-keeper.onrender.com/health
# Expected: {"status":"ok","uptime":45.2}
```

Then check Supabase: go to your project → Table Editor. After about 5 minutes, the `keeper_logs` table should have rows. After 15 minutes, `rebalance_log` should have entries.

---

## Part 7 — Run the Backtest

Run this before making any APY claims. Uses real Hyperliquid historical data.

```bash
cd quant

# Activate Python environment
source venv/bin/activate         # Windows: venv\Scripts\activate

# Fetch real historical data from HL (takes ~5 minutes)
python data/fetch_hl_funding.py

# Fetch Kamino lending rate history
python data/fetch_kamino_rates.py

# Run the full strategy backtest
python backtest/strategy.py

# Generate the PDF tearsheet (your evidence document)
python reports/generate_tearsheet.py
# Output: quant/reports/osprey_tearsheet.pdf
```

The tearsheet shows annualised APY, Sharpe ratio, max drawdown, and monthly returns using real data. This is what you show when people ask for proof.

---

## Part 8 — Final Checklist

Go through every item before calling the system live:

```
[ ] curl osprey-three.vercel.app/api/regime  returns JSON with real data
[ ] curl osprey-three.vercel.app/api/sizing  returns non-zero allocation
[ ] vault-setup 07-verify-setup.ts printed "All checks passed"
[ ] curl YOUR-RENDER-URL/health  returns {"status":"ok"}
[ ] Supabase keeper_logs table has rows
[ ] Supabase rebalance_log has at least one entry (wait 15 min after deploy)
[ ] Backtest ran with real data (not synthetic fallback)
[ ] Tearsheet PDF generated with real numbers
```

---

## Part 9 — Using Osprey (Trader Guide)

You only need the link: **https://osprey-three.vercel.app**

No wallet needed for demo mode. No code needed for anything in this section.

### The Scanner

The main screen. Every Hyperliquid perpetual, live rates, updated every 60 seconds.

**Rate colour coding:**

| Colour | Rate | Annual equivalent | Action |
|---|---|---|---|
| 🔵 Blue (COLD) | < 0.02%/hr | < 18% | Skip |
| 🟡 Yellow (WARM) | 0.02–0.05%/hr | 18–44% | Watch |
| 🟠 Amber (HOT) | 0.05–0.10%/hr | 44–88% | Consider entry |
| 🔴 Red (FIRE) | > 0.10%/hr | > 88% | Strong opportunity |

**Sort** by clicking any column header. **Filter** by category using the buttons (All / Crypto / TradFi / HIP-3). **Search** by typing in the top bar.

**TradFi pairs** (NVDA, AAPL, GOLD, SPACEX, etc.) often have the highest rates because liquidity is thinner and the trader base is smaller. NVDA has been above 100% annualised. Always check these first in a HOT regime.

### The Regime Badge

Top of every page:
```
🔥 HOT    0.0421%/hr    72% ↑
```

| Label | Meaning | What to do |
|---|---|---|
| 🔥 HOT | Top-20 pairs all paying elevated funding | Look for entries aggressively |
| 🌤 NEUTRAL | Mixed market | Selective entries only |
| 🧊 COLD | Market-wide funding is low | No new entries; exit existing positions |

The **breadth %** (72% above) tells you how many of the top-20 pairs are elevated. The higher it is, the more reliable the regime signal.

### Entry Signals

Click any pair to open its detail page. The signal badge at the top tells you what to do:

| Signal | Meaning |
|---|---|
| ✅ ENTER | Rate has been above threshold for 2+ consecutive hours. High confidence. Enter now. |
| ⏳ WAIT | Rate just spiked — only 0–1 hour of history. Check back in an hour. |
| ⚠️ EXIT | Rate has faded. If you hold this pair, close it. |
| 🚫 AVOID | Rate is negative or too low to cover fees. Skip. |

The 2-hour confirmation rule exists because single-hour spikes revert ~60% of the time. If WAIT becomes ENTER on the next refresh, that's a genuine opportunity.

### Entering a Position

**Demo (no wallet):**
1. Click **Enter** on any pair
2. The modal shows your $10,000 virtual balance
3. Drag the size slider or click 25/50/75/100%
4. The summary shows: each leg size, fees, hourly income, break-even hours
5. Click **Open Demo Position**

Position appears in the right panel and accrues funding every second in real time.

**Live (requires MetaMask + Hyperliquid balance):**
1. Go to **Settings** → **Connect MetaMask** → approve in MetaMask
2. Osprey fetches your real HL balance
3. Switch sidebar to **Live**
4. Enter a position — same flow as demo but with the real balance
5. Tick the confirmation checkbox → **Place Real Order** → confirm in MetaMask
6. **After the perp order confirms: manually go long the same notional in spot** (HL spot market or any CEX). Without this you have directional price exposure.

### Managing Positions

Right panel shows all open positions with live stats:
- **Funding earned** — accrues every second
- **Net PnL** — funding minus fees
- **Per hour** — current hourly income
- **Hedge drifted X%** — appears when price moved >5% since entry, meaning your hedge needs rebalancing

**Close** when you see EXIT signal on the pair, or when regime goes COLD.

### Backtester

Sidebar → Backtest

1. Select a pair, set a date range (30d or 90d minimum for meaningful results)
2. Set strategy params — the defaults are calibrated to real HL distributions
3. Click **Run Backtest**
4. Read the equity curve, Sharpe ratio, max drawdown, and trade log
5. Click **Save** to keep the result for comparison

Key thing to check: if break-even hours > 24 at your entry threshold, lower capital or raise the threshold.

### Auto-Trader

Sidebar → Auto

The bot runs a cycle every 60 seconds: check exits → check rotations → look for entries → execute.

1. Set **Capital per position** and **Max positions** (1–5)
2. Toggle **Regime Gate** ON — pauses entries in COLD regime
3. Click **Start Auto-Trader**

In demo mode it executes automatically. In live mode each order prompts MetaMask.

The **Activity Log** shows every decision and why. Read it to understand the bot's behaviour before trusting it with real capital.

### Fee Reference

| Order type | When | Fee |
|---|---|---|
| Post-only (Alo) | All entries | **0.010%** |
| Market (Ioc) | All exits | **0.035%** |

Round-trip on $5,000: $0.50 entry + $1.75 exit = **$2.25 total**

At 0.04%/hr on $5,000 = $2.00/hr income → break-even in **1.1 hours**

---

## Part 10 — Operating the Live System

### Daily Check (< 5 minutes)

```bash
# Is the keeper running?
curl https://YOUR-RENDER-URL/health

# Is the signal API fresh?
curl https://osprey-three.vercel.app/api/regime
# Check: "timestamp" should be within the last 2 minutes
```

Also open Supabase → Table Editor → `keeper_logs` → filter by `level = 'error'`. If there are errors in the last 24 hours, read them.

### Reading the Logs

Normal every 15 minutes:
```
[INFO] [rebalancer.tick]  Rebalance loop tick
[INFO] [rebalancer.state] {"regime":"HOT","totalNav":"84320.12",...}
[INFO] [rebalancer.skip]  Within threshold — no rebalance needed
```

Normal every hour:
```
[INFO] [mtm.tick]   Mark-to-market loop tick
[INFO] [mtm.marked] Trustful value marked at 42150.88 USDC
[INFO] [mtm.nav]    Vault NAV updated: 84320.12 USDC. Asset/LP: 1.04832
```

**Warning you must act on:**
```
[WARN] [rebalancer.bridge] ACTION REQUIRED: Transfer 12400 USDC to HL wallet
```
This means the keeper wants more capital in HL but can't bridge automatically. Do it manually: withdraw from your Solana wallet and deposit to HL at app.hyperliquid.xyz.

**Emergency exit (requires immediate attention):**
```
[ERROR] [emergency.start] Emergency exit triggered: drawdown_limit
[ERROR] [emergency.done]  Emergency exit complete. Final HL equity: 41200.33 USDC
```
USDC is now sitting in your HL account. Withdraw it at app.hyperliquid.xyz → the keeper will deposit it back into Kamino on the next cycle.

### Adjusting Allocation

Edit `keeper/src/risk/limits.ts`:
```typescript
export const REGIME_ALLOCATION = {
  HOT:     { hl: 0.70, kamino: 0.30 },   // change these
  NEUTRAL: { hl: 0.40, kamino: 0.60 },
  COLD:    { hl: 0.05, kamino: 0.95 },
};
```

Also update `api/regime.ts` if you change the HOT/NEUTRAL threshold numbers, and `quant/backtest/regime_filter.py` to match. Then:
```bash
git add keeper/src/risk/limits.ts api/regime.ts quant/backtest/regime_filter.py
git commit -m "config: adjust regime allocations"
git push
# Render and Vercel auto-redeploy
```

### Restarting the Keeper

```bash
git commit --allow-empty -m "chore: restart keeper"
git push
```

Or click **Manual Deploy** in the Render dashboard.

### Cost

| Service | Plan | Cost |
|---|---|---|
| Vercel | Free | $0 |
| Render keeper | Starter | $7/mo |
| Supabase | Free | $0 |
| Upstash | Free | $0 |
| Helius | Free dev | $0 |
| **Total** | | **$7/month** |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `/api/regime` returns 500 | Check Vercel Function Logs — HL API may be briefly down |
| Vault script fails with "Invalid program" | Wrong adaptor ID — re-fetch from docs.ranger.finance |
| Keeper crashes immediately | Open Render logs — error message names the missing env var |
| `npm run typecheck` fails | Run it in `keeper/` to see the exact line |
| Render service keeps sleeping | You're on the free tier. Upgrade to Starter ($7/mo) |
| Supabase `keeper_logs` is empty | Keeper hasn't started yet, or DATABASE_URL is wrong |
| MetaMask order rejected | Try a smaller size first; some pairs have minimum order sizes |
| "Would immediately cross" in logs | Normal — keeper retried as taker (Ioc). Not an error. |
| Demo balance is $0 | Settings → Reset to $10,000 |
| HL balance shows $0 in Osprey | Deposit USDC to HL first at app.hyperliquid.xyz |
