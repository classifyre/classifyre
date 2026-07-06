#!/usr/bin/env bash
set -euo pipefail

# Stages everything the desktop app bundles into apps/desktop/resources/.
# Single source of truth used by both the local build (Makefile /
# build-desktop.sh) and the GitHub Actions release workflow.
#
# Layout produced:
#   resources/api/     — esbuild single-file bundle (backend.js) + minimal
#                        external node_modules (Prisma client/engines, prisma
#                        CLI, NestJS framework — see scripts/bundle-api.mjs)
#   resources/web/     — Next.js static export
#   resources/pg/      — embedded-postgres npm tree (main app loads it from here)
#   resources/pyapp/   — Python CLI (apps/cli) + schemas (packages/schemas),
#                        preserving the monorepo-relative editable-dep layout
#   resources/python/  — standalone CPython (python-build-standalone via uv)
#   resources/venv/    — pre-baked BASE venv (optional groups install on demand)
#   resources/prisma/  — Prisma schema + migrations
#
# Env toggles:
#   SKIP_APP_BUILD=1  — skip rebuilding API/web (reuse existing dist/out)
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

# Native node.exe/prisma on Windows misread git-bash POSIX paths ("/d/a/...")
# as drive-relative ("D:\d\a\..."), so the inline `node -e` staging scripts
# below must be handed mixed-mode paths ("D:/a/..."). MSYS tools (cp/npm/bash)
# accept POSIX paths fine, so only the node-facing variants are converted.
to_node_path() {
  if [ "$IS_WINDOWS" = "1" ]; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}
MONOREPO_ROOT_NODE="$(to_node_path "$MONOREPO_ROOT")"
RESOURCES_NODE="$(to_node_path "$RESOURCES")"

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
mkdir -p "$RESOURCES"/{api,web}

# --- API: esbuild single-file bundle + minimal external install ---------------
# The compiled dist/ + a full production node_modules is ~65k files / 768 MB —
# 92% of the desktop bundle's file count. Instead we bundle the tsc OUTPUT
# (apps/api/dist, which carries the decorator metadata Nest DI needs and esbuild
# cannot re-emit) into a single backend.js with scripts/bundle-api.mjs, and
# install ONLY the packages that must stay real files on disk (see that script's
# `external` list: Prisma client+engines, the prisma CLI, the NestJS framework,
# fastify, rxjs, class-transformer/validator, pg, natural, socket.io, swagger's
# static assets). Everything else is inlined into backend.js.
echo "Bundling API into backend.js (esbuild)…"
API_MAIN_NODE="$(to_node_path "$MONOREPO_ROOT/apps/api/dist/src/main.js")"
BACKEND_OUT_NODE="$(to_node_path "$RESOURCES/api/backend.js")"
(cd "$DESKTOP_DIR" && node scripts/bundle-api.mjs "$API_MAIN_NODE" "$BACKEND_OUT_NODE")

echo "Installing API external dependencies (standalone npm install)…"
# Only the externalized framework layer is installed as real files; every other
# dependency is inlined into backend.js. KEEP must stay in sync with the
# `external` list in scripts/bundle-api.mjs. `prisma` (the migrate-deploy CLI)
# and @prisma/client-runtime-utils live in devDependencies upstream, so we merge
# both dep maps when resolving versions. @workspace/schemas is vendored below;
# @kubernetes/client-node and @opentelemetry/* are intentionally omitted (lazy /
# stubbed on desktop).
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$MONOREPO_ROOT_NODE/apps/api/package.json', 'utf8'));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const KEEP = [
    '@nestjs/common', '@nestjs/core', '@nestjs/platform-express',
    '@nestjs/platform-fastify', '@nestjs/platform-socket.io', '@nestjs/swagger',
    '@nestjs/websockets',
    '@fastify/multipart', '@fastify/static', '@fastify/under-pressure',
    '@prisma/adapter-pg', '@prisma/client', '@prisma/client-runtime-utils',
    'class-transformer', 'class-validator', 'fastify', 'pg',
    'reflect-metadata', 'rxjs', 'socket.io', 'prisma',
  ];
  const dependencies = {};
  for (const name of KEEP) {
    const v = allDeps[name];
    if (!v) throw new Error('KEEP dep missing from apps/api/package.json: ' + name);
    dependencies[name] = v;
  }
  const out = { name: pkg.name, version: pkg.version, private: true, dependencies };
  fs.writeFileSync('$RESOURCES_NODE/api/package.json', JSON.stringify(out, null, 2));
