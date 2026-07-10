#!/usr/bin/env bash
#
# callsmith — agent skill + pack verification CLI
# One-liner installer:  curl -fsSL .../install-callsmith.sh | bash
#
set -euo pipefail

REPO="Nachi-Kulkarni/Callsmith_skills"
BRANCH="main"
INSTALL_DIR="${CALLSMITH_HOME:-$HOME/.callsmith}"
BIN_DIR="${CALLSMITH_BIN:-$HOME/.local/bin}"
BINARY_NAME="callsmith"
INSTALL_METHOD="${CALLSMITH_INSTALL_METHOD:-}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
err()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; }

echo ""
bold "callsmith installer"
echo ""

# --- Node.js check -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed."
  echo ""
  echo "  Install Node.js >= 18:"
  echo "    curl -fsSL https://fnm.vercel.app/install | bash   # or use nvm"
  echo "    fnm install 22"
  echo ""
  exit 1
fi

NODE_VERSION="$(node -e 'process.stdout.write(process.versions.node)')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node.js >= 18 required (found $NODE_VERSION)."
  exit 1
fi
info "Node.js v$NODE_VERSION found."

# --- Choose install method ---------------------------------------------------
# Prefer npm from git if npm is available — handles PATH/manpages for us.
# CALLSMITH_INSTALL_METHOD=manual is also useful for offline/release tests.
if [ "$INSTALL_METHOD" != "manual" ] && command -v npm >/dev/null 2>&1; then
  info "Installing via npm (zero npm dependencies — installs in seconds)..."
  if npm install -g "github:$REPO" 2>/dev/null; then
    :
  else
    # npm global install failed (permissions?) — fall through to manual
    info "npm global install failed, falling back to manual install..."
    MANUAL=1
  fi
  [ "${MANUAL:-0}" = "0" ] && INSTALL_METHOD="npm"
fi

