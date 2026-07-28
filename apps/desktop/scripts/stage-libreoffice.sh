#!/usr/bin/env bash
set -euo pipefail

# Stages LibreOffice into apps/desktop/resources/libreoffice/.
#
# Legacy Office formats (.doc/.xls/.ppt) have no usable pure-Python parser, so
# the CLI shells out to `soffice --headless --convert-to docx|xlsx|pptx`
# (apps/cli/src/utils/legacy_office.py). The Kubernetes CLI image installs the
# Debian libreoffice-*-nogui packages; the desktop app bundles its own copy so a
# user with no system LibreOffice still gets those formats scanned instead of
# silently reported as "no content available".
#
# Layout produced (resolved at runtime by src/main/soffice-env.ts):
#   macOS    resources/libreoffice/LibreOffice.app/Contents/MacOS/soffice
#   Windows  resources/libreoffice/program/soffice.exe
#   Linux    resources/libreoffice/program/soffice
#
# Env toggles:
#   LO_VERSION       — LibreOffice release to bundle (default below)
#   SKIP_LIBREOFFICE — skip staging entirely (dev iteration; the packaged app
#                      then falls back to a system install, as before bundling)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOURCES="$DESKTOP_DIR/resources"
DEST="$RESOURCES/libreoffice"

# Pinned to the "still" branch: this is a bundled dependency users cannot patch
# themselves, so it tracks the conservative release line rather than "fresh".
# Bumping means updating BOTH the version and all four checksums — see the
# sha256 files next to each artifact on the download server.
LO_VERSION="${LO_VERSION:-25.8.7}"
LO_BASE_URL="https://download.documentfoundation.org/libreoffice/stable/${LO_VERSION}"

# sha256 of each upstream artifact, from ${LO_BASE_URL}/<path>/<file>.sha256.
# A mismatch aborts the build: this binary ends up inside a signed, notarized
# installer, so it must never be whatever a compromised mirror served.
LO_SHA256_MAC_AARCH64="e7556aa61e282f89578ebaf35afdb09c94dcf9d6ee7c137004377bee81a6e900"
LO_SHA256_WIN_X86_64="ecdb65e76f5e91dc198b8c8dce5b5d6e1eb12fea6023553e52b591afd10b619d"
LO_SHA256_LINUX_X86_64="7f4d7b2e36921eec5122c655249a24cc88935ee357e8261fd3bccd15aa1f7b9f"
LO_SHA256_LINUX_AARCH64="67e9b7dcdeae72c7aa1357345307e67376fc2b729a7f9ebfafb372b010e22ffa"

if [ "${SKIP_LIBREOFFICE:-0}" = "1" ]; then
  echo "SKIP_LIBREOFFICE=1 — not staging LibreOffice"
  exit 0
fi

case "$(uname -s)" in
  Darwin)               HOST_OS=mac ;;
  MINGW*|MSYS*|CYGWIN*) HOST_OS=win ;;
  Linux)                HOST_OS=linux ;;
  *) echo "Unsupported host OS: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  arm64|aarch64) HOST_ARCH=aarch64 ;;
  x86_64|amd64)  HOST_ARCH=x86_64 ;;
  *) echo "Unsupported host arch: $(uname -m)" >&2; exit 1 ;;
esac

TMP="$DESKTOP_DIR/.libreoffice-dist"
rm -rf "$TMP" "$DEST"
mkdir -p "$TMP"
# shellcheck disable=SC2064  # expand TMP now, not at trap time
trap "rm -rf '$TMP'" EXIT

# Verify before extracting, never after: an unverified archive must not be
# unpacked at all.
download_and_verify() {
  local url="$1" out="$2" want_sha="$3" got_sha

  echo "Downloading $(basename "$out") …"
  curl -fSL --retry 3 --retry-delay 5 -o "$out" "$url"

  if command -v sha256sum >/dev/null; then
    got_sha="$(sha256sum "$out" | cut -d' ' -f1)"
  else
    got_sha="$(shasum -a 256 "$out" | cut -d' ' -f1)"
  fi

  if [ "$got_sha" != "$want_sha" ]; then
    echo "Checksum mismatch for $(basename "$out")" >&2
    echo "  expected: $want_sha" >&2
    echo "  actual:   $got_sha" >&2
    exit 1
  fi
  echo "Checksum OK: $got_sha"
}

# Locale help, clipart, templates and sample wizards are pure UI surface. The
# app only ever runs `--headless --convert-to`, which never reads any of them,
# and they are ~90 MB that would otherwise be signed, notarized and shipped.
# Import/export filters, fonts and configuration are NOT touched.
strip_unused() {
  local root="$1" dir
  for dir in help gallery template wizards; do
    rm -rf "${root:?}/$dir"
  done
}

