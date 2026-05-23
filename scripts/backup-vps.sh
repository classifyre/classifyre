#!/usr/bin/env bash
# Backup /srv/wordpress from production VPS to local dumps/wordpress/
# Usage: ./scripts/backup-vps.sh

set -euo pipefail

VPS_HOST="144.217.166.247"
VPS_PORT="47819"
VPS_USER="debian"
VPS_PATH="/srv/wordpress/"
LOCAL_PATH="$(cd "$(dirname "$0")/.." && pwd)/dumps/wordpress/"

echo "=== VPS WordPress Backup ==="
echo "From: ${VPS_USER}@${VPS_HOST}:${VPS_PATH}"
echo "To:   ${LOCAL_PATH}"
echo "Started at: $(date)"
echo ""

mkdir -p "$LOCAL_PATH"

rsync -avz --progress \
  --rsync-path="sudo rsync" \
  -e "ssh -p ${VPS_PORT}" \
  "${VPS_USER}@${VPS_HOST}:${VPS_PATH}" \
  "${LOCAL_PATH}"

echo ""
echo "=== Done at $(date) ==="
echo "Size: $(du -sh "$LOCAL_PATH" | cut -f1)"
