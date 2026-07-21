#!/usr/bin/env bash
#
# Regenerates the app icons from a single transparent master
# (build/icon-source.png) onto a SOLID BLACK background, for every platform:
#
#   - build/icon.iconset/*  + build/icon.icns  (macOS)
#   - build/icon.ico                            (Windows)
#   - build/icon.png                            (Linux + Forge packagerConfig)
#
# The master keeps its transparency; flattening onto black is what fills the
# area around the logo so it reads as black (not the OS's default grey) in
# Finder, the dock, the taskbar, and Linux launchers alike.
#
# Idempotent: re-run any time the master changes. Requires ImageMagick
# (`magick`); the .icns step additionally requires macOS `iconutil`.
set -euo pipefail

cd "$(dirname "$0")/.."
BUILD="build"
SRC="$BUILD/icon-source.png"
ICONSET="$BUILD/icon.iconset"
BG="black"

command -v magick >/dev/null || { echo "error: ImageMagick (magick) not found" >&2; exit 1; }
[ -f "$SRC" ] || { echo "error: master $SRC not found" >&2; exit 1; }

# name:size pairs for the macOS iconset
sizes=(
  "icon_16x16.png:16"      "icon_16x16@2x.png:32"
  "icon_32x32.png:32"      "icon_32x32@2x.png:64"
  "icon_64x64.png:64"      "icon_64x64@2x.png:128"
  "icon_128x128.png:128"   "icon_128x128@2x.png:256"
  "icon_256x256.png:256"   "icon_256x256@2x.png:512"
  "icon_512x512.png:512"
)

mkdir -p "$ICONSET"
for pair in "${sizes[@]}"; do
  name="${pair%%:*}"; size="${pair##*:}"
  magick "$SRC" -resize "${size}x${size}" -background "$BG" -flatten "$ICONSET/$name"
done
echo "iconset regenerated ($ICONSET)"

# Linux + Forge packagerConfig icon
magick "$SRC" -resize 512x512 -background "$BG" -flatten "$BUILD/icon.png"
echo "icon.png regenerated"

# Windows multi-resolution .ico
magick "$SRC" -background "$BG" -flatten \
  -define icon:auto-resize=256,128,64,48,32,16 "$BUILD/icon.ico"
echo "icon.ico regenerated"

# macOS .icns (needs iconutil)
if command -v iconutil >/dev/null; then
  iconutil -c icns "$ICONSET" -o "$BUILD/icon.icns"
  echo "icon.icns regenerated"
else
  echo "warning: iconutil not available — skipped icon.icns (run on macOS)" >&2
fi
