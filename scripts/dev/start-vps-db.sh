#!/usr/bin/env bash
# Run the local k3d cluster in NON-demo mode against the VPS instance's Postgres.
#
# The VPS instance is deployed read-only (DEMO_MODE=true). This gives you a
# writable local deployment of the same chart pointed at the same database, so
# you can create sources and change settings for the demo without taking the
# public instance out of demo mode.
#
#   ./scripts/dev/start-vps-db.sh            # deploy and watch (Ctrl-C to stop)
#   ./scripts/dev/start-vps-db.sh --migrate  # also let the local API migrate
#
# Ctrl-C leaves the release running (--cleanup=false), same as start.sh.
# Tear down with: ./scripts/dev/stop-vps-db.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

KUBECONFIG_VPS="${KUBECONFIG_VPS:-${HOME}/.kube/config-classifyre-vps}"
VPS_NAMESPACE="${VPS_NAMESPACE:-classifyre}"
VPS_PG_SECRET="${VPS_PG_SECRET:-classifyre-postgres-password}"
VPS_PG_SECRET_KEY="${VPS_PG_SECRET_KEY:-password}"

ALLOW_MIGRATE=0
for arg in "$@"; do
  case "${arg}" in
    --migrate) ALLOW_MIGRATE=1 ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      exit 1
      ;;
  esac
done

for required_command in docker kubectl skaffold k3d; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 1
  fi
done

if [[ ! -f "${KUBECONFIG_VPS}" ]]; then
  echo "VPS kubeconfig not found: ${KUBECONFIG_VPS}" >&2
  exit 1
fi

if ! k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx classifyre; then
  echo "k3d cluster 'classifyre' does not exist. Run ./scripts/dev/create-cluster.sh first." >&2
  exit 1
fi

echo "This deploys a WRITABLE local instance against the VPS demo database."
echo "  VPS kubeconfig: ${KUBECONFIG_VPS}"
echo "  VPS namespace:  ${VPS_NAMESPACE}"
if [[ "${ALLOW_MIGRATE}" -eq 1 ]]; then
  echo "  Migrations:     ENABLED — the local checkout will apply pending"
  echo "                  migrations to the VPS database. Make sure this branch"
  echo "                  is not ahead of what the VPS release runs."
else
  echo "  Migrations:     disabled (pass --migrate to allow them)"
fi
read -r -p "Continue? [y/N] " reply
case "${reply}" in
  y | Y | yes | YES) ;;
  *)
    echo "Aborted."
    exit 1
    ;;
esac

# Read the database password straight from the VPS cluster so it never has to
# be copied into a file on disk.
echo "Reading database password from ${VPS_NAMESPACE}/${VPS_PG_SECRET}..."
DB_PASSWORD="$(
  KUBECONFIG="${KUBECONFIG_VPS}" kubectl get secret "${VPS_PG_SECRET}" \
    --namespace "${VPS_NAMESPACE}" \
    -o "jsonpath={.data.${VPS_PG_SECRET_KEY}}" | base64 -d
)"
if [[ -z "${DB_PASSWORD}" ]]; then
  echo "Could not read ${VPS_PG_SECRET_KEY} from secret ${VPS_PG_SECRET}." >&2
  exit 1
fi

DB_HOST="$("${SCRIPT_DIR}/vps-db-tunnel.sh" start | tail -1)"
if [[ -z "${DB_HOST}" ]]; then
  echo "Failed to start the database tunnel." >&2
  exit 1
fi
echo "Database reachable from the cluster at ${DB_HOST}:5432"

kubectl config use-context k3d-classifyre >/dev/null

# Consumed by the dev-vps-db profile's setValueTemplates in skaffold.yaml.
export CLASSIFYRE_VPS_DB_HOST="${DB_HOST}"
export CLASSIFYRE_VPS_DB_PASSWORD="${DB_PASSWORD}"
if [[ "${ALLOW_MIGRATE}" -eq 1 ]]; then
  export CLASSIFYRE_VPS_AUTO_MIGRATE="true"
else
  export CLASSIFYRE_VPS_AUTO_MIGRATE="false"
fi

cd "${REPO_ROOT}"
exec skaffold dev \
  --profile dev-vps-db \
  --kube-context k3d-classifyre \
  --cleanup=false
