#!/usr/bin/env bash
#
# callsmith — voice-agent recipe compiler
# One-liner installer:  curl -fsSL .../install-callsmith.sh | bash
#
set -euo pipefail

REPO="Nachi-Kulkarni/Callsmith_skills"
BRANCH="main"
INSTALL_DIR="${CALLSMITH_HOME:-$HOME/.callsmith}"
BIN_DIR="${CALLSMITH_BIN:-/usr/local/bin}"
BINARY_NAME="callsmith"

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
if command -v npm >/dev/null 2>&1; then
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
  trap 'rm -rf "$TMPDIR"' EXIT

  info "Downloading..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$TARBALL_URL" -o "$TMPDIR/callsmith.tar.gz"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TMPDIR/callsmith.tar.gz" "$TARBALL_URL"
  else
    err "Neither curl nor wget found. Install one and retry."
    exit 1
  fi

  tar -xzf "$TMPDIR/callsmith.tar.gz" -C "$TMPDIR"
  SRC_DIR="$TMPDIR/callsmith-$BRANCH"

  mkdir -p "$INSTALL_DIR"
  cp -r "$SRC_DIR/bin" "$SRC_DIR/src" "$SRC_DIR/data" "$SRC_DIR/providers" \
        "$SRC_DIR/package.json" "$SRC_DIR/SKILL.md" "$INSTALL_DIR/" 2>/dev/null || true

  # Create a wrapper script
  mkdir -p "$HOME/.local/bin"
  WRAPPER="$HOME/.local/bin/$BINARY_NAME"
  cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
exec node "$INSTALL_DIR/bin/callsmith.mjs" "\$@"
EOF
  chmod +x "$WRAPPER"

  BIN_DIR="$HOME/.local/bin"
fi

# --- Verify ------------------------------------------------------------------
echo ""
if [ "${INSTALL_METHOD:-manual}" = "npm" ]; then
  if command -v callsmith >/dev/null 2>&1; then
    bold "Installed:"
    callsmith --version 2>/dev/null || echo "  callsmith is on your PATH"
  else
    # npm global bin might not be on PATH yet
    NPM_BIN="$(npm config get prefix 2>/dev/null)/bin"
    bold "Installed to $NPM_BIN/callsmith"
    echo ""
    if ! echo "$PATH" | grep -q "$NPM_BIN"; then
      err "$NPM_BIN is not on your PATH."
      echo "  Add it to your shell profile:"
      echo "    export PATH=\"$NPM_BIN:\$PATH\""
    fi
  fi
else
  bold "Installed:"
  "$WRAPPER" --version 2>/dev/null || true
  echo ""
  if ! echo "$PATH" | grep -q "$BIN_DIR"; then
    err "$BIN_DIR is not on your PATH."
    echo "  Add it to your shell profile:"
    echo "    export PATH=\"$BIN_DIR:\$PATH\""
  fi
fi

echo ""
bold "Next:"
echo "  callsmith init          # create a starter voice-agent project"
echo "  callsmith spec          # interactive intake quiz"
echo ""
