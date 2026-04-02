# Classifyre Helm Production Deployment

This guide covers production deployment of Classifyre on Kubernetes with the Helm chart in [`helm/classifyre`](/unstructured/helm/classifyre).

Published images:

- API: `classifyre/api`
- Web: `classifyre/web`
- CLI jobs: `classifyre/cli`

## Deployment Model

The chart creates:

- an `api` Deployment
- a `frontend` Deployment
- namespace-scoped Kubernetes Jobs for CLI extraction and sandbox execution
- PostgreSQL in one of these modes:
  - `external`
  - `cnpg`
  - `embedded`

For production, prefer `postgres.mode=external` or `postgres.mode=cnpg`. Use `embedded` only when the cluster itself is the whole deployment boundary.

## Production Checklist

- Keep `api.image`, `frontend.image`, and `api.cliJobs.image` aligned to the same release.
- Prefer immutable tags or digests over long-lived mutable tags.
- Set a stable `api.maskedConfigEncryption` secret and keep it unchanged across upgrades.
- Keep Web as the public entrypoint and route browser API requests through `/api`.
- Persist runner logs and CLI caches with PVCs sized for your workload.
- Keep `serviceAccount.automount=true` and `rbac.create=true` when `api.cliJobs.enabled=true`.

## Required Secrets

Create the namespace once:

```bash
kubectl create namespace classifyre
```

Create the masked-config encryption key:

```bash
kubectl -n classifyre create secret generic classifyre-api-secrets \
  --from-literal=CLASSIFYRE_MASKED_CONFIG_KEY="$(openssl rand -base64 32)"
```

If you use external PostgreSQL, create the DB secret:

```bash
kubectl -n classifyre create secret generic classifyre-db \
  --from-literal=password='<db-password>'
```

## Recommended Production Values

Example `values-prod.yaml`:

```yaml
serviceAccount:
  create: true
  automount: true

rbac:
  create: true

api:
  image:
    repository: classifyre/api
    tag: "<immutable-tag>"
    pullPolicy: IfNotPresent
  maskedConfigEncryption:
    existingSecret: classifyre-api-secrets
    secretKey: CLASSIFYRE_MASKED_CONFIG_KEY
  env:
    ENVIRONMENT: kubernetes
    NODE_ENV: production
    PORT: "8000"
    TEMP_DIR: /tmp
    RUNNER_LOGS_DIR: /var/lib/classifyre/runner-logs
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: "1"
      memory: 1Gi
  runnerLogs:
    enabled: true
    size: 20Gi
  cliJobs:
    enabled: true
    image:
      repository: classifyre/cli
      tag: "<immutable-tag>"
      pullPolicy: IfNotPresent
    cleanupPolicy: always
    waitTimeoutSeconds: 3900
    pollIntervalMs: 2000
    resources:
      requests:
        cpu: 500m
        memory: 1Gi
      limits:
        cpu: "2"
        memory: 4Gi
    uvCache:
      enabled: true
      size: 20Gi

frontend:
  image:
    repository: classifyre/web
    tag: "<immutable-tag>"
    pullPolicy: IfNotPresent
  env:
    NODE_ENV: production
    PORT: "3100"
    HOSTNAME: 0.0.0.0
    NEXT_PUBLIC_API_URL: /api
  resources:
    requests:
      cpu: 200m
      memory: 384Mi
    limits:
      cpu: "1"
      memory: 1Gi

postgres:
  mode: external
  connection:
    sslMode: require
  external:
    host: <db-host>
    port: 5432
    database: classifyre
    username: classifyre
    existingSecret: classifyre-db
    existingSecretPasswordKey: password

ingress:
  enabled: true
  className: nginx
  host: classifyre.example.com
  tls:
    - hosts:
        - classifyre.example.com
      secretName: classifyre-tls
```

## k3s NodePort Profile

For single-node k3s without ingress, use the repo values file [`helm/classifyre/values-vps.yaml`](/unstructured/helm/classifyre/values-vps.yaml).

That profile keeps:

- `ingress.enabled=false`
- `frontend.service.type=NodePort`
- `frontend.service.nodePort=30100`
- API internal as `ClusterIP`
- browser traffic entering through Web, then proxying `/api`
- `ReadWriteOnce` PVC access modes for local-path storage

Use it with:

```bash
export KUBECONFIG=~/.kube/config-classifyre-vps

cd /unstructured

helm upgrade --install classifyre ./helm/classifyre \
  -n classifyre \
  --create-namespace \
  -f ./helm/classifyre/values-vps.yaml
```

The public entrypoint for that profile is `http://<node-ip>:30100`.

## Install Or Upgrade

For a general production install:

```bash
cd /unstructured

helm upgrade --install classifyre ./helm/classifyre \
  -n classifyre \
  --create-namespace \
  -f ./values-prod.yaml
```

Keep deployment-specific values files in version control so chart upgrades remain reproducible.

The repo also includes a production-oriented starting point at [`helm/classifyre/values-production.example.yaml`](/unstructured/helm/classifyre/values-production.example.yaml).

## Verification

After each install or upgrade:

```bash
helm status classifyre -n classifyre
kubectl -n classifyre get pods
kubectl -n classifyre get svc
kubectl -n classifyre get pvc
```

Verify the public Web entrypoint and API health:

```bash
curl -i http://<public-endpoint>/
curl -i http://<public-endpoint>/api/ping
```

Verify CLI job creation:

```bash
kubectl -n classifyre get jobs
kubectl -n classifyre get pods -l app.kubernetes.io/component=cli-job
```

Fail the deployment if any source is stuck `RUNNING` without a matching active runner:

```bash
bash ./scripts/check-k8s-runner-invariants.sh
```

If the API has already been upgraded to the reconciliation-safe runner lifecycle and you need to repair stale source state in-place:

```bash
bash ./scripts/check-k8s-runner-invariants.sh --repair
```

## Upgrade Sequence

Recommended order:

1. Publish new `api`, `web`, and `cli` images.
2. Update values files if image tags, storage, or chart settings changed.
3. Run `helm upgrade`.
4. Watch API and Web rollout until the new pods are ready.
5. Run a sandbox job and at least one real ingestion run.

If only image tags changed, a deployment restart can refresh pods, but Helm should remain the source of truth for any manifest or values change.
