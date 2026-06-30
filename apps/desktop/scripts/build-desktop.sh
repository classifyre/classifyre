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
mkdir -p "$RESOURCES"/{api,web,cli,venv,prisma,jre}

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

# Bundle Amazon Corretto JDK for the Spark-backed lakehouse sources (pyspark).
# Downloaded for the current host OS/arch; normalized so resources/jre/bin/java
# exists on every platform. Java 21 is the latest LTS certified for Spark 4.x.
JAVA_VERSION="${JAVA_VERSION:-21}"
case "$(uname -m)" in
  x86_64|amd64) JARCH=x64 ;;
  arm64|aarch64) JARCH=aarch64 ;;
  *) echo "Unsupported arch $(uname -m) for JRE bundling" && exit 1 ;;
esac
case "$(uname -s)" in
  Darwin) JOS=macos ;;
  Linux) JOS=linux ;;
  *) echo "Unsupported OS $(uname -s) for JRE bundling (build Windows separately)" && exit 1 ;;
esac
JRE_TMP="$(mktemp -d)"
JRE_URL="https://corretto.aws/downloads/latest/amazon-corretto-${JAVA_VERSION}-${JARCH}-${JOS}-jdk.tar.gz"
echo "Downloading Corretto: $JRE_URL"
curl -fsSL "$JRE_URL" -o "$JRE_TMP/corretto.tar.gz"
tar -xzf "$JRE_TMP/corretto.tar.gz" -C "$JRE_TMP"
if [ "$JOS" = "macos" ]; then
  JHOME="$(find "$JRE_TMP" -maxdepth 4 -type d -path '*/Contents/Home' | head -1)"
else
  JHOME="$(find "$JRE_TMP" -mindepth 1 -maxdepth 1 -type d -name 'amazon-corretto-*' | head -1)"
fi
[ -n "$JHOME" ] || { echo "Could not locate extracted Corretto home" && exit 1; }
cp -R "$JHOME"/. "$RESOURCES/jre/"
"$RESOURCES/jre/bin/java" -version
rm -rf "$JRE_TMP"

echo "=== Step 5: Package Electron ==="
cd "$DESKTOP_DIR"
bun run make

echo "=== Done ==="
echo "Installers are in $DESKTOP_DIR/out/"
