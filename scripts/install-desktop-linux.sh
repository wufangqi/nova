#!/usr/bin/env bash
# Best-effort Linux install for Nova desktop (ADR-0004: Windows-first).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> System packages (sudo)"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential \
  curl \
  wget \
  file \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf \
  libssl-dev \
  libgtk-3-dev \
  libsoup-3.0-dev \
  libglib2.0-dev

echo "==> Node / TypeScript core"
npm install
npm run build
npm --prefix desktop install

echo "==> Tauri release binary (no Windows MSI/NSIS on Linux)"
# Prefer bare binary on Linux; Windows installers are configured in tauri.conf.json.
npm run build
npm --prefix desktop run build
(
  cd desktop/src-tauri
  cargo build --release
)

BIN="$ROOT/desktop/src-tauri/target/release/desktop"
if [[ -x "$BIN" ]]; then
  mkdir -p "$HOME/.local/bin"
  ln -sfn "$BIN" "$HOME/.local/bin/nova-desktop"
  echo
  echo "Installed symlink: $HOME/.local/bin/nova-desktop -> $BIN"
  echo "Ensure ~/.local/bin is on PATH, then run: nova-desktop"
  echo "Or from repo: npm run desktop:dev"
else
  echo "Build finished but binary not found at $BIN" >&2
  exit 1
fi
