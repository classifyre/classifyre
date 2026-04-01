#!/usr/bin/env bash

load_repo_secrets() {
  local repo_root="$1"
  local secrets_file="${repo_root}/.secrets"

  if [[ ! -f "${secrets_file}" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "${secrets_file}"
  set +a
}
