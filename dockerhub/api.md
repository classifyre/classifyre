<div align="center">
<img src="https://www.classifyre.com/clasifyre_icon.png" alt="Classifyre" width="96" />

# Classifyre API

**Backend service of the open-source Classifyre investigation platform — REST API, scan orchestration, findings, cases and AI autopilot.**

</div>

Classifyre turns the data scattered across the systems you already run — file shares, Confluence, Jira, SharePoint, S3, Git repositories, databases — into **investigations you can act on**: detectors raise findings (leaked secrets, PII, security risks), and analysts work them through inquiries, duplicates, cases and hypotheses.

This `classifyre/api` image is the Classifyre backend (NestJS): it serves the REST API and WebSockets, orchestrates scans, runs the background job queues (pg-boss) and semantic embeddings, and spawns scan workers. It is one of three service images — together with [`classifyre/web`](https://hub.docker.com/r/classifyre/web) (frontend) and [`classifyre/cli`](https://hub.docker.com/r/classifyre/cli) (scan jobs) — composed into the [`classifyre/all-in-one`](https://hub.docker.com/r/classifyre/all-in-one) image and deployed separately by the [`classifyre/classifyre-core`](https://hub.docker.com/r/classifyre/classifyre-core) Helm chart.

You normally don't run this image by hand: use the [all-in-one image](https://hub.docker.com/r/classifyre/all-in-one) for local use or the [Helm chart](https://github.com/classifyre/classifyre/tree/develop/helm) for Kubernetes.

📚 Full documentation: **https://docs.classifyre.com**

---

## Quickstart (standalone)

The API needs PostgreSQL 15+ with **pgvector**:

```bash
docker run -d --name classifyre-api \
  -p 8000:8000 \
  -e DATABASE_URL="postgresql://user:pass@db.internal:5432/classifyre?sslmode=require" \
  classifyre/api:latest
```

The DB user needs `CREATE SCHEMA` / `CREATE EXTENSION` (every workspace gets its own schema). Migrations run automatically on startup behind an advisory lock, so multiple replicas against one database are safe.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | *(required standalone)* | PostgreSQL connection string. |
| `PORT` | `8000` | Port the API listens on. |
| `CLASSIFYRE_MASKED_CONFIG_KEY` | *auto-generated* | Encrypts stored source credentials and MCP tokens. Set explicitly in production and back it up. |
| `SERVICE_ROLE` | `api` | `api` serves traffic; `worker` runs background embedding/automation jobs (used by the Helm chart). |
| `CORS_ORIGIN` | same-origin | Set when the UI is served from another host. |
| `DEMO_MODE` | `false` | Read-only mode; blocks every write. |
| `TELEMETRY_DISABLED` / `DO_NOT_TRACK` | unset | Set either to `1` to disable anonymous usage telemetry. |
| `CLASSIFYRE_AUTO_MIGRATE` | `true` | `false` skips startup migrations (only if you run them yourself). |
| `EMBEDDING_PROVIDER` | `transformers-js` | `openai-compatible` for a remote embedding service. |
| `EMBEDDING_BASE_URL` / `EMBEDDING_API_KEY` | unset | Remote endpoint for `openai-compatible`. |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model id. |
| `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | unset | Object storage for scan logs (disk otherwise). |

> AI provider keys (LLM detectors, autopilot) are per-workspace settings in the UI (**Settings → AI providers**), not environment variables.

The Helm chart exposes further tuning (DB pool sizes, V8 heap, HNSW index parameters) — see [values](https://github.com/classifyre/classifyre/tree/develop/helm).

## Tags

- `latest` tracks the newest stable release; pin a version (e.g. `classifyre/api:0.6.3`) in production. API, web and CLI tags with the same version are built from the same commit — keep them in sync.

---

*Classifyre is open source: https://github.com/classifyre/classifyre · Docs: https://docs.classifyre.com*
