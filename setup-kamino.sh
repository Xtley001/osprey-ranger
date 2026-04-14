#!/usr/bin/env bash
# setup-kamino.sh
# Run from anywhere inside your codespace:
#   bash setup-kamino.sh

set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
info() { echo -e "${CYAN}▶ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ── Hardcoded values from your existing setup ─────────────────────────────────
HELIUS_RPC="https://mainnet.helius-rpc.com/?api-key=4b11a98a-125c-462b-a8cb-a78392bf9a06"
USDC_MINT="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
SPL_TOKEN_PROGRAM="TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
KAMINO_RESERVE="Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6"

ADMIN_KEYPAIR='[135,100,6,113,194,184,134,95,208,87,199,197,185,9,24,233,22,90,25,209,221,102,43,234,253,64,70,106,91,30,20,37,114,62,76,40,246,55,106,38,10,207,181,219,210,186,196,182,34,229,168,157,147,174,31,139,193,236,32,178,207,8,13,41]'
MANAGER_KEYPAIR='[136,46,246,6,4,219,215,131,13,5,4,144,127,225,129,102,163,79,136,210,75,237,234,191,151,236,216,138,5,221,80,179,47,245,245,243,39,87,105,22,107,192,40,12,207,238,91,101,201,71,172,217,252,152,186,29,8,250,235,76,221,241,34,115]'

# ── Where to clone ────────────────────────────────────────────────────────────
TARGET="/workspaces/kamino-scripts"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Osprey — Kamino Scripts Setup (Mainnet)          ${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ── 1. Clone or update repo ───────────────────────────────────────────────────
info "Setting up kamino-scripts repo"
if [ -d "$TARGET/.git" ]; then
  warn "Repo already exists — pulling latest"
  git -C "$TARGET" pull origin main
else
  git clone https://github.com/voltrxyz/kamino-scripts.git "$TARGET"
fi
ok "Repo ready at $TARGET"

# ── 2. Install pnpm if missing ────────────────────────────────────────────────
info "Checking pnpm"
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm --silent
  ok "pnpm installed"
else
  ok "pnpm already available ($(pnpm -v))"
fi

# ── 3. Install dependencies ───────────────────────────────────────────────────
info "Installing dependencies"
cd "$TARGET"
pnpm install --silent
ok "Dependencies installed"

# ── 4. Write keypair files ────────────────────────────────────────────────────
info "Writing keypair files"
echo "$ADMIN_KEYPAIR"   > "$TARGET/admin.json"
echo "$MANAGER_KEYPAIR" > "$TARGET/manager.json"
ok "admin.json and manager.json written"

# ── 5. Write .env ─────────────────────────────────────────────────────────────
info "Writing .env"
cat > "$TARGET/.env" << EOF
ADMIN_FILE_PATH="$TARGET/admin.json"
MANAGER_FILE_PATH="$TARGET/manager.json"
HELIUS_RPC_URL=$HELIUS_RPC
EOF
ok ".env written"

# ── 6. Write config/base.ts ───────────────────────────────────────────────────
info "Writing config/base.ts"
mkdir -p "$TARGET/config"
cat > "$TARGET/config/base.ts" << EOF
// config/base.ts — Osprey vault config (mainnet)
// VAULT_ADDRESS: fill in after running vault creation scripts
export const vaultAddress      = "";  // ← paste VAULT_ADDRESS here after vault is created
export const assetMintAddress  = "$USDC_MINT";
export const assetTokenProgram = "$SPL_TOKEN_PROGRAM";
export const lookupTableAddress = "";  // ← fill in if vault was created with a lookup table
EOF
ok "config/base.ts written"

# ── 7. Write config/kamino.ts ─────────────────────────────────────────────────
info "Writing config/kamino.ts"
cat > "$TARGET/config/kamino.ts" << EOF
// config/kamino.ts — Kamino USDC Main Market (mainnet)
// reserveAddress: verified from https://app.kamino.finance USDC Main Market
export const reserveAddress         = "$KAMINO_RESERVE";
// depositStrategyAmount: in USDC lamports (6 decimals)
// 1_000_000 = 1 USDC. Change this before running deposit script.
export const depositStrategyAmount  = 1_000_000;
EOF
ok "config/kamino.ts written"

# ── 8. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  All done! kamino-scripts is ready.               ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Repo:    ${CYAN}$TARGET${NC}"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo -e "  1. Get mainnet SOL to: ${CYAN}8gxaHALZme6Bjd3wQPVHu7mYXwmqUA2oe7VWQ2KEkXBe${NC}"
echo -e "  2. Run your vault-setup scripts (01-create-vault.ts on mainnet)"
echo -e "  3. Paste the output VAULT_ADDRESS into: ${CYAN}$TARGET/config/base.ts${NC}"
echo -e "  4. Then run: ${CYAN}cd $TARGET && pnpm ts-node src/scripts/manager-deposit-market.ts${NC}"
echo ""
echo -e "  ${YELLOW}⚠  vaultAddress in config/base.ts is blank until vault is created${NC}"
echo ""
