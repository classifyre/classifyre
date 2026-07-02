#!/usr/bin/env bash
set -euo pipefail

# Stages everything the desktop app bundles into apps/desktop/resources/.
# Single source of truth used by both the local build (Makefile /
# build-desktop.sh) and the GitHub Actions release workflow.
#
# Layout produced:
#   resources/api/     — compiled NestJS API + production node_modules (incl. prisma CLI)
#   resources/web/     — Next.js static export
#   resources/cli/     — Python CLI source + pyproject/uv.lock
#   resources/python/  — standalone CPython (python-build-standalone via uv)
#   resources/venv/    — pre-baked venv (re-pointed at first app launch)
#   resources/prisma/  — Prisma schema + migrations
#   resources/jre/     — jlink-minimized Corretto runtime for pyspark
#
# Env toggles:
#   SKIP_APP_BUILD=1  — skip rebuilding API/web (reuse existing dist/out)
#   SKIP_JRE=1        — skip Java download/jlink (dev iteration)
#   SKIP_PYTHON=1     — skip Python/venv baking (dev iteration)
#   PYTHON_VERSION    — standalone CPython version (default 3.12)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MONOREPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"
RESOURCES="$DESKTOP_DIR/resources"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
  *)                    IS_WINDOWS=0 ;;
esac

if [ "${SKIP_APP_BUILD:-0}" != "1" ]; then
  echo "=== Build API (incl. prisma generate) ==="
  cd "$MONOREPO_ROOT"
  bun run --cwd apps/api prisma:generate
  bun run --filter=@classifyre/api build

  echo "=== Build Next.js (static export) ==="
  bash "$SCRIPT_DIR/desktop-web-build.sh"
fi

echo "=== Stage artifacts into resources/ ==="
rm -rf "$RESOURCES"
mkdir -p "$RESOURCES"/{api,web,cli}

# --- API: dist + standalone production install --------------------------------
# The monorepo uses bun's isolated (pnpm-style) store: apps/api/node_modules
# only holds symlinks to direct deps, and transitive deps resolve through the
# repo root. Copying that tree produces a broken bundle. Instead we do a real
# production install into the staged directory so the tree is complete and
# self-contained.
cp -R "$MONOREPO_ROOT/apps/api/dist" "$RESOURCES/api/dist"

echo "Installing API production dependencies (standalone npm install)…"
# `prisma` must be a production dep here: the app runs `prisma migrate deploy`
# from this tree at runtime. @workspace/schemas is vendored below instead.
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$MONOREPO_ROOT/apps/api/package.json', 'utf8'));
  const prismaVersion = (pkg.devDependencies && pkg.devDependencies.prisma) || pkg.dependencies.prisma;
  delete pkg.dependencies['@workspace/schemas'];
  pkg.dependencies.prisma = prismaVersion;
  delete pkg.devDependencies;
  delete pkg.scripts;
  fs.writeFileSync('$RESOURCES/api/package.json', JSON.stringify(pkg, null, 2));
