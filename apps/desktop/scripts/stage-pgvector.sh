#!/usr/bin/env bash
set -euo pipefail

# Build pgvector against PostgreSQL 18 development headers, then copy only the
# extension runtime into the embedded-postgres package. PGVECTOR_SOURCE_DIR can
# point at a pre-fetched checkout for offline/reproducible builds.
PG_STAGE="${1:?usage: stage-pgvector.sh <staged-pg-dir-or-native-root>}"
PGVECTOR_VERSION="${PGVECTOR_VERSION:-0.8.5}"

if [ -f "$PG_STAGE/bin/postgres" ] || [ -f "$PG_STAGE/bin/postgres.exe" ]; then
  NATIVE_ROOT="$PG_STAGE"
else
  NATIVE_ROOT="$(find "$PG_STAGE/node_modules/@embedded-postgres" -type f \( -name postgres -o -name postgres.exe \) -path '*/native/bin/*' -print -quit | sed -E 's#/bin/postgres(\.exe)?$##')"
fi
[ -n "$NATIVE_ROOT" ] || { echo "Could not locate staged embedded PostgreSQL native root" >&2; exit 1; }

if [ -n "${PGVECTOR_SOURCE_DIR:-}" ]; then
  SOURCE_DIR="$PGVECTOR_SOURCE_DIR"
  CLEAN_SOURCE=0
else
  SOURCE_DIR="$(mktemp -d)/pgvector"
  CLEAN_SOURCE=1
  mkdir -p "$SOURCE_DIR"
  curl -fsSL "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz" \
    | tar -xz --strip-components=1 -C "$SOURCE_DIR"
fi

cleanup() {
  if [ "$CLEAN_SOURCE" = "1" ]; then rm -rf "$(dirname "$SOURCE_DIR")"; fi
}
trap cleanup EXIT

CONTROL_FILE="$(find "$NATIVE_ROOT" -type f -name plpgsql.control -print -quit)"
CONTROL_DIR="${CONTROL_FILE:+$(dirname "$CONTROL_FILE")}"
[ -n "$CONTROL_DIR" ] || CONTROL_DIR="$NATIVE_ROOT/share/postgresql/extension"
mkdir -p "$CONTROL_DIR"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    : "${PGROOT:?PGROOT must point at a PostgreSQL 18 installation on Windows}"
    NMAKE="$(command -v nmake.exe || command -v nmake || true)"
    [ -n "$NMAKE" ] || {
      echo "MSVC nmake.exe is required to build pgvector on Windows. Run from an x64 Visual Studio Developer Command Prompt." >&2
      exit 1
    }
    # GitHub's bash shell prepends Git's /usr/bin after msvc-dev-cmd runs,
    # which can shadow Microsoft's link.exe. Put the MSVC tools first again.
    MSVC_BIN="$(dirname "$NMAKE")"
    export PATH="$MSVC_BIN:$PATH"
    command -v cl.exe >/dev/null 2>&1 || {
      echo "MSVC cl.exe is missing from PATH after locating nmake.exe" >&2
      exit 1
    }
    # MSYS otherwise rewrites NMake's /F switch as a filesystem path, causing
    # NMake to ignore Makefile.win and parse the GNU Makefile instead.
    (cd "$SOURCE_DIR" && MSYS2_ARG_CONV_EXCL='*' "$NMAKE" /F Makefile.win)
    LIB_FILE="$(find "$NATIVE_ROOT" -type f -name plpgsql.dll -print -quit)"
    LIB_DIR="${LIB_FILE:+$(dirname "$LIB_FILE")}"
    [ -n "$LIB_DIR" ] || LIB_DIR="$NATIVE_ROOT/lib"
    cp "$SOURCE_DIR/vector.dll" "$LIB_DIR/vector.dll"
    ;;
  *)
    if [ -z "${PG_CONFIG:-}" ] && [ "$(uname -s)" = "Darwin" ] \
      && command -v brew >/dev/null 2>&1; then
      BREW_PG_CONFIG="$(brew --prefix postgresql@18 2>/dev/null || true)/bin/pg_config"
      if [ -x "$BREW_PG_CONFIG" ]; then PG_CONFIG="$BREW_PG_CONFIG"; fi
    fi
    PG_CONFIG="${PG_CONFIG:-$(command -v pg_config || true)}"
    [ -n "$PG_CONFIG" ] || { echo "PostgreSQL 18 pg_config is required to build pgvector" >&2; exit 1; }
    PG_MAJOR="$($PG_CONFIG --version | sed -E 's/.* ([0-9]+).*/\1/')"
    [ "$PG_MAJOR" = "18" ] || { echo "pg_config must be PostgreSQL 18, got $($PG_CONFIG --version)" >&2; exit 1; }
    [ -f "$($PG_CONFIG --pgxs)" ] || { echo "PostgreSQL 18 server development files are required (missing PGXS)" >&2; exit 1; }
    (cd "$SOURCE_DIR" && make clean PG_CONFIG="$PG_CONFIG" && make OPTFLAGS="" PG_CONFIG="$PG_CONFIG")
    if [ "$(uname -s)" = "Darwin" ]; then
      BUILT_LIBRARY="$SOURCE_DIR/vector.dylib"
      LIB_FILE="$(find "$NATIVE_ROOT" -type f -name plpgsql.dylib -print -quit)"
      LIB_NAME="vector.dylib"
    else
      BUILT_LIBRARY="$SOURCE_DIR/vector.so"
      LIB_FILE="$(find "$NATIVE_ROOT" -type f -name plpgsql.so -print -quit)"
      LIB_NAME="vector.so"
    fi
    LIB_DIR="${LIB_FILE:+$(dirname "$LIB_FILE")}"
    [ -n "$LIB_DIR" ] || LIB_DIR="$NATIVE_ROOT/lib/postgresql"
    mkdir -p "$LIB_DIR"
    cp "$BUILT_LIBRARY" "$LIB_DIR/$LIB_NAME"
    ;;
esac

cp "$SOURCE_DIR/vector.control" "$CONTROL_DIR/vector.control"
cp "$SOURCE_DIR"/sql/vector--*.sql "$CONTROL_DIR/"

[ -f "$CONTROL_DIR/vector.control" ] || { echo "pgvector control file was not staged" >&2; exit 1; }
echo "Staged pgvector ${PGVECTOR_VERSION} into $NATIVE_ROOT"
