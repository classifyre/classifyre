#!/usr/bin/env bash
# Reclaim disk on the single-node k3s VPS to prevent DiskPressure evictions.
#
# Usage:
#   ./scripts/vps-disk-cleanup.sh                 # safe cleanup (default)
#   ./scripts/vps-disk-cleanup.sh --dry-run       # report only, change nothing
#   ./scripts/vps-disk-cleanup.sh --deep          # also VACUUM FULL + purge uv cache
#   ./scripts/vps-disk-cleanup.sh --skip-db       # host/k8s cleanup only
#
# Everything runs through kubectl (no SSH needed). Host-level commands are
# executed via a short-lived privileged pod that nsenters the node's namespaces.

set -euo pipefail

KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config-classifyre-vps}"
export KUBECONFIG

DRY_RUN=false
DEEP=false
SKIP_DB=false
JOB_RETENTION_HOURS="${JOB_RETENTION_HOURS:-24}"   # finished k8s Jobs older than this are deleted
PGBOSS_RETENTION_DAYS="${PGBOSS_RETENTION_DAYS:-7}" # matches pg-boss deletion_seconds default
HELPER_POD="disk-cleanup-helper"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --deep) DEEP=true ;;
    --skip-db) SKIP_DB=true ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
info() { printf '   %s\n' "$*"; }
run()  { if $DRY_RUN; then info "[dry-run] $*"; else "$@"; fi; }

NODE="$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')"

# ---------------------------------------------------------------------------
# helper pod: gives us host-level shell access without SSH
# ---------------------------------------------------------------------------
helper_up() {
  if kubectl get pod "$HELPER_POD" -n default >/dev/null 2>&1; then
    kubectl delete pod "$HELPER_POD" -n default --wait=true >/dev/null 2>&1 || true
  fi
  kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: $HELPER_POD
  namespace: default
spec:
  restartPolicy: Never
  hostPID: true
  nodeName: $NODE
  tolerations: [{operator: "Exists"}]
  containers:
    - name: shell
      image: busybox:1.36
      command: ["sleep", "900"]
      securityContext: { privileged: true }
      volumeMounts: [{ name: host, mountPath: /host }]
  volumes:
    - name: host
      hostPath: { path: / }
EOF
  kubectl wait --for=condition=Ready "pod/$HELPER_POD" -n default --timeout=120s >/dev/null
}

helper_down() {
  kubectl delete pod "$HELPER_POD" -n default --wait=false >/dev/null 2>&1 || true
}
trap helper_down EXIT

# Run a command in the node's root namespaces.
on_host() { kubectl exec "$HELPER_POD" -n default -- nsenter -t 1 -m -u -i -n -p -- sh -c "$1"; }

disk_free_bytes() { on_host "df --output=avail -B1 / | tail -1" | tr -d ' \r'; }

# ---------------------------------------------------------------------------
log "Node: $NODE"
helper_up
BEFORE="$(disk_free_bytes)"
on_host "df -h /"

# ---------------------------------------------------------------------------
log "1/6  Deleting failed, evicted and orphaned pods"
kubectl get pods -A --no-headers \
  | awk '$4 ~ /^(Error|Evicted|Completed|ContainerStatusUnknown|Init:ContainerStatusUnknown|NodeAffinity|OutOfcpu|OutOfmemory)$/ {print $1, $2}' \
  | while read -r ns pod; do
      info "$ns/$pod"
      run kubectl delete pod -n "$ns" "$pod" --wait=false >/dev/null 2>&1 || true
    done

