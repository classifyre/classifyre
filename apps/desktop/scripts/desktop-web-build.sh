#!/usr/bin/env bash
set -euo pipefail

# Build Next.js in static export mode for Electron desktop.
# Temporarily excludes routes incompatible with output: 'export':
# - Server-side proxy routes (runtime: "nodejs" + dynamic: "force-dynamic")
# - Dynamic [param] routes without generateStaticParams()

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WEB_DIR="$MONOREPO_ROOT/apps/web"

BACKED_UP_FILES=()

backup_file() {
  local src="$1"
  if [ -f "$src" ]; then
    mv "$src" "$src.desktop-bak"
    BACKED_UP_FILES+=("$src")
    echo "[desktop-web-build]   excluded: ${src#$WEB_DIR/}"
  fi
}

cleanup() {
  echo "[desktop-web-build] Restoring excluded files…"
  for src in "${BACKED_UP_FILES[@]}"; do
    if [ -f "$src.desktop-bak" ]; then
      mv "$src.desktop-bak" "$src"
    fi
  done
}

trap cleanup EXIT

echo "[desktop-web-build] Excluding incompatible routes…"

# Proxy routes
backup_file "$WEB_DIR/app/api/[...path]/route.ts"
backup_file "$WEB_DIR/app/classifyre-usr/[...path]/route.ts"

# Dynamic [param] routes that lack generateStaticParams — find all page/layout
# files anywhere under a [param] directory and exclude them.
while IFS= read -r -d '' file; do
  backup_file "$file"
done < <(find "$WEB_DIR/app" -path '*\[*\]*' \( -name 'page.tsx' -o -name 'page.ts' -o -name 'page.jsx' -o -name 'page.js' -o -name 'layout.tsx' -o -name 'layout.ts' \) -print0)

echo "[desktop-web-build] Building Next.js with DESKTOP_BUILD=true…"
cd "$WEB_DIR"
DESKTOP_BUILD=true bun run build

echo "[desktop-web-build] Done. Output in $WEB_DIR/out/"
