#!/bin/sh
# The bed under a video's voice: a low drone on A that breathes, made from
# nothing but sine waves, so it costs nothing and is the same on every run.
# It is a stand-in. Put real music in the video's audio/bed.mp3 whenever there
# is some; a video only asks that it be as long as the video.
#
#   sh apps/studio/tools/bed.sh <video-folder> [seconds]
set -e
[ -n "$1" ] || { echo "usage: bed.sh <video-folder> [seconds]"; exit 1; }
cd "$(dirname "$0")/../videos/$1/audio"
SECONDS_LONG="${2:-272}"

# Five partials of an open fifth, each swelling on its own slow clock; the
# right channel is a fraction of a hertz sharp, which is what gives it width.
voice() {
  echo "0.20*sin(2*PI*(55+$1)*t)*(0.6+0.4*sin(2*PI*0.050*t))+0.14*sin(2*PI*(82.41+$1)*t)*(0.5+0.5*sin(2*PI*0.037*t+1))+0.12*sin(2*PI*(110+$1)*t)*(0.5+0.5*sin(2*PI*0.043*t+2))+0.07*sin(2*PI*(164.81+$1)*t)*(0.5+0.5*sin(2*PI*0.031*t+3))+0.035*sin(2*PI*(220+$1)*t)*(0.5+0.5*sin(2*PI*0.027*t+4))"
}

ffmpeg -y -v error \
  -f lavfi -i "aevalsrc=$(voice 0)|$(voice 0.31):s=48000:d=${SECONDS_LONG}" \
  -af "aecho=0.8:0.6:140|210:0.28|0.22,lowpass=f=1300,loudnorm=I=-33:TP=-6:LRA=6,afade=t=in:d=3,afade=t=out:st=$((SECONDS_LONG - 5)):d=5" \
  -ar 48000 -b:a 128k bed.mp3
echo "bed.mp3: ${SECONDS_LONG} s"
