<div align="center">
<img src="https://www.classifyre.com/clasifyre_icon.png" alt="Classifyre" width="96" />

# Classifyre CLI

**Scan worker of the open-source Classifyre investigation platform — source extraction, text/OCR/transcription and detector execution.**

</div>

Classifyre turns the data scattered across the systems you already run — file shares, Confluence, Jira, SharePoint, S3, Git repositories, databases — into **investigations you can act on**. This `classifyre/cli` image (Python) does the heavy lifting of every scan: it extracts content from sources (including image OCR, audio/video transcription and legacy Office conversion via LibreOffice), runs detector packs (secrets, PII, security, plus custom detectors) and streams findings back to the API in batches.

It is one of three service images — with [`classifyre/api`](https://hub.docker.com/r/classifyre/api) (backend) and [`classifyre/web`](https://hub.docker.com/r/classifyre/web) (frontend) — composed into the [`classifyre/all-in-one`](https://hub.docker.com/r/classifyre/all-in-one) image and run as ephemeral Kubernetes Jobs by the [`classifyre/classifyre-core`](https://hub.docker.com/r/classifyre/classifyre-core) Helm chart.

You normally don't run this image by hand: scans are launched from the UI/API. It is documented here for Kubernetes operators and anyone scripting scans directly.

📚 Full documentation: **https://docs.classifyre.com** — [Sources](https://docs.classifyre.com/sources/) · [Detectors](https://docs.classifyre.com/detectors/)

---

## How it runs

- **All-in-one / local:** the API starts one CLI process per scan; it exits when the scan does.
- **Kubernetes (Helm):** the API creates one Kubernetes Job per scan with this image; results are posted back to the API. See the [Helm chart](https://github.com/classifyre/classifyre/tree/develop/helm) (`api.cliJobs.*` values: resources, retries, uv-cache, Hugging Face token).
- **Manual:** `docker run --rm classifyre/cli:latest <command> <recipe.json> [options]` against a reachable API.

Base Python dependencies ship in the image (~150–230 MB); optional detector/source groups (OCR, ML detectors) install on demand at runtime and are cached. Legacy `.doc`/`.xls`/`.ppt` conversion works out of the box (LibreOffice is installed); override with `CLASSIFYRE_SOFFICE_PATH` if needed.

## Configuration (most relevant)

Full behavior is driven by the scan recipe; these environment variables tune the worker:

| Variable | Default | Purpose |
|---|---|---|
| `CLASSIFYRE_OUTPUT_REST_URL` | unset | API base URL findings are posted to (batch ingest). |
| `CLASSIFYRE_OUTPUT_REST_TIMEOUT_SEC` | `120` | HTTP read timeout for posting batches (API transactions can take 30–60 s under load). |
| `CLASSIFYRE_OUTPUT_BATCH_SIZE` | autotuned | Assets per result batch sent to the API. |
| `CLASSIFYRE_INTERNAL_KEY` | unset | Internal API key authenticating the worker to the API. |
| `CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS` | `1` | `0` disables on-demand install of optional detector groups. |
| `CLASSIFYRE_MAX_POOL_WORKERS` | autotuned | Detector worker processes per scan. |
| `CLASSIFYRE_DETECTOR_FLUSH_BATCH_SIZE` | `5` | Detector-processed assets accumulated before pushing findings. |
| `CLASSIFYRE_SOFFICE_PATH` | auto-detected | LibreOffice binary for legacy Office conversion. |
| `HF_TOKEN` | unset | Hugging Face token; raises model-download rate limits (in Helm, via `api.cliJobs.huggingFace.existingSecret`). |

## Tags

- `latest` tracks the newest stable release; pin a version (e.g. `classifyre/cli:0.6.3`) in production. API, web and CLI tags with the same version are built from the same commit — keep them in sync.

---

*Classifyre is open source: https://github.com/classifyre/classifyre · Docs: https://docs.classifyre.com*
