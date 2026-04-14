# Osprey × Ranger — SETUP.md

**The only file you need to read.** Follow it top to bottom.  
Everything is in one place. No switching between files mid-setup.

---

## 0 — Nuclear Reset (Fresh Start)

> Use this if your codespace is a mess and you want to wipe everything
> and start clean from this zip. If you're setting up fresh, skip to §1.

### 0.1 Save your keys first

Before you clear anything, copy these values somewhere safe (a password manager, a local text file — NOT another git repo):

```
ADMIN_KEYPAIR=         ← your Solana admin keypair array
MANAGER_KEYPAIR=       ← your Solana manager keypair array
VAULT_KEYPAIR=         ← your Solana vault keypair array
HL_PRIVATE_KEY=        ← your Hyperliquid EVM private key (0x...)
HL_WALLET_ADDRESS=     ← your Hyperliquid wallet address
VAULT_ADDRESS=         ← on-chain vault address (if already created)
KAMINO_STRATEGY_ADDRESS=
TRUSTFUL_STRATEGY_ADDRESS=
RPC_URL=               ← your Helius API key URL
DATABASE_URL=          ← your Supabase connection string
```

If you never got past setup and have no real addresses yet, you only need the keys and DB URL.

### 0.2 Wipe the codespace

```bash
# From your codespace root — this deletes EVERYTHING in the current folder
# Make sure you've saved your keys first (§0.1 above)
cd ~
rm -rf /workspaces/YOUR_REPO_NAME/*
rm -rf /workspaces/YOUR_REPO_NAME/.[!.]*   # hidden files like .env, .git
```

### 0.3 Drop in the new zip and bootstrap

```bash
# Upload osprey-ranger-v2.zip to your codespace, then:
cd /workspaces/YOUR_REPO_NAME

# Unzip (the -j flag flattens, so we use a subfolder then move)
unzip ~/osprey-ranger-v2.zip -d /tmp/osprey-extract
cp -r /tmp/osprey-extract/osprey-ranger-clean/. .
rm -rf /tmp/osprey-extract

# Run the one-command bootstrap
bash scripts/bootstrap.sh
```

Bootstrap installs all Node.js and Python deps, creates `.env` files from examples, and validates TypeScript. It takes about 90 seconds.

### 0.4 Re-inject your keys

Open `keeper/.env` and paste your saved values back in:

```bash
# Quick way — open in editor
code keeper/.env
```

Fill every field. The keeper will refuse to start with any blank required var.

Do the same for `vault-setup/.env` — same keypairs, same addresses.

---

## 1 — What You're Building

```
You (this repo)
├── api/regime.ts          → Vercel serverless: HOT / NEUTRAL / COLD signal
├── api/sizing.ts          → Vercel serverless: recommended HL allocation %
├── keeper/                → Render background worker (Node.js, runs 24/7)
│   ├── rebalancer         → every 15 min: move USDC between Kamino ↔ HL
│   ├── risk-monitor       → every 5 min: drawdown, funding, liquidation checks
│   └── mark-to-market     → every 1 hr: write HL equity to vault NAV on-chain
├── osprey/                → Wallet connector + trade panel for the frontend
│   ├── WalletContext      → MetaMask / any EIP-1193 wallet, switch at will
│   ├── WalletButton       → connect button with account/wallet switcher menu
│   ├── WalletModal        → wallet picker (EIP-6963 multi-wallet support)
│   └── HlTradePanel       → place orders directly from the Osprey UI
└── vault-setup/           → one-time Solana scripts to create the vault
```

Capital flow:
- USDC sits in **Kamino** (Solana lending, ~8–12% APR base)
- When regime = HOT/NEUTRAL → move some USDC to **Hyperliquid**, open a short perp
- Short perp earns **funding payments** every 8 hours
- When regime = COLD or funding goes negative → close perp, return USDC to Kamino

---

## 2 — Accounts You Need

| Service | URL | Cost | What for |
|---------|-----|------|----------|
| Vercel | vercel.com | Free | Signal API endpoints |
| GitHub | github.com | Free | Repo (Vercel/Render pull from here) |
| Render | render.com | $7/mo | Keeper bot (Starter plan — free tier sleeps) |
| Supabase | supabase.com | Free | Postgres for logs and NAV history |
| Helius | helius.dev | Free | Solana RPC |
| Hyperliquid | app.hyperliquid.xyz | Free | Where perp trades execute |

