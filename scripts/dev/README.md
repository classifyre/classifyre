# Local Kubernetes development

These scripts run the **production Helm chart** on a local k3d cluster. There
are no separate development manifests — the same `helm/classifyre` chart that
ships to the VPS is installed with a `values-dev.yaml` overlay.

The API and worker run from official Bun containers with your working copy
bind-mounted read-only, so TypeScript source edits restart the pod in place.
The **web app runs a locally built production image**, same as CI: no bind
mount, no dev server, no hot reload. Run `./scripts/dev/rebuild-web.sh` after
web changes and restart the deployment to see them. This used to run
`next dev --turbopack` against the bind-mounted source too, but Turbopack's
persistent dev cache (needed to survive pod restarts) kept drifting from the
actual route tree and serving stale 404s — a built image can't drift, because
there's no cache to go stale.

Two modes:

| Mode            | Database                        | Demo mode             | Use it to                                           |
| --------------- | ------------------------------- | --------------------- | --------------------------------------------------- |
| `dev` (default) | embedded Postgres in-cluster    | per `values-dev.yaml` | Normal feature work on throwaway local data         |
| `dev-vps-db`    | the **VPS instance's** Postgres | forced off            | Administer the public demo while it stays read-only |

## Prerequisites

Docker, the latest stable k3d, kubectl, Helm, the latest stable Skaffold, and
curl. `create-cluster.sh` and `start.sh` deliberately refuse to run against a
stale k3d or Skaffold and print the version you need — the chart uses features
that older releases silently mis-handle.

## Quick start

```bash
./scripts/dev/create-cluster.sh
./scripts/dev/start.sh
```

`create-cluster.sh` is a one-time setup: it creates the `k3d-classifyre`
cluster, mounts this checkout into the k3d node at
`/var/lib/classifyre/source`, disables Traefik, installs ingress-nginx, and
pre-creates the container-owned dependency caches. It is idempotent, but it
refuses to continue if an existing cluster was created without _this_ checkout
mounted — delete and recreate in that case.

`start.sh` runs `skaffold dev --profile dev --cleanup=false`. Ctrl-C stops
watching but leaves the release and the Postgres PVC running, so your data
survives between sessions.

| Component     | Address                            |
| ------------- | ---------------------------------- |
| Web (Next.js) | <http://localhost:3301>            |
| API (NestJS)  | <http://localhost:8811>            |
| PostgreSQL    | `localhost:5555`                   |
| NGINX ingress | <http://classifyre.localhost:8080> |

Both the port-forwards and the ingress reach the same pods. The ingress path is
the one that matches production routing; the direct ports are convenient for
`psql` and API clients.

## Editing the demo instance

The public VPS instance runs with `DEMO_MODE=true`, so its own UI cannot create
sources or change settings. Rather than flipping the public instance out of demo
mode to administer it, run a second **local, writable** deployment against that
same database:

```bash
./scripts/dev/start-vps-db.sh          # deploy and watch
./scripts/dev/start-vps-db.sh --migrate # ...and allow schema migrations
./scripts/dev/stop-vps-db.sh           # tear down and close the tunnel
```

Web is on <http://localhost:3302>, API on <http://localhost:8812>, in namespace
`classifyre-vps-db`. The script prompts for confirmation and prints exactly what
it is about to touch first.

| Setting          | Default                         | Override         |
| ---------------- | ------------------------------- | ---------------- |
| VPS kubeconfig   | `~/.kube/config-classifyre-vps` | `KUBECONFIG_VPS` |
| VPS namespace    | `classifyre`                    | `VPS_NAMESPACE`  |
| Postgres service | `classifyre-postgres`           | `VPS_PG_SERVICE` |
| Password secret  | `classifyre-postgres-password`  | `VPS_PG_SECRET`  |

### Why it is built this way

**The tunnel is a container, not a host port-forward.** A plain
`kubectl port-forward` bound to `127.0.0.1` is unreachable from inside the k3d
node, and binding it to `0.0.0.0` would publish a production database to every
network your laptop is on. `vps-db-tunnel.sh` instead runs kubectl in a
container attached to the k3d Docker network with **no published host port**:
reachable by the cluster, and by nothing else. The chart gets that container's
IP as `postgres.external.host`.

