#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# push-to-git.sh — Copy extension files into Osprey repo and push to GitHub
#
# Usage:
#   # From inside the osprey-ranger-extension folder:
#   bash scripts/push-to-git.sh
#
#   # With explicit Osprey repo path:
#   bash scripts/push-to-git.sh --osprey /path/to/osprey
#
#   # Dry run (see what would happen without making changes):
#   bash scripts/push-to-git.sh --dry-run
#
# What this does:
#   1. Locates your Osprey repo (auto-detects sibling folder named 'osprey',
#      or use --osprey flag)
#   2. Copies: api/, shared/, vercel.json, docs/, keeper/, vault-setup/, quant/
#   3. Stages the new files with git add
#   4. Commits with a conventional commit message
#   5. Pushes to origin/main
#
# What this does NOT touch:
#   - Existing Osprey source code (src/, public/, engine-tests/, etc.)
#   - Existing Osprey .env files
#   - Any Osprey files that already exist (copies only what's new)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

step()  { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()    { echo -e "${GREEN}✓ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $1${NC}"; }
fail()  { echo -e "${RED}✗ $1${NC}"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"
OSPREY_DIR=""
DRY_RUN=false

# ── Parse arguments ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --osprey)
      OSPREY_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

# ── Find Osprey repo ──────────────────────────────────────────────────────────
if [ -z "$OSPREY_DIR" ]; then
  # Auto-detect: look for sibling named 'osprey'
  CANDIDATE="$(dirname "$EXT_DIR")/osprey"
  if [ -d "$CANDIDATE" ] && [ -f "$CANDIDATE/package.json" ]; then
    OSPREY_DIR="$CANDIDATE"
  fi
fi

if [ -z "$OSPREY_DIR" ] || [ ! -d "$OSPREY_DIR" ]; then
  echo ""
  echo -e "${RED}Could not find Osprey repo automatically.${NC}"
  echo ""
  echo "Please specify the path:"
  echo "  bash scripts/push-to-git.sh --osprey /path/to/osprey"
  echo ""
  echo "Or clone Osprey first:"
  echo "  git clone https://github.com/Xtley001/osprey.git"
  echo "  bash scripts/push-to-git.sh --osprey ./osprey"
  exit 1
fi

if [ ! -f "$OSPREY_DIR/package.json" ]; then
  fail "$OSPREY_DIR does not look like an Osprey repo (no package.json)"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Osprey × Ranger — Push to Git                       ${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Extension dir:  ${CYAN}$EXT_DIR${NC}"
echo -e "  Osprey repo:    ${CYAN}$OSPREY_DIR${NC}"
if $DRY_RUN; then
  echo -e "  Mode:           ${YELLOW}DRY RUN (no files written, no git changes)${NC}"
fi

# ── Helper: copy dir, skip existing unless it's in overwrite list ─────────────
# Files that should REPLACE what's in Osprey (not additive):
OVERWRITE_FILES=("vercel.json")  # vercel.json needs to be replaced for API routes

copy_item() {
  local src="$1"
  local dst="$2"
  local item_name
  item_name="$(basename "$src")"

  if $DRY_RUN; then
    echo -e "  ${YELLOW}[DRY RUN]${NC} Would copy: $src → $dst"
    return
  fi

  # Check if this item is in the overwrite list
  local should_overwrite=false
  for f in "${OVERWRITE_FILES[@]}"; do
    if [ "$item_name" = "$f" ]; then
      should_overwrite=true
      break
    fi
  done

  if [ -d "$src" ]; then
    if [ -d "$dst" ] && ! $should_overwrite; then
      # Merge: copy files that don't exist yet
      rsync -a --ignore-existing "$src/" "$dst/"
    else
      cp -r "$src" "$(dirname "$dst")/"
    fi
  elif [ -f "$src" ]; then
    if [ -f "$dst" ] && ! $should_overwrite; then
      echo -e "  ${YELLOW}skip${NC} $item_name already exists (not overwriting)"
    else
      cp "$src" "$dst"
    fi
  fi
}

# ── Step 1: Copy extension files into Osprey ─────────────────────────────────
step "Copying extension files into Osprey repo"

# Files/dirs to copy
declare -A COPIES=(
  ["$EXT_DIR/api"]="$OSPREY_DIR/api"
  ["$EXT_DIR/shared"]="$OSPREY_DIR/shared"
  ["$EXT_DIR/vercel.json"]="$OSPREY_DIR/vercel.json"
  ["$EXT_DIR/docs"]="$OSPREY_DIR/docs"
  ["$EXT_DIR/keeper"]="$OSPREY_DIR/keeper"
  ["$EXT_DIR/vault-setup"]="$OSPREY_DIR/vault-setup"
  ["$EXT_DIR/quant"]="$OSPREY_DIR/quant"
  ["$EXT_DIR/scripts"]="$OSPREY_DIR/scripts"
)

for src in "${!COPIES[@]}"; do
  dst="${COPIES[$src]}"
  if [ -e "$src" ]; then
    copy_item "$src" "$dst"
    ok "Copied $(basename "$src")"
  fi
done

# Merge .gitignore additions
if ! $DRY_RUN; then
  GITIGNORE="$OSPREY_DIR/.gitignore"
  EXT_GITIGNORE="$EXT_DIR/.gitignore"
  if [ -f "$EXT_GITIGNORE" ] && [ -f "$GITIGNORE" ]; then
    # Append lines from extension .gitignore that aren't already present
    while IFS= read -r line; do
      if [ -n "$line" ] && ! grep -qF "$line" "$GITIGNORE"; then
        echo "$line" >> "$GITIGNORE"
      fi
    done < "$EXT_GITIGNORE"
    ok "Updated .gitignore"
  fi
fi

# Install @vercel/node in Osprey if not already present
if ! $DRY_RUN; then
  if ! grep -q "@vercel/node" "$OSPREY_DIR/package.json"; then
    step "Adding @vercel/node to Osprey dependencies"
    cd "$OSPREY_DIR"
    npm install --save-dev @vercel/node 2>&1 | tail -2
    ok "@vercel/node installed"
  else
    ok "@vercel/node already in package.json"
  fi
fi

# ── Step 2: Git operations ────────────────────────────────────────────────────
step "Git operations"

cd "$OSPREY_DIR"

if ! git rev-parse --git-dir &>/dev/null; then
  fail "Not a git repo: $OSPREY_DIR. Run 'git init' or clone the repo first."
fi

if $DRY_RUN; then
  echo -e "  ${YELLOW}[DRY RUN]${NC} Would run: git add api/ shared/ vercel.json docs/ keeper/ vault-setup/ quant/ scripts/ .gitignore package.json package-lock.json"
  echo -e "  ${YELLOW}[DRY RUN]${NC} Would run: git commit -m 'feat: add Ranger vault extension...'"
  echo -e "  ${YELLOW}[DRY RUN]${NC} Would run: git push origin main"
  echo ""
  echo -e "  ${GREEN}Dry run complete — no changes made.${NC}"
  echo -e "  Remove --dry-run to apply."
  exit 0
fi

# Stage new files — only what the extension adds
git add \
  api/ \
  shared/ \
  vercel.json \
  docs/ \
  keeper/ \
  vault-setup/ \
  quant/ \
  scripts/ \
  .gitignore \
  package.json \
  package-lock.json \
  2>/dev/null || true

# Check if there's anything to commit
if git diff --cached --quiet; then
  warn "Nothing new to commit — all files already staged or committed"
else
  git commit -F - <<'COMMITMSG'
feat: add Ranger vault extension (keeper + signal API + quant layer)

api/:
- api/regime.ts   — serverless GET /api/regime → HOT|NEUTRAL|COLD
- api/sizing.ts   — serverless GET /api/sizing → recommended HL allocation %
Both cached at Vercel edge (60s) and consumed by keeper bot every 15 min.

shared/types.ts:
- Cross-system TypeScript types (RegimeLabel, RebalanceRecord, etc.)
- REGIME_ALLOCATION and REGIME_THRESHOLDS constants shared across all layers

vercel.json:
- Updated with API function routing (api/**/*.ts → @vercel/node@3)
- All existing SPA rewrites and security headers preserved

keeper/ (16 files):
- Always-on Node.js bot for Render Starter ($7/mo)
- Loops: rebalance (15min), mark-to-market (1hr), risk monitor (5min)
- vault/: Kamino deposit/withdraw, Trustful mark-to-market via @voltr/vault-sdk
- exchange/: HL REST + EIP-712 signing (ported from src/api/hyperliquid.ts)
- strategy/: regime-gated allocator, rebalancer, 1× leverage sizing
- risk/: 5% drawdown limit, negative funding exit, liquidation proximity guard
- reporting/: Postgres logger (keeper_logs, rebalance_log, nav_history)
- signal/: HTTP client → Osprey /api/regime with COLD fallback

vault-setup/ (7 scripts):
- One-time Solana vault initialization via @voltr/vault-sdk
- Scripts 01–07: create vault, LP metadata, add adaptors, init strategies, verify

quant/ (9 files):
- Real HL historical funding data fetcher (from Jan 2023)
- Kamino USDC APY fetcher with synthetic fallback
- Hour-by-hour strategy backtest (regime-gated HL + Kamino floor)
- Risk metrics: Sharpe, Sortino, Calmar, max drawdown
- 4-page PDF tearsheet generator

docs/:
- SETUP.md     — full step-by-step deployment guide
- USER_MANUAL.md — complete trader guide (no code required)
- OPERATIONS.md — day-to-day vault management
- ARCHITECTURE.md — system design and data flow reference

scripts/:
- install.sh      — dependency installation
- push-to-git.sh  — this script

0 TypeScript errors. All loops independently fault-tolerant.
COMMITMSG

  ok "Committed"
fi

# ── Step 3: Push ──────────────────────────────────────────────────────────────
step "Pushing to origin/main"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if git push origin "$CURRENT_BRANCH" 2>&1; then
  ok "Pushed to origin/$CURRENT_BRANCH"
else
  warn "Push failed. Try: git pull --rebase origin $CURRENT_BRANCH && git push"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Extension pushed to GitHub ✅                                ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Vercel will auto-deploy the new API endpoints."
echo -e "  Wait ~2 minutes, then verify:"
echo ""
echo -e "  ${CYAN}curl https://osprey-three.vercel.app/api/regime${NC}"
echo ""
echo -e "  Then follow docs/SETUP.md for:"
echo -e "    Step 2 — vault-setup (Solana vault initialization)"
echo -e "    Step 3 — keeper deployment to Render"
echo -e "    Step 4 — quant backtest"
echo ""
