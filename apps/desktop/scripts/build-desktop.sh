#!/usr/bin/env bash
set -euo pipefail

# Full desktop build pipeline:
# 1. Build monorepo packages + API
# 2. Build Next.js as static export (desktop mode)
# 3. Pre-bake fat Python venv
# 4. Stage all artifacts into apps/desktop/resources/
# 5. Package Electron via Forge

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONOREPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

RESOURCES="$DESKTOP_DIR/resources"

echo "=== Step 1: Build monorepo packages + API ==="
cd "$MONOREPO_ROOT"
bun run --filter=@classifyre/api build

echo "=== Step 2: Build Next.js (static export) ==="
bash "$SCRIPT_DIR/desktop-web-build.sh"

echo "=== Step 3: Pre-bake Python venv ==="
cd "$MONOREPO_ROOT/apps/cli"
if [ ! -d ".venv-desktop" ]; then
  uv venv .venv-desktop
fi
uv sync --python .venv-desktop/bin/python --frozen --all-groups

echo "=== Step 4: Stage artifacts into resources/ ==="
rm -rf "$RESOURCES"
mkdir -p "$RESOURCES"/{api,web,cli,venv,prisma}

# API dist + node_modules
cp -r "$MONOREPO_ROOT/apps/api/dist" "$RESOURCES/api/dist"
cp -r "$MONOREPO_ROOT/apps/api/node_modules" "$RESOURCES/api/node_modules"
cp "$MONOREPO_ROOT/apps/api/package.json" "$RESOURCES/api/package.json"

# Prisma schema + migrations
cp -r "$MONOREPO_ROOT/apps/api/prisma" "$RESOURCES/prisma"

# Next.js static export
cp -r "$MONOREPO_ROOT/apps/web/out" "$RESOURCES/web/"

# Python CLI source
cp -r "$MONOREPO_ROOT/apps/cli/src" "$RESOURCES/cli/src"
cp "$MONOREPO_ROOT/apps/cli/pyproject.toml" "$RESOURCES/cli/pyproject.toml"
cp "$MONOREPO_ROOT/apps/cli/uv.lock" "$RESOURCES/cli/uv.lock"

# Pre-baked venv
cp -r "$MONOREPO_ROOT/apps/cli/.venv-desktop" "$RESOURCES/venv"

echo "=== Step 5: Package Electron ==="
cd "$DESKTOP_DIR"
bun run make

echo "=== Done ==="
echo "Installers are in $DESKTOP_DIR/out/"
