#!/usr/bin/env bash
set -euo pipefail

# Build Next.js in static export mode for Electron desktop.
# Temporarily excludes routes incompatible with output: 'export':
# - Server-side proxy routes (runtime: "nodejs" + dynamic: "force-dynamic")
#
# Dynamic [id] pages ARE exported: each declares generateStaticParams() (a single
# "__id__" placeholder shell, see apps/web/lib/dynamic-route.ts) and the Electron
# protocol handler serves that shell for any real id, with the page recovering
# the real id from the URL via useRouteId(). They must therefore NOT be excluded
# here — dropping them is what previously made every detail page redirect home.

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

# Proxy routes: catch-all [...path] route handlers that proxy to the API at
# runtime. These are genuinely incompatible with a static export (no server), so
# they stay excluded. Any dynamic *page* under a [param] dir must instead provide
# generateStaticParams (see the header note) rather than be excluded here.
backup_file "$WEB_DIR/app/api/[...path]/route.ts"
backup_file "$WEB_DIR/app/classifyre-usr/[...path]/route.ts"

# Guard: fail loudly if a dynamic [param] *page* is not covered by a
# generateStaticParams() somewhere in its segment — the page itself or, more
# usually, an ancestor layout (a "use client" page cannot export it). Without
# coverage the static export drops the route and it silently redirects to home.
has_static_params() {
  local file="$1"
  grep -q 'generateStaticParams' "$file" && return 0
  local dir; dir="$(dirname "$file")"
  while [ "$dir" != "$WEB_DIR/app" ] && [ "$dir" != "/" ]; do
    for ext in tsx ts jsx js; do
      if [ -f "$dir/layout.$ext" ] && grep -q 'generateStaticParams' "$dir/layout.$ext"; then
        return 0
      fi
    done
    dir="$(dirname "$dir")"
  done
  return 1
}
missing=()
while IFS= read -r -d '' file; do
  has_static_params "$file" || missing+=("${file#"$WEB_DIR"/}")
done < <(find "$WEB_DIR/app" -path '*\[*\]*' \( -name 'page.tsx' -o -name 'page.ts' -o -name 'page.jsx' -o -name 'page.js' \) -print0)
if [ "${#missing[@]}" -gt 0 ]; then
  echo "[desktop-web-build] ERROR: dynamic page(s) not covered by generateStaticParams():" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo "[desktop-web-build] Add to the [id] layout: export function generateStaticParams() { return dynamicIdParams(); }" >&2
  exit 1
fi

echo "[desktop-web-build] Building Next.js with DESKTOP_BUILD=true…"
cd "$WEB_DIR"
DESKTOP_BUILD=true bun run build

echo "[desktop-web-build] Done. Output in $WEB_DIR/out/"