---

## 3 — Fresh Install (No Existing Codespace)

If starting from scratch (not a wipe):

```bash
# 1. Unzip
unzip osprey-ranger-v2.zip -d /tmp/extract
cp -r /tmp/extract/osprey-ranger-clean/. /workspaces/my-osprey
cd /workspaces/my-osprey
rm -rf /tmp/extract

# 2. Bootstrap everything
bash scripts/bootstrap.sh

# 3. Verify structure
ls
# Should show: api/ keeper/ osprey/ quant/ shared/ vault-setup/ scripts/
# README.md  SETUP.md  vercel.json  .gitignore
```

---

## 4 — Generate Keypairs (If You Don't Have Them)

You need three Solana keypairs. Each is a 64-byte JSON array.

```bash
# Install Solana CLI if you don't have it
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Generate three keypairs
solana-keygen new --outfile admin.json --no-bip39-passphrase
solana-keygen new --outfile manager.json --no-bip39-passphrase
solana-keygen new --outfile vault.json --no-bip39-passphrase

# Print the array content you need for .env files
echo "ADMIN_KEYPAIR=$(cat admin.json)"
echo "MANAGER_KEYPAIR=$(cat manager.json)"
echo "VAULT_KEYPAIR=$(cat vault.json)"

# Fund admin with ~0.1 SOL for transaction fees
# (Copy the public key shown by solana-keygen, send SOL to it from an exchange)
solana-keygen pubkey admin.json
```

> ⚠️ `admin.json`, `manager.json`, `vault.json` are in `.gitignore` and will never be committed.  
> Back them up offline (USB drive, encrypted notes). If you lose the manager key you lose vault control.

For your Hyperliquid EVM wallet:

```bash
# Generate a fresh wallet via Node (or export from MetaMask)
node -e "const {ethers} = require('ethers'); const w = ethers.Wallet.createRandom(); console.log('HL_PRIVATE_KEY=' + w.privateKey); console.log('HL_WALLET_ADDRESS=' + w.address);"
```

Or in MetaMask: create a dedicated account → Account details → Export private key.

---

## 5 — Fill In `keeper/.env`

```bash
code keeper/.env
```

Fill in every field. Required fields the keeper will refuse to start without:

