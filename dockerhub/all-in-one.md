<div align="center">
<img src="https://www.classifyre.com/clasifyre_icon.png" alt="Classifyre" width="96" />

# Classifyre All-in-One

**Open-source investigation platform in a single Docker image — connect a source, detect leaked secrets, PII and security risks, and work findings into cases.**

</div>

Classifyre turns the data scattered across the systems you already run — file shares, Confluence, Jira, SharePoint, S3, Git repositories, databases — into **investigations you can act on**. Detectors surface the evidence (leaked secrets and API keys, PII, security misconfigurations), and you work the results like an analyst: standing inquiries, duplicate detection, cases and hypotheses, with an AI autopilot doing the legwork in between.

This `classifyre/all-in-one` image is the fastest way to try Classifyre: the web UI, the API, the background worker, the Python scan workers, and a PostgreSQL database with pgvector — all in one container. One `docker run`, no dependencies to provision, nothing to connect. Ideal for local scanning, evaluations, and rapid prototyping.

For a team, or for anything that has to survive a machine dying, use the [Helm chart](https://github.com/classifyre/classifyre/tree/develop/helm) (`classifyre/classifyre-core`) instead — it runs the same code as separate, independently scalable workloads.

📚 Full documentation: **https://docs.classifyre.com** — start with [Deployment](https://docs.classifyre.com/deployment/) · [Sources](https://docs.classifyre.com/sources/) · [Detectors](https://docs.classifyre.com/detectors/) · [Investigations](https://docs.classifyre.com/investigations/)

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

The first boot initialises the database, applies the migrations and creates a workspace called `default`. On a laptop that takes a few minutes; watch it with `docker logs -f classifyre`.

Nothing leaves your machine. There is no account, no signup, and no telemetry you have not opted into.

**What to do next:** add a source (*Sources → New*), turn on detectors, run a scan, then work the findings into cases. See [How it works](https://docs.classifyre.com/how-it-works/) and [Flow](https://docs.classifyre.com/flow/).

## Requirements

- **Memory:** 4 GB minimum, 8 GB recommended. The container refuses to start below 4 GB.
- **CPU:** 2 cores minimum (scans are CPU-bound).
- **Disk:** ~10 GB for the image and database, plus room for what you scan.
- **Shared memory:** always pass `--shm-size=1g` (PostgreSQL parallel queries need it).
- On **macOS/Windows**, raise Docker Desktop to 4+ GB under *Settings → Resources → Memory*.
- Architectures: `linux/amd64` and `linux/arm64` (Apple Silicon included).

## What is inside

| Process | Port | Purpose |
|---|---|---|
| Caddy | **3000** (the only published port) | Routes to the UI and API |
| Web UI | 3100 (internal) | Next.js app + bundled docs at `/docs` |
| API + worker | 8000 (internal) | REST, WebSockets, job queues, embeddings, scan orchestration |
| PostgreSQL 18 + pgvector | 5432 (internal, not exposed) | All application data |

## Scanning a folder on your machine

```bash
docker run -d --name classifyre \
  -p 3000:3000 --shm-size=1g \
  -v classifyre-pgdata:/var/lib/postgresql/data \
  -v classifyre-data:/var/lib/classifyre \
  -v classifyre-uv-cache:/cache/uv \
  -v "$HOME/Documents/case-files:/data/case-files:ro" \
  classifyre/all-in-one:latest
```

Then in the UI: **Sources → New → Mounted Folder**, path `/data/case-files`.

## Configuration

Everything is an environment variable (`-e NAME=value` or `--env-file`), and everything has a working default.

### Core

| Variable | Default | Purpose |
|---|---|---|
| `PORT_HTTP` | `3000` | Port inside the container (or remap with `-p 8080:3000`). |
| `CLASSIFYRE_BOOTSTRAP_NAMESPACE` | `default` | Slug of the workspace created on first boot. Set to `""` to create your own in the UI. |
| `CLASSIFYRE_MASKED_CONFIG_KEY` | *auto-generated* | Encrypts stored source credentials and MCP tokens. **Back it up** (see below) — without it, restored backups keep credentials encrypted and unreadable. |
| `DEMO_MODE` | `false` | Read-only mode; blocks every write. For shared demo instances. |
| `TELEMETRY_DISABLED` / `DO_NOT_TRACK` | unset | Set either to `1` to disable anonymous usage telemetry. |
| `CORS_ORIGIN` | same-origin | Only needed if you serve the UI from another host. |

### Database

Leave these unset to use the PostgreSQL server inside the image.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | *bundled server* | Set it and the bundled server never starts (must have pgvector; user needs `CREATE SCHEMA` / `CREATE EXTENSION`). |
| `POSTGRES_DB` | `classifyre` | Database name (bundled server only). |
| `PGDATA` | `/var/lib/postgresql/data` | Data directory (bundled server only). |
| `CLASSIFYRE_AUTO_MIGRATE` | `true` | `false` skips migrations at startup (only if you run them yourself). |

### Object storage (S3, MinIO, R2, …)

Scan logs go to disk by default; set `S3_BUCKET` to store them in object storage instead.

| Variable | Default | Purpose |
|---|---|---|
| `S3_BUCKET` | unset | Setting this switches scan logs from disk to S3. |
| `S3_ENDPOINT` | AWS | Required for MinIO, R2, Backblaze, Garage, any non-AWS provider. |
| `S3_REGION` | `us-east-1` | Bucket region. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | unset | Omit both to use the ambient credential chain. |
| `S3_FORCE_PATH_STYLE` | `true` | Required by MinIO and most self-hosted providers; `false` for AWS. |
| `S3_LOG_PREFIX` | `runner-logs/` | Key prefix for scan logs. |

### Embeddings

A small embedding model (`Xenova/all-MiniLM-L6-v2`, 384 dimensions) ships baked into the image and runs on CPU, so semantic search and duplicate detection work offline out of the box.

| Variable | Default | Purpose |
|---|---|---|
| `EMBEDDING_PROVIDER` | `transformers-js` | `openai-compatible` to use a remote service instead. |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` | unset | Remote endpoint for `openai-compatible`. |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Changing this re-embeds everything. |
| `EMBEDDING_ALLOW_REMOTE_MODELS` | `false` | `true` allows downloading a different local model at runtime. |
| `EMBEDDING_BATCH_SIZE` | *autotuned* | Lower it if embedding starves your scans. |

> AI providers (LLM detectors, investigation autopilot) are **not** environment variables — they are per-workspace settings under **Settings → AI providers** in the UI, with API keys encrypted at rest.

### Resources

The container sizes itself to the memory/CPU it was given. Override only with reason.

| Variable | Purpose |
|---|---|
| `CLASSIFYRE_NODE_HEAP_MB` | Node heap ceiling. Bigger is not better past ~2.5 GB. |
| `PG_SHARED_BUFFERS`, `PG_WORK_MEM`, `PG_EFFECTIVE_CACHE_SIZE`, `PG_MAX_CONNECTIONS` | PostgreSQL memory tuning. |
| `MAX_CONCURRENT_RUNNERS` | Scans running at once. |
| `CLASSIFYRE_MAX_POOL_WORKERS` | Detector worker processes per scan. |
| `CLASSIFYRE_MIN_MEMORY_MB` | The 4 GB startup floor. Lower at your own risk. |

## Upgrades & backup

```bash
docker pull classifyre/all-in-one:latest
docker rm -f classifyre
# re-run the same docker run as before, with the same volumes
```

Data lives in the volumes, so it carries over; migrations run automatically. Pin a version tag to decide when to upgrade. Downgrades are not supported.

Back up two things: the database (`docker exec classifyre pg_dump -U postgres classifyre > classifyre.sql`) **and** the key (`docker exec classifyre cat /var/lib/classifyre/masked-config.key`).

## Moving to Kubernetes

Nothing here is a dead end: export a workspace from this container and import it into a cluster install — sources, findings, cases and lineage all move. The [Helm chart](https://github.com/classifyre/classifyre/tree/develop/helm) (`classifyre/classifyre-core`) runs the same images this one is composed from (`classifyre/api`, `classifyre/web`, `classifyre/cli`).

---

*Classifyre is open source: https://github.com/classifyre/classifyre · Docs: https://docs.classifyre.com*
