#!/usr/bin/env bash
#
# Sizes the container to the machine it landed on, then hands off to s6.
#
# The all-in-one runs four memory-hungry things side by side — Postgres, the
# Node API (which also forks an ONNX embedding child), the Next.js server, and a
# Python scan process — inside one memory limit. The Kubernetes defaults assume
# each of those has a pod to itself, so running them unchanged on a laptop is
# how you get an OOM kill or a stall. Everything below derives a budget from the
# container's real limits and splits it.
#
# Every value is a default: if the operator already set the variable, it is left
# alone. That is what makes the README's "override anything with -e" true.

set -euo pipefail

log() { printf '[classifyre] %s\n' "$*" >&2; }
die() { printf '[classifyre] FATAL: %s\n' "$*" >&2; exit 1; }

# Only set a variable when the operator has not.
default() {
  local name="$1" value="$2"
  if [ -z "${!name:-}" ]; then
    export "${name}=${value}"
  fi
}

# The image sets all of these, but `set -u` turns a missing one into a fatal
# error halfway through rather than a sensible fallback — and this script has to
# survive being run with a trimmed environment (a bare `docker run -e ...`, or
# the test harness). Establish the baseline before anything reads it.
: "${PG_MAJOR:=18}"
: "${PGDATA:=/var/lib/postgresql/data}"
: "${PGPORT:=5432}"
: "${POSTGRES_USER:=postgres}"
: "${POSTGRES_DB:=classifyre}"
: "${PORT_HTTP:=3000}"
: "${API_PORT:=8000}"
: "${WEB_PORT:=3100}"
export PG_MAJOR PGDATA PGPORT POSTGRES_USER POSTGRES_DB PORT_HTTP API_PORT WEB_PORT

# ── Detect the memory limit ───────────────────────────────────────────────────
# cgroup v2 first, then v1, then the host. A cgroup file can hold "max", and an
# unlimited v1 cgroup reports a number near 2^63, so anything above the host's
# own RAM is treated as "no limit" and we fall back to physical memory.
detect_memory_mb() {
  local host_mb bytes
  host_mb=$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo)

  for f in /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes; do
    [ -r "$f" ] || continue
    bytes=$(cat "$f" 2>/dev/null || echo max)
    [ "$bytes" = "max" ] && continue
    case "$bytes" in (*[!0-9]*) continue ;; esac
    local mb=$(( bytes / 1024 / 1024 ))
    if [ "$mb" -gt 0 ] && [ "$mb" -le "$host_mb" ]; then
      echo "$mb"
      return
    fi
  done

  echo "$host_mb"
}

# cgroup CPU quota if one is set (cpu.max is "<quota> <period>", or "max"),
# otherwise the visible processor count.
detect_cpus() {
  local quota period
  if [ -r /sys/fs/cgroup/cpu.max ]; then
    read -r quota period < /sys/fs/cgroup/cpu.max || true
    if [ "${quota:-max}" != "max" ] && [ "${period:-0}" -gt 0 ] 2>/dev/null; then
      local n=$(( (quota + period - 1) / period ))
      [ "$n" -ge 1 ] && { echo "$n"; return; }
    fi
  fi
  nproc 2>/dev/null || echo 2
}

TOTAL_MB=$(detect_memory_mb)
CPUS=$(detect_cpus)

# ── Memory floor ──────────────────────────────────────────────────────────────
# Refuse rather than half-boot. Below this the API cannot hold a working heap
# and run a scan at the same time, and the failure mode is a restart loop that
# looks like a product bug instead of a configuration one.
MIN_MB="${CLASSIFYRE_MIN_MEMORY_MB:-3584}"
if [ "$TOTAL_MB" -lt "$MIN_MB" ]; then
  cat >&2 <<EOF
[classifyre] FATAL: only ${TOTAL_MB} MB of memory is available to this container.

Classifyre needs at least ${MIN_MB} MB (4 GB), and is comfortable with 8 GB.

  Docker Desktop (macOS/Windows): Settings -> Resources -> Memory, then restart
                                  Docker and run the container again.
  docker run:                     raise or remove --memory
  Linux:                          this is the host's free memory

Set CLASSIFYRE_MIN_MEMORY_MB to override this check if you know what you are
doing — expect scans of anything but a handful of small files to fail.
EOF
  exit 1
fi

# ── Split the budget ──────────────────────────────────────────────────────────
# Three bands rather than a formula. A formula reads as precision this problem
# does not have, and the interesting behaviour is at the edges: a 4 GB container
# must leave room for a scan subprocess, and a 32 GB one must NOT hand V8 a
# proportional heap — a bigger ceiling means more garbage accrues before a major
# GC, and the process spends its time collecting instead of working (measured in
# docs/development/memory-sizing.md).
if   [ "$TOTAL_MB" -lt 6144 ];  then HEAP_MB=1536; PG_SHARED_MB=256; PG_WORK_MB=8;  RUNNERS=1; NS_JOBS=1
elif [ "$TOTAL_MB" -lt 10240 ]; then HEAP_MB=2048; PG_SHARED_MB=512; PG_WORK_MB=16; RUNNERS=1; NS_JOBS=2
else                                 HEAP_MB=2560; PG_SHARED_MB=768; PG_WORK_MB=16; RUNNERS=2; NS_JOBS=2
fi