case "$HOST_OS" in
  mac)
    if [ "$HOST_ARCH" = "aarch64" ]; then
      ARTIFACT="LibreOffice_${LO_VERSION}_MacOS_aarch64.dmg"
      URL="$LO_BASE_URL/mac/aarch64/$ARTIFACT"
      WANT_SHA="$LO_SHA256_MAC_AARCH64"
    else
      echo "macOS x86_64 is not a release target (release-desktop.yml builds mac-arm64 only)." >&2
      echo "Add the artifact + its sha256 here if that changes." >&2
      exit 1
    fi

    download_and_verify "$URL" "$TMP/$ARTIFACT" "$WANT_SHA"

    echo "=== Mount DMG and copy LibreOffice.app ==="
    MOUNT_POINT="$TMP/mnt"
    mkdir -p "$MOUNT_POINT"
    hdiutil attach "$TMP/$ARTIFACT" -nobrowse -readonly -mountpoint "$MOUNT_POINT" >/dev/null
    # Always detach, even if the copy fails, or the volume leaks and the next
    # build's attach fails on a stale mount.
    trap "hdiutil detach '$MOUNT_POINT' >/dev/null 2>&1 || true; rm -rf '$TMP'" EXIT

    mkdir -p "$DEST"
    cp -R "$MOUNT_POINT/LibreOffice.app" "$DEST/LibreOffice.app"
    hdiutil detach "$MOUNT_POINT" >/dev/null
    trap "rm -rf '$TMP'" EXIT

    strip_unused "$DEST/LibreOffice.app/Contents/Resources"
    SOFFICE="$DEST/LibreOffice.app/Contents/MacOS/soffice"
    ;;

  win)
    ARTIFACT="LibreOffice_${LO_VERSION}_Win_x86-64.msi"
    download_and_verify "$LO_BASE_URL/win/x86_64/$ARTIFACT" "$TMP/$ARTIFACT" "$LO_SHA256_WIN_X86_64"

    echo "=== Administrative MSI install (extract without installing) ==="
    # /a unpacks the payload into TARGETDIR instead of installing to the system
    # — no registry writes, no elevation. msiexec is a native Windows binary, so
    # it needs real Windows paths, not the git-bash POSIX view.
    ADMIN_DIR="$TMP/admin"
    mkdir -p "$ADMIN_DIR"
    msiexec.exe //a "$(cygpath -w "$TMP/$ARTIFACT")" //qn \
      TARGETDIR="$(cygpath -w "$ADMIN_DIR")"

    # The admin image nests the payload one directory deep; find the tree that
    # actually holds program/soffice.exe rather than hard-coding its name, which
    # carries the version and has changed between releases.
    PROGRAM_DIR="$(dirname "$(find "$ADMIN_DIR" -type f -name soffice.exe -print -quit)")"
    [ -n "$PROGRAM_DIR" ] || { echo "soffice.exe not found in MSI admin image" >&2; exit 1; }

    mkdir -p "$DEST"
    cp -R "$(dirname "$PROGRAM_DIR")/." "$DEST/"
    strip_unused "$DEST/share"
    SOFFICE="$DEST/program/soffice.exe"
    ;;

  linux)
    if [ "$HOST_ARCH" = "aarch64" ]; then
      ARTIFACT="LibreOffice_${LO_VERSION}_Linux_aarch64_deb.tar.gz"
      URL="$LO_BASE_URL/deb/aarch64/$ARTIFACT"
      WANT_SHA="$LO_SHA256_LINUX_AARCH64"
    else
      ARTIFACT="LibreOffice_${LO_VERSION}_Linux_x86-64_deb.tar.gz"
      URL="$LO_BASE_URL/deb/x86_64/$ARTIFACT"
      WANT_SHA="$LO_SHA256_LINUX_X86_64"
    fi

    download_and_verify "$URL" "$TMP/$ARTIFACT" "$WANT_SHA"

    echo "=== Extract .deb payloads (no dpkg install) ==="
    tar -xzf "$TMP/$ARTIFACT" -C "$TMP"
    DEBS_DIR="$(find "$TMP" -type d -name DEBS -print -quit)"
    [ -n "$DEBS_DIR" ] || { echo "DEBS/ not found in $ARTIFACT" >&2; exit 1; }

    EXTRACT_ROOT="$TMP/root"
    mkdir -p "$EXTRACT_ROOT"
    # Every .deb in the tarball is part of one self-contained /opt tree; the
    # -writer/-calc/-impress payloads carry the .doc/.xls/.ppt import filters,
    # so all of them are extracted. dpkg-deb -x unpacks files only — no
    # maintainer scripts, no dpkg database, nothing touching the build host.
    for deb in "$DEBS_DIR"/*.deb; do
      dpkg-deb -x "$deb" "$EXTRACT_ROOT"
    done

    PROGRAM_DIR="$(dirname "$(find "$EXTRACT_ROOT/opt" -type f -name soffice -print -quit)")"
    [ -n "$PROGRAM_DIR" ] || { echo "soffice not found in extracted debs" >&2; exit 1; }

    mkdir -p "$DEST"
    cp -R "$(dirname "$PROGRAM_DIR")/." "$DEST/"
    strip_unused "$DEST/share"
    SOFFICE="$DEST/program/soffice"
    chmod +x "$SOFFICE"
    ;;
esac

[ -x "$SOFFICE" ] || { echo "Staged soffice is not executable: $SOFFICE" >&2; exit 1; }

echo "=== Smoke-test the staged binary ==="
# Proves the extracted tree is self-contained and can actually convert, on this
# machine, before it is signed and shipped. A bundle that merely *contains*
# soffice but cannot run it is the exact failure this staging step exists to
# prevent, and it is invisible until a user scans a .doc.
SMOKE="$TMP/smoke"
mkdir -p "$SMOKE"
printf 'Legacy document body text.\n' > "$SMOKE/sample.txt"
"$SOFFICE" --headless --norestore \
  -env:UserInstallation="file://$SMOKE/profile" \
  --convert-to doc --outdir "$SMOKE" "$SMOKE/sample.txt" >/dev/null
[ -s "$SMOKE/sample.doc" ] || { echo "Staged LibreOffice could not produce a .doc" >&2; exit 1; }
"$SOFFICE" --headless --norestore \
  -env:UserInstallation="file://$SMOKE/profile2" \
  --convert-to docx --outdir "$SMOKE/out" "$SMOKE/sample.doc" >/dev/null
[ -s "$SMOKE/out/sample.docx" ] || { echo "Staged LibreOffice could not convert .doc → .docx" >&2; exit 1; }

echo "=== LibreOffice staged: $(du -sh "$DEST" | cut -f1) at $DEST ==="
