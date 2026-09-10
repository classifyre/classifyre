# Classifyre — all-in-one Docker image

The whole product in one container: the web UI, the API, the background worker,
the Python scan workers, and a PostgreSQL database. One `docker run`, no
dependencies to provision, nothing to connect.

This is the fastest way to try Classifyre on real data, and it is a reasonable
way to run it for a single investigator. For a team, or for anything that has to
survive a machine dying, use the [Helm chart](../helm/classifyre) instead — it
runs the same code as separate, independently scalable workloads.

---

## Quickstart

```bash
docker run -d --name classifyre \
  -p 3000:3000 \
  --shm-size=1g \
  -v classifyre-pgdata:/var/lib/postgresql/data \
  -v classifyre-data:/var/lib/classifyre \
  -v classifyre-uv-cache:/cache/uv \
  classifyre/all-in-one:latest
```

Then open **http://localhost:3000**.

The first boot initialises the database, applies the migrations and creates a
workspace called `default`. On a laptop that takes a few minutes; the container
reports `starting` until it is done. Watch it with:

```bash
docker logs -f classifyre
```

Nothing leaves your machine. There is no account, no signup, and no telemetry
you have not opted into.

### What to do next

1. **Add a source** — a folder you mounted, an S3 bucket, Confluence, Jira, a
   Git repository, a database. Sources live under *Sources → New*.
2. **Turn on detectors** — these decide what counts as a finding.
3. **Run a scan**, then work the findings into cases.

---

## Requirements

