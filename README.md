# Classifyre Monorepo

This repo now includes:

- `web` (Next.js)
- `api` (NestJS + Prisma)
- `cli` (Python, lazy optional deps)
- PostgreSQL runtime support
- one all-in-one Docker image (single exposed endpoint via frontend reverse proxy)
- production Helm chart (api/web as Deployments, cli as Kubernetes Jobs)
- Turborepo-integrated DevOps commands

## What Was Implemented

### 1) All-in-one Docker runtime

- Single container runs PostgreSQL, API, Web, and Caddy reverse proxy via `s6-overlay`.
- Only one public port is exposed: `3000` (frontend entrypoint).
- `/api/*` and `/socket.io*` are reverse-proxied to the backend.
- Prisma migration (`prisma migrate deploy`) runs on API start, so it also runs after container restart.

Key file:

- `/Dockerfile`

### 2) CLI job runtime fixes

- Kubernetes CLI jobs now use `.venv/bin/python` directly (no shell activate side effects).
- This removed `OSTYPE`/shell activation issues in job pods.

Key file:

- `/apps/api/src/cli-runner/kubernetes-cli-job.service.ts`

### 3) Helm production chart

- One chart in `/helm/classifyre`.
- `web` and `api` are separate stateless Deployments.
- `cli` runs as per-request Kubernetes Jobs created by backend.
- Supports external PostgreSQL and CNPG modes.
- Includes RBAC, affinity/topology defaults, HPAs, PDBs, optional cache PVCs.

Key docs:

- `/helm/README.md`

### 4) Turborepo DevOps integration

- Added `@workspace/devops` workspace with Docker/Helm scripts.
- Added root `ops:*` scripts so DevOps flows run via Turbo.
- Added Helm manifest snapshots and snapshot-check command.

Key files:

- `/packages/devops/package.json`
- `/packages/devops/turbo.json`
- `/scripts/docker-build-allinone.sh`
- `/scripts/docker-build-multiarch.sh`
- `/scripts/helm-lint.sh`
- `/scripts/helm-snapshot.sh`
- `/helm/snapshots/default.yaml`
- `/helm/snapshots/minikube.yaml`

## Prerequisites

- `bun` (workspace package manager)
- `docker` (for local all-in-one image)
- `helm` + `kubectl` + `minikube` (for Helm test/deploy)

## How To Run

### A) Local all-in-one Docker (single command style)

The all-in-one image is for demos, evaluation, and local validation. It is not the production topology.

Build:

```bash
bun run ops:docker:build
```

Run:

```bash
docker run --rm -p 3000:3000 classifyre-all-in-one:local
```

Verify:

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/api/ping
```

Smoke test the real runtime, including a non-root optional dependency install:

```bash
bun run ops:docker:smoke
```

### B) Multi-platform image build (amd64/arm64)

```bash
IMAGE=ghcr.io/<org>/classifyre-all-in-one TAG=v1.0.0 bun run ops:docker:build:multiarch
```

Optional envs:

- `PLATFORMS` (default `linux/amd64,linux/arm64`)
- `MODE` (`push` or `load`)
- `LATEST=1` to also tag/push `:latest`

### C) Helm quality checks and snapshots

Lint chart + template render sanity:

```bash
bun run ops:helm:lint
```

Generate snapshots:

```bash
bun run ops:helm:snapshot
```

Verify snapshots are up-to-date:

```bash
bun run ops:helm:snapshot:check
```

Combined Helm test flow:

```bash
bun run ops:helm:test
```

Post-deploy, fail the rollout if any source is stuck `RUNNING` without a valid runner:

```bash
bash ./scripts/check-k8s-runner-invariants.sh
```

Repair those source states in-place when needed:

```bash
bash ./scripts/check-k8s-runner-invariants.sh --repair
```

### D) Minikube deployment validation

```bash
bash ./helm/test-minikube.sh
```

This builds local image, installs chart, waits for rollout, and validates:

- `GET /`
- `GET /api/ping`

## Turborepo Commands

Dev app commands (default monorepo behavior):

- `bun run build`
- `bun run lint`
- `bun run test`

DevOps-only commands:

- `bun run ops:build`
- `bun run ops:lint`
- `bun run ops:test`
- `bun run ops:docker:build`
- `bun run ops:docker:build:multiarch`
- `bun run ops:helm:lint`
- `bun run ops:helm:snapshot`
- `bun run ops:helm:snapshot:check`
- `bun run ops:helm:test`

## Runtime Behavior Notes

- Public endpoint is frontend only (`:3000`); backend is internal and reached through reverse proxy.
- `/notifications` serves frontend page HTML as expected.
- Prisma migrations execute on each API start in container and via Helm init container in k8s.
- CLI optional heavy dependencies are still lazy-loaded on demand by the Python runtime logic.
