#!/usr/bin/env bash
# Sets up the `classifyre` realm on every start: the same script the Helm
# chart's setup job runs (helm/classifyre/files/iam/setup-realm.sh), with the
# all-in-one's simple settings. It waits for the identity server itself.
#
# The first tenant admin is $CLASSIFYRE_ADMIN_USER with the documented
# password (admin / admin by default), marked temporary so Keycloak asks for a
# new password on first sign-in. The realm setup never resets it once the
# account exists. Set CLASSIFYRE_ADMIN_PASSWORD_TEMPORARY=false to skip the
# first-sign-in prompt in automated environments.
set -euo pipefail

exec s6-setuidgid classifyre env \
  HOME=/home/classifyre \
  IAM_INTERNAL_URL="http://127.0.0.1:${IAM_PORT:-8180}/iam" \
  IAM_REALM="${IAM_REALM:-classifyre}" \
  IAM_APP_URL="${CLASSIFYRE_URL}" \
  IAM_ACCESS_TOKEN_LIFESPAN="${IAM_ACCESS_TOKEN_LIFESPAN:-300}" \
  IAM_TENANT_ALIAS="${IAM_BOOTSTRAP_TENANT:-default}" \
  IAM_TENANT_NAME="${IAM_BOOTSTRAP_TENANT_NAME:-Default}" \
  IAM_THEME=classifyre \
  IAM_REALM_CONSOLE="${IAM_REALM_CONSOLE:-true}" \
  IAM_SSL_REQUIRED="${IAM_SSL_REQUIRED}" \
  IAM_ADMIN_USER="${CLASSIFYRE_ADMIN_USER}" \
  IAM_ADMIN_PASSWORD="${CLASSIFYRE_ADMIN_PASSWORD}" \
  IAM_API_CLIENT_SECRET="${IAM_API_CLIENT_SECRET}" \
  IAM_WEB_CLIENT_SECRET="${IAM_WEB_CLIENT_SECRET}" \
  IAM_BOOTSTRAP_ADMIN="${CLASSIFYRE_ADMIN_USER}" \
  IAM_BOOTSTRAP_ADMIN_PASSWORD="${CLASSIFYRE_ADMIN_PASSWORD}" \
  IAM_BOOTSTRAP_ADMIN_TEMPORARY="${CLASSIFYRE_ADMIN_PASSWORD_TEMPORARY:-true}" \
  IAM_BOOTSTRAP_ADMIN_EMAIL="${CLASSIFYRE_ADMIN_EMAIL:-admin@classifyre.example}" \
  IAM_BOOTSTRAP_ADMIN_FIRST_NAME=Classifyre \
  IAM_BOOTSTRAP_ADMIN_LAST_NAME=Admin \
  IAM_BOOTSTRAP_ADMIN_OPERATOR=true \
  bash /opt/classifyre/iam/setup-realm.sh