# ---------------------------------------------------------------------------
log "2/6  Deleting finished Jobs older than ${JOB_RETENTION_HOURS}h"
CUTOFF="$(date -u -v-"${JOB_RETENTION_HOURS}"H +%s 2>/dev/null || date -u -d "-${JOB_RETENTION_HOURS} hours" +%s)"
kubectl get jobs -A -o json \
  | jq -r --argjson cutoff "$CUTOFF" '
      .items[]
      | select((.status.succeeded // 0) > 0 or (.status.failed // 0) > 0)
      | select(((.status.completionTime // .status.conditions[-1].lastTransitionTime // "1970-01-01T00:00:00Z")
                | fromdateiso8601) < $cutoff)
      | .metadata.namespace + " " + .metadata.name' \
  | while read -r ns job; do
      info "$ns/$job"
      run kubectl delete job -n "$ns" "$job" --wait=false >/dev/null 2>&1 || true
    done

# ---------------------------------------------------------------------------
log "3/6  Pruning containerd (k3s) images and dead containers"
if $DRY_RUN; then
  on_host "k3s crictl images | tail -n +2 | wc -l | xargs echo '   images on node:'"
else
  on_host "k3s crictl rm --all >/dev/null 2>&1; k3s crictl rmp --all >/dev/null 2>&1; k3s crictl rmi --prune 2>&1 | tail -3; true"
fi

# ---------------------------------------------------------------------------
log "4/6  Pruning Docker (separate daemon on this host) and rotating logs"
if $DRY_RUN; then
  on_host "docker system df 2>/dev/null || echo '   docker not present'"
else
  on_host "
    if command -v docker >/dev/null 2>&1; then
      docker container prune -f 2>&1 | tail -1
      docker image prune -f     2>&1 | tail -1
      docker builder prune -af  2>&1 | tail -1
      docker network prune -f >/dev/null 2>&1
      find /var/lib/docker/containers -name '*-json.log' -size +10M -exec truncate -s 0 {} \; 2>/dev/null
    fi
    journalctl --vacuum-size=100M 2>&1 | tail -1
    find /var/log/pods -name '*.log.*' -mtime +3 -delete 2>/dev/null
    apt-get clean 2>/dev/null; rm -rf /var/cache/apt/archives/*.deb 2>/dev/null
    true"
fi

# ---------------------------------------------------------------------------
log "5/6  Pruning pg-boss job history (> ${PGBOSS_RETENTION_DAYS} days)"
if $SKIP_DB; then
  info "skipped (--skip-db)"
else
  # Every Classifyre release namespace runs its own Postgres pod.
  kubectl get pods -A --no-headers \
    | awk '$4 == "Running" && $2 ~ /postgres/ {print $1, $2}' \
    | while read -r ns pod; do
        info "$ns/$pod"
        # Discover pgboss schemas dynamically: one per Classifyre namespace.
        SCHEMAS="$(kubectl exec -n "$ns" "$pod" -- sh -c \
          'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT nspname FROM pg_namespace WHERE nspname LIKE '"'"'pgboss%'"'"'"' 2>/dev/null | tr -d '\r')"
        [ -z "$SCHEMAS" ] && { info "  no pgboss schemas"; continue; }

        for schema in $SCHEMAS; do
          SQL="DELETE FROM \"$schema\".job_common
               WHERE state IN ('completed','failed','cancelled')
                 AND completed_on < now() - interval '${PGBOSS_RETENTION_DAYS} days';"
          if $DEEP; then
            SQL="$SQL VACUUM (FULL, ANALYZE) \"$schema\".job_common;"
          else
            SQL="$SQL VACUUM (ANALYZE) \"$schema\".job_common;"
          fi
          if $DRY_RUN; then
            info "  [dry-run] prune $schema"
          else
            printf '%s\n' "$SQL" \
              | kubectl exec -i -n "$ns" "$pod" -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' 2>&1 \
              | grep -E '^(DELETE|ERROR)' | sed "s/^/     $schema: /" || true
          fi
        done
      done
  $DEEP || info "(plain VACUUM only — rerun with --deep to actually shrink the files)"
fi

# ---------------------------------------------------------------------------
log "6/6  uv package cache"
if $DEEP && ! $DRY_RUN; then
  RUNNING_CLI="$(kubectl get pods -A --no-headers | grep -c 'classifyre-extract.*Running' || true)"
  if [ "$RUNNING_CLI" -gt 0 ]; then
    info "skipped — $RUNNING_CLI extraction job(s) running, cache is in use"
  else
    on_host "rm -rf /var/lib/rancher/k3s/storage/*cli-uv-cache/* 2>/dev/null; true"
    info "purged (next CLI run re-downloads its wheels)"
  fi
else
  info "kept (use --deep to purge; it is only a wheel cache)"
fi

# ---------------------------------------------------------------------------
AFTER="$(disk_free_bytes)"
log "Result"
on_host "df -h /"
if ! $DRY_RUN; then
  printf '   reclaimed: %s MB\n' "$(( (AFTER - BEFORE) / 1024 / 1024 ))"
fi

log "Largest consumers (for when this is not enough)"
on_host "du -sh /var/lib/rancher/k3s/storage/* 2>/dev/null | sort -rh | head -5
         du -sh /var/lib/rancher/k3s/agent/containerd /var/lib/docker /home/* 2>/dev/null | sort -rh | head -5"