**Two writers on one database need guardrails.** The overlay
(`helm/classifyre/values-dev-vps-db.yaml`) applies three:

- `worker.replicaCount: 0` — two independent pg-boss consumers on one database
  means scheduled scans and autopilot cycles can be claimed twice, and the local
  pod would launch CLI jobs into k3d for work the VPS already owns. The API pod
  is `SERVICE_ROLE=api` and starts no namespace workers, so the UI is fully
  usable with the worker at zero.
- `autoBackfill: false` — a backfill would re-embed the VPS instance's findings
  from a local pod, competing with the deployment that owns them.
- `CLASSIFYRE_AUTO_MIGRATE=false` — a checkout on a feature branch would
  otherwise apply unreleased migrations to the live database on boot. `--migrate`
  is the deliberate opt-in.

The password is read out of the VPS cluster at deploy time and passed through
the environment, so it is never written to a file in the repo.

## Script reference

| Script              | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `create-cluster.sh` | One-time: create k3d cluster, mount source, install ingress-nginx  |
| `start.sh`          | `skaffold dev` on the `dev` profile (embedded database)            |
| `rebuild-web.sh`    | Production `next build` → Docker image → import into k3d → restart |
| `stop.sh`           | Uninstall the release; keeps the cluster, caches, and Postgres PVC |
| `delete-cluster.sh` | Delete the cluster, its database, and all container-owned caches   |
| `start-vps-db.sh`   | Writable local deploy against the VPS database (opens the tunnel)  |
| `stop-vps-db.sh`    | Uninstall that release and close the tunnel                        |
| `vps-db-tunnel.sh`  | `start` / `ip` / `status` / `logs` / `stop` for the tunnel alone   |

## How the pieces fit

```
skaffold.yaml            profiles: dev, dev-vps-db
  └─ helm/classifyre     the production chart
       ├─ values-dev.yaml            source mounts, Bun containers, embedded PG
       └─ values-dev-vps-db.yaml     + external PG, DEMO_MODE=false, worker=0
```

The `dev` profile **auto-activates** on the `k3d-classifyre` kube-context. An
explicit `--profile` does not suppress auto-activation in Skaffold, so `dev` is
additionally gated on `CLASSIFYRE_VPS_DB_HOST` being empty — `start-vps-db.sh`
sets it, `start.sh` does not. Without that guard both profiles would activate
during a `dev-vps-db` run and their two `classifyre` releases would fight over
the deploy config.

Because the checkout is mounted into the API/worker/CLI containers, most
source edits never trigger an image build — web is the one exception, since it
now runs a locally built image instead of a bind mount:

| Change                          | Result                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| Web or shared frontend source   | Nothing until you run `rebuild-web.sh` and restart the pod    |
| API TypeScript source           | Bun restarts API and worker in their existing pods           |
| CLI or Python schema source     | The next CLI Job picks up the changed files                  |
| `bun.lock` / `package.json`     | Pods restart; dependencies reinstall into k3d-owned caches   |
| Prisma schema                   | Pods restart; client regenerates, startup applies migrations |
| Helm templates or a values file | Skaffold upgrades the release                                |

## Troubleshooting

Inspect the effective pipeline for either profile:

```bash
skaffold diagnose -p dev --yaml-only
```

Restart workloads after a dependency or Prisma metadata change:

```bash
kubectl -n classifyre-dev rollout restart deployment/classifyre-api deployment/classifyre-worker deployment/classifyre-web
```

Check the database tunnel when `dev-vps-db` pods cannot reach Postgres:

```bash
./scripts/dev/vps-db-tunnel.sh status
./scripts/dev/vps-db-tunnel.sh logs
```

If `create-cluster.sh` reports that the cluster was created without this
checkout mounted, the k3d node is bound to a different directory. Run
`./scripts/dev/delete-cluster.sh` and create it again — the mount is fixed at
cluster-creation time and cannot be changed in place.

See also `docs/development/skaffold.md` for the architecture behind this setup.
