#!/usr/bin/env bash
# The all-in-one image and the Helm chart must run the same identity server:
# they share the realm setup (helm/classifyre/files/iam/setup-realm.sh) and the
# theme. Dependabot bumps the two pins in separate PRs (docker and helm
# ecosystems); this fails CI until both say the same version.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
docker_tag=$(sed -n 's|^FROM quay.io/keycloak/keycloak:\([^ ]*\) AS .*|\1|p' "$ROOT/docker/Dockerfile")
helm_tag=$(awk '
  /^iam:/ { in_iam = 1; next }
  in_iam && /^[^ #]/ { in_iam = 0 }
  in_iam && /^    tag:/ { gsub(/["'"'"' ]/, "", $2); print $2; exit }
' "$ROOT/helm/classifyre/values.yaml")

if [ -z "$docker_tag" ] || [ -z "$helm_tag" ]; then
  echo "could not read the Keycloak version (docker: '${docker_tag}', helm: '${helm_tag}')" >&2
  exit 1
fi
if [ "$docker_tag" != "$helm_tag" ]; then
  echo "Keycloak differs: docker/Dockerfile has ${docker_tag}, helm/classifyre/values.yaml iam.image.tag has ${helm_tag}." >&2
  echo "Bump both to the same version." >&2
  exit 1
fi
echo "Keycloak ${docker_tag} in both the all-in-one image and the Helm chart."
