#!/usr/bin/env bash
set -euo pipefail

# Build Next.js in static export mode for Electron desktop.
# Temporarily excludes server-side proxy routes that are incompatible with
# output: 'export' (they use runtime: "nodejs" + dynamic: "force-dynamic").

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WEB_DIR="$MONOREPO_ROOT/apps/web"

PROXY_ROUTES=(
  "app/api/[...path]/route.ts"
  "app/classifyre-usr/[...path]/route.ts"
)

cleanup() {
  echo "[desktop-web-build] Restoring proxy routes…"
  for route in "${PROXY_ROUTES[@]}"; do
    local bak="$WEB_DIR/$route.desktop-bak"
    if [ -f "$bak" ]; then
      mv "$bak" "$WEB_DIR/$route"
    fi
  done
}

trap cleanup EXIT

echo "[desktop-web-build] Temporarily excluding proxy routes…"
for route in "${PROXY_ROUTES[@]}"; do
  src="$WEB_DIR/$route"
  if [ -f "$src" ]; then
    mv "$src" "$src.desktop-bak"
  fi
done

echo "[desktop-web-build] Building Next.js with DESKTOP_BUILD=true…"
cd "$WEB_DIR"
DESKTOP_BUILD=true bun run build

echo "[desktop-web-build] Done. Output in $WEB_DIR/out/"