|  | |
|---|---|
| **Memory** | **4 GB minimum**, 8 GB recommended. The container refuses to start below 4 GB rather than dying halfway through your first scan. |
| **CPU** | 2 cores minimum. Scans are CPU-bound. |
| **Disk** | ~10 GB for the image and the database, plus room for what you scan. |
| **Shared memory** | `--shm-size=1g`. See [troubleshooting](#dev-shm-is-too-small). |

On **macOS and Windows**, Docker Desktop caps what containers may use, and its
default is often 2 GB — below the floor. Raise it in **Settings → Resources →
Memory**, then restart Docker.

On **Linux**, the container sees the host's memory unless you pass `--memory`.

The image runs on `linux/amd64` and `linux/arm64` (Apple Silicon included), with
no emulation on either.

---

## What is inside

| Process | Port | What it is |
|---|---|---|
| Caddy | **3000** | the only published port; routes to the two servers below |
| Web UI | 3100 (internal) | Next.js, and the bundled documentation at `/docs` |
| API + worker | 8000 (internal) | REST, WebSockets, job queues, embeddings, and the parent of every scan |
| PostgreSQL 18 + pgvector | 5432 (internal) | all data |

They are supervised by [s6-overlay](https://github.com/just-containers/s6-overlay),
which restarts anything that dies and makes `docker stop` and `docker restart`
behave the way you expect.

Only port 3000 is reachable. Postgres binds to loopback inside the container's
own network namespace and is not exposed, deliberately.

The Python scan workers are not a service: the API starts one process per scan
and it exits when the scan does — the same lifecycle the Helm chart gets from
Kubernetes Jobs.

---

## Scanning a folder on your machine

Mount it, then point a source at the path *inside* the container:

```bash
docker run -d --name classifyre \
  -p 3000:3000 --shm-size=1g \
  -v classifyre-pgdata:/var/lib/postgresql/data \
  -v classifyre-data:/var/lib/classifyre \
  -v classifyre-uv-cache:/cache/uv \
  -v "$HOME/Documents/case-files:/data/case-files:ro" \
  classifyre/all-in-one:latest
```

In the UI: **Sources → New → Mounted Folder**, path `/data/case-files`.

Mount read-only (`:ro`) unless you have a reason not to. Classifyre only ever
reads from a folder source, and `:ro` makes that guarantee the filesystem's
rather than the application's.

---

## Configuration

Everything is an environment variable, and everything has a working default.
Pass them with `-e NAME=value`, or put them in a file and use `--env-file`.

### Core

| Variable | Default | Purpose |
|---|---|---|
| `PORT_HTTP` | `3000` | Port inside the container. Usually easier to remap with `-p 8080:3000`. |
| `CLASSIFYRE_BOOTSTRAP_NAMESPACE` | `default` | Slug of the workspace created on first boot. Set to `""` to create your own in the UI. |
| `CLASSIFYRE_MASKED_CONFIG_KEY` | *generated* | Encrypts stored source credentials and MCP tokens. See [backup](#backup). |
| `DEMO_MODE` | `false` | Read-only mode. Blocks every write; for a shared demo instance. |
| `TELEMETRY_DISABLED` / `DO_NOT_TRACK` | unset | Set either to `1` to disable anonymous usage telemetry. |
| `CORS_ORIGIN` | same-origin | Only needed if you serve the UI from another host. |

### Database

Leave these unset to use the PostgreSQL server inside the image.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | *bundled* | Set it and the bundled server never starts. See [external Postgres](#using-an-external-postgresql). |
| `POSTGRES_DB` | `classifyre` | Database name (bundled server only). |
| `PGDATA` | `/var/lib/postgresql/data` | Data directory (bundled server only). |
| `CLASSIFYRE_AUTO_MIGRATE` | `true` | `false` skips migrations at startup. Only useful if you run them yourself. |

### Object storage (S3, MinIO, R2, …)

Scan logs are written to disk by default. Point them at object storage if you
would rather keep them there — useful when the container is disposable but the
logs are not.

| Variable | Default | Purpose |
|---|---|---|
| `S3_BUCKET` | unset | Setting this switches scan logs from disk to S3. |
| `S3_ENDPOINT` | AWS | Required for MinIO, R2, Backblaze, Garage, and anything else non-AWS. |
| `S3_REGION` | `us-east-1` | |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | unset | Omit both to use the instance/ambient credential chain. |
| `S3_FORCE_PATH_STYLE` | `true` | Required by MinIO and most self-hosted providers. Set `false` for AWS. |
| `S3_LOG_PREFIX` | `runner-logs/` | Key prefix. |

```bash
-e S3_BUCKET=classifyre-logs \
-e S3_ENDPOINT=http://minio.local:9000 \
-e S3_ACCESS_KEY_ID=… -e S3_SECRET_ACCESS_KEY=… \
-e S3_FORCE_PATH_STYLE=true
```

### Embeddings

The image ships with a small embedding model already baked in
(`Xenova/all-MiniLM-L6-v2`, 384 dimensions) and runs it on the CPU, so semantic
search and duplicate detection work offline out of the box.

| Variable | Default | Purpose |
|---|---|---|
| `EMBEDDING_PROVIDER` | `transformers-js` | `openai-compatible` to use a remote service instead. |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` | unset | The remote endpoint, when using `openai-compatible`. |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Changing this re-embeds everything. |
| `EMBEDDING_ALLOW_REMOTE_MODELS` | `false` | `true` lets it download a different local model at runtime. |
| `EMBEDDING_BATCH_SIZE` | *autotuned* | Lower it if embedding is starving your scans. |

> **AI providers** (for LLM detectors and the investigation autopilot) are *not*
> environment variables. They are per-workspace settings, configured in the UI
> under **Settings → AI providers**, and their API keys are encrypted at rest.

### Resources

The container measures the memory and CPU it was given and sizes itself
accordingly. Override any of these only if you have a reason to.

| Variable | Purpose |
|---|---|
| `CLASSIFYRE_NODE_HEAP_MB` | Node heap ceiling. **Bigger is not better** — see [tuning](#resource-tuning). |
| `PG_SHARED_BUFFERS`, `PG_WORK_MEM`, `PG_EFFECTIVE_CACHE_SIZE`, `PG_MAX_CONNECTIONS` | PostgreSQL memory. |
| `MAX_CONCURRENT_RUNNERS` | Scans running at once. |
| `CLASSIFYRE_MAX_POOL_WORKERS` | Detector worker processes per scan. |
| `CLASSIFYRE_MIN_MEMORY_MB` | The 4 GB startup floor. Lower it at your own risk. |

The startup log prints exactly what it chose:

```
[classifyre] memory=8192MB cpus=4 shm=1024MB
[classifyre] node heap=2048MB rss guard=5031MB
[classifyre] postgres shared_buffers=512MB work_mem=16MB effective_cache_size=4096MB
[classifyre] scans: 1 concurrent, 4 worker(s) each
```

---

## Using an external PostgreSQL

```bash
-e DATABASE_URL="postgresql://user:pass@db.internal:5432/classifyre?sslmode=require"
```

The bundled server then never starts, and its volume is unused.

The server must have **pgvector** available, and the user must be able to
`CREATE SCHEMA` and `CREATE EXTENSION` — Classifyre gives every workspace its
own schema and creates them on demand. `pgvector/pgvector:0.8.5-pg18-bookworm`
is the image the Helm chart uses and the one this is tested against.

Migrations run automatically on startup, against a database-wide advisory lock,
so it is safe to point more than one container at the same database.

---

## Resource tuning

Four memory-hungry things share one limit here: PostgreSQL, the Node API (which
also forks a child for embeddings), the web server, and a Python scan process.
The container splits the budget between them at startup.

The counter-intuitive part is the **Node heap**. Raising it past ~2.5 GB usually
makes things *worse*: a larger ceiling means more garbage accumulates before V8
decides to collect, and the process spends its time in major GC instead of
working. If ingestion feels slow, the fix is more concurrency headroom or a
faster disk, not a bigger heap.

If a scan is being killed, give the container more memory rather than moving the
internal splits — they are proportional to what it has.

---

## Upgrades

```bash
docker pull classifyre/all-in-one:latest
docker rm -f classifyre
# …then the same `docker run` as before, with the same volumes
```

Your data is in the volumes, so it carries over. Database migrations run
automatically on the first boot of the new version.

Pin a version (`classifyre/all-in-one:0.4.137`) if you would rather decide when
to upgrade. Downgrading is not supported — migrations only go forwards.

## Backup

Two things matter, and you need both:

```bash
# 1. The database
docker exec classifyre pg_dump -U postgres classifyre > classifyre.sql

# 2. The credential encryption key
docker exec classifyre cat /var/lib/classifyre/masked-config.key
```

Without the key, a restored dump still has every stored source credential —
encrypted, and permanently unreadable. Keep it somewhere you would keep a
password. Restore it with `-e CLASSIFYRE_MASKED_CONFIG_KEY=…`.

---

## Troubleshooting

### It exits immediately saying there is not enough memory

Docker is capping the container below 4 GB. On Docker Desktop, raise
**Settings → Resources → Memory** and restart Docker. On Linux, check for a
`--memory` flag.

### `/dev/shm` is too small

You will see a warning at startup, and large queries may fail with
`could not resize shared memory segment` (SQLSTATE 53100). PostgreSQL puts
parallel-query buffers in `/dev/shm`, and Docker's default is 64 MB.

Add `--shm-size=1g`. The container disables query parallelism when it detects
the small default, which avoids the crash at the cost of slower queries.

### The first scan is slow

Two things happen once, on the first scan that needs them:

- **Optional Python dependencies** (OCR, ML detectors) install on demand. They
  are cached in `/cache/uv` — keep that volume and it only happens once.
- **Detector models** download the first time a detector that needs one runs.

### Legacy `.doc` / `.xls` / `.ppt` files

These are handled by LibreOffice, which is in the image. If one still comes back
empty, read the extraction error in the scan log rather than assuming the format
is unsupported.

### Looking at the logs

```bash
docker logs -f classifyre                 # everything
docker exec classifyre s6-rc -a list      # which services are up
```

Scan logs are in the UI, per run, and on disk under `/var/lib/classifyre/runner-logs`.

---

## Moving to Kubernetes

Nothing here is a dead end. Export a workspace from this container and import it
into a cluster install — sources, findings, cases and lineage all move
([`docs/architecture`](../docs/architecture)). The [Helm chart](../helm/classifyre)
runs the same images this one is composed from.

---

## Building it yourself

`docker/Dockerfile` builds nothing. It assembles an image out of artifacts
produced beforehand, which is why CI can build it in a minute and why it is
guaranteed to contain the same bytes as the Kubernetes images:

| Input | Produced by |
|---|---|
| `classifyre/api`, `classifyre/web`, `classifyre/cli` | the root `Dockerfile` |
| build context `models` | the embedding model, fetched once |

So the order is: build the three service images, fetch the model, then assemble.

```bash
# from the repository root
bun install && bun run codegen && bun run build
bash ./scripts/stage-docker-artifacts.sh /tmp/cf-artifacts

for target in web api cli; do
  docker buildx build --target "${target}-final" -t "classifyre/${target}:local" \
    --build-context api-dist=/tmp/cf-artifacts/api-dist \
    --build-context codegen=/tmp/cf-artifacts/codegen \
    --build-context web-dist=/tmp/cf-artifacts/web-dist \
    --load .
done

# The embedding model, downloaded once into a directory the build can copy from.
EMBEDDING_CACHE_DIR=/tmp/cf-models bun run apps/api/scripts/cache-embedding-model.ts

# Note the build context is docker/, not the repository root.
docker buildx build docker -f docker/Dockerfile \
  --build-arg BASE_TAG=local \
  --build-context models=/tmp/cf-models \
  -t classifyre/all-in-one:local --load
```

Build arguments: `BASE_TAG` (which service images to compose, default `latest`)
and `IMAGE_NS` (their namespace).

Base-image versions are pinned as literal `FROM` tags so Dependabot keeps them
current, grouped with the root Dockerfile into one PR. The two it cannot see —
s6-overlay (a release tarball) and PostgreSQL (an apt repository) — are `ARG`s at
the top of the file, tracked by hand.

Then run the smoke test, which boots the image and scans a fixture corpus
end to end — the UI, the docs, pgvector, the first-run workspace, a real scan
with findings, and a restart:

```bash
IMAGE=classifyre/all-in-one:local bash docker/scripts/smoke.sh
```
