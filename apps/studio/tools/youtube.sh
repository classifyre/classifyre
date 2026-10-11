#!/bin/sh
# Exports a video for YouTube: H.264 High, 4:2:0, BT.709, AAC at 48 kHz, the
# index at the front of the file, and the sound levelled to the -14 LUFS that
# YouTube plays everything at (a quieter upload is not turned up).
#
#   sh apps/studio/tools/youtube.sh <CompositionId> [1080p|4k|both]
#
# Writes apps/studio/out/<CompositionId>-1080p.mp4 and/or -4k.mp4. The 4K file
# is the same composition drawn at twice the size, not an upscale: YouTube
# gives a 4K upload its better codec at every resolution, which is what keeps
# small interface text sharp.
set -e
cd "$(dirname "$0")/.."

ID="$1"
WHICH="${2:-both}"
[ -n "$ID" ] || { echo "usage: youtube.sh <CompositionId> [1080p|4k|both]"; exit 1; }
mkdir -p out

export_one() {
  name="$1"
  scale="$2"
  raw="out/$ID-$name-raw.mp4"
  final="out/$ID-$name.mp4"

  bun run render "$ID" "$raw" --scale="$scale" \
    --codec=h264 --crf=15 --pixel-format=yuv420p --color-space=bt709 \
    --jpeg-quality=96 --audio-codec=aac --audio-bitrate=320k --log=error

  # Two passes: measure the whole film, then turn it up by one fixed amount,
  # so that quiet lines are not pumped louder than loud ones.
  measured=$(ffmpeg -hide_banner -i "$raw" -vn \
    -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1)
  value() { echo "$measured" | sed -n "s/.*\"$1\" *: *\"\\([^\"]*\\)\".*/\\1/p" | tail -1; }
  ffmpeg -y -v error -i "$raw" -c:v copy \
    -af "loudnorm=I=-14:TP=-1.5:LRA=7:measured_I=$(value input_i):measured_TP=$(value input_tp):measured_LRA=$(value input_lra):measured_thresh=$(value input_thresh):offset=$(value target_offset):linear=true" \
    -ar 48000 -c:a aac -b:a 320k -movflags +faststart "$final"
  rm -f "$raw"
  echo "exported $final"
}

case "$WHICH" in
  1080p) export_one 1080p 1 ;;
  4k) export_one 4k 2 ;;
  both) export_one 1080p 1; export_one 4k 2 ;;
  *) echo "unknown size: $WHICH"; exit 1 ;;
esac
