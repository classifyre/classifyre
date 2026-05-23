# Telemetry & Observability

Classifyre ships with optional OpenTelemetry (OTel) instrumentation across all three components: the NestJS API, the Next.js web app, and the Python CLI. Telemetry is **disabled by default** and is opt-in via Helm values or environment variables.

## Signal types

| Component | Traces | Metrics | Logs |
|-----------|--------|---------|------|
| API (NestJS) | ✓ | ✓ | ✓ |
| Web (Next.js) | ✓ | — | — |
| CLI (Python) | ✓ | — | — |

---

## Quick start

### 1. Enable telemetry with an external OTLP endpoint

```yaml
# values-telemetry.yaml
telemetry:
  enabled: true
  otlpEndpoint: "http://your-otel-collector:4318"
  otlpProtocol: "http/protobuf"
  deployEnv: "production"
```

```bash
helm upgrade classifyre ./helm/classifyre -f values-telemetry.yaml
```

### 2. Deploy the in-cluster OTel Collector gateway

```yaml
telemetry:
  enabled: true
  # otlpEndpoint is auto-set to http://<release>-otel-collector:4318
  receiver:
    enabled: true
    backends:
      traces:
        endpoint: "http://tempo:4318"           # Grafana Tempo
      metrics:
        endpoint: "http://mimir:8080/api/v1/push"  # Grafana Mimir
      logs:
        endpoint: "http://loki:3100/loki/api/v1/push"  # Grafana Loki
```

This deploys `otel/opentelemetry-collector-contrib` as a Deployment + ClusterIP Service in the same namespace. All workloads (API, web, CLI jobs) export to it automatically.

---

## Helm values reference

| Key | Default | Description |
|-----|---------|-------------|
| `telemetry.enabled` | `false` | Master switch. `false` injects `TELEMETRY_DISABLED=1` into all workloads. |
| `telemetry.otlpEndpoint` | `""` | OTLP HTTP/gRPC endpoint. Auto-set to in-cluster Collector when `receiver.enabled=true`. |
| `telemetry.otlpProtocol` | `"http/protobuf"` | `"http/protobuf"` or `"grpc"`. |
| `telemetry.deployEnv` | `"production"` | Value of `deployment.environment.name` resource attribute. |
| `telemetry.instanceId.enabled` | `true` | Persist a stable anonymous UUID in a ConfigMap (survives `helm upgrade`). |
| `telemetry.instanceId.existingConfigMap` | `""` | Bring your own ConfigMap instead of auto-generating. |
| `telemetry.receiver.enabled` | `false` | Deploy the in-cluster OTel Collector gateway. |
| `telemetry.receiver.replicaCount` | `1` | Collector replicas (stateless, safe to scale). |
| `telemetry.receiver.image.tag` | `"0.126.0"` | OTel Collector Contrib image tag. |
| `telemetry.receiver.backends.traces.endpoint` | `""` | Tempo / any OTLP HTTP traces endpoint. |
| `telemetry.receiver.backends.metrics.endpoint` | `""` | Mimir / any Prometheus remote-write endpoint. |
| `telemetry.receiver.backends.logs.endpoint` | `""` | Loki push endpoint. |
| `telemetry.receiver.customConfig` | `""` | Full OTel Collector YAML config override. |

---

## Opt-out

Any of these environment variables disable telemetry at the SDK level, regardless of Helm settings:

```bash
TELEMETRY_DISABLED=1       # Classifyre-specific opt-out
DO_NOT_TRACK=1             # Standard Console DNT convention
CLASSIFYRE_TELEMETRY=false # Alternative flag
```

---

## Anonymous instance ID

When `telemetry.instanceId.enabled=true` (the default when telemetry is enabled), the chart creates a ConfigMap named `<release>-instance-id` containing a randomly-generated UUID:

```yaml
annotations:
  helm.sh/resource-policy: keep   # preserved across helm upgrade
data:
  instance-id: "a3f2c1d0-..."
```

The UUID is injected as `CLASSIFYRE_INSTANCE_ID` and attached to every span and metric as the `service.instance.id` resource attribute. It is never derived from machine IDs or hostnames, so it is safe in environments with cloned VMs or shared base images.

---

## Full LGTM backend stack

For a complete self-hosted observability backend (Loki + Grafana + Tempo + Mimir), deploy the [Grafana LGTM distributed Helm chart](https://github.com/grafana/helm-charts) alongside Classifyre:

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update

# Minimal single-node LGTM stack for staging/dev
helm install lgtm grafana/lgtm-distributed \
  --namespace monitoring --create-namespace \
  -f - <<'EOF'
grafana:
  enabled: true
  adminPassword: "changeme"
loki:
  enabled: true
  loki:
    auth_enabled: false
tempo:
  enabled: true
mimir-distributed:
  enabled: false
# Use monolithic Mimir for simplicity
mimir:
  enabled: true
EOF
```

Then configure Classifyre to point at the LGTM endpoints:

```yaml
telemetry:
  enabled: true
  receiver:
    enabled: true
    backends:
      traces:
        endpoint: "http://lgtm-tempo:4318"
      metrics:
        endpoint: "http://lgtm-mimir-nginx/api/v1/push"
      logs:
        endpoint: "http://lgtm-loki-gateway:80/loki/api/v1/push"
```

> **Production note:** For multi-tenant production deployments, use `grafana/mimir-distributed` instead of monolithic Mimir and enable `auth_enabled: true` on Loki/Tempo. Pass `X-Scope-OrgID: <tenant>` headers via the OTel Collector's `headers_setter` extension.

---

## Collector configuration

The default generated Collector pipeline:

1. **Receives** OTLP gRPC (`:4317`) and OTLP HTTP (`:4318`)
2. **Processes** with `memory_limiter` → PII-stripping `transform` → `batch`
3. **Exports** to configured Tempo / Mimir / Loki backends

The PII transform strips file-path usernames from exception stack traces and redacts email addresses from exception messages.

Override the entire config via `telemetry.receiver.customConfig` (raw YAML string):

```yaml
telemetry:
  receiver:
    enabled: true
    customConfig: |
      receivers:
        otlp:
          protocols:
            http:
              endpoint: "0.0.0.0:4318"
      exporters:
        debug: {}
      service:
        pipelines:
          traces:
            receivers: [otlp]
            exporters: [debug]
```

---

## Python CLI — ephemeral job considerations

The CLI runs as a Kubernetes Job and may finish in under 30 seconds. The OTel SDK is configured with `schedule_delay_millis=2000` (vs the default 5 s) so spans flush incrementally during the job. A `SIGTERM` handler calls `force_flush()` before exit.

The Kubernetes Job spec includes `terminationGracePeriodSeconds: 45` (set via `api.cliJobs.activeDeadlineSeconds`) to give the flush time to complete before the kubelet sends `SIGKILL`.

The OTel SDK for the CLI is an optional dependency group. Install it with:

```bash
uv sync --group otel
```

When not installed, the CLI starts normally with no telemetry — there is no error.