| Variable | Where to get it |
|----------|-----------------|
| `RPC_URL` | helius.dev → dashboard → your API key → copy the mainnet URL |
| `ADMIN_KEYPAIR` | `cat admin.json` |
| `MANAGER_KEYPAIR` | `cat manager.json` |
| `HL_PRIVATE_KEY` | MetaMask → export key, or `node -e ...` above |
| `HL_WALLET_ADDRESS` | your 0x... EVM address |
| `DATABASE_URL` | Supabase → Settings → Database → Connection string (URI) |
| `KAMINO_ADAPTOR_PROGRAM_ID` | [docs.ranger.finance/security/deployed-programs](https://docs.ranger.finance/security/deployed-programs) |
| `TRUSTFUL_ADAPTOR_PROGRAM_ID` | same page |
| `KAMINO_COUNTER_PARTY_TA` | [github.com/voltrxyz/kamino-scripts](https://github.com/voltrxyz/kamino-scripts) README |
| `KAMINO_COUNTER_PARTY_TA_AUTH` | same repo |
| `KAMINO_PROTOCOL_PROGRAM` | same repo |

Leave these blank for now — they come from the vault setup scripts:
- `VAULT_ADDRESS`
- `KAMINO_STRATEGY_ADDRESS`
- `TRUSTFUL_STRATEGY_ADDRESS`

---

## 6 — Deploy the Signal API to Vercel

This adds `/api/regime` and `/api/sizing` to your existing Osprey Vercel project.

### Option A — Automatic (recommended)

```bash
bash scripts/push-to-git.sh --osprey /path/to/your/osprey-repo
```

This copies `api/`, `shared/`, `vercel.json` into your Osprey repo, commits, and pushes. Vercel auto-deploys on push.

### Option B — Manual

```bash
# From your osprey-ranger folder:
cp -r api/    /path/to/osprey/api/
cp -r shared/ /path/to/osprey/shared/
cp vercel.json /path/to/osprey/vercel.json

cd /path/to/osprey
npm install --save-dev @vercel/node
git add api/ shared/ vercel.json package.json
git commit -m "feat: add Osprey × Ranger signal API"
git push origin main
```

### Verify (wait ~2 min for Vercel to build)

```bash
curl https://osprey-three.vercel.app/api/regime | python3 -m json.tool
# Expect: { "regime": "HOT"|"NEUTRAL"|"COLD", "confidence": 0.x, ... }

curl https://osprey-three.vercel.app/api/sizing | python3 -m json.tool
# Expect: { "recommendedHlAllocationPct": 0.x, ... }
```

**Do not proceed to §7 until both endpoints return valid JSON.**

---

## 7 — Add the Wallet Connector to the Osprey Frontend

The `osprey/` directory contains the MetaMask connector and trade panel. Add it to the Osprey React source:

```bash
cp -r osprey/ /path/to/osprey/src/osprey/
```

Then in your Osprey `main.tsx` (or `index.tsx`):

```tsx
// Add at the very top, before ReactDOM.render / createRoot
import { announceEIP6963Request } from "./osprey/wallet/walletUtils";
announceEIP6963Request();   // fires EIP-6963 request so all wallets announce themselves

// Wrap your root component:
import { WalletProvider } from "./osprey/wallet/WalletContext";

root.render(
  <WalletProvider>
    <App />
  </WalletProvider>
);
```

Add the connect button anywhere in your layout (e.g. `Navbar.tsx`):

```tsx
import { WalletButton } from "./osprey/components/WalletButton";

// In your navbar/header JSX:
<WalletButton />
```

Add the trade panel to a signal detail page:

```tsx
import { HlTradePanel } from "./osprey/components/HlTradePanel";

// Pass the currently viewed pair:
<HlTradePanel coin={selectedPair} />
```

Install deps in the Osprey frontend:

```bash
cd /path/to/osprey
npm install ethers @msgpack/msgpack
```

### Wallet Features

- **Connect** — detects MetaMask, Coinbase Wallet, Rabby, and any EIP-6963 wallet
- **Switch Account** — triggers MetaMask's built-in account picker without page reload
- **Switch Wallet** — opens the wallet modal to connect a different provider entirely
- **Auto-reconnect** — remembers the last wallet across page refreshes
- **HL Balance** — shows your live Hyperliquid USDC equity next to the address
- **Signing** — uses corrected EIP-712 (msgpack + solidityPacked, not JSON + ABI encoding)

---

## 8 — Vault Setup (One-Time, Solana Mainnet)

> Run on devnet first. Switch `RPC_URL` in `vault-setup/.env` to devnet, run through all 7 scripts, verify, then switch to mainnet.

### 8.1 Fill in `vault-setup/.env`

```bash
code vault-setup/.env
```

Required before starting:
- `RPC_URL` — start with `https://api.devnet.solana.com` for testing
- `ADMIN_KEYPAIR`, `MANAGER_KEYPAIR`, `VAULT_KEYPAIR` — from §4
- `KAMINO_ADAPTOR_PROGRAM_ID`, `TRUSTFUL_ADAPTOR_PROGRAM_ID` — from Ranger docs
- `KAMINO_LENDING_MARKET`, `KAMINO_RESERVE` — from [kamino-scripts repo](https://github.com/voltrxyz/kamino-scripts)

### 8.2 Run the scripts in order

```bash
cd vault-setup

npx ts-node 01-create-vault.ts
# → Copy VAULT_ADDRESS to both vault-setup/.env and keeper/.env

npx ts-node 02-lp-metadata.ts

npx ts-node 03-add-kamino-adaptor.ts
# → Adds Kamino as a registered strategy adaptor

npx ts-node 04-add-trustful-adaptor.ts
# → Adds Trustful as a registered strategy adaptor

npx ts-node 05-init-kamino-strategy.ts
# → Copy KAMINO_STRATEGY_ADDRESS to keeper/.env

npx ts-node 06-init-trustful-strategy.ts
# → Copy TRUSTFUL_STRATEGY_ADDRESS to keeper/.env

npx ts-node 07-verify-setup.ts
# → Should print "All checks passed"
```

Each script prints the address to add to `.env`. **Pause after each one and fill it in before running the next.**

### 8.3 Fund the vault

```bash
# Switch RPC_URL to mainnet in vault-setup/.env, then:
# Send USDC to your vault's token account
# Minimum recommended: $1,000 USDC for meaningful yield
# The keeper auto-splits between Kamino and HL based on regime
```

---

## 9 — Test on Hyperliquid Testnet

Before touching mainnet, verify the signing works:

```bash
# In keeper/.env, temporarily override:
HL_API_URL=https://api.hyperliquid-testnet.xyz

cd keeper
npm run dev
```

Watch the logs. You should see:
```
[INFO] [keeper.vault]    Vault verified. Manager: ...
[INFO] [rebalancer.tick] Rebalance loop tick
[INFO] [rebalancer.state] { regime: "...", fundingAnn: "x.xx%", ... }
```

If an order fires, you should see:
```
[INFO] [orders.open]  Opening short BTC sz=0.001 px=95000
[INFO] [orders.open]  Short opened as maker. Order: 12345678
```

**If you see `[ERROR] [orders.open] Taker order also failed`** — the signing is wrong. Check that `@msgpack/msgpack` is installed (`npm ls @msgpack/msgpack`).

Switch back to mainnet when ready:
```bash
HL_API_URL=https://api.hyperliquid.xyz
```

---

## 10 — Deploy Keeper to Render

1. Push this repo to GitHub (Render needs to pull from it)

```bash
cd /workspaces/YOUR_REPO_NAME
git init   # if not already a git repo
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git add .
git commit -m "feat: osprey-ranger v2"
git push -u origin main
```

2. On [render.com](https://render.com):
   - New → **Background Worker**
   - Connect your GitHub repo
   - **Root Directory**: `keeper`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Starter ($7/mo) — **required**, free tier sleeps

3. Add environment variables in Render dashboard → Environment:
   - Copy every key from `keeper/.env` (not the file itself — paste values one by one)
   - Never upload the `.env` file to Render

4. Deploy. Watch logs for:
```
[INFO] [keeper.start]  All loops running
[INFO] [keeper.health] Health endpoint listening on :3001/health
[INFO] [keeper.vault]  Vault verified. Manager: ...
```

---

## 11 — Switching Wallets (Frontend + Keeper)

### Frontend wallet (MetaMask — for manual trades)

The `WalletButton` component in the Osprey UI handles this entirely:

- **Switch Account** in the dropdown → MetaMask shows its account picker → new account selected, no page reload
- **Switch Wallet** in the dropdown → wallet modal opens → click a different provider to connect

The keeper bot is **not affected** by which wallet is connected in the browser. They are independent.

### Keeper wallet (server-side — for automated trades)

The keeper always uses `HL_PRIVATE_KEY` from its environment. To switch the keeper to a different wallet:

```bash
# 1. In Render dashboard → Environment:
#    Update HL_PRIVATE_KEY and HL_WALLET_ADDRESS to the new values

# 2. Trigger a redeploy:
git commit --allow-empty -m "chore: rotate keeper wallet"
git push
```

> ⚠️ Before switching the keeper wallet, make sure the old wallet has no open positions on Hyperliquid.  
> The keeper will stop monitoring the old address immediately.

---

## 12 — Risk Parameters

All limits live in `keeper/src/risk/limits.ts`. Edit and redeploy to change.

| Parameter | Default | Notes |
|-----------|---------|-------|
| `MAX_DRAWDOWN_PCT` | 5% | Emergency exit if NAV drops this far from peak |
| `MIN_FUNDING_ANNUALISED` | 8% | Reduce HL allocation below this rate |
| `NEGATIVE_FUNDING_EXIT` | true | Instant exit if funding goes negative |
| `REBALANCE_THRESHOLD_PCT` | 5% | Minimum drift to trigger rebalance |
| `MAX_HL_ALLOCATION_PCT` | 80% | Hard cap on HL exposure |
| `MAX_POSITION_LEVERAGE` | 1.0× | Always fully collateralised |
| `LIQ_PROXIMITY_THRESHOLD` | 10% | Emergency exit if within 10% of liquidation |

Regime targets (what % goes to HL vs Kamino):

```typescript
HOT:     { hl: 0.70, kamino: 0.30 }   // market-wide funding elevated
NEUTRAL: { hl: 0.40, kamino: 0.60 }
COLD:    { hl: 0.05, kamino: 0.95 }   // low/no funding — park in Kamino
```

> **Funding rate note**: Hyperliquid pays every 8 hours (3× per day).  
> All annualised figures = 8-hour rate × 3 × 365. This is already correct throughout the codebase.

---

## 13 — v1 Known Limitations

**Cross-chain USDC bridging is manual.** The keeper automates everything except physically moving USDC between Solana and Hyperliquid. When a rebalance fires:

- Solana → HL: you get a `[WARN] rebalancer.bridge: ACTION REQUIRED` log. Go to `app.hyperliquid.xyz/deposit` and deposit the stated amount from your Solana wallet. The keeper will open the short position automatically on the next tick once funds arrive.
- HL → Solana: similar log. Go to `app.hyperliquid.xyz/withdraw`.

This is by design for v1. v2 will automate this via Circle CCTP.

---

## 14 — Quant Backtest

```bash
cd quant
source venv/bin/activate

# Fetch up to 90 days of historical HL funding data
python data/fetch_hl_funding.py

# Run the backtest
python backtest/strategy.py

# Generate HTML tearsheet
python reports/generate_tearsheet.py
# Opens report in browser

deactivate
```

---

## 15 — Final Checklist

Run through this before marking yourself done:

```
Infrastructure
  [ ] curl /api/regime returns { regime, confidence, topPair }
  [ ] curl /api/sizing returns { recommendedHlAllocationPct }
  [ ] Render keeper health: curl YOUR-RENDER-URL/health → {"status":"ok"}
  [ ] Supabase keeper_logs table has rows
  [ ] Supabase rebalance_log has at least one entry (wait 15 min after deploy)

Vault
  [ ] 07-verify-setup.ts printed "All checks passed" on devnet
  [ ] VAULT_ADDRESS, KAMINO_STRATEGY_ADDRESS, TRUSTFUL_STRATEGY_ADDRESS in keeper/.env

Signing
  [ ] HL testnet order returned status: "ok" (not "err")
  [ ] @msgpack/msgpack installed in keeper/ (npm ls @msgpack/msgpack)
  [ ] Frontend WalletButton connects MetaMask successfully
  [ ] HlTradePanel places a test order on HL testnet

Security
  [ ] .gitignore committed and working (git status shows no .env files)
  [ ] No secrets in git history (run: git log --all -S "0x" -- '*.env' — should be empty)
  [ ] admin.json / manager.json / vault.json NOT in git (git ls-files *.json | grep -v package)
  [ ] All credentials rotated if the old repo was public
```

---

## 16 — Troubleshooting

| Problem | Fix |
|---------|-----|
| `Missing required env var: X` | Open `keeper/.env`, fill in X |
| `/api/regime` returns 500 | Vercel → Functions → Logs. HL API may be briefly down |
| Vault script fails "Invalid program" | Wrong adaptor ID — re-read from docs.ranger.finance |
| Keeper crashes immediately | Render → Logs → error names the missing var |
| HL order rejected "Invalid signature" | `@msgpack/msgpack` not installed — `cd keeper && npm install` |
| HL order rejected "Insufficient margin" | Funds not arrived from bridge yet — wait, then retry |
| "Would immediately cross" in logs | Normal — keeper retried as taker (IOC). Not an error |
| MetaMask shows wrong account | Click wallet button → Switch Account |
| MetaMask not detected | Ensure extension is installed and unlocked, then reload |
| Render service keeps sleeping | Upgrade to Starter plan ($7/mo) |
| `keeper_logs` table empty | Check DATABASE_URL in keeper/.env is correct |
| HL balance shows $0 in UI | Deposit USDC at app.hyperliquid.xyz first |
| TypeScript errors in keeper | `cd keeper && npm run typecheck` — usually a missing env var |
| `npx ts-node` not found | `cd vault-setup && npm install` first |
