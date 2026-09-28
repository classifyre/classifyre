<div align="center">
<img src="https://www.classifyre.com/clasifyre_icon.png" alt="Classifyre" width="96" />

# Classifyre Helm Chart

**Production Kubernetes deployment of the open-source Classifyre investigation platform — web UI, API, worker, ephemeral scan jobs and PostgreSQL.**

</div>

Classifyre turns the data scattered across the systems you already run — file shares, Confluence, Jira, SharePoint, S3, Git repositories, databases — into **investigations you can act on**: detectors raise findings (leaked secrets, PII, security risks), and analysts work them through inquiries, duplicates, cases and hypotheses, with an AI autopilot doing the legwork.

This chart (`classifyre/classifyre-core`) deploys Classifyre on Kubernetes 1.28+ (Helm 3.12+): the web UI and API deployments, the background worker, ephemeral [`classifyre/cli`](https://hub.docker.com/r/classifyre/cli) scan Jobs with shared uv-cache, ingress/TLS, autoscaling, RBAC — and PostgreSQL (embedded for trials, external or CloudNativePG for production). It runs the same [`classifyre/api`](https://hub.docker.com/r/classifyre/api) / [`classifyre/web`](https://hub.docker.com/r/classifyre/web) / [`classifyre/cli`](https://hub.docker.com/r/classifyre/cli) images as the [all-in-one Docker image](https://hub.docker.com/r/classifyre/all-in-one), as separate, independently scalable workloads.

📚 Full documentation: chart source, values reference and production guidance at **https://github.com/classifyre/classifyre/tree/develop/helm** · product docs at **https://docs.classifyre.com** ([Kubernetes guide](https://docs.classifyre.com/deployment/kubernetes/))

---

## Installation

No `helm repo add` — the chart is published as OCI (Helm 3.8+ speaks OCI natively). Pin `--version` to the release you want.

**Trial (embedded Postgres, single namespace):**

```bash
helm upgrade --install classifyre \
  oci://registry-1.docker.io/classifyre/classifyre-core \
  --version '<version>' \
  -n classifyre --create-namespace
```

**Production (external Postgres, pinned images):**

```bash
kubectl create namespace classifyre

helm upgrade --install classifyre \
  oci://registry-1.docker.io/classifyre/classifyre-core \
  --version '<version>' \
  -n classifyre \
  -f your-values.yaml \
  --set api.image.tag='<version>' \
  --set api.cliJobs.image.tag='<version>' \
  --set frontend.image.tag='<version>'
```

Start `your-values.yaml` from [`values-production.example.yaml`](https://github.com/classifyre/classifyre/blob/develop/helm/classifyre/values-production.example.yaml) — a commented starting point, not a drop-in file.

**External Postgres:**

```bash
kubectl -n classifyre create secret generic classifyre-db --from-literal=password='<db-password>'

helm upgrade --install classifyre oci://registry-1.docker.io/classifyre/classifyre-core \
  -n classifyre --version '<version>' \
  --set postgres.mode=external \
  --set postgres.external.host='<db-host>' \
  --set postgres.external.port=5432 \
  --set postgres.external.database='classifyre' \
  --set postgres.external.username='classifyre' \
  --set postgres.external.existingSecret='classifyre-db' \
  --set postgres.external.existingSecretPasswordKey='password'
```

**CloudNativePG:**

```bash
helm upgrade --install classifyre oci://registry-1.docker.io/classifyre/classifyre-core \
  -n classifyre --create-namespace --version '<version>' \
  --set postgres.mode=cnpg \
  --set postgres.cnpg.appPassword='<app-password>'
```

## Key values

| Value | Default | Purpose |
|---|---|---|
| `postgres.mode` | `embedded` | `embedded` (trial only), `external`, or `cnpg`. Production: `external`/`cnpg`. |
| `api.image.tag` / `frontend.image.tag` / `api.cliJobs.image.tag` | chart appVersion | Pin all three to the same immutable version in production (never `latest`). |
| `api.maskedConfigEncryption.existingSecret` | — | Existing Secret holding `CLASSIFYRE_MASKED_CONFIG_KEY` (recommended); otherwise the chart auto-generates one. |
| `api.maxOldSpaceSizeMb` | `1536` | V8 heap cap for API+worker. Keep ≈ 0.75 × `api.resources.limits.memory`. |
| `api.cliJobs.resources.*` | `500m`–`2` CPU, `4Gi` mem | CPU/memory requests/limits per scan job. |
| `api.cliJobs.huggingFace.existingSecret` | `""` | Secret with an `HF_TOKEN` to raise model-download rate limits. |
| `api.autoscaling.*` | enabled, 2–10 replicas | HPA for the API deployment. |

Full values reference: [`helm/classifyre`](https://github.com/classifyre/classifyre/tree/develop/helm/classifyre) (every value is documented inline in `values.yaml`).

## Production checklist

1. `postgres.mode=external` or `cnpg` (embedded is local/dev convenience).
2. Pin all image tags to immutable versions.
3. Configure ingress TLS, resource requests/limits and scheduling per environment.
4. Provide `CLASSIFYRE_MASKED_CONFIG_KEY` via a Helm-managed or existing Secret.
5. A namespace export moves work between the Docker and Kubernetes distributions — no lock-in.

---

*Classifyre is open source: https://github.com/classifyre/classifyre · Docs: https://docs.classifyre.com*
