# Kubernetes development with k3d and Skaffold

Local development runs the production Helm chart on k3d. There are no separate
development manifests and no locally built application images.

For the day-to-day command reference, see
[`scripts/dev/README.md`](../../scripts/dev/README.md). This page covers why the
setup is shaped the way it is.

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

| Component     | Endpoint                                     |
| ------------- | --------------------------------------------- |
| NestJS API    | <http://localhost:8811>                      |
| PostgreSQL    | `localhost:5555`                             |
| NGINX ingress | <http://classifyre.localhost:8080/api/...>   |

These are the local ports Skaffold forwards, which differ from the in-cluster
ports the services listen on (8000, 5432). `portForward` in `skaffold.yaml` is
the source of truth.

Web (`frontend.enabled: false` in `values-dev.yaml`) is not deployed to this
cluster at all — run it locally with `bun run dev` in `apps/web`, pointed at
the API port-forward above. See
[`scripts/dev/README.md`](../../scripts/dev/README.md) for the exact command.
It previously ran as `next dev --turbopack` in-cluster against a
hostPath-persisted `.next` cache, but that cache repeatedly drifted from the
actual route tree (stale/missing route manifest entries after restarts,
producing 404s Turbopack never got around to fixing). Running it as an
ordinary local process removes that cache entirely.

## How development runs

Skaffold installs `helm/classifyre` using `values-dev.yaml`, monitors chart
changes, streams deployment status, and owns the port-forwards. Its local
profile intentionally has no build artifacts or file-sync rules.

The k3d node exposes the checkout at `/var/lib/classifyre/source`. Helm mounts
that source read-only into official Bun containers for API and worker.
Writable dependency and framework paths are overlaid from
`/var/lib/classifyre/cache` inside the k3d node, so host `node_modules` are
never used or modified. Web is not part of any of this — it runs as a normal
local process outside the cluster.

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
| Web or shared frontend source         | Handled by your local `next dev`; this cluster isn't involved               |
| API TypeScript source                 | Bun restarts API and worker processes in their existing pods                 |
| CLI or Python schema source           | The next CLI Job uses the changed files                                      |
| `bun.lock` or relevant `package.json` | Restart API/worker; dependencies reinstall into k3d-owned caches            |
| Prisma schema                         | Restart API/worker; Prisma client regenerates and startup applies migrations |
| Python dependency files               | Build and publish the normal production CLI image through CI                 |
| Helm templates or `values-dev.yaml`   | Skaffold upgrades the Helm release                                           |
| Root `Dockerfile`                     | Affects only explicit production workload-image builds                       |

Source changes never trigger image builds. Skaffold sync is not used because
the source is already visible through the k3d mount.

## The `dev-vps-db` profile

The public VPS instance runs with `DEMO_MODE=true`, so its own UI cannot create
sources or change settings. The `dev-vps-db` profile installs the chart into
`classifyre-vps-db` with `DEMO_MODE=false` against that instance's database, so
it can be administered without taking the public instance out of demo mode.

The profile is not meant to be run directly — `scripts/dev/start-vps-db.sh`
opens the database tunnel and exports the values its `setValueTemplates` read.
Commands, environment overrides and the safeguards that apply when a second
writer attaches to a live database are documented in
[`scripts/dev/README.md`](../../scripts/dev/README.md).

One Skaffold detail worth knowing: an explicit `--profile` does not suppress
auto-activation, so the `dev` profile is gated on `CLASSIFYRE_VPS_DB_HOST` being
empty in addition to its kube-context match. Without that guard both profiles
would activate during a `dev-vps-db` run and their two `classifyre` releases
would fight over the deploy config.

## Operations

Restart workloads after dependency or Prisma metadata changes:

```bash
kubectl -n classifyre-dev rollout restart \
  deployment/classifyre-api \
  deployment/classifyre-worker
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
