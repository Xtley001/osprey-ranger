#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  bootstrap.sh — One-command full setup for Osprey × Ranger
#
#  Run this once after unzipping. It installs everything, validates your
#  env vars, and tells you exactly what to do next.
#
#  Usage:
#    bash scripts/bootstrap.sh
#
#  Options:
#    --skip-python   Skip quant/Python setup
#    --skip-typecheck  Skip TypeScript validation
#    --fresh         Force-overwrite .env files from .env.example (use for fresh setup)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

box()  { echo -e "\n${CYAN}${BOLD}━━━  $1  ━━━${NC}"; }
step() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()   { echo -e "  ${GREEN}✓ $1${NC}"; }
warn() { echo -e "  ${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "\n${RED}✗ $1${NC}\n"; exit 1; }
info() { echo -e "  ${NC}$1${NC}"; }

SKIP_PYTHON=false
SKIP_TYPECHECK=false
FRESH=false
for arg in "$@"; do
  [[ "$arg" == "--skip-python" ]]     && SKIP_PYTHON=true
  [[ "$arg" == "--skip-typecheck" ]]  && SKIP_TYPECHECK=true
  [[ "$arg" == "--fresh" ]]           && FRESH=true
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

cd "$ROOT"

# ══════════════════════════════════════════════════════════════════════════════
box "Osprey × Ranger — Bootstrap"
echo ""
info "Root: $ROOT"

# ── 1. Prerequisites ───────────────────────────────────────────────────────────
box "1 / 6  Checking prerequisites"

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install v20+ from https://nodejs.org"
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
[ "$NODE_VER" -lt 20 ] && fail "Node.js v${NODE_VER} found — need v20+. Update at nodejs.org"
ok "Node.js $(node -v)"

# npm
command -v npm &>/dev/null && ok "npm $(npm -v)" || fail "npm not found"

# git
command -v git &>/dev/null && ok "git $(git --version | awk '{print $3}')" \
  || warn "git not found — push-to-git.sh won't work"

# Python (optional)
PYTHON_CMD=""
if ! $SKIP_PYTHON; then
  for cmd in python3 python; do
    if command -v $cmd &>/dev/null; then
      PY_MINOR=$($cmd -c "import sys; print(sys.version_info.minor)")
      PY_MAJOR=$($cmd -c "import sys; print(sys.version_info.major)")
      if [ "$PY_MAJOR" -ge 3 ] && [ "$PY_MINOR" -ge 11 ]; then
        PYTHON_CMD=$cmd
        ok "Python $($cmd --version)"
        break
      fi
    fi
  done
  [ -z "$PYTHON_CMD" ] && warn "Python 3.11+ not found — skipping quant layer. Install from python.org"
fi

# ── 2. Install deps ────────────────────────────────────────────────────────────
box "2 / 6  Installing Node dependencies"

step "keeper/"
cd "$ROOT/keeper"
npm install 2>&1 | grep -E "added|warn|error" | tail -5
ok "keeper deps installed  (includes @msgpack/msgpack — required for HL signing)"

step "vault-setup/"
cd "$ROOT/vault-setup"
npm install 2>&1 | grep -E "added|warn|error" | tail -5
ok "vault-setup deps installed"

# ── 3. Python venv ─────────────────────────────────────────────────────────────
if [ -n "$PYTHON_CMD" ] && ! $SKIP_PYTHON; then
  box "3 / 6  Python quant layer"
  cd "$ROOT/quant"
  [ ! -d venv ] && $PYTHON_CMD -m venv venv && ok "venv created"
  source venv/bin/activate
  pip install -q --upgrade pip
  pip install -q -r requirements.txt
  ok "Python deps installed"
  deactivate
else
  box "3 / 6  Python quant layer — skipped"
fi

# ── 4. .env files ──────────────────────────────────────────────────────────────
box "4 / 6  Setting up .env files"

for dir in keeper vault-setup; do
  ENV="$ROOT/$dir/.env"
  EX="$ROOT/$dir/.env.example"
  if $FRESH; then
    cp "$EX" "$ENV"
    ok "$dir/.env reset from .env.example (--fresh)"
    warn "→ Open $dir/.env and fill in your new credentials"
  elif [ ! -f "$ENV" ] || [ ! -s "$ENV" ]; then
    cp "$EX" "$ENV"
    ok "$dir/.env created from .env.example"
    warn "→ Open $dir/.env and fill in your credentials before deploying"
  else
    ok "$dir/.env already exists — not overwriting (use --fresh to reset)"
  fi
done

# ── 5. TypeScript check ────────────────────────────────────────────────────────
if ! $SKIP_TYPECHECK; then
  box "5 / 6  TypeScript validation"
  cd "$ROOT/keeper"
  if npm run typecheck 2>&1 | grep -q "error TS"; then
    warn "TypeScript errors found — expected if .env not filled yet"
    warn "Re-run after filling keeper/.env: cd keeper && npm run typecheck"
  else
    ok "keeper TypeScript clean"
  fi
else
  box "5 / 6  TypeScript — skipped"
fi

# ── 6. Summary ────────────────────────────────────────────────────────────────
box "6 / 6  Done"

echo ""
echo -e "${BOLD}What to do next — follow SETUP.md section by section:${NC}"
echo ""
echo -e "  ${CYAN}1.${NC}  ${BOLD}keeper/.env${NC}             → fill in all credentials"
echo -e "  ${CYAN}2.${NC}  ${BOLD}vault-setup/.env${NC}        → fill in keypairs + addresses"
echo -e "  ${CYAN}3.${NC}  Deploy signal API:       ${YELLOW}bash scripts/push-to-git.sh${NC}"
echo -e "  ${CYAN}4.${NC}  Run vault setup scripts: ${YELLOW}cd vault-setup && npx ts-node 01-create-vault.ts${NC}"
echo -e "  ${CYAN}5.${NC}  Test on HL testnet:      ${YELLOW}cd keeper && npm run dev${NC}"
echo -e "  ${CYAN}6.${NC}  Deploy keeper to Render: connect repo, set env vars, push"
echo ""
echo -e "  Full guide: ${CYAN}SETUP.md${NC}"
echo ""
