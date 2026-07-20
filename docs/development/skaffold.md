# Kubernetes development with k3d and Skaffold

Local development runs the production Helm chart on k3d. There are no separate
development manifests and no locally built application images.

## Start

Install Docker, the latest stable k3d, kubectl, Helm, and the latest stable
Skaffold. The helper scripts reject stale k3d or Skaffold versions and print the
version that must be installed.

```bash
./scripts/dev/create-cluster.sh
./scripts/dev/start.sh
```

The first command creates `k3d-classifyre`, mounts the checkout read-only into
the k3d node, disables Traefik, and installs the current ingress-nginx chart.
The second runs `skaffold dev --profile dev`.

| Component     | Endpoint                           |
| ------------- | ---------------------------------- |
| Next.js       | <http://localhost:3000>            |
| NestJS API    | <http://localhost:8000>            |
| PostgreSQL    | `localhost:5433`                   |
| NGINX ingress | <http://classifyre.localhost:8080> |

## How development runs

Skaffold installs `helm/classifyre` using `values-dev.yaml`, monitors chart
changes, streams deployment status, and owns the port-forwards. Its local
profile intentionally has no build artifacts or file-sync rules.

The k3d node exposes the checkout at `/var/lib/classifyre/source`. Helm mounts
that source read-only into official Bun containers. Writable dependency and
framework paths are overlaid from `/var/lib/classifyre/cache` inside the k3d
node, so host `node_modules` are never used or modified.

- Web runs `bun --bun next dev --turbopack` with filesystem polling.
- API and worker run `bun --watch src/main.ts`.
- PostgreSQL runs as the chart's embedded Kubernetes workload.
- CLI scans use the production `classifyre/cli` image with only CLI and shared
  schema source mounted over it. Each newly created Job sees current Python.

Dependencies are installed inside the Bun containers. A checksum of the lock
file and relevant package metadata selects a persistent cache marker, and API
and worker installations are serialized through a shared lock directory.

## Change behavior

| Change                                | Result                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| Web or shared frontend source         | Next.js Fast Refresh; no image build or Helm upgrade                         |
| API TypeScript source                 | Bun restarts API and worker processes in their existing pods                 |
| CLI or Python schema source           | The next CLI Job uses the changed files                                      |
| `bun.lock` or relevant `package.json` | Restart web/API/worker; dependencies reinstall into k3d-owned caches         |
| Prisma schema                         | Restart API/worker; Prisma client regenerates and startup applies migrations |
| Python dependency files               | Build and publish the normal production CLI image through CI                 |
| Helm templates or `values-dev.yaml`   | Skaffold upgrades the Helm release                                           |
| Root `Dockerfile`                     | Affects only explicit production workload-image builds                       |

Source changes never trigger image builds. Skaffold sync is not used because
the source is already visible through the k3d mount.

## Operations

Restart workloads after dependency or Prisma metadata changes:

```bash
kubectl -n classifyre-dev rollout restart \
  deployment/classifyre-api \
  deployment/classifyre-worker \
  deployment/classifyre-web
```

Remove the Helm release while keeping the cluster and warm caches:

```bash
./scripts/dev/stop.sh
```

Delete the cluster, database, and all container-owned caches:

```bash
./scripts/dev/delete-cluster.sh
```

Production images are built only for the Kubernetes workloads using the
`web-final`, `api-final`, and `cli-final` targets in the root `Dockerfile`.
GitHub Actions builds and publishes them for both supported architectures.

## Troubleshooting

- Run `skaffold diagnose -p dev --yaml-only` to inspect the effective pipeline.
- Run `helm lint helm/classifyre -f helm/classifyre/values-dev.yaml` to validate
  the local overrides.
- If a source watcher misses an event, confirm the checkout mount exists with
  `docker exec k3d-classifyre-server-0 ls /var/lib/classifyre/source`.
- If dependency installation was interrupted, restart the cluster to discard
  its internal cache, or remove only the stale `install.lock` in the k3d node.
