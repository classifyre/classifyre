#!/usr/bin/env bash
# Run web (3000), docs (3002) and blog (3003) dev servers, reachable over the LAN.
set -euo pipefail
cd "$(dirname "$0")/../.."

trap 'kill 0' EXIT INT TERM

# Always start from a clean Next.js cache.
rm -rf apps/web/.next apps/docs/.next apps/blog/.next

IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
echo "web   (with sign-in) see address printed below, port 3000"
echo "docs  http://${IP:-localhost}:3002"
echo "blog  http://${IP:-localhost}:3003"

LAN=1 ./scripts/dev/web-iam.sh &
bun run --cwd apps/docs dev --hostname 0.0.0.0 &
bun run --cwd apps/blog dev --hostname 0.0.0.0 &
wait
