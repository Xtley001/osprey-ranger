#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh — Extract Osprey × Ranger extension and install all dependencies
#
# Usage (from inside the downloaded zip's directory, or wherever you saved it):
#
#   # If you have the zip file:
#   unzip osprey-ranger-extension.zip
#   cd osprey-ranger-extension
#   bash scripts/install.sh
#
# Options:
#   --fresh   Force-overwrite .env files from .env.example (use for fresh setup)
#
#   # Or if you're already inside the extracted folder:
#   bash scripts/install.sh
#
# Options:
#   --fresh   Force-overwrite .env files from .env.example (use for fresh setup)
#
# What this does:
#   1. Checks Node.js ≥ 20 and Python ≥ 3.11 are available
#   2. Installs keeper dependencies
#   3. Installs vault-setup dependencies
#   4. Creates Python venv for quant layer
#   5. Prints next steps
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Colours
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
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Osprey × Ranger — Install Script                 ${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# ── 1. Check prerequisites ────────────────────────────────────────────────────
step "Checking prerequisites"

# Node.js
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install from https://nodejs.org (need v20+)"
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
  fail "Node.js v${NODE_VER} found, need v20+. Update at https://nodejs.org"
fi
ok "Node.js $(node -v)"

# npm
if ! command -v npm &>/dev/null; then
  fail "npm not found (should come with Node.js)"
fi
ok "npm $(npm -v)"

# Python
PYTHON_CMD=""
for cmd in python3 python; do
  if command -v $cmd &>/dev/null; then
    PY_VER=$($cmd --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
    MAJOR=$(echo $PY_VER | cut -d. -f1)
    MINOR=$(echo $PY_VER | cut -d. -f2)
    if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 11 ]; then
      PYTHON_CMD=$cmd
      ok "Python $($cmd --version)"
      break
    fi
  fi
done
if [ -z "$PYTHON_CMD" ]; then
  warn "Python 3.11+ not found — quant layer won't be set up. Install from python.org"
fi

# Git
if ! command -v git &>/dev/null; then
  warn "Git not found — push-to-git.sh won't work. Install from git-scm.com"
fi

# ── 2. Install keeper dependencies ───────────────────────────────────────────
step "Installing keeper dependencies"
cd "$ROOT_DIR/keeper"
npm install --prefer-offline 2>&1 | tail -3
ok "keeper/node_modules ready"

# TypeScript check
if npm run typecheck 2>&1 | grep -q "error TS"; then
  warn "TypeScript errors in keeper — check after filling in .env"
else
  ok "keeper TypeScript clean"
fi

# ── 3. Install vault-setup dependencies ──────────────────────────────────────
step "Installing vault-setup dependencies"
cd "$ROOT_DIR/vault-setup"
npm install --prefer-offline 2>&1 | tail -3
ok "vault-setup/node_modules ready"

# ── 4. Set up quant Python environment ───────────────────────────────────────
if [ -n "$PYTHON_CMD" ]; then
  step "Setting up quant Python environment"
  cd "$ROOT_DIR/quant"

  if [ ! -d "venv" ]; then
    $PYTHON_CMD -m venv venv
    ok "Python venv created"
  else
    ok "Python venv already exists"
  fi

  source venv/bin/activate
  pip install -q --upgrade pip
  pip install -q -r requirements.txt
  ok "Python dependencies installed"
  deactivate
fi

# ── 5. Copy .env.example files ────────────────────────────────────────────────
step "Creating .env files from examples"

FRESH=false
for arg in "$@"; do
  [[ "$arg" == "--fresh" ]] && FRESH=true
done

for dir in keeper vault-setup; do
  ENV_FILE="$ROOT_DIR/$dir/.env"
  EXAMPLE="$ROOT_DIR/$dir/.env.example"
  if $FRESH; then
    cp "$EXAMPLE" "$ENV_FILE"
    ok "$dir/.env reset from .env.example (--fresh)"
    warn "→ Open $dir/.env and fill in your new credentials"
  elif [ ! -f "$ENV_FILE" ] || [ ! -s "$ENV_FILE" ]; then
    cp "$EXAMPLE" "$ENV_FILE"
    ok "$dir/.env created from .env.example"
    warn "→ Open $dir/.env and fill in your credentials before deploying"
  else
    ok "$dir/.env already exists — not overwriting (use --fresh to reset)"
  fi
done

# ── 6. Summary ────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Installation complete!                            ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Next steps:"
echo ""
echo -e "  ${CYAN}1.${NC} Read  SETUP.md  for the full deployment guide"
echo -e "  ${CYAN}2.${NC} Fill  keeper/.env    with your credentials"
echo -e "  ${CYAN}3.${NC} Fill  vault-setup/.env  with your keypairs + addresses"
echo -e "  ${CYAN}4.${NC} Copy api/ and vercel.json to your Osprey repo:"
echo -e "         ${YELLOW}cp -r api/ vercel.json shared/ /path/to/osprey/${NC}"
echo -e "  ${CYAN}5.${NC} Push to git:"
echo -e "         ${YELLOW}bash scripts/push-to-git.sh${NC}"
echo ""
