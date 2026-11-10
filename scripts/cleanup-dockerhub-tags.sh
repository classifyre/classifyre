#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DOCKER_USERNAME:-}" || -z "${DOCKERHUB_TOKEN:-}" ]]; then
  echo "Error: DOCKER_USERNAME and DOCKERHUB_TOKEN must be set." >&2
  exit 1
fi

DRY_RUN="${DRY_RUN:-0}"
PAGE_SIZE="${PAGE_SIZE:-100}"
KEEP_PATTERN='^(main|latest|develop|build-cache(|-.+)|[0-9]+\.[0-9]+\.[0-9]+)$'
# Branch tags pushed this recently are kept: a CI run builds the service images
# first and the all-in-one image from them minutes later, and a cleanup that
# lands in between deleted the tags the second build was about to pull.
KEEP_RECENT_HOURS="${KEEP_RECENT_HOURS:-24}"
KEEP_AFTER_EPOCH=$(( $(date -u +%s) - KEEP_RECENT_HOURS * 3600 ))
# Every repository the release and CI pipelines push to. all-in-one is one of
# them: ci.yml tags it per branch exactly like the three service images, so
# without it here those tags accumulate forever — and at ~4 GB each that is the
# most expensive repository to leave untended.
REPOSITORIES=(web api cli all-in-one)

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

    # "<name> <epoch of last push>" (0 when Docker Hub gives no date).
    mapfile -t page_tags < <(jq -r '.results[] | "\(.name) \((.last_updated // "") | if . == "" then 0 else (sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) end)"' <<< "${response}")
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

  for entry in "${tags[@]}"; do
    tag="${entry% *}"
    pushed="${entry##* }"
    if [[ "${tag}" =~ ${KEEP_PATTERN} ]]; then
      echo "keep   ${repository}:${tag}"
      continue
    fi
    if (( pushed > KEEP_AFTER_EPOCH )); then
      echo "keep   ${repository}:${tag} (pushed in the last ${KEEP_RECENT_HOURS} h)"
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
