#!/usr/bin/env bash
set -euo pipefail

# Full desktop build pipeline:
#   1. Stage all bundled artifacts into apps/desktop/resources/
#      (API, web static export, Python CLI + venv + interpreter, prisma)
#   2. Package Electron + create installers via Forge
#
# Prefer `make` in apps/desktop for day-to-day use; this script is what
# `make all` runs. See scripts/stage-resources.sh for SKIP_* env toggles.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

bash "$SCRIPT_DIR/stage-resources.sh"

echo "=== Package Electron ==="
cd "$DESKTOP_DIR"
bun run make

echo "=== Done ==="
echo "Installers are in $DESKTOP_DIR/out/make/"
