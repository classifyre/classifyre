#!/usr/bin/env bash
set -euo pipefail

for required_command in curl kubectl skaffold; do
  if ! command -v "${required_command}" >/dev/null 2>&1; then
    echo "Missing required command: ${required_command}" >&2
    exit 1
  fi
done

skaffold_version="$(skaffold version)"
skaffold_latest_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' \
  https://github.com/GoogleContainerTools/skaffold/releases/latest)"
skaffold_latest_version="${skaffold_latest_url##*/}"
if [[ -z "${skaffold_version}" || -z "${skaffold_latest_version}" || "${skaffold_version}" != "${skaffold_latest_version}" ]]; then
  echo "Latest stable Skaffold ${skaffold_latest_version:-could not be determined} is required (found ${skaffold_version:-unknown})." >&2
  echo "Upgrade Skaffold with your package manager before starting development." >&2
  exit 1
fi

kubectl config use-context k3d-classifyre >/dev/null
# --cleanup=false leaves the Helm release (and the persistent Postgres PVC)
# running when you Ctrl-C, so the database survives across dev sessions.

# Skaffold forwards the SQL gateway to localhost:25432 itself (skaffold.yaml).
# This watcher only fills the gap when that forward is missing or drops (the
# gateway pod restarted, or the service appeared after skaffold started): it
# opens a plain kubectl forward whenever nothing listens on the port.
sql_port=25432
(
  while true; do
    if ! nc -z localhost "${sql_port}" >/dev/null 2>&1 \
      && kubectl -n classifyre-dev get endpoints classifyre-sql-gateway \
        -o jsonpath='{.subsets[0].addresses[0].ip}' 2>/dev/null | grep -q .; then
      kubectl -n classifyre-dev port-forward svc/classifyre-sql-gateway \
        "${sql_port}:5432" >/dev/null 2>&1 || true
    fi
    sleep 10
  done
) &
watcher_pid=$!
trap 'kill "${watcher_pid}" 2>/dev/null || true; pkill -P "${watcher_pid}" 2>/dev/null || true' EXIT

skaffold dev --profile dev --kube-context k3d-classifyre --cleanup=false
