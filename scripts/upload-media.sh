#!/usr/bin/env bash
# Upload everything in media/ to the server. New videos appear in xwall within
# about a minute — no deploy needed.
#
#   scripts/upload-media.sh
#
# Never deletes anything on the server. To remove a video there:
#   ssh root@xwall.co.za 'rm /opt/xwall/media/<mode>/<file>.mp4'
#
# Override the defaults with XWALL_SERVER and XWALL_SSH_KEY if needed.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
server="${XWALL_SERVER:-root@xwall.co.za}"
key="${XWALL_SSH_KEY:-$HOME/.ssh/hungu_rsa}"

rsync -av --progress \
  -e "ssh -i '$key'" \
  --exclude README.md \
  "$root/media/" "$server:/opt/xwall/media/"

# World-readable so nginx and the app container can both read the files.
# Done over ssh because macOS's built-in rsync (openrsync) has no --chmod.
ssh -i "$key" "$server" \
  'find /opt/xwall/media -type d -exec chmod 755 {} + && find /opt/xwall/media -type f -exec chmod 644 {} +'

echo
echo "Uploaded. Open https://xwall.co.za — your videos show first in each mode's picker."