"
(cd "$RESOURCES/api" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

# Vendor @workspace/schemas as plain CommonJS. Its published form exports .ts
# files (fine in dev where Node's type stripping applies, but stripping is
# disabled for files inside node_modules), so we compile it for the bundle.
echo "Vendoring @workspace/schemas (compiled to CommonJS)…"
SCHEMAS_DEST="$RESOURCES/api/node_modules/@workspace/schemas"
mkdir -p "$SCHEMAS_DEST"
(cd "$MONOREPO_ROOT/packages/schemas" && bun x tsc src/*.ts \
  --outDir "$SCHEMAS_DEST/src" \
  --module commonjs --target es2022 --moduleResolution node \
  --esModuleInterop --resolveJsonModule --skipLibCheck --noCheck \
  --declaration false)
mkdir -p "$SCHEMAS_DEST/src/schemas"
cp -R "$MONOREPO_ROOT/packages/schemas/src/schemas/." "$SCHEMAS_DEST/src/schemas/"
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$MONOREPO_ROOT/packages/schemas/package.json', 'utf8'));
  pkg.type = 'commonjs';
  for (const key of Object.keys(pkg.exports || {})) {
    if (typeof pkg.exports[key] === 'string') {
      pkg.exports[key] = pkg.exports[key].replace(/\.ts$/, '.js');
    }
  }
  fs.writeFileSync('$SCHEMAS_DEST/package.json', JSON.stringify(pkg, null, 2));
"

# Generate the Prisma client into the staged tree for this platform. The
# schema must sit inside resources/api so prisma resolves the staged
# node_modules for the generated client output.
echo "Generating Prisma client in staged tree…"
cp -R "$MONOREPO_ROOT/apps/api/prisma" "$RESOURCES/api/prisma"
(cd "$RESOURCES/api" && node node_modules/prisma/build/index.js generate \
  --schema "$RESOURCES/api/prisma/schema.prisma")

# Sanity checks: migration CLI + client + vendored schemas must be loadable.
[ -f "$RESOURCES/api/node_modules/prisma/build/index.js" ] || { echo "prisma CLI missing in staged tree" >&2; exit 1; }
node -e "
  require('$RESOURCES/api/node_modules/@workspace/schemas/src/assistant.js');
  require('$RESOURCES/api/node_modules/@prisma/client/package.json');
  console.log('Staged API tree sanity checks passed.');
"

# --- Web static export --------------------------------------------------------
if [ ! -d "$MONOREPO_ROOT/apps/web/out" ]; then
  echo "apps/web/out missing — run without SKIP_APP_BUILD or build web first" >&2
  exit 1
fi
cp -R "$MONOREPO_ROOT/apps/web/out/." "$RESOURCES/web/"

# --- Python CLI source ----------------------------------------------------------
cp -R "$MONOREPO_ROOT/apps/cli/src" "$RESOURCES/cli/src"
cp "$MONOREPO_ROOT/apps/cli/pyproject.toml" "$RESOURCES/cli/pyproject.toml"
cp "$MONOREPO_ROOT/apps/cli/uv.lock" "$RESOURCES/cli/uv.lock"

# --- Standalone CPython + pre-baked venv --------------------------------------
if [ "${SKIP_PYTHON:-0}" != "1" ]; then
  echo "=== Bundle standalone CPython $PYTHON_VERSION ==="
  command -v uv >/dev/null || { echo "uv is required (https://docs.astral.sh/uv/)" >&2; exit 1; }

  PY_TMP="$DESKTOP_DIR/.python-dist"
  rm -rf "$PY_TMP"
  uv python install "$PYTHON_VERSION" --install-dir "$PY_TMP"
  PY_HOME="$(find "$PY_TMP" -mindepth 1 -maxdepth 1 -type d -name 'cpython-*' | head -1)"
  [ -n "$PY_HOME" ] || { echo "Standalone CPython not found under $PY_TMP" >&2; exit 1; }
  mkdir -p "$RESOURCES/python"
  cp -R "$PY_HOME/." "$RESOURCES/python/"
  rm -rf "$PY_TMP"

  if [ "$IS_WINDOWS" = "1" ]; then
    PY_BIN="$RESOURCES/python/python.exe"
  else
    PY_BIN="$RESOURCES/python/bin/python3"
  fi
  "$PY_BIN" --version

  echo "=== Pre-bake Python venv ==="
  cd "$MONOREPO_ROOT/apps/cli"
  rm -rf .venv-desktop
  uv venv --python "$PY_BIN" .venv-desktop
  # UV_PROJECT_ENVIRONMENT redirects the sync target — `uv sync --python`
  # alone only selects the interpreter version and would sync .venv instead.
  UV_PROJECT_ENVIRONMENT=.venv-desktop uv sync --frozen --all-groups
  cp -R "$MONOREPO_ROOT/apps/cli/.venv-desktop" "$RESOURCES/venv"

  # A pyspark-capable venv is >1GB; an empty scaffold means the sync silently
  # missed the target env. Fail loudly instead of shipping a broken bundle.
  VENV_SIZE_KB="$(du -sk "$RESOURCES/venv" | cut -f1)"
  if [ "$VENV_SIZE_KB" -lt 102400 ]; then
    echo "Staged venv is only ${VENV_SIZE_KB}KB — uv sync did not populate it" >&2
    exit 1
  fi
fi

# --- Minimized JRE --------------------------------------------------------------
if [ "${SKIP_JRE:-0}" != "1" ]; then
  echo "=== Bundle minimized JRE ==="
  bash "$SCRIPT_DIR/fetch-jre.sh" "$RESOURCES/jre"
fi

echo "=== Resources staged ==="
du -sh "$RESOURCES"/* 2>/dev/null || true
