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
exec skaffold dev --profile dev --kube-context k3d-classifyre
