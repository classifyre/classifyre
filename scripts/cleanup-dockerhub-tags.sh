#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DOCKER_USERNAME:-}" || -z "${DOCKERHUB_TOKEN:-}" ]]; then
  echo "Error: DOCKER_USERNAME and DOCKERHUB_TOKEN must be set." >&2
  exit 1
fi

DRY_RUN="${DRY_RUN:-0}"
PAGE_SIZE="${PAGE_SIZE:-100}"
KEEP_PATTERN='^(main|latest|[0-9]+\.[0-9]+\.[0-9]+)$'
REPOSITORIES=(all-in-one web api cli)

dockerhub_api() {
  local method="$1"
  local path="$2"
  shift 2 || true

  curl --silent --show-error --fail \
    -X "${method}" \
    -H "Authorization: Bearer ${DOCKERHUB_BEARER_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@" \
    "https://hub.docker.com${path}"
}

echo "Authenticating to Docker Hub as ${DOCKER_USERNAME}..."
DOCKERHUB_BEARER_TOKEN="$(
  curl --silent --show-error --fail \
    -X POST \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${DOCKER_USERNAME}\",\"password\":\"${DOCKERHUB_TOKEN}\"}" \
    "https://hub.docker.com/v2/users/login/" |
    jq -r '.token'
)"

if [[ -z "${DOCKERHUB_BEARER_TOKEN}" || "${DOCKERHUB_BEARER_TOKEN}" == "null" ]]; then
  echo "Error: failed to obtain Docker Hub bearer token." >&2
  exit 1
fi

for repository in "${REPOSITORIES[@]}"; do
  echo ""
  echo "==> Processing ${DOCKER_USERNAME}/${repository}"

  page=1
  tags=()
  while :; do
    response="$(
      dockerhub_api GET \
        "/v2/namespaces/${DOCKER_USERNAME}/repositories/${repository}/tags?page_size=${PAGE_SIZE}&page=${page}"
    )"

    mapfile -t page_tags < <(jq -r '.results[].name' <<< "${response}")
    if [[ "${#page_tags[@]}" -eq 0 ]]; then
      break
    fi

    tags+=("${page_tags[@]}")

    next="$(jq -r '.next // empty' <<< "${response}")"
    if [[ -z "${next}" ]]; then
      break
    fi

    page=$((page + 1))
  done

  for tag in "${tags[@]}"; do
    if [[ "${tag}" =~ ${KEEP_PATTERN} ]]; then
      echo "keep   ${repository}:${tag}"
      continue
    fi

    if [[ "${DRY_RUN}" == "1" ]]; then
      echo "delete ${repository}:${tag} (dry-run)"
      continue
    fi

    echo "delete ${repository}:${tag}"
    dockerhub_api DELETE \
      "/v2/namespaces/${DOCKER_USERNAME}/repositories/${repository}/tags/${tag}" \
      >/dev/null
  done
done