"
(cd "$RESOURCES/api" && npm install --omit=dev --no-audit --no-fund --loglevel=error)

# @workspace/schemas is compiled into backend.js by esbuild (not external), so
# no vendoring is needed here. The JSON schema files that package also ships are
# resolved at runtime by filesystem path (apps/api utils/schema-path.ts), which
# walks up to packages/schemas — independent of node_modules.

# Generate the Prisma client into the staged tree for this platform. The
# schema must sit inside resources/api so prisma resolves the staged
# node_modules for the generated client output.
echo "Generating Prisma client in staged tree…"
cp -R "$MONOREPO_ROOT/apps/api/prisma" "$RESOURCES/api/prisma"
# Prisma 7 requires datasource.url via prisma.config.ts for `migrate deploy`
# (the runtime migration step) — without it the packaged app fails to open any
# workspace with "The datasource.url property is required".
cp "$MONOREPO_ROOT/apps/api/prisma.config.ts" "$RESOURCES/api/prisma.config.ts"
# Run from the staged api dir with a relative --schema so native prisma on
# Windows doesn't misread a POSIX absolute path.
(cd "$RESOURCES/api" && node node_modules/prisma/build/index.js generate \
  --schema prisma/schema.prisma)

# Sanity checks: the bundle, migration CLI, client + vendored schemas must all
# be present/loadable. `node --check` parses backend.js without executing it
# (a full require would boot Nest and connect to a database).
[ -f "$RESOURCES/api/backend.js" ] || { echo "backend.js missing in staged tree" >&2; exit 1; }
[ -f "$RESOURCES/api/node_modules/prisma/build/index.js" ] || { echo "prisma CLI missing in staged tree" >&2; exit 1; }
node --check "$RESOURCES/api/backend.js" || { echo "backend.js failed to parse" >&2; exit 1; }
node -e "
  require('$RESOURCES_NODE/api/node_modules/@prisma/client/package.json');
  require('$RESOURCES_NODE/api/node_modules/@nestjs/core/package.json');
  console.log('Staged API tree sanity checks passed.');
"

# --- Embedded PostgreSQL runtime ----------------------------------------------
# The Electron Forge Vite plugin packages ONLY .vite/build + package.json into
# app.asar — the app's node_modules never ship. `embedded-postgres` is
# externalized in vite.main.config.ts (it wraps native PG binaries), so in a
# packaged app it must be loaded from a staged tree instead. A real npm install
# (not bun's symlinked store) produces a self-contained tree, installs only the
# platform-matching @embedded-postgres/* package, and runs its postinstall
# (hydrate-symlinks.js), which restores the SONAME symlinks npm-pack strips.
echo "=== Stage embedded PostgreSQL node modules ==="
mkdir -p "$RESOURCES/pg"
node -e "
  const fs = require('fs');
  const desktopPkg = JSON.parse(fs.readFileSync('$(to_node_path "$DESKTOP_DIR")/package.json', 'utf8'));
  const pkg = {
    name: 'classifyre-desktop-pg',
    private: true,
    dependencies: { 'embedded-postgres': desktopPkg.dependencies['embedded-postgres'] },
  };
  fs.writeFileSync('$RESOURCES_NODE/pg/package.json', JSON.stringify(pkg, null, 2));
