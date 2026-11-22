#!/usr/bin/env bash
# BI smoke on the skaffold dev stack (docs/prd/BIC-bi-client-compatibility.md §4):
# builds the drivers image into k3d, installs Metabase (release `bi-smoke`),
# then runs development/bi-smoke/bi_smoke.py against the `lakehouse-lab` workspace.
#
#   scripts/dev/bi-smoke.sh                  # everything
#   scripts/dev/bi-smoke.sh --only M1,D5     # arguments go to bi_smoke.py
#   SKIP_BUILD=1 scripts/dev/bi-smoke.sh     # reuse the drivers image
#
# Needs the dev stack (scripts/dev/start.sh) and the lakehouse lab
# (development/lakehouse-lab/README.md). Metabase stays up afterwards:
#   kubectl -n classifyre-dev port-forward svc/bi-smoke-metabase 3030:3000
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NS=${NS:-classifyre-dev}
CLUSTER=${K3D_CLUSTER:-classifyre}
IMAGE=classifyre/bi-smoke-drivers:dev

if [ -z "${SKIP_BUILD:-}" ]; then
  docker build -q -t "$IMAGE" "$ROOT/development/bi-smoke/drivers" >/dev/null
  k3d image import -c "$CLUSTER" "$IMAGE" >/dev/null
  echo "drivers image $IMAGE imported into k3d-$CLUSTER"
fi

helm upgrade --install bi-smoke "$ROOT/development/bi-smoke" -n "$NS" --wait --timeout 10m >/dev/null
kubectl -n "$NS" rollout status deploy/bi-smoke-metabase --timeout=10m >/dev/null
echo "Metabase ready"

exec uv run "$ROOT/development/bi-smoke/bi_smoke.py" "$@"
