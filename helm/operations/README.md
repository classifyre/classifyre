# Classifyre Helm Operations Notes

This document captures the practical configuration choices and operational considerations for production Kubernetes deployments of Classifyre.

## Image Management

- Prefer immutable tags or digests.
- Keep `api`, `web`, and `cli` versions aligned.
- If the chart changes and the images change, deploy both together.
- Use `image.pullPolicy: Always` only when that matches your release process. Immutable tags are safer than mutable tags with forced pulls.

## Values File Strategy

- Keep one shared production baseline values file and environment-specific overlays beside it.
- Keep single-node k3s overrides in a dedicated file such as [`helm/classifyre/values-vps.yaml`](/unstructured/helm/classifyre/values-vps.yaml).
- Keep local and Minikube values separate from production values so storage classes, service exposure, and replica counts do not leak across environments.

## Secrets And Encryption

- Keep `CLASSIFYRE_MASKED_CONFIG_KEY` stable across upgrades and pod restarts.
- Store it in an existing Kubernetes Secret for production.
- Rotating that key is an operational migration, not a casual value change.

## Database Mode Selection

- `external`: best when the platform already provides managed PostgreSQL.
- `cnpg`: good when you want Kubernetes-native Postgres lifecycle management.
- `embedded`: fine for local/dev and controlled single-purpose environments, but not the default recommendation for production.

## Storage Considerations

The chart can use persistent volumes for:

- runner logs
- uv cache
- Playwright cache
- embedded PostgreSQL data

Choose storage classes and access modes that match the cluster.

Examples:

- single-node k3s may work well with `ReadWriteOnce`
- multi-node shared caches often need `ReadWriteMany`

If your storage backend does not support the chart defaults, override the PVC settings explicitly.

For the current k3s VPS shape, the important overrides are:

- `api.runnerLogs.accessModes`
- `api.cliJobs.uvCache.accessModes`
- `postgres.embedded.persistence.accessModes`

## CLI Job Runtime Characteristics

CLI jobs are not lightweight shell wrappers. They can:

- install optional dependency groups on first use
- download detector/model assets on first use
- consume significant CPU and memory during extraction and detection

This means:

- first runs can be slower than warm-cache runs
- timeouts should reflect real ingestion size and detector mix
- resource requests and limits should be sized for your largest expected source type

The API only orchestrates these jobs. If job creation, log access, or cleanup fails, check the API service account and RoleBinding first.

## Runner Logs

Runner logs are stored on the API side and exposed through `/runners/:runnerId/logs`.

For production:

- keep `api.runnerLogs.enabled=true`
- keep `api.env.RUNNER_LOGS_DIR` consistent with the mounted PVC path
- treat runner logs as operational data, not ephemeral scratch space

If runner log retention matters, size the PVC accordingly and define your cleanup policy outside the app as needed.

## CLI Job Cleanup Policy

`api.cliJobs.cleanupPolicy` controls whether completed Jobs stay around:

- `always`
- `failed`
- `none`

Operational trade-off:

- `always` keeps the namespace clean
- `failed` is useful if you want failed Job objects left for inspection
- `none` is useful only if you have a deliberate retention workflow

TTL settings still matter when cleanup is not immediate.

## Service Account And RBAC

Kubernetes-backed CLI execution requires the API pod to create and inspect Jobs and Pods.

Keep enabled in production unless you have a custom RBAC model:

- `serviceAccount.create`
- `serviceAccount.automount`
- `rbac.create`

If you replace them with custom resources, verify:

- API can create/delete Jobs
- API can list/read Pods
- API can read Pod logs

## Networking Model

Recommended public entrypoint:

- expose Web publicly
- keep API internal
- route browser API calls through `/api`

You can run with:

- ingress
- NodePort
- LoadBalancer

For single-node VPS deployments without ingress yet, expose only `frontend.service` through `NodePort` and keep `api.service.type=ClusterIP`.

For the current k3s staging/production-style setup:

- set `ingress.enabled=false`
- set `frontend.service.type=NodePort`
- set `frontend.service.nodePort=30100`
- leave API private inside the cluster
- use the Web app as the only public HTTP surface

## Probes And Rollouts

Keep health probes enabled in production.

Important paths:

- API: `/ping`
- Web: `/`

After upgrades:

- watch Deployment rollout
- confirm old pods terminate
- confirm the new image digest is actually in use

## Day-2 Verification Checklist

After every production upgrade:

1. `helm status classifyre -n classifyre`
2. `kubectl -n classifyre get pods`
3. `kubectl -n classifyre get pvc`
4. `curl http://<public-endpoint>/api/ping`
5. start a sandbox run
6. start a real source run
7. confirm CLI Job creation in the namespace
8. confirm runner logs and runner state updates

## Safe Operational Commands

```bash
kubectl -n classifyre get pods
kubectl -n classifyre get jobs
kubectl -n classifyre describe deploy classifyre-api
kubectl -n classifyre describe deploy classifyre-web
kubectl -n classifyre logs deploy/classifyre-api --tail=200
kubectl -n classifyre logs deploy/classifyre-web --tail=200
kubectl -n classifyre get events --sort-by=.lastTimestamp
helm status classifyre -n classifyre
```

## Repo Workflow Notes

- keep Helm values under version control
- keep deployment-specific values files separate from local/minikube values
- prefer Helm upgrades over ad hoc manual cluster edits
- treat image publication and chart publication as part of the same release workflow