"
(cd "$RESOURCES/pg" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
node -e "
  const { pathToFileURL } = require('url');
  import(pathToFileURL('$RESOURCES_NODE/pg/node_modules/embedded-postgres/dist/index.js').href)
    .then((m) => {
      if (typeof m.default !== 'function') throw new Error('unexpected export shape');
      console.log('Staged embedded-postgres tree loads OK.');
    })
    .catch((err) => { console.error('Staged embedded-postgres tree is broken:', err); process.exit(1); });
"

# --- Web static export --------------------------------------------------------
if [ ! -d "$MONOREPO_ROOT/apps/web/out" ]; then
  echo "apps/web/out missing — run without SKIP_APP_BUILD or build web first" >&2
  exit 1
fi
cp -R "$MONOREPO_ROOT/apps/web/out/." "$RESOURCES/web/"

# --- Python CLI source ----------------------------------------------------------
# Staged as pyapp/apps/cli + pyapp/packages/schemas so the CLI pyproject's
# editable path dependency (classifyre-schemas = ../../packages/schemas) keeps
# the exact relative layout uv.lock was resolved against. Runtime `uv sync`
# (on-demand optional groups) re-verifies the whole project, so that path must
# exist inside the bundle.
CLI_DEST="$RESOURCES/pyapp/apps/cli"
SCHEMAS_PY_DEST="$RESOURCES/pyapp/packages/schemas"
mkdir -p "$CLI_DEST" "$SCHEMAS_PY_DEST"
cp -R "$MONOREPO_ROOT/apps/cli/src" "$CLI_DEST/src"
cp "$MONOREPO_ROOT/apps/cli/pyproject.toml" "$CLI_DEST/pyproject.toml"
cp "$MONOREPO_ROOT/apps/cli/uv.lock" "$CLI_DEST/uv.lock"
cp "$MONOREPO_ROOT/apps/cli/README.md" "$CLI_DEST/README.md" 2>/dev/null || true
cp -R "$MONOREPO_ROOT/packages/schemas/src" "$SCHEMAS_PY_DEST/src"
cp "$MONOREPO_ROOT/packages/schemas/pyproject.toml" "$SCHEMAS_PY_DEST/pyproject.toml"
cp "$MONOREPO_ROOT/packages/schemas/uv.lock" "$SCHEMAS_PY_DEST/uv.lock" 2>/dev/null || true
cp "$MONOREPO_ROOT/packages/schemas/README.md" "$SCHEMAS_PY_DEST/README.md" 2>/dev/null || true

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

  # Only the BASE dependencies are baked. Optional detector/source groups
  # (torch, presidio, transformers, … — multiple GB) install on demand at
  # runtime through the CLI's uv_sync machinery, exactly like the server
  # deployment; baking them all made the installers ~800 MB-1 GB compressed.
  # --no-dev drops ruff/mypy/pytest, which have no place in a shipped venv.
  # UV_PROJECT_ENVIRONMENT redirects the sync target — `uv sync --python`
  # alone only selects the interpreter version and would sync .venv instead.
  UV_PROJECT_ENVIRONMENT=.venv-desktop uv sync --frozen --no-dev

  # Bundle the uv binary inside the venv so it lands on PATH at runtime: the API
  # spawns the CLI via `uv run`, and optional groups self-install via `uv sync`.
  # The build host's arch matches this per-platform bundle, so its uv is correct.
  # Windows venvs use Scripts/ (and a .exe); POSIX venvs use bin/.
  if [ "$IS_WINDOWS" = "1" ]; then
    cp "$(command -v uv)" ".venv-desktop/Scripts/uv.exe"
  else
    cp "$(command -v uv)" ".venv-desktop/bin/uv"
    chmod +x ".venv-desktop/bin/uv"
  fi

  # No optional groups are baked, so uv_sync.py's group-accumulation state
  # starts empty — the first runtime `uv sync --group X` installs exactly that
  # group on top of the base deps and records it.
  cp -R "$MONOREPO_ROOT/apps/cli/.venv-desktop" "$RESOURCES/venv"

  # codesign rejects symlinks whose destination is an absolute build-machine
  # path ("invalid destination for symbolic link in bundle"), which breaks the
  # macOS signature seal. The venv's bin/python* point at the standalone CPython
  # by absolute path, so rewrite them to bundle-relative links: inside the .app
  # both live under Contents/Resources (venv/ and python/), so venv/bin/python3
  # -> ../../python/bin/python3 resolves within the sealed bundle. (Windows venvs
  # ship a real python.exe, not symlinks, so this no-ops there.) python-env.ts
  # still re-points these at runtime after the read-only-bundle relocation.
  VENV_BIN="$RESOURCES/venv/bin"
  if [ -L "$VENV_BIN/python3" ] || [ -L "$VENV_BIN/python" ]; then
    ln -sf ../../python/bin/python3 "$VENV_BIN/python3"
    ln -sf python3 "$VENV_BIN/python"
    for alias in "$VENV_BIN"/python3.*; do
      [ -L "$alias" ] && ln -sf python3 "$alias"
    done
    echo "Rewrote venv python symlinks to bundle-relative paths for codesign"
  fi

  # A populated base venv (spacy + en_core_web_sm + lxml + pydantic…) is well
  # over 50MB; an empty scaffold (<10MB) means the sync silently missed the
  # target env. Fail loudly rather than ship broken.
  VENV_SIZE_KB="$(du -sk "$RESOURCES/venv" | cut -f1)"
  if [ "$VENV_SIZE_KB" -lt 51200 ]; then
    echo "Staged venv is only ${VENV_SIZE_KB}KB — uv sync did not populate it" >&2
    exit 1
  fi
fi

# --- macOS: sign the API's Mach-O binaries, then collapse into one archive ----
# Even after esbuild bundling, the external node_modules (Prisma engines, the
# NestJS framework, rxjs, …) is a few thousand small files. Apple's notary
# service scans per file (and codesign walks the same tree), so we still ship
# the API as ONE tar.gz to keep the notarized payload small; the app extracts it
# to userData on first workspace open (same pattern as the Python runtime
# relocation). Linux/Windows keep the plain directory — they have no
# notarization step and extraction would only cost disk and first-run time.
#
# The notary service DOES recurse into api.tar.gz, so any Mach-O inside it must
# already carry a valid Developer ID signature with the hardened runtime and a
# secure timestamp — otherwise notarization returns Invalid ("binary is not
# signed with a valid Developer ID certificate"). @electron/osx-sign only walks
# the .app bundle; it never opens this tarball, so we sign the inner binaries
# here, before packing. The Prisma query-engine .node is loaded by the API at
# runtime — signing it with the SAME Developer ID (same Team ID) as the app also
# satisfies library validation under the hardened runtime.
if [ "$(uname -s)" = "Darwin" ]; then
  if [ "${MACOS_SIGN:-0}" = "1" ]; then
    echo "=== Sign Mach-O binaries in resources/api (Developer ID + hardened runtime) ==="
    IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
    if [ -z "$IDENTITY" ]; then
      IDENTITY="$(security find-identity -v -p codesigning \
        | grep -m1 'Developer ID Application' \
        | sed -E 's/.*"(.*)".*/\1/')"
    fi
    [ -n "$IDENTITY" ] || { echo "No 'Developer ID Application' identity in keychain" >&2; exit 1; }
    echo "Signing identity: $IDENTITY"
    signed=0
    while IFS= read -r f; do
      # Only Mach-O objects need signing; skip scripts, JSON, JS, etc.
      case "$(file -b "$f")" in
        Mach-O*)
          codesign --force --options runtime --timestamp \
            --sign "$IDENTITY" "$f"
          signed=$((signed + 1))
          ;;
      esac
    done < <(find "$RESOURCES/api" -type f)
    echo "Signed $signed Mach-O binaries under resources/api"
    [ "$signed" -gt 0 ] || echo "::warning::No Mach-O binaries found under resources/api to sign"
  else
    echo "MACOS_SIGN != 1 — skipping inner API binary signing (unsigned build)"
  fi

  echo "=== Pack resources/api into api.tar.gz (macOS notarization) ==="
  tar -czf "$RESOURCES/api.tar.gz" -C "$RESOURCES" api
  rm -rf "$RESOURCES/api"
  du -sh "$RESOURCES/api.tar.gz"
fi

echo "=== Resources staged ==="
du -sh "$RESOURCES"/* 2>/dev/null || true
