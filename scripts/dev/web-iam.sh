#!/usr/bin/env bash
# Runs the web app locally (http://localhost:3000) against the dev stack
# (`./scripts/dev/start.sh`). Sign-in is always on, so the web app needs the
# identity server's settings; the web client's secret is read from the
# cluster, so nothing is written to disk.
#
# Over wifi: `bun run web-iam:dev:lan` (or `LAN=1 ./scripts/dev/web-iam.sh`)
# binds the dev server to all interfaces and uses this machine's Bonjour name
# (mac.local, else its LAN IP) as the app address (override with
# LAN_HOST=192.168.x.y). The identity client must also accept that address as a
# redirect URI (the dev stack registers only http://localhost:3000), so LAN
# mode adds the Bonjour name and the IP to the classifyre-web client on every
# start (the IP can change; `iam-register-app-hosts.sh` does it).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NS=${CLASSIFYRE_NAMESPACE:-classifyre-dev}

secret=$(kubectl --context k3d-classifyre -n "$NS" get secret classifyre-iam \
  -o jsonpath='{.data.web-client-secret}' 2>/dev/null | base64 -d || true)
if [ -z "$secret" ]; then
  echo "No classifyre-iam Secret in $NS: start the dev stack first (./scripts/dev/start.sh)." >&2
  exit 1
fi

cd "$ROOT/apps/web"
export IAM_REALM=classifyre
if [ "${LAN:-}" = "1" ]; then
  # Prefer the Bonjour name (mac.local): unlike the IP it does not change, so
  # the registered redirect URI keeps working. Fall back to the IP.
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
  BONJOUR=$(scutil --get LocalHostName 2>/dev/null || true)
  LAN_HOST=${LAN_HOST:-${BONJOUR:+$BONJOUR.local}}
  LAN_HOST=${LAN_HOST:-$LAN_IP}
  if [ -z "$LAN_HOST" ]; then
    echo "No LAN IP found: set LAN_HOST=<your ip>." >&2
    exit 1
  fi
  APP_HOST=$LAN_HOST
  kc_pod=$(kubectl --context k3d-classifyre -n "$NS" get pod -l app.kubernetes.io/component=iam \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  if [ -n "$kc_pod" ]; then
    # Both names reach this machine, so both must be registered, not only the
    # one the app address is built from.
    admin_pw=$(kubectl --context k3d-classifyre -n "$NS" get secret classifyre-iam \
      -o jsonpath='{.data.admin-password}' | base64 -d)
    hosts=("$APP_HOST")
    if [ -n "$LAN_IP" ] && [ "$LAN_IP" != "$APP_HOST" ]; then hosts+=("$LAN_IP"); fi
    kubectl --context k3d-classifyre -n "$NS" exec -i "$kc_pod" -- \
      bash -c "$(cat "$ROOT/scripts/dev/iam-register-app-hosts.sh")" register "${hosts[@]}" \
      <<<"$admin_pw" >&2
  else
    echo "identity pod not found: add http://$APP_HOST:3000/auth/callback to the classifyre-web client by hand." >&2
  fi
  echo "Open http://$APP_HOST:3000 from any device on the same wifi." >&2
else
  APP_HOST=localhost
fi
export IAM_APP_URL=http://$APP_HOST:3000
# The issuer is always the app's own address plus the proxied `/iam` path —
# nothing separate to configure. Token calls go over the skaffold
# port-forward instead, since the in-cluster DNS name only resolves
# inside the cluster.
export IAM_ISSUER_URL="$IAM_APP_URL/iam/realms/$IAM_REALM"
export IAM_INTERNAL_URL=http://localhost:8280/iam
export IAM_WEB_CLIENT_ID=classifyre-web
export IAM_WEB_CLIENT_SECRET="$secret"
# Same settings as the API's (the dev values): which identity consoles the
# `/iam` proxy forwards.
api_env() {
  kubectl --context k3d-classifyre -n "$NS" get deploy classifyre-api \
    -o jsonpath="{.spec.template.spec.containers[0].env[?(@.name==\"$1\")].value}" 2>/dev/null || true
}
IAM_REALM_CONSOLE=$(api_env IAM_REALM_CONSOLE)
IAM_EXPOSE_ADMIN_CONSOLE=$(api_env IAM_EXPOSE_ADMIN_CONSOLE)
export IAM_REALM_CONSOLE IAM_EXPOSE_ADMIN_CONSOLE
# The dev identity server follows the request host (iam.dynamicHostname) and
# the API is told so by the same flag; the web app's `/iam` proxy needs it too,
# else it sends the /iam prefix the server then doubles. Not only in LAN mode:
# the dev values turn it on for the whole stack.
IAM_ISSUER_ANY_HOST=$(api_env IAM_ISSUER_ANY_HOST)
export IAM_ISSUER_ANY_HOST
if [ "${LAN:-}" = "1" ]; then
  export NEXT_ALLOWED_DEV_ORIGIN=$APP_HOST${LAN_IP:+,$LAN_IP}
  exec bun dev -H 0.0.0.0
fi
exec bun dev