if [ "${INSTALL_METHOD:-manual}" = "manual" ]; then
  info "Installing to $INSTALL_DIR (manual)..."

  # Download tarball
  TARBALL_URL="https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"
  TMPDIR="$(mktemp -d)"
  INSTALL_STARTED=0
  BACKUP_DIR="$TMPDIR/managed-backup"

  cleanup() {
    status=$?
    if [ "$INSTALL_STARTED" = "1" ]; then
      # A managed-path replacement failed. Restore the previous managed tree;
      # unrelated files in CALLSMITH_HOME are never touched.
      for required in "${REQUIRED_PATHS[@]}"; do
        rm -rf "$INSTALL_DIR/$required"
        if [ -e "$BACKUP_DIR/$required" ]; then
          mkdir -p "$(dirname "$INSTALL_DIR/$required")"
          mv "$BACKUP_DIR/$required" "$INSTALL_DIR/$required"
        fi
      done
    fi
    rm -rf "$TMPDIR"
    exit "$status"
  }
  trap cleanup EXIT

  info "Downloading..."
  if [ -n "${CALLSMITH_ARCHIVE:-}" ]; then
    if [ ! -f "$CALLSMITH_ARCHIVE" ]; then
      err "CALLSMITH_ARCHIVE does not exist: $CALLSMITH_ARCHIVE"
      exit 1
    fi
    cp "$CALLSMITH_ARCHIVE" "$TMPDIR/callsmith.tar.gz"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "$TARBALL_URL" -o "$TMPDIR/callsmith.tar.gz"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TMPDIR/callsmith.tar.gz" "$TARBALL_URL"
  else
    err "Neither curl nor wget found. Install one and retry."
    exit 1
  fi

  tar -xzf "$TMPDIR/callsmith.tar.gz" -C "$TMPDIR"
  SRC_DIR=""
  for candidate in "$TMPDIR"/*; do
    [ -d "$candidate" ] || continue
    if [ -n "$SRC_DIR" ]; then
      err "Release archive is ambiguous: multiple top-level directories"
      exit 1
    fi
    SRC_DIR="$candidate"
  done
  if [ -z "$SRC_DIR" ]; then
    err "Release archive is incomplete: no top-level source directory"
    exit 1
  fi

  REQUIRED_PATHS=(
    bin
    src
    data
    providers
    reference
    examples
    package.json
    SKILL.md
    product_decisions.md
    product.md
    subtraction.md
  )
  STAGE_DIR="$TMPDIR/stage"
  mkdir -p "$STAGE_DIR"
  for required in "${REQUIRED_PATHS[@]}"; do
    if [ ! -e "$SRC_DIR/$required" ]; then
      err "Release archive is incomplete: missing $required"
      exit 1
    fi
    cp -R "$SRC_DIR/$required" "$STAGE_DIR/"
  done

  # Prove the staged product is internally complete before touching an existing
  # installation. This catches missing references and invalid provider packs.
  if ! node "$STAGE_DIR/bin/callsmith.mjs" doctor >/dev/null 2>&1; then
    err "Staged release failed doctor; existing installation was not changed."
    exit 1
  fi

  mkdir -p "$INSTALL_DIR" "$BACKUP_DIR"
  INSTALL_STARTED=1
  for required in "${REQUIRED_PATHS[@]}"; do
    if [ -e "$INSTALL_DIR/$required" ]; then
      mkdir -p "$(dirname "$BACKUP_DIR/$required")"
      mv "$INSTALL_DIR/$required" "$BACKUP_DIR/$required"
    fi
  done
  for required in "${REQUIRED_PATHS[@]}"; do
    mkdir -p "$(dirname "$INSTALL_DIR/$required")"
    mv "$STAGE_DIR/$required" "$INSTALL_DIR/$required"
  done
  INSTALL_STARTED=0
  rm -rf "$BACKUP_DIR"

  # Create a wrapper script
  mkdir -p "$BIN_DIR"
  WRAPPER="$BIN_DIR/$BINARY_NAME"
  cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/bin/callsmith.mjs" "\$@"
EOF
  chmod +x "$WRAPPER"

fi

# --- Verify ------------------------------------------------------------------
echo ""
CALLSMITH_BIN_PATH=""
if [ "${INSTALL_METHOD:-manual}" = "npm" ]; then
  if command -v callsmith >/dev/null 2>&1; then
    CALLSMITH_BIN_PATH="$(command -v callsmith)"
    bold "Installed:"
    callsmith --version 2>/dev/null || echo "  callsmith is on your PATH"
  else
    # npm global bin might not be on PATH yet
    NPM_BIN="$(npm config get prefix 2>/dev/null)/bin"
    CALLSMITH_BIN_PATH="$NPM_BIN/callsmith"
    bold "Installed to $NPM_BIN/callsmith"
    echo ""
    if ! echo "$PATH" | grep -q "$NPM_BIN"; then
      err "$NPM_BIN is not on your PATH."
      echo "  Add it to your shell profile:"
      echo "    export PATH=\"$NPM_BIN:\$PATH\""
    fi
  fi
else
  CALLSMITH_BIN_PATH="$WRAPPER"
  bold "Installed:"
  "$WRAPPER" --version 2>/dev/null || true
  echo ""
  if ! echo "$PATH" | grep -q "$BIN_DIR"; then
    err "$BIN_DIR is not on your PATH."
    echo "  Add it to your shell profile:"
    echo "    export PATH=\"$BIN_DIR:\$PATH\""
  fi
fi

# Require verification spine (doctor). Generation CLI (intake/init/forge) was removed.
if [ -n "$CALLSMITH_BIN_PATH" ] && [ -x "$CALLSMITH_BIN_PATH" ]; then
  if ! "$CALLSMITH_BIN_PATH" doctor >/dev/null 2>&1; then
    err "Installed callsmith failed doctor (need agent-compiler / 1.6+ verification CLI)."
    echo "  Re-run this installer, or:"
    echo "    npm install -g github:$REPO"
    echo "    # or from a checkout: node bin/callsmith.mjs doctor"
    exit 1
  fi
  info "Verified: callsmith doctor OK (pack validation spine)."
fi

echo ""
bold "Next:"
echo "  npx skills add Nachi-Kulkarni/Callsmith_skills   # primary: agent skill"
echo "  invoke /callsmith                                 # agent compiles the design"
echo "  callsmith doctor | packs | pack validate | check  # verification only"
echo ""
