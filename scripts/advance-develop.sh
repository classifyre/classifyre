#!/usr/bin/env bash
# Brings develop up to date after a release.
#
#   scripts/advance-develop.sh v1.2.3 1.2.4
#
# Merges the release tag into develop as origin has it now (a release takes
# half an hour and commits can land meanwhile), sets <next-version>-SNAPSHOT
# and pushes. A plain fast-forward when develop did not move. Running it again
# changes nothing, so it is also how to repair a release that stopped before
# this step. It works on a detached HEAD and never touches a local branch.
set -euo pipefail

# In a function so that bash has read all of it before the checkout replaces
# this file.
main() {
  local usage="usage: advance-develop.sh <release-tag> <next-version>"
  local tag=${1:?$usage}
  local next=${2:?$usage}
  if ! [[ ${next} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "next version must be major.minor.patch, got '${next}'" >&2
    exit 2
  fi

  cd "$(git rev-parse --show-toplevel)"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "the working tree has uncommitted changes; commit or stash them first" >&2
    exit 1
  fi

  git fetch --quiet --tags origin
  git rev-parse --quiet --verify "refs/tags/${tag}" >/dev/null || {
    echo "no such tag: ${tag}" >&2
    exit 1
  }

  local start attempt base
  start=$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)

  for attempt in 1 2 3 4 5; do
    git fetch --quiet origin develop
    git checkout --quiet --detach origin/develop
    git merge --no-edit -m "chore(release): merge ${tag} back into develop" "${tag}"

    # Never move a version backwards: develop may already be at or past it.
    base=$(node -p "require('./package.json').version.split('-')[0]")
    if [[ ${base} != "${next}" && "$(printf '%s\n%s\n' "${base}" "${next}" | sort -V | head -n 1)" == "${base}" ]]; then
      node scripts/set-release-version.mjs "${next}-SNAPSHOT"
      # `uv lock` keeps every pinned dependency and records the new version.
      (cd apps/cli && uv lock)
      (cd packages/schemas && uv lock)
      git add --update
      git commit -m "chore: set develop to v${next}-SNAPSHOT"
    fi

    if git push origin HEAD:develop; then
      git checkout --quiet "${start}"
      return 0
    fi
    echo "develop moved while pushing (attempt ${attempt}); trying again" >&2
  done

  git checkout --quiet "${start}"
  echo "could not push develop after 5 attempts" >&2
  exit 1
}

main "$@"
