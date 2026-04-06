# Manual Rollout — Develop Namespace

Use this when you want to pull the latest `:develop` image into the running pods **without**
triggering the full GitHub Actions deploy workflow.

> **Warning:** The next GitHub Actions deploy will overwrite any manual `kubectl set` / `kubectl edit`
> changes. If you want something permanent (e.g. a new env var), add it to
> `helm/classifyre/values-vps-develop.yaml` and commit instead.

---

## Prerequisites

```bash
export KUBECONFIG=~/.kube/config-classifyre-vps
```

---

## Restart a single deployment

```bash
# Web only
kubectl -n classifyre-develop rollout restart deployment/classifyre-develop-web

# API only
kubectl -n classifyre-develop rollout restart deployment/classifyre-develop-api
```

## Restart both at once

```bash
kubectl -n classifyre-develop rollout restart \
  deployment/classifyre-develop-web \
  deployment/classifyre-develop-api
```

## Wait for rollout to complete

```bash
kubectl -n classifyre-develop rollout status deployment/classifyre-develop-web
kubectl -n classifyre-develop rollout status deployment/classifyre-develop-api
```

## Check current pod state

```bash
kubectl -n classifyre-develop get pods
```

---

## Why this is needed

Both deployments use a mutable `:develop` image tag with `imagePullPolicy: Always`. Kubernetes
only re-pulls the image when the pod is recreated — it does **not** watch the registry for changes.

The API deployment self-triggers on every Helm upgrade because it has a
`checksum/cli-job-template` annotation on its pod template (the annotation hash changes whenever
the CLI job configmap changes). The web deployment has no such annotation, so a manual
`rollout restart` (or the one baked into `develop.yml`) is required to pick up a new image.
