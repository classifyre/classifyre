#!/usr/bin/env bash

set -euo pipefail

VERSION="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

if [[ -z "${VERSION}" ]]; then
  echo "Usage: $0 <major.minor.patch|vmajor.minor.patch>" >&2
  exit 1
fi

VERSION="${VERSION#v}"
if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be major.minor.patch (got '${VERSION}')" >&2
  exit 1
fi

TAG="v${VERSION}"

resolve_repo() {
  if gh repo view --json nameWithOwner --jq .nameWithOwner >/dev/null 2>&1; then
    gh repo view --json nameWithOwner --jq .nameWithOwner
    return 0
  fi

  local remote_url
  remote_url="$(git remote get-url origin)"
  remote_url="${remote_url%.git}"
  remote_url="${remote_url#git@}"
  remote_url="${remote_url#https://github.com/}"
  remote_url="${remote_url#ssh://git@}"
  remote_url="${remote_url#github.com/}"
  remote_url="${remote_url/:/\/}"
  printf '%s\n' "${remote_url}"
}

REPO="$(resolve_repo)"

echo ""
echo "==> Cleaning release ${TAG} in ${REPO}"

if gh release view "${TAG}" --repo "${REPO}" >/dev/null 2>&1; then
  echo "==> GitHub release exists for ${TAG}"
else
  echo "==> GitHub release does not exist for ${TAG}"
fi

if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "==> Deleting local tag ${TAG}"
  git tag -d "${TAG}"
else
  echo "==> Local tag ${TAG} does not exist"
fi

if git ls-remote --tags origin "${TAG}" 2>/dev/null | grep -q "refs/tags/${TAG}$"; then
  echo "==> Deleting remote tag ${TAG}"
  git push origin ":refs/tags/${TAG}"
else
  echo "==> Remote tag ${TAG} does not exist"
fi

echo "==> Syncing local tags"
git fetch origin --tags --prune

if gh release view "${TAG}" --repo "${REPO}" >/dev/null 2>&1; then
  echo "==> Release still visible after tag delete, attempting explicit release delete"
  release_id="$(gh api "repos/${REPO}/releases/tags/${TAG}" --jq .id)"
  gh api -X DELETE "repos/${REPO}/releases/${release_id}"
  git fetch origin --tags --prune
fi

if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "Error: local tag ${TAG} still exists after cleanup" >&2
  exit 1
fi

if git ls-remote --tags origin "${TAG}" 2>/dev/null | grep -q "refs/tags/${TAG}$"; then
  echo "Error: remote tag ${TAG} still exists after cleanup" >&2
  exit 1
fi

if gh release view "${TAG}" --repo "${REPO}" >/dev/null 2>&1; then
  echo "Error: GitHub release ${TAG} still exists after cleanup" >&2
  exit 1
fi

echo "==> Release ${TAG} removed and tags synced"
