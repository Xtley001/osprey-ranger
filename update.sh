#!/usr/bin/env bash
# update.sh — Download the latest Osprey × Ranger extension and apply it to this repo
#
# Run this from inside /workspaces/osprey-ranger:
#   bash update.sh
#
# What it does:
#   1. Downloads osprey-ranger-extension.zip from wherever you point it
#   2. Extracts into a temp folder
#   3. Copies every new/updated file into the current repo
#   4. Installs dependencies
#   5. Commits and pushes

set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "\n${CYAN}▶ $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

REPO_ROOT="$(pwd)"
TMP="$REPO_ROOT/tmp-extract"

# ── Make sure we're in the right place ───────────────────────────────────────
if [ ! -f "$REPO_ROOT/vercel.json" ]; then
  fail "Run this from the root of your osprey-ranger repo (where vercel.json lives)"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Osprey × Ranger — Update Script                   ${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Repo: ${CYAN}$REPO_ROOT${NC}"

# ── Step 1: Locate or download the zip ───────────────────────────────────────
step "Locating zip file"

ZIP=""

# Priority 1: passed as argument
if [ $# -ge 1 ] && [ -f "$1" ]; then
  ZIP="$1"
  ok "Using provided file: $ZIP"

# Priority 2: already in repo root
elif [ -f "$REPO_ROOT/osprey-ranger-extension.zip" ]; then
  ZIP="$REPO_ROOT/osprey-ranger-extension.zip"
  ok "Found in repo root: $ZIP"

# Priority 3: in tmp-test (where you might have dropped it)
elif [ -f "$REPO_ROOT/tmp-test/osprey-ranger-extension.zip" ]; then
  ZIP="$REPO_ROOT/tmp-test/osprey-ranger-extension.zip"
  ok "Found in tmp-test: $ZIP"

# Priority 4: ask for the path
else
  echo ""
  echo -e "  ${YELLOW}Zip file not found automatically.${NC}"
  echo ""
  echo "  Options:"
  echo "  a) Drag the zip into your Codespace file explorer, then run:"
  echo "       bash update.sh /path/to/osprey-ranger-extension.zip"
  echo ""
  echo "  b) If it's hosted somewhere, download it first:"
  echo "       wget -O osprey-ranger-extension.zip 'YOUR_DOWNLOAD_URL'"
  echo "       bash update.sh osprey-ranger-extension.zip"
  echo ""
  exit 1
fi

# ── Step 2: Extract ───────────────────────────────────────────────────────────
step "Extracting zip"

rm -rf "$TMP"
mkdir -p "$TMP"

unzip -q "$ZIP" -d "$TMP"
ok "Extracted to $TMP"

# The zip wraps everything in a build/ folder — find it
EXTRACT_SRC=""
if [ -d "$TMP/build" ]; then
  EXTRACT_SRC="$TMP/build"
elif [ -d "$TMP/osprey-ranger-extension" ]; then
  EXTRACT_SRC="$TMP/osprey-ranger-extension"
else
  # Flat extract
  EXTRACT_SRC="$TMP"
fi

ok "Source root: $EXTRACT_SRC"

# ── Step 3: Copy files into repo ─────────────────────────────────────────────
step "Copying files into repo"

copy_if_exists() {
  local src="$EXTRACT_SRC/$1"
  local dst="$REPO_ROOT/$1"
  if [ -e "$src" ]; then
    if [ -d "$src" ]; then
      mkdir -p "$dst"
      # rsync: copy everything, overwrite existing files
      rsync -a "$src/" "$dst/"
      ok "Updated $1/"
    else
      cp -f "$src" "$dst"
      ok "Updated $1"
    fi
  else
    warn "Not in zip: $1 (skipping)"
  fi
}

# These always overwrite — they're the files Claude generated
copy_if_exists "api"
copy_if_exists "shared"
copy_if_exists "vercel.json"
copy_if_exists "keeper"
copy_if_exists "vault-setup"
copy_if_exists "quant"
copy_if_exists "scripts"
copy_if_exists "OSPREY.md"
copy_if_exists "README.md"
copy_if_exists ".gitignore"

# ── Step 4: Install dependencies ─────────────────────────────────────────────
step "Installing keeper dependencies"
cd "$REPO_ROOT/keeper"
npm install --prefer-offline 2>&1 | tail -3
ok "keeper node_modules ready"

step "Installing vault-setup dependencies"
cd "$REPO_ROOT/vault-setup"
npm install --prefer-offline 2>&1 | tail -3
ok "vault-setup node_modules ready"

# Python quant venv (optional — only if python3 available)
if command -v python3 &>/dev/null; then
  step "Setting up Python venv for quant layer"
  cd "$REPO_ROOT/quant"
  if [ ! -d "venv" ]; then
    python3 -m venv venv
  fi
  source venv/bin/activate
  pip install -q --upgrade pip
  pip install -q -r requirements.txt
  deactivate
  ok "quant/venv ready"
fi

# Create .env files from examples (only if they don't already exist)
step "Checking .env files"
for dir in keeper vault-setup; do
  ENV_FILE="$REPO_ROOT/$dir/.env"
  EXAMPLE="$REPO_ROOT/$dir/.env.example"
  if [ ! -f "$ENV_FILE" ] && [ -f "$EXAMPLE" ]; then
    cp "$EXAMPLE" "$ENV_FILE"
    warn "$dir/.env created from example — fill in your values"
  else
    ok "$dir/.env already exists — not overwritten"
  fi
done

# ── Step 5: Stage, commit, push ──────────────────────────────────────────────
step "Committing and pushing to GitHub"

cd "$REPO_ROOT"

# Stage everything the extension adds/updates
git add \
  api/ \
  shared/ \
  vercel.json \
  keeper/ \
  vault-setup/ \
  quant/ \
  scripts/ \
  OSPREY.md \
  README.md \
  .gitignore \
  2>/dev/null || true

# Only commit if there are staged changes
if git diff --cached --quiet; then
  warn "Nothing to commit — all files are already up to date"
else
  git commit -m "chore: apply osprey-ranger-extension update

Updated files: api, shared, vercel.json, keeper, vault-setup, quant, scripts, OSPREY.md"
  ok "Committed"

  if git push origin "$(git rev-parse --abbrev-ref HEAD)" 2>&1; then
    ok "Pushed to GitHub"
  else
    warn "Push failed. Run: git pull --rebase && git push"
  fi
fi

# ── Cleanup ───────────────────────────────────────────────────────────────────
step "Cleaning up temp files"
rm -rf "$TMP"
ok "Temp folder removed"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  All done! Repo is updated and pushed.                   ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${CYAN}Next:${NC} Vercel will auto-deploy the API endpoints (~2 min)"
echo ""
echo -e "  Verify with:"
echo -e "  ${YELLOW}curl https://osprey-three.vercel.app/api/regime${NC}"
echo ""
echo -e "  Then follow ${CYAN}OSPREY.md${NC} from Part 4 onwards."
echo ""
