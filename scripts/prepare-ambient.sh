#!/usr/bin/env bash
# Turn a recording into a web-ready ambient video for xwall.
#
#   scripts/prepare-ambient.sh <input-video> <mode> "<Title>"
#
#   mode:  fireplace | rain | river | space
#   e.g.   scripts/prepare-ambient.sh ~/Movies/IMG_1234.MOV fireplace "Cozy Hearth"
#
# Writes media/<mode>/<title>.mp4 (1080p H.264, starts playing before it has
# fully downloaded) and a poster image media/<mode>/<title>.jpg for the picker.
# Then run scripts/upload-media.sh to put it on the server.
set -euo pipefail

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

command -v ffmpeg >/dev/null || { echo "ffmpeg not found. Install it with: brew install ffmpeg"; exit 1; }
[ $# -eq 3 ] || usage

in="$1"; mode="$2"; title="$3"
case "$mode" in fireplace|rain|river|space) ;; *) echo "mode must be one of: fireplace, rain, river, space"; exit 1 ;; esac
[ -f "$in" ] || { echo "No such file: $in"; exit 1; }

slug=$(printf '%s' "$title" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
[ -n "$slug" ] || { echo "The title must contain letters or numbers"; exit 1; }

root="$(cd "$(dirname "$0")/.." && pwd)"
outdir="$root/media/$mode"
mkdir -p "$outdir"
out="$outdir/$slug.mp4"
poster="$outdir/$slug.jpg"

echo "Converting to $out …"
# 1080p max, 30 fps, H.264 + AAC. -movflags +faststart lets playback begin
# while the rest downloads; maxrate keeps bandwidth predictable (~6 Mbit/s).
ffmpeg -hide_banner -loglevel error -stats -y -i "$in" \
  -vf "scale='min(1920,iw)':-2:flags=lanczos,fps=30,format=yuv420p" \
  -c:v libx264 -preset slow -crf 23 -profile:v high -level 4.1 \
  -maxrate 6M -bufsize 12M \
  -c:a aac -b:a 128k -ac 2 \
  -movflags +faststart \
  "$out"

ffmpeg -hide_banner -loglevel error -y -ss 1 -i "$out" -frames:v 1 -vf "scale=480:-2" -q:v 3 "$poster" \
  || echo "(poster skipped — the picker will show a coloured placeholder)"

echo
echo "Done: $(du -h "$out" | cut -f1)  $out"
[ -f "$poster" ] && echo "      $(du -h "$poster" | cut -f1)  $poster"
echo "Next: scripts/upload-media.sh"
