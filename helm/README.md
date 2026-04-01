# Classifyre Kubernetes Deployment Guide

This directory contains the production Helm chart for Classifyre:

- `helm/classifyre/` deploys **frontend** and **backend** as separate stateless Deployments.
- Backend creates namespace-scoped Kubernetes Jobs for CLI extraction/testing.
- PostgreSQL modes:
  - `external` (managed DB: RDS/CloudSQL/Azure PG)
  - `cnpg` (CloudNativePG operator)
  - `embedded` (single in-cluster PostgreSQL for local/dev convenience)

Additional docs:

- [`production/README.md`](/unstructured/helm/production/README.md) for production deployment structure, values files, and install flow
- [`operations/README.md`](/unstructured/helm/operations/README.md) for operational considerations, storage, RBAC, rollout guidance, and day-2 checks

## Prerequisites

- Kubernetes 1.27+
- Helm 3.14+
- Ingress controller (for ingress mode)
- CloudNativePG operator (only when `postgres.mode=cnpg`)

## Production Quick Start (External Postgres)

1. Create namespace:

```bash
kubectl create namespace classifyre
```

2. Create DB secret (or use existing one):

```bash
kubectl -n classifyre create secret generic classifyre-db \
  --from-literal=password='<db-password>'
```

3. Create API masked-config encryption key secret (recommended):

```bash
kubectl -n classifyre create secret generic classifyre-api-secrets \
  --from-literal=CLASSIFYRE_MASKED_CONFIG_KEY="$(openssl rand -base64 32)"
```

4. Install chart:

```bash
helm upgrade --install classifyre ./helm/classifyre \
  -n classifyre \
  --set postgres.mode=external \
  --set postgres.external.host='<db-host>' \
  --set postgres.external.port=5432 \
  --set postgres.external.database='classifyre' \
  --set postgres.external.username='classifyre' \
  --set postgres.external.existingSecret='classifyre-db' \
  --set postgres.external.existingSecretPasswordKey='password' \
  --set api.maskedConfigEncryption.existingSecret='classifyre-api-secrets' \
  --set api.maskedConfigEncryption.secretKey='CLASSIFYRE_MASKED_CONFIG_KEY' \
  --set api.image.repository='classifyre/api' \
  --set api.image.tag='<immutable-tag>' \
  --set frontend.image.repository='classifyre/web' \
  --set frontend.image.tag='<immutable-tag>' \
  --set api.cliJobs.image.repository='classifyre/cli' \
  --set api.cliJobs.image.tag='<immutable-tag>'
```

## Production Quick Start (CNPG)

```bash
helm upgrade --install classifyre ./helm/classifyre \
  -n classifyre \
  --create-namespace \
  --set postgres.mode=cnpg \
  --set postgres.cnpg.appPassword='<app-password>' \
  --set api.maskedConfigEncryption.value="$(openssl rand -base64 32)" \
  --set api.image.repository='classifyre/api' \
  --set api.image.tag='<immutable-tag>' \
  --set frontend.image.repository='classifyre/web' \
  --set frontend.image.tag='<immutable-tag>' \
  --set api.cliJobs.image.repository='classifyre/cli' \
  --set api.cliJobs.image.tag='<immutable-tag>'
```

## Operational Checks

- Helm lint/template:

```bash
bun run ops:helm:lint
```

- Helm docs generation/check:

```bash
bun run ops:helm:docs
bun run ops:helm:docs:check
```

- Snapshot generation/check:

```bash
bun run ops:helm:snapshot
bun run ops:helm:snapshot:check
```

## Local Minikube

Local-only instructions are in `helm/MINIKUBE.md`.
