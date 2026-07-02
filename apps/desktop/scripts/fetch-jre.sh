#!/usr/bin/env bash
set -euo pipefail

# Downloads Amazon Corretto JDK for the current platform and produces a
# jlink-minimized runtime at the destination directory. The minimized runtime
# (~80MB vs ~300MB for the full JDK) carries the module set Spark 4.x needs.
#
# Usage: fetch-jre.sh <dest-dir>
# Env:   JAVA_VERSION (default 21 — latest LTS certified for Spark 4.x)

DEST="${1:?Usage: fetch-jre.sh <dest-dir>}"
JAVA_VERSION="${JAVA_VERSION:-21}"

# Module set for pyspark lakehouse sources. Generous on purpose: a missing
# module fails at runtime, an extra one costs a few MB.
JLINK_MODULES="java.base,java.compiler,java.datatransfer,java.desktop,java.instrument,java.logging,java.management,java.management.rmi,java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.se,java.security.jgss,java.security.sasl,java.sql,java.sql.rowset,java.transaction.xa,java.xml,java.xml.crypto,jdk.unsupported,jdk.security.auth,jdk.crypto.ec,jdk.crypto.cryptoki,jdk.zipfs,jdk.httpserver,jdk.management,jdk.net"

case "$(uname -s)" in
  Darwin)               JOS=macos   ; JARCH="$(uname -m | sed 's/x86_64/x64/' | sed 's/arm64/aarch64/')" ; JEXT=tar.gz ;;
  Linux)                JOS=linux   ; JARCH="$(uname -m | sed 's/x86_64/x64/' | sed 's/arm64/aarch64/')" ; JEXT=tar.gz ;;
  MINGW*|MSYS*|CYGWIN*) JOS=windows ; JARCH=x64                                                          ; JEXT=zip    ;;
  *) echo "Unsupported OS $(uname -s)" >&2; exit 1 ;;
esac

JRE_TMP="$(mktemp -d)"
trap 'rm -rf "$JRE_TMP"' EXIT

JRE_URL="https://corretto.aws/downloads/latest/amazon-corretto-${JAVA_VERSION}-${JARCH}-${JOS}-jdk.${JEXT}"
echo "Downloading Corretto JDK: $JRE_URL"
curl -fsSL --retry 3 "$JRE_URL" -o "$JRE_TMP/corretto.${JEXT}"

case "$JEXT" in
  tar.gz) tar -xzf "$JRE_TMP/corretto.tar.gz" -C "$JRE_TMP" ;;
  zip)
    if command -v unzip >/dev/null 2>&1; then
      unzip -q "$JRE_TMP/corretto.zip" -d "$JRE_TMP"
    else
      powershell.exe -NoProfile -Command \
        "Expand-Archive -LiteralPath '$(cygpath -w "$JRE_TMP/corretto.zip")' -DestinationPath '$(cygpath -w "$JRE_TMP")'"
    fi
    ;;
esac

case "$JOS" in
  macos)   JHOME="$(find "$JRE_TMP" -maxdepth 4 -type d -path '*/Contents/Home' | head -1)" ;;
  linux)   JHOME="$(find "$JRE_TMP" -mindepth 1 -maxdepth 1 -type d -name 'amazon-corretto-*' | head -1)" ;;
  windows) JHOME="$(find "$JRE_TMP" -mindepth 1 -maxdepth 2 -type d -name 'jdk*' | head -1)" ;;
esac
[ -n "$JHOME" ] || { echo "Could not locate extracted Corretto home" >&2; exit 1; }

EXE=""
[ "$JOS" = "windows" ] && EXE=".exe"

echo "Building minimized runtime with jlink (modules: spark set)"
rm -rf "$DEST"
"$JHOME/bin/jlink$EXE" \
  --add-modules "$JLINK_MODULES" \
  --strip-debug \
  --no-man-pages \
  --no-header-files \
  --compress zip-6 \
  --output "$DEST"

"$DEST/bin/java$EXE" -version
echo "Minimized JRE ready at $DEST ($(du -sh "$DEST" | cut -f1))"
