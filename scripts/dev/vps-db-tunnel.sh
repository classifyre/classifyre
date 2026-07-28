#!/usr/bin/env bash
# Expose the VPS instance's Postgres to the local k3d cluster.
#
# The tunnel runs as a container attached to k3d's Docker network rather than
# as a plain `kubectl port-forward` on the host. A host port-forward bound to
# 127.0.0.1 is unreachable from inside the k3d node, and binding it to 0.0.0.0
# would publish a production database to every network the laptop is on. Inside
# a container on the k3d network it is reachable by the cluster and by nothing
# else: no host port is published.
#
# Usage:
#   scripts/dev/vps-db-tunnel.sh start    # start (idempotent), print its IP
#   scripts/dev/vps-db-tunnel.sh ip       # print the IP only
#   scripts/dev/vps-db-tunnel.sh status
#   scripts/dev/vps-db-tunnel.sh logs
#   scripts/dev/vps-db-tunnel.sh stop
set -euo pipefail

KUBECONFIG_VPS="${KUBECONFIG_VPS:-${HOME}/.kube/config-classifyre-vps}"
VPS_NAMESPACE="${VPS_NAMESPACE:-classifyre}"
VPS_PG_SERVICE="${VPS_PG_SERVICE:-classifyre-postgres}"
VPS_PG_PORT="${VPS_PG_PORT:-5432}"
K3D_NETWORK="${K3D_NETWORK:-k3d-classifyre}"
CONTAINER_NAME="${CONTAINER_NAME:-classifyre-vps-db-tunnel}"
KUBECTL_IMAGE="${KUBECTL_IMAGE:-bitnami/kubectl:latest}"

log() { echo "[vps-db-tunnel] $*" >&2; }

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    log "docker is required."
    exit 1
  fi
}

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null || echo false)" == "true" ]]
}

container_ip() {
  docker inspect \
    -f "{{(index .NetworkSettings.Networks \"${K3D_NETWORK}\").IPAddress}}" \
    "${CONTAINER_NAME}" 2>/dev/null
}

start() {
  require_docker

  if [[ ! -f "${KUBECONFIG_VPS}" ]]; then
    log "VPS kubeconfig not found: ${KUBECONFIG_VPS}"
    log "Set KUBECONFIG_VPS to override."
    exit 1
  fi

  if ! docker network inspect "${K3D_NETWORK}" >/dev/null 2>&1; then
    log "Docker network ${K3D_NETWORK} does not exist."
    log "Create the cluster first: ./scripts/dev/create-cluster.sh"
    exit 1
  fi

  if container_running; then
    log "Already running."
    container_ip
    return 0
  fi

  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

  # --address 0.0.0.0 binds inside this container's own network namespace only;
  # no port is published to the host.
  docker run -d \
    --name "${CONTAINER_NAME}" \
    --network "${K3D_NETWORK}" \
    --restart unless-stopped \
    -v "${KUBECONFIG_VPS}:/.kube/config:ro" \
    -e KUBECONFIG=/.kube/config \
    --entrypoint kubectl \
    "${KUBECTL_IMAGE}" \
    port-forward \
    --address 0.0.0.0 \
    --namespace "${VPS_NAMESPACE}" \
    "svc/${VPS_PG_SERVICE}" \
    "${VPS_PG_PORT}:${VPS_PG_PORT}" >/dev/null

  # port-forward exits non-zero on a bad context/RBAC; catch that here rather
  # than letting Helm deploy against a tunnel that is already dead.
  for _ in $(seq 1 20); do
    if ! container_running; then
      log "Tunnel container exited. Logs:"
      docker logs "${CONTAINER_NAME}" 2>&1 | tail -20 >&2
      docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
      exit 1
    fi
    if docker logs "${CONTAINER_NAME}" 2>&1 | grep -q "Forwarding from"; then
      break
    fi
    sleep 0.5
  done

  local ip
  ip="$(container_ip)"
  if [[ -z "${ip}" ]]; then
    log "Could not determine tunnel IP on network ${K3D_NETWORK}."
    exit 1
  fi

  log "Forwarding ${VPS_NAMESPACE}/${VPS_PG_SERVICE}:${VPS_PG_PORT} -> ${ip}:${VPS_PG_PORT} (k3d network only)"
  echo "${ip}"
}

case "${1:-start}" in
  start) start ;;
  ip)
    if ! container_running; then
      log "Tunnel is not running."
      exit 1
    fi
    container_ip
    ;;
  status)
    if container_running; then
      log "running at $(container_ip)"
    else
      log "not running"
      exit 1
    fi
    ;;
  logs) docker logs -f "${CONTAINER_NAME}" ;;
  stop)
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 && log "Stopped." || log "Not running."
    ;;
  *)
    log "Unknown command: $1 (expected start|ip|status|logs|stop)"
    exit 1
    ;;
esac
