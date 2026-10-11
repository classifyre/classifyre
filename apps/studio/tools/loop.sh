#!/bin/sh
# Makes a video's bed out of a piece of music: the piece looped to the video's
# length, so that it starts where the piece starts and ends on the piece's own
# ending.
#
#   sh apps/studio/tools/loop.sh <video-folder> <piece> <seconds> [lufs]
#
# Each pass but the last is cut 14 s before the piece ends (its ending is for
# the end of the film) and crossfaded over 5 s into the next; the first pass
# is the one shortened to make the sum come out. 2 kHz is dipped by 4 dB, to
# leave the voice its room, and the whole is levelled to -30 LUFS (a video
# then plays it at about 0.55). The bed is exactly as long as the video, so it
# is made again whenever a line is spoken again.
set -e
[ -n "$3" ] || { echo "usage: loop.sh <video-folder> <piece> <seconds> [lufs]"; exit 1; }
PIECE="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
WANT="$3"
LUFS="${4:--30}"
cd "$(dirname "$0")/../videos/$1/audio"

LONG=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$PIECE")
# How many shortened passes go before the last, whole one, and how long the first of them is.
set -- $(awk -v t="$WANT" -v l="$LONG" 'BEGIN {
  body = l - 14; step = body - 5;
  if (t <= l) { print 0, 0, body; exit }
  k = int((t - l) / step); if ((t - l) > k * step) k += 1;
  print k, t - l - (k - 1) * step + 5, body
}')
PASSES="$1"; FIRST="$2"; BODY="$3"

if [ "$PASSES" -eq 0 ]; then
  # Shorter than the piece: its end, so that it still closes on the piece's ending.
  GRAPH="[0:a]atrim=start=$(awk -v t="$WANT" -v l="$LONG" 'BEGIN { print l - t }'),asetpts=N/SR/TB,afade=t=in:d=3[mix]"
  INPUTS="-i $PIECE"
else
  INPUTS=""; GRAPH=""; i=0
  while [ "$i" -le "$PASSES" ]; do
    INPUTS="$INPUTS -i $PIECE"
    if [ "$i" -eq 0 ]; then GRAPH="$GRAPH[0:a]atrim=0:$FIRST,asetpts=N/SR/TB[p0];"
    elif [ "$i" -lt "$PASSES" ]; then GRAPH="$GRAPH[$i:a]atrim=0:$BODY,asetpts=N/SR/TB[p$i];"
    else GRAPH="$GRAPH[$i:a]anull[p$i];"; fi
    i=$((i + 1))
  done
  i=1; LAST="p0"
  while [ "$i" -le "$PASSES" ]; do
    GRAPH="$GRAPH[$LAST][p$i]acrossfade=d=5:c1=tri:c2=tri[x$i];"
    LAST="x$i"; i=$((i + 1))
  done
  GRAPH="$GRAPH[$LAST]anull[mix]"
fi

# shellcheck disable=SC2086
ffmpeg -y -v error $INPUTS -filter_complex \
  "$GRAPH;[mix]equalizer=f=2000:t=q:w=1:g=-4,loudnorm=I=$LUFS:TP=-6:LRA=7,atrim=0:$WANT[out]" \
  -map "[out]" -ar 48000 -b:a 160k bed.mp3
echo "bed.mp3: $(ffprobe -v error -show_entries format=duration -of csv=p=0 bed.mp3) s, $((PASSES + 1)) passes"