# One core cannot usefully run two scans plus the embedding worker.
[ "$CPUS" -lt 2 ] && { RUNNERS=1; NS_JOBS=1; }
POOL_WORKERS=$(( CPUS > 4 ? 4 : (CPUS < 1 ? 1 : CPUS) ))

# ── Node heap and backpressure ────────────────────────────────────────────────
# An unset NODE_OPTIONS leaves V8 near a 512 MB default, and the API then dies
# with SIGSEGV 139 partway through an ingest — a JS heap OOM, which looks
# nothing like a container OOM kill in the logs. Set it explicitly.
if [ -z "${NODE_OPTIONS:-}" ]; then
  export NODE_OPTIONS="--max-old-space-size=${CLASSIFYRE_NODE_HEAP_MB:-${HEAP_MB}}"
fi
EFFECTIVE_HEAP_MB="${CLASSIFYRE_NODE_HEAP_MB:-${HEAP_MB}}"

# @fastify/under-pressure sheds ingestion when RSS crosses this. Its own default
# is 1 GB, which is below our heap ceiling and would latch the API into
# permanent 503s. The API's fair share here is what is left once Postgres, the
# web server and one scan subprocess are accounted for.
if [ -z "${UNDER_PRESSURE_MAX_RSS_BYTES:-}" ]; then
  api_share_mb=$(( TOTAL_MB - PG_SHARED_MB - 256 - 1536 - 256 ))
  rss_mb=$(( api_share_mb * 875 / 1000 ))
  floor_mb=$(( EFFECTIVE_HEAP_MB * 5 / 4 ))
  [ "$rss_mb" -lt "$floor_mb" ] && rss_mb="$floor_mb"
  export UNDER_PRESSURE_MAX_RSS_BYTES=$(( rss_mb * 1024 * 1024 ))
fi

# The invariant the Helm chart enforces at render time: if the heap ceiling is
# at or above the RSS guard, the JS heap alone trips isUnderPressure() and every
# ingestion endpoint 503s forever. Fail loudly instead of booting into that.
guard_mb=$(( UNDER_PRESSURE_MAX_RSS_BYTES / 1024 / 1024 ))
if [ "$EFFECTIVE_HEAP_MB" -ge "$guard_mb" ]; then
  die "Node heap ceiling (${EFFECTIVE_HEAP_MB} MB) must be below UNDER_PRESSURE_MAX_RSS_BYTES (${guard_mb} MB), or the API will reject every scan callback. Lower CLASSIFYRE_NODE_HEAP_MB or raise UNDER_PRESSURE_MAX_RSS_BYTES."
fi

# UNDER_PRESSURE_MAX_HEAP_USED_BYTES is deliberately left unset: heap-guard.ts
# derives 80% of the ceiling V8 *actually* enforces, which is more reliable than
# any number computed out here.

# ── Postgres ──────────────────────────────────────────────────────────────────
default PG_SHARED_BUFFERS       "${PG_SHARED_MB}MB"
default PG_WORK_MEM             "${PG_WORK_MB}MB"
default PG_EFFECTIVE_CACHE_SIZE "$(( TOTAL_MB / 2 ))MB"
default PG_MAINTENANCE_WORK_MEM "128MB"
# SSD-shaped default. The Postgres default of 4.0 describes a spinning disk and
# pushes the planner off index scans that are the right choice here.
default PG_RANDOM_PAGE_COST     "1.1"
default PG_MAX_CONNECTIONS      "100"

# ── Concurrency ───────────────────────────────────────────────────────────────
default MAX_CONCURRENT_RUNNERS        "${RUNNERS}"
default MAX_CONCURRENT_NAMESPACE_JOBS "${NS_JOBS}"
default MAX_RUNNERS_PER_SOURCE        "1"
default CLASSIFYRE_MAX_POOL_WORKERS   "${POOL_WORKERS}"
default EMBEDDING_BATCH_SIZE          "8"
default EMBEDDING_INTRA_OP_THREADS    "$(( CPUS > 2 ? 2 : 1 ))"
# One workspace resident is the norm here; the Kubernetes default of 20 would
# hold 20 connection pools open against a Postgres sized for a laptop.
default PRISMA_MAX_RESIDENT           "4"
default PRISMA_POOL_MAX               "8"
default PRISMA_INTERACTIVE_POOL_MAX   "4"

