#!/usr/bin/env bash
# Start ShellForge in development: build sidecar daemon, install next to the app
# binary, then run Tauri dev (Vite + Rust backend).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

log() {
  printf '\033[1;36m[start_dev]\033[0m %s\n' "$*"
}

die() {
  printf '\033[1;31m[start_dev]\033[0m %s\n' "$*" >&2
  exit 1
}

# Node 20 (project standard; Cursor shell may not load nvm by default).
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || true
fi
if [[ -d "$HOME/.nvm/versions/node/v20.20.2/bin" ]]; then
  export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
fi

command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 20 (nvm use 20)."
command -v cargo >/dev/null 2>&1 || die "Rust/cargo not found."
command -v npm >/dev/null 2>&1 || die "npm not found."

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  die "Node $(node -v) is too old; use Node 20 (nvm use 20)."
fi

if [[ ! -d node_modules ]]; then
  log "Installing frontend dependencies..."
  npm ci
fi

DAEMON_DIR="$ROOT/src-daemon"
HOST_TRIPLE="$(rustc --print host-tuple)"
BINARIES_DIR="$ROOT/src-tauri/binaries"
SIDEcar_BIN="$BINARIES_DIR/shellforge-daemon-$HOST_TRIPLE"

log "Building shellforge-daemon (debug)..."
cargo build --manifest-path "$DAEMON_DIR/Cargo.toml"

mkdir -p "$BINARIES_DIR"
cp -f "$DAEMON_DIR/target/debug/shellforge-daemon" "$SIDEcar_BIN"
chmod +x "$SIDEcar_BIN"
log "Installed daemon sidecar at $SIDEcar_BIN"

log "Starting Tauri dev (Ctrl+C to stop)..."
exec npm run tauri:dev