# ── /dev/shm ──────────────────────────────────────────────────────────────────
# Postgres puts parallel query workers' exchange buffers here. Docker's 64 MB
# default is far too small and surfaces as "could not resize shared memory
# segment" (SQLSTATE 53100) partway through an aggregate — a confusing failure
# with no obvious link to the container's configuration.
SHM_MB=$(df -m /dev/shm 2>/dev/null | awk 'NR==2 {print $2}' || echo 0)
if [ "${SHM_MB:-0}" -lt 256 ]; then
  log "WARNING: /dev/shm is only ${SHM_MB} MB. Large queries may fail with"
  log "         'could not resize shared memory segment' (SQLSTATE 53100)."
  log "         Re-run the container with --shm-size=1g."
  # Parallelism is what needs the segment, so turn it off rather than let a scan
  # die on an aggregate. Raising --shm-size is the real fix.
  default PG_MAX_PARALLEL_WORKERS_PER_GATHER "0"
fi

# ── Database ──────────────────────────────────────────────────────────────────
# No DATABASE_URL means "use the Postgres in this image". Setting one points the
# whole stack at an external server and the bundled one never starts.
if [ -z "${DATABASE_URL:-}" ]; then
  export CLASSIFYRE_BUNDLED_POSTGRES=1
  export DATABASE_URL="postgresql://${POSTGRES_USER}@127.0.0.1:${PGPORT}/${POSTGRES_DB}"
  log "Using the bundled PostgreSQL ${PG_MAJOR} server (data in ${PGDATA})."
else
  export CLASSIFYRE_BUNDLED_POSTGRES=0
  log "Using the external database from DATABASE_URL; bundled PostgreSQL disabled."
  log "It must have the pgvector extension available and allow CREATE SCHEMA."
fi

# The API tells scan subprocesses where to call back. ENVIRONMENT=docker already
# resolves this to 127.0.0.1:$PORT, but being explicit means a changed API_PORT
# cannot silently break ingestion.
default CLASSIFYRE_INTERNAL_API_URL "http://127.0.0.1:${API_PORT}"
default API_URL                     "http://127.0.0.1:${API_PORT}"

# ── Credential encryption key ─────────────────────────────────────────────────
# Every stored source credential and MCP token is encrypted with this. Generate
# once and keep it beside the data: regenerating it leaves the rows in place but
# permanently undecryptable. It lives under /var/lib/classifyre (a volume)
# rather than PGDATA so that pointing at an external database still persists it.
if [ -z "${CLASSIFYRE_MASKED_CONFIG_KEY:-}" ]; then
  key_file="${CLASSIFYRE_KEY_FILE:-/var/lib/classifyre/masked-config.key}"
  if [ -s "$key_file" ]; then
    CLASSIFYRE_MASKED_CONFIG_KEY="$(cat "$key_file")"
  else
    mkdir -p "$(dirname "$key_file")"
    CLASSIFYRE_MASKED_CONFIG_KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
    ( umask 077 && printf '%s' "$CLASSIFYRE_MASKED_CONFIG_KEY" > "$key_file" )
    chown 10001:10001 "$key_file"
    log "Generated a credential encryption key at ${key_file}."
    log "Back it up: without it, stored credentials cannot be recovered."
  fi
  export CLASSIFYRE_MASKED_CONFIG_KEY
fi

# Marks the CLI's callbacks as trusted so they bypass demo-mode write blocking.
if [ -z "${CLASSIFYRE_INTERNAL_KEY:-}" ]; then
  export CLASSIFYRE_INTERNAL_KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
fi

# ── Runtime directories ───────────────────────────────────────────────────────
# The Dockerfile creates these, but a mount replaces whatever the image had at
# that path: a named volume is seeded from the image, a *bind* mount is not — it
# arrives empty and root-owned. So TEMP_DIR disappears and the API's recipe
# write fails with ENOENT (a 400 on every scan start), and /cache/uv becomes
# unwritable so no optional Python group can install.
#
# Recreate them here instead, after the mounts are in place and while this is
# still root. Cheap, idempotent, and it makes bind mounts behave exactly like
# named volumes.
for dir in "${TEMP_DIR}" "${RUNNER_LOG_DIR}" "${UV_CACHE_DIR}" \
           "${PLAYWRIGHT_BROWSERS_PATH}" "${EMBEDDING_CACHE_DIR}"; do
  [ -n "${dir}" ] || continue
  mkdir -p "${dir}"
  # Only fix ownership when it is wrong: a large warm uv cache is not worth
  # walking on every boot.
  if [ "$(stat -c '%u' "${dir}")" != "10001" ]; then
    chown -R 10001:10001 "${dir}"
  fi
done

# ── Report ────────────────────────────────────────────────────────────────────
log "memory=${TOTAL_MB}MB cpus=${CPUS} shm=${SHM_MB}MB"
log "node heap=${EFFECTIVE_HEAP_MB}MB rss guard=${guard_mb}MB"
log "postgres shared_buffers=${PG_SHARED_BUFFERS} work_mem=${PG_WORK_MEM} effective_cache_size=${PG_EFFECTIVE_CACHE_SIZE}"
log "scans: ${MAX_CONCURRENT_RUNNERS} concurrent, ${CLASSIFYRE_MAX_POOL_WORKERS} worker(s) each"
log "listening on :${PORT_HTTP}"

exec /init "$@"
